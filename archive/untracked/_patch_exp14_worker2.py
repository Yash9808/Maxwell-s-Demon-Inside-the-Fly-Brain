import io

p = "experiment_worker.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in d else "\n"
def nl(s): return s.replace("\r\n", "\n").replace("\n", NL)

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# ---- generic apparatus curve: block-average EVERY numeric row field (vs the
# fixed demon field list in buildCurve) so each apparatus gets honest charts.
rep("""  function buildCurve() {""",
"""  // Apparatus variant: block-average every numeric field the rows carry
  // (piston, work, door angle, net rotation, ...) — the plots page renders
  // these per experiment; fields a row lacks become null.
  function buildApparatusCurve(B) {
    const curve = [];
    for (const [key, rows] of Object.entries(trialRows)) {
      const fields = new Set();
      for (const r of rows) for (const f of Object.keys(r))
        if (typeof r[f] === "number" && Number.isFinite(r[f])) fields.add(f);
      fields.delete("seed");
      const bCount = Math.max(1, Math.floor(rows.length / B));
      for (let b = 0; b < bCount; b++) {
        const seg = rows.slice(b * B, (b + 1) * B);
        if (!seg.length) continue;
        const pt = { cond: key, block: b, phase: seg[0].phase };
        for (const f of fields) {
          let s = 0, n = 0;
          for (const r of seg) { const v = r[f]; if (Number.isFinite(v)) { s += v; n++; } }
          pt[f] = n ? s / n : null;
        }
        curve.push(pt);
      }
    }
    return curve;
  }

  function buildCurve() {""")

# ---- emit uses the selected builder ------------------------------------------
rep("""  function emit(expId_, phase, trial, nTrials, seedIdx, force) {
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;   // throttle UI chatter
    lastEmit = now;
    const { curve, live } = buildCurve();""",
"""  let curveBuilder = buildCurve;   // apparatus branch swaps in the generic one
  function emit(expId_, phase, trial, nTrials, seedIdx, force) {
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;   // throttle UI chatter
    lastEmit = now;
    const built = curveBuilder();
    const curve = built.curve || built, live = built.live || {};""")

# ---- apparatus branch: select builder, send flat rows + apparatus curve ------
rep("""  if (spec.apparatus) {
    const coreFn = CORE[spec.apparatus];
    const nTrials = train + test;
    try {""",
"""  if (spec.apparatus) {
    const coreFn = CORE[spec.apparatus];
    const nTrials = train + test;
    curveBuilder = () => buildApparatusCurve(4);
    try {""")

rep("""      const { curve } = buildCurve();
      const conditions = {};
      for (const [key, cond] of Object.entries(res.conditions)) {
        const { _apparatus, ...rest } = cond;
        conditions[key] = rest;
      }""",
"""      const curve = buildApparatusCurve(4);
      const conditions = {};
      const flatRows = [];
      for (const [key, cond] of Object.entries(res.conditions)) {
        const { _apparatus, ...rest } = cond;
        conditions[key] = rest;
        for (const r of (trialRows[key] || [])) flatRows.push(r);
      }""")

rep("""      postMessage({ type: "done", expId, summary: { conditions, curve },
                    rows: [], provenance: prov, apparatus: spec.apparatusEnv });""",
"""      postMessage({ type: "done", expId, summary: { conditions, curve },
                    rows: flatRows, provenance: prov, apparatus: spec.apparatusEnv });""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("worker apparatus rows + generic curve done")
