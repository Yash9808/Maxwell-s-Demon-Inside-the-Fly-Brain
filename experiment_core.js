/**
 * experiment_core.js — shared, seeded, headless physics + measurement core.
 *
 * Ported from fly_demon_3d.html's stepParticles / tempStats / jetFire /
 * coolDown so the benchmark and the 3D GUI drive the identical environment.
 * Determinism: every stochastic decision draws from an injected PRNG.
 *
 * Chamber conventions match the 3D app (CH = 760 x 380 x 300, WALL_T = 8,
 * DOOR_GAP = 0.6, drag 0.999, elastic pair collisions on a uniform grid).
 */
"use strict";

// ----------------------------------------------------------------- PRNG
/** mulberry32 — small, fast, fully seedable. Returns a () => float in [0,1). */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ------------------------------------------------------------- constants
const CH = { w: 760, h: 380, d: 300 };
const WALL_T = 8;
const DOOR_GAP = 0.6;
const DOOR_Z_HALF = CH.d * 0.35;
const PMAX = 600;

// ------------------------------------------------------------ environment
/**
 * Environment constructor. cfg (all optional):
 *   seed        — integer PRNG seed (default 1)
 *   nParticles  — particle count (default 320)
 *   noise       — velocity noise (default 0.12)
 *   doorHeight  — max door aperture in units (default 64)
 *   jetPower    — 0..1 (default 0.55)
 *   jetAim      — 0..1 vertical aim (default 0.5)
 *   jetInterval — seconds between auto jets (default 3.5)
 */
function makeEnvironment(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const nP = cfg.nParticles || 320;
  const noise = cfg.noise !== undefined ? cfg.noise : 0.12;
  const doorHeight = cfg.doorHeight || 64;
  const jetPower = cfg.jetPower !== undefined ? cfg.jetPower : 0.55;
  const jetAim = cfg.jetAim !== undefined ? cfg.jetAim : 0.5;
  const jetInterval = cfg.jetInterval || 3.5;

  const particles = [];
  function reset() {
    particles.length = 0;
    for (let i = 0; i < nP; i++) {
      const sp = 40 + rng() * 30, an = rng() * Math.PI * 2;
      particles.push({
        x: (rng() - 0.5) * (CH.w - 40),
        y: (rng() - 0.5) * (CH.h - 20),
        z: (rng() - 0.5) * (CH.d - 40),
        vx: sp * Math.cos(an), vy: sp * Math.sin(an),
        vz: (rng() - 0.5) * sp * 0.6,
      });
    }
  }
  reset();

  const door = { target: 0, pos: 0 };
  let jetPulse = 0, autoJetT = 2.0, time = 0;

  // ---- statistics captured during the last step ------------------------
  let lastStats = { lMean2: 900 * 900, rMean2: 900 * 900, lN: 1, rN: 1 };
  const stats = {
    crossings: 0,            // door crossings this step (for energy audit)
    crossingEnergyJ: 0,      // kinetic energy transferred across the door
    jetWork: 0,              // kinetic energy injected by the jet this step
    jetWorkNet: 0,           // signed net jet work (can cool), same units
  };

  function jetFire(power) {
    const p = power !== undefined ? power : jetPower;
    const band = 90 + 120 * p;
    let work = 0, workNet = 0;
    for (const q of particles) {
      if (q.x < -CH.w / 2 + band && rng() < 0.3 * p) {
        const sp = 200 + 130 * rng() * (0.6 + 0.4 * p);
        const an = 0.15 + 0.25 * rng();
        const nvx = sp * Math.cos(an);
        const nvy = sp * Math.sin(an) * (jetAim - 0.5) * 2 + (rng() - 0.5) * 60;
        const nvz = (rng() - 0.5) * 40;
        const dv2 = nvx * nvx + nvy * nvy + nvz * nvz
                   - (q.vx * q.vx + q.vy * q.vy + q.vz * q.vz);
        if (dv2 > 0) work += 0.5 * dv2;
        workNet += 0.5 * dv2;            // signed: the jet can also cool
        q.vx = nvx; q.vy = nvy; q.vz = nvz;
      }
    }
    stats.jetWork += work;
    stats.jetWorkNet += workNet;
    jetPulse = 1;
  }

  function coolDown() {
    for (const q of particles) {
      const s = Math.hypot(q.vx, q.vy, q.vz);
      if (s > 90) { const f = 0.4; q.vx *= f; q.vy *= f; q.vz *= f; }
    }
  }

  /** Called by the controller bridge when a particle crosses the open door. */
  let onCrossing = null;   // fn(particle, dir)

  function step(dt) {
    time += dt;
    autoJetT -= dt;
    if (autoJetT <= 0) { jetFire(jetPower * 0.8); autoJetT = jetInterval; }
    jetPulse *= 0.92;

    const openHalf = doorHeight * door.pos / 2;
    stats.crossings = 0; stats.crossingEnergyJ = 0;

    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.999; p.vy *= 0.999; p.vz *= 0.999;
      if (noise > 0) {
        p.vx += (rng() - 0.5) * noise * 60;
        p.vy += (rng() - 0.5) * noise * 60;
        p.vz += (rng() - 0.5) * noise * 60;
      }
      const bx = CH.w / 2 - 4, by = CH.h / 2 - 4, bz = CH.d / 2 - 4;
      if (p.x < -bx) { p.x = -bx; p.vx = Math.abs(p.vx); }
      if (p.x > bx) { p.x = bx; p.vx = -Math.abs(p.vx); }
      if (p.y < -by) { p.y = -by; p.vy = Math.abs(p.vy); }
      if (p.y > by) { p.y = by; p.vy = -Math.abs(p.vy); }
      if (p.z < -bz) { p.z = -bz; p.vz = Math.abs(p.vz); }
      if (p.z > bz) { p.z = bz; p.vz = -Math.abs(p.vz); }
      // center wall / door
      if (Math.abs(p.x) < WALL_T + 4) {
        const inDoor = door.pos > 0.02 && Math.abs(p.y) < openHalf - DOOR_GAP
                                     && Math.abs(p.z) < DOOR_Z_HALF - DOOR_GAP;
        if (!inDoor) {
          if (p.x < 0) { p.x = -WALL_T - 4; p.vx = -Math.abs(p.vx); }
          else { p.x = WALL_T + 4; p.vx = Math.abs(p.vx); }
        }
      }
      // crossing detection
      if (door.pos > 0.2) {
        const prevX = p.x - p.vx * dt;
        if (prevX < 0 && p.x >= 0 && Math.abs(p.y) < openHalf && Math.abs(p.z) < DOOR_Z_HALF) {
          stats.crossings++; stats.crossingEnergyJ += 0.5 * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
          if (onCrossing) onCrossing(p, 1);
        } else if (prevX > 0 && p.x <= 0 && Math.abs(p.y) < openHalf && Math.abs(p.z) < DOOR_Z_HALF) {
          stats.crossings++; stats.crossingEnergyJ += 0.5 * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
          if (onCrossing) onCrossing(p, -1);
        }
      }
    }

    // pairwise elastic collisions (uniform grid, mirrors the 3D app)
    const cell = 8, gw = Math.ceil(CH.w / cell), gh = Math.ceil(CH.h / cell),
          gd = Math.ceil(CH.d / cell);
    const grid = new Map();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const gx = clamp(((p.x + CH.w / 2) / cell) | 0, 0, gw - 1);
      const gy = clamp(((p.y + CH.h / 2) / cell) | 0, 0, gh - 1);
      const gz = clamp(((p.z + CH.d / 2) / cell) | 0, 0, gd - 1);
      const key = (gz * gh + gy) * gw + gx;
      let arr = grid.get(key);
      if (!arr) { arr = []; grid.set(key, arr); }
      arr.push(i);
    }
    for (const arr of grid.values()) {
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const p = particles[arr[a]], q = particles[arr[b]];
          const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
          const d2 = dx * dx + dy * dy + dz * dz, min = 6.8;
          if (d2 > 1e-6 && d2 < min * min) {
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, ov = (min - d) / 2;
            p.x -= nx * ov; p.y -= ny * ov; p.z -= nz * ov;
            q.x += nx * ov; q.y += ny * ov; q.z += nz * ov;
            const dv = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny + (q.vz - p.vz) * nz;
            if (dv < 0) {
              p.vx += dv * nx; p.vy += dv * ny; p.vz += dv * nz;
              q.vx -= dv * nx; q.vy -= dv * ny; q.vz -= dv * nz;
            }
          }
        }
      }
    }
    // door easing
    door.pos += (door.target - door.pos) * clamp(dt * 8, 0, 1);
  }

  /** temperatures + occupancy; T = sqrt(<v^2>) * K as in the 3D app (K=1/900). */
  function tempStats() {
    let lN = 0, lS = 0, rN = 0, rS = 0;
    for (const p of particles) {
      const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
      if (p.x < 0) { lN++; lS += v2; } else { rN++; rS += v2; }
    }
    const lm = lN ? lS / lN : 1, rm = rN ? rS / rN : 1;
    lastStats = { lMean2: lm, rMean2: rm, lN, rN };
    const K = 1 / 900;
    return { Tl: Math.sqrt(lm) * K, Tr: Math.sqrt(rm) * K, lN, rN, lMean2: lm, rMean2: rm };
  }

  /** 7 sensor channels — identical semantics to readSensors() in the 3D app. */
  function readSensors() {
    const ts = tempStats();
    const fracL = ts.lN / particles.length;
    let n = 0, sSum = 0;
    const openHalf = doorHeight * door.pos / 2;
    for (const p of particles) {
      if (p.x < 10 && p.x > -80 && Math.abs(p.y) < openHalf + 40 && Math.abs(p.z) < DOOR_Z_HALF) {
        n++; sSum += Math.hypot(p.vx, p.vy, p.vz);
      }
    }
    const doorFast = n ? clamp((sSum / n - 30) / 180, 0, 1) : 0;
    return [
      clamp(ts.Tl / 40, 0, 1), clamp(ts.Tr / 40, 0, 1),
      clamp((ts.Tl - ts.Tr) / 20, -1, 1) * 0.5 + 0.5,
      clamp(fracL, 0, 1), clamp(jetPulse, 0, 1),
      doorFast, 1 - doorFast,
    ];
  }

  /** 8-bin visual field (4 horizontal x 2 vertical) — matches readVisualField(). */
  function readVisualField() {
    const field = new Array(8).fill(0);
    for (const p of particles) {
      const u = clamp((p.x + CH.w / 2) / CH.w, 0, 0.9999);
      const v = clamp((p.y + CH.h / 2) / CH.h, 0, 0.9999);
      const channel = (u * 4 | 0) + ((v * 2 | 0) * 4);
      const speed = clamp(Math.hypot(p.vx, p.vy, p.vz) / 260, 0, 1);
      field[channel] = Math.min(1, field[channel] + 0.015 + speed * 0.025);
    }
    return field;
  }

  return {
    cfg, rng, particles, door, reset, step, tempStats, readSensors,
    readVisualField, jetFire, coolDown,
    get jetPulse() { return jetPulse; },
    get time() { return time; },
    get lastStats() { return lastStats; },
    get stepStats() { return stats; },
    set onCrossing(fn) { onCrossing = fn; },
  };
}

// ---------------------------------------------------------------- metrics
const METRICS = (() => {
  /** Shannon entropy (bits) of the 8-bin horizontal x 2-bin vertical occupancy. */
  function spatialEntropy(particles) {
    const bins = new Array(8).fill(0);
    for (const p of particles) {
      const u = clamp((p.x + CH.w / 2) / CH.w, 0, 0.9999);
      const v = clamp((p.y + CH.h / 2) / CH.h, 0, 0.9999);
      bins[(u * 4 | 0) + ((v * 2 | 0) * 4)]++;
    }
    const n = particles.length;
    let H = 0;
    for (const c of bins) {
      if (c > 0) { const q = c / n; H -= q * Math.log2(q); }
    }
    return { H, bins, maxH: 3 };   // 8 bins -> max 3 bits
  }

  /** Sorting entropy: bits recovered by replacing the mixed distribution with
   *  the left/right speed histograms (shannon entropy of speed classes). */
  function sortingEntropy(particles) {
    // two speed classes per side: fast (>= median-speed proxy 120 u/s) / slow
    const sides = [[0, 0], [0, 0]]; // [left][fast,slow] / [right][fast,slow]
    for (const p of particles) {
      const fast = Math.hypot(p.vx, p.vy, p.vz) >= 120 ? 0 : 1;
      sides[p.x < 0 ? 0 : 1][fast]++;
    }
    const n = particles.length;
    const H = (a, b) => {
      const t = a + b; if (!t) return 0;
      let h = 0;
      for (const c of [a, b]) if (c > 0) { const q = c / t; h -= q * Math.log2(q); }
      return h * (t / n);
    };
    const mixed = H(sides[0][0] + sides[1][0], sides[0][1] + sides[1][1]);
    const sorted = H(sides[0][0], sides[0][1]) + H(sides[1][0], sides[1][1]);
    return { mixed, sorted, delta: mixed - sorted };  // delta >= 0 when sorted
  }

  /** Empirical mutual information (bits) between a binary neural summary
   *  (activity array, thresholded at thr) and particle speed classes. */
  function mutualInformation(activity, particles, thr) {
    const n = Math.min(activity.length, particles.length);
    if (n < 8) return 0;
    // joint counts: [active][fast]
    let a0f0 = 0, a0f1 = 0, a1f0 = 0, a1f1 = 0;
    for (let i = 0; i < n; i++) {
      const a = activity[i] > (thr !== undefined ? thr : 0) ? 1 : 0;
      const f = Math.hypot(particles[i].vx, particles[i].vy, particles[i].vz) >= 120 ? 1 : 0;
      if (a === 0 && f === 0) a0f0++;
      else if (a === 0 && f === 1) a0f1++;
      else if (a === 1 && f === 0) a1f0++;
      else a1f1++;
    }
    const tot = a0f0 + a0f1 + a1f0 + a1f1;
    if (!tot) return 0;
    const mi = (c) => { const q = c / tot; return q > 0 ? q * Math.log2(q) : 0; };
    const H_joint = -(mi(a0f0) + mi(a0f1) + mi(a1f0) + mi(a1f1));
    const pA1 = (a1f0 + a1f1) / tot, pF1 = (a0f1 + a1f1) / tot;
    const H_A = -(pA1 > 0 ? pA1 * Math.log2(pA1) : 0) - (pA1 < 1 ? (1 - pA1) * Math.log2(1 - pA1) : 0);
    const H_F = -(pF1 > 0 ? pF1 * Math.log2(pF1) : 0) - (pF1 < 1 ? (1 - pF1) * Math.log2(1 - pF1) : 0);
    return Math.max(0, H_A + H_F - H_joint);
  }

  /** Binary KL divergence (bits) between policy p (controller) and q (demon). */
  function klDivergence(pOpen, qOpen) {
    const eps = 1e-6;
    const p = clamp(pOpen, eps, 1 - eps), q = clamp(qOpen, eps, 1 - eps);
    return p * Math.log2(p / q) + (1 - p) * Math.log2((1 - p) / (1 - q));
  }

  /** Landauer bound (Joules) for erasing `bits` at temperature T_kelvin. */
  const KB = 1.380649e-23;
  function landauerJoules(bits, TKelvin) { return KB * (TKelvin || 300) * Math.LN2 * bits; }

  /** Maximum reversible work obtainable by coupling the two chamber halves
   *  as finite heat reservoirs at kinetic temperatures Th ~ sqrt(<v^2>):
   *      W_max = U_hot * (1 - Tc/Th)
   *  in sim energy units (multiply by SIM_J = 1e-21 for Joules). U_hot is the
   *  total kinetic energy of the hotter side. This is the thermodynamic value
   *  the demon's sorting creates (upper bound; no engine is implemented). */
  function extractableWorkSimJ(particles) {
    let uL = 0, uR = 0, lm2 = 0, rm2 = 0, lN = 0, rN = 0;
    for (const p of particles) {
      const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
      if (p.x < 0) { uL += 0.5 * v2; lm2 += v2; lN++; }
      else { uR += 0.5 * v2; rm2 += v2; rN++; }
    }
    lm2 = lN ? lm2 / lN : 1; rm2 = rN ? rm2 / rN : 1;
    if (lm2 > rm2) return uL * (1 - Math.sqrt(rm2 / lm2));
    return uR * (1 - Math.sqrt(lm2 / rm2));
  }

  return { spatialEntropy, sortingEntropy, mutualInformation, klDivergence,
           landauerJoules, extractableWorkSimJ };
})();

// ----------------------------------------------------------- trial engine
/**
 * Runs a full benchmark. cfg:
 *   seed, nSeeds, trialsTrain (1000), trialsTest (200),
 *   dt (1/60), episodeSeconds (60), maxCrossingsPerTrial (50),
 *   controllers: { key: factory(rng, env, cfg) -> controller }
 *   connectomeFactory: optional fn(rng) -> connectome controller factory
 *   onTrial(cond, phase, t, nTrials, seedIdx, nSeeds) — optional progress hook
 * A controller implements:
 *   observe(env)                 — optional pre-step read
 *   step(dt)                     — decide + act; MUST set env.door.target
 *   receiveFeedback(rewardInfo)  — optional learning signal
 *   summary() -> object          — logged after each trial
 *   resetForTrial()              — optional per-trial reset
 */
function runBenchmark(cfg) {
  const defaults = {
    seed: 1, nSeeds: 10,
    trialsTrain: 1000, trialsTest: 200,
    dt: 1 / 60, episodeSeconds: 60, maxCrossingsPerTrial: 50,
    tKelvin: 300,
  };
  cfg = Object.assign({}, defaults, cfg);
  const out = { cfg, conditions: {} };

  for (const [key, factory] of Object.entries(cfg.controllers)) {
    const trials = [];
    for (let s = 0; s < cfg.nSeeds; s++) {
      const seed = cfg.seed + s * 101;
      const ph = cfg._physics ? (cfg._physics(s, cfg.nSeeds) || {}) : {};
      const env = makeEnvironment({ seed,
                                    nParticles: ph.nParticles !== undefined ? ph.nParticles : cfg.nParticles,
                                    noise: ph.noise !== undefined ? ph.noise : cfg.noise,
                                    doorHeight: cfg.doorHeight });
      const controller = factory(makeRng(seed ^ 0x5f5f), env, cfg);
      const rec = { seed, trials: [] };

      const phaseDefs = [
        { phase: "train", n: cfg.trialsTrain, learning: true },
        { phase: "test", n: cfg.trialsTest, learning: false },
      ];
      for (const ph of phaseDefs) {
        if (controller.setLearning) controller.setLearning(ph.learning);
        for (let t = 0; t < ph.n; t++) {
          if (cfg.onTrial) cfg.onTrial(key, ph.phase, t, ph.n, s, cfg.nSeeds);
          env.reset();
          env.door.pos = 0; env.door.target = 0;
          if (controller.resetForTrial) controller.resetForTrial();
          const tr = { seed, phase: ph.phase, trial: t, steps: 0,
                       crossings: 0, goodCrossings: 0, badCrossings: 0,
                       energyJ: 0, jetWorkJ: 0,
                       demonAgree: 0, demonDecisions: 0,
                       openFraction: 0, dTfinal: 0, sortEntropy: 0, spatialH: 0,
                       miNeural: 0,
                       workInJ: 0, measuredBits: 0, erasureCostJ: 0,
                       extractableJ: 0, landauerRatio: 0 };
          let openSteps = 0, lastDoorTarget = 0;
          const SIM_J = 1e-21;          // 1 sim energy unit in Joules
          const T_ENV = 300;            // demon's ambient erasure temperature (K)
          env.onCrossing = (p, dir) => {
            tr.crossings++;
            tr.measuredBits += 1;       // good/bad evaluation = 1 memory bit
            const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
            const T2 = env.lastStats.lMean2;
            const good = dir * (T2 - v2) / Math.max(T2, 1) > 0;
            if (good) tr.goodCrossings++; else tr.badCrossings++;
            if (controller.receiveFeedback) {
              controller.receiveFeedback({ good, dir, v2, T2, kind: "crossing" });
            }
          };
          // good:bad ratio (null when no bad crossings — avoids Infinity in JSON)
          const goodBadRatio = () => tr.badCrossings > 0
            ? tr.goodCrossings / tr.badCrossings : null;
          Object.defineProperty(tr, "goodBadRatio", {
            get: goodBadRatio, enumerable: true, configurable: true,
          });
          const maxSteps = Math.round(cfg.episodeSeconds / cfg.dt);
          for (let st = 0; st < maxSteps; st++) {
            if (controller.observe) controller.observe(env);
            controller.step(cfg.dt, env);
            env.step(cfg.dt);
            tr.steps++;
            tr.energyJ += env.stepStats.crossingEnergyJ;
            tr.jetWorkJ += env.stepStats.jetWork;
            tr.workInJ += env.stepStats.jetWorkNet * SIM_J;
            if (env.door.target !== lastDoorTarget) {
              tr.measuredBits += 1;     // decision-state flip = 1 memory bit
              lastDoorTarget = env.door.target;
            }
            if (env.door.pos > 0.5) openSteps++;
            if (controller.crossingsNeeded && tr.crossings >= cfg.maxCrossingsPerTrial) break;
          }
          const ts = env.tempStats();
          const se = METRICS.sortingEntropy(env.particles);
          const sp = METRICS.spatialEntropy(env.particles);
          tr.dTfinal = ts.Tl - ts.Tr;
          tr.sortEntropy = se.delta;
          tr.spatialH = sp.H;
          tr.openFraction = openSteps / tr.steps;
          // thermodynamic budget: extractable work of the final state vs the
          // Landauer erasure bill for the demon's memory traffic
          tr.extractableJ = METRICS.extractableWorkSimJ(env.particles) * SIM_J;
          tr.erasureCostJ = METRICS.landauerJoules(tr.measuredBits, T_ENV);
          tr.landauerRatio = tr.erasureCostJ > 0
            ? tr.extractableJ / tr.erasureCostJ : null;
          if (controller.neuralActivity && controller.particleSample) {
            tr.miNeural = METRICS.mutualInformation(
              controller.neuralActivity(), controller.particleSample(env));
          }
          if (controller.layerSpikeRates) tr.layerRates = controller.layerSpikeRates();
          if (controller.fireVec) tr.fireVec = controller.fireVec();
          if (controller.summary) Object.assign(tr, controller.summary());
          rec.trials.push(tr);
          if (cfg.onTrialData) cfg.onTrialData(key, ph.phase, tr);
        }
      }
      trials.push(rec);
    }
    out.conditions[key] = summarizeCondition(trials);
    out.conditions[key]._raw = trials;
  }
  return out;
}

/** Per-condition aggregate: early/late train ratios, test metrics, CIs. */
function summarizeCondition(seedRuns) {
  const blockAvg = (trials, from, to, field) => {
    const vals = [];
    for (const run of trials) {
      const seg = run.trials.slice(from, to)
        .map(t => t[field]).filter(v => v !== null && v !== undefined && Number.isFinite(v));
      if (seg.length) vals.push(seg.reduce((a, b) => a + b, 0) / seg.length);
    }
    return meanCI(vals);
  };
  const nTrain = seedRuns[0].trials.filter(t => t.phase === "train").length;
  const firstBlock = Math.max(1, Math.floor(nTrain / 5));
  return {
    earlyAgreement: blockAvg(seedRuns, 0, firstBlock, "demonAgree"),
    lateAgreement: blockAvg(seedRuns, nTrain - firstBlock, nTrain, "demonAgree"),
    testAgreement: blockAvg(seedRuns, nTrain, Infinity, "demonAgree"),
    earlyGoodBadRatio: blockAvg(seedRuns, 0, firstBlock, "goodBadRatio"),
    lateGoodBadRatio: blockAvg(seedRuns, nTrain - firstBlock, nTrain, "goodBadRatio"),
    testGoodBadRatio: blockAvg(seedRuns, nTrain, Infinity, "goodBadRatio"),
    testSortEntropy: blockAvg(seedRuns, nTrain, Infinity, "sortEntropy"),
    testDT: blockAvg(seedRuns, nTrain, Infinity, "dTfinal"),
    testOpenFraction: blockAvg(seedRuns, nTrain, Infinity, "openFraction"),
    testMiNeural: blockAvg(seedRuns, nTrain, Infinity, "miNeural"),
    testEnergyJ: blockAvg(seedRuns, nTrain, Infinity, "energyJ"),
    testWorkInJ: blockAvg(seedRuns, nTrain, Infinity, "workInJ"),
    testExtractableJ: blockAvg(seedRuns, nTrain, Infinity, "extractableJ"),
    testErasureCostJ: blockAvg(seedRuns, nTrain, Infinity, "erasureCostJ"),
    testLandauerRatio: blockAvg(seedRuns, nTrain, Infinity, "landauerRatio"),
    testMeasuredBits: blockAvg(seedRuns, nTrain, Infinity, "measuredBits"),
  };
}

function meanCI(vals) {
  const n = vals.length;
  if (!n) return { mean: 0, ci: 0, n: 0 };
  const m = vals.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: m, ci: 0, n };
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
  return { mean: m, ci: 1.96 * sd / Math.sqrt(n), n };  // 95% CI (normal approx)
}

module.exports = { makeRng, makeEnvironment, METRICS, runBenchmark, meanCI,
                   CH, WALL_T, DOOR_GAP, DOOR_Z_HALF, clamp };
