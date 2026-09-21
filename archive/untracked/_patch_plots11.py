import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# ---------------- 1. card copy ------------------------------------------------
rep("""      <div class="sub">per-region firing change across training (second half minus first half of train trials);
      blue = fires less after learning, red = fires more; one snapshot per experiment, click to download</div>""",
"""      <div class="sub">3D fly brain (real FAFB v783 anatomy) showing WHERE training changed firing —
      one region + one pathway highlighted per condition: red = fires more after learning,
      blue = fires less, gray = unchanged; one snapshot per experiment, click to download</div>""")

rep("""      <div id="deltaGallery"><div class="empty">no delta snapshots yet — finish an experiment with a fly brain (E2–E5, E7, E8)</div></div>
      <div class="dlbar"><button id="dlDeltaSheet">⬇ all deltas · six brains figure (PNG)</button></div>""",
"""      <div id="deltaGallery"><div class="empty">no 3D brain deltas yet — finish an experiment with a fly brain (E2–E5, E7, E8)</div></div>
      <div class="dlbar"><button id="dlDeltaSheet">⬇ all deltas · 3D brains figure (PNG)</button></div>""")

# ---------------- 2. new region-keyed delta collection + 3D figure ------------
NEW_BLOCK = r"""
// ---- learning-delta 3D brain figure -----------------------------------------
// WHERE did learning change firing? Aggregate the controllers' layer rates
// into six functional brain regions, then render the real FAFB v783 anatomy
// in 3D (axon view): translucent region hulls, neurons tinted by their
// late−early change, the most-changed region ringed, and ONE curved arrow
// from sensory input to motor output through the learning structure.
const REGION_STYLE = {
  optic:   { hue: 205, color: "dodgerblue"  },
  antennal:{ hue: 150, color: "seagreen"    },
  mb:      { hue: 50,  color: "gold"        },
  lh:      { hue: 25,  color: "orange"      },
  cx:      { hue: 280, color: "orchid"      },
  motor:   { hue: 0,   color: "tomato"      },
  central: { hue: 210, color: "lightslategray" }
};
const REGION_TITLE = { optic: "optic lobe", antennal: "antennal lobe", mb: "mushroom body",
                       lh: "lateral horn", cx: "central complex", motor: "motor (GNG)",
                       central: "central brain" };
const REGION_ORDER = ["optic", "antennal", "mb", "lh", "cx", "motor", "central"];
function collectBrainDeltas(rows){
  if (!rows || !rows.length) return null;
  const withRates = rows.filter(r => r.layerRates);
  if (!withRates.length) return null;
  const layerNames = Object.keys(withRates[0].layerRates);
  if (!layerNames.length) return null;
  const groups = new Map();
  for (const r of withRates){
    const g = r.condition || "model";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const conds = [...groups.keys()];
  const stat = (rs, lo, hi, ph) => {
    const sums = new Float64Array(layerNames.length); let n = 0;
    for (const r of rs){
      if (ph && r.phase !== ph) continue;
      if (r.trial < lo || r.trial >= hi) continue;
      layerNames.forEach((ln, k) => sums[k] += r.layerRates[ln] || 0);
      n++;
    }
    return { sums, n };
  };
  let vmax = 0;
  const deltas = conds.map((c) => {
    const rs = groups.get(c);
    const tr = rs.map(r => r.trial);
    const lo = Math.min(...tr), hi = Math.max(...tr) + 1, mid = Math.floor((lo + hi) / 2);
    const early = stat(rs, lo, mid, "train"), late = stat(rs, mid, hi, "train");
    return layerNames.map((ln, k) => {
      const e = early.n ? early.sums[k] / early.n : 0;
      const l = late.n ? late.sums[k] / late.n : 0;
      const dr = l - e;
      vmax = Math.max(vmax, Math.abs(dr));
      return dr;
    });
  });
  if (!vmax) return null;
  return { conds, layers: layerNames, matrix: deltas, vmax };
}
// 3D axon view of the fly brain: rotate each neuron's (x, z) about the
// brain's centre (depth-ordered painter's sort, screen y = world y).
function drawDeltaBrainFigure(canvas, data, title){
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#e6edf3";
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  g.fillStyle = fg; g.font = "bold 13px ui-sans-serif,system-ui"; g.textAlign = "left";
  g.fillText(title, 8, 16);
  const B = anatBounds();
  if (!B || !ANAT.ready){
    g.fillStyle = "#8b98a5"; g.fillText("anatomy positions loading…", 8, H / 2); return;
  }
  const conds = data.conds, n = ANAT.meta.n;
  // per-condition region deltas: aggregate layer deltas through regionForRateName
  const condReg = conds.map((c, ci) => {
    const acc = {};
    data.layers.forEach((ln, k) => {
      const rk = regionForRateName(ln);
      acc[rk] = (acc[rk] || 0) + data.matrix[ci][k];
    });
    return acc;
  });
  // shared color scale across the figure's panels
  let gmax = 1e-12;
  for (const acc of condReg) for (const rk in acc) gmax = Math.max(gmax, Math.abs(acc[rk]));
  const cols = Math.max(1, Math.min(conds.length, 3));
  const pw = Math.floor((W - 40) / cols) - 14, ph = H - 96;
  const cxw = (B.x0 + B.x1) / 2, czw = 0;
  // depth-cache: z-rotate once; per-condition only the tint changes
  const cached = {};
  const projFor = (yawDeg) => {
    const key = yawDeg.toFixed(0);
    if (cached[key]) return cached[key];
    const yaw = yawDeg * Math.PI / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const pts = new Float32Array(n * 3);   // sx, sy, depth
    const bsz = Math.max(B.x1 - B.x0, 1);
    for (let i = 0; i < n; i++){
      const x = ANAT.pos[i*3] - cxw, y = ANAT.pos[i*3+1], z = ANAT.pos[i*3+2];
      const rx = x * cy - z * sy, rz = x * sy + z * cy;
      const s = Math.min(pw / bsz, ph / Math.max(1, B.y1 - B.y0)) * 0.98;
      pts[i*3] = pw / 2 + rx * s;
      pts[i*3+1] = ph / 2 - y * s;
      pts[i*3+2] = rz;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[a*3+2] - pts[b*3+2]);
    const out = { pts, order, key };
    cached[key] = out;
    return out;
  };
  const pairs = conds.map((c, ci) => ({ c, ci, acc: condReg[ci] }));
  pairs.sort((a, b) => {
    const top = (o) => { let mk = "central", mv = -1e9;
      for (const rk in o){ const v = Math.abs(o[rk]); if (v > mv){ mv = v; mk = rk; } } return mk; };
    return REGION_ORDER.indexOf(top(a.acc)) - REGION_ORDER.indexOf(top(b.acc));
  });
  const YAW = { optic: 0, antennal: 10, mb: 35, lh: 50, cx: 65, motor: 80, central: 25 };
  const PATH = { optic:   ["optic", "central", "motor"],
                 antennal:["antennal", "lh", "mb", "motor"],
                 mb:      ["antennal", "mb", "motor"],
                 lh:      ["antennal", "lh", "motor"],
                 cx:      ["optic", "cx", "motor"],
                 motor:   ["central", "motor"],
                 central: ["antennal", "central", "motor"] };
  const RDELTA = 0.10;                        // region-ball radius (FAFB units)
  const regionPoints = {};
  for (let i = 0; i < n; i++){
    const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
    if (!rk) continue;
    (regionPoints[rk] = regionPoints[rk] || { x: 0, y: 0, z: 0, n: 0 });
    regionPoints[rk].x += ANAT.pos[i*3]; regionPoints[rk].y += ANAT.pos[i*3+1];
    regionPoints[rk].z += ANAT.pos[i*3+2]; regionPoints[rk].n++;
  }
  pairs.forEach((p, pi) => {
    const acc = p.acc;
    let top = "central", mv = -1e9, sign = 0;
    for (const rk in acc){ const v = Math.abs(acc[rk]); if (v > mv){ mv = v; top = rk; sign = Math.sign(acc[rk]); } }
    const yaw = YAW[top] !== undefined ? YAW[top] : 25;
    const ox = 20 + pi * (pw + 14), oy = 44;
    const pr = projFor(yaw);
    const pts = pr.pts, order = pr.order;
    // hull silhouettes, depth-sorted back-to-front with the dots
    const byReg = {};
    if (ANAT.hulls && ANAT.hulls.length){
      for (const hl of ANAT.hulls){
        const rk = ANAT.npRegion.get(hl.name) || "central";
        (byReg[rk] = byReg[rk] || []).push(hl);
      }
    }
    const items = [];
    for (const rk in byReg){
      let z = 0, cnt = 0;
      for (const hl of byReg[rk]){ const t = hl.tri;
        for (let v = 0; v < t.length; v += 9){ z += t[v+2] + t[v+5] + t[v+8]; cnt += 3; } }
      items.push({ kind: "hull", rk, z: cnt ? z / cnt : 0, hulls: byReg[rk] });
    }
    items.push({ kind: "dots", rk: null, z: 1e9 });
    items.sort((a, b) => a.z - b.z);
    // region-delta tint for this panel
    const tintOf = (rk) => {
      const dv = acc[rk] || 0, t = dv / gmax;
      if (Math.abs(t) < 0.06) return "rgba(140,150,165,0.16)";   // unchanged: gray
      return t > 0 ? "rgba(229,57,53," + (0.14 + 0.5 * Math.min(1, Math.abs(t))).toFixed(2) + ")"
                   : "rgba(30,136,229," + (0.14 + 0.5 * Math.min(1, Math.abs(t))).toFixed(2) + ")";
    };
    for (const it of items){
      if (it.kind === "hull"){
        const col = tintOf(it.rk);
        for (const hl of it.hulls){
          const t = hl.tri; g.beginPath();
          for (let v = 0; v < t.length; v += 9){
            const a = proj3(t[v], t[v+1], t[v+2], pr, ox, oy, pw, ph);
            const b = proj3(t[v+3], t[v+4], t[v+5], pr, ox, oy, pw, ph);
            const c = proj3(t[v+6], t[v+7], t[v+8], pr, ox, oy, pw, ph);
            g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]);
          }
          g.closePath(); g.fillStyle = col; g.fill();
          if (it.rk === top){ g.strokeStyle = sign >= 0 ? "rgba(255,120,110,0.8)" : "rgba(100,180,255,0.8)";
            g.lineWidth = 0.7; g.stroke(); }
        }
      } else {
        for (const i of order){
          const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
          if (rk === top) continue;
          g.fillStyle = "rgba(120,132,148,0.30)";
          g.fillRect(ox + pts[i*3] - 0.5, oy + pts[i*3+1] - 0.5, 1.1, 1.1);
        }
      }
    }
    // firing-delta dots of the learning region on top
    const tcol = sign >= 0 ? [229, 57, 53] : [30, 136, 229];
    for (const i of order){
      const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
      if (rk !== top) continue;
      g.fillStyle = "rgba(" + tcol[0] + "," + tcol[1] + "," + tcol[2] + ",0.75)";
      g.fillRect(ox + pts[i*3] - 0.6, oy + pts[i*3+1] - 0.6, 1.3, 1.3);
    }
    // ONE pathway: curved arrow from sensory input through the top region to motor
    const chain = (PATH[top] || PATH.central).slice();
    if (chain.indexOf(top) < 0) chain.splice(1, 0, top);
    const cps = [];
    for (const rk of chain){
      const c3 = regionPoints[rk];
      if (!c3) continue;
      cps.push(proj3(c3.x / c3.n, c3.y / c3.n, c3.z / c3.n, pr, ox, oy, pw, ph));
    }
    if (cps.length >= 2){
      g.strokeStyle = sign >= 0 ? "rgba(255,140,130,0.95)" : "rgba(120,190,255,0.95)";
      g.lineWidth = 1.6; g.setLineDash([]);
      g.beginPath(); g.moveTo(cps[0][0], cps[0][1]);
      for (let i2 = 1; i2 < cps.length; i2++){
        const mx = (cps[i2-1][0] + cps[i2][0]) / 2, my = (cps[i2-1][1] + cps[i2][1]) / 2;
        const dx = cps[i2][0] - cps[i2-1][0], dy = cps[i2][1] - cps[i2-1][1];
        const len = Math.hypot(dx, dy) || 1;
        g.quadraticCurveTo(mx - dy / len * 12, my + dx / len * 12, cps[i2][0], cps[i2][1]);
      }
      g.stroke();
      const e = cps[cps.length - 1], pe = cps[cps.length - 2];
      const ang = Math.atan2(e[1] - pe[1], e[0] - pe[0]);
      g.beginPath(); g.moveTo(e[0], e[1]);
      g.lineTo(e[0] - 7 * Math.cos(ang - 0.45), e[1] - 7 * Math.sin(ang - 0.45));
      g.lineTo(e[0] - 7 * Math.cos(ang + 0.45), e[1] - 7 * Math.sin(ang + 0.45));
      g.closePath(); g.fillStyle = g.strokeStyle; g.fill();
    }
    // node dots + label
    for (const rk of chain){
      const c3 = regionPoints[rk]; if (!c3) continue;
      const q = proj3(c3.x / c3.n, c3.y / c3.n, c3.z / c3.n, pr, ox, oy, pw, ph);
      g.beginPath(); g.arc(q[0], q[1], 2.4, 0, 7);
      g.fillStyle = (REGION_STYLE[rk] || REGION_STYLE.central).color; g.fill();
      g.strokeStyle = "#0d1117"; g.lineWidth = 1; g.stroke();
    }
    g.fillStyle = fg; g.font = "10px ui-sans-serif,system-ui";
    const dtop = acc[top] || 0;
    g.fillText(p.c + " — " + (REGION_TITLE[top] || top) + " · Δ " + (dtop >= 0 ? "+" : "") + dtop.toFixed(2), ox, oy + ph + 14);
    function proj3(x, y, z, P, ox2, oy2, pw2, ph2){
      const yaw2 = yaw * Math.PI / 180, cy2 = Math.cos(yaw2), sy2 = Math.sin(yaw2);
      const rx = (x - cxw) * cy2 - z * sy2;
      const s = Math.min(pw2 / Math.max(1, B.x1 - B.x0), ph2 / Math.max(1, B.y1 - B.y0)) * 0.98;
      return [ox2 + pw2 / 2 + rx * s, oy2 + ph2 / 2 - y * s];
    }
  });
  // shared diverging colorbar
  const cbX = W - 30, cbY = 44, cbH = ph;
  for (let y = 0; y < cbH; y++){ g.fillStyle = divColor(1 - 2 * y / cbH); g.fillRect(cbX, cbY + y, 7, 1); }
  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("+" + gmax.toPrecision(2), cbX + 10, cbY + 8);
  g.fillText("−" + gmax.toPrecision(2), cbX + 10, cbY + cbH);
  g.fillStyle = "#8b98a5"; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("real FAFB v783 · red = fires more after learning · blue = less · ring = most-changed region · arrow = one pathway → motor", 20, H - 12);
}
"""

rep("""// ---- learning-delta heatmaps (late - early, diverging colors) --------------
// diverging blue-white-red: t in [-1,1]; deltas need sign, jet is for magnitude
function divColor(t){""",
NEW_BLOCK + """
// diverging blue-white-red: t in [-1,1]; deltas need sign, jet is for magnitude
function divColor(t){""")

# ---------------- 3. snapshot capture renders the 3D figure -------------------
rep("""  let deltaURL = null;
  const dd = collectBrainDeltas(LAST_ROWS || []);
  if (dd){
    const cvD = document.createElement("canvas");
    cvD.width = 1000; cvD.height = 30 + Math.max(2, dd.conds.length) * 40 + 46;
    drawMiniDeltaHeatmap(cvD, dd, label + " — Δ firing (late − early)");
    deltaURL = cvD.toDataURL("image/png");
  }""",
"""  let deltaURL = null;
  const dd = collectBrainDeltas(LAST_ROWS || []);
  if (dd){
    const cvD = document.createElement("canvas");
    cvD.width = 940; cvD.height = 430;
    drawDeltaBrainFigure(cvD, dd, label + " — Δ firing (late − early)");
    deltaURL = cvD.toDataURL("image/png");
  }""")

# ---------------- 4. contact-sheet caption ------------------------------------
rep("""  g.fillText("Six fly brains — firing change across training (late − early, diverging scale)", 24, 30);
  g.font = "11px ui-sans-serif,system-ui"; g.fillStyle = "#8b98a5";
  g.fillText("blue = fires less after learning · red = fires more · per condition where the experiment has several", 24, 48);""",
"""  g.fillText("Six fly brains — WHERE learning changed firing (3D, late − early)", 24, 30);
  g.font = "11px ui-sans-serif,system-ui"; g.fillStyle = "#8b98a5";
  g.fillText("one region + one pathway highlighted per condition · red = fires more, blue = fires less · real FAFB v783 anatomy", 24, 48);""")

# ---------------- 5. sheet cells sized for the 3D panels ----------------------
rep("""  const keys = galleryKeys().filter(k => GALLERY.get(k).deltaURL);
  if (!keys.length) return;
  const cols = 3, cellW = 500, cellH = 220;""",
"""  const keys = galleryKeys().filter(k => GALLERY.get(k).deltaURL);
  if (!keys.length) return;
  const cols = 3, cellW = 500, cellH = 250;""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("experiment_plots.html patched OK")
