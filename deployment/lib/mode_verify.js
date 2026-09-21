"use strict";
/** deployment/lib/mode_verify.js — environment + dependency + manifest verification. */
const fs = require("fs");
const path = require("path");
const util = require("./util");

async function modeVerify(jsonOut) {
  const problems = [];
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
    if (!ok) problems.push(name);
  };

  // 1. git state
  const head = util.git(["rev-parse", "HEAD"]);
  check("git_head_resolves", Boolean(head), head || "git failed");

  // 2. manifest verification — canonical tool
  const vm = path.join(util.ROOT, "tools", "verify_manifest.py");
  if (!fs.existsSync(vm)) {
    check("manifest_verify_tool_present", false, "tools/verify_manifest.py missing");
  } else {
    const log = path.join(jsonOut.dir, "manifest_verify.log");
    const r = util.runSuite(["python", "tools/verify_manifest.py"], log, { timeout: 300_000 });
    const ok = r.status === 0;
    check("manifest_zero_stale", ok, ok ? null : "tools/verify_manifest.py reported problems — see log");
    jsonOut.suites.push(util.suiteResult("manifest_verify", ["python", "tools/verify_manifest.py"], r, { logPath: log, pass: ok }));
  }

  // 3. environment contract — present, versioned, correct vocabulary
  const cPath = path.join(util.ROOT, "baselines", "environment_contract.json");
  let contract = null;
  if (!fs.existsSync(cPath)) {
    check("environment_contract_present", false, "baselines/environment_contract.json missing — run tools/make_environment_contract.py first");
  } else {
    try { contract = JSON.parse(fs.readFileSync(cPath, "utf8")); } catch { contract = null; }
    check("environment_contract_parse", Boolean(contract));
    if (contract) {
      check("environment_contract_versioned", typeof contract.contract_version === "string");
      const vocab = contract.classification_vocab || [];
      check("environment_contract_vocab",
        ["REQUIRED", "OPTIONAL", "UNKNOWN", "MODEL-ASSUMED", "MISSING-BUT-NON-RUNTIME"].every((c) => vocab.includes(c)));
      const emb = contract.python_environments && contract.python_environments.embodiment;
      check("embodiment_env_present", Boolean(emb && emb.present),
        emb && emb.present ? null : "embodiment venv absent — bootstrap required for physics suites");
    }
  }

  // 4. runtime payload identity vs manifest (DEPLOY_MANIFEST may point the
  //    payload check at an alternate manifest — used by failure-injection
  //    tests; default is the canonical MANIFEST.json)
  const manifestPath = process.env.DEPLOY_MANIFEST && fs.existsSync(process.env.DEPLOY_MANIFEST)
    ? process.env.DEPLOY_MANIFEST
    : path.join(util.ROOT, "MANIFEST.json");
  if (process.env.DEPLOY_MANIFEST && !fs.existsSync(process.env.DEPLOY_MANIFEST)) {
    check("deploy_manifest_present", false, `DEPLOY_MANIFEST points to a nonexistent path: ${process.env.DEPLOY_MANIFEST}`);
  } else if (!fs.existsSync(manifestPath)) {
    check("manifest_present", false, "MANIFEST.json absent");
  } else {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const recs = {};
    for (const lst of Object.values(m.files || {})) for (const f of lst) recs[f.path] = f;
    for (const p of ["data/circuits/fafb_circuit.js", "data/circuits/mcns_circuit.js"]) {
      const rec = recs[p];
      if (!rec || !rec.sha256) { check(`payload_${p}`, false, "no manifest record"); continue; }
      const fp = path.join(util.ROOT, p);
      if (!fs.existsSync(fp)) { check(`payload_${p}`, false, "file absent"); continue; }
      check(`payload_${p}`, util.sha256File(fp) === rec.sha256, "hash mismatch vs manifest");
    }
  }

  jsonOut.checks = checks;
  return problems;
}

module.exports = modeVerify;
