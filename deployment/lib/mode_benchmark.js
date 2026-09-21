"use strict";
/** deployment/lib/mode_benchmark.js — bit-exact benchmark verification vs Phase 01. */
const fs = require("fs");
const path = require("path");
const util = require("./util");

const PHASE01 = {
  connectome: { agree: 0.536, entropy: 0.0282, goodBad: 0.95 },
  shuffled_connectome: { agree: 0.489, entropy: 0.0244, goodBad: 0.53 },
};

async function modeBenchmark(jsonOut) {
  const problems = [];
  const py = util.needPython(jsonOut, "PYTHON_EMBODIMENT");
  if (!py) return ["PYTHON_EMBODIMENT gate failed"];

  const log = path.join(jsonOut.dir, "benchmark.log");
  const r = util.runSuite(["node", "benchmark.js", "--quick"], log, {
    env: { PYTHON_EMBODIMENT: py },
    timeout: 900_000,
  });
  const text = fs.readFileSync(log, "utf8");

  // headline lines look like:
  // "connectome  demonAgree 0.536 ± 0.0282 | sortEntropy ... | good:bad 0.95"
  const line = /^(\S+)\s+demonAgree\s+([\d.]+)\s+±\s+([\d.]+)\s+\|\s+sortEntropy\s+([\d.]+)\s+±\s+([\d.]+)\s+\|\s+good:bad\s+([\d.]+)$/gm;
  const vals = {};
  for (const a of text.matchAll(line)) {
    vals[a[1]] = {
      agree: parseFloat(a[2]),
      agree_ci: parseFloat(a[3]),
      entropy: parseFloat(a[4]),
      entropy_ci: parseFloat(a[5]),
      goodBad: parseFloat(a[6]),
    };
  }

  const cmp = {};
  const have = Boolean(r.status === 0 && vals.connectome && vals.shuffled_connectome);
  let ok = have;
  if (have) {
    for (const cond of ["connectome", "shuffled_connectome"]) {
      cmp[cond] = {};
      for (const k of ["agree", "entropy", "goodBad"]) {
        cmp[cond][k] = {
          phase01: PHASE01[cond][k],
          phase02: vals[cond][k],
          exact: vals[cond][k] === PHASE01[cond][k],
        };
        if (!cmp[cond][k].exact) ok = false;
      }
    }
  }

  jsonOut.suites.push(util.suiteResult("benchmark_quick", ["node", "benchmark.js", "--quick"], r, {
    logPath: log, pass: ok, checks: { phase01: PHASE01, phase02: vals, comparison: cmp },
  }));
  if (!ok) problems.push("benchmark_bitexact");
  return problems;
}

module.exports = modeBenchmark;
