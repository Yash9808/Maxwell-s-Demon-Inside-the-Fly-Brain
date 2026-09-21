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

rep("""      const ts = _apparatusSideStats(parts, vl, vr);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;""",
    """      const vlF = (L / 2 + 8) * H * D;
      const vrF = (PEXT + L / 2 + 8 - pist.x) * H * D;
      const ts = _apparatusSideStats(parts, vlF, vrF);
      const erasureCostJ = bits * kB_J * T_ENV * Math.LN2;""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("scope fix applied")
