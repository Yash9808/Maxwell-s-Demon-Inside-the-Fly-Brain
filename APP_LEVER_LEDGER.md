# APP LEVER LEDGER — all pre-registered app-side experiments (2026-10-08)

**FINAL UPDATE (Experiment 4, closing clause executed): the two-door learned policy landed NO-EFFECT (burst 31.6%, in-band; alignment z=−1.09; P(good|chosen) trend flat; policy entropy pinned at 1.000 bit — the softmax never left the uniform prior despite DA-gated credit on the chosen channel). Per the prereg closing clause, ALL lever diffs (sustained heat + two-door) were REVERTED and app-side lever work is CLOSED permanently. Learning claims route to the Stage-2 harness. See `research_data/twodoor_experiment_2026-10-08/EXPERIMENT4_REPORT.md`.**

Read-only ledger. Compiled after Experiment 3 (sustained heat), before Experiment 4 (two-door learned policy); updated with Experiment 4's final verdict. All sessions driven by the same export pipeline (verify_schema_v2_session.js pattern); identical analysis pipeline throughout (60 s windows, burst = ≥25 crossings/60 s, head metric = pooled burst-regime mean, one-sided binomial vs 50%).

## Evidence points (chronological)

| # | session | prereg | prereg timestamp | head metric (burst pooled) | verdict band | mechanism finding (one line) |
|---|---|---|---|---|---|---|
| 1 | `fly_session_2026-10-08T10-45-13` (baseline, jetP 0.55, 932 s) | none (reference/baseline — pre-registers the pipeline itself) | — | ~43–50% region; lifetime 46.0% (652/1417), p=.9987 | REFERENCE (keeper FAIL) | pulsed auto-jet gives τ≈1.94 s gradient (~55% duty); gate-policy alignment metric (a) ANTI-aligned (z=−3.66) — action stream untargeted |
| 2 | 621 s verify session | none (schema-verification run) | — | 29.5% (71/241), p=1.0 | REFERENCE (keeper FAIL) | export later lost to harness overwrite (disclosed); numbers kept from keeper_performance.csv quoted at capture time |
| 3 | `fly_session_2026-10-08T14-03-57` (lr 0.004→0.012) | `research_data/lr_experiment_2026-10-08/app_prereg_lr.json` | 2026-10-08 (pre-session; see file) | 29.4% (64/218), p=1.0 | NO-EFFECT | 3× learning rate changed nothing → plasticity is signal-starved, not amplitude-limited; verdict "degraded" corrected to NO-EFFECT (disclosed in dtlever prereg) |
| 4 | `fly_session_2026-10-08T14-43-03` (jetP 0.55→1.0) | `research_data/dtlever_experiment_2026-10-08/app_prereg_dtlever.json` | 2026-10-08T15:35:00Z (pre-diff) | 22.2% (131/591), p=1.0 | FAIL (degraded) | jetP scales only sawtooth amplitude (rise 0.011→0.019), never τ (~1.9 s invariant); stronger pulses ≠ sustained gradient; reverted to 0.55 |
| 5 | `fly_session_2026-10-08T16-14-53` (sustained heat, power-matched) | `research_data/sheat_experiment_2026-10-08/app_prereg_sheat.json` | 2026-10-08T15:42:21Z (pre-diff) | 26.9% (68/253), p=1.0000 | NO-EFFECT (degraded end) | duty 87% (from ~55%), standing dT 0.044, real plasticity flow (signed dwL1 4.7e-3→4.2e4) — yet alignment stayed at chance (z=0.64); crossing throughput fell ~4× (321 vs 1417) |
| 6 | `fly_session_2026-10-08T17-42-07` (two-door learned policy, stacked on sustained heat) | `research_data/twodoor_experiment_2026-10-08/app_prereg_twodoor.json` | 2026-10-08T16:43:43Z (pre-diff) | 31.6% (49/155), p=1.0000 | NO-EFFECT → CLOSING CLAUSE | door action made plastic for the first time (softmax two-channel, credit-on-chosen, 265 choices logged): policy entropy never left 1.000 bit, pHot 0.502→0.498 — the DA-gated route cannot move this action; first run (17-17-07) INVALID on a ring-buffer overflow (per-frame logging), disclosed + single recovery used |

Diagnostic prelude (read-only, no prereg needed): gate-policy audit found the door action untargeted (chance-level or anti-aligned at all δ); dwMax=300 traced to the inhibitory clamp ceiling (brain_worker.js:274, [−1,+2]×W0·WS → max |ΔW| = 3×W0·WS = 300%) — one saturated inhibitory synapse, not plasticity capacity; dT decay τ ≈ 1.9 s measured in all three then-surviving sessions.

## Explicit conclusion lines

1. **The teaching signal was replaced (pulsed → sustained, power-matched, duty ~87%) and the head metric stayed chance-level** (26.9%, degraded end of the 22–46% band) with no alignment gain (z=0.64). The teaching-signal hypothesis is falsified in this regime → **policy architecture is implicated**: the door reflex `door.target = clamp((motorRateSmooth − motorBase − 0.02)·12, 0, 1)` (fly_demon_3d.html:7945) is outside the learning loop — no reward-signal improvement can steer a channel that never receives it.
   - *Amendment (Step B throughput diagnostic, post-ledger):* the "4× crossing drop under sustained heat" is an **app-version confound, not a lever effect** — the v2.1-pipeline session at identical pulsed 0.55 physics (lr012, 0.412/s, speed med 112) matches the sustained session (0.411/s, med 114); the pre-v2.1 baseline's 1.52/s (speed med 330) is the outlier build. See `research_data/sheat_experiment_2026-10-08/THROUGHPUT_DIAGNOSTIC.md`.
2. **dwMax is DROPPED as a KPI** (Experiment 3 prereg §phase_minus1): dwMaxFinal=300 is the hard clamp ceiling for an inhibitory synapse — a saturation artifact present in every session regardless of lever or behavior. Signed v2.2 estimators replace it for plasticity-flow measurement.
3. **Gate-policy alignment metric (a)** — P(good | crossing within δ of gate_open) vs session overall good-rate, with empirical random-time coincidence baseline and one-sided z — is the STANDARD SECONDARY READOUT for all experiments: it separates "learning happened but cannot express" (PARTIAL-POLICY) from "no learning" (NO-EFFECT). It read chance-level or anti-aligned in every session (−3.66 / +1.11 / +0.55 / +0.64 / −1.09) and never earned a PARTIAL-POLICY verdict.
4. **Experiment 4 closed the app lever program.** With the teaching signal fixed (EXP3) AND the action made plastic (EXP4), the policy still never moved: app-side dopamine-gated routes cannot learn this apparatus's door behavior. Remaining questions belong to the Stage-2 harness (stage2_parallel.js pipeline), not further app levers.

## Demon-observation slice — rows 1–4 of the demon wiring chain (2026-10-09)

**ZERO EVIDENTIAL WEIGHT.** Protocol §2: this browser app is *visualization, never evidence generation*; nothing below enters any estimand, and no §13-pinned file was touched. This is **not** a lever and it does **not** reopen the closed app-lever program — it is a narrow **representation** test: *is the demon represented in the network's activity?* It says nothing about learning, imitation or transfer, and cannot, because the btnSwap handover still resets weights and the action pathway (`actuate()`, the DA rule `q·0.6·rewScale`) is unchanged. Rows 5–7 of the chain are explicitly out of scope.

### Row 1 — demon telemetry accessor (read-only): `DemonObs` (`window.DemonObs`)
`DemonObs.read()` returns, for the current frame: `state` (WATCH│ATTEND│HOLD│STRIKE│RECOIL), `simTime`, `seq`/`lastActionT` (a state transition *is* the demon's behavioral action), `gateCmd` = `door.target` (the gatekeeper's attention), `lastOpenT`/`lastCloseT` (transitions of `door.pos` through 0.5), `lastQ`, `crossGood`/`crossBad`, `qWindow` (the recorder's own rolling-20 crossing valences, `chemKeeperStats.recent`), `goodRate` (rolling mean; cumulative fallback; 0.5 prior), `timeSinceAction`.
**One gate.** The apparatus has exactly one gate — `let door = { target, pos }` is a single 2-field object and `gateId` is a monotonic open/close *pair* id for that one gate. "Which door" is therefore **not meaningful**; the slice encodes the gate **command** as one scalar (`obs_gateCmd`) and does not invent a second door to fill a table.
**No sim writes.** `read()` and `demonObsVector()` assign only to the accessor's own scratch object and their own edge memory; they never write `sim.*`, `door.*`, `DemonGatekeeper.*`, particle or brain arrays (verified by inspection of the three functions and by the probe sampling a live run without perturbing it).

### Row 2 — the obs_* encoder (exact ordering)
Behind ONE UI toggle, `#demonObsChk` in **Demon driver**, **DEFAULT OFF.** With it ON, `readSensors()` appends this 8-feature tail (indices are 0-based *within the tail*; the base vector keeps indices 0–6):

| idx | name | definition |
|---|---|---|
| 0–4 | `obs_state_watch`, `obs_state_attend`, `obs_state_hold`, `obs_state_strike`, `obs_state_recoil` | one-hot on the FSM state, in that order |
| 5 | `obs_timeSinceAction` | `clamp((simTime − last state transition)/2 s, 0, 1)` (2 s saturation) |
| 6 | `obs_goodRate` | rolling-20 crossing good-rate (cumulative `crossGood/(good+bad)` fallback; 0.5 prior) |
| 7 | `obs_gateCmd` | `door.target` — the commanded gate regime |

**Feature count: base 7 → 15 when ON; identical 7 when OFF.** `window.__demonObsVector()` reproduces the tail on paper from any frame.

### Row 3 — worker protocol + input mapping
- The tick message gains an **additive** block only while ON: `demonObs` (Float32Array(8)) + `demon` {state, simTime, seq, gateCmd, gateOpen, lastOpenT, lastCloseT, goodRate, timeSinceAction, nGood, nBad}. With the toggle OFF the payload keeps exactly its pre-slice keys.
- `brain_worker.js` is **tolerant both ways**: it consumes `m.demonObs` when present and echoes the consumed `demon` block (plus `demonObsChannels`) back with the state message; an old-format tick (no demon field) runs unmodified — proven bit-identically in the tick-level test below.
- **Input mapping:** the app/worker own their index→bin partition (`injectLayerChannels`, optional `slice` descriptor). **`controllers.js` was NOT touched** (it carries a separate copy of that mapping for the headless harness; §13 pin verified fresh), so the extra channels were accepted without any blocker.
- **Input-layer size: unchanged — the layer is 2,875 neurons (FAFB layer 0), before and after.** What changes is the *channel* count mapped onto it. The base 7 channels keep their exact index→bin partition; the 8 obs channels enter a **RESERVED sub-band, layer positions [2472, 2875) = 403 neurons (14% of the input layer)**, at the same injection gain 12. Report: `window.__demonObsInput()`.

### Row 4 — representation test (the deliverable, deliberately narrow)
Headless Chrome, FAFB dataset, real 106,765-neuron connectome **in the worker**, 180 s window per arm, one sample per worker tick (mean firing rate + that tick's demon state). Statistic = range of per-state mean firing rate (states with n ≥ 25); null = seeded (mulberry32, 20261009) **label-shuffle permutation**, 5,000 resamples over the same samples, so group sizes co-vary exactly as under the sharp null.

| arm | samples | states (n) | per-state mean rate (Δ vs WATCH) | observed | null mean ± sd (max) | p |
|---|---|---|---|---|---|---|
| **OFF** (control) | 1,938 | WATCH 1809, HOLD 55, RECOIL 39, STRIKE 25, ATTEND 10 | WATCH .012585 (—), HOLD .014941 (+18.7%), RECOIL .015871 (+26.1%), STRIKE .015319 (+21.7%), ATTEND .015177 (+20.6%) | 3.286e-3 | 5.02e-4 ± 2.41e-4 (1.92e-3) | **2.0e-4** (floor: 0/5000) |
| **ON** | 2,235 | WATCH 2016, HOLD 101, RECOIL 65, STRIKE 34, ATTEND 19 | WATCH .012412 (—), HOLD .014577 (+17.4%), RECOIL .016953 (+36.6%), STRIKE .015696 (+26.5%), ATTEND .016700 (+34.6%) | 4.541e-3 | 5.05e-4 ± 2.51e-4 (2.02e-3) | **2.0e-4** (floor: 0/5000) |

**Result, both directions.** (i) Network activity **does covary with demon state** — WATCH (the resting post) fires lowest; HOLD/ATTEND/STRIKE/RECOIL run 17–37% hotter, far outside the label-shuffle null in **both** arms. (ii) The covariance is **NOT specific to the obs channels**: the OFF arm — no obs channels anywhere in the pipeline — shows the same pattern at the permutation floor, because demon transitions are apparatus-coupled (crossings fire the AL+optic stim pulses and shift DA; the gate regime drives the fly's own sensory state). (iii) In the ON arm **all 2,235 samples carried the worker's echoed demon block** (echoMismatch 14/2,235 ≈ 0.6%, i.e. a transition landing between post and receipt) — the block really reached the worker every tick, and the in-band writes are proven mechanically (T8/W2). (iv) The ON arm's range statistic is 1.38× the OFF arm's, but with **one unreplicated run per arm** and a Bernoulli injection that itself adds variance (per-state SD ≈ 1.22× higher in ON), that ratio is **descriptive only** and must not be read as the obs channels sharpening the representation. No evidence of *no* effect and no evidence of an *added* effect: the honest statement is that the demon is represented in network activity, that this representation is already present without the obs channels, and that one run per arm cannot separate the two contributions.

### Regression guards (all re-run after the last edit)
- `?fly=legacy` TrueFly-glb path and its orientation fix: untouched (no hunk in that region).
- **Toggle OFF byte-identity** vs the pre-slice sources (`/tmp/obs_slice_before` snapshots): 18/18 — `readSensors` elementwise identical with identical RNG draw count; page and worker `injectLayerChannels` byte-identical `V` and RNG stream; the explicit base slice `{start:0,count:7}` preserves the legacy partition; obs drive confined to the reserved band (page and worker agree).
- **Worker tick protocol** (tick-level, Node vm with a `self` stub): 12/12 — old-format tick produces bit-identical `V`/spikes vs the pre-slice worker; a demon tick changes current only inside the reserved band and leaves the base partition intact; the demon block is echoed verbatim with `demonObsChannels = 8`; old-format ticks echo `demon: null` / `0`; no worker error on either path.
- **Full smoke suite: 80 passed, 0 failed, 0 skipped, exit 0** (`node tests/run_smoke.js`; the earlier run's single S12 failure — the pinned `dt:sim._bwLastDt })` snippet — was fixed in the source, not by weakening the pin).
- **Pins 7/7 FRESH** against `PRE_REGISTRATION_STAGE1.json` (protocol, stage1_config, stage1_analyze, match test, experiment_core, controllers, benchmark) + Stage-2 spot check FRESH (protocol v1.1, stage2_config sha `4114bc7c…`, experiment_core, controllers, benchmark, match test). The live Stage-2 campaign is untouched.
- **Diff confined to** `fly_demon_3d.html` + `brain_worker.js` + this ledger; no new repo files (harnesses and the raw probe JSON live outside the repo, in `/tmp/obs_slice/`).

**One honest sentence.** With the observation toggle ON the network's firing rate differs strongly by demon state — but so does it with the toggle OFF, so this establishes that the demon is *represented* in the apparatus-coupled network activity (and that the obs channels verifiably reach the input layer), not that the obs channels are what carries the representation, and nothing at all about learning, imitation or transfer.

## Working-tree diffs vs the pre-diagnostic state (as of this ledger)

Files MODIFIED (tracked):
- `fly_demon_3d.html` — (a) schema v2.1 export code (from earlier in-conversation work: gate_close fix, shared sim clock, dwL1_step/dwN_step, spk_<nt>/n_<nt>, README clock contract); (b) Experiment 3 instrumentation: signed dwL1/dwN estimator, schema 2.1→2.2, README/meta notes, dwMax KPI drop disclosure; (c) Experiment 3 lever: `var SUSTAINED_HEAT = false;` default-off flag, `jetFireContinuous()` (power-matched continuous injection), sustained frame-loop branch with 3.5 s `mode:'sustained'` cycle-marker events. Keeper rule, q-rule, actuate(), plasticity: UNTOUCHED.
- `verify_schema_v2_session.js` — schema check 2.1→2.2; env-gated `SHEAT=1` pre-goto `addInitScript` (non-writable pinned `window.SUSTAINED_HEAT`; setter ignores `false` redeclarations). Without SHEAT: behaviorally identical.
- `brain_worker.js` — (demon-observation slice, 2026-10-09) optional `slice` argument on `injectLayerChannels` (absent ⇒ the original whole-layer mapping, arithmetically and RNG-identically), tolerant `m.demonObs` injection into the reserved band of input layer 0, and the additive `demon`/`demonObsChannels` echo in the state message. `controllers.js`, `benchmark.js`, `experiment_core.js` and the other tracked files listed in `git status` were ALREADY MODIFIED before this conversation's diagnostics began (pre-existing working-tree state; sha256-pinned files verified 7/7 fresh against `PRE_REGISTRATION_STAGE1.json` — the pins cover protocol/config/analysis/harness files and are unaffected).

Files UNTRACKED (added this conversation, research artifacts only):
- `app_prereg_lr.json`, `app_prereg_dtlever.json`, `research_data/lr_experiment_2026-10-08/`, `research_data/dtlever_experiment_2026-10-08/`, `research_data/sheat_experiment_2026-10-08/` (prereg + session + zip + `EXPERIMENT3_REPORT.md` + `THROUGHPUT_DIAGNOSTIC.md`), `research_data/twodoor_experiment_2026-10-08/` (prereg + `RECOVERY_DISCLOSURE.md` + invalid-session artifacts + final session + zip + `EXPERIMENT4_REPORT.md`), this ledger.

**Post-EXP4 state (closing clause executed):** `fly_demon_3d.html` retains ONLY the v2.1 schema work + v2.2 signed-estimator instrumentation vs HEAD; ALL lever code (SUSTAINED_HEAT/jetFireContinuous and TWO_DOOR_POLICY/tdChoose/tdCredit) is REVERTED, schema_version is 2.2, and a post-revert smoke run passed all contract checks with zero lever markers. `verify_schema_v2_session.js` retains only the 2.2 contract check. The app is functionally at its diagnostic-state configuration.

Nothing committed.
