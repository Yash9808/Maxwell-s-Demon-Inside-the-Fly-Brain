"use strict";
/**
 * tests/watch_pacing.test.js — watch-speed pacing invariance + re-anchor.
 *
 * The watch pacing (opts.pace, worker apparatus branch) must stretch ONLY
 * wall time: same steps, same RNG draws, same rows. Each variant restarts
 * sim-time at 0, so the pace clock must RE-ANCHOR at every variant boundary
 * (the paceAnchor fix) — otherwise variant 2+ would flash past after the
 * first variant played at watch speed (the bug this test pins).
 *
 * Runs the REAL experiment_worker.js in a node sandbox twice — unpaced vs
 * paced — on a small E10 configuration (no circuit → 2 physics variants ×
 * 2 trials × 16 s = 64 streamed sim-seconds) and asserts:
 *   1. done rows are byte-identical paced vs unpaced (science unchanged),
 *   2. paced wall ≈ streamed sim-seconds / pace across BOTH variants
 *      (a broken re-anchor halves the wall: variant 2 would not be held),
 *   3. the paced stream is variant-major and covers each variant's full
 *      sim-time span from t≈0 to the last trial.
 *
 * Run: node --test tests/watch_pacing.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Synchronous same-origin fetch shim: importAs() only needs status+text.
// (importAs appends a ?v= cache-buster — strip it before hitting the disk.)
class FakeXHR {
  open(method, url) { this._url = url; }
  setRequestHeader() {}
  send() {
    this.responseText = fs.readFileSync(path.join(ROOT, this._url.split("?")[0]), "utf8");
    this.status = 200;
  }
}

// Evaluate the worker script exactly like the browser would: it sets
// self.onmessage at top level and reports via postMessage.
function evalWorker() {
  const msgs = [];
  globalThis.postMessage = (m) => msgs.push(m);
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.self = globalThis;                 // worker assigns self.onmessage
  const src = fs.readFileSync(path.join(ROOT, "experiment_worker.js"), "utf8");
  new Function(src)();                          // eslint-disable-line no-new-func
  return {
    send: (msg) => { msgs.length = 0; globalThis.onmessage({ data: msg }); return msgs; },
  };
}

// Small production-faithful E10 message: 1 seed, 1 train + 1 test episode
// (t spans [0, 32) per variant), WITH the real connectome like the page —
// so the variant set is the full four (light/heavy/neural/frozen).
const CIRCUIT = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));
const E10_MSG = (pace) => ({
  type: "run", expId: "e10", circuit: CIRCUIT,
  opts: Object.assign({ seeds: 1, train: 1, test: 1, episode: 16 },
                      pace ? { pace } : {}),
});

test("watch pacing: rows identical + every variant re-anchors the pace clock",
  { timeout: 120000 }, () => {
    const wUn = evalWorker();
    const tUn = Date.now();
    const un = wUn.send(E10_MSG(0));
    const unWallMs = Date.now() - tUn;
    const doneUn = un.filter(m => m.type === "done");
    assert.strictEqual(doneUn.length, 1, "unpaced run completes" +
      (doneUn.length ? "" : ": " + JSON.stringify(un[0] && un[0].message || un.slice(0, 2))));

    const PACE = 3;                       // 64 sim-s / 3 ≈ 21.3 s wall target
    const wP = evalWorker();
    const tP = Date.now();
    const p = wP.send(E10_MSG(PACE));
    const pWallS = (Date.now() - tP) / 1000;
    const doneP = p.filter(m => m.type === "done");
    assert.strictEqual(doneP.length, 1, "paced run completes" +
      (doneP.length ? "" : ": " + JSON.stringify(p[0] && p[0].message || p.slice(0, 2))));

    // 1) science unchanged: byte-identical trial rows
    assert.strictEqual(JSON.stringify(doneP[0].rows), JSON.stringify(doneUn[0].rows),
      "paced rows must be byte-identical to unpaced rows");

    const SIM_S = 64;                     // 4 variants × 16 s streamed span
    // 2) re-anchor proof: if variant 2 were not paced, wall ≈ 32/pace ≈ 10.7 s
    assert.ok(pWallS > 0.8 * SIM_S / PACE,
      `paced wall ${pWallS.toFixed(1)}s must approach ${SIM_S}/${PACE}s ` +
      "(both variants held at watch speed)");
    assert.ok(pWallS < 2.5 * SIM_S / PACE,
      `paced wall ${pWallS.toFixed(1)}s must not wildly exceed the pace target`);
    assert.ok(unWallMs < 15000, `unpaced run stays fast (took ${unWallMs}ms)`);

    // 3) stream shape: variant-major, full span, t restarts per variant
    const app = p.filter(m => m.type === "app_state").map(m => m.state);
    assert.ok(app.length > 100, `paced stream carries frames (${app.length})`);
    const conds = [...new Set(app.map(s => s.cond))];
    assert.deepStrictEqual(conds,
      ["trapdoor_light", "trapdoor_heavy", "trapdoor_neural", "trapdoor_frozen"],
      "stream plays variant-major with every variant paced in order");
    for (const c of conds) {
      const ts = app.filter(s => s.cond === c).map(s => s.t);
      assert.ok(ts[0] < 1, `${c}: stream restarts at t≈0 (got ${ts[0].toFixed(2)})`);
      // each trial restarts the sim clock (t drops to ≈0); within a trial
      // the streamed t must be monotone sim-seconds reaching the episode end
      let trials = 1;
      for (let i = 1; i < ts.length; i++) {
        if (ts[i] < ts[i - 1] - 1) { trials++; assert.ok(ts[i] < 1, `${c}: trial restarts at t≈0`); }
        else assert.ok(ts[i] >= ts[i - 1], `${c}: t monotone within a trial`);
      }
      assert.strictEqual(trials, 2, `${c}: both trials streamed at watch speed`);
      assert.ok(ts[ts.length - 1] > 15,
        `${c}: last trial reaches the full episode (t=${ts[ts.length - 1].toFixed(1)})`);
    }
  });
