"use strict";
/** deployment/lib/mode_replay.js — canonical seed-11 replay vs frozen Phase 01 hash.
 *
 * Post-Phase-02 ADDITIVE: EMBODIMENT_TRAJECTORY_SHA256 (64-hex, optional)
 * switches the comparison target to a NEW canonical baseline (e.g. the
 * flybody-mode trajectory with real visual feedback). Default unchanged:
 * the frozen Phase 01 hash (fail-closed default preserved).
 */
const fs = require("fs");
const path = require("path");
const util = require("./util");

const FROZEN_SHA = "05c47753fe56af3de12d5fa3b209e6c3ef20f88a74952154977b1c568bac204b";
const ENV_SHA = (process.env.EMBODIMENT_TRAJECTORY_SHA256 || "").trim().toLowerCase();
const EXPECTED_SHA = /^[0-9a-f]{64}$/.test(ENV_SHA) ? ENV_SHA : FROZEN_SHA;

async function modeReplay(jsonOut) {
  const problems = [];
  const py = util.needPython(jsonOut, "PYTHON_EMBODIMENT");
  if (!py) return ["PYTHON_EMBODIMENT gate failed"];

  const log = path.join(jsonOut.dir, "replay.log");
  const script = path.join(util.ROOT, "deployment", "replay_canonical.js");

  const r = util.runSuite([process.execPath, script], log, {
    env: { PYTHON_EMBODIMENT: py },
    timeout: 900_000,
  });
  const text = fs.readFileSync(log, "utf8");
  const m = text.match(/TRAJECTORY_SHA256=([0-9a-f]{64})/);
  const got = m ? m[1] : null;
  const records = (() => { try { return parseInt((text.match(/RECORDS=(\d+)/) || [])[1], 10) || null; } catch { return null; } })();

  const ok = r.status === 0 && got === EXPECTED_SHA && records === 240;
  jsonOut.suites.push(util.suiteResult("canonical_replay", [process.execPath, "deployment/replay_canonical.js"], r, {
    logPath: log, pass: ok,
    checks: { expected: EXPECTED_SHA, frozen_phase01: FROZEN_SHA, observed: got, records, match: got === EXPECTED_SHA },
  }));
  if (!ok) problems.push("canonical_replay_mismatch");
  return problems;
}

module.exports = modeReplay;
