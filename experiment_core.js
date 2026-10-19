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
// NOTE: this file must stay require()-free — the smoke suite executes its
// source in a hermetic determinism sandbox (tests/run_smoke.js S7-S10) that
// forbids module loads. Stage F keeps the retinotopy coupling in
// controllers.js (which owns the require edge to p1_retinotopy.js).
const WALL_T = 8;
const DOOR_GAP = 0.6;
const DOOR_Z_HALF = CH.d * 0.35;
const PMAX = 600;

const DEMON_STATES = ["WATCH", "ATTEND", "HOLD", "STRIKE", "RECOIL"];   // DemonGatekeeper FSM states (frozen order of the obs one-hot)

// ------------------------------------------------- demon-observation FSM -----
/** Headless replica of the browser DemonGatekeeper FSM (fly_demon_3d.html)
 *  reduced to the state the obs_* encoder can see. Driven ONLY by two event
 *  kinds the headless core already owns:
 *    onDoorRegime(cmd, open) — cmd = door.target > 0.5, open = door.pos > 0.6;
 *                              open→HOLD / cmd→ATTEND / else→WATCH, ignored
 *                              while STRIKE/RECOIL (events own the state);
 *    onCrossing(q, sp)       — good (q>0) → STRIKE, bad → RECOIL; impulse
 *                              mag = min(1,|q|)·min(1,sp/160) scaled by the
 *                              browser constants (STRIKE 140, RECOIL 90,
 *                              recoil cap 180); scalar speed decays ×(1−dt·3.5)
 *                              and recovers below 12 u/s into doorOpen ?
 *                              HOLD : WATCH. That is exactly the browser's
 *                              velocity decay with the direction-dependence
 *                              (pure geometry) factored out.
 *  No rng, no wall clock, no sim writes — a pure event transducer. Reset
 *  per trial/episode (browser's resetToPost on dataset switch).
 */
function makeDemonFsm() {
  const S = {
    state: "WATCH",        // WATCH | ATTEND | HOLD | STRIKE | RECOIL
    seq: 0,                // increments on every behavioral transition
    simTime: 0,            // integrated simulation seconds — never wall clock
    lastActionT: -1,       // simTime of the last state transition (-1 = none yet)
    vel: 0,                // scalar speed shadow of the browser's kick decay
    doorOpen: false,       // remembered open flag for the recovery target
    crossGood: 0, crossBad: 0,
    rolling: [],           // last-20 crossing valences (browser chemKeeperStats.recent)
  };
  function setState(s) { if (S.state !== s) { S.state = s; S.seq++; S.lastActionT = S.simTime; } }
  function onDoorRegime(cmd, open) {
    S.doorOpen = open;
    if (S.state === "STRIKE" || S.state === "RECOIL") return;   // events own the state until recovery
    if (open)      setState("HOLD");
    else if (cmd)  setState("ATTEND");
    else           setState("WATCH");
  }
  function onCrossing(q, sp) {
    const good = q > 0;
    S.crossGood += good ? 1 : 0; S.crossBad += good ? 0 : 1;
    S.rolling.push(good ? 1 : 0);
    if (S.rolling.length > 20) S.rolling.shift();
    const mag = Math.min(1, Math.abs(q)) * Math.min(1, sp / 160);   // 0..1 bounded
    if (mag <= 0) return;                                           // zero impulse: no behavioral kick
    if (good) { setState("STRIKE");  S.vel = 140 * mag; }
    else      { setState("RECOIL");  S.vel = Math.min(90 * mag, 180); }
  }
  function step(dt) {
    S.simTime += dt;
    if (S.state === "STRIKE" || S.state === "RECOIL") {
      S.vel *= Math.max(0, 1 - dt * 3.5);    // browser recovery law (scalar form)
      if (S.vel < 12) setState(S.doorOpen ? "HOLD" : "WATCH");
    }
  }
  function reset() {
    S.state = "WATCH"; S.seq++; S.simTime = 0; S.lastActionT = -1;
    S.vel = 0; S.doorOpen = false;
    S.crossGood = 0; S.crossBad = 0; S.rolling.length = 0;
  }
  return { S, onDoorRegime, onCrossing, step, reset };
}

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

  // (Stage-3 demon observation arm, opt-in) cfg.demonObs = true extends the
  // 7-channel sensor vector with the 8 obs_* features of
  // fly_demon_3d.html demonObsVector() — EXACT ordering: one-hot FSM state
  // (WATCH/ATTEND/HOLD/STRIKE/RECOIL), timeSinceAction (2 s clamp), goodRate
  // (rolling-20 crossing valences, 0.5 prior) and gateCmd = door.target.
  // The FSM is a DETERMINISTIC headless replica of DemonGatekeeper: its only
  // inputs are (a) the door regime (door.target > 0.5 command / door.pos > 0.6
  // open — the same edge table onDoorRegime uses) and (b) door-crossing
  // events with q = dir*(T2−v2)/max(T2,1) (T2 = lastStats.lMean2 — the same
  // valence the runner scores) and sp = particle speed (60 u/s fallback),
  // impulse mag = min(1,|q|)·min(1,sp/160), scalar speed decay ×(1−dt·3.5)
  // recovering below 12 u/s. It consumes NO rng and reads NO wall clock, so
  // with the flag OFF nothing below exists and the environment is exactly
  // the pre-slice machine, bit for bit.
  let demonObsFsm = null;
  if (!!cfg.demonObs) demonObsFsm = makeDemonFsm();

  const particles = [];

  const door = { target: 0, pos: 0 };
  let jetPulse = 0, autoJetT = 2.0, time = 0;

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
    if (demonObsFsm) demonObsFsm.reset();   // fresh episode = fresh FSM (browser: resetToPost on dataset switch)
  }

  reset();

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
          // (Stage-3 demon observation) same valence the browser demon sees:
          // q = dir*(T2−v2)/max(T2,1) with T2 = lastStats.lMean2 (LEFT mean v²),
          // sp = crossing speed with the browser's 60 u/s non-finite fallback.
          if (demonObsFsm) {
            const dq = (lastStats.lMean2 - (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz))
                     / Math.max(lastStats.lMean2, 1);   // dir = +1 (L→R)
            const dsp = Math.hypot(p.vx, p.vy, p.vz);
            demonObsFsm.onCrossing(dq, Number.isFinite(dsp) && dsp > 1e-9 ? dsp : 60);
          }
          if (onCrossing) onCrossing(p, 1);
        } else if (prevX > 0 && p.x <= 0 && Math.abs(p.y) < openHalf && Math.abs(p.z) < DOOR_Z_HALF) {
          stats.crossings++; stats.crossingEnergyJ += 0.5 * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
          // (Stage-3 demon observation) same valence the browser demon sees:
          // q = dir*(T2−v2)/max(T2,1) with T2 = lastStats.lMean2 (LEFT mean v²),
          // sp = crossing speed with the browser's 60 u/s non-finite fallback.
          if (demonObsFsm) {
            const dq = -(lastStats.lMean2 - (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz))
                     / Math.max(lastStats.lMean2, 1);   // dir = −1 (R→L)
            const dsp = Math.hypot(p.vx, p.vy, p.vz);
            demonObsFsm.onCrossing(dq, Number.isFinite(dsp) && dsp > 1e-9 ? dsp : 60);
          }
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
    // (Stage-3 demon observation) the browser feeds DemonGatekeeper.onDoorRegime
    // once per frame with (door.target > 0.5, door.pos > 0.6) — the headless
    // step plays that frame: integrate (sim clock + strike/recoil decay and
    // recovery), then the regime feed. No rng, no sim writes.
    if (demonObsFsm) {
      demonObsFsm.step(dt);
      demonObsFsm.onDoorRegime(door.target > 0.5, door.pos > 0.6);
    }
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
    const base = [
      clamp(ts.Tl / 40, 0, 1), clamp(ts.Tr / 40, 0, 1),
      clamp((ts.Tl - ts.Tr) / 20, -1, 1) * 0.5 + 0.5,
      clamp(fracL, 0, 1), clamp(jetPulse, 0, 1),
      doorFast, 1 - doorFast,
    ];
    // (Stage-3 demon observation, opt-in) OFF: this function returns the SAME
    // 7-array it always did — no code path below executes. ON: the same 7 base
    // values, then the obs_8 tail in the EXACT demonObsVector() ordering
    // (fly_demon_3d.html): one-hot FSM state (WATCH/ATTEND/HOLD/STRIKE/RECOIL),
    // timeSinceAction = clamp((simTime − last transition)/2 s, 0, 1) falling
    // back to 1 before any transition, goodRate = mean of the rolling-20
    // crossing valences with cumulative fallback and a 0.5 prior, gateCmd =
    // door.target clamped into 0..1. No rng is consumed.
    if (demonObsFsm) {
      const o = demonObsFsm.S;
      const tot = o.crossGood + o.crossBad;
      const goodRate = o.rolling.length
        ? o.rolling.reduce((a, b) => a + b, 0) / o.rolling.length
        : (tot ? o.crossGood / tot : 0.5);
      const oh = [0, 0, 0, 0, 0];
      const si = DEMON_STATES.indexOf(o.state);
      oh[si < 0 ? 0 : si] = 1;
      return base.concat(
        oh,
        o.lastActionT < 0 ? 1 : clamp((o.simTime - o.lastActionT) / 2, 0, 1),
        goodRate,
        clamp(door.target, 0, 1),
      );
    }
    return base;
  }

  /** 8-bin visual field (4 horizontal x 2 vertical) — matches readVisualField().
   *  Stage F: the 800-bin retinotopic variant is computed by the CONSUMER
   *  (connectomeController via p1_retinotopy.js) from env.particles + CH,
   *  because this file must stay require()-free (see note at top). */
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
      // (guard) particleSample cycles a too-short particle list; an EMPTY list
      // yields undefined entries (E11 ratchet has no particles) - treat them
      // as not-fast so MI degrades to 0 instead of throwing.
      const p = particles[i];
      const f = p && Math.hypot(p.vx, p.vy, p.vz) >= 120 ? 1 : 0;
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
 *   onStepProgress(cond, phase, t, nTrials, step, maxSteps, seedIdx, nSeeds) —
 *     optional intra-trial heartbeat, called every ~256 sim steps (~4.3 sim-
 *     seconds); lets hosts surface liveness during long neural-controller
 *     episodes. Keep the implementation cheap: it runs inside the hot loop.
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
  if (cfg.seedSpecs !== undefined &&
      (!Array.isArray(cfg.seedSpecs) || cfg.seedSpecs.length !== cfg.nSeeds))
    throw new Error("seedSpecs must contain exactly one entry per nSeeds run");
  const out = { cfg, conditions: {} };
  const phaseDefs = [];
  if (cfg.trialsPre > 0) phaseDefs.push({ phase: "pre", n: cfg.trialsPre, learning: false,
                                            episodeSeconds: cfg.preEpisodeSeconds });
  phaseDefs.push({ phase: "train", n: cfg.trialsTrain, learning: true });
  if (cfg.trialsTest > 0) phaseDefs.push({ phase: "test", n: cfg.trialsTest, learning: false });
  if (cfg.trialsPost > 0) phaseDefs.push({ phase: "post", n: cfg.trialsPost, learning: false });

  // Stage-1 frozen pre-baseline (protocol §10): a declared frozen pre phase
  // must carry its frozenPreSeconds; the core stamps every pre row with
  // frozenPre: true so downstream consumers can verify the freeze contract
  // without trusting the caller's phase name.
  const FROZEN_PRE_PHASE = "pre";
  const frozenPreSec = cfg.frozenPreSeconds !== undefined ? cfg.frozenPreSeconds : null;

  for (const [key, factory] of Object.entries(cfg.controllers)) {
    const trials = [];
    for (let s = 0; s < cfg.nSeeds; s++) {
      const scheduled = cfg.seedSpecs && cfg.seedSpecs[s] || {};
      const seed = scheduled.environmentSeed !== undefined
        ? scheduled.environmentSeed : cfg.seed + s * 101;
      const networkSeed = scheduled.networkSeed !== undefined ? scheduled.networkSeed : seed;
      const topologySeed = scheduled.topologySeed !== undefined ? scheduled.topologySeed : networkSeed;
      const seedSpec = Object.assign({ runId: "seed_" + (s + 1) }, scheduled,
                                     { environmentSeed: seed, networkSeed, topologySeed });
      const ph = cfg._physics ? (cfg._physics(s, cfg.nSeeds) || {}) : {};
      const env = makeEnvironment({ seed,
                                    nParticles: ph.nParticles !== undefined ? ph.nParticles : cfg.nParticles,
                                    noise: ph.noise !== undefined ? ph.noise : cfg.noise,
                                    doorHeight: cfg.doorHeight,
                                    // (Stage-3 demon observation) per-arm flag: the
                                    // callers set cfg.demonObsArms when the config
                                    // enumerates arm-level flags; without it the run
                                    // flag is the arm flag. OFF calls the ORIGINAL
                                    // 4-field constructor unchanged.
                                    demonObs: cfg.demonObsArms
                                      ? cfg.demonObsArms[key] === true
                                      : cfg.demonObs === true });
      const controller = factory(makeRng(networkSeed ^ 0x5f5f), env, cfg, seedSpec);
      const rec = { seed, networkSeed, topologySeed, runId: seedSpec.runId, trials: [] };

      for (let phaseIndex = 0; phaseIndex < phaseDefs.length; phaseIndex++) {
        const ph = phaseDefs[phaseIndex];
        if (controller.setLearning) controller.setLearning(ph.learning);
        for (let t = 0; t < ph.n; t++) {
          if (cfg.onTrial) cfg.onTrial(key, ph.phase, t, ph.n, s, cfg.nSeeds);
          env.reset();
          env.door.pos = 0; env.door.target = 0;
          if (controller.resetForTrial) controller.resetForTrial();
          const tr = { seed, networkSeed, topologySeed, runId: seedSpec.runId,
                       phase: ph.phase, phaseIndex, trial: t, steps: 0,
                       plannedEpisodeSeconds: ph.episodeSeconds !== undefined
                         ? ph.episodeSeconds : cfg.episodeSeconds,
                       frozenPre: ph.phase === FROZEN_PRE_PHASE ? true : undefined,
                       frozenPreSeconds: ph.phase === FROZEN_PRE_PHASE ? frozenPreSec : undefined,
                       crossings: 0, goodCrossings: 0, badCrossings: 0,
                       energyJ: 0, jetWorkJ: 0,
                       demonAgree: 0, demonDecisions: 0,
                       openFraction: 0, dTfinal: 0, sortEntropy: 0, spatialH: 0,
                       miNeural: 0,
                       workInJ: 0, measuredBits: 0, erasureCostJ: 0,
                       extractableJ: 0, landauerRatio: 0, weightDrift: 0 };
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
          const maxSteps = Math.round(tr.plannedEpisodeSeconds / cfg.dt);
          for (let st = 0; st < maxSteps; st++) {
            if (cfg.onStepProgress && (st & 255) === 0)   // (audit step 6) intra-trial heartbeat, ~4.3 sim-s cadence
              cfg.onStepProgress(key, ph.phase, t, ph.n, st, maxSteps, s, cfg.nSeeds);
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
          tr.openFraction = tr.steps ? openSteps / tr.steps : 0;
          tr.durationSeconds = tr.steps * cfg.dt;
          // thermodynamic budget: extractable work of the final state vs the
          // Landauer erasure bill for the demon's memory traffic
          tr.extractableJ = METRICS.extractableWorkSimJ(env.particles) * SIM_J;
          tr.erasureCostJ = METRICS.landauerJoules(tr.measuredBits, T_ENV);
          tr.landauerRatio = tr.erasureCostJ > 0
            ? tr.extractableJ / tr.erasureCostJ : null;
          // Stage-1 frozen-pre evidence (protocol §10): persistence metric —
          // EXACTLY 0.0 after any episode in which no plastic change occurred
          // (connectome arms during the frozen pre phase); stays 0 for
          // brainless controllers (classical/random: non-plastic by design).
          if (typeof controller.weightDrift === "function")
            tr.weightDrift = controller.weightDrift();
          if (controller.neuralActivity && controller.particleSample) {
            tr.miNeural = METRICS.mutualInformation(
              controller.neuralActivity(), controller.particleSample(env));
          }
          if (controller.layerSpikeRates) tr.layerRates = controller.layerSpikeRates();
          if (controller.fireVec) tr.fireVec = controller.fireVec();
          if (controller.summary) Object.assign(tr, controller.summary());
          // (Stage-3 demon observation) per-row provenance — written ONLY when
          // this arm actually carries the registered flag: OFF arms and OFF
          // runs gain no keys at all. The connectome controller's summary()
          // already carries its own MEASURED band (obsBandLo/Hi/Neurons); these
          // defaults fill rows for arms whose sensors are extended without a
          // connectome and echo the run-level gain.
          if (cfg.demonObsArms ? cfg.demonObsArms[key] === true : cfg.demonObs === true) {
            if (tr.demonObsOn === undefined) tr.demonObsOn = true;
            if (tr.demonObsGain === undefined)
              tr.demonObsGain = cfg.demonObsGain !== undefined ? cfg.demonObsGain : 12;
            if (cfg.demonObsBand) {
              if (tr.obsBandLo === undefined) tr.obsBandLo = cfg.demonObsBand.lo;
              if (tr.obsBandHi === undefined) tr.obsBandHi = cfg.demonObsBand.hi;
              if (tr.obsBandNeurons === undefined) tr.obsBandNeurons = cfg.demonObsBand.neurons;
            }
          }
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
          cfg.onState({ kind: "pressure", t: st * dt,   // streamed t = CONTINUOUS sim-seconds (watch pacing maps t→wall)
                        trials, seed: seedTag,
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

/** E10 sensors — 8 channels, ALL derived from live trapdoor apparatus
 *  state (documented; no placeholders, no future information). The brain
 *  sees the same numbers the physics computes:
 *    0 fast-molecule approach count (left slot box, v > VFAST)   [0,1]
 *    1 slow-molecule approach count (v < VSLOW)                  [0,1]
 *    2 local density in the left slot box                        [0,1]
 *    3 signed side-density contrast (nl-nr)/(nl+nr)              [-1,1]
 *    4 flap angle / 1.1                                          [0,1]
 *    5 flap angular velocity / 25                                [-1,1]
 *    6 gate hold state (1 = flap pinned shut by the brain)       {0,1}
 *    7 smoothed total crossing rate / RATE_NORM                  [0,1]  */
const E10_SENSOR_DOC = {
  // Speed thresholds are quantiles of the ACTUAL gas distribution. The E10
  // gas thermalizes at per-component sigma = 86/sqrt(3) ~= 49.7 u/s
  // (_thermoWalls SPEED0=86), so |v| is Maxwell-distributed:
  //   p10 ~ 60, median ~ 76, p84 ~ 100 u/s (initial draw band: 60..110).
  // The original VFAST=260 sat above the physical max -> channel fastL read
  // 100% zeros and the brain could not see who was at the door.
  VFAST: 100, VSLOW: 60, NLOCAL_MAX: 12, LOCAL_BOX: 90, SLOT_HALF: 60,
  RATE_NORM: 2,
  channels: ["fastL", "slowL", "localL", "densityContrast", "doorAngle",
             "doorVel", "hold", "crossingRate"],
};
function senseE10(parts, door, sideStats, crossRateSm, doc, visitors) {
  const d = doc || E10_SENSOR_DOC;
  let nFast = 0, nSlow = 0, nLocal = 0;
  for (const q of parts) {
    if (q.x < -4 - d.LOCAL_BOX || q.x > -4) continue;
    if (Math.abs(q.y) > d.SLOT_HALF || Math.abs(q.z) > d.SLOT_HALF) continue;
    nLocal++;
    const sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy + q.vz * q.vz);
    if (sp > d.VFAST) nFast++; else if (sp < d.VSLOW) nSlow++;
  }
  const nv = visitors ? visitors.length : 0;
  let nFastVis = 0;
  if (visitors) for (const q of visitors) {
    const sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy + q.vz * q.vz);
    if (sp > d.VFAST) nFastVis++;
  }
  return [
    Math.min(1, nFast / 6),
    Math.min(1, nSlow / 6),
    Math.min(1, nLocal / d.NLOCAL_MAX),
    Math.max(-1, Math.min(1, (sideStats.nl - sideStats.nr) /
                             Math.max(1, sideStats.nl + sideStats.nr))),
    Math.min(1, door.ang / 1.1),
    Math.max(-1, Math.min(1, door.vel / 25)),
    door.hold > 0.5 ? 1 : 0,
    Math.min(1, crossRateSm / d.RATE_NORM),
    // -- learned-contrast channels (additive, opt-in via visitors) --------
    // ch8: molecules CURRENTLY approaching (identity-tracked, rising-edge
    //      event source — the event-locked decision fires on entry)
    Math.min(1, nv / 6),
    // ch9: approaching molecules that are fast — "someone who will bounce
    //      hard is incoming" (the physically predictive signal)
    Math.min(1, nFastVis / 3),
  ];
}

/** E10 · Smoluchowski Trapdoor — a spring trapdoor opened only by molecule
 *  impacts from the left. Passage is genuinely gated by the door angle, so a
 *  heavier door (slower to open) passes fewer molecules; the gas still relaxes
 *  to equilibrium — no demon, no net work.
 *
 *  With cfg.brainFactory the fly brain joins as GATEKEEPER. It cannot push
 *  the flap; the only actuator it owns is door.hold — pin the flap shut, or
 *  release it to the spring. The classical reference rule is computed every
 *  decision for demonAgreement ONLY and never actuates the door.
 *
 *    environment -> senseE10() 8ch -> brain.observe/step -> hold 0|1
 *      -> door.hold -> flap spring physics -> crossings -> nL/nR imbalance
 *      -> physical reward -> brain.receiveFeedback -> dopamine
 *      -> eligibility traces -> weights (persist across trials)
 *
 *  Reward (documented in E10_REWARD_DOC; nothing hidden in magic numbers):
 *  sorted L->R passages pay wSelect, R->L leaks cost 1.5x wSelect, and each
 *  decision is scored on the NET sorted transport its window achieved
 *  (wWork); holding while a fast molecule waits costs wWrong. TRAIN runs
 *  with plasticity on; TEST freezes the weights (demon_frozen freezes from
 *  trial 0 as the exposure control). */
function smoluchowskiCore(cfg) {
  cfg = cfg || {};
  const seedTag = cfg.seedTag !== undefined ? cfg.seedTag : 1;
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const L = 760, H = 300, D = 300, DH = 120;
  const nP = cfg.nParticles || 220;
  const trials = cfg.trials || 20;
  const trainTrials = Math.max(0, Math.min(trials, cfg.trainTrials !== undefined ? cfg.trainTrials : Math.floor(trials / 2)));
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const OPEN_THRESH = 0.22;
  // ---- reward coefficients (documented; nothing hidden in a magic number) --
  const E10_REWARD_DOC = {
    wWork: 0.5,        // per decision: wWork * clamp(net sorted crossings in
                       //   the decision window / W_NORM, -1, 1)
    wSelect: 0.3,      // per crossing: +wSelect sorted L->R,
                       //   -1.5*wSelect R->L leak
    wWrong: 0.15,      // per decision: -wWrong for holding while a fast L
                       //   molecule waits at the slot (blocked opportunity)
    W_NORM: 3,         // net sorted crossings per decision window that
                       //   count as "full" transport reward
    DECISION_S: 0.25,  // seconds between gate decisions
    EVENT_S: 0.6,      // event-locked mode: decision + credit window length
                       //   when a molecule ENTERS the approach box. Matched
                       //   to the ~0.45 s box->slot transit so the action
                       //   that governs the contact is the one scored.
                       //   cfg.decisionMode: "event" (default with brain)
                       //   | "clock" (legacy 0.25 s blind cadence)
  };
  const PG_CREDIT_GAMMA = 0.99;   // discounted credit window (~1.7 s at 60 Hz)
  const RDOC = (cfg.rewardCfg && typeof cfg.rewardCfg === "object")
    ? Object.assign({}, E10_REWARD_DOC, cfg.rewardCfg) : E10_REWARD_DOC;
  const hasBrain = typeof cfg.brainFactory === "function";
  const variants = [
    { key: "trapdoor_light", mass: 0.02, label: "light trapdoor", mode: "physics" },
    { key: "trapdoor_heavy", mass: 0.12, label: "heavy trapdoor", mode: "physics" },
  ];
  if (hasBrain) variants.push(
    { key: "trapdoor_neural", mass: 0.02, label: "fly-brain gate (learning)", mode: "neural" },
    { key: "trapdoor_frozen", mass: 0.02, label: "fly-brain gate (weights frozen)", mode: "frozen" });
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
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 - 20, H, D));
    const door = { ang: 0, vel: 0, hold: 0, dwell: 0, flips: 0, prev: 0, classical: 0 };
    let crossLR = 0, crossRL = 0;
    const BURN = Math.round(6 / dt);     // 6 s equilibration before counting
    let brain = null;
    if (v.mode === "neural" || v.mode === "frozen") {
      if (!hasBrain) throw new Error("trapdoor_neural/frozen require cfg.brainFactory");
      // one brain per seed: cross-seed CI reflects gas + connectome draw
      brain = cfg.brainFactory(seedTag);
    }
    const rows = [];
    let epRewWork = 0, epRewSel = 0, epRewPen = 0, epRewTotal = 0, epPgAcc = 0;
    let epDecisions = 0, epAgree = 0, epWrong = 0, epHoldSteps = 0;
    let epLtoR = 0, epRtoL = 0;
    let epSensSum = 0, epMotorSum = 0, epSpikeSum = 0, epDaSum = 0, epDaPeak = 0, epWChange = 0;
    let lastSens = new Array(8).fill(0), lastMotor = 0, lastPopen = 0;
    let crossRateSm = 0;
    let mFast = 0, mSlow = 0, mInit = 0;   // population-code fallback variables
    // ---- event-locked decisions -----------------------------------------
    // Identity-tracked per-molecule "in approach box" state. A decision is
    // triggered when a molecule ENTERS the box (rising edge). The event gate
    // ("any new arrival OR a waiting molecule present") re-scores the same
    // contact every 0.6 s while it lingers, so the credit window (also 0.6 s)
    // is matched to the box->slot transit and the action that governs the
    // contact is the one scored. Legacy blind 0.25 s cadence remains
    // available via cfg.decisionMode:"clock".
    const eventMode = (cfg.decisionMode === "clock") ? false : true;
    const inBox = new Uint8Array(nP);          // tracked box membership
    const decided = new Uint8Array(nP);        // already scored this visit
    let edgeCount = 0;                         // diagnostic: rising edges / seed
    const VIS_BOX = 90, VIS_HALF = 60;         // box extent (u), mirror of sense
    for (let t = 0; t < trials; t++) {
      const phase = t < trainTrials ? "train" : "test";
      // training: plasticity on for the neural variant; test: frozen.
      if (brain && brain.setLearning) brain.setLearning(v.mode === "neural" && phase === "train");
      if (brain && brain.resetForTrial) brain.resetForTrial();
      epRewWork = 0; epRewSel = 0; epRewPen = 0; epRewTotal = 0; epPgAcc = 0;
      epDecisions = 0; epAgree = 0; epWrong = 0; epHoldSteps = 0;
      epLtoR = 0; epRtoL = 0;
      epSensSum = 0; epMotorSum = 0; epSpikeSum = 0; epDaSum = 0; epDaPeak = 0; epWChange = 0;
      mFast = 0; mSlow = 0; mInit = 0;             // decision-variable reset
      const angSamples = [];
      for (let st = 0; st < maxSteps; st++) {
        const lrBefore = crossLR, rlBefore = crossRL;
        // ---- flap physics: spring-driven while free; the brain's hold pins
        // it shut (impacts reflect off the held flap; the hand absorbs the
        // impulse). No other physics changed — physics variants (hold = 0
        // forever) traverse the ORIGINAL code path bit-for-bit.
        if (door.hold > 0.5) {
          door.vel *= Math.exp(-6 * dt);
          door.ang *= Math.exp(-6 * dt);
        } else {
          door.vel += (-26 * door.ang - 1.6 * door.vel) * dt;   // spring + hinge damping
        }
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.x < -L / 2) { p.x = -L / 2; p.vx = Math.abs(p.vx); }
          if (p.x > L / 2) { p.x = L / 2; p.vx = -Math.abs(p.vx); }
          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          // center wall across the whole face; the door slot opens only in
          // [-DH/2, DH/2] x [-DH/2, DH/2] while the flap is lifted. Impacts
          // from the left kick it open; while open BOTH directions pass — a
          // Smoluchowski flap rectifies nothing on its own. With the brain
          // holding the flap shut, impacts from BOTH sides reflect.
          const xPrev = p.x - p.vx * dt;
          if ((p.x >= 0) !== (xPrev >= 0)) {
            const inSlot = Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2;
            _thermoWalls(vRng, [p], dt);
            if (inSlot && p.vx > 0) {
              if (door.hold > 0.5) {
                p.x = xPrev; p.vx = -p.vx;      // brain-pinned: no swing
              } else {
                // impact impulse: heavier door swings slower, so it needs more
                // hits before the spring-loaded angle clears the passage
                door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
                if (st >= BURN && door.ang > OPEN_THRESH) { crossLR++; epLtoR++; }
                else { p.x = xPrev; p.vx = -p.vx; }
              }
            } else if (st >= BURN && inSlot && p.vx < 0 && door.ang > OPEN_THRESH && door.hold <= 0.5) {
              crossRL++; epRtoL++;
            } else {
              p.x = xPrev; p.vx = -p.vx;
            }
          }
        }
        door.ang = Math.max(0, Math.min(1.1, door.ang + door.vel * dt));
        if (door.hold > 0.5) epHoldSteps++;
        if ((st & 15) === 0) angSamples.push(door.ang);
        crossRateSm += ((crossLR - lrBefore + crossRL - rlBefore) - crossRateSm) * 0.02;
        const s = _apparatusSideStats(parts, L * H * D / 2, L * H * D / 2);
        // ---- decision (the ONLY place door.hold is written) -------------
        if (brain) {
          // ---- event gating: ONE decision per visit --------------------
          // Identity-tracked approach-box membership. A decision fires when
          // a molecule ENTERS the box (rising edge); all occupants are then
          // marked decided, so no re-fire while a visit lingers — the same
          // visit can never reinforce two opposite actions. Decided flags
          // clear on exit, so a molecule that turns around and re-enters is
          // genuinely a new visit. The 0.6 s dwell still bounds the credit
          // window (box->slot transit ~0.45 s), so a window's crossing
          // rewards belong to the decision that governed that visit.
          let visitors = 0, newEdge = false, undecided = false;
          if (eventMode) {
            visitors = 0; newEdge = false; undecided = false;
            for (let pi = 0; pi < nP; pi++) {
              const q = parts[pi];
              const inside = q.x < -4 && q.x > -4 - VIS_BOX &&
                             Math.abs(q.y) < VIS_HALF && Math.abs(q.z) < VIS_HALF;
              if (inside && !inBox[pi]) { newEdge = true; edgeCount++; }
              if (inside) {
                visitors++; inBox[pi] = 1;
                if (!decided[pi]) undecided = true;
              } else { inBox[pi] = 0; decided[pi] = 0; }
            }
          }
          const evFire = eventMode &&
            ((newEdge && door.dwell <= 0) ||
             (undecided && door.dwell <= 0));
          door.dwell -= dt;
          if (!eventMode ? door.dwell <= 0 : evFire) {
            const sens = senseE10(parts, door, s, crossRateSm, E10_SENSOR_DOC,
              eventMode ? parts.filter((q, pi) => inBox[pi]) : null);
            brain.observe({ readSensors: () => sens,
              readVisualField: () => new Array(8).fill(0),
              door, particles: parts });
            brain.step(dt * 4, { readSensors: () => sens,
              readVisualField: () => new Array(8).fill(0),
              door, particles: parts });
            const tel = brain.telemetry ? brain.telemetry() : {};
            lastMotor = tel.motorRate !== undefined ? tel.motorRate : lastMotor;
            if (tel.sensoryActivity) lastSens = tel.sensoryActivity;
            if (tel.spikeCount !== undefined) epSpikeSum += tel.spikeCount;
            if (tel.dopamine !== undefined) {
              epDaSum += tel.dopamine;
              if (tel.dopamine > epDaPeak) epDaPeak = tel.dopamine;
            }
            if (brain.weightDrift) epWChange = brain.weightDrift();
            // ---- action selection ----------------------------------------
            // Primary: trained policy-gradient readout. The action is SAMPLED
            // from P(hold | motor population); before the decision the brain
            // received the rewards accrued since the last one, so REINFORCE
            // uses a contiguous per-decision credit window
            // (Δw ∝ r·(a − P_hold)).
            // Fallback (no PG readout): E9's population code — the gate holds
            // while the motor pool sits ABOVE its own slow baseline.
            let action = 1;
            const popenFn = brain.policyProb ? brain.policyProb() : null;
            if (popenFn !== null && popenFn !== undefined) {
              // deliver the credit accrued over the previous window; the
              // pgBaseline setter pairs it with the decision that earned it
              // (decPend is still that decision's — the core re-latches only
              // after this write). Includes transport, crossings, and the
              // wWrong penalty: the penalty is the main structured signal
              // against holding while a fast molecule waits, and omitting it
              // from the credit stream left the policy blind to exactly the
              // cost that discriminates hold from release.
              brain.pgReward = epPgAcc;
              epPgAcc = 0;
              lastPopen = popenFn;
              const sampled = brain.lastPgAction ? brain.lastPgAction() : null;
              action = sampled !== null && sampled !== undefined ? sampled : 1;
            } else {
              if (!mInit) { mInit = 1; mSlow = lastMotor; }
              mFast += (lastMotor - mFast) * 0.35;
              mSlow += (lastMotor - mSlow) * 0.02;
              action = (mFast - mSlow) > 0 ? 1 : 0;
            }
            const fastWaiting = sens[0] > 0.15;
            // classical reference — demonAgreement ONLY, never actuates:
            // release while a fast molecule waits or while the right side is
            // not yet richer; hold to protect the accumulated sorting.
            const refAction = (fastWaiting || s.nl <= s.nr) ? 0 : 1;
            door.classical = refAction;
            if (action !== door.prev) { door.flips++; door.prev = action; }
            const wrong = action === 1 && fastWaiting;
            if (wrong) epWrong++;
            epDecisions++;
            if (action === refAction) epAgree++;
            door.hold = action;
            door.dwell = eventMode ? RDOC.EVENT_S : RDOC.DECISION_S;
            // one decision per visit: every occupant is now scored; nobody
            // re-fires until they leave and a new molecule enters
            for (let pi = 0; pi < nP; pi++) if (inBox[pi]) decided[pi] = 1;
            epSensSum += lastSens.reduce((a, x) => a + x, 0) / (sens.length || 8);
            epMotorSum += lastMotor;
            if (brain.receiveFeedback) {
              if (wrong) {
                epRewPen -= RDOC.wWrong;
                epRewTotal -= RDOC.wWrong;
                epPgAcc -= RDOC.wWrong;   // the penalty TEACHES: it belongs in
                                          // the PG credit stream too, not just
                                          // the episode bookkeeping
                brain.receiveFeedback({ reward: -RDOC.wWrong,
                                        kind: "e10_penalty" });
              }
              // decision record (zero-reward: bookkeeping + reference action)
              brain.receiveFeedback({
                reward: 0,
                good: fastWaiting && action === 0,
                kind: "e10_decision", action, classicalAction: refAction, fastWaiting,
              });
            }
            // ---- decision-window transport reward (physical outcome) ------
            const netSorted = (crossLR - lrBefore) - (crossRL - rlBefore);
            const rWork = RDOC.wWork *
              Math.max(-1, Math.min(1, netSorted / RDOC.W_NORM));
            epRewWork += rWork;
            epRewTotal += rWork;
            epPgAcc = epPgAcc * PG_CREDIT_GAMMA + rWork;
            if (rWork !== 0 && brain.receiveFeedback)
              brain.receiveFeedback({ reward: rWork, kind: "e10_transport",
                                      netSorted });
          }
        }
        // ---- per-step crossing reward (physical outcome only) -------------
        if (brain && st >= BURN) {
          const nLR = crossLR - lrBefore, nRL = crossRL - rlBefore;
          let rSel = 0;
          if (nLR > 0) rSel += RDOC.wSelect * nLR;          // sorted passage
          if (nRL > 0) rSel -= 1.5 * RDOC.wSelect * nRL;    // R->L leak: back-leak
                                                            // costs 1.5x (a leak both
                                                            // undoes sorting AND signals
                                                            // the gate failed to block)
          if (rSel !== 0) {
            epRewSel += rSel;
            epRewTotal += rSel;
            epPgAcc = epPgAcc * PG_CREDIT_GAMMA + rSel;
            if (brain.receiveFeedback)
              brain.receiveFeedback({ reward: rSel, kind: "e10_crossing",
                                      lr: nLR, rl: nRL });
          }
        }
        if (cfg.onState && (st % 20) === 0) {
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "trapdoor", t: st * dt,   // streamed t = CONTINUOUS sim-seconds (watch pacing maps t→wall)
                        trials, seed: seedTag, phase, trial: t, trainTrials,
                        pos, door: door.ang, doorVel: door.vel, hold: door.hold,
                        tl: s.tl, tr: s.tr, nl: s.nl, nr: s.nr,
                        crossLR, crossRL, cond: v.key,
                        sensors: brain ? lastSens.map(x => Math.round(x * 1000) / 1000) : null,
                        motorActivity: lastMotor, action: door.hold,
                        classical: door.classical, reward: epRewTotal,
                        dopamine: epDaPeak,
                        demonAgree: epDecisions ? epAgree / epDecisions : 0 });
        }
      }
      const s = _apparatusSideStats(parts, L * H * D / 2, L * H * D / 2);
      const imb = (s.nl - s.nr) / Math.max(1, s.nl + s.nr);
      const fl = angSamples.length > 2
        ? Math.sqrt(angSamples.reduce((a, x) => a + x * x, 0) / angSamples.length) : 0;
      rows.push({ condition: v.key, phase, trial: t, seed: seedTag,
                  steps: maxSteps, crossings: epLtoR + epRtoL,
                  crossingRate: (epLtoR + epRtoL) / episode,
                  crossLR: epLtoR, crossRL: epRtoL,
                  leftCount: s.nl, rightCount: s.nr,
                  densityDiff: imb,
                  trapdoorAngle: door.ang,
                  trapdoorFluctuation: fl,
                  directionalBias: (epLtoR + epRtoL) > 0 ? (epLtoR - epRtoL) / (epLtoR + epRtoL) : 0,
                  demonAgree: epDecisions ? epAgree / epDecisions : 0,
                  decisionAccuracy: epDecisions ? 1 - epWrong / epDecisions : 0,
                  holdFraction: epHoldSteps / Math.max(1, maxSteps),
                  reward: epRewTotal,
                  rewardWork: epRewWork, rewardSelection: epRewSel, rewardPenalty: epRewPen,
                  rewardPerSec: epRewTotal / episode,
                  measuredBits: brain ? epDecisions : 0,
                  motorActivity: lastMotor,
                  motorRateMean: epDecisions ? epMotorSum / epDecisions : 0,
                  sensoryActivity: epDecisions ? epSensSum / epDecisions : 0,
                  spikeRate: epDecisions ? epSpikeSum / epDecisions : 0,
                  dopamine: epDaPeak, dopamineMean: epDecisions ? epDaSum / epDecisions : 0,
                  weightDrift: epWChange,
                  pgReleaseP: lastPopen,   // P(action=1) = P(release) from the PG readout
                  sortEntropy: 0, spatialH: 0, miNeural: 0,
                  dTfinal: s.tr - s.tl,
                  openFraction: 0, pistonX: 0, workJ: 0, erasureCostJ: 0, netWorkJ: 0 });
      // ---- Brain outcome telemetry (same contract as E9 rows) -------------
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
    const avgT = (f) => rows.filter(r => r.phase === "test").length
      ? rows.filter(r => r.phase === "test").reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.filter(r => r.phase === "test").length : avg(f);
    conditions[v.key] = {
      label: v.label,
      summary: {
        testDT: { mean: avgT("densityDiff"), ci: 0, n: rows.length },
        testOpenFraction: { mean: avgT("crossingRate"), ci: 0, n: rows.length },
        testPistonX: { mean: avgT("trapdoorFluctuation"), ci: 0, n: rows.length },
        testMiNeural: { mean: avgT("miNeural"), ci: 0, n: rows.length },
        testWorkJ: { mean: avgT("netWorkJ"), ci: 0, n: rows.length },
        testReward: { mean: avgT("reward"), ci: 0, n: rows.length },
        testAccuracy: { mean: avgT("decisionAccuracy"), ci: 0, n: rows.length },
        testDemonAgree: { mean: avgT("demonAgree"), ci: 0, n: rows.length },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "trapdoor" };
}

/** E11 · Feynman Ratchet & Pawl — event-rate model with exact detailed
 *  balance: forward slips come from the hot vanes (rate ∝ Th), backward
 *  steps need the cold-bath pawl lift against the load bias. At Th = Tc the
 *  rates balance EXACTLY (the backward exponent carries the +load·STEP
 *  raise it needs: exp(-(EPS - load*STEP)/Tc) at load*STEP < EPS) and net
 *  rotation is zero — the machine cannot extract work from a single bath;
 *  with Th > Tc it turns forward and lifts the load.
 *
 *  Work is the SIGNED mechanical work done against the load (a backward
 *  slip PAYS work back — there is no max(0,·) clamp to hide losses).
 *
 *  With cfg.brainFactory the fly brain joins as PAWL OPERATOR. The wheel is
 *  thermally rattled (an equilibrium bath, NOT a gradient): hops forward and
 *  backward are near-symmetric and the raw machine extracts nothing. The
 *  brain's one actuator is pawl.lift — pin the pawl UP (disengaged: the
 *  wheel slips both ways freely) or drop it DOWN (engaged: it blocks
 *  backward hops while forward hops lift it over). Timing the lift against
 *  the wheel's net bias is the only way to rectify the rattle; that IS
 *  information gathering. The classical reference (lift DOWN iff recent
 *  wheel net motion is forward) is computed every decision for
 *  demonAgreement ONLY and never actuates the pawl.
 *
 *    thermal rattle -> ratchetHops -> senseE11() 8ch -> brain.observe/step
 *      -> lift 0|1 -> pawl physics -> net rotation -> work against load
 *      -> physical reward -> brain.receiveFeedback -> dopamine
 *      -> eligibility traces -> weights (persist across trials)
 *
 *  Note on regime: this model's bath is EQUILIBRIUM (Th == Tc); the brain
 *  creates the asymmetry in time, not the temperature field. A Th>Tc
 *  variant is provided as the classical Feynman gradient reference — its
 *  pawl is NOT brain-controlled. */
function feynmanRatchetCore(cfg) {
  cfg = cfg || {};
  const seedTag = cfg.seedTag !== undefined ? cfg.seedTag : 1;
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const trials = cfg.trials || 20;
  const trainTrials = Math.max(0, Math.min(trials, cfg.trainTrials !== undefined ? cfg.trainTrials : Math.floor(trials / 2)));
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const TEETH = 24, STEP = (Math.PI * 2) / TEETH;
  const EPS = 0.10;                        // pawl lift barrier (arb. units)
  const LOADQ = 6.95;                      // load -> energy bias: load*STEP*LOADQ
  const GAMMA = 3.0;
  // ---- reward coefficients (documented; nothing hidden in a magic number) --
  const E11_REWARD_DOC = {
    wWork: 0.5,        // per decision: wWork * clamp(signed angular work of
                       //   the decision window / W_NORM, -1, 1)
    wStep: 0.3,        // per hop: +wStep forward (against the load),
                       //   -1.5*wStep backward (work paid back)
    wWrong: 0.15,      // per decision: -wWrong for dropping the pawl while
                       //   the wheel's recent motion is backward
    W_NORM: 0.15,      // wheel-turns per second of net rotation that count
                       //   as "full" mechanical reward in a decision window
    DECISION_S: 0.25,  // seconds between pawl decisions
  };
  const PG_CREDIT_GAMMA = 0.99;   // discounted credit window (~1.7 s at 60 Hz)
  const RDOC = (cfg.rewardCfg && typeof cfg.rewardCfg === "object")
    ? Object.assign({}, E11_REWARD_DOC, cfg.rewardCfg) : E11_REWARD_DOC;
  const hasBrain = typeof cfg.brainFactory === "function";
  const variants = [
    { key: "ratchet_gradient", Th: 2.0, Tc: 1.0, load: 0.055, label: "Th > Tc (extracts work)", mode: "physics" },
    { key: "ratchet_equilibrium", Th: 1.0, Tc: 1.0, load: 0.055, label: "Th = Tc (equilibrium)", mode: "physics" },
    { key: "ratchet_heavy_load", Th: 2.0, Tc: 1.0, load: 0.0825, label: "gradient + heavy load", mode: "physics" },
  ];
  if (hasBrain) variants.push(
    { key: "ratchet_neural", Th: 1.0, Tc: 1.0, load: 0.055, label: "fly-brain pawl (learning, equilibrium bath)", mode: "neural" },
    { key: "ratchet_frozen", Th: 1.0, Tc: 1.0, load: 0.055, label: "fly-brain pawl (weights frozen)", mode: "frozen" });
  if (Array.isArray(cfg.variants) && cfg.variants.length) {
    const keep = variants.filter(v => cfg.variants.includes(v.key));
    if (keep.length) variants.length = 0, variants.push(...keep);
  }
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    let ang = 0, fwd = 0, rev = 0, qh = 0, qc = 0;
    let velSm = 0, wobAng = 0;
    // brain state (actuator + decision variables; neural/frozen only)
    const brain = (v.mode === "neural" || v.mode === "frozen")
      ? (hasBrain ? cfg.brainFactory(seedTag) : null) : null;
    if ((v.mode === "neural" || v.mode === "frozen") && !brain)
      throw new Error("ratchet_neural/frozen require cfg.brainFactory");
    const pawl = { lift: 0, dwell: 0, flips: 0, prev: 0, classical: 0 };
    const rows = [];
    let epRewWork = 0, epRewStep = 0, epRewPen = 0, epRewTotal = 0, epPgAcc = 0;
    let epDecisions = 0, epAgree = 0, epWrong = 0, epLiftSteps = 0;
    let epSensSum = 0, epMotorSum = 0, epSpikeSum = 0, epDaSum = 0, epDaPeak = 0, epWChange = 0;
    let lastSens = new Array(8).fill(0), lastMotor = 0, lastPopen = 0;
    let netSm = 0;                            // EMA of signed hop events (sensor)
    let mFast = 0, mSlow = 0, mInit = 0;      // population-code fallback
    for (let t = 0; t < trials; t++) {
      const phase = t < trainTrials ? "train" : "test";
      if (brain && brain.setLearning) brain.setLearning(v.mode === "neural" && phase === "train");
      if (brain && brain.resetForTrial) brain.resetForTrial();
      epRewWork = 0; epRewStep = 0; epRewPen = 0; epRewTotal = 0; epPgAcc = 0;
      epDecisions = 0; epAgree = 0; epWrong = 0; epLiftSteps = 0;
      epSensSum = 0; epMotorSum = 0; epSpikeSum = 0; epDaSum = 0; epDaPeak = 0; epWChange = 0;
      mFast = 0; mSlow = 0; mInit = 0;
      const fwd0 = fwd, rev0 = rev, ang0 = ang, qh0 = qh, qc0 = qc;
      let dWorkSm = ang;                      // cumulative angle at last decision
      for (let st = 0; st < maxSteps; st++) {
        // thermal rattle of the wheel (visual + fluctuation metric)
        wobAng = wobAng * 0.96 + (vRng() - 0.5) * v.Th * 0.02;
        // ---- event rates with the barrier physics made EXPLICIT -------------
        // Lb = load·STEP·LOADQ is the load's energy bias per tooth. A forward
        // hop must lift the load AND the pawl (energy EPS + Lb, paid from the
        // hot-vane bath at Th); a backward hop is downhill for the load and
        // only needs the pawl to bounce (EPS − Lb, paid from the cold bath).
        // With the pawl LIFTED the teeth are cleared: both hops see the load
        // alone. In every state pFwd/pBack = (Th/Tc)·exp(−(EPS+Lb)/Th + (EPS−Lb)/Tc)
        // or its lifted analogue — at Th = Tc this is exp(−2Lb/T) < 1 for ANY
        // Lb > 0: the wheel can only back-drive at equilibrium. The old model
        // gave forward hops a barrier-free rate and balanced them against
        // backward only through the accidental near-cancellation
        // EPS ≈ load·STEP·LOADQ — a knife edge, not detailed balance.
        const Lb = v.load * STEP * LOADQ;
        const pFwd = Math.min(0.5, GAMMA * v.Th * dt *
          (pawl.lift > 0.5 ? Math.exp(-Lb / v.Th)
                           : Math.exp(-(EPS + Lb) / v.Th)));
        const pBack = Math.min(0.5, GAMMA * v.Tc * dt *
          (pawl.lift > 0.5 ? Math.exp(Lb / v.Tc)
                           : Math.exp(-(EPS - Lb) / v.Tc)));
        const r = vRng();
        let dAng = 0;
        const fwdBefore = fwd, revBefore = rev;
        if (r < pFwd) {
          dAng = STEP; fwd++; qh += (pawl.lift > 0.5 ? Lb : EPS + Lb);
        } else if (r < pFwd + pBack) {
          dAng = -STEP; rev++; qc += (pawl.lift > 0.5 ? Lb : EPS - Lb);
        }
        ang += dAng;
        velSm += (dAng / dt - velSm) * Math.min(1, dt * 6);
        netSm += (dAng / STEP - netSm) * 0.02;      // signed hop EMA (sensor ch7)
        // ---- per-hop reward (physical outcome; brain modes only) ----------
        if (brain) {
          const nF = fwd - fwdBefore, nR = rev - revBefore;
          // SIGNED mechanical reward per hop: +wStep forward (against the
          // load), -1.5*wStep backward (work paid back + the pawl failed to
          // block — the documented E11 contract).
          const rStep = RDOC.wStep * nF - 1.5 * RDOC.wStep * nR;
          if (rStep !== 0) {
            epRewStep += rStep;
            epRewTotal += rStep;
            epPgAcc = epPgAcc * PG_CREDIT_GAMMA + rStep;
            if (brain.receiveFeedback)
              brain.receiveFeedback({ reward: rStep, kind: "e11_hop",
                                      fwd: nF, rev: nR });
          }
        }
        // ---- decision (the ONLY place pawl.lift is written; brain modes) --
        if (brain) {
          pawl.dwell -= dt;
          if (pawl.dwell <= 0) {
            const fwdRate = fwd - fwd0, revRate = rev - rev0;
            const sens = [
              Math.min(1, (fwd - fwd0) / 40),            // forward-hop count / ep
              Math.min(1, (rev - rev0) / 40),            // backward-hop count / ep
              Math.max(-1, Math.min(1, netSm)),          // signed hop-rate EMA
              Math.max(-1, Math.min(1, velSm / 25)),     // smoothed angular velocity
              Math.min(1, ((ang % STEP) + STEP) % STEP / STEP), // wheel angle within tooth
              Math.min(1, v.Th / 2),                     // hot-bath temperature
              Math.min(1, v.Tc / 2),                     // cold-bath temperature
              Math.min(1, fwdRate + revRate > 0
                ? (fwdRate - revRate) / (fwdRate + revRate) : 0),  // recent-hop imbalance
            ];
            lastSens = sens;
            brain.observe({ readSensors: () => sens,
              readVisualField: () => new Array(8).fill(0),
              pawl, particles: [] });
            brain.step(dt * 4, { readSensors: () => sens,
              readVisualField: () => new Array(8).fill(0),
              pawl, particles: [] });
            const tel = brain.telemetry ? brain.telemetry() : {};
            lastMotor = tel.motorRate !== undefined ? tel.motorRate : lastMotor;
            if (tel.spikeCount !== undefined) epSpikeSum += tel.spikeCount;
            if (tel.dopamine !== undefined) {
              epDaSum += tel.dopamine;
              if (tel.dopamine > epDaPeak) epDaPeak = tel.dopamine;
            }
            if (brain.weightDrift) epWChange = brain.weightDrift();
            // ---- action selection (same contract as E10) ----------------
            let action = 1;
            const popenFn = brain.policyProb ? brain.policyProb() : null;
            if (popenFn !== null && popenFn !== undefined) {
              brain.pgReward = epPgAcc;            // credit window -> REINFORCE
              epPgAcc = 0;
              lastPopen = popenFn;
              const sampled = brain.lastPgAction ? brain.lastPgAction() : null;
              action = sampled !== null && sampled !== undefined ? sampled : 1;
            } else {
              if (!mInit) { mInit = 1; mSlow = lastMotor; }
              mFast += (lastMotor - mFast) * 0.35;
              mSlow += (lastMotor - mSlow) * 0.02;
              action = (mFast - mSlow) > 0 ? 1 : 0;
            }
            // classical reference — demonAgreement ONLY, never actuates:
            // drop the pawl (engage the ratchet) while the wheel's recent
            // motion is forward, lift it when motion is backward.
            const refAction = netSm > 0 ? 1 : 0;
            pawl.classical = refAction;
            if (action !== pawl.prev) { pawl.flips++; pawl.prev = action; }
            const wrong = action === 0 && netSm < 0;
            if (wrong) epWrong++;
            epDecisions++;
            if (action === refAction) epAgree++;
            pawl.lift = 1 - action;             // action 1 = pawl DOWN (engaged)
            pawl.dwell = RDOC.DECISION_S;
            epSensSum += sens.reduce((a, x) => a + x, 0) / 8;
            epMotorSum += lastMotor;
            if (brain.receiveFeedback) {
              if (wrong) {
                epRewPen -= RDOC.wWrong;
                epRewTotal -= RDOC.wWrong;
                brain.receiveFeedback({ reward: -RDOC.wWrong,
                                        kind: "e11_penalty" });
              }
              brain.receiveFeedback({
                reward: 0,
                good: netSm > 0 && action === 1,
                kind: "e11_decision", action, classicalAction: refAction,
                netHopRate: netSm,
              });
            }
            // ---- decision-window mechanical reward (physical outcome) -----
            // hops since the last decision, normalized by W_NORM turns/s ×
            // window duration × teeth (i.e. hops-at-full-reward)
            const rWork = RDOC.wWork *
              Math.max(-1, Math.min(1, ((ang - dWorkSm) / STEP) /
                                    (RDOC.W_NORM * RDOC.DECISION_S * TEETH)));
            epRewWork += rWork;
            epRewTotal += rWork;
            epPgAcc = epPgAcc * PG_CREDIT_GAMMA + rWork;
            if (rWork !== 0 && brain.receiveFeedback)
              brain.receiveFeedback({ reward: rWork, kind: "e11_mechanical",
                                      dAng: ang - dWorkSm });
            dWorkSm = ang;
          }
        }
        if (pawl.lift > 0.5) epLiftSteps++;
        if (cfg.onState && (st % 20) === 0) {
          cfg.onState({ kind: "ratchet", t: st * dt,   // streamed t = CONTINUOUS sim-seconds (watch pacing maps t→wall)
                        trials, seed: seedTag, phase, trial: t, trainTrials,
                        ang: ang + wobAng, angSnap: ang, vel: velSm,
                        teeth: TEETH, fwd, rev, th: v.Th, tc: v.Tc,
                        load: v.load, qh, qc, cond: v.key,
                        lift: pawl.lift,
                        sensors: brain ? lastSens.map(x => Math.round(x * 1000) / 1000) : null,
                        motorActivity: lastMotor, action: 1 - pawl.lift,
                        classical: pawl.classical, reward: epRewTotal,
                        dopamine: epDaPeak,
                        demonAgree: epDecisions ? epAgree / epDecisions : 0 });
        }
      }
      const net = ang - ang0;                 // THIS episode's net rotation
      const entropy = (qh - qh0) / v.Th - (qc - qc0) / v.Tc;   // per-episode
      // SIGNED mechanical work against the load: backward rotation pays work
      // back. (The old max(0, net) clamp hid backward losses — removed.)
      const workEp = net * v.load;
      rows.push({ condition: v.key, phase, trial: t, seed: seedTag,
                  steps: maxSteps, crossings: (fwd - fwd0) + (rev - rev0),
                  ratchetAngle: ang, angularVelocity: velSm,
                  torque: v.load, forwardSteps: fwd - fwd0, reverseSteps: rev - rev0,
                  netRotation: ang, netPerEpisode: net,
                  liftFraction: brain ? epLiftSteps / Math.max(1, maxSteps) : 0,
                  thermalFluctuation: Math.abs(wobAng),
                  workJ: ang * v.load * 1e-21, workJEp: workEp * 1e-21,
                  heatJ: (qh + qc) * 1e-21,
                  demonAgree: brain ? (epDecisions ? epAgree / epDecisions : 0) : 0,
                  decisionAccuracy: brain ? (epDecisions ? 1 - epWrong / epDecisions : 0) : 0,
                  entropyProduction: entropy,
                  efficiency: qh > 0 ? Math.max(0, workEp) / (qh - qh0) : 0,
                  reward: brain ? epRewTotal : 0,
                  rewardWork: epRewWork, rewardSelection: epRewStep, rewardPenalty: epRewPen,
                  rewardPerSec: brain ? epRewTotal / episode : 0,
                  measuredBits: brain ? epDecisions : 0,
                  motorActivity: lastMotor,
                  motorRateMean: epDecisions ? epMotorSum / epDecisions : 0,
                  sensoryActivity: epDecisions ? epSensSum / epDecisions : 0,
                  spikeRate: epDecisions ? epSpikeSum / epDecisions : 0,
                  dopamine: brain ? epDaPeak : 0,
                  dopamineMean: epDecisions ? epDaSum / epDecisions : 0,
                  weightDrift: brain ? epWChange : 0,
                  pgEngageP: lastPopen,   // P(action=1) = P(engage) from the PG readout
                  sortEntropy: 0, spatialH: 0, miNeural: 0,
                  dTfinal: net, openFraction: 0, pistonX: 0,
                  erasureCostJ: 0, netWorkJ: workEp * 1e-21 });
      const row = rows[rows.length - 1];      // fix: telemetry block below needs it
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
            brain.neuralActivity(), brain.particleSample({ particles: [] }));
        }
      }
      if (cfg.onTrialData) cfg.onTrialData(v.key, phase, row);
    }
    const avg = (f) => rows.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.length;
    const avgT = (f) => rows.filter(r => r.phase === "test").length
      ? rows.filter(r => r.phase === "test").reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.filter(r => r.phase === "test").length : avg(f);
    conditions[v.key] = {
      label: v.label,
      summary: {
        testDT: { mean: avgT("netPerEpisode"), ci: 0, n: rows.length },
        testOpenFraction: { mean: avgT("efficiency"), ci: 0, n: rows.length },
        testMiNeural: { mean: avgT("miNeural"), ci: 0, n: rows.length },
        testWorkJ: { mean: avgT("netWorkJ"), ci: 0, n: rows.length },
        testReward: { mean: avgT("reward"), ci: 0, n: rows.length },
        testAccuracy: { mean: avgT("decisionAccuracy"), ci: 0, n: rows.length },
        testDemonAgree: { mean: avgT("demonAgree"), ci: 0, n: rows.length },
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

// ---- reserved obs band of the connectome's input layer (Stage-3 demon
//      observation arm) — the SAME slice math the layer-channel injector uses:
//      band = [floor(0.86·L), floor(1.0·L)·cap] of input layer 0. The browser
//      constants are OBS_INPUT_BAND [0.86, 1.0] with gain 12; for the FAFB
//      circuit the pinning expects input layer L = 2875 → [2472, 2875),
//      403 reserved neurons, matching the pre-registered map. Returns null
//      when no circuit is available (the caller's manifest echoes null).
function demonObsBand(circuit) {
  if (!circuit || !Array.isArray(circuit.layers) || !circuit.layers.length ||
      !Array.isArray(circuit.layers[0]) || !circuit.layers[0].length) return null;
  const L = circuit.layers[0].length;
  const lo = Math.max(0, Math.min(L, Math.floor(0.86 * L)));
  const hi = Math.max(lo, Math.min(L, Math.floor(1.0 * L)));
  return { lo, hi, neurons: hi - lo, inputLayer: L };
}

module.exports = { makeRng, makeEnvironment, METRICS, runBenchmark, meanCI,
                   demonObsBand, makeDemonFsm,
                   apparatusCurve,
                   pressureDemonCore, smoluchowskiCore, feynmanRatchetCore,
                   CH, WALL_T, DOOR_GAP, DOOR_Z_HALF, clamp };
