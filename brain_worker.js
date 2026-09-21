// brain_worker.js — (patch 19) the 106k-neuron LIF brain simulation moves off
// the render thread. The main page ships cheap per-frame inputs (sensors,
// visual field, learning rate) every other rAF frame; this worker advances
// the full connectome tick (563k synaptic fan-out) and publishes the spike
// bitmap + plastic weights back as zero-copy transferable buffers. The page
// keeps those buffers as its read-only mirrors, so all existing rendering
// code (point cloud, heat maps, HUD, region stats, replay) reads sim.spikes /
// sim.W unchanged. Buffers ping-pong: the page returns each consumed buffer
// and the worker reuses it as scratch, so nothing is re-allocated per tick.
//
// Protocol (main -> worker):  init | tick | reward | buffers
// Protocol (worker -> main):  ready | state | error
//
// If this worker cannot start (e.g. file:// pages), the main page
// transparently falls back to the old in-frame brainTick.
"use strict";

let S = null;          // master simulation state (never transferred)
let tickN = 0;
const WS = 0.02;       // global weight scale (parity with makeSim)
const spikePool = [];  // returned ArrayBuffers reused as spike publish targets
const wPool = [];      // same for weight publishes
let starved = 0;       // consecutive ticks with an empty publish pool

const clampf = (x, a, b) => x < a ? a : x > b ? b : x;

function buildSim(cfg) {
  const { N, NE, members, layerOff, src, dst, w0, sign, opticChan, opticCol, opticLayer,
          stimLayers, state, modEdges } = cfg;
  // layer membership as typed subarray views (indexable + .length like arrays)
  const layers = [];
  for (let i = 0; i < layerOff.length - 1; i++)
    layers.push(members.subarray(layerOff[i], layerOff[i + 1]));
  const layerStart = [];
  for (let i = 0; i < layerOff.length - 1; i++) layerStart.push(layerOff[i]);
  const V = new Float32Array(N), spikes = new Uint8Array(N), refac = new Uint8Array(N);
  const W = new Float32Array(NE), E = new Float32Array(NE);
  for (let i = 0; i < NE; i++) W[i] = w0[i] * (sign[i] ? 1 : -1) * WS;
  // P0 NT semantics: modulators (da/ser/oct) are NOT fast weights. The main
  // side filters modulatory edges out of src/dst/w0/sign before init and
  // passes them here as {s, type}; their source activity feeds third-factor
  // channels that scale the dopamine-gated update (mirrors controllers.js).
  const modByType = { dopamine: [], serotonin: [], octopamine: [] };
  for (const me of modEdges || []) if (modByType[me.type]) modByType[me.type].push(me);
  // P0 parity (fixed during Stage F wiring): plasticity is NOT gated on the
  // excitatory sign — eligibility is all-ones over fast edges, mirroring
  // controllers.js (`plastic[i] = 1`). The previous `plastic: sign` alias
  // silently froze every inhibitory synapse in this browser path.
  const plasticAll = new Uint8Array(NE).fill(1);
  return {
    N, NE, layers, layerStart, V, spikes, refac,
    src, dst, W, isExc: sign, plastic: plasticAll, E, WS,
    DA: { v: 0 },
    motorRateSmooth: 0,
    motorBase: 0,
    _stimPulse: 0,
    _spikePrev: new Uint8Array(N),
    opticChan, opticCol: opticCol || null, opticLayer, stimLayers: stimLayers || null,
    modByType,
    modulatorCount: (modEdges || []).length,
    modEma: { dopamine: 0, serotonin: 0, octopamine: 0 },
  };
}

function injectLayerChannels(sim, layerIndex, values, gain) {
  if (layerIndex < 0 || !values || !values.length) return;
  const layer = sim.layers[layerIndex], start = sim.layerStart[layerIndex];
  const bins = values.length;
  for (let k = 0; k < layer.length; k++) {
    const i = layer[k];
    const channel = Math.min(bins - 1, Math.floor(k * bins / layer.length));
    if (Math.random() < values[channel] * 0.5) sim.V[i] += gain * (0.5 + Math.random());
  }
}

function brainTick(sim, m) {
  const { V, spikes, refac, N } = sim;
  injectLayerChannels(sim, 0, m.s, 12);
  // STIMULUS-LOCKED firing: particle crossings pulse the real sensory
  // neuropils (AL + optic). The connectome's own edges carry the signal
  // onward; downstream layers are NOT force-injected. Crossings accumulate
  // main-side between ticks and arrive in m.stimPulse.
  if (m.stimPulse > 0) {
    const burst = m.stimPulse;         // 0..1 decaying envelope
    for (const li of sim.stimLayers || [0, 1]) {
      const a = sim.layerStart[li], b = a + sim.layers[li].length;
      const frac = 0.012 * burst;
      for (let i = a; i < b; i++)
        if (Math.random() < frac) V[i] += 16 * (0.7 + Math.random() * 0.6);
    }
  }
  // The optic layer is driven by particle positions. Stage F: when the main
  // page sends an 800-bin retinotopic field (m.visual.length > 8), each
  // optic neuron reads its own SOURCE-DERIVED hex column (opticCol,
  // precomputed at init from the same lattice as p1_retinotopy.py); with a
  // legacy 8-bin array the old channel map (opticChan) is used unchanged.
  if (sim.opticLayer >= 0 && sim.layers[sim.opticLayer]) {
    const optic = sim.layers[sim.opticLayer];
    if (m.visual && m.visual.length > 8 && sim.opticCol) {
      const colOf = sim.opticCol;
      for (let k = 0; k < optic.length; k++) {
        const drive = m.visual[colOf[k]] || 0;
        if (drive > 0 && Math.random() < drive * 0.5) V[optic[k]] += 14 * (0.5 + Math.random());
      }
    } else {
      const chan = sim.opticChan;
      for (let k = 0; k < optic.length; k++) {
        const drive = (chan ? m.visual[chan[k]] : m.visual[k % 8]) || 0;
        if (Math.random() < drive * 0.5) V[optic[k]] += 14 * (0.5 + Math.random());
      }
    }
  }
  const motorLayer = sim.layers.length - 1;
  const m0 = sim.layerStart[motorLayer], m1 = m0 + sim.layers[motorLayer].length;
  for (let i = m0; i < m1; i++) if (Math.random() < m.motorDrive * 0.035) V[i] += 8 * (0.5 + Math.random());
  if (m.exAmp > 0.03) for (let i = m0; i < m1; i++)
    if (Math.random() < 0.008) V[i] += m.exAmp * (24 + 24 * Math.random());
  for (let i = 0; i < N; i++) {
    if (refac[i] > 0) { refac[i]--; spikes[i] = 0; continue; }
    V[i] *= 0.86; spikes[i] = 0;
    if (V[i] > 30) { spikes[i] = 1; refac[i] = 3; }
  }
  // 1-tick synaptic delay: spikes from the previous tick drive currents now
  const prev = sim._spikePrev;
  for (let i = 0; i < sim.NE; i++) if (prev[sim.src[i]]) V[sim.dst[i]] += sim.W[i];
  prev.set(spikes);
  // P0 third-factor channels from modulatory source activity
  if (sim.modulatorCount) {
    for (const type in sim.modByType) {
      const list = sim.modByType[type];
      let act = 0;
      for (let mi = 0; mi < list.length; mi++) if (spikes[list[mi].s]) act++;
      sim.modEma[type] = sim.modEma[type] * MOD_EMA_DECAY
        + act / Math.max(1, list.length) * (1 - MOD_EMA_DECAY);
    }
  }
  sim.DA.v *= 0.985;
}

function updateTraces(sim) {
  const { E, plastic, spikes, src, dst, NE } = sim;
  for (let i = 0; i < NE; i++) { E[i] *= 0.985;
    if (plastic[i] && spikes[src[i]] && spikes[dst[i]]) E[i] = Math.min(E[i] + 0.15, 1); }
}

const MOD_GAINS = { dopamine: 0.15, serotonin: 0.15, octopamine: 0.15 };
const MOD_EMA_DECAY = 0.99;

function applyLearning(sim, lr) {
  const d0 = lr * sim.DA.v;
  if (Math.abs(d0) < 1e-5) return;
  // P0 third-factor gain (mirrors controllers.js)
  let G = 1;
  if (sim.modulatorCount) {
    for (const type in sim.modByType) {
      const g = MOD_GAINS[type];
      if (g && sim.modEma[type] > 0) G += g * Math.min(1, sim.modEma[type]);
    }
  }
  const d = d0 * G;
  const { E, plastic, isExc, W, W0b, NE } = sim;
  for (let i = 0; i < NE; i++) {
    const e = E[i];
    // P0: eligibility no longer requires isExc — inhibitory synapses are
    // plastic too; DA and other modulators are never in these arrays.
    if (e < 0.01 || !plastic[i]) continue;
    W[i] = clampf(W[i] + d * e * sim.WS * W0b[i], -W0b[i] * sim.WS, W0b[i] * sim.WS * 2);
  }
}

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === "init") {
      S = buildSim(m);
      S.W0b = m.w0;                       // master baseline weights (worker-owned)
      spikePool.length = 0; wPool.length = 0;
      spikePool.push(new ArrayBuffer(S.N), new ArrayBuffer(S.N));
      wPool.push(new ArrayBuffer(S.NE * 4), new ArrayBuffer(S.NE * 4));
      starved = 0;
      tickN = 0;
      self.postMessage({ type: "ready", N: S.N, NE: S.NE });
      return;
    }
    if (!S) return;

    if (m.type === "tick") {
      tickN++;
      // stimulus pulses from door crossings / apparatus events accumulate
      // main-side between ticks; decay mirrors the old main-thread envelope
      S._stimPulse = Math.min(1.5, S._stimPulse * 0.82 + (m.stim || 0));
      brainTick(S, { s: m.s, visual: m.visual, motorDrive: m.motorDrive,
                     exAmp: m.exAmp, stimPulse: S._stimPulse, dt: m.dt });
      updateTraces(S);
      if (m.lr) applyLearning(S, m.lr);
      // motor firing statistics for the door policy (same math as the old
      // main-thread block, including its frame-dt scaling, so behavior and
      // HUD readouts stay identical)
      const motorLayer = S.layers.length - 1;
      const a = S.layerStart[motorLayer], b = a + S.layers[motorLayer].length;
      let ms = 0; for (let i = a; i < b; i++) ms += S.spikes[i];
      S.motorRateSmooth = S.motorRateSmooth * 0.85
        + (ms / Math.max(1, b - a) / Math.max(m.dt, 1e-3)) * 0.15;
      S.motorBase += (S.motorRateSmooth - S.motorBase) * clampf(m.dt * 0.1, 0, 1);
      // publish: reuse a returned buffer as the spike snapshot; if the page
      // stopped returning buffers (lost/detached transfer) re-allocate after
      // ~1s of starvation instead of going silent forever.
      if (spikePool.length) {
        starved = 0;
        const buf = spikePool.pop();
        const pub = new Uint8Array(buf); pub.set(S.spikes);
        const msg = { type: "state", spikes: pub,
                      dav: S.DA.v, mrs: S.motorRateSmooth, mb: S.motorBase, tick: tickN };
        const tr = [buf];
        if ((tickN % 12) === 0 && wPool.length) {   // weights move slowly
          const wb = wPool.pop();
          const pubW = new Float32Array(wb); pubW.set(S.W);
          msg.W = pubW; tr.push(wb);
        }
        self.postMessage(msg, tr);
      } else if (++starved >= 30) {
        starved = 0;
        if (spikePool.length < 8)                // self-heal, but never balloon
          spikePool.push(new ArrayBuffer(S.N));
      }
      return;
    }

    if (m.type === "reward") {            // dopamine shift from door crossings
      S.DA.v = clampf(S.DA.v + m.dq, -1.5, 3);
      if (m.stim) S._stimPulse = Math.min(1.5, S._stimPulse + m.stim);
      return;
    }

    if (m.type === "buffers") {           // page returned consumed mirrors
      const sb = m.spikes && (m.spikes.buffer || m.spikes);   // view or ArrayBuffer
      if (sb && sb.byteLength === S.N && spikePool.length < 8) spikePool.push(sb);
      const wb = m.W && (m.W.buffer || m.W);
      if (wb && wb.byteLength === S.NE * 4 && wPool.length < 4) wPool.push(wb);
      return;
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.stack || err) });
  }
};
