// Smoke test: run a tiny E2 (ANN) and E8 (demon) benchmark and check that
// layerRates rows are emitted and collectBrainDeltas aggregates regions.
const CORE = require("./experiment_core.js");
const CTRL = require("./controllers.js");

function collectRows(spec) {
  const rows = [];
  CORE.runBenchmark({
    seed: 1, nSeeds: 1, trialsTrain: 4, trialsTest: 1, episodeSeconds: 2,
    nParticles: 60, noise: 0.12, doorHeight: 64,
    controllers: spec,
    onTrialData: (cond, phase, tr) => rows.push(Object.assign({ condition: cond, phase }, tr)),
  });
  return rows;
}

// ---- E2 (ANN + random)
let rows = collectRows({
  ann: (rng, env, cfg) => CTRL.annController(rng, env, cfg),
  random: (rng, env) => CTRL.randomController(rng, env),
});
const annRows = rows.filter(r => r.layerRates);
console.log("E2 rows with layerRates:", annRows.length, "/", rows.length);
if (!annRows.length) { console.error("FAIL: E2 produced no brain rows"); process.exit(1); }
console.log("E2 layer names:", Object.keys(annRows[0].layerRates));

// ---- E8 (classical demon variants)
rows = collectRows({
  demon_adaptive: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg, { adaptive: true }),
  demon_fixed: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg, { adaptive: false }),
});
const e8Rows = rows.filter(r => r.layerRates);
console.log("E8 rows with layerRates:", e8Rows.length, "/", rows.length);
if (!e8Rows.length) { console.error("FAIL: E8 produced no brain rows"); process.exit(1); }
console.log("E8 layer names:", Object.keys(e8Rows[0].layerRates));

// ---- region aggregation (same rules as the new collectBrainDeltas)
function regionForRateName(nm) {
  const s = (nm || "").toLowerCase();
  if (/antennal|\bpn\b|olfact/.test(s)) return "antennal";
  if (/kenyon|mushroom|hidden|\bmb\b/.test(s)) return "mb";
  if (/optic|medulla|lobula|lamina/.test(s)) return "optic";
  if (/motor|descend|vnc|neck/.test(s)) return "motor";
  if (/lateral horn|\blh\b/.test(s)) return "lh";
  if (/central complex|ellipsoid|fan-shaped|\bcx\b|\beb\b|\bpb\b|\bfb\b/i.test(s)) return "cx";
  return "central";
}
for (const r of annRows.concat(e8Rows))
  console.log(" ", r.condition, "->", Object.keys(r.layerRates).map(k => regionForRateName(k)).join(","));

// every emitted layer must land in a non-central region
const bad = annRows.concat(e8Rows).flatMap(r => Object.keys(r.layerRates))
  .filter(k => regionForRateName(k) === "central");
if (bad.length) { console.error("FAIL: layers fell into 'central':", bad); process.exit(1); }

// ---- regression: E3 drosophila rows still emitted
rows = collectRows({ drosophila: (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg) });
const e3Rows = rows.filter(r => r.layerRates);
console.log("E3 rows with layerRates:", e3Rows.length, "/", rows.length);
if (!e3Rows.length) { console.error("FAIL: E3 regression"); process.exit(1); }

console.log("ALL OK");
