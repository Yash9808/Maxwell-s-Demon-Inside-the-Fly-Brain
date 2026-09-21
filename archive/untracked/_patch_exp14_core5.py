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

# ---- E9: one-way demon valve, two-way random control ------------------------
rep("""          // center wall with the valve slot [-DH/2, DH/2] x [-DH/2, DH/2]
          if (p.x > -8 && p.x < 8 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            if (valve.pos > 0.6) {
              p.x += p.vx > 0 ? 10 : -10;      // pass through
              crossings++; epCross++;
            } else {
              p.x = Math.sign(p.x) * 8; p.vx = -p.vx;
            }
          }""",
"""          // center wall with the valve slot [-DH/2, DH/2] x [-DH/2, DH/2].
          // demon valve: one-way L->R (a Maxwell rectifier). random control:
          // two-way opening (no rectification, no information). never: shut.
          if (p.x > -8 && p.x < 8 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            if (valve.pos > 0.6 && (p.vx > 0 || v.mode === "random")) {
              p.x += p.vx > 0 ? 10 : -10;      // pass through
              crossings++; epCross++;
            } else {
              p.x = Math.sign(p.x) * 8; p.vx = -p.vx;
            }
          }""")

# ---- E9: time-averaged dT / dP instead of a single noisy snapshot -----------
rep("""    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };
    const pist = { x: 0, v: 0 };
    let workU = 0, crossings = 0, bits = 0, opened = 0;""",
"""    const valve = { pos: 0, target: 0, flips: 0, prev: 0, dwell: 0 };
    const pist = { x: 0, v: 0 };
    let workU = 0, crossings = 0, bits = 0, opened = 0;
    let dTsum = 0, dPsum = 0, dN = 0;""")

rep("""        // piston: driven by the volume-aware pressure difference
        const s = _apparatusSideStats(parts, vl, vr);
        const F = (s.pr - s.pl) - SPRING * pist.x;""",
"""        // piston: driven by the volume-aware pressure difference
        const s = _apparatusSideStats(parts, vl, vr);
        dTsum += s.dT; dPsum += (s.pr - s.pl) / Math.max(1e-9, s.pr + s.pl); dN++;
        const F = (s.pr - s.pl) - SPRING * pist.x;""")

rep("""      const vlF = (L / 2 + 8) * H * D;
      const vrF = (PEXT + L / 2 + 8 - pist.x) * H * D;
      const ts = _apparatusSideStats(parts, vlF, vrF);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;
      rows.push({ condition: v.key, phase: "train", trial: t, seed: 1,
                  steps: maxSteps, crossings: epCross,
                  openFraction: openSteps / maxSteps,
                  dPfinal: (ts.pr - ts.pl) / Math.max(1e-9, ts.pl + ts.pr),
                  dTfinal: ts.dT,""",
"""      const vlF = (L / 2 + 8) * H * D;
      const vrF = (PEXT + L / 2 + 8 - pist.x) * H * D;
      const ts = _apparatusSideStats(parts, vlF, vrF);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;
      rows.push({ condition: v.key, phase: "train", trial: t, seed: 1,
                  steps: maxSteps, crossings: epCross,
                  openFraction: openSteps / maxSteps,
                  dPfinal: dN ? dPsum / dN : 0,
                  dTfinal: dN ? dTsum / dN : ts.dT,""")

# ---- E10: while the door is open, BOTH directions pass (honest relaxation) --
rep("""          // center wall: opening only in the door slot (y in [-DH/2, DH/2])
          if (Math.abs(p.x) < 6 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            const s2 = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
            if (wasLeft && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
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
          }""",
"""          // center wall: opening only in the door slot (y in [-DH/2, DH/2]).
          // Impacts from the left swing the door open; while it is open both
          // directions pass — a Smoluchowski flap rectifies nothing on its own.
          if (Math.abs(p.x) < 6 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            const s2 = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
            const openNow = door.ang > OPEN_THRESH;
            if (wasLeft && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
              if (openNow) { p.x += 12; crossLR++; epL++; }
              else { p.x = -6; p.vx = Math.abs(p.vx); }
            } else if (!wasLeft && p.vx < 0) {
              if (openNow) { p.x -= 12; crossRL++; epR++; }
              else { p.x = 6; p.vx = Math.abs(p.vx); }
            } else {
              p.x = Math.sign(p.x) * 6; p.vx = -p.vx;
            }
          }""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("pass-5 physics fixes applied")
