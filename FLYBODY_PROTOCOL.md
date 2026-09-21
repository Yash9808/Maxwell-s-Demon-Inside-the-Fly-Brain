# FLYBODY PROTOCOL — synchronization & wire format

Author: Agent 4 (embodiment track) · Implements FLYBODY_ARCHITECTURE.md §1, §3.
Transport: JSON lines, one JSON object per frame (UTF-8). Two equivalent
transports: **stdio** (default — batch/CI/Node harness; zero dependencies) and
**WebSocket** (interactive browser mode; used automatically when the optional
`websockets` package is installed). Envelopes and semantics are identical.
Reference implementation: `embodiment/sidecar.py` (server) +
`embodiment/embodiment_client.js` (Node client).

---

## 1. The three clocks

| Clock | Rate | Owner | Purpose |
|---|---|---|---|
| **Neural (sim) clock** | fixed dt_neural = 1/60 s virtual (one connectome tick) | browser `brain_worker.js` | advances the connectome; **never** derived from rAF timing |
| **Sidecar (physics) clock** | fixed dt_phys = 1/60 s virtual (one MuJoCo `step`) | `sidecar.py` | advances flybody physics + task |
| **Browser render clock** | rAF (~60 Hz, variable, throttles when hidden) | browser | display only — has **no** authority over the two clocks above |

Ratio **R = dt_neural : dt_phys = 1 : 1** at start (simplest causal loop; one
connectome tick per physics step). R is a protocol constant negotiated in
`hello` (below); changing it later requires a protocol version bump.

**Binding rule (the "never let rendering change science" rule):** the sidecar
steps physics only when a `step` message arrives *or* on its own fixed-interval
catch-up timer while a run is active — never from browser animation callbacks.
If the browser stalls (tab hidden, GC pause), physics does not speed up, slow
down, or skip: it either waits (interactive mode) or advances deterministically
headless (batch mode, PROTOCOL §8). The neural clock is unaffected in both
cases because it lives in the browser worker, which the sidecar never waits on
in batch mode (`MOCK_NEURAL` replays recorded traces instead).

## 2. Message envelope

Every message is one JSON object:

```json
{ "v": 1, "type": "...", "ts": 1690000000123.4, "seq": 142, "...": "type-specific fields" }
```

- `v` protocol version (1). Server replies with `error` and closes on mismatch.
- `seq` monotonically increasing per sender; receiver tracks last-seen for
  dropped-frame detection (§8).

## 3. Handshake & episode lifecycle

```
client → { type:"hello", client:"browser"|"node", R:1 }
server ← { type:"welcome", mode:"flybody"|"mock_body", neural:"live"|"mock",
           assets:{model:"fruitfly.xml", ok:true|false}, version:1,
           capabilities:["step","reset","log","tap"] }

client → { type:"reset", seed:12345, episode:7 }        // §6
server ← { type:"reset_ack", episode:7, obs0:{...}, body0:{...} }

client → { type:"step", neural:[...k], obs_neural:[...m], learn:0.01, t_neural:4120 }
server ← { type:"step_result", t_phys:4120, body:{...}, action:[...59],
           joints:[...J], reward:0.0031, task:{...}, latency_ms:1.42 }

client → { type:"tap", on:true }                        // NeuralTap stream (optional)
server ← { type:"tap_state", on:true }

either → { type:"error", message:"..." }
```

Field notes:
- `neural` = motor-population activity vector `a_neural` (float[k], k = motor
  layer size; see DECODER_SPEC §3). `obs_neural` = observation vector for the
  neural input encoding (8-bin visual + 7 contact analogues → m=15).
- `learn` is the plasticity gate (mirrors `parseFloat($("lr").value)` semantics);
  the sidecar routes reward × learn into the protocol's `reward_to_brain` bookkeeping.
- `t_neural` is the client's neural tick counter; `t_phys` the sidecar's physics
  step counter. The sidecar asserts `t_neural == t_phys` when `R == 1` and
  reports drift in `step_result.task.sync`.

## 4. Step semantics (server-side order of operations)

```
1. validate seq (gaps → task.sync.dropped_in)
2. decoder:      u   = D(neural)                    # logged
3. actuator map: a59 = actuator_map(u)              # logged
4. physics:      s'  = env.step(a59)                # THE BODY — mujoco step
5. task:         r, task, done = task_fn(s', prev_s)
6. sensors:      obs' = SensorBinder(s', task)
7. logging:      RunLogger.step(...)                # full causal chain, §6
8. reply:        step_result{body, action:a59, joints, reward:r, task, latency_ms}
```

One `step` in ⇒ exactly one physics step out. The server never batches, never
coalesces, never drops a step silently.

## 5. Shutdown

`{ type:"bye" }` → `{ type:"bye_ack" }`; server flushes the run log and closes.
WebSocket close without `bye` = abnormal; the log records `abnormal_close: true`.

## 6. Episode reset protocol

```
client → { type:"reset", seed:S, episode:E }
server:
  1. flush + rotate the JSONL log for the finished episode (if any)
  2. env.reset(seed=S)           # MuJoCo qpos0 + task geometry re-derived from seed
  3. decoder.state_reset()       # decoder EMAs/adaptive gains back to priors —
                                 # the DECODER carries no cross-episode memory
  4. reply reset_ack{obs0, body0}
```

The neural controller is NOT reset by the sidecar (the connectome's learning is
the experiment's business); only decoder + physics + task state reset.

## 7. Seed handling

- One seed controls the whole episode: MuJoCo `env.reset(seed=S)`, task
  randomization, and `MOCK_*` noise all draw from one `numpy.random.Generator(PCG64(S))`.
- The client may pass `seed: 0` meaning "sidecar chooses" — the sidecar then
  returns the chosen seed in `reset_ack.seed_used` and it is logged.
- Determinism contract: same seed + same `step` sequence ⇒ identical
  `step_result` trajectories in `mock` mode and identical MuJoCo trajectories in
  flybody mode (MuJoCo is deterministic given identical step order; `mj_step` on
  one thread with no rendering jitter).
- The neural stream is NOT expected to be seed-reproducible (it is the living
  controller); determinism claims apply to body+task only.

## 8. Dropped frames & catch-up behavior

Interactive mode (browser client):
- The sidecar paces itself with a fixed 16.67 ms timer while a run is active and
  **auto-steps** with `neural = last_neural` (hold-last-command, the standard
  zero-order-hold policy) when the client's step has not arrived in time. Every
  auto-step is logged with `src:"auto"`.
- If the client falls >10 steps behind (`t_neural < t_phys - 10`), the sidecar
  enters `sync_hold`: physics pauses until the client catches up or requests
  reset. No silent trajectory divergence.

Batch mode (Node harness / CI):
- Client drives every step explicitly (`pace:"client"`, set via `hello.pace`);
  the sidecar has no timer; wall-clock latency never enters the loop. This is
  the mode the smoke test uses, so **rendering latency cannot contaminate results**.

Drop detection: `step_result.task.sync = { dropped_in, drift, auto_steps }`.

## 9. Latency measurement

- `latency_ms` (in `step_result`) = time from receiving `step` to sending
  `step_result`, measured server-side (`perf_counter`), excluding network.
- Round-trip: client measures `rtt_ms = send→reply` wall time and accumulates
  p50/p95 in `task.sync.rtt` every 100 steps.
- Budget: sidecar compute < 5 ms/step (mock ≈ 0.05 ms; flybody ≈ 1–3 ms CPU on
  this class of model). If p95 > 10 ms for 100 consecutive steps the sidecar
  flags `task.sync.overloaded` — a signal to reduce R or move to batch mode,
  never a signal to skip physics.

## 10. Log stream (server → client, optional)

`{ type:"log_summary", episode, steps, mean_reward, final_body, sync }` on
episode end/reset. Full per-step records live in the JSONL file
(RunLogger, DECODER_SPEC §6); the wire carries only summaries by default so a
60 Hz session cannot flood the browser with megabytes (patch-16 lesson).
