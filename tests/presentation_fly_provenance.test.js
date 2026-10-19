#!/usr/bin/env node
"use strict";
/**
 * tests/presentation_fly_provenance.test.js — Stage 5 §17 follow-through.
 *
 * The 3D presentation fly (fly.glb via flyGroup) must visualize the REAL
 * Flybody/MuJoCo pose while a closed-loop experiment streams cl_state, and
 * the page must DISCLOSE which writer owns the avatar at any moment:
 *   "flybody"      — the cl_state stream (real MuJoCo pose, contract v1) is
 *                    the single pose writer (patch 3d22: rigid translation +
 *                    rotation only; no gait, no invented physical behavior)
 *   "presentation" — the chamber flight director / demon narrative owns it
 *                    (presentation-only storytelling, never neural/physical)
 *
 * Machine-readable disclosure: window.__flyMotionSource() / __flyMotionFacts()
 * and the CLOSED-LOOP card chip ("pose: flybody (real)" / "pose: presentation").
 *
 * Regression protection — each guard FAILS if the wiring regresses:
 *   T1  provenance defaults to "presentation" before any stream runs
 *   T2  a real cl_state tick flips provenance to "flybody" AND moves the fly
 *       to exactly the streamed MuJoCo pose (×1000, Z-up→Y-up basis change)
 *   T3  clGlbEnd() returns provenance to "presentation" and the fly to perch
 *   T4  the verdict chip mirrors the live provenance both ways
 *   T5  the experiment worker's cl_state envelope CARRIES fly_motion_source
 *       (behavioral: real worker sandbox + closed_loop_core over a fake
 *       contract-valid sidecar — proves the stamp rides the real stream)
 *   T6  no synthetic pose: streamed body_pos/body_quat pass through to the
 *       cl_state envelope byte-identically (worker never invents a pose)
 *   R1  director guard: updateFlyTurn early-returns under the drive and the
 *       director path stamps "presentation" (module text pins)
 *   R2  honest-limits pins: rigid_pose_only / no-fabricated-gait / cosmetic
 *       wing flutter stay disclosed in code and UI tooltip
 *   R3  worker onerror releases the drive (provenance cannot stick on
 *       "flybody" when no cl_state follows an error)
 *
 * Run: node --test tests/presentation_fly_provenance.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const HTML_PATH = path.join(ROOT, "fly_demon_3d.html");
const html = fs.readFileSync(HTML_PATH, "utf8");
const lines = html.split("\n");

function findLine(needle, from = 0) {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i;
  }
  throw new Error("marker not found in fly_demon_3d.html: " + needle);
}

/**
 * The module block owns the presentation fly and the CL glb drive. We eval
 * the span from the TRUEFLY declaration (no THREE import, no DOM at load)
 * through the classic-wiring export line — exactly the code the browser
 * executes, minus the DOM-dependent button handler below it.
 */
function moduleWindowCode() {
  const start = findLine("const TRUEFLY = { on:false");
  const exportLine = findLine("window.__clGlbApply = clGlbApply", start);
  // include the §17 provenance block that follows the export line
  const factsLine = findLine("window.__flyMotionFacts = () => ({", exportLine);
  let end = factsLine;
  for (let i = factsLine; i < lines.length; i++) {
    if (lines[i].trim() === "});") { end = i; break; }
  }
  assert.ok(end > factsLine, "__flyMotionFacts block must terminate");
  return { code: lines.slice(start, end + 1).join("\n"), start, end };
}

/** clChips lives in the classic CL block (below the module). */
function clChipsCode() {
  const start = findLine("function clChips(st) {");
  let depth = 0, end = -1;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end >= 0) break;
  }
  assert.ok(end > start, "clChips block must terminate");
  return lines.slice(start, end + 1).join("\n");
}

// ---- minimal THREE + stage stubs (pose math only) -------------------------
class V3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  applyQuaternion() { return this; }          // basis-change stub (QC is {} in tests)
  setScalar(s) { return this.set(s, s, s); }  // THREE.Vector3 API (trueflyLoad uses it)
}
// Minimal quaternion/base classes: clGlbApply needs set/premultiply/normalize
// (pose copy) and trueflyLoad needs Box3/Group/Euler/Quaternion/Color. The
// GLTFLoader stub succeeds ASYNCHRONOUSLY with a neutral fly (identity
// quaternion) so auto-engage completes exactly as it does in the browser
// after fly.glb finishes loading.
class Q4 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  premultiply() { return this; }          // basis change QC: {} stub passes
  normalize() { return this; }
  setFromEuler() { return this; }
  applyQuaternion() { return this; }
  multiplyScalar() { return this; }
}
class Node3 {
  constructor() {
    this.position = new V3(); this.scale = new V3(1, 1, 1);
    this.quaternion = new Q4(); this.rotation = { x: 0, y: 0, z: 0 };
    this.children = []; this.visible = true; this.name = "";
  }
  add(o) { this.children.push(o); o.parent = this; return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  traverse(fn) { fn(this); this.children.forEach((c) => c.traverse(fn)); }
}
class Group extends Node3 {}
class Obj3D extends Node3 {}
class MeshBasicMaterial { constructor(o) { Object.assign(this, o || {}); this.color = this.color || { setHex() {}, lerp() {} }; } }
class Color { constructor() {} setHex() { return this; } lerp() { return this; } }
class Box3 {
  setFromObject() { return this; }
  getCenter(v) { return v.set(0, 0, 0); }
  getSize(v) { return v.set(4000, 1000, 2000); }   // like fly.glb's ~4000u wingspan
}
class Euler { constructor() {} }
const GLTF_STUB = class {
  load(_url, onLoad) {
    setTimeout(() => {
      try { onLoad({ scene: new Group() }); }
      catch (e) { GLTF_ERRORS.push(e); }   // surfaced by the tests, never swallowed
    }, 0);
  }
};
const GLTF_ERRORS = [];
function makeFlyGroup() {
  const g = new Group();
  g.parent = {};                                   // attached to the stage
  g.position = new V3(-420, 20, 100);
  g.rotation = { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, x: 0, y: 0, z: 0 };
  g.quaternion = new Q4();
  g.userData = { wings: [] };
  return g;
}

/** One shared sandbox: the page's own code, loaded without a browser. */
function buildSandbox() {
  const win = { __clViz: { qc: {}, setVisible() {} } };   // clGlbApply reads window.__clViz.qc
  const sandbox = {
    window: win,
    document: { getElementById: () => null },
    msg: () => {},                                // toast stub
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    THREE: { Vector3: V3, Quaternion: Q4, Euler, Box3, Group, Object3D: Obj3D,
             MeshBasicMaterial, Color },
    FLY_PERCH: new V3(-420, 20, 100),             // declared above the window span
    pushLegL: {}, pushLegR: {},                    // trueflyApply's visibility filter
    GLTFLoader: GLTF_STUB,
    flyGroup: makeFlyGroup(),
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const mw = moduleWindowCode();
  vm.runInContext(mw.code, sandbox, { filename: "fly_demon_3d.html@module-span" });
  vm.runInContext(clChipsCode(), sandbox, { filename: "fly_demon_3d.html@clChips" });
  win.clChips = sandbox.clChips;   // function declarations attach to the vm global, not the window stub
  GLTF_ERRORS.length = 0;
  return { sandbox, win, flyGroup: sandbox.flyGroup, gltfErrors: GLTF_ERRORS };
}

/** Canonical real-shaped cl_state tick (matches experiment_worker.js envelope). */
function fakeClState(t) {
  return {
    kind: "closed_loop", contract_v: 1,
    episode: 0, t, seed: 11, learning: true, mode: "flybody",
    body_pos: [0.02, -0.001, 0.15],               // MuJoCo meters, Z-up
    body_quat: [0.99, 0, 0.01, 0],                // [w,x,y,z]
    action: new Array(59).fill(0.5), reward: 0.1,
    dopamine: 0.5, weight_drift: 1, motor_rate: 3,
    neural_active: 2, neural_dim: 200,
  };
}

// ---------------------------------------------------------------- T1
test("T1: provenance defaults to 'presentation' before any stream runs", () => {
  const { win } = buildSandbox();
  assert.strictEqual(typeof win.__flyMotionSource, "function",
    "window.__flyMotionSource must exist (machine-readable disclosure)");
  assert.strictEqual(win.__flyMotionSource(), "presentation");
  const facts = win.__flyMotionFacts();
  assert.strictEqual(facts.source, "presentation");
  assert.strictEqual(facts.contract_v, null);          // no stream seen yet
  assert.strictEqual(facts.rigid_pose_only, true);     // honest-limits disclosure
  assert.match(facts.gait, /none/);
  assert.match(facts.gait, /no joint angles/);
  assert.match(facts.wing_flutter, /cosmetic/);
});

// ---------------------------------------------------------------- T2
test("T2: real cl_state tick flips provenance to 'flybody' and drives the REAL pose", async () => {
  const { win, flyGroup, gltfErrors } = buildSandbox();
  win.__clGlbApply(fakeClState(3));
  await new Promise((r) => setTimeout(r, 5));     // let the GLTF loader stub fire
  win.__clGlbApply(fakeClState(3));               // ready → this tick owns the pose
  assert.deepStrictEqual(gltfErrors, [], "fly.glb stub load must not throw in the page code");
  assert.strictEqual(win.__flyMotionSource(), "flybody",
    "the streamed MuJoCo pose must be the single pose writer");
  const facts = win.__flyMotionFacts();
  assert.strictEqual(facts.source, "flybody");
  assert.strictEqual(facts.contract_v, 1);
  assert.strictEqual(facts.last_stream_t, 3);
  // patch 3d22 mapping: ×1000 (1 scene unit = 1 mm), MuJoCo Z-up → scene Y-up
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  close(flyGroup.position.x, 0.02 * 1000);
  close(flyGroup.position.y, 0.15 * 1000);
  close(flyGroup.position.z, 0.001 * 1000);   // -(-0.001)
});

// ---------------------------------------------------------------- T3
test("T3: clGlbEnd returns provenance to 'presentation' and the fly to its perch", async () => {
  const { win, flyGroup } = buildSandbox();
  win.__clGlbApply(fakeClState(5));
  await new Promise((r) => setTimeout(r, 5));
  win.__clGlbApply(fakeClState(5));
  assert.strictEqual(win.__flyMotionSource(), "flybody");
  win.__clGlbEnd();
  assert.strictEqual(win.__flyMotionSource(), "presentation",
    "after release the flight director owns the avatar again");
  assert.strictEqual(win.__flyMotionFacts().contract_v, null);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  close(flyGroup.position.x, -420);
  close(flyGroup.position.y, 20);
  close(flyGroup.position.z, 100);
});

// ---------------------------------------------------------------- T4
test("T4: the CLOSED-LOOP verdict chip mirrors the live provenance both ways", async () => {
  const { win } = buildSandbox();
  win.__clGlbApply(fakeClState(1));
  await new Promise((r) => setTimeout(r, 5));
  win.__clGlbApply(fakeClState(1));
  let chips = win.clChips(fakeClState(1));
  let pose = chips.find((c) => /^pose: /.test(c.txt));
  assert.ok(pose, "a pose-provenance chip must exist");
  assert.strictEqual(pose.txt, "pose: flybody (real)");
  assert.strictEqual(pose.cls, "ok");
  win.__clGlbEnd();
  chips = win.clChips(fakeClState(1));
  pose = chips.find((c) => /^pose: /.test(c.txt));
  assert.strictEqual(pose.txt, "pose: presentation");
  assert.strictEqual(pose.cls, "amb");
});

// Real canonical circuit: the worker builds the same connectome brain the
// page uses (empty circuits are not buildable — never a synthetic shortcut).
const CIRCUIT = JSON.parse(
  fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));

// ---------------------------------------------------------------- T5/T6
// Real worker sandbox + closed_loop_core over a contract-valid fake sidecar:
// proves fly_motion_source rides the ACTUAL cl_state stream (not synthesized
// in the page) and that poses pass through byte-identically.
const SIDECAR_BODY = { pos: [0.01, 0, 0.13], quat: [1, 0, 0, 0] };

class FakeSidecarSocket {
  constructor() { this.sent = []; }
  connect() { return Promise.resolve(this); }
  send(msg) {
    this.sent.push(msg);
    let rep;
    if (msg.type === "step") {
      rep = { type: "step_result", v: 1, episode: msg.episode, t_env: msg.t_neural,
              action: new Array(59).fill(0), obs_next: new Array(15).fill(0),
              reward: 0, mode: "mock", body: SIDECAR_BODY };
    } else if (msg.type === "hello") {
      rep = { type: "welcome", v: 1, mode: "mock" };
    } else if (msg.type === "reset") {
      rep = { type: "reset_ack", v: 1, episode: msg.episode, obs0: new Array(15).fill(0) };
    } else {
      rep = { type: "bye_ack", v: 1 };
    }
    return Promise.resolve(rep);
  }
  close() {}
}

function buildWorkerSandbox() {
  class FakeXHR {
    open(method, url) { this._url = url; }
    setRequestHeader() {}
    send() {
      const file = this._url.split("?")[0];
      this.responseText = fs.readFileSync(path.join(ROOT, file), "utf8");
      this.status = 200;
    }
  }
  const msgs = [];
  // Auto-connecting, contract-valid WebSocket stub: cl_ws.js does
  // `new WebSocket(url)` then waits for onopen; replies arrive via onmessage.
  class FakeWS {
    constructor(url) {
      this._url = url;
      setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
    }
    send(s) {
      const msg = JSON.parse(s);
      let rep;
      if (msg.type === "step") {
        rep = { type: "step_result", v: 1, episode: msg.episode, t_env: msg.t_neural,
                action: new Array(59).fill(0), obs_next: new Array(15).fill(0),
                reward: 0, mode: "mock", body: SIDECAR_BODY };
      } else if (msg.type === "hello") {
        rep = { type: "welcome", v: 1, mode: "mock" };
      } else if (msg.type === "reset") {
        rep = { type: "reset_ack", v: 1, episode: msg.episode, obs0: new Array(15).fill(0) };
      } else {
        rep = { type: "bye_ack", v: 1 };
      }
      setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify(rep) }); }, 0);
    }
    close() {}
  }
  const sandbox = {
    window: {},
    postMessage: (m) => msgs.push(m),
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWS,
    location: { href: "http://127.0.0.1/fly_demon_3d.html" },
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout,       // cl_ws.js reply guard (worker realm has these)
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(ROOT, "experiment_worker.js"), "utf8");
  vm.runInContext(code, sandbox, { filename: "experiment_worker.js" });
  return { sandbox, msgs };
}

async function until(cond, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for worker reply");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("T5: the worker's cl_state envelope carries fly_motion_source:'flybody'", async () => {
  const { sandbox, msgs } = buildWorkerSandbox();
  sandbox.runClosedLoop({ circuit: CIRCUIT, steps: 3, seed: 11, port: 8795 });
  await until(() => msgs.some((m) => m.type === "cl_done" || m.type === "error"));
  const err = msgs.find((m) => m.type === "error");
  assert.ok(!err, "worker run must not error: " + (err && err.message));
  const states = msgs.filter((m) => m.type === "cl_state").map((m) => m.state);
  assert.ok(states.length === 3, "one cl_state per step, got " + states.length);
  for (const st of states) {
    assert.strictEqual(st.fly_motion_source, "flybody");
    assert.strictEqual(st.contract_v, 1);
    // the worker echoes the sidecar's mode; the fake sidecar reports "mock"
    assert.strictEqual(st.mode, "mock");
    assert.ok(Array.isArray(st.body_quat) && st.body_quat.length === 4);
  }
});

test("T6: no synthetic pose — streamed body_pos/body_quat pass through byte-identically", async () => {
  const { sandbox, msgs } = buildWorkerSandbox();
  sandbox.runClosedLoop({ circuit: CIRCUIT, steps: 3, seed: 11, port: 8795 });
  await until(() => msgs.some((m) => m.type === "cl_done" || m.type === "error"));
  const states = msgs.filter((m) => m.type === "cl_state").map((m) => m.state);
  for (const st of states) {
    // JSON compare (deepStrictEqual trips on vm cross-realm array prototypes)
    assert.strictEqual(JSON.stringify(st.body_pos), JSON.stringify(SIDECAR_BODY.pos),
      "cl_state pose must be the sidecar's, never a page-side invention");
    assert.strictEqual(JSON.stringify(st.body_quat), JSON.stringify(SIDECAR_BODY.quat));
  }
});

// ------------------------------------------------------- narrative-guard pins
test("R1: director guard — updateFlyTurn yields to the stream; director path stamps 'presentation'", () => {
  const mw = moduleWindowCode();
  // updateFlyTurn lives ABOVE the TRUEFLY span — pin it against the whole page
  assert.match(html,
    /if \(window\.__clGlbDrive && window\.__clGlbDrive\(\)\) return;\s*\/\/ CL physics-pose drive owns the pose \(fly_motion_source: "flybody"\)/,
    "updateFlyTurn must early-return while the real stream owns the pose");
  assert.ok(mw.code.includes('CL_GLB_DRIVE.source = "presentation";'),
    "director/narrative path must stamp the presentation provenance");
  assert.match(mw.code, /CL_GLB_DRIVE\.source = "flybody";/,
    "clGlbApply must stamp the flybody provenance on stream ticks");
});

test("R2: honest-limits pins — rigid pose only, no fabricated gait, cosmetic wings, UI disclosure", () => {
  const mw = moduleWindowCode();
  assert.match(mw.code, /rigid_pose_only: true/);
  assert.match(mw.code, /gait: "none \(contract v1 streams no joint angles\)"/);
  assert.match(mw.code, /wing_flutter: "cosmetic oscillator"/);
  assert.match(mw.code, /no fabricated gait/);
  // UI tooltip discloses the provenance probe to users (element region, not the module)
  assert.match(html, /window\.__flyMotionSource\(\) returns "flybody" while the stream owns the pose/);
});

test("R3: worker onerror releases the drive — provenance cannot stick on 'flybody'", () => {
  // The classic CL block's worker error handler must end the glb drive: no
  // cl_state follows an error, so the last stream tick would otherwise leave
  // __flyMotionSource() === "flybody" while the director silently owns the fly.
  const marker = findLine("function clFeed(st, seq) {");   // classic block region
  const windowEnd = (() => {
    for (let i = marker; i < lines.length; i++) if (lines[i].includes("</script>")) return i;
    throw new Error("classic block must terminate");
  })();
  const region = lines.slice(Math.max(0, marker - 120), windowEnd).join("\n");
  assert.match(region,
    /clWorker\.onerror = \(e\) => \{[\s\S]{0,300}window\.__clGlbEnd\(\)/,
    "the worker onerror handler must call window.__clGlbEnd()");
});
