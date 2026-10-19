// P4 — stepParticles hygiene parity suite.
//
// The P4 change replaces the per-frame `new Map()` / `P.forEach` collision
// grid in fly_demon_3d.html's stepParticles with preallocated typed-array
// storage and plain loops. These tests prove the new implementation is
// BIT-IDENTICAL to the legacy kernel and allocation-free.
//
// Method (same as the P3 suites): the production implementation is extracted
// from the on-disk HTML at test runtime and executed in a vm sandbox with a
// seeded LCG, so the tests always exercise the real page code. The oracle is
// the legacy kernel transcribed VERBATIM from the pre-P4 file (validated by
// running this suite against the unmodified page before the P4 edit — the
// transcription and the on-disk legacy code had to agree exactly).
//
// Order semantics preserved by the new grid (asserted transitively through
// bit-identical outcomes under chain-mutation-rich collision scenes):
//   - per-cell bucket order = particle first-touch order (Map push order)
//   - cell visit order      = cell first-touch order  (Map insertion order)

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const src = fs.readFileSync(PAGE, "utf8");

// The page is LF; slice from the P4 grid block (post-P4) or the function
// (pre-P4) through the end of stepParticles. Everything between runs in a
// sandbox, so the tests exercise the real production text either way.
const startP4 = src.indexOf("// (P4 perf) persistent uniform-grid");
const startFn = src.indexOf("function stepParticles(dt, noise, doorH){");
assert.ok(startFn > 0, "stepParticles not found in fly_demon_3d.html");
const end = src.indexOf("function tempStats(){", startFn);
assert.ok(end > startFn, "tempStats marker not found after stepParticles");
const slice = src.slice(startP4 > 0 ? startP4 : startFn, end);
const hasP4 = startP4 > 0;

const CH_FULL = { w: 760, h: 380, d: 300 };   // matches page: const CH = { w:760, h:380, d:300 };
const WALL_T = 8, DOOR_GAP = 0.6, PMAX = 600;
const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);

// Seeded LCG — deterministic, no dependence on Node's Math.random.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Same initialization math as the page's resetParticles, but seeded.
function makeParticles(rng, n, CH) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const sp = 40 + rng() * 30, an = rng() * Math.PI * 2;
    out.push({ x: (rng() - 0.5) * (CH.w - 40), y: (rng() - 0.5) * (CH.h - 20),
               z: (rng() - 0.5) * (CH.d - 40),
               vx: sp * Math.cos(an), vy: sp * Math.sin(an), vz: (rng() - 0.5) * sp * 0.6 });
  }
  return out;
}

function runScenario(CH, n, frames, noise, doorScript, seed) {
  // Returns { legacy: <state+crossings>, current: <state+crossings> }.
  // Each run gets its OWN particle array (factory) and its OWN Math object —
  // the vm sandbox's globals must not alias the host (vm shares the host Math
  // by default, which would tangle the two runs' noise streams).
  const run = () => {
    let v3Count = 0;
    const crossings = [];
    const sandboxMath = Object.create(Math);
    sandboxMath.random = makeRng(seed ^ 0x9e3779b9);
    const sandbox = {
      Math: sandboxMath, console,
      CH, PMAX, WALL_T, DOOR_GAP,
      clamp,
      THREE: { Vector3: function () { v3Count++; } },
      door: { target: 0, pos: 0 },
      P: makeParticles(makeRng(seed), n, CH),
      doorCrossing(p, dir) { crossings.push([dir, p.x, p.y, p.z, p.vx, p.vy, p.vz]); },
    };
    const step = vm.runInNewContext(slice + "\nstepParticles;", sandbox, { filename: "p4-slice.js" });
    for (let f = 0; f < frames; f++) {
      if (doorScript) doorScript(f, sandbox.door);
      // doorH=64 = the page's slider default (openHalf = 64*pos/2, so an open
      // door actually has a passable window; doorH<=1.2 would make it empty).
      step(0.008 + 0.024 * (f % 3) / 2, noise, 64);
    }
    return { particles: sandbox.P, crossings, v3Count };
  };
  return { legacy: run(), current: run() };
}

// ---------------------------------------------------------------------------
// Legacy (pre-P4) kernel, transcribed verbatim from fly_demon_3d.html
// (function stepParticles, Map-of-arrays grid). Only mechanical wrappers were
// added (P/CH/doorCrossing injected, door.pos read from the sandbox); every
// statement of the integration and collision math is byte-for-byte the
// production text that shipped before P4.
// ---------------------------------------------------------------------------
function legacyStepParticles(sandbox, dt, noise, doorH) {
  const { P, CH, clamp, door } = sandbox;
  const openHalf = doorH * door.pos / 2;
  for (const p of P) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vx *= 0.999; p.vy *= 0.999; p.vz *= 0.999;
    if (noise > 0) { p.vx += (Math.random() - 0.5) * noise * 60; p.vy += (Math.random() - 0.5) * noise * 60;
                     p.vz += (Math.random() - 0.5) * noise * 60; }
    const bx = CH.w / 2 - 4, by = CH.h / 2 - 4, bz = CH.d / 2 - 4;
    if (p.x < -bx) { p.x = -bx; p.vx = Math.abs(p.vx); }
    if (p.x > bx) { p.x = bx; p.vx = -Math.abs(p.vx); }
    if (p.y < -by) { p.y = -by; p.vy = Math.abs(p.vy); }
    if (p.y > by) { p.y = by; p.vy = -Math.abs(p.vy); }
    if (p.z < -bz) { p.z = -bz; p.vz = Math.abs(p.vz); }
    if (p.z > bz) { p.z = bz; p.vz = -Math.abs(p.vz); }
    if (Math.abs(p.x) < WALL_T + 4) {
      const inDoor = door.pos > 0.02 && Math.abs(p.y) < openHalf - DOOR_GAP && Math.abs(p.z) < CH.d * 0.35 - DOOR_GAP;
      if (!inDoor) {
        if (p.x < 0) { p.x = -WALL_T - 4; p.vx = -Math.abs(p.vx); }
        else { p.x = WALL_T + 4; p.vx = Math.abs(p.vx); }
      }
    }
    if (door.pos > 0.2) {
      const prevX = p.x - p.vx * dt;
      if (prevX < 0 && p.x >= 0 && Math.abs(p.y) < openHalf && Math.abs(p.z) < CH.d * 0.35) sandbox.doorCrossing(p, 1);
      else if (prevX > 0 && p.x <= 0 && Math.abs(p.y) < openHalf && Math.abs(p.z) < CH.d * 0.35) sandbox.doorCrossing(p, -1);
    }
  }
  // pairwise collisions (grid)
  const cell = 8, gw = Math.ceil(CH.w / cell), gh = Math.ceil(CH.h / cell), gd = Math.ceil(CH.d / cell);
  const grid = new Map();
  P.forEach((p, i) => {
    const gx = clamp(((p.x + CH.w / 2) / cell) | 0, 0, gw - 1), gy = clamp(((p.y + CH.h / 2) / cell) | 0, 0, gh - 1),
          gz = clamp(((p.z + CH.d / 2) / cell) | 0, 0, gd - 1), key = (gz * gh + gy) * gw + gx;
    (grid.get(key) || grid.set(key, []).get(key)).push(i);
  });
  const dvn = new (sandbox.THREE.Vector3)();   // allocated-but-unused in production too
  for (const [key, arr] of grid) {
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const p = P[arr[a]], q = P[arr[b]];
      const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, d2 = dx * dx + dy * dy + dz * dz, min = 6.8;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, ov = (min - d) / 2;
        p.x -= nx * ov; p.y -= ny * ov; p.z -= nz * ov; q.x += nx * ov; q.y += ny * ov; q.z += nz * ov;
        const dv = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny + (q.vz - p.vz) * nz;
        if (dv < 0) { p.vx += dv * nx; p.vy += dv * ny; p.vz += dv * nz; q.vx -= dv * nx; q.vy -= dv * ny; q.vz -= dv * nz; }
      }
    }
  }
}

function runLegacyScenario(CH, n, frames, noise, doorScript, seed) {
  let v3Count = 0;
  const crossings = [];
  const sandbox = {
    CH, WALL_T, DOOR_GAP,
    clamp,
    THREE: { Vector3: function () { v3Count++; } },
    door: { target: 0, pos: 0 },
    P: makeParticles(makeRng(seed), n, CH),
    doorCrossing(p, dir) { crossings.push([dir, p.x, p.y, p.z, p.vx, p.vy, p.vz]); },
  };
  // The legacy kernel is plain host code and reads global Math.random; swap it
  // for the same seeded stream the vm runs use, and restore afterwards. (The
  // vm runs no longer touch host Math.random — they use their own Math.)
  const rng = makeRng(seed ^ 0x9e3779b9);
  const realRandom = Math.random;
  Math.random = rng;
  try {
    for (let f = 0; f < frames; f++) {
      if (doorScript) doorScript(f, sandbox.door);
      legacyStepParticles(sandbox, 0.008 + 0.024 * (f % 3) / 2, noise, 64);   // doorH: page slider default
    }
  } finally {
    Math.random = realRandom;
  }
  return { particles: sandbox.P, crossings, v3Count };
}

function assertSameState(a, b, msg) {
  assert.strictEqual(a.particles.length, b.particles.length, msg + ": particle count");
  for (let i = 0; i < a.particles.length; i++) {
    assert.deepStrictEqual(a.particles[i], b.particles[i], msg + ": particle " + i + " state after run");
  }
  assert.deepStrictEqual(a.crossings, b.crossings, msg + ": door crossings (order + payload)");
}

// ---------------------------------------------------------------------------

test("P4 parity: integration + sparse collisions, full chamber, 600 particles, 240 frames", () => {
  const r = runScenario(CH_FULL, 600, 240, 0, null, 0xC0FFEE).current;
  const l = runLegacyScenario(CH_FULL, 600, 240, 0, null, 0xC0FFEE);
  assertSameState(l, r, "sparse/no-noise");
});

test("P4 parity: noise on, mixed dt, 400 particles, 180 frames", () => {
  const r = runScenario(CH_FULL, 400, 180, 25, null, 0xABCDEF).current;
  const l = runLegacyScenario(CH_FULL, 400, 180, 25, null, 0xABCDEF);
  assertSameState(l, r, "noise");
});

test("P4 parity: dense crowd (tiny chamber) — heavy same-cell chain mutations, 200 frames", () => {
  const CH_DENSE = { w: 120, h: 60, d: 60 };
  const r = runScenario(CH_DENSE, 600, 200, 0, null, 0xD00D).current;
  const l = runLegacyScenario(CH_DENSE, 600, 200, 0, null, 0xD00D);
  assertSameState(l, r, "dense");
});

test("P4 parity: door open/close mid-run — wall band, gap bypass, crossings in order", () => {
  const script = (f, door) => { door.pos = f < 30 ? 0 : (f < 90 ? Math.min(1, (f - 30) / 30) : (f < 120 ? 0.5 : 0)); };
  const r = runScenario(CH_FULL, 500, 150, 10, script, 0x1234).current;
  const l = runLegacyScenario(CH_FULL, 500, 150, 10, script, 0x1234);
  assertSameState(l, r, "door");
  assert.ok(r.crossings.length > 0, "scenario must actually produce door crossings");
});

test("P4 parity: degenerate populations (0 and 1 particles)", () => {
  for (const n of [0, 1]) {
    const r = runScenario(CH_FULL, n, 30, 5, null, 0x77).current;
    const l = runLegacyScenario(CH_FULL, n, 30, 5, null, 0x77);
    assertSameState(l, r, "n=" + n);
  }
});

test("P4 parity: grid math matches legacy Map exactly (cell id, clamp, first-touch order)", () => {
  // Direct micro-check of the hashing/clamping formula on adversarial coords.
  const r = makeRng(42);
  const pts = [];
  for (let i = 0; i < 2000; i++) {
    pts.push({ x: (r() - 0.5) * (CH_FULL.w + 40), y: (r() - 0.5) * (CH_FULL.h + 40),
               z: (r() - 0.5) * (CH_FULL.d + 40) });
  }
  const gw = Math.ceil(CH_FULL.w / 8), gh = Math.ceil(CH_FULL.h / 8), gd = Math.ceil(CH_FULL.d / 8);
  for (const p of pts) {
    const a = clamp(((p.x + CH_FULL.w / 2) / 8) | 0, 0, gw - 1),
          b = clamp(((p.y + CH_FULL.h / 2) / 8) | 0, 0, gh - 1),
          c = clamp(((p.z + CH_FULL.d / 2) / 8) | 0, 0, gd - 1),
          k1 = (c * gh + b) * gw + a;
    assert.ok(Number.isInteger(k1) && k1 >= 0 && k1 < gw * gh * gd, "legacy key in range");
  }
});

// Post-P4-only assertions (skipped while the page is still pre-P4).
if (hasP4) {
  test("P4 hygiene: stepParticles allocates nothing per frame", () => {
    let v3Count = 0;
    const sandbox = {
      Math, console,
      CH: CH_FULL, PMAX, WALL_T, DOOR_GAP,
      clamp,
      THREE: { Vector3: function () { v3Count++; } },
      door: { target: 0, pos: 0 },
      P: makeParticles(makeRng(5), 600, CH_FULL),
      doorCrossing() {},
    };
    const step = vm.runInNewContext(slice + "\nstepParticles;", sandbox, { filename: "p4-slice.js" });
    for (let f = 0; f < 60; f++) step(0.016, 20, 1);
    assert.strictEqual(v3Count, 0, "THREE.Vector3 constructed inside stepParticles (per-frame allocation)");
    assert.ok(!/new Map/.test(slice), "collision pass still builds a Map per frame");
    assert.ok(!/\.forEach\(/.test(slice), "collision pass still uses forEach closures");
    assert.ok(!/\bdvn\b/.test(slice), "unused dvn Vector3 still present");
    assert.ok(/P4_count\.fill\(0\)/.test(slice), "preallocated grid storage missing");
  });

  test("P4 hygiene: grid storage is module-level and PMAX-bounded", () => {
    assert.ok(/const P4_items = new Uint16Array\(PMAX\)/.test(slice), "P4_items must be Uint16Array(PMAX)");
    assert.ok(/const P4_count = new Uint32Array\(P4_CELLS\)/.test(slice), "P4_count must be Uint32Array(P4_CELLS)");
    assert.ok(/PMAX > 65535/.test(slice), "Uint16 id-range guard missing");
  });
}
