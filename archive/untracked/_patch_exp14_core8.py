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

# ---- shared: gaussian sampler next to the apparatus helpers ------------------
rep("""function _apparatusPart(rng, x0, x1, H, D) {""",
"""/** Maxwell-boundary thermal walls: with probability THERMO_P a molecule
 *  bouncing off a wall is re-emitted with a fresh Maxwell velocity at the
 *  bath temperature (the chamber is in contact with the lab at T_ENV).
 *  Without this, per-side temperatures are frozen initial fluctuations that
 *  never equilibrate and every "never-open" control shows phantom dT. */
function _thermoWalls(rng, parts, dt) {
  const SPEED0 = 86;                     // matches the initial speed distribution
  for (const p of parts) {
    if (rng() < 0.08 * dt * 60) {
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

function _apparatusPart(rng, x0, x1, H, D) {""")

# ---- E9: apply thermal walls after wall reflections --------------------------
rep("""          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          // center wall across the whole y-z face; the valve slot""",
"""          if (Math.abs(p.y) > H / 2) { p.y = Math.sign(p.y) * H / 2; p.vy = -p.vy; }
          if (Math.abs(p.z) > D / 2) { p.z = Math.sign(p.z) * D / 2; p.vz = -p.vz; }
          _thermoWalls(vRng, [p], dt);
          // center wall across the whole y-z face; the valve slot""")

# ---- E10: same thermal-wall contact ------------------------------------------
rep("""            if (inSlot && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));""",
"""            _thermoWalls(vRng, [p], dt);
            if (inSlot && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("pass-8 thermal walls added")
