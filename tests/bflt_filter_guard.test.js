#!/usr/bin/env node
"use strict";
/**
 * tests/bflt_filter_guard.test.js — (user-approved plan) guard the fixes that
 * keep the FILTER dropdown showing the actual brain:
 *
 *   W1. the brain-worker watchdog must restart ONLY while the page is actively
 *       posting ticks (_bwPostedAt stamped in brainTick's post path). A silent
 *       heartbeat with no posts = suspended tab = NOT a stall. Previously any
 *       rAF suspension (backgrounded tab) restarted healthy workers → churn →
 *       episode reset → mis-framed brain → "filter shows an empty background".
 *   W2. churn cap: 3+ restarts within 60s must set the permanent in-frame
 *       fallback (_bwBroken) instead of looping restarts forever.
 *   F1. auto re-frame: the first mirrored state after boot/restart schedules
 *       brainAutoTrack() (guarded by the user-manual-camera latch), so the
 *       right viewport comes back framed over the actual brain.
 *   F2. the user-manual latch (__fltUserCam) is set by orbit/pan/zoom on the
 *       brain half, and brainAutoTrack respects it (manual framing wins).
 *   R1. Δ-baseline re-freeze: brainAutoTrack and the canvas-resize reconcile
 *       path clear hasBase for diffbase/turnover so the frozen baseline
 *       matches the new framing (no full-screen red/blue flash).
 *   S1. the brain-filter shader must compile under GLSL ES/ANGLE rules:
 *       no ternaries on sampler/int-compare operands (the three compile
 *       failures found and fixed during the filter sweep).
 *
 * Run: node --test tests/bflt_filter_guard.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");

// ------------------------------------------------------------ W1 watchdog gating
test("W1: watchdog restarts only while the page actively posts ticks", () => {
  assert.match(html, /sim\._bwPostedAt = Date\.now\(\)/,
    "brainTick must stamp _bwPostedAt on every worker post");
  const wd = html.slice(html.indexOf("s._bwWatch = setInterval"),
                         html.indexOf("s._bwWatch = setInterval") + 1400);
  assert.match(wd, /const posting = now - s\._bwPostedAt < 5000/,
    "watchdog must compute whether page-side posts are still flowing");
  assert.match(wd, /if \(!posting\) return;/,
    "watchdog must NOT restart when the tab (not the worker) went silent");
  assert.match(wd, /if \(!posting\) return;[^\n]*\n\s*console\.warn\("\[brain_worker\] silent/,
    "the restart must sit behind the posting gate");
});

// ------------------------------------------------------------ W2 churn cap
test("W2: 3+ restarts in 60s flips to the permanent in-frame fallback", () => {
  assert.match(html, /s\._bwRestarts\.push\(now\)/);
  assert.match(html, /s\._bwRestarts\.filter\(t => now - t < 60000\)/,
    "restart window must be 60 seconds");
  assert.match(html, /if \(s\._bwRestarts\.length > 3\)\{[^\n]*\n\s*s\._bwBroken = true;/,
    "churn cap must set _bwBroken (permanent loud fallback)");
});

// ------------------------------------------------------------ F1 auto re-frame
test("F1: first mirrored state schedules the guarded auto re-frame", () => {
  assert.match(html, /if \(s\._bwTicks === 1\)\{[\s\S]{0,400}?setTimeout\(\(\) => brainAutoTrack\(\), 900\)/,
    "boot/restart first state must schedule brainAutoTrack (+900ms)");
  assert.match(html, /setTimeout\(\(\) => brainAutoTrack\(\), 2400\)/,
    "a later post-lift re-frame (+2400ms) must also be scheduled");
});

// ------------------------------------------------------------ F2 manual latch
test("F2: user orbit/pan/zoom on the brain half latches manual camera control", () => {
  assert.match(html, /if \(window\.__fltUserCam === undefined\) window\.__fltUserCam = false;/);
  assert.match(html, /function brainAutoTrack\(\)\{\s*\n\s*if \(window\.__fltUserCam\) return;/,
    "brainAutoTrack must respect the manual-camera latch");
  // orbit drag on the brain half
  assert.match(html, /brainDrag = \{x:e\.clientX,y:e\.clientY\}; brainOrbit\.auto=0; window\.__fltUserCam = true;/);
  // right-button pan on the brain half
  assert.match(html, /if \(e\.clientX >= viewsplitCssX\(\)\) window\.__fltUserCam = true;/);
  // wheel zoom on the brain half
  assert.match(html, /brainOrbit\.dist=clamp\(brainOrbit\.dist\*\(1\+e\.deltaY\*0\.001\), 420, 3200\); window\.__fltUserCam = true;/);
});

// ------------------------------------------------------------ R1 Δ-baseline re-freeze
test("R1: re-frame and resize invalidate the Δ-filter baseline for re-freeze", () => {
  assert.match(html, /if \(m === "diffbase" \|\| m === "turnover"\) window\.__bflt\.hasBase = false;/,
    "both re-base sites must clear hasBase for the Δ-family filters");
  assert.match(html, /const m = window\.__bflt && window\.__bflt\.mode;/,
    "re-base must read the mode defensively (filter may be uninitialized)");
  const atAt = html.indexOf("function brainAutoTrack");
  assert.ok(atAt > 0, "brainAutoTrack must exist");
  assert.match(html.slice(atAt, atAt + 700),
    /if \(m === "diffbase" \|\| m === "turnover"\) window\.__bflt\.hasBase = false;/,
    "re-framing must invalidate the Δ baseline (re-freezes next frame)");
  const rcAt = html.indexOf("function reconcileCanvasBox");
  assert.ok(rcAt > 0, "reconcileCanvasBox must exist");
  assert.match(html.slice(rcAt, rcAt + 1400),
    /if \(m === "diffbase" \|\| m === "turnover"\) window\.__bflt\.hasBase = false;/,
    "resize must invalidate the Δ baseline (re-freezes next frame)");
});

// ------------------------------------------------------------ R2 RT-size race
// (black-half fix) with a filter active, renderDualView sizes the RTs and
// renders the brain pass into them; bfltApply must NEVER resize again — a
// second size computation (round(W*pr) - round(splitX*pr)) could disagree by
// 1px with round((W-splitX)*pr) at odd pixel ratios, and the resulting
// setSize disposed the just-rendered texture → quad sampled black storage.
test("R2: renderDualView is the only RT-size site (no post-render resize race)", () => {
  const rdv = html.slice(html.indexOf("function renderDualView"),
                         html.indexOf("// ================================================================= BRAIN FILTER dropdown"));
  assert.match(rdv, /bfltResizeRTs\(bfW, bfH\);/,
    "the filter branch must size the RTs BEFORE rendering into them");
  const apply = html.slice(html.indexOf("function bfltApply"),
                           html.indexOf("function bfltBlit"));
  assert.doesNotMatch(apply, /bfltResizeRTs/,
    "bfltApply must not resize — it runs AFTER the brain pass rendered into the RT");
  assert.match(apply, /BFLT\.rt \. BFLT\.rt\.width|BFLT\.rt \? BFLT\.rt\.width/,
    "bfltApply must derive texel size from the existing RT dimensions");
});

// ------------------------------------------------------------ S1 GLSL/ANGLE safety
test("S1: brain-filter shader avoids ANGLE-illegal ternaries", () => {
  const frag = html.slice(html.indexOf("const BFLT_FRAG = ["),
                          html.indexOf("].join(\"\\n\");"));
  assert.ok(frag.length > 500, "BFLT_FRAG must be present");
  assert.doesNotMatch(frag, /\?\s*tOn\s*:\s*tOff/,
    "sampler ternaries are illegal in GLSL ES (opaque types)");
  assert.doesNotMatch(frag, /\?\s*tPOff\s*:\s*tPOn|tPOn\s*:\s*tPOff/);
  assert.match(frag, /float on = 0\.0; if \(uMode == 7\) on = 1\.0;/,
    "the int-compare ternary must stay as the if-statement form");
  assert.match(frag, /float lit = 0\.0; if \(uAr > 0\.0\) lit = 1\.0;/);
  assert.match(frag, /outC = mix\(vec3\(0\.62\), mix\(vec3\(0\.20, 0\.62, 0\.92\), vec3\(0\.88, 0\.15, 0\.10\), on\), acc\); }/,
    "the display ternary over vec3 must stay as the mix form");
});
