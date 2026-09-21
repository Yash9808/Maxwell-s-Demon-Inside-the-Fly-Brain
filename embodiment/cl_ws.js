/**
 * embodiment/cl_ws.js — worker-safe WebSocket JSON-lines client for the
 * embodiment sidecar (`python embodiment/sidecar.py --ws --port 8795`).
 *
 * The closed loop is strictly sequential: one request in flight, resolved
 * with the next JSON reply. Used by the experiment worker's `run_cl` mode
 * (the browser↔body gate) — the page itself never talks to the sidecar, it
 * only renders the worker's cl_state stream (no second brain anywhere).
 */
"use strict";

class CLWebSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this._waiters = [];
    this._buffer = [];
  }

  /** Resolve when the socket is open (reject on error). */
  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); }
      catch (e) { reject(e); return; }
      ws.onopen = () => { this.ws = ws; resolve(this); };
      ws.onerror = () => reject(new Error("WebSocket error: " + this.url));
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }   // fail closed
        const w = this._waiters.shift();
        if (w) w(msg); else this._buffer.push(msg);
      };
    });
  }

  /** Send one JSON request; resolve with the next JSON reply (30 s guard). */
  send(msg) {
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("sidecar reply timeout")), 30000);
      this._waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
  }

  close() { try { if (this.ws) this.ws.close(); } catch (e) { /* already */ } }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CLWebSocket };
}
