# Script Archive Index

**Created:** 2026-09-20 · **Archived scripts:** 117 · **Deleted: none**

The repository root accumulated ~110 one-off patch/check/probe/smoke scripts during
rapid development. All were moved to `archive/` — **nothing was deleted**. Scripts
that produced current production artifacts are explicitly marked. None of these
scripts are referenced by the app, tests, or CI.

## Layout

- `archive/untracked/` — scripts that were **never tracked by git** (local scratch). Include in a release archive only if provenance of the current artifacts is needed.
- `archive/_*.py|_.js` — were tracked; moved with `git mv` (history preserved).
- `archive/backup_anatomy_0851/` — snapshot of the anatomy assets before a rebuild (superseded).
- `tools/rebuild_anatomy.py` — NOT archived: it is the README-documented generator of `fly_brain_positions/hulls/meta` (renamed from `_rebuild_anatomy.py`; references updated).

## Disposition legend

| Tag | Meaning | Still needed? |
|---|---|---|
| PRODUCED-CURRENT-* | contributed code that exists in current production files | keep for provenance |
| LINEAGE-APP | intermediate steps in the 3D app's patch history | optional (provenance) |
| APP-SNAPSHOT | full copies of the app extracted for syntax checks (large!) | NO — safe to delete (three are ~40 MB each) |
| AUDIT-HELPER | one-shot structural audits | no (concept lives on in `tests/`) |
| DEBUG-PROBE | tiny DOM/state probes | no |
| EARLY-TEST | early smoke tests | no (superseded by `tests/run_smoke.js`) |
| ONE-OFF-FIX / BENCH-HELPER / EXPERIMENT-RUNNER | self-descriptive | no |
| TEMPORARY | default for unaudited scratch | review before release |

## Scripts that produced current production artifacts (keep)

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_patch_chat12_worker.py` | 4,465 | PRODUCED-CURRENT-WORKER | run_custom chat protocol in experiment_worker.js |
| `archive/untracked\_patch_e3_mbon.py` | 9,935 | PRODUCED-CURRENT-CORE | E3 drosophilaController anatomical upgrade (controllers.js) |
| `archive/untracked\_patch_exp14_core.py` | 16,763 | PRODUCED-CURRENT-CORE | first apparatus-core rewrite of experiment_core.js (E9/E10/E11 cores) |
| `archive/untracked\_patch_exp14_core2.py` | 16,985 | PRODUCED-CURRENT-CORE | apparatus-core rewrite, generation 2 |
| `archive/untracked\_patch_exp14_core3.py` | 831 | PRODUCED-CURRENT-CORE | thermo/erasure accounting in apparatus cores |
| `archive/untracked\_patch_exp14_core4.py` | 6,164 | PRODUCED-CURRENT-CORE | apparatus particle/wall geometry |
| `archive/untracked\_patch_exp14_core4b.py` | 363 | PRODUCED-CURRENT-CORE | apparatus core fragment |
| `archive/untracked\_patch_exp14_core5.py` | 5,677 | PRODUCED-CURRENT-CORE | valve slot geometry |
| `archive/untracked\_patch_exp14_core6.py` | 2,393 | PRODUCED-CURRENT-CORE | demon decision/valve logic |
| `archive/untracked\_patch_exp14_core7.py` | 4,152 | PRODUCED-CURRENT-CORE | one-way valve + Maxwell walls |
| `archive/untracked\_patch_exp14_core8.py` | 3,037 | PRODUCED-CURRENT-CORE | thermal wall generation |
| `archive/untracked\_patch_exp14_core9.py` | 4,947 | PRODUCED-CURRENT-CORE | _thermoWalls implementation |
| `archive/untracked\_patch_exp14_plots.py` | 11,072 | PRODUCED-CURRENT-PLOTS | apparatus behavior panels in experiment_plots.html |
| `archive/untracked\_patch_exp14_stage.py` | 21,927 | PRODUCED-CURRENT-APP | 3D stage/HUD for apparatus experiments |
| `archive/untracked\_patch_exp14_worker.py` | 4,376 | PRODUCED-CURRENT-WORKER | apparatus experiment wiring in experiment_worker.js |
| `archive/untracked\_patch_exp14_worker2.py` | 3,703 | PRODUCED-CURRENT-WORKER | apparatus curve blocking |
| `archive/untracked\_patch_exp14_wthr.py` | 1,289 | PRODUCED-CURRENT-WORKER | app_state streaming throttle (patch 17) |
| `archive/untracked\_patch_plots11.py` | 15,701 | PRODUCED-CURRENT-PLOTS | per-region firing-change maps |
| `archive/untracked\_patch_plots11_ctrl.py` | 3,438 | PRODUCED-CURRENT-CORE | decision telemetry in classicalDemon (controllers.js) |
| `archive/untracked\_patch_plots11d.py` | 2,765 | PRODUCED-CURRENT-PLOTS | region-rate memory |
| `archive/untracked\_patch_plots11e.py` | 2,260 | PRODUCED-CURRENT-PLOTS | dot/hull layering |
| `archive/untracked\_patch_plots11f.py` | 3,475 | PRODUCED-CURRENT-PLOTS | hull tint rendering |
| `archive/untracked\_patch_plots11g.py` | 1,598 | PRODUCED-CURRENT-PLOTS | firing-delta dots |
| `archive/untracked\_patch_plots11h.py` | 2,250 | PRODUCED-CURRENT-PLOTS | delta thresholding |
| `archive\_bw_poolsync_patch.py` | 2,899 | PRODUCED-CURRENT-WORKER | brain-worker pool sync |
| `archive\_bw_watchdog_patch.py` | 1,822 | PRODUCED-CURRENT-WORKER | brain-worker watchdog |
| `archive\_gen_payload.js` | 2,693 | PRODUCED-CURRENT-DATA | generated research_data/_payload_e*.json fixtures |
| `archive\_gen_payload_e10.js` | 2,697 | PRODUCED-CURRENT-DATA | generated E10 payload fixture |

## App patch lineage (keep for provenance; optional at release)

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_patch_3d.py` | 1,905 | LINEAGE-APP | anatomical-view readability |
| `archive/untracked\_patch_3d10.py` | 10,139 | LINEAGE-APP | TrueFly-glb loads fly.glb |
| `archive/untracked\_patch_3d10b.py` | 3,720 | LINEAGE-APP | TrueFly-glb scale corrections |
| `archive/untracked\_patch_3d10c.py` | 747 | LINEAGE-APP | brainDebug hook (later reverted) |
| `archive/untracked\_patch_3d10c_revert.py` | 752 | LINEAGE-APP | revert of 10c |
| `archive/untracked\_patch_3d10d.py` | 789 | LINEAGE-APP | trueflyDebug hook |
| `archive/untracked\_patch_3d11.py` | 3,406 | LINEAGE-APP | brand animation embed |
| `archive/untracked\_patch_3d12.py` | 1,738 | LINEAGE-APP | lab rename copy |
| `archive/untracked\_patch_3d13.py` | 1,722 | LINEAGE-APP | hero badge animation |
| `archive/untracked\_patch_3d14_labplay.py` | 9,616 | LINEAGE-APP | per-lab play buttons |
| `archive/untracked\_patch_3d15_nolag.py` | 8,518 | LINEAGE-APP | UI jank fix while experiments run |
| `archive/untracked\_patch_3d18_framesim.py` | 4,245 | LINEAGE-APP | per-frame cost reduction |
| `archive/untracked\_patch_3d19_worker.py` | 9,190 | LINEAGE-APP | brain worker (brain_worker.js) extraction |
| `archive/untracked\_patch_3d2.py` | 1,808 | LINEAGE-APP | stage/actor separation |
| `archive/untracked\_patch_3d20_perfhud.py` | 5,372 | LINEAGE-APP | perf HUD |
| `archive/untracked\_patch_3d3.py` | 2,232 | LINEAGE-APP | framing |
| `archive/untracked\_patch_3d4.py` | 2,904 | LINEAGE-APP | brain stage geometry fix |
| `archive/untracked\_patch_3d5.py` | 7,250 | LINEAGE-APP | activity-jet colors + glow edges |
| `archive/untracked\_patch_3d6.py` | 6,591 | LINEAGE-APP | MCNS switch UX |
| `archive/untracked\_patch_3d6b.py` | 1,503 | LINEAGE-APP | rAF fallback for deferred switch |
| `archive/untracked\_patch_3d6c.py` | 1,135 | LINEAGE-APP | integrity refresh + NaN-proof tint |
| `archive/untracked\_patch_3d7.py` | 16,158 | LINEAGE-APP | per-condition brain maps in plots |
| `archive/untracked\_patch_3d8.py` | 8,481 | LINEAGE-APP | TrueFly-glb mode (CT-scan fly) |
| `archive/untracked\_patch_3d9.py` | 1,316 | LINEAGE-APP | plots button placement |
| `archive/untracked\_patch_chat12_lab.py` | 16,486 | LINEAGE-APP | Chat card UI |
| `archive/untracked\_patch_chat12b.py` | 1,174 | LINEAGE-APP | chat follow-up |
| `archive/untracked\_patch_chat12c.py` | 1,654 | LINEAGE-APP | chat follow-up |
| `archive/untracked\_patch_chat12d.py` | 2,837 | LINEAGE-APP | chat follow-up |
| `archive/untracked\_patch_chat12e.py` | 7,488 | LINEAGE-APP | chat answer mode |
| `archive/untracked\_patch_chat12g.py` | 772 | LINEAGE-APP | chat follow-up |
| `archive/untracked\_patch_chat13_labs.py` | 3,305 | LINEAGE-APP | lab-group CSS |
| `archive/untracked\_patch_chat13b.py` | 345 | LINEAGE-APP | lab-group follow-up |
| `archive/untracked\_patch_ct3d_a.py` | 2,862 | LINEAGE-APP | CT-3D view A |
| `archive/untracked\_patch_ct3d_b.py` | 14,801 | LINEAGE-APP | CT-3D view B |
| `archive/untracked\_patch_plots11b.py` | 1,036 | LINEAGE-APP | plots panel layout |
| `archive/untracked\_patch_plots11c.py` | 1,198 | LINEAGE-APP | plots follow-up |
| `archive/untracked\_patch_plots11i.py` | 1,004 | LINEAGE-APP | plots follow-up |
| `archive/untracked\_patch_plots11j.py` | 2,181 | LINEAGE-APP | plots follow-up |
| `archive\_lab_sweep.js` | 4,536 | EXPERIMENT-RUNNER | lab sweep runner |

## Full-app snapshots (safe to delete; duplicated HTML)

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_check_3d10.tmp.mjs` | 40,163,405 | APP-SNAPSHOT | FULL 40MB app copy (module bundle) |
| `archive/untracked\_check_3d10_module.mjs` | 40,160,382 | APP-SNAPSHOT | FULL 40MB app copy (module bundle) |
| `archive/untracked\_check_3d13.js` | 10,238 | APP-SNAPSHOT | extracted module for node --check |
| `archive/untracked\_check_3d5.js` | 10,017 | APP-SNAPSHOT | extracted module for node --check |
| `archive/untracked\_check_3d6.js` | 10,017 | APP-SNAPSHOT | extracted module for node --check |
| `archive/untracked\_check_3d6b.js` | 10,017 | APP-SNAPSHOT | extracted module for node --check |
| `archive/untracked\_check_3d6c.js` | 10,017 | APP-SNAPSHOT | extracted module for node --check |
| `archive/untracked\_check_3d8.js` | 40,158,180 | APP-SNAPSHOT | FULL 40MB app copy (module bundle) |
| `archive/untracked\_check_3d9.js` | 10,017 | APP-SNAPSHOT | extracted module for node --check |
| `archive/untracked\_check_plots.js` | 111,253 | APP-SNAPSHOT | full app snapshot used for plots testing |
| `archive/untracked\_tmp_blk00.mjs` | 40,172,629 | APP-SNAPSHOT | tracked 40MB module-wrapped app copy (untrack at next history rewrite) |
| `archive/untracked\_tmp_blk01.js` | 81,621 | APP-SNAPSHOT | companion block |

## Audit helpers / one-off fixes (safe to delete)

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_audit_glbs.py` | 2,969 | AUDIT-HELPER | GLB asset inspector |
| `archive/untracked\_check_3d10.js` | 1,655 | AUDIT-HELPER | patch 10 audit |
| `archive/untracked\_check_chat12.py` | 4,245 | AUDIT-HELPER | chat patch audit |
| `archive/untracked\_check_chat13.py` | 2,776 | AUDIT-HELPER | lab-group audit |
| `archive/untracked\_check_exp14.py` | 5,693 | AUDIT-HELPER | structural audit for apparatus expansion |
| `archive/untracked\_check_patch15.py` | 1,174 | AUDIT-HELPER | script-block syntax checker (concept lives on in tests/run_smoke.js S2) |
| `archive/untracked\_check_plots.py` | 245 | AUDIT-HELPER | plots page probe |
| `archive/untracked\_extract_3d10.py` | 533 | AUDIT-HELPER | companion extractor for patch 10 |
| `archive/untracked\_extract_module_js.py` | 405 | AUDIT-HELPER | module extractor (superseded by tests/run_smoke.js S2) |
| `archive/untracked\_fix_patch6.py` | 429 | ONE-OFF-FIX | encoding fixer for _patch_3d6.py itself |
| `archive/untracked\_inspect_glb.js` | 1,744 | AUDIT-HELPER | GLB node dump |
| `archive/untracked\_patch_chat12f.py` | 939 | AUDIT-HELPER | chat card audit assertions |
| `archive/untracked\_time_mcns.js` | 2,781 | BENCH-HELPER | MCNS vs FAFB headless timing |

## Debug probes (safe to delete)

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_probe_anatfill.py` | 232 | DEBUG-PROBE | anatomy fill probe |
| `archive/untracked\_probe_anchors.py` | 484 | DEBUG-PROBE | anchor probe |
| `archive/untracked\_probe_chat12.js` | 2,234 | DEBUG-PROBE | chat probe |
| `archive/untracked\_probe_debug.py` | 350 | DEBUG-PROBE | DOM probe |
| `archive/untracked\_probe_exp14.js` | 1,420 | DEBUG-PROBE | apparatus core probe |
| `archive/untracked\_probe_exp14b.js` | 1,094 | DEBUG-PROBE | apparatus core probe |
| `archive/untracked\_probe_exp14c.js` | 992 | DEBUG-PROBE | apparatus core probe |
| `archive/untracked\_probe_firevec.py` | 426 | DEBUG-PROBE | fireVec probe |
| `archive/untracked\_probe_glb.py` | 756 | DEBUG-PROBE | glb probe |
| `archive/untracked\_probe_glb2.py` | 1,276 | DEBUG-PROBE | glb probe |
| `archive/untracked\_probe_hull.py` | 613 | DEBUG-PROBE | hull probe |
| `archive/untracked\_probe_hullfield.py` | 272 | DEBUG-PROBE | hull field probe |
| `archive/untracked\_probe_integrity.py` | 718 | DEBUG-PROBE | dataset integrity probe |
| `archive/untracked\_probe_it.py` | 241 | DEBUG-PROBE | scratch |
| `archive/untracked\_probe_layout.py` | 235 | DEBUG-PROBE | layout probe |
| `archive/untracked\_probe_makesim.py` | 445 | DEBUG-PROBE | makeSim probe |
| `archive/untracked\_probe_mcns.py` | 493 | DEBUG-PROBE | MCNS probe |
| `archive/untracked\_probe_scatter.py` | 474 | DEBUG-PROBE | scattter probe |
| `archive/untracked\_probe_switch.py` | 200 | DEBUG-PROBE | dataset switch probe |

## Early tests (safe to delete)

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_smoke_chat12.js` | 3,156 | EARLY-TEST | early chat worker smoke (superseded by tests/run_smoke.js) |
| `archive/untracked\_smoke_exp14.js` | 3,333 | EARLY-TEST | early apparatus smoke (superseded by tests/run_smoke.js S6/S7) |
| `archive/untracked\_smoke_exp14b.js` | 3,171 | EARLY-TEST | early apparatus smoke variant |
| `archive/untracked\_smoke_exp14w.js` | 5,012 | EARLY-TEST | early worker smoke |
| `archive/untracked\_smoke_plots11.js` | 2,904 | EARLY-TEST | early E2/E8 benchmark smoke |

## Other / unaudited

| File | Bytes | Disposition | Purpose |
|---|---:|---|---|
| `archive/untracked\_check_tmp_ct3d.mjs` | 14,874 | TEMPORARY | scratch script; purpose not individually audited (default disposition) |

## Duplicate functionality observed

- **Module extraction + `node --check`:** `_extract_3d10.py`, `_extract_module_js.py`, `_check_patch15.py` all do the same thing → replaced by `tests/run_smoke.js` S2.
- **Early apparatus smoke tests:** `_smoke_exp14.js`, `_smoke_exp14b.js`, `_smoke_exp14w.js` overlap → replaced by `tests/run_smoke.js` S6–S8.
- **GLB inspection:** `_inspect_glb.js` + `_audit_glbs.py` + `_probe_glb*.py` overlap → a single entry point would suffice; archived as-is.
- **App snapshots:** `_check_3d8.js`, `_check_3d10.tmp.mjs`, `_check_3d10_module.mjs`, `_tmp_blk00.mjs` are near-identical ~40 MB copies (~160 MB waste; kept only until the next history rewrite untracks them).

## Reference updates made with this archive

- `README.md` anatomy section: `_rebuild_anatomy.py` → `tools/rebuild_anatomy.py`
- `.gitignore`: scratch patterns replaced by `archive/untracked/` ignore rules
