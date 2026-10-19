"use strict";
/**
 * P3 behavior tests — end-to-end worker protocol (render-state offload).
 *
 * Runs the REAL brain_worker.js source in a vm sandbox with:
 *   - a fake `self` (onmessage/postMessage like DedicatedWorkerGlobalScope),
 *   - a seeded Math.random for full determinism,
 *   - structuredClone({transfer}) for TRUE ArrayBuffer detachment semantics.
 *
 * Covers the P3 acceptance items that need a live worker:
 *   - init/ready, per-tick heat publish (u8 /255, N bytes)
 *   - top-K publish cadence (only every 12th tick, packed ≤ 4+180*9 bytes)
 *   - top-K correctness after learning (count > 0, indices in range)
 *   - buffer recycling (spike/heat/topK pools survive long runs)
 *   - worker restart continuity (heatSeed warm start, no cold flash)
 *   - pause/resume (no ticks => no decay => heat unchanged across the gap)
 *   - duplicate buffer returns do not break the pool
 *   - stale/malformed messages are ignored safely
 *   - no large unnecessary transfers (nothing NE-sized except W at cadence)
 *
 * Run: node --test tests/p3_behavior.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const WORKER_SRC = fs.readFileSync(path.join(ROOT, "brain_worker.js"), "utf8");
const TOPK_LIMIT = 180;
const TOPK_MSG_BYTES = 4 + 4 + 1;

// Deterministic PRNG (mulberry32) — the worker consumes Math.random; we
// substitute a seeded one inside the vm context so every run is identical.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Harness: fake worker global scope + message pump with real detach semantics
// ---------------------------------------------------------------------------
function makeHarness(seed) {
  const rnd = mulberry32(seed);
  const seededMath = Object.create(Math);
  seededMath.random = rnd;                       // own prop shadows intrinsic

  const state = { messages: [] };
  const fakeSelf = {
    onmessage: null,
    postMessage(msg, tr) {
      // structuredClone with a transfer list detaches the worker-side
      // ArrayBuffers exactly like a real postMessage would.
      const clone = structuredClone(msg, { transfer: tr || [] });
      state.messages.push({ data: clone });
    },
  };
  vm.runInNewContext(WORKER_SRC, { self: fakeSelf, Math: seededMath });

  // Main-side helpers -------------------------------------------------------
  const H = {
    state,
    /** Deliver a message to the worker (optionally transferring buffers). */
    send(msg, transfer) {
      const clone = structuredClone(msg, { transfer: transfer || [] });
      fakeSelf.onmessage({ data: clone });
    },
    /** Last worker->main message of a given type. */
    last(type) {
      for (let i = state.messages.length - 1; i >= 0; i--)
        if (state.messages[i].data.type === type) return state.messages[i].data;
      return null;
    },
    drain() { const n = state.messages.length; state.messages.length = 0; return n; },
    /** Mimic the page: return consumed mirror buffers to the worker pool. */
    returnBuffers(stateMsg, opts = {}) {
      const tr = [];
      const msg = { type: "buffers" };
      if (stateMsg.spikes && stateMsg.spikes.buffer) { msg.spikes = stateMsg.spikes.buffer; tr.push(msg.spikes); }
      if (opts.heat && stateMsg.heat && stateMsg.heat.buffer) { msg.heat = stateMsg.heat.buffer; tr.push(msg.heat); }
      if (opts.topK && stateMsg.topK && stateMsg.topK.buf) { msg.topK = { buf: stateMsg.topK.buf }; tr.push(stateMsg.topK.buf); }
      if (opts.W && stateMsg.W && stateMsg.W.buffer) { msg.W = stateMsg.W.buffer; tr.push(msg.W); }
      H.send(msg, tr);
    },
  };
  return H;
}

// Small deterministic synthetic circuit: 2 layers x 25 neurons, 200 fast
// edges (half of them layer0->layer0 so co-activation learning can fire).
function initPayload(N = 50, NE = 200) {
  const members = new Int32Array(N);
  const off = [0, 25, 50];
  for (let i = 0; i < N; i++) members[i] = i;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  const w0 = new Float32Array(NE), sign = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) {
    src[i] = i % 25;                       // layer 0 sources
    dst[i] = (i % 2 === 0) ? (i % 25) : (25 + (i % 25)); // half self-layer
    w0[i] = 1.0 + (i % 7) * 0.25;
    sign[i] = i % 3 === 0 ? 1 : 0;
  }
  return { type: "init", N, NE, members, layerOff: off, src, dst, w0, sign,
           opticChan: null, opticCol: null, opticLayer: -1,
           stimLayers: [0, 1], modEdges: [] };
}

function tickMsg(over) {
  return Object.assign({ type: "tick",
    s: new Float32Array([0, 0, 0, 0, 0, 0, 0]),   // zero drive -> no spikes
    visual: new Float32Array(8), motorDrive: 0, exAmp: 0, lr: 0, dt: 0.016 }, over);
}

function unpackTopK(buf) {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const idx = new Int32Array(count), score = new Float32Array(count), flag = new Uint8Array(count);
  let o = 4;
  for (let k = 0; k < count; k++) {
    idx[k] = dv.getInt32(o, true); o += 4;
    score[k] = new Float32Array(new Uint32Array([dv.getUint32(o, true)]).buffer)[0]; o += 4;
    flag[k] = dv.getUint8(o); o += 1;
  }
  return { idx, score, flag, count };
}

// ---------------------------------------------------------------------------
test("P3 behavior: init -> ready echoes N/NE", () => {
  const H = makeHarness(11);
  H.send(initPayload());
  const ready = H.last("ready");
  assert.ok(ready, "worker must answer init with ready");
  assert.strictEqual(ready.N, 50);
  assert.strictEqual(ready.NE, 200);
});

test("P3 behavior: heat publishes every tick, N bytes; spikes/heat detached views", () => {
  const H = makeHarness(22);
  H.send(initPayload());
  for (let t = 1; t <= 5; t++) {
    H.send(tickMsg());
    const m = H.last("state");
    assert.ok(m, "state published on tick " + t);
    assert.strictEqual(m.tick, t);
    assert.ok(m.heat instanceof Uint8Array, "heat is a u8 view");
    assert.strictEqual(m.heat.byteLength, 50, "heat is N bytes (1/neuron)");
    assert.strictEqual(m.spikes.byteLength, 50);
    // detaching worked: worker-side buffers were moved, not copied
    assert.ok(m.heat.buffer.byteLength === 50, "heat buffer transferred intact");
    // keep the pool fed exactly like the page does (assert BEFORE returning:
    // the transfer detaches our views)
    H.returnBuffers(m, { heat: true });
  }
});

test("P3 behavior: top-K only every 12th tick, packed size bounded, no W otherwise", () => {
  const H = makeHarness(33);
  H.send(initPayload());
  H.drain();
  for (let t = 1; t <= 13; t++) {
    H.send(tickMsg());
    const m = H.last("state");
    if (t % 12 === 0) {
      assert.ok(m.topK, "tick " + t + ": top-K present");
      assert.ok(m.W, "tick " + t + ": weights present");
      const bytes = m.topK.buf.byteLength;
      const n = new DataView(m.topK.buf).getUint32(0, true);
      assert.strictEqual(m.topK.count, n);
      assert.ok(bytes <= 4 + TOPK_LIMIT * TOPK_MSG_BYTES, "top-K payload ≤ ~1.7KB");
    } else {
      assert.ok(!m.topK, "tick " + t + ": no top-K off cadence");
      assert.ok(!m.W, "tick " + t + ": no W off cadence");
    }
    H.returnBuffers(m, { heat: true, topK: true });   // keep pools fed
  }
});

test("P3 behavior: unchanged weights -> empty top-K (count 0, 4-byte payload)", () => {
  const H = makeHarness(44);
  H.send(initPayload());
  for (let t = 1; t <= 12; t++) {
    H.send(tickMsg());
    const m = H.last("state");
    if (t === 12) {
      assert.ok(m.topK, "12th tick publishes top-K");
      assert.strictEqual(m.topK.count, 0, "no learning -> no plastic changes");
      assert.strictEqual(m.topK.buf.byteLength, 4);
      const entries = unpackTopK(m.topK.buf);
      assert.strictEqual(entries.count, 0);
    }
    H.returnBuffers(m, { heat: true, topK: true });
  }
});

test("P3 behavior: learning produces a valid top-180 ranking (indices in range, sorted desc)", () => {
  const H = makeHarness(55);
  H.send(initPayload());
  H.send({ type: "reward", dq: 2.0 });             // strong dopamine
  let lastEntries = null;
  for (let t = 1; t <= 24; t++) {
    // strong sensory drive -> layer-0 neurons fire (seeded, deterministic)
    H.send(tickMsg({ s: new Float32Array(7).fill(1.0), lr: 1.0, dt: 0.016 }));
    const m = H.last("state");
    if (m.topK && m.topK.count > 0) lastEntries = unpackTopK(m.topK.buf);
    H.returnBuffers(m, { heat: true, topK: true });
  }
  assert.ok(lastEntries, "learning must eventually produce plastic changes");
  const entries = lastEntries;
  assert.ok(entries.count > 0 && entries.count <= TOPK_LIMIT);
  assert.ok(entries.count > 0 && entries.count <= TOPK_LIMIT);
  for (let k = 0; k < entries.count; k++) {
    assert.ok(entries.idx[k] >= 0 && entries.idx[k] < 200, "index in edge range");
    assert.ok(entries.score[k] > 1e-5, "sub-threshold edges are excluded");
    if (k > 0) assert.ok(entries.score[k] <= entries.score[k - 1], "descending order");
  }
});

test("P3 behavior: worker restart with heatSeed warm-starts (no cold flash)", () => {
  const H = makeHarness(66);
  H.send(initPayload());
  H.send(tickMsg());
  H.drain();
  // watchdog-style restart: init again, seeding heat with full brightness
  const payload = initPayload();
  payload.heatSeed = new Uint8Array(50).fill(255);
  H.send(payload);
  assert.strictEqual(H.last("ready").N, 50, "re-init answers ready again");
  H.send(tickMsg());                                // zero drive -> no spikes
  const m = H.last("state");
  assert.strictEqual(m.tick, 1, "tick counter reset on restart");
  assert.strictEqual(m.heat[0], Math.round(255 * 0.81),
    "seeded heat decays exactly one tick (0.90^2) instead of cold-flashing to 0");
});

test("P3 behavior: pause/resume — heat does not decay while no ticks are sent", () => {
  const H = makeHarness(77);
  H.send(initPayload());
  H.send(tickMsg());
  const before = Array.from(H.last("state").heat);
  H.returnBuffers(H.last("state"), { heat: true, topK: true });
  // ...pause: the page stops dispatching brainTick, so no tick messages...
  H.send(tickMsg());                                // resume
  const m = H.last("state");
  for (let i = 0; i < before.length; i++)
    assert.strictEqual(m.heat[i], Math.round(before[i] * 0.81),
      "heat advances exactly one tick across the pause gap (no wall-clock drift)");
});

test("P3 behavior: duplicate buffer returns and stale buffers do not break the pool", () => {
  const H = makeHarness(88);
  H.send(initPayload());
  H.send(tickMsg());
  const m = H.last("state");
  // return the same heat buffer twice (double-return bug simulation)
  const hb = m.heat.buffer;
  H.send({ type: "buffers", heat: hb }, [hb]);
  const hb2 = m.heat.buffer;                        // note: same buffer object
  if (hb2.byteLength > 0) H.send({ type: "buffers", heat: hb2 }, [hb2]);
  // a wrongly-sized return must be rejected, not crash
  const junk = new ArrayBuffer(7);
  H.send({ type: "buffers", heat: junk }, [junk]);
  // worker keeps publishing afterwards
  for (let t = 0; t < 3; t++) { H.send(tickMsg()); assert.ok(H.last("state")); }
});

test("P3 behavior: zero returns (starvation) self-heals instead of going silent", () => {
  const H = makeHarness(99);
  H.send(initPayload());
  // never return anything; the worker must re-allocate after ~1s of ticks
  let states = 0;
  for (let t = 1; t <= 40; t++) {
    H.send(tickMsg());
    if (H.last("state")) states++;
  }
  assert.ok(states >= 35, "publishing continues under starvation (self-heal), got " + states + "/40");
});

test("P3 behavior: no large unnecessary transfers — nothing NE-sized except W at cadence", () => {
  const H = makeHarness(101);
  H.send(initPayload());
  for (let t = 1; t <= 13; t++) {
    H.send(tickMsg());
    const m = H.last("state");
    assert.ok(m.spikes.byteLength === 50, "spikes: N bytes");
    assert.ok(m.heat.byteLength === 50, "heat: N bytes");
    if (m.W) { assert.strictEqual(t % 12, 0, "W rides the 12-tick cadence only"); assert.strictEqual(m.W.byteLength, 200 * 4); }
    if (m.topK) assert.ok(m.topK.buf.byteLength <= 4 + TOPK_LIMIT * TOPK_MSG_BYTES);
    H.returnBuffers(m, { heat: true, topK: true });
  }
});

test("P3 behavior: messages before init are ignored safely; worker stays alive", () => {
  const H = makeHarness(202);
  H.send(tickMsg());                                // no init yet
  H.send({ type: "reward", dq: 1 });
  H.send({ type: "buffers" });
  H.send(initPayload());
  assert.ok(H.last("ready"), "init after stray messages still works");
  H.send(tickMsg());
  assert.ok(H.last("state"), "tick after init works");
});

test("P3 behavior: malformed buffer-return messages do not kill the worker", () => {
  const H = makeHarness(303);
  H.send(initPayload());
  H.send({ type: "buffers", topK: { buf: new ArrayBuffer(4) } });   // header-only
  H.send({ type: "buffers", topK: null, heat: null, spikes: null });
  H.send(tickMsg());
  assert.ok(H.last("state"), "worker survives junk returns");
});
