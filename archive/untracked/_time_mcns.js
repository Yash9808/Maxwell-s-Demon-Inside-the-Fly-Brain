// Time MCNS vs FAFB data phases headlessly in Node (no THREE needed).
const fs = require("fs");
const h = fs.readFileSync("fly_demon_3d.html", "utf8");

function grab(name) {
  const i = h.indexOf("const " + name + " = ");
  if (i < 0) throw new Error(name + " not found");
  const start = h.indexOf("{", i);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let p = start; p < h.length; p++) {
    const ch = h[p];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = p + 1; break; } }
  }
  return JSON.parse(h.slice(start, end));
}
const t0 = Date.now();
const FAFB = grab("FAFB");
const MCNS = grab("MCNS");
console.log("JSON parse ms:", Date.now() - t0);
const nF = FAFB.layers.reduce((a, l) => a + l.length, 0);
const nM = MCNS.layers.reduce((a, l) => a + l.length, 0);
console.log("FAFB neurons:", nF, "edges:", FAFB.edges.length);
console.log("MCNS neurons:", nM, "edges:", MCNS.edges.length);

// makeSim edge loop
function timeEdges(circ, tag) {
  const NE = circ.edges.length;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  const W = new Float32Array(NE), isExc = new Uint8Array(NE);
  const t1 = Date.now();
  circ.edges.forEach((e, i) => { src[i] = e.s; dst[i] = e.t; W[i] = e.w; isExc[i] = e.sign > 0 ? 1 : 0; });
  console.log(tag, "makeSim edges ms:", Date.now() - t1);
}
timeEdges(FAFB, "FAFB");
timeEdges(MCNS, "MCNS");

// per-neuron layer-lookup (buildBrain pattern)
function timeLookup(circ, tag) {
  const layers = circ.layers, NL = layers.length;
  const layerStart = []; let s = 0;
  for (const l of layers) { layerStart.push(s); s += l.length; }
  const t2 = Date.now();
  let li = 0;
  for (let i = 0; i < s; i++) { li = 0; while (li < NL - 1 && i >= layerStart[li + 1]) li++; }
  console.log(tag, "per-neuron layer lookup ms:", Date.now() - t2);
}
timeLookup(FAFB, "FAFB");
timeLookup(MCNS, "MCNS");

// sim-tick edge loop cost per frame (the real hang candidate)
function timeEdgeTick(circ, tag) {
  const NE = circ.edges.length;
  const src = new Int32Array(NE), dst = new Int32Array(NE);
  circ.edges.forEach((e, i) => { src[i] = e.s; dst[i] = e.t; });
  const V = new Float32Array(nF + nM), spk = new Uint8Array(nF + nM);
  for (let i = 0; i < spk.length; i++) spk[i] = Math.random() < 0.02 ? 1 : 0;
  const t3 = Date.now();
  let frames = 60;
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < NE; k++) { if (spk[src[k]]) V[dst[k]] += 0.02; }
  }
  console.log(tag, "edge tick x60 frames ms:", Date.now() - t3, "=> per frame", (Date.now() - t3) / frames);
}
timeEdgeTick(FAFB, "FAFB");
timeEdgeTick(MCNS, "MCNS");
