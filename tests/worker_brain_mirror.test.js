#!/usr/bin/env node
"use strict";
/**
 * tests/worker_brain_mirror.test.js — PHASE 3A §K follow-through.
 *
 * The WORKER connectome loop (the canonical brain inside experiment_worker.js
 * run_cl) must be visible in the page's 3D brain / LIVE CONNECTOME panel while
 * a closed-loop run streams cl_state. The bridge is the genuine
 * window.__embodimentTap state (FLYBODY_ARCHITECTURE.md §3); PHASE 3A adds its
 * FIRST pull() consumer (clBrainMirrorFrame). Honesty rules enforced here:
 *   - aggregates only: contract v1 carries no per-neuron vector, and the page
 *     invents none — the mirror renders motor_rate / neural_active /
 *     neural_dim, never synthetic spikes;
 *   - raise-only: the worker mirror can brighten a quiet shell toward the
 *     worker signal, never dim the page sim's own spike heat;
 *   - provenance: the WORKER LOOP strip appears ONLY while a real stream
 *     feeds it, inside the LIVE CONNECTOME panel, clearly labeled.
 *
 * Regression protection — each guard FAILS if the wiring regresses:
 *   T1  clFeed routes every validated cl_state through the tap bridge
 *   T2  clBrainMirrorFrame is the first (and only) pull() consumer
 *   T3  mirror renders on the rAF frame path via lcPanelFrame
 *   T4  mirror consumes the worker aggregates (motor_rate/neural_active/neural_dim)
 *   T5  aggregates only: mirror never writes per-neuron spikes
 *   T6  raise-only: the shell-tint threshold may raise heat, never lower it
 *   T7  WORKER LOOP strip is labeled, clamped, and only shown after a stream
 *   R1  honesty disclosure pinned in code (no per-neuron synthesis)
 *
 * Run: node --test tests/worker_brain_mirror.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

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
function findAll(needle) {
  const out = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) out.push(i);
  return out;
}

test("T1 clFeed routes every validated cl_state through the tap bridge", () => {
  const sink = findLine("window.__embodimentTap._sink(st);");
  const feed = findLine("function clFeed(st, seq) {");
  assert.ok(feed < sink, "clFeed must precede the _sink call");
  assert.ok(lines[sink + 1].includes("clBrainMirrorFrame();"),
    "the line after _sink must invoke the mirror (per-tick pull)");
});

test("T2 clBrainMirrorFrame is the first (and only) pull() consumer", () => {
  const tapPulls = findAll("window.__embodimentTap.pull()");
  assert.ok(tapPulls.length === 1,
    "exactly one window.__embodimentTap.pull() call site expected, found " + tapPulls.length);
  const fn = findLine("function clBrainMirrorFrame() {");
  assert.ok(tapPulls[0] > fn - 5 && tapPulls[0] < fn + 40,
    "the sole pull() must live inside clBrainMirrorFrame");
});

test("T3 mirror renders on the rAF frame path via lcPanelFrame", () => {
  const frame = findLine("function lcPanelFrame(dt){");
  const raise = findLine("if (clMirrorHeat > heat) heat = clMirrorHeat;", frame);
  assert.ok(raise > frame, "raise-only heat must be applied inside lcPanelFrame");
});

test("T4 mirror consumes the worker aggregates (motor_rate, neural_active, neural_dim)", () => {
  const fn = findLine("function clBrainMirrorFrame() {");
  const body = lines.slice(fn, fn + 40).join("\n");
  for (const field of ["motor_rate", "neural_active", "neural_dim"]) {
    assert.ok(body.includes(field), "mirror body must use cl_state field: " + field);
  }
});

test("T5 aggregates only: mirror never writes per-neuron spikes", () => {
  const fn = findLine("function clBrainMirrorFrame() {");
  const body = lines.slice(fn, fn + 40).join("\n");
  assert.ok(!body.includes("sim.spikes"), "mirror must not touch page-sim spike arrays");
  assert.ok(!body.includes("spk["), "mirror must not index per-neuron arrays");
  const disc = lines.slice(fn - 12, fn).join("\n");
  assert.ok(disc.includes("Aggregate signals only"),
    "honesty disclosure must pin aggregates-only in code");
});

test("T6 raise-only: the shell-tint threshold can raise heat, never lower it", () => {
  const raise = findLine("if (clMirrorHeat > heat) heat = clMirrorHeat;");
  assert.ok(lines[raise].trim().startsWith("if (heat < 0.045)"),
    "raise must sit inside the low-heat branch of the real tint path");
  const def = findLine("const clMirrorHeat = (brainHolder._clMirrorHeat && (window.__clMirrorSeq || 0) > 0)");
  assert.ok(def < raise, "worker heat must be defined before use");
  assert.ok(lines[def].includes("__clMirrorSeq || 0"),
    "no worker heat before any real stream tick (provenance default = page sim only)");
});

test("T7 WORKER LOOP strip is labeled, clamped, and only shown after a stream", () => {
  const gate = findLine("if ((window.__clMirrorSeq || 0) > 0) {");
  const body = lines.slice(gate, gate + 6).join("\n");
  assert.ok(body.includes('"lcL"') && body.includes('"lcR"'),
    "strip must drive the L/R motor bars");
  assert.ok(body.includes("Math.min(100,"), "bar widths must be clamped");
  const disc = lines.slice(gate - 5, gate).join("\n");
  assert.ok(disc.includes("WORKER LOOP strip") && disc.includes("DISPLAY-only"),
    "strip must be disclosed as display-only in code");
  const label = findLine('WORKER LOOP " + (t.motor_rate || 0)');
  const sub = findLine('document.getElementById("lcSub")', Math.max(0, label - 20));
  assert.ok(sub < label, "strip must live in the LIVE CONNECTOME panel sub-line");
});

test("R1 honesty disclosure: no per-neuron data transported or synthesized", () => {
  const fn = findLine("function clBrainMirrorFrame() {");
  const near = lines.slice(fn - 12, fn + 45).join("\n");
  assert.ok(near.includes("no per-neuron vector"),
    "pin: contract v1 carries no per-neuron vector");
  assert.ok(near.includes("never dim") && near.includes("raise-only"),
    "pin: additive raise-only semantics");
});

test("T8 DA bar carries the worker dopamine while streaming", () => {
  const page = findLine('lcDA").style.width = Math.min(100, sim.DA.v/3*100');
  const bar  = findLine("brainHolder._clMirrorHeat.da) || 0) * 100).toFixed(1)");
  const da   = findLine("Math.abs(t.dopamine || 0) / 3");
  assert.ok(page < bar, "worker DA override must follow the page-sim DA bar line");
  const fn = findLine("function clBrainMirrorFrame() {");
  const fnEnd = findLine("async function clStart()");
  assert.ok(da > fn && da < fnEnd, "worker DA heat must be stored inside the mirror function");
  assert.ok(lines[bar].includes("_clMirrorHeat.da"), "DA bar must read exactly the mirror-stored heat");
  assert.ok(lines[findLine('DA " + (t.dopamine || 0).toFixed(2)')].includes("toFixed(2)"),
    "WORKER LOOP strip must display the worker dopamine value");
});

test("T9 one-click demo badge labels the CL card", () => {
  const card = findLine("const clCard = cards.cl;");
  const b    = findLine("badge.className = ");
  const txt  = findLine("ONE-CLICK DEMO");
  assert.ok(card < b && b < txt, "badge must be built inside the clCard wiring");
  assert.ok(lines[txt].includes("sense"), "badge must name the demo chain");
  assert.ok(lines[findLine("No mock controllers, no synthetic data")].includes("synthetic"),
    "badge tooltip must disclose the no-synthetic-data rule");
  assert.ok(lines[findLine("clCard.insertBefore(badge, clCard.firstChild)")].includes("firstChild"),
    "badge must be inserted into the CL card");
});

test("T10 scope bridge: module render loop never references classic-scope clMirror", () => {
  const fn = findLine("function clBrainMirrorFrame() {");
  const start = findLine("async function clStart()");
  for (const i of findAll("clMirror.seq")) {
    assert.ok(i > fn - 6 && i < start,
      "clMirror.seq must only appear inside the classic mirror block (line " + (i + 1) + ")");
  }
  assert.ok(lines[findLine("window.__clMirrorSeq = clMirror.seq;")].includes("__clMirrorSeq"),
    "the scope bridge must publish the seq for the module render loop");
  assert.ok(findAll("(window.__clMirrorSeq || 0) > 0").length >= 2,
    "module-side heat + strip must gate on the bridged seq, never on clMirror");
});
