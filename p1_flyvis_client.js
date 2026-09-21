/**
 * p1_flyvis_client.js — Stage F: browser/node client for the flyvis sidecar.
 *
 * Pipeline role (see P1_FLYVIS_BRIDGE.md):
 *   physical visual field -> p1_stimuli (THIS module's suite, JSON) -> sidecar
 *   /predict -> flyvis optic response (per-type rates) -> parity comparison
 *
 * The client is deliberately thin: it owns the stimulus definitions and the
 * HTTP boundary, and NOTHING else. If the sidecar is down or flyvis is not
 * installed (503), responses degrade to { available: false, reason } — the
 * parity harness then runs in browser-model-only mode and says so.
 */
"use strict";

const http = require("http");

const SIDECAR_DEFAULT = { host: "127.0.0.1", port: 8767 };

/** Standardized P1 stimulus suite (parity test). Mirrors flyvis_sidecar.py
 *  STIMULUS_SUITE exactly; expanded frames must match frame-for-frame. */
const STIMULI = {
  flash: { type: "full_field", profile: "step", amplitude: 1.0, on_ticks: 40, off_ticks: 40 },
  moving_edge_lr: { type: "edge", direction: 1, columns: 8, ticks_per_column: 6, amplitude: 1.0 },
  moving_edge_rl: { type: "edge", direction: -1, columns: 8, ticks_per_column: 6, amplitude: 1.0 },
  stationary_contrast: { type: "full_field", profile: "sin", freq_hz: 1.0, amplitude: 0.5, ticks: 80 },
};
const TICK_MS = 16.7;

/** Expand a named stimulus into per-tick frames [0..1]^C — same contract as
 *  the Python side; the parity test asserts both expansions agree. */
function expandStimulus(name) {
  const spec = STIMULI[name];
  if (!spec) throw new Error("unknown stimulus: " + name);
  const frames = [];
  if (spec.type === "full_field") {
    if (spec.profile === "step") {
      for (let t = 0; t < spec.on_ticks; t++) frames.push([spec.amplitude]);
      for (let t = 0; t < spec.off_ticks; t++) frames.push([0.0]);
    } else {
      for (let t = 0; t < spec.ticks; t++) {
        const ph = 2 * Math.PI * spec.freq_hz * (t * TICK_MS / 1000);
        frames.push([spec.amplitude * 0.5 * (1 + Math.sin(ph))]);
      }
    }
  } else {
    const C = spec.columns;
    for (let t = 0; t < C * spec.ticks_per_column; t++) {
      const col = ((t / spec.ticks_per_column) | 0) % C;
      const c = spec.direction > 0 ? col : C - 1 - col;
      const f = new Array(C).fill(0);
      f[c] = spec.amplitude;
      frames.push(f);
    }
  }
  return frames;
}

function post(host, port, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      host, port, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: timeoutMs || 15000,
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (e) { return reject(new Error("bad JSON from sidecar")); }
        resolve({ status: res.statusCode, json: j });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("sidecar timeout")));
    req.end(data);
  });
}

function get(host, port, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method: "GET", timeout: timeoutMs || 8000 },
      (res) => {
        let buf = "";
        res.on("data", c => buf += c);
        res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
                              catch (e) { reject(new Error("bad JSON from sidecar")); } });
      });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("sidecar timeout")));
    req.end();
  });
}

async function health(opts) {
  const { host, port } = Object.assign({}, SIDECAR_DEFAULT, opts);
  try {
    const r = await get(host, port, "/health");
    return { available: true, ...r.json };
  } catch (e) {
    return { available: false, reason: "sidecar unreachable: " + e.message };
  }
}

/** Request a flyvis response for a stimulus name. Never throws on
 *  unavailability — returns { available:false, ... } instead.
 *  opts.timeoutMs: first call includes the one-time pretrained-model load
 *  (~15-40 s) plus inference (~4 s per 80-frame stimulus on CPU); allow
 *  generously (default 240 s). */
async function predict(name, opts) {
  const merged = Object.assign({}, SIDECAR_DEFAULT, opts);
  const { host, port } = merged;
  const frames = expandStimulus(name);
  const r = await post(host, port, "/predict", { stimulus: name, frames, tick_ms: TICK_MS },
                       merged.timeoutMs || 240000);
  if (r.status === 503) return { available: false, reason: r.json.error, flyvis: r.json.flyvis };
  if (r.status !== 200) {
    return { available: false, reason: "sidecar status " + r.status
      + (r.json && r.json.error ? ": " + r.json.error : "") };
  }
  return { available: true, name, frames, response: r.json };
}

module.exports = { STIMULI, TICK_MS, expandStimulus, health, predict };
