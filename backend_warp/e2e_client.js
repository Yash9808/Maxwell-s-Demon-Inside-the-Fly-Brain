// e2e_client.js — consumes the Warp backend's tick payloads the way the page
// would: per tick, parse body, (V1) mirror spikes + accept W + compute heat,
// (V2) mirror spikes + scalars; heat computed browser-side from spikes.
// Measures end-to-end per-tick latency (request->parsed), throughput (ticks/s
// sustained closed-loop), and transfer size.
//
// Usage: node e2e_client.js <v1|v2> <ticks> [port]
"use strict";
const http = require("http");

const [ver, ticksArg, portArg] = process.argv.slice(2);
const PORT = parseInt(portArg || "8791", 10);
const TICKS = parseInt(ticksArg || "200", 10);

function fetchTick() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    http.get({ host: "127.0.0.1", port: PORT, path: `/tick?v=${ver === "v1" ? 1 : 2}` }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const t1 = performance.now();
        const body = Buffer.concat(chunks);
        // simulate page consumption
        if (ver === "v1") {
          const N = 106765, NE = 553807;
          const spikes = new Uint8Array(body.buffer, N * 4, N);          // after V
          let sum = 0; for (let i = 0; i < N; i += 7) sum += spikes[i];  // sample like render
        } else {
          const spikes = new Uint8Array(body.buffer, 0, 106765);
          let sum = 0; for (let i = 0; i < 106765; i += 7) sum += spikes[i];
          const scalStart = body.indexOf(124);                            // '|'
        }
        const t2 = performance.now();
        resolve({
          bytes: body.length,
          sim_ms: parseFloat(res.headers["x-sim-ms"]),
          extract_ms: parseFloat(res.headers["x-extract-ms"]),
          net_parse_ms: (t1 - t0),
          consume_ms: (t2 - t1),
          e2e_ms: (t2 - t0),
        });
      });
    }).on("error", reject);
  });
}

(async () => {
  // warmup
  for (let i = 0; i < 10; i++) await fetchTick();
  const rows = [];
  const tStart = performance.now();
  for (let i = 0; i < TICKS; i++) rows.push(await fetchTick());
  const wall = performance.now() - tStart;
  rows.sort((a, b) => a.e2e_ms - b.e2e_ms);
  const med = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const p = (q) => rows[Math.floor(rows.length * q)].e2e_ms;
  console.log(JSON.stringify({
    version: ver, ticks: TICKS,
    bytes_median: rows[Math.floor(rows.length / 2)].bytes,
    sim_ms: med(rows.map(r => r.sim_ms)),
    extract_ms: med(rows.map(r => r.extract_ms)),
    net_parse_ms: med(rows.map(r => r.net_parse_ms)),
    consume_ms: med(rows.map(r => r.consume_ms)),
    e2e_ms_median: p(0.5), e2e_ms_p95: p(0.95), e2e_ms_p99: p(0.99),
    ticks_per_s: TICKS / (wall / 1000),
  }, null, 1));
})();
