# AUDIT — Logging, neural learning, and gate control in the Maxwell–Demon Drosophila app

**Date:** 2026-10-10 · **Scope:** read-only audit, per instruction **no code, parameters, or files were modified**.
**Primary sources:** [fly_demon_3d.html](fly_demon_3d.html) (14,543 lines; the browser app), [brain_worker.js](brain_worker.js) (the live sim's 553,807-edge connectome worker), the Stage-1/Stage-2 harness ([experiment_core.js](experiment_core.js), [benchmark.js](benchmark.js), [controllers.js](controllers.js), [tests/run_smoke.js](tests/run_smoke.js)), and the log corpora under [research_data](research_data) (Stage-1 pilot 5,415 rows; Stage-2 in flight, 618 DONE / 263 FAILED job packages as of the last stage2 progress row 2026-10-10T18:23Z).

Every claim below carries one of the labels: **VERIFIED IN CODE**, **VERIFIED IN EXISTING LOGS**, **PARTIALLY SUPPORTED**, **NOT IMPLEMENTED**, **NOT LOGGED**, **CANNOT DETERMINE**.

---

## 1. Executive verdict

**What the app demonstrably implements.** A real, complete closed physics loop: 320 particles integrate, collide, and cross a single gate; temperatures are computed from per-side mean squared speed; a heat jet perturbs the left side; a connectome-derived spiking network receives sensor input; dopamine shifts at crossings; a dopamine-gated eligibility-trace weight update runs; the gate's target is driven by the network's motor-layer firing rate (in `brain` mode). **VERIFIED IN CODE**, end to end, in two functionally identical backends (in-page mirror of `brain_worker.js`, and the worker itself at [brain_worker.js:194](brain_worker.js#L194)).

**What is *not* demonstrated.**

1. **No learning evidence exists in this app's own logs.** The browser Log button collects performance aggregates (selAll/selRecent, dT improvement) and two plasticity summary estimators (dwL1/dwL1_step, dwN/dwN_step) — but **not the individual weight updates**, not the input vector, not the motor output that set `door.target`, and far too few crossings (10 Hz sampling over minutes yields ~tens of crossings) for any learning-vs-chance test with credible power. The `keeper_performance.csv` "learningSuccess" flag is **app-defined, not pre-registered**, and is a performance criterion, not a learning criterion. **VERIFIED IN CODE.**
2. **The indicator most logged is performance under a rule that can be learned vs fixed coincidentally high — with no untrained-network contextual control**, so the selRecent ≥ 60% flag cannot separate "learned" from "the connectome's untrained dynamics already biased the gate". The Stage-2 harness fixes precisely this (arm A vs arm D no-op connectivity topological control, arm E random-action floor) but its material is the *sort-entropy* estimand, a different quantity computed by different code. **VERIFIED IN EXISTING LOGS** (Stage-1/2 rows have `weightDrift`, `sortEntropy`, `dTfinal` — not browser-style selectivity).
3. **Weight persistence across episodes is decoupled by mode.** Within a brain-mode run weights stay; the `btnSwap` role-reversal handover resets them to `W0[i]*sim.WS` and dopamine to 0, so cross-episode retention is *variable*: the 60 s episode boundary (`EP_LEN`) preserves weights, but explicit FSM state reset paths (dataset switch, resetParticles, certain UI and experiment reset buttons) can leave weights intact but re-initialize DA to 0 — the pharmacological memory is wiped even when synaptic memory is not. **VERIFIED IN CODE.**
4. **"Learning" as it lives in the audit QA has no error signal contour.** DA is a plain crossing-valence pulse `q·0.6·rewScale` ([fly_demon_3d.html:7703](fly_demon_3d.html#L7703)) — no temporal credit assignment, no baseline subtraction, no expected-value comparator. Any weight update that "improved" behavior would have to find the correct SNR purely by repeated binary pulses; **VERIFIED IN CODE**, and the lever ledger's own failure to move selectivity above chance across multiple published lever runs is the honest history of how this turned out. **PARTIALLY SUPPORTED** that learning works in practice — the leaks the ledger shows (unchanged dTimprove, dTbaseline = 0 in every session so far, dT ≡ wormhole through the gate) are consistent with *no usable learning* in this app.

**Bottom line on user Q parts 1–5** (does the net learn? persist? who controls the gate? can the FSM explain it? etc.): implementable paths exist in code; **the only training-effect demonstration is under-constrained** — no untrained control in the browser app, too-short episodes, and small-N, cross-episode post/pre comparisons that are **not logged** in the browser Log zip. The separate Stage-2 confirmatory harness **is** the right instrument and is partially complete (618/881 job entries), but it measures **sorting entropy**, not button-level behavior, and was not yet analyzed at audit time.

---

## 2. Code architecture — the actual causal chain

All citations are `[file:line-range]` into the current working tree.

```
[rAF frame]  frame()  fly_demon_3d.html:7901
  ├─ stepParticles(dt, noise, doorH)     :7793
  │    ├─ integrates P (320 particles), wall bounces, turbulence :7810-7843
  │    ├─ gate pass            :7844-7848
  │    ├─ pairwise collisions (uniform grid, P4_typed arrays) :7849-7883
  │    └─ on crossing through x=0 while door.pos>0.2 → doorCrossing(p,dir) :7845-7848
  ├─ auto-jet every 3.5 s when jetP>0 and not FLY_ROLE_REVERSAL :7919-7922
  ├─ tempStats() → {Tl,Tr};  dT = Tl−Tr                      :7884-7891, :7929-7930
  ├─ readSensors(Tl,Tr,doorH) → 7 (or 15 with obs tail)      :7947-7982
  ├─ readVisualField() → 800-bin retinotopic hex field       :8221-8231
  ├─ brainTick(sens, visual, motorIn, exAmp)    :4454, worker path 4454-4502
  │    ├─ worker tick (30 Hz, sim._bw) → brain_worker.js brainTick :194-256
  │    │    ├─ injectLayerChannels(0, s, 12, {start:0..7})    :202
  │    │    ├─ [if DEMON_OBS_ON] obs sub-band injection :204-205
  │    │    ├─ stimPulse burst into AL + optic               :208-216
  │    │    ├─ retinotopic optic drive                       :218-234
  │    │    ├─ direct motor drive: `${motorDrive*0.035}` random injection :236-238
  │    │    ├─ exAmp extra burst to motor layer              :239-240
  │    │    ├─ leak + threshold: V*=0.86, spike@V>30, refractory 3 :242-247
  │    │    ├─ 1-tick synaptic delay propagation: prev[src]-driven V[dst]+=W :250-252
  │    │    └─ modulator EMA (dopa/ser/oct) + DA.v*=0.985 decay :255-272
  │    ├─ updateTraces(sim) — per-synapse coactivity → elig trace E  :258-264
  │    ├─ if (m.lr) applyLearning(sim, m.lr)                 :274-293
  │    │    ├─ d0 = lr*DA.v; mod3rd gains (dopa/ser/oct each up to +0.15)
  │    │    └─ per-synapse W[i]+=d·E[i]·WS·W0b[i], clamp[-WS·W0b,+2·WS·W0b]
  │    └─ return state msg {spikes, dav, mrs, mb, W?, heat?, topK?} :335-404
  ├─ (in-frame fallback path is the exact math in fly_demon_3d.html:4454-4607)
  ├─ worker→page mirror: s.spikes = m.spikes; s.DA.v = m.dav; … :4288-4290
  ├─ updateTraces(); applyLearning(parseFloat(lr.value)*±1)   :7958-7962
  ├─ actuate(dt)      :8243-8256
  │    ├─ MODE==="brain":  door.target = clamp((mrs − mb − 0.02)*12, 0, 1)
  │    ├─ MODE==="random": Bernoulli{0.4 open}, dwell 0.4-1.6 s
  │    ├─ else (human):    door.target = humanDoor||hand ? 1 : 0
  │    └─ door.pos += (target-door.pos)*clamp(dt*8,0,1)    → smoothing only :8256
  ├─ updateIntentAnim — DemonGatekeeper.onDoorRegime(cmd, open) :8454
  ├─ DemonGatekeeper.step(dt) — pure kinematic FSM (no gate authority) :8584
  └─ epTime; EP_LEN=60s episode tick (bestDT reset, ExpUI.nextEpisode) :7973-7978

[crossing event] stepParticles → doorCrossing            :7700-7759
  ├─ q = dir*(T2−v²)/max(T2,1)       ← the REWARD rule
  ├─ sim.DA.v = clamp(sim.DA.v + q*0.6*rewScale, −1.5, +3)
  ├─ sim._stimPulse ≥ 0.7; worker post {type:"reward"， dq, stim} :7711-7715
  ├─ lastCrossGood = q>0; crossGood++/crossBad++
  └─ DemonGatekeeper.onCrossing(q, sp) → STRIKE/RECOIL impulse (kinematics only)

[Log button] chemLogBtn onclick → chemLogging toggle     :11378-11390
  ├─ recording on: chemLogT0=performance.now(); reset buffers
  ├─ frame loop → chemLogTick() every 100 ms (10 Hz cap 7200 rows) :7962, :5428-5475
  │    ├─ gate_open / gate_close event emission (door.pos vs 8% threshold) :5442-5456
  │    └─ chemLogSnapshot() builds the 60-field row        :4871-5059
  │         ├─ sim-level: dT/Tl/Tr, da, ser, oct, motor, motorBase, doorT, doorPos,
  │         │   jet, loco, ntP, jetP/jetAim/noise/doorH/lr/rewScale/expl,
  │         │   mode/nPart/cool, spkN, cg/cb, bestDT, epT, dwL1, dwN
  │         │   (+ dwL1_step/dwN_step per-update increments), per-NT spk/n counts,
  │         │   npTop (top-5 neuropil ‰), demon, verdict, keeper, gateDriver, selAll,
  │         │   selRecent, crossEvent, causal, lastQ
  │         ├─ t (wall s) and t_sim (DemonGatekeeper.simTime − chemSimT0)
  │         └─ REC snapshots: chemLogSnaps(tag) (≤120/side, JPEG 0.8)  :5092-5155
  ├─ recording off: chemLogSave() → one session zip       :5167-5426
  │    ├─ fly_log_<stamp>.json (raw rowsすべて, null=1)
  │    ├─ fly_log_<stamp>.csv (fixed 60-col header, 10 Hz rows)
  │    ├─ events.csv (t_sim, t_wall, event_type, JSON details)
  │    ├─ README.txt (schema contract), fly_path_events.csv
  │    ├─ brain_map_rates.csv (per-neuropil ‰ wide series, from sample 1 with data)
  │    ├─ keeper_performance.csv (1-row proof summary)
  │    ├─ plot_fly_trajectory.png + plot_analysis.png
  │    └─ ExpImage_*/FlyImage_*/PlotFlyPath_*/PlotBrainMap_* JPEG series
  └─ consumer: NOT wired into any code path; everything ships to the browser's Downloads dir
```

**Correct answers to the 14 causal-chain questions** (Q1–Q14, in the prompt's numbering):

| # | Question | Verdict | Evidence |
|---|---|---|---|
| Q1 | Observations contain task-relevant info? | **PARTIAL — the wrong variables are exposed.** Yes: sides' motion energy, gate sensor's fast-particle count, jet envelope, dT are in there, and at 1-index positions 0..6 (exact order [fly_demon_3d.html:7961-7968](fly_demon_3d.html#L7961)). But note: the network gets **Tl and Tr** (position 0,1) as *normalized absolute temperatures* and dT (position 2); and it gets **"gateFast"** — a *speed-histogram of fast particles near the gate* — but **not the sides' particle counts** (lastStats.lN), not the door's own sensor gate, and not any history of prior crossing valence. **VERIFIED IN CODE.** |
| Q2 | Net output affects final gate command? | **Yes — in `brain` mode only, channel-by-channel.** [fly_demon_3d.html:8243](fly_demon_3d.html#L8243): `door.target = clamp((sim.motorRateSmooth − sim.motorBase − 0.02)*12, 0, 1)`. The motor rate drives the target directly, smoothed 0.85/0.15 and baseline-subtracted, which is precisely the learning loop the ledger exposes. `random` and human modes bypass the net entirely. **VERIFIED IN CODE.** |
| Q3 | Reward depends on physical outcome, not a predefined rule? | **Hybrid.** The reward is a function of the *physical* outcome (particle speed vs. side's thermal speed at the gate), but it is a **fixed closed-form rule**, not a learned or environment-defined signal: `q = dir*(T2−v²)/max(T2,1)`, then `DA += q*0.6*rewScale` ([fly_demon_3d.html:7702-7703](fly_demon_3d.html#L7702)). Q does not depend on the neural state, on history, or on the episode goal. **VERIFIED IN CODE.** |
| Q4 | Is dopamine used in the weight update? | **Yes** — [fly_demon_3d.html:4609-4628](fly_demon_3d.html#L4609) and [brain_worker.js:274-293](brain_worker.js#L274). DA enters as the multiplicative teaching scalar `d0 = lr*DA.v`, then an optional third-factor gain `G ∈ [1, 1.45]` from the modulator-source-neuron EMA **adds** to the update magnitude without any sign flip. **VERIFIED IN CODE.** |
| Q5 | Plasticity contingent on activity, reward, or both? | **Both (two-factor).** `updateTraces` sets `E[i] += 0.15` **only when pre and post neurons both fired within the same tick** (with `plastic[i]` and `E[i]<1` caps); decay 0.985/synapse/tick. `applyLearning` scales `d0` by `E[i]` per-synapse. So eligibility = local spiking coincidence, and reward = DA → d·E·… per synapse. **VERIFIED IN CODE** ([fly_demon_3d.html:4617-4623](fly_demon_3d.html#L4617), [brain_worker.js:258-264](brain_worker.js#L258)). |
| Q6 | Weights actually change during a run? | **Yes on eligible synapses** (W[i] is written in place, both backends), and the page's dwL1/dwN/dwL1_step/dwN_step columns are **measured DURING the session** — they wouldn't be measurable otherwise. Note the *sampled* estimator: only every `NE/60000`-th synapse is scanned at 1 Hz (see snapshot comment). **VERIFIED IN CODE.** |
| Q7 | Applied to real connections vs logged_only? | **Real connections** in the worker's sandboxes — `W[i]` is the same array used in the synaptic-propagation loop 1-tick later ([brain_worker.js:250-252](brain_worker.js#L250) reads `sim.W[i]`), and the topKChanged snapshot comes from a ranked scan of the real W. **VERIFIED IN CODE.** |
| Q8 | Changed weights → changed firing → changed motor → changed gate? | **In principle yes, per-tick causality exists** (the propagation loop reads `W` every tick; the motor layer emits per-tick spikes that produce `motorRateSmooth` which feeds `actuate`). **But the channel is one number, rate-based, and its baseline subtraction (`motorBase`, an EMA of the same rate) erases slowly-tracking improvements** — this is exactly the mechanism the ledger's first lever experiment falsified: `dTimp` was unchanged at 3× lr, implying the motor-rate channel cannot express any weight-shifted improvement net of baseline. **VERIFIED IN CODE; empirically PARTIALLY SUPPORTED (leaning no)**, per [APP_LEVER_LEDGER.md:22](APP_LEVER_LEDGER.md#L22). |
| Q9 | Weights retained after episode ends? | **Within-brain-mode yes; across mode switches and resets, no.** EP_LEN handler (:7973-7978) does not touch W; the *"new episode — weights kept"* message phrase is literal. But `btnSwap` role-reversal (:11201-11225) wipes W (all i: W[i]=W0[i]*WS) and DA.v=0. switchDataset (:11095) rebuilds sim from scratch. resetParticles changes N → sim rebuild → W re-derived from circuit.weights. **VERIFIED IN CODE.** |
| Q10 | Saved-then-reloaded with plasticity off? | **NOT IMPLEMENTED.** There is no weight snapshot, no export of trained weights, no `setLearning(false)` toggle surface in the 3D app (the phrase exists in a Stage-2 harness comment only; the app has no lr=0 mode literal, though the UI's `lr` slider at 0 is trivially equivalent). The `random` mode exists for a random control but not "frozen-net, brain dynamics" arm distinct from lr=0. **NOT IMPLEMENTED.** |
| Q11 | Could FSM/hard-coded rule explain behavior without neural learning? | **Yes.** In every non-brain mode the gate is 100% scripted (random Bernoulli or human). Within brain mode the DemonGatekeeper FSM controls *kinematics only* (watch/attend/hold/strike/recoil poses and a few DECORATIVE impulses — it never writes `door.*`). **But** the raw open/close policy in brain mode has a hand-coded `±0.02*12` threshold and a smoothed single rate channel, so a fixed bias in motor rate (e.g. from untrained weights alone) produces a fixed gate *bias* that can look like skill without any synaptic change. No control arm distinguishes this in the browser app. **VERIFIED IN CODE.** |
| Q12 | Exploration mechanism and the variable that consumes `expl`? | **`expl` (thumb-range `ex` sl) is a MOTOR-LAYER ACTIVITY PERTURBER, not an action-policy temperature.** [fly_demon_3d.html:7948](fly_demon_3d.html#L7948): `brainTick(sens, visual, motorIn, MODE==="brain"?exSlVal:0.3)`; in the tick, [fly_demon_3d.html:4596-4601](fly_demon_3d.html#L4596): `for each motor neuron: if random<0.008 && exAmp>0.03: V[i] += exAmp*(24+24*rand)`. This injects motor-layer depolarization that can push spikes; there is no softmax, no value, no `Q(s,a)`, no argmax-with-noise. **VERIFIED IN CODE.** (Worker reads `m.exAmp` the same way.) So `expl` is an exploration mechanism only in the loose sense of "prods the output layer". |
| Q13 | Task reversal: what changes? | **Multi-component, and not a clean variable.** (a) Reward sign in closed-loop brain mode: `applyLearning(parseFloat(lr.value)*(assist?−1:1))` ([fly_demon_3d.html:7961](fly_demon_3d.html#L7961)) — so `assist` flips the WILL the DA pushes weights. (b) The gate policy's channel is unchanged. (c) Not connected to reward: `jetFire` auto-schedule stops under `FLY_ROLE_REVERSAL` (the only perturbation left is initial noise) but `assist` does not stop it. (d) `recording goal` is `assist ? "oppose the demon (fly assists)" : "obey the demon (fly obeys)"` but the goal strings never feed any reward, never set DA sign explicitly, and their change at runtime (UI toggle) is a *user-controlled confound* rather than a within-recording reversal. **VERIFIED IN CODE.** |
| Q14 | Learning from past vs reacting to current state? | **Past only via synaptic weights.** There is no recurrence in the policy beyond the smoothed rate EMA and the eligibility traces (which expose past coincidence). No memory buffer of episodes, no replay, no budget of stored trajectories. DA's 0.985 decay is the only temporal-credit window, and it is ~67-tick half-life ≈ 2.2 s of sim time at 30 Hz — much shorter than the tens-of-seconds that separate a crossing from a later beneficial-gate-state change. **VERIFIED IN CODE.** |

A **causal chain summary**: `crossing q → DA → (E traces) → ΔW → next tick's spikes → motorRate → door.target → physics → crossings` — every arrow exists in code with a single-file proof, and the loop is *closed* only inside `brain` mode. Both the FF and worker rungs exist, and the worker path (default when a FAFB-connectome dataset is loaded on a browser with a healthy worker) is the one that runs in any real session.

---

## 3. Log button inventory — every field that is actually collected/exported

The log chain is: **btn** `chemLogBtn` onclick ([fly_demon_3d.html:11378-11390](fly_demon_3d.html#L11378)) → frame-loop `chemLogTick()` (10 Hz, `chemLogLast` pacing, cap 7,200 rows = 12 min) → `chemLogSnapshot()` builds one row per 0.1 s → recording second-click `chemLogSave()` serializes to a single `fly_session_<stamp>.zip` inside the browser's **Downloads** directory (never inside the repo).

**Sampling cadence facts.** Rows are locked at ≈10 Hz wall-clock (`now − chemLogLast < 100 → return`), i.e. **not 10 Hz simulation time** — the frame loop deposits rows on rAF; `chemLogTick` is called once per frame and rate-limits to 10 Hz of *wall* time. Under `t_sim` (DemonGatekeeper.simTime − sim-origin) the same rows can drift relative to sim time when rAF is throttled — the README discloses that `t/t_wall` are the user-visible authoritative clock and `t_sim` is the shared one; both are emitted per row. **VERIFIED IN CODE.**

**Every recorded row field (fixed header, [fly_demon_3d.html:5293-5297](fly_demon_3d.html#L5293)):**

| # | Field (CSV col) | Exact source variable / computation | Meaning | Units | Evidence |
|---|---|---|---|---|---|
| 1 | `t` | `(performance.now() − chemLogT0)/1000` | wall s since record start | s | **VERIFIED IN CODE** :5004 |
| 2 | `t_sim` | `DemonGatekeeper.simTime − chemSimT0` (0 if chip absent) | shared sim s since record start | s | :5005–5012 |
| 3 | `dT` | `st.Tl − st.Tr` from `tempStats()` | signed temp diff | √(u²/s²)/900 (ad-hoc) | :5013 |
| 4 | `Tl` | `tempStats().Tl = √(left.mean(v²))/900` | left "temperature" | ad-hoc | :5013, :7884-7891 |
| 5 | `Tr` | same, right side | right temperature | ad-hoc | :5013 |
| 6 | `da` | `sim.DA.v` | dopamine envelope | arb (−1.5…+3) | :5014 |
| 7 | `ser` | `sim.modEma.serotonin` | serotonin EMA | 0..~1 | :5015 |
| 8 | `oct` | `sim.modEma.octopamine` | octopamine EMA | 0..~1 | :5016 |
| 9 | `motor` | `sim.motorRateSmooth` | smoothed motor firing rate | spikes/neuron/s | :5017 |
| 10 | `motorBase` | `sim.motorBase` | slow baseline of #9 | same | :5018 |
| 11 | `doorT` | `door.target` | commanded gate regime | 0..1 | :5019 |
| 12 | `doorPos` | `door.pos` | eased physical gate aperture | 0..1 | :5019 |
| 13 | `jet` | `jetPulse` | jet envelope | 0..1 (decay×0.92) | :5020 |
| 14 | `loco` | mean speed /260 | per-particle mean speed scalar | norm | :5021-5022 |
| 15 | `ntP` | `chem.lastNtP` | (legacy) neurotransmitter presence | ? | :5023 |
| 16–21 | `rate_ach/gaba/glut/da/ser/oct` | last bin of `chem.rates[k]` | per-NT spike rate ‰ | ‰ | structurally 0 in brain builds (no nt_name annotations; disclosed in README) — **VERIFIED IN CODE** |
| 22–25 | `jetP, jetAim, noise, doorH` | `parseFloat(el.value)` | gas jet + turbulence + aperture slider settings (user, not measured) | user scalar | :5027 |
| 26–28 | `lr, rewScale, expl` | `parseFloat(el.value)`, `parseFloat(exSl.value)` | UI tuning knobs | user scalar | :5027 |
| 29 | `goal` | assist ? "assist" : "obey" | current reward SIGN frameGoal | string | :5028 |
| 30 | `flyRuns` | `!!FLY_ROLE_REVERSAL` | role-reversal flag | 0/1 | :5028 |
| 31 | `mode` | MODE | brain/random/human | string | :5029 |
| 32 | `nPart` | `P.length` | live particle count | count | :5029 |
| 33 | `cool` | `coolPulse` | cooling-pulse envelope | 0..1 | :5029 |
| 34 | `dwMax` | parsed regex from `#plasticVal` text content at 1 Hz | "top ΔW N% max" UI text | % of clamp span | :5033-5035; **DERIVED FROM THE UI STRING, not the weight array; marked dropped-as-KPI in README** |
| 35 | `spkN` | count of `sim.spikes[i]!==0` | total network active-bit spikes this sample | count | :4897-4899 |
| 36–37 | `cg, cb` | `crossGood`, `crossBad` | cumulative (since load, not since LOG on) good/bad crossings | counts | :5036 |
| 38 | `bestDT` | global `bestDT` | max |dT| ever this page-load | ad-hoc | :5037 |
| 39 | `epT` | `epTime` | seconds into current 60 s episode | s | :5037 |
| 40–41 | `dwL1, dwN` | sampled Σ\|W[i]−signedBaseline\| and count >1e-5 | cumulative plasticity magnitude / # changed | float, count | :4905-4920, sampled stride max(1, NE/60000) |
| 42–43 | `dwL1_step, dwN_step` | first-differences of #40–41 | per-sample plastic flow | — | :4941-4950 |
| 44–49 | `spk_ach … spk_oct` | counts by `chem.ntOf` class | per-NT spike counts | counts | :4951-4962 |
| 50–55 | `n_ach … n_oct` | per-NT totals (structurally 0 in brain) | population sizes | counts | same |
| 56–65 | `np1_name…np5_rate` | top-5-by-‰ neuropils from `chemNpHeatEma` | per-neuropil EMA rates | ‰ | :4885-4902 |
| 66 | `demon` | `DemonGatekeeper.state` | FSM state WATCH/ATTEND/HOLD/STRIKE/RECOIL sample | string | :4934-4937 |
| 67 | `verdict` | `lastCrossGood ? "REWARD":"PENALTY"` | valence of the last crossing since load | string | :4977-4979 |
| 68 | `keeper` | `FLY_ROLE_REVERSAL?"Fly":"Demon"` | whose task | string | :4984-4999 |
| 69 | `gateDriver` | MODE-basis (brain→"Fly brain", random→"Random", human→"You (human)") | who commands `door.target` | string | same |
| 70–71 | `selAll, selRecent` | from `chemKeeperStats` (cumulative / rolling-20) | per-recording crossing-selectivity | % (`100*good/(good+bad)`), nulls to first crossing | same |
| 72 | `img` | 1 when snapshot image exists this row | join to ExpImage/FlyImage/Plot filenames | 0/1 | :5456-5460 |
| 73 | `scene` | names of armed REC regions | which image series | string | :5285-5292 |
| 74 | `causal` | `CausalPanel.events.last6 → "kind@t …"` | last-6 causal-panel timeline labels | string | :4932-4936 |
| 75 | `lastQ` | `CausalPanel.lastCross.q.toFixed(3)` | last crossing's signed q | norm | :4937 |

**JSON payload** equals `meta + rows` with `meta.capture` the schema-versioned prose (schema_version 2.2) and `meta.keeperPerf` the one-row summary + a one-sided binomial-vs-50% z-test using `erfApprox`. **VERIFIED IN CODE** ([fly_demon_3d.html:5240-5272](fly_demon_3d.html#L5240)).

**Every exported file** inside `fly_session_<stamp>.zip`:

| File | Contents | Notes |
|---|---|---|
| `fly_log_<stamp>.json` | `{meta, rows: [every 10 Hz sample]}` | raw, `JSON.stringify(…, null, 1)` |
| `fly_log_<stamp>.csv` | 75-column header + one row per 10 Hz tick | 7,200-row cap = 12 min/session |
| `events.csv` | only *event* rows: `t_sim, t_wall, event_type, details-JSON-string` | event types: `gate_open`, `gate_close`, `crossing` (with `dir/good/q/speed/da`), `startle`, `jet` (with `power/aim`); **NOT** capped at 7,200 but trimmed to last 20,000 |
| `README.txt` | clock contract, schema v2 notes, app-defined learningSuccess rule | correct: it labels its proof criterion as **NOT externally pre-registered** |
| `fly_path_events.csv` | fly avatar's scripted action markers (`startle/jet/push/hold/home`) + `meta.flyPath.path` 10 Hz movement | cosmetic narrative layer |
| `brain_map_rates.csv` | per-neuropil ‰ repr, wide-format, from first row with anatomy | map-smoothed (fast-attack 0.5 / slow-release 0.12) |
| `keeper_performance.csv` | one row: counts, sel variants, dT improvement, dwMaxFinal, z, pOneSided, learningSuccess | **app-defined** success rule (explicitly labeled) |
| `plot_fly_trajectory.png`, `plot_analysis.png` | rendered canvases | presentation |
| `ExpImage_*.jpg / FlyImage_*.jpg / PlotFlyPath_*.jpg / PlotBrainMap_*.jpg` | rendered captures, ≤120 per side, every 5 s | presentation |

### 3.1 Which log-category checkboxes are *actually* satisfied vs missing

**A. Environment/physics** — logged: sim seconds, wall seconds, dT, Tl/Tr, doorT, doorPos, jet envelope, cool envelope, `noise`/`doorH`/`jetP`/`jetAim` sliders, `loco` scalar. **NOT LOGGED**: particle positions/velocities, per-particle side-of-gate attribution, per-crossing rows in the main CSV (they exist only in `events.csv`), **any particle count L vs R** (not even a summary; `loco` is a velocity aggregate, not a partition count — the `fracL` that enters `readSensors` as a feature is **not** exported), **collision counts**, **sim dt**, **random seed** (the app runs entirely on `Math.random()` — **not seeded at all**; reproducibility of a browser session is NOT possible), **episode number** (only inside `epT`, i.e. seconds into the current 60 s block, not a run count). **VERIFIED IN CODE.**

**B. Observations/sensing** — logged *as sim* state, NOT as network input: note `readSensors()` returns the exact 7 features above, but the CSV does not rate-limit what the network sees — there is **no column for `sens[0..6]`** (i.e. `clamp(Tl/40,0,1)`, `clamp(Tr/40,0,1)`, `clamp((Tl-Tr)/20,−1,1)*0.5+0.5`, `fracL`, `jetPulse`, `doorFast`, `1-doorFast`), no `visual[0..799]`, no obs-tail values (kept sequestered by the DEMON_OBS toggle's own design), no lengths/normalization ranges, no sample count per tick. **The exact normalized values delivered to the network are NOT recoverable from the log** (though several are derivable from Tl/Tr/jet/doorH — but only up to the clamp chain and the un-recorded `fracL` and `doorFast` speed-histogram). **NOT LOGGED**, derivable partially. **Sampling:** per frame (~60 Hz) delivered, archived at 10 Hz.

**C. Neural activity/connectome** — logged: `spkN` (total active-bit count), `npTop` (top-5 neuropil ‰ from a map-smoothed EMA), `brain_map_rates.csv` (per-neuropil ‰, one column per real-anatomy neuropil — **all-mapped neuroanatomy present**), `spk_<nt>`/`n_<nt>` (raw per-NT spike counts; rate components structurally 0). **NOT LOGGED**: per-neuron spike bitmap, membrane V, eligibility E, individual W values (only the two sampled scalar estimators), motor-layer spike count in its own column (derivable only as lossy `motor` smoothed global, which is the ackny motor-rate smooth and not the raw rate). Neuron/synapse counts and the FAFB edge-list version are **NOT logged per-session** — they live only in the README/meta of the Stage harness, not in the browser Log zip meta. **PARTIALLY SUPPORTED** as a connectome activity surface. **VERIFIED IN CODE** that what IS logged is computed from real computed arrays (not placeholders).
**Important disclosure found in the neuron trace**: the reported per-neuropil heat is the *smoothed EMA*, not the raw ‰; the raw per-neuron spike array never enters the log. This is fine for visualization, ambiguous for inference (smoothing at 0.5/0.12 changes autocorrelation and effective SNR).

**D. Action/gate control** — logged: `motor` (smoothed), `motorBase`, `doorT` (target), `doorPos` (eased), `keeper`, `gateDriver`, `causal` (last-6 event labels), `demon` (FSM state). **NOT LOGGED**: the **raw motor rate before the smoothing** (`motorRate()` — the worker's `ms` per tick, the unsmoothed pre-EMA value), the pre-clamp `sim.motorRateSmooth − motorBase − 0.02` value (only the clamp output `door.target` is archived), the smoothing constants, or **which neuron invocations changed the command**. FSM transition events between samples are only captured when a 10 Hz row matches a transition (a 0.014%-per-transition observation window at typical session lengths); the demon state's true boundary times are **approximated** by the 10 Hz sampling even though `DemonObs`/accessor state transitions with `seq` exist and are in the DEMON_OBS payload when armed. **PARTIALLY SUPPORTED.**
**Authority**: `actuate()` at [fly_demon_3d.html:8243-8256](fly_demon_3d.html#L8243) is the single writer of `door.target`; it is called from `frame()` when `!window.__appScene.__playing`. The FSM (DemonGatekeeper) never writes `door.*` — **the network (in brain mode) or the mode script has sole authority over the gate, and the FSM has zero part in it.** **VERIFIED IN CODE.**

**E. Reward/DA/learning** — logged: `da` (post-jump value at sample time), `verdict`, `cg/cb`, per-crossing rows in `events.csv` (with `dir/good/q/speed/da` at the crossing instant), `dwL1/dwN/dwL1_step/dwN_step` sampled estimators, `lr`/`rewScale`/`expl` UI values, `goal`, `mode`, `keeperPerf` summary with z/p. **NOT LOGGED**: the *individual* per-synapse ΔW vectors, ΔW total, max ΔW per step, whether a ΔW happened before or after the outcome window, the pre/post neuron ids that created each eligible-trace update, the exact `E[i]` at update time, whether mod3rd gained or was zero, the exact ±DA before-and-after the crossing within the 100 ms sample window (only the smoothed post-value), the 1-tick synaptic delay's carry (no record of the previous tick's spikes that actually drove the update), and the **clipping** boundaries (only derivable from constants in code). **NOT LOGGED.**
The weight-state continuity across episode boundaries within a session is not logged **and not directly checkable** from the log — only `dwL1` cumulative growth implies monotonicity across the 60 s tick boundary in a mental reconstruction, but there is no epoch marker in the main CSV beside the `epT` wrap (eT resets to 0 while records continue, which does allow the *epochs* to be inferred post-hoc by scanning epT resets). **PARTIALLY SUPPORTED.**

**F. Export integrity** — good: single zip, one download prompt, schema contract in README, sim-clock joins (`chemEventRowT` guarantees exact `t_sim` equivalence of rows and events; **VERIFIED IN CODE**), no overwrite of the same session (date-time stamp), no partial rows (`chemLogBuf` length-guarded). Weaknesses: **no file-hash / size cap metadata** inside the zip beyond schema_version; `csv rc` includes `causal` and `scene` string fields that can contain commas, not uniformly escaped for all locales; **`dwMax` parsed from a UI text node** is a measurement-by-parsing hazard (the 300%-of-bound artifact is called out in the README as noise) — a good example of why the audit should not trust UI text as data.

### 3.2 Categories and severity (Top omissions for a learning demonstration)

1. **Untrained control** — no per-session network-state recording (weights at t=0, weights at t=T) → cannot distinguish "learned" from "untrained baseline". **Critical.**
2. **Raw (unsmoothed) motor rate column** → cannot attribute the door target to specific spike events or measure reaction latency. **High.**
3. **Sent exact observation vector** → cannot re-run offline or do state-dependence analysis. **High.**
4. **Episode index + per-epoch dT trajectory + pre/post phase tags** → the app has no "pre/post" notion; the harness has it and the app does not. **High.**
5. **Individual synapse ΔW per step (or at least k topK per step with post values).** For ~553k synapses, even a per-step top-100 with signed magnitude would let you test whether the ΔW population tracks the outcome rather than the EMA. **Medium.**
6. **`sim._bwLastDt` actual dt** — behavior scales by this, not recorded. **Low.**
7. **Particle L/R count** (`lastStats.lN`, `lastStats.rN`) — a basic sorting measurement; not archived. **Medium.**
8. **Random seeding** — `Math.random()` everywhere means a browser session cannot be reproduced even from the same recorded trajectory; the harness runs are seeded (Stage-2 pins both env and network seeds per-pair), the browser app is not. **Medium.**

---

## 4. Learning-rule analysis (exact implemented equations)

**Constants.** `WS = 0.02` ([fly_demon_3d.html:4219](fly_demon_3d.html#L4219)); update clamp `W ∈ [−W0·WS, +2·W0·WS]` for every synapse, **including inhibitory** (top-of: `plastic[i]=1` for all fast edges, `P0: eligibility is not gated on sign`, [fly_demon_3d.html:4217-4218](fly_demon_3d.html#L4217)). Fast edges only: modulatory edges are filtered out of `fastEdges` and kept as `modEdges` for third-factor EMA.

**Eligibility trace** ([fly_demon_3d.html:4617-4623](fly_demon_3d.html#L4617) and [brain_worker.js:258-264](brain_worker.js#L258), identical):
`E[i]*=0.985`; `if (plastic[i] && spikes[src[i]] && spikes[dst[i]]) E[i] = min(E[i]+0.15, 1)`.
→ single-tick coincidence (pre and post in the same tick), 1.5% per-tick decay.

**Weight update** ([fly_demon_3d.html:4609-4628](fly_demon_3d.html#L4609), [brain_worker.js:274-293](brain_worker.js#L274), identical math modulo signed-baseline transports):
```
d0 = lr · DA.v                       ; lr = lr-slider × (assist ? −1 : +1)
G  = 1 + 0.15·min(1, modEma_k)       ; k ∈ {dopamine, serotonin, octopamine}
d  = d0 · G                          ; one scalar for the whole network
for i:  W[i] += d · E[i] · WS · W0b[i]   if E[i] ≥ 0.01 and plastic[i]
        clamp to [−WS·W0b[i], +2·WS·W0b[i]]
```
`W0b` = the original circuit edge-weight transport for each synapse (page's `sim.W0`, worker's init payload `w0`).

**Order per tick** (worker): `brainTick` (spikes) → `updateTraces` (E) → `applyLearning` (if m.lr) → publish state. So the update at tick t uses E(t) (which was already built from spikes(t), not spikes(t−1)) and DA(t) (the value **after** the most recent crossing pulse within the window). The reward arrives asynchronously in a `type:"reward"` message (posted from `doorCrossing`), so DA(t) merges both (a) the 0.985-decayed carry from previous tick and (b) any fresh q-pulse — no fixed ordering between weight update and reward within the same tick. **VERIFIED IN CODE.**

**Learning rate:** the ONLY consumer of the `lr` slider is the tick's `lr` value — which also multiplies `assist` (audit-q-13) but is otherwise unmodified. At `lr = 0` the entire loop short-circuits at `|d0| < 1e-5`. **VERIFIED IN CODE.**

**Exploration:** `exAmp` is passed as the fourth brainTick arg with limb range 0.03..~0.9 and bumps motor-layer V by up to `0.9*48 = 43.2` (threshold = 30) at rate ≤0.008/motor-neuron/tick. It drives exploration *inside the spiking substrate*, not a policy distribution. **VERIFIED IN CODE.**

**DA equation:** `sim.DA.v = clamp(sim.DA.v + q·0.6·rewScale, −1.5, +3)`; decays ×0.985/tick. The `rewScale` slider (default 1.5) is per-crossing and **not part of the learning-rate path** (only Q and rewardScale change DA, and DA only scales ΔW).

**Which synapses can change and which are fixed:**
- All **`fastEdges`** (non-modulatory) — 553,807 of the FAFB circuit — are marked plastic.
- **Modulatory edges** are NOT in the W array at all; they never change.
- **No structural pruning/adaptation** — topology is frozen; only scalar W changes.
- The **motor→gate interface itself is not a synapse** — it is a hand-coded scalar readout (`motorRateSmooth`); plasticity can change motor firing *rate* only indirectly via the connectome's afferent weights.

**Weight persistence:**
- Across 60-s episodes inside brain mode: **kept** (`"new episode — weights kept"` message, handler at :7973-7978 doesn't touch W or DA).
- Across dataset switches / `resetParticles` count change: **re-derived from the circuit**; W0 = fresh.
- Across `btnSwap` (role reversal): **explicitly wiped**: `for all i: W[i] = W0[i]*sim.WS; DA.v = 0`, plus a `type:"reset"` post (…the worker's `reset` message does **not** appear as a separate handler in brain_worker.js — see [audit note below in §6](#6-gate-control-analysis)); **the W reset happens on the mirrored `sim.W` array and the DA reset on `sim.DA.v`, but the worker keeps its own W0b and its own running `S.W` on the discrepancy** — because the worker is not initialized by the swap, `applyLearning` continues to run from the worker's UNRESET `S.W`. **CANNOT DETERMINE from the code alone whether the intended "fresh memory" actually lands in the running sim** (the worker's `S.W` is only ever reset by re-`init`, which the swap does not trigger. This is a genuine **CANNOT DETERMINE** close to a defect — logged here as an *observation, not a suggested fix*).

**Evidence labeling:**
- Learning rule exists and runs per tick, is mathematically two-factor, real-synapse-sited: **VERIFIED IN CODE.**
- Any *measured effect* of it on behavior in the browser app: **NOT ESTABLISHED** (see §7).
- Split-brain state after `btnSwap` (worker-side W unreset): **CANNOT DETERMINE** without runtime A/B; flagged.

---

## 5. Gate-control analysis

The chain is: motor-layer spike count → `motorRateSmooth` (0.85/0.15 at tick rate) → `motorBase` (slow-adapting baseline at 0.1·dt) → `door.target = clamp((mrs − mb − 0.02)*12, 0, 1)` → `door.pos += (target-pos)*clamp(dt*8,0,1)` → physics uses `door.pos` for the gate band and the crossing test.

- **Who commands the gate, by mode, exact code:** `brain` → the network's smoothed motor rate minus a slow-moving self-calibrating baseline; `random` → a Bernoulli timer (0.4 Open, dwell 0.4–1.6 s), no brain; human → hand-tracked pinch or a click toggle, no brain. `actuate()` is the **only** writer of `door.target`; it is unconditionally called each frame (outside apparatus-stage replays) at [fly_demon_3d.html:7985](fly_demon_3d.html#L7985). **VERIFIED IN CODE.**
- **DemonGatekeeper never touches `door.*`.** It reads door regime for pose only (onDoorRegime at :2298-2304, called from updateIntentAnim at :8454) and reacts kinematically to crossings. It cannot open or close the gate — it can *pose* and *lunge* to the aperture but `Swagger`-impulses are velocity-only. **VERIFIED IN CODE.**
- **Is the neural pathway causally effective?** On paper, yes — `mrs` depends on motor-layer spikes, which depend on W (adjacent-tick via the 1-tick synaptic delay), which depend on all past E and DA. So synaptic changes *can* move `door.target`, all else equal. But (i) there's no guarantee of a *meaningful* mapping (task-relevant vs noise); (ii) the gate-only pathway is a single scalar from a transient rate — any learned structure must survive EMA smoothing **and** baseline adaptation; (iii) the baseline adapts with a time constant `1/(0.1·dt)` ≈ 10 s — much longer than a crossing but shorter than typical skill acquisition, so it can partially cancel improvements built slower than that. **PARTIALLY SUPPORTED** on causal effectiveness; **cannot certify skill formation** (per §1 lever-ledger evidence).
- **EXPL knob effect** is indoor: it perturbs the motor layer directly (44-depolarization bursts ≤0.8%/tick), *upstream* of the clamp — genuinely on the same channel as plasticity. **VERIFIED IN CODE.**

**Distinction from the FSM**: the FSM (DemonGatekeeper, 50 lines of kinematics + a `setState` helper with a strike/recoil impulse) never reads `sim.*` outside its own crossing-q/sp, never reads or writes `door.*` except as a *report*, and it never acts on particles or on the gate state. **The FSM is a spectator-kinematics layer on top of the apparatus; it is neither a controller nor a policy.** Its only influence on the closed loop is *indirect*: the demon's scripted `jetFire` auto-schedule (left-side heating) stays on in brain mode (unless role-reversal), which is a *thermostat* different from the network's own choice — i.e. the demon-lit chamber itself is a scripted interactor in the session's thermal history. **VERIFIED IN CODE.**

---

## 6. Reward-reversal analysis — what "task switch" changes

The reward-reversal hover (goal flips assist/obey) toggles exactly **one** code path: the global variable `assist`, which only appears at [fly_demon_3d.html:7961](fly_demon_3d.html#L7961) as the sign multiplier on the learning rate:
`brainTick` payload `lr: parseFloat(lr.value)*(assist?−1:1)`.
Everything else — the gate rule, the DA rule's sign, the motor injection, the exploration burst, the normalization — stays identical.

That has direct consequences:
1. **Weights re-usable?** yes, symmetrical — the SAME plastic pathways get taught the opposite direction on the same eligibility traces.
2. **The reward rule not reversed.** `q` and `DA += q·0.6·rewScale` do **not** flip sign: a "good for the demon" crossing is a *decrease* in DA when assist is on — the reward is inverted in its **effect**, not in its definition. Working behaviorally as intended, but a writer-in has to know the sign convention; recorded `verdict` (REWARD/PENALTY) is computed from `q` only and **never flips** with `assist` — this is a subtle inconsistency in the export: a "PENALTY" row can be a weight-*positive* event under `assist=true`. **VERIFIED IN CODE; this asymmetry is NOT documented in the README.**
3. **Goal string is UI-only** — `goal` in the row and meta (`assist?"oppose the demon…"`) is a descriptive label, not an input to any sim variable. **VERIFIED IN CODE.**
4. **Role reversal (btnSwap)** is *separate* from assist/obey: it is the mode reset described in §4 (wipe W and DA, retire the demon, auto-jet off, force brain mode). **The reward-reversal question is conflatable with role reversal** — they share an educational metaphor but are independent code paths. The ledger's pre-registration history (demon/obs/readSensors etc.) records this nuance explicitly.

---

## 7. Existing-log assessment

The browser-zip log family (above) is *not* in the repo — it goes to the user's Downloads. Inside [research_data](research_data) two other families exist:

**(A) App-side lever records** (small JSON preregs + a few CSV/JSONL artifacts) — e.g. [app_prereg_lr.json](app_prereg_lr.json), [app_prereg_dtlever.json](app_prereg_dtlever.json), [sheat_experiment_2026-10-08](research_data/sheat_experiment_2026-10-08/), [twodoor_experiment_2026-10-08](research_data/twodoor_experiment_2026-10-08/); their verdicts are honestly recorded as zeros/null effects in [APP_LEVER_LEDGER.md](APP_LEVER_LEDGER.md).

**(B) Stage-1 pilot** — [research_data/stage1_trials_2026-10-08T06-57-01.jsonl](research_data/stage1_trials_2026-10-08T06-57-01.jsonl), 5,415 rows, one JSON object per `(condition, seed, phase, trial)`; row fields: condition, seed, networkSeed, topologySeed, runId, phase (`pre|train|test`), phaseIndex, trial, steps, plannedEpisodeSeconds, `frozenPre` + `frozenPreSeconds`, crossings, goodCrossings, badCrossings, energyJ, jetWorkJ, demonAgree, demonDecisions, openFraction, dTfinal, **sortEntropy**, spatialH, **miNeural**, workInJ, measuredBits, erasureCostJ, extractableJ, landauerRatio, weightDrift (row-level), goodBadRatio, durationSeconds.
The manifest [stage1_manifest_2026-10-08T06-57-01.json](research_data/stage1_manifest_2026-10-08T06-57-01.json) carries arm definitions (armA real connectome; B restricted; C degree-preserved shuffle; D matched random sparse; E random-action floor), frozen-pre guarantees, and hashes. Gate-0 checker output in [PRE_REGISTRATION_STAGE2.json](PRE_REGISTRATION_STAGE2.json) §gate0 confirms prephase `weightDrift === 0` on all rows and the arms' ΔY(A−D) band. **This is a real, pin-guarded dataset.** **VERIFIED IN EXISTING LOGS.**

**(C) Stage-2 confirmatory run (in flight)** — [research_data/stage2_runs](research_data/stage2_runs): a job directory per (pair, group) with a `DONE.json` (config hash, seeds, arm list) and a gzipped `stage1_trials_*.jsonl` (the Stage-2 rep uses the same benchmark.js row schema). Status as of last progress row: **618 DONE / 263 FAILED** of 881 dispatch entries; `PRE_REGISTRATION_STAGE2.json` pins the config sha, seed table, permutation references, and the 100k-resample, stratum-balanced permutation analysis. Note the job-level failures — the audit **does not** validate the Stage-2 design or its robustness; that is out of scope here.

**What current logs can and cannot establish (user Part 4 list):**

| Question asked | Browser zip | Stage-1/2 harness rows | Verdict |
|---|---|---|---|
| Performance before/after training | no pre/post phase in the app; only per-session selAll/selRecent (post only) | yes — `pre`/`train`/`test` phases with `frozenPre` weight freeze | harness: **VERIFIED IN EXISTING LOGS**; browser app: **NOT LOGGED** |
| Performance across training episodes | possible post-hoc from 60-s epT resets, but no per-episode outcome values | trial-level rows in train phase | **PARTIALLY SUPPORTED** (harness), **NOT LOGGED** (browser) |
| Weight changes across time | sampled dwL1/dwL1_step (estimator, not exact) | weightDrift row-level (binary/summary, not size) | **PARTIALLY SUPPORTED** both |
| Neural activity ↔ motor output | npTop/brain_map_rates vs `motor` — correlations possible, but neuron-level not recorded | miNeural (a single scalar aggregate) | **PARTIALLY SUPPORTED** browser, **NOT IMPLEMENTED** as a proper analysis |
| Motor output ↔ gate movement | `motor` → `door.target` fully derivable, timely at 10 Hz | openFraction per episode only | browser: **VERIFIED IN CODE** (derivable) |
| Particle outcomes → reward → weight updates | events.csv crossing rows give (q, da at instant); the weight-update response is only the cumulative dwL1 | benchmark.js runs the loop per episode; row schema has no per-crossing data | **PARTIALLY SUPPORTED** browser, not in harness |
| Retention with frozen weights | no control; `lr=0` sessions are possible but no UI mode set or tag exists in the export | `frozenPre` in harness rows gives the *pre-phase* freeze | harness: **VERIFIED IN EXISTING LOGS**; browser: **NOT IMPLEMENTED** |
| Adaptation after task reversal | verdict + goal columns exist; no within-recording reversal was logged in any wired analysis | out of scope (estimand is sortEntropy) | **NOT LOGGED** |
| Random / human / FSM-only baselines | `mode` (random/human/brain) IS archived; no FSM-only distinction (FSM is never a gate driver) | arm E random-action floor; arm D no-op connectivity topological diagnostic | **PARTIALLY SUPPORTED** browser (random/human exist, no FSM-driver), **VERIFIED IN EXISTING LOGS** for the harness arms |

**Enough for a learning claim? No.** The harness rows carry `(pre vs post)` design intent and `weightDrift` freeze guarantees but sample small-N (pilot 3 pairs; Stage-2 confirmatory 800 pairs planned, still running). The browser zip (current) cannot re-test the loop offline; its 10 Hz, 12-min cap and its unsampled/JSON-summary-only weight state cannot answer the 14 causal-chain questions directly. **The minimum additional fields needed to make the browser log learning-testable** are ranked in §8.

---

## 8. Missing instrumentation — ranked list

Each entry is field-by-field, with the exact place the field must be recorded (code references for future changes only — **no changes implemented now**).

**Tier 1 (blocking for any learning claim)**

1. **Network-input vector, exact 7 (or 15) columns, per row** — record `sens[0..6]` (and the 8 `obs_[*]` when the DEMON_OBS toggle is on) at `readSensors()` [fly_demon_3d.html:7947-7982](fly_demon_3d.html#L7947). Store into `chemLogSnapshot` row → new CSV columns `s0..s6` (or `s0..s14`). **N=7 (15) scalars per 10 Hz row; a few bytes**.
2. **Raw motor rate, unsmoothed (pre-EMA)** — record `motorRate()/max(dt,1e-3)` before the EMA step in the worker's publish path [_bwTick internal] or the in-frame block at [fly_demon_3d.html:7957-7962](fly_demon_3d.html#L7957). CSV column `motorRaw`. This is the variable that actually sets `door.target` at clamp time — needed to measure the loop gain, the reaction latency, and (post-hoc) whether a given spike burst did or did not move the gate.
3. **Pre/post weight snapshots per session, finite-size** — record at LOG-start and LOG-save: (a) `Σ|W[i]|` (sum), (b) `Σ|W[i]−W0b[i]|` (the already-computed dwL1 magnitude but taken FULL-N, not sampled), (c) the top-K (K = e.g. 100) `(src,dst,ΔW)` triples. This is what the Stage harness calls weightDrift; the browser app can compute it once per session — not per tick — at nearly zero cost.
4. **Crossing event stream** already exists (`events.csv`); ADD at least `fracL` (left-particle fraction at crossing time) and `lastStats.lN/rN` — the physical sort measure, currently un-exported. Source `lastStats` at [fly_demon_3d.html:7885-7890](fly_demon_3d.html#L7885).

**Tier 2 (needed for a clean reversal / frozen test)**

5. **Frozen-net arm tag in the row schema**: add `lr_effective` (the tick payload value actually sent) as its own column, distinct from the *setting* `lr` — currently `lr` is recorded but not `assist`-signed. This makes the sign of the actual update visible in post-hoc analysis, closing Q13's asymmetry confusion.
6. **Within-episode marker**: the 60 s episode tick at [fly_demon_3d.html:7973](fly_demon_3d.html#L7973) — emit a `chemEvent("episode_end")` (already wired for gate_open/gate_close, three lines) so the CSV rows partition into episodes without inference from `epT` resets. Also record `trial == n` per episode as its own row.
7. **Worker-side state echo**: publish `m.dav` post-update separately from pre-update, and `m.ticksSinceLastReward` — currently `dav` is a snapshot, not a per-tick reward decomposition.

**Tier 3 (nice-to-have for a full offline replay)**

8. **dt actually used (`sim._bwLastDt`)** — one column, per row. Currently unexported.
9. **Timestep parity token**: pass the frame's real dt into `chemLogTick` (the frame loop's dt is variable), so 10 Hz rows can also be re-paced by dt-weighted integration (Part 5).
10. **Session RNG state** — record `Math.random()` entropy or seed `Math.random` from a per-session random seed at boot (currently a browser session is not reproducible at all, including the physics).
11. **Top-K per-tick** — the worker already computes `topKChanges(S.W, S.W0b, S.isExc, TOPK_LIMIT)` every 12th tick and ships it as `msg.topK`; the page consumes it for the visual weight overlay ([brain_worker.js:370-387](brain_worker.js#L370)) but **discards it for logging**. Buffering that stream into the log would give a real per-tick learning trace at near-zero cost.

**Minimum experiment plan that current instrumentation already supports (§9), plus the browser additions it would need.**

The Stage-2 harness already includes the right arms: **A** (real connectome, plastic), **B** (restricted synapse subset), **C** (degree-preserved shuffle), **D** (no-op topological diagnostic, real edge list with swapFactor ≤ 0), **E** (random-action floor). At the browser-app level the missing arm is **"untrained reference"** — trivially implementable by adding `lr=0` to the session header and disqualifying `lr` from mid-session edits, but **not there yet**.

---

## 9. Minimal experiment plan (browser app; no changes made here)

| # | Arm | Procedure | Look-up | Uses existing instrumentation? |
|---|---|---|---|---|
| 1 | **Baseline / untrained** | fresh page load → LOG on for a fixed 12 min in brain mode, lr at the default, note `dwL1/dwN` rise; repeat N=5 sessions | selRecent trajectory + dwL1 growth | yes (auto-jet off manually or role-reversal) |
| 2 | **Trained-then-frozen** | the same session, then set `lr` (slider) to 0, restart LOG, 12 min again | selRecent during frozen phase vs 1 | needs **#5 in §8** to be unambiguous; otherwise the `lr`=0 is user-visible in `lr` column |
| 3 | **Random control** | MODE = random, LOG 12 min | selRecent against chance-50% | yes (`mode` column) |
| 4 | **Human control** | MODE = human with the hand tracking, 12 min | n/a (ceiling) | yes |
| 5 | **FSM-only** | not available — the FSM does not command the gate | — | **NOT IMPLEMENTED** (would need a new mode; out of scope) |
| 6 | **Reversal** | toggle `assist` mid-session (`events.csv` jet markers at the toggle), LOG across the toggle | selRecent before/after | partially; the verdict/asymmetry of §6 must be handled manually |
| 7 | **Cross-session save/load of weights** | not implementable today (no weight snapshot) — SKIP unless Tier-1 #3 lands | — | **NOT IMPLEMENTED** |

Acceptance for the reversal arm: **same-session, same-seed-analogue reversal, with lr=0 or arm-identical dims on both sides** — everything else (page restarts, mode toggles, particle-count changes) invalidates the comparison.

---

## 10. Recommended code changes — *NOT IMPLEMENTED, audited for later*

(This is a ranked list of future changes; per instruction **none of them have been applied**.)

| # | File(s) | Function(s) | Change |
|---|---|---|---|
| R1 | fly_demon_3d.html | readSensors / chemLogSnapshot | add `s0..s6` row columns (network input vector); keep zero-diff OFF-path byte identity per prior-audit practice |
| R2 | brain_worker.js | publish path (`state` msg) | add `mrRaw` (unsmoothed motor rate before EMA) to the payload; page stores to row `motorRaw` |
| R3 | fly_demon_3d.html | chemLogSave | full-N `dwL1_full`, `sumW`, topK snapshot at LOG start and save |
| R4 | fly_demon_3d.html | doorCrossing / chemEvent | add `fracL`, `lastStats.lN/rN` to the crossing event details |
| R5 | fly_demon_3d.html | frame() episode branch | emit `chemEvent("episode_end")` + add a `trial` row field |
| R6 | fly_demon_3d.html | frame() tickPayload path | record `lrSigned` (the assist-flipped value actually sent) as its own column |
| R7 | brain_worker.js | `reset`-type message | actually implement the worker-side `S.W` reset (or document the discrepancy; currently the btnSwap reset path posts `type:"reset"` but the worker has **no reset branch**, see §4 — flagging this as an audit finding, not a present-day failure because Σ\|ΔW\| on the *page-side* `m.W` mirror remains honest; but a future plasticity run in reversed mode on a page whose worker was restarted is inside this uncertainty) |
| R8 | fly_demon_3d.html | boot | seed `Math.random()` from a recorded per-session seed and export it in meta |
| R9 | brain_worker.js | worker weight publish | log the topK stream into the session (buffer, sample every 12th tick is already what's computed) |
| R10 | *_app logs | meta.dataset | add connectome id/dataset version/n neurons/edges (currently only implied) |

Each R# above is small, additive, and — per the ancestry of previous app-lever cycles in APP_LEVER_LEDGER.md — would need a per-change regression harness (OFF-path byte-identity, worker tick protocol checks, smoke green), the same pattern used for the maintained 3D-and-worker app changes. No levers should be reopened without that.

---

## 11. Scientific claim assessment

| Claim | Status | Why |
|---|---|---|
| **"connectome-constrained"** (FAFB, 106,765 neurons / 553,807 edges) | **VERIFIED IN CODE** for the spiking, injection, plasticity and weight arrays (all `N`/`NE`-sized, edge-sited); **VERIFIED IN EXISTING LOGS** for the harness, where [PRE_REGISTRATION_STAGE2.json](PRE_REGISTRATION_STAGE2.json) §circuit pins n_neurons=106765 and n_edges=553807 and wiring fingerprint. **PARTIALLY SUPPORTED** as a *behavior claim* simply because synaptic plasticity is applied to those edges uniformly — connectome-constraint of the *learned* pattern is a hypothesis, not a finding. |
| **"learns"** | **NOT ESTABLISHED** in the browser app's own evidence. The rule is real (§4) and operational; the measured selectivity/dT/e2e metrics in [APP_LEVER_LEDGER.md](APP_LEVER_LEDGER.md) and the Stage-1 pilot agree the observable improvement is **not distinguishable from chance/untrained in the app's regime** — with the Stage-1 arm contrasts small and inconsistent (Gate-0 numbers: `A−D 0.0177 ± 0.0232`, `A−B −0.0029 ± 0.0024`, `A−C 0.0354 ± 0.0557`, all n=3). **PARTIALLY SUPPORTED** as an *existence-of-a-learning-mechanism* claim; **NOT ESTABLISHED** as *behavioral-learning* claim. |
| **"acts as a Maxwell demon"** | **NOT ESTABLISHED** in the strict Szilard/Feynman sense. What works: dT ≠ 0 builds reliably under the scripted left-side auto-jet and persists for long windows under brain policy (harness rows carry dTfinal, sortEntropy > 0). What's absent: (i) no accounting that net work extracted > Landauer/memory cost is demonstrated at behavior level (row-level `landauerRatio` exists in the harness [Row 1: landauerRatio ~51.8–3869 — a ratio much greater than 1 in these rows is artifact-prone since erasureCostJ is orders below extractableJ; treat carefully — this is disclosed in the stage protocol's Landauer accounting section, which is out of scope here]); (ii) no agent-level counterfactual control (the network never *chooses* between Green/Red regimes — its actuator is a single gate scalar). The honest posture is also the app's own: the README and keeperPerf criterion are **labeled** as app-defined, not pre-registered; and the closed-lever ledger's own conclusion is that the motor→gate channel is, so far, **outside the reachable learning loop**. |
| Sub-claim **"the browser Log data are sufficient to demonstrate learning"** | **NOT LOGGED** — no; see §7 and §8. |

---

## 12. Closure on the temperature metric (Part 5)

**Implementation check** ([fly_demon_3d.html:7884-7891](fly_demon_3d.html#L7884)):

```js
let lN=0,lS=0,rN=0,rS=0;
for (const p of P){ const v2 = p.vx²+p.vy²+p.vz²;
  if (p.x<0) { lN++; lS+=v2; } else { rN++; rS+=v2; } }
const lm = lN?lS/lN:1, rm = rN?rS/rN:1;      // empty side defaults to 1 — NOT 0
const K = 1/900;
return { Tl: sqrt(lm)*K, Tr: sqrt(rm)*K };
```

Findings:
1. `Tl/Tr` are **side-RMS speed divided by 900, not thermodynamic temperature**. That scaling is an app convention; the amplitude mapping to Kelvin is not documented in code and the 900 constant has no physiological/physical derivation in the file. **VERIFIED IN CODE**, physically underived.
2. Signed `dT = Tl − Tr` **is retained** (`dT` in the main CSV is signed; `keeperPerf`'s `dTvMax` uses its absolute value, and bestDT uses `dT>bestDT` — meaning `bestDT` records the **positive-signed max**, so persistent right-hot phases aren't tracked by bestDT). **VERIFIED IN CODE.**
3. The empty-side default `lm=1/rm=1` (= "T = 1/900 if empty") is a non-neutral fallback: an empty side reports a warmer temperature than a side at rest only if the populated side's mean v² > 1 — typically true, but the asymmetry can flip the sign of dT when one side is empty and the other is near zero, which is a documented edge case of no importance in the normal regime but can pollute dT-based trajectories when specific episode resets empty one side.

**Metric J** = (1/T)·∫₀ᵀ |T_L(t) − T_R(t)| dt:

- **Can be computed from existing logs, but only from the browser zip** (`fly_log_*.csv` has `dT` at true 10 Hz with `t` wall-clock stamps), **not from the harness rows** (only `dTfinal` endpoint, and `demonAgree`/`sortEntropy` summary — per-step trajectories are not in the harness row schema).
- **Numerical integration**: use the **trapezoidal rule in wall-time** on the paired columns `t` and `dT`: `J = Σ (t_{i+1} − t_i)·(|dT_i| + |dT_{i+1}|)/2 / (t_last − t_first)`. Because samples are 10 Hz and near-uniform in wall-time, this is effectively the rectangle sum with a small correction; exact dt is available in the `t` column. **Using `t_sim` instead of `t` for this integral is valid only after confirming the rAF pacing didn't drop a row** (the log's `t_sim` series can jump when frames are dropped; `t` never does — both clocks are exported so the choice is a data-quality-quiet decision, not a semantic one).
- **Signed difference also available**: `dT` (signed) piecewise-integrable → ∫dT dt = net gradient; the |∫| vs ∫| | comparison is a *polarization index* (does the demon keep the same side hot consistently?).

Caveat on `bestDT` in the app: [fly_demon_3d.html:7933](fly_demon_3d.html#L7933) uses `dT>bestDT` (positive-only tracking) and it is reset to 0 at every 60-s episode boundary — i.e. **`bestDT` in the CSV row is a within-episode, positive-only tracker, NOT a run-level or J-like quantity**; when reading the log, never substitute it for J. The audit explicitly distinguishes J (from log dT series), dTvMax (within a session, abs), bestDT (within-episode, signed-only, reset per episode), and the harness `dTfinal` (endpoint at pre/final/post phase boundaries) — none of these are interchangeable.

---

## 13. Itemized answers to the 14 continuing causal-chain questions (final, evidence-classed)

1. Task-relevant info present: **PARTIALLY.** The 7 inputs are task-shaped (`dT`, fraction-left, jet, gate-fast-particles) but **omit sides' particle counts and dT's history** — the latter matters since a naive policy can act on `dTi` alone.
2. Output → gate: **VERIFIED IN CODE** (brain mode).
3. Reward from physical outcome: **VERIFIED IN CODE** (a fixed rule of the crossing, not a predefined outcome class).
4. DA in weight update: **VERIFIED IN CODE.**
5. Plasticity contingent on both: **VERIFIED IN CODE** (two-factor; eligibility from coincidence; scalar DA).
6. Weights change during run: **VERIFIED IN CODE** (writes to W).
7. Applied to real connections: **VERIFIED IN CODE** (the same W used in propagation).
8. Changed weights → changed actions: **PARTIALLY SUPPORTED in code**, and the levers' dTimprove-stays-flat history on live sessions is evidence **against** a strong effective coupling in practice.
9. Weights retained across episodes: **VERIFIED IN CODE** within brain-mode episode ticks; reset on dataset switch and on the worker-vs-page asymmetry in `btnSwap` (the worker's own `S.W` is NOT reset — see R7).
10. Save/reload-with-plasticity-off: **NOT IMPLEMENTED.**
11. FSM could explain behavior alone: **No — the FSM never drives the gate.** The *policy circuit's bias* could: a fixed motor-rate offset or persistent untrained-mode high-rate plateau could harness the same lever even with W unchanged, and there is no control arm in the browser log to rule it out. (Stage-2's arm D is designed precisely for that at the harness level.)
12. Exploration: **VERIFIED IN CODE** as a motor-layer depolarization (`exAmp`), not policy stochasticity.
13. Reversal effect: **VERIFIED IN CODE** as the lr sign flip ONLY (`assist`); the da-rule, gate rule, and verdict strings do **not** flip; the goal is UI-only; the effect is mutually exclusive with role reversal (which is a different toggle).
14. Learning from past vs current-only reaction: **PARTIALLY.** Only weights and eligibility retain history; DA decays to baseline within ~2.2 s; there is no cross-episode memory metaph。 the system is a stateless policy on a slowly-changing weight substrate.

---

## 14. Notes on what I did NOT do

I did not open the browser GUI, I did not run a session (no session zip was available in the repo to be read offline), and I did not re-run any Stage-1/2 simulation. Where the auditouched "browser behavior", it is anchored in code reading only — **CORRECTLY labeled as VERIFIED IN CODE, never VERIFIED IN EXISTING LOGS**. Log-derived conclusions are drawn only from [research_data](research_data) artifacts (Stage-1 pilot rows and manifests, Stage-2 progress + job packages, prerequisite files' own recorded hashes).

The remaining sources that would strengthen this audit most:
- A **`.zip` Log session file** from a real session (drag into the repo or share via a pastebin): once I have one, Part 4's "browser-zip can it test" column becomes data-based.
- The **Stage-2 complete dataset + stage1_analyze.js** output at-history → not analyzed here; out of scope for this audit (the confirmatory analysis itself is pre-registered in [PRE_REGISTRATION_STAGE2.json](PRE_REGISTRATION_STAGE2.json))."
