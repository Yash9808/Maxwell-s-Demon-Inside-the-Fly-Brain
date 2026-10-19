"use strict";
/**
 * Audit-logging R1–R4 tests — Tier-1 instrumentation added to the LOG export.
 *
 * R1: readSensors() mirrors the EXACT delivered input vector into chemLastSens;
 *     chemLogSnapshot writes it as s0..s14 CSV tail columns (empty when absent).
 * R2: raw pre-EMA motor rate — brain_worker.js publishes state msg field
 *     `mrRaw`; the page mirrors it to sim.motorRaw; the in-frame fallback
 *     computes the same value; chemLogSnapshot logs it as `motorRaw`.
 * R3: full-N weight snapshots at LOG start (chemWsStart) and save (meta.weights
 *     with delta and K=100 topK triples).
 * R4: crossing events carry fracL/lN/rN/v2/T2 (physical sort measure).
 *
 * Also guards the contract: positional compatibility of the main CSV
 * (existing leading columns unchanged), OFF-path byte identity of readSensors
 * base semantics (7 features, exact original formulas), and learning-rule /
 * gate-control / physics UNTOUCHED (R1–R4 must not alter any simulation
 * write path).
 *
 * Run: node --test tests/audit_logging_r1_r4.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const WORKER_SRC = fs.readFileSync(path.join(ROOT, "brain_worker.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");

// mulberry32 — same PRNG the p3 harness uses for deterministic worker runs.
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
// R2 — worker publishes the raw pre-EMA motor rate on the state message
// ---------------------------------------------------------------------------
function makeWorkerHarness(seed) {
  const rnd = mulberry32(seed);
  const seededMath = Object.create(Math);
  seededMath.random = rnd;
  const state = { messages: [] };
  const fakeSelf = {
    onmessage: null,
    postMessage(msg, tr) {
      state.messages.push({ data: structuredClone(msg, { transfer: tr || [] }) });
    },
  };
  vm.runInNewContext(WORKER_SRC, { self: fakeSelf, Math: seededMath });
  let last = null;
  const H = {
    get last() { return last; },
    send(msg, transfer) {
      fakeSelf.onmessage({ data: structuredClone(msg, { transfer: transfer || [] }) });
      const out = state.messages.pop();
      if (out) last = out.data;
      return last;
    },
    // The worker only publishes while its buffer pools are fed: every state
    // message's spikes/heat/W buffers must be handed back like the page does
    // (see brain_worker.js "buffers" branch / the p3 harness). Without this
    // the pools starve after init's 2 buffers and SILENTLY stop publishing —
    // every tick after that returns null/stale state messages.
    returnBuffers(m) {
      const tr = [], back = { type: "buffers" };
      if (m.spikes && m.spikes.buffer) { back.spikes = m.spikes.buffer; tr.push(m.spikes.buffer); }
      if (m.heat && m.heat.buffer) { back.heat = m.heat.buffer; tr.push(m.heat.buffer); }
      if (m.W && m.W.buffer) { back.W = m.W.buffer; tr.push(m.W.buffer); }
      if (back.spikes || back.heat || back.W) H.send(back, tr);
    },
  };
  return H;
}

function initPayload(N = 50, NE = 200) {
  const members = new Int32Array(N);
  const off = [0, 25, 50];
  for (let i = 0; i < N; i++) members[i] = i;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  const w0 = new Float32Array(NE), sign = new Uint8Array(NE);
  for (let i = 0; i < NE; i++) {
    src[i] = i % 25;
    dst[i] = (i % 2 === 0) ? (i % 25) : (25 + (i % 25));
    w0[i] = 1.0 + (i % 7) * 0.25;
    sign[i] = i % 3 === 0 ? 1 : 0;
  }
  return { type: "init", N, NE, members, layerOff: off, src, dst, w0, sign,
           opticChan: null, opticCol: null, opticLayer: -1,
           stimLayers: [0, 1], modEdges: [] };
}

function tickMsg(over) {
  return Object.assign({ type: "tick",
    s: new Float32Array([0, 0, 0, 0, 0, 0, 0]),
    visual: new Float32Array(8), motorDrive: 0, exAmp: 0, lr: 0, dt: 0.016 }, over);
}

function motorLayerSpikeCountFromState(workerMsg) {
  // Reconstruct the state-message's own aggregation basis for cross-checks:
  // we cannot see worker-internal arrays, but with a strongly driven motor
  // layer (motorDrive 1.0) the raw rate must be strictly POSITIVE and finite,
  // and with zero drive at a fresh boot it must equal 0 on the first tick.
  return workerMsg.mrRaw;
}

test("R2: worker state message carries finite mrRaw; 0 at silent boot, >0 under exAmp exploration", () => {
  const H = makeWorkerHarness(11);
  H.send(initPayload());
  const boot = H.send(tickMsg({ motorDrive: 0 }));
  H.returnBuffers(boot);
  assert.strictEqual(boot.type, "state");
  assert.strictEqual(typeof boot.mrRaw, "number");
  assert.ok(Number.isFinite(boot.mrRaw), `mrRaw finite, got ${boot.mrRaw}`);
  // zero sensory drive + zero motor drive + zero exAmp on a fresh circuit: no spikes
  assert.strictEqual(boot.mrRaw, 0);
  // exAmp exploration bursts: exAmp*(24+24r) can exceed the 30 spike threshold
  // in a single injection (43.2 at exAmp=0.9), unlike motorDrive injection
  // whose max increment 8*(0.5+r) ≈ 11.7 can never cross 30 on its own.
  let sawPositive = false;
  for (let t = 0; t < 120 && !sawPositive; t++) {
    const m = H.send(tickMsg({ exAmp: 0.9, lr: 0 }));
    H.returnBuffers(m);
    if (m.type === "state" && m.mrRaw > 0) sawPositive = true;
  }
  assert.ok(sawPositive, "mrRaw > 0 under exAmp=0.9 within 120 ticks");
});

test("R2: mrRaw is the exact pre-EMA value used by the smoothing (derivable off msg fields)", () => {
  // The smoothed value in the state message must satisfy:
  //   mrs' = 0.85*mrs + mrRaw*0.15  — i.e. mrRaw is (mrs' - 0.85*mrs)/0.15.
  // Tick twice with a short dt so motor rate changes between ticks; verify the
  // relation to 1e-6 (float churn on the shared computation).
  const H = makeWorkerHarness(12);
  H.send(initPayload());
  const m0 = H.send(tickMsg({ motorDrive: 0.9, dt: 0.02 }));
  H.returnBuffers(m0);
  const from0 = (m0.mrs - 0) / 0.15;           // first tick: prior smooth is 0
  assert.ok(Math.abs(from0 - m0.mrRaw) < 1e-6,
    `first-tick mrRaw=${m0.mrRaw} vs (mrs)/0.15=${from0}`);
  const m1 = H.send(tickMsg({ motorDrive: 0.9, dt: 0.02 }));
  H.returnBuffers(m1);
  const from1 = (m1.mrs - 0.85 * m0.mrs) / 0.15;
  assert.ok(Math.abs(from1 - m1.mrRaw) < 1e-6,
    `second-tick mrRaw=${m1.mrRaw} vs (mrs'−0.85·mrs)/0.15=${from1}`);
});

test("R2 page side: state handler mirrors mrRaw to sim.motorRaw; in-frame path computes the same value", () => {
  const lines = HTML.split(/\r?\n/);
  const around = (idx, n) => lines.slice(Math.max(0, idx - n), idx + n).join("\n");
  // mirror gate: only the finite, worker-supplied value lands on sim.motorRaw
  const mirrorIdx = lines.findIndex((l, i) =>
    lines[i].includes("s.motorRateSmooth = m.mrs;") && lines[i].includes("m.mb;") === shotsFix(lines, i));
  assert.ok(mirrorIdx > 0, "worker state mirror line found");
  const ctx = around(mirrorIdx + 1, 8);
  assert.ok(ctx.includes("Number.isFinite(m.mrRaw)"), "mirror is gated on finiteness (old workers tolerated)");
  assert.ok(ctx.includes("s.motorRaw = m.mrRaw;"), "mirror writes sim.motorRaw");
  // in-frame fallback computes the same pre-EMA expression order
  const fb = lines.findIndex(l => l.includes("sim.motorRaw = motorRate()/Math.max(dt,1e-3)"));
  assert.ok(fb > 0, "in-frame fallback writes the same pre-EMA value");
  const fbCtx = around(fb + 1, 3);
  assert.ok(fbCtx.includes("sim.motorRateSmooth = sim.motorRateSmooth*0.85 + sim.motorRaw*0.15"),
    "fallback EMA consumes the same motorRaw variable (no second computation)");
});
function shotsFix(lines, i) { return true; }   // helper: the m.mb same-line check

// ---------------------------------------------------------------------------
// R1 — sensor vector identity/mirror + CSV columns
// ---------------------------------------------------------------------------
test("R1: readSensors mirrors the delivered vector into chemLastSens (both toggle arms)", () => {
  assert.ok(HTML.includes("chemLastSens = base;"),
    "OFF arm stores the exact base array it returns");
  const v = HTML.indexOf("const _sens = base.concat(demonObsVector());");
  assert.ok(v > 0, "ON arm builds the delivered vector explicitly");
  const seg = HTML.slice(v, v + 200);
  assert.ok(seg.includes("chemLastSens = _sens;"),
    "ON arm stores the exact concat result it returns (bit-identical to delivery)");
  // declared once at module scope, default null
  assert.ok(HTML.includes("let chemLastSens = null;"),
    "chemLastSens is module-scoped and null before the first read");
});

test("R1: chemLogSnapshot writes verbatim values, 15 positions, empty when absent", () => {
  const idx = HTML.indexOf("const sensCols = [];");
  assert.ok(idx > 0, "snapshot builds the 15-wide column set");
  const seg = HTML.slice(idx - 400, idx + 400);
  assert.ok(seg.includes("chemLastSens"), "reads the mirrored vector");
  assert.ok(seg.includes("sensRow.length"), "wider vector (15) preserved positionally");
  // JSON row carries the structure; CSV writer emits the 15 s-cells + motorRaw
  assert.ok(HTML.includes("sens: sensCols,"),
    "JSON rows carry the structured sens array");
  assert.ok(HTML.includes('"s0,s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,motorRaw'),
    "CSV header has s0..s14 then motorRaw at the tail");
});

test("R1/R2 CSV positional compatibility: original leading columns unchanged, new fields appended", () => {
  // Original 15 leading columns IN THEIR ORIGINAL ORDER (audit v2.2 header):
  const ORIG = "t,t_sim,dT,Tl,Tr,da,ser,oct,motor,motorBase,doorT,doorPos,jet,loco,ntP";
  const hIdx = HTML.indexOf('"t","t_sim","dT","Tl","Tr","da","ser","oct","motor","motorBase","doorT","doorPos","jet","loco","ntP"]');
  assert.ok(hIdx > 0, "leading cols array still has the original order/count");
  const hdrIdx = HTML.indexOf("rate_ach,rate_gaba,rate_glut,rate_da,rate_ser,rate_oct,");
  assert.ok(hdrIdx > 0, "header base intact");
  const head = HTML.slice(hdrIdx - 20, hdrIdx);
  assert.ok(head.includes(ORIG.slice(0, 20)) || HTML.includes(ORIG.slice(0, 20)) ||
    HTML.includes('"t","t_sim","dT"'), "original leading columns survive verbatim");
  // New columns are APPENDED (s0..s14, motorRaw) — never inserted mid-header:
  const tailIdx = HTML.indexOf("s0,s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,motorRaw");
  assert.ok(tailIdx > 0, "new columns live at the CSV tail, after causal");
  const tail = HTML.slice(tailIdx - 60, tailIdx);
  assert.ok(tail.includes("causal,"), "tail columns come immediately after the old last column");
  // motorRaw is NOT inside the leading cols array literal (would shift column
  // semantics): check only the bracketed array itself, not nearby comments.
  const arrStart = HTML.indexOf('["t","t_sim","dT"');
  assert.ok(arrStart > 0, "leading cols array literal found");
  const arrEnd = HTML.indexOf("]", arrStart);
  const arrBody = HTML.slice(arrStart, arrEnd + 1);
  assert.ok(!arrBody.includes("motorRaw"), "motorRaw must not be spliced into the leading block");
  assert.ok(arrBody.includes('"motorBase"'), "leading array retains motorBase in position");
});

// ---------------------------------------------------------------------------
// R3 — full-N weight snapshots at LOG start and save
// ---------------------------------------------------------------------------
test("R3: full-N snapshot scans ALL synapses (no stride), same signed baseline as the v2.2 estimator", () => {
  const idx = HTML.indexOf("function chemWeightSnapshot()");
  assert.ok(idx > 0, "snapshot function exists");
  const body = HTML.slice(idx, idx + 2400);
  assert.ok(body.includes("for (let i = 0; i < NE; i++)"),
    "loops the full NE (no sampled stride)");
  assert.ok(body.includes("W0[i] * sim.WS * (sim.isExc && sim.isExc[i] ? 1 : -1)"),
    "signed initial baseline identical to the v2.2 dwL1 estimator");
  assert.ok(body.includes("adw > 1e-5"), "same changed-synapse threshold as dwN");
  assert.ok(body.includes("sumW += Math.abs(w)"), "sumW is Σ|W| over all synapses");
  assert.ok(HTML.includes("const CHEM_TOPK = 100;"), "topK cap K=100 (module constant above the fn)");
  // no writes to sim state (read-only instrumentation):
  assert.ok(!body.includes("sim.W ="), "no assignment to sim.W");
  assert.ok(!body.replace(/^|\s*sim\./g, " sim.").includes(" sim.DA.v ="), "no writes to DA");
  // boundaries wired: called once on recording start, once on save
  assert.ok(HTML.includes("chemWsStart = chemWeightSnapshot();"),
    "start snapshot taken when recording begins");
  const saveSeg = HTML.slice(HTML.indexOf("const wsEnd = chemWeightSnapshot();"),
    HTML.indexOf("const wsEnd = chemWeightSnapshot();") + 400);
  assert.ok(saveSeg.includes("wsEnd"), "end snapshot taken at chemLogSave");
  // serialized into meta with an exact delta (not sampled-estimator diff)
  const metaSeg = HTML.slice(HTML.indexOf("meta.weights = {"), HTML.indexOf("meta.weights = {") + 1200);
  assert.ok(metaSeg.includes("dwL1Full"), "meta exposes dwL1Full");
  assert.ok(metaSeg.includes("delta:"), "meta carries the start→end delta");
  // topK reaches meta via _wsPick ({ok,NE,sumW,dwL1Full,dwNFull,topK}); verify
  // BOTH the picker's field and the picker itself being applied to the snapshots
  assert.ok(HTML.includes("topK: w.topK"), "_wsPick exposes topK triples");
  assert.ok(metaSeg.includes("_wsPick(chemWsStart)") && metaSeg.includes("_wsPick(wsEnd)"),
    "both snapshots pass through the topK-carrying picker");
});

// ---------------------------------------------------------------------------
// R4 — crossing event enrichment (physical sort measure)
// ---------------------------------------------------------------------------
test("R4: crossing events carry fracL/lN/rN from lastStats, plus the q-rule inputs v2/T2", () => {
  const idx = HTML.indexOf('chemEvent("crossing",');
  assert.ok(idx > 0, "crossing chemEvent site found");
  const seg = HTML.slice(idx, idx + 700);
  assert.ok(seg.includes("fracL:"), "fracL recorded per crossing");
  assert.ok(seg.includes("lN: lastStats.lN"), "lN from the actual tempStats snapshot");
  assert.ok(seg.includes("rN: lastStats.rN"), "rN from the actual tempStats snapshot");
  assert.ok(seg.includes("v2:") && seg.includes("T2:"),
    "q-rule inputs (particle speed², left mean v²) recorded alongside");
  // exact formula, not a re-derivation:
  assert.ok(seg.includes("lastStats.lN / Math.max(1, P.length)"),
    "fracL matches the readSensors fracL formula exactly");
});

// ---------------------------------------------------------------------------
// Contract guards — the audit's hard boundary
// ---------------------------------------------------------------------------
test("CONTRACT: learning rule, DA equation, actuate(), FSM, and physics untouched", () => {
  // DA rule intact (q·0.6·rewScale, same clamp):
  assert.ok(HTML.includes("const q = dir*(T2-v2)/Math.max(T2,1);"), "q rule exact");
  const daIdx = HTML.indexOf("sim.DA.v = clamp(sim.DA.v + q*0.6*rs, -1.5, 3);");
  assert.ok(daIdx > 0, "DA pulse rule intact");
  const daAfter = HTML.indexOf("sim.DA.v = clamp", daIdx + 2);       // 2nd occurrence is worker post? none — page has exactly one
  const daWorker = /S\.DA\.v = clampf\(S\.DA\.v \+ m\.dq, -1\.5, 3\)/.test(WORKER_SRC);
  assert.ok(daWorker, "worker reward accept rule intact");
  // applyLearning loop intact (same formula, same clamp):
  const pl = WORKER_SRC.match(/W\[i\] = clampf\(W\[i\] \+ d \* e \* sim\.WS \* W0b\[i\][^;]*\)/);
  assert.ok(pl, "worker applyLearning formula verbatim");
  // actuate gate rule intact in the page:
  assert.ok(HTML.includes("door.target = clamp((sim.motorRateSmooth - sim.motorBase - 0.02)*12, 0, 1);"),
    "brain-mode gate rule verbatim");
  assert.ok(HTML.includes("door.pos += (door.target-door.pos)*clamp(dt*8,0,1);"),
    "gate easing verbatim");
  // FSM untouched: DemonGatekeeper has no door writes
  const fsmStart = HTML.indexOf("const DemonGatekeeper = (function(){");
  const fsmEnd = HTML.indexOf("window.DemonGatekeeper = DemonGatekeeper;");
  assert.ok(fsmStart > 0 && fsmEnd > fsmStart, "FSM block located");
  const fsm = HTML.slice(fsmStart, fsmEnd);
  // assignment statements only — the FSM block's COMMENT lines legitimately
  // mention door.target/door.pos (they document the read-only contract)
  // Filter comment lines: the FSM block's comments legitimately mention
  // door.target/door.pos (they document the read-only contract) — only real
  // code statements must be free of door writes.
  const fsmCode = fsm.split(/\r?\n/).filter(l => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
  }).join("\n");
  assert.ok(!fsmCode.includes("door.target ="), "FSM never writes door.target");
  assert.ok(!fsmCode.includes("door.pos ="), "FSM never writes door.pos");
  // physics integrity: stepParticles still has its original crossing call
  assert.ok(HTML.includes("doorCrossing(p, 1);") && HTML.includes("doorCrossing(p, -1);"),
    "crossing dispatch intact");
  assert.ok(HTML.includes("if (door.pos>0.2){"), "crossing gate threshold intact");
});

test("CONTRACT: btnSwap / worker reset behavior untouched in this phase", () => {
  const swapIdx = HTML.indexOf('$("btnSwap").addEventListener');
  assert.ok(swapIdx > 0, "btnSwap handler present");
  const seg = HTML.slice(swapIdx, swapIdx + 2500);
  assert.ok(seg.includes("postMessage({ type:\"reset\" })"),
    "the pre-existing reset post is unchanged (un-implemented worker branch is the R7 finding, explicitly out of scope)");
  assert.ok(!WORKER_SRC.includes('m.type === "reset"'),
    "worker still has NO reset branch (R7 deferred by instruction)");
});
