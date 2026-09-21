"use strict";
/** deployment/lib/mode_suites.js — modes that invoke the canonical existing suites. */
const fs = require("fs");
const path = require("path");
const util = require("./util");

// Canonical suite commands (single source of truth — mirrors baselines/results/results_index.json)
const SUITES = {
  p0: { cmd: ["node", "--test", "test_p0.js"], want: [14, 14], expect: "14/14" },
  e9: { cmd: ["node", "e9_learning_test.js"], text: /all causal tests passed/, expect: "all causal gates PASS" },
  validation: { cmd: ["node", "--test", "validation_tests.js"], want: [15, 15], expect: "15/15" },
  p1: { cmd: ["node", "p1_tests.js"], want: [55, 55], expect: "55/55" },
  sandbox: { cmd: ["node", "--test", "tests/worker_sandbox.test.js"], want: [5, 5], expect: "5/5" },
  smoke: { cmd: ["node", "tests/run_smoke.js"], want: [41, 41], expect: "41/41" },
  closedloop: {
    cmd: ["node", "--test", "tests/closed_loop.test.js"],
    want: [11, 11], expect: "11/11",
    env: "PYTHON_EMBODIMENT", // forwarded to the suite (sidecar spawn)
  },
};

function makeMode(name) {
  const spec = SUITES[name];
  return async function mode(jsonOut) {
    const problems = [];
    let cmd = spec.cmd.slice();
    const extraEnv = {};
    if (spec.env) {
      const py = util.needPython(jsonOut, spec.env);
      if (!py) return [`${spec.env} gate failed`];
      extraEnv[spec.env] = py;
    }
    const log = path.join(jsonOut.dir, `${name}.log`);
    const r = util.runSuite(cmd, log, { env: extraEnv, timeout: name === "smoke" ? 900_000 : 600_000 });
    const text = fs.readFileSync(log, "utf8");
    let ok = r.status === 0;
    let checks = null;
    if (ok && spec.text) {
      ok = spec.text.test(text);
      checks = { matched: ok ? spec.expect : "marker missing" };
    }
    if (ok && spec.want) {
      const c = util.checkCounted(text, spec.want[0], spec.want[1]);
      ok = c.ok;
      checks = c.checks || { why: c.why };
    }
    jsonOut.suites.push(util.suiteResult(name, cmd, r, { logPath: log, pass: ok, checks }));
    if (!ok) problems.push(name);
    return problems;
  };
}

const modes = {};
for (const name of Object.keys(SUITES)) modes[name] = makeMode(name);
module.exports = modes;
