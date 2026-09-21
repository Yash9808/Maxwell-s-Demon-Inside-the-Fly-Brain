/**
 * gen_e1_fixture.js — (re)generate the golden E1 fixture for tests/run_smoke.js S9.
 *
 * Run this ONLY when scientific behavior changed on purpose (new physics,
 * new controller, new reward). Commit the resulting fixture diff together
 * with an explanation of the intended behavior change. CI (S9) fails on any
 * UNintended divergence.
 *
 * The fixture pins the EXACT rows (all numeric fields) of the E1 classical
 * anchor run through the real experiment_worker pipeline, so any change in
 * PRNG consumption, integrator order, reward math or metric computation
 * breaks the test loudly.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "golden", "e1_fixture.json");
const OPTS = { seeds: 1, train: 3, test: 2 };   // same config as documented in run_smoke.js S9

const workerSrc = fs.readFileSync(path.join(ROOT, "experiment_worker.js"), "utf8");
const msgs = [], errs = [];
const selfObj = { postMessage: (m) => { (m.type === "error" ? errs : msgs).push(m); } };
selfObj.self = selfObj;
class XHRShim {
  constructor() { this.status = 0; this.responseText = ""; }
  open(_m, u) { this._u = u; }
  send() {
    const p = path.join(ROOT, this._u.split("?")[0]);
    if (fs.existsSync(p)) { this.status = 200; this.responseText = fs.readFileSync(p, "utf8"); }
    else this.status = 404;
  }
}
new Function("self", "postMessage", "XMLHttpRequest", "location", "atob", "btoa", workerSrc)(
  selfObj, selfObj.postMessage, XHRShim, { origin: "http://localhost" },
  (s) => Buffer.from(s, "base64").toString("binary"),
  (s) => Buffer.from(s, "binary").toString("base64"));

selfObj.onmessage({ data: { type: "run", expId: "e1", circuit: null, opts: OPTS } });
setTimeout(() => {
  const done = msgs.find(m => m.type === "done" && m.expId === "e1");
  if (!done) {
    console.error("no done message; errors:", errs);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    _comment: "golden E1 rows for tests/run_smoke.js S9 — regenerate ONLY for intended scientific changes; commit the diff with an explanation",
    opts: OPTS,
    provenanceKeys: Object.keys(done.provenance),
    rows: done.rows,
  }, null, 1));
  console.log("golden fixture written:", OUT, "(" + done.rows.length + " rows)");
}, 120000);
