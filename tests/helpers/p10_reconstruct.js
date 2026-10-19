"use strict";
// P10 reconstruction helper (shared by tests/p10_edge_gpu.test.js): rebuilds
// the per-vertex legacy color buffer from the new per-edge color data + the
// wave phase, using the exact legacy expressions.
//
// edgeData layout (must match the GLSL texel addressing): 8 Float32 per edge
//   [ei*8 .. ei*8+3] = front RGBA texel   [ei*8+4 .. ei*8+7] = trail RGBA texel
// The vertex shader picks front or trail by the wave window
//   d = segT - wave; if (d < 0) d += 1; front = d < 0.18
//
// mode: "cable" (wave branch) or "chord" (front only, no branch).

function p10ReconstructPerVertex(edgeData, cable, wave, vertexCount, segIdx) {
  const segT = cable.segT, segOff = cable.segOff, segN = cable.segN;
  const out = new Float32Array(vertexCount * 3);
  for (let k = 0; k < segIdx.length; k++) {
    const ei = segIdx[k];
    const f = k * 8, t = k * 8 + 4;   // compact slot k -> front/trail texels
    const rF = edgeData[f], gF = edgeData[f + 1], bF = edgeData[f + 2];
    const rT = edgeData[t], gT = edgeData[t + 1], bT = edgeData[t + 2];
    for (let s = segOff[ei], e2 = segOff[ei] + segN[ei]; s < e2; s++) {
      let d = segT[s] - wave; if (d < 0) d += 1;
      const front = d < 0.18;
      const r = front ? rF : rT, g = front ? gF : gT, b = front ? bF : bT;
      const v = s * 6;
      out[v] = r; out[v + 1] = g; out[v + 2] = b;
      out[v + 3] = r; out[v + 4] = g; out[v + 5] = b;
    }
  }
  return out;
}

function p10ReconstructPerVertexChord(edgeData, chordOrder, vertexCount) {
  // chord mode: vertex pair k belongs to edge chordOrder[k]; the shader has
  // no wave branch, so every vertex samples the front texel directly.
  const out = new Float32Array(vertexCount * 3);
  for (let k = 0; k < chordOrder.length; k++) {
    const ei = chordOrder[k];
    const f = k * 8;                  // compact slot k -> front texel
    const r = edgeData[f], g = edgeData[f + 1], b = edgeData[f + 2];
    const v = k * 6;
    out[v] = r; out[v + 1] = g; out[v + 2] = b;
    out[v + 3] = r; out[v + 4] = g; out[v + 5] = b;
  }
  return out;
}

module.exports = { p10ReconstructPerVertex, p10ReconstructPerVertexChord };
