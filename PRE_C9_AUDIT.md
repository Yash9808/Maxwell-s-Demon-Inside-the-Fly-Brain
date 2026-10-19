# Pre-C-9 Audit — Implementation Status, Working/Not-Working, Live Positioning Checks

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Method: **read-only**. No engine, validator, controller, test, or schema file
was modified. Live behavior was checked with a throwaway probe script
(short deterministic runs of each untouched core, ~40 s total) which was
**deleted immediately after** — the workspace is byte-identical to before
the audit apart from this report.

## 1. Implementation status table (build-plan ladder)

| Row | Item | Status | Where / evidence |
|---|---|---|---|
| 3 | Phase 3B items 0–6 (RNG reset, seed semantics) | **CLOSED (C-2)** | `PHASE_3B_APPROACH.md` + C-2 addendum; `PHASE3_RNG_RESET=1`, eval_after == eval_before byte-exact |
| 8 | E9 first pass (Sept) | Superseded | `e9_batch_2026-09-2*.jsonl` (legacy pairing null; re-run properly in C-8) |
| 11, 12 | E2 ANN, E3 drosophila | **DONE (C-4)** | `E2_E3_C4_RESULTS.md`; E2 beats random p=0.019; E3 collapse (openFrac 0.000, p≤1e-5, replicates E3R2) |
| 13 | E4 connectome A/B/C | **DONE (C-5)** | `E4_C5_RESULTS.md`; structure NULL (p=0.65–0.81), drift signatures distinct |
| 14 | E5 comparator (7 controllers, paired) | **DONE (C-6)** | `E5_C6_RESULTS.md`; paired gas; drosophila only sig. loser (p_holm=0.011) |
| 15 + 8 | E6 jet-closure | **DONE (C-1)** | `PHASE_C_E6.md`; NULL (p=0.23–0.83) with live machinery (drift 1.43e3 vs exactly-0 frozen) |
| 16 | E7 generalization sweep | **DONE (C-7)** | `E7_E8_C7_RESULTS.md`; gradient established, all pairs p_holm<0.01; per-event efficiency inverts |
| 17 | E8 information-limited | **DONE with caveat (C-7)** | adaptive-vs-fixed NULL p=0.175; `memSize` arm structurally inert (write-only buffer) — pinned in tests + manifest audit |
| 18 | E9/E10/E11 onto unified schema | **DONE (C-8)** | `E9_E10_E11_C8_RESULTS.md`; **E9 corrected pairing establishes learning (p=2.5e-7)**; E10 accuracy +0.056±0.019 (17/20); E11 second-law safe |
| 20 | C-3 unified datasets | **DONE** | `DATASET_SCHEMA.md`; 7 dataset families, all `verifyDataset` OK (e6, e2_e3, e4, e5, e7_e8, e9 ×2, e10_e11) |
| **24** | **Nature analysis layer (effect sizes, CIs, ablations, preregistered comparisons)** | **NOT STARTED — this is C-9** | Pre-C-9 tooling exists (`tools/make_nature_figures.py`, `tools/build_nature_manuscript.py`) but consumes the OLD artifact paths, not the C-3 schema; no effect-size/Holm cross-experiment layer |
| **21** | **E12 transfer (Flybody↔demon)** | **DEFERRED — untouched (verified)** | grep for E12/transfer files: zero hits. Only `embodiment/` MuJoCo sidecar assets from Phase 3B, which are row-3 scope, not E12 |
| **23** | **LLM designer** | **DEFERRED — untouched (verified)** | grep for llm/designer: zero hits anywhere in the repo |

## 2. What's working / not working (by experiment, from recorded results)

**Working (established, verified):**
- Apparatus physics end-to-end: deterministic (7 determinism gates all
  IDENTICAL across C-7/C-8), all metrics populated, E7 regime gradient,
  E11 second-law bookkeeping (negative signed work at equilibrium).
- Classical demon: sorts above chance in all 3 gas regimes without
  re-tuning (E7); dominates every neural arm on throughput+quality (E5/E9);
  exactly reproduces across validators (E5 classical == e7_default row).
- E2 ANN: beats random (p=0.019), volume leader of the comparator.
- E9 neural valve UNDER CORRECTED PAIRING: real learning vs frozen
  (reward p=2.5e-7, accuracy p=8.6e-8, agreement p=4.9e-9; TRAIN→TEST
  improves −6.82→−5.39). Isolation clean: frozen arms byte-identical across
  pairings.
- E10: accuracy learning +0.0560 ± 0.0187 (17/20 seeds, CI excludes 0).
- C-3 schema + exporter/verifier: 7 families live-verified with sha256.

**Not working / honest nulls (must be reported as such in C-9):**
- E6: neural does NOT beat frozen at the apparatus (p=0.23–0.83).
- E4: connectome structure (4A/4B/4C) makes no behavioral difference
  (p=0.65–0.81).
- E3: drosophila controller collapsed (openFraction exactly 0, 20/20 seeds).
- E7: per-event sorting efficiency (dT, sortEntropy) DECREASES with gas
  density — policy generalizes, efficiency does not scale.
- E8: adaptive threshold does not beat fixed (p=0.175) and costs more
  measured bits; the memory-limited arm cannot bind (write-only buffer).
- E9/E11 under any pairing: neural still far below the classical reference;
  E11 shows no learning and no work extraction (law-safe).
- Known engine quirks: `demonDecisions` dead field (see §3),
  classical `demonAgree` self-agreement degeneracy, sub-display erasure
  costs (~4e-21 J/bit), `landauerRatio` >> 1 regime-dependent.

## 3. LIVE positioning check (probe run this session — 15/15 PASS)

The probe re-ran each core briefly and verified the demon and the fly are
**positioned where the experiment says and acting as intended**:

| Check | Result | Evidence |
|---|---|---|
| Apparatus: demon at gate plane x=0, acts on gas | PASS | crossings=9 (good=6), openFrac 0.544 |
| Jet agitation at left wall, drives gas toward gate | PASS | auto-jet fired on cadence (599 fires/12 s equivalent cadence check), door at pos 0 |
| Never-gate holds door shut | PASS | openFrac=0, crossings=0 |
| Random gate ~intermediate opening | PASS | openFrac 0.253 |
| **Fly brain live at the gate (E6/E5 family)** | PASS | motor-layer spikes (motorHz>0), miNeural=0.002, internal demonAgree=0.56 — the fly is sensing, spiking, deciding |
| E9: classical valve ≥ never-open (reward floor) | PASS | reward 0.00 vs 0.00; classical acc 0.59 |
| E9: neural valve live (spikes + plasticity) | PASS | spikeRate>0, weightDrift 5.4, valveFlips 38.3/trial |
| E9: piston apparatus streams state | PASS | onState kind=pressure (with burnSeconds=0; default 10 s burn gates streaming — see quirks) |
| E10: trapdoor floor present + fluctuating | PASS | trapdoorAngle 0.000, fluct 0.592 |
| E10: fly gatekeeper counts L/R crossings | PASS | crossLR 2.00, crossRL 1.33 |
| E10: decision telemetry live | PASS | acc 0.624, pgReleaseP 0.480 |
| E11: wheel state live | PASS | ratchetAngle −3.403, liftFraction 0.444 |
| E11: pawl decisions engaged | PASS | pgEngageP 0.509 |
| E11: second-law bookkeeping | PASS | entropyProduction 1.902, signed work −1.87e-22 J |
| E8: adaptive vs fixed arms distinct at matched gas | PASS | vThr 90.9 vs 120.0, crossings 3 vs 4 |

**Positioning verdict: PASS everywhere.** In every experiment the demon/
classical reference sits at the gate/valve/pawl it is supposed to operate,
and the fly brain is attached to the right actuator (gate / valve / trapdoor
/ pawl) with live sensing and plasticity. No misplacement, no wrong-actuator
wiring.

**Two engine quirks surfaced by the audit (documented, NOT fixed — read-only):**
1. `demonDecisions` is a **dead 0-field** in `runBenchmark` (initialized at
   line 415, never incremented; the `lastAction` hook exists only on
   classical/saboteur). It is 0 for every controller in the C-5/C-6/C-7
   datasets — including the classical demon. Harmless (the same episodes'
   `measuredBits`, `motorHz`, `openFraction`, `demonAgree` carry the real
   decision telemetry), but C-9 must not use this column.
2. `onState` streaming is gated by a default 10 s BURN
   (`burnSeconds`, line 728) — analysis rows are unaffected (they use
   `onTrialData`), only the live-HUD stream is gated.

## 4. Conclusion and plan

**GO for C-9.** All in-scope rows (3, 8, 11–18, 20) are DONE and verified;
rows 21/23 remain properly deferred with zero leftover code; every
experiment's live positioning/behavior checks pass; the seven C-3 datasets
are the correct, verified input layer.

C-9 plan (row 24 — Nature analysis layer), to execute next:
1. New analysis module (no engine changes) reading the C-3 CSVs+manifests:
   per-experiment effect sizes (Hedges g / paired where the design allows),
   exact CIs, Holm correction across each preregistered comparison family.
2. Preregistered comparison list written FIRST (from the results docs, no
   re-picking): E6 neural-vs-frozen; E2 ANN-vs-random, ANN-vs-classical;
   E4 4A-vs-4B/4C/frozen; E5 all-pairs; E7 regime gradient; E8
   adaptive-vs-fixed; E9 corrected neural-vs-frozen, neural-vs-classical;
   E10 accuracy delta; E11 second-law audit.
3. Ablation table limited to what the data already supports (E4 structure
   arms, E8 information arms, E9 pairing contrast, E7 regimes).
4. Regenerate figures from the unified schema (extend the existing
   `make_nature_figures.py` conventions; do not fork the schema), then the
   manuscript digest (`paper_digest.json`) + docx via
   `build_nature_manuscript.py`, with every number traceable to a
   sha256-pinned dataset manifest.
5. Honest-claims policy: report the nulls above as nulls; no re-analysis
   after unblinding; any engine-quirk-affected column (e.g. demonDecisions)
   excluded and noted.
