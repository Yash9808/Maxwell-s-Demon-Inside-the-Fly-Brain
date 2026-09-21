#!/usr/bin/env node
// embodiment/embodiment_client.js — Node/browser client for the embodiment
// sidecar (FLYBODY_PROTOCOL.md). Two roles:
//
//   1. Driver library: EmbodimentClient speaks the JSON-lines protocol over
//      stdio (spawning sidecar.py) — batch/CI safe. WebSocket mode is a thin
//      TODO-free extension point for the interactive browser panel (Stage 5);
//      the browser can also talk to the sidecar directly.
//   2. Regression harness: `node embodiment/embodiment_client.js --test`
//      runs the protocol-level causal assertions headless (no browser needed).
//
// The existing Node benchmark (experiment_worker.js / experiment_core.js) is
// NOT modified; this client is an additional consumer of the same repo.
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const PY = process.env.PYTHON_EMBODIMENT || 'python';
const SIDECAR = path.join(__dirname, 'sidecar.py');

/** Minimal JSON-lines client for one sidecar process. */
class EmbodimentClient {
  constructor({ body = 'auto', logDir } = {}) {
    this.args = ['--body', body];
    if (logDir) this.args.push('--log-dir', logDir);
    this.child = null;
    this.rl = null;
    this.waiters = [];
    this.buffer = [];
    this.seq = 0;
  }

  start() {
    this.child = spawn(PY, [SIDECAR, ...this.args], { cwd: path.join(__dirname, '..') });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const w = this.waiters.shift();
      if (w) w.resolve(msg); else this.buffer.push(msg);
    });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr || '') + d; });
    return this;
  }

  send(msg) {
    msg = Object.assign({ seq: ++this.seq }, msg);
    this.child.stdin.write(JSON.stringify(msg) + '\n');
    return this._recv();
  }

  _recv() {
    if (this.buffer.length) return Promise.resolve(this.buffer.shift());
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      // generous timeout: a hung sidecar should fail the test, not hang CI
      setTimeout(() => reject(new Error('sidecar reply timeout')), 30000);
    });
  }

  async stop() {
    try { await this.send({ type: 'bye' }); } catch { /* already closed */ }
    try { this.child.kill(); } catch { /* */ }
  }
}

// --------------------------------------------------------------------------- //
/** Structured neural drive vector (protocol-level stand-in for the live tap). */
function burstVector(k = 412) {
  const a = new Array(k).fill(0.02);
  const n = Math.floor(k * 0.35);
  for (let j = 0; j < n; j++) a[(j * 13) % k] = 0.35 + 0.25 * ((j * 7 % 11) / 11);
  return a;
}

// --------------------------------------------------------------------------- //
async function runTests() {
  const results = [];
  const check = (name, pass, note) => results.push({ name, pass, note });

  // P1: handshake reports mode honestly
  const c1 = new EmbodimentClient().start();
  const welcome = await c1.send({ type: 'hello' });
  check('P1 handshake', welcome.type === 'welcome' && ['mock_body', 'flybody'].includes(welcome.mode),
    `mode=${welcome.mode}${welcome.dependency_note ? ' (dep note present)' : ''}`);

  // P2: reset returns seed + initial state
  const ack = await c1.send({ type: 'reset', seed: 4242, episode: 0 });
  check('P2 reset', ack.type === 'reset_ack' && ack.seed_used === 4242 && Array.isArray(ack.obs0),
    `seed=${ack.seed_used}, obs0[${ack.obs0.length}]`);

  // P3: step → step_result with the full causal payload
  const step1 = await c1.send({ type: 'step', neural: new Array(32).fill(0.3), learn: 0.01, t_neural: 0 });
  check('P3 step shape', step1.type === 'step_result' && step1.action.length === 59 &&
      step1.body && typeof step1.reward === 'number' && step1.obs_next.length === 15,
    `t=${step1.t_phys}, reward=${step1.reward}, latency=${step1.latency_ms}ms`);

  // P4: neural causality at protocol level. Mock: silent → exact stillness.
  // Flybody: silent vs driven → different physics (no passive tone: silence
  // does not mean stillness; the test asserts neural output changes outcome).
  await c1.send({ type: 'reset', seed: 77, episode: 1 });
  let x0 = null, x1 = null, rew = 0;
  const silentDrive = new Array(welcome.mode === 'flybody' ? 412 : 32).fill(0);
  for (let i = 0; i < 120; i++) {
    const r = await c1.send({ type: 'step', neural: silentDrive, learn: 0, t_neural: i });
    if (i === 0) x0 = r.body.pos[0];
    x1 = r.body.pos[0];
    rew += Math.abs(r.reward);
  }
  if (welcome.mode === 'flybody') {
    await c1.send({ type: 'reset', seed: 77, episode: 1 });
    let d0 = null, d1 = null;
    for (let i = 0; i < 120; i++) {
      const r = await c1.send({ type: 'step', neural: burstVector(412), learn: 0, t_neural: i });
      if (i === 0) d0 = r.body.pos[0];
      d1 = r.body.pos[0];
    }
    const div = Math.abs(d1 - x1);
    check('P4 silent-vs-driven divergence', div > 1e-3,
      `silent dx=${(x1 - x0).toExponential(1)}, driven dx=${(d1 - d0).toExponential(1)}, divergence=${div.toFixed(4)} m`);
  } else {
    check('P4 silent->still', Math.abs(x1 - x0) < 1e-6 && rew < 1e-3,
      `dx=${(x1 - x0).toExponential(1)}, |r|=${rew.toExponential(1)}`);
  }

  // P5: seq gap detected (dropped-frame accounting)
  await c1.send({ type: 'reset', seed: 88, episode: 2 });
  await c1.send({ type: 'step', seq: 1, neural: [0.4, 0.4], learn: 0, t_neural: 0 });
  const gap = await c1.send({ type: 'step', seq: 5, neural: [0.4, 0.4], learn: 0, t_neural: 1 });
  check('P5 drop detection', gap.task.sync.dropped_in >= 1, `dropped_in=${gap.task.sync.dropped_in}`);

  // P6: determinism across two fresh clients
  const traj = async () => {
    const c = new EmbodimentClient().start();
    await c.send({ type: 'hello' });
    await c.send({ type: 'reset', seed: 909, episode: 3 });
    const out = [];
    for (let i = 0; i < 50; i++) {
      const r = await c.send({ type: 'step', neural: [0.5, 0.2, 0.8, 0.1], learn: 0, t_neural: i });
      out.push(JSON.stringify({ a: r.action, b: r.body, r: r.reward }));
    }
    await c.stop();
    return out.join('\n');
  };
  const [t1, t2] = [await traj(), await traj()];
  check('P6 determinism', t1 === t2, '50-step trajectories identical: ' + (t1 === t2));

  await c1.stop();

  console.log('EMBODIMENT PROTOCOL TESTS (Node)');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.note})`);
  }
  const all = results.every(r => r.pass);
  console.log(all ? 'ALL PASS' : 'FAILURES PRESENT');
  process.exit(all ? 0 : 1);
}

// --------------------------------------------------------------------------- //
if (require.main === module) {
  if (process.argv.includes('--test')) {
    runTests().catch((e) => { console.error('test harness error:', e.message); process.exit(1); });
  } else {
    console.log('usage: node embodiment/embodiment_client.js --test');
    console.log('  (library use: require("./embodiment_client.js").EmbodimentClient)');
  }
}

module.exports = { EmbodimentClient, SIDECAR, PY };
