/** _probe_exp14.js — why does never_open show a phantom dT? */
"use strict";
const fs = require("fs");
const src = fs.readFileSync("experiment_core.js", "utf8");
const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => {});
const CORE = mod.exports;

// instrument: capture onState dT trajectory for the never-open variant only
let last = null;
const traj = [];
CORE.pressureDemonCore({
  seed: 7, trials: 3, episodeSeconds: 8,
  onState: (s) => { if (s.cond === "never_open") { last = s; traj.push([s.t, s.dT, s.piston, s.pl, s.pr]); } },
});
const first = traj[0], mid = traj[(traj.length / 2) | 0], end = traj[traj.length - 1];
console.log("samples:", traj.length);
console.log("t=0   dT=%s piston=%s pl=%s pr=%s", first[1].toFixed(1), first[2].toFixed(2), first[3].toFixed(0), first[4].toFixed(0));
console.log("t=mid dT=%s piston=%s pl=%s pr=%s", mid[1].toFixed(1), mid[2].toFixed(2), mid[3].toFixed(0), mid[4].toFixed(0));
console.log("t=end dT=%s piston=%s pl=%s pr=%s", end[1].toFixed(1), end[2].toFixed(2), end[3].toFixed(0), end[4].toFixed(0));
// mean dT
const mdT = traj.reduce((a, x) => a + x[1], 0) / traj.length;
const mpist = traj.reduce((a, x) => a + x[2], 0) / traj.length;
console.log("mean dT: %s   mean piston: %s", mdT.toFixed(2), mpist.toFixed(3));
// per-side counts at the end
console.log("final nl/nr:", last ? last.nl + "/" + last.nr : "n/a");
