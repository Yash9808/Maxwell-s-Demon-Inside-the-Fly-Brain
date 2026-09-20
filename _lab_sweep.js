"use strict";
// Full-lab sweep: drive ALL experiments (E1-E11) through the REAL worker code
// in a Node shim. Reports per-experiment: ok/error, elapsed, row count, and
// which brain-telemetry fields the rows carry (the Brain outcome contract:
// layerRates, fireVecMean, fireVecEarly, miNeural).
const fs = require("fs");
const path = require("path");
const workerSrc = fs.readFileSync("experiment_worker.js", "utf8");

const messages = [], errors = [];
const selfObj = { postMessage: (m) => { if (m.type === "error") errors.push(m); messages.push(m); } };
selfObj.self = selfObj;
class XHRShim {
  constructor() { this.status = 0; this.responseText = ""; }
  open(_m, url) { this._url = url; }
  send() {
    const p = path.join(__dirname, this._url);
    if (fs.existsSync(p)) { this.status = 200; this.responseText = fs.readFileSync(p, "utf8"); }
    else this.status = 404;
  }
}
new Function("self", "postMessage", "XMLHttpRequest", "location", "atob", "btoa", workerSrc)(
  selfObj, selfObj.postMessage, XHRShim, { origin: "http://localhost" },
  // correct order: atob decodes base64, btoa encodes binary (was swapped)
  (s) => Buffer.from(s, "base64").toString("binary"),
  (s) => Buffer.from(s, "binary").toString("base64"));

// minimal FAFB-shaped circuit (real loader shape: layers/layer_names/edges)
function miniCircuit() {
  const layers = [[], [], [], []];         // AL, MB, motor, optic
  let id = 0;
  for (let i = 0; i < 24; i++) layers[0].push(id++);
  for (let i = 0; i < 40; i++) layers[1].push(id++);
  for (let i = 0; i < 16; i++) layers[2].push(id++);
  for (let i = 0; i < 12; i++) layers[3].push(id++);
  const flat = layers.flat();
  const edges = [];
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < 300; i++) {
    const s = rnd(flat), t = rnd(flat);
    edges.push({ s, t, w: Math.random() * 2 - 1, sign: Math.random() > 0.3 ? 1 : -1 });
  }
  return { layers, layer_names: ["antennal lobe", "mushroom body", "motor", "optic lobe"], edges, n: flat.length };
}
const CIRCUIT = miniCircuit();

function run(expId, opts) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const startIdx = messages.length;
    selfObj.onmessage({ data: { type: "run", expId, circuit: CIRCUIT, opts } });
    const deadline = Date.now() + 180000;
    (function poll() {
      const done = messages.slice(startIdx).find(m => m.type === "done" && m.expId === expId);
      if (done) return resolve({ ok: true, ms: Date.now() - t0, done });
      const err = errors.find(m => m.expId === expId);
      if (err) return resolve({ ok: false, ms: Date.now() - t0, error: String(err.message).split("\n")[0] });
      if (Date.now() > deadline) return resolve({ ok: false, ms: Date.now() - t0, error: "TIMEOUT (>180s) — hang" });
      setTimeout(poll, 200);
    })();
  });
}

(async () => {
  // small-but-representative opts; E4/E5 get extra test trials for the delta windows
  const PLAN = [
    ["e1", {}], ["e2", {}], ["e3", {}], ["e4", { train: 12, test: 6 }],
    ["e6", {}], ["e7", {}], ["e8", {}],
    ["e9", { seeds: 1, train: 3, test: 3 }],
    ["e10", { seeds: 1, train: 2, test: 2 }],
    ["e11", { seeds: 1, train: 3, test: 3 }],
    ["e5", { train: 12, test: 6 }],
  ];
  const fields = (rows) => ({
    layerRates: rows.some(r => r.layerRates) ? "Y" : "-",
    fireVecMean: rows.some(r => r.fireVecMean) ? "Y" : "-",
    fireVecEarly: rows.some(r => r.fireVecEarly) ? "Y" : "-",
    miNeural: rows.some(r => Number(r.miNeural) > 0) ? "Y" : "-",
  });
  let fails = 0;
  for (const [id, opts] of PLAN) {
    process.stdout.write(id.padEnd(5));
    const r = await run(id, opts);
    if (!r.ok) { fails++; console.log("FAIL " + r.ms + "ms  " + r.error); continue; }
    const rows = r.done.rows || [];
    const f = fields(rows);
    const conds = Object.keys(r.done.summary.conditions || {}).length;
    // persist the REAL done payload for live plots-page injection checks
    fs.writeFileSync("research_data/_payload_" + id + ".json", JSON.stringify(r.done));
    console.log("ok " + String(r.ms).padStart(6) + "ms  rows " + String(rows.length).padStart(4) +
      "  conds " + conds + "  brain[ rates " + f.layerRates + "  fvMean " + f.fireVecMean +
      "  fvEarly " + f.fireVecEarly + "  mi>0 " + f.miNeural + " ]");
  }
  console.log(fails ? "\nRESULT: " + fails + " failure(s)" : "\nRESULT: all experiments complete");
  process.exit(fails ? 1 : 0);
})();
