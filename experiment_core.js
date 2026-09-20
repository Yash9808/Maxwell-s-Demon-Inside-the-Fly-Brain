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

// ============================================================ apparatus sims
// Self-contained apparatus experiments (E9 pressure engine, E10 Smoluchowski
// trapdoor, E11 Feynman ratchet & pawl). Each returns the same shape as
// runBenchmark ({ conditions: { key: { label, summary } } }) so the existing
// worker/queue/plots/provenance pipeline consumes them unchanged. Rows carry
// per-episode apparatus metrics; cfg.onState streams compact live state for
// the 3D apparatus scenes (throttled inside these sims).

/** Maxwell-boundary thermal walls: with probability THERMO_P a molecule
 *  bouncing off a wall is re-emitted with a fresh Maxwell velocity at the
 *  bath temperature (the chamber is in contact with the lab at T_ENV).
 *  Without this, per-side temperatures are frozen initial fluctuations that
 *  never equilibrate and every "never-open" control shows phantom dT. */
function _thermoWalls(rng, parts, dt) {
  const SPEED0 = 86;                     // matches the initial speed distribution
  for (const p of parts) {
    if (rng() < 0.0008 * dt * 60) {
      let u = 0, v = 0;
      while (!u) u = rng(); while (!v) v = rng();
      const g1 = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      u = 0; v = 0;
      while (!u) u = rng(); while (!v) v = rng();
      const g2 = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      u = 0; v = 0;
      while (!u) u = rng(); while (!v) v = rng();
      const g3 = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const s = SPEED0 / Math.sqrt(3);
      p.vx = s * g1; p.vy = s * g2; p.vz = s * g3;
    }
  }
}

function _apparatusPart(rng, x0, x1, H, D) {
  const sp = 60 + rng() * 50, an = rng() * Math.PI * 2;
  return { x: x0 + rng() * (x1 - x0), y: (rng() - 0.5) * H * 0.85,
           z: (rng() - 0.5) * D * 0.85,
           vx: sp * Math.cos(an), vy: sp * Math.sin(an), vz: (rng() - 0.5) * sp * 0.5 };
}
/** Side stats: counts, per-particle mean kinetic energy, and volume-aware
 *  ideal-gas pressure proxy (n*<v2>/V). */
function _apparatusSideStats(parts, vl, vr) {
  let nl = 0, nr = 0, el = 0, er = 0;
  for (const p of parts) {
    const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
    if (p.x < 0) { nl++; el += v2; } else { nr++; er += v2; }
  }
  const tl = nl ? el / nl : 0, tr = nr ? er / nr : 0;
  return { nl, nr, tl, tr,
           pl: nl ? el / vl : 0, pr: nr ? er / vr : 0,
           dT: tr - tl };
}

/** Canonical two-condition valve reference (extracted verbatim from the old
 *  inline E9 rule): find the fastest molecule in the approach box moving
 *  right; open iff its speed exceeds 95 u/s. Used ONLY for demonAgreement,
 *  wrong-action scoring and the classical reference variant. */
function classicalValveDecision(parts, DH, thr) {
  let best = null;
  for (const q of parts) {
    if (q.x < 0 && q.x > -60 && Math.abs(q.z) < DH / 2 && Math.abs(q.y) < DH / 2) {
      const v2q = q.vx * q.vx + q.vy * q.vy + q.vz * q.vz;
      if (!best || v2q > best.v2) best = { v2: v2q, vx: q.vx };
    }
  }
  return (best && best.v2 > thr * thr && best.vx > 0) ? 1 : 0;
}

/**
 * E9 sensory adapter. The demon-fly can only sense what a molecule-sized
 * demon at the valve could physically measure locally, plus the two bulk
 * chamber pressures its membrane can feel. All channels are normalized to
 * roughly [0,1] (ch7 signed [-1,1]) so the same gain works across variants.
 *
 *   ch0 local fast molecules   — L-side molecules in the valve approach box
 *                                (|y|,|z| < DH/2, x in [-4-LOCAL_BOX, -4])
 *                                with speed > VFAST
 *   ch1 local slow molecules   — same box, speed < VSLOW
 *   ch2 local density          — molecules in the approach box / nLocalMax
 *   ch3 left pressure          — P_L = E_L/V_L (ideal-gas kinetic pressure)
 *   ch4 right pressure         — P_R = E_R/V_R (piston-side volume)
 *   ch5 pressure difference    — (P_R - P_L) / (P_R + P_L), signed [-1,1]
 *   ch6 valve aperture         — current valve.pos (0 shut .. 1 open)
 *   ch7 piston velocity        — signed piston.v / vMax, [-1,1]
 *
 * NOTE: ch0/ch1 encode the demon's *local* measurement (what the classical
 * rule keys on); ch3-ch5 are bulk state a demon-fly could sense through its
 * cuticle. Nothing here reads the global parts[] array blindly — the valve
 * decision can only be driven by these 8 numbers.
 */const E9_SENSOR_DOC = {
  n: 8,
  VFAST: 110,        // u/s — "fast" molecules (> 110)
  VSLOW: 75,         // u/s — "slow" molecules (< 75)
  LOCAL_BOX: 120,    // u — approach half-depth on the left of the valve
  NLOCAL_MAX: 14,    // molecules in the approach box -> ch2 saturates
  P_SCALE: 60,       // kinetic pressure (P ~ 0.01) -> ch3/ch4 ~ 0.6 at operating point
  VPISTON_MAX: 2,    // u/s piston speed (typical ~0.5) -> ch7 ~ [-1,1]
  SLOT_HALF: 120,    // u — valve slot half-aperture (DH/2); sensor box y/z span
};
function senseE9(parts, valve, pist, sideStats, doc) {
  const d = doc || E9_SENSOR_DOC;
  const half = d.LOCAL_BOX;
  let nFast = 0, nSlow = 0, nLocal = 0;
  for (const q of parts) {
    // approach box: left chamber, within LOCAL_BOX of the wall plane,
    // inside the valve slot's y-z footprint (the demon's line of sight)
    if (q.x < -4 - half || q.x > -4) continue;
    if (Math.abs(q.y) > d.SLOT_HALF || Math.abs(q.z) > d.SLOT_HALF) continue;
    nLocal++;
    const s2 = q.vx * q.vx + q.vy * q.vy + q.vz * q.vz;
    const sp = Math.sqrt(s2);
    if (sp > d.VFAST) nFast++; else if (sp < d.VSLOW) nSlow++;
  }
  return [
    Math.min(1, nFast / 6),
    Math.min(1, nSlow / 6),
    Math.min(1, nLocal / d.NLOCAL_MAX),
    Math.min(1, sideStats.pl * d.P_SCALE),
    Math.min(1, sideStats.pr * d.P_SCALE),
    Math.max(-1, Math.min(1, (sideStats.pr - sideStats.pl) /
                             Math.max(1e-9, sideStats.pr + sideStats.pl))),
    valve.pos,
    Math.max(-1, Math.min(1, pist.v / d.VPISTON_MAX)),
  ];
}

/** E9 · Pressure Demon — the demon's speed-selective valve builds a thermal
 *  pressure difference that does mechanical work on a piston against a
 *  spring. Variants: demon_speed (classical rule, reference), demon_random,
 *  never_open, and the fly-brain conditions demon_neural / demon_frozen
 *  whose valve command comes from an injected neural controller
 *  (cfg.brainFactory) through the explicit interface below:
 *
 *    environment -> senseE9() 8ch -> brain.observe/step -> action 0|1
 *      -> valve.target -> valve.pos -> particle crossings -> P_R/P_L
 *      -> piston -> work -> reward components -> brain.receiveFeedback
 *      -> dopamine -> eligibility traces -> weights (persist across trials)
 *
 *  The classical speed rule is retained VERBATIM as classicalValveDecision()
 *  — it is the reference policy used for demonAgreement, never the valve
 *  driver of the neural conditions. Physics below (ballistics, thermal walls,
 *  valve slot, side stats, piston integrator, spring work) is unchanged. */
function pressureDemonCore(cfg) {
  cfg = cfg || {};
  // physical state persists ACROSS episodes within a variant (one gas, one
  // piston); the reward/learning loop is what the episodes measure
  const seedTag = cfg.seedTag !== undefined ? cfg.seedTag : 1;   // row seed tag (multi-seed batch runner)
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const L = 900, H = 420, D = 420, DH = 240, PEXT = 160;   // chamber + piston run
  const nP = cfg.nParticles || 260;
  const trials = cfg.trials || 24;
  const trainTrials = Math.max(0, Math.min(trials, cfg.trainTrials !== undefined ? cfg.trainTrials : Math.floor(trials / 2)));
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  // Spring constant matched to the kinetic-pressure units of this chamber
  // (P = Σv²/V ~ 0.01): ΔP ~ 0.005 must yield O(1-10 u) piston travel. The
  // old value (12) made the spring 1000x stiffer than any achievable ΔP —
  // the piston could never move and spring work was dead. Dynamics unchanged:
  // F = (P_R - P_L) - SPRING*x, same integrator, same caps.
  const SPRING = 0.002, DRAG = 0.35, PMASS = 0.02;
  const SIM_J = 1e-21, T_ENV = 300, kB_J = 1.38e-23;
  // ---- reward coefficients (documented; nothing hidden in a magic number) --
  const REWARD_DOC = {
    wWork: 0.5,        // per step: +wWork * (useful work rate this step / W_NORM)
    wSelect: 0.3,      // per crossing: +wSelect if it helps build ΔP, else -wSelect
    wWrong: 0.2,       // per decision: -wWrong if the action mismatches the
                       //   reference policy AND the action is useless (opening
                       //   with no fast approacher, or closing while one waits)
    W_NORM: 0.02,      // spring-work units per step that count as "full" reward
    hysteresis: 0.08,  // brain action must exceed/below this band to flip (clamps chatter)
  };
  const PG_CREDIT_GAMMA = 0.99;   // per-step discount of the PG readout credit
                                  // window (mean lifetime ~1.7 s at 60 Hz)
  // ---- Phase-3 sweep knobs (additive; defaults reproduce Phase-1 exactly) --
  // rewardCfg: overrides of REWARD_DOC entries (e.g. {wWork:0.4, wSelect:0.4});
  //   name tags rows for sweep provenance. Unset => Phase-1 coefficients.
  // decisionInterval: seconds between valve decisions (Phase-1 = 0.25 s).
  //   "2x decision frequency" = 0.125 s, "1/2x" = 0.5 s. Physics timestep,
  //   integrator and episode duration are untouched — only how often the
  //   brain is consulted. rewardRegime/decisionS are recorded on every row.
  const RDOC = (cfg.rewardCfg && typeof cfg.rewardCfg === "object")
    ? Object.assign({}, REWARD_DOC, cfg.rewardCfg) : REWARD_DOC;
  const rewardRegime = (cfg.rewardCfg && cfg.rewardCfg.name) || "R0";
  const DECISION_S = cfg.decisionInterval !== undefined ? +cfg.decisionInterval : 0.25;
  const hasBrain = typeof cfg.brainFactory === "function";
  const variants = [
    { key: "demon_neural", mode: "neural", label: "fly-brain valve (learning)" },
    { key: "demon_frozen", mode: "frozen", label: "fly-brain valve (weights frozen)" },
    { key: "demon_speed", mode: "speed", label: "selective valve (classical reference)" },
    { key: "demon_random", mode: "random", label: "random valve (control)" },
    { key: "never_open", mode: "never", label: "never-open valve (control)" },
  ];
  if (!hasBrain) variants.splice(0, 2);   // ablation: classical-only runs stay intact
  // Optional subset filter (Phase-2 batch validation): run only the named
  // variants. RNG/variant-geometry seeds still derive from the FULL list
  // index, so a subset run reproduces the same-seed trajectory of a full run
  // exactly — subsets change runtime, never the science.
  if (Array.isArray(cfg.variants) && cfg.variants.length) {
    const keep = variants.filter(v => cfg.variants.includes(v.key));
    if (keep.length) variants.length = 0, variants.push(...keep);
  }
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 + PEXT - 20, H, D));
    const BURN = Math.round((cfg.burnSeconds !== undefined ? cfg.burnSeconds : 10) / dt);    // equilibration before measuring
    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };
    const pist = { x: 0, v: 0 };
    let workU = 0, crossings = 0, bits = 0, opened = 0;
    let dTsum = 0, dPsum = 0, dN = 0;
    // per-episode metric accumulators (reset below; physical state persists)
    let epWorkU = 0, epOpenSteps = 0, epCross = 0, epGood = 0, epBad = 0;
    let epDecisions = 0, epAgree = 0, epBits = 0, epWrong = 0;
    let epRewWork = 0, epRewSel = 0, epRewPen = 0, epRewTotal = 0;
    let epPgAcc = 0;              // reward accrued since the last PG decision
    let epSensSum = 0, epMotorSum = 0, epSpikeSum = 0, epDaSum = 0, epDaPeak = 0, epWChange = 0;
    let lastSens = new Array(8).fill(0), lastMotor = 0, lastAction = 0;
    let lastPopen = 0;              // last sampled P(open) from the PG readout
    let lastActionSample = 0;       // the Bernoulli action the readout sampled
    // neural decision variables: fast EMA of motor-layer population rate vs a
    // slow baseline (self-calibrating; see brainTick note in controllers.js)
    let mFast = 0, mSlow = 0, mInit = 0;
    let brain = null;
    if (v.mode === "neural" || v.mode === "frozen") {
      if (!hasBrain) throw new Error("demon_neural/demon_frozen require cfg.brainFactory");
      // one brain per seed: cross-seed CI then reflects seed-to-seed variance
      // of gas + connectome draw, not a shared learned trajectory
      brain = cfg.brainFactory(seedTag);
    }
    const rows = [];
    for (let t = 0; t < trials; t++) {
      const phase = t < trainTrials ? "train" : "test";
      // training: plasticity enabled for the neural variant; test: frozen.
      // A separate frozen control freezes from trial 0 — its rows prove the
      // learning effect is not an artifact of exposure.
      if (brain && brain.setLearning) brain.setLearning(v.mode === "neural" && phase === "train");
      // per-episode reset of neural STATE (weights persist inside the brain)
      if (brain && brain.resetForTrial) brain.resetForTrial();
      mFast = 0; mSlow = 0; mInit = 0;             // decision-variable reset
      epWorkU = 0; epOpenSteps = 0; epCross = 0; epGood = 0; epBad = 0;
      epDecisions = 0; epAgree = 0; epBits = 0; epWrong = 0;
      epRewWork = 0; epRewSel = 0; epRewPen = 0; epRewTotal = 0;
      epPgAcc = 0;              // reward-credit window never spans trials
      epSensSum = 0; epMotorSum = 0; epSpikeSum = 0; epDaSum = 0; epDaPeak = 0; epWChange = 0;
      dTsum = 0; dPsum = 0; dN = 0;   // episode-window pressure averages
      let openSteps = 0, epCrossTotal = 0;
      for (let st = 0; st < maxSteps; st++) {
        // piston geometry: right-chamber volume shrinks as the piston advances
        const vr = (PEXT + L / 2 + 8 - pist.x) * H * D;
        const vl = (L / 2 + 8) * H * D;
        const crossingsBefore = crossings;
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.x < -L / 2) { p.x = -L / 2; p.vx = Math.abs(p.vx); }
          if (p.x > L / 2 + PEXT - pist.x) { p.x = L / 2 + PEXT - pist.x; p.vx = -Math.abs(p.vx); }
          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          _thermoWalls(vRng, [p], dt);
          // center wall across the whole y-z face; the valve slot
          // [-DH/2, DH/2] x [-DH/2, DH/2] opens per the demon's rule:
          // speed = one-way L->R rectifier, random = two-way opening
          // (no information, no rectification), never = always shut.
          // NEURAL conditions: passable is one-way whenever the brain holds
          // valve.target = 1 — the crossing itself is pure physics, unchanged.
          const xPrev = p.x - p.vx * dt;
          if ((p.x >= 0) !== (xPrev >= 0)) {
            const inSlot = Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2;
            const passable = valve.pos > 0.6 && (v.mode === "random" ? true : p.vx > 0);
            if (inSlot && passable) {
              crossings++; epCross++; epCrossTotal++;          // through the valve
            } else {
              p.x = xPrev; p.vx = -p.vx;       // reflect off the wall
            }
          }
        }
        // ---- decision (the ONLY place valve.target is written) -------------
        valve.dwell -= dt;
        if (valve.dwell <= 0) {
          bits++; epBits++;                // 1 decision bit written to memory
          let action = 0, classicalAction = 0;
          const sPre = _apparatusSideStats(parts, vl, vr);
          const sens = senseE9(parts, valve, pist, sPre, E9_SENSOR_DOC);
          if (v.mode === "random") {
            action = vRng() < 0.3 ? 1 : 0;
          } else if (v.mode === "speed") {
            action = classicalValveDecision(parts, DH, 95);   // reference policy
          } else if (v.mode === "never") {
            action = 0;
          } else {
            // NEURAL: the fly brain, driven ONLY by the 8 normalized sensors.
            if (brain.observe) brain.observe({ readSensors: () => sens,
              readVisualField: () => new Array(8).fill(0),
              door: valve, particles: parts });
            if (brain.step) brain.step(dt * 4, { readSensors: () => sens,
              readVisualField: () => new Array(8).fill(0),
              door: valve, particles: parts });
            const tel = brain.telemetry ? brain.telemetry() : {};
            lastMotor = tel.motorRate !== undefined ? tel.motorRate : lastMotor;
            if (tel.sensoryActivity) lastSens = tel.sensoryActivity;
            if (tel.spikeCount !== undefined) epSpikeSum += tel.spikeCount;
            if (tel.dopamine !== undefined) {
              epDaSum += tel.dopamine;
              if (tel.dopamine > epDaPeak) epDaPeak = tel.dopamine;
            }
            if (tel.weightDrift !== undefined) epWChange = tel.weightDrift;
            // direct persistence metric: Σ|Δw| from the connectome baseline
            if (brain.weightDrift) epWChange = brain.weightDrift();
            // ---- population-code decision --------------------------------
            // mFast tracks the evoked motor-layer rate (~1 s); mSlow is its
            // slow baseline (~15 s). The valve opens while the brain's motor
            // population is driven ABOVE ITS OWN baseline — no absolute
            // threshold to tune, deterministic given seed + neural state.
            const m = lastMotor;
            if (!mInit) { mInit = 1; mSlow = m; }   // seed baseline from tick 1
            mFast += (m - mFast) * 0.35;
            mSlow += (m - mSlow) * 0.02;
            const drive = mFast - mSlow - RDOC.hysteresis * (mFast + mSlow + 1e-6);
            action = drive > 0 ? 1 : 0;
            // ---- trained policy-gradient readout (credit assignment) -----
            // When the brain exposes a readout (opts.policyGradient), the
            // action is SAMPLED from P(open | motor population) instead of
            // the fixed rate-code threshold. Before this decision the brain
            // received the rewards accrued SINCE the last decision, so the
            // REINFORCE update uses a contiguous, per-decision credit
            // window (Δw ∝ r·(a − P_open)). The rate-code decision is still
            // computed first — telemetry and lastMotor bookkeeping unchanged.
            const popenFn = brain.policyProb ? brain.policyProb() : null;
            if (popenFn !== null && popenFn !== undefined) {
              brain.pgReward = epPgAcc;            // credit window -> REINFORCE
              epPgAcc = 0;
              lastPopen = popenFn;
              const sampled = brain.lastPgAction ? brain.lastPgAction() : null;
              action = sampled !== null && sampled !== undefined
                ? sampled                          // the brain's own draw
                : (vRng() < popenFn ? 1 : 0);      // fallback draw
              lastActionSample = action;
            }
            epMotorSum += m;
            epSensSum += lastSens.reduce((a, x) => a + x, 0) / 8;
          }
          classicalAction = classicalValveDecision(parts, DH, 95);
          valve.classical = classicalAction;     // for the live HUD readout
          if (action !== valve.prev) { valve.flips++; valve.prev = action; }
          if (action) opened++;
          // ---- action scoring (ALL variants, same rule) ---------------------
          // A wrong action: opening with no fast molecule waiting, or staying
          // closed while one waits with local density to pass. Brain variants
          // additionally receive the penalty as a dopamine teaching signal;
          // non-brain controls are scored identically but teach nothing.
          const fastWaiting = sens[0] > 0.15;   // ch0: fast molecule approaching
          const wrong = (action === 1 && !fastWaiting) || (action === 0 && fastWaiting && sens[2] > 0.1);
          if (wrong) epWrong++;
          if (brain && brain.receiveFeedback) {
            if (wrong) {
              epRewPen -= RDOC.wWrong;
              epRewTotal -= RDOC.wWrong;
              brain.receiveFeedback({ reward: -RDOC.wWrong,
                                      kind: "e9_penalty" });
            }
            // decision record (zero-reward: bookkeeping + reference action)
            brain.receiveFeedback({
              reward: 0,
              good: fastWaiting && action === 1,   // legacy field parity
              kind: "e9_decision", action, classicalAction, fastWaiting,
            });
          }
          epDecisions++;
          if (action === classicalAction) epAgree++;
          lastAction = action;
          valve.target = action;
          valve.dwell = DECISION_S;   // Phase-1 default 0.25 s; sweep knob
        }
        valve.pos += (valve.target - valve.pos) * Math.min(1, dt * 10);
        if (valve.pos > 0.5) openSteps++;
        // piston: driven by the volume-aware pressure difference
        const s = _apparatusSideStats(parts, vl, vr);
        if (st >= BURN) { dTsum += s.dT; dPsum += (s.pr - s.pl) / Math.max(1e-9, s.pr + s.pl); dN++; }
        const F = (s.pr - s.pl) - SPRING * pist.x;
        pist.v += ((F / PMASS) - DRAG * pist.v) * dt;
        pist.x += pist.v * dt;
        if (pist.x < 0) { pist.x = 0; pist.v = 0; }
        if (pist.x > PEXT * 0.9) { pist.x = PEXT * 0.9; pist.v = 0; }
        const dW = Math.max(0, SPRING * pist.x * pist.v * dt);   // work into the spring
        workU += dW;
        // ---- per-step reward accrual (work + selection) -------------------
        if (brain && brain.receiveFeedback) {
          const rWork = RDOC.wWork * Math.min(1, dW / RDOC.W_NORM);
          const nCross = crossings - crossingsBefore;
          const dPr = s.pr - s.pl;
          let rSel = 0;
          if (nCross > 0) {
            // a crossing helps iff it moves toward building ΔP (L->R while
            // P_R <= P_L, or R->L while P_R > P_L — the valve only allows L->R)
            const helps = (dPr <= 0) ? 1 : 0;
            rSel = RDOC.wSelect * (helps ? 1 : -1) * nCross;
            if (helps) epGood += nCross; else epBad += nCross;
          }
          const rTotal = rWork + rSel;
          epRewWork += rWork; epRewSel += rSel; epRewTotal += rTotal;
          if (rTotal !== 0) {
            brain.receiveFeedback({ reward: rTotal,
              kind: "e9_step", work: dW, crossings: nCross, dP: dPr });
            // PG readout credit accrues as a DISCOUNTED return-to-go since
            // the last sampled action (gamma ~ 1.7 s effective window at
            // 60 Hz): the work/selection consequences of a gate decision
            // unfold over seconds, so a hard one-dwell window would credit
            // the readout with only the immediate slice.
            epPgAcc = epPgAcc * PG_CREDIT_GAMMA + rTotal;
          }
        }
        epWorkU += dW;
        if (st >= BURN) epOpenSteps += (valve.pos > 0.5 ? 1 : 0);
        if (cfg.onState && st >= BURN && ((st - BURN) % 8) === 0) {
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "pressure", t: (t * episode) + (st - BURN) / maxSteps, trials, seed: seedTag,
                        pos, valve: valve.pos, piston: pist.x,
                        tl: s.tl, tr: s.tr, pl: s.pl, pr: s.pr,
                        dT: s.dT, workU, bits, crossings, cond: v.key,
                        phase, trial: t, trainTrials,
                        sensors: (v.mode === "neural" || v.mode === "frozen")
                          ? senseE9(parts, valve, pist, s, E9_SENSOR_DOC).map(x => Math.round(x * 1000) / 1000) : null,
                        motorActivity: lastMotor, action: valve.target,
                        classical: valve.classical || 0,
                        reward: epRewTotal, dopamine: epDaPeak,
                        demonAgree: epDecisions ? epAgree / epDecisions : 0,
                        landauerJ: bits * kB_J * T_ENV,          // theoretical minimum
                        netWorkJ: workU - bits * kB_J * T_ENV,
                        extractionRate: bits > 0 ? workU / (bits * kB_J * T_ENV) : 0 });
        }
      }
      const vlF = (L / 2 + 8) * H * D;
      const vrF = (PEXT + L / 2 + 8 - pist.x) * H * D;
      const ts = _apparatusSideStats(parts, vlF, vrF);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;   // theoretical minimum
      const workJ = workU * SIM_J;
      // workJ is the chamber-cumulative spring work (monotone across trials);
      // workJEp isolates THIS episode's work for per-episode learning curves
      const workJEp = epWorkU * SIM_J;
      rows.push({ condition: v.key, phase, trial: t, seed: seedTag,
                  rewardRegime, decisionS: DECISION_S,
                  steps: maxSteps, crossings: epCross,
                  openFraction: epOpenSteps / Math.max(1, maxSteps - BURN),
                  dPfinal: dN ? dPsum / dN : 0,
                  dTfinal: dN ? dTsum / dN : ts.dT,
                  pistonX: pist.x, pistonV: pist.v,
                  pistonVelocity: Math.abs(pist.v),
                  workJ, workJEp, netWorkJ: workJ - erasureCostJ, valveFlips: valve.flips,
                  demonAgree: epDecisions ? epAgree / epDecisions : 0,
                  decisionAccuracy: epDecisions ? 1 - epWrong / epDecisions : 0,
                  goodCrossings: epGood, badCrossings: epBad,
                  success: epGood > epBad && epWorkU > 0 ? 1 : 0,
                  reward: epRewTotal, rewardPerSec: epRewTotal / episode,
                  rewardWork: epRewWork, rewardSelection: epRewSel, rewardPenalty: epRewPen,
                  measuredBits: bits, sensorDecisionBits: epBits,
                  motorActivity: lastMotor, motorRateMean: epBits ? epMotorSum / epBits : 0,
                  sensoryActivity: epBits ? epSensSum / epBits : 0,
                  spikeRate: epSpikeSum / Math.max(1, epBits),
                  dopamine: epDaPeak, dopamineMean: epBits ? epDaSum / epBits : 0,
                  weightDrift: epWChange,
                  sortEntropy: 0, spatialH: 0, miNeural: 0,
                  erasureCostJ });
      // ---- Brain outcome telemetry (same contract as E1-E8 rows) ----------
      // The FAFB brain already exposes cumulative per-trial counters; one
      // snapshot at episode end IS the episode mean (both counters reset in
      // resetForTrial). layerRates feeds the region heatmap/3D anatomy cards,
      // fireVec feeds the per-neuron anatomy maps, MI reuses the E1 metric.
      const row = rows[rows.length - 1];
      if (brain) {
        if (brain.layerSpikeRates) {
          const lr = brain.layerSpikeRates();
          if (lr && Object.keys(lr).length) row.layerRates = lr;
        }
        if (brain.fireVec) {
          const fv = brain.fireVec();
          if (fv && fv.vec) row.fireVec = fv;
        }
        if (brain.neuralActivity && brain.particleSample) {
          row.miNeural = METRICS.mutualInformation(
            brain.neuralActivity(), brain.particleSample({ particles: parts }));
        }
      }
      if (cfg.onTrialData) cfg.onTrialData(v.key, phase, row);
    }
    const avg = (f) => rows.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.length;
    const testRows = rows.filter(r => r.phase === "test");
    const avgT = (f) => testRows.length
      ? testRows.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / testRows.length : avg(f);
    conditions[v.key] = {
      label: v.label,
      summary: {
        testWorkJ: { mean: avgT("workJ"), ci: 0, n: rows.length },
        testDT: { mean: avgT("dTfinal"), ci: 0, n: rows.length },
        testOpenFraction: { mean: avgT("openFraction"), ci: 0, n: rows.length },
        testPistonX: { mean: avgT("pistonX"), ci: 0, n: rows.length },
        testMiNeural: { mean: 0, ci: 0, n: rows.length },
        testReward: { mean: avgT("reward"), ci: 0, n: rows.length },
        testAccuracy: { mean: avgT("decisionAccuracy"), ci: 0, n: rows.length },
        testDemonAgree: { mean: avgT("demonAgree"), ci: 0, n: rows.length },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "pressure" };
}

/** E10 · Smoluchowski Trapdoor — a spring trapdoor opened only by molecule
 *  impacts from the left. Passage is genuinely gated by the door angle, so a
 *  heavier door (slower to open) passes fewer molecules; the gas still relaxes
 *  to equilibrium — no demon, no net work. */
function smoluchowskiCore(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const L = 760, H = 300, D = 300, DH = 120;
  const nP = cfg.nParticles || 220;
  const trials = cfg.trials || 20;
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const OPEN_THRESH = 0.22;
  const variants = [
    { key: "trapdoor_light", mass: 0.02, label: "light trapdoor" },
    { key: "trapdoor_heavy", mass: 0.12, label: "heavy trapdoor" },
  ];
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 - 20, H, D));
    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0;
    const BURN = Math.round(6 / dt);     // 6 s equilibration before counting
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let epL = 0, epR = 0;
      const angSamples = [];
      for (let st = 0; st < maxSteps; st++) {
        door.vel += (-26 * door.ang - 1.6 * door.vel) * dt;   // spring + hinge damping
        for (const p of parts) {
          const wasLeft = p.x < 0;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.x < -L / 2) { p.x = -L / 2; p.vx = Math.abs(p.vx); }
          if (p.x > L / 2) { p.x = L / 2; p.vx = -Math.abs(p.vx); }
          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          // center wall across the whole face; the door slot opens only in
          // [-DH/2, DH/2] x [-DH/2, DH/2] while the flap is lifted. Impacts
          // from the left kick it open; while open BOTH directions pass — a
          // Smoluchowski flap rectifies nothing on its own.
          const xPrev = p.x - p.vx * dt;
          if ((p.x >= 0) !== (xPrev >= 0)) {
            const inSlot = Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2;
            _thermoWalls(vRng, [p], dt);
            if (inSlot && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
              if (st >= BURN && door.ang > OPEN_THRESH) { crossLR++; epL++; }
              else { p.x = xPrev; p.vx = -p.vx; }
            } else if (st >= BURN && inSlot && p.vx < 0 && door.ang > OPEN_THRESH) {
              crossRL++; epR++;
            } else {
              p.x = xPrev; p.vx = -p.vx;
            }
          }
        }
        door.ang = Math.max(0, Math.min(1.1, door.ang + door.vel * dt));
        if ((st & 15) === 0) angSamples.push(door.ang);
        if (cfg.onState && (st % 20) === 0) {
          const s = _apparatusSideStats(parts, L * H * D / 2, L * H * D / 2);
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "trapdoor", t: (t * episode) + st / maxSteps, trials,
                        pos, door: door.ang, doorVel: door.vel,
                        tl: s.tl, tr: s.tr,
                        nl: s.nl, nr: s.nr, crossLR, crossRL, cond: v.key });
        }
      }
      const s = _apparatusSideStats(parts, L * H * D / 2, L * H * D / 2);
      const imb = (s.nl - s.nr) / Math.max(1, s.nl + s.nr);
      const fl = angSamples.length > 2
        ? Math.sqrt(angSamples.reduce((a, x) => a + x * x, 0) / angSamples.length) : 0;
      rows.push({ condition: v.key, phase: "train", trial: t, seed: 1,
                  steps: maxSteps, crossings: epL + epR,
                  crossingRate: (epL + epR) / episode,
                  crossLR: epL, crossRL: epR,
                  leftCount: s.nl, rightCount: s.nr,
                  densityDiff: imb,
                  trapdoorAngle: door.ang,
                  trapdoorFluctuation: fl,
                  demonAgree: 0,
                  directionalBias: epL + epR > 0 ? (epL - epR) / (epL + epR) : 0,
                  measuredBits: 0, sortEntropy: 0, spatialH: 0, miNeural: 0,
                  dTfinal: s.tr - s.tl,
                  openFraction: 0, pistonX: 0, workJ: 0, erasureCostJ: 0, netWorkJ: 0 });
      if (cfg.onTrialData) cfg.onTrialData(v.key, "train", rows[rows.length - 1]);
    }
    const avg = (f) => rows.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.length;
    conditions[v.key] = {
      label: v.label,
      summary: {
        testDT: { mean: avg("densityDiff"), ci: 0, n: rows.length },
        testOpenFraction: { mean: avg("crossingRate"), ci: 0, n: rows.length },
        testPistonX: { mean: avg("trapdoorFluctuation"), ci: 0, n: rows.length },
        testMiNeural: { mean: 0, ci: 0, n: rows.length },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "trapdoor" };
}

/** E11 · Feynman Ratchet & Pawl — event-rate model with exact detailed
 *  balance: forward slips come from the hot vanes (rate ∝ Th), backward
 *  steps need the cold-bath pawl lift against the load bias. At Th = Tc the
 *  rates balance and net rotation is zero — the machine cannot extract work
 *  from a single bath; with Th > Tc it turns forward and lifts the load. */
function feynmanRatchetCore(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const trials = cfg.trials || 20;
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const TEETH = 24, STEP = (Math.PI * 2) / TEETH;
  const EPS = 0.10;                        // pawl lift barrier (arb. units)
  const LOADQ = 6.95;                      // load -> energy bias: load*STEP*LOADQ
  const GAMMA = 3.0;
  const variants = [
    { key: "ratchet_gradient", Th: 2.0, Tc: 1.0, load: 0.055, label: "Th > Tc (extracts work)" },
    { key: "ratchet_equilibrium", Th: 1.0, Tc: 1.0, load: 0.055, label: "Th = Tc (equilibrium)" },
    { key: "ratchet_heavy_load", Th: 2.0, Tc: 1.0, load: 0.0825, label: "gradient + heavy load" },
  ];
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    let ang = 0, fwd = 0, rev = 0, qh = 0, qc = 0;
    let velSm = 0, wobAng = 0;
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let epF = 0, epR = 0, ang0 = ang;
      for (let st = 0; st < maxSteps; st++) {
        // thermal rattle of the wheel (visual + fluctuation metric)
        wobAng = wobAng * 0.96 + (vRng() - 0.5) * v.Th * 0.02;
        // event probabilities with detailed balance:
        const pFwd = Math.min(0.5, GAMMA * v.Th * dt);
        const pBack = Math.min(0.5, GAMMA * v.Tc *
                               Math.exp(-(EPS - v.load * STEP * LOADQ) / v.Tc) * dt);
        const r = vRng();
        let dAng = 0;
        if (r < pFwd) { dAng = STEP; fwd++; epF++; qh += EPS; }
        else if (r < pFwd + pBack) { dAng = -STEP; rev++; epR++; qc += EPS; }
        ang += dAng;
        velSm += (dAng / dt - velSm) * Math.min(1, dt * 6);
        if (cfg.onState && (st % 20) === 0) {
          cfg.onState({ kind: "ratchet", t: (t * episode) + st / maxSteps, trials,
                        ang: ang + wobAng, angSnap: ang, vel: velSm,
                        teeth: TEETH, fwd, rev, th: v.Th, tc: v.Tc,
                        load: v.load, qh, qc, cond: v.key });
        }
      }
      const net = ang - ang0;
      const entropy = qh / v.Th - qc / v.Tc;
      const work = Math.max(0, net) * v.load;
      rows.push({ condition: v.key, phase: "train", trial: t, seed: 1,
                  steps: maxSteps, crossings: fwd + rev,
                  ratchetAngle: ang, angularVelocity: velSm,
                  torque: v.load, forwardSteps: fwd, reverseSteps: rev,
                  netRotation: ang, netPerEpisode: net,
                  thermalFluctuation: Math.abs(wobAng),
                  workJ: work * 1e-21, heatJ: (qh + qc) * 1e-21,
                  demonAgree: 0,
                  entropyProduction: entropy,
                  efficiency: qh > 0 ? work / qh : 0,
                  measuredBits: 0, sortEntropy: 0, spatialH: 0, miNeural: 0,
                  dTfinal: net, openFraction: 0, pistonX: 0,
                  workJ: work * 1e-21, erasureCostJ: 0, netWorkJ: work * 1e-21 });
      if (cfg.onTrialData) cfg.onTrialData(v.key, "train", rows[rows.length - 1]);
    }
    const avg = (f) => rows.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.length;
    conditions[v.key] = {
      label: v.label,
      summary: {
        testDT: { mean: avg("netPerEpisode"), ci: 0, n: rows.length },
        testOpenFraction: { mean: avg("efficiency"), ci: 0, n: rows.length },
        testMiNeural: { mean: 0, ci: 0, n: rows.length },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "ratchet" };
}

function meanCI(vals) {
  const n = vals.length;
  if (!n) return { mean: 0, ci: 0, n: 0 };
  const m = vals.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: m, ci: 0, n };
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
  return { mean: m, ci: 1.96 * sd / Math.sqrt(n), n };  // 95% CI (normal approx)
}

/**
 * Apparatus learning-curve aggregation across seeds (E9 multi-seed batch).
 * Block-averages numeric row fields per condition/phase, converts per-seed
 * block values into a cross-seed mean + 95% CI (meanCI), and continues test
 * blocks after train blocks so curves read left-to-right through both phases.
 *
 * rows: flat apparatus trial rows ({condition, phase, trial, seed, ...});
 * B:    block size in episodes (per seed, per phase).
 * Each point carries <field>: {mean, ci, n} plus a scalar <field>_mean for
 * the legacy series code; dT/agree/energyJ aliases follow the same scheme.
 */
function apparatusCurve(rows, B) {
  B = Math.max(1, B | 0);
  const byKey = new Map();
  for (const r of rows || []) {
    if (!byKey.has(r.condition)) byKey.set(r.condition, []);
    byKey.get(r.condition).push(r);
  }
  const out = [];
  for (const [cond, rrows] of byKey) {
    const fields = new Set();
    for (const r of rrows) for (const f of Object.keys(r))
      if (typeof r[f] === "number" && Number.isFinite(r[f]) &&
          f !== "seed" && f !== "trial" && f !== "steps") fields.add(f);
    const seeds = [...new Set(rrows.map(r => r.seed !== undefined ? r.seed : 1))].sort((a, b) => a - b);
    let blockOffset = 0;
    for (const phase of ["train", "test"]) {
      const prows = rrows.filter(r => (r.phase || "train") === phase);
      if (!prows.length) continue;
      const acc = {};                       // field -> Map(block -> [per-seed means])
      for (const f of fields) acc[f] = new Map();
      let bCount = 0;
      for (const sd of seeds) {
        const srows = prows.filter(r => (r.seed !== undefined ? r.seed : 1) === sd);
        if (!srows.length) continue;
        const nb = Math.max(1, Math.floor(srows.length / B));
        bCount = Math.max(bCount, nb);
        for (let b = 0; b < nb; b++) {
          const seg = srows.slice(b * B, (b + 1) * B);
          if (!seg.length) continue;
          for (const f of fields) {
            let s = 0, n = 0;
            for (const r of seg) { const v = r[f]; if (Number.isFinite(v)) { s += v; n++; } }
            if (n) { if (!acc[f].has(b)) acc[f].set(b, []); acc[f].get(b).push(s / n); }
          }
        }
      }
      for (let b = 0; b < bCount; b++) {
        const pt = { cond, block: blockOffset + b, phase };
        for (const f of fields) {
          const st = meanCI(acc[f].get(b) || []);
          pt[f] = st;                 // {mean, ci, n} — CI band renderers
          pt[f + "_mean"] = st.mean;  // scalar for the legacy series code
        }
        if (acc.dTfinal && acc.dTfinal.has(b)) pt.dT = pt.dTfinal;
        if (acc.demonAgree && acc.demonAgree.has(b)) pt.agree = pt.demonAgree;
        if (acc.workJEp && acc.workJEp.has(b)) pt.energyJ = pt.workJEp;        // E9: per-episode work
        else if (acc.workJ && acc.workJ.has(b)) pt.energyJ = pt.workJ;         // E10/E11: cumulative work
        out.push(pt);
      }
      blockOffset += bCount;
    }
  }
  return out;
}

module.exports = { makeRng, makeEnvironment, METRICS, runBenchmark, meanCI,
                   apparatusCurve,
                   pressureDemonCore, smoluchowskiCore, feynmanRatchetCore,
                   CH, WALL_T, DOOR_GAP, DOOR_Z_HALF, clamp };
