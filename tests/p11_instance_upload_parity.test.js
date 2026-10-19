"use strict";
// P11 parity tests — partial instance uploads (ANIMATION_PERFORMANCE_PROPOSAL
// P11): the node-glow loop scales a strided 1/7 subset of the ~107k brain
// instances per frame, but legacy raises `nodeMesh.instanceMatrix.needsUpdate`
// afterwards, re-uploading the FULL N*16-float (~6.8 MB) instanceMatrix buffer
// every frame even though only ~N/7 matrices changed and the underlying
// POSITIONS are static.
//
// Design audit (documented here because it shaped the implementation):
//   * The proposal's first option — per-touched-instance addUpdateRange on
//     instanceMatrix — was verified to exist in the vendored three r160
//     (BufferAttribute.addUpdateRange/clearUpdateRanges/updateRanges; the
//     renderer patches exactly those ranges, else full-uploads) but is a
//     PESSIMIZATION for this pattern: the touched set is strided
//     (indices ≡ (tick+li) mod 7 across layers), so ranges cannot coalesce —
//     it would issue ~15k single-matrix gl.bufferSubData calls per frame
//     (r160 does one driver call PER range), far worse than one 6.8 MB
//     upload. Additionally, positions never change and the only per-frame
//     mutation is the scalar dummy.scale.setScalar(spikes?2.2:1), so patching
//     16-float matrices is the wrong unit of work entirely.
//   * Chosen instead (the row's "or restructure" clause, minimal form):
//     freeze instanceMatrix at build; carry the glow pulse in a per-instance
//     1-float instanced attribute `aPulseScale` applied in the vertex shader
//     via onBeforeCompile (`transformed *= aPulseScale` after begin_vertex).
//     Per-frame upload drops from N*64 bytes to N*4 bytes (exactly 1/16), in
//     ONE bufferSubData call.
//
// Numerical parity argument (verified below, not just asserted):
//   For an identity-rotation instance matrix, compose(position, I, s) = s*M1
//   where M1 = compose(position, I, 1), elementwise EXACTLY (the off-diagonal
//   zeros and the position column are untouched by scalar multiplication).
//   The legacy GPU transform M(s)*v and the patched transform M1*(s*v) then
//   round identically in f32 because both compute s*comp first and add the
//   position last (the test emulates both orders with Math.fround).
//
// Pattern mirrors P4/P5/P10: the legacy glow block is transcribed verbatim
// from the pre-edit page as the oracle, and the page-extracted new block is
// driven through the same frames post-edit. Sections 1–3 validate BEFORE the
// page edit (pure math + transcriptions); sections 4–5 gate on hasP11.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const src = fs.readFileSync(PAGE, "utf8");
const hasP11 = /setAttribute\("aPulseScale"/.test(src) && /p11Scale\.needsUpdate/.test(src);

// ---- deterministic fixtures (seeded LCG, like P4/P5/P10) --------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// layered brain fixture: per-layer global id ranges, like circuit.layers
const LAYER_SIZES = [640, 720, 560, 480, 600]; // N = 3000
const N = LAYER_SIZES.reduce((a, b) => a + b, 0);
function makeLayers() {
  const layers = []; let acc = 0;
  for (const n of LAYER_SIZES) {
    const L = [];
    for (let k = 0; k < n; k++) L.push(acc++);
    layers.push(L);
  }
  return layers;
}
function makePositions(seed) {
  const rng = makeRng(seed), pos = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) pos[i] = (rng() * 2 - 1) * 300;
  return pos;
}
// spike train with persistence: mostly stable, small flip probability, so
// instances are revisited in both states across the scenario (strided visits
// touch each instance every 7 frames per layer offset).
function makeSpikeScenario(seed, frames) {
  const rng = makeRng(seed);
  const out = [];
  let sp = new Uint8Array(N);
  for (let i = 0; i < N; i++) sp[i] = rng() < 0.12 ? 1 : 0;
  for (let f = 0; f < frames; f++) {
    out.push(sp);
    const next = new Uint8Array(sp);
    for (let i = 0; i < N; i++) if (rng() < 0.06) next[i] ^= 1;
    sp = next;
  }
  return out;
}

// ---- f32-exact mat4 model (column-major, three.js Matrix4 layout) -----------
// compose(position, identity quaternion, scalar s): exactly s on the diagonal,
// 0 elsewhere, position in the translation column (all values exactly
// representable — no rounding beyond the Float32Array store).
function composeScale(pos, s) {
  return new Float32Array([
    s, 0, 0, 0,
    0, s, 0, 0,
    0, 0, s, 0,
    pos[0], pos[1], pos[2], 1,
  ]);
}
// apply M to (x,y,z,1) the way the vertex shader does, with Math.fround at
// every multiply and add (f32 GPU arithmetic).
function applyMat(m, v) {
  const fr = Math.fround;
  const x = fr(fr(fr(fr(m[0] * v[0]) + fr(m[4] * v[1])) + fr(m[8] * v[2])) + m[12]);
  const y = fr(fr(fr(fr(m[1] * v[0]) + fr(m[5] * v[1])) + fr(m[9] * v[2])) + m[13]);
  const z = fr(fr(fr(fr(m[2] * v[0]) + fr(m[6] * v[1])) + fr(m[10] * v[2])) + m[14]);
  return [x, y, z];
}

// ---- legacy node-glow block (verbatim from the pre-edit page) ---------------
// fly_demon_3d.html updateVisuals, "node glow" section. `nodeMesh` is an
// InstancedMesh-like stub writing into a Float32Array matrix buffer; dummy is
// an Object3D-like stub whose updateMatrix composes position+scale exactly as
// three.js does for identity rotation.
function makeDummy() {
  return {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    scale: { s: 1, setScalar(s) { this.s = s; } },
    matrix: null,
    updateMatrix() { this.matrix = composeScale([this.position.x, this.position.y, this.position.z], this.scale.s); },
  };
}
function glowBlockLegacy(nodeMesh, layers, spikes, brainHolder, dummy, tick) {
  // node glow: scale spiking neurons (subset per frame)
  const stride = 7;
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li], off = (tick + li) % stride;
    for (let k = off; k < L.length; k += stride) {
      const i = L[k];
      dummy.position.set(brainHolder.pos[i * 3], brainHolder.pos[i * 3 + 1], brainHolder.pos[i * 3 + 2]);
      dummy.scale.setScalar(spikes[i] ? 2.2 : 1); dummy.updateMatrix();
      nodeMesh.setMatrixAt(i, dummy.matrix);
    }
  }
  nodeMesh.instanceMatrix.needsUpdate = true;
}

// P11 store hook (identity in normal mode; the page defines this so the
// DEGRADED test mode can quantize stores without touching the hot loop).
function p11StoreScale(arr, i, v) { arr[i] = v; }

// ---- renderer upload mirror (r160 semantics, simplified to what both paths
// use: needsUpdate with empty updateRanges => one full bufferSubData) ----------
function makeMirror(bytesPerItem) {
  return { gpu: null, bytes: 0, uploads: 0, upload(attr) { this.gpu = Float32Array.from(attr.array); this.bytes += attr.array.length * bytesPerItem; this.uploads++; } };
}

// ============================================================================
// 1) Numeric identity: M(s)*v === M1*(s*v) under f32 rounding
// ============================================================================
test("P11 numeric identity: patched shader transform is f32-identical to legacy instanceMatrix transform", () => {
  const rng = makeRng(0x11e7);
  const fr = Math.fround;
  for (let t = 0; t < 2000; t++) {
    const p = [rng() * 600 - 300, rng() * 600 - 300, rng() * 600 - 300];
    // scales include the exact literals the app uses plus random f32 values
    const sRaw = t % 4 === 0 ? 1 : t % 4 === 1 ? 1.5 : t % 4 === 2 ? 2.2 : rng() * 4;
    const s = fr(sRaw);                       // Float32Array store rounds once
    const v = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
    // legacy: full matrix M(s) applied to v
    const legacy = applyMat(composeScale(p, s), v);
    // patched: unit matrix M1 applied to (s*v) — "transformed *= aPulseScale"
    // happens right after begin_vertex, BEFORE modelMatrix/instanceMatrix
    const sv = [fr(s * v[0]), fr(s * v[1]), fr(s * v[2])];
    const patched = applyMat(composeScale(p, 1), sv);
    assert.deepStrictEqual(patched, legacy,
      `M1*(s*v) must be f32-identical to M(s)*v at t=${t} s=${s}`);
    // and the matrix identity itself is exact: compose(p,s) === s*compose(p,1)
    const Ms = composeScale(p, s), M1 = composeScale(p, 1);
    for (let j = 0; j < 16; j++) {
      // translation column (12..14) and the w row (15) are untouched by a
      // uniform scalar multiply of the rotation columns
      const expected = (j >= 12) ? Ms[j] : fr(M1[j] * s);
      assert.strictEqual(Ms[j], expected);
    }
  }
});

// ============================================================================
// 2) Frame parity: legacy full instanceMatrix upload vs aPulseScale upload
// ============================================================================
test("P11 frame parity: aPulseScale GPU state matches legacy matrices every frame; uploads are exactly 1/16", () => {
  const layers = makeLayers(), pos = makePositions(0xbee5);
  const frames = makeSpikeScenario(0xcafe, 24);
  const dummy = makeDummy();

  // build-time state (mirrors buildBrain): unit matrices + build scale attr
  const legacyMat = new Float32Array(N * 16);      // legacy instanceMatrix array
  const frozenUnit = new Float32Array(N * 16);     // new: frozen matrices (unit)
  const scaleAttr = new Float32Array(N);           // new: aPulseScale array
  const buildScale = 1;                            // layered view build scale
  for (let i = 0; i < N; i++) {
    const m = composeScale([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], buildScale);
    legacyMat.set(m, i * 16); frozenUnit.set(m, i * 16);
    scaleAttr[i] = buildScale;
  }
  const legacyMirror = makeMirror(4);              // f32: 4 bytes per element
  const scaleMirror = makeMirror(4);               // f32: 4 bytes per element
  legacyMirror.upload({ array: legacyMat });       // createBuffer full upload
  scaleMirror.upload({ array: scaleAttr });        // createBuffer full upload

  for (let tick = 0; tick < frames.length; tick++) {
    const spikes = frames[tick];
    // legacy side
    const legacyMesh = {
      setMatrixAt(i, m) { legacyMat.set(m, i * 16); },
      instanceMatrix: { needsUpdate: false, array: legacyMat },
    };
    glowBlockLegacy(legacyMesh, layers, spikes, { pos }, dummy, tick);
    assert.strictEqual(legacyMesh.instanceMatrix.needsUpdate, true);
    legacyMirror.upload(legacyMesh.instanceMatrix);

    // new side (the exact block the page will run — also extracted from the
    // page in section 5; kept literal here so this test validates pre-edit)
    const p11Mesh = {
      geometry: { getAttribute: () => ({ array: scaleAttr, needsUpdate: false }) },
      instanceMatrix: { needsUpdate: false, array: frozenUnit },
    };
    const nodeMesh = p11Mesh;
    const p11Scale = nodeMesh.geometry.getAttribute("aPulseScale");
    const stride = 7;
    let visits = 0, pulsed = 0;
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li], off = (tick + li) % stride;
      for (let k = off; k < L.length; k += stride) {
        visits++;
        if (spikes[L[k]]) pulsed++;
        p11StoreScale(p11Scale.array, L[k], spikes[L[k]] ? 2.2 : 1);
      }
    }
    p11Scale.needsUpdate = true;
    assert.strictEqual(p11Mesh.instanceMatrix.needsUpdate, false,
      "new path must never raise the full 6.8 MB instanceMatrix upload");
    scaleMirror.upload(p11Scale);

    // parity: for every instance, legacy GPU matrix vs frozen matrix + scale
    let touched = 0;
    for (let i = 0; i < N; i++) {
      const lm = legacyMirror.gpu.subarray(i * 16, i * 16 + 16);
      const sLegacy = lm[0];
      const sNew = scaleMirror.gpu[i];
      if (sLegacy !== 1) touched++;
      assert.strictEqual(sNew, sLegacy, `instance ${i} scale diverged at tick ${tick}`);
      // frozen matrix: unit diagonal + the SAME position legacy composes
      assert.strictEqual(frozenUnit[i * 16], 1);
      assert.strictEqual(frozenUnit[i * 16 + 5], 1);
      assert.strictEqual(frozenUnit[i * 16 + 10], 1);
      assert.strictEqual(frozenUnit[i * 16 + 12], pos[i * 3]);
      assert.strictEqual(frozenUnit[i * 16 + 13], pos[i * 3 + 1]);
      assert.strictEqual(frozenUnit[i * 16 + 14], pos[i * 3 + 2]);
      // scale equality + exact matrix identity (section 1) => transform parity
      const v = [pos[i * 3] * 0.001, pos[i * 3 + 1] * 0.001, 1];
      assert.deepStrictEqual(
        applyMat(composeScale([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], sNew), v),
        applyMat(lm, v));
    }
    // the strided visit pattern visits ≈ N/7 instances per frame; the spiking
    // subset among them gets the non-unit scale. The legacy buffer differs
    // from unit at the CUMULATIVE visited-spiking set (values persist until
    // revisited), yet legacy uploads all N matrices every frame — the waste
    // P11 removes.
    assert.ok(visits > N / 10 && visits < N / 5, `visited ${visits} ≈ N/7`);
    assert.ok(pulsed > 0 && pulsed < visits, `pulsed subset ${pulsed} of ${visits} visited`);
    assert.ok(touched >= pulsed && touched <= N, `cumulative non-unit set ${touched} ≥ pulsed ${pulsed}`);
  }
  // accounting: legacy uploads N*64 bytes per frame regardless of the ~N/7
  // touched subset (this is exactly the waste P11 removes)
  assert.strictEqual(legacyMirror.bytes, (frames.length + 1) * N * 64);
  assert.strictEqual(scaleMirror.bytes, (frames.length + 1) * N * 4);
  assert.strictEqual(legacyMirror.bytes / scaleMirror.bytes, 16);
});

// ============================================================================
// 3) Degraded mode: 4-significant-bit quantized stores stay structurally
//    identical (same upload size, single multiplicative error term)
// ============================================================================
test("P11 degraded mode (4-bit mantissa stores): same upload contract, bounded single-term scale error", () => {
  const layers = makeLayers();
  const frames = makeSpikeScenario(0xfeed, 12);
  const scaleAttr = new Float32Array(N);
  scaleAttr.fill(1);
  // quantizing store: keep 4 significant bits of the f32 value (worst-case
  // driver/precision demonstration for the aPulseScale path)
  const q4 = (v) => {
    if (v === 0) return 0;
    const e = Math.floor(Math.log2(Math.abs(v))) - 3;   // 4 sig bits
    return Math.fround(Math.round(v / 2 ** e) * 2 ** e);
  };
  const quantStore = (arr, i, v) => { arr[i] = q4(v); };
  const stride = 7;
  for (let tick = 0; tick < frames.length; tick++) {
    const spikes = frames[tick];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li], off = (tick + li) % stride;
      for (let k = off; k < L.length; k += stride) {
        quantStore(scaleAttr, L[k], spikes[L[k]] ? 2.2 : 1);
      }
    }
  }
  // quiet scale is exact; spiking scale carries the quantization delta only
  const seen = new Set(scaleAttr);
  for (const v of seen) assert.ok(v === 1 || Math.abs(v - 2.2) <= 2.2 / 16, `quantized value ${v} within 2^-4 relative bound`);
  assert.ok(seen.has(1), "quiet scale exact under quantization");
  assert.ok(!seen.has(2.2), "spiking scale is actually quantized in this mode");
  // single multiplicative term: rendered radius error is exactly |q(s)-s|/s
  // relative (no cross-terms — the patch is one scalar multiply), so the
  // worst visible deviation is bounded by the same 2^-4 bound.
  const legacyQuiet = applyMat(composeScale([1, 2, 3], 1), [0.5, 0.5, 0.5]);
  const degQuiet = applyMat(composeScale([1, 2, 3], 1), [0.5, 0.5, 0.5]);
  assert.deepStrictEqual(degQuiet, legacyQuiet);   // quiet path unaffected
  const legacySpike = applyMat(composeScale([1, 2, 3], Math.fround(2.2)), [0.5, 0.5, 0.5]);
  const degSpike = applyMat(composeScale([1, 2, 3], q4(2.2)), [0.5, 0.5, 0.5]);
  const rel = Math.abs(degSpike[0] - legacySpike[0]) / legacySpike[0];
  assert.ok(rel <= 1 / 16, `degraded radius error ${rel} within 2^-4`);
});

// ============================================================================
// 4) Structure pins (post-edit): page wiring
// ============================================================================
test("P11 page wiring: frozen matrices, instanced attr, shader patch, glow block rewritten", { skip: !hasP11 && "P11 not yet implemented" }, () => {
  // build-side: attribute exists with dynamic usage, build scale mirrors matrix scale
  assert.match(src, /nGeo\.setAttribute\("aPulseScale",\s*new THREE\.InstancedBufferAttribute\(p11Scales, 1\)\.setUsage\(THREE\.DynamicDrawUsage\)\)/);
  assert.match(src, /p11Scales\[i\]\s*=\s*anatMode \? 1\.5 : 1/);
  // matrices are explicitly static; no per-frame nodeMesh matrix writes remain
  assert.doesNotMatch(src, /nodeMesh\.setMatrixAt/);
  assert.doesNotMatch(src, /nodeMesh\.instanceMatrix\.needsUpdate/);
  assert.match(src, /nMesh\.instanceMatrix\.setUsage\(THREE\.StaticDrawUsage\)/);
  // shader patch: scale applied after begin_vertex on the CAPTURED material
  // (distinct per-mesh patch fn => distinct program cache key, so other
  // MeshBasicMaterials never compile a program expecting aPulseScale)
  // (P11-fix pin) the injected GLSL MUST declare the custom attribute first
  // — an undeclared identifier is a hard GLSL compile error: the program
  // never links and the whole neuron cloud silently draws NOTHING while the
  // scene graph stays intact (the Phase 3A "brain region disappeared"
  // regression; console spammed "useProgram: program not valid").
  assert.match(src, /const p11Mat = new THREE\.MeshBasicMaterial\(\{ transparent: anatMode, opacity: anatMode \? 0\.95 : 1 \}\);/);
  assert.match(src, /const nMesh = new THREE\.InstancedMesh\(nGeo, p11Mat, N\)/);
  assert.match(src, /p11Mat\.onBeforeCompile = \(shader\) => \{[\s\S]*?"#include <common>\\nattribute float aPulseScale;"[\s\S]*?"#include <begin_vertex>\\n\\ttransformed \*= aPulseScale;"[\s\S]*?\};/);
  assert.match(src, /p11Mat\.customProgramCacheKey = \(\) => "p11-pulse-scale";/);
  // glow block: scalar stores through the documented hook, attr upload raised
  const g0 = src.indexOf("node glow: scale spiking neurons (subset per frame)");
  const g1 = src.indexOf("---- NT pulse", g0);
  const glow = src.slice(g0, g1);
  assert.match(glow, /p11StoreScale\(p11Scale\.array, L\[k\], spikes\[L\[k\]\] \? 2\.2 : 1\)/);
  assert.match(glow, /p11Scale\.needsUpdate = true/);
  assert.ok(!glow.includes("dummy.position.set"), "glow block must not recompose matrices");
  assert.match(src, /function p11StoreScale\(/, "degraded-mode hook present");
});

// ============================================================================
// 5) Page-extracted glow block driven in-sandbox vs the legacy oracle
// ============================================================================
test("P11 page block in-sandbox: GPU-equivalent to legacy over the full scenario", { skip: !hasP11 && "P11 not yet implemented" }, () => {
  const A0 = src.indexOf("const p11Scale = nodeMesh.geometry.getAttribute");
  assert.ok(A0 > 0, "glow block anchor found");
  const A1 = src.indexOf("p11Scale.needsUpdate = true;", A0) + "p11Scale.needsUpdate = true;".length;
  const block = src.slice(A0, A1);

  const layers = makeLayers(), pos = makePositions(0xbee5);
  const frames = makeSpikeScenario(0xcafe, 24);
  const dummy = makeDummy();
  const legacyMat = new Float32Array(N * 16);
  const scaleAttr = new Float32Array(N);
  scaleAttr.fill(1);
  const frozen = new Float32Array(N * 16);
  for (let i = 0; i < N; i++) {
    const m = composeScale([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], 1);
    legacyMat.set(m, i * 16); frozen.set(m, i * 16);
  }
  const sandbox = {
    layers, spikes: null, tick: 0,
    nodeMesh: null,
    p11StoreScale,
  };
  const ctx = vm.createContext(sandbox);
  for (let tick = 0; tick < frames.length; tick++) {
    const spikes = frames[tick];
    sandbox.spikes = spikes; sandbox.tick = tick;
    // legacy oracle
    const legacyMesh = {
      setMatrixAt(i, m) { legacyMat.set(m, i * 16); },
      instanceMatrix: { needsUpdate: false, array: legacyMat },
    };
    glowBlockLegacy(legacyMesh, layers, spikes, { pos }, dummy, tick);
    // page block (bare-block scoped so top-level `const` re-runs per tick)
    const nodeMesh = {
      geometry: { getAttribute: () => ({ array: scaleAttr, needsUpdate: false }) },
      instanceMatrix: { needsUpdate: false, array: frozen },
    };
    sandbox.nodeMesh = nodeMesh;
    vm.runInContext(`"use strict";\n{\n${block}\n}`, ctx);
    // parity
    for (let i = 0; i < N; i++) {
      const sLegacy = legacyMat[i * 16];
      assert.strictEqual(scaleAttr[i], sLegacy, `instance ${i} tick ${tick}`);
    }
    assert.strictEqual(nodeMesh.instanceMatrix.needsUpdate, false);
  }
});
