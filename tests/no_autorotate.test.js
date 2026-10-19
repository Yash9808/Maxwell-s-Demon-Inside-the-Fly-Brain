#!/usr/bin/env node
"use strict";
/**
 * tests/no_autorotate.test.js — (user request) NO automatic rotation anywhere.
 *
 * The interactive lab shows two separate 3D boxes — the fly/experiment region
 * and the fly-brain region — in one shared orbit-camera view. Nothing may
 * rotate on its own:
 *   1. the camera must never idle-spin (orbit.auto pinned to 0; the frame
 *      loop's spin line is guarded and unreachable at auto=0);
 *   2. exiting ANY staged run (interaction experiment, E-session, apparatus
 *      stage) must never re-arm the idle spin — all three restore paths pin
 *      auto to 0;
 *   3. the brain must never self-rotate — neither the main brain group
 *      (was `rotation.y = Math.sin(now2()*0.12)*0.35`) nor the docked
 *      guest-stage brain (was `Math.sin(t*0.22)*0.35`);
 *   4. manual control stays: pointer drag = orbit, wheel = zoom, brain drag,
 *      lab-split drag (those code paths must remain intact).
 *
 * Run: node --test tests/no_autorotate.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");

// ------------------------------------------------------------ camera spin
test("CAM1: orbit camera auto-spin is pinned to 0 at construction", () => {
  assert.doesNotMatch(html, /auto:\s*0\.0\d+/,
    "orbit must not be constructed with an idle auto-spin");
  assert.match(html, /const orbit = \{ yaw:0, pitch:0\.42, dist:1400, auto:0 \}/);
});

test("CAM2: the frame-loop spin is guarded (unreachable at auto=0)", () => {
  // the yaw integration must be behind the auto guard, not unconditional
  assert.match(html, /if \(orbit\.auto\) orbit\.yaw \+= orbit\.auto\*dt;/,
    "frame loop must only integrate yaw when orbit.auto is non-zero");
  assert.doesNotMatch(html, /^\s*orbit\.yaw \+= orbit\.auto\*dt;/m,
    "unconditional per-frame yaw spin must not return");
});

test("CAM3: exiting a staged run never re-arms the idle spin", () => {
  // 1) interaction-experiment stop (camSave restore)
  assert.match(html, /S\.orbit\.dist = camSave\.dist; S\.orbit\.auto = 0;/);
  // 2) E-session stop (__EBS.saved restore)
  assert.match(html, /S\.orbit\.dist = __EBS\.saved\.dist; S\.orbit\.auto = 0;/);
  // 3) apparatus-stage stop (__camSave restore)
  assert.match(html, /__A\(\)\.orbit\.auto = 0;/);
  // none of the three restore paths may read the saved auto value back
  assert.doesNotMatch(html, /orbit\.auto = camSave\.auto/);
  assert.doesNotMatch(html, /orbit\.auto = __EBS\.saved\.auto/);
  assert.doesNotMatch(html, /orbit\.auto = __camSave\.auto/);
});

// ------------------------------------------------------------ brain sway
test("BRAIN1: main brain group never self-rotates (sine sway removed)", () => {
  assert.doesNotMatch(html, /brainHolder\.group\.rotation\.y\s*=\s*Math\.sin\(/,
    "the updateVisuals brain sway (rotation.y = sin(...)*0.35) must stay removed");
});

test("BRAIN2: docked guest-stage brain never self-rotates", () => {
  // the idle block may keep the hover bob on position.y but must not touch
  // brainGroup.rotation.y with a time function
  const region = html.slice(html.indexOf("function appGuestsIdle"),
                            html.indexOf("function appGuestsIdle") + 5000);
  assert.ok(region.length > 0, "appGuestsIdle must exist");
  assert.doesNotMatch(region, /brainGroup\.rotation\.y\s*=\s*Math\.sin\(/,
    "guest-stage brain sway must stay removed");
  assert.match(region, /brainGroup\.position\.y = G\.brainBase\.y \+ Math\.sin\(t\*0\.8\)\*10;/,
    "the (non-rotating) hover bob stays");
});

// ---------------------------------------------------------- manual control
test("MANUAL: drag-orbit, zoom, brain-drag and lab-split remain wired", () => {
  assert.match(html, /orbit\.yaw -= \(e\.clientX-drag\.x\)\*0\.005;/,
    "pointer drag must still orbit the camera manually");
  assert.match(html, /renderer\.domElement\.addEventListener\("wheel"/,
    "wheel zoom stays");
  // (auto-frame) the pointerdown handler grew by the user-approved manual-camera
  // latch lines; the spin-cancel statement is unchanged, just further in.
  assert.match(html, /addEventListener\("pointerdown"[\s\S]{0,1600}orbit\.auto=0/,
    "grabbing the camera still cancels any residual spin");
  assert.match(html, /function brainDragStart/,
    "brain drag (move the brain region by hand) stays");
  assert.match(html, /function splitDragStart/,
    "lab-split drag (move the region divider by hand) stays");
});
