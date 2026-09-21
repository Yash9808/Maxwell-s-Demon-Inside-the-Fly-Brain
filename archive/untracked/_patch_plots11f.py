import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# Replace per-triangle fill+stroke with uniform region tints (single alpha
# application, no stacking flood) and a soft silhouette glow for the ring.
rep("""      if (it.kind === "hull"){
        const col = tintOf(it.rk);
        for (const hl of it.hulls){
          const t = hl.tri; g.beginPath();
          for (let v = 0; v < t.length; v += 9){
            const a = proj3(t[v]*10, t[v+1]*10, t[v+2]*10, pr, ox, oy, pw, ph);
            const b = proj3(t[v+3]*10, t[v+4]*10, t[v+5]*10, pr, ox, oy, pw, ph);
            const c = proj3(t[v+6]*10, t[v+7]*10, t[v+8]*10, pr, ox, oy, pw, ph);
            g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]);
          }
          g.closePath(); g.fillStyle = col; g.fill();
          if (it.rk === top){ g.strokeStyle = sign >= 0 ? "rgba(255,120,110,0.85)" : "rgba(100,180,255,0.85)";
            g.lineWidth = 1; g.stroke(); }
        }
      } else {""",
"""      if (it.kind === "hull"){
        const col = tintOf(it.rk);
        // uniform region tint: fill all triangles opaque into a scratch
        // canvas, then composite once at the tint's alpha (per-triangle
        // alpha stacking floods large regions like the optic lobe)
        const oc = document.createElement("canvas"); oc.width = Math.max(1, pw); oc.height = Math.max(1, ph);
        const og = oc.getContext("2d"); og.fillStyle = "#fff";
        for (const hl of it.hulls){
          const t = hl.tri; og.beginPath();
          for (let v = 0; v < t.length; v += 9){
            const a = proj3(t[v]*10, t[v+1]*10, t[v+2]*10, pr, ox, oy, pw, ph);
            const b = proj3(t[v+3]*10, t[v+4]*10, t[v+5]*10, pr, ox, oy, pw, ph);
            const c = proj3(t[v+6]*10, t[v+7]*10, t[v+8]*10, pr, ox, oy, pw, ph);
            og.moveTo(a[0] - ox, a[1] - oy); og.lineTo(b[0] - ox, b[1] - oy); og.lineTo(c[0] - ox, c[1] - oy);
          }
          og.closePath(); og.fill();
        }
        const tc = document.createElement("canvas"); tc.width = oc.width; tc.height = oc.height;
        const tg2 = tc.getContext("2d");
        tg2.drawImage(oc, 0, 0);
        tg2.globalCompositeOperation = "source-in";
        tg2.fillStyle = col.replace(/,[\\d.]+\\)$/, ",1)");
        tg2.fillRect(0, 0, tc.width, tc.height);
        const ma = col.match(/([\\d.]+)\\)$/);
        g.globalAlpha = ma ? Math.min(1, parseFloat(ma[1])) : 1;
        g.drawImage(tc, ox, oy);
        g.globalAlpha = 1;
        // most-changed region: soft glow silhouette instead of stroking
        // every triangle (thousands of tiny strokes read as a solid fill)
        if (it.rk === top && Math.abs(acc[top] || 0) >= 0.15 * gmax){
          const sc = document.createElement("canvas"); sc.width = oc.width; sc.height = oc.height;
          const sg2 = sc.getContext("2d");
          sg2.shadowColor = sign >= 0 ? "rgba(255,120,110,0.9)" : "rgba(100,180,255,0.9)";
          sg2.shadowBlur = 7;
          sg2.drawImage(oc, 0, 0);
          sg2.globalCompositeOperation = "destination-out";
          sg2.drawImage(oc, 0, 0);
          g.drawImage(sc, ox, oy);
        }
      } else {""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("uniform tints + silhouette glow OK")
