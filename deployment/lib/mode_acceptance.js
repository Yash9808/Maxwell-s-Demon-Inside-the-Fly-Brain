"use strict";
/** deployment/lib/mode_acceptance.js — full Phase 02 acceptance: every mode, in order. */

const ORDER = [
  "verify", "p0", "e9", "validation", "p1", "sandbox", "smoke",
  "benchmark", "flybody", "flyvis", "closedloop", "replay", "protocol",
];

async function modeAcceptance(jsonOut, util) {
  const problems = [];
  // lazy requires to avoid circulars and keep startup cheap
  const MODES = {
    verify: require("./mode_verify"),
    p0: require("./mode_suites").p0,
    e9: require("./mode_suites").e9,
    validation: require("./mode_suites").validation,
    p1: require("./mode_suites").p1,
    sandbox: require("./mode_suites").sandbox,
    smoke: require("./mode_suites").smoke,
    benchmark: require("./mode_benchmark"),
    flybody: require("./mode_flybody"),
    flyvis: require("./mode_flyvis"),
    closedloop: require("./mode_suites").closedloop,
    replay: require("./mode_replay"),
    protocol: require("./mode_protocol"),
  };
  for (const name of ORDER) {
    process.stdout.write(`[acceptance] ${name} ...\n`);
    try {
      const p = await MODES[name](jsonOut, util);
      if (p.length) problems.push(...p.map((x) => `${name}:${x}`));
    } catch (e) {
      problems.push(`${name}:runner_error:${(e && e.message) || e}`);
      jsonOut.suites.push({ name: `${name}_exception`, pass: false, error: String((e && e.stack) || e) });
    }
  }
  return problems;
}

module.exports = modeAcceptance;
