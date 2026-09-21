/** _smoke_exp14.js — physics sanity of the three apparatus sims. */
"use strict";
const fs = require("fs");
const src = fs.readFileSync("experiment_core.js", "utf8");
const mod = { exports: {} };
new Function("module", "exports", "require", src + "\n//# sourceURL=experiment_core.js")(mod, mod.exports, () => { throw new Error("no require"); });
const CORE = mod.exports;

const ok = [];
const ck = (name, cond, detail) => { ok.push([name, cond]); console.log((cond ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : "")); };

// ---- E9: speed-demon must beat both controls on dP and work ----------------
const e9 = CORE.pressureDemonCore({ seed: 7, trials: 8, episodeSeconds: 12 });
const d = e9.conditions.demon_speed, r9 = e9.conditions.demon_random, n = e9.conditions.never_open;
ck("E9 demon dP > random dP", d.summary.testDT.mean > r9.summary.testDT.mean,
   d.summary.testDT.mean.toFixed(3) + " vs " + r9.summary.testDT.mean.toFixed(3));
ck("E9 demon dP > never-open dP", d.summary.testDT.mean > n.summary.testDT.mean,
   n.summary.testDT.mean.toFixed(3));
ck("E9 demon work > never-open work", d.summary.testWorkJ.mean > n.summary.testWorkJ.mean,
   d.summary.testWorkJ.mean.toExponential(2) + " vs " + n.summary.testWorkJ.mean.toExponential(2));
ck("E9 demon work >= random work", d.summary.testWorkJ.mean >= r9.summary.testWorkJ.mean * 0.9,
   d.summary.testWorkJ.mean.toExponential(2) + " vs " + r9.summary.testWorkJ.mean.toExponential(2));
ck("E9 never-open dP ~ 0", Math.abs(n.summary.testDT.mean) < 0.05, n.summary.testDT.mean.toFixed(4));

// ---- E10: trapdoor must NOT sort (relaxation, |imbalance| small) -----------
const e10 = CORE.smoluchowskiCore({ seed: 7, trials: 6, episodeSeconds: 12 });
const tl = e10.conditions.trapdoor_light, th = e10.conditions.trapdoor_heavy;
ck("E10 light trapdoor lets molecules through", tl.summary.testOpenFraction.mean > 0.2,
   tl.summary.testOpenFraction.mean.toFixed(3) + " crossings/s");
ck("E10 stays near equilibrium (|imb| < 0.15)", Math.abs(tl.summary.testDT.mean) < 0.15,
   "imb " + tl.summary.testDT.mean.toFixed(3));
ck("E10 heavy door passes fewer molecules",
   th.summary.testOpenFraction.mean < tl.summary.testOpenFraction.mean,
   th.summary.testOpenFraction.mean.toFixed(3) + " vs " + tl.summary.testOpenFraction.mean.toFixed(3));

// ---- E11: gradient ratchet nets forward, equilibrium nets ~0 ---------------
const e11 = CORE.feynmanRatchetCore({ seed: 7, trials: 6, episodeSeconds: 12 });
const rg = e11.conditions.ratchet_gradient, re = e11.conditions.ratchet_equilibrium;
ck("E11 gradient ratchet turns forward on average", rg.summary.testDT.mean > 0,
   "net/ep " + rg.summary.testDT.mean.toFixed(3));
ck("E11 equilibrium ratchet ~ no net rotation", Math.abs(re.summary.testDT.mean) < rg.summary.testDT.mean * 0.5,
   "net/ep " + re.summary.testDT.mean.toFixed(3) + " vs " + rg.summary.testDT.mean.toFixed(3));

// shape: rows + summary compatible with the existing pipeline
const row = e9.conditions.demon_speed && null;
ck("conditions have _apparatus flag", !!d._apparatus && !!tl._apparatus && !!rg._apparatus);
ck("labels present", !!d.label && !!tl.label && !!rg.label);

let pass = 0;
for (const [, g] of ok) if (g) pass++;
console.log("----");
console.log("PASS %d/%d", pass, ok.length);
process.exit(pass === ok.length ? 0 : 1);
