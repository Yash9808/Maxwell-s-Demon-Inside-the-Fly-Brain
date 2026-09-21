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

# ---- E9: full-face wall with crossing detection -----------------------------
rep("""          // center wall with the valve slot [-DH/2, DH/2] x [-DH/2, DH/2].
          // demon valve: one-way L->R (a Maxwell rectifier). random control:
          // two-way opening (no rectification, no information). never: shut.
          if (p.x > -8 && p.x < 8 && Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2) {
            if (valve.pos > 0.6 && (p.vx > 0 || v.mode === "random")) {
              p.x += p.vx > 0 ? 10 : -10;      // pass through
              crossings++; epCross++;
            } else {
              p.x = Math.sign(p.x) * 8; p.vx = -p.vx;
            }
          }""",
"""          // center wall across the whole y-z face; the valve slot
          // [-DH/2, DH/2] x [-DH/2, DH/2] opens per the demon's rule:
          // speed = one-way L->R rectifier, random = two-way opening
          // (no information, no rectification), never = always shut.
          const xPrev = p.x - p.vx * dt;
          if ((p.x >= 0) !== (xPrev >= 0)) {
            const inSlot = Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2;
            const passable = valve.pos > 0.6 && (v.mode === "random" ? true : p.vx > 0);
            if (inSlot && passable) {
              crossings++; epCross++;          // through the valve
            } else {
              p.x = xPrev; p.vx = -p.vx;       // reflect off the wall
            }
          }""")

# ---- E10: same full-face wall fix -------------------------------------------
rep("""          // center wall: opening only in the door slot (y in [-DH/2, DH/2]).
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
          }""",
"""          // center wall across the whole face; the door slot opens only in
          // [-DH/2, DH/2] x [-DH/2, DH/2] while the flap is lifted. Impacts
          // from the left kick it open; while open BOTH directions pass — a
          // Smoluchowski flap rectifies nothing on its own.
          const xPrev = p.x - p.vx * dt;
          if ((p.x >= 0) !== (xPrev >= 0)) {
            const inSlot = Math.abs(p.z) < DH / 2 && Math.abs(p.y) < DH / 2;
            if (inSlot && p.vx > 0) {
              // impact impulse: heavier door swings slower, so it needs more
              // hits before the spring-loaded angle clears the passage
              door.vel = Math.min(25, door.vel + 60 / (v.mass * 80));
              if (door.ang > OPEN_THRESH) { crossLR++; epL++; }
              else { p.x = xPrev; p.vx = -p.vx; }
            } else if (inSlot && p.vx < 0 && door.ang > OPEN_THRESH) {
              crossRL++; epR++;
            } else {
              p.x = xPrev; p.vx = -p.vx;
            }
          }""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("pass-7 wall geometry fixed")
