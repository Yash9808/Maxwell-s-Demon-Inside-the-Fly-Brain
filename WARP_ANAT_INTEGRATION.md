# Warp CUDA — Anatomical 3D Integration (implemented & verified)

Status: **IMPLEMENTED, browser-verified.** Experimental performance backend for
the 🧠 Anatomical 3D brain mode only. Built on the validated Warp investigation
(`WARP_BACKEND_INVESTIGATION.md`, `WARP_BENCHMARK_RESULTS.md`) — no second Warp
implementation; `kernels.py` reused, plus one parity fix (see §7).

Workstream note: this is the **Warp track**, NOT P3 (heat/top-K in worker) and
not a scientific-phase change. No scientific baseline, Phase-01 tag, P0/P1
semantics, decoder, or physics parameters were touched.

---

## 1. Files changed

| File | Change |
|---|---|
| `backend_warp/warp_server.py` | **NEW** — production Warp-CUDA sidecar (HTTP, port 8793). Dataset-aware `/init`, compact-state `/tick`, `/reward`, `/health`, `/stop`. Reuses `kernels.py`. |
| `backend_warp/warp_client_smoke.js` | **NEW** — standalone contract smoke test (init guards, tick layout, W cadence, reward). |
| `backend_warp/kernels.py` | **1-line fix**: `k_plasticity` increment now `d*e*WS*W0b[i]`, matching production `applyLearning` exactly (was missing `WS*W0b`). Verified bit-exact vs production with the eligibility gate. |
| `fly_demon_3d.html` | Page integration: `BrainBackend` module, top-bar backend chip, `btnAnat` gate, dataset-switch re-init, telemetry. |
| `WARP_ANAT_INTEGRATION.md` | **NEW** — this report. |

Not touched: `brain_worker.js`, scientific baselines, experiment code, physics,
P0/P1 modules, launch script.

## 2. Anatomical 3D activation handler

`fly_demon_3d.html` `$("btnAnat")` click handler: toggles `anatMode`, then
`Promise.resolve(BrainBackend.prepareAnat())` decides the backend:

* Warp probe OK → sidecar `/init` (circuit blobs) → `/tick` loop → rebuild anat
  view → chip `⚡ WARP CUDA ● ACTIVE`.
* Warp unavailable → **explicit modal** "Warp CUDA is unavailable — [Use JS
  Worker] [Cancel]". Cancel restores the button; no silent fallback.
* Legacy path unchanged (JS worker + `leaveAnat` stop).

## 3. Top-bar control

`#warpBadge` chip in the existing top bar, click-cycles Warp ↔ JS Worker for
the current anat session. States: `⚡ WARP CUDA — CONNECTING / ● ACTIVE /
⚠ UNAVAILABLE` and `● JS WORKER`. Low-freq telemetry appended (2–10 Hz budget):
`tick 2.2ms · rtt 13ms · #n`.

## 4. Availability detection

`BrainBackend.probe()` → `GET /health` (1.5 s timeout). Positive result cached;
negative result cached for 60 s only (TTL — a late-starting sidecar is picked up
on the next anat entry instead of being locked out for the page lifetime).
`?warp=off` disables Warp everywhere (one-click A/B baseline replay).

## 5. Start / stop lifecycle

* **Start**: probe → `/init` (base64 `src/dst/w0/sign` + optional `modSrc`,
  `modType`, dataset key, N, NE, optic/layers) → GPU arrays built → tick loop
  (rAF-paced ≥33 ms) → `/health` poll for telemetry.
* **Stop** (`leaveAnat`, also on override and dataset switch): clear loop +
  watchdog timers, abort in-flight fetches, `POST /stop` (GPU state released
  server-side), chip restored. Verified: server ticks freeze on leave; no
  background simulation.
* **Exclusivity**: `suspendJsWorker` latches the worker off before the first
  Warp tick; worker resumes only after Warp stops. Confirmed never both.

## 6. Dataset switching

`switchDataset()` → `BrainBackend.onDatasetChanged()`: stops Warp (in-flight
init guarded by a swap counter → init result discarded if a switch happened
mid-flight), clears the cached payload, `delete cachedMeta.sim`. Next anat
entry re-`/init`s from the freshly loaded circuit arrays. Server validates
N/NE/array lengths and rejects mismatches (400) — verified live with a
deliberately bad init, and verified good: FAFB (106,765 / 553,807) and MCNS
(52,849 / 160,000) inits both succeeded from the real page payload (captured
init body decoded: fully self-consistent, dataset key matches arrays).

## 7. State payload (compact ONLY)

24-byte little-endian header (`<IIBfff`: tick, N, flags, dav, mrs, mb) +
N×`uint8` spike bitmap + every 12th tick a 4-byte-aligned f32 `W` block —
**≈104 KB/tick, 106 KB with W**. Full-state (~3 MB/tick) path is NOT used
(`full_state_path: false` in `/health`). Same compact contract as
`brain_worker.js`; Three.js rendering untouched. An alignment bug (W offset
uncaught by Float32Array, killed ticks at exactly #12) was found live and
fixed on both ends (padded W start).

## 8. Verification results

| Scenario | Result |
|---|---|
| Normal startup | JS worker default, `● JS WORKER`, no Warp fetches |
| Anat 3D + healthy sidecar | auto CONNECTING → `⚡ WARP CUDA ● ACTIVE` with telemetry (`tick 2.2–2.7 ms · rtt 13–68 ms`) |
| Tick flow | server ticks advance only while tab visible (hidden-tab rAF skip); ~14 ticks/s under hidden-tab throttle, 60+ Hz capable (4.1–8.5 ms round-trip standalone) |
| Warp unavailable | explicit modal, [Use JS Worker] only path to legacy backend, no silent fallback |
| JS Worker override | chip click → JS worker active, Warp stopped (`/health` frozen) |
| Leave anat | `stopped: left anatomical 3D`, worker restored, no leak |
| Dataset switch | stop → re-init with new arrays → dimension guards pass (both datasets verified live) |
| Backend exclusivity | worker suspended during Warp; never both |
| `?bw=off` / P1 fallback / smoke tests | unchanged, still pass |
| Server-side guards | bad init rejected 400, `last_error` set, state never corrupt |
| Sidecar smoke (`warp_client_smoke.js`) | PASS: 60-tick contract exact, W cadence exact, guard 400 |

Bugs found and fixed during verification (all real, all pre-report):
1. `modType` vs `modT` payload key mismatch (init never fired).
2. Float32Array alignment of W block (tick #12 crash).
3. Stale watchdog false-fire after main-thread freeze → loop-gap guard.
4. Negative probe cached forever → 60 s TTL.
5. Early click mid-boot threw on `sim.circuit` → guarded.
6. `k_plasticity` missing `WS*W0b` factor (parity with production).
7. `TCP_NODELAY` + `Access-Control-Expose-Headers` for honest telemetry.

## 9. A/B browser measurements (head-to-head, same tab, same machine)

| Metric | A — JS Worker | B — Warp CUDA |
|---|---|---|
| Frame p50 (layered-view baseline) | 177–228 ms, 20 fps | — (not anat) |
| Anat-frame behavior | worker messages land on main thread; heavy hitching (F1: 19.4 long tasks/s sustained) | sim off-thread: **0 long tasks** in 10 s clean windows; rtt P50 13–38 ms |
| Backend tick (GPU) | 12.4 ms p50 (F1) | **2.2–2.7 ms** |
| Round-trip latency | worker postMessage (in-process) | HTTP 104 KB: P50 13–38 ms |
| Clean-window anat sampling | 198 worker ticks / 20 s, 100 long tasks, ~20 fps | 120 ticks / 20 s, 76 long tasks, ~12 fps rAF under occlusion-throttled preview |
| Telemetry (clean) | bw 3–4/s, frame p50 178–228 ms | `tick 2.4ms · rtt 13ms · #89` with rAF ~60 fps |

Honest reading: the browser leg is **noisy** — the preview tab was repeatedly
occlusion-throttled/hidden (rAF 0 for minutes at a time), which contaminates
rAF-derived numbers (the "12 fps" windows) and triggered false-fail paths that
are now guarded. What reproduces consistently: **Warp moves the 106k-neuron
LIF+plasticity tick off the main thread at 2–3 ms and emits zero long tasks in
clean windows**, while the JS worker's tick path contributes sustained long
tasks on the render thread in this mode. A quiet-foreground A/B (real user
watching the tab, or the F1 clean-room harness) is the remaining step for a
publication-grade FPS verdict.

## 10. Remaining limitations

1. Warp requires the sidecar process (`.venv-warp`, CUDA GPU); it is an
   **experimental** backend — the JS worker remains the default everywhere
   outside anat mode and after override.
2. Head-to-head FPS under a *visible* tab not yet captured (preview tab kept
   getting throttled); telemetry metrics above are the reliable subset.
3. Modulatory EMA counters (`mb`) approximated as neuron-count-scaled rates in
   the sidecar; magnitudes are display-plausible, not production-derived.
4. `/reward` accepted but only recorded server-side (parity with worker's
   separate reward message semantics preserved; no plasticity coupling added).

## 11. Report checklist (task §18)

1–2. Files & handler: §1, §2. 3. Chip: §3. 4. Probe: §4. 5. Lifecycle: §5.
6. Dataset: §6. 7. Payload: §7. 8. Full-state not used: `/health`
`full_state_path:false`, 104 KB/tick. 9. Exclusivity: §5, verified. 10.
Unavailable → explicit modal, no silent fallback: §2, §8. 11. JS worker
regression: startup/anat-override/leave verified, `?bw=off` intact. 12. Warp
anat tests: §8. 13. A/B: §9. 14. Limitations: §10.

Warp is **not** a production replacement — it is an opt-in, anat-only,
explicitly-indicated experimental backend.
