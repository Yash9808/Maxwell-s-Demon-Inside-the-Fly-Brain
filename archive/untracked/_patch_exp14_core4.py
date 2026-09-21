import io

p = "experiment_core.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
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

# ---- E9: fill the whole geometry at init (no fake volume-asymmetry transient),
#          and give each variant an identical, paired seed -------------------
rep("""function _apparatusPart(rng, L, H, D) {
  const sp = 60 + rng() * 50, an = rng() * Math.PI * 2;
  return { x: (rng() - 0.5) * L * 0.9, y: (rng() - 0.5) * H * 0.85,
           z: (rng() - 0.5) * D * 0.85,
           vx: sp * Math.cos(an), vy: sp * Math.sin(an), vz: (rng() - 0.5) * sp * 0.5 };
}""",
"""function _apparatusPart(rng, x0, x1, H, D) {
  const sp = 60 + rng() * 50, an = rng() * Math.PI * 2;
  return { x: x0 + rng() * (x1 - x0), y: (rng() - 0.5) * H * 0.85,
           z: (rng() - 0.5) * D * 0.85,
           vx: sp * Math.cos(an), vy: sp * Math.sin(an), vz: (rng() - 0.5) * sp * 0.5 };
}""")

rep("""  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (const v of variants) {
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(rng, L, H, D));
    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };""",
"""  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 + PEXT - 20, H, D));
    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };""")

# E9 inner loop must use vRng (not the outer rng)
rep("""          bits++;
          const cand = parts[(rng() * parts.length) | 0];
          const speed2 = cand.vx * cand.vx + cand.vy * cand.vy + cand.vz * cand.vz;
          if (v.mode === "speed") valve.target = (speed2 > 95 * 95 && cand.x < 0) ? 1 : 0;
          else if (v.mode === "random") valve.target = rng() < 0.3 ? 1 : 0;""",
"""          bits++;
          const cand = parts[(vRng() * parts.length) | 0];
          const speed2 = cand.vx * cand.vx + cand.vy * cand.vy + cand.vz * cand.vz;
          if (v.mode === "speed") valve.target = (speed2 > 95 * 95 && cand.x < 0) ? 1 : 0;
          else if (v.mode === "random") valve.target = vRng() < 0.3 ? 1 : 0;""")

# ---- E10: paired seeds + impulse-only door physics --------------------------
rep("""  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (const v of variants) {
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(rng, L, H, D));
    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0;""",
"""  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    const parts = [];
    for (let i = 0; i < nP; i++) parts.push(_apparatusPart(vRng, -L / 2 + 20, L / 2 - 20, H, D));
    const door = { ang: 0, vel: 0 };
    let crossLR = 0, crossRL = 0;""")

rep("""            const s2 = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
            if (wasLeft && p.vx > 0) {
              // impact kicks the door open (heavier door: smaller kick)
              door.vel += Math.min(60, s2 * 0.12) / v.mass * dt * 8;
              door.ang = Math.min(1.1, door.ang + Math.min(0.55, (s2 / 300) * 0.5 / (v.mass * 25)));
              if (door.ang > OPEN_THRESH) {""",
"""            const s2 = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
            if (wasLeft && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
              if (door.ang > OPEN_THRESH) {""")

# ---- E11: paired seeds per variant ------------------------------------------
rep("""  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (const v of variants) {
    let ang = 0, fwd = 0, rev = 0, qh = 0, qc = 0;
    let velSm = 0, wob = 0, wobAng = 0;""",
"""  const conditions = {};
  const maxSteps = Math.round(episode / dt);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const vRng = makeRng((cfg.seed !== undefined ? cfg.seed : 1) * 31 + vi * 7919);
    let ang = 0, fwd = 0, rev = 0, qh = 0, qc = 0;
    let velSm = 0, wobAng = 0;""")

rep("""        const pFwd = Math.min(0.5, GAMMA * v.Th * dt);
        const pBack = Math.min(0.5, GAMMA * v.Tc *
                               Math.exp(-(EPS - v.load * STEP * LOADQ) / v.Tc) * dt);
        const r = rng();
        let dAng = 0;
        if (r < pFwd) { dAng = STEP; fwd++; epF++; qh += EPS; }
        else if (r < pFwd + pBack) { dAng = -STEP; rev++; epR++; qc += EPS; }
        ang += dAng;
        velSm += (dAng / dt - velSm) * Math.min(1, dt * 6);""",
"""        const pFwd = Math.min(0.5, GAMMA * v.Th * dt);
        const pBack = Math.min(0.5, GAMMA * v.Tc *
                               Math.exp(-(EPS - v.load * STEP * LOADQ) / v.Tc) * dt);
        const r = vRng();
        let dAng = 0;
        if (r < pFwd) { dAng = STEP; fwd++; epF++; qh += EPS; }
        else if (r < pFwd + pBack) { dAng = -STEP; rev++; epR++; qc += EPS; }
        ang += dAng;
        velSm += (dAng / dt - velSm) * Math.min(1, dt * 6);""")

rep("""        // thermal rattle of the wheel (visual + fluctuation metric)
        wobAng = wobAng * 0.96 + (rng() - 0.5) * v.Th * 0.02;""",
"""        // thermal rattle of the wheel (visual + fluctuation metric)
        wobAng = wobAng * 0.96 + (vRng() - 0.5) * v.Th * 0.02;""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("pass-3 fixes applied (paired seeds, full-geometry init, impulse door)")
