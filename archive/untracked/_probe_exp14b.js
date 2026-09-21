/** _probe_exp14b.js — track E9 never_open side temps / counts / energy drift. */
"use strict";
const fs = require("fs");
const src = fs.readFileSync("experiment_core.js", "utf8");
const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => {});
const CORE = mod.exports;

let n = 0;
const rows = [];
CORE.pressureDemonCore({
  seed: 7, trials: 2, episodeSeconds: 10,
  onState: (s) => {
    if (s.cond !== "never_open") return;
    n++;
    if (n % 20 === 1) rows.push([s.t, s.tl, s.tr, s.dT, s.piston]);
  },
});
console.log(" t     Tl      Tr      dT    piston");
for (const r of rows) console.log(r[0].toFixed(2), r[1].toFixed(0), r[2].toFixed(0), r[3].toFixed(1), r[4].toFixed(3));
// If Tl/Tr are noisy but flat -> estimator noise; if they drift -> real dynamics.
const dTs = rows.map(r => r[3]);
const mean = dTs.reduce((a, b) => a + b, 0) / dTs.length;
const sd = Math.sqrt(dTs.reduce((a, b) => a + (b - mean) ** 2, 0) / dTs.length);
console.log("dT mean %s sd %s  (flat => dT is just instantaneous noise)", mean.toFixed(1), sd.toFixed(1));
