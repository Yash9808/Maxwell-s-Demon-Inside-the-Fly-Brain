import io

p = "experiment_core.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d
CRLF = "\r\n" in d
NL = "\r\n" if CRLF else "\n"

def nl(s):
    return s.replace("\r\n", "\n").replace("\n", NL) if CRLF else s

# cut the old apparatus block (between its header and meanCI)
start_marker = nl("// ============================================================ apparatus sims")
end_marker = nl("\n\nfunction meanCI(vals) {")
i = d.find(start_marker)
assert i >= 0, "apparatus header not found"
j = d.find(end_marker, i)
assert j > i, "meanCI marker not found after apparatus block"

APPARATUS = r'''
// ============================================================ apparatus sims
// Self-contained apparatus experiments (E9 pressure engine, E10 Smoluchowski
// trapdoor, E11 Feynman ratchet & pawl). Each returns the same shape as
// runBenchmark ({ conditions: { key: { label, summary } } }) so the existing
// worker/queue/plots/provenance pipeline consumes them unchanged. Rows carry
// per-episode apparatus metrics; cfg.onState streams compact live state for
// the 3D apparatus scenes (throttled inside these sims).

function _apparatusPart(rng, L, H, D) {
  const sp = 60 + rng() * 50, an = rng() * Math.PI * 2;
  return { x: (rng() - 0.5) * L * 0.9, y: (rng() - 0.5) * H * 0.85,
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

/** E9 · Pressure Demon — the demon's speed-selective valve builds a thermal
 *  pressure difference that does mechanical work on a piston against a
 *  spring. Controls: random valve, never-open. Landauer bill for the bits. */
function pressureDemonCore(cfg) {
  cfg = cfg || {};
  const rng = makeRng(cfg.seed !== undefined ? cfg.seed : 1);
  const L = 900, H = 420, D = 420, DH = 190, PEXT = 160;   // chamber + piston run
  const nP = cfg.nParticles || 260;
  const trials = cfg.trials || 24;
  const episode = cfg.episodeSeconds || 20;
  const dt = cfg.dt || 1 / 60;
  const SPRING = 12, DRAG = 0.35, PMASS = 0.02;
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
    let workU = 0, crossings = 0, bits = 0, opened = 0;
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let openSteps = 0, epCross = 0;
      for (let st = 0; st < maxSteps; st++) {
        // piston geometry: right-chamber volume shrinks as the piston advances
        const vr = (PEXT + L / 2 + 8 - pist.x) * H * D;
        const vl = (L / 2 + 8) * H * D;
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.x < -L / 2) { p.x = -L / 2; p.vx = Math.abs(p.vx); }
          if (p.x > L / 2 + PEXT - pist.x) { p.x = L / 2 + PEXT - pist.x; p.vx = -Math.abs(p.vx); }
          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          // center wall with the valve slot [-DH/2, DH/2] x [-DH/2, DH/2]
          if (p.x > -8 && p.x < 8 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            if (valve.pos > 0.6) {
              p.x += p.vx > 0 ? 10 : -10;      // pass through
              crossings++; epCross++;
            } else {
              p.x = Math.sign(p.x) * 8; p.vx = -p.vx;
            }
          }
        }
        // demon decision: measure one particle (1 bit), set the valve
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
          valve.dwell = 0.12;
        }
        valve.pos += (valve.target - valve.pos) * Math.min(1, dt * 10);
        if (valve.pos > 0.5) openSteps++;
        // piston: driven by the volume-aware pressure difference
        const s = _apparatusSideStats(parts, vl, vr);
        const F = (s.pr - s.pl) - SPRING * pist.x;
        pist.v += ((F / PMASS) - DRAG * pist.v) * dt;
        pist.x += pist.v * dt;
        if (pist.x < 0) { pist.x = 0; pist.v = 0; }
        if (pist.x > PEXT * 0.9) { pist.x = PEXT * 0.9; pist.v = 0; }
        workU += Math.max(0, SPRING * pist.x * pist.v * dt);   // work into the spring
        if (cfg.onState && (st % 8) === 0) {
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "pressure", t: t + st / maxSteps, trials,
                        pos, valve: valve.pos, piston: pist.x,
                        tl: s.tl, tr: s.tr, pl: s.pl, pr: s.pr,
                        dT: s.dT, workU, bits, crossings, cond: v.key });
        }
      }
      const ts = _apparatusSideStats(parts, vl, vr);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;
      rows.push({ condition: v.key, phase: "train", trial: t, seed: 1,
                  steps: maxSteps, crossings: epCross,
                  openFraction: openSteps / maxSteps,
                  dPfinal: (ts.pr - ts.pl) / Math.max(1e-9, ts.pl + ts.pr),
                  dTfinal: ts.dT,
                  pistonX: pist.x, pistonV: pist.v,
                  pistonVelocity: Math.abs(pist.v),
                  workJ: workU * SIM_J, valveFlips: valve.flips,
                  demonAgree: 0, measuredBits: bits,
                  sortEntropy: 0, spatialH: 0, miNeural: 0,
                  erasureCostJ,
                  netWorkJ: (workU * SIM_J) - erasureCostJ });
      if (cfg.onTrialData) cfg.onTrialData(v.key, "train", rows[rows.length - 1]);
    }
    const avg = (f) => rows.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / rows.length;
    conditions[v.key] = {
      label: v.label,
      summary: {
        testWorkJ: { mean: avg("workJ"), ci: 0, n: rows.length },
        testDT: { mean: avg("dTfinal"), ci: 0, n: rows.length },
        testOpenFraction: { mean: avg("openFraction"), ci: 0, n: rows.length },
        testPistonX: { mean: avg("pistonX"), ci: 0, n: rows.length },
        testMiNeural: { mean: 0, ci: 0, n: rows.length },
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
  for (const v of variants) {
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(rng, L, H, D));
    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0;
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
          // center wall: opening only in the door slot (y in [-DH/2, DH/2])
          if (Math.abs(p.x) < 6 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            const s2 = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
            if (wasLeft && p.vx > 0) {
              // impact kicks the door open (heavier door: smaller kick)
              door.vel += Math.min(60, s2 * 0.12) / v.mass * dt * 8;
              door.ang = Math.min(1.1, door.ang + Math.min(0.55, (s2 / 300) * 0.5 / (v.mass * 25)));
              if (door.ang > OPEN_THRESH) {
                p.x += 12; crossLR++; epL++;   // passes through
              } else {
                p.x = -6; p.vx = Math.abs(p.vx);   // bounced off the closed door
              }
            } else if (!wasLeft && p.vx < 0) {
              // right-to-left: hits the door frame — always blocked
              p.x = 6; p.vx = Math.abs(p.vx);
            } else {
              p.x = Math.sign(p.x) * 6; p.vx = -p.vx;
            }
          }
        }
        door.ang = Math.max(0, Math.min(1.1, door.ang + door.vel * dt));
        if ((st & 15) === 0) angSamples.push(door.ang);
        if (cfg.onState && (st % 8) === 0) {
          const s = _apparatusSideStats(parts, L * H * D / 2, L * H * D / 2);
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "trapdoor", t: t + st / maxSteps, trials,
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
  for (const v of variants) {
    let ang = 0, fwd = 0, rev = 0, qh = 0, qc = 0;
    let velSm = 0, wob = 0, wobAng = 0;
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let epF = 0, epR = 0, ang0 = ang;
      for (let st = 0; st < maxSteps; st++) {
        // thermal rattle of the wheel (visual + fluctuation metric)
        wobAng = wobAng * 0.96 + (rng() - 0.5) * v.Th * 0.02;
        // event probabilities with detailed balance:
        const pFwd = Math.min(0.5, GAMMA * v.Th * dt);
        const pBack = Math.min(0.5, GAMMA * v.Tc *
                               Math.exp(-(EPS - v.load * STEP * LOADQ) / v.Tc) * dt);
        const r = rng();
        let dAng = 0;
        if (r < pFwd) { dAng = STEP; fwd++; epF++; qh += EPS; }
        else if (r < pFwd + pBack) { dAng = -STEP; rev++; epR++; qc += EPS; }
        ang += dAng;
        velSm += (dAng / dt - velSm) * Math.min(1, dt * 6);
        if (cfg.onState && (st % 8) === 0) {
          cfg.onState({ kind: "ratchet", t: t + st / maxSteps, trials,
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
'''

d = d[:i] + nl(APPARATUS.strip("\n")) + d[j:]
assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("apparatus sims corrected (physics pass 2)")
