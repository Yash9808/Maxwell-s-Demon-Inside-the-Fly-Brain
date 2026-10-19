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
const RT = require("./p1_retinotopy.js");   // Stage F hex-lattice optic input
// (experiment_core.js must stay require()-free — the smoke determinism
// sandbox forbids module loads there — so the field is computed HERE from
// env.particles + the exported CH constants.)
const RT_NODES = RT.hexLatticeNodes();

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
    fireVec() {
      // Real per-neuron activity snapshot: 16 hidden (tanh, [-1,1]) + 2 output
      // (softmax, [0,1]) activations from the LAST forward pass, Uint8-quantized
      // with the same sqrt scaling the connectome controller uses. Feeds the
      // Brain-outcome per-neuron cards for E2/E5-ann with measured data.
      const q = new Uint8Array(NHID + NOUT);
      for (let h = 0; h < NHID; h++)
        q[h] = Math.min(255, Math.round(Math.sqrt(Math.abs(hid[h])) * 16));
      for (let o = 0; o < NOUT; o++)
        q[NHID + o] = Math.min(255, Math.round(Math.sqrt(out[o]) * 16));
      let b64 = "";
      for (let i = 0; i < q.length; i += 3)
        b64 += btoa(String.fromCharCode(q[i], q[i + 1] || 0, q[i + 2] || 0));
      return { vec: b64, n: q.length, total: hidRateSum + outRateSum };
    },
  };
}

// --------------------------------------------------- 4. Drosophila-inspired
/**
 * Simplified mushroom-body architecture (PDF Experiment 3):
 *   sensory (7) + visual field (8 bins) -> projection neurons -> Kenyon-like
 *   population -> MBON output pool (16, opponent approach/avoid channels) ->
 *   dopamine-gated decision -> motor (door).
 * Two reward-gated plasticity sites: KC->MBON synapses (wMB; winner-take-all
 * LTP on the MBON that won the last race, contrast LTD on the losers) and
 * visual-bin->PN weights (wPNVis; conjunctive LTP). KC drive gains (wKC) and
 * sensor->PN wiring (wPN) are fixed.
 */
function drosophilaController(rng, env, cfg) {
  const NPN = 32, NKC = 200, NMBON = 16;
  const KC_ACTIVE = 12;                       // sparse winnner-take-all
  const wPN = new Float32Array(7 * NPN);      // sensor -> PN (fixed wiring)
  const wPNVis = new Float32Array(8 * NPN);   // visual bin -> PN (LEARNED, reward-gated)
  const wKC = new Float32Array(NKC);          // KC drive gain (fixed; not plastic)
  const wMB = new Float32Array(NMBON * NKC);  // KC -> MBON synapses (LEARNED, reward-gated)
  for (let i = 0; i < wPN.length; i++) wPN[i] = rng();
  for (let i = 0; i < wPNVis.length; i++) wPNVis[i] = rng();
  for (let i = 0; i < NKC; i++) wKC[i] = 0.5 + rng() * 0.5;
  for (let i = 0; i < wMB.length; i++) wMB[i] = 0.05 + rng() * 0.15;
  const kcThr = new Float32Array(NKC);
  for (let i = 0; i < NKC; i++) kcThr[i] = 0.3 + rng() * 0.4;

  const pnAct = new Float32Array(NPN);        // PN rates (this step)
  const kcAct = new Float32Array(NKC);        // binary KC spikes (this step)
  const mb = new Float32Array(NMBON);         // MBON drives (this step)
  let mbWinner = 0, lastVis = null;           // last race winner / visual field
  let chOpen = 0, latchOpen = false;          // opponent channels + hysteresis latch
  let bestOpenM = 0, bestCloseM = 0;          // best MBON per channel (credit)
  let mbOut = 0, baseline = 0.5, learning = true;
  let agreeCount = 0, decisions = 0;
  const da = { v: 0 };
  const layerSteps = { pn: 0, kc: 0, mb: 0 };
  const layerSums = { pn: 0, kc: 0, mb: 0 };

  function forward(env2) {
    const s = env2.readSensors();
    const v = env2.readVisualField();
    lastVis = v;
    // PN response
    for (let p = 0; p < NPN; p++) {
      let a = 0;
      for (let i = 0; i < 7; i++) a += s[i] * wPN[i * NPN + p];
      for (let i = 0; i < 8; i++) a += v[i] * 1.0 * wPNVis[i * NPN + p]; // learned visual-PN weights
      pnAct[p] = a / 7;
      if (pnAct[p] > 0.5) layerSums.pn++;     // PN "spike" (thresholded rate)
    }
    layerSteps.pn++;
    // KC expansion + sparsification
    for (let k = 0; k < NKC; k++) {
      const p = k % NPN;
      const drive = pnAct[p] * wKC[k] + (rng() - 0.5) * 0.05;
      kcAct[k] = drive > kcThr[k] ? 1 : 0;    // binary KC spike
      if (kcAct[k]) layerSums.kc++;
    }
    layerSteps.kc++;
    // ---- MBON output layer: sparse KC code drives learned KC->MBON synapses.
    // Winner-take-all race decides the readout: mbOut is the winning MBON's
    // drive normalized by the KC population — the scale the door comparator's
    // +0.01 margin was calibrated on (the old active/NKC rate code). Rest
    // bias + noise keep every MBON winnable before learning specializes it.
    for (let m = 0; m < NMBON; m++) mb[m] = 0.05 + rng() * 0.10;
    let nAct = 0;
    for (let k = 0; k < NKC; k++) {
      if (!kcAct[k]) continue;
      nAct++;
      const w = wKC[k];
      for (let m = 0; m < NMBON; m++) mb[m] += wMB[k * NMBON + m] * w;
    }
    if (nAct > 0) { const inv = 1 / nAct; for (let m = 0; m < NMBON; m++) mb[m] *= inv; }
    let mbMax = 0;
    for (let m = 0; m < NMBON; m++) if (mb[m] > mbMax) mbMax = mb[m];
    // Opponent motor channels (MBON 0-7 = approach/open, 8-15 = avoid/close),
    // the classic MBON approach/avoid compartment split: channel drive is the
    // summed drive of its 8 MBONs and the stronger channel holds the door.
    // Dopamine LTPs the acting channel's best MBON on good outcomes and the
    // opponent's best on bad ones (contrast), so preference can hold the door
    // open OR closed per context and punishment prepares a policy switch.
    let dO = 0, dC = 0, bO = 0, mO = 0, bC = 0, mC = 0;
    for (let m = 0; m < NMBON; m++) {
      if (m < NMBON / 2) { dO += mb[m]; if (mb[m] > bO) { bO = mb[m]; mO = m; } }
      else { dC += mb[m]; if (mb[m] > bC) { bC = mb[m]; mC = m; } }
    }
    bestOpenM = mO; bestCloseM = mC;
    chOpen = chOpen * 0.95 + (dO - dC) * 0.05;         // smoothed decision var
    // Hysteresis latch: commit to a channel and hold it until the drive
    // difference clearly crosses zero — without this, rest noise flips the
    // credited channel several times a second and reward credit cancels.
    if (chOpen > 0.02) latchOpen = true;
    else if (chOpen < -0.02) latchOpen = false;
    mbWinner = latchOpen ? mO : mC;                    // credit the acting channel
    mbOut = 0.05 * (dO - dC);                          // dashboard scale (rate era)
    if (mbMax > 0.15) layerSums.mb++;           // a MBON fired above rest bias (0.05-0.15)
    layerSteps.mb++;
    return mbOut;
  }

  return {
    name: "drosophila",
    observe(env2) { forward(env2); },
    step(dt, env2) {
      baseline += (mbOut - baseline) * clamp(dt * 0.5, 0, 1); // activity stat (EMA)
      const open = latchOpen;                   // opponent-channel decision (latched)
      env2.door.target = open ? 1 : 0;
      decisions++;
      if (open === (demonDecisionFor(env2, {}) === 1)) agreeCount++;
      da.v *= 0.985;
    },
    receiveFeedback(fb) {
      if (!learning) return;
      const r = fb.good ? 1 : -1;
      da.v = clamp(da.v + 0.6 * r, -1.5, 3);
      // Dopamine-gated plasticity, two sites:
      //  1) KC->MBON (wMB): the MBON that won the last race gets LTP on its
      //     active-KC synapses (reward) or LTD (punishment); every loser
      //     gets the opposite sign on the same active set (race contrast).
      //  2) visual bin -> PN (wPNVis): conjunctive LTP where the last
      //     visual field and the spiking PN crowd overlapped.
      if (da.v !== 0 && lastVis) {
        // Rates are small on purpose: one feedback step must move a synapse
        // well below the channel-drive scale so preferences accumulate over
        // dozens of outcomes instead of saturating after the first reward.
        // Acting channel's best MBON: LTP with dopamine sign (reward strength-
        // ens this context-action, punishment weakens it). On PUNISHMENT the
        // opposing channel's best MBON also grows (contrast term) — how the
        // policy prepares a switch. Reward never decays the opponent: wMB
        // synapses are shared across contexts, and reward-side opponent decay
        // would melt the alternative channel's synapses to the zero floor,
        // permanently killing it (observed as an always-closed policy).
        const oppBest = latchOpen ? bestCloseM : bestOpenM;
        for (let k = 0; k < NKC; k++) {
          if (!kcAct[k]) continue;
          const w = wKC[k];
          const ik = k * NMBON;
          wMB[ik + mbWinner] = clamp(wMB[ik + mbWinner] + 0.02 * da.v * w, 0, 0.3);
          if (da.v < 0)
            wMB[ik + oppBest] = clamp(wMB[ik + oppBest] + 0.02 * (-da.v) * w, 0, 0.3);
        }
        for (let b = 0; b < 8; b++) {
          if (!(lastVis[b] > 0.05)) continue;
          for (let p = 0; p < NPN; p++) {
            if (pnAct[p] > 0.5) wPNVis[b * NPN + p] = clamp(wPNVis[b * NPN + p] + 0.02 * da.v, 0, 1.5);
          }
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
      // Snapshot of the last step's activity: PN rates, binary KC spikes
      // and MBON drives, quantized like the connectome controller.
      const q = new Uint8Array(NPN + NKC + NMBON);
      for (let i = 0; i < NPN; i++) {
        const v = Math.max(0, pnAct[i]) * 8;    // PN rate
        q[i] = Math.min(255, Math.ceil(Math.sqrt(v) * 16));
      }
      for (let k = 0; k < NKC; k++) {
        const c = kcAct[k] > 0.5 ? 4 : 0;       // binary KC spike
        q[NPN + k] = c;
      }
      for (let m = 0; m < NMBON; m++) {
        const v = Math.max(0, mb[m] - 0.05) * 8; // MBON drive above rest bias
        q[NPN + NKC + m] = Math.min(255, Math.ceil(Math.sqrt(v) * 16));
      }
      let b64 = "";
      const CH = 3 * 4096;   // multiple of 3 so concatenated base64 stays valid
      for (let o = 0; o < q.length; o += CH)
        b64 += btoa(String.fromCharCode.apply(null, q.subarray(o, Math.min(q.length, o + CH))));
      return { vec: b64, n: q.length, layout: { pn: NPN, kc: NKC, mbon: NMBON } };
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
// --- P0 modulatory (third-factor) semantics ---------------------------------
// Edge objects may carry nt / modulatory / modulatorType (schema 2, P0).
// Legacy circuits (no modulatory field) keep the old behavior exactly:
// an absent field means a fast, weight-bearing synapse, sign +1/-1.
// Modulators (da/ser/oct) are NEVER weight-bearing: they are split out of the
// propagation arrays at build time and re-enter only as per-modulator activity
// channels that scale the dopamine-gated plasticity update (third factor).
// Default modulation gains are structural and UNOPTIMIZED (no benchmark was
// consulted to choose them); pass opts.modulation to override.
const MOD_GAINS_DEFAULT = Object.freeze({ dopamine: 0.15, serotonin: 0.15, octopamine: 0.15 });

function ntToModulator(nt) {                 // tolerant fallback for partial schema
  return nt === "da" ? "dopamine" : nt === "ser" ? "serotonin"
       : nt === "oct" ? "octopamine" : null;
}

function connectomeController(circuit, opts) {
  opts = opts || {};
  const shuffle = !!opts.shuffle;
  // Stage-1/configurable lr (pre-registration config): the dopamine-gated
  // update rate for applyLearning below. Default 0.004 preserves the legacy
  // magnitude byte-for-byte for every existing caller.
  const lr = opts.lr !== undefined && Number.isFinite(opts.lr) ? opts.lr : 0.004;
  const motorDrive = opts.motorDrive !== undefined ? opts.motorDrive : 0.35;
  const opticDrive = opts.opticDrive !== undefined ? opts.opticDrive : 1.0;
  // plasticity mode (Experiment 4 variants):
  //   "full" = all excitatory edges plastic (4A, default)
  //   "restricted" = only sensory-pathway edges plastic (4B restricted)
  //   "none" = fixed connectome, no plasticity (4B fixed)
  const plasticity = opts.plasticity !== undefined ? opts.plasticity : "full";
  // P0 third-factor channels: modulatory contacts split from the fast edges.
  const MOD_GAINS = Object.assign({}, MOD_GAINS_DEFAULT, opts.modulation || {});
  const hasModField = circuit.modulatory_edges !== undefined ||
    (circuit.edges.length && circuit.edges[0].modulatory !== undefined);
  // arm D keeps the REAL modulatory-contact layout: customEdges replaces only
  // the FAST propagation list; modEdgesRaw below still reads circuit.edges.
  const modEdgesRaw = hasModField && circuit.modulatory_edges
    ? circuit.modulatory_edges
    : (circuit.edges || []).filter(e => e.modulatory);   // tolerant fallback
  const MOD = { dopamine: 0, serotonin: 0, octopamine: 0 }; // modulator activity (EMA)
  const layers = circuit.layers;
  const N = layers.reduce((a, l) => a + l.length, 0);
  const NE0 = circuit.edges.length;
  const layerStart = [];
  { let s = 0; for (const l of layers) { layerStart.push(s); s += l.length; } }

  // --- edge arrays (source -> dest, weight, sign) ---
  // P0: modulatory edges are NOT propagation edges. They are filtered out
  // here so spike propagation, weights and eligibility traces only ever see
  // fast synapses; their activity feeds the third-factor channels instead.
  // Stage 1 arm D (Confirmatory_experiment_protocol_v1.md §5c): opts.customEdges
  // — an explicitly supplied fast-synapse edge list (built by
  // degreeMatchedRandomEdges) — REPLACES the real fast-edge list BEFORE the
  // shuffle branch. Every other construction step (weight scaling, plastic,-
  // ity flags, CSR layout, modulatory handling) is untouched, so arm D differs
  // from arm A only in wiring, never in runtime.
  let edges = (opts.customEdges || circuit.edges).filter(e => !e.modulatory)
                           .map(e => ({ s: e.s, t: e.t, w: e.w, sign: e.sign, nt: e.nt || null }));
  if (shuffle) {
    // degree-preserving rewiring: collect all endpoints, shuffle targets.
    const rng = makeRng(opts.seed || 7);
    const targets = edges.map(e => e.t);
    for (let i = targets.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = targets[i]; targets[i] = targets[j]; targets[j] = tmp;
    }
    edges = edges.map((e, i) => ({ s: e.s, t: targets[i], w: e.w, sign: e.sign, nt: e.nt }));
  }
  // P0: the shuffled-connectome control shuffles fast wiring AND reassigns
  // modulatory contacts, so structure (not just weights) is randomized.
  let modEdges = modEdgesRaw.map(e => ({ s: e.s, t: e.t, type: e.modulatorType || ntToModulator(e.nt) }));
  if (shuffle) {
    const modTargets = modEdges.map(e => e.t);
    const rngMod = makeRng(opts.seed || 7);
    for (let i = modTargets.length - 1; i > 0; i--) {
      const j = (rngMod() * (i + 1)) | 0;
      const tmp = modTargets[i]; modTargets[i] = modTargets[j]; modTargets[j] = tmp;
    }
    modEdges = modEdges.map((e, i) => ({ s: e.s, t: modTargets[i], type: e.type }));
  }
  const modByType = { dopamine: [], serotonin: [], octopamine: [] };
  for (const m of modEdges) if (modByType[m.type]) modByType[m.type].push(m);

  const NE = edges.length;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  const W = new Float32Array(NE), W0 = new Float32Array(NE);
  const isExc = new Uint8Array(NE), plastic = new Uint8Array(NE);
  const ntSign = new Float32Array(NE);   // +1 exc / -1 inh fast synapses
  const WS = 0.02;
  edges.forEach((e, i) => {
    src[i] = e.s; dst[i] = e.t; W0[i] = e.w;
    W[i] = e.w * (e.sign > 0 ? 1 : -1) * WS;
    isExc[i] = e.sign > 0 ? 1 : 0;
    ntSign[i] = e.sign > 0 ? 1 : -1;
    // P0: eligibility is a property of the CONTACT (co-active pre/post), not
    // of its sign. Inhibitory and excitatory synapses are both plastic; DA and
    // the other modulators are no longer frozen negative weights — they are
    // not weights at all (filtered above) and act through the third-factor
    // channel in applyLearning instead.
    plastic[i] = 1;
  });
  const modulatorCount = modEdges.length;
  const modCountByType = {
    dopamine: modByType.dopamine.length,
    serotonin: modByType.serotonin.length,
    octopamine: modByType.octopamine.length,
  };
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
  // bit-exact initial weight snapshot (weightDrift baseline: comparing against
  // a recomputed W0*sign*WS in f64 would report a ~5e-3 false floor from
  // Float32 storage rounding)
  const W_INIT = Float32Array.from(W);

  const V = new Float32Array(N), spikes = new Uint8Array(N), refac = new Uint8Array(N);
  // Closed-loop tap: live zero-copy view of the current-tick spike vector over
  // the designated motor pool (first POOL_N motor-layer neurons, fixed
  // identity — same population the rate-code/policy readouts consume). This is
  // the canonical neural→decoder interface for the FlyBody/MuJoCo embodiment
  // loop (embodiment/state_contract.js, tools/closed_loop_runner.js). READ-ONLY
  // by convention: consumers must never mutate the view; the brain advances it
  // itself in brainTick. Built once; costs one subarray header, no per-tick work.
  let MOTOR_VIEW = null;
  const trialSpikeCount = new Uint32Array(N);   // cumulative per trial (MI)
  // per-trial layer spike counts for the brain-outcome heatmap (additive)
  const layerSpikeSums = new Float64Array(layers.length);
  // P0: per-modulator activity EMAs (third-factor channels). Updated each
  // brainTick from spiking modulatory-source neurons; consumed by applyLearning.
  const modEma = { dopamine: 0, serotonin: 0, octopamine: 0 };
  const MOD_EMA_DECAY = 0.99;                // per-tick retention of modulator tone
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
  // Stage F optic input: "retinotopy" (default) drives each optic neuron by
  // its SOURCE-DERIVED hex column (p1_retinotopy.js — the JS lattice is
  // self-test-validated against the Python Stage E mapping); "legacy8bin"
  // preserves the pre-F operating point bit-for-bit (8 coarse bins; the
  // axis mislabel is documented in P1_BIOLOGY_AUDIT.md E1). The stimulus
  // function (per-particle constants) is identical in both paths — only
  // the sampling grid differs: 8 saturated bins -> ~256 occupied columns.
  // DEFAULT = "legacy8bin" (stabilization pass, 2026-09-21): the documented
  // operating point (opticDrive 0.25; "sparsest sensory regime where
  // real-vs-shuffled wiring diverges", verified by the pre-registered sweep)
  // was calibrated on the 8-bin interface. The retinotopic grid collapses
  // expected optic injection ~9x at the same drive (measured: ~8374 vs ~945
  // kicks/tick, tools/diagnose_optic_input.js A/B), which silences the
  // motor pool ratio policy (door never opens, DA = 0, plasticity = 0) —
  // an operating-point shift, not an integration defect. Retinotopy remains
  // available via { opticInput: "retinotopy" } until its own operating  // point is calibrated and pre-registered (P1_RETINOTOPY_REPORT.md follow-up).
  const opticInput = opts.opticInput || "legacy8bin";
  let columnOf = null, opticByColumn = null;
  // precompute the visual channel per optic neuron once (String(i) lookups
  // every tick are the dominant cost of the old inner loop)
  const opticChannelOf = new Int8Array(N).fill(-1);
  const opticByChannel = [[], [], [], [], [], [], [], []];
  let opticNodes = null;
  if (opticInput === "retinotopy") {
    const b = RT.buildOpticColumns(circuit);
    columnOf = b.columnOf; opticByColumn = b.byColumn; opticNodes = b.nodes;   // null when no optic layer
  } else if (opticLayer >= 0 && layers[opticLayer]) {
    for (const i of layers[opticLayer]) {
      const field = opticMap[String(i)];
      const ch = field ? Math.min(7, (field[0] * 4 | 0) + ((field[1] * 2 | 0) * 4)) : -1;
      opticChannelOf[i] = ch;
      if (ch >= 0) opticByChannel[ch].push(i);
    }
  }
  const opticLists = opticByChannel.map(a => Int32Array.from(a));

  // (Stage-3 demon observation) opt-in: the headless env's 15-channel sensor
  // vector (base 7 + obs_8 tail, appended by experiment_core readSensors when
  // the arm's demonObs flag is set) is SPLIT-injected — the base 7 keep the
  // original 7-bin whole-layer partition (same map, same rng order as the
  // OFF path), and the obs tail enters the RESERVED sub-band of input layer 0
  // with its own gain. Mirrors fly_demon_3d.html brainTick /
  // brain_worker.js exactly (browser constants: band [0.86, 1.0], gain 12).
  const demonObs = opts.demonObs === true;
  const demonObsGain = opts.demonObsGain !== undefined ? opts.demonObsGain : 12;

  // (Stage-3 demon observation) OPTIONAL 5th argument `slice` = {start, count,
  // frac}: map values[start .. start+count) across the layer index span
  // [frac[0]*len, frac[1]*len) instead of the whole layer. ABSENT (= every
  // pre-slice call) start0 = 0, bins = values.length, lo = 0, hi = layer.length,
  // so the loop body is arithmetically identical and consumes rng in exactly
  // the original order — the pre-slice input mapping, byte for byte.
  function injectLayerChannels(layerIndex, values, gain, rng, slice) {
    if (layerIndex < 0 || !values || !values.length) return;
    const layer = layers[layerIndex];
    const start0 = slice ? (slice.start | 0) : 0;
    const bins = slice ? (slice.count | 0) : values.length;
    const lo = slice && slice.frac ? Math.max(0, Math.min(layer.length, Math.floor(slice.frac[0] * layer.length))) : 0;
    const hi = slice && slice.frac ? Math.max(lo, Math.min(layer.length, Math.floor(slice.frac[1] * layer.length))) : layer.length;
    const span = hi - lo;
    if (bins <= 0 || span <= 0 || start0 + bins > values.length) return;
    for (let k = 0; k < span; k++) {
      const i = layer[lo + k];
      const channel = start0 + Math.min(bins - 1, Math.floor(k * bins / span));
      if (rng() < values[channel] * 0.5) V[i] += gain * (0.5 + rng());
    }
  }

  let opticPhase = 0;
  // P0 synaptic-delay knob: 0 = same-tick propagation (experiment-path default,
  // documented); 1 = one-tick buffered relay (matches the browser mirror).
  // Implemented via a copied source list; adds one Uint8Array, nothing else.
  const synapticDelay = opts.synapticDelay !== undefined ? (opts.synapticDelay ? 1 : 0) : 0;
  const prevSpikeSrc = synapticDelay ? new Int32Array(N) : null;
  let prevSpikeSrcN = 0;
  // ---- trained policy-gradient readout (E9 credit assignment) -------------
  // A linear softmax readout on the motor population — one weight per motor
  // neuron — trained BY REINFORCE on the dopaminergic reward: Δr w_i ∝ r·(a
  // − π). It closes the gap the rate-code readout cannot: that readout only
  // re-routes fixed connectome activity, while these weights form a direct,
  // low-variance sensor→action association trained by the same reward
  // channel. Learning stops entirely when learning=false (frozen control).
  let pg = null, phi = null, pgR = 0;     // readout state (factory scope:
  // --- KC-style sparse code for the policy readout (opt-in pgKc) ----------
  // The fly solves learned sensory->action association with the mushroom
  // body: random high-dimensional expansion of sensory drive into a sparse
  // Kenyon-cell code (12-of-200 winner-take-all), read out by plastic
  // synapses. The rate-only policy readout tunnels every sensory distinction
  // through one smoothed motor-rate scalar — measured on E10 it yields a
  // correctly-signed but tiny gradient (~0.03 P-movement per 24 episodes).
  // Feeding a sparse random-projection code to the softmax lets REINFORCE
  // associate visitor TYPE with action directly. Allocated/rng-consuming
  // ONLY when opts.pgKc — every other experiment keeps byte-identical
  // behavior and rng streams.
  let pgKcState = null;
  if (opts.policyGradient && opts.pgKc) {
    const NKCp = 200, KCAP = 12;                // expansion size, sparsity
    const wSK = new Float32Array(12 * NKCp);    // sensory ch -> KC (fixed)
    const kcRng = makeRng(((opts.seed !== undefined ? opts.seed : 7) *
                           2654435761 % 4294967291 + 1013904223) % 4294967291);
    for (let i = 0; i < wSK.length; i++) wSK[i] = kcRng() * 2 - 1;
    pgKcState = {
      wSK, NKCp, KCAP,
      drive: new Float32Array(NKCp),
      bit: new Uint8Array(NKCp),
      ids: new Uint16Array(KCAP),               // active KC ids this tick
      n: 0,
      W: new Float32Array(NKCp),                // KC -> policy (LEARNED)
    };
  }
  if (opts.policyGradient) {               // brainTick updates it every tick)
    const WPG = new Float32Array(m1 - m0);        // readout weights, zero-init
    const RNG = opts.pgRng || makeRng(opts.seed !== undefined ? opts.seed * 2654435761 % 4294967291 : 7);
    const TAU = 1;                                // softmax temperature
    // Baseline mode (opt-in pgBaseline): one REINFORCE update per decision
    // with the reward centered by an EMA baseline (unbiased variance
    // reduction) and zero-reward windows INCLUDED — in event-locked E10 an
    // r=0 window is a correct rejection (the hold kept a leak out), the
    // strongest pro-hold sample available, and the legacy pgR!==0 gate
    // discards it. Delivery is also fixed: the cores write pgReward BEFORE
    // lastPgAction() re-latches the sample, so applying at delivery time
    // pairs credit with the decision that earned it (the deferred tick
    // update pairs it with the NEXT decision — an off-by-one that corrupts
    // the gradient whenever consecutive decisions differ).
    const baseBeta = !!opts.pgBaseline;
    pg = {
      WPG, get W() { return WPG; },
      bias: 0,                           // learnable action prior: without it
                                         // P(open) is pinned to 0.5 until the
                                         // pool spikes correlate with reward —
                                         // measured: P never left 0.5 in E10
      probs: 0.5,                        // cached P(open), updated every step
      action: 0,                         // cached Bernoulli sample
      RNG, TAU,
      baseBeta, base: 0,                 // EMA reward baseline (baseBeta only)
      BASE_BETA: 0.05,
      kc: pgKcState,                     // null unless opts.pgKc
    };
  }
  function pgZ(pg, phi) {                        // policy logit
    let z = pg.bias;
    for (let i = 0; i < pg.WPG.length; i++) z += pg.WPG[i] * phi[i];
    // KC branch uses the MBON readout's own normalization (mean of active
    // weights, cf. mb[m] *= 1/nAct): raw sums across 12 active KCs inflate
    // logit variance ~sqrt(12)x, saturating the softmax and killing the
    // gradient (measured: E10 delta −0.254 ± 0.114 with raw sums).
    if (pg.kc && pg.kc.n > 0) {
      let s = 0;
      for (let n = 0; n < pg.kc.n; n++) s += pg.kc.W[pg.kc.ids[n]];
      z += s / pg.kc.n;
    }
    return z;
  }
  function pgProbs2(pg, phi) {                   // P(open) — 2-action softmax
    const e = Math.exp(clamp(pgZ(pg, phi) / pg.TAU, -20, 20));
    return e / (e + 1);                          // = 1 / (1 + e^(-z))
  }
  function pgDelta(pg, ga) {                     // REINFORCE weight move
    const d = pg.decPend;
    for (let i = 0; i < pg.WPG.length; i++)
      pg.WPG[i] = clamp(pg.WPG[i] + ga * d.phi[i], -2, 2);
    // KC mean readout: dLogit/dW_k = 1/n for each active k, so the exact
    // per-synapse move is ga/n (credit shared equally among the codeword).
    if (pg.kc && d.kc && d.kc.n > 0) {
      const gk = ga / d.kc.n;
      for (let n = 0; n < d.kc.n; n++)
        pg.kc.W[d.kc.ids[n]] = clamp(pg.kc.W[d.kc.ids[n]] + gk, -2, 2);
    }
    pg.bias = clamp(pg.bias + ga, -2, 2);        // the prior learns too
  }
  function pgProbs(W, phi, tau, bias) {            // P(open) — 2-action softmax
    let z = bias;
    for (let i = 0; i < W.length; i++) z += W[i] * phi[i];
    const e = Math.exp(clamp(z / tau, -20, 20));
    return e / (e + 1);                            // = 1 / (1 + e^(-z))
  }
  function brainTick(rng, sens, visual, motorDrive, opticScale) {
    // (Stage-3 demon observation) OFF: the ORIGINAL single call — with
    // sens.length === 7 the loop is the pre-slice 7-bin whole-layer sweep,
    // byte for byte. ON: the base 7 ride the same 7-bin partition via the
    // {start:0, count:7} slice (arithmetically identical map and rng order),
    // and the obs_8 tail enters the reserved input-layer sub-band with its
    // own gain — the headless mirror of the browser application.
    injectLayerChannels(0, sens, 12, rng, (demonObs && sens && sens.length > 7) ? { start: 0, count: 7 } : undefined);
    if (demonObs && sens && sens.length > 7)
      injectLayerChannels(0, sens, demonObsGain, rng, { start: 7, count: 8, frac: [0.86, 1.0] });
    // KC sparse code (pgKc only): random fixed expansion of the sensory
    // channels into a 12-of-200 winner-take-all codeword — the mushroom-body
    // motif. Deterministic in sens, consumes no rng: legacy streams untouched.
    if (pg && pg.kc) {
      const K = pg.kc, sL = Math.min(12, sens.length);
      for (let k = 0; k < K.NKCp; k++) {
        let a = 0;
        for (let j = 0; j < sL; j++) a += (sens[j] || 0) * K.wSK[j * K.NKCp + k];
        K.drive[k] = a;
        K.bit[k] = 0;
      }
      K.n = 0;
      for (let it = 0; it < K.KCAP; it++) {      // top-K winner-take-all
        let bi = -1, bv = -Infinity;
        for (let k = 0; k < K.NKCp; k++)
          if (!K.bit[k] && K.drive[k] > bv) { bv = K.drive[k]; bi = k; }
        if (bi < 0) break;
        K.bit[bi] = 1; K.ids[K.n++] = bi;
      }
    }
    if (opticInput === "retinotopy") {
      if (opticByColumn) {
        // Stage F retinotopic injection: per-column drive from the 800-bin
        // hex field. Same p = drive*2 decimation probability, same 4x
        // stochastic decimation and same kick (14) as the legacy path —
        // only the neuron grouping changed.
        opticPhase = (opticPhase + 1) & 3;
        for (let col = 0; col < opticByColumn.length; col++) {
          const drive = visual[col] || 0;
          if (drive <= 0) continue;
          const list = opticByColumn[col];
          const p4 = drive * 2 * opticScale > 1 ? 1 : drive * 2 * opticScale;
          for (let k = opticPhase; k < list.length; k += 4) {
            if (rng() < p4) V[list[k]] += 14;         // mean(0.5+rng) = 1.0
          }
        }
      }
    } else if (opticLists.length) {
      // legacy 8-bin injection: 4x stochastic decimation: each tick injects
      // a rotating 1/4 subset of each channel's neurons with 4x the
      // probability, preserving the mean drive while cutting rng calls.
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
    // P0 delay knob: synapticDelay=0 propagates from this tick's spikes
    // (experiment-path default, same-tick); =1 propagates from the PREVIOUS
    // tick's spike list, matching the browser mirror's _spikePrev semantics.
    if (synapticDelay) {
      for (let s2 = 0; s2 < prevSpikeSrcN; s2++) {
        const r0 = rowA[prevSpikeSrc[s2]], r1 = rowA[prevSpikeSrc[s2] + 1];
        for (let k = r0; k < r1; k++) {
          V[tgtA[k]] += wA[k];
          if (pla[k] && spikes[tgtA[k]]) coActive[coActiveN++] = k;
        }
      }
      prevSpikeSrc.set(spikeSrc.subarray(0, spikeSrcN));
      prevSpikeSrcN = spikeSrcN;
    } else {
      for (let s2 = 0; s2 < spikeSrcN; s2++) {
        const r0 = rowA[spikeSrc[s2]], r1 = rowA[spikeSrc[s2] + 1];
        for (let k = r0; k < r1; k++) {
          V[tgtA[k]] += wA[k];
          if (pla[k] && spikes[tgtA[k]]) coActive[coActiveN++] = k;
        }
      }
    }
    // P0 third-factor channels: per-modulator activity EMA from the spiking
    // sources of that modulator's contact list. Deterministic given spikes;
    // with no modulatory schema this loop never runs (gains stay 0) and the
    // legacy behavior is bit-preserved.
    if (modulatorCount) {
      modEma.dopamine *= MOD_EMA_DECAY;
      modEma.serotonin *= MOD_EMA_DECAY;
      modEma.octopamine *= MOD_EMA_DECAY;
      for (const type in modByType) {
        const list = modByType[type];
        let act = 0;
        for (let mi = 0; mi < list.length; mi++) if (spikes[list[mi].s]) act++;
        if (act) modEma[type] += act / Math.max(1, list.length) * (1 - MOD_EMA_DECAY);
      }
    }
    da.v *= 0.985;
    // via the softmax readout; the Bernoulli action is drawn from the brain's
    // OWN rng so a seed fully determines the trajectory. The core consumes
    // both the probability (telemetry/rows) and the action (valve command).
    if (pg) {
      // REINFORCE, two delivery modes:
      //  legacy (default): apply accrued credit on a later tick, paired with
      //    decPend — the decision snapshot captured by lastPgAction(). This
      //    preserves E9's byte-identical behavior.
      //  pgBaseline: the update is applied at DELIVERY time (see the set
      //    pgReward accessor below) so credit pairs with the decision that
      //    earned it even when the next sample latches within the same core
      //    step; ticks only recompute the policy here. Zero-reward windows
      //    still count: in event-locked E10 an r=0 window is a correct
      //    rejection (the hold kept a leak out), not missing data.
      if (!pg.baseBeta) {
        if (pgR !== 0 && pg.decPend && learning) {
          const ga = 0.08 * pgR * (pg.decPend.a - pg.decPend.p);
          pgDelta(pg, ga);
          pgR = 0;
        }
      }
      phi = new Float32Array(m1 - m0);           // readout features: this
      for (let i = m0; i < m1; i++) phi[i - m0] = spikes[i];   // tick's pool spikes
      pg.probs = pgProbs2(pg, phi);
      pg.action = pg.RNG() < pg.probs ? 1 : 0;
      pg.pend = { a: pg.action, p: pg.probs, phi };
    }
  }

  // ---- eligibility traces ---------------------------------------------
  // E0 decays globally; explicit traces live only where they were last
  // touched. tickCount counts calls to updateTraces; a trace's effective
  // value is E0 * tau^(tickCount - lastTouchTick[k]) below the floor.
  //
  // WINDOWS: per-crossing eligibility windows (E9 credit assignment).
  // Default [{tau: DECAY, w: 1}] reproduces the original single exponential
  // trace byte-for-byte. opts.eligibility = [{tau, w}, ...] stamps EVERY
  // co-active synapse into ALL windows at once; window i keeps its own
  // lazily-decayed sum, so effective eligibility at age a is Σ w_i tau_i^a.
  // Fast windows dominate immediate credit; slow windows keep credit alive
  // across the multi-second delay between a gate decision and the pressure
  // difference / spring work it eventually causes (the E9 credit gap: the
  // old single 0.985 trace retains only 6.7% after 3 s, the slow window
  // retains 41%).
  const E0 = 1;                       // per-window cap (was the E[i] cap)
  let tickCount = 0;
  const lastTouchTick = new Float64Array(NE).fill(-1e9);
  const activeTraces = [];            // csr k values with live (touched) traces
  const inActive = new Uint8Array(NE);
  const TRACE_FLOOR = 0.01;
  const DECAY = 0.985;
  const INC = 0.15;
  const WINDOWS = Array.isArray(opts.eligibility) && opts.eligibility.length
    ? opts.eligibility.map(x => ({ tau: x.tau !== undefined ? x.tau : 0.995,
                                   w: x.w !== undefined ? x.w : 1 }))
    : [{ tau: DECAY, w: 1 }];
  { const wSum = WINDOWS.reduce((a, x) => a + x.w, 0);
    for (const x of WINDOWS) x.w /= wSum; }        // age-0 amplitude stays INC
  const EW = WINDOWS.map(() => new Float32Array(NE));  // one lazy trace per window
  const E = EW[0];                    // window 0 — THE trace in default mode
  const WPOWS = WINDOWS.map(x => {    // small pow tables (shared shape with POW)
    const P = [1]; for (let i = 1; i <= 8; i++) P.push(P[i - 1] * x.tau); return P;
  });

  function updateTraces() {
    tickCount++;
    // co-active synapses were collected during propagation this tick
    for (let ci = 0; ci < coActiveN; ci++) {
      const k = coActive[ci];
      const ek = csrEdge[k];
      const age = tickCount - lastTouchTick[ek];
      if (lastTouchTick[ek] < 0) {
        for (let wi = 0; wi < WINDOWS.length; wi++) EW[wi][ek] = INC * WINDOWS[wi].w;
      } else {
        for (let wi = 0; wi < WINDOWS.length; wi++) {
          const p = age <= 8 ? WPOWS[wi][age] : Math.pow(WINDOWS[wi].tau, age);
          const v = EW[wi][ek] * p + INC * WINDOWS[wi].w;
          EW[wi][ek] = v < E0 ? v : E0;
        }
      }
      lastTouchTick[ek] = tickCount;
      if (!inActive[ek]) { inActive[ek] = 1; activeTraces.push(ek); }
    }
    // bounded active list: cap size, evicting the oldest entries first
    if (activeTraces.length > 40000) {
      const drop = activeTraces.splice(0, activeTraces.length - 40000);
      for (const ek of drop) { for (const A of EW) A[ek] = 0; lastTouchTick[ek] = -1e9; inActive[ek] = 0; }
    }
  }

  function applyLearning(lr) {
    const d0 = lr * da.v;
    if (Math.abs(d0) < 1e-5) return;
    // P0 third-factor gain: modulator tone scales the dopamine-gated update.
    // G = 1 + Σ_type γ_type · m_type. Defaults are structural (γ=0.15, unoptimized);
    // with no modulatory schema all m_type stay 0 => G=1 => legacy bit-exact.
    let G = 1;
    if (modulatorCount) {
      for (const type in modByType) {
        const g = MOD_GAINS[type];
        if (g && modEma[type] > 0) G += g * Math.min(1, modEma[type]);
      }
    }
    const d = d0 * G;
    for (let idx = 0; idx < activeTraces.length; idx++) {
      const ek = activeTraces[idx];
      const age = tickCount - lastTouchTick[ek];
      let e = 0;
      for (let wi = 0; wi < WINDOWS.length; wi++) {
        const p = age <= 8 ? WPOWS[wi][age] : Math.pow(WINDOWS[wi].tau, age);
        e += EW[wi][ek] * p;
      }
      if (e < TRACE_FLOOR) continue;
      const i = ek;
      if (!plastic[i]) continue;   // P0: eligibility no longer requires isExc —
                                   // inhibitory synapses are plastic too; the sign
                                   // of ΔW still follows the dopamine teaching signal.
      W[i] = clamp(W[i] + d * e * WS * W0[i], -W0[i] * WS, W0[i] * WS * 2);
      weightsDirty = true;
    }
  }

  return {
    name: shuffle ? "shuffled_connectome" : "connectome",
    _N: N, _NE: NE,
    observe(env) {
      this._sens = env.readSensors();
      // Stage F: retinotopic 800-bin field by default, computed from the
      // env's live particles with the shared stimulus constants. Envs that
      // only carry the 8-bin field (zero-field stubs, no particles) get a
      // defined lift (each legacy bin fills the hex columns inside its
      // rectangle) instead of silence.
      this._visual = opticInput === "retinotopy"
        ? (env.particles
            ? RT.readVisualFieldRetinotopy(env.particles, CH.w, CH.h, RT_NODES)
            : RT.liftLegacyField(env.readVisualField(), opticNodes))
        : env.readVisualField();
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
      // (guard) door-equipped envs (E1/E2/E8/E9...) get the pool-ratio policy
      // written to env.door.target + scored against the demon reference.
      // Actuator envs without a door (E11 ratchet: the core reads the action
      // from brain.policyProb/lastPgAction) still count the decision and run
      // dopamine-gated plasticity, but never touch env.door.
      if (!env.door) {
        decisions++;
        if (learning) { applyLearning(lr); if ((decisions & 255) === 0) syncWeights(); }
        return;
      }
      env.door.target = clamp(ratio * 40, 0, 1);
      const open = env.door.target > 0.5;
      decisions++;
      if (open === (demonDecisionFor(env, _sharedDecision) === 1)) agreeCount++;
      if (learning) { applyLearning(lr); if ((decisions & 255) === 0) syncWeights(); }
    },
    receiveFeedback(fb) {
      // Legacy E1-E8 crossing feedback ({dir, T2, v2, ...}): original q
      // formula, byte-for-byte behavior — E1-E8 results are unaffected.
      if (fb.dir !== undefined && fb.T2 !== undefined) {
        const q = fb.dir * (fb.T2 - fb.v2) / Math.max(fb.T2, 1);
        da.v = clamp(da.v + q * 0.6, -1.5, 3);
        return;
      }
      // E9 reward pathway (additive): an explicit scalar reward -> dopamine
      // teaching signal. Dopamine gates applyLearning, so this causally
      // shapes weights through the same eligibility-trace machinery as E4.
      if (fb.reward !== undefined && fb.reward !== 0) {
        da.v = clamp(da.v + fb.reward * 0.6, -1.5, 3);
      }
    },
    setLearning(on) { learning = on; if (!on) { for (const A of EW) A.fill(0); da.v = 0; pgR = 0;
                      modEma.dopamine = 0; modEma.serotonin = 0; modEma.octopamine = 0; } },
    resetForTrial() { V.fill(0); spikes.fill(0); refac.fill(0); for (const A of EW) A.fill(0); da.v = 0;
                      trialSpikeCount.fill(0); layerSpikeSums.fill(0);
                      motorRateSmooth = 0; layerRateSmooth = 0;
                      modEma.dopamine = 0; modEma.serotonin = 0; modEma.octopamine = 0;
                      agreeCount = 0; decisions = 0;
                      activeTraces.length = 0; inActive.fill(0);
                      lastTouchTick.fill(-1e9);
                      if (pg) { pgR = 0; phi = null; pg.probs = 0.5; pg.action = 0; pg.pend = null; pg.decPend = null; } },
    summary() {
      let s = 0; for (let i = m0; i < m1; i++) s += spikes[i];
      // (Stage-3 demon observation) measured per-row provenance, only when the
      // arm carries the registered flag — OFF summary objects gain NO keys.
      if (demonObs) {
        const L = layers[0].length;
        const blo = Math.max(0, Math.min(L, Math.floor(0.86 * L)));
        const bhi = Math.max(blo, Math.min(L, Math.floor(1.0 * L)));
        return { demonAgree: decisions > 0 ? agreeCount / decisions : 0,
                 motorHz: s / layers[motorLayer].length,
                 demonObsOn: true, demonObsGain,
                 obsBandLo: blo, obsBandHi: bhi, obsBandNeurons: bhi - blo };
      }
      return { demonAgree: decisions > 0 ? agreeCount / decisions : 0,
               motorHz: s / layers[motorLayer].length };
    },
    // ---- E9 live telemetry (additive; used by pressureDemonCore + 3D HUD) --
    telemetry() {
      let s = 0; for (let i = m0; i < m1; i++) s += spikes[i];
      return {
        motorActivity: motorRateSmooth,          // smoothed pool rate (Hz, EMA):
                                                 // legacy readout kept for parity
        motorRate: s,                            // raw motor-layer spikes this
                                                 // tick — the population decision
                                                 // variable E9 thresholds
        sensoryActivity: this._sens || null,     // last injected sensory vector
        spikeCount: s,                           // motor-layer spikes this tick
        dopamine: da.v,                          // current teaching signal
      };
    },
    // total absolute synaptic drift from the connectome baseline (persistence
    // metric: stays 0 under setLearning(false), grows during training)
    weightDrift() {
      let s = 0;
      for (let i = 0; i < NE; i++) s += Math.abs(W[i] - W_INIT[i]);
      return s;
    },
    get dopamine() { return da.v; },
    // ---- closed-loop read-only accessors (additive; no dynamics touched) ----
    // Current-tick spike vector over the designated motor pool (len POOL_N;
    // live view — each call returns the same backing buffer the brain writes).
    motorSpikeVector() {
      if (!MOTOR_VIEW) MOTOR_VIEW = spikes.subarray(m0, m0 + POOL_N);
      return MOTOR_VIEW;
    },
    // Designated motor-pool size (the neural vector dimension the decoder is
    // built for; a mid-episode change is a contract violation downstream).
    motorPoolSize() { return POOL_N; },
    // ---- P0 modulatory-channel accessors (third factor; null/0 with legacy
    // schema so telemetry consumers can feature-detect) ----
    get modulatorTypes() { return modulatorCount ? Object.keys(modByType) : null; },
    get modulatorTone() {
      return modulatorCount ? { dopamine: modEma.dopamine, serotonin: modEma.serotonin,
                                octopamine: modEma.octopamine }
                            : { dopamine: 0, serotonin: 0, octopamine: 0 };
    },
    get modulatorCounts() {
      return modulatorCount ? { dopamine: modCountByType.dopamine, serotonin: modCountByType.serotonin,
                                octopamine: modCountByType.octopamine }
                            : { dopamine: 0, serotonin: 0, octopamine: 0 };
    },
    // P0 synaptic-delay knob: documented extension point (see P0_AUDIT.md A2).
    // The experiment path is same-tick today; setting synapticDelay=1 buffers
    // spike sources one tick before propagation — for future biological-delay
    // work. NOT enabled by any experiment; default preserves current dynamics.
    get synapticDelay() { return synapticDelay; },
    // E9 policy-gradient readout (null unless opts.policyGradient): the core
    // drives the valve from lastPgAction() and routes each decision's reward
    // window into pgReward, closing the loop Δw_i ∝ r·(a − P_open).
    policyProb() { return pg ? pg.probs : null; },
    // The core reads the sampled action at decision time; this read is what
    // DEFINES the decision, so it latches the sample's (a, P, phi, KC code)
    // snapshot for the REINFORCE update that will consume the credit this
    // decision accrues. 60 Hz ticks in between must not touch it.
    lastPgAction() {
      if (pg) pg.decPend = { a: pg.action, p: pg.probs, phi,
                             kc: pg.kc ? { ids: Uint16Array.from(pg.kc.ids.subarray(0, pg.kc.n)), n: pg.kc.n } : null };
      return pg ? pg.action : null;
    },
    // PG readout state for HUD/tests: P(hold), sampled action, learned prior
    pgState() { return pg ? { probs: pg.probs, action: pg.action, bias: pg.bias } : null; },
    set pgReward(v) {
      if (!pg) return;
      if (pg.baseBeta) {
        // Baseline mode: credit applies NOW, against decPend — the decision
        // that earned this window (cores deliver before re-latching the next
        // sample). The EMA baseline centers the reward without biasing the
        // gradient, and zero windows flow through as correct rejections.
        if (pg.decPend && learning) {
          const ga = 0.08 * (v - pg.base) * (pg.decPend.a - pg.decPend.p);
          if (ga !== 0) pgDelta(pg, ga);
          pg.base += pg.BASE_BETA * (v - pg.base);
        }
      } else {
        pgR = v;                               // legacy deferred delivery
      }
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

// -------------------------------- 6. arm D: degree-matched random sparse ----
/**
 * Confirmatory_experiment_protocol_v1.md §5a — Maslov–Sneppen double-edge
 * rewiring of the REAL circuit edge list. Produces a random sparse graph that
 * matches the real connectivity EXACTLY in |E|, per-neuron out-degree and
 * per-neuron in-degree (each swap moves endpoints between existing edges, so
 * every degree is preserved by construction), with no self-loops and no
 * duplicate (s,t) pairs. Weights/signs/nt tags stay attached to their
 * original edges (they ride along with the edge's source). Deterministic:
 * the whole draw comes from makeRng(seed). Consumed by connectomeController
 * through opts.customEdges (arm D). REJECTS instead of forcing: a swap that
 * would create a self-loop or a duplicate is discarded, never repaired.
 *
 * Accepts a plain edge list in place of the circuit (tests use this to
 * validate the swap machinery without the full connectome).
 */
function degreeMatchedRandomEdges(circuit, opts) {
  opts = opts || {};
  // tolerate a caller passing (edgeArray, opts) or (circuit, {edges})
  let real = Array.isArray(circuit) ? circuit
    : (opts.edges || ((circuit.edges || []).filter(e => !e.modulatory)));
  if (!Array.isArray(real)) throw new Error("degreeMatchedRandomEdges: no edge list");
  const seed = opts.seed !== undefined ? opts.seed : 7;
  const rng = makeRng(seed);
  // resolve lazily: only when a rewired edge list is actually needed, so the
  // controller-construction path in Stage 1 never deep-copies the full
  // edge list twice.
  let cache = null;
  function rewired() {
    if (cache) return cache;
    const E = real.length;
    if (E < 2) { cache = real.map(e => ({ s: e.s, t: e.t, w: e.w, sign: e.sign, nt: e.nt || null })); return cache; }
    // flat working copy: s/t mutable, w/sign/nt fixed to the edge slot
    const s = new Int32Array(E), t = new Int32Array(E);
    for (let i = 0; i < E; i++) { s[i] = real[i].s; t[i] = real[i].t; }
    // duplicate detector: hash set over "s<<21|t" (validated for ids < 2^21;
    // circuit indices are well below that). Rebuilt only when a swap ACCEPTS.
    const key = (a, b) => a * 2097152 + b;
    const pairs = new Set();
    for (let i = 0; i < E; i++) pairs.add(key(s[i], t[i]));
    const attempts = opts.swapFactor !== undefined ? opts.swapFactor * E : 10 * E;
    let accepted = 0;
    for (let a = 0; a < attempts; a++) {
      // two distinct edge slots
      const i = (rng() * E) | 0; if (i === E) continue;
      let j = (rng() * (E - 1)) | 0; if (j >= i) j++;   // j != i, uniform
      const s1 = s[i], t1 = t[i], s2 = s[j], t2 = t[j];
      if (s1 === s2 || t1 === t2) continue;   // would create a parallel pair
      const newT1 = t2, newT2 = t1;
      if (newT1 === s1 || newT2 === s2) continue; // would create a self-loop
      if (pairs.has(key(s1, newT1)) || pairs.has(key(s2, newT2))) continue;
      // accept: rewire + record in the pair set atomically
      pairs.delete(key(s1, t1)); pairs.delete(key(s2, t2));
      pairs.add(key(s1, newT1)); pairs.add(key(s2, newT2));
      t[i] = newT1; t[j] = newT2;
      accepted++;
    }
    const out = new Array(E);
    for (let k = 0; k < E; k++) out[k] = { s: s[k], t: t[k], w: real[k].w, sign: real[k].sign, nt: real[k].nt || null };
    cache = out;
    return cache;
  }
  rewired._stats = () => ({ seed, attempts: opts.swapFactor !== undefined ? opts.swapFactor * real.length : 10 * real.length });
  rewired.real = real;
  rewired.rewired = rewired;
  return rewired;
}

module.exports = { classicalDemon, demonDecisionFor, randomController,
                   annController, drosophilaController, connectomeController,
                   saboteurController, neverGateController,
                   degreeMatchedRandomEdges };
