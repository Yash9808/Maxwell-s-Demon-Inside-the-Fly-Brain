#!/usr/bin/env node
"use strict";
/**
 * tests/nf_interactive_view.test.js — interactive 3D views.
 *
 * The Flybody live figure's trajectory panel (nfTraj, the "arena") and the
 * ct3d 3D brain card are manually viewable: LEFT-drag rotates (orbit), RIGHT
 * drag pans, wheel zooms (ct3d), and the browser context menu is suppressed
 * on both canvases so right-drag never opens it.
 *
 * T1  arena projection is driven by NF_VIEW (yaw/pitch/pan) — behavioral
 * T2  arena: pan shifts every projected point by exactly (panX, panY) px
 * T3  arena: left-drag orbit + right-drag pan + contextmenu suppression wired
 * T4  interactive wiring sits BELOW the sandbox-evaluated region (T9 stays bare)
 * T5  ct3d brain: left=orbit, right=pan, contextmenu suppressed, wheel zoom kept
 * T6  both views share honest defaults (reset restores the initial framing)
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
function findLine(lines, needle, from = 0) {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(needle)) return i;
  throw new Error("marker not found: " + needle);
}
const plots = read("experiment_plots.html");
const plotsLines = plots.split("\n");

// The same region T9 of nature_figure_panel.test.js evaluates bare: from the
// NF ring state to the PNG-export block. Reused here so the view math is
// exercised against the real shipped source.
function evalNfRegion() {
  const start = findLine(plotsLines, "const NF = { traj: [], obs: [], motor: [], t: []");
  const end = findLine(plotsLines, "{ const b = document.getElementById(\"dlNfPNG\")", start);
  const src = plotsLines.slice(start, end).join("\n");
  const sandbox = { document: { getElementById: () => null } };
  vm.createContext(sandbox);
  vm.runInContext(src + "\nglobalThis.__api = { NF_VIEW, nfAxes };", sandbox, { filename: "nfRegion" });
  return sandbox.__api;
}

// Minimal 2d-context recorder: nfAxes only sets styles and draws paths.
function stubCtx() {
  return new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 0 }) : () => {}) });
}

test("T1 arena projection is driven by NF_VIEW yaw/pitch/pan (behavioral)", () => {
  assert.ok(plots.includes("const NF_VIEW = { yaw: Math.PI / 6, pitch: Math.PI / 6, panX: 0, panY: 0 }"),
            "view state must exist with the documented default (old 30°-yaw framing)");
  const { NF_VIEW, nfAxes } = evalNfRegion();
  const ox = 40, oy = 46, w = 540, h = 360, S = Math.min(w, h) * 0.5;
  let g = stubCtx();
  let prj = nfAxes(g, ox, oy, w, h, 0.01);
  // centre of the box projects to the box centre at any view (prj is relative
  // to ox/oy — the caller adds those outside, matching nfDraw's ox + q[0])
  let c0 = prj(0, 0, 0.5);
  assert.ok(Math.abs(c0[0] - w / 2) < 1e-9 && Math.abs(c0[1] - h / 2) < 1e-9,
            "box centre must project to the box centre");
  // yaw = 0 (front view): +x axis lies exactly on +screen-x at floor level
  NF_VIEW.yaw = 0; NF_VIEW.pitch = Math.PI / 6; NF_VIEW.panX = 0; NF_VIEW.panY = 0;
  g = stubCtx(); prj = nfAxes(g, ox, oy, w, h, 0.01);
  const px0 = prj(0.5, 0, 0);
  assert.ok(Math.abs(px0[0] - (w / 2 + 0.5 * S)) < 1e-9, "yaw 0: +x must map to +screen-x");
  assert.ok(Math.abs(px0[1] - (h / 2 + 0.5 * Math.cos(Math.PI / 6) * S)) < 1e-9,
            "floor squash follows cos(pitch)");
  const py0 = prj(0, 0.5, 0);
  assert.ok(Math.abs(py0[0] - w / 2) < 1e-9, "yaw 0: +y recedes straight toward the viewer");
  assert.ok(Math.abs(py0[1] - (h / 2 + 0.5 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)) * S)) < 1e-9,
            "depth tilt adds sin(pitch) toward the viewer (down-screen)");
  // rotating the view by 90° must swap the x/y screen footprints
  NF_VIEW.yaw = Math.PI / 2;
  g = stubCtx(); prj = nfAxes(g, ox, oy, w, h, 0.01);
  const px90 = prj(0.5, 0, 0), py90 = prj(0, 0.5, 0);
  assert.ok(Math.abs(px90[0] - w / 2) < 1e-9, "yaw 90°: +x must map to screen depth");
  assert.ok(Math.abs(py90[0] - (w / 2 + 0.5 * S)) < 1e-9, "yaw 90°: +y must take +x's old screen spot");
});

test("T2 arena pan shifts every projected point by exactly (panX, panY) px", () => {
  const { NF_VIEW, nfAxes } = evalNfRegion();
  NF_VIEW.yaw = Math.PI / 6; NF_VIEW.pitch = Math.PI / 6; NF_VIEW.panX = 0; NF_VIEW.panY = 0;
  let prj = nfAxes(stubCtx(), 40, 46, 540, 360, 0.01);
  const a = prj(0.3, -0.2, 0.7), b = prj(-0.1, 0.4, 0.2);
  NF_VIEW.panX = 23; NF_VIEW.panY = -11;
  prj = nfAxes(stubCtx(), 40, 46, 540, 360, 0.01);
  const a2 = prj(0.3, -0.2, 0.7), b2 = prj(-0.1, 0.4, 0.2);
  assert.ok(Math.abs(a2[0] - a[0] - 23) < 1e-9 && Math.abs(a2[1] - a[1] + 11) < 1e-9, "pan must translate point A exactly");
  assert.ok(Math.abs(b2[0] - b[0] - 23) < 1e-9 && Math.abs(b2[1] - b[1] + 11) < 1e-9, "pan must translate point B exactly");
});

test("T3 arena: left-drag orbits, right-drag pans, context menu suppressed", () => {
  const wire = findLine(plotsLines, "{ const tc = document.getElementById(\"nfTraj\")");
  const btn = findLine(plotsLines, "drag = { x: e.clientX, y: e.clientY, btn: e.button }", wire);
  const pan = findLine(plotsLines, "NF_VIEW.panX += dx; NF_VIEW.panY += dy;", wire);
  const orbit = findLine(plotsLines, "NF_VIEW.yaw += dx * 0.008;", wire);
  const noMenu = findLine(plotsLines, "tc.addEventListener(\"contextmenu\", (e) => e.preventDefault())", wire);
  assert.ok(btn < pan && pan < orbit, "right-drag (btn 2) must pan, left-drag (btn 0) must orbit");
  assert.ok(plotsLines[pan - 1].includes("drag.btn === 2"), "pan must be gated on the right button");
  assert.ok(plotsLines[orbit - 1].includes("drag.btn === 0"), "orbit must be gated on the left button");
  assert.ok(noMenu > btn, "contextmenu must be suppressed on the trajectory canvas");
  assert.ok(plots.includes("pointerup", wire) || findLine(plotsLines, "tc.addEventListener(\"pointerup\"", wire) > btn,
            "drag must end on pointerup");
  const dbl = findLine(plotsLines, "tc.addEventListener(\"dblclick\"", wire);
  const reset = findLine(plotsLines, "Object.assign(NF_VIEW, { yaw: Math.PI / 6, pitch: Math.PI / 6, panX: 0, panY: 0 })", wire);
  assert.ok(dbl > btn && reset > dbl, "double-click must reset the arena to the default framing");
});

test("T3b arena orbit clamps pitch so the arena can never flip", () => {
  const wire = findLine(plotsLines, "{ const tc = document.getElementById(\"nfTraj\")");
  const orbit = findLine(plotsLines, "NF_VIEW.yaw += dx * 0.008;", wire);
  const clamp = plotsLines.slice(orbit - 2, orbit + 2).join("\n");
  assert.ok(clamp.includes("Math.min(1.45, Math.max(0.05"), "pitch must be clamped");
});

test("T4 interactive wiring sits BELOW the sandbox-evaluated region (T9 stays bare)", () => {
  const start = findLine(plotsLines, "const NF = { traj: [], obs: [], motor: [], t: []");
  const end = findLine(plotsLines, "{ const b = document.getElementById(\"dlNfPNG\")", start);
  const wire = findLine(plotsLines, "{ const tc = document.getElementById(\"nfTraj\")");
  assert.ok(wire > end, "pointer wiring must come after the PNG-export block, outside the evaluated region");
  const region = plotsLines.slice(start, end).join("\n");
  assert.ok(!region.includes("addEventListener"), "evaluated region must stay free of event wiring");
  assert.ok(region.includes("const NF_VIEW = { yaw"), "view state itself is plain math and may live in the region");
});

test("T5 ct3d brain: left=orbit, right=pan, context menu suppressed, wheel zoom kept", () => {
  const pd = findLine(plotsLines, "drag = { x: e.clientX, y: e.clientY, btn: e.button }");
  const pan = findLine(plotsLines, "const ppu = orb.dr * 2 * Math.tan(cam.fov * Math.PI / 360)", pd);
  const orbit = findLine(plotsLines, "orb.dth -= dx * 0.0055;", pd);
  const noMenu = findLine(plotsLines, "renderer.domElement.addEventListener(\"contextmenu\", (e) => e.preventDefault())", pd);
  assert.ok(plotsLines[pan - 2].includes("drag.btn === 2"), "brain pan must be gated on the right button");
  assert.ok(plotsLines[orbit - 1].includes("drag.btn === 0"), "brain orbit must be gated on the left button");
  assert.ok(noMenu > pd, "context menu must be suppressed on the brain canvas");
  assert.ok(plots.includes("orb.dr = Math.min(2500, Math.max(80, orb.dr * (1 + Math.sign(e.deltaY) * 0.12)))"),
            "wheel zoom must be unchanged");
  assert.ok(plots.includes("o.tgt.x += (o.dtx - o.tgt.x) * k"), "pan target must ride the same damping as orbit");
});

test("T6 reset restores the initial framing on both views", () => {
  const r = findLine(plotsLines, "orb.dth = 0.55; orb.dph = 1.25; orb.dr = 600; orb.dtx = 0; orb.dty = -4; orb.dtz = 7;");
  assert.ok(r > 0, "brain reset must restore orbit AND pan target");
  assert.ok(plots.includes("const NF_VIEW = { yaw: Math.PI / 6"), "arena default view stays the documented 30°-yaw framing");
});
