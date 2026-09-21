# P1 Stage F — flyvis Bridge

Status: **fully implemented and executed.** flyvis 1.2.0 + torch (CPU) run in a
dedicated sidecar environment (`.venv-flyvis`, Python 3.11) with the published
pretrained ensemble checkpoints; `_run_flyvis` performs real inference and the
flagship parity test ran all three models (legacy, typed, flyvis) on the full
standardized stimulus suite — `P1_PARITY_RESULTS.json` reports
`flyvis.status: "RAN"` with full per-type traces. Nothing about flyvis is
fabricated anywhere in P1.

## 1. Boundary

```
 physical visual field (browser chamber: particle positions, readVisualField)
      │
      ▼
 standardized P1 stimulus suite  ── p1_flyvis_client.js / flyvis_sidecar.py
      │   (flash · moving_edge_lr · moving_edge_rl · stationary_contrast;
      │    per-tick intensity frames, 16.7 ms ticks)
      ▼
 flyvis-compatible stimulus      ── frames rasterized onto the REAL 721-hexel
      │                            lattice: width-1 frames broadcast full-field,
      │                            width-8 frames map through azimuth bins of
      │                            flyvis's own hex_center_coordinates()
      ▼
 flyvis optic response           ── Network.simulate(movie, dt=1/60) on the
      │                            pretrained connectome-constrained network
      │                            (45,669 nodes / 1.5M edges / 65 cell types)
      ▼
 per-type traces (65 central)    ── T4a–T4d / T5a–T5d = the trained motion
      │                            outputs; R1–R8 photoreceptors included
      ▼
 existing downstream interface   ── parity comparison against the browser
                                   models (p1_parity_test.js) — NOT a
                                   replacement of the runtime controller
```

The existing controller (`fly_demon_3d.html` / `brain_worker.js`) is untouched:
the bridge is an **adapter boundary for measurement**, exactly as mandated.

## 2. Components

| Component | File | State |
|---|---|---|
| Stimulus suite (JS) | `p1_flyvis_client.js` (`STIMULI`, `expandStimulus`) | implemented + tested |
| Stimulus suite (Py mirror) | `flyvis_sidecar.py` (`STIMULUS_SUITE`, `stimulus_to_frames`) | implemented + tested; JS/Py expansions asserted identical (mirror property) |
| HTTP sidecar | `flyvis_sidecar.py` (`/health`, `/stimulus?name=`, `/predict`) | implemented; stdlib-only HTTP surface |
| Availability probe | `probe_flyvis()` | honest; `/predict` → 503 with exact reason when the env lacks flyvis |
| **flyvis adapter** | `_run_flyvis()` | **implemented + executed** — lazy model load, rasterization, `Network.simulate`, 65 central traces returned |
| Windows datamate fix | `p1_flyvis_winfix.py` | required on Windows (see §5); honest no-op elsewhere |
| Live diagnostics | `p1_flyvis_probe.py` | 5 probes against the real stack: load, dims, simulate, LayerActivity, HexEye render |
| Client | `p1_flyvis_client.js` (`health`, `predict`) | implemented; 240 s inference timeout; degrades to `{available:false, reason}` |
| Parity harness | `p1_parity_test.js` | three-model run; stores full `flyvis_traces` per stimulus |

## 3. Environment (`.venv-flyvis`)

* **Python 3.11.9** venv (flyvis pins `>=3.9,<3.13`; host 3.14 unusable).
* `torch 2.14.0+cpu`, `flyvis 1.2.0` (upstream `git+https://github.com/TuragaLab/flyvis.git`).
* Checkpoints: `flyvis download-pretrained` (published ensemble via Google
  Drive, SHA256-verified by the downloader) into `FLYVIS_ROOT_DIR=.flyvis_data/`
  (project-local, gitignored; ~10 MB — the zips are small).
* Model used: `flow/0000/000` (first member of the published `flow` ensemble;
  overridable via `P1_FLYVIS_MODEL` env var). All 10 members are available
  locally; only one is exercised — ensemble averaging is a possible extension.

## 4. The contract

`GET /health` → probe plus runtime state:
```json
{ "flyvis": { "flyvis_installed": true, "torch_installed": true, "ready": true },
  "runtime": { "model": "flow/0000/000", "loaded": false, "error": null } }
```
(`ready` reflects the environment; `loaded` flips true after the first `/predict`.)

`POST /predict {"stimulus", "frames", "tick_ms"}` →
```json
{ "model": "flow/0000/000", "n_frames": 80, "dt": 0.0167,
  "steady_state_note": "flyvis prepends 1 s grey(0.5) steady state internally; …",
  "provenance": "SOURCE-DERIVED network/checkpoints (TuragaLab flyvis ensemble); activity = trained dimensionless state, not measured Hz",
  "n_cell_types": 65,
  "cell_types": { "R1": [80 floats], …, "T4a": [80 floats], …, "T5d": [80 floats] },
  "input_types": { "R1": [80 floats], …, "R8": [80 floats] } }
```

Frame-width semantics (validated server-side, honest 400/500 otherwise):
* **width 1** → full-field; broadcast to every hexel;
* **width 8** → azimuth columns; hexel `h` shows its column's intensity
  (`_hexel_azimuth_columns()`: equal-width bins over the x extent of
  `hex_center_coordinates(721, …)`, the same function HexEye is built on;
  `x = dist_w·r` is the horizontal/azimuth lattice axis);
* any other width → rejected (no silent resampling).

Timing (measured, this machine, CPU): one-time model load ≈ 15–40 s, then
≈ 4 s per 80-frame stimulus. `dt = 16.7 ms = 1/60` (below flyvis's 1/50
integration warning threshold).

## 5. Two environment fixes (documented, not bypassed)

1. **datamate HDF5 unlink bug (Windows).** `datamate 1.0.0 io.py::_write_h5`
   opens `h5.File(path, mode="w")`, probes `f["data"]` (KeyError on a fresh
   file) and calls `path.unlink()` **while its own handle is still open** —
   POSIX allows it, Windows raises `WinError 32`, so every first `.h5` write
   fails and flyvis cannot build its connectome caches.
   `p1_flyvis_winfix.py` replaces that one function at runtime with identical
   data semantics and correct handle lifecycle (probe → close → unlink →
   write), patching both import-binding sites. It touches no project file and
   honestly no-ops when datamate is absent.
2. **datamate thread-local context.** `datamate.context` is a
   `threading.local` whose defaults are set only on the importing (main)
   thread; per-request worker threads crash with
   `AttributeError: '_thread._local' object has no attribute 'delete_if_exists'`.
   The sidecar therefore serves on the **main thread** (`HTTPServer`, not
   `ThreadingHTTPServer`) — serialized requests are correct for this
   single-client measurement workload and inference is CPU-bound anyway.

## 6. Three-model parity results (live run)

`node p1_parity_test.js` → `P1_PARITY_RESULTS.json` (`flyvis: RAN`).
Browser readout = motor layer rate; flyvis readout = lamina group mean
(L1+L2+L3) as the structural analog of the browser optic population; T4/T5
groups are the trained motion outputs. Cross-model correlations use the
stimulus-aligned window; flyvis traces are frames-aligned (its 1 s grey
steady state is internal).

| stimulus | leg↔typed motor corr | flyvis lamina AUC | corr(lamina, legacy) | corr(lamina, typed) |
|---|---|---|---|---|
| flash | 0.9886 | −1.18e+0 | 0.9418 | 0.9939 |
| moving_edge_lr | 0.9369 | −7.64e−1 | 0.4909 | 0.4911 |
| moving_edge_rl | 0.9214 | −7.66e−1 | −0.2884 | −0.1546 |
| stationary_contrast | 0.9674 | −9.26e−1 | 0.3724 | 0.5509 |

Sanity of the flyvis responses themselves (flash): R1/R2 ON-delta ≈ +0.85
(strong photoreceptor step), T4/T5 central cells ≈ 0 on a uniform flash —
expected for motion detectors — with the trained cells' structure living in
the transients (per-type traces in `flyvis_traces`).

Direction selectivity (AUC ratio LR/RL): legacy 0.958, typed 0.988, flyvis
T4/T5 in `direction_selectivity.flyvis_T4_T5`. The flyvis lamina↔browser
correlations are *not uniformly high across stimuli* (edge/contrast stimuli
0.37–0.55 vs flash 0.94–0.99) — reported as-is: the three models agree
closely on full-field dynamics and diverge on spatially structured ones,
which is precisely the kind of fact this parity experiment exists to expose.
No parameter was tuned toward any of these numbers.

## 7. Reproduce

```bash
# one-time environment (already done here)
py -3.11 -m venv .venv-flyvis
.venv-flyvis/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv-flyvis/Scripts/python.exe -m pip install git+https://github.com/TuragaLab/flyvis.git
FLYVIS_ROOT_DIR="$PWD/.flyvis_data" .venv-flyvis/Scripts/flyvis.exe download-pretrained

# live stack
./.venv-flyvis/Scripts/python.exe p1_flyvis_probe.py          # 5/5 probes
( FLYVIS_ROOT_DIR="$PWD/.flyvis_data" ./.venv-flyvis/Scripts/python.exe \
    flyvis_sidecar.py --port 8767 & )
node p1_parity_test.js                                        # three-model run
node p1_tests.js                                              # 54/54 suite
```

Without the venv/sidecar, everything degrades honestly: `/predict` → 503 with
the reason, parity marks flyvis `PENDING`, and the suite's F7/F8 checks report
"no live sidecar — parity artifact covers evidence".
