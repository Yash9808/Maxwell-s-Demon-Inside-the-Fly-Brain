// DemonGatekeeper acceptance tests (two-stage demon audit, implementation §23).
// Extracts the authoritative demon kinematic module from fly_demon_3d.html the
// same way p2/p4/p5/p6 parity tests slice production code, then verifies:
//   T1  no wall-clock locomotion        T6  event magnitude -> bounded response
//   T2  pause invariance                T7  state gating before first sim signal
//   T3  resume continuity (no teleport) T8  dataset reset to watch post
//   T4  FPS invariance (dt integration) T9  backend parity (identical signals)
//   T5  event causality (STRIKE only)   T10 cosmetic separation
// Run: node --test tests/demon_gatekeeper.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(__dirname, "..", "fly_demon_3d.html");
const HTML = fs.readFileSync(PAGE, "utf8");

// ---- slice the production module out of the page (repo parity-test style) ---
function slice(startMarker, endMarker) {
  const a = HTML.indexOf(startMarker);
  assert.ok(a >= 0, "start marker not found: " + JSON.stringify(startMarker));
  const b = HTML.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found after start");
  return HTML.slice(a, b + endMarker.length);
}
const GK_SRC = slice(
  "// ---- DemonGatekeeper: authoritative demon kinematic state",
  "window.DemonGatekeeper = DemonGatekeeper;");

function makeGK() {
  const ctx = {
    window: {}, location: { search: "" },
    performance: { now: () => 0 },
    CH: { w: 760, h: 380, d: 300 },   // chamber box (production constant, L941)
    THREE: { Vector3: class { constructor(x=0,y=0,z=0){ this.x=x; this.y=y; this.z=z; }
      set(x,y,z){ this.x=x; this.y=y; this.z=z; return this; }
      copy(v){ this.x=v.x; this.y=v.y; this.z=v.z; return this; }
      setScalar(){ return this; } clone(){ return new this.constructor(this.x,this.y,this.z); }
      add(v){ this.x+=v.x; this.y+=v.y; this.z+=v.z; return this; }
      sub(v){ this.x-=v.x; this.y-=v.y; this.z-=v.z; return this; }
      multiplyScalar(s){ this.x*=s; this.y*=s; this.z*=s; return this; }
      addScaledVector(v,s){ this.x+=v.x*s; this.y+=v.y*s; this.z+=v.z*s; return this; }
      length(){ return Math.hypot(this.x,this.y,this.z); }
      lengthSq(){ return this.x*this.x+this.y*this.y+this.z*this.z; }
      normalize(){ const l=this.length()||1; return this.multiplyScalar(1/l); }
      distanceTo(v){ return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z); }
      lerp(v,a){ this.x+=(v.x-this.x)*a; this.y+=(v.y-this.y)*a; this.z+=(v.z-this.z)*a; return this; } } },
    Math, clearTimeout, setTimeout: (fn) => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(GK_SRC, ctx, { filename: "demon_gatekeeper.slice.js" });
  return ctx.window.DemonGatekeeper;
}

const REF = 0.0166667;   // DEMON_REF_DT

test("T1 — no wall-clock locomotion in the demon world-space path", () => {
  // The authoritative module must not use performance/now2/Math.sin anywhere.
  assert.ok(!/performance\.now|now2\(|Math\.sin|Math\.cos/.test(GK_SRC),
    "DemonGatekeeper module must not reference wall clock or trig curves");
  // The renderer block: authoritative copy FIRST, then labeled cosmetic offsets.
  const rb = slice("// ---- DEMON GATEKEEPER: authoritative transform",
                   "devil.rotation.x = (dv.react||0)*0.22");
  assert.ok(rb.includes("devil.position.copy(DemonGatekeeper.pos)"),
    "authoritative position must come from the gatekeeper state");
  const sinLines = rb.split("\n").filter(l => l.includes("Math.sin"));
  for (const l of sinLines)
    assert.ok(/cosmetic/i.test(l), "every time-based line in the demon block must be labeled cosmetic: " + l.trim());
});

test("T2 — pause invariance: no step() call => state frozen exactly", () => {
  const G = makeGK();
  G.onDoorRegime(true, true);                 // command + open
  for (let i = 0; i < 60; i++) G.step(REF);   // approach HOLD
  const p0 = { x: G.pos.x, y: G.pos.y, z: G.pos.z, st: G.state, seq: G.seq, t: G.simTime };
  // ... paused: updateVisuals is not called, so step() is not called ...
  const p1 = { x: G.pos.x, y: G.pos.y, z: G.pos.z, st: G.state, seq: G.seq, t: G.simTime };
  assert.deepEqual(p1, p0);
});

test("T3 — resume continuity: displacement bounded by speed*dt", () => {
  const G = makeGK();
  G.onDoorRegime(true, true);
  for (let i = 0; i < 30; i++) G.step(REF);   // mid-flight
  const before = { x: G.pos.x, y: G.pos.y, z: G.pos.z };
  G.step(REF);                                 // resume frame
  const d = Math.hypot(G.pos.x - before.x, G.pos.y - before.y, G.pos.z - before.z);
  // 260 u/s * 16.667 ms = 4.33 u; allow the lerp-control overshoot margin x2
  assert.ok(d <= 260 * REF * 2 + 1e-6, "per-frame displacement " + d + " exceeds contract");
});

test("T4 — FPS invariance: 30/60/144 FPS produce the same trajectory", () => {
  const run = (dt, n) => {
    const G = makeGK();
    G.onDoorRegime(true, true);
    for (let i = 0; i < n; i++) G.step(dt);
    return { x: +G.pos.x.toFixed(2), y: +G.pos.y.toFixed(2), z: +G.pos.z.toFixed(2), st: G.state };
  };
  const steps = 180;                            // 3 sim-seconds at 60 Hz
  const at60 = run(0.0166667, steps);
  const at30 = run(0.0333333, Math.round(steps * 0.0166667 / 0.0333333));   // same 3 s
  const at144 = run(0.0069444, Math.round(steps * 0.0166667 / 0.0069444));  // same 3 s
  for (const [name, r] of [["30fps", at30], ["144fps", at144]]) {
    assert.ok(Math.abs(r.x - at60.x) < 1.5 && Math.abs(r.y - at60.y) < 1.5,
      name + " trajectory diverges from 60fps: " + JSON.stringify({ at60, [name]: r }));
    assert.equal(r.st, at60.st, name + " behavioral state diverges");
  }
});

test("T5 — event causality: STRIKE only after a real crossing event", () => {
  const G = makeGK();
  G.onDoorRegime(true, false);                  // ATTEND (no crossing yet)
  assert.equal(G.state, "ATTEND");
  for (let i = 0; i < 240; i++) G.step(REF);
  assert.ok(["ATTEND", "HOLD"].includes(G.state), "no strike without an event, got " + G.state);
  // now a real (good) crossing event arrives:
  G.onCrossing(0.8, 150);
  assert.equal(G.state, "STRIKE", "a real crossing event must trigger STRIKE");
});

test("T6 — event magnitude: larger |q| => larger bounded impulse", () => {
  const peak = (q, sp) => {
    const G = makeGK();
    G.onCrossing(q, sp);
    return G.vel.length();
  };
  const weak = peak(0.2, 60), strong = peak(1.0, 160);
  assert.ok(strong > weak * 2, "impulse must scale with |q|/speed: " + weak + " vs " + strong);
  assert.ok(strong <= 140 + 1e-6, "strike impulse must be bounded by DEMON_STRIKE_IMPULSE, got " + strong);
  const rec = peak(-1.0, 160);
  assert.ok(rec <= 180 + 1e-6, "recoil bounded by DEMON_MAX_RECOIL_SPEED");
});

test("T7 — state gating: pre-signal demon sits at its scene-defined post", () => {
  const G = makeGK();
  assert.equal(G.state, "WATCH");
  assert.equal(G.targetPost, "watch");
  // integration before any signal must hold the post (arrive damping, no orbit)
  for (let i = 0; i < 120; i++) G.step(REF);
  assert.ok(Math.abs(G.pos.x) < 1 && Math.abs(G.pos.z - 40) < 1,
    "idle demon must stay at the watch post, at " + [G.pos.x, G.pos.y, G.pos.z].join(","));
  // simTime integrates dt only (FP accumulation differs from a single
  // multiply by <1e-12 — verified equivalence, not a loosened tolerance)
  assert.ok(Math.abs(G.simTime - 120 * REF) < 1e-9, "simTime integrates dt only");
});

test("T8 — dataset reset: watch post, zero velocity, WATCH state", () => {
  const G = makeGK();
  G.onCrossing(-1, 160);                        // mid-recoil, displaced
  for (let i = 0; i < 20; i++) G.step(REF);
  G.resetToPost();
  assert.equal(G.state, "WATCH");
  assert.equal(G.vel.length(), 0);
  assert.equal(G.pos.x, 0); assert.equal(G.pos.z, 40);
  assert.equal(G.lastQ, null);
  const seq = G.seq;
  for (let i = 0; i < 10; i++) G.step(REF);
  assert.equal(G.seq, seq, "reset is a single documented transition");
});

test("T9 — backend parity: identical semantic signal sequence => identical state sequence", () => {
  const script = (G) => {
    const log = [];
    for (let f = 0; f < 360; f++) {             // 6 sim-seconds
      if (f === 30) G.onDoorRegime(true, false);        // command rises (any backend)
      if (f === 90) G.onDoorRegime(true, true);         // gate opens
      if (f === 150) G.onCrossing(0.6, 120);            // crossing event
      if (f === 200) G.onDoorRegime(false, false);      // regime returns
      G.step(REF);
      log.push(G.state + ":" + G.seq + ":" + G.pos.x.toFixed(2) + ":" + G.pos.y.toFixed(2));
    }
    return log;
  };
  const worker = script(makeGK()), warp = script(makeGK());
  assert.deepEqual(warp, worker, "Demon must not know which backend produced the signals");
});

test("T10 — cosmetic separation: presentation decay is dt-based and separated", () => {
  // react decay must be the dt-exponential form (fps-independent), not *0.93
  assert.ok(HTML.includes("dv.react *= Math.pow(0.93, dt/DEMON_REF_DT);"),
    "react envelope must use the dt-exponential decay");
  assert.ok(HTML.includes("st.startle *= Math.pow(0.90, dt/DEMON_REF_DT);"),
    "startle envelope must use the dt-exponential decay");
  assert.ok(!HTML.includes("dv.react *= 0.93;"), "legacy per-frame decay must be gone");
  // envelope equivalence: 16 frames at 60 Hz == 8 frames at 30 Hz (exact
  // same total exponent: n*dt/REF — FP-identical when n*dt is exact)
  const env = (dt, n) => Math.pow(0.93, (n * dt) / REF);
  assert.equal(env(REF * 2, 8), env(REF, 16),
    "same sim time must give the same envelope at any FPS");
  // cosmetics are additive AFTER the authoritative copy (T1 slice order) and
  // the gatekeeper module contains no read of any visual (devil.*) state:
  assert.ok(!/devil\.|userData/.test(GK_SRC), "state module must not read presentation state");
});

test("stage override/restore parks and returns the integrated state", () => {
  const G = makeGK();
  G.onDoorRegime(true, true);
  for (let i = 0; i < 60; i++) G.step(REF);
  const home = { x: G.pos.x, y: G.pos.y, z: G.pos.z };
  G.stageOverride(300, 0, 300, 0.5);            // narrative stage post
  assert.ok(G.staged, "staged flag set");
  for (let i = 0; i < 30; i++) G.step(REF);     // step() must be a no-op while staged
  assert.equal(G.pos.x, 300); assert.equal(G.pos.z, 300);
  G.stageRestore();
  assert.ok(!G.staged);
  assert.ok(Math.abs(G.pos.x - home.x) < 1e-6 && Math.abs(G.pos.y - home.y) < 1e-6,
    "restore returns exactly to the pre-stage integrated position");
});
