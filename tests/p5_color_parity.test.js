"use strict";
// P5 parity tests — color-write hygiene (ANIMATION_PERFORMANCE_PROPOSAL P5).
//
// Pattern mirrors tests/p4_particle_parity.test.js:
//   1. The three production color writers are transcribed verbatim below
//      ("legacy" runners) and ALSO extracted from the live page text ("current"
//      runners). Pre-P5 both are the same code, which validates the
//      transcriptions against real production source. Post-P5 the page slice is
//      the new implementation, so the same comparisons prove the rewrite is
//      bit-identical.
//   2. All writers must produce EXACTLY equal Float32 color buffers (element
//      identity, not tolerance), equal needsUpdate flags, and equal material
//      opacity side effects.
//
// three.js semantics pinned by this suite: BufferAttribute.setXYZ on an
// unnormalized Float32 itemSize-3 attribute is `array[i*3]=x` — channel-wise
// writes to .array are therefore equivalent by construction, and these tests
// verify it empirically per frame of every scenario.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const src = fs.readFileSync(PAGE, "utf8");
// (P10) shared reconstruction helper: rebuilds the per-vertex legacy buffer
// from the per-edge texture data so the page's post-P10 writers can still be
// compared against the P5-era legacy transcriptions.
const { p10ReconstructPerVertex, p10ReconstructPerVertexChord } =
  require("./helpers/p10_reconstruct.js");

// ---- page extraction (markers kept stable by the P5 edit) -------------------
const cableStart = src.indexOf("const CABLE_WAVE_SPEED");
const cableEnd = src.indexOf("// ---- W3 modulatory channel");
assert.ok(cableStart > 0 && cableEnd > cableStart, "cable section markers not found");
const cableSlice = src.slice(cableStart, cableEnd);

const updAt = src.indexOf("function updateVisuals");
assert.ok(updAt > 0, "updateVisuals not found");
const chordStart = src.indexOf("const colAttr = brainHolder.edgeLines.geometry.getAttribute", updAt);
const chordEnd = src.indexOf("// node glow: scale spiking neurons", chordStart);
assert.ok(chordStart > 0 && chordEnd > chordStart, "chord block markers not found");
const chordSlice = src.slice(chordStart, chordEnd);

const modStart = src.indexOf("function modTick(){");
const modEnd = src.indexOf("function realPosOf(", modStart);
assert.ok(modStart > 0 && modEnd > modStart, "modTick markers not found");
const modSlice = src.slice(modStart, modEnd);

const hasP5 = /function npSetFor/.test(src);

// ---- deterministic fixtures (seeded LCG, like P4) ----------------------------
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
  return { spikes, src, dst, isExc, E };
}

// fake cable: per-edge segment counts/offsets/t-phases
function makeCable(seed) {
  const rng = makeRng(seed ^ 0xabe1);
  const pick = [];
  for (let k = 0; k < 600; k++) pick.push((rng() * NE) | 0);
  const segN = [], segOff = [], segT = [];
  let off = 0;
  for (const ei of pick) {
    const n = 1 + ((rng() * 8) | 0);
    segN[ei] = n; segOff[ei] = off;
    for (let s = 0; s < n; s++) segT.push(s === 0 ? 0 : (s === n - 1 ? 1 : rng()));
    off += n;
  }
  return { segN, segOff, segT, verts: off * 2 };
}

function makeHeat(seed) {
  const rng = makeRng(seed ^ 0x7ea7);
  const heat = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = rng();
    heat[i] = u < 0.4 ? 0 : (u < 0.5 ? 0.01 + rng() * 0.04   // includes 0.05 band
             : (u < 0.55 ? 0.05 : 0.06 + rng() * 0.94));
  }
  return heat;
}

// fake BufferAttribute (unnormalized Float32, itemSize 3 — mirrors three.js)
function makeColAttr(nVerts) {
  const array = new Float32Array(nVerts * 3);
  return {
    array,
    needsUpdate: false,
    setXYZ(v, x, y, z) { const i = v * 3; array[i] = x; array[i + 1] = y; array[i + 2] = z; },
  };
}
function assertBufEqual(a, b, msg) {
  assert.strictEqual(a.length, b.length, msg + " (length)");
  for (let i = 0; i < a.length; i++)
    assert.ok(Object.is(a[i], b[i]), msg + " [" + i + "]: " + a[i] + " !== " + b[i]);
}

const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);

// ---- legacy transcriptions (verbatim from the pre-P5 page) -------------------
const MOD_COLORS = { dopamine:[0.85,0.20,0.55], serotonin:[0.30,0.65,0.95],
                     octopamine:[0.95,0.60,0.15] };

function legacyFillCableColors(cable, sim, wave, em, sel, selNp, colAttr, brainHolder){
  const { spikes, src, dst, isExc } = sim;
  const heat = brainHolder._eHeat;
  const segT = cable.segT, segOff = cable.segOff, segN = cable.segN;
  const segIdx = brainHolder.segIdx;
  const npMembers = selNp ? (brainHolder.npMembers && brainHolder.npMembers.get(selNp)) : null;
  const inSet = npMembers ? (()=>{ const m=new Set(npMembers); return m; })() : null;
  const dark = (ei)=>{
    for (let s=0;s<segN[ei];s++){
      const v = (segOff[ei]+s)*2;
      colAttr.setXYZ(v, 0,0,0); colAttr.setXYZ(v+1, 0,0,0);
    }
  };
  for (let k=0;k<segIdx.length;k++){
    const ei = segIdx[k];
    // participation filters (scientific modes)
    if (em === "inspect"){
      const sI = src[ei], dI = dst[ei];
      const touch = (sel>=0 && (sI===sel || dI===sel)) ||
                    (inSet && (inSet.has(sI) || inSet.has(dI)));
      if (!touch){ dark(ei); continue; }
    } else if (em === "active"){
      const carry = sim.E[ei] > 0.08 || (spikes[src[ei]] && spikes[dst[ei]]);
      if (!carry){ dark(ei); continue; }
    }
    const hS = heat ? heat[src[ei]] : (spikes[src[ei]] ? 1 : 0);
    if (hS <= 0.05){ dark(ei); continue; }
    const b = Math.min(1, hS)*0.75;
    const exc = isExc[ei];
    const elig = sim.E[ei];
    for (let s=0;s<segN[ei];s++){
      const t = segT[segOff[ei]+s];
      // travelling wavefront: segments within ±0.18 arbor-phase of the front
      // light up; the rest of the cable glows at 35% (trail).
      let d = t - wave; if (d < 0) d += 1;
      const front = d < 0.18 ? 1 : 0.35;
      const potent = elig > 0.08 ? 1.25 : 1;        // co-active: brighter
      const v = (segOff[ei]+s)*2;
      const rC = exc ? 0.55*b*front*potent : 0.12*b*front*potent;
      const gC = exc ? 0.30*b*front*potent : 0.34*b*front*potent;
      const bC = exc ? 0.10*b*front*potent : 0.55*b*front*potent;
      colAttr.setXYZ(v,   rC, gC, bC);
      colAttr.setXYZ(v+1, rC, gC, bC);
    }
  }
}

function legacyChord(ctx){
  const { colAttr, base, E, spikes, src, dst, isExc, em, sel, inSet, anatMode, brainHolder } = ctx;
  const gCol = [0.10,0.28,0.16], rCol = [0.30,0.10,0.16], dCol=[0.10,0.13,0.20];
  for (let k=0;k<base.length;k++){
    let c;
    if (em === "active"){
      // carrying recent activity: co-active trace or live pre-spike
      const ei = base[k];
      const carry = E[ei] > 0.08 || (spikes[src[ei]] && spikes[dst[ei]]);
      c = carry ? (isExc[ei] ? [0.16,0.62,0.34] : [0.72,0.26,0.30]) : [0,0,0];
    } else if (em === "inspect"){
      const ei = base[k];
      const sI = src[ei], dI = dst[ei];
      const touch = (sel>=0 && (sI===sel || dI===sel)) ||
                    (inSet && (inSet.has(sI) || inSet.has(dI)));
      c = touch ? (spikes[sI] ? (isExc[ei]? [0.20,0.80,0.44] : [0.90,0.34,0.38]) : [0.42,0.50,0.62]) : [0,0,0];
    } else if (anatMode){
      // glow-path wiring: edges carry only live activity; the idle brain
      // is clean (no static web). Excitatory = warm ember, inhibitory =
      // cool azure; brightness follows the pre-neuron's decaying heat.
      const ei = base[k];
      const hS = brainHolder._eHeat ? brainHolder._eHeat[src[ei]] : (spikes[src[ei]]?1:0);
      if (hS > 0.05){
        const b = Math.min(1, hS) * 0.75;
        c = isExc[ei] ? [0.55*b, 0.30*b, 0.10*b] : [0.12*b, 0.34*b, 0.55*b];
      } else c = [0,0,0];
    } else {
      const ei = base[k];
      c = spikes[src[ei]] ? (isExc[ei]? gCol : rCol) : dCol;
    }
    colAttr.setXYZ(k*2, c[0], c[1], c[2]);           // both endpoints of the
    colAttr.setXYZ(k*2+1, c[0], c[1], c[2]);         // k-th segment (was k/k+S)
  }
  colAttr.needsUpdate = true;
}

function legacyModTick(ctx){
  const { holder, SCIMODE, sim, performance } = ctx;
  if (!holder || !holder.modLines) return;
  const o = holder.modOverlay; if (!o) return;
  // pure-anatomy modes (A anatomy, T cell types) keep the idle brain clean
  if (SCIMODE.chip==="A" || SCIMODE.chip==="T"){
    holder.modLines.material.opacity = 0;
    return;
  }
  const tone = sim.modEma || { dopamine:0, serotonin:0, octopamine:0 };
  const daSig = clamp(sim.DA.v, 0, 3)/3;
  const colAttr = holder.modLines.geometry.getAttribute("color");
  const pulse = 0.5 + 0.5*Math.sin(performance.now()*0.004);
  for (let k=0; k<o.list.length; k++){
    const me = o.mods[o.list[k]];
    const type = me.modulatorType || me.nt;
    const base = MOD_COLORS[type] || [0.6,0.6,0.6];
    const amp = Math.min(1, (tone[type]||0)*6 + (type==="dopamine" ? daSig : 0));
    const a = amp*(0.35 + 0.65*pulse);
    colAttr.setXYZ(k*2,   base[0]*a, base[1]*a, base[2]*a);
    colAttr.setXYZ(k*2+1, base[0]*a, base[1]*a, base[2]*a);
  }
  colAttr.needsUpdate = true;
  holder.modLines.material.opacity = 0.85;
}

// ---- current-path runners (page slices in a vm sandbox) ----------------------
// The page code reads brainHolder / SCIMODE / sim as globals, so the sandbox is
// (re)populated per scenario before each call.
function makeCableFn() {
  // (P10) the page writer now stores per-edge texels into the shared edge
  // texture, so the runner extracts the P10 texture infra alongside the
  // cable slice; the caller reconstructs the per-vertex buffer via the
  // shared helper (tests/helpers/p10_reconstruct.js) before comparing.
  const infra = src.slice(src.indexOf("const P10_ROW ="),
    src.indexOf("// Vertex shader: samples the per-edge front/trail texel pair"));
  const sandbox = { console, Math, performance: { now: () => 0 },
    // minimal THREE stub: p10TargetFor only constructs a DataTexture
    THREE: { RGBAFormat: 1, FloatType: 2, NearestFilter: 1003, ClampToEdgeWrapping: 1001,
      DataTexture: class { constructor(data, w, h, format, type){
        this.image = { data, width: w, height: h }; this.format = format; this.type = type; } } } };
  const fn = vm.runInNewContext(
    infra + "\n(function(){\n" + cableSlice + "\nreturn fillCableColors; })()",
    sandbox, { filename: "p5-cable-slice.js" });
  return { fn, sandbox };
}
function makeChordFn() {
  // (P10) the legacy in-loop chord writer became the p10ChordColors helper
  // (per-edge texel stores). Extract the helper + P10 texture infra +
  // P5_CHORD_LUT + npSetFor; expose the sandbox so the caller can read the
  // texture and reconstruct the per-vertex buffer for comparison.
  const infra = src.slice(src.indexOf("const P10_ROW ="),
    src.indexOf("// Vertex shader: samples the per-edge front/trail texel pair"));
  const lut = src.slice(src.indexOf("const P5_CHORD_LUT"), src.indexOf("function updateVisuals"));
  const npSet = src.slice(src.indexOf("const P5_NP_CACHE"), src.indexOf("function fillCableColors"));
  const chordAt = src.indexOf("function p10ChordColors");
  assert.ok(chordAt > 0, "p10ChordColors not found in page");
  const chordSlice = src.slice(chordAt, src.indexOf("\nfunction ", chordAt + 10));
  const sandbox = { console, Math, clamp,
    THREE: { RGBAFormat: 1, FloatType: 2, NearestFilter: 1003, ClampToEdgeWrapping: 1001,
      DataTexture: class { constructor(data, w, h, format, type){
        this.image = { data, width: w, height: h }; this.format = format; this.type = type; } } } };
  const fn = vm.runInNewContext(
    infra + "\n" + lut + "\n" + npSet + "\n" +
    "(function(){\nreturn function(ctx){\n" +
    "const s = { console: console, Math: Math, clamp: clamp,\n" +
    "  E: ctx.E, spikes: ctx.spikes, src: ctx.src, dst: ctx.dst, isExc: ctx.isExc,\n" +
    "  anatMode: ctx.anatMode, SCIMODE: ctx.SCIMODE, brainHolder: ctx.brainHolder };\n" +
    "with (s) {\n" + chordSlice + "\np10ChordColors(ctx.sim, ctx.em, ctx.sel, ctx.selNp, ctx.anatMode);\n}\n}; })()",
    sandbox, { filename: "p5-chord-slice.js" });
  return { fn, sandbox };
}
// (P10) window-aware comparator: the GPU path is bit-exact except for the
// documented d == 0.18 wave-window band, where the shader's f32 comparison
// may flip a segment between the front and trail brightness of the SAME hue.
function assertReconMatchesLegacy(recon, legacy, cable, wave, segIdx, msg) {
  assert.strictEqual(recon.length, legacy.length, msg + " (length)");
  for (const ei of segIdx) {
    for (let s = cable.segOff[ei], e2 = s + cable.segN[ei]; s < e2; s++) {
      const v = s * 6;
      let same = true;
      for (let c = 0; c < 6; c++) if (!Object.is(recon[v + c], legacy[v + c])) { same = false; break; }
      if (same) continue;
      let d = cable.segT[s] - wave; if (d < 0) d += 1;
      assert.ok(Math.abs(d - 0.18) < 1e-4, msg + " [seg " + s + "] differs outside the d==0.18 window band");
      for (let c = 0; c < 3; c++) {
        const x = recon[v + c], y = legacy[v + c];
        assert.ok(x === y || (y !== 0 && (Math.abs(x / y - 1 / 0.35) < 1e-4 || Math.abs(x / y - 0.35) < 1e-4)),
          msg + " [seg " + s + " ch " + c + "] not a front/trail brightness flip of the same hue");
      }
    }
  }
}
function makeModFn(extra) {
  const fb = src.match(/const P5_MOD_FALLBACK = \[[^\]]*\];/);
  assert.ok(fb, "P5_MOD_FALLBACK not found in page");
  const sandbox = Object.assign({ console, Math, clamp, MOD_COLORS, code: fb[0] }, extra);
  const fn = vm.runInNewContext(
    fb[0] + "\n(function(){\n" + modSlice + "\nreturn modTick; })()",
    sandbox, { filename: "p5-mod-slice.js" });
  return fn;
}

// ---- shared scenario state ----------------------------------------------------
const sim = makeSim(20260923);
const cable = makeCable(7);
const heat = makeHeat(11);
const base = (() => { const r = makeRng(99), out = []; for (let k = 0; k < 800; k++) out.push((r() * NE) | 0); return out; })();
const npMembers = new Map([["MB", [3, 17, 200, 250, 399]], ["CX", [1, 2]]]);
const cableSegIdx = Object.keys(cable.segN).map(Number).sort((a, b) => a - b);

test("P5 parity: fillCableColors current page === legacy transcription (all modes/waves/heat)", () => {
  const cur = makeCableFn();
  const waves = [0, 0.17, 0.18, 0.1799999, 0.5, 0.999, 1.0];
  const modes = [
    { em: "spike", sel: -1, selNp: null },
    { em: "anat", sel: -1, selNp: null },
    { em: "inspect", sel: -1, selNp: null },
    { em: "inspect", sel: 17, selNp: null },
    { em: "inspect", sel: -1, selNp: "MB" },
    { em: "inspect", sel: 200, selNp: "MB" },
    { em: "inspect", sel: -1, selNp: "ZZ-missing" },   // selNp not in map
    { em: "active", sel: -1, selNp: null },
  ];
  cur.sandbox.p10TargetFor(NE);          // seed the shared texture once
  for (const w of waves) for (const m of modes) for (const h of [heat, null]) {
    const bh = { _eHeat: h, segIdx: cableSegIdx, npMembers };
    cur.sandbox.brainHolder = bh;
    cur.sandbox.p10TargetFor.data.fill(0);
    cur.fn(cable, sim, w, m.em, m.sel, m.selNp, null);
    const recon = p10ReconstructPerVertex(cur.sandbox.p10TargetFor.data, cable, w, cable.verts, cableSegIdx);
    const b = makeColAttr(cable.verts);
    legacyFillCableColors(cable, sim, w, m.em, m.sel, m.selNp, b, bh);
    assertReconMatchesLegacy(recon, b.array, cable, w, cableSegIdx,
      "cable colors differ (wave=" + w + " em=" + m.em + " sel=" + m.sel + " selNp=" + m.selNp + " heat=" + (h ? "yes" : "null") + ")");
  }
});

test("P5 parity: inSet caching does not change results across repeats and selection switches", () => {
  const cur = makeCableFn();
  const bh = { _eHeat: heat, segIdx: cableSegIdx, npMembers };
  cur.sandbox.p10TargetFor(NE);
  for (let round = 0; round < 3; round++) {
    cur.sandbox.brainHolder = bh;
    cur.sandbox.p10TargetFor.data.fill(0);
    cur.fn(cable, sim, 0.3, "inspect", -1, "MB", null);
    const recon = p10ReconstructPerVertex(cur.sandbox.p10TargetFor.data, cable, 0.3, cable.verts, cableSegIdx);
    const b = makeColAttr(cable.verts);
    legacyFillCableColors(cable, sim, 0.3, "inspect", -1, "MB", b, bh);
    assertReconMatchesLegacy(recon, b.array, cable, 0.3, cableSegIdx, "round " + round + ": cached inSet diverged");
  }
  // selection switch MB -> CX -> MB must track selection changes identically
  cur.sandbox.brainHolder = bh;
  cur.fn(cable, sim, 0.3, "inspect", -1, "CX", null);
  cur.sandbox.p10TargetFor.data.fill(0);
  cur.fn(cable, sim, 0.3, "inspect", -1, "MB", null);
  const recon1 = p10ReconstructPerVertex(cur.sandbox.p10TargetFor.data, cable, 0.3, cable.verts, cableSegIdx);
  const b1 = makeColAttr(cable.verts);
  legacyFillCableColors(cable, sim, 0.3, "inspect", -1, "CX", b1, bh);
  legacyFillCableColors(cable, sim, 0.3, "inspect", -1, "MB", b1, bh);
  assertReconMatchesLegacy(recon1, b1.array, cable, 0.3, cableSegIdx, "selection switch diverged");
});

test("P5 parity: legacy chord loop current page === transcription (all modes)", () => {
  const current = makeChordFn();
  const currentFn = current.fn;
  const mkCtx = (over) => {
    const bh = Object.assign({ _eHeat: heat, cableReady: false, cable: null, segIdx: base, npMembers }, over.bh || {});
    const scimode = Object.assign({ sel: -1, selNp: null }, over.scimode || {});
    return {
      base, E: sim.E, spikes: over.spikes || sim.spikes, src: sim.src, dst: sim.dst,
      isExc: sim.isExc, anatMode: !!over.anatMode,
      brainHolder: bh, SCIMODE: scimode,
      // legacy-transcription mirrors of what the slice derives from globals:
      em: over.em || "spike", sel: scimode.sel,
      selNp: scimode.selNp,   // (P10) the page writer re-derives inSet via npSetFor
      inSet: scimode.selNp ? new Set(npMembers.get(scimode.selNp)) : null,
      // (P10) the page writer reads sim.spikes/sim.E directly, so the sim shim
      // must carry the same overrides the legacy transcription receives
      simShim: Object.assign({}, sim, { spikes: over.spikes || sim.spikes, E: sim.E }),
    };
  };
  const scenarios = [
    mkCtx({}),
    mkCtx({ em: "active", bh: { _edgeMode: "active" } }),
    mkCtx({ em: "inspect", scimode: { sel: 17 }, bh: { _edgeMode: "inspect" } }),
    mkCtx({ em: "inspect", scimode: { sel: -1, selNp: "MB" }, bh: { _edgeMode: "inspect" } }),
    mkCtx({ em: "inspect", scimode: { sel: 3, selNp: "CX" }, bh: { _edgeMode: "inspect" } }),
    mkCtx({ anatMode: true }),
    mkCtx({ anatMode: true, bh: { _eHeat: null } }),
    mkCtx({ em: "active", anatMode: true, bh: { _edgeMode: "active" } }),
    mkCtx({ spikes: new Array(N).fill(false) }),
    mkCtx({ spikes: new Array(N).fill(true), em: "active", bh: { _edgeMode: "active" } }),
  ];
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    current.sandbox.p10TargetFor(NE);          // seed the shared texture
    current.sandbox.p10TargetFor.data.fill(0);
    current.sandbox.p10TargetFor.tex.needsUpdate = false;
    currentFn(Object.assign({}, sc, { sim: sc.simShim }));
    // chord mode has no wave branch: the reconstruction is bit-exact
    const recon = p10ReconstructPerVertexChord(current.sandbox.p10TargetFor.data, base, base.length * 2);
    const b = makeColAttr(base.length * 2);
    legacyChord(Object.assign({}, sc, { colAttr: b }));
    assert.strictEqual(recon.length, b.array.length, "chord buffer length, scenario " + i);
    for (let j = 0; j < recon.length; j++)
      assert.ok(Object.is(recon[j], b.array[j]),
        "chord colors differ in scenario " + i + " [" + j + "]: recon=" + recon[j] + " legacy=" + b.array[j]);
    assert.strictEqual(current.sandbox.p10TargetFor.tex.needsUpdate, true,
      "chord texture upload flag, scenario " + i);
  }
});

function modFixture(type, toneV, daV, chip) {
  const list = [0, 1, 2, 3];
  const mods = list.map(() => (type ? { modulatorType: type } : { nt: "unknownpeptide" }));
  return {
    list, mods,
    sim: { modEma: { dopamine: toneV, serotonin: toneV * 0.5, octopamine: toneV * 0.25 }, DA: { v: daV } },
    SCIMODE: { chip: chip || "S" },
  };
}

test("P5 parity: modTick current page === transcription (types/tone/DA/chips/no-ops)", () => {
  const cases = [
    modFixture("dopamine", 0.2, 1.5, "S"),
    modFixture("serotonin", 0.05, 0.0, "S"),
    modFixture("octopamine", 0.0, 3.0, "S"),
    modFixture(null, 0.3, 0.5, "S"),           // unknown modulator -> fallback literal
    modFixture("dopamine", 0, 0, "S"),         // amp 0
    modFixture("dopamine", 0.9, -1.5, "S"),    // da clamp low
    modFixture("dopamine", 0.5, 1.0, "A"),     // anatomy chip: opacity-0 early return
    modFixture("dopamine", 0.5, 1.0, "T"),
  ];
  for (const f of cases) {
    const colCur = makeColAttr(f.list.length * 2);
    const holderCur = { modLines: { geometry: { getAttribute: () => colCur }, material: { opacity: -1 } }, modOverlay: { list: f.list, mods: f.mods } };
    const colLeg = makeColAttr(f.list.length * 2);
    const holderLeg = { modLines: { geometry: { getAttribute: () => colLeg }, material: { opacity: -1 } }, modOverlay: { list: f.list, mods: f.mods } };
    const perf = { now: () => 1234.5 };
    const cur = makeModFn({ brainHolder: holderCur, sim: f.sim, SCIMODE: f.SCIMODE, performance: perf });
    cur();
    legacyModTick({ holder: holderLeg, SCIMODE: f.SCIMODE, sim: f.sim, clamp, performance: perf });
    assertBufEqual(colCur.array, colLeg.array, "modTick colors differ (chip=" + f.SCIMODE.chip + ")");
    assert.strictEqual(holderCur.modLines.material.opacity, holderLeg.modLines.material.opacity, "modTick opacity differs");
  }
  // no-op paths: no brainHolder / no modLines / no overlay must not throw
  assert.doesNotThrow(() => makeModFn({ brainHolder: undefined, SCIMODE: { chip: "S" }, performance: { now: () => 0 } })());
  assert.doesNotThrow(() => makeModFn({ brainHolder: {}, SCIMODE: { chip: "S" }, performance: { now: () => 0 } })());
  assert.doesNotThrow(() => makeModFn({ brainHolder: { modLines: null, modOverlay: null }, SCIMODE: { chip: "S" }, performance: { now: () => 0 } })());
});

// ---- post-edit-only hygiene assertions ---------------------------------------
if (hasP5) {
  test("P5 hygiene: per-frame Set/array-literal allocations removed", () => {
    assert.ok(!/new Set\(npMembers\)/.test(src), "still builds new Set(npMembers) per call");
    const cableBlock = src.slice(cableStart, cableEnd);
    assert.ok(!/=>\s*\{\s*const m=new Set/.test(cableBlock), "cable writer still builds a Set per call");
    assert.ok(!/\bc\s*=\s*\[0\.\d/.test(src.slice(updAt, src.indexOf("function refreshWeightOverlay"))), "chord loop still allocates color literals per segment");
    assert.ok(/P5_CHORD_LUT|CHORD_LUT/.test(src), "chord LUT constants missing");
    assert.ok(/function npSetFor/.test(src), "npSetFor selection cache missing");
  });
  test("P5 hygiene: npSetFor cache invalidates on npMembers swap", () => {
    const sandbox = { console, Math };
    const m = new Map([["X", [1, 2, 3]]]);
    sandbox.npMembers = m;
    const npSetFor = vm.runInNewContext(
      "(function(){\n" + src.slice(src.indexOf("const P5_NP_CACHE"), src.indexOf("function fillCableColors")) + "\nreturn npSetFor; })()",
      sandbox, { filename: "p5-npsetfor.js" });
    const s1 = npSetFor(m, "X");
    const s2 = npSetFor(m, "X");
    assert.strictEqual(s1, s2, "cache did not reuse the Set for an unchanged selection");
    const m2 = new Map([["X", [4, 5]]]);              // dataset rebuild -> new Map identity
    sandbox.npMembers = m2;
    const s3 = npSetFor(m2, "X");
    assert.notStrictEqual(s3, s1, "cache survived a npMembers Map swap (stale membership)");
    assert.deepEqual([...s3], [4, 5]);
    m.set("X", [9]);                                     // same map, new array identity
    const s4 = npSetFor(m, "X");
    assert.deepEqual([...s4], [9], "cache survived member-array replacement (stale membership)");
  });
}
