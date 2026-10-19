# E1–E11 Visual Audit — Defects, Fixes, and Re-Audit (2026-09-27)

Full visual/behavioral audit of the experiment system on branch `deployment/phase-02`,
executed in one session: initial audit → 8-step fix plan (approved order 2→1→3→7→6→8→5→4)
→ full re-audit with all three lab sessions re-run end-to-end.

## Original defects (initial audit) → resolution

| # | Defect | Fix | Re-audit evidence |
|---|--------|-----|-------------------|
| 1 | Plots "Results by laboratory" session chips frozen at first paint (`LAB_STATE` never written) | `handleSixMsg` mirrors progress/done/error into `LAB_STATE`; lab page answers `expstatus_query` with card states; plots page re-queries every 10 s (self-heal; Chrome drops BroadcastChannel messages to frozen tabs) | Fresh plots page opened after all sessions painted **all 11 chips "✓ done"** instantly |
| 2 | "Experiment status live" card actually showed the ambient chamber loop | Retitled **"Chamber loop (ambient)"** with explanatory sub-line; E1–E11 report in the laboratory board | Retitle visible; card semantics documented |
| 3 | E10 stage: giant foreground fly (scale 1.5), camera too close (dist 760, meters at x=±510 cropped), door-meter text clipped (420 px canvas for ~36-char strings) | cam `760→1050`, per-stage fly scale `1.0` (restore keeps home 1.5), door meter `420→760 px` | Caught live mid-session: `orbitDist 1050`, `flyScale 1.0`, demon at [300,15,230], meter text 226/760 px unclipped; end-of-run worst case 640/760 px |
| 4 | E4 ≈24 min / E5 ≈13 min of dead air (120/125 trials, 3 s/trial connectome cost) | Trial cuts: E4 120→**60** (15+5 ×3), E5 125→**75** (12+3 ×5); E5 gains a post-benchmark **comparator stage** (worker-side echo of `e5_comparator.js`): conditions ranked on frozen-test agreement, 95% CIs (`CORE.meanCI`), headline contrast; rendered as ⚖ chips + mirrored on bench HUD | E4 **271 s**, E5 **257 s** (from 1417 s / 805 s); comparator `⚖ classical_demon 1.00 ±0.00 · drosophila 0.50 ±0.05 · shuffled_connectome 0.48 ±0.05` — deterministic across sandbox + browser runs |
| 5 | E1–E8 had no prediction-vs-observation verdicts on the 3D stage | `#expBenchHud` floats under the brain tag during non-apparatus runs, mirroring the cards' `evaluateLiveVerdicts` chips (single evaluation source); opens on stage start, retires with stage stop | HUD "on" with live chips during runs; chip content byte-identical to card |
| 6 | Stage-1 worker starvation: neural compute went silent between trial boundaries (E2–E5, E8) | `experiment_core.runBenchmark` gained opt-in `onStepProgress` (every 256 sim steps); worker posts ≤1 `stage` msg/1.2 s with intra-trial fraction; main thread shows `… · 36%` labels and pulses the brain envelope (+0.12 train / +0.30 test) | Heartbeat labels with percentages observed on E3/E4/E5 runs (`train 10/15 · seed 1/1 · 0%` etc.); zero silent stretches in the status log |
| 7 | E1–E8 runs produced no brain sensory pulses (no apparatus events to drive `_stimPulse`) | Each *new plotted curve point* (post-dedupe, 300 ms debounce) pulses `sim._stimPulse +0.6`; E9–E11 excluded (stage events already pulse +0.85) | Envelope sampled at 100 % saturation throughout runs (ambient loop + experiment pulses); stack-attribution proved 10 dedicated writes during one E1 run |
| 8 | Card ETAs wildly wrong (E4 "≈2 min" vs 24 min reality; E8 "≈12 s" vs 83 s) | All 11 ETAs rewritten from measured timings; E4/E5 re-corrected after the cuts (measured 342 s → ≈6 min; 218 s → ≈4 min) | Every card matches or is conservative vs measured: E1 4 s, E6 11 s, E7 5 s, E2 9 s, E3 38 s, E8 12 s (warm-cache; ETA stays conservative for first-run cold start), E4 271 s, E5 257 s, E9 258 s, E10 201 s, E11 117 s |

## Re-audit run (2026-09-27, all times measured this session)

| Session | Experiments | Results |
|---------|-------------|---------|
| FLY BRAIN | E3, E4, E5 | 38 s · 271 s · 257 s + comparator |
| DEMON LAB | E1, E6, E7, E9, E10, E11 | 4 s · 11 s · 5 s · 258 s · 201 s · 117 s |
| INFORMATION LAB | E2, E8 | 9 s · 12 s |

- **All 11 experiments `done`, zero errors** (continuous DOM status logger, 250 ms sampling,
  error-pattern scan = 0 hits across all three sessions).
- All card-state transitions observed: waiting → running → (heartbeat %) → done; guest cast
  restore verified (fly scale back to 1.5, demon home).
- Plots board final state: all 11 chips ✓ done, repainted correctly on a fresh window open.

## Verification methods
- Static: `node --check` on worker + core; inline script-block extraction checks on both HTML
  pages; structured card→ETA scans; marker greps for every fix.
- Headless sandbox (XHR-shimmed worker) for E5 comparator validation before browser runs.
- Live DOM instrumentation: status-change logger, envelope property accessors/stack capture,
  pixel-scanning of meter sprite canvases for clip detection, orbit/render probes.
- Test suite: 240 tests, 231 pass, 3 skipped, 6 fail — all 6 pre-existing and unrelated
  (5× P6 stale extraction markers vs `updateHUD(Tl,Tr,dT,sens,visual)`; 1× R2 disclosure
  string absent at HEAD). One retitle-caused failure (T5) was repaired by re-anchoring to
  `id="expStatusCard"`; `tests/nature_figure_panel.test.js` now 9/9.
- Manifest protocol after every step: `zero_stale: true`, stamp `6e63e02c7940…`.

## Measurement caveats
The Freebuff preview freezes hidden tabs: `renderer.info.render.frame` reads static between
probe windows and timers/interval samplers are suspended. Frozen tabs also *drop*
BroadcastChannel deliveries (motivating the plots self-heal). All live numbers above were
taken inside wake windows; none of this affects real on-screen sessions.

## Residual known issues (pre-existing, out of audit scope)
- P6 HUD-parity suite: 5 failures from a stale extraction marker (updateHUD signature
  gained `sens, visual` in Phase B); repair = update markers/oracle.
- R2 provenance test: expects a machine-readable disclosure comment for
  `__flyMotionSource()` that has never existed at HEAD (one-line page addition).
- E8/E3 warm-cache runs are much faster than their (deliberately conservative) ETAs.
