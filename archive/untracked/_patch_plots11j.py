import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()

BAD = ('const REGION_ORDER = ["optic", "antennal", "mb", "lh", "cx", "motor", "central"];\n'
       'hanges\n  const cached = {};')

GOOD = '''const REGION_ORDER = ["optic", "antennal", "mb", "lh", "cx", "motor", "central"];
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
    g.fillStyle = "#8b98a5"; g.fillText("anatomy positions loading\u2026", 8, H / 2); return;
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
  const cxw = (B.x0 + B.x1) / 2, cyw = (B.y0 + B.y1) / 2;
  // depth-cache: z-rotate once; per-condition only the tint changes
  const cached = {};'''

c = d.count(BAD)
assert c == 1, "corruption anchor x%d" % c
d = d.replace(BAD, GOOD)

assert d.count("function collectBrainDeltas") == 1, d.count("function collectBrainDeltas")
assert d.count("function drawDeltaBrainFigure") == 1, d.count("function drawDeltaBrainFigure")
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("figure header restored; single collectBrainDeltas kept")
