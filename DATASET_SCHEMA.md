# DATASET_SCHEMA — C-3 unified experiment datasets (build-plan row 9)

One standardized, reproducible dataset format for every experiment run.
Version: **schema v1**. Module: `dataset_export.js` (zero dependencies).
Wired into: `e6_batch_validate.js`, `e9_batch_validate.js`,
`e10_e11_batch_validate.js`. Every run of those scripts emits a
`<experiment>_dataset_<stamp>.csv` + `.manifest.json` pair into
`research_data/`.

## Files (atomic pair, shared stamp)

| File | Content |
|---|---|
| `<name>.csv` | RFC-4180 CSV, one row per trial; CRLF line endings; deterministic bytes |
| `<name>.manifest.json` | schema v1 manifest describing exactly that CSV |

The manifest pins the **sha256 + byte length** of its CSV: a torn or
tampered pair is detectably inconsistent (`verifyDataset()` in
`dataset_export.js`; T5/T7 in `tests/dataset_export.test.js`).

## Column schema

- **Meta columns first, fixed order:** `experiment, condition, phase,
  seed, trial` (e6 uses `seed` = global replicate id, re-based from chunk
  provenance; `seedTag` remains as a data column).
- **Then the union of numeric/boolean row fields, sorted alphabetically**
  (uniform across all rows of the run; missing values are empty cells).
- **Excluded by design:** display payloads (`fireVec` base64 blobs,
  `layerRates` maps, `vec/n/total`) — UI artifacts, not data. The exclusion
  list is recorded in every manifest (`excluded_fields`).
- Non-numeric, non-meta fields (free text notes) are excluded from columns
  by the same rule.

## Manifest fields (schema v1)

`schema_version, experiment, label, question, created_utc, protocol,
config (full CLI/config echo: seeds, seedBase, stride, trials, episode
seconds, particles, variants, engine), conditions, n_rows, n_conditions,
columns, meta_columns, excluded_fields, csv_file, csv_sha256, csv_bytes,
git_revision, git_dirty`.

Timestamps live ONLY in the manifest: the same rows always produce
byte-identical CSVs (determinism, T6), so the CSV is the reproducible
artifact and the manifest is its provenance envelope.

## Reproduce a dataset

```js
const DX = require("./dataset_export.js");
const v = DX.verifyDataset("research_data/<name>.csv",
                           "research_data/<name>.manifest.json");
// v.ok === true  -> the CSV is byte-exactly what its manifest describes
```

CSV → pandas: `pd.read_csv(path)` (RFC-4180, UTF-8, CRLF).

## Coverage / status

| Experiment | Exporter | Rows | Notes |
|---|---|---|---|
| E6 jet-closure | `e6_batch_validate.js` | per-trial, all conditions | live-verified (320 rows x 35 cols) |
| **E9 pressure (legacy + corrected pairing)** | `e9_batch_validate.js` | per-trial, all variants | **live-verified (2 × 1440 rows x 41 cols; C-8)** — one dataset per credit pairing (`config.pairing`); JSONL hygiene: `fireVec` never persisted |
| **E10/E11 trapdoor + ratchet** | `e10_e11_batch_validate.js` | per-trial, all 9 core variants (neural + frozen + physics probes, same seeds) | **live-verified (5760 rows x 56 cols; C-8)** — single-pass export (no re-simulation); 4x-reduced frozen-control rows are analysis-only |
| **E2 ANN + E3 Drosophila** | `e2_e3_batch_validate.js` | per-trial, all 4 conditions | **live-verified (3200 rows x 26 cols; C-4)** |
| **E4 connectome A/B/C + frozen** | `e4_batch_validate.js` | per-trial, all 6 arms | **live-verified (C-5)** |
| **E5 comparator (7 controllers, paired gas)** | `e5_comparator.js` | per-trial, all controllers | **live-verified (3360 rows; C-6)** |
| **E7 regimes + E8 information arms** | `e7_e8_batch_validate.js` | per-trial, all 6 conditions | **live-verified (2880 rows x 26 cols; C-7)** — E7 gas per condition via per-call `_physics` (manifest `config.e7_regimes`); E8 arms share one 320p/0.12 call (`config.e8_gas`); `config.e8_structural_audit` records the mem4-inert identity |
| **C-9 analysis layer (consumer)** | `nature_analysis.js` | — | reads the production datasets above (all `verifyDataset` OK; smoke-scale same-tag artifacts excluded; e9 split by `config.pairing`), emits `research_data/paper_digest_c9.json` + `nature_analysis_report.html` with preregistered families, effect sizes, Holm, ablations, and doc-value traceability (`docPinned`) |
| E1 | `experiment_worker.js` UI runs | — | same engine (`runBenchmark`); exporter wiring is mechanical follow-up |
| Phase 3B (MuJoCo) | `tools/phase3_behavior_experiment.js` | per-step trajectories | JSON artifact already carries manifest + trajectories; CSV export optional follow-up |

## Stage-3 demon-observation registered arm (row fields + manifest)

The Stage-3 registered arm (`demonObs`) extends the SENSORY INPUT ONLY — the
DA rule (q·0.6·rewScale), `actuate()` and the door reflex are untouched.
When an arm's flag is OFF (or the config declares no flag anywhere) **no
field below appears**: OFF rows and OFF manifests are byte-identical to the
pre-arm runner (verified byte-for-byte against the pre-change golden
fixtures in `tests/fixtures/stage3_demonobs_off/` by
`tests/stage3_demonobs_parity.test.js`).

Per-trial-row fields, present only when the arm carries the flag:

| Field | Meaning |
|---|---|
| `demonObsOn` | `true` — the arm ran with the obs tail appended to `readSensors()` (base 7 → 15) |
| `demonObsGain` | obs-tail injection gain into the reserved sub-band (config `demonObsGain`, default 12 = browser `DEMON_OBS_INPUT_GAIN`) |
| `obsBandLo` / `obsBandHi` | reserved sub-band `[(0.86·L), L)` of connectome input layer 0; FAFB L = 2875 → `[2472, 2875)` |
| `obsBandNeurons` | size of that band (FAFB: 403) |

obs sensor ordering (exact, mirrors `fly_demon_3d.html demonObsVector()`):
base 7 channels, then obs_0..obs_4 = one-hot FSM state (WATCH, ATTEND, HOLD,
STRIKE, RECOIL), obs_5 = `timeSinceAction` = clamp((simTime − last state
transition)/2 s, 0, 1) (1 before any transition), obs_6 = `goodRate` = mean
of the rolling last-20 crossing valences with cumulative fallback and a 0.5
prior, obs_7 = `gateCmd` = `door.target` clamped to 0..1. The FSM is the
deterministic headless replica `experiment_core.makeDemonFsm()` (DemonGatekeeper
semantics; consumes no rng).

Manifest block (benchmark `--config` mode), present ONLY when at least one
arm carries the flag: `demonObs = { on: true, gain, armGains, arms[], band:
{ lo, hi, neurons, inputLayer }, sensorVector, inputBand, scope }`. Config
schema: top-level `demonObs` (boolean, default false, browser checkbox
parity) and `demonObsGain` (number 1..24, default 12), each overridable per
arm; validated by `tools/stage3_config_check.js` (stage2-style validator).

## Tests

`tests/dataset_export.test.js` (7): RFC-4180 escaping, column-union order,
display-payload exclusion, manifest fields, sha256/byte-length tamper
detection (both length-changing and equal-length edits), determinism, and
live on-disk dataset verification.
`tests/stage3_demonobs_parity.test.js`: env-FSM unit contract,
runBenchmark per-arm row stamping, OFF-path byte parity vs the pre-change
golden fixtures, and the ON-arm FAFB band `[2472, 2875)` on rows + manifest.
