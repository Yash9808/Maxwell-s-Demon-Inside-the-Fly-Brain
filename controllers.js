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
  let edges = circuit.edges.filter(e => !e.modulatory)
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
  // axis mislabel is documented in P1_BIOLOGY_AUDIT.md E1). The stimulus  // function (per-particle constants) is identical in both paths — only
  // the sampling grid differs: 8 saturated bins -> ~256 occupied columns
  // (sparse drive, the regime the preregistered hypothesis names).
  const opticInput = opts.opticInput || "retinotopy";
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
  if (opts.policyGradient) {               // brainTick updates it every tick)
    const WPG = new Float32Array(m1 - m0);        // readout weights, zero-init
    const RNG = opts.pgRng || makeRng(opts.seed !== undefined ? opts.seed * 2654435761 % 4294967291 : 7);
    const TAU = 1;                                // softmax temperature
    pg = {
      WPG, get W() { return WPG; },
      bias: 0,                           // learnable action prior: without it
                                         // P(open) is pinned to 0.5 until the
                                         // pool spikes correlate with reward —
                                         // measured: P never left 0.5 in E10
      probs: 0.5,                        // cached P(open), updated every step
      action: 0,                         // cached Bernoulli sample
      RNG, TAU,
    };
  }
  function pgProbs(W, phi, tau, bias) {            // P(open) — 2-action softmax
    let z = bias;
    for (let i = 0; i < W.length; i++) z += W[i] * phi[i];
    const e = Math.exp(clamp(z / tau, -20, 20));
    return e / (e + 1);                            // = 1 / (1 + e^(-z))
  }
  function brainTick(rng, sens, visual, motorDrive, opticScale) {
    injectLayerChannels(0, sens, 12, rng);
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
      // REINFORCE: apply credit accrued since the last SAMPLE, paired with
      // THAT decision's own cached (action, P, features) — snapshotted by
      // lastPgAction() at decision time (decPend). Without the snapshot the
      // credit would pair with a mid-window 60 Hz sample instead of the
      // action that earned it: measured, the gradient then carries zero
      // information (E10 P(hold) never left 0.5). Learning stops when frozen.
      if (pgR !== 0 && pg.decPend && learning) {
        const ga = 0.08 * pgR * (pg.decPend.a - pg.decPend.p);
        for (let i = 0; i < pg.WPG.length; i++)
          pg.WPG[i] = clamp(pg.WPG[i] + ga * pg.decPend.phi[i], -2, 2);
        pg.bias = clamp(pg.bias + ga, -2, 2);      // the prior learns too
        pgR = 0;
      }
      phi = new Float32Array(m1 - m0);           // readout features: this
      for (let i = m0; i < m1; i++) phi[i - m0] = spikes[i];   // tick's pool spikes
      pg.probs = pgProbs(pg.WPG, phi, pg.TAU, pg.bias);
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
        if (learning) { applyLearning(0.004); if ((decisions & 255) === 0) syncWeights(); }
        return;
      }
      env.door.target = clamp(ratio * 40, 0, 1);
      const open = env.door.target > 0.5;
      decisions++;
      if (open === (demonDecisionFor(env, _sharedDecision) === 1)) agreeCount++;
      if (learning) { applyLearning(0.004); if ((decisions & 255) === 0) syncWeights(); }
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
    // DEFINES the decision, so it latches the sample's (a, P, phi) snapshot
    // for the REINFORCE update that will consume the credit this decision
    // accrues. 60 Hz ticks in between must not touch it.
    lastPgAction() {
      if (pg) pg.decPend = { a: pg.action, p: pg.probs, phi };
      return pg ? pg.action : null;
    },
    // PG readout state for HUD/tests: P(hold), sampled action, learned prior
    pgState() { return pg ? { probs: pg.probs, action: pg.action, bias: pg.bias } : null; },
    set pgReward(v) { if (pg) pgR = v; },
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
