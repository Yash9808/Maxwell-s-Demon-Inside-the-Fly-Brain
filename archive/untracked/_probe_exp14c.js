/** _probe_exp14c.js — why does never-open drift to dT ≈ −336?
 * Trace per-step dT, per-trial side stats, and boundary events. */
"use strict";
const fs = require("fs");
const CORE = require("./experiment_core.js");

// instrument by monkey-patching nothing: re-run with tiny trials and log.
// Instead of touching the core, replicate its never-open loop minimally? No —
// simplest: call pressureDemonCore with trials=4 and rely on onState trace.
const states = [];
const res = CORE.pressureDemonCore({
  seed: 1, trials: 4, episodeSeconds: 20, nParticles: 260,
  onState: (st) => { if (st.cond === "never_open") states.push(st); },
});
const s = res.conditions.never_open.summary;
console.log("never_open mean dT:", s.testDT.mean.toFixed(1));
console.log("states:", states.length);
for (const st of states.filter((_, i) => i % 40 === 0)) {
  console.log("t=%5.1f dT=%7.1f tl=%6.0f tr=%6.0f piston=%5.1f valve=%.2f",
              st.t, st.dT, st.tl, st.tr, st.piston, st.valve);
}
