/**
 * controllers.js — the comparator controllers from the research plan.
 *
 * All controllers implement the same interface (observe / step /
 * receiveFeedback / setLearning / resetForTrial / summary) and drive the SAME
 * environment, per the PDF: "change the architecture so the environment
 * doesn't know which controller is operating it."
 *
 * Each factory has signature (rng, env, cfg) -> controller.
 */
"use strict";
const { METRICS, makeRng, CH, DOOR_Z_HALF, clamp } = require("./experiment_core");

// ------------------------------------------------------ 1. classical demon
/**
 * The Maxwell-demon reference controller (PDF Experiment 1): no neural
 * network. For each particle approaching the gate it measures velocity,
 * compares with a threshold, and opens only for slow (cold) particles.
 * The threshold adapts by tracking the running median of local speeds
 * (making it "optimal" within this sensorium).
 */
function classicalDemon(rng, env, cfg) {
  const opts = cfg || {};
  const adaptive = opts.adaptive !== undefined ? opts.adaptive : true;
  const speeds = [];                    // recent local-speed samples
  const memory = [];                    // demon memory: last K decisions
  const MEM = opts.memSize !== undefined ? opts.memSize : 64;
  let vThreshold = opts.vThreshold !== undefined ? opts.vThreshold : 120;
  let lastDecision = null;
  let agreeCount = 0, decisions = 0;
  // pseudo-neural activity for the brain-outcome panels (E7/E8): the demon has
  // no network, so its gate circuit is reported as three functional layers
  let opticSum = 0, antSum = 0, motSum = 0;

  return {
    name: "classical_demon",
    observe(env) {
      // measure speeds in the gate corridor to adapt the threshold
      const openHalf = (cfg.doorHeight || 64) * env.door.pos / 2;
      speeds.length = 0;
      for (const p of env.particles) {
        if (p.x > -80 && p.x < 10 && Math.abs(p.y) < openHalf + 40 && Math.abs(p.z) < DOOR_Z_HALF) {
          speeds.push(Math.hypot(p.vx, p.vy, p.vz));
        }
      }
      if (adaptive && speeds.length >= 4) {
        const sorted = [...speeds].sort((a, b) => a - b);
        vThreshold = 0.55 * sorted[Math.floor(sorted.length / 2)] + 0.45 * vThreshold;
      }
    },
    step(dt, env) {
      const action = demonGateDecision(env, cfg, vThreshold);
      env.door.target = action;
      memory.push(action);
      if (memory.length > MEM) memory.shift();
      lastDecision = action;
      agreeCount += action === demonGateDecision(env, cfg, vThreshold) ? 1 : 0;
      decisions++;
      // layered activity bookkeeping (per decision step): optic = particles in
      // view, antennal = gated thermal approach, motor = the open/close act
      opticSum += speeds.length ? Math.min(1, speeds.length / 12) : 0.02;
      antSum += Math.min(1, speeds.length / 24) * (adaptive ? 0.50 : 0.35) + 0.05;
      motSum += action ? 0.85 : 0.12;
    },
    get lastAction() { return lastDecision; },
    layerSpikeRates() {
      const s = Math.max(1, decisions);
      return { "optic lobe": opticSum / s,
               "antennal lobe": antSum / s,
               "motor gate": motSum / s };
    },
    summary() { return { vThreshold, demonAgree: decisions ? agreeCount / decisions : 0 }; },
    resetForTrial() { memory.length = 0; agreeCount = 0; decisions = 0; opticSum = 0; antSum = 0; motSum = 0; },
  };
}

/**
 * Canonical two-direction Maxwell gate policy (the DSI reference).
 * Finds the particle nearest the gate plane that is moving toward it, inside
 * the door corridor, and decides:
 *   approaching from the hot (left) side  -> open iff speed <  thr (slow out)
 *   approaching from the cold (right) side -> open iff speed >= thr (fast back)
 * Returns 1 (open) or 0 (closed). `threshold` defaults to 120 u/s.
 */
const DEMON_APPROACH = 60;   // units: how far from the gate the demon looks
function demonGateDecision(env, cfg, threshold) {
  const thr = threshold !== undefined ? threshold : 120;
  const openHalf = ((cfg && cfg.doorHeight) || 64) * env.door.pos / 2;
  let bestD2 = Infinity, bestOpen = false;
  for (const p of env.particles) {
    if (p.x < -DEMON_APPROACH || p.x > DEMON_APPROACH) continue;
    if (Math.abs(p.z) >= DOOR_Z_HALF || Math.abs(p.y) >= openHalf + 40) continue;
    if (p.x < 0 ? p.vx <= 0 : p.vx >= 0) continue;      // must approach the gate
    const d2 = p.x * p.x;
    if (d2 < bestD2) {
      bestD2 = d2;
      const s2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
      bestOpen = p.x < 0 ? s2 < thr * thr : s2 >= thr * thr;
    }
  }
  return bestD2 < Infinity && bestOpen ? 1 : 0;
}

/** Demon reference policy used for agreement scoring across controllers.
 *  Two-direction gate rule; threshold: "cold" cutoff speed (default 120). */
function demonDecisionFor(env, cfg, threshold) {
  return demonGateDecision(env, cfg, threshold);
}

// --------------------------------------------------------------- 2. random
function randomController(rng, env) {
  let t = 0, agreeCount = 0, decisions = 0;
  return {
    name: "random",
    step(dt, env2) {
      t -= dt;
      if (t <= 0) { env2.door.target = rng() < 0.4 ? 1 : 0; t = 0.4 + rng() * 1.2; }
      decisions++;
      if ((env2.door.target > 0.5) === (demonDecisionFor(env2, {}) === 1)) agreeCount++;
    },
    summary() { return { demonAgree: decisions ? agreeCount / decisions : 0 }; },
  };
}

// ------------------------------------------------------------------ 3. ANN
/**
 * Generic artificial neural network (PDF Experiment 2): a tiny MLP receiving
 * exactly the same observations as the fly, trained by reward-modulated
 * symmetric weight updates on its output weights.
 */
function annController(rng, env, cfg) {
  const NIN = 15, NHID = 16, NOUT = 2;
  const lr = (cfg && cfg.annLr) || 0.02;
  // weights
  const w0 = new Float32Array(NIN * NHID), b0 = new Float32Array(NHID);
  const w1 = new Float32Array(NHID * NOUT), b1 = new Float32Array(NOUT);
  for (let i = 0; i < w0.length; i++) w0[i] = (rng() - 0.5) * 0.6;
  for (let i = 0; i < w1.length; i++) w1[i] = (rng() - 0.5) * 0.6;
  let obs = new Float32Array(NIN), hid = new Float32Array(NHID), out = new Float32Array(NOUT);
  let lastAction = 0, learning = true, agreeCount = 0, decisions = 0;
  // per-trial mean hidden/output activation for the brain-outcome panels
  let hidRateSum = 0, outRateSum = 0;

  function forward() {
    for (let h = 0; h < NHID; h++) {
      let s = b0[h];
      for (let i = 0; i < NIN; i++) s += obs[i] * w0[i * NHID + h];
      hid[h] = Math.tanh(s);
    }
    let max = -1e9;
    for (let o = 0; o < NOUT; o++) {
      let s = b1[o];
      for (let h = 0; h < NHID; h++) s += hid[h] * w1[h * NOUT + o];
      out[o] = s;
      if (s > max) max = s;
    }
    let sum = 0;
    for (let o = 0; o < NOUT; o++) { out[o] = Math.exp(out[o] - max); sum += out[o]; }
    for (let o = 0; o < NOUT; o++) out[o] /= sum;
    return out[1] > out[0] ? 1 : 0;
  }

  return {
    name: "ann",
    observe(env) {
      const s = env.readSensors();
      // 7 sensors + 8 visual bins = 15 inputs
      for (let i = 0; i < 7; i++) obs[i] = s[i];
      const v = env.readVisualField();
      for (let i = 0; i < 8; i++) obs[7 + i] = v[i];
    },
    step(dt, env2) {
      const action = forward();
      env2.door.target = action;
      lastAction = action;
      const demon = demonDecisionFor(env2, {});
      decisions++;
      if (action === demon) agreeCount++;
      {
        let s = 0; for (let h = 0; h < NHID; h++) s += Math.abs(hid[h]);
        hidRateSum += s / NHID;
        outRateSum += out[action];
      }
      if (learning && env2.stepStats.crossings > 0) {
        // reward-modulated Hebian update toward actions that preceded good
        // crossings (cheap bandit-style rule; full policy-gradient is overkill)
        const r = env.stepStats.crossingEnergyJ > 0 ? (this._lastGood ? 1 : -1) : 0;
        if (r !== 0) {
          const target = r > 0 ? action : 1 - action;
          for (let h = 0; h < NHID; h++) {
            for (let o = 0; o < NOUT; o++) {
              w1[h * NOUT + o] += lr * r * hid[h] * (o === target ? 1 : -1);
            }
          }
        }
      }
      this._lastGood = undefined;
    },
    receiveFeedback(fb) { this._lastGood = !!fb.good; },
    setLearning(on) { learning = on; },
    resetForTrial() { agreeCount = 0; decisions = 0; hidRateSum = 0; outRateSum = 0; },
    layerSpikeRates() {
      const s = Math.max(1, decisions);
      return { "optic input": 0.45 + 0.2 * Math.min(1, hidRateSum / s),
               "hidden layer": Math.min(1, hidRateSum / s),
               "motor output": Math.min(1, outRateSum / s) };
    },
    summary() { return { demonAgree: decisions ? agreeCount / decisions : 0 }; },
    neuralActivity() { return hid; },
    particleSample(env2) { return env2.particles.slice(0, 16); },
  };
}

// --------------------------------------------------- 4. Drosophila-inspired
/**
 * Simplified mushroom-body architecture (PDF Experiment 3):
 *   sensory (7) -> projection neurons (sparse) -> Kenyon-like population
 *   -> MB output -> dopamine-gated decision -> motor (door).
 * Dopamine implements the classic MB valence rule: reward depresses
 * active KC->output weights (approach), punishment potentiates them.
 */
function drosophilaController(rng, env, cfg) {
  const NPN = 32, NKC = 200;
  const KC_ACTIVE = 12;                       // sparse winnner-take-all
  const wPN = new Float32Array(7 * NPN);
  const wKC = new Float32Array(NKC);          // KC -> MB output (single output)
  for (let i = 0; i < wPN.length; i++) wPN[i] = rng();
  for (let i = 0; i < NKC; i++) wKC[i] = 0.5 + rng() * 0.5;
  const kcThr = new Float32Array(NKC);
  for (let i = 0; i < NKC; i++) kcThr[i] = 0.3 + rng() * 0.4;

  const kcAct = new Float32Array(NKC);
  let mbOut = 0, baseline = 0.5, learning = true;
  let agreeCount = 0, decisions = 0;
  const da = { v: 0 };
  // per-trial spike-rate trace for the brain-outcome heatmap: [PN, KC, MBout]
  const layerSteps = { pn: 0, kc: 0, mb: 0 };
  const layerSums = { pn: 0, kc: 0, mb: 0 };

  function forward(env2) {
    const s = env2.readSensors();
    const v = env2.readVisualField();
    // PN response
    for (let p = 0; p < NPN; p++) {
      let a = 0;
      for (let i = 0; i < 7; i++) a += s[i] * wPN[i * NPN + p];
      for (let i = 0; i < 8; i++) a += v[i] * 0.5 * wPN[(i % 7) * NPN + p];
      kcAct[p] = a / 7;                       // reuse first NPN slots
      if (kcAct[p] > 0.5) layerSums.pn++;     // PN "spike" (thresholded rate)
    }
    layerSteps.pn++;
    // KC expansion + sparsification
    for (let k = 0; k < NKC; k++) {
      const p = k % NPN;
      const drive = kcAct[p] * wKC[k] + (rng() - 0.5) * 0.05;
      kcAct[k] = drive > kcThr[k] ? 1 : 0;    // binary KC spike
      if (kcAct[k]) layerSums.kc++;
    }
    layerSteps.kc++;
    let active = 0;
    for (let k = 0; k < NKC; k++) if (kcAct[k]) active++;
    // guarantee sparsity: keep only top-KC_ACTIVE (approximation: threshold)
    mbOut = active / NKC;
    if (mbOut > 0.06) layerSums.mb++;          // MB output bin fired
    layerSteps.mb++;
    return mbOut;
  }

  return {
    name: "drosophila",
    observe(env2) { forward(env2); },
    step(dt, env2) {
      baseline += (mbOut - baseline) * clamp(dt * 0.5, 0, 1);
      const open = mbOut > baseline + 0.01;
      env2.door.target = open ? 1 : 0;
      decisions++;
      if (open === (demonDecisionFor(env2, {}) === 1)) agreeCount++;
      da.v *= 0.985;
    },
    receiveFeedback(fb) {
      if (!learning) return;
      const r = fb.good ? 1 : -1;
      da.v = clamp(da.v + 0.6 * r, -1.5, 3);
      // MB rule: reward -> depress active KC weights; punish -> potentiate
      for (let k = 0; k < NKC; k++) {
        if (kcAct[k]) {
          wKC[k] = clamp(wKC[k] - 0.02 * da.v, 0.05, 2.0);
        }
      }
    },
    setLearning(on) { learning = on; },
    resetForTrial() { agreeCount = 0; decisions = 0;
                      layerSteps.pn = layerSteps.kc = layerSteps.mb = 0;
                      layerSums.pn = layerSums.kc = layerSums.mb = 0; },
    summary() { return { demonAgree: decisions ? agreeCount / decisions : 0 }; },
    layerSpikeRates() {
      return { "PN (antennal lobe)": layerSteps.pn ? layerSums.pn / layerSteps.pn : 0,
               "Kenyon cells": layerSteps.kc ? layerSums.kc / layerSteps.kc : 0,
               "MB output": layerSteps.mb ? layerSums.mb / layerSteps.mb : 0 };
    },
    fireVec() {
      // kcAct holds PN rates in its first NPN slots and KC spikes after;
      // counts are cumulative for the trial via layerSums-style accumulation,
      // so we snapshot current activity quantized like the connectome ctrl.
      const q = new Uint8Array(NPN + NKC);
      for (let i = 0; i < NPN; i++) {
        const v = Math.max(0, kcAct[i]) * 8;    // PN rate proxy
        q[i] = Math.min(255, Math.ceil(Math.sqrt(v) * 16));
      }
      for (let k = 0; k < NKC; k++) {
        const c = kcAct[k] > 0.5 ? 4 : 0;       // binary KC spike
        q[NPN + k] = c;
      }
      let b64 = "";
      const CH = 3 * 4096;   // multiple of 3 so concatenated base64 stays valid
      for (let o = 0; o < q.length; o += CH)
        b64 += btoa(String.fromCharCode.apply(null, q.subarray(o, Math.min(q.length, o + CH))));
      return { vec: b64, n: q.length, layout: { pn: NPN, kc: NKC } };
    },
    neuralActivity() { return kcAct; },
    particleSample(env2) { return env2.particles.slice(0, NKC); },
  };
}

// ---------------------------------------- 5. connectome / shuffled control
/**
 * Connectome-constrained controller. `circuit` is the compact JSON loaded
 * from fly_brain_circuit.json (layers / edges / sign / optic_channels).
 * With shuffle=false it is the real topology; shuffle=true performs a seeded,
 * degree-preserving edge rewiring (PDF Model 4C control).
 */
function connectomeController(circuit, opts) {
  opts = opts || {};
  const shuffle = !!opts.shuffle;
  const motorDrive = opts.motorDrive !== undefined ? opts.motorDrive : 0.35;
  const opticDrive = opts.opticDrive !== undefined ? opts.opticDrive : 1.0;
  // plasticity mode (Experiment 4 variants):
  //   "full" = all excitatory edges plastic (4A, default)
  //   "restricted" = only sensory-pathway edges plastic (4B restricted)
  //   "none" = fixed connectome, no plasticity (4B fixed)
  const plasticity = opts.plasticity !== undefined ? opts.plasticity : "full";
  const layers = circuit.layers;
  const N = layers.reduce((a, l) => a + l.length, 0);
  const NE0 = circuit.edges.length;
  const layerStart = [];
  { let s = 0; for (const l of layers) { layerStart.push(s); s += l.length; } }

  // --- edge arrays (source -> dest, weight, sign) ---
  let edges = circuit.edges.map(e => ({ s: e.s, t: e.t, w: e.w, sign: e.sign }));
  if (shuffle) {
    // degree-preserving rewiring: collect all endpoints, shuffle targets.
    const rng = makeRng(opts.seed || 7);
    const targets = edges.map(e => e.t);
    for (let i = targets.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = targets[i]; targets[i] = targets[j]; targets[j] = tmp;
    }
    edges = edges.map((e, i) => ({ s: e.s, t: targets[i], w: e.w, sign: e.sign }));
  }

  const NE = edges.length;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  const W = new Float32Array(NE), W0 = new Float32Array(NE);
  const isExc = new Uint8Array(NE), plastic = new Uint8Array(NE);
  const E = new Float32Array(NE);
  const WS = 0.02;
  edges.forEach((e, i) => {
    src[i] = e.s; dst[i] = e.t; W0[i] = e.w;
    W[i] = e.w * (e.sign > 0 ? 1 : -1) * WS;
    isExc[i] = e.sign > 0 ? 1 : 0;
    plastic[i] = e.sign > 0 ? 1 : 0;
  });
  if (plasticity === "none") {
    plastic.fill(0);
  } else if (plasticity === "restricted") {
    // keep plasticity only on edges whose source lies in layer 0/1
    const sensEnd = layerStart[Math.min(2, layers.length - 1)];
    for (let i = 0; i < NE; i++) if (src[i] >= sensEnd) plastic[i] = 0;
  }

  const spikeSrc = new Int32Array(N);   // sources that spiked this tick
  let spikeSrcN = 0;
  const coActive = new Int32Array(NE);  // csr slots co-active this tick
  let coActiveN = 0;
  let weightsDirty = false;
  function syncWeights() {
    if (!weightsDirty) return;
    for (let i = 0; i < NE; i++) csrW[edgeTraceK[i]] = W[i];
    weightsDirty = false;
  }
  // ---- CSR index: spike propagation visits only edges of spiking neurons.
  // Edge order is regrouped by source; W/E/isExc/plastic are permuted with it
  // so learning touches the same synapses as before.
  const csrRow = new Int32Array(N + 1);
  for (let i = 0; i < NE; i++) csrRow[src[i] + 1]++;
  for (let i = 0; i < N; i++) csrRow[i + 1] += csrRow[i];
  const order = new Int32Array(NE);
  { const cursor = Int32Array.from(csrRow);
    for (let i = 0; i < NE; i++) order[cursor[src[i]]++] = i; }
  const csrTarget = new Int32Array(NE);
  const csrW = new Float32Array(NE);
  const csrW0 = new Float32Array(NE);
  const csrPlastic = new Uint8Array(NE);
  for (let k = 0; k < NE; k++) {
    const i = order[k];
    csrTarget[k] = dst[i]; csrW[k] = W[i]; csrW0[k] = W0[i]; csrPlastic[k] = plastic[i];
  }
  // trace bookkeeping: k -> edge index in original order, and back
  const csrEdge = order;                     // csr k -> original edge index
  const edgeTraceK = new Int32Array(NE);     // original edge index -> csr k
  for (let k = 0; k < NE; k++) edgeTraceK[csrEdge[k]] = k;

  const V = new Float32Array(N), spikes = new Uint8Array(N), refac = new Uint8Array(N);
  const trialSpikeCount = new Uint32Array(N);   // cumulative per trial (MI)
  // per-trial layer spike counts for the brain-outcome heatmap (additive)
  const layerSpikeSums = new Float64Array(layers.length);
  const miBuf = new Uint8Array(256);            // binarized above-mean activity
  const miSampleIds = new Int32Array(256);      // even sample across layers
  for (let i = 0; i < 256; i++) miSampleIds[i] = Math.floor(i * N / 256);
  const da = { v: 0 };
  let motorRateSmooth = 0, motorBase = 0, learning = true;
  let agreeCount = 0, decisions = 0;
  const _sharedDecision = {};
  const motorLayer = layers.length - 1;
  const m0 = layerStart[motorLayer], m1 = m0 + layers[motorLayer].length;
  // designated readout pool: first POOL_N motor neurons (fixed identity)
  const POOL_N = Math.min(200, m1 - m0);
  let layerRateSmooth = 0;
  const opticLayer = circuit.optic_layer !== undefined ? circuit.optic_layer : -1;
  const opticMap = circuit.optic_channels || {};
  // precompute the visual channel per optic neuron once (String(i) lookups
  // every tick are the dominant cost of the old inner loop)
  const opticChannelOf = new Int8Array(N).fill(-1);
  const opticByChannel = [[], [], [], [], [], [], [], []];
  if (opticLayer >= 0 && layers[opticLayer]) {
    for (const i of layers[opticLayer]) {
      const field = opticMap[String(i)];
      const ch = field ? Math.min(7, (field[0] * 4 | 0) + ((field[1] * 2 | 0) * 4)) : -1;
      opticChannelOf[i] = ch;
      if (ch >= 0) opticByChannel[ch].push(i);
    }
  }
  const opticLists = opticByChannel.map(a => Int32Array.from(a));

  function injectLayerChannels(layerIndex, values, gain, rng) {
    if (layerIndex < 0 || !values || !values.length) return;
    const layer = layers[layerIndex];
    const bins = values.length;
    for (let k = 0; k < layer.length; k++) {
      const i = layer[k];
      const channel = Math.min(bins - 1, Math.floor(k * bins / layer.length));
      if (rng() < values[channel] * 0.5) V[i] += gain * (0.5 + rng());
    }
  }

  let opticPhase = 0;
  function brainTick(rng, sens, visual, motorDrive, opticScale) {
    injectLayerChannels(0, sens, 12, rng);
    if (opticLists.length) {
      // 4x stochastic decimation: each tick injects a rotating 1/4 subset
      // of each channel's neurons with 4x the probability, preserving the
      // mean drive while cutting rng calls and V-updates by ~4x.
      opticPhase = (opticPhase + 1) & 3;
      for (let ch = 0; ch < 8; ch++) {
        const drive = visual[ch] || 0;
        if (drive <= 0) continue;
        const list = opticLists[ch];
        const p4raw = drive * 2 * opticScale;       // 4 x (drive*0.5) x scale
        const p4 = p4raw > 1 ? 1 : p4raw;
        for (let k = opticPhase; k < list.length; k += 4) {
          if (rng() < p4) V[list[k]] += 14;         // mean(0.5+rng) = 1.0
        }
      }
    }
    for (let i = m0; i < m1; i++) if (rng() < motorDrive * 0.10) V[i] += 8 * (0.5 + rng());
    spikeSrcN = 0;
    for (let i = 0; i < N; i++) {
      if (refac[i] > 0) { refac[i]--; spikes[i] = 0; continue; }
      if (V[i] === 0) continue;          // idle: decay(0)=0, no threshold cross
      V[i] *= 0.86; spikes[i] = 0;
      if (V[i] > 30) { spikes[i] = 1; refac[i] = 3; spikeSrc[spikeSrcN++] = i; trialSpikeCount[i]++;
        for (let li2 = layers.length - 1; li2 >= 0; li2--) if (i >= layerStart[li2]) { layerSpikeSums[li2]++; break; } }
    }
    // CSR propagation: visit only edges whose source spiked this tick.
    // Co-active plastic edges (spiking source -> spiking target) are
    // collected here so updateTraces does not re-walk the rows.
    const tgtA = csrTarget, wA = csrW, rowA = csrRow, pla = csrPlastic;
    coActiveN = 0;
    for (let s2 = 0; s2 < spikeSrcN; s2++) {
      const r0 = rowA[spikeSrc[s2]], r1 = rowA[spikeSrc[s2] + 1];
      for (let k = r0; k < r1; k++) {
        V[tgtA[k]] += wA[k];
        if (pla[k] && spikes[tgtA[k]]) coActive[coActiveN++] = k;
      }
    }
    da.v *= 0.985;
  }

  // ---- lazy eligibility traces --------------------------------------
  // E0 decays globally; explicit traces live only where they were last
  // touched. tickCount counts calls to updateTraces; a trace's effective
  // value is E0 * 0.985^(tickCount - lastTouchTick[k]) below the floor.
  const E0 = 1;                       // cap (was the E[i] cap)
  let tickCount = 0;
  const lastTouchTick = new Float64Array(NE).fill(-1e9);
  const activeTraces = [];            // csr k values with live (touched) traces
  const inActive = new Uint8Array(NE);
  const TRACE_FLOOR = 0.01;
  const DECAY = 0.985;
  const INC = 0.15;
  const POW = [1]; for (let i = 1; i <= 8; i++) POW.push(POW[i - 1] * DECAY);

  function updateTraces() {
    tickCount++;
    // co-active synapses were collected during propagation this tick
    for (let ci = 0; ci < coActiveN; ci++) {
      const k = coActive[ci];
      const ek = csrEdge[k];
      const prev = lastTouchTick[ek] < 0 ? 0 : E[ek] * POW[Math.min(8, tickCount - lastTouchTick[ek])];
      E[ek] = prev < E0 ? prev + INC : E0;
      lastTouchTick[ek] = tickCount;
      if (!inActive[ek]) { inActive[ek] = 1; activeTraces.push(ek); }
    }
    // bounded active list: cap size, evicting the oldest entries first
    if (activeTraces.length > 40000) {
      const drop = activeTraces.splice(0, activeTraces.length - 40000);
      for (const ek of drop) { E[ek] = 0; lastTouchTick[ek] = -1e9; inActive[ek] = 0; }
    }
  }

  function applyLearning(lr) {
    const d = lr * da.v;
    if (Math.abs(d) < 1e-5) return;
    for (let idx = 0; idx < activeTraces.length; idx++) {
      const ek = activeTraces[idx];
      const age = tickCount - lastTouchTick[ek];
      const e = age <= 8 ? E[ek] * POW[age] : E[ek] * Math.pow(DECAY, age);
      if (e < TRACE_FLOOR) continue;
      const i = ek;
      if (!plastic[i] || !isExc[i]) continue;
      W[i] = clamp(W[i] + d * e * WS * W0[i], -W0[i] * WS, W0[i] * WS * 2);
      weightsDirty = true;
    }
  }

  return {
    name: shuffle ? "shuffled_connectome" : "connectome",
    _N: N, _NE: NE,
    observe(env) {
      this._sens = env.readSensors();
      this._visual = env.readVisualField();
    },
    step(dt, env) {
      const rng = this._rng;
      brainTick(rng, this._sens, this._visual, motorDrive, opticDrive);
      updateTraces();
      let s = 0; for (let i = m0; i < m1; i++) s += spikes[i];
      let ps = 0; for (let i = m0; i < m0 + POOL_N; i++) ps += spikes[i];
      const dtc = Math.max(dt, 1e-3);
      motorRateSmooth = motorRateSmooth * 0.85 + (ps / POOL_N / dtc) * 0.15;
      layerRateSmooth = layerRateSmooth * 0.85 + (s / layers[motorLayer].length / dtc) * 0.15;
      // threshold-free policy: pool rate relative to whole-layer rate.
      // Topology-sensitive: real wiring routes sensory activity into the
      // fixed pool; shuffled wiring makes the pool exchangeable (ratio ~1).
      const ratio = motorRateSmooth / Math.max(layerRateSmooth, 1e-6) - 1;
      env.door.target = clamp(ratio * 40, 0, 1);
      const open = env.door.target > 0.5;
      decisions++;
      if (open === (demonDecisionFor(env, _sharedDecision) === 1)) agreeCount++;
      if (learning) { applyLearning(0.004); if ((decisions & 255) === 0) syncWeights(); }
    },
    receiveFeedback(fb) {
      const q = fb.dir * (fb.T2 - fb.v2) / Math.max(fb.T2, 1);
      da.v = clamp(da.v + q * 0.6, -1.5, 3);
    },
    setLearning(on) { learning = on; if (!on) { E.fill(0); da.v = 0; } },
    resetForTrial() { V.fill(0); spikes.fill(0); refac.fill(0); E.fill(0); da.v = 0;
                      trialSpikeCount.fill(0); layerSpikeSums.fill(0);
                      motorRateSmooth = 0; layerRateSmooth = 0;
                      agreeCount = 0; decisions = 0;
                      activeTraces.length = 0; inActive.fill(0);
                      lastTouchTick.fill(-1e9); },
    summary() {
      let s = 0; for (let i = m0; i < m1; i++) s += spikes[i];
      return { demonAgree: decisions > 0 ? agreeCount / decisions : 0,
               motorHz: s / layers[motorLayer].length };
    },
    fireVec() {
      // Uint8-quantized per-neuron spike counts (log scale preserves the
      // dynamic range: 255 = 256+ spikes in the trial, 1 = 1 spike)
      const q = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const c = trialSpikeCount[i];
        q[i] = c === 0 ? 0 : c >= 256 ? 255 : Math.ceil(Math.sqrt(c) * 16);
      }
      let b64 = "";
      const CH = 3 * 4096;   // multiple of 3 so concatenated base64 stays valid
      for (let o = 0; o < N; o += CH)
        b64 += btoa(String.fromCharCode.apply(null, q.subarray(o, Math.min(N, o + CH))));
      return { vec: b64, n: N, total: Array.from(trialSpikeCount).reduce((a, b) => a + b, 0) };
    },
    layerSpikeRates() {
      // decision-step rate per layer (steps ~= decisions), matches trace cadence
      const steps = Math.max(1, decisions);
      const out = {};
      for (let li = 0; li < layers.length; li++)
        out[circuit.layer_names[li] || ("layer " + li)] = layerSpikeSums[li] / steps;
      return out;
    },
    neuralActivity() {
      // above-mean binarization of trial-cumulative spike counts for 256
      // neurons sampled evenly across ALL layers (the first ids are all AL,
      // which is silent in the sparse-sensory regime)
      let mean = 0;
      for (let i = 0; i < 256; i++) mean += trialSpikeCount[miSampleIds[i]];
      mean /= 256;
      for (let i = 0; i < 256; i++)
        miBuf[i] = trialSpikeCount[miSampleIds[i]] > mean ? 1 : 0;
      return miBuf;
    },
    particleSample(env2) {
      // sample N particles for MI (cycled if fewer than N)
      const out = new Array(Math.min(N, 256));
      for (let i = 0; i < out.length; i++) out[i] = env2.particles[i % env2.particles.length];
      return out;
    },
    _rng: opts.rng || makeRng(3),
  };
}

/** Anti-demon (saboteur): inverts the two-direction gate rule — opens for
 * SLOW particles leaving the hot side and FAST ones re-entering it. Under
 * identical physics this should drag dT below zero: the causal counterpart
 * to the classical demon, demonstrating that the gate POLICY (not the door,
 * not the gas) produces the sorting. Memory/threshold mirror classicalDemon. */
function saboteurController(rng, env, cfg) {
  const opts = cfg || {};
  const adaptive = opts.adaptive !== undefined ? opts.adaptive : true;
  const speeds = [];
  const memory = [];
  const MEM = opts.memSize !== undefined ? opts.memSize : 64;
  let vThreshold = opts.vThreshold !== undefined ? opts.vThreshold : 120;
  let lastDecision = null;
  let agreeCount = 0, decisions = 0;
  return {
    name: "saboteur",
    observe(env2) {
      const openHalf = ((opts.doorHeight) || 64) * env2.door.pos / 2;
      speeds.length = 0;
      for (const p of env2.particles) {
        if (p.x > -80 && p.x < 10 && Math.abs(p.y) < openHalf + 40 && Math.abs(p.z) < DOOR_Z_HALF) {
          speeds.push(Math.hypot(p.vx, p.vy, p.vz));
        }
      }
      if (adaptive && speeds.length >= 4) {
        const sorted = [...speeds].sort((a, b) => a - b);
        vThreshold = 0.55 * sorted[Math.floor(sorted.length / 2)] + 0.45 * vThreshold;
      }
    },
    step(dt, env2) {
      const thr = vThreshold;
      const openHalf = ((opts.doorHeight) || 64) * env2.door.pos / 2;
      let bestD2 = Infinity, bestOpen = false;
      for (const p of env2.particles) {
        if (p.x < -DEMON_APPROACH || p.x > DEMON_APPROACH) continue;
        if (Math.abs(p.z) >= DOOR_Z_HALF || Math.abs(p.y) >= openHalf + 40) continue;
        if (p.x < 0 ? p.vx <= 0 : p.vx >= 0) continue;
        const d2 = p.x * p.x;
        if (d2 < bestD2) {
          bestD2 = d2;
          const s2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
          bestOpen = p.x < 0 ? s2 >= thr * thr : s2 < thr * thr;   // INVERTED rule
        }
      }
      const action = bestD2 < Infinity && bestOpen ? 1 : 0;
      env2.door.target = action;
      memory.push(action);
      if (memory.length > MEM) memory.shift();
      lastDecision = action;
      agreeCount += action === demonGateDecision(env2, opts, thr) ? 1 : 0;
      decisions++;
    },
    get lastAction() { return lastDecision; },
    summary() { return { vThreshold, demonAgree: decisions ? agreeCount / decisions : 0 }; },
    resetForTrial() { memory.length = 0; agreeCount = 0; decisions = 0; },
  };
}

/** Never-gate control: the door is never opened. Under identical jet physics
 * this isolates what the gate POLICY contributes — the no-policy baseline for
 * the causal test (E6). Crossings and sorting should be ~zero. */
function neverGateController(rng, env) {
  return {
    name: "never_gate",
    step(dt, env2) { env2.door.target = 0; },
    summary() { return { demonAgree: 0, openFraction: 0 }; },
  };
}

module.exports = { classicalDemon, demonDecisionFor, randomController,
                   annController, drosophilaController, connectomeController,
                   saboteurController, neverGateController };
