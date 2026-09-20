"use strict";
/**
 * E11 · Feynman Ratchet & Pawl — long-scale validation sweep (headless).
 *
 * Question:  does the ratchet_neural learning gain over ratchet_frozen hold
 *             with proper statistics (independent-seed 95% CIs)?
 * Protocol:  30 s episodes, 24 train + 12 test episodes, 10 seeds,
 *             real FAFB circuit (fly_brain_circuit.json), real worker code.
 *
 * The independent replicate for every CI is the SEED (per Phase-2 contract):
 * each seed's TEST-phase mean is one sample; meanCI gives mean ± 1.96·SEM.
 * Only the random seed differs between runs — all physics/controller params
 * are identical and come from the shared core (no tuning, validation only).
 *
 * Usage:  node e11_validation_sweep.js [seeds] [seedBase]
 */
const fs = require("fs");
const path = require("path");

const N_SEEDS  = Math.max(2, parseInt(process.argv[2] || "10", 10));
const SEED_BASE = parseInt(process.argv[3] || "101", 10);
const TRAIN = 24, TEST = 12, EPISODE_S = 30;
const OUT = path.join("research_data", "e11_validation_sweep.json");
const OUT_CSV = path.join("research_data", "e11_validation_sweep.csv");

// ---- real worker code in a Node shim (same harness as _lab_sweep.js) ----
const workerSrc = fs.readFileSync("experiment_worker.js", "utf8");
const messages = [], errors = [];
const selfObj = { postMessage: (m) => { if (m.type === "error") errors.push(m); messages.push(m); } };
selfObj.self = selfObj;
class XHRShim {
  constructor() { this.status = 0; this.responseText = ""; }
  open(_m, url) { this._url = url; }
  send() {
    const p = path.join(__dirname, this._url);
    if (fs.existsSync(p)) { this.status = 200; this.responseText = fs.readFileSync(p, "utf8"); }
    else this.status = 404;
  }
}
new Function("self", "postMessage", "XMLHttpRequest", "location", "atob", "btoa", workerSrc)(
  selfObj, selfObj.postMessage, XHRShim, { origin: "http://localhost" },
  (s) => Buffer.from(s, "base64").toString("binary"),
  (s) => Buffer.from(s, "binary").toString("base64"));

// ---- the REAL FAFB circuit (same file the 3D page feeds the worker) ----
console.log("loading fly_brain_circuit.json (real FAFB v783)…");
const CIRCUIT = JSON.parse(fs.readFileSync("fly_brain_circuit.json", "utf8"));
console.log(`circuit: ${CIRCUIT.n} neurons, ${CIRCUIT.edges.length} edges`);

// ---- run one multi-seed E11 batch through the worker ----
function runE11(seeds, seedBase) {
  return new Promise((resolve) => {
    const startIdx = messages.length;
    selfObj.onmessage({ data: { type: "run", expId: "e11", circuit: CIRCUIT,
      opts: { seeds, seed: seedBase, train: TRAIN, test: TEST, episode: EPISODE_S } } });
    const totalEp = (TRAIN + TEST) * seeds * 5;  // 5 conditions when circuit present
    (function poll() {
      const done = messages.slice(startIdx).find(m => m.type === "done" && m.expId === "e11");
      if (done) return resolve(done);
      const err = errors.find(m => m.expId === "e11");
      if (err) return resolve({ error: String(err.message).split("\n")[0] });
      const last = messages.slice(startIdx).filter(m => m.type === "progress" && m.expId === "e11").pop();
      process.stdout.write(`\r  progress: ${last ? `${last.phase} ep ${last.trial}/${last.nTrials} (seed ${last.seedIdx}/${seeds})` : "starting…"}   `);
      setTimeout(poll, 500);
    })();
  });
}

// ---- per-seed TEST-phase means for a condition (seed = independent unit) --
function perSeedTestMean(rows, cond, field) {
  const bySeed = new Map();
  for (const r of rows) {
    if (r.condition !== cond || (r.phase || "train") !== "test") continue;
    const v = Number(r[field]);
    if (!Number.isFinite(v)) continue;
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, []);
    bySeed.get(r.seed).push(v);
  }
  return [...bySeed.entries()].map(([sd, vals]) => ({
    seed: sd,
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    n: vals.length,
  }));
}

function meanCI(vals) {
  const n = vals.length;
  if (!n) return { mean: NaN, ci: NaN, n: 0 };
  const m = vals.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: m, ci: 0, n };
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
  return { mean: m, ci: 1.96 * sd / Math.sqrt(n), n };  // 95% CI (normal approx, as CORE.meanCI)
}

// ---- paired per-seed learning gain: neural − frozen on matched seeds ------
function pairedGain(rows, field) {
  const neu = perSeedTestMean(rows, "ratchet_neural", field);
  const fro = perSeedTestMean(rows, "ratchet_frozen", field);
  const froBySeed = new Map(fro.map(s => [s.seed, s.mean]));
  const pairs = [];
  for (const s of neu) if (froBySeed.has(s.seed)) pairs.push({ seed: s.seed, d: s.mean - froBySeed.get(s.seed) });
  const ci = meanCI(pairs.map(p => p.d));
  return { ...ci, pairs, nSeeds: pairs.length };
}

// ---- determinism check: identical seed must reproduce identical rows -----
function rowKey(r) {
  return [r.condition, r.phase, r.trial, r.seed, r.reward, r.netWorkJ, r.netRotation,
          r.demonAgree, r.decisionAccuracy].map(x => (typeof x === "number" ? x.toFixed(9) : x)).join("|");
}

(async () => {
  console.log(`\nE11 long-scale validation: ${N_SEEDS} seeds × (24 train + 12 test) × 30 s episodes`);
  console.log(`conditions: ratchet_neural (learning) vs ratchet_frozen (control) + 3 physics refs\n`);
  const t0 = Date.now();
  const done = await runE11(N_SEEDS, SEED_BASE);
  if (done.error) { console.error(`\nRUN FAILED: ${done.error}`); process.exit(1); }
  const rows = done.rows || [];
  console.log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(0)} s — ${rows.length} episode rows`);

  // sanity: expected condition set + per-seed/phase coverage
  const conds = [...new Set(rows.map(r => r.condition))].sort();
  console.log(`  conditions: ${conds.join(", ")}`);

  // ---------- determinism check (rerun seed_base only, 1 seed) ----------
  console.log("\n[1] determinism check — rerunning the first seed…");
  const det = await runE11(1, SEED_BASE);
  if (det.error) { console.error(`determinism rerun FAILED: ${det.error}`); process.exit(1); }
  const firstSeedRows = rows.filter(r => r.seed === 1);
  const detRows = det.rows || [];
  const a = firstSeedRows.map(rowKey).sort();
  const b = detRows.map(rowKey).sort();
  const identical = a.length === b.length && a.every((k, i) => k === b[i]);
  console.log(`  same seed → same trajectory: ${identical ? "YES (row-for-row identical)" : "NO — DETERMINISM VIOLATION"}`);
  if (!identical) {
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a[i] !== b[i]) { console.log(`  first diff at sorted row ${i}:\n    run1: ${a[i]}\n    run2: ${b[i]}`); break; }
  }

  // ---------- statistics: seed as the independent replicate ----------
  console.log("\n[2] TEST-phase results (seed = independent replicate, mean ± 95% CI):");
  const stats = {};
  for (const cond of conds) {
    stats[cond] = {};
    for (const f of ["reward", "decisionAccuracy", "demonAgree", "netWorkJ", "workJEp", "netPerEpisode", "dopamine", "weightDrift"]) {
      const per = perSeedTestMean(rows, cond, f);
      stats[cond][f] = meanCI(per.map(p => p.mean));
    }
  }
  const fmt = (s) => `${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(4)} ± ${s.ci.toFixed(4)} (n=${s.n})`;
  const fmtJ = (s) => `${s.mean >= 0 ? "+" : ""}${(s.mean * 1e21).toExponential(2)}e-21 ± ${(s.ci * 1e21).toExponential(2)}e-21 J (n=${s.n})`;
  const rowsOf = (c) => rows.filter(r => r.condition === c);
  for (const cond of conds) {
    console.log(`\n  ${cond}:`);
    console.log(`    reward          : ${fmt(stats[cond].reward)}`);
    console.log(`    decisionAccuracy: ${fmt(stats[cond].decisionAccuracy)}`);
    console.log(`    demonAgree      : ${fmt(stats[cond].demonAgree)}`);
    console.log(`    netWorkJ        : ${fmtJ(stats[cond].netWorkJ)}`);
    console.log(`    netRotation/ep  : ${fmt(stats[cond].netPerEpisode)}`);
    if (cond.startsWith("ratchet_neural") || cond.startsWith("ratchet_frozen")) {
      console.log(`    dopamine        : ${fmt(stats[cond].dopamine)}`);
      console.log(`    weightDrift     : ${fmt(stats[cond].weightDrift)}`);
    }
  }

  // ---------- paired neural-vs-frozen learning gain ----------
  console.log("\n[3] PAIRED learning gain (neural − frozen, matched seeds, TEST phase):");
  const fields = ["reward", "decisionAccuracy", "demonAgree", "netWorkJ", "netPerEpisode"];
  const gains = {};
  for (const f of fields) {
    gains[f] = pairedGain(rows, f);
    const g = gains[f];
    const sig = Number.isFinite(g.ci) && Math.abs(g.mean) > g.ci && g.nSeeds >= 2;
    const u = f === "netWorkJ" ? "e-21 J" : "";
    console.log(`    ${f.padEnd(17)}: ${g.mean >= 0 ? "+" : ""}${(f === "netWorkJ" ? g.mean * 1e21 : g.mean).toFixed(4)}${u} ± ${(f === "netWorkJ" ? g.ci * 1e21 : g.ci).toFixed(4)}${u}  n=${g.nSeeds} → ${sig ? "SIGNIFICANT" : "not significant"}`);
  }

  // ---------- gradient reference comparison ----------
  console.log("\n[4] Thermal-gradient reference (ratchet_gradient, Th>Tc — extracts work by physics):");
  const grad = stats.ratchet_gradient ? stats.ratchet_gradient.netWorkJ : null;
  if (grad) console.log(`    netWorkJ: ${fmtJ(grad)}  (physics benchmark; neural/frozen run at equilibrium Th=Tc)`);

  // ---------- learning-curve blocks (per-seed blocks → cross-seed CI) ----------
  console.log("\n[5] Learning curve (ratchet_neural reward, per-seed blocks of 4 eps → cross-seed 95% CI):");
  const B = 4;
  const neuTrain = rows.filter(r => r.condition === "ratchet_neural" && r.phase === "train");
  const maxBlock = Math.floor(TRAIN / B);
  const curvePts = [];
  for (let bi = 0; bi < maxBlock; bi++) {
    const perSeed = [];
    for (const sd of new Set(neuTrain.map(r => r.seed))) {
      const vals = neuTrain.filter(r => r.seed === sd &&
        r.trial >= bi * B && r.trial < (bi + 1) * B).map(r => Number(r.reward)).filter(Number.isFinite);
      if (vals.length) perSeed.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    const ci = meanCI(perSeed);
    curvePts.push({ block: bi + 1, ...ci });
    console.log(`    block ${String(bi + 1).padStart(2)} (ep ${bi * B + 1}-${(bi + 1) * B}): ${ci.mean >= 0 ? "+" : ""}${ci.mean.toFixed(4)} ± ${ci.ci.toFixed(4)} (n=${ci.n} seeds)`);
  }

  // ---------- persistence ----------
  const report = {
    meta: {
      expId: "e11", apparatus: "feynmanRatchetCore", circuit: "fly_brain_circuit.json (real FAFB v783)",
      seeds: N_SEEDS, seedBase: SEED_BASE, trainEpisodes: TRAIN, testEpisodes: TEST,
      episodeSeconds: EPISODE_S, controller: "connectome (FAFB) + eligibility windows + PG readout",
      frozenControl: "same brain, setLearning(false) in all phases",
      ciMethod: "seed = independent replicate; mean ± 1.96·SEM (CORE.meanCI convention)",
      gainTest: "paired neural−frozen per matched seed; significant iff |mean| > 95% CI",
      determinism: identical ? "pass (same seed → identical rows)" : "FAIL",
      elapsedS: Math.round((Date.now() - t0) / 1000),
      generated: new Date().toISOString(),
    },
    determinism: identical,
    stats, gains, curvePts,
    conditions: conds,
  };
  fs.mkdirSync("research_data", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  // per-seed CSV for the paper
  const csvRows = [["condition", "phase", "trial", "seed", "reward", "decisionAccuracy", "demonAgree", "netWorkJ", "netPerEpisode", "dopamine", "weightDrift"].join(",")];
  for (const r of rows) csvRows.push([r.condition, r.phase, r.trial, r.seed, r.reward, r.decisionAccuracy, r.demonAgree, r.netWorkJ, r.netPerEpisode, r.dopamine, r.weightDrift].join(","));
  fs.writeFileSync(OUT_CSV, csvRows.join("\n"));
  console.log(`\nsaved: ${OUT} (stats) + ${OUT_CSV} (per-episode rows)`);

  // ---------- verdict ----------
  const gR = gains.reward, gW = gains.netWorkJ;
  const sigR = Number.isFinite(gR.ci) && Math.abs(gR.mean) > gR.ci;
  const sigW = Number.isFinite(gW.ci) && Math.abs(gW.mean) > gW.ci;
  console.log("\n================ VERDICT ================");
  console.log(`neural−frozen reward gain   : ${gR.mean >= 0 ? "+" : ""}${gR.mean.toFixed(4)} ± ${gR.ci.toFixed(4)} → ${sigR ? "SIGNIFICANT" : "NOT significant"}`);
  console.log(`neural−frozen netWorkJ gain : ${(gW.mean * 1e21).toExponential(2)}e-21 ± ${(gW.ci * 1e21).toExponential(2)}e-21 J → ${sigW ? "SIGNIFICANT" : "NOT significant"}`);
  console.log(`determinism                 : ${identical ? "pass" : "FAIL"}`);
  console.log(sigR || sigW
    ? "\n→ The Phase-3 learning gain HOLDS with proper statistics."
    : "\n→ The learning gain does NOT hold with proper statistics — report honestly.");
})();
