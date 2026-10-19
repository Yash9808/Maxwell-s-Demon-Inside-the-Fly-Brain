// (P9) cell-types parse off the main thread — F2. The 53.8 MB
// fly_brain_celltypes.json r.json()/JSON.parse is the largest remaining
// main-thread parse; P9 moves fetch+parse into celltypes_worker.js and ships
// the page only what its consumers ever read: root_id -> type-name Map,
// per-type counts, neuron count — two transferable buffers + a small Map.
//
// Parity strategy (P4–P8 discipline, zero transcriptions on the hot path):
//   worker side  — the REAL celltypes_worker.js runs in a vm with a fake
//                  self/postMessage that uses structuredClone({transfer}) so
//                  ArrayBuffer detachment semantics are real.
//   page side    — the REAL loadCellTypes slice runs in a vm with a fake
//                  Worker class; the worker's posted message is structured-
//                  cloned (as a real postMessage would) and dispatched into
//                  the page's actual onmessage closure.
//   oracle       — the verbatim legacy main-thread loader (the P8
//                  transcription, validated against the pre-edit page in that
//                  suite) applied to the same payload: CELLTYPES.byRoot
//                  (entries AND order), counts (values AND key order), ready
//                  flag, messages.
// Failure contract: any worker-level failure answers celltypes_unavailable
// and the page must end in exactly the missing-file state (P8 UX preserved:
// silent attempt, done, exact legacy message on the next chip-T click).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
const WORKER_SRC = fs.readFileSync(path.join(ROOT, "celltypes_worker.js"), "utf8");
const drain = () => new Promise((r) => setImmediate(r));

function pageSlice(startMarker, endMarker) {
  const a = HTML.indexOf(startMarker);
  assert.ok(a >= 0, "startMarker not found: " + JSON.stringify(startMarker));
  const b = HTML.indexOf(endMarker, a);
  assert.ok(b > a, "endMarker not found: " + JSON.stringify(endMarker));
  return HTML.slice(a, b);
}

// ------------------------------------------------- fixture
// JSON text -> JSON.parse (the same entry point both paths see), including a
// root id above 2^53 (720575940596125868) — already truncated by the legacy
// path; parity requires the worker path to round IDENTICALLY, not better.
const PAYLOAD_TEXT = '{"neurons":['
  + '{"root_id":720575940596125868,"cell_type":"Kenyon cell"},'
  + '{"root_id":22,"cell_type":"Kenyon cell"},'
  + '{"root_id":33,"cell_type":"Optic lobe DCN"},'
  + '{"root_id":44,"cell_type":"UNKNOWN"},'
  + '{"root_id":55}'
  + "]}";
const PAYLOAD = JSON.parse(PAYLOAD_TEXT);
const BIG_KEY = String(720575940596125868);   // legacy key for the 2^53+ id

const MSG_LOADED_N = "cell types loaded: 3 neurons typed (Schlegel et al. 2024)";
const MSG_MISSING = "cell types not loaded — fly_brain_celltypes.json missing or untyped";
const MSG_PENDING = "loading cell types…";

// ------------------------------------------------- legacy oracle loader
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
;__ct = () => CELLTYPES;`;

function snapCT(CT) {
  // byRoot entries in order; counts as entries (key order matters);
  // done excluded (legacy has no such flag)
  return JSON.stringify({
    byRoot: [...CT.byRoot.entries()],
    counts: Object.entries(CT.counts),
    ready: CT.ready,
  });
}

// ------------------------------------------------- worker harness (p3_behavior pattern)
function mkWorkerSandbox(payload) {
  let promise = null;
  const fetchMock = () => {
    if (promise) return promise;
    promise = new Promise((res, rej) => {
      resolver = () => {
        if (payload.reject) rej(new Error("network down"));
        else res({ ok: payload.ok !== false, status: payload.status || 200,
                   json: async () => payload.json });
        return promise;   // settle() must hand back the fetch promise itself
      };
    });
    return promise;
  };
  let resolver = null;
  fetchMock.settle = () => resolver ? resolver() : promise;
  const sent = [];                       // { msg (cloned), workerSide }
  const self = {
    onmessage: null,
    postMessage(msg, transfer) {
      const tr = transfer || [];
      const workerSide = msg;            // views BEFORE the transfer detaches them
      sent.push({ msg: structuredClone(msg, { transfer: tr }), workerSide });
    },
  };
  const sb = { self, fetch: fetchMock, TextEncoder, structuredClone, console };
  vm.createContext(sb);
  new vm.Script(WORKER_SRC, { filename: "celltypes_worker.js" }).runInContext(sb);
  return { sb, self, sent, fetchMock };
}

// ------------------------------------------------- page harness (fake Worker)
function mkPageSandbox() {
  const rec = { msgs: [], builds: 0, clicks: [], workerUrl: null, posted: [] };
  const els = new Map();
  const $fake = (id) => { if (!els.has(id)) els.set(id, { textContent: "", style: {},
    classList: { toggle: (c, on) => rec.clicks.push(id + ":" + c + ":" + !!on) } });
    return els.get(id); };
  class FakeWorker {
    constructor(url) { rec.workerUrl = url; FakeWorker.instances.push(this); this.terminated = false; }
    postMessage(m) { rec.posted.push(m); }
    terminate() { this.terminated = true; }
    __dispatch(data) { if (this.onmessage) this.onmessage({ data }); }
  }
  FakeWorker.instances = [];
  const sb = { Worker: FakeWorker, msg: (m) => rec.msgs.push(String(m)), $: $fake,
               anatMode: true, SCIMODE: { chip: "A" }, applySciMode() {},
               rebuildBrainIfReady() { rec.builds++; },
               fetch: () => { throw new Error("inline fallback must not fetch in worker tests"); },
               structuredClone, console, Math };
  vm.createContext(sb);
  const cell = pageSlice("const CELLTYPES = {", "const _ctColorCache");
  new vm.Script(cell + ";__ct = () => CELLTYPES;",
                { filename: "p9-page.js" }).runInContext(sb);
  // flow slices for the chip-T UX regression (P8 anchors)
  new vm.Script(pageSlice("function rebuildBrainIfReady(){", "// ---- W1 REAL pathway")
    + pageSlice("function setChip(id){", '$("chipA").onclick')
    + pageSlice('$("chipT").onclick', '$("chipR").onclick'), { filename: "p9-flow.js" }).runInContext(sb);
  return { sb, rec, FakeWorker };
}

// End-to-end: payload -> worker parse -> structuredClone -> page handler.
async function runE2E(payload) {
  const w = mkWorkerSandbox(payload);
  const p = mkPageSandbox();
  p.sb.loadCellTypes();                            // page starts the worker path
  assert.equal(p.rec.workerUrl, "celltypes_worker.js");
  // realm-safe: the request object was created inside the vm, so prototype-
  // sensitive deepEqual cannot be used across the boundary
  assert.equal(p.rec.posted.length, 1);
  assert.equal(p.rec.posted[0] && p.rec.posted[0].type, "load_celltypes");
  w.self.onmessage({ data: { type: "load_celltypes" } });
  await w.fetchMock.settle().catch(() => {});
  await drain(); await drain();
  assert.equal(w.sent.length, 1, "worker must answer exactly once");
  const { msg, workerSide } = w.sent[0];
  // real postMessage hands the page a clone; worker-side buffers are detached
  // (failure replies carry no buffers — only the success path transfers)
  if (msg.type === "celltypes") {
    assert.equal(workerSide.roots.buffer.byteLength, 0, "roots buffer must be transferred (detached worker-side)");
    assert.equal(workerSide.blob.buffer.byteLength, 0, "blob buffer must be transferred (detached worker-side)");
  }
  const cloned = structuredClone(msg);             // clone-safety of the whole message
  p.FakeWorker.instances[0].__dispatch(cloned);
  await drain();
  return { w, p, msg: cloned };
}

// ------------------------------------------------- tests
test("P9: worker parse -> page apply reproduces the legacy loader exactly (values, key order, message)", async () => {
  // oracle run: legacy transcription on the same payload
  let lpromise = null, lresolve = null;
  const lf = () => {
    if (lpromise) return lpromise;
    lpromise = new Promise((res) => {
      lresolve = () => { res({ ok: true, json: async () => PAYLOAD }); return lpromise; };
    });
    return lpromise;
  };
  lf.settle = () => lresolve ? lresolve() : lpromise;
  const lsb = { fetch: lf, msg: () => {}, console, Math };
  vm.createContext(lsb);
  new vm.Script(LEGACY_SRC, { filename: "p9-legacy.js" }).runInContext(lsb);
  await lf.settle();
  const legacy = lsb.__ct();

  const { p, msg } = await runE2E({ json: PAYLOAD });
  const page = p.sb.__ct();

  assert.equal(snapCT(page), snapCT(legacy), "page CELLTYPES must equal legacy byRoot/counts/ready");
  assert.ok(page.byRoot.has(BIG_KEY), "2^53+ root id must key like the legacy path");
  assert.deepEqual([...page.byRoot.entries()], [
    [BIG_KEY, "Kenyon cell"], ["22", "Kenyon cell"], ["33", "Optic lobe DCN"],
  ], "insertion order must be payload neuron order (UNKNOWN/missing excluded)");
  assert.deepEqual(p.rec.msgs, [MSG_LOADED_N], "success message byte-identical");
  assert.equal(page.done, true, "attempt finished");
  assert.equal(p.FakeWorker.instances[0].terminated, true, "one-shot worker terminated after reply");
  // worker message shape (spread first: vm-origin arrays are cross-realm)
  assert.equal(msg.nNeurons, 5);
  assert.equal(msg.nTypes, 2);
  assert.deepEqual([...msg.types], ["Kenyon cell", "Optic lobe DCN"]);
});

test("P9: transferables sized exactly; flag bytes + decoded keys reproducible from buffers alone", async () => {
  const { msg } = await runE2E({ json: PAYLOAD });
  const n = 5, nTypes = 2;
  assert.equal(msg.roots.byteLength, n * 8, "roots = one f64 per payload neuron");
  const nameLens = msg.types.map(t => new TextEncoder().encode(t).length);
  assert.equal(msg.blob.byteLength, 4 + nTypes * 2 + nameLens.reduce((a, b) => a + b, 0) + n,
    "blob = u32 count + per-type (u16 len + utf8) + u8 flag per neuron");
  // flag bytes: 1-based typeIdx per neuron, 0 for untyped
  const flags = msg.blob.slice(msg.blob.byteLength - n);
  assert.deepEqual([...flags], [1, 1, 2, 0, 0]);
  // decode roots independently and confirm byRoot keys are exactly the typed ones
  const dv = new DataView(msg.roots.buffer);
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(String(dv.getFloat64(i * 8, true)));
  assert.deepEqual(keys.filter(k => msg.byRoot.has(k)), [...msg.byRoot.keys()]);
});

test("P9: failure contract — worker unavailable answers once; page lands in the exact missing-file state", async () => {
  for (const payload of [{ ok: false, status: 404 }, { reject: true },
                         { ok: true, json: {} }, { ok: true, json: { neurons: [] } },
                         { ok: true, json: { neurons: [{ root_id: 1, cell_type: "UNKNOWN" }] } }]) {
    const { p } = await runE2E(payload);
    const page = p.sb.__ct();
    assert.equal(page.ready, false, "ready must stay false for " + JSON.stringify(payload).slice(0, 40));
    assert.equal(page.done, true, "attempt must finish (done) for " + JSON.stringify(payload).slice(0, 40));
    assert.equal(page.byRoot.size, 0, "palette must stay empty");
    assert.deepEqual(p.rec.msgs, [], "failure must be silent");
    assert.equal(p.rec.builds, 0, "failed palette must not rebuild the brain");
  }
});

test("P9: worker failure flows into the P8 chip-T UX — pending, then exact legacy missing message", async () => {
  const w = mkWorkerSandbox({ ok: false, status: 404 });
  const p = mkPageSandbox();
  p.sb.$("chipT").onclick();                       // chip-T click starts the load
  assert.equal(p.rec.workerUrl, "celltypes_worker.js");
  w.self.onmessage({ data: { type: "load_celltypes" } });
  await w.fetchMock.settle().catch(() => {});
  await drain(); await drain();
  p.FakeWorker.instances[0].__dispatch(structuredClone(w.sent[0].msg));
  await drain();
  p.sb.SCIMODE.chip = "T";                          // second click after failure
  p.sb.$("chipT").onclick();
  assert.deepEqual(p.rec.msgs, [MSG_PENDING, MSG_MISSING],
    "P8 UX preserved: pending hint on first click, exact legacy missing message after");
});

test("P9: idempotence with worker path — one Worker, one request, concurrent triggers safe", () => {
  const p = mkPageSandbox();
  p.sb.loadCellTypes(); p.sb.loadCellTypes(); p.sb.loadCellTypes();
  assert.equal(p.FakeWorker.instances.length, 1, "exactly one worker per page life");
  assert.equal(p.rec.posted.length, 1, "exactly one load request");
});

test("P9: worker ignores foreign messages; >255 types refuses rather than corrupting u8 indices", async () => {
  const w = mkWorkerSandbox({ json: PAYLOAD });
  w.self.onmessage({ data: { type: "something_else" } });
  w.self.onmessage(undefined);
  await drain();
  assert.equal(w.sent.length, 0, "foreign messages must be ignored");
  const many = { neurons: Array.from({ length: 300 }, (_, i) =>
    ({ root_id: i + 1, cell_type: "Type" + i })) };
  const w2 = mkWorkerSandbox({ json: many });
  w2.self.onmessage({ data: { type: "load_celltypes" } });
  await w2.fetchMock.settle();
  await drain(); await drain();
  assert.equal(w2.sent[0].msg.type, "celltypes_unavailable", ">255 types must refuse (u8 index overflow)");
});

test("P9: page structure — worker path primary, inline fallback byte-identical to the P8-tested loader", () => {
  const cell = pageSlice("const CELLTYPES = {", "const _ctColorCache");
  assert.ok(cell.includes('new Worker("celltypes_worker.js")'), "worker path must be the primary loader");
  assert.ok(cell.includes('ctWorker.onerror = () => { ctWorker = null; if (!CELLTYPES.done) ctLoadInline(); };'),
    "worker error must fall back inline (unless already done)");
  assert.ok(cell.includes("} catch (e) { ctWorker = null; }"), "worker construction failure must fall back inline");
  assert.ok(cell.includes("let _ctInlineStarted = false") && cell.includes("if (_ctInlineStarted) return;"),
    "inline fallback must be idempotent (onerror-after-sync-throw race)");
  // the inline fallback is the exact legacy loader body (P8 suite exercises it)
  const inline = cell.slice(cell.indexOf("function ctLoadInline(){"));
  for (const line of [
    'const j = await fetch("fly_brain_celltypes.json",{cache:"no-cache"}).then(r => r.ok ? r.json() : null);',
    "if (n.cell_type && n.cell_type !== \"UNKNOWN\"){",
    "CELLTYPES.byRoot.set(String(n.root_id), n.cell_type);",
    "CELLTYPES.counts[n.cell_type] = (CELLTYPES.counts[n.cell_type]||0)+1;",
    "finally { CELLTYPES.done = true; }",
  ]) assert.ok(inline.includes(line), "fallback line missing: " + line);
  // success-handler contract: ready, countOrder application, self-heal, done
  assert.ok(cell.includes("m.byRoot.size > 0"), "empty palette reply must not mark ready");
  assert.ok(cell.includes("for (const k of order) CELLTYPES.counts[k] = counts[k];"),
    "counts must be applied in worker-provided first-use order");
  assert.ok(cell.includes("SCIMODE.chip === \"T\""), "self-heal rebuild must be T-view guarded");
  assert.ok(cell.includes("CELLTYPES.done = true;"), "done must be set after the worker replies");
});

test("P9: counts object key order matches the legacy insertion order (message-order sensitive)", async () => {
  // interleaved first-use: Optic lobe DCN before Kenyon cell by neuron order
  const payload = { neurons: [
    { root_id: 1, cell_type: "Optic lobe DCN" },
    { root_id: 2, cell_type: "Kenyon cell" },
    { root_id: 3, cell_type: "Optic lobe DCN" },
  ] };
  const { msg } = await runE2E({ json: payload });
  assert.deepEqual([...Object.keys(msg.counts)], ["Optic lobe DCN", "Kenyon cell"],
    "counts keys must be in first-typed-neuron order");
  assert.deepEqual([...msg.countOrder], ["Optic lobe DCN", "Kenyon cell"]);
});
