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

// (watch pacing) bump when core/controller files change: busts the browser's
// HTTP cache for worker module fetches — a stale experiment_core.js silently
// reintroduces old streamed-t semantics (took one debug session to find).
const WORKER_ASOF = "2026-09-27a";

function importAs(url, requireFn) {
  // Synchronous same-origin fetch (allowed in workers). ?v + no-cache: never
  // serve yesterday's science from the HTTP cache.
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url + "?v=" + WORKER_ASOF, false);
  try { xhr.setRequestHeader("Cache-Control", "no-cache"); } catch (e) {}
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

let RT = null;     // p1_retinotopy.js exports (Stage F hex-lattice optic input)

try {
  CORE = importAs("experiment_core.js",
                  () => { throw new Error("experiment_core.js must not require()"); });
  RT = importAs("p1_retinotopy.js",
                () => { throw new Error("p1_retinotopy.js must not require()"); });
  // controllers.js pulls in both: p1_retinotopy.js (Stage F) + experiment_core.js.
  CTRL = importAs("controllers.js",
                  (spec) => String(spec).includes("p1_retinotopy") ? RT : CORE);
} catch (err) {
  postMessage({ type: "error", expId: null, message: "worker init failed: " + String(err) });
}

// ---- closed-loop core (browser↔body gate) --------------------------------
// One loop implementation, shared verbatim with the CLI runner
// (tools/closed_loop_runner.js). The canonical brain that drives the loop
// lives HERE in the worker — exactly one brain; the page only renders the
// cl_state stream this mode emits. See embodiment/closed_loop_core.js and
// embodiment/state_contract.js (versioned, fail-closed contract).
let CLCORE = null, CLWS = null;
try {
  const CONTRACT = importAs("embodiment/state_contract.js",
                            () => { throw new Error("state_contract must not require()"); });
  CLWS = importAs("embodiment/cl_ws.js",
                  () => { throw new Error("cl_ws must not require()"); });
  CLCORE = importAs("embodiment/closed_loop_core.js",
                    (spec) => spec === "state_contract" ? CONTRACT
                            : spec === "experiment_core" ? CORE
                            : CTRL);
  CLCORE.init((spec) => spec === "state_contract" ? CONTRACT
              : spec === "experiment_core" ? CORE : CTRL);
} catch (err) {
  postMessage({ type: "error", expId: null, message: "closed-loop init failed: " + String(err) });
}

// ------------------------------------------------------- closed-loop mode --
// Drive the CANONICAL connectome brain (the same factory e9BrainFactory uses
// — never a page-side copy) through the REAL FlyBody/MuJoCo sidecar over
// WebSocket and stream the actual loop state to the page (cl_state). Follows
// the app_state discipline: monotone seq, real values only, no placeholders.
function runClosedLoop(m) {
  if (!m.circuit) { postMessage({ type: "error", expId: "cl", message: "circuit data missing" }); return; }
  if (!CLCORE || !CLWS) { postMessage({ type: "error", expId: "cl", message: "closed-loop core failed to init" }); return; }
  const steps = Math.max(1, Math.min(20000, m.steps || 240));
  const seed = m.seed !== undefined ? m.seed : 11;
  const episode = m.episode || 0;
  const learning = m.frozen ? false : true;
  const port = m.port || 8795;
  let seq = 0;
  // fail-closed envelope check: never post a malformed state to the page
  const validEnvelope = (st) => st && typeof st === "object" &&
    Number.isInteger(st.episode) && Number.isInteger(st.t) &&
    typeof st.mode === "string" && st.contract_v === 1;
  const sock = new CLWS.CLWebSocket("ws://127.0.0.1:" + port);
  sock.connect().then(() => CLCORE.runEpisode({
    send: (msg) => sock.send(msg),
    circuit: m.circuit, seed, steps, learning, episode,
    onTick: (rec, ...onTickObs) => {   // NATURE FIGURE v1: rest-arg keeps the
                                       // legacy single-arg call valid
      const st = {   // thin snapshot of the ACTUAL loop state
        kind: "closed_loop", contract_v: 1,
        fly_motion_source: "flybody",   // §17 provenance: this pose IS the real Flybody/MuJoCo stream
        episode, t: rec.t, seed, learning, mode: rec.mode,
        body_pos: rec.body_pos, body_quat: rec.body_quat,
        action: rec.action, reward: rec.reward,
        dopamine: rec.da_after, weight_drift: rec.weight_drift,
        motor_rate: rec.motor_rate,
        neural_active: rec.neural.reduce((a, c) => a + (c > 0 ? 1 : 0), 0),
        neural_dim: rec.neural.length,
        // NATURE FIGURE v1 (additive envelope): the real 15-D observation the
        // brain sees NEXT tick — undefined on legacy core versions, dropped by
        // JSON on the wire when absent. Never synthesized.
        obs_bins: onTickObs.length ? Array.from(onTickObs[0].slice(0, 8)) : undefined,
        obs_proprio: onTickObs.length ? Array.from(onTickObs[0].slice(8, 15)) : undefined,
      };
      if (validEnvelope(st)) postMessage({ type: "cl_state", expId: "cl", seq: ++seq, state: st });
    },
  })).then(({ gates, mode }) => {
    sock.close();
    postMessage({ type: "cl_done", expId: "cl", gates, mode, steps });
  }).catch((e) => {
    sock.close();
    postMessage({ type: "error", expId: "cl",
      message: String(e && e.message || e) +
        " (sidecar must run: python embodiment/sidecar.py --ws --port " + port + ")" });
  });
}

// ------------------------------------------------ E9 fly-brain factory ----
// E9's demon_neural/demon_frozen variants need a real neural controller. We
// reuse the EXACT E4 connectome machinery (LIF over the FAFB circuit, CSR
// spike propagation, eligibility traces, dopamine-gated applyLearning) via a
// small adapter — no second brain implementation. The circuit JSON arrives
// with the run message (window.__expCircuit on the page); if it is missing we
// fall back to the classical-only variant set (core drops the neural rows).
let E9_CIRCUIT = null;
function e9BrainFactory(seedIdx) {
  if (!E9_CIRCUIT) throw new Error("e9 brain requested but no circuit loaded");
  // plasticity "full": every excitatory synapse is eligible; dopamine gates
  // updates through receiveFeedback({reward}). resetForTrial() clears state,
  // NOT weights — learned weights persist across trials inside the controller.
  // One distinct brain draw per seed index so cross-seed CIs reflect
  // seed-to-seed variance, not a shared trajectory.
  return CTRL.connectomeController(E9_CIRCUIT, {
    shuffle: false, rng: makeRng(9176 + (seedIdx || 0) * 37), seed: 1,
    opticDrive: 0,              // no visual field in the pressure apparatus
    motorDrive: 0.6,            // tonic motor-pool drive tuned so the pool can
                                // cross threshold on strong sensory evidence
    plasticity: "full",
    // ---- E9 credit assignment upgrades (opt-in; default paths untouched) --
    // Per-crossing eligibility windows: fast/mid/slow traces so dopamine that
    // arrives seconds after a gate decision still lands on the synapses that
    // caused it (the single 0.985 trace forgets a 3 s-old decision).
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    // Trained policy-gradient readout on the motor population: the core
    // samples P(open) from a REINFORCE-trained softmax over pool rates and
    // routes each decision's credit window into it via pgReward.
    policyGradient: true,
    pgRng: makeRng(424243 + (seedIdx || 0) * 977),
  });
}
function makeRng(seed) {        // local PRNG for the brain factory (mulberry32)
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Apparatus brains (E10/E11) use the SAME connectome controller and credit
// upgrades as E9 — the only difference is what the actuators mean:
//   E10: action 1 = RELEASE the trapdoor flap (sorting window open)
//   E11: action 1 = DROP the pawl (engage the ratchet)
function apparatusBrainFactory(expId, seedIdx) {
  if (!E9_CIRCUIT) throw new Error(expId + " brain requested but no circuit loaded");
  return CTRL.connectomeController(E9_CIRCUIT, {
    shuffle: false, rng: makeRng(9176 + (seedIdx || 0) * 37), seed: 1,
    opticDrive: 0,
    motorDrive: 0.6,
    plasticity: "full",
    // same credit-assignment upgrades as e9BrainFactory (windows + PG readout),
    // plus the apparatus-grade pairing/feature upgrades: pgBaseline applies the
    // REINFORCE update at reward-delivery time (pairs credit with the decision
    // that earned it — the cores deliver before re-latching), includes
    // zero-reward windows as correct rejections, and centers reward with an
    // EMA baseline; pgKc adds the mushroom-body sparse code (12-of-200 random
    // expansion of the sensory channels) as readout features so visitor TYPE
    // reaches the policy directly.
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true,
    pgBaseline: true,
    pgKc: true,
    pgRng: makeRng(424243 + (seedIdx || 0) * 977),
  });
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
        // (audit step 4) trial cut 120→60 total: 3 controllers × 20 trials
        // (15 train + 5 test) — measured 342 s (5.7 s/trial) vs the old
        // 1417 s, a 4.1× dead-air cut. Ranking now comes from the post-
        // benchmark comparator stage, which suits the 4A-vs-4C question
        // better than sparse late-block learning chips.
        seeds: 1, train: 15, test: 5, episode: 12 },
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
  e9: { label: "E9 · Pressure Demon",
        needsCircuit: false,
        apparatus: "pressureDemonCore",          // CORE function name
        apparatusEnv: "pressure",                // 3D environment id
        controllers: () => ({}),
        physics: () => ({ nParticles: 260, noise: 0 }),
        // multi-seed by default: learning curves aggregate across seeds with
        // 95% CIs (CORE.apparatusCurve); override via run opts.seeds
        seeds: 3, train: 12, test: 12, episode: 20 },
  e10: { label: "E10 · Smoluchowski Trapdoor",
        needsCircuit: true,
        apparatus: "smoluchowskiCore",
        apparatusEnv: "trapdoor",
        controllers: () => ({}),
        physics: () => ({ nParticles: 220, noise: 0 }),
        // train: 24 — event-locked decisions fire once per molecule visit (~3x
        // sparser than the old 4 Hz blind clock), so 24 train episodes give
        // the policy a comparable number of graded decisions per training run
        seeds: 1, train: 24, test: 8, episode: 16 },
  e11: { label: "E11 · Feynman Ratchet & Pawl",
        needsCircuit: true,
        apparatus: "feynmanRatchetCore",
        apparatusEnv: "ratchet",
        controllers: () => ({}),
        physics: () => ({ nParticles: 0, noise: 0 }),
        seeds: 1, train: 10, test: 10, episode: 12 },
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
        // (audit step 4) trial cut 125→75 total: 5 controllers × 15 trials
        // (12 train + 3 test) — clean browser run measured 218 s (2.9 s/trial,
        // connectome-dominated; was 805 s for 125 trials, 3.7×). The formal
        // 60-trial (12×5) paired protocol lives in the node-side comparator
        // (e5_comparator.js); the worker run now ends with a comparator stage
        // ranking the 5 conditions on frozen-test agreement.
        seeds: 1, train: 12, test: 3, episode: 12 },
};

// ------------------------------------------------------- message protocol
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "run") {
    E9_CIRCUIT = m.circuit || null;   // real connectome for the E9 fly brain
    runExperiment(m.expId, m.circuit, m.opts || {});
  }
  else if (m.type === "run_custom") {
    try { registerCustom(m); runExperiment("chat", m.circuit, m.opts || {}); }
    catch (err) { postMessage({ type: "error", expId: "chat",
                                message: "custom spec: " + String(err && err.message || err) }); }
  }
  else if (m.type === "run_cl") { try { runClosedLoop(m); }
    catch (err) { postMessage({ type: "error", expId: "cl", message: String(err && err.message || err) }); } }
  else if (m.type === "ping") postMessage({ type: "pong" });
};

// ------------------------------------------------- chat-designed experiments
// The lab page's Chat card lets an LLM (GPT API / local Ollama / LM Studio)
// design an experiment; the design arrives as `spec`, gets registered as the
// pseudo-experiment "chat", and then runs through the exact same pipeline as
// E1-E8 (same rows, curve, provenance and plots broadcasts).
const CHAT_FACTORIES = {
  classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
  ann:             (rng, env, cfg) => CTRL.annController(rng, env, cfg),
  drosophila:      (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg),
  never_gate:      (rng, env, cfg) => CTRL.neverGateController(rng, env, cfg),
  random:          (rng, env, cfg) => CTRL.randomController(rng, env, cfg),
};
const CHAT_ALIASES = {
  classical_demon: "classical_demon", classical: "classical_demon",
  demon: "classical_demon", classic: "classical_demon", physical: "classical_demon",
  ann: "ann", mlp: "ann", neural: "ann", network: "ann",
  drosophila: "drosophila", fly: "drosophila", fly_brain: "drosophila",
  mb: "drosophila", mushroom: "drosophila", mushroom_body: "drosophila",
  never_gate: "never_gate", nevergate: "never_gate", never: "never_gate",
  random: "random", control: "random", baseline: "random",
};
function registerCustom(m) {
  const s = m.spec || {};
  if (!s || typeof s !== "object") throw new Error("spec missing");
  const name = String(s.name || "Chat experiment").slice(0, 60);
  const conds = Array.isArray(s.conditions) ? s.conditions : [];
  const ids = [];
  for (const c of conds) {
    const k = CHAT_ALIASES[String(c).toLowerCase().trim()];
    if (k && !ids.includes(k)) ids.push(k);
  }
  if (!ids.length) ids.push("classical_demon");
  if (ids.length > 4) ids.length = 4;
  const nP = Math.max(40, Math.min(640, Math.round(Number(s.nParticles) || 320)));
  const nN = Math.max(0, Math.min(0.4, Number(s.noise) || 0.12));
  const ep = Math.max(4, Math.min(12, Math.round(Number(s.episodeSeconds) || 12)));
  const tr = Math.max(8, Math.min(60, Math.round(Number(s.trainTrials) || 40)));
  const te = Math.max(4, Math.min(12, Math.round(Number(s.testTrials) || 8)));
  const controllers = () => {
    const out = {};
    ids.forEach((k, i) => {
      const key = k + "_" + (i + 1);
      out[key] = (rng, env, cfg) => CHAT_FACTORIES[k](rng, env, cfg);
    });
    return out;
  };
  EXPERIMENTS.chat = {
    label: "\uD83D\uDCAC " + name,
    needsCircuit: false,
    controllers,
    physics: () => ({ nParticles: nP, noise: nN }),
    seeds: 1, train: tr, test: te, episode: ep,
    design: s,                    // echoed into provenance for the paper trail
  };
}

// (audit step 4) comparator stage — E5's post-benchmark reduction. Ranks the
// run's conditions on FROZEN-test per-decision agreement (95% CI via the
// core's meanCI), with ΔT and good:bad selectivity as context. This is the
// worker-side echo of the formal node-side comparator (e5_comparator.js:
// paired permutation tests on identical env draws) — same ranking question,
// honest but lighter statistics, computed from the rows this run produced.
function buildComparatorStage(rows) {
  const byCond = {};
  for (const r of rows) {
    if (!r || r.phase !== "test") continue;
    (byCond[r.condition] = byCond[r.condition] || []).push(r);
  }
  const entries = [];
  for (const [cond, rs] of Object.entries(byCond)) {
    // benchmark rows carry per-trial agreement directly in demonAgree (0..1);
    // demonDecisions stays 0 there, so NO normalization — take the mean as-is.
    const agree = rs.map(r => r.demonAgree)
                    .filter(v => v !== null && v !== undefined && Number.isFinite(v));
    if (!agree.length) continue;              // condition never decided → unrankable
    entries.push({ cond,
                   agree: CORE.meanCI(agree),
                   dT: CORE.meanCI(rs.map(r => r.dTfinal).filter(v => Number.isFinite(v))),
                   sel: CORE.meanCI(rs.map(r => r.goodBadRatio).filter(v => v !== null && Number.isFinite(v))),
                   n: rs.length });
  }
  entries.sort((a, b) => b.agree.mean - a.agree.mean);
  const top = entries[0], second = entries[1];
  const headline = (top && second)
    ? `${top.cond} > ${second.cond} · test agree ${top.agree.mean.toFixed(2)} vs ${second.agree.mean.toFixed(2)} ±${top.agree.ci.toFixed(2)}`
    : (top ? `${top.cond} leads on test agreement` : null);
  return { ranked: entries, headline };
}

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
  let lastStagePost = 0;   // (audit step 6) wall-clock gate for intra-trial heartbeats
  let curveBuilder = buildCurve;   // apparatus branch swaps in the generic one

  // ---- apparatus experiments (E9/E10/E11): self-contained cores that stream
  // live 3D state + one metrics row per episode. They bypass runBenchmark
  // (no _raw seeds / per-neuron vectors) and reuse everything else: rows ->
  // curve -> sparklines, provenance, plots broadcast.
  if (spec.apparatus) {
    const coreFn = CORE[spec.apparatus];
    const nSeeds = Math.max(1, opts.seeds || spec.seeds || 1);
    const nTrials = train + test;
    curveBuilder = () => buildApparatusCurve(4);
    try {
      let lastAppPost = 0, lastAppSeq = 0;   // (patch 17) app_state replay-stream gate
      // (watch pacing) opts.pace = sim-seconds played per wall-second. The gate
      // sits INSIDE onState, which fires at fixed physics-step boundaries, so
      // holding here stretches only WALL TIME — every step, RNG draw, reward
      // and row is computed exactly as in unpaced runs. Applies to the stage
      // seed only; later seeds still compute at full speed for the curves.
      const pace = Math.max(0, Number(opts.pace) || 0);
      let paceT0 = 0, paceLastT = -1e9;
      // every variant/seed restarts sim-time at 0; re-anchor the pace clock on
      // each regression so ALL conditions play at watch speed, not just the first
      const paceAnchor = (t) => {
        if (t < paceLastT - 1){ paceT0 = 0; }
        paceLastT = t;
        if (!paceT0) paceT0 = Date.now();
      };
      for (let s = 0; s < nSeeds; s++) {
        const seed = (opts.seed !== undefined ? opts.seed : 1) + s * 101;
        coreFn({
          seed,
          seedTag: s + 1,           // rows carry which batch seed produced them
          trials: nTrials,
          trainTrials: train,
          episodeSeconds: episode,
          nParticles: (spec.physics && spec.physics(0, 1) || {}).nParticles || 260,
          // fly-brain conditions are added only when a real circuit arrived;
          // one distinct brain draw per seed (cross-seed CI over brains)
          brainFactory: (expId === "e9" && E9_CIRCUIT) ? (sd) => e9BrainFactory(sd)
            : (expId === "e10" && E9_CIRCUIT) ? (sd) => apparatusBrainFactory("e10", sd)
            : (expId === "e11" && E9_CIRCUIT) ? (sd) => apparatusBrainFactory("e11", sd)
            : undefined,
          onTrialData: (cond, phase, tr) => {
            pushRow(cond, phase, tr);
            emit(expId, phase, (tr.trial || 0) + 1, nTrials * nSeeds, s + 1, false);
          },
          // 3D replay stream for the first seed; later seeds stream every
          // other episode so the stage stays live without tripling batch time.
          // (patch 17) full-speed streaming flooded the main thread with ~460
          // structured-clone app_state messages/sec and froze the fly (8fps).
          // (watch pacing) the page replays the buffer at a user-chosen speed,
          // so the stream must carry the FULL sim-time trajectory, not a 30 Hz
          // wall-time sample: gated to ~125 msg/s (8 ms floor) — well under the
          // ~460/s that froze the page — while preserving every episode so a
          // ×1..×10 replay shows each trial's actual dynamics.
          onState: (st) => {
            if (pace > 0 && s === 0 && typeof st.t === "number") {
              paceAnchor(st.t);
              const waitMs = (paceT0 + (st.t / pace) * 1000) - Date.now();
              if (waitMs > 1) {
                // spin-wait: a dedicated worker has no sleep(); the main thread
                // is never blocked and nothing else needs this thread meanwhile
                const until = performance.now() + waitMs;
                while (performance.now() < until) { /* hold for watchable pace */ }
              }
            }
            // paced playback streams seed 1 only — later seeds would reset the
            // stage mid-watch; their rows still feed the learning curves.
            if (pace > 0 && s !== 0) return;
            if (s === 0 || ((st.trial | 0) & 1) === 0) {
              const now = Date.now();
              if (now - lastAppPost >= 8) {
                lastAppPost = now;
                st.__seq = (++lastAppSeq);
                postMessage({ type: "app_state", expId, state: st });
              }
            }
          },
        });
      }
      const curve = buildApparatusCurve(4);
      // FIX (ReferenceError: res is not defined): the apparatus branch never
      // had a `res` — cores stream rows via onTrialData instead of returning
      // a result object. Build the per-condition summary from those rows;
      // apparatus panels derive their statistics from the rows themselves.
      // Brain outcome reduction (same contract as the runBenchmark branch):
      // keep per-trial fireVec only for the late-train / late-test / early-train
      // windows of the FIRST seed, emit each as a mean b64 vector on one row
      // per phase (fireVecMean / fireVecEarly), and drop the heavy per-trial
      // vectors from all other rows. E10/E11 have no brain — rows without
      // fireVec pass through untouched.
      const meanVec = (vecs, n) => {
        if (!vecs.length) return null;
        const acc = new Float64Array(n);
        for (const v of vecs) {
          const bin = atob(v.vec); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          for (let i = 0; i < n; i++) acc[i] += bytes[i];
        }
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = Math.round(acc[i] / vecs.length);
        let b64 = "";
        const CH = 3 * 4096;   // multiple of 3 so concatenated base64 stays valid
        for (let o = 0; o < n; o += CH)
          b64 += btoa(String.fromCharCode.apply(null, out.subarray(o, Math.min(n, o + CH))));
        return b64;
      };
      const conditions = {};
      const flatRows = [];
      const firstSeed = {};
      for (const r of Object.values(trialRows).flat())
        if (r.fireVec && firstSeed[r.condition] === undefined) firstSeed[r.condition] = r.seed;
      for (const [key, rows] of Object.entries(trialRows)) {
        conditions[key] = { episodes: rows.length };
        const f0 = firstSeed[key];
        const lateTrain = rows.filter(r => r.fireVec && r.seed === f0 && r.phase === "train").slice(-8);
        const earlyTrain = rows.filter(r => r.fireVec && r.seed === f0 && r.phase === "train").slice(0, 8);
        const lateTest = rows.filter(r => r.fireVec && r.seed === f0 && r.phase === "test").slice(-4);
        let nVec = 0, layout = null;
        for (const fv of [...lateTrain, ...lateTest, ...earlyTrain])
          if (fv && fv.fireVec && fv.fireVec.n) { nVec = fv.fireVec.n; layout = fv.fireVec.layout || null; break; }
        const emitted = { train: false, test: false, early: false };
        for (const r of rows) {
          const row = Object.assign({}, r);
          const fv = row.fireVec; delete row.fireVec;
          if (nVec && r.seed === f0 && fv) {
            const ph = row.phase === "test" ? "test" : "train";
            if (lateTrain.includes(r) && !emitted.train) {
              row.fireVecMean = { phase: "train", vec: meanVec(lateTrain.map(x => x.fireVec), nVec), n: nVec, layout, count: lateTrain.length };
              emitted.train = true;
            } else if (lateTest.includes(r) && !emitted.test) {
              row.fireVecMean = { phase: "test", vec: meanVec(lateTest.map(x => x.fireVec), nVec), n: nVec, layout, count: lateTest.length };
              emitted.test = true;
            }
            if (earlyTrain.includes(r) && !emitted.early) {
              row.fireVecEarly = { phase: "train", vec: meanVec(earlyTrain.map(x => x.fireVec), nVec), n: nVec, layout, count: earlyTrain.length };
              emitted.early = true;
            }
          }
          flatRows.push(row);
        }
      }
      const prov = {
        experiment: expId, label: spec.label,
        seeds: nSeeds, seedBase: opts.seed !== undefined ? opts.seed : 1,
        trainTrials: train, testTrials: test,
        episodeSeconds: episode,
        nParticles: (spec.physics && (spec.physics(0, 1) || {}).nParticles) || 260,
        noise: 0, dt: 1 / 60, tKelvin: 300, simToJoule: 1e-21,
        apparatus: spec.apparatusEnv,
        software: "Fly-Demon Lab v2 experiment list",
        startedISO: new Date(t0).toISOString(),
        elapsedSeconds: (Date.now() - t0) / 1000,
      };
      postMessage({ type: "done", expId, summary: { conditions, curve },
                    rows: flatRows, provenance: prov, apparatus: spec.apparatusEnv });
    } catch (err) {
      postMessage({ type: "error", expId, message: String(err && err.stack || err) });
    }
    return;
  }

  function pushRow(key, phase, tr) {
    const row = Object.assign({ condition: key, phase }, tr);
    (trialRows[key] = trialRows[key] || []).push(row);
  }

  // Apparatus curve: delegate to the pure CORE.apparatusCurve aggregator —
  // cross-seed block means with 95% CIs, train/test block continuity, and
  // agree/energyJ aliases (rows already carry their seed tag).
  function buildApparatusCurve(B) {
    let all = [];
    for (const rows of Object.values(trialRows)) all = all.concat(rows);
    return CORE.apparatusCurve(all, B);
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
        const eJ = avg("energyJ");   // E1-E8 extractable work; E10/E11 stream
        const energyJ = eJ !== null ? eJ : (avg("workJ") !== null ? avg("workJ") : avg("netWorkJ"));
        curve.push({ cond: key, block: b, phase: seg[0].phase,
                     agree: avg("demonAgree"), goodBadRatio: avg("goodBadRatio"),
                     sortEntropy: avg("sortEntropy"), miNeural: avg("miNeural"),
                     energyJ, dT: avg("dTfinal"),
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
    const built = curveBuilder();
    const curve = built.curve || built, live = built.live || {};
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
      // (Stage-3 demon observation) registered-arm plumbing: only carried
      // when the caller opted in, so OFF worker runs are byte-identical.
      ...(opts.demonObs === true ? {
        demonObs: true,
        demonObsGain: opts.demonObsGain,
        demonObsBand: opts.demonObsBand || (circuit ? CORE.demonObsBand(circuit) : null),
      } : {}),
      controllers: spec.controllers(),
      onTrial: (cond, phase, t, n, si, sn) => {
        emit(expId, phase, t, n, si, false);
      },
      // (audit step 6) intra-trial heartbeat: the core calls this every ~256
      // sim steps, but stage 1 is pure neural compute (no app_state stream and
      // long silent stretches), so the UI had no liveness signal mid-trial.
      // Wall-clock gated to ≤1 post / 1.2s and every-2nd-step sparse to keep
      // the hot loop cheap; heartbeats REPLACE the phase label between trial
      // completions (cleared on the next trial-boundary progress emit).
      onStepProgress: (cond, phase, t, n, stp, maxSteps, si, sn) => {
        const now = Date.now();
        if (now - lastStagePost < 1200 || (stp & 1)) return;
        lastStagePost = now;
        postMessage({ type: "stage", expId, phase, trial: t, nTrials: n,
                      seedIdx: si, nSeeds: sn,
                      frac: maxSteps ? stp / maxSteps : 0 });
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
      for (const v of vecs) {
        // accept either a b64 string or a fireVec object {vec,...}
        const b64 = typeof v === "string" ? v : v.vec;
        const b = b64toBytes(b64); for (let i = 0; i < n; i++) acc[i] += b[i];
      }
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
        // FIX: fv here is the TRIAL row — the vector lives at fv.fireVec.
        // The old code read fv.n, so meta stayed null and fireVecMean was
        // never emitted (anatomy cards silently fell back to region means).
        for (const tr of [...fvs.train, ...fvs.test, ...fvs.early]) {
          if (tr && tr.fireVec && tr.fireVec.n) { meta = { n: tr.fireVec.n, layout: tr.fireVec.layout || null }; break; }
        }
        for (const tr of trs) {
          const row = Object.assign({ condition: key }, tr);
          delete row.fireVec;
          const ph = tr.phase === "test" ? "test" : "train";
          if (!emitted[ph] && meta) {
            const vecs = fvs[ph];
            if (vecs.length) {
              row.fireVecMean = { phase: ph, vec: meanVec(vecs.map(t2 => t2.fireVec), meta.n),
                                  n: meta.n, layout: meta.layout,
                                  count: vecs.length };
              emitted[ph] = true;
            }
          }
          // one row carries the early-train mean alongside the late-train one
          if (!emitted.early && meta && fvs.early.length && !row.fireVecMean) {
            row.fireVecEarly = { phase: "train", vec: meanVec(fvs.early.map(t2 => t2.fireVec), meta.n),
                                 n: meta.n, layout: meta.layout, count: fvs.early.length };
            emitted.early = true;
          } else if (!emitted.early && meta && fvs.early.length) {
            row.fireVecEarly = { phase: "train", vec: meanVec(fvs.early.map(t2 => t2.fireVec), meta.n),
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
    // (audit step 4) E5 ends with its comparator stage: rank conditions on
    // frozen-test metrics instead of leaving the run's payoff to the sparse
    // late-block chips.
    let comparator = null;
    if (expId === "e5") {
      try { comparator = buildComparatorStage(rows); } catch (e) { comparator = null; }
    }
    const prov = {
      experiment: expId, label: spec.label,
      seeds: nSeeds, trainTrials: train, testTrials: test,
      episodeSeconds: episode, doorHeight: 64,
      nParticles: (spec.physics && (spec.physics(0, nSeeds) || {}).nParticles) || 320,
      noise: (spec.physics && (spec.physics(0, nSeeds) || {}).noise) || 0.12,
      dt: 1 / 60, tKelvin: 300, simToJoule: 1e-21,
      software: "Fly-Demon Lab v2 experiment list",
      chatDesign: spec.design || null,
      ...(opts.demonObs === true ? { demonObs: {
        on: true, gain: opts.demonObsGain !== undefined ? opts.demonObsGain : 12,
        band: opts.demonObsBand || (circuit ? CORE.demonObsBand(circuit) : null),
      } } : {}),
      startedISO: new Date(t0).toISOString(),
      elapsedSeconds: (Date.now() - t0) / 1000,
    };
    postMessage({ type: "done", expId, summary: { conditions, curve }, rows, provenance: prov, comparator });
  } catch (err) {
    postMessage({ type: "error", expId, message: String(err && err.stack || err) });
  }
}
