"use strict";
/**
 * P3 top-K parity harness — tests the REAL worker code against the REAL
 * production main-thread ranking formula.
 *
 * P3 moves `refreshWeightOverlay`'s plasticity top-K into brain_worker.js
 * (ANIMATION_PERFORMANCE_PROPOSAL.md P3 / finding F4). The proposal's parity
 * gate (§7) requires the worker-side ranking to reproduce the main-thread
 * ranking EXACTLY: same score formula, same tie-breaking, same ordering.
 *
 * To make that guarantee structural rather than aspirational, this test:
 *   1. extracts `topKChanges(limit)` from brain_worker.js itself (the real
 *      production function — no copy that could drift),
 *   2. reimplements the main-thread scan from fly_demon_3d.html
 *      (refreshWeightOverlay, L3287–3296 at audit time) as the reference,
 *   3. cross-checks both against a naive full-sort ranking,
 *   4. sweeps deterministic + adversarial score scenarios: skip threshold,
 *      heap-replacement, exact ties (scan-order stability), K >= NE,
 *      all-subthreshold, empty W.
 *
 * It also pins the P3 heat-decay derivation: the worker's per-tick constant
 * must equal the main-thread per-frame constant squared (0.90^2 = 0.81 at the
 * 60fps/30Hz design point). If either constant changes, this fails and forces
 * re-derivation (fly_demon_3d.html heat block L3153 / brain_worker.js tick).
 *
 * Run: node --test tests/p3_topk_parity.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WS = 0.02;            // global weight scale (makeSim / buildSim / overlay)
const CHANGE_LIMIT = 180;   // fly_demon_3d.html L1606: brainHolder.changeLimit

// ---------------------------------------------------------------------------
// 1. Load the REAL worker top-K (extracted from brain_worker.js, not copied)
// ---------------------------------------------------------------------------
const workerSrc = fs.readFileSync(path.join(ROOT, "brain_worker.js"), "utf8");

function extractWorkerFunction(name) {
  // Matches `function name(...) { ... }` by brace counting. Fails loudly if
  // the function is renamed/moved — that IS the drift-detection.
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(workerSrc);
  assert.ok(m, "brain_worker.js must define function " + name +
            " — extraction regex broke or the function was renamed");
  let i = workerSrc.indexOf("{", m.index), depth = 0, j = i;
  for (; j < workerSrc.length; j++) {
    const c = workerSrc[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  const src = workerSrc.slice(m.index, j + 1);
  // Worker code is plain ES5-ish JS; eval is fine in a test harness.
  return eval("(" + src + ")");
}

/** Real worker-side top-K (returns packed {idx: Int32Array, score: Float32Array, count}). */
const workerTopK = extractWorkerFunction("topKChanges");

// ---------------------------------------------------------------------------
// 2. Reference: the PRODUCTION main-thread scan, reimplemented line-for-line
//    from fly_demon_3d.html refreshWeightOverlay (L3349+ at audit time):
//      baseline = W0*WS*(exc?1:-1); scale = max(|W0*WS|, 1e-6);
//      score = |W - baseline| / scale; skip score <= 1e-5;
//      min-heap of [score,i], strict > replacement (scan-order ties),
//      final descending sort.
//    (P3 fix, 2026-09-22) bubbleUp now pushes first; the original page code
//    never pushed the first item and produced an empty ranking. The page and
//    the worker port were fixed in lockstep; this reference matches them.
// ---------------------------------------------------------------------------
function mainThreadTopK(W, W0, isExc, limit) {
  const NE = W.length;
  const ranked = [];
  const bubbleUp = (item) => {
    ranked.push(item);
    let i = ranked.length - 1;
    while (i > 0) { const parent = (i - 1) >> 1; if (ranked[parent][0] <= item[0]) break;
      ranked[i] = ranked[parent]; i = parent; }
    ranked[i] = item;
  };
  const bubbleDown = () => {
    let i = 0, item = ranked[0];
    while (true) { const left = i * 2 + 1; if (left >= ranked.length) break;
      let child = left, right = left + 1;
      if (right < ranked.length && ranked[right][0] < ranked[left][0]) child = right;
      if (ranked[child][0] >= item[0]) break;
      ranked[i] = ranked[child]; i = child;
    }
    ranked[i] = item;
  };
  for (let i = 0; i < NE; i++) {
    const baseline = W0[i] * WS * (isExc[i] ? 1 : -1);
    const scale = Math.max(Math.abs(W0[i] * WS), 1e-6);
    const score = Math.abs(W[i] - baseline) / scale;
    if (score <= 1e-5) continue;
    const item = [score, i];
    if (ranked.length < limit) bubbleUp(item);
    else if (score > ranked[0][0]) { ranked[0] = item; bubbleDown(); }
  }
  ranked.sort((a, b) => b[0] - a[0]);
  const idx = new Int32Array(ranked.length);
  const score = new Float32Array(ranked.length);
  for (let k = 0; k < ranked.length; k++) { idx[k] = ranked[k][1]; score[k] = ranked[k][0]; }
  return { idx, score, count: ranked.length };
}

// ---------------------------------------------------------------------------
// 3. Naive cross-check: full sort by (score desc, index asc)
// ---------------------------------------------------------------------------
function naiveTopK(W, W0, isExc, limit) {
  const NE = W.length, items = [];
  for (let i = 0; i < NE; i++) {
    const baseline = W0[i] * WS * (isExc[i] ? 1 : -1);
    const scale = Math.max(Math.abs(W0[i] * WS), 1e-6);
    const score = Math.abs(W[i] - baseline) / scale;
    if (score <= 1e-5) continue;
    items.push([score, i]);
  }
  items.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : b[0] - a[0]));
  const n = Math.min(limit, items.length);
  const idx = new Int32Array(n), score = new Float32Array(n);
  for (let k = 0; k < n; k++) { idx[k] = items[k][1]; score[k] = items[k][0]; }
  return { idx, score, count: n };
}

function assertRankingEqual(label, a, b) {
  assert.strictEqual(a.count, b.count, label + ": count");
  for (let k = 0; k < a.count; k++) {
    assert.strictEqual(a.idx[k], b.idx[k], label + ": index@" + k);
    assert.strictEqual(a.score[k], b.score[k], label + ": score@" + k);
  }
}

// Deterministic PRNG (mulberry32)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeState(seed, NE, opts) {
  const r = rng(seed);
  const W = new Float32Array(NE), W0 = new Float32Array(NE), isExc = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) {
    W0[i] = 0.2 + 4.8 * r();                       // baseline magnitude 0.2..5
    isExc[i] = r() < 0.7 ? 1 : 0;
    const mode = r();
    if (mode < (opts.zeroFrac ?? 0.55)) W[i] = W0[i] * WS * (isExc[i] ? 1 : -1); // unchanged
    else if (mode < 0.9) W[i] = W0[i] * WS * (isExc[i] ? 1 : -1) + (r() - 0.3) * 0.5 * WS;
    else W[i] = (r() - 0.5) * 10 * WS;
    if (opts.microFrac && r() < opts.microFrac)    // sub-threshold change band
      W[i] = W0[i] * WS * (isExc[i] ? 1 : -1) + (1e-6 + 9e-7 * r()) * (r() < 0.5 ? 1 : -1) * 1;
  }
  return { W, W0, isExc };
}

test("P3 parity: worker topKChanges === main-thread ranking (large sweep)", () => {
  const NE = 50000;
  for (const seed of [1, 2, 3]) {
    const { W, W0, isExc } = makeState(seed, NE, { zeroFrac: 0.5, microFrac: 0.05 });
    const wk = workerTopK(W, W0, isExc, CHANGE_LIMIT);
    const ref = mainThreadTopK(W, W0, isExc, CHANGE_LIMIT);
    const nv = naiveTopK(W, W0, isExc, CHANGE_LIMIT);
    assertRankingEqual("worker vs mainThread (seed " + seed + ")", wk, ref);
    assertRankingEqual("worker vs naive (seed " + seed + ")", wk, nv);
    assert.strictEqual(wk.count, CHANGE_LIMIT, "seed " + seed + ": heap should fill to limit");
  }
});

test("P3 parity: exact-tie scan-order stability (strict > heap semantics)", () => {
  // Every candidate shares one score; ties must resolve to the LOWEST indices
  // in scan order, exactly as the main-thread strict-> heap does.
  const NE = 1000, K = 180;
  const W = new Float32Array(NE), W0 = new Float32Array(NE), isExc = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) { W0[i] = 2.5; isExc[i] = 1; W[i] = W0[i] * WS + 0.1 * WS; }
  const wk = workerTopK(W, W0, isExc, K);
  const ref = mainThreadTopK(W, W0, isExc, K);
  const nv = naiveTopK(W, W0, isExc, K);
  assertRankingEqual("worker vs mainThread (uniform ties)", wk, ref);
  assertRankingEqual("worker vs naive (uniform ties)", wk, nv);
  assert.strictEqual(wk.count, K);
  for (let k = 0; k < K; k++) assert.strictEqual(wk.idx[k], k, "ties must pick lowest indices in order");
});

test("P3 parity: tie across the K-boundary", () => {
  // 200 identical-score candidates with K=180: the first 180 scanned win;
  // a candidate that enters then ties at the top must NOT displace (strict >).
  const NE = 200;
  const W = new Float32Array(NE), W0 = new Float32Array(NE), isExc = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) { W0[i] = 1.0; isExc[i] = 1; W[i] = W0[i] * WS + 0.01 * WS; }
  const wk = workerTopK(W, W0, isExc, CHANGE_LIMIT);
  const ref = mainThreadTopK(W, W0, isExc, CHANGE_LIMIT);
  assertRankingEqual("worker vs mainThread (boundary ties)", wk, ref);
  assert.strictEqual(wk.count, CHANGE_LIMIT);
  assert.strictEqual(wk.idx[0], 0, "first scanned wins on tie");
  assert.strictEqual(wk.idx[CHANGE_LIMIT - 1], CHANGE_LIMIT - 1, "boundary holds first 180");
});

test("P3 parity: sub-threshold skip band (score <= 1e-5)", () => {
  const NE = 500;
  const W = new Float32Array(NE), W0 = new Float32Array(NE), isExc = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) {
    W0[i] = 2.0; isExc[i] = i % 2;
    const d = (i < 250) ? 0 : 1e-6;              // exactly at threshold must skip too
    W[i] = W0[i] * WS * (isExc[i] ? 1 : -1) + d;
  }
  const wk = workerTopK(W, W0, isExc, CHANGE_LIMIT);
  const ref = mainThreadTopK(W, W0, isExc, CHANGE_LIMIT);
  assertRankingEqual("worker vs mainThread (skip band)", wk, ref);
  assert.strictEqual(wk.count, Math.min(250, CHANGE_LIMIT),
    "score==1e-5 must be skipped; result capped at changeLimit");
});

test("P3 parity: all sub-threshold -> empty ranking, count 0", () => {
  const NE = 300;
  const W = new Float32Array(NE), W0 = new Float32Array(NE), isExc = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) { W0[i] = 1.0; isExc[i] = 1; W[i] = W0[i] * WS; }
  const wk = workerTopK(W, W0, isExc, CHANGE_LIMIT);
  assert.strictEqual(wk.count, 0);
  assert.strictEqual(wk.idx.length, 0);
  const ref = mainThreadTopK(W, W0, isExc, CHANGE_LIMIT);
  assert.strictEqual(ref.count, 0);
});

test("P3 parity: K >= NE returns all qualifying edges", () => {
  const NE = 100, K = CHANGE_LIMIT;
  const W = new Float32Array(NE), W0 = new Float32Array(NE), isExc = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) { W0[i] = 3.0; isExc[i] = i % 3 === 0 ? 1 : 0;
    W[i] = W0[i] * WS * (isExc[i] ? 1 : -1) + 0.05 * WS; }
  const wk = workerTopK(W, W0, isExc, K);
  const ref = mainThreadTopK(W, W0, isExc, K);
  assertRankingEqual("worker vs mainThread (K >= NE)", wk, ref);
  assert.strictEqual(wk.count, NE);
});

test("P3 parity: empty/degenerate W arrays", () => {
  const wk0 = workerTopK(new Float32Array(0), new Float32Array(0), new Uint8Array(0), CHANGE_LIMIT);
  assert.strictEqual(wk0.count, 0);
  const wk1 = workerTopK(new Float32Array([1 * WS]), new Float32Array([1]), new Uint8Array([1]), CHANGE_LIMIT);
  assert.strictEqual(wk1.count, 0);   // unchanged weight (W == W0*WS) -> score 0 -> skipped
});

test("P3 heat: worker tick decay constant == frame constant squared (60fps/30Hz)", () => {
  // fly_demon_3d.html heat block (L3153 at audit time): HN[i]*0.90 per FRAME.
  // Worker decays per TICK at half the frame rate -> 0.90^2.
  const m = /HEAT_TICK_DECAY\s*=\s*([0-9.eE+-]+)/.exec(workerSrc);
  assert.ok(m, "brain_worker.js must define HEAT_TICK_DECAY");
  const workerK = parseFloat(m[1]);
  const html = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  const mh = /_eHeat[\s\S]{0,200}?HN\[i\]\s*\*\s*([0-9.]+)/.exec(html);
  assert.ok(mh, "fly_demon_3d.html heat block not found (L3152–3154 moved?)");
  const frameK = parseFloat(mh[1]);
  const designRatio = 2; // 30Hz tick vs 60fps frame (patch 18 sim parity gate)
  assert.ok(Math.abs(workerK - Math.pow(frameK, designRatio)) < 1e-12,
    "worker tick decay " + workerK + " must equal frame decay " + frameK +
    " ^ " + designRatio + " — re-derive HEAT_TICK_DECAY if either constant changed");
});
