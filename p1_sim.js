/**
 * p1_sim.js — Stage C: typed-dynamics simulation core over the REAL circuit.
 *
 * Replaces the one-size-fits-all tick with:
 *  - per-neuron Vrest / tauMem / theta / tRef / noise (p1_dynamics classes)
 *  - soft reset (V -= theta) instead of hard V=0
 *  - structured conduction delays (bucketed ring buffers; default rule derives
 *    per-edge delay from the optic neuron's SOURCE-DERIVED depth axis)
 *  - causal, dopamine-gated pairwise-approx STDP (pre-before-post vs
 *    post-before-pre sign, from ordering — not pure co-occurrence)
 *  - response recording (trace extraction for the parity suite)
 *  - deterministic seeded rng everywhere (no Math.random)
 *
 * P0 PORT (parity with controllers.js — see P0_IMPLEMENTATION_REPORT.md):
 *  - modulatory contacts (da/ser/oct) are stripped from the fast-edge arrays
 *    at build time; they are NEVER propagation weights. Their spiking sources
 *    feed per-modulator activity EMAs, which scale the dopamine-gated update
 *    as a third factor: G = 1 + Σ_type γ_type · min(1, m_type), γ=0.15.
 *  - eligibility is a property of the CONTACT, not its sign: plastic[i] = 1
 *    for every fast synapse (no isExc gate). The SIGN of ΔW still follows the
 *    dopamine teaching signal, as in P0.
 *  - with no modulatory_edges field the channels stay at 0, G = 1 and the
 *    pre-port behavior is preserved (legacy-compat guaranteed).
 *
 * NOTHING in the legacy app is modified: this is a parallel core used by the
 * Stage D/E/F harnesses and tests. The legacy-compat profile ("legacy")
 * reproduces the global rule and is used as the audit baseline.
 */
"use strict";

const { resolveDynamics, STDP_DEFAULTS, PROV } = require("./p1_dynamics");
const RT = require("./p1_retinotopy.js");   // Stage F hex-lattice optic input (opt-in)

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// P0: same structural, UNOPTIMIZED third-factor gains as controllers.js.
const MOD_GAINS_DEFAULT = Object.freeze({ dopamine: 0.15, serotonin: 0.15, octopamine: 0.15 });
function ntToModulator(nt) {                 // tolerant fallback for partial schema
  return nt === "da" ? "dopamine" : nt === "ser" ? "serotonin"
       : nt === "oct" ? "octopamine" : null;
}

/** Degree-preserving (both degree sequences) double-edge-swap shuffle. */
function shuffledEdges(edges, seed) {
  const rng = mulberry32(seed ^ 0x51ed);
  const E = edges.length;
  const pairs = edges.map(e => e.s * 1e7 + e.t);   // s,t < 1e7 each: unique packing
  const pairSet = new Set(pairs);
  const s = new Int32Array(E), t = new Int32Array(E);
  for (let i = 0; i < E; i++) { s[i] = edges[i].s; t[i] = edges[i].t; }
  let swaps = 0;
  const attempts = 2 * E;
  for (let a = 0; a < attempts; a++) {
    const i = (rng() * E) | 0, j = (rng() * E) | 0;
    if (i === j) continue;
    const s1 = s[i], t1 = t[i], s2 = s[j], t2 = t[j];
    if (s1 === s2 || t1 === t2) continue;
    const n1 = s1 * 1e7 + t2, n2 = s2 * 1e7 + t1;
    if (pairSet.has(n1) || pairSet.has(n2)) continue;
    pairSet.delete(pairs[i]); pairSet.delete(pairs[j]);
    t[i] = t2; t[j] = t1;
    pairs[i] = n1; pairs[j] = n2;
    pairSet.add(n1); pairSet.add(n2);
    swaps++;
  }
  const out = edges.map((e, i) => ({ s: s[i], t: t[i], w: e.w, sign: e.sign }));
  return { edges: out, swaps };
}

/** Default delay rule: 1 tick + extra from the optic source's real depth axis.
 *  Provenance: delay AXIS is SOURCE-DERIVED (optic_channels depth = radial
 *  synapse position); the 1+depth*maxExtra mapping is MODEL-ASSUMED. */
function delaysFromOpticDepth(circuit, maxExtra) {
  const NE = circuit.edges.length;
  const delays = new Int8Array(NE).fill(1);
  const opticLayer = circuit.optic_layer ?? -1;
  if (opticLayer < 0) return delays;
  const members = circuit.layers[opticLayer];
  const chan = circuit.optic_channels || {};
  const depthOf = new Float32Array(circuit.layers.reduce((a, l) => a + l.length, 0));
  const hasDepth = new Uint8Array(depthOf.length);
  for (const i of members) {
    const f = chan[String(i)];
    if (f) { depthOf[i] = f[2]; hasDepth[i] = 1; }
  }
  for (let k = 0; k < NE; k++) {
    const s = circuit.edges[k].s;
    if (hasDepth[s]) delays[k] = 1 + ((depthOf[s] * maxExtra) | 0);
  }
  return delays;
}

/**
 * @param circuit legacy circuit JSON
 * @param opts {
 *   neuronTable     Stage B table (p1_celltypes.buildNeuronTable)
 *   profile         "typed" (default) | "legacy"
 *   edgeDelays      Int8Array override; else delaysFromOpticDepth
 *   maxExtraDelay   2 (ticks) for the depth rule
 *   WS              weight scale (default 0.02, legacy MODEL-ASSUMED)
 *   stdp            false | { lr, tauPost, Aplus, Aminus }
 *   record          null | { layer, every } — response traces
 *   seed            deterministic rng seed
 * }
 */
function createTypedSim(circuit, opts) {
  const o = opts || {};
  const layers = circuit.layers;
  const N = layers.reduce((a, l) => a + l.length, 0);
  const layerStart = []; { let s = 0; for (const l of layers) { layerStart.push(s); s += l.length; } }

  const dyn = resolveDynamics(circuit, o.neuronTable || null, { profile: o.profile || "typed" });
  const WS = o.WS !== undefined ? o.WS : 0.02;

  // P0: modulatory contacts are NOT propagation edges. Filtered out here so
  // spike propagation, weights and eligibility only ever see fast synapses;
  // their activity feeds the third-factor channels instead. Mirrors
  // controllers.js (P0_IMPLEMENTATION_REPORT.md, repair 3).
  const MOD_GAINS = Object.assign({}, MOD_GAINS_DEFAULT, o.modulation || {});
  const hasModField = circuit.modulatory_edges !== undefined ||
    (circuit.edges.length && circuit.edges[0].modulatory !== undefined);
  const modEdgesRaw = hasModField && circuit.modulatory_edges
    ? circuit.modulatory_edges
    : (circuit.edges || []).filter(e => e.modulatory);   // tolerant fallback

  let edges = circuit.edges.filter(e => !e.modulatory)
                           .map(e => ({ s: e.s, t: e.t, w: e.w, sign: e.sign, nt: e.nt || null }));
  let shuffleInfo = null;
  if (o.shuffle) {
    const sh = shuffledEdges(edges, o.seed || 7);
    edges = sh.edges; shuffleInfo = { swaps: sh.swaps, method: "double_edge_swap" };
  }
  const NE = edges.length;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  const W = new Float32Array(NE), W0 = new Float32Array(NE);
  const isExc = new Uint8Array(NE), plastic = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) {
    src[i] = edges[i].s; dst[i] = edges[i].t; W0[i] = edges[i].w;
    W[i] = edges[i].w * (edges[i].sign > 0 ? 1 : -1) * WS;
    isExc[i] = edges[i].sign > 0 ? 1 : 0;
    // P0: eligibility is a property of the CONTACT (co-active pre/post), not
    // of its sign. Inhibitory and excitatory synapses are both plastic; DA and
    // the other modulators are no longer frozen negative weights — they are
    // not weights at all (filtered above) and act through the third-factor
    // channel in applyLearning instead.
    plastic[i] = 1;
  }
  // P0: modulator contact lists, grouped by type (mirrors controllers.js).
  const modEdges = modEdgesRaw.map(e => ({ s: e.s, t: e.t, type: e.modulatorType || ntToModulator(e.nt) }));
  const modByType = { dopamine: [], serotonin: [], octopamine: [] };
  for (const m of modEdges) if (modByType[m.type]) modByType[m.type].push(m);
  const modulatorCount = modEdges.length;
  const modulatorTypes = Object.keys(modByType).filter(k => modByType[k].length > 0);

  // structured delays: bucket edge indices by delay, ring of spike snapshots
  const delays = o.edgeDelays || delaysFromOpticDepth(circuit, o.maxExtraDelay || 2);
  const D = Math.max(1, delays.reduce((a, d) => Math.max(a, d), 0));
  const buckets = [];
  for (let d = 0; d <= D; d++) buckets.push([]);
  for (let k = 0; k < NE; k++) {
    const d = delays[k] | 0;
    buckets[d < 1 ? 1 : Math.min(d, D)].push(k);
  }
  const bucketArr = buckets.map(b => Int32Array.from(b));
  const history = [];
  for (let d = 0; d < D; d++) history.push(new Uint8Array(N));

  const V = new Float32Array(N), spikes = new Uint8Array(N), refac = new Uint32Array(N);
  const lastPostTick = new Int32Array(N).fill(-1e9);
  const E = new Float32Array(NE);            // eligibility (legacy-compatible)
  const tauPost = (o.stdp && o.stdp.tauPost) || STDP_DEFAULTS.tauPost;
  const Aplus = (o.stdp && o.stdp.Aplus) || STDP_DEFAULTS.Aplus;
  const Aminus = (o.stdp && o.stdp.Aminus) || STDP_DEFAULTS.Aminus;
  const stdpOn = !!o.stdp;
  let ltpEvents = 0, ltdEvents = 0;

  const rng = mulberry32(o.seed !== undefined ? o.seed : 7);
  const DA = { v: 0 };
  // P0: per-modulator activity EMAs (third-factor channels), from spiking
  // modulator-source neurons. Same decay and normalization as controllers.js.
  const modEma = { dopamine: 0, serotonin: 0, octopamine: 0 };
  const MOD_EMA_DECAY = 0.99;                // per-tick retention of modulator tone
  let tickIndex = 0;
  const motorLayer = layers.length - 1;
  const m0 = layerStart[motorLayer], m1 = m0 + layers[motorLayer].length;

  // per-neuron channel map for the retinotopic stimulator
  const opticLayer = circuit.optic_layer ?? -1;
  const opticMembers = opticLayer >= 0 ? layers[opticLayer] : [];
  const chanOf = (circuit.optic_channels || {});
  const opticUV = new Float32Array(N * 2).fill(-1);
  for (const i of opticMembers) {
    const f = chanOf[String(i)];
    if (f) { opticUV[i * 2] = f[0]; opticUV[i * 2 + 1] = f[1]; }
  }
  // Stage F: opt-in retinotopic optic input. Default "legacy8bin" keeps the
  // parity suite and recorded P1_PARITY_RESULTS.json comparability; opts
  // { opticInput: "retinotopy" } switches tick() to the hex-column field
  // (800 bins, relative-contrast coded — see p1_retinotopy.js). tick() then
  // consumes inp.retinotopicField directly, or lifts an 8-bin inp.visual
  // through the declared legacy-bin -> column layout.
  const opticInput = o.opticInput || "legacy8bin";
  let opticByColumn = null, opticNodes = null;
  if (opticInput === "retinotopy" && opticMembers.length) {
    const b = RT.buildOpticColumns(circuit);
    opticByColumn = b.byColumn; opticNodes = b.nodes;
  }

  // response recording
  let recIdx = null, recEvery = 1, recBuf = null, recN = 0, recCap = 0;
  if (o.record) {
    recEvery = o.record.every || 1;
    recCap = o.record.capacity || 4000;
    recBuf = new Float32Array(recCap);
    const L = o.record.layer !== undefined ? o.record.layer : motorLayer;
    recIdx = Int32Array.from(layers[L]);
    recBuf.layer = L;
  }

  function recordResponse() {
    if (!recBuf || tickIndex % recEvery !== 0) return;
    if (recN < recCap) {
      let s = 0;
      for (let k = 0; k < recIdx.length; k++) s += spikes[recIdx[k]];
      recBuf[recN++] = s / recIdx.length;
    }
  }

  /**
   * One simulation tick.
   * input: { visual: Float32Array|Array (8 legacy bins or per-neuron drive
   *          via stim), alDrive: array (legacy 7-sensor path, optional),
   *          motorDrive: 0..1, stimPulse: 0..1.5, opticScale: 0..1,
   *          reward: dopamine delta (optional), lr: learning rate (optional) }
   */
  function tick(input) {
    const inp = input || {};
    tickIndex++;
    if (inp.reward) DA.v = Math.max(-1.5, Math.min(3, DA.v + inp.reward));

    // --- external drives (per-neuron gains from the dynamics classes) -----
    const gain = dyn.gain;
    // legacy 8-bin visual path + retinotopic per-neuron intensities both land
    // in `visualNeuron` (set by setNeuronDrive); 8-bin drive uses channel map
    if (inp.neuronDrive) {           // Float32Array(N) 0..1 per-neuron intensity
      for (let i = 0; i < N; i++) {
        const d = inp.neuronDrive[i];
        if (d > 0 && gain.optic[i] > 0 && rng() < d * 0.5)
          V[i] += gain.optic[i] * (0.5 + rng());
      }
    } else if (opticInput === "retinotopy" && opticByColumn &&
               (inp.retinotopicField || inp.visual)) {
      // Stage F: hex-column injection, same p = drive*0.5 semantics as the
      // legacy branch; 8-bin inputs are lifted to columns (declared layout).
      const f800 = inp.retinotopicField || RT.liftLegacyField(inp.visual, opticNodes);
      for (let col = 0; col < opticByColumn.length; col++) {
        const d = f800[col] || 0;
        if (d <= 0) continue;
        const list = opticByColumn[col];
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (rng() < d * 0.5) V[i] += gain.optic[i] * (0.5 + rng());
        }
      }
    } else if (inp.visual) {
      // legacy convention: channel per optic neuron from optic_channels (see
      // p1_retinotopy.py for the axis discussion)
      for (let k = 0; k < opticMembers.length; k++) {
        const i = opticMembers[k];
        const f = chanOf[String(i)];
        const ch = f ? Math.min(7, ((f[0] * 4) | 0) + (((f[1] * 2) | 0) * 4)) : (k & 7);
        const drive = inp.visual[ch] || 0;
        if (drive > 0 && rng() < drive * 0.5)
          V[i] += gain.optic[i] * (0.5 + rng());
      }
    }
    if (inp.alDrive) {
      const alLayer = 0;
      const a0 = layerStart[alLayer], a1 = a0 + layers[alLayer].length;
      const bins = inp.alDrive.length;
      for (let k = a0; k < a1; k++) {
        const ch = Math.min(bins - 1, ((k - a0) * bins / (a1 - a0)) | 0);
        if (rng() < inp.alDrive[ch] * 0.5) V[k] += gain.al[k] * (0.5 + rng());
      }
    }
    if (inp.stimPulse > 0) {
      for (const li of [0, 1]) {
        const a = layerStart[li], b = a + layers[li].length;
        const frac = 0.012 * inp.stimPulse;
        for (let i = a; i < b; i++) if (rng() < frac) V[i] += gain.stim[i] * (0.7 + rng() * 0.6);
      }
    }
    if (inp.motorDrive > 0) {
      for (let i = m0; i < m1; i++) if (rng() < inp.motorDrive * 0.10) V[i] += gain.motor[i] * (0.5 + rng());
    }
    // --- intrinsic noise (per-class rate) ----------------------------------
    for (let i = 0; i < N; i++) {
      const r = gain.noiseRate[i];
      if (r > 0 && rng() < r) V[i] += dyn.noiseSigma[i] * (0.5 + rng());
    }
    // --- global noise channel (Stage D operating-point axis) ---------------
    // MODEL-ASSUMED injection: event probability 0.002*level / neuron / tick,
    // kick 10*level*(0.5+rng) — order-matched to the legacy exAmp knob but
    // applied to ALL layers, so the phase diagram can sweep it explicitly.
    if (inp.noise > 0) {
      const pN = 0.002 * inp.noise, kN = 10 * inp.noise;
      for (let i = 0; i < N; i++) if (rng() < pN) V[i] += kN * (0.5 + rng());
    }

    // --- integrate (per-neuron dynamics, soft reset) -----------------------
    for (let i = 0; i < N; i++) {
      if (refac[i] > 0) { refac[i]--; spikes[i] = 0; continue; }
      V[i] = dyn.Vrest[i] + (V[i] - dyn.Vrest[i]) * dyn.tauMem[i];
      spikes[i] = 0;
      if (V[i] > dyn.theta[i]) {
        spikes[i] = 1; refac[i] = dyn.tRef[i];
        V[i] -= dyn.theta[i];                 // soft reset
        lastPostTick[i] = tickIndex;
      }
    }

    // --- propagate with structured delays + causal STDP -------------------
    const lr = inp.lr !== undefined ? inp.lr : 0;
    const gate = stdpOn && lr !== 0;
    for (let d = 1; d <= D; d++) {
      const hist = history[(tickIndex - d + D * 4) % D];
      const bucket = bucketArr[d];
      for (let bi = 0; bi < bucket.length; bi++) {
        const k = bucket[bi];
        if (!hist[src[k]]) continue;
        const t = dst[k];
        V[t] += W[k];
        if (spikes[t]) {                                   // post fires now: pre-before-post
          E[k] = E[k] + 0.15 > 1 ? 1 : E[k] + 0.15;
          ltpEvents++;
          if (gate && plastic[k]) {                        // P0: no isExc gate —
            W[k] = Math.min(W0[k] * WS * 2, Math.max(-W0[k] * WS,   // sign of ΔW
              W[k] + lr * DA.v * Aplus * WS * W0[k]));             // follows DA
          }
        } else {
          const age = tickIndex - lastPostTick[t];
          if (age >= 1 && age <= tauPost) {                // post-before-pre: LTD
            E[k] = E[k] + 0.075 > 1 ? 1 : E[k] + 0.075;
            ltdEvents++;
            if (gate && plastic[k]) {
              const decay = Math.pow(0.985, age);
              W[k] = Math.min(W0[k] * WS * 2, Math.max(-W0[k] * WS,
                W[k] - lr * DA.v * Aminus * decay * WS * W0[k]));
            }
          }
        }
      }
    }
    for (let d = 0; d < D - 1; d++) history[d].set(history[d + 1]);
    if (D > 0) history[D - 1].set(spikes);

    // P0 third-factor channels: per-modulator activity EMA from the spiking
    // sources of that modulator's contact list. Deterministic given spikes;
    // with no modulatory schema this loop never runs (gains stay 0) and the
    // legacy behavior is bit-preserved.
    if (modulatorCount) {
      modEma.dopamine *= MOD_EMA_DECAY;
      modEma.serotonin *= MOD_EMA_DECAY;
      modEma.octopamine *= MOD_EMA_DECAY;
      for (const type of modulatorTypes) {
        const list = modByType[type];
        let act = 0;
        for (let mi = 0; mi < list.length; mi++) if (spikes[list[mi].s]) act++;
        if (act) modEma[type] += act / Math.max(1, list.length) * (1 - MOD_EMA_DECAY);
      }
    }
    DA.v *= 0.985;
    recordResponse();
  }

  function applyLearning(lr) {
    const d0 = lr * DA.v;
    if (Math.abs(d0) < 1e-5) return;
    // P0 third-factor gain: modulator tone scales the dopamine-gated update.
    // G = 1 + Σ_type γ_type · m_type. Defaults are structural (γ=0.15, unoptimized);
    // with no modulatory schema all m_type stay 0 => G=1 => legacy bit-exact.
    let G = 1;
    if (modulatorCount) {
      for (const type of modulatorTypes) {
        const g = MOD_GAINS[type];
        if (g && modEma[type] > 0) G += g * Math.min(1, modEma[type]);
      }
    }
    const d = d0 * G;
    for (let i = 0; i < NE; i++) {
      const e = E[i];
      // P0: eligibility no longer requires isExc — inhibitory synapses are
      // plastic too; the sign of ΔW still follows the dopamine teaching signal.
      if (e < 0.01 || !plastic[i]) continue;
      W[i] = Math.max(-W0[i] * WS, Math.min(W0[i] * WS * 2, W[i] + d * e * WS * W0[i]));
      E[i] *= 0.985;
    }
  }

  function motorRate() {
    let s = 0; for (let i = m0; i < m1; i++) s += spikes[i];
    return s / layers[motorLayer].length;
  }
  function layerRate(li) {
    const a = layerStart[li], b = a + layers[li].length;
    let s = 0; for (let i = a; i < b; i++) s += spikes[i];
    return s / (b - a);
  }

  return {
    N, NE, layers, layerStart, WS, D,
    V, spikes, W, W0, E, DA, rng,
    delays, dyn, shuffleInfo,
    modulatorCount, modulatorTypes, modEma,   // P0 third-factor channels
    get tick() { return tickIndex; },
    get stdpStats() { return { ltp: ltpEvents, ltd: ltdEvents, tauPost, Aplus, Aminus }; },
    tick,
    applyLearning,
    motorRate, layerRate,
    opticUV,
    response() {
      return { buf: recBuf ? recBuf.slice(0, recN) : null, n: recN,
               layer: recBuf ? recBuf.layer : null, every: recEvery };
    },
    clearTrace() { recN = 0; },
  };
}

module.exports = { createTypedSim, shuffledEdges, delaysFromOpticDepth, mulberry32, MOD_GAINS_DEFAULT };
