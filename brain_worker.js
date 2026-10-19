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
// (P3 perf) render-state offload: the worker now also owns the per-neuron
// decay heat (fly_demon_3d.html used to re-scan all N neurons EVERY render
// frame) and the refreshWeightOverlay plastic top-K (a full 553k-edge scan +
// heap + sort every 6th frame). Heat decays once per tick with the
// frame-constant squared (0.90^2 = 0.81 at the 60fps/30Hz design point),
// preserving the same envelope. Top-K uses the EXACT main-thread score
// formula and tie-breaking, runs only when weights are actually published
// (every 12th tick), and ships a ~1.7 KB compact payload with the state
// message. The page keeps a quantized main-side mirror (_eHeat8) and retains
// its local heat/top-K paths for the in-frame fallback and trial replay.
//
// If this worker cannot start (e.g. file:// pages), the main page
// transparently falls back to the old in-frame brainTick.
"use strict";

let S = null;          // master simulation state (never transferred)
let tickN = 0;
const WS = 0.02;       // global weight scale (parity with makeSim)
const spikePool = [];  // returned ArrayBuffers reused as spike publish targets
const wPool = [];      // same for weight publishes
const heatPool = [];   // (P3) per-tick heat publish targets
const topkPool = [];   // (P3) {idx, score, flag} buffer triples for top-K publishes
let starved = 0;       // consecutive ticks with an empty publish pool

const clampf = (x, a, b) => x < a ? a : x > b ? b : x;

// (P3) heat decay constants. The main-thread block decays _eHeat per RENDER
// FRAME with 0.90; the tick runs at half the frame rate (patch 18 sim-parity
// gate), so the envelope-preserving per-tick constant is 0.90^2 = 0.81.
// tests/p3_topk_parity.test.js pins this derivation against the page's
// constant — update both together.
const HEAT_TICK_DECAY = 0.81;
const HEAT_QUANT = 255;                    // publish heat as N-byte Uint8 (x/255)
const TOPK_LIMIT = 180;                    // == brainHolder.changeLimit
const TOPK_MSG_BYTES = 4 + 4 + 1;          // packed bytes per top-K entry

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
  // (P3) worker-owned render state: per-neuron decay heat mirrors the page's
  // _eHeat (attack 1.0 on spike, exponential decay) but advances per tick.
  const heat = new Float32Array(N);
  if (cfg.heatSeed && cfg.heatSeed.length === N)
    for (let i = 0; i < N; i++) heat[i] = cfg.heatSeed[i] / HEAT_QUANT;  // restart continuity (dequantize /255)
  return {
    N, NE, layers, layerStart, V, spikes, refac,
    src, dst, W, isExc: sign, plastic: plasticAll, E, WS,
    heat,                                  // (P3) f32 chain, never transferred
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

// (P3) port of the refreshWeightOverlay scan (fly_demon_3d.html L3288+):
// same score formula, same 1e-5 skip, same strict-> min-heap (scan-order tie
// stability), same descending sort. bubbleUp PUSHES first (the original page
// version never pushed the first item — ranked[-1] — leaving the heap empty;
// fixed here and in the page in lockstep, 2026-09-22, see P3 audit notes).
// Parity is enforced by tests/p3_topk_parity.test.js against the real page
// formula. Returns packed typed arrays ready for postMessage transfer.
function topKChanges(W, W0, isExc, limit) {
  const NE = W.length;
  const ranked = [];
  const bubbleUp = (item) => {
    ranked.push(item);
    let i = ranked.length - 1;
    while (i > 0) { const parent = (i - 1) >> 1; if (ranked[parent][0] <= item[0]) break;
      ranked[i] = ranked[parent]; i = parent; }
    ranked[i] = item;
  };
  const bubbleDown = () => {
    let i = 0, item = ranked[0];
    while (true) { const left = i * 2 + 1; if (left >= ranked.length) break;
      let child = left, right = left + 1;
      if (right < ranked.length && ranked[right][0] < ranked[left][0]) child = right;
      if (ranked[child][0] >= item[0]) break;
      ranked[i] = ranked[child]; i = child;
    }
    ranked[i] = item;
  };
  for (let i = 0; i < NE; i++) {
    const baseline = W0[i] * WS * (isExc[i] ? 1 : -1);
    const scale = Math.max(Math.abs(W0[i] * WS), 1e-6);
    const score = Math.abs(W[i] - baseline) / scale;
    if (score <= 1e-5) continue;
    const item = [score, i];
    if (ranked.length < limit) bubbleUp(item);
    else if (score > ranked[0][0]) { ranked[0] = item; bubbleDown(); }
  }
  ranked.sort((a, b) => b[0] - a[0]);
  const n = ranked.length;
  const idx = new Int32Array(n), score = new Float32Array(n), flag = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const ei = ranked[k][1];
    idx[k] = ei;
    score[k] = ranked[k][0];
    flag[k] = Math.abs(W[ei]) > Math.abs(W0[ei] * WS * (isExc[ei] ? 1 : -1)) ? 1 : 0;
  }
  return { idx, score, flag, count: n };
}

// (P3) pack {idx,score,flag,count} into one transferable ArrayBuffer:
// [count(u32)] then per entry [index(i32), scoreBits(u32), flag(u8)].
function packTopK(r) {
  const n = r.count | 0;
  const buf = new ArrayBuffer(4 + n * TOPK_MSG_BYTES);
  const dv = new DataView(buf);
  dv.setUint32(0, n, true);
  let o = 4;
  for (let k = 0; k < n; k++) {
    dv.setInt32(o, r.idx[k], true); o += 4;
    dv.setUint32(o, f32Bits(r.score[k]), true); o += 4;
    dv.setUint8(o, r.flag[k]); o += 1;
  }
  return buf;
}
function f32Bits(v) { const t = new Float32Array(1); t[0] = v; return new Uint32Array(t.buffer)[0]; }
function bitsF32(b) { const u = new Uint32Array(1); u[0] = b; return new Float32Array(u.buffer)[0]; }
function unpackTopK(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const idx = new Int32Array(n), score = new Float32Array(n), flag = new Uint8Array(n);
  let o = 4;
  for (let k = 0; k < n; k++) {
    idx[k] = dv.getInt32(o, true); o += 4;
    score[k] = bitsF32(dv.getUint32(o, true)); o += 4;
    flag[k] = dv.getUint8(o); o += 1;
  }
  return { idx, score, flag, count: n };
}

// (demon observation, row 3) OPTIONAL 5th argument `slice` = {start, count, frac}:
// map values[start .. start+count) across the layer index span
// [frac[0]*len, frac[1]*len) instead of the whole layer. ABSENT (= every
// pre-slice call) start0 = 0, bins = values.length, lo = 0, hi = layer.length,
// so the loop body is arithmetically identical and consumes Math.random in
// exactly the original order — the pre-slice input mapping, byte for byte.
function injectLayerChannels(sim, layerIndex, values, gain, slice) {
  if (layerIndex < 0 || !values || !values.length) return;
  const layer = sim.layers[layerIndex];
  const start0 = slice ? (slice.start | 0) : 0;
  const bins = slice ? (slice.count | 0) : values.length;
  const lo = slice && slice.frac ? Math.max(0, Math.min(layer.length, Math.floor(slice.frac[0] * layer.length))) : 0;
  const hi = slice && slice.frac ? Math.max(lo, Math.min(layer.length, Math.floor(slice.frac[1] * layer.length))) : layer.length;
  const span = hi - lo;
  if (bins <= 0 || span <= 0 || start0 + bins > values.length) return;
  for (let k = 0; k < span; k++) {
    const i = layer[lo + k];
    const channel = start0 + Math.min(bins - 1, Math.floor(k * bins / span));
    if (Math.random() < values[channel] * 0.5) sim.V[i] += gain * (0.5 + Math.random());
  }
}

function brainTick(sim, m) {
  const { V, spikes, refac, N } = sim;
  // (demon observation, row 3) the base sensory channels keep their original
  // 7-bin partition over the whole input layer; the obs_* tail (shipped as its
  // own tolerant field, m.demonObs) enters the RESERVED sub-band below. An
  // old-format tick has no m.demonObs and no m.s tail, so both branches are
  // skipped and this function is byte-identical to pre-slice behavior.
  injectLayerChannels(sim, 0, m.s, 12, (m.s && m.s.length > 7) ? { start: 0, count: 7 } : undefined);
  if (m.demonObs && m.demonObs.length)
    injectLayerChannels(sim, 0, m.demonObs, 12, { start: 0, count: 8, frac: [0.86, 1.0] });
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
      heatPool.length = 0; topkPool.length = 0;
      spikePool.push(new ArrayBuffer(S.N), new ArrayBuffer(S.N));
      wPool.push(new ArrayBuffer(S.NE * 4), new ArrayBuffer(S.NE * 4));
      heatPool.push(new ArrayBuffer(S.N), new ArrayBuffer(S.N));
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
                     exAmp: m.exAmp, stimPulse: S._stimPulse, dt: m.dt,
                     demonObs: m.demonObs });
      updateTraces(S);
      if (m.lr) applyLearning(S, m.lr);
      // motor firing statistics for the door policy (same math as the old
      // main-thread block, including its frame-dt scaling, so behavior and
      // HUD readouts stay identical)
      // (audit logging R2) publish the UNsmoothed per-tick motor firing rate —
      // the exact pre-EMA value that feeds motorRateSmooth, i.e. the immediate
      // noise/input the smoothed signal integrates; logged as motorRaw so the
      // log can separate raw neural output from its processed/EMA form.
      const motorLayer = S.layers.length - 1;
      const a = S.layerStart[motorLayer], b = a + S.layers[motorLayer].length;
      let ms = 0; for (let i = a; i < b; i++) ms += S.spikes[i];
      S.motorRaw = ms / Math.max(1, b - a) / Math.max(m.dt, 1e-3);
      S.motorRateSmooth = S.motorRateSmooth * 0.85
        + (ms / Math.max(1, b - a) / Math.max(m.dt, 1e-3)) * 0.15;
      S.motorBase += (S.motorRateSmooth - S.motorBase) * clampf(m.dt * 0.1, 0, 1);
      // (P3) worker-owned per-neuron heat: attack 1.0 on spike, exponential
      // decay at the tick-cadence constant (envelope parity with the old
      // per-frame 0.90 chain — see HEAT_TICK_DECAY above).
      for (let i = 0; i < S.N; i++) S.heat[i] = S.spikes[i] ? 1 : S.heat[i] * HEAT_TICK_DECAY;
      // publish: reuse a returned buffer as the spike snapshot; if the page
      // stopped returning buffers (lost/detached transfer) re-allocate after
      // ~1s of starvation instead of going silent forever.
      if (spikePool.length) {
        starved = 0;
        const buf = spikePool.pop();
        const pub = new Uint8Array(buf); pub.set(S.spikes);
        const msg = { type: "state", spikes: pub,
                      dav: S.DA.v, mrs: S.motorRateSmooth, mb: S.motorBase, tick: tickN,
                      // (audit logging R2) raw per-tick motor firing rate (pre-EMA);
                      // finite always (ms, b-a, m.dt are finite positive).
                      mrRaw: S.motorRaw,
                      // (demon observation, row 4) ECHO the demon block this tick
                      // was computed with, so the page can label the returned
                      // spike bitmap with the exact state that drove it (no
                      // tick-arrival lag). Absent when the sender is old-format.
                      demon: m.demon || null,
                      demonObsChannels: m.demonObs ? m.demonObs.length : 0 };
        const tr = [buf];
        // (P3) heat snapshot every tick: quantized to 1 byte/neuron (error
        // ~0.004, far below the 0.05/0.07 render thresholds) and transferred
        // zero-copy from the pool. Warm-started with m.heatSeed on init so a
        // worker restart does not cold-flash the glow.
        if (heatPool.length) {
          const hb = heatPool.pop();
          const pubH = new Uint8Array(hb);
          for (let i = 0; i < S.N; i++) pubH[i] = Math.round(S.heat[i] * HEAT_QUANT);
          msg.heat = pubH; tr.push(hb);
        }
        // (P3) plastic top-K only when weights actually move across (every
        // 12th tick); gated on an ACTUAL publish, not tickN%12, so pool
        // starvation cannot ship a stale ranking twice.
        if ((tickN % 12) === 0 && wPool.length) {   // weights move slowly
          const wb = wPool.pop();
          const pubW = new Float32Array(wb); pubW.set(S.W);
          msg.W = pubW; tr.push(wb);
          const tk = topKChanges(S.W, S.W0b, S.isExc, TOPK_LIMIT);
          if (topkPool.length) {
            const tb = topkPool.pop();
            const packed = packTopK(tk);
            if (packed.byteLength <= tb.byteLength) {
              new Uint8Array(tb).set(new Uint8Array(packed));
              msg.topK = { count: tk.count, buf: tb };
              tr.push(tb);
            } else {
              msg.topK = { count: tk.count, buf: packed };
              tr.push(packed);
            }
          } else {
            const packed = packTopK(tk);
            msg.topK = { count: tk.count, buf: packed };
            tr.push(packed);
          }
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
      const hb = m.heat && (m.heat.buffer || m.heat);         // (P3) heat mirror return
      if (hb && hb.byteLength === S.N && heatPool.length < 4) heatPool.push(hb);
      const tbuf = m.topK && (m.topK.buf && (m.topK.buf.buffer || m.topK.buf)); // (P3) topK return
      // Partial rankings (count < limit) ship a smaller buffer; accept any
      // buffer big enough for the header + at least one entry and reuse it
      // when a future packing fits (see the topK publish path above).
      if (tbuf && tbuf.byteLength >= 4 + TOPK_MSG_BYTES && topkPool.length < 4)
        topkPool.push(tbuf);
      return;
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.stack || err) });
  }
};
