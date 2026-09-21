import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# ---- 1. sparse deterministic synthesis (fixes 100k-gradient page lock) ------
rep("""  const n = ANAT.meta.n;
  const out = new Uint8Array(n);
  for (const [rk, ids] of mem){
    const v = (regRate[rk] || 0) / (mx || 1);
    for (const i of ids){
      const jit = 0.7 + 0.6 * (((i * 2654435761) >>> 16 & 255) / 255);
      out[i] = Math.min(255, Math.round(6 + v * 190 * jit));
    }
  }
  return { vec: out, measured: false };""",
"""  const n = ANAT.meta.n;
  const out = new Uint8Array(n);
  // sparse deterministic activation: only a hash-selected fraction of each
  // region's neurons is marked active (sparse coding — and it keeps these
  // 100k-neuron canvases cheap enough to render per condition)
  for (const [rk, ids] of mem){
    const v = (regRate[rk] || 0) / (mx || 1);
    if (v <= 0) continue;
    const thresh = 0.03 + 0.12 * v;                        // 3%–15% of the pool
    const cap = Math.min(ids.length, Math.round(800 + 1800 * v));
    let cnt = 0;
    for (const i of ids){
      if (cnt >= cap) break;
      const h = ((i * 2654435761) >>> 16) & 1023;
      if (h >= thresh * 1024) continue;
      const jit = 0.7 + 0.6 * ((h & 255) / 255);
      out[i] = Math.min(255, Math.round(40 + v * 190 * jit));
      cnt++;
    }
  }
  return { vec: out, measured: false };""")

# ---- 2. 3D figure: hull verts are 1/10 scale — multiply by 10 like the 2D maps
rep("""          for (let v = 0; v < t.length; v += 9){
            const a = proj3(t[v], t[v+1], t[v+2], pr, ox, oy, pw, ph);
            const b = proj3(t[v+3], t[v+4], t[v+5], pr, ox, oy, pw, ph);
            const c = proj3(t[v+6], t[v+7], t[v+8], pr, ox, oy, pw, ph);
            g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]);
          }""",
"""          for (let v = 0; v < t.length; v += 9){
            const a = proj3(t[v]*10, t[v+1]*10, t[v+2]*10, pr, ox, oy, pw, ph);
            const b = proj3(t[v+3]*10, t[v+4]*10, t[v+5]*10, pr, ox, oy, pw, ph);
            const c = proj3(t[v+6]*10, t[v+7]*10, t[v+8]*10, pr, ox, oy, pw, ph);
            g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]);
          }""")

# ---- 3. drop unused constant -------------------------------------------------
rep("""  const RDELTA = 0.10;                        // region-ball radius (FAFB units)
  const regionPoints = {};""",
"""  const regionPoints = {};""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("sparse synthesis + hull x10 scale fixed OK")
