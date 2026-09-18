/**
 * experiment_worker.js — background experiment runner (Web Worker).
 *
 * Runs the seeded multi-controller experiments from the research plan in a
 * separate thread so the 3D lab keeps animating. Posts progress messages:
 *   { type:"progress", expId, phase, trial, nTrials, seedIdx, nSeeds,
 *     curve: [{cond, block, phase, agree, goodBadRatio, sortEntropy, miNeural,
 *              energyJ, dT, openFraction}], live: {cond: agree} }
 *   { type:"done", expId, summary: {conditions}, rows: [...], provenance: {...} }
 *   { type:"error", expId, message }
 *
 * Rows are identical in shape to research_data/ JSONL (benchmark.js).
 *
 * NOTE: experiment_core.js / controllers.js are CommonJS files (module.exports)
 * while workers only provide importScripts. We shim `module`/`exports` around
 * each import and capture what each file exports.
 */
"use strict";

let CORE = null;   // experiment_core.js exports
let CTRL = null;   // controllers.js exports

function importAs(url, requireFn) {
  // Synchronous same-origin fetch (allowed in workers).
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.send();
  if (xhr.status !== 200 && xhr.status !== 0) {
    throw new Error("cannot load " + url + " (status " + xhr.status + ")");
  }
  const mod = { exports: {} };
  // Evaluate inside a function scope: importScripts would execute both files
  // in the worker's single global scope, colliding on shared top-level consts
  // (e.g. `const METRICS` in both experiment_core.js and controllers.js).
  const fn = new Function("module", "exports", "require",
                          xhr.responseText + "\n//# sourceURL=" + url);
  fn(mod, mod.exports, requireFn);   // file ends with: module.exports = {...}
  return mod.exports;
}

try {
  CORE = importAs("experiment_core.js",
                  () => { throw new Error("experiment_core.js must not require()"); });
  CTRL = importAs("controllers.js", () => CORE);
} catch (err) {
  postMessage({ type: "error", expId: null, message: "worker init failed: " + String(err) });
}

// ---------------------------------------------------------------- registry
const EXPERIMENTS = {
  e1: { label: "E1 · Classical Maxwell Demon",
        needsCircuit: false,
        controllers: () => ({ classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg) }),
        seeds: 2, train: 60, test: 12, episode: 12 },
  e2: { label: "E2 · Artificial Neural Demon",
        needsCircuit: false,
        controllers: () => ({ ann: (rng, env, cfg) => CTRL.annController(rng, env, cfg),
                              random: (rng, env) => CTRL.randomController(rng, env) }),
        seeds: 2, train: 60, test: 12, episode: 12 },
  e3: { label: "E3 · Drosophila-Inspired Network",
        needsCircuit: false,
        controllers: () => ({ drosophila: (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg) }),
        seeds: 2, train: 60, test: 12, episode: 12 },
  e4: { label: "E4 · Connectome-Constrained (4A/4B/4C)",
        needsCircuit: true,
        controllers: () => ({
          connectome_4A: (rng, env, cfg) => CTRL.connectomeController(cfg.circuit,
            { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
          connectome_4B: (rng, env, cfg) => CTRL.connectomeController(cfg.circuit,
            { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "restricted" }),
          connectome_4C: (rng, env, cfg) => CTRL.connectomeController(cfg.circuit,
            { shuffle: true, rng, seed: 7, opticDrive: 0.25, plasticity: "full" }),
        }),
        seeds: 1, train: 40, test: 10, episode: 12 },
  e6: { label: "E6 · Jet-Closure Paradox (causal decomposition)",
        needsCircuit: false,
        controllers: () => ({
          classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
          random: (rng, env, cfg) => CTRL.randomController(rng, env, cfg),
          never_gate: (rng, env, cfg) => CTRL.neverGateController(rng, env, cfg),
        }),
        seeds: 2, train: 60, test: 12, episode: 12 },
  e7: { label: "E7 · Generalization Sweep (density × noise)",
        needsCircuit: false,
        controllers: () => ({
          classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
        }),
        // three physics regimes per seed: sparse/clean, default, dense/noisy
        physics: (seedIdx) => seedIdx === 1 ? { nParticles: 120, noise: 0.0 }
                              : seedIdx === 2 ? { nParticles: 640, noise: 0.30 }
                              : { nParticles: 320, noise: 0.12 },
        seeds: 3, train: 50, test: 10, episode: 12 },
  e8: { label: "E8 · Information-Limited Demons",
        needsCircuit: false,
        controllers: () => ({
          demon_adaptive: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg, { adaptive: true }),
          demon_fixed: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg, { adaptive: false }),
          demon_mem4: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg, { memSize: 4 }),
        }),
        seeds: 2, train: 60, test: 12, episode: 12 },
  e5: { label: "E5 · Full Comparator Study",
        needsCircuit: true,
        controllers: () => ({
          classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
          ann: (rng, env, cfg) => CTRL.annController(rng, env, cfg),
          drosophila: (rng, env) => CTRL.drosophilaController(rng, env),
          connectome: (rng, env, cfg) => CTRL.connectomeController(cfg.circuit,
            { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
          shuffled_connectome: (rng, env, cfg) => CTRL.connectomeController(cfg.circuit,
            { shuffle: true, rng, seed: 7, opticDrive: 0.25, plasticity: "full" }),
        }),
        seeds: 1, train: 40, test: 10, episode: 12 },
};

// ------------------------------------------------------- message protocol
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "run") runExperiment(m.expId, m.circuit, m.opts || {});
  else if (m.type === "ping") postMessage({ type: "pong" });
};

function runExperiment(expId, circuit, opts) {
  const spec = EXPERIMENTS[expId];
  if (!spec) { postMessage({ type: "error", expId, message: "unknown experiment" }); return; }
  if (spec.needsCircuit && !circuit) {
    postMessage({ type: "error", expId, message: "circuit data missing" }); return;
  }
  const nSeeds  = opts.seeds  || spec.seeds;
  const train   = opts.train  || spec.train;
  const test    = opts.test   || spec.test;
  const episode = opts.episode || spec.episode;
  const t0 = Date.now();

  // per-condition accumulation of full trial rows (streamed via onTrialData)
  const trialRows = {};     // key -> [row, ...]
  let lastEmit = 0;

  function pushRow(key, phase, tr) {
    const row = Object.assign({ condition: key, phase }, tr);
    (trialRows[key] = trialRows[key] || []).push(row);
  }

  function buildCurve() {
    const curve = [], live = {};
    for (const [key, rows] of Object.entries(trialRows)) {
      const B = 10;
      const bCount = Math.max(1, Math.floor(rows.length / B));
      for (let b = 0; b < bCount; b++) {
        const seg = rows.slice(b * B, (b + 1) * B);
        if (!seg.length) continue;
        const avg = (f) => {
          const vals = seg.map(x => x[f]).filter(v => v !== null && v !== undefined && Number.isFinite(v));
          return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
        };
        curve.push({ cond: key, block: b, phase: seg[0].phase,
                     agree: avg("demonAgree"), goodBadRatio: avg("goodBadRatio"),
                     sortEntropy: avg("sortEntropy"), miNeural: avg("miNeural"),
                     energyJ: avg("energyJ"), dT: avg("dTfinal"),
                     openFraction: avg("openFraction") });
      }
      // live headline: mean agreement over the last 10 rows
      const tail = rows.slice(-10).map(x => x.demonAgree || 0);
      live[key] = tail.length ? tail.reduce((a, c) => a + c, 0) / tail.length : 0;
    }
    return { curve, live };
  }

  function emit(expId_, phase, trial, nTrials, seedIdx, force) {
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;   // throttle UI chatter
    lastEmit = now;
    const { curve, live } = buildCurve();
    postMessage({ type: "progress", expId, phase, trial, nTrials, seedIdx,
                  nSeeds, curve, live });
  }

  try {
    const result = CORE.runBenchmark({
      seed: opts.seed !== undefined ? opts.seed : 1,
      nSeeds,
      trialsTrain: train,
      trialsTest: test,
      episodeSeconds: episode,
      nParticles: opts.nParticles || 320,
      noise: 0.12,
      doorHeight: 64,
      _physics: spec.physics || null,   // per-seed env overrides (E7)
      circuit,                                  // E4/E5 read it via cfg
      controllers: spec.controllers(),
      onTrial: (cond, phase, t, n, si, sn) => {
        emit(expId, phase, t, n, si, false);
      },
      onTrialData: (cond, phase, tr) => { pushRow(cond, phase, tr); },
    });

    // ---- per-condition summary (without raw rows) + flat rows -----------
    // fireVec reduction: decode the last-8-train / last-4-test per-neuron
    // vectors, average them, and attach as fireVecMean on one row per phase
    // (per-trial vectors are dropped to keep the message small).
    const b64toBytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const meanVec = (vecs, n) => {
      if (!vecs.length) return null;
      const acc = new Float64Array(n);
      for (const v of vecs) { const b = b64toBytes(v); for (let i = 0; i < n; i++) acc[i] += b[i]; }
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.round(acc[i] / vecs.length);
      let b64 = "";
      const CH = 3 * 4096;   // multiple of 3 so concatenated base64 stays valid
      for (let o = 0; o < n; o += CH)
        b64 += btoa(String.fromCharCode.apply(null, out.subarray(o, Math.min(n, o + CH))));
      return b64;
    };
    const conditions = {}, rows = [];
    for (const [key, cond] of Object.entries(result.conditions)) {
      const { _raw, ...rest } = cond;
      conditions[key] = rest;
      const run = _raw[0];   // seed 0 carries the anatomy vectors
      if (run) {
        const trs = run.trials;
        const trainTr = trs.filter(t => t.phase !== "test");
        const testTr = trs.filter(t => t.phase === "test");
        const pick = (arr, k) => arr.slice(-k).filter(t => t.fireVec);
        // early-train vectors: first trials of the train phase (for the
        // real-anatomy learning-delta maps: late − early at real positions)
        const pickEarly = (arr, k) => arr.slice(0, k).filter(t => t.fireVec);
        const fvs = { train: pick(trainTr, 8), test: pick(testTr, 4),
                      early: pickEarly(trainTr, 8) };
        let emitted = { train: false, test: false, early: false };
        let meta = null;
        for (const fv of [...fvs.train, ...fvs.test, ...fvs.early]) {
          if (fv && fv.n) { meta = { n: fv.n, layout: fv.layout || null }; break; }
        }
        for (const tr of trs) {
          const row = Object.assign({ condition: key }, tr);
          delete row.fireVec;
          const ph = tr.phase === "test" ? "test" : "train";
          if (!emitted[ph] && meta) {
            const vecs = fvs[ph];
            if (vecs.length) {
              row.fireVecMean = { phase: ph, vec: meanVec(vecs, meta.n),
                                  n: meta.n, layout: meta.layout,
                                  count: vecs.length };
              emitted[ph] = true;
            }
          }
          // one row carries the early-train mean alongside the late-train one
          if (!emitted.early && meta && fvs.early.length && !row.fireVecMean) {
            row.fireVecEarly = { phase: "train", vec: meanVec(fvs.early, meta.n),
                                 n: meta.n, layout: meta.layout, count: fvs.early.length };
            emitted.early = true;
          } else if (!emitted.early && meta && fvs.early.length) {
            row.fireVecEarly = { phase: "train", vec: meanVec(fvs.early, meta.n),
                                 n: meta.n, layout: meta.layout, count: fvs.early.length };
            emitted.early = true;
          }
          rows.push(row);
        }
      } else {
        for (const tr of run ? run.trials : []) rows.push(Object.assign({ condition: key }, tr));
      }
    }
    const { curve } = buildCurve();
    const prov = {
      experiment: expId, label: spec.label,
      seeds: nSeeds, trainTrials: train, testTrials: test,
      episodeSeconds: episode, nParticles: 320, noise: 0.12, doorHeight: 64,
      dt: 1 / 60, tKelvin: 300, simToJoule: 1e-21,
      software: "Fly-Demon Lab v2 experiment list",
      startedISO: new Date(t0).toISOString(),
      elapsedSeconds: (Date.now() - t0) / 1000,
    };
    postMessage({ type: "done", expId, summary: { conditions, curve }, rows, provenance: prov });
  } catch (err) {
    postMessage({ type: "error", expId, message: String(err && err.stack || err) });
  }
}
