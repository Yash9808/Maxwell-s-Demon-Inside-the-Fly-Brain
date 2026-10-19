// (P8) De-eager loadCellTypes — F2. Pre-edit, the page fetches
// fly_brain_celltypes.json in an eager async IIFE at module load, competing
// with the circuit/paths payloads for bandwidth; every consumer of CELLTYPES
// is .ready-guarded, so the palette is only *needed* on first anatomy use
// (chip-T view, arbors, cell-type family overlays). P8 turns the IIFE into an
// idempotent function invoked from those first uses; the loader's completion
// rebuilds the brain only when the T anatomy view is currently open (same
// self-heal pattern as the late-arriving anatomy data).
//
// The loader is about WHEN work starts, not about computed values, so the
// parity surface is: identical payload handling (byRoot/counts/ready/messages),
// identical failure semantics, exactly-once fetching, and trigger wiring.
//
// P8_LIVE = page already contains the lazy loader (let _ctLoadStarted).
// Pre-edit it is false: only the transcription-validation tests run — they
// compare the verbatim legacy transcription against the real page IIFE.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const HTML = fs.readFileSync(PAGE, "utf8");
const P8_LIVE = HTML.includes("let _ctLoadStarted");
const drain = () => new Promise((r) => setImmediate(r));

function pageSlice(startMarker, endMarker) {
  const a = HTML.indexOf(startMarker);
  assert.ok(a >= 0, "start marker not found: " + JSON.stringify(startMarker));
  const b = HTML.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found: " + JSON.stringify(endMarker));
  return HTML.slice(a, b);
}

// ------------------------------------------------- fetch mock (controllable)
function mkFetch(response) {
  const calls = [];
  let resolver = null;
  const fn = (url, opts) => {
    calls.push({ url, opts: opts ? JSON.parse(JSON.stringify(opts)) : null });
    return new Promise((res, rej) => {
      if (response.reject) resolver = () => rej(new Error("network down"));
      else resolver = () => res({ ok: response.ok, status: response.status || 200,
                                 json: async () => response.json });
    });
  };
  fn.settle = () => { const p = resolver(); return p && p.catch && p.catch(() => {}) || p; };
  fn.calls = calls;
  return fn;
}

// Realistic mini payload: 2 typed (one repeated), 1 UNKNOWN, 1 missing field.
const PAYLOAD = { neurons: [
  { root_id: 11, cell_type: "Kenyon cell" },
  { root_id: 22, cell_type: "Kenyon cell" },
  { root_id: 33, cell_type: "UNKNOWN" },
  { root_id: 44 },
] };
const OK = { ok: true, json: PAYLOAD };

const MSG_LOADED = "cell types loaded: 2 neurons typed (Schlegel et al. 2024)";
const MSG_VIEW = "cell-type view — 2 neurons typed across 1 published types (Schlegel et al. 2024); untyped neurons stay grey";
const MSG_MISSING = "cell types not loaded — fly_brain_celltypes.json missing or untyped";
const MSG_PENDING = "loading cell types…";
const MSG_NOT_ANAT = "cell-type coloring shows in the anatomical view — press 🧠 anatomy, then T";

// ------------------------------------------------- sandbox plumbing
function mkRec() {
  const rec = { msgs: [], buildBrain: 0, toggles: [] };
  rec.els = new Map();
  rec.$ = (id) => {
    if (!rec.els.has(id)) rec.els.set(id, {
      textContent: "", style: {},
      classList: { toggle: (c, on) => rec.toggles.push(id + ":" + c + ":" + !!on) },
    });
    return rec.els.get(id);
  };
  rec.msg = (m, ms) => rec.msgs.push(String(m));
  return rec;
}

// Verbatim transcription of the PRE-EDIT loader (const CELLTYPES + eager IIFE).
const LEGACY_SRC = `
const CELLTYPES = { byRoot: new Map(), ready: false, counts: {} };
(async function loadCellTypes(){
  try {
    const j = await fetch("fly_brain_celltypes.json",{cache:"no-cache"}).then(r => r.ok ? r.json() : null);
    if (!j || !j.neurons) return;
    for (const n of j.neurons){
      if (n.cell_type && n.cell_type !== "UNKNOWN"){
        CELLTYPES.byRoot.set(String(n.root_id), n.cell_type);
        CELLTYPES.counts[n.cell_type] = (CELLTYPES.counts[n.cell_type]||0)+1;
      }
    }
    CELLTYPES.ready = CELLTYPES.byRoot.size > 0;
    if (CELLTYPES.ready && typeof msg === "function")
      msg("cell types loaded: " + CELLTYPES.byRoot.size.toLocaleString()
          + " neurons typed (Schlegel et al. 2024)", 3600);
  } catch(e) { /* cell types optional */ }
})();
`;

const CELL_START = "const CELLTYPES = {";
const CELL_END = "const _ctColorCache";
// const declarations don't attach to the vm global — expose via accessor probe
const CT_PROBE = ";__ct = () => CELLTYPES;";

function snapCT(CT) {
  // done is a P8 addition ("attempt finished"); the legacy IIFE has no such
  // flag, so it is excluded from the legacy-vs-page parity snapshot and
  // asserted directly on the page object in the flow tests.
  return JSON.stringify({
    byRoot: [...CT.byRoot.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    counts: Object.entries(CT.counts).sort(),
    ready: CT.ready,
  });
}

// ------------------------------------------------- tests
test("P8: legacy transcription validated — eager fetch + payload handling identical to page", async () => {
  // legacy transcription run
  const lr = mkRec();
  const lf = mkFetch(OK);
  const lsb = { fetch: lf, msg: lr.msg, console, Math };
  vm.createContext(lsb);
  vm.runInContext(LEGACY_SRC + CT_PROBE, lsb, { filename: "p8-legacy.js" });
  const lCT = lsb.__ct();
  assert.equal(lf.calls.length, 1, "legacy transcription must fetch at eval (module-load behavior)");
  assert.equal(lf.calls[0].url, "fly_brain_celltypes.json");
  assert.deepEqual(lf.calls[0].opts, { cache: "no-cache" });
  await lf.settle(); await drain();

  // real page slice run
  const pr = mkRec();
  const pf = mkFetch(OK);
  const psb = { fetch: pf, msg: pr.msg, console, Math };
  vm.createContext(psb);
  vm.runInContext(pageSlice(CELL_START, CELL_END) + CT_PROBE, psb, { filename: "p8-page.js" });
  const pCT = psb.__ct();
  if (!P8_LIVE) {
    assert.equal(pf.calls.length, 1, "pre-edit page must fetch at eval too");
  } else {
    assert.equal(pf.calls.length, 0, "post-edit page must not fetch at eval");
    psb.loadCellTypes();
    assert.equal(pf.calls.length, 1, "first-use trigger fetches once");
  }
  await pf.settle(); await drain();

  assert.equal(snapCT(lCT), snapCT(pCT), "payload handling diverged");
  assert.equal(JSON.stringify(lr.msgs), JSON.stringify(pr.msgs), "messages diverged");
  assert.deepEqual(lr.msgs, [MSG_LOADED]);
  // untyped neurons excluded from the map
  assert.equal(lCT.byRoot.get("11"), "Kenyon cell");
  assert.equal(lCT.byRoot.has("33"), false, "UNKNOWN must be excluded");
  assert.equal(lCT.byRoot.has("44"), false, "missing cell_type must be excluded");
});

test("P8: malformed/failed payloads — ready stays false, no message, both variants", async () => {
  for (const resp of [{ ok: true, json: {} }, { ok: true, json: { neurons: [] } },
                      { ok: false, status: 404 }, { reject: true }]) {
    const r = mkRec();
    const f = mkFetch(resp);
    const sb = { fetch: f, msg: r.msg, console, Math };
    vm.createContext(sb);
    vm.runInContext(LEGACY_SRC + CT_PROBE, sb, { filename: "p8-legacy-fail.js" });
    await f.settle(); await drain();
    assert.equal(sb.__ct().ready, false, "ready must stay false for " + JSON.stringify(resp));
    assert.equal(r.msgs.length, 0, "failure must be silent for " + JSON.stringify(resp));
  }
});

test("P8: page never fetches at load; first use fetches exactly once (idempotent)", async () => {
  if (!P8_LIVE) return;
  const r = mkRec();
  const f = mkFetch(OK);
  const sb = { fetch: f, msg: r.msg, console, Math, anatMode: false, SCIMODE: { chip: "A" } };
  vm.createContext(sb);
  vm.runInContext(pageSlice(CELL_START, CELL_END) + CT_PROBE, sb, { filename: "p8-page-lazy.js" });
  assert.equal(f.calls.length, 0, "module eval must not fetch");
  sb.loadCellTypes();
  sb.loadCellTypes(); sb.loadCellTypes();          // concurrent triggers
  assert.equal(f.calls.length, 1, "exactly one fetch per page life");
  await f.settle(); await drain();
  sb.loadCellTypes();                              // trigger after completion
  assert.equal(f.calls.length, 1, "must not refetch after completion");
  assert.equal(sb.__ct().ready, true);
  assert.deepEqual(r.msgs, [MSG_LOADED]);
});

test("P8: failure semantics — silent, done, no refetch; missing-file message preserved on next chip-T click", async () => {
  if (!P8_LIVE) return;
  for (const resp of [{ ok: false, status: 404 }, { reject: true }]) {
    const r = mkRec();
    const f = mkFetch(resp);
    const sb = { fetch: f, msg: r.msg, $: r.$, console, Math, anatMode: true,
                 SCIMODE: { chip: "T" }, applySciMode() {},
                 sim: { circuit: { n: 1 } }, buildBrain() { r.buildBrain++; } };
    vm.createContext(sb);
    vm.runInContext(pageSlice(CELL_START, CELL_END) + CT_PROBE
      + pageSlice("function rebuildBrainIfReady(){", "// ---- W1 REAL pathway")
      + pageSlice("function setChip(id){", '$("chipA").onclick')
      + pageSlice('$("chipT").onclick', '$("chipR").onclick'), sb, { filename: "p8-fail-flow.js" });
    sb.$("chipT").onclick();                        // first click starts the fetch
    assert.equal(f.calls.length, 1);
    await f.settle(); await drain();
    assert.equal(sb.__ct().ready, false);
    assert.equal(sb.__ct().done, true, "attempt must mark done (finally)");
    assert.equal(r.buildBrain, 0, "failed palette must not trigger a rebuild");
    sb.$("chipT").onclick();                        // second click: legacy missing message
    assert.equal(f.calls.length, 1, "no refetch on second click");
    // the FIRST click legitimately showed the pending message (the fetch had
    // not failed yet); the second click must show the exact legacy message
    assert.deepEqual(r.msgs, [MSG_PENDING, MSG_MISSING]);
  }
});

test("P8: chip-T click flow — pending message, self-heal rebuild of the open T view, success message on re-click", async () => {
  if (!P8_LIVE) return;
  const r = mkRec();
  const f = mkFetch(OK);
  const sb = { fetch: f, msg: r.msg, $: r.$, console, Math, anatMode: true,
               SCIMODE: { chip: "A" }, applySciMode() {},
               sim: { circuit: { n: 1 } }, buildBrain() { r.buildBrain++; } };
  vm.createContext(sb);
  vm.runInContext(pageSlice(CELL_START, CELL_END)
    + pageSlice("function rebuildBrainIfReady(){", "// ---- W1 REAL pathway")
    + pageSlice("function setChip(id){", '$("chipA").onclick')
    + pageSlice('$("chipT").onclick', '$("chipR").onclick'), sb, { filename: "p8-click-flow.js" });
  sb.$("chipT").onclick();
  assert.equal(f.calls.length, 1, "first T click must start the fetch");
  assert.ok(r.msgs.includes(MSG_PENDING), "pending message expected, got " + JSON.stringify(r.msgs));
  assert.equal(r.buildBrain, 0, "no rebuild before the palette lands");
  await f.settle(); await drain();
  assert.equal(r.buildBrain, 1, "open T anatomy view must be rebuilt once the palette lands");
  assert.deepEqual(r.msgs, [MSG_PENDING, MSG_LOADED]);
  sb.$("chipT").onclick();                          // now ready: success branch
  assert.equal(f.calls.length, 1);
  assert.ok(r.msgs.includes(MSG_VIEW), "success view message expected, got " + JSON.stringify(r.msgs));
  assert.equal(r.buildBrain, 1, "no duplicate rebuilds");
});

test("P8: chip-T click outside anatomy view — hint message only, no fetch", async () => {
  if (!P8_LIVE) return;
  const r = mkRec();
  const f = mkFetch(OK);
  const sb = { fetch: f, msg: r.msg, $: r.$, console, Math, anatMode: false,
               SCIMODE: { chip: "A" }, applySciMode() {},
               sim: { circuit: { n: 1 } }, buildBrain() { r.buildBrain++; } };
  vm.createContext(sb);
  vm.runInContext(pageSlice(CELL_START, CELL_END)
    + pageSlice("function rebuildBrainIfReady(){", "// ---- W1 REAL pathway")
    + pageSlice("function setChip(id){", '$("chipA").onclick')
    + pageSlice('$("chipT").onclick', '$("chipR").onclick'), sb, { filename: "p8-notanat.js" });
  sb.$("chipT").onclick();
  assert.equal(f.calls.length, 0, "hint-only click must not fetch");
  assert.deepEqual(r.msgs, [MSG_NOT_ANAT]);
  assert.equal(r.buildBrain, 0);
});

test("P8: arbor/family triggers wired before their ready guards; consumer guards untouched", () => {
  if (!P8_LIVE) return;
  const showArbor = pageSlice("function showArbor(neuronIdx){", "function hideArbor(){");
  assert.match(showArbor, /hideArbor\(\);\s*\n\s*loadCellTypes\(\);/,
    "showArbor must trigger the palette fetch right after hideArbor()");
  const famShow = pageSlice("async function famShow(name){", "enter the anatomy view first");
  assert.match(famShow, /async function famShow\(name\)\{\s*\n\s*loadCellTypes\(\);/,
    "famShow must trigger the palette fetch as its first statement");
  // buildBrain chip-T guards must be byte-identical to pre-edit
  assert.ok(HTML.includes('const ctOf = (anatMode && SCIMODE.chip==="T" && CELLTYPES.ready && circuit.provenance)'));
  assert.ok(HTML.includes('} else if (anatMode && SCIMODE.chip==="T" && CELLTYPES.ready){'));
  // setChip T-entry routes through the loader
  const setChip = pageSlice("function setChip(id){", '$("chipA").onclick');
  assert.match(setChip, /if \(CELLTYPES\.ready\) rebuildBrainIfReady\(\);\s*\n\s*else loadCellTypes\(\);/,
    "setChip T-entry must rebuild when ready, else start the fetch");
});

test("P8: hygiene — lazy loader in place; the other eager loaders are untouched", () => {
  if (!P8_LIVE) return;
  const cell = pageSlice(CELL_START, CELL_END);
  assert.doesNotMatch(cell, /\(async function loadCellTypes\)/, "eager IIFE must be gone");
  assert.match(cell, /let _ctLoadStarted/, "idempotence flag missing");
  assert.match(cell, /function loadCellTypes\(\)\{/, "idempotent loader missing");
  assert.match(cell, /finally\s*\{/, "done must be set in finally (covers early return + throw)");
  assert.ok(HTML.includes('(async function loadEdgePaths(){'), "loadEdgePaths must stay eager");
  assert.ok(HTML.includes('(async function loadArbors(){'), "loadArbors must stay eager");
  assert.ok(/const PATHS = \{ bin: null, idx: null, ready: false, failed: false \};/.test(HTML), "PATHS untouched");
  assert.ok(/const ARBOR = \{ bin: null, idx: null, ready: false \};/.test(HTML), "ARBOR untouched");
});
