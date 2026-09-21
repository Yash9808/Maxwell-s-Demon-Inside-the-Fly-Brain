"use strict";
/** deployment/lib/mode_flyvis.js — FlyVis probes via the gated flyvis venv python. */
const fs = require("fs");
const path = require("path");
const util = require("./util");

async function modeFlyvis(jsonOut) {
  const problems = [];
  const py = util.needPython(jsonOut, "FLYVIS_PYTHON");
  if (!py) return ["FLYVIS_PYTHON gate failed"];

  const log = path.join(jsonOut.dir, "flyvis_probe.log");
  const cmd = [py, "p1_flyvis_probe.py"];
  const r = util.runSuite(cmd, log, { timeout: 900_000 });
  const text = fs.readFileSync(log, "utf8");
  const ok = r.status === 0 && /ALL PROBES PASS/i.test(text);
  jsonOut.suites.push(util.suiteResult("flyvis_probe", cmd, r, { logPath: log, pass: ok }));
  if (!ok) problems.push("flyvis_probe");
  return problems;
}

module.exports = modeFlyvis;
