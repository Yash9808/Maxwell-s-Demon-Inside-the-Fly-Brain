"use strict";
// P10 parity tests — GPU-side edge coloring (ANIMATION_PERFORMANCE_PROPOSAL
// P10): pack per-edge colors into a Float32 DataTexture; a custom LineSegments
// ShaderMaterial samples it per edge index in the VERTEX shader, eliminating
// the per-segment CPU color writes (~36k cable segment ops / frame at 30 Hz +
// an 864 KB full-buffer upload, and the ~6k-edge chord loop at 60 Hz + 430 KB).
//
// Architecture under test (design notes):
//   * The per-edge COLOR MATH stays on the CPU, verbatim from the legacy
//     writers (same expressions -> one f64->f32 rounding at the texture-data
//     store, exactly where legacy rounded at the color-attribute store).
//   * The per-SEGMENT loop collapses to a per-edge loop: legacy computed the
//     same coefficient triple per edge and only selected front/trail per
//     segment, so the shader performs the selection (front vs trail texel)
//     with the exact wave window `d = segT - wave; if (d<0) d+=1; d < 0.18`.
//   * Chord mode has no wave branch -> fully bit-exact. Cable mode exposes
//     only the window comparison to f32 (~1-ulp band around d==0.18; both
//     sides are the same hue, front is merely 1/0.35x brighter).
//
// Pattern mirrors P4/P5: the page's writers are transcribed verbatim as the
// oracle (validated against the live page before the P10 edit), and the
// page-extracted P10 implementation is driven through the same scenarios
// post-edit. tests/p5_color_parity.test.js continues to drive the real page
// writers against its own legacy transcriptions after the edit.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const src = fs.readFileSync(PAGE, "utf8");
const hasP10 = /uniform sampler2D edgeTex/.test(src) && /p10TargetFor/.test(src);

const { p10ReconstructPerVertex, p10ReconstructPerVertexChord } =
  require("./helpers/p10_reconstruct.js");

// ---- deterministic fixtures (seeded LCG, like P4/P5) ------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const N = 400, NE = 2000;
function makeSim(seed) {
  const rng = makeRng(seed);
  const spikes = new Array(N).fill(false);
  for (let i = 0; i < N; i++) spikes[i] = rng() < 0.10;
  const src = new Int32Array(NE), dst = new Int32Array(NE), isExc = new Array(NE);
  for (let e = 0; e < NE; e++) {
    src[e] = (rng() * N) | 0; dst[e] = (rng() * N) | 0;
    isExc[e] = rng() < 0.7;
  }
  const E = new Float32Array(NE);
  for (let e = 0; e < NE; e++) {
    const u = rng();
    E[e] = u < 0.7 ? 0 : (u < 0.75 ? 0.08 : (u < 0.85 ? 0.07999 : 0.09 + rng() * 0.6));
  }
  // heat with the exact 0.05 gate band represented
  const heat = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = rng();
    heat[i] = u < 0.2 ? 0 : (u < 0.25 ? 0.0499 : (u < 0.30 ? 0.05 : (u < 0.35 ? 0.0501 : rng())));
  }
  heat[0] = 0.05; heat[1] = 0.0501; heat[2] = 0.0499;
  spikes[3] = true; spikes[4] = true;
  return { spikes, src, dst, isExc, E, heat };
}
// fake cable: per-edge segment counts/offsets/t-phases (like P5's fixture)
function makeCable(seed) {
  const rng = makeRng(seed ^ 0xabe1);
  const segOff = new Int32Array(NE), segN = new Int32Array(NE), segT = [];
  let acc = 0;
  for (let e = 0; e < NE; e++) {
    segOff[e] = acc;
    const n = e % 7 === 0 ? 1 : 1 + ((rng() * 8) | 0);   // incl. degenerate stubs
    for (let s = 0; s < n; s++) {
      const u = rng();
      // include t values in the exact wave-window band
      segT.push(u < 0.1 ? 0.18 : (u < 0.15 ? 0.1799999 : (u < 0.2 ? 0.1800001 : rng())));
    }
    acc += n; segN[e] = n;
  }
  return { segOff, segN, segT: new Float32Array(segT) };
}

// ---- legacy transcriptions (verbatim from the pre-edit page) ----------------
function p5ZeroSeg(arr, off0, n) {
  for (let s = off0, e2 = off0 + n; s < e2; s++) {
    const v = s * 6;
    arr[v] = 0; arr[v + 1] = 0; arr[v + 2] = 0; arr[v + 3] = 0; arr[v + 4] = 0; arr[v + 5] = 0;
  }
}
function fillCableColorsLegacy(cable, sim, wave, em, sel, selNp, inSet, heat, segIdx, colAttr) {
  const { spikes, src, dst, isExc, E } = sim;
  const segT = cable.segT, segOff = cable.segOff, segN = cable.segN;
  const arr = colAttr;
  for (let k = 0; k < segIdx.length; k++) {
    const ei = segIdx[k];
    if (em === "inspect") {
      const sI = src[ei], dI = dst[ei];
      const touch = (sel >= 0 && (sI === sel || dI === sel)) ||
                    (inSet && (inSet.has(sI) || inSet.has(dI)));
      if (!touch) { p5ZeroSeg(arr, segOff[ei], segN[ei]); continue; }
    } else if (em === "active") {
      const carry = E[ei] > 0.08 || (spikes[src[ei]] && spikes[dst[ei]]);
      if (!carry) { p5ZeroSeg(arr, segOff[ei], segN[ei]); continue; }
    }
    const hS = heat ? heat[src[ei]] : (spikes[src[ei]] ? 1 : 0);
    if (hS <= 0.05) { p5ZeroSeg(arr, segOff[ei], segN[ei]); continue; }
    const b = Math.min(1, hS) * 0.75;
    const exc = isExc[ei];
    const potent = E[ei] > 0.08 ? 1.25 : 1;
    let A, B, C;
    if (exc) { A = 0.55 * b; B = 0.30 * b; C = 0.10 * b; }
    else { A = 0.12 * b; B = 0.34 * b; C = 0.55 * b; }
    for (let s = segOff[ei], e2 = segOff[ei] + segN[ei]; s < e2; s++) {
      const t = segT[s];
      let d = t - wave; if (d < 0) d += 1;
      const v = s * 6;
      if (d < 0.18) {
        const rC = A * 1 * potent, gC = B * 1 * potent, bC = C * 1 * potent;
        arr[v] = rC; arr[v + 1] = gC; arr[v + 2] = bC; arr[v + 3] = rC; arr[v + 4] = gC; arr[v + 5] = bC;
      } else {
        const rC = A * 0.35 * potent, gC = B * 0.35 * potent, bC = C * 0.35 * potent;
        arr[v] = rC; arr[v + 1] = gC; arr[v + 2] = bC; arr[v + 3] = rC; arr[v + 4] = gC; arr[v + 5] = bC;
      }
    }
  }
}
function p10ZeroEdge(target, k) { target.set(k, 0, 0, 0, 0, 0, 0); }
// P10 per-edge cable writer: identical math, one store per edge.
function fillCableColorsP10(cable, sim, wave, em, sel, selNp, inSet, heat, segIdx, target) {
  const { spikes, src, dst, isExc, E } = sim;
    for (let k = 0; k < segIdx.length; k++) {
      const ei = segIdx[k];
      if (em === "inspect") {
        const sI = src[ei], dI = dst[ei];
        const touch = (sel >= 0 && (sI === sel || dI === sel)) ||
                      (inSet && (inSet.has(sI) || inSet.has(dI)));
        if (!touch) { p10ZeroEdge(target, k); continue; }
      } else if (em === "active") {
        const carry = E[ei] > 0.08 || (spikes[src[ei]] && spikes[dst[ei]]);
        if (!carry) { p10ZeroEdge(target, k); continue; }
      }
      const hS = heat ? heat[src[ei]] : (spikes[src[ei]] ? 1 : 0);
      if (hS <= 0.05) { p10ZeroEdge(target, k); continue; }
      const b = Math.min(1, hS) * 0.75;
      const exc = isExc[ei];
      const potent = E[ei] > 0.08 ? 1.25 : 1;
      let A, B, C;
      if (exc) { A = 0.55 * b; B = 0.30 * b; C = 0.10 * b; }
      else { A = 0.12 * b; B = 0.34 * b; C = 0.55 * b; }
      const rF = A * 1 * potent, gF = B * 1 * potent, bF = C * 1 * potent;
      const rT = A * 0.35 * potent, gT = B * 0.35 * potent, bT = C * 0.35 * potent;
      target.set(k, rF, gF, bF, rT, gT, bT);
    }
}
const P5_CHORD_LUT = {
  grey: [0.10, 0.28, 0.16], red: [0.30, 0.10, 0.16], dim: [0.10, 0.13, 0.20],
  activeE: [0.16, 0.62, 0.34], activeI: [0.72, 0.26, 0.30],
  inspE: [0.20, 0.80, 0.44], inspI: [0.90, 0.34, 0.38], inspS: [0.42, 0.50, 0.62],
  zero: [0, 0, 0],
};
// legacy chord writer (from updateVisuals), verbatim branch math
function chordLegacy(sim, em, sel, inSet, heat, anatMode, segIdx, colAttr) {
  const { spikes, src, dst, isExc, E } = sim;
  const arr5 = colAttr;
  for (let k = 0; k < segIdx.length; k++) {
    const ei = segIdx[k];
    let r, g, bl;
    if (em === "active") {
      const carry = E[ei] > 0.08 || (spikes[src[ei]] && spikes[dst[ei]]);
      const c = carry ? (isExc[ei] ? P5_CHORD_LUT.activeE : P5_CHORD_LUT.activeI) : P5_CHORD_LUT.zero;
      r = c[0]; g = c[1]; bl = c[2];
    } else if (em === "inspect") {
      const sI = src[ei], dI = dst[ei];
      const touch = (sel >= 0 && (sI === sel || dI === sel)) ||
                    (inSet && (inSet.has(sI) || inSet.has(dI)));
      const c = touch ? (spikes[sI] ? (isExc[ei] ? P5_CHORD_LUT.inspE : P5_CHORD_LUT.inspI) : P5_CHORD_LUT.inspS) : P5_CHORD_LUT.zero;
      r = c[0]; g = c[1]; bl = c[2];
    } else if (anatMode) {
      const hS = heat ? heat[src[ei]] : (spikes[src[ei]] ? 1 : 0);
      if (hS > 0.05) {
        const b = Math.min(1, hS) * 0.75;
        if (isExc[ei]) { r = 0.55 * b; g = 0.30 * b; bl = 0.10 * b; }
        else { r = 0.12 * b; g = 0.34 * b; bl = 0.55 * b; }
      } else { r = 0; g = 0; bl = 0; }
    } else {
      const c = spikes[src[ei]] ? (isExc[ei] ? P5_CHORD_LUT.grey : P5_CHORD_LUT.red) : P5_CHORD_LUT.dim;
      r = c[0]; g = c[1]; bl = c[2];
    }
    const v = k * 6;
    arr5[v] = r; arr5[v + 1] = g; arr5[v + 2] = bl; arr5[v + 3] = r; arr5[v + 4] = g; arr5[v + 5] = bl;
  }
}
// P10 per-edge chord writer: same branches, one store per edge.
function chordP10(sim, em, sel, inSet, heat, anatMode, segIdx, target) {
  const { spikes, src, dst, isExc, E } = sim;
  for (let k = 0; k < segIdx.length; k++) {
    const ei = segIdx[k];
    let r, g, bl;
    if (em === "active") {
      const carry = E[ei] > 0.08 || (spikes[src[ei]] && spikes[dst[ei]]);
      const c = carry ? (isExc[ei] ? P5_CHORD_LUT.activeE : P5_CHORD_LUT.activeI) : P5_CHORD_LUT.zero;
      r = c[0]; g = c[1]; bl = c[2];
    } else if (em === "inspect") {
      const sI = src[ei], dI = dst[ei];
      const touch = (sel >= 0 && (sI === sel || dI === sel)) ||
                    (inSet && (inSet.has(sI) || inSet.has(dI)));
      const c = touch ? (spikes[sI] ? (isExc[ei] ? P5_CHORD_LUT.inspE : P5_CHORD_LUT.inspI) : P5_CHORD_LUT.inspS) : P5_CHORD_LUT.zero;
      r = c[0]; g = c[1]; bl = c[2];
    } else if (anatMode) {
      const hS = heat ? heat[src[ei]] : (spikes[src[ei]] ? 1 : 0);
      if (hS > 0.05) {
        const b = Math.min(1, hS) * 0.75;
        if (isExc[ei]) { r = 0.55 * b; g = 0.30 * b; bl = 0.10 * b; }
        else { r = 0.12 * b; g = 0.34 * b; bl = 0.55 * b; }
      } else { r = 0; g = 0; bl = 0; }
    } else {
      const c = spikes[src[ei]] ? (isExc[ei] ? P5_CHORD_LUT.grey : P5_CHORD_LUT.red) : P5_CHORD_LUT.dim;
      r = c[0]; g = c[1]; bl = c[2];
    }
    target.set(k, r, g, bl, r, g, bl);
  }
}

// ---- P10 edge target: RGBA float texels, compact segIdx slot k ->
// front texel 2k, trail texel 2k+1 (only rendered edges occupy texels) -------
const P10_COLS_PER_EDGE = 2;   // front + trail
const P10_ROW = 1024;          // texture width (texels)
function makeTarget(edgeCount) {
  const W = Math.max(1, Math.ceil(edgeCount / P10_ROW) * P10_ROW);
  const data = new Float32Array(W * P10_COLS_PER_EDGE * 4);
  return {
    W, data,
    set(k, rF, gF, bF, rT, gT, bT) {
      const f = k * 8, t = k * 8 + 4;
      data[f] = rF; data[f + 1] = gF; data[f + 2] = bF; data[f + 3] = 1;
      data[t] = rT; data[t + 1] = gT; data[t + 2] = bT; data[t + 3] = 1;
    },
  };
}

// ---- comparison with the documented ~1-ulp window caveat (cable mode) -------
function segsNearWindow(cable, ei, wave) {
  const out = [];
  for (let s = cable.segOff[ei], e2 = cable.segOff[ei] + cable.segN[ei]; s < e2; s++) {
    let d = cable.segT[s] - wave; if (d < 0) d += 1;
    if (Math.abs(d - 0.18) < 1e-4) out.push(s);
  }
  return out;
}
function assertSameRay(a, b, msg) {
  const norm = (v) => { const m = Math.hypot(v[0], v[1], v[2]); return m === 0 ? null : [v[0] / m, v[1] / m, v[2] / m]; };
  const na = norm(a), nb = norm(b);
  if (!na || !nb) { assert.deepStrictEqual([...a], [...b], msg); return; }
  for (let c = 0; c < 3; c++) {
    if (Math.abs(na[c] - nb[c]) > 1e-6) {
      assert.fail(msg + " — window-adjacent segments must be the same hue");
    }
  }
}

const WAVES = [0, 0.1, 0.17999, 0.18, 0.1801, 0.5, 0.99];
const MODES = ["spike", "active", "inspect", "anat"];

test("P10 reconstruction matches legacy cable writer over modes/waves (pre+post edit)", () => {
  const sim = makeSim(1234), cable = makeCable(77);
  const segIdx = []; for (let i = 0; i < NE; i += 7) segIdx.push(i);
  const sel = 42;
  const inSet = new Set([sim.src[5], sim.dst[9], 7]);
  const vertexCount = /* position buffer built from segPos, 2 verts/segment */ cable.segN.reduce((a, n) => a + n, 0) * 2;
  for (const em of MODES) for (const useHeat of [true, false]) for (const wave of WAVES) {
    const heat = useHeat ? sim.heat : null;
    const legacy = new Float32Array(vertexCount * 3);
    fillCableColorsLegacy(cable, sim, wave, em, sel, null, inSet, heat, segIdx, legacy);
    const target = makeTarget(NE);
    fillCableColorsP10(cable, sim, wave, em, sel, null, inSet, heat, segIdx, target);
    const recon = p10ReconstructPerVertex(target.data, cable, wave, vertexCount, segIdx);
    assert.strictEqual(recon.length, legacy.length, "buffer length " + em + " heat=" + !!useHeat);
    for (let k = 0; k < segIdx.length; k++) {
      const ei = segIdx[k];
      for (let s = cable.segOff[ei], e2 = cable.segOff[ei] + cable.segN[ei]; s < e2; s++) {
        const v = s * 6;
        const a = [legacy[v], legacy[v + 1], legacy[v + 2]];
        const b = [recon[v], recon[v + 1], recon[v + 2]];
        if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
        const near = segsNearWindow(cable, ei, wave);
        assert.ok(near.includes(s),
          `mode=${em} heat=${useHeat} wave=${wave} seg=${s}: [${a}] vs [${b}] outside the documented d==0.18 window`);
        assertSameRay(a, b, `mode=${em} wave=${wave} seg=${s}`);
        // the only allowed difference: front vs trail brightness of one hue
        const ratio = (x, y) => (y === 0 ? x === 0 : Math.abs(x / y - 1 / 0.35) < 1e-5 || Math.abs(x / y - 0.35) < 1e-5 || x === y);
        assert.ok(ratio(a[0], b[0]) && ratio(a[1], b[1]) && ratio(a[2], b[2]),
          `window-adjacent mismatch must be front/trail brightness only: [${a}] vs [${b}]`);
      }
    }
  }
});

test("P10 reconstruction matches legacy chord writer exactly (no wave branch)", () => {
  const sim = makeSim(555);
  const segIdx = []; for (let i = 0; i < NE; i += 7) segIdx.push(i);
  const sel = 17;
  const inSet = new Set([sim.src[3], 11]);
  const vertexCount = segIdx.length * 2;
  for (const em of MODES) for (const useHeat of [true, false]) for (const anat of [true, false]) {
    const heat = useHeat ? sim.heat : null;
    const legacy = new Float32Array(vertexCount * 3);
    chordLegacy(sim, em, sel, inSet, heat, anat, segIdx, legacy);
    const target = makeTarget(NE);
    chordP10(sim, em, sel, inSet, heat, anat, segIdx, target);
    const recon = p10ReconstructPerVertexChord(target.data, segIdx, vertexCount);
    assert.strictEqual(recon.length, legacy.length);
    for (let i = 0; i < recon.length; i++) {
      assert.ok(Object.is(recon[i], legacy[i]),
        `chord mode=${em} heat=${useHeat} anat=${anat} float[${i}]`);
    }
  }
});

test("P10 texture scheme: RGBA float texel indexing round-trips for every edge", async () => {
  const THREE = await import(require("node:url").pathToFileURL(
    path.join(__dirname, "..", "three.module.js")).href);
  for (const E of [1, 1023, 1024, 1025, 6000, 20480, 71680]) {
    const W = Math.max(1, Math.ceil(E / P10_ROW) * P10_ROW);
    const data = new Float32Array(W * P10_COLS_PER_EDGE * 4);
    const tex = new THREE.DataTexture(data, W, P10_COLS_PER_EDGE, THREE.RGBAFormat, THREE.FloatType);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    assert.strictEqual(tex.image.data, data, "DataTexture must not copy the backing buffer");
    assert.strictEqual(tex.image.width, W);
    // GLSL nearest-sampling math: texel = floor(u * W); u must hit texel 2ei / 2ei+1
    for (let ei = 0; ei < E; ei += Math.max(1, (E / 257) | 0)) {
      // GLSL nearest-sampling: texel = floor(u * totalTexels), totalTexels =
      // W*2 (RGBA rows: row 0 = front, row 1 = trail). Sample at texel CENTER:
      // u = (texel + 0.5) / (2W). Front texel = 2*ei, trail = 2*ei+1.
      const uF = (2 * ei + 0.5) / (2 * W);
      const uT = (2 * ei + 1.5) / (2 * W);
      assert.strictEqual(Math.floor(uF * 2 * W), 2 * ei, "front texel E=" + E + " ei=" + ei);
      assert.strictEqual(Math.floor(uT * 2 * W), 2 * ei + 1, "trail texel E=" + E + " ei=" + ei);
    }
    // padded texels stay zero (never sampled: u clamps inside [0,1) for ei<E)
    if (W * 2 > 2 * E) assert.strictEqual(data[(2 * E) * 4], 0, "first padded texel must stay zero");
  }
});

test("P10 page: edge writers are per-edge, texture target wired, cadence preserved", { skip: !hasP10 && "P10 not yet implemented" }, () => {
  // ShaderMaterial + DataTexture present and correctly configured
  assert.ok(/new THREE\.ShaderMaterial\(/.test(src), "ShaderMaterial for edgeLines");
  assert.ok(/new THREE\.DataTexture\(/.test(src), "DataTexture for edge colors");
  assert.ok(/THREE\.RGBAFormat,\s*THREE\.FloatType\)/.test(src), "RGBA float texels");
  assert.ok(/\.magFilter\s*=\s*THREE\.NearestFilter/.test(src), "NearestFilter mag");
  assert.ok(/\.minFilter\s*=\s*THREE\.NearestFilter/.test(src), "NearestFilter min");
  assert.ok(/\.flipY\s*=\s*false/.test(src), "flipY false");
  assert.ok(/\.generateMipmaps\s*=\s*false/.test(src), "no mipmaps");
  // shader source pins
  assert.ok(/uniform sampler2D edgeTex/.test(src));
  assert.ok(/attribute float p10T/.test(src), "per-vertex segment phase attribute");
  assert.ok(/attribute float p10Edge/.test(src), "per-vertex edge index attribute");
  assert.ok(/d < 0\.18/.test(src), "exact wave window in the shader");
  assert.ok(/if \(d < 0\.0\) d \+= 1\.0/.test(src), "exact wave wrap in the shader");
  assert.ok(/#include <fog_fragment>/.test(src), "fog parity with legacy material");
  assert.ok(/#include <colorspace_fragment>/.test(src), "colorspace parity");
  // writers are per-edge: no per-vertex/per-segment color stores remain
  const cableStart = src.indexOf("const CABLE_WAVE_SPEED");
  const cableEnd = src.indexOf("// ---- W3 modulatory channel");
  const cableSlice = src.slice(cableStart, cableEnd);
  assert.ok(!/arr\[[^\]]*\]\s*=/.test(cableSlice.replace(/\/\/[^\n]*/g, "")),
    "fillCableColors must not write per-vertex color arrays");
  assert.ok(!/setXYZ/.test(cableSlice), "no setXYZ in the cable writer");
  assert.ok(/texData\[f\]\s*=\s*rF/.test(cableSlice), "per-edge texel store present");
  // exactly one cable recolor call (the legacy double-call redundancy is gone)
  const uv = src.indexOf("function updateVisuals");
  const uvBlock = src.slice(uv, src.indexOf("// node glow: scale spiking neurons", uv));
  const calls = uvBlock.match(/cableEdgeTick\(/g) || [];
  assert.strictEqual(calls.length, 1, "exactly one cable recolor call site (was 2)");
  assert.ok(/\(tick & 1\) === 0/.test(uvBlock), "30 Hz cable recolor cadence preserved");
  assert.ok(!/p5ZeroSeg/.test(uvBlock), "no legacy zero-fill helper in updateVisuals");
  // chord path routes through the per-edge writer
  assert.ok(/p10ChordColors|chordP10|p10WriteChord/.test(uvBlock) || /target\.set\(/.test(uvBlock),
    "chord coloring routed through the per-edge target");
});

test("P10 page: real fillCableColors drives the per-edge target with legacy math", { skip: !hasP10 && "P10 not yet implemented" }, () => {
  const cableStart = src.indexOf("const CABLE_WAVE_SPEED");
  const cableEnd = src.indexOf("// ---- W3 modulatory channel");
  const cableSlice = src.slice(cableStart, cableEnd);
  // the writer needs the p10 texture infra (page-level consts + p10TargetFor)
  const infraStart = src.indexOf("const P10_ROW =");
  const infraEnd = src.indexOf("// Vertex shader: samples the per-edge front/trail texel pair");
  const infraSlice = src.slice(infraStart, infraEnd);
  const sandbox = { console, Math, performance: { now: () => 0 },
    // minimal THREE stub (see the chord test below; real DataTexture behavior
    // is covered by the three.js-import test)
    THREE: { RGBAFormat: 1, FloatType: 2, NearestFilter: 1003, ClampToEdgeWrapping: 1001,
      DataTexture: class { constructor(data, w, h, format, type){
        this.image = { data, width: w, height: h }; this.format = format; this.type = type; } } },
    npSetFor: null };
  sandbox.sim = null; sandbox.brainHolder = null; sandbox.SCIMODE = null;
  vm.createContext(sandbox);
  vm.runInContext(infraSlice + "\n" + cableSlice, sandbox, { filename: "p10-cable-slice.js" });
  const fill = sandbox.fillCableColors;
  assert.strictEqual(typeof fill, "function");
  const sim = makeSim(909), cable = makeCable(31);
  const segIdx = []; for (let i = 0; i < NE; i += 7) segIdx.push(i);
  const sel = 8;
  const inSet = new Set([sim.src[2], sim.dst[2]]);
  const vertexCount = cable.segN.reduce((a, n) => a + n, 0) * 2;
  sandbox.p10TargetFor(NE);                       // seed the shared texture once
  for (const em of MODES) for (const useHeat of [true, false]) for (const wave of [0, 0.18, 0.5]) {
    const heat = useHeat ? sim.heat : null;
    sandbox.brainHolder = { _eHeat: heat, segIdx, npMembers: null };
    const legacy = new Float32Array(vertexCount * 3);
    fillCableColorsLegacy(cable, sim, wave, em, sel, null, inSet, heat, segIdx, legacy);
    sandbox.p10TargetFor.data.fill(0);
    fill(cable, sim, wave, em, sel, null, null);
    const recon = p10ReconstructPerVertex(sandbox.p10TargetFor.data, cable, wave, vertexCount, segIdx);
    for (let k = 0; k < segIdx.length; k++) {
      const ei = segIdx[k];
      for (let s = cable.segOff[ei], e2 = cable.segOff[ei] + cable.segN[ei]; s < e2; s++) {
        const v = s * 6;
        const a = [legacy[v], legacy[v + 1], legacy[v + 2]];
        const b = [recon[v], recon[v + 1], recon[v + 2]];
        if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
        const near = segsNearWindow(cable, ei, wave);
        assert.ok(near.includes(s), `page fillCableColors mismatch outside window: mode=${em} wave=${wave} seg=${s}`);
        assertSameRay(a, b, "page fillCableColors window mismatch");
      }
    }
  }
});

test("P10 page: real chord writer drives the per-edge target exactly", { skip: !hasP10 && "P10 not yet implemented" }, () => {
  const chordAt = src.indexOf("function p10ChordColors");
  assert.ok(chordAt > 0, "p10ChordColors not found");
  const chordEnd = src.indexOf("\nfunction ", chordAt + 10);
  const slice = src.slice(chordAt, chordEnd);
  const sandbox = { console, Math, P5_CHORD_LUT,
    // minimal THREE stub: p10TargetFor only constructs a DataTexture (real
    // DataTexture behavior is covered by the three.js-import test above)
    THREE: { RGBAFormat: 1, FloatType: 2, NearestFilter: 1003, ClampToEdgeWrapping: 1001,
      DataTexture: class { constructor(data, w, h, format, type){
        this.image = { data, width: w, height: h }; this.format = format; this.type = type; } } },
    brainHolder: null };
  vm.createContext(sandbox);
  // p10ChordColors needs the P10 texture infra + the (P5) selection cache
  const infraStart = src.indexOf("const P10_ROW =");
  const infraEnd = src.indexOf("// Vertex shader: samples the per-edge front/trail texel pair");
  const npStart = src.indexOf("const P5_NP_CACHE");
  const npEnd = src.indexOf("function fillCableColors");
  vm.runInContext(src.slice(infraStart, infraEnd) + "\n" + src.slice(npStart, npEnd) + "\n" +
    slice + "\nthis.__f = p10ChordColors;", sandbox, { filename: "p10-chord-slice.js" });
  const f = sandbox.__f;
  const sim = makeSim(31);
  const segIdx = []; for (let i = 0; i < NE; i += 7) segIdx.push(i);
  const sel = 5;
  const vertexCount = segIdx.length * 2;
  sandbox.p10TargetFor(NE);                       // seed the shared texture once
  // the page writer derives inSet from brainHolder.npMembers via the (P5)
  // npSetFor cache — mirror that derivation for the legacy side so both
  // sides see the identical membership input (full-chain parity, like P5).
  const npMembers = new Map([["MB", [sim.src[1], 3, sim.dst[1]]]]);
  const inSet = new Set(npMembers.get("MB"));
  for (const em of MODES) for (const useHeat of [true, false]) for (const anat of [true, false]) {
    const heat = useHeat ? sim.heat : null;
    sandbox.brainHolder = { _eHeat: heat, segIdx, npMembers };
    const legacy = new Float32Array(vertexCount * 3);
    chordLegacy(sim, em, sel, inSet, heat, anat, segIdx, legacy);
    sandbox.p10TargetFor.data.fill(0);
    f(sim, em, sel, "MB", anat);
    const recon = p10ReconstructPerVertexChord(sandbox.p10TargetFor.data, segIdx, vertexCount);
    for (let i = 0; i < recon.length; i++) {
      assert.ok(Object.is(recon[i], legacy[i]), `page chord float[${i}] mode=${em} heat=${useHeat} anat=${anat}`);
    }
  }
});

test("P10 page: material config and buffer wiring match the legacy presentation", { skip: !hasP10 && "P10 not yet implemented" }, () => {
  // opacity 0.85 in the fragment output; transparent/blending/depthWrite flags
  assert.ok(/vec4\(vP10Color,\s*0\.85\)/.test(src), "fragment opacity 0.85 (legacy material value)");
  assert.ok(/transparent:\s*true/.test(src), "transparent edges preserved");
  assert.ok(/blending:\s*anatMode \? THREE\.AdditiveBlending : THREE\.NormalBlending/.test(src),
    "per-view blending preserved");
  assert.ok(/depthWrite:\s*!anatMode/.test(src), "depthWrite preserved");
  // attributes are bound per vertex from the same segment tables legacy used
  assert.ok(/p10T.*segT|segT.*p10T/s.test(src), "p10T sourced from cable.segT");
  assert.ok(/p10Edge/.test(src), "p10Edge attribute present");
  // no full color-attribute upload remains for the edge layer
  assert.ok(!/edgeLines\.geometry\.getAttribute\("color"\)\.needsUpdate\s*=\s*true/.test(src),
    "no full edge color buffer upload");
  assert.ok(/tex\.needsUpdate\s*=\s*true/.test(src),
    "texture upload flag present");
});
