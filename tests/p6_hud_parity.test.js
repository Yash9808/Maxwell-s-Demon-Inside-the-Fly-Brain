// (P6) HUD DOM-write batching parity — P4/P5 discipline: run against the
// PRE-EDIT page first to validate the legacy transcription against real
// production code, then re-run post-edit where updateHUD/expFrame stage
// computed strings every frame (metric math untouched, full rate) and flush
// the staged DOM writes at 10 Hz. At every flush the DOM must be byte-
// identical to the legacy direct writer; between flushes there must be ZERO
// DOM writes; and the staged strings at every frame must equal the text the
// legacy writer produced that same frame (nothing is recomputed at flush).
//
// P6_LIVE = page already contains the P6 gate (const P6_HUD_FLUSH_MS).
// Pre-edit it is false: only the transcription parity + full-rate-math
// assertions run (they validate the transcription against production code).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const HTML = fs.readFileSync(PAGE, "utf8");
const P6_LIVE = HTML.includes("const P6_HUD_FLUSH_MS");
const FLUSH_EVERY = 6;   // 100 ms gate at 16.6667 ms frames -> every 6th frame

function pageSlice(startMarker, endMarker) {
  const a = HTML.indexOf(startMarker);
  assert.ok(a >= 0, "start marker not found: " + JSON.stringify(startMarker));
  const b = HTML.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found: " + JSON.stringify(endMarker));
  return HTML.slice(a, b);
}

// ------------------------------------------------- sandbox plumbing
// Fake $ that records every DOM assignment (the thing P6 counts).
function mkRecorder() {
  const rec = new Map();       // id -> last text (or "id::style.color" -> color)
  let writes = 0;
  function mkEl(id) {
    const el = {};
    Object.defineProperty(el, "textContent", {
      set(v) { writes++; rec.set(id, String(v)); },
      get() { return rec.get(id) ?? ""; },
    });
    el.style = {};
    Object.defineProperty(el.style, "color", {
      set(v) { writes++; rec.set(id + "::style.color", String(v)); },
      get() { return rec.get(id + "::style.color") ?? ""; },
    });
    return el;
  }
  const els = new Map();
  const $ = (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };
  return { $, rec, get writes() { return writes; } };
}

// Fixture world matching the page-global shape the writers read.
function mkCtx() {
  const rec = mkRecorder();
  const ctx = { Math, console, $: rec.$, perfNow: 0 };
  ctx.performance = { now: () => ctx.perfNow };
  ctx.window = ctx;   // browsers expose `window`; page code guards on window.ExpUI (absent here)
  const P = [];
  for (let i = 0; i < 40; i++) {
    const fast = i % 2 === 0;
    const sp = fast ? 150 + (i % 7) * 20 : 40 + (i % 5) * 10;   // straddles the 120 threshold
    const an = (i * 2.399963) % (2 * Math.PI);                  // golden-angle spread
    P.push({ i, x: i % 2 ? -10 - i : 10 + i, y: (i % 9) * 7 - 28, z: (i % 5) * 11 - 22,
             vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.4, vz: Math.sin(an * 1.7) * sp * 0.3 });
  }
  ctx.P = P;
  ctx.sim = { motorRateSmooth: 55, DA: { v: 0.1 }, spikes: new Uint8Array(14),
              layers: [Array.from({ length: 8 }, (_, k) => k), Array.from({ length: 6 }, (_, k) => 8 + k)],
              layerStart: [0, 8] };
  ctx.door = { target: 0, pos: 0 };   // pos: physical gate position (drives the 3-state doorVal text)
  ctx.sens = new Float32Array(7);
  ctx.visual = new Float32Array(8);
  ctx.crossGood = 0; ctx.crossBad = 0;
  return { ctx, rec, P };
}

function runSlice(sandbox, code, filename) {
  vm.runInContext(code, sandbox, { filename });
}

// Deterministic per-frame driver: mutates ONLY state the writers read —
// identical for the legacy run and the current run (pure function of f).
function driveFrame(f, A) {   // A = { ctx, acc }
  A.acc.setLastDTv(Math.round((0.40 + 0.10 * Math.sin(f * 0.7)) * 1000) / 1000);
  A.ctx.door.target = f % 11 > 5 ? 1 : 0;
  // deterministic physical gate position spanning all three text states
  // (OPEN / closing… / closed) the doorVal line now presents
  A.ctx.door.pos = A.ctx.door.target > 0.5 ? (f % 3 === 1 ? 0.3 : 0.8) : 0;
  A.ctx.sim.DA.v = Math.round(Math.sin(f * 0.9) * 1.2 * 1e6) / 1e6;
  A.ctx.sim.motorRateSmooth = Math.round((40 + 30 * Math.sin(f * 0.3)) * 10) / 10;
  if (f % 3 === 0) A.ctx.crossGood += 2;
  if (f % 4 === 0) A.ctx.crossBad += 1;
  const E = A.acc.EXP;      // NOTE: __acc.EXP is a getter, not a method
  E.energyJ += 1e-19 * ((f % 7) + 1);
  E.THERMO.workInJ += 5e-20 * (f % 5);
  E.THERMO.measuredBits += f % 3;
  for (const p of A.ctx.P) {
    p.x += p.vx * 1e-3; p.y += p.vy * 1e-3; p.z += p.vz * 1e-3;
    p.vx += Math.sin(f + p.i) * 3; p.vy += Math.cos(f * 0.8 + p.i) * 2; p.vz += Math.sin(f * 0.5 + p.i * 0.3);
  }
  for (let k = 0; k < A.ctx.sens.length; k++) A.ctx.sens[k] = Math.abs(Math.sin(f * 0.13 + k));
  for (let k = 0; k < A.ctx.visual.length; k++) A.ctx.visual[k] = Math.abs(Math.cos(f * 0.11 + k * 0.7));
  E.mode = ["compare", "ann", "kid", "compare"][f % 4];
  A.ctx.sim.spikes[(f * 3) % A.ctx.sim.spikes.length] = f % 2;
  A.ctx.perfNow = Math.round(f * 16.6667 * 1000) / 1000;   // ~60 fps rAF timestamps
}

// JSON-safe deep snapshot of the EXP metric state (Float32Array -> Array).
function snapEXP(o) { return JSON.stringify(o, (k, v) => (v && v.constructor === Float32Array) ? Array.from(v) : v); }
function snapMap(m) { return [...m.keys()].sort().map((k) => k + "=" + m.get(k)).join("|"); }

// ------------------------------------------------- legacy transcription
// Oracle transcription of updateHUD (direct-write semantics). 2026-09-27
// repair: the page's updateHUD gained (sens, visual) in Phase B (passed
// through to the guarded causal-panel/ExpUI tail) and its doorVal line moved
// from the commanded door.target to the PHYSICAL door.pos (3-state text);
// the oracle now mirrors that call surface and text exactly, while keeping
// the direct every-call DOM writes that define "legacy" for this parity
// suite. The guarded tail is inert in the sandbox (no CausalPanel/ExpUI),
// matching production's short-circuit behavior.
const LEGACY_UPDATEHUD_SRC = `
function updateHUD(Tl, Tr, dT, sens, visual){
    $("tVals").textContent = \`\${Tl.toFixed(1)} / \${Tr.toFixed(1)}\`;
    $("dTVal").textContent = dT.toFixed(2);
    $("motorVal").textContent = (sim.motorRateSmooth).toFixed(1)+" Hz";
    $("doorVal").textContent = door.pos>0.5?"OPEN":door.pos>0.02?"closing…":"closed";
    $("daVal").textContent = sim.DA.v.toFixed(2);
    $("daVal").style.color = sim.DA.v>0.3?"var(--good)":sim.DA.v<-0.3?"var(--bad)":"var(--txt)";
    $("crossVal").textContent = \`\${crossGood}:\${crossBad}\`;
    if (typeof DemonObserver !== "undefined") DemonObserver.step();
    window.CausalPanel && window.CausalPanel.flush(dT, sens, visual);
    window.ExpUI && window.ExpUI.update(0, { stimPulse: sim._stimPulse || 0, da: sim.DA.v });
}
`;
const LEGACY_EXPFRAME_SRC = `
function expFrame(sens, visual){
    const dAction = expDemonDecision();
    let bAction;
    if (EXP.mode==="demon"){ bAction=dAction; }
    else if (EXP.mode==="ann"){ bAction=expAnnDecision(sens,visual); }
    else if (EXP.mode==="kid"){ bAction=expKidDecision(sens,visual); }
    else { bAction = door.target>0.5?1:0; }
    EXP.lastDemon=dAction; EXP.lastBrain=bAction;
    EXP.agreeD++; if (dAction===bAction) EXP.agreeN++;
    const se = METRICS_SORT();
    const mi = METRICS_MI();
    EXP.sortEma = EXP.sortEma*0.97 + se*0.03;
    EXP.miEma   = EXP.miEma*0.97   + mi*0.03;
    const agree = EXP.agreeD? EXP.agreeN/EXP.agreeD : 0;
    const dsi = 0.5*agree + 0.3*Math.min(1,EXP.miEma/1.5) + 0.2*Math.min(1,EXP.sortEma/1.0);
    EXP.dsiEma = EXP.dsiEma*0.95 + dsi*0.05;
    $("xCompAction").textContent = dAction? "OPEN":"closed";
    $("xBrainAction").textContent = bAction? "OPEN":"closed";
    $("xAgree").textContent = (agree*100).toFixed(1)+"%";
    $("xSortH").textContent = EXP.sortEma.toFixed(3)+" bits";
    $("xMI").textContent = EXP.miEma.toFixed(3)+" bits";
    $("xDT").textContent = lastDTv.toFixed(2);
    $("xEnergy").textContent = EXP.energyJ.toExponential(2)+" J";
    $("xDSI").textContent = EXP.dsiEma.toFixed(3);
    const T = EXP.THERMO;
    if (door.target !== T.lastDoorTarget){ T.measuredBits += 1; T.lastDoorTarget = door.target; }
    const extJ = METRICS_EXTRACT() * 1e-21;
    T.extractEma = T.extractEma*0.97 + extJ*0.03;
    const eff = T.workInJ > 0 ? T.extractEma / T.workInJ : 0;
    T.effEma = T.effEma*0.97 + eff*0.03;
    const KB_ = 1.380649e-23;
    const landauerJ = KB_ * T.T_ENV * Math.LN2 * T.measuredBits;
    const bitsNeeded = T.extractEma > 0 ? T.extractEma / (KB_ * T.T_ENV * Math.LN2) : 0;
    $("xWorkIn").textContent = T.workInJ.toExponential(2)+" J";
    $("xExtract").textContent = T.extractEma.toExponential(2)+" J";
    $("xEff").textContent = (T.effEma*100).toExponential(1)+" %";
    $("xLandauer").textContent = landauerJ.toExponential(2)+" J";
    $("xBits").textContent = Math.round(T.measuredBits)+" / "+
      (bitsNeeded >= 1000 ? (bitsNeeded/1000).toFixed(1)+"k" : Math.round(bitsNeeded));
}
`;
const UIW = "// ============================================================ UI WIRING";

// Page slice holding lastDTv/EXP/METRICS_*/exp*Decision (both runs share it;
// in the current page it also contains the P6-staged updateHUD/expFrame).
const S2_A = "let lastDTv = 0;";
const S2_B = "// experiment panel buttons";
const ACC_SRC = `
__acc = {
  get EXP(){ return EXP; },
  setLastDTv(v){ lastDTv = v; },
};
`;

// ------------------------------------------------- scenario runner
function runScenario(frames) {
  // ---- legacy run: verbatim transcriptions of the pre-edit direct writers
  const leg = mkCtx();
  vm.createContext(leg.ctx);
  runSlice(leg.ctx, pageSlice(S2_A, S2_B) + ACC_SRC + LEGACY_UPDATEHUD_SRC + LEGACY_EXPFRAME_SRC, "p6-legacy.js");
  const legRuns = { snaps: [], expSnaps: [], writes: [] };
  const A = { ctx: leg.ctx, acc: leg.ctx.__acc };
  for (let f = 0; f < frames; f++) {
    driveFrame(f, A);
    leg.ctx.updateHUD(tempTl(f), tempTr(f), lastDTof(A.acc));
    leg.ctx.expFrame(A.ctx.sens, A.ctx.visual);
    legRuns.snaps.push(snapMap(leg.rec.rec));
    legRuns.expSnaps.push(snapEXP(leg.ctx.__acc.EXP));
    legRuns.writes.push(leg.rec.writes);
  }

  // ---- current run: page slices (pre-edit: original direct writers;
  //      post-edit: P6 stage/flush pipeline, identical call surface)
  // ---- current run: both writers extracted from the PAGE (pre-edit: direct
  //      originals — validates the transcriptions; post-edit: P6-staged)
  const cur = mkCtx();
  vm.createContext(cur.ctx);
  // Post-edit the staged writers reference the P6 infra (p6Stage/p6Staged/
  // p6StagedStyle/p6HudFlushIfDue) which lives in the infra slice, not in the
  // writer slices — extract it with the same UI-WIRING end marker.
  const infra = P6_LIVE ? pageSlice("const P6_HUD_FLUSH_MS", UIW) : "";
  const s1 = pageSlice("function updateHUD(Tl, Tr, dT, sens, visual){", UIW) +
             pageSlice("function expFrame(sens, visual){", "// extractable work of the current two-reservoir state");
  runSlice(cur.ctx, infra + s1 + pageSlice(S2_A, S2_B) + ACC_SRC +
    (P6_LIVE ? `
__hudProbe = () => ({
  text: [...p6Staged].map(([k,v]) => k+"="+v).sort().join("|"),
  style: [...p6StagedStyle].map(([k,v]) => k+"::style.color="+v).sort().join("|"),
  n: p6Staged.size + p6StagedStyle.size,
});` : ""), "p6-current.js");
  const curRuns = { snaps: [], expSnaps: [], writes: [], probes: [] };
  const B = { ctx: cur.ctx, acc: cur.ctx.__acc };
  for (let f = 0; f < frames; f++) {
    driveFrame(f, B);
    cur.ctx.updateHUD(tempTl(f), tempTr(f), lastDTof(B.acc));
    cur.ctx.expFrame(B.ctx.sens, B.ctx.visual);  // (staged post-edit: flush fires inside expFrame)
    curRuns.snaps.push(snapMap(cur.rec.rec));
    curRuns.expSnaps.push(snapEXP(cur.ctx.__acc.EXP));
    curRuns.writes.push(cur.rec.writes);
    // staged state must be captured DURING the loop — the staged maps hold
    // only the latest frame's strings once the run completes
    if (P6_LIVE) curRuns.probes.push(cur.ctx.__hudProbe());
  }
  return { leg, cur, legRuns, curRuns };
}

// deterministic updateHUD inputs (Tl/Tr only feed strings)
function tempTl(f) { return Math.round((30 + 2 * Math.sin(f * 0.4)) * 10) / 10; }
function tempTr(f) { return Math.round((28 + 2 * Math.cos(f * 0.23)) * 10) / 10; }
function lastDTof(acc) { return acc.EXP.lastDemon ? 0.42 : 0.41; }  // drives $("xDT") too

function parseSnap(s) {
  const m = new Map();
  if (!s) return m;
  for (const kv of s.split("|")) {
    if (!kv) continue;
    const i = kv.indexOf("=");
    m.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return m;
}

// ------------------------------------------------- tests
test("P6: transcription validated — EXP metric/decision state deep-equal every frame", () => {
  const r = runScenario(30);
  for (let f = 0; f < 30; f++) {
    assert.equal(r.curRuns.expSnaps[f], r.legRuns.expSnaps[f], "EXP state diverged at frame " + f);
  }
});

test("P6: flush-frame DOM is byte-identical to legacy direct writes", () => {
  const r = runScenario(37);
  for (let f = 0; f < 37; f++) {
    assert.equal(r.curRuns.expSnaps[f], r.legRuns.expSnaps[f], "metric math diverged at frame " + f);
    if (f % FLUSH_EVERY === 0 || !P6_LIVE) {
      assert.equal(r.curRuns.snaps[f], r.legRuns.snaps[f], "DOM mismatch at flush frame " + f);
    }
  }
});

test("P6: staged strings at EVERY frame equal the legacy text for that frame (nothing recomputed)", () => {
  if (!P6_LIVE) return;
  const r = runScenario(29);
  for (let f = 0; f < 29; f++) {
    const probe = r.curRuns.probes[f];
    const leg = parseSnap(r.legRuns.snaps[f]);
    const text = new Map();
    for (const kv of probe.text.split("|")) if (kv) { const i = kv.indexOf("="); text.set(kv.slice(0, i), kv.slice(i + 1)); }
    for (const kv of probe.style.split("|")) if (kv) { const i = kv.indexOf("="); text.set(kv.slice(0, i), kv.slice(i + 1)); }
    assert.equal([...text.keys()].sort().join("|"), [...leg.keys()].sort().join("|"),
      "staged key set mismatch at frame " + f);
    for (const [k, v] of leg) assert.equal(text.get(k), v, "staged value mismatch at frame " + f + " key " + k);
  }
});

test("P6: zero DOM writes between flushes; DOM lags legacy by at most one flush interval", () => {
  if (!P6_LIVE) return;
  const r = runScenario(31);
  // writes only increase at flush frames
  for (let f = 1; f < 31; f++) {
    if (f % FLUSH_EVERY !== 0) assert.equal(r.curRuns.writes[f], r.curRuns.writes[f - 1],
      "DOM writes occurred at non-flush frame " + f);
  }
  // DOM content equals legacy content at the last flushed frame
  const INITIAL = "";
  let lastFlushSnap = INITIAL;
  for (let f = 0; f < 31; f++) {
    if (f % FLUSH_EVERY === 0) lastFlushSnap = r.legRuns.snaps[f];
    assert.equal(r.curRuns.snaps[f], lastFlushSnap,
      "current DOM at frame " + f + " should equal legacy DOM at last flush");
  }
  // aggregate: ~frames/6 flushes × 20 writes vs legacy ~frames × 20
  const curTotal = r.curRuns.writes[30], legTotal = r.legRuns.writes[30];
  assert.ok(curTotal < legTotal / 4, "expected >4x write reduction, got " + curTotal + " vs " + legTotal);
});

test("P6: gate is exactly 100 ms — flush fires only at the 6th 16.6667 ms frame", () => {
  if (!P6_LIVE) return;
  const r = runScenario(13);
  let changes = 0;
  for (let f = 1; f < 13; f++) if (r.curRuns.snaps[f] !== r.curRuns.snaps[f - 1]) changes++;
  assert.equal(changes, 2, "flush cadence deviated from every 6th frame at 60 fps timing");
  const s1 = pageSlice("const P6_HUD_FLUSH_MS", "// ============================================================ UI WIRING");
  assert.match(s1, /P6_HUD_FLUSH_MS\s*=\s*100\b/, "flush gate must be 100 ms (10 Hz)");
});

test("P6: bestVal panel writes route through the staged path; no direct write remains", () => {
  if (!P6_LIVE) return;
  const frameSlice = pageSlice("function frame(now)", "function readSensors(");
  assert.ok(frameSlice.includes('p6Stage("bestVal"'), "bestVal writes not staged in frame()");
  assert.ok(!frameSlice.includes('$("bestVal").textContent'), "direct bestVal textContent write remains");
});

test("P6: hygiene — staged updateHUD/expFrame contain no direct DOM writes; flush helper is module-level", () => {
  if (!P6_LIVE) return;
  const s1 = pageSlice("const P6_HUD_FLUSH_MS", "// ============================================================ UI WIRING");
  const hudBody = s1.slice(s1.indexOf("function updateHUD("), s1.indexOf("function p6HudFlushIfDue("));
  assert.ok(!/textContent\s*=/.test(hudBody), "direct textContent write inside staged updateHUD");
  const expSlice = pageSlice("function expFrame(sens, visual){", S2_B);
  assert.ok(!/textContent\s*=/.test(expSlice), "direct textContent write inside staged expFrame");
  assert.ok(hudBody.includes("p6HudFlushIfDue()"), "updateHUD must end by attempting the flush");
  assert.ok(s1.includes("p6StagedStyle"), "style.color must route through the staged map");
});
