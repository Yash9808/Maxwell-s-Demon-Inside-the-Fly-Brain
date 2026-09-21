/** _smoke_exp14b.js — honest physics assertions (mean over trials, not single shots). */
"use strict";
const fs = require("fs");
const src = fs.readFileSync("experiment_core.js", "utf8");
const mod = { exports: {} };
new Function("module", "exports", "require", src)(mod, mod.exports, () => {});
const CORE = mod.exports;

const ok = [];
const ck = (name, cond, detail) => { ok.push([name, cond]); console.log((cond ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : "")); };

// ---------------- E9 ---------------------------------------------------------
const e9 = CORE.pressureDemonCore({ seed: 7, trials: 10, episodeSeconds: 15 });
const d = e9.conditions.demon_speed, r9 = e9.conditions.demon_random, nv = e9.conditions.never_open;
ck("E9 demon mean dT > never-open mean dT + 3*floor",
   d.summary.testDT.mean > nv.summary.testDT.mean + 60,
   `demon ${d.summary.testDT.mean.toFixed(0)} vs never ${nv.summary.testDT.mean.toFixed(0)}`);
ck("E9 demon mean dT > random mean dT",
   d.summary.testDT.mean > r9.summary.testDT.mean,
   `random ${r9.summary.testDT.mean.toFixed(0)}`);
ck("E9 demon does more spring work than never-open",
   d.summary.testWorkJ.mean > nv.summary.testWorkJ.mean * 1.5,
   `${d.summary.testWorkJ.mean.toExponential(2)} vs ${nv.summary.testWorkJ.mean.toExponential(2)}`);
ck("E9 never-open is a noise floor (|dT| < 100)",
   Math.abs(nv.summary.testDT.mean) < 100, nv.summary.testDT.mean.toFixed(0));

// ---------------- E10 --------------------------------------------------------
const e10 = CORE.smoluchowskiCore({ seed: 7, trials: 6, episodeSeconds: 15 });
const tl = e10.conditions.trapdoor_light, th = e10.conditions.trapdoor_heavy;
ck("E10 light trapdoor passes molecules", tl.summary.testOpenFraction.mean > 0.5,
   tl.summary.testOpenFraction.mean.toFixed(2) + " /s");
ck("E10 heavy trapdoor passes fewer than light",
   th.summary.testOpenFraction.mean < tl.summary.testOpenFraction.mean,
   `heavy ${th.summary.testOpenFraction.mean.toFixed(2)} vs light ${tl.summary.testOpenFraction.mean.toFixed(2)}`);
ck("E10 relaxes toward equilibrium (|imb| < 0.12)",
   Math.abs(tl.summary.testDT.mean) < 0.12, "imb " + tl.summary.testDT.mean.toFixed(3));

// ---------------- E11 --------------------------------------------------------
const e11 = CORE.feynmanRatchetCore({ seed: 7, trials: 6, episodeSeconds: 15 });
const rg = e11.conditions.ratchet_gradient, re = e11.conditions.ratchet_equilibrium, rh = e11.conditions.ratchet_heavy_load;
ck("E11 gradient ratchet rotates forward", rg.summary.testDT.mean > 2,
   "net/ep " + rg.summary.testDT.mean.toFixed(2));
ck("E11 equilibrium ratchet cannot extract work (|net| < 20% of gradient)",
   Math.abs(re.summary.testDT.mean) < Math.abs(rg.summary.testDT.mean) * 0.2,
   "net/ep " + re.summary.testDT.mean.toFixed(2));
ck("E11 heavy load turns slower than light load",
   rh.summary.testDT.mean < rg.summary.testDT.mean,
   `heavy ${rh.summary.testDT.mean.toFixed(2)} vs ${rg.summary.testDT.mean.toFixed(2)}`);

let pass = 0;
for (const [, g] of ok) if (g) pass++;
console.log("----");
console.log("PASS %d/%d", pass, ok.length);
process.exit(pass === ok.length ? 0 : 1);
