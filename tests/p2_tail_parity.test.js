"use strict";
// P2 parity tests — tail TubeGeometry reuse (ANIMATION_PERFORMANCE_PROPOSAL P2).
//
// Pattern mirrors tests/p4_particle_parity.test.js and tests/p5_color_parity.test.js:
//   - The production tail driver is transcribed verbatim below ("legacy") and
//     ALSO extracted from the live page ("current"). Pre-P2 both are the same
//     code, validating the transcription against real production source.
//     Post-P2 the page slice is the in-place-update implementation, so the same
//     comparisons prove the rewrite produces bit-identical geometry.
//   - Unlike P4/P5, both sides use the REAL vendored three.module.js classes
//     (CatmullRomCurve3, TubeGeometry) — the tube generation math is not
//     transcribed at all, only the page-level driver code is.
//
// What is pinned:
//   1. Vertex AND normal buffers element-identical (Object.is) every frame,
//      plus identical _tailTip side effect.
//   2. Topology never changes: same index buffer, same uv buffer, same counts.
//   3. The persistent geometry is literally the same object across frames and
//      geometry.dispose() is never called (post-edit only).
//   4. The curve cache protocol used by the new implementation
//      (points mutated in place + needsUpdate = true) is exactly equivalent to
//      constructing a fresh CatmullRomCurve3 with the same points — verified
//      against three.js itself, independent of the page code.

const test = require("node:test");
const { before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const src = fs.readFileSync(PAGE, "utf8");

// ---- page extraction ---------------------------------------------------------
// Initial tail construction (module scope): from the tailCurve literal through
// devil.add(tailMesh).
const initStart = src.indexOf("const tailCurve=new THREE.CatmullRomCurve3([");
const initEnd = src.indexOf("const trident=", initStart);
assert.ok(initStart > 0 && initEnd > initStart, "tail construction block not found");
const initSlice = src.slice(initStart, initEnd);

// Tail driver: from the _tailTip module state through the end of updateTail
// (stop before the FLY_* turn-taking constants, which pull in page globals).
const drvStart = src.indexOf("const _tailTip = new THREE.Vector3();");
const drvEnd = src.indexOf("const FLY_PERCH", drvStart);
assert.ok(drvStart > 0 && drvEnd > drvStart, "updateTail block not found");
const drvSlice = src.slice(drvStart, drvEnd);

const hasP2 = /p2Retube|P2 persistent tail/.test(src);

// ---- real vendored three.js --------------------------------------------------
let THREE;
before(async () => {
  THREE = await import(pathToFileURL(path.join(__dirname, "..", "three.module.js")));
});

// ---- deterministic scenario ---------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// 180 frames: intent ramp-up, jittered cruise, decay + a crossing lash spike.
const FRAMES = (() => {
  const rng = makeRng(4242);
  const out = [];
  let react = 0;
  for (let f = 0; f < 180; f++) {
    if (f === 30) react = 1;              // reaction lash
    react *= 0.94;
    let intent;
    if (f < 60) intent = (f / 60) * (0.4 + 0.6 * rng());
    else if (f < 120) intent = rng();
    else intent = 0.2;
    intent = Math.min(1, Math.max(0, intent));
    out.push({ intent, react, t: f * 0.0167 + rng() * 0.001 });
  }
  return out;
})();

function assertArrEqual(a, b, msg) {
  assert.strictEqual(a.length, b.length, msg + " (length)");
  for (let i = 0; i < a.length; i++)
    assert.ok(Object.is(a[i], b[i]), msg + " [" + i + "]: " + a[i] + " !== " + b[i]);
}

// ---- runners ------------------------------------------------------------------
// Builds a sandbox holding the real THREE, runs the page's tail-construction
// slice, and returns { tailCurve, tailMesh, devil, geometryDisposed }.
function makeTailRig() {
  const rig = { geometryDisposed: 0 };
  const sandbox = {
    console, Math,
    THREE,
    demonBlack: new THREE.MeshBasicMaterial(),
    devil: { userData: {}, add(m) { rig.tailMesh = m; } },
  };
  const exposed = vm.runInNewContext(
    "(function(){\n" + initSlice + "\nreturn { tailCurve, tailMesh }; })()",
    sandbox, { filename: "p2-tail-init.js" });
  rig.devil = sandbox.devil;          // devil.userData carries demonIntent.react
  rig.tailCurve = exposed.tailCurve;
  rig.tailMesh = exposed.tailMesh;
  rig.initialGeometry = rig.tailMesh.geometry;
  // spy dispose on the persistent geometry (property shadows the prototype)
  const g = rig.initialGeometry;
  g.dispose = function () { rig.geometryDisposed++; };
  return rig;
}

// Installs the page's driver slice into a rig's sandbox and returns updateTail.
function makeDriver(rig, slice) {
  const sb = { console, Math, THREE, devil: rig.devilSb, tailMesh: rig.tailMesh, tailCurve: rig.tailCurve };
  rig.sb = sb;
  sb.devil = rig.devilSb;
  sb.demonIntent = rig.demonIntent;
  sb.now2 = () => rig.now;
  rig.exposed = vm.runInNewContext(
    "(function(){\n" + slice + "\nreturn { updateTail, tailTipState: _tailTip }; })()",
    sb, { filename: "p2-tail-driver.js" });
  return rig.exposed.updateTail;
}

function freshRig() {
  const rig = makeTailRig();
  rig.devilSb = rig.devil;
  rig.demonIntent = { level: 0, target: 0 };
  rig.now = 0;
  return rig;
}

// Legacy transcription (verbatim pre-P2 driver, operating on its own rig).
const _legacyTip = { x: 0, y: 0, z: 0 };
function legacyUpdateTail(rig, dt) {
  const sb = rig.legacySb;
  sb.devil.userData.react = rig.demonIntent.react;
  void dt;
  const devil = sb.devil;
  const demonIntent = rig.demonIntent;
  const now2 = () => rig.now;
  const tailMesh = sb.tailMesh;
  const dv = devil.userData;
  const it = demonIntent.level;          // 0..1
  const re = dv.react || 0;              // 0..1 decaying
  const t = now2();
  // base points (demon-local): root at body rear, tip curls up toward the door
  const raise = it * 0.9 + re * 0.8;         // how much the tail is "open"/raised
  const sway = Math.sin(t * 1.7) * 0.35 * (1 - raise) + Math.sin(t * 9) * 0.25 * re;
  const pts = [
    new sb.THREE.Vector3(18, -13, 0),
    new sb.THREE.Vector3(36, -22 + raise * 14, sway * 6),
    new sb.THREE.Vector3(50, -10 + raise * 34, sway * 10),
    new sb.THREE.Vector3(64 + re * 8, -18 + raise * 52 + re * 10, sway * 14),
  ];
  _legacyTip.x = pts[3].x; _legacyTip.y = pts[3].y; _legacyTip.z = pts[3].z;
  const curve = new sb.THREE.CatmullRomCurve3(pts);
  tailMesh.geometry.dispose();
  tailMesh.geometry = new sb.THREE.TubeGeometry(curve, 18, 2.5, 8, false);
}

// ---- 1. transcription validation / parity over the frame sequence -------------
test("P2 parity: tail geometry current page === legacy rebuild, every frame", () => {
  const curRig = freshRig();
  const legRig = freshRig();
  const curUpdate = makeDriver(curRig, drvSlice);
  // legacy rig uses the same construction slice (identical pre/post edit)
  legRig.legacySb = { console, Math, THREE, tailMesh: legRig.tailMesh, devil: legRig.devil };
  for (let f = 0; f < FRAMES.length; f++) {
    const fr = FRAMES[f];
    curRig.demonIntent.level = fr.intent;
    curRig.devilSb.userData.react = fr.react;
    curRig.now = fr.t;
    legRig.demonIntent.level = fr.intent;
    legRig.demonIntent.react = fr.react;
    legRig.now = fr.t;
    curUpdate(0.016);
    legacyUpdateTail(legRig, 0.016);
    const gA = curRig.tailMesh.geometry, gB = legRig.tailMesh.geometry;
    assertArrEqual(gA.attributes.position.array, gB.attributes.position.array, "frame " + f + " positions");
    assertArrEqual(gA.attributes.normal.array, gB.attributes.normal.array, "frame " + f + " normals");
    assert.strictEqual(curRig.exposed.tailTipState.x, _legacyTip.x, "frame " + f + " tailTip.x");
    assert.strictEqual(curRig.exposed.tailTipState.y, _legacyTip.y, "frame " + f + " tailTip.y");
    assert.strictEqual(curRig.exposed.tailTipState.z, _legacyTip.z, "frame " + f + " tailTip.z");
  }
});

// ---- 2. topology invariants -----------------------------------------------------
test("P2 topology: index/uv buffers and counts are frame-invariant", () => {
  const rig = freshRig();
  const update = makeDriver(rig, drvSlice);
  const idx0 = Array.from(rig.tailMesh.geometry.index.array);
  const uv0 = Array.from(rig.tailMesh.geometry.attributes.uv.array);
  const n0 = rig.tailMesh.geometry.attributes.position.count;
  const seen = new Set();
  for (let f = 0; f < 40; f++) {
    const fr = FRAMES[f];
    rig.demonIntent.level = fr.intent;
    rig.devilSb.userData.react = fr.react;
    rig.now = fr.t;
    update(0.016);
    const g = rig.tailMesh.geometry;
    assert.strictEqual(g.attributes.position.count, n0, "vertex count changed at frame " + f);
    assert.deepEqual(Array.from(g.index.array), idx0, "index buffer changed at frame " + f);
    assert.deepEqual(Array.from(g.attributes.uv.array), uv0, "uv buffer changed at frame " + f);
    seen.add(g);
  }
  // pre-edit the driver allocates a new geometry per frame; post-edit it must
  // be the persistent one (this assertion is the P2 contract).
  if (hasP2) assert.strictEqual(seen.size, 1, "driver allocated more than one geometry");
});

// ---- 3. post-edit hygiene -------------------------------------------------------
if (hasP2) {
  test("P2 hygiene: no per-frame geometry disposal or TubeGeometry allocation", () => {
    assert.ok(!drvSlice.includes("geometry.dispose()"), "driver still disposes geometry per frame");
    assert.ok(!drvSlice.includes("new THREE.TubeGeometry"), "driver still allocates TubeGeometry per frame");
    const rig = freshRig();
    const update = makeDriver(rig, drvSlice);
    for (let f = 0; f < 60; f++) {
      const fr = FRAMES[f];
      rig.demonIntent.level = fr.intent;
      rig.devilSb.userData.react = fr.react;
      rig.now = fr.t;
      update(0.016);
    }
    assert.strictEqual(rig.geometryDisposed, 0, "persistent geometry was disposed");
    assert.strictEqual(rig.tailMesh.geometry, rig.initialGeometry, "geometry identity changed");
  });

  test("P2 hygiene: curve cache protocol === fresh construction (three.js cross-check)", () => {
    // Mutating points in place + needsUpdate=true must sample identically to a
    // freshly built curve with the same points. The cache must already exist
    // (as it does in the driver, which samples every frame) — otherwise the
    // flag is vacuous. So: sample first, then mutate, then compare.
    const pts1 = [
      new THREE.Vector3(18, -13, 0),
      new THREE.Vector3(36, -5.3, 1.9),
      new THREE.Vector3(50, 15.2, -3.3),
      new THREE.Vector3(66.5, 20.8, 0.7),
    ];
    const persistent = new THREE.CatmullRomCurve3(pts1);
    void persistent.getLength();                    // build the arc-length cache
    const freshPts = pts1.map((p) => p.clone());
    freshPts[1].set(30, 30, 30);
    freshPts[3].set(70, -10, 5);
    const fresh = new THREE.CatmullRomCurve3(freshPts);
    persistent.points[1].copy(freshPts[1]);
    persistent.points[2].copy(freshPts[2]);
    persistent.points[3].copy(freshPts[3]);
    persistent.needsUpdate = true;                 // the P2 invalidation step
    const a = new THREE.TubeGeometry(fresh, 18, 2.5, 8, false);
    const b = new THREE.TubeGeometry(persistent, 18, 2.5, 8, false);
    assertArrEqual(a.attributes.position.array, b.attributes.position.array, "cross-check positions");
    assertArrEqual(a.attributes.normal.array, b.attributes.normal.array, "cross-check normals");
    // Load-bearing sanity, on a separate curve: sample once (cache exists),
    // mutate WITHOUT invalidating, then rebuild — the stale u->t mapping must
    // produce different vertices than a fresh curve of the same points.
    // NOTE: CatmullRomCurve3 stores the caller's Vector3 instances, so these
    // literals are deliberately independent of pts1 (which persistent aliases).
    const stale = new THREE.CatmullRomCurve3([
      new THREE.Vector3(18, -13, 0),
      new THREE.Vector3(36, -5.3, 1.9),
      new THREE.Vector3(50, 15.2, -3.3),
      new THREE.Vector3(66.5, 20.8, 0.7),
    ]);
    void stale.getLength();                        // cache = state A
    stale.points[1].set(30, 30, 30);               // mutate, no invalidation
    const staleFresh = new THREE.CatmullRomCurve3([
      new THREE.Vector3(18, -13, 0),
      new THREE.Vector3(30, 30, 30),
      new THREE.Vector3(50, 15.2, -3.3),
      new THREE.Vector3(66.5, 20.8, 0.7),
    ]);
    const tA = new THREE.TubeGeometry(stale, 18, 2.5, 8, false);
    const tB = new THREE.TubeGeometry(staleFresh, 18, 2.5, 8, false);
    let differs = false;
    for (let i = 0; i < tA.attributes.position.array.length; i++)
      if (!Object.is(tA.attributes.position.array[i], tB.attributes.position.array[i])) { differs = true; break; }
    assert.ok(differs, "stale arc-length cache unexpectedly produced fresh geometry (flag not load-bearing)");
  });
}
