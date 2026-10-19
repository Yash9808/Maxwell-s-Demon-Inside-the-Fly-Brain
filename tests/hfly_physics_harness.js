// Headless physics harness for the Human–Fly Interaction experiment.
//
// Extracts the real `(function hflyExperiment(){...})` IIFE from the module
// block of fly_demon_3d.html and runs it in a VM sandbox with stubbed DOM /
// THREE. The harness itself plays the HUMAN (scripted pursuit hands driven
// through the same camera-mapping channel as the real tracker, incl. a
// two-handed pincer phase), while the fly's threat detection, 13-route escape
// scoring and integration are the production physics — nothing about the fly
// is scripted here. Also asserts the experiment-only staging: demon chamber
// hidden, LIVE CONNECTOME panel hidden, live brain docked beside the arena,
// camera framing both.
//
// Run:  node tests/hfly_physics_harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'fly_demon_3d.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ---- extract the module block (robust to line-number drift) -----------------
const mStart = html.indexOf('<script type="module">');
const mEnd = html.indexOf('</script>', mStart);
if (mStart < 0 || mEnd < 0) { console.error('FAIL: module block not found'); process.exit(2); }
const mod = html.slice(mStart, mEnd).replace(/^import[^\n]*$/mg, '');

// ---- extract the hflyExperiment IIFE ----------------------------------------
const iifeStart = mod.indexOf('(function hflyExperiment()');
const iifeEnd = mod.indexOf('// ============================================================ EXPERIMENT v2');
if (iifeStart < 0 || iifeEnd < 0 || iifeEnd <= iifeStart) {
  console.error('FAIL: hflyExperiment IIFE markers not found');
  process.exit(2);
}
const src = mod.slice(iifeStart, iifeEnd);

// ---- stubs -------------------------------------------------------------------
function fakeCtx() {
  return { font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '',
    fillRect() {}, strokeRect() {}, clearRect() {}, fillText() {}, strokeText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
    drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {}, createLinearGradient: () => ({ addColorStop() {} }) };
}
function fakeEl(id) {
  const el = {
    id: id || '', style: {}, dataset: {}, children: [], value: '1.4',
    textContent: '', innerHTML: '', disabled: false, _listeners: {},
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    remove() {}, click() {}, focus() {}, select() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600 }; },
    getContext() { return fakeCtx(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  el.width = 512; el.height = 64;
  return el;
}
// auto-proxy THREE: chainable, callable, constructible; numeric coercion → 0
const threeTarget = function threeStub() {};
const THREE = new Proxy(threeTarget, {
  get(t, p) {
    if (p === 'length') return () => 1;
    if (p === Symbol.toPrimitive) return () => 0;
    return THREE;
  },
  apply() { return THREE; },
  construct() { return THREE; },
  set(t, p, v) { return true; },
});

// ---- sandbox -------------------------------------------------------------------
const msgs = [];
let blobCapture = null;
const els = {};
const getEl = (id) => {
  if (!els[id]) els[id] = fakeEl(id);
  return els[id];
};
const worldCalls = [];
const cameraTargets = [];
const fakeBrain = {
  parent: { add() {}, remove() {} },
  position: { x: 0, y: 60, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; },
              copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; },
              clone() { const s = this; return { x: s.x, y: s.y, z: s.z, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; } }; } },
  rotation: {},
};
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  document: {
    createElement: (tag) => fakeEl('<' + tag + '>'),
    getElementById: getEl,
    querySelector: () => null,          // .hfly-tag recreated each frame
    querySelectorAll: () => [],
    body: fakeEl('body'),
    addEventListener() {},
  },
  addEventListener() {},
  URL: { createObjectURL(b) { blobCapture = b; return 'blob:harness'; } },
  Blob: class Blob { constructor(parts) { this._parts = parts; } },
  requestAnimationFrame: () => 0,
};
sandbox.window = sandbox;
sandbox.THREE = THREE;
sandbox.__appScene = {
  scene: { add() {} },
  orbit: { yaw: 0.4, pitch: 0.6, dist: 1100, auto: 1 },
  cameraTarget: { set(...a) { cameraTargets.push(a); }, copy() {},
                  clone() { return { x: 0, y: 520, z: 0, copy() {} }; } },
  setWorldVisible(v) { worldCalls.push(v); },
  // (dual viewport) start() hands the right viewport to the docked brain
  brainTrackCalls: { n: 0 },
  brainCameraTrack() { this.brainTrackCalls.n++; },
  get guests() { return { brainGroup: fakeBrain }; },
};
sandbox.__humanInput = {
  on: true, x: 0.5, y: 0.5,
  hands: [ { x: 0.5, y: 0.5, on: false, fist: false },
           { x: 0.5, y: 0.5, on: false, fist: false } ],
};
sandbox.__labMsg = (t) => msgs.push(String(t));
vm.createContext(sandbox);

// ---- run the real experiment code ---------------------------------------------
let runErr = null;
try { vm.runInContext(src, sandbox, { filename: 'hflyExperiment.js' }); }
catch (e) { runErr = e; }
if (runErr) { console.error('FAIL: IIFE threw on load:', runErr.stack); process.exit(2); }

const HF = sandbox.__hfly;
const frame = sandbox.__hflyFrame;
if (!HF || typeof frame !== 'function') { console.error('FAIL: __hfly/__hflyFrame missing'); process.exit(2); }

// ---- camera↔arena mapping (inverse of updateHand's mapping) -------------------
const AW = 980, AH = 460, AD = 620;
const toCam = (x, y) => ({
  x: Math.min(1, Math.max(0, 0.5 - x / (AW * 0.9))),
  y: Math.min(1, Math.max(0, 0.72 - y / (AH * 1.15))),
});
const setHand = (k, x, y, on) => {
  const c = on ? toCam(x, y) : { x: 0.5, y: 0.5 };
  sandbox.__humanInput.hands[k].x = c.x;
  sandbox.__humanInput.hands[k].y = c.y;
  sandbox.__humanInput.hands[k].on = !!on;
};

// ---- scripted HUMAN ------------------------------------------------------------
// A naturalistic human: hands rest at the sides; when the fly (drawn in by
// its curiosity about the human) comes within reach, the hands SWIPE at it
// fast; when it escapes out of reach, they return to rest. Hand 1 joins the
// swatting from t>6 s. Nothing about the fly is scripted — it must come close
// on its own (the lure force in the physics) for interaction to happen.
const hand0 = { x: -340, y: 120 }, hand1 = { x: -260, y: 120 };
const seek = (p, tx, ty, speed, dt) => {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1e-6;
  const s = Math.min(d, speed * dt);
  p.x += dx / d * s; p.y += dy / d * s;
};
const REACH = 260;                                   // how far the human can strike
const humanStep = (dt, tNow) => {
  const f = HF.fly;
  const near = Math.hypot(f.x - HFbodyProbe(), f.y - 120) < REACH;
  const swipe = (p, k, on) => {
    if (on && near) seek(p, f.x, f.y, 720, dt);      // fast swipe at the fly
    else { const hx = k === 0 ? -340 : -260; seek(p, hx, 120, 420, dt); }  // rest
  };
  swipe(hand0, 0, true);
  swipe(hand1, 1, tNow > 6);
  setHand(0, hand0.x, hand0.y, true);
  setHand(1, hand1.x, hand1.y, tNow > 6);
};
// the body centre follows the same clamp the physics uses (humanX ± 150)
function HFbodyProbe(){
  const cx = 0.5 - hand0.x / (AW * 0.9);             // inverse mapping, hand0 x
  return Math.max(ARENA_HX - 150, Math.min(ARENA_HX + 150, cx));
}
const ARENA_HX = -340;

// ---- run -------------------------------------------------------------------------
sandbox.__hflyBtnClick = () => {
  const btn = els.hflyBtn;
  if (btn && btn._listeners.click) btn._listeners.click.forEach((f) => f());
};
sandbox.__hflyBtnClick();          // start() → staging + trial reset
const DT = 1 / 60;
let maxThreat = 0, escapeFrames = 0, outOfBounds = 0, pincerFrames = 0, maxThreatSingle = 0, brainDockX = 0;
const perFrame = [];
const FRAMES = 60 * 22;
for (let i = 0; i < FRAMES; i++) {
  const nowT = i * 1000 * DT;
  humanStep(DT, nowT / 1000);
  frame(DT, nowT);
  const f = HF.fly;
  maxThreat = Math.max(maxThreat, f.threat);
  if (f.escape) escapeFrames++;
  const twoOn = HF.hands[0].active && HF.hands[1].active;
  if (twoOn){ pincerFrames++; if (i < 60 * 11.4) maxThreatSingle = Math.max(maxThreatSingle, f.threat); }
  const m = 14;
  if (f.x < -AW / 2 + 1 || f.x > AW / 2 - 1 || f.y < -AH / 2 + 1 || f.y > AH / 2 - 1 || f.z < -AD / 2 + 1 || f.z > AD / 2 - 1) outOfBounds++;
  if (i === 300) brainDockX = fakeBrain.position.x;   // sampled mid-run
  if (i % 60 === 0) {
    const row = HF.trial.rows.length ? HF.trial.rows[HF.trial.rows.length - 1] : null;
    if (row) perFrame.push('t=' + row.t.toFixed(1) + ' dist=' + row.dist + ' threat=' + row.threat +
      ' esc=' + (row.escape || '-') + ' hands=[' + row.hand.map((h) => (h.active ? 'on' : '·')).join(',') + ']' +
      ' fly=(' + row.fly.x + ',' + row.fly.y + ') ' + row.region);
  }
}
// stop via the real button wiring (undocks + auto-downloads the trial dataset)
blobCapture = null;
sandbox.__hflyBtnClick();

// ---- report -------------------------------------------------------------------------
console.log('--- per-frame trace (every 1 s) ---');
perFrame.forEach((l) => console.log(l));
console.log('--- summary ---');
console.log('mode:', HF.mode, '| maxThreat:', maxThreat.toFixed(3), '| escapeFrames:', escapeFrames,
  '| escapes:', HF.trial.escapes, '| hitAttempts:', HF.trial.hitAttempts, '| swats:', HF.trial.swats);
console.log('pincerFrames:', pincerFrames, '| minDist:', HF.trial.minDist < 1e8 ? HF.trial.minDist.toFixed(1) : '—',
  '| rows:', HF.trial.rows.length, '| events:', HF.trial.events.map((e) => e.kind + (e.hand !== undefined ? ':h' + e.hand : '')).join(','));
console.log('staging: setWorldVisible calls [' + worldCalls.join(',') + '] | lcPanel display after stop: ' +
  (els.lcPanel.style.display || '(restored)') +
  ' | camTarget(last): [' + cameraTargets[cameraTargets.length - 1].map((v) => Math.round(v)).join(', ') + ']' +
  ' | orbit saved+restored(yaw,dist): ' + sandbox.__appScene.orbit.yaw + ', ' + sandbox.__appScene.orbit.dist +
  ' | brain docked at x=' + Math.round(brainDockX) + ' → home x=' + Math.round(fakeBrain.position.x));
console.log('out-of-bounds frames:', outOfBounds, '| msgs:', msgs.length);

// ---- acceptance ------------------------------------------------------------------------
const kinds = new Set(HF.trial.events.map((e) => e.kind));
const fails = [];
if (maxThreat < 0.3) fails.push('peak threat ' + maxThreat.toFixed(2) + ' < 0.3');
if (escapeFrames < 60) fails.push('escape frames ' + escapeFrames + ' < 60');
if (HF.trial.escapes < 1) fails.push('no escape episodes');
if (!kinds.has('escape_start')) fails.push('no escape_start event');
if (HF.trial.hitAttempts < 1) fails.push('no hit_attempt event');
const minRows = Math.floor(FRAMES * DT * (1000 / 66) * 0.8);   // rows sample at 66 ms
void minRows;
if (HF.trial.rows.length < minRows) fails.push('rows ' + HF.trial.rows.length + ' < ' + minRows);
if (outOfBounds > 0) fails.push('fly left the arena in ' + outOfBounds + ' frames');
// two-hand: pincer phase ran and was recorded; rows carry per-hand arrays
if (pincerFrames < 100) fails.push('pincer phase only ' + pincerFrames + ' frames');
const rows2 = HF.trial.rows.filter((r) => Array.isArray(r.hand) && r.hand.length === 2 && r.hand[1].active);
if (rows2.length < 20) fails.push('two-hand rows ' + rows2.length + ' < 20');
if (!HF.trial.events.some((e) => e.kind === 'hit_attempt' && e.hand === 1)) fails.push('no hit_attempt from hand 1');
// staging: chamber hidden then restored, connectome hidden then restored, brain docked
if (!worldCalls.length || worldCalls[0] !== false) fails.push('start did not hide the demon chamber (setWorldVisible(false))');
if (worldCalls[worldCalls.length - 1] !== true) fails.push('stop did not restore the demon chamber');
if (els.lcPanel.style.display !== '' ) fails.push('stop did not restore the LIVE CONNECTOME panel');
if (!cameraTargets.length) fails.push('start never set a camera target');
else {
  // (updated for dual viewport) the LEFT camera frames the arena center; the
  // RIGHT viewport is handed to the docked brain via S.brainCameraTrack —
  // asserted separately below.
  const t = cameraTargets[cameraTargets.length - 1];
  if (!(Math.abs(t[0]) < 1e-6 && Math.abs(t[1] - 900) < 1e-6 && Math.abs(t[2] + 420) < 1e-6))
    fails.push('left camera does not frame the arena center (target=' + t.join(',') + ')');
}
if (!(sandbox.__appScene.brainTrackCalls.n > 0)) fails.push('start did not hand the right viewport to the docked brain (brainCameraTrack)');
if (!(brainDockX > 500)) fails.push('live brain not docked beside the arena during the run (x=' + brainDockX + ')');
if (Math.abs(fakeBrain.position.x) > 1e-6) fails.push('brain not restored home after stop (x=' + fakeBrain.position.x + ')');
if (!blobCapture) fails.push('stop() did not download trial data');
else {
  const json = JSON.parse(blobCapture._parts[0]);
  if (json.kind !== 'hfly_interaction_trial') fails.push('bad dataset kind');
  if (!json.summary || !json.summary.frames) fails.push('dataset summary frames missing');
  if (!json.rows || !json.rows.length) fails.push('dataset rows missing');
  if (!json.events || !json.events.length) fails.push('dataset events missing');
  if (!Array.isArray(json.rows[0].hand)) fails.push('dataset rows do not carry per-hand arrays');
  console.log('dataset ok: frames=' + json.summary.frames + ' dur=' + json.summary.durationS + 's' +
    ' hits=' + json.summary.hitAttempts + ' escapes=' + json.summary.escapes +
    ' minDist=' + json.summary.minDist + ' source=' + json.source);
}
if (fails.length) { console.error('FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('ALL PHYSICS CHECKS PASSED');
