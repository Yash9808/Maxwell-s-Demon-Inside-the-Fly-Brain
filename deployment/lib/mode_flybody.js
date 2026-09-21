"use strict";
/** deployment/lib/mode_flybody.js — FlyBody embodiment smoke via the gated venv python. */
const fs = require("fs");
const path = require("path");
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
  return problems;
}

module.exports = modeFlybody;
