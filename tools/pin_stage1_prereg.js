#!/usr/bin/env node
/**
 * tools/pin_stage1_prereg.js — REGENERATOR for PRE_REGISTRATION_STAGE1.json
 * (protocol §13; never edit the JSON by hand).
 *
 * Refuses to write unless every gate prerequisite passes:
 *   1. stage1_analyze.js --selftest exits 0
 *   2. node --test tests/stage1_arm_d_match.test.js exits 0
 *   3. benchmark.js --config stage1_config.json REPLIably refuses (the
 *      pilot-prohibition test: with the pin absent it must exit 2 — checked
 *      BEFORE the pin is written, so the check is meaningful)
 * Only then does it hash and pin: protocol, config, analysis, match test,
 * runtime files, benchmark — i.e. every input that could have changed a
 * Stage-1 outcome. `gitDirty: true` is recorded verbatim (this checkout is
 * a working branch); the pin protects∗ the CONTENT listed below.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PIN_PATH = path.join(ROOT, "PRE_REGISTRATION_STAGE1.json");
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function run(cmd, args, opts) {
  return execFileSync(cmd, args, Object.assign({ encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }, opts || {}));
}

// ---- gate 1: analysis selftest ------------------------------------------
let selftestOut = null;
try {
  selftestOut = run(process.execPath, [path.join(ROOT, "stage1_analyze.js"), "--selftest"], {});
  const line = selftestOut.split("\n").find(l => /selftest: (\d+) passed, (\d+) failed/.test(l));
  const m = line && line.match(/selftest: (\d+) passed, (\d+) failed/);
  if (!m || +m[2] !== 0) throw new Error("selftest not green: " + (line || selftestOut));
  console.log("prereq 1 OK — stage1_analyze selftest:", line.trim());
} catch (e) {
  console.error("PREREQ FAIL (analysis selftest):", (e.stdout || "") + (e.message || e));
  process.exit(2);
}

// ---- gate 2: arm D match test --------------------------------------------
let matchOut = null;
try {
  matchOut = run(process.execPath, ["--test", path.join(ROOT, "tests", "stage1_arm_d_match.test.js")], { timeout: 400000 });
  const pm = matchOut.match(/pass (\d+)/), fm = matchOut.match(/fail (\d+)/);
  if (!pm || +fm[1] !== 0) throw new Error("match test not green: pass=" + (pm && pm[1]));
  console.log("prereq 2 OK — arm D match test:", pm[1], "passing, 0 failing");
} catch (e) {
  console.error("PREREQ FAIL (arm D match test):", (e.stdout || "") + (e.message || e));
  process.exit(2);
}

// ---- gate 3: pilot-prohibition (benchmark must REFUSE while pin is absent)
if (fs.existsSync(PIN_PATH)) {
  console.error("REFUSING to regenerate over an existing pin without --force\n" +
    "(amendment discipline, §13: delete the file explicitly + rerun, or pass --force after the §0 amendment note is written)");
  process.exit(2);
}
try {
  run(process.execPath, [path.join(ROOT, "benchmark.js"), "--config", "stage1_config.json"], { timeout: 120000 });
  console.error("PREREQ FAIL: benchmark --config RAN despite missing pin — pilot-prohibition is broken");
  process.exit(2);
} catch (e) {
  // expected: process.exit(2) surfaces as ExecException with status 2; the
  // refusal message goes to STDERR (console.error in benchmark.js)
  const code = e.status !== undefined ? e.status : (e.code === 2 ? 2 : null);
  const out = (e.stdout || "") + "\n" + (e.stderr || "");
  if (code === 2 && /PRE_REGISTRATION_STAGE1\.json is missing/.test(out)) {
    console.log("prereq 3 OK — pilot-prohibition holds (benchmark refused with exit 2)");
  } else {
    console.error("PREREQ FAIL: benchmark failure was NOT the expected pilot-prohibition refusal" +
      " (exit=" + code + "): " + out.slice(0, 300));
    process.exit(2);
  }
}

// ---- compose the registration record -------------------------------------
const existing = fs.existsSync(PIN_PATH) ? JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) : null;
if (existing && process.argv.includes("--force")) {
  existing.amendments = existing.amendments || [];
  existing.amendments.push({ date: new Date().toISOString(), note: "superseded by tools/pin_stage1_prereg.js --force" });
}

function git(...args) {
  try { return execFileSync("git", args, { encoding: "utf8", cwd: ROOT }).trim(); }
  catch { return "UNKNOWN"; }
}

const pins = {};
const FILES = [
  "Confirmatory_experiment_protocol_v1.md",
  "stage1_config.json",
  "stage1_analyze.js",
  "tests/stage1_arm_d_match.test.js",
  "experiment_core.js",
  "controllers.js",
  "benchmark.js",
];
for (const rel of FILES) pins[rel] = sha256(path.join(ROOT, rel));

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "stage1_config.json"), "utf8"));

const record = {
  registration_version: 1,
  registered_utc: new Date().toISOString(),
  stage: 1,
  declared_status: "EXPLORATORY (protocol §7); pilot-prohibition holds until this record exists",
  protocol: { document: FILES[0], sha256: pins[FILES[0]] },
  analysis_expectations: {
    endpoint: "deltaSortEntropy_post_minus_pre",
    contrasts: "seed-paired A−D (primary candidate), A−B, A−C (secondary); descriptive-only in Stage 1 (§7/§14)",
    selftest_fixture_count: 5,
  },
  match_test: { file: FILES[3], sha256: pins[FILES[3]], real_circuit_fingerprint_note: "validated on the full real circuit in-test" },
  config: {
    file: FILES[1], sha256: pins[FILES[1]],
    arms: Object.keys(config.arms),
    consumedSeedPairs: config.seedTable.consumedPairs,
    seedPairReserve: config.seedTable.pairs.length,
    frozenPreSeconds: config.frozenPreSeconds,
    phases: config.phases,
  },
  runtime: { files: { experiment_core: pins[FILES[4]], controllers: pins[FILES[5]], benchmark: pins[FILES[6]] } },
  analysis: { file: FILES[2], sha256: pins[FILES[2]], selftest: "--selftest green at registration time" },
  pinned_files: pins,
  circuit: { file: "fly_brain_circuit.json", n_neurons: idx.layers.reduce((a, l) => a + l.length, 0), n_edges: idx.edges.length },
  git: { commit: git("rev-parse", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), dirty: git("status", "--porcelain").length > 0 },
  amendment_note: "Any change to a pinned file after registration invalidates the pin and requires the §13 amendment path (re-run selftest + match test, regenerate, note in protocol §0).",
};
if (existing && existing.amendments) record.amendments = existing.amendments;

fs.writeFileSync(PIN_PATH, JSON.stringify(record, null, 2) + "\n");
console.log("wrote", PIN_PATH);
console.log("pinned:", FILES.join(", "));
console.log("Stage-1 pilot prohibition is now lifted.",
  "'node benchmark.js --config stage1_config.json' may run the pinned protocol ONLY.");
// pin protects the CONTENT listed; working-tree state is recorded, not judged
