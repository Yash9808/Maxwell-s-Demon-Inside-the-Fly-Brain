"use strict";
// Generate a REAL E9 done payload (through the actual worker code) and save
// it as JSON so the plots page can be tested end-to-end in isolation.
const fs = require("fs");
const path = require("path");
const workerSrc = fs.readFileSync("experiment_worker.js", "utf8");
const msgs = [], errs = [];
const selfObj = { postMessage: (m) => { if (m.type === "error") errs.push(m); msgs.push(m); } };
selfObj.self = selfObj;
class XHRShim {
  constructor() { this.status = 0; this.responseText = ""; }
  open(_m, u) { this._u = u; }
  send() {
    const p = path.join(__dirname, this._u);
    if (fs.existsSync(p)) { this.status = 200; this.responseText = fs.readFileSync(p, "utf8"); }
    else this.status = 404;
  }
}
new Function("self", "postMessage", "XMLHttpRequest", "location", "atob", "btoa", workerSrc)(
  selfObj, selfObj.postMessage, XHRShim, { origin: "http://localhost" },
  // correct order: atob decodes base64, btoa encodes binary (was swapped,
  // which corrupted every fireVec in the test payload)
  (s) => Buffer.from(s, "base64").toString("binary"),
  (s) => Buffer.from(s, "binary").toString("base64"));

// mini FAFB-shaped circuit (the plots pipeline works with any circuit size)
const layers = [[], [], [], []];
let id = 0;
for (let i = 0; i < 24; i++) layers[0].push(id++);
for (let i = 0; i < 40; i++) layers[1].push(id++);
for (let i = 0; i < 16; i++) layers[2].push(id++);
for (let i = 0; i < 12; i++) layers[3].push(id++);
const flat = layers.flat();
const edges = [];
for (let i = 0; i < 300; i++) {
  const s = flat[Math.floor(Math.random() * flat.length)], t = flat[Math.floor(Math.random() * flat.length)];
  edges.push({ s, t, w: Math.random() * 2 - 1, sign: Math.random() > 0.3 ? 1 : -1 });
}
const circuit = { layers, layer_names: ["antennal lobe", "mushroom body", "motor", "optic lobe"], edges, n: flat.length };

selfObj.onmessage({ data: { type: "run", expId: "e9", circuit, opts: { seeds: 1, train: 3, test: 3 } } });
setTimeout(() => {
  const done = msgs.find(m => m.type === "done" && m.expId === "e9");
  if (!done) { console.error("no done; errors:", errs); process.exit(1); }
  const payload = { kind: "plots", type: "done", expId: "e9",
                    label: "E9 · Pressure Demon",
                    summary: done.summary, rows: done.rows, provenance: done.provenance };
  fs.writeFileSync("research_data/_e9_payload_test.json", JSON.stringify(payload));
  console.log("payload written: rows", done.rows.length,
              "fvMean rows", done.rows.filter(r => r.fireVecMean).length,
              "fvEarly rows", done.rows.filter(r => r.fireVecEarly).length);
}, 60000);
