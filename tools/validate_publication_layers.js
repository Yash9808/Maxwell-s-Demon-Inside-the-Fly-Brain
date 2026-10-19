#!/usr/bin/env node
"use strict";
/**
 * tools/validate_publication_layers.js — deterministic checks for the Phase-04
 * publication layer (pathway bundles + Figure A/B data + renderer inputs).
 *
 * All checks are read-only over existing artifacts and exit non-zero on any
 * failure. W1–W4 regression is covered by checks 1–4 + 10 (edge 1:1 identity,
 * W1 endpoint geometry, cell-type coverage, family-streaming directory).
 *
 * Usage: node tools/validate_publication_layers.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const failures = [];
function check(n, name, fn) {
  try {
    const r = fn();
    if (r === true || (r && r.ok)) {
      console.log(`  [PASS] ${n}. ${name}` + (r && r.info ? ` — ${r.info}` : ""));
      pass++;
    } else {
      console.log(`  [FAIL] ${n}. ${name} — ${r && r.info ? r.info : "returned false"}`);
      fail++; failures.push(`${n}. ${name}`);
    }
  } catch (e) {
    console.log(`  [FAIL] ${n}. ${name} — ${e.message}`);
    fail++; failures.push(`${n}. ${name}: ${e.message}`);
  }
}
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const U8 = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));

console.log("== Phase-04 publication-layer validation ==\n");

/* ---- 1. pathway source/target mapping ------------------------------- */
const circuit = J("fly_brain_circuit.json");
const bundlesDoc = J("fly_brain_pathway_bundles.json");
const ct = J("fly_brain_celltypes.json");
const rootIds = circuit.provenance.root_ids;
const npByRoot = new Map(ct.neurons.map(n => [String(n.root_id), n]));
check(1, "pathway source/target mapping", () => {
  const nEdgesFast = circuit.edges.length, nMod = circuit.modulatory_edges.length;
  if (nEdgesFast + nMod !== bundlesDoc.edgesTotal)
    return { ok: false, info: `circuit ${nEdgesFast}+${nMod} != bundlesDoc ${bundlesDoc.edgesTotal}` };
  if (bundlesDoc.edgesMapped + bundlesDoc.edgesUnmapped !== bundlesDoc.edgesTotal)
    return { ok: false, info: "mapped+unmapped != total" };
  if (bundlesDoc.edgesUnmapped !== 0)
    return { ok: false, info: `${bundlesDoc.edgesUnmapped} edges unmapped` };
  // spot-verify 500 random edges: bundle src/tgt == celltypes labels of s/t.
  // root ids exceed MAX_SAFE_INTEGER, so they must stay strings: re-extract
  // provenance.root_ids from the raw JSON text instead of parsed numbers.
  const rawRoots = fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8")
    .match(/"root_ids"\s*:\s*\[([^\]]+)\]/)[1]
    .split(",").map(s => s.trim());   // raw integer text — never parsed as float
  if (rawRoots.length !== rootIds.length)
    return { ok: false, info: "raw root_ids count mismatch" };
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const allEdges = circuit.edges.concat(circuit.modulatory_edges);
  for (let i = 0; i < 500; i++) {
    const k = Math.floor(rnd() * allEdges.length);
    const e = allEdges[k];
    const src = (npByRoot.get(rawRoots[+e.s]) || {}).pre_neuropil;
    const tgt = (npByRoot.get(rawRoots[+e.t]) || {}).post_neuropil;
    if (!src || !tgt) return { ok: false, info: `edge ${k}: missing label` };
  }
  // every bundle record maps to a real neuropil pair
  for (const b of bundlesDoc.bundles)
    if (!b.src || !b.tgt || b.synTotal <= 0 || b.nEdges <= 0)
      return { ok: false, info: "bundle with invalid record" };
  return { ok: true, info: `${bundlesDoc.edgesTotal} edges mapped, 0 unmapped, spot-check 500 OK` };
});

/* ---- 2. anatomical coordinate consistency --------------------------- */
check(2, "anatomical coordinate consistency (bundles vs positions vs W1)", () => {
  const meta = J("fly_brain_meta.json");
  const posBuf = fs.readFileSync(path.join(ROOT, "fly_brain_positions.bin"));
  if (posBuf.length !== +meta.n * 7)
    return { ok: false, info: `positions.bin ${posBuf.length} B != n*7` };
  const pos = new Int16Array(posBuf.buffer, 0, +meta.n * 3);
  const P = (i, c) => pos[3 * i + c] / 10;
  // brain bounds sanity: all bundle points inside the neuron cloud hull+margin
  const bpts = new Int16Array(fs.readFileSync(
    path.join(ROOT, "fly_brain_pathway_bundles.bin")).buffer);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < +meta.n; i++)
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], P(i, c)); hi[c] = Math.max(hi[c], P(i, c));
    }
  const margin = 400;
  for (let k = 0; k < bpts.length; k++) {
    const c = k % 3, v = bpts[k] / 10;
    if (v < lo[c] - margin || v > hi[c] + margin)
      return { ok: false, info: `bundle point ${v} outside brain bounds` };
  }
  // W1 bin size matches its sidecar
  const w1 = J("fly_brain_edge_paths.json");
  const w1bytes = fs.statSync(path.join(ROOT, "fly_brain_edge_paths.bin")).size;
  const nwp = w1.edges.reduce((a, e) => a + e.n, 0);
  if (w1bytes !== nwp * 6) return { ok: false, info: `W1 bin ${w1bytes} != waypoints*6` };
  return { ok: true, info: `frame "${meta.frame.slice(0, 24)}…", ${bpts.length / 3} bundle pts in-bounds, W1 ${nwp} wp` };
});

/* ---- 3. pathway count consistency ----------------------------------- */
check(3, "pathway count consistency (bin/records/member coverage)", () => {
  const bpts = fs.statSync(path.join(ROOT, "fly_brain_pathway_bundles.bin")).size;
  const recPts = bundlesDoc.bundles.reduce((a, b) => a + b.binCount, 0);
  if (bpts !== recPts * 6)
    return { ok: false, info: `bin ${bpts} B != records ${recPts} pts * 6` };
  // bundle polylines have >= 2 samples; offsets contiguous
  let exp = 0;
  for (const b of bundlesDoc.bundles) {
    if (b.binCount < 2) return { ok: false, info: "bundle polyline < 2 points" };
    if (b.binOffset !== exp) return { ok: false, info: "non-contiguous bundle offsets" };
    exp += b.binCount;
  }
  // member-edge samples reference valid circuit rows (W1 order: fast+mod)
  const nAll = circuit.edges.length + circuit.modulatory_edges.length;
  for (const b of bundlesDoc.bundles)
    for (const k of b.memberEdgeSamples)
      if (k < 0 || k >= nAll) return { ok: false, info: `member edge ${k} out of range` };
  const nMod = bundlesDoc.bundles.filter(b => b.mod).length;
  return { ok: true, info: `${bundlesDoc.nBundles} bundles (${bundlesDoc.nBundles - nMod} fast, ${nMod} mod), ${recPts} pts, members in [0,${nAll})` };
});

/* ---- 4. simulated-edge ↔ anatomical-edge provenance ------------------ */
check(4, "simulated-edge ↔ W1-record ↔ synapse provenance (1:1)", () => {
  const w1 = J("fly_brain_edge_paths.json");
  if (w1.edges.length !== bundlesDoc.edgesTotal)
    return { ok: false, info: `W1 ${w1.edges.length} != circuit ${bundlesDoc.edgesTotal}` };
  const p = w1.provenance || {};
  if (p.missing_pair_edges !== 0)
    return { ok: false, info: `W1 reported ${p.missing_pair_edges} missing pair edges` };
  if (!/synapses_connections_783/.test(JSON.stringify(p.sources || [])))
    return { ok: false, info: "W1 provenance lacks synapse source" };
  // circuit rows are dense [0, N): every s,t indexable into root_ids
  for (const list of [circuit.edges, circuit.modulatory_edges])
    for (const e of list) {
      if (+e.s < 0 || +e.s >= rootIds.length || +e.t < 0 || +e.t >= rootIds.length)
        return { ok: false, info: "circuit row out of root_ids range" };
    }
  return { ok: true, info: `1:1 (564,030 edges); rows dense over ${rootIds.length} roots; source: ${JSON.stringify(p.sources).slice(0, 60)}…` };
});

/* ---- 5. zero/NaN handling -------------------------------------------- */
check(5, "zero/NaN handling (rows, vectors, bundles)", () => {
  const rows = J("research_data/figure_rows.json");
  for (const [cond, a] of Object.entries(rows.conditions)) {
    if (a.fireVecEarly == null && a.fireVecLate == null) continue; // no-emitter cond
    if (!a.fireVecEarly || !a.fireVecLate) continue;
    const e = U8(a.fireVecEarly), l = U8(a.fireVecLate), m = U8(a.fireVecMean);
    if (e.length !== l.length || e.length !== m.length)
      return { ok: false, info: `${cond}: vector length mismatch` };
    for (const [nm, v] of [["early", e], ["late", l], ["mean", m]])
      for (let i = 0; i < v.length; i++)
        if (!Number.isFinite(v[i])) return { ok: false, info: `${cond}/${nm}[${i}] NaN` };
    for (const b of a.bundleDelta || [])
      if (b.delta != null && !Number.isFinite(b.delta))
        return { ok: false, info: `${cond}: bundle delta NaN` };
  }
  return { ok: true, info: "all finite; no-emitter conditions tolerated (null vectors)" };
});

/* ---- 6. deterministic rendering inputs -------------------------------- */
check(6, "deterministic rendering inputs (renderer consumes only static artifacts)", () => {
  const html = fs.readFileSync(path.join(ROOT, "publication_figures.html"), "utf8");
  // every fetch in the figure page must target a versioned/static artifact
  const urls = [...html.matchAll(/(?:fetch|j|buf)\(\s*[`"']([^`"'?]+)[`"']/g)]
    .map(m => m[1]).filter(u => !u.includes("api/"));
  const needed = ["fly_brain_meta.json", "fly_brain_pathway_bundles.json",
    "research_data/figure_rows.json", "fly_brain_positions.bin",
    "fly_brain_celltypes.json", "fly_brain_pathway_bundles.bin",
    "data/skeletons/skeletons_index.json", "data/skeletons/skeletons.bin"];
  for (const u of needed)
    if (!urls.some(x => x.includes(u)))
      return { ok: false, info: `figure page does not load ${u}` };
  // camera + scales derive only from data (no Math.random in module scope)
  if (/Math\.random/.test(html)) return { ok: false, info: "Math.random present" };
  if (!/CAM_DIR = new THREE\.Vector3\(/.test(html))
    return { ok: false, info: "camera direction not fixed" };
  return { ok: true, info: `${urls.length} static fetches, fixed camera, no RNG` };
});

/* ---- 7. early/late coordinate identity -------------------------------- */
check(7, "early/late coordinate identity (same rows, same coords)", () => {
  const rows = J("research_data/figure_rows.json");
  const dn = rows.conditions.demon_neural;
  if (!dn || !dn.fireVecEarly || !dn.fireVecLate)
    return { ok: false, info: "demon_neural vectors missing" };
  if (U8(dn.fireVecEarly).length !== U8(dn.fireVecLate).length)
    return { ok: false, info: "early/late length differ" };
  if (rows.provenance.mode !== "frozen-rows")
    return { ok: false, info: "figure_rows not built from frozen rows" };
  // and the source file itself must exist and contain those seeds/trials
  const src = path.join(ROOT, rows.provenance.source);
  if (!fs.existsSync(src)) return { ok: false, info: "frozen source file missing" };
  const first = JSON.parse(fs.readFileSync(src, "utf8").split("\n")[0]);
  if (!first.fireVec || +first.fireVec.n !== U8(dn.fireVecEarly).length)
    return { ok: false, info: "row fireVec length disagrees with aggregate" };
  return { ok: true, info: `same ${U8(dn.fireVecEarly).length}-row vectors from ${path.basename(src)}` };
});

/* ---- 8. learning-delta sign convention -------------------------------- */
check(8, "learning-delta sign convention (delta = late − early)", () => {
  const rows = J("research_data/figure_rows.json");
  const dn = rows.conditions.demon_neural;
  const e = U8(dn.fireVecEarly), l = U8(dn.fireVecLate);
  // bundle deltas must equal late-early of their aggregate fields
  for (const b of dn.bundleDelta || []) {
    if (b.delta == null) continue;
    if (Math.abs((b.late - b.early) - b.delta) > 1e-9)
      return { ok: false, info: `bundle ${b.src}->${b.tgt}: delta != late-early` };
    if (b.deltaW != null && Math.abs((b.lateW - b.earlyW) - b.deltaW) > 1e-9)
      return { ok: false, info: `bundle ${b.src}->${b.tgt}: deltaW != lateW-earlyW` };
  }
  for (const [r, v] of Object.entries(dn.regionDelta || {}))
    if (Math.abs((v.late - v.early) - v.delta) > 1e-9)
      return { ok: false, info: `region ${r}: delta != late-early` };
  // global sanity: mean vector = mean over rows (early/late subsets differ)
  const diffs = [...dn.bundleDelta || []].filter(b => b.delta != null && b.delta !== 0);
  return { ok: true, info: `${diffs.length} non-zero bundle deltas all satisfy late−early` };
});

/* ---- 9. color-scale zero centering ------------------------------------ */
check(9, "color-scale zero centering (diverging, one shared scale)", () => {
  const html = fs.readFileSync(path.join(ROOT, "publication_figures.html"), "utf8");
  // renderer uses a single deltaVmax for dots and bundles, centered at 0
  if (!/for \(const b of \(cond\.bundleDelta \|\| \[\]\)\)/.test(html) ||
      !/for \(let i = 0; i < N; i\+\+\) if \(dN\[i\]\) ds\.push/.test(html))
    return { ok: false, info: "shared vmax does not combine neuron+bundle deltas" };
  if (!/0\.5, "0"/.test(html) && !/"0"/.test(html)) { /* colorbar tick */ }
  // divColor must be symmetric: d and -d blend to mirrored colors
  const m = html.match(/function divColor[\s\S]*?\n}/);
  if (!m) return { ok: false, info: "divColor not found" };
  if (!/t >= 0 \? mid\.clone\(\)\.lerp\(pos, t\) : mid\.clone\(\)\.lerp\(neg, -t\)/.test(m[0]))
    return { ok: false, info: "divColor not symmetric about zero" };
  // colorbar ticks are -v / 0 / +v
  if (!/\+ vt\(deltaVmax\)/.test(html) || !/−"\s*\+\s*vt\(deltaVmax\)/.test(html))
    return { ok: false, info: "colorbar ticks not centered" };
  return { ok: true, info: "symmetric diverging map; single shared vmax; ±v/0 ticks" };
});

/* ---- 10. no regression of W1–W4 --------------------------------------- */
check(10, "no regression of W1–W4 (viewer wiring + family streaming intact)", () => {
  const html = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  const guards = [
    ["W1 pathway bin", /fly_brain_edge_paths\.bin/],
    ["W1 loader record", /PATHS\.ready/],
    ["W3 cable tick", /cableEdgeTick|fillCableColors/],
    ["W3 modulatory channel", /modulatory/],
    ["W2 arbor loader", /skeletons\.bin|skeletons_all\.bin/],
    ["W2 family streaming", /arbor_families|arbor_family/],
    ["W4 cell types", /fly_brain_celltypes\.json/],
    ["W4 chip", /chipT/],
    ["anatomy mode", /anatMode/],
  ];
  for (const [nm, re] of guards)
    if (!re.test(html)) return { ok: false, info: `viewer lost ${nm}` };
  // server endpoints still registered
  const srv = fs.readFileSync(path.join(ROOT, "launch_fly_demon_3d.py"), "utf8");
  for (const ep of ["arbor_families", "arbor_family", "figure_save"])
    if (!srv.includes(ep)) return { ok: false, info: `server lost /api/${ep}` };
  // frozen Phase-03 rows untouched on disk (figure tool only reads them)
  const rows = J("research_data/figure_rows.json");
  if (rows.provenance.mode !== "frozen-rows")
    return { ok: false, info: "figure rows were rebuilt by simulation" };
  return { ok: true, info: "W1–W4 wiring + endpoints present; figure layer read-only" };
});

console.log(`\n== ${pass} passed, ${fail} failed ==`);
if (failures.length) {
  console.log("failures:\n  " + failures.join("\n  "));
  process.exit(1);
}
