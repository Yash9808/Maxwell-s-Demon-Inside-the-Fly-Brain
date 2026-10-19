"use strict";
/** deployment/lib/mode_flybody.js — FlyBody embodiment smoke via the gated venv python.
 *
 * Post-Phase-02 ADDITIVE gate: EMBODIMENT_REQUIRE_GL=1 additionally requires
 * the sidecar's welcome banner to report a REAL visual sensor provenance
 * ("sensor": "egocentric_field_bins"). Default unchanged (banner is advisory
 * only) so the historical acceptance battery semantics are preserved.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const util = require("./util");

async function modeFlybody(jsonOut) {
  const problems = [];
  const py = util.needPython(jsonOut, "PYTHON_EMBODIMENT");
  if (!py) return ["PYTHON_EMBODIMENT gate failed"];

  const log = path.join(jsonOut.dir, "flybody.log");
  const cmd = [py, "embodiment/smoke_test.py", "--mode", "flybody"];
  const r = util.runSuite(cmd, log, { timeout: 900_000 });
  const text = fs.readFileSync(log, "utf8");
  const ok = r.status === 0 && /EMBODIMENT FOUNDATION READY/i.test(text) && /T7 determinism\s+PASS/i.test(text);
  jsonOut.suites.push(util.suiteResult("flybody_smoke", cmd, r, { logPath: log, pass: ok }));
  if (!ok) problems.push("flybody_smoke");

  if (process.env.EMBODIMENT_REQUIRE_GL === "1") {
    // Probe the sidecar hello banner for the real-visual provenance stamp.
    const probe = spawnSync(py,
      ["-c", "import sys,os,json; sys.path.insert(0, os.path.join(os.getcwd(),'embodiment'));"
        + "from sidecar import Sidecar; sc=Sidecar(body='flybody');"
        + "print(json.dumps(sc.handle({'type':'hello','client':'deploy'})))"],
      { cwd: util.ROOT, encoding: "utf8", timeout: 300_000 });
    let visual = null, parseErr = null;
    try {
      const line = (probe.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
      const banner = JSON.parse(line);
      visual = banner && banner.assets && banner.assets.visual;
    } catch (e) { parseErr = String(e); }
    const glOk = !!visual && visual.sensor === "egocentric_field_bins";
    jsonOut.suites.push({ name: "flybody_visual_gate", pass: glOk,
      checks: { visual, stderr: (probe.stderr || "").slice(0, 500), parseErr } });
    if (!glOk) problems.push("flybody_visual_gate");
  }
  return problems;
}

module.exports = modeFlybody;
