#!/usr/bin/env node
/**
 * fetch_fly_skeletons.js — download REAL fruit-fly neuron skeletons (SWC) from
 * Virtual Fly Brain (virtualflybrain.org) into fly_skeletons/ so the SKELETON
 * button renders true EM-reconstruction morphologies.
 *
 * Source: VFB individual neurons aligned to the JRC2018Unisex adult brain
 * template (VFB_00101567), discovered with the public VFBquery API
 * (v3-cached.virtualflybrain.org, read-only GETs, no token needed).
 *
 * REGISTRATION (v8 — neuron-weighted, rigid per neuron): every VFB neuron
 * shares ONE template space, so within a class the SWCs are mutually
 * consistent real morphologies. But the scene atlas is a SCHEMATIC plate,
 * not a rigid JRC2018U replica: template->scene x-distance scales ~1.5x for
 * the optic lobes but ~0.97x for the mushroom body (measured), so NO single
 * rigid/similarity/affine transform can map template onto scene (v2 wrong
 * mesh, v3/v4 domain-mesh frames inconsistent, v6 global-similarity rmse 41;
 * v7 additionally anchored POINT-weighted medians while the measured
 * population is NEURON-weighted, and split each midline-crossing neuron's
 * arbor between the two side shifts, tearing it). v8 ships exactly the
 * page's own placement convention, honestly staged:
 *   1. ONE global similarity transform (axis permutation/reflection + uniform
 *      scale + offset) calibrated from per-class NEURON medians — each SWC
 *      contributes exactly one point (its own point-median), matching how the
 *      measured FAFB population (fly_brain_positions.bin) is weighted.
 *   2. PER-NEURON anchoring: each neuron gets ONE rigid translation (chosen
 *      by ITS OWN median-x side for bilateral classes) moving its class-side
 *      neuron-median onto the measured population median. Real morphology is
 *      never deformed; neurons are never torn at the midline.
 * Documented in index.json and every file header. tools/audit_skeletons.js
 * validates the shipped files independently.
 *
 * RUN:  node tools/fetch_fly_skeletons.js
 * OUT:  fly_skeletons/index.json  +  fly_skeletons/skel_<region>_NN_<id>.swc
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "fly_skeletons");
const VFB = "https://www.virtualflybrain.org";
const API = "https://v3-cached.virtualflybrain.org";
const TEMPLATE = "VFB_00101567";                       // JRC2018Unisex adult brain
const TEMPLATE_MIDLINE_X = 307;      // JRC2018U: 614-voxel L-R axis, midline 307
const GLOBAL_RMSE_GATE = 120;        // scene units (orientation/scale sanity only)
const ANCHOR_GATE = 150;             // scene units (per-neuron shift must not teleport)
const CAL_N = 12;                    // global-fit calibration neurons per class

// download classes: FBbt term -> n neurons, output key (color region), anchor
const REGIONS = [
  { key: "anten",   fbbt: "FBbt_00003924", n: 70, anchor: "anten",  bilat: true  },  // green
  { key: "mb",      fbbt: "FBbt_00003685", n: 70, anchor: "mb",     bilat: true  },  // orange
  { key: "optic",   fbbt: "FBbt_00003852", n: 60, anchor: "lobula", bilat: true  },  // cyan
  { key: "optic2",  fbbt: "FBbt_00003748", n: 60, anchor: "medulla", bilat: true, out: "optic" }, // cyan
  { key: "central", fbbt: "FBbt_00003679", n: 45, anchor: "cx",     bilat: false },  // blue
  { key: "central2",fbbt: "FBbt_00003678", n: 45, anchor: "cx",     bilat: false, out: "central" }, // blue
  { key: "central3",fbbt: "FBbt_00003668", n: 45, anchor: "cx",     bilat: false, out: "central" }, // blue
  // lateral horn: olfactory output neuropil. The VFB LH-domain query returns
  // SLP/LH neurons whose skeletons cluster nearest the LH under the global fit
  // (verified: 22/25 nearest LH_L/R census); the schematic plate compresses
  // the posterior-lateral region, so this class legitimately needs a larger
  // anchor shift (gate 220).
  { key: "lh",      fbbt: "FBbt_00007053", n: 55, anchor: "lh",     bilat: true, out: "lh", gate: 220 },
  // descending neurons: giant fiber class (PLP dendrites, axons descending to
  // VNC); anchored onto the measured PLP population (their somatic region).
  // DNgXX EM groups have no aligned skeletons; named giant-fiber class does.
  { key: "desc",    fbbt: "FBbt_00004020", n: 15, anchor: "plp",     bilat: true, out: "desc", gate: 220 },
];

// measured populations (np_names entries) each anchor class joins, per side
const ANCHORS = {
  anten:  { L: ["AL_L"], R: ["AL_R"] },
  lobula: { L: ["LO_L"], R: ["LO_R"] },
  medulla:{ L: ["ME_L"], R: ["ME_R"] },
  mb:     { L: ["MB_CA_L", "MB_ML_L", "MB_VL_L", "MB_PED_L"],
            R: ["MB_CA_R", "MB_ML_R", "MB_VL_R", "MB_PED_R"] },
  lh:     { L: ["LH_L"], R: ["LH_R"] },
  plp:    { L: ["PLP_L"], R: ["PLP_R"] },
  cx:     { L: ["FB"], R: ["FB"] },   // central complex: single midline anchor
};

const TIMEOUT = (ms) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); return { sig: ac.signal, done: () => clearTimeout(t) }; };
async function get(url, bin){
  const { sig, done } = TIMEOUT(60000);
  try {
    const r = await fetch(url, { signal: sig, headers: { "User-Agent": "fly-demon-skeleton-fetch/1.0" } });
    if (!r.ok) return null;
    return bin ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } catch (e) { return null; } finally { done(); }
}
async function getJSON(url){ const t = await get(url); try { return JSON.parse(t); } catch (e) { return null; } }

async function discover(fbbt, want){
  const ids = [];
  for (let off = 0; off < 400 && ids.length < want; off += 100){
    const j = await getJSON(`${API}/run_query?id=${fbbt}&query_type=ImagesNeurons&limit=100&offset=${off}`);
    const rows = j && j.rows;
    if (!rows || !rows.length) break;
    for (const r of rows){
      // each row's thumbnail carries its exact VFB data path (individual dir
      // + aligned-template dir); use it verbatim — the path components are
      // NOT derivable from the id alone
      const m = String(r.thumbnail || "").match(/data\/VFB\/i\/([^)\'\"]+)thumbnail\.png/);
      if (r.id && m && !ids.some(x => x.id === r.id))
        ids.push({ id: r.id, path: m[1] });
      if (ids.length >= want) break;
    }
    if (rows.length < 100) break;
  }
  return ids;
}
function parseSWC(txt){
  const pts = new Map(), order = [];
  for (const ln of txt.split(/\r?\n/)){
    const t = ln.trim();
    if (!t || t.charAt(0) === "#") continue;
    const c = t.split(/\s+/);
    if (c.length < 7) continue;
    const id = c[0] | 0;
    pts.set(id, { x: +c[2], y: +c[3], z: +c[4], pa: c[6] | 0 });
    order.push(id);
  }
  return { pts, order };
}
function medianOf(col){
  col.sort((a, b) => a - b);
  const m = col.length >> 1;
  return col.length % 2 ? col[m] : (col[m - 1] + col[m]) / 2;
}
// per-neuron point-median in raw template space
function neuronMedian(P){
  const sx = [], sy = [], sz = [];
  for (const pid of P.order){
    const p = P.pts.get(pid);
    sx.push(p.x); sy.push(p.y); sz.push(p.z);
  }
  return [medianOf(sx), medianOf(sy), medianOf(sz)];
}
// raw template-space SWCs of one FBbt class. For bilateral calibration we
// need BOTH sides represented (VFB discovery order is not side-balanced), so
// keep fetching up to 3x until minPerSide neurons sit on each template side.
async function fetchClassSWCs(fbbt, want, minPerSide){
  const ids = await discover(fbbt, (minPerSide ? want * 3 : want) + 10);
  const swcs = [];
  for (const cand of ids){
    if (swcs.length >= want && (!minPerSide ||
        swcs.filter(s => s.med[0] < TEMPLATE_MIDLINE_X).length >= minPerSide &&
        swcs.filter(s => s.med[0] >= TEMPLATE_MIDLINE_X).length >= minPerSide)) break;
    const swc = await get(`${VFB}/data/VFB/i/${cand.path}volume.swc`);
    if (!swc) continue;
    const P = parseSWC(swc);
    if (P.order.length < 40) continue;                      // fragments are useless
    swcs.push({ cand, P, med: neuronMedian(P) });
  }
  return swcs;
}
// ONE similarity transform from N 3D correspondences, searched over all axis
// permutations + reflections. Returns { s, o, pm, sg, rmse, resid[] } or null.
function fitProcrustes(T4, D4){
  const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  let best = null;
  for (const pm of perms)
    for (const s0 of [1, -1]) for (const s1 of [1, -1]) for (const s2 of [1, -1]){
      const T = T4.map(p => [pm[0], pm[1], pm[2]].map((ax, k) => (k === 0 ? s0 : k === 1 ? s1 : s2) * p[ax]));
      let mt = [0,0,0], mq = [0,0,0];
      for (let i = 0; i < T.length; i++) for (let k = 0; k < 3; k++){ mt[k] += T[i][k] / T.length; mq[k] += D4[i][k] / T.length; }
      let num = 0, den = 0;
      for (let i = 0; i < T.length; i++)
        for (let k = 0; k < 3; k++){
          num += (T[i][k] - mt[k]) * (D4[i][k] - mq[k]);
          den += (T[i][k] - mt[k]) * (T[i][k] - mt[k]);
        }
      if (den < 1e-9) continue;
      const s = num / den;
      if (!(s > 0) || s > 8 || s < 0.02) continue;
      const o = [0,1,2].map(k => mq[k] - s * mt[k]);
      let err = 0; const resid = [];
      for (let i = 0; i < T.length; i++){
        let e2 = 0;
        for (let k = 0; k < 3; k++){ const d = s * T[i][k] + o[k] - D4[i][k]; e2 += d * d; }
        err += e2; resid.push(Math.sqrt(e2));
      }
      if (!best || err < best.err)
        best = { s, o, pm, sg: [s0, s1, s2], err, rmse: Math.sqrt(err / (T.length * 3)), resid };
    }
  return best;
}
function applyFit(f, x, y, z){
  const p = [f.pm[0], f.pm[1], f.pm[2]].map((ax, k) => f.sg[k] * [x, y, z][ax]);
  return [f.s * p[0] + f.o[0], f.s * p[1] + f.o[1], f.s * p[2] + f.o[2]];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fly_brain_meta.json"), "utf8"));
  const files = [];
  const seq = new Map();   // per outKey running number (regions sharing a key share the counter)

  // ---------- scene-side measured population medians (neuron-weighted) -----
  const pbuf = fs.readFileSync(path.join(__dirname, "..", "fly_brain_positions.bin"));
  let nNeurons = meta.n || Math.floor(pbuf.byteLength / 7);
  if (pbuf.byteLength !== nNeurons * 7) nNeurons = Math.floor(pbuf.byteLength / 7);
  const P16 = new Int16Array(pbuf.buffer, pbuf.byteOffset, nNeurons * 3);
  const PRIM = new Uint8Array(pbuf.buffer, pbuf.byteOffset + nNeurons * 6, nNeurons);
  const npIdx = new Map(meta.np_names.map((nm, i) => [nm, i]));
  console.log(`measured FAFB cloud: ${nNeurons} neurons`);
  const sceneMedian = (names) => {
    const want = new Set(names.map(nm => npIdx.get(nm)).filter(v => v !== undefined));
    const pts = [];
    for (let i = 0; i < nNeurons; i++)
      if (want.has(PRIM[i])) pts.push(P16[i * 3] * 0.1, P16[i * 3 + 1] * 0.1, P16[i * 3 + 2] * 0.1);
    if (pts.length < 30) return null;
    return [medianOf(pts.filter((_, j) => j % 3 === 0)),
            medianOf(pts.filter((_, j) => j % 3 === 1)),
            medianOf(pts.filter((_, j) => j % 3 === 2))];
  };
  const anchorTarget = {};
  for (const [nm, a] of Object.entries(ANCHORS))
    anchorTarget[nm] = { L: sceneMedian(a.L), R: sceneMedian(a.R) };

  // ---------- stage 1: global similarity from class NEURON medians ---------
  console.log("calibrating global similarity from class neuron medians...");
  const calClasses = ["anten", "lobula", "medulla", "mb"];
  const calFbbt = { anten: "FBbt_00003924", lobula: "FBbt_00003852", medulla: "FBbt_00003748", mb: "FBbt_00003685" };
  // global fit stays calibrated from the four original classes (the fit itself
  // is unchanged); new classes (lh/desc) reuse it and anchor onto their own
  // measured populations — that is exactly what per-class anchoring is for.
  // (Re-fitting globally whenever a class is added would silently reshift
  // every previously shipped neuron.)
  const T4 = [], D4 = [], nm4 = [];
  for (const nm of calClasses){
    const swcs = await fetchClassSWCs(calFbbt[nm], CAL_N, 5);
    if (swcs.length < 5){ console.error(`FATAL: calibration class ${nm} too small (${swcs.length})`); process.exit(1); }
    const tgt = anchorTarget[nm];
    if (!tgt.L || !tgt.R){ console.error(`FATAL: measured population missing for ${nm}`); process.exit(1); }
    // neuron-weighted side medians (each neuron = one point); side judged in
    // TEMPLATE space (JRC2018U midline x=307)
    const sidePts = (side) => swcs.filter(s => side === "L" ? s.med[0] < TEMPLATE_MIDLINE_X : s.med[0] >= TEMPLATE_MIDLINE_X).map(s => s.med);
    const mL = sidePts("L"), mR = sidePts("R");
    if (mL.length < 3 || mR.length < 3){ console.error(`FATAL: ${nm} one-sided neuron medians (L=${mL.length} R=${mR.length})`); process.exit(1); }
    T4.push([medianOf(mL.map(p => p[0])), medianOf(mL.map(p => p[1])), medianOf(mL.map(p => p[2]))],
            [medianOf(mR.map(p => p[0])), medianOf(mR.map(p => p[1])), medianOf(mR.map(p => p[2]))]);
    D4.push(tgt.L, tgt.R);
    nm4.push(nm + "-L", nm + "-R");
  }
  const G = fitProcrustes(T4, D4);
  if (!G){ console.error("FATAL: global fit failed"); process.exit(1); }
  console.log(`GLOBAL similarity: scale ${G.s.toFixed(4)}  rmse ${G.rmse.toFixed(1)} scene units (orientation/scale only)`);
  if (G.rmse > GLOBAL_RMSE_GATE){ console.error(`FATAL: global rmse > ${GLOBAL_RMSE_GATE}`); process.exit(1); }

  // ---------- stage 2: per-region download + per-neuron anchoring ----------
  const anchorReport = {};
  for (const reg of REGIONS){
    const outKey = reg.out || reg.key;
    console.log(`== ${reg.key} (${reg.fbbt}) anchor=${reg.anchor}`);
    const swcs = await fetchClassSWCs(reg.fbbt, reg.n);
    if (!swcs.length){ console.log("   no usable neurons, skipping"); continue; }
    // neuron-weighted class medians in FITTED space, per side (neuron's own
    // median-x side for bilateral classes)
    const tgt = anchorTarget[reg.anchor];
    const anchorL = tgt.L, anchorR = reg.bilat ? tgt.R : tgt.L;
    if (!anchorL || !anchorR){ console.log("   no measured anchor, skipping"); continue; }
    const medFit = (side) => {
      const mine = swcs.filter(s => reg.bilat ? (side === "L" ? s.med[0] < TEMPLATE_MIDLINE_X : s.med[0] >= TEMPLATE_MIDLINE_X) : true)
                       .map(s => applyFit(G, s.med[0], s.med[1], s.med[2]));
      if (mine.length < (reg.bilat ? 3 : 5)) return null;
      return [medianOf(mine.map(p => p[0])), medianOf(mine.map(p => p[1])), medianOf(mine.map(p => p[2]))];
    };
    const fL = medFit("L"), fR = reg.bilat ? medFit("R") : fL;
    let tL = null, tR = null;
    if (fL) tL = [0, 1, 2].map(k => anchorL[k] - fL[k]);
    if (fR && reg.bilat) tR = [0, 1, 2].map(k => anchorR[k] - fR[k]);
    if (!reg.bilat) tR = tL;
    // one-sided batches (VFB discovery order is not side-balanced): neurons
    // all sit on ONE template side, so only that side's anchor exists. Mirror
    // the shift to the opposite side's anchor so a mirrored twin class stays
    // consistent; each neuron keeps its OWN-side rigid shift (no tearing).
    if (reg.bilat && ((!tL && tR) || (!tR && tL))){
      const have = tL ? "L" : "R";
      const src = have === "L" ? tL : tR;
      const anchorHave = have === "L" ? anchorL : anchorR;
      const anchorMir = have === "L" ? anchorR : anchorL;
      const mir = have === "L" ? [anchorR[0] - (anchorHave[0] - src[0]) * -1, src[1] + (anchorR[1] - anchorHave[1]), src[2] + (anchorR[2] - anchorHave[2])]
                               : [anchorL[0] - (anchorHave[0] - src[0]) * -1, src[1] + (anchorL[1] - anchorHave[1]), src[2] + (anchorL[2] - anchorHave[2])];
      if (have === "L") tR = mir; else tL = mir;
      console.log(`   NOTE: one-sided batch (${have}); mirrored shift to opposite anchor`);
    }
    if (!tL && !tR){ console.log("   too few neurons per side to anchor, skipping"); continue; }
    const norm = t => t ? Math.hypot(t[0], t[1], t[2]) : 0;
    const gate = reg.gate || ANCHOR_GATE;
    if (Math.max(norm(tL), norm(tR)) > gate){
      console.error(`FATAL: ${reg.key} anchor translation ${Math.max(norm(tL), norm(tR)).toFixed(0)} > ${gate} — refusing`);
      process.exit(1);
    }
    anchorReport[reg.key] = { anchor: reg.anchor, tL: tL && tL.map(v => +v.toFixed(1)), tR: tR && tR.map(v => +v.toFixed(1)) };
    console.log(`   anchor shift L ${tL ? tL.map(v => v.toFixed(0)) : "-"}  R ${tR ? tR.map(v => v.toFixed(0)) : "-"}  (${swcs.length} neurons)`);
    // write: ONE rigid shift per neuron, side chosen by ITS OWN median
    for (const { cand, P, med } of swcs){
      const t = reg.bilat ? (med[0] < TEMPLATE_MIDLINE_X ? tL : tR) : tL;
      let out = "# fly skeleton - REAL morphology from virtualflybrain.org\n";
      out += `# ${cand.id} aligned to JRC2018U; scene frame = global similarity (scale ${G.s.toFixed(4)}) + ${reg.anchor} measured-population anchoring (one rigid translation per neuron, neuron-weighted calibration; scene atlas is a schematic plate, not a rigid JRC2018U replica)\n`;
      out += "# PointNo Label X Y Z Radius Parent\n";
      for (const pid of P.order){
        const p = P.pts.get(pid);
        const q = applyFit(G, p.x, p.y, p.z);
        out += `${pid} 1 ${(q[0] + t[0]).toFixed(2)} ${(q[1] + t[1]).toFixed(2)} ${(q[2] + t[2]).toFixed(2)} 0.5 ${p.pa}\n`;
      }
      const sn = (seq.get(outKey) || 0) + 1; seq.set(outKey, sn);
      const fname = `skel_${outKey}_${String(sn).padStart(2, "0")}_${cand.id}.swc`;
      fs.writeFileSync(path.join(OUT, fname), out);
      files.push(fname);
    }
    console.log(`   kept ${swcs.length} skeletons (cumulative ${seq.get(outKey)}, shared outKey)`);
  }
  const index = {
    registered: true,
    registrationVersion: 8,
    source: "virtualflybrain.org — individual neurons aligned to JRC2018Unisex (VFB_00101567), read via the public VFBquery API",
    registration: "TWO-STAGE: (1) ONE global similarity transform (axis permutation/reflection + uniform scale + offset) " +
      "calibrated from per-class NEURON medians (each SWC contributes one point) vs measured FAFB population medians " +
      "(fly_brain_positions.bin); (2) per-class anchoring: ONE rigid translation per neuron (side by the neuron's own " +
      "median-x) onto the measured population (scene atlas is a schematic plate, not a rigid JRC2018U replica — measured " +
      "pairwise stretch differs per neuropil, so a single rigid map does not exist; the page itself places neurons inside " +
      "their neuropil populations). Real morphology is never deformed and no neuron is torn at the midline. " +
      "(v8; v1 per-region, v2 single-mesh, v3/v4 domain-mesh, v6/v7 point-weighted fits documented in git history.)",
    globalFit: { scale: +G.s.toFixed(4), rmse: +G.rmse.toFixed(1),
                 perm: G.pm, sign: G.sg, offset: G.o.map(v => +v.toFixed(2)),
                 anchors: anchorReport },
    regions: REGIONS.map(r => ({ key: r.out || r.key, fbbt: r.fbbt, anchor: r.anchor })),
    n: files.length,
    files,
    generated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
  console.log(`DONE: ${files.length} real skeletons in fly_skeletons/ (neuron-weighted anchored registration v8)`);
})();
