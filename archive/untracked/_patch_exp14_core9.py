import io

p = "experiment_core.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in d else "\n"
def nl(s):
    return s.replace("\r\n", "\n").replace("\n", NL) if NL else s

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# ---- 1. bath strength: 0.08/frame (~0.2 s equilibration) is far too strong —
# it erases the demon's gradient as fast as it builds. 0.0008/frame gives a
# ~21 s equilibration time: slow leak representing imperfect isolation.
rep("""function _thermoWalls(rng, parts, dt) {
  const SPEED0 = 86;                     // matches the initial speed distribution
  for (const p of parts) {
    if (rng() < 0.08 * dt * 60) {""",
"""function _thermoWalls(rng, parts, dt) {
  const SPEED0 = 86;                     // matches the initial speed distribution
  for (const p of parts) {
    if (rng() < 0.0008 * dt * 60) {""")

# ---- 2. E9: burn-in — run the valve for BURN seconds before accumulating
# dT/dP so the initial-condition fluctuation (the "phantom" signal) decays and
# only the demon's pumping is measured. Standard equilibration practice.
rep("""    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 + PEXT - 20, H, D));
    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };""",
"""    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 + PEXT - 20, H, D));
    const BURN = Math.round(10 / dt);    // 10 s equilibration before measuring
    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };""")

rep("""        const s = _apparatusSideStats(parts, vl, vr);
        dTsum += s.dT; dPsum += (s.pr - s.pl) / Math.max(1e-9, s.pr + s.pl); dN++;
        const F = (s.pr - s.pl) - SPRING * pist.x;""",
"""        const s = _apparatusSideStats(parts, vl, vr);
        if (st >= BURN) { dTsum += s.dT; dPsum += (s.pr - s.pl) / Math.max(1e-9, s.pr + s.pl); dN++; }
        const F = (s.pr - s.pl) - SPRING * pist.x;""")

# burn-in must still animate the piston/valve on screen: shift the live-state
# time origin so t starts at 0 after burn-in for the viewer.
rep("""        if (cfg.onState && (st % 8) === 0) {
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "pressure", t: t + st / maxSteps, trials,""",
"""        if (cfg.onState && st >= BURN && ((st - BURN) % 8) === 0) {
          const pos = new Array(nP * 3);
          for (let i2 = 0; i2 < nP; i2++) {
            pos[i2 * 3] = Math.round(parts[i2].x); pos[i2 * 3 + 1] = Math.round(parts[i2].y);
            pos[i2 * 3 + 2] = Math.round(parts[i2].z);
          }
          cfg.onState({ kind: "pressure", t: t + (st - BURN) / maxSteps, trials,""")

# ---- 3. E10: burn-in before counting crossings (startup imbalance is noise,
# not trapdoor behavior). Search anchored on the current file bytes.
rep("""            if (inSlot && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
              if (door.ang > OPEN_THRESH) { crossLR++; epL++; }
              else { p.x = xPrev; p.vx = -p.vx; }
            } else if (inSlot && p.vx < 0 && door.ang > OPEN_THRESH) {
              crossRL++; epR++;""",
"""            if (inSlot && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
              if (st >= BURN && door.ang > OPEN_THRESH) { crossLR++; epL++; }
              else { p.x = xPrev; p.vx = -p.vx; }
            } else if (st >= BURN && inSlot && p.vx < 0 && door.ang > OPEN_THRESH) {
              crossRL++; epR++;""")

rep("""    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0;
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let epL = 0, epR = 0;
      const angSamples = [];""",
"""    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0;
    const BURN = Math.round(6 / dt);     // 6 s equilibration before counting
    const rows = [];
    for (let t = 0; t < trials; t++) {
      let epL = 0, epR = 0;
      const angSamples = [];""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("pass-9 burn-in + weak bath applied")
