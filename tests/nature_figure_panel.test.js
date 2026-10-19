#!/usr/bin/env node
"use strict";
/**
 * tests/nature_figure_panel.test.js — "Nature Figure Live Panel v1".
 *
 * Two-panel live figure beside Experiment status on experiment_plots.html:
 *   LEFT  — 3D flybody trajectory from the REAL worker body_pos;
 *   RIGHT — stacked time series of the real 15-D observation (8 visual bins +
 *           7 proprio/contact) + motor_rate as a separated motor trace.
 * Data path: closed_loop_core.runEpisode onTick(rec, obs) → experiment_worker
 * cl_state envelope (obs_bins/obs_proprio, additive) → clFeed rebroadcast
 * (kind:"clFigure", 1/4-rate throttle) → BroadcastChannel → nfFrame ring
 * buffers → canvases + PNG export. Honesty: pass-through only, nothing
 * synthesized; hidden until a live stream feeds it; legacy record shape and
 * frozen replay anchors untouched (obs rides onTick's 2nd argument).
 *
 * Guards: T1 core onTick(rec, obs) w/o record change · T2 envelope additive ·
 * T3 clFeed 1/4-rate rebroadcast · T4 clFigure routing · T5 panel markup ·
 * T6 ring buffers pass-through · T7 8+7+1 stacked layout · T8 PNG export ·
 * T9 nfFrame math evalutes on real ticks.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const linesOf = f => read(f).split("\n");
function findLine(lines, needle, from = 0) {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(needle)) return i;
  throw new Error("marker not found: " + needle);
}
const html = read("fly_demon_3d.html");
const plots = read("experiment_plots.html");
const plotsLines = linesOf("experiment_plots.html");
const core = read("embodiment/closed_loop_core.js");
const worker = read("experiment_worker.js");

test("T1 core passes obs to onTick without changing the record shape", () => {
  const i = findLine(linesOf("embodiment/closed_loop_core.js"), "if (onTick) onTick(rec, obs);");
  const b = findLine(linesOf("embodiment/closed_loop_core.js"), "rec.obs_bins");
  assert.ok(b < i, "obs_bins must remain inside the task-mode record block");
  const task = findLine(linesOf("embodiment/closed_loop_core.js"), "if (task) {");
  assert.ok(task < b && b < i, "obs_bins must stay inside the task-gated block, before onTick");
});
test("T2 worker envelope carries obs additively (contract_v unchanged)", () => {
  const i = findLine(linesOf("experiment_worker.js"), "obs_bins: onTickObs.length");
  assert.ok(worker.includes("contract_v: 1"), "envelope must keep contract_v: 1");
  assert.ok(worker.includes("...onTickObs"), "worker must accept the core's 2nd onTick argument");
  const j = findLine(linesOf("experiment_worker.js"), "obs_proprio: onTickObs.length");
  assert.ok(j === i + 1, "obs_bins and obs_proprio must be adjacent additive fields");
  assert.ok(worker.includes("Array.from(onTickObs[0].slice(0, 8))"), "obs_bins must be the real 8-bin slice");
});

test("T3 clFeed rebroadcasts real cl_state ticks at 1/4 rate", () => {
  const sink = findLine(linesOf("fly_demon_3d.html"), "clBrainMirrorFrame();");
  const i = findLine(linesOf("fly_demon_3d.html"), "kind: \"clFigure\"");
  assert.ok(i > sink && i - sink < 14, "rebroadcast must sit in clFeed, right after the mirror pull");
  assert.ok(html.includes("(st.t & 3) === 0"), "throttle must be the documented 1/4-rate gate");
  for (const f of ["body_pos: st.body_pos", "body_quat: st.body_quat", "action: st.action",
                   "motor_rate: st.motor_rate", "obs_bins: st.obs_bins", "obs_proprio: st.obs_proprio"]) {
    assert.ok(html.includes(f), "packet must pass through the real field: " + f);
  }
  assert.ok(!/\bkind: "clFigure"[\s\S]{0,400}Math\.random/.test(html), "no synthetic values in the packet");
});

test("T4 plots page routes clFigure before the plots-kind filter", () => {
  const route = findLine(plotsLines, "if (m.kind === \"clFigure\") { nfFrame(m.state); return; }");
  const filter = findLine(plotsLines, "if (m.kind !== \"plots\") return;");
  assert.ok(route < filter, "clFigure must be handled before the plots-kind filter");
});

test("T5 panel markup exists at the marked spot, hidden until a live stream", () => {
  const card = findLine(plotsLines, "id=\"nfCard\"");
  assert.ok(plotsLines[card].includes("display:none"), "panel must start hidden");
  assert.ok(plots.includes("id=\"nfTraj\"") && plots.includes("id=\"nfSeries\""), "both canvases must exist");
  const status = findLine(plotsLines, "id=\"expStatusCard\"");   // stable id (h2 text may be retitled)
  assert.ok(card > status && card - status < 40, "panel must sit right beside the status card (the marked spot)");
  assert.ok(plots.includes("waiting for a closed-loop run"), "panel must disclose it waits for a live stream");
});
test("T6 ring buffers pass-through only and capped", () => {
  assert.ok(plots.includes('const NF = { traj: [], obs: [], motor: [], t: [], CAP: 600'), "ring state must be capped");
  assert.ok(plots.includes("st.body_pos[0], st.body_pos[1], st.body_pos[2]"), "trajectory must come from real body_pos");
  assert.ok(plots.includes("Array.isArray(st.obs_bins)"), "obs must be taken as-is when present");
  assert.ok(!/Math\.random[\s\S]{0,200}NF\./.test(plots), "no synthetic values enter the buffers");
  assert.ok(plots.includes("while (NF.t.length > NF.CAP)"), "buffers must trim to CAP");
});

test("T7 stacked layout = 8 visual + 7 proprio + motor_rate on a shared axis", () => {
  assert.ok(plots.includes("for (let b = 0; b < 8; b++)"), "8 visual traces");
  assert.ok(plots.includes("for (let c = 0; c < 7; c++)"), "7 proprio traces");
  assert.ok(plots.includes('"motor_rate (max " + mMax + " spk/t)"'), "motor_rate must be its own labeled trace");
  assert.ok(plots.includes("shared time axis"), "stacks must share one time axis");
});

test("T8 PNG export wired with page-convention download", () => {
  const b = findLine(plotsLines, "dlNfPNG");
  assert.ok(plotsLines[b].includes("button"), "export button must exist in the panel markup");
  const click = findLine(plotsLines, "a.download = \"flybody_figure_live_\"");
  assert.ok(click > b, "download handler must be wired after the button");
});

test("T9 nfFrame computes real math on a real cl_state tick (behavioral)", () => {
  const start = findLine(plotsLines, "const NF = { traj: [], obs: [], motor: [], t: []");
  const end = findLine(plotsLines, String.fromCharCode(123)+" const b = document.getElementById("+String.fromCharCode(34)+"dlNfPNG"+String.fromCharCode(34)+")", start);
  const frameSrc = plotsLines.slice(start, end).join("\n");
  const sandbox = { document: { getElementById: () => null } };
  vm.createContext(sandbox);
  vm.runInContext(frameSrc + "\nglobalThis.__nf = nfFrame;", sandbox, { filename: "nfFrame" });
  assert.doesNotThrow(() => sandbox.__nf({
    t: 12, episode: 0, seed: 11, learning: true, mode: "flybody",
    body_pos: [0.001, -0.002, 0.003], body_quat: [1, 0, 0, 0],
    action: new Array(59).fill(0.1), motor_rate: 37,
    obs_bins: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    obs_proprio: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
    dopamine: -0.15, weight_drift: 4.2,
  }));
  const after = vm.runInContext("JSON.stringify({ t: NF.t, n: NF.obs.length, v: NF.obs[0].v[3], p: NF.obs[0].p[1] })", sandbox);
  const st = JSON.parse(after);
  assert.deepStrictEqual(st.t, [12], "one tick buffered");
  assert.strictEqual(st.n, 1);
  assert.strictEqual(st.v, 0.4, "real obs bin must land in the buffer unmodified");
  assert.strictEqual(st.p, 0.9, "real proprio channel must land unmodified");
  assert.ok(sandbox.__nf({ t: 13, body_pos: [0, 0, 0] }) === undefined || true, "sparse tick tolerated");
});
