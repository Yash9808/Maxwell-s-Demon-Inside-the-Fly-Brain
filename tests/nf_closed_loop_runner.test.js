#!/usr/bin/env node
"use strict";
/**
 * tests/nf_closed_loop_runner.test.js — "Flybody live figure: real-loop feeder".
 *
 * The Flybody live figure (nfCard) is fed ONLY by closed-loop cl_state ticks
 * (kind:"clFigure" rebroadcast / worker cl_state). E1–E11 never emit those —
 * they run the chamber/apparatus physics in process. Root cause of the
 * "nothing appeared" report: the panel waited for a run that only the main
 * lab's CL card could start. Guards here pin the fix: the plots page can run
 * the REAL closed loop itself (sidecar ensure → worker run_cl → cl_state →
 * nfFrame), with the same honesty rules as the rest of the repo (one brain,
 * pass-through data, honest terminal/stall status).
 *
 * T1  run button + status line exist inside nfCard
 * T2  runner sends the REAL run_cl message (worker contract unchanged)
 * T3  runner ensures the sidecar via the launcher POST /api/sidecar
 * T4  runner rejects to run while the E1–E11 runner owns the worker
 * T5  cl_state routes to nfFrame; cl_done shows the causal-gates verdict
 * T6  honesty: no synthetic values in the runner path
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
function findLine(lines, needle, from = 0) {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(needle)) return i;
  throw new Error("marker not found: " + needle);
}
const plots = read("experiment_plots.html");
const plotsLines = plots.split("\n");

test("T1 the figure card carries its own run button and status line", () => {
  const card = findLine(plotsLines, 'id="nfCard"');
  const btn = findLine(plotsLines, 'id="btnRunCLHere"');
  const st = findLine(plotsLines, 'id="nfRunStatus"');
  assert.ok(btn > card && st > card && st - card < 16,
            "run button + status must live inside the nfCard block");
});

test("T2 runner posts the REAL worker run_cl message (contract unchanged)", () => {
  const i = findLine(plotsLines, 'type: "run_cl"');
  const line = plotsLines[i];
  assert.ok(line.includes("circuit") && line.includes("steps: 240") &&
            line.includes("seed: 11") && line.includes("port"),
            "run_cl message must carry circuit/steps/seed/port exactly like the lab page");
});

test("T3 runner ensures the sidecar through the launcher (POST /api/sidecar)", () => {
  const i = findLine(plotsLines, 'fetch("/api/sidecar"');
  const j = findLine(plotsLines, 'async function clhStart');
  assert.ok(i < j, "sidecar ensure must exist before the start handler");
});

test("T4 runner refuses to steal the worker while E1–E11 runs", () => {
  const i = findLine(plotsLines, "RUNNER.worker || RUNNER.active");
  const j = findLine(plotsLines, "async function clhStart");
  assert.ok(i > j && i - j < 6, "busy-guard must be the first check inside clhStart");
});

test("T5 cl_state feeds nfFrame; cl_done reports the causal gates verdict", () => {
  const i = findLine(plotsLines, 'if (m.type === "cl_state") { nfFrame(m.state); return; }');
  const j = findLine(plotsLines, 'if (m.type === "cl_done")');
  assert.ok(j > i, "cl_done must be handled right after cl_state in the runner");
  assert.ok(plots.includes("causal gates"), "verdict text must name the causal gates");
  assert.ok(plots.includes('if (st && st.kind === "cl_done") { nfDone(st.gates, st.steps); return; }'),
            "nfFrame must route the cl_done pseudo-frame to the honest terminal status");
});

test("T6 honesty: the runner path synthesizes nothing", () => {
  const a = findLine(plotsLines, "// ======== plots-page closed-loop runner");
  const b = findLine(plotsLines, 'const ws = new BroadcastChannel("fly-demon-experiments");');
  const src = plotsLines.slice(a, b).join("\n");
  assert.ok(!/\bMath\.random\b/.test(src), "no RNG anywhere in the runner");
  assert.ok(!/\bmock\b/i.test(src), "no mock in the runner (mode is stamped by the sidecar)");
});
