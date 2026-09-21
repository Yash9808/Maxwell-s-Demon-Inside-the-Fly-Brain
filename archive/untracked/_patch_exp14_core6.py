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

rep("  const L = 900, H = 420, D = 420, DH = 190, PEXT = 160;",
    "  const L = 900, H = 420, D = 420, DH = 240, PEXT = 160;")

rep("""        // demon decision: measure one particle (1 bit), set the valve
        valve.dwell -= dt;
        if (valve.dwell <= 0) {
          bits++;
          const cand = parts[(vRng() * parts.length) | 0];
          const speed2 = cand.vx * cand.vx + cand.vy * cand.vy + cand.vz * cand.vz;
          if (v.mode === "speed") valve.target = (speed2 > 95 * 95 && cand.x < 0) ? 1 : 0;
          else if (v.mode === "random") valve.target = vRng() < 0.3 ? 1 : 0;
          else valve.target = 0;
          if (valve.target !== valve.prev) { valve.flips++; valve.prev = valve.target; }
          if (valve.target) opened++;
          valve.dwell = 0.12;
        }""",
"""        // demon decision: measure one particle AT THE VALVE (1 bit), set valve.
        // The demon looks at molecules arriving at its door, not anywhere in
        // the chamber; a random control flips the gate with no information.
        valve.dwell -= dt;
        if (valve.dwell <= 0) {
          bits++;
          if (v.mode === "random") {
            valve.target = vRng() < 0.3 ? 1 : 0;
          } else if (v.mode === "speed") {
            let best = null;
            for (const q of parts) {
              if (q.x < 0 && q.x > -60 && Math.abs(q.z) < DH / 2 && Math.abs(q.y) < DH / 2) {
                const v2q = q.vx * q.vx + q.vy * q.vy + q.vz * q.vz;
                if (!best || v2q > best.v2) best = { v2: v2q, vx: q.vx };
              }
            }
            valve.target = (best && best.v2 > 95 * 95 && best.vx > 0) ? 1 : 0;
          } else {
            valve.target = 0;
          }
          if (valve.target !== valve.prev) { valve.flips++; valve.prev = valve.target; }
          if (valve.target) opened++;
          valve.dwell = 0.25;
        }""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("pass-6 demon-valve signal applied")
