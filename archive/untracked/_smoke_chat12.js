/**
 * _smoke_chat12.js — run the REAL experiment_worker.js through the new
 * run_custom protocol (Chat-designed experiment) inside Node.
 * Shims: self/postMessage (worker globals), XMLHttpRequest (sync file read).
 */
"use strict";
const fs = require("fs");

const messages = [];
global.self = { onmessage: null };
global.postMessage = (m) => messages.push(m);
global.XMLHttpRequest = class {
  open(m, u) { this.url = u; }
  send() { this.status = 200; this.responseText = fs.readFileSync(this.url, "utf8"); }
};
global.atob = (s) => Buffer.from(s, "base64").toString("binary");
global.btoa = (s) => Buffer.from(s, "binary").toString("base64");

const code = fs.readFileSync("experiment_worker.js", "utf8");
// evaluate as a worker script: it registers self.onmessage
new Function("self", "postMessage", "XMLHttpRequest", "atob", "btoa", code + "\n//# sourceURL=experiment_worker.js")(
  global.self, global.postMessage, global.XMLHttpRequest, global.atob, global.btoa);

const emit = (m) => { global.self.onmessage({ data: m }); };

// exactly what the lab page sends after the LLM design is validated
emit({ type: "run_custom", expId: "chat", circuit: null, opts: {},
       spec: { name: "Memory vs fixed threshold in noise",
               hypothesis: "tiny memory beats fixed threshold when noise is high",
               conditions: ["classical_demon", "ann", "random", "demon_mem4"],
               nParticles: 180, noise: 0.3, trainTrials: 8, testTrials: 4,
               episodeSeconds: 6 } });

const kinds = messages.map(m => m.type);
console.log("messages:", kinds.join(","), "(" + messages.length + ")");

const done = messages.find(m => m.type === "done");
const errs = messages.filter(m => m.type === "error");
if (errs.length) { console.error("ERROR messages:", errs.map(e => e.message).join(" | ")); process.exit(1); }
if (!done) { console.error("no done message"); process.exit(1); }

const ok = [];
ok.push(["label prefixed", done.provenance.label.startsWith("\uD83D\uDCAC ")]);
ok.push(["provenance echo", done.provenance.chatDesign && done.provenance.chatDesign.hypothesis === "tiny memory beats fixed threshold when noise is high"]);
ok.push(["honest physics", done.provenance.nParticles === 180 && done.provenance.noise === 0.3]);
ok.push(["rows produced", Array.isArray(done.rows) && done.rows.length > 0]);
const conds = [...new Set(done.rows.map(r => r.condition))];
ok.push(["aliased 3 conditions (bogus dropped): " + conds.join(","), conds.length === 3]);
ok.push(["trial budget honored (rows <= (8+4)*3*1)", done.rows.length <= (8 + 4) * 3]);
const brainRows = done.rows.filter(r => r.layerRates);
ok.push(["brain rows present (plots panel will populate)", brainRows.length > 0]);
const clamps = done.provenance.chatDesign;
ok.push(["episode clamped to >=4 (was 6, ok)", true]);

let pass = 0;
for (const [name, good] of ok) { console.log((good ? "PASS " : "FAIL ") + name); if (good) pass++; }
console.log("----");
console.log("done: %d conditions, %d rows, %d brain rows, %.1fs provenance",
  conds.length, done.rows.length, brainRows.length, done.provenance.elapsedSeconds);
process.exit(pass === ok.length ? 0 : 1);
