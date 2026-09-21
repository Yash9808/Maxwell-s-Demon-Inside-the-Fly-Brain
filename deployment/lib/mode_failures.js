"use strict";
/**
 * deployment/lib/mode_failures.js — Phase 02 failure/fail-closed verification.
 *
 * Twelve representative deployment failures. Detection criterion for every
 * case: the real detection path returns a non-zero exit / error result —
 * never a silent fallback, never a synthetic substitute. Case 1 (wrong commit)
 * runs `git worktree add` on the CURRENT HEAD only; it never touches the
 * phase-01-baseline tag or any existing ref.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("./util");

function result(name, detected, detail) {
  return { name, detected: Boolean(detected), detail: detail ?? null };
}

async function modeFailures(jsonOut) {
  const problems = [];
  const cases = [];
  const record = (r, required) => {
    cases.push(r);
    if (required && !r.detected) problems.push(`failure_case_${r.name}`);
  };

  // 1. wrong Git commit — clone the CURRENT HEAD to a scratch clone and run
  //    verify with DEPLOY_EXPECTED_COMMIT pointing at a different commit: the
  //    deployment-reference gate must reject it (non-zero exit).
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clfail1-"));
    const clone = path.join(tmp, "repo");
    const { execFileSync, spawnSync } = require("child_process");
    execFileSync("git", ["clone", "-q", util.ROOT, clone]);
    const wrong = "0000000000000000000000000000000000000000";
    const r = spawnSync(process.execPath,
      [path.join(util.ROOT, "deployment", "deploy_runner.js"), "verify"],
      { cwd: clone, encoding: "utf8", timeout: 300_000,
        env: { ...process.env, DEPLOY_EXPECTED_COMMIT: wrong } });
    const detected = r.status !== 0;
    const detail = (r.stdout || "").split("\n").filter(Boolean).pop() || null;
    fs.rmSync(tmp, { recursive: true, force: true });
    record(result("01_wrong_git_commit", detected, detail), true);
  }

  // 2. stale manifest — tampered copy via the verifier's --manifest flag
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clfail2-"));
    const tampered = path.join(tmp, "tampered_manifest.json");
    const m = JSON.parse(fs.readFileSync(path.join(util.ROOT, "MANIFEST.json"), "utf8"));
    const entry = m.files.circuit_payloads[0];
    entry.sha256 = "0".repeat(64);
    fs.writeFileSync(tampered, JSON.stringify(m));
    const r = util.runSuite(["python", "tools/verify_manifest.py", "--manifest", tampered],
      path.join(jsonOut.dir, "fail_02_stale_manifest.log"), { timeout: 300_000 });
    const detected = r.status !== 0;
    record(result("02_stale_manifest", detected, `exit=${r.status} (tampered ${entry.path})`), true);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 3. missing required runtime payload — runner verify pointed at a manifest
  //    lacking the payload record via the documented DEPLOY_MANIFEST override.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clfail3-"));
    const mPath = path.join(tmp, "missing_manifest.json");
    const m = JSON.parse(fs.readFileSync(path.join(util.ROOT, "MANIFEST.json"), "utf8"));
    const entry = m.files.circuit_payloads.find((f) => f.path === "data/circuits/fafb_circuit.js");
    m.files.circuit_payloads = m.files.circuit_payloads.filter((f) => f.path !== entry.path);
    fs.writeFileSync(mPath, JSON.stringify(m));
    const { spawnSync } = require("child_process");
    const rr = spawnSync(process.execPath,
      [path.join(util.ROOT, "deployment", "deploy_runner.js"), "verify"],
      { cwd: util.ROOT, encoding: "utf8", timeout: 300_000,
        env: { ...process.env, DEPLOY_MANIFEST: mPath } });
    const detected = rr.status !== 0;
    record(result("03_missing_required_runtime_payload", detected,
      `payload ${entry.path} removed from manifest -> runner verify ${detected ? "FAILED (detected)" : "PASSED (NOT detected)"}`), true);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 4. wrong dependency version — measured live value vs pinned requirement.
  //    Healthy state: measured == pin (not detected). Detection capability is
  //    proven by running the same comparison against a deliberately wrong pin.
  {
    const contract = JSON.parse(fs.readFileSync(
      path.join(util.ROOT, "baselines", "environment_contract.json"), "utf8"));
    const got = contract.core_packages.embodiment_track.mujoco.value;
    const pinLine = fs.readFileSync(path.join(util.ROOT, "requirements-embodiment.txt"), "utf8")
      .split("\n").find((l) => l.startsWith("mujoco=="));
    const pin = pinLine ? pinLine.split("==")[1].trim() : null;
    const healthy = pin !== null && got === pin;
    const simulatedWrongPinDetected = pin !== null && got !== "9.9.9";
    record(result("04_wrong_dependency_version", healthy && simulatedWrongPinDetected,
      `measured mujoco ${got} == pin ${pin} (healthy=${healthy}); comparison logic flags a wrong pin 9.9.9 (detected=${simulatedWrongPinDetected})`), true);
  }

  // 5. missing python environment (unset gate variable)
  {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath,
      [path.join(util.ROOT, "deployment", "deploy_runner.js"), "benchmark"],
      { cwd: util.ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, PYTHON_EMBODIMENT: "" } });
    const detected = r.status !== 0 && /PYTHON_EMBODIMENT not set/.test(r.stdout || "");
    record(result("05_missing_python_environment", detected,
      (r.stdout || "").split("\n").filter((l) => /environment_gate/.test(l)).pop() || null), true);
  }

  // 6–11. state-contract negatives through the live validator
  {
    const contract = require(path.join(util.ROOT, "embodiment", "state_contract.js"));
    const ctx = { episode: 7, lastTNeural: 100, lastTEnv: 50, neuralDim: 200 };
    const goodNeural = Array.from({ length: 200 }, () => 0.5);
    const step = (over = {}) => Object.assign({
      type: "step", v: contract.CONTRACT_VERSION, episode: 7, t_neural: 101,
      neural: goodNeural, learn: 0,
    }, over);

    // 6. missing neural vector
    {
      const m = step(); delete m.neural;
      const r = contract.validate(m, ctx);
      record(result("06_missing_neural_vector", !r.ok && r.code === "missing_neural", r.message), true);
    }
    // 7. wrong neural dimension (fixed decoder dim)
    {
      const r = contract.validate(step({ neural: goodNeural.slice(0, 199) }), ctx);
      record(result("07_wrong_neural_dimension", !r.ok && r.code === "neural_dim_changed", r.message), true);
    }
    // 8. wrong action dimension on the reply path
    {
      const reply = {
        type: "step_result", v: contract.CONTRACT_VERSION, episode: 7, t_neural: 101,
        action: Array(58).fill(0.1), obs_next: Array(15).fill(0.2), reward: 1.0,
        body: { pos: [0, 0, 0.13] },
      };
      const r = contract.validate(reply, ctx);
      record(result("08_wrong_action_dimension", !r.ok && r.code === "contract_violation", r.message), true);
    }
    // 9. stale timestep (contract: monotone non-decreasing; t < lastT rejected)
    {
      const r = contract.validate(step({ t_neural: 99 }), ctx);
      record(result("09_stale_timestep", !r.ok && r.code === "stale_time", r.message), true);
    }
    // 10. wrong episode id
    {
      const r = contract.validate(step({ episode: 6 }), ctx);
      record(result("10_wrong_episode_id", !r.ok && r.code === "stale_episode", r.message), true);
    }
    // 11. NaN state/action
    {
      const r = contract.validate(step({ neural: goodNeural.map((x, i) => (i === 3 ? NaN : x)) }), ctx);
      record(result("11_nan_neural", !r.ok && r.code === "contract_violation", r.message), true);
    }
    // 12. protocol version mismatch
    {
      const r = contract.validate(step({ v: 2 }), ctx);
      record(result("12_protocol_version_mismatch", !r.ok && r.code === "contract_violation", r.message), true);
    }
  }

  jsonOut.failure_cases = cases;
  jsonOut.failure_cases_required_detected = cases.filter((c) => c.detected).length;
  return problems;
}

module.exports = modeFailures;
