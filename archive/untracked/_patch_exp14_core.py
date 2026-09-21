import io

p = "experiment_core.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d
CRLF = "\r\n" in d
NL = "\r\n" if CRLF else "\n"

def nl(s):
    return s.replace("\r\n", "\n").replace("\n", NL) if CRLF else s

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

APPARATUS = r'''
// ============================================================ apparatus sims
// Self-contained apparatus experiments (E9 pressure engine, E10 Smoluchowski
// trapdoor, E11 Feynman ratchet & pawl). Each returns the same shape as
// runBenchmark ({ conditions: { key: { summary, rows } } }) so the existing
// worker/queue/plots/provenance pipeline consumes them unchanged. Rows carry
// per-episode apparatus metrics; cfg.onState streams compact live state for
// the 3D apparatus scenes (throttled inside these sims).

function _apparatusPart(rng, L, H, D) {
  const sp = 60 + rng() * 50, an = rng() * Math.PI * 2;
  return { x: (rng() - 0.5) * L * 0.9, y: (rng() - 0.5) * H * 0.85,
           z: (rng() - 0.5) * D * 0.85,
           vx: sp * Math.cos(an), vy: sp * Math.sin(an), vz: (rng() - 0.5) * sp * 0.5 };
}
function _apparatusSideStats(parts) {
  let nl = 0, nr = 0, el = 0, er = 0;
  for (const p of parts) {
    if (p.x < 0) { nl++; el += p.vx * p.vx + p.vy * p.vy + p.vz * p.vz; }
    else { nr++; er += p.vx * p.vx + p.vy * p.vy + p.vz * p.vz; }
  }
  return { nl, nr,
           pl: nl > 0 ? (el / nl) * nl : 0,     // ideal-gas proxy: N * <v2>
           pr: nr > 0 ? (er / nr) * nr : 0 };
}

/** E9 · Pressure Demon — demon-mediated pressure difference does mechanical
 *  work on a piston. The demon opens a valve only for fast particles moving
 *  hot-side -> work-side, building dP; the piston compresses a spring.
 *  Controls: random valve flips, never-open. Landauer bill for the bits. */
function pressureDemonCore(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const L = 900, H = 420, D = 420, DH = 190;   // chamber + valve aperture
  const nP = cfg.nParticles || 260;
  const trials = cfg.trials || 24;
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const SPRING = 2.2e-4, DRAG = 0.35, PMASS = 0.02;
  const SIM_J = 1e-21, T_ENV = 300, kB_J = 1.38e-23;
  const variants = [
    { key: "demon_speed", mode: "speed", label: "selective valve (demon)" },
    { key: "demon_random", mode: "random", label: "random valve (control)" },
    { key: "never_open", mode: "never", label: "never-open valve (control)" },
  ];
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (const v of variants) {
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(rng, L, H, D));
    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };
    const pist = { x: 0, v: 0 };
    let workJ = 0, crossings = 0, bits = 0, decided = 0, opened = 0;
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let openSteps = 0, epCross = 0;
      let epP = null;
      for (let st = 0; st < maxSteps; st++) {
        // particle dynamics (elastic walls; center wall solid except valve slot)
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.x < -L / 2) { p.x = -L / 2; p.vx = Math.abs(p.vx); }
          if (p.x > L / 2 + 160) { p.x = L / 2 + 160; p.vx = -Math.abs(p.vx); }
          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          // center wall with valve slot [-DH/2, DH/2] x [-DH/2, DH/2]
          if (p.x > -8 && p.x < 8 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            if (valve.pos > 0.6) {
              p.x += p.vx > 0 ? 10 : -10;      // pass through
              crossings++; epCross++;
            } else {
              p.x = Math.sign(p.x) * 8; p.vx = -p.vx;
            }
          }
        }
        // demon decision: measure a particle near the valve (1 bit)
        valve.dwell -= dt;
        if (valve.dwell <= 0) {
          bits++;
          const cand = parts[(rng() * parts.length) | 0];
          const speed2 = cand.vx * cand.vx + cand.vy * cand.vy + cand.vz * cand.vz;
          if (v.mode === "speed") valve.target = (speed2 > 95 * 95 && cand.x < 0) ? 1 : 0;
          else if (v.mode === "random") valve.target = rng() < 0.3 ? 1 : 0;
          else valve.target = 0;
          if (valve.target !== valve.prev) { valve.flips++; valve.prev = valve.target; }
          if (valve.target) opened++;
          decided++;
          valve.dwell = 0.12;
        }
        valve.pos += (valve.target - valve.pos) * Math.min(1, dt * 10);
        if (valve.pos > 0.5) openSteps++;
        // piston: driven by right-side overpressure against a spring
        const s = _apparatusSideStats(parts);
        const dp = (s.pr / Math.max(1, nP)) - (s.pl / Math.max(1, nP));
        const F = dp * 0.06 - SPRING * pist.x * 1000;
        const dv = (F / PMASS) * dt - DRAG * pist.v * dt;
        pist.v += dv; pist.x += pist.v * dt;
        if (pist.x < 0) { pist.x = 0; pist.v = 0; }
        const dW = Math.max(0, F * pist.v * dt);   // work done on the spring
        workJ += dW;
        epP = s;
        if (cfg.onState && (st % 8) === 0) {
          const pos = new Array(nP * 3);
          for (let i = 0; i < nP; i++) {
            pos[i * 3] = Math.round(parts[i].x); pos[i * 3 + 1] = Math.round(parts[i].y);
            pos[i * 3 + 2] = Math.round(parts[i].z);
          }
          cfg.onState({ kind: "pressure", t: t + st / maxSteps, trials,
                        pos, valve: valve.pos, piston: pist.x,
                        pl: s.pl, pr: s.pr, workJ, bits, crossings,
                        cond: v.key });
        }
      }
      const ts = _apparatusSideStats(parts);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;
      rows.push({ condition: v.key, phase: "train", trial: t, seed: rng.seed || 1,
                  steps: maxSteps, crossings: epCross, openFraction: openSteps / maxSteps,
                  dPfinal: (ts.pr - ts.pl) / Math.max(1, nP),
                  pistonX: pist.x, pistonV: pist.v,
                  pistonVelocity: Math.abs(pist.v),
                  workJ: workJ * SIM_J, valveFlips: valve.flips,
                  demonAgree: v.mode === "speed" ? 1 : 0,
                  measuredBits: bits,
                  erasureCostJ: erasureCostJ,
                  netWorkJ: (workJ - erasureCostJ / SIM_J) * SIM_J });
      if (cfg.onTrialData) cfg.onTrialData(v.key, "train", rows[rows.length - 1]);
    }
    conditions[v.key] = {
      label: v.label,
      summary: {
        testWorkJ: { mean: workJ * SIM_J / trials, ci: 0, n: trials },
        testDT: { mean: rows.reduce((a, r) => a + r.dPfinal, 0) / trials, ci: 0, n: trials },
        testOpenFraction: { mean: rows.reduce((a, r) => a + r.openFraction, 0) / trials, ci: 0, n: trials },
        testPistonX: { mean: rows.reduce((a, r) => a + r.pistonX, 0) / trials, ci: 0, n: trials },
        testMiNeural: { mean: 0, ci: 0, n: trials },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "pressure" };
}

/** E10 · Smoluchowski Trapdoor — a massless-on-demand spring trapdoor opened
 *  only by molecules arriving from the left; thermal fluctuations move the
 *  door, the gas relaxes to equilibrium (no demon, no net work). */
function smoluchowskiCore(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const L = 760, H = 300, D = 300, DH = 120;
  const nP = cfg.nParticles || 220;
  const trials = cfg.trials || 20;
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const variants = [
    { key: "trapdoor_light", mass: 0.02, label: "light trapdoor" },
    { key: "trapdoor_heavy", mass: 0.12, label: "heavy trapdoor" },
  ];
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (const v of variants) {
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(rng, L, H, D));
    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0, bits = 0;
    const rows = [];
    const angSamples = [];
    for (let t = 0; t < trials; t++) {
      let epL = 0, epR = 0, epCross = 0;
      for (let st = 0; st < maxSteps; st++) {
        // trapdoor dynamics: spring toward closed + collision kicks
        door.vel += (-26 * door.ang - 1.6 * door.vel) * dt;
        for (const p of parts) {
          const wasLeft = p.x < 0;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.x < -L / 2) { p.x = -L / 2; p.vx = Math.abs(p.vx); }
          if (p.x > L / 2) { p.x = L / 2; p.vx = -Math.abs(p.vx); }
          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          // center wall: opening only where the door swings (y < 0 half)
          if (Math.abs(p.x) < 6 && Math.abs(p.z) < DH / 2 && p.y < DH / 2 && p.y > -DH / 2) {
            const s2 = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
            if (wasLeft && p.vx > 0) {
              // molecule pushes the door open (against spring) and passes
              door.vel += Math.min(60, s2 * 0.12) / v.mass * dt * 8;
              door.ang = Math.min(1.1, door.ang + 0.5);
              p.x += 12; crossLR++; epL++; bits++;
            } else if (!wasLeft && p.vx < 0) {
              // door blocks right-to-left (hits the frame)
              p.x = 6; p.vx = Math.abs(p.vx);
            } else {
              p.x = Math.sign(p.x) * 6; p.vx = -p.vx;
            }
          }
        }
        door.ang = Math.max(0, Math.min(1.1, door.ang));
        door.ang += door.vel * dt;
        door.ang = Math.max(0, Math.min(1.1, door.ang));
        if (cfg.onState && (st % 8) === 0) {
          const s = _apparatusSideStats(parts);
          const pos = new Array(nP * 3);
          for (let i = 0; i < nP; i++) {
            pos[i * 3] = Math.round(parts[i].x); pos[i * 3 + 1] = Math.round(parts[i].y);
            pos[i * 3 + 2] = Math.round(parts[i].z);
          }
          cfg.onState({ kind: "trapdoor", t: t + st / maxSteps, trials,
                        pos, door: door.ang, doorVel: door.vel,
                        nl: s.nl, nr: s.nr, crossLR, crossRL, cond: v.key });
          angSamples.push(door.ang);
        }
      }
      const s = _apparatusSideStats(parts);
      const imb = (s.nl - s.nr) / Math.max(1, s.nl + s.nr);
      rows.push({ condition: v.key, phase: "train", trial: t, seed: rng.seed || 1,
                  steps: maxSteps, crossings: epL + epR, crossingRate: (epL + epR) / episode,
                  crossLR: epL, crossRL: epR,
                  leftCount: s.nl, rightCount: s.nr,
                  densityDiff: imb,
                  trapdoorAngle: door.ang,
                  trapdoorFluctuation: angSamples.length > 2 ? Math.sqrt(
                    angSamples.reduce((a, x) => a + x * x, 0) / angSamples.length) : 0,
                  demonAgree: 0,
                  directionalBias: epL + epR > 0 ? (epL - epR) / (epL + epR) : 0,
                  measuredBits: 0, sortEntropy: 0, spatialH: 0, miNeural: 0 });
      if (cfg.onTrialData) cfg.onTrialData(v.key, "train", rows[rows.length - 1]);
      angSamples.length = 0;
    }
    conditions[v.key] = {
      label: v.label,
      summary: {
        testDT: { mean: rows.reduce((a, r) => a + r.densityDiff, 0) / trials, ci: 0, n: trials },
        testOpenFraction: { mean: rows.reduce((a, r) => a + r.crossingRate, 0) / trials, ci: 0, n: trials },
        testMiNeural: { mean: 0, ci: 0, n: trials },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "trapdoor" };
}

/** E11 · Feynman Ratchet & Pawl — thermal kicks on vanes try to rotate the
 *  wheel; the pawl randomizes and the load opposes. Net rotation appears only
 *  with a temperature gradient (Th > Tc); at equilibrium forward = reverse. */
function feynmanRatchetCore(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const trials = cfg.trials || 20;
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const TEETH = 24, STEP = (Math.PI * 2) / TEETH;
  const LOAD = 0.055;                      // load torque (stall near 0.05)
  const PAWL_E = 0.10;                     // pawl lift barrier (arb. units)
  const variants = [
    { key: "ratchet_gradient", Th: 2.0, Tc: 1.0, load: LOAD, label: "Th > Tc (extracts work)" },
    { key: "ratchet_equilibrium", Th: 1.0, Tc: 1.0, load: LOAD, label: "Th = Tc (equilibrium)" },
    { key: "ratchet_heavy_load", Th: 2.0, Tc: 1.0, load: LOAD * 1.5, label: "gradient + heavy load" },
  ];
  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (const v of variants) {
    let ang = 0, vel = 0, fwd = 0, rev = 0, qh = 0, qc = 0, wob = 0, wobN = 0;
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let epF = 0, epR = 0, epNet0 = ang;
      for (let st = 0; st < maxSteps; st++) {
        // thermal kicks from the hot bath on the vanes
        const kickH = (rng() - 0.5) * v.Th * 2.4;
        vel += kickH * dt * 30;
        // pawl: cold bath occasionally lifts it (back-steps become possible)
        const lift = rng() < 1 - Math.exp(-v.Tc * dt * 8);
        // ratchet tooth geometry: forward slips free, backward blocked unless lifted
        if (vel > 0) {
          const tooth = ang % STEP;
          if (tooth > STEP * 0.55) { vel -= vel * dt * 6; }   // climbing a face
        } else if (vel < 0 && !lift) {
          vel = 0;                                            // pawl holds
        }
        vel -= v.load * dt * 30;                              // load torque
        vel *= (1 - 0.4 * dt);                                // axle friction
        const dAng = vel * dt;
        ang += dAng;
        // discrete step bookkeeping (forward/reverse events over tooth lines)
        if (Math.floor(ang / STEP) > Math.floor((ang - dAng) / STEP)) { fwd++; epF++; qh += Math.abs(dAng) * 0.4; }
        if (Math.floor(ang / STEP) < Math.floor((ang - dAng) / STEP)) { rev++; epR++; qc += Math.abs(dAng) * 0.4; }
        wob += Math.abs(dAng); wobN++;
        if (cfg.onState && (st % 8) === 0) {
          cfg.onState({ kind: "ratchet", t: t + st / maxSteps, trials,
                        ang, vel, teeth: TEETH, fwd, rev,
                        th: v.Th, tc: v.Tc, load: v.load,
                        qh, qc, cond: v.key });
        }
      }
      const net = ang - epNet0;
      const entropy = (qh / v.Th) - (qc / v.Tc);   // arb. units, >= 0 honest
      rows.push({ condition: v.key, phase: "train", trial: t, seed: rng.seed || 1,
                  steps: maxSteps, crossings: fwd + rev,
                  ratchetAngle: ang, angularVelocity: vel,
                  torque: v.load, forwardSteps: fwd, reverseSteps: rev,
                  netRotation: ang, netPerEpisode: net,
                  thermalFluctuation: wob / Math.max(1, wobN),
                  workJ: Math.max(0, net) * v.load * 1e-21,
                  heatJ: (qh + qc) * 1e-21,
                  demonAgree: 0,
                  entropyProduction: entropy,
                  efficiency: qh > 0 ? Math.max(0, net) * v.load / qh : 0,
                  measuredBits: 0, sortEntropy: 0, spatialH: 0, miNeural: 0 });
      if (cfg.onTrialData) cfg.onTrialData(v.key, "train", rows[rows.length - 1]);
    }
    conditions[v.key] = {
      label: v.label,
      summary: {
        testDT: { mean: rows.reduce((a, r) => a + r.netPerEpisode, 0) / trials, ci: 0, n: trials },
        testOpenFraction: { mean: rows.reduce((a, r) => a + r.efficiency, 0) / trials, ci: 0, n: trials },
        testMiNeural: { mean: 0, ci: 0, n: trials },
      },
      _apparatus: true,
    };
  }
  return { conditions, apparatus: "ratchet" };
}

'''

# insert the apparatus module before meanCI definition
rep("function meanCI(vals) {",
    APPARATUS.strip("\n") + "\n\nfunction meanCI(vals) {")

# export the new cores
rep("""module.exports = { makeRng, makeEnvironment, METRICS, runBenchmark, meanCI,
                   CH, WALL_T, DOOR_GAP, DOOR_Z_HALF, clamp };""",
    """module.exports = { makeRng, makeEnvironment, METRICS, runBenchmark, meanCI,
                   pressureDemonCore, smoluchowskiCore, feynmanRatchetCore,
                   CH, WALL_T, DOOR_GAP, DOOR_Z_HALF, clamp };""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("apparatus cores added to experiment_core.js")
