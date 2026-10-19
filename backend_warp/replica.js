// replica.js — JS reference implementation of the brain_worker.js kernels,
// bit-parity anchor for the Warp correctness harness.
//
// Implements EXACTLY the production math (brain_worker.js brainTick /
// updateTraces / applyLearning, fly_demon_3d.html heat + refreshWeightOverlay),
// with one declared substitution: Math.random() -> a deterministic per-(neuron,
// tick) derived 32-bit LCG (shared with kernels.py) so CPU and CUDA run the
// identical random sequence despite different thread-scheduling orders.
"use strict";

// Shared LCG (must match kernels.py lcg_next/lcg_uniform bit-for-bit).
function lcgNext(state) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}
function lcgUniform(state) {
  return (state & 0xffffff) / 16777216; // f32-exact uniform in [0,1)
}
function f32(x) { return Math.fround(x); }

class SpillRng {
  constructor(seed) { this.s = seed >>> 0; }
  u32() { this.s = lcgNext(this.s); return this.s; }
  uni() { return f32(lcgUniform((this.s = lcgNext(this.s)))); }
}

// ---- production constants (verbatim)
const LEAK = 0.86, VTH = 30.0, REFAC = 3;
const E_DECAY = 0.985, E_INC = 0.15;
const MOD_EMA_DECAY = 0.99, MOD_GAINS = { dopamine: 0.15, serotonin: 0.15, octopamine: 0.15 };
const WS = 0.02, HEAT_DECAY = 0.94, CHANGE_TOP_K = 180;
const STIM_BURST_FRAC = 0.012, STIM_BURST_AMP = 16.0;
const OPTIC_P = 0.5, OPTIC_AMP = 14.0;
const MOTOR_P = 0.035, MOTOR_AMP = 8.0;
const DA_DECAY = 0.985;

class Sim {
  constructor({ N, NE, src, dst, w0, sign, layerStart, stimRange, opticRange, motorRange, modEdges }) {
    this.N = N; this.NE = NE;
    this.src = src; this.dst = dst;
    this.w0b = w0;                      // baseline w0 (pre-sign)
    this.isExc = sign;
    this.W = new Float32Array(NE);      // scaled signed weights
    for (let i = 0; i < NE; i++) this.W[i] = f32(w0[i] * (sign[i] ? 1 : -1) * WS);
    this.W0 = new Float32Array(NE);     // scaled baseline (for change scan)
    for (let i = 0; i < NE; i++) this.W0[i] = f32(w0[i] * WS);
    this.V = new Float32Array(N);
    this.vbuf = new Float32Array(N);   // injector accumulation, mirrors Warp kernel vbuf
    this.spikes = new Uint8Array(N);
    this.refac = new Uint8Array(N);
    this.prev = new Uint8Array(N);
    this.E = new Float32Array(NE);
    this.heat = new Float32Array(N);
    this.plastic = new Uint8Array(NE).fill(1);
    this.layerStart = layerStart;
    this.stimRange = stimRange; this.opticRange = opticRange; this.motorRange = motorRange;
    // modulators: {type: Int32Array(sources)} in production order
    this.modByType = modEdges || {};
    this.modEma = { dopamine: 0, serotonin: 0, octopamine: 0 };
    this.DA = 0;
    this.t = 0;
  }

  // One tick. stimBurst in [0,1] decaying envelope; opticField = per-neuron
  // drive lookup fn(k) -> [0,1]; motorDrive in [0,1]; exAmp excitability.
  //
  // RNG DERIVATION (must stay identical to kernels.py k_lif_edge_parallel):
  //   base = lcg(seed ^ i ^ t)      [per-neuron, per-tick stream, seed=1]
  //   stim:  gate=uni(base);        amp=16*(0.7+0.6*uni(next(base)))
  //   optic: gate=uni(next2);       amp=14*(0.5+uni(next3))
  //   motor: gate=uni(next4);       amp= 8*(0.5+uni(next5))
  //   ex:    gate=uni(next6);       amp=ex*(24+24*uni(next7))
  tick({ stimBurst = 0, opticField = null, motorDrive = 0.35, exAmp = 0.3 } = {}) {
    const { V, vbuf, spikes, refac, prev, N, NE, src, dst, W } = this;
    const t = this.t++;
    // --- injectors in production stage order (stim -> optic -> motor -> ex)
    // Accumulate into vbuf with per-add f32 rounding, exactly as the Warp
    // kernel's atomic_add(vbuf, i, ...) does (same thread => same order).
    {
      const [a, b] = this.stimRange;
      if (stimBurst > 0) {
        for (let i = a; i < b; i++) {
          const st1 = lcgNext((1 ^ i ^ t) >>> 0);
          if (f32(lcgUniform(st1)) < f32(f32(STIM_BURST_FRAC) * f32(stimBurst))) {
            const us = f32(lcgUniform(lcgNext(st1)));
            const amp = f32(f32(STIM_BURST_AMP) * f32(f32(0.7) + f32(f32(0.6) * us)));
            vbuf[i] = f32(vbuf[i] + amp);
          }
        }
      }
    }
    {
      const [a, b] = this.opticRange;
      for (let k = 0; k < b - a; k++) {
        const drive = opticField ? f32(opticField(a + k) || 0) : 0;
        const st2 = lcgNext(lcgNext((1 ^ (a + k) ^ t) >>> 0));
        if (drive > 0 && f32(lcgUniform(st2)) < f32(f32(drive) * f32(OPTIC_P))) {
          const uo = f32(lcgUniform(lcgNext(st2)));
          const amp = f32(f32(OPTIC_AMP) * f32(f32(0.5) + uo));
          vbuf[a + k] = f32(vbuf[a + k] + amp);
        }
      }
    }
    {
      const [a, b] = this.motorRange;
      for (let i = a; i < b; i++) {
        let st = lcgNext(lcgNext(lcgNext((1 ^ i ^ t) >>> 0)));
        if (f32(lcgUniform(st)) < f32(f32(motorDrive) * f32(MOTOR_P))) {
          const um = f32(lcgUniform(lcgNext(st)));
          const amp = f32(f32(MOTOR_AMP) * f32(f32(0.5) + um));
          vbuf[i] = f32(vbuf[i] + amp);
        }
        st = lcgNext(st);
        if (exAmp > 0.03 && f32(lcgUniform(st)) < f32(0.008)) {
          const ue = f32(lcgUniform(lcgNext(st)));
          const amp = f32(f32(exAmp) * f32(f32(24.0) + f32(f32(24.0) * ue)));
          vbuf[i] = f32(vbuf[i] + amp);
        }
      }
    }
    // --- LIF (node order deterministic; (V + vbuf) * LEAK, per-op rounding)
    for (let i = 0; i < N; i++) {
      if (refac[i] > 0) { refac[i]--; spikes[i] = 0; continue; }
      const vi = f32(f32(V[i] + vbuf[i]) * f32(LEAK));
      V[i] = vi;
      if (vi > f32(VTH)) { spikes[i] = 1; refac[i] = REFAC; }
      else { spikes[i] = 0; }
    }
    vbuf.fill(0);
    // --- 1-tick-delay fan-out (edge order deterministic; add associativity
    //     caveat documented in kernels.py)
    for (let i = 0; i < NE; i++) if (prev[src[i]]) V[dst[i]] = f32(V[dst[i]] + W[i]);
    prev.set(spikes);
    // --- modulator EMA (third factor)
    for (const type in this.modByType) {
      const list = this.modByType[type];
      let act = 0;
      for (let mi = 0; mi < list.length; mi++) if (spikes[list[mi]]) act++;
      this.modEma[type] = this.modEma[type] * MOD_EMA_DECAY
        + f32(act / Math.max(1, list.length)) * (1 - MOD_EMA_DECAY);
    }
    this.DA = f32(this.DA * f32(DA_DECAY));
    return spikes;
  }

  updateTraces() {
    const { E, plastic, spikes, src, dst, NE } = this;
    for (let i = 0; i < NE; i++) {
      let ei = f32(E[i] * f32(E_DECAY));
      if (plastic[i] && spikes[src[i]] && spikes[dst[i]]) ei = Math.min(f32(ei + f32(E_INC)), 1);
      E[i] = ei;
    }
  }

  // applyLearning: d = lr*DA*G computed host-side (mirrors production).
  // `da` overrides the internal envelope for correctness scenarios (the
  // production envelope starts at 0 and only rises via reward events).
  applyLearning(lr, da = this.DA) {
    const d0 = f32(lr * f32(da));
    if (Math.abs(d0) < 1e-5) return;
    let G = 1;
    for (const type in this.modByType) {
      const g = MOD_GAINS[type];
      if (g && this.modEma[type] > 0) G += g * Math.min(1, this.modEma[type]);
    }
    const d = f32(d0 * G);
    const { E, plastic, W, w0b, NE } = this;
    for (let i = 0; i < NE; i++) {
      const e = E[i];
      if (e < 0.01 || !plastic[i]) continue;
      const wmax = f32(w0b[i] * f32(WS));
      W[i] = Math.min(Math.max(f32(W[i] + f32(d * e)), -wmax), f32(wmax * 2));
    }
  }

  decayHeat(spikeArr) {
    for (let i = 0; i < this.N; i++)
      this.heat[i] = spikeArr[i] ? 1 : f32(this.heat[i] * f32(HEAT_DECAY));
  }

  // refreshWeightOverlay scan: change[i] = |W - W0| (both already WS-scaled);
  // top-K by ascending change, ties by scan order (heap push semantics).
  changes() {
    const { W, W0, NE } = this;
    const ch = new Float32Array(NE);
    for (let i = 0; i < NE; i++) ch[i] = Math.abs(f32(W[i] - W0[i]));
    return ch;
  }
  topKChanges(k = CHANGE_TOP_K) {
    const ch = this.changes();
    const idx = Array.from({ length: this.NE }, (_, i) => i);
    idx.sort((a, b) => (ch[a] === ch[b] ? a - b : ch[a] - ch[b]));
    return idx.slice(0, k).map((i) => [ch[i], i]);
  }

  snapshot() {
    return {
      V: this.V.slice(), spikes: this.spikes.slice(), refac: this.refac.slice(),
      W: this.W.slice(), E: this.E.slice(), heat: this.heat.slice(),
      DA: this.DA, modEma: { ...this.modEma },
    };
  }

  loadSnapshot(s) {
    this.V.set(s.V); this.spikes.set(s.spikes); this.refac.set(s.refac);
    this.W.set(s.W); this.E.set(s.E); this.heat.set(s.heat);
    this.DA = s.DA; this.modEma = { ...s.modEma };
    this.prev.fill(0);
  }
}

module.exports = {
  Sim, SpillRng, lcgNext, lcgUniform, f32,
  LEAK, VTH, REFAC, E_DECAY, E_INC, WS, HEAT_DECAY, CHANGE_TOP_K,
  STIM_BURST_FRAC, STIM_BURST_AMP, OPTIC_P, OPTIC_AMP, MOTOR_P, MOTOR_AMP,
};
