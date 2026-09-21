#!/usr/bin/env node
"use strict";
/**
 * deployment/deploy_runner.js — THE canonical Phase 02 deployment runner (main).
 *
 * Modes:
 *   verify | p0 | e9 | validation | p1 | sandbox | smoke | benchmark |
 *   flybody | flyvis | closedloop | replay | protocol | failures | acceptance
 *
 * Fail closed: exit 0 only when every check in the mode passes.
 * Artifacts:   deployment/runs/<utcstamp>_<mode>/mode.json + per-suite logs.
 *
 * Env gates (deterministic validation errors, no silent fallback):
 *   PYTHON_EMBODIMENT — required by benchmark, flybody, closedloop, replay.
 *   FLYVIS_PYTHON     — required by flyvis.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const util = require("./lib/util");

const MODES = {
  verify: require("./lib/mode_verify"),
  p0: require("./lib/mode_suites").p0,
  e9: require("./lib/mode_suites").e9,
  validation: require("./lib/mode_suites").validation,
  p1: require("./lib/mode_suites").p1,
  sandbox: require("./lib/mode_suites").sandbox,
  smoke: require("./lib/mode_suites").smoke,
  closedloop: require("./lib/mode_suites").closedloop,
  benchmark: require("./lib/mode_benchmark"),
  flybody: require("./lib/mode_flybody"),
  flyvis: require("./lib/mode_flyvis"),
  replay: require("./lib/mode_replay"),
  protocol: require("./lib/mode_protocol"),
  failures: require("./lib/mode_failures"),
  acceptance: require("./lib/mode_acceptance"),
};

async function main() {
  const mode = process.argv[2];
  if (!mode || !MODES[mode]) {
    console.error(`usage: node deployment/deploy_runner.js <${Object.keys(MODES).join("|")}>`);
    process.exit(2);
  }

  const dir = util.ensureRunDir(mode);
  const jsonOut = {
    artifact: "phase02_deployment_runner_result",
    mode,
    started_utc: new Date().toISOString(),
    dir: path.relative(ROOT, dir),
    host: { os: os.type(), platform: process.platform, arch: process.arch, node: process.version },
    git: {
      head: util.git(["rev-parse", "HEAD"]),
      branch: util.git(["branch", "--show-current"]),
      dirty: util.git(["status", "--porcelain"]) !== "",
    },
    python_embodiment: process.env.PYTHON_EMBODIMENT || null,
    suites: [],
    checks: [],
    problems: [],
    pass: false,
  };

  let problems;
  try {
    problems = await MODES[mode](jsonOut, util);
  } catch (e) {
    problems = [`runner_error:${(e && e.message) || e}`];
    jsonOut.suites.push({ name: "runner_exception", pass: false, error: String((e && e.stack) || e) });
  }

  jsonOut.problems = problems;
  jsonOut.pass = problems.length === 0;
  jsonOut.finished_utc = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "mode.json"), JSON.stringify(jsonOut, null, 2) + "\n");

  for (const s of jsonOut.suites) {
    console.log(`${s.pass ? "PASS" : "FAIL"}  ${s.name}${s.error ? `  [${String(s.error).slice(0, 90)}]` : ""}`);
  }
  console.log(jsonOut.pass
    ? `RESULT: PASS (${mode})`
    : `RESULT: FAIL (${mode}) — ${problems.join(", ")}`);
  process.exit(jsonOut.pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
