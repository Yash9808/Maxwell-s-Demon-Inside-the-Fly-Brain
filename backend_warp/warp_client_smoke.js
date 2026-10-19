// warp_client_smoke.js — standalone smoke test for backend_warp/warp_server.py.
// Verifies: /init dimension guards, /tick compact-state contract (header,
// spikes length, W cadence every 12th), /reward, round-trip timings.
// Run: node backend_warp/warp_client_smoke.js [port]
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = parseInt(process.argv[2] || "8793", 10);
const D = path.join(__dirname, "data");
const ld = (n) => fs.readFileSync(path.join(D, n));

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? Buffer.from(body) : body;
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: p, method: "POST",
        headers: { "Content-Length": data.length } },
      (res) => {
        const cs = [];
        res.on("data", (c) => cs.push(c));
        res.on("end", () => resolve({ status: res.statusCode,
          headers: res.headers, buf: Buffer.concat(cs) }));
      });
    req.on("error", reject);
    req.end(data);
  });
}
const get = (p) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (res) => {
    const cs = [];
    res.on("data", (c) => cs.push(c));
    res.on("end", () => resolve({ status: res.statusCode,
      json: JSON.parse(Buffer.concat(cs).toString()) }));
  }).on("error", reject);
});

(async () => {
  const h0 = await get("/health");
  console.log("health:", JSON.stringify(h0.json));
  if (!h0.json.backend || h0.json.backend !== "warp_cuda")
    throw new Error("backend is not warp_cuda");
  if (!h0.json.full_state_path === false) throw new Error("full-state flag wrong");

  const meta = JSON.parse(ld("meta.json"));
  const hdr = { dataset: "fafb", N: meta.N, NE: meta.NE, WS: 0.02,
                opticLayer: -1, stimLayers: [0, 1] };
  const blobs = { _members: ld("members.i32").toString("base64"),
                  _layerOff: ld("layeroff.i32").toString("base64"),
                  _src: ld("src.i32").toString("base64"),
                  _dst: ld("dst.i32").toString("base64"),
                  _w0: ld("w0.f32").toString("base64"),
                  _sign: ld("sign.u8").toString("base64"),
                  _modS: ld("modsrc.i32").toString("base64"),
                  _modType: ld("modtype.u8").toString("base64") };
  const hb = Buffer.from(JSON.stringify(hdr));
  const bb = Buffer.from(JSON.stringify(blobs));
  const body = Buffer.concat([Buffer.alloc(4), hb, bb]);
  body.writeUInt32LE(hb.length, 0);
  const t0 = Date.now();
  const init = await post("/init", body);
  const ij = JSON.parse(init.buf.toString());
  console.log("init:", init.status, JSON.stringify(ij), `(${Date.now() - t0} ms)`);
  if (init.status !== 200 || ij.N !== meta.N || ij.NE !== meta.NE)
    throw new Error("init failed");

  // wrong-dimension guard: init with NE mismatched must 4xx, not silently load
  const badHdr = { ...hdr, NE: meta.NE + 7 };
  const hb2 = Buffer.from(JSON.stringify(badHdr));
  const badBody = Buffer.concat([Buffer.alloc(4), hb2, bb]);
  badBody.writeUInt32LE(hb2.length, 0);
  const bad = await post("/init", badBody);
  console.log("guard(mismatched NE):", bad.status,
    bad.status >= 400 ? "REJECTED (ok)" : "ACCEPTED (BUG)");

  const N = meta.N, NE = meta.NE;
  const TICKS = 60;
  const visual = Array.from({ length: 800 }, (_, i) => (i % 97) / 200);
  const s = [0.4, 0.2, 0.1, 0, 0, 0, 0];
  let wCount = 0, totRtt = 0, maxRtt = 0, spikesTotal = 0, simSum = 0;
  const tT = Date.now();
  for (let i = 0; i < TICKS; i++) {
    const r = await post("/tick", JSON.stringify({
      s, visual, motorDrive: 0.35, exAmp: 0.3, lr: 0.5, dt: 0.016 }));
    if (r.status !== 200) throw new Error("tick " + i + " -> " + r.status);
    const b = r.buf;
    const tick = b.readUInt32LE(0), n = b.readUInt32LE(4), hasW = b[8];
    const dav = b.readFloatLE(9), mrs = b.readFloatLE(13), mb = b.readFloatLE(17);
    const WPAD = (4 - (N % 4)) % 4;
    const spikesLen = b.length - 24 - WPAD - (hasW ? NE * 4 : 0);   // 21B hdr + 3 pad + W-align pad
    if (tick !== i + 1 || n !== N || spikesLen !== N) {
      throw new Error(`contract violation: tick=${tick} n=${n} spikes=${spikesLen}`);
    }
    if (!Number.isFinite(dav) || !Number.isFinite(mrs) || !Number.isFinite(mb))
      throw new Error("NaN in scalars");
    if (hasW) { wCount++; if (b.length !== 24 + N + WPAD + NE * 4)
      throw new Error("W frame length wrong"); }
    if (b.slice(24, 24 + N).some((v) => v > 1)) throw new Error("bad spike value");
    spikesTotal += b[24 + (i * 131) % N];   // sample one neuron
    const simMs = parseFloat(r.headers["x-sim-ms"]);
    simSum += simMs;
    const rtt = Date.now() - (tT + i * 0);
    totRtt += simMs; maxRtt = Math.max(maxRtt, simMs);
    if (i === 11 && !hasW) throw new Error("W cadence wrong (tick 12 must carry W)");
  }
  const wall = Date.now() - tT;
  console.log(`ticks: ${TICKS} OK in ${wall} ms  (${(wall / TICKS).toFixed(1)} ms/tick round-trip, ` +
    `${(simSum / TICKS).toFixed(2)} ms sim avg, max ${maxRtt.toFixed(2)})`);
  console.log(`W frames: ${wCount}/${TICKS} (expected ~${Math.floor(TICKS / 12)})`);

  const rw = await post("/reward", JSON.stringify({ dq: 0.8, stim: 0.6 }));
  const h1 = await get("/health");
  console.log("reward:", rw.status, "| health.tick:", h1.json.tick,
    "| ready:", h1.json.ready, "| dataset:", h1.json.dataset);
  console.log("SMOKE PASS");
  process.exit(0);
})().catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
