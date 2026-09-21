"""Generate SCRIPT_ARCHIVE_INDEX.md from the archive/ directories.

Disposition map is hand-audited (Agent 5, Stage 4). Everything not in the map
defaults to TEMPORARY with a note. Idempotent; re-run after adding scripts.
"""
import datetime
import glob
import os

DISPOSITION = {
    "_patch_exp14_core.py": ("PRODUCED-CURRENT-CORE", "first apparatus-core rewrite of experiment_core.js (E9/E10/E11 cores)"),
    "_patch_exp14_core2.py": ("PRODUCED-CURRENT-CORE", "apparatus-core rewrite, generation 2"),
    "_patch_exp14_core3.py": ("PRODUCED-CURRENT-CORE", "thermo/erasure accounting in apparatus cores"),
    "_patch_exp14_core4.py": ("PRODUCED-CURRENT-CORE", "apparatus particle/wall geometry"),
    "_patch_exp14_core4b.py": ("PRODUCED-CURRENT-CORE", "apparatus core fragment"),
    "_patch_exp14_core5.py": ("PRODUCED-CURRENT-CORE", "valve slot geometry"),
    "_patch_exp14_core6.py": ("PRODUCED-CURRENT-CORE", "demon decision/valve logic"),
    "_patch_exp14_core7.py": ("PRODUCED-CURRENT-CORE", "one-way valve + Maxwell walls"),
    "_patch_exp14_core8.py": ("PRODUCED-CURRENT-CORE", "thermal wall generation"),
    "_patch_exp14_core9.py": ("PRODUCED-CURRENT-CORE", "_thermoWalls implementation"),
    "_patch_exp14_worker.py": ("PRODUCED-CURRENT-WORKER", "apparatus experiment wiring in experiment_worker.js"),
    "_patch_exp14_worker2.py": ("PRODUCED-CURRENT-WORKER", "apparatus curve blocking"),
    "_patch_exp14_wthr.py": ("PRODUCED-CURRENT-WORKER", "app_state streaming throttle (patch 17)"),
    "_patch_exp14_plots.py": ("PRODUCED-CURRENT-PLOTS", "apparatus behavior panels in experiment_plots.html"),
    "_patch_exp14_stage.py": ("PRODUCED-CURRENT-APP", "3D stage/HUD for apparatus experiments"),
    "_patch_3d.py": ("LINEAGE-APP", "anatomical-view readability"),
    "_patch_3d2.py": ("LINEAGE-APP", "stage/actor separation"),
    "_patch_3d3.py": ("LINEAGE-APP", "framing"),
    "_patch_3d4.py": ("LINEAGE-APP", "brain stage geometry fix"),
    "_patch_3d5.py": ("LINEAGE-APP", "activity-jet colors + glow edges"),
    "_patch_3d6.py": ("LINEAGE-APP", "MCNS switch UX"),
    "_patch_3d6b.py": ("LINEAGE-APP", "rAF fallback for deferred switch"),
    "_patch_3d6c.py": ("LINEAGE-APP", "integrity refresh + NaN-proof tint"),
    "_patch_3d7.py": ("LINEAGE-APP", "per-condition brain maps in plots"),
    "_patch_3d8.py": ("LINEAGE-APP", "TrueFly-glb mode (CT-scan fly)"),
    "_patch_3d9.py": ("LINEAGE-APP", "plots button placement"),
    "_patch_3d10.py": ("LINEAGE-APP", "TrueFly-glb loads fly.glb"),
    "_patch_3d10b.py": ("LINEAGE-APP", "TrueFly-glb scale corrections"),
    "_patch_3d10c.py": ("LINEAGE-APP", "brainDebug hook (later reverted)"),
    "_patch_3d10c_revert.py": ("LINEAGE-APP", "revert of 10c"),
    "_patch_3d10d.py": ("LINEAGE-APP", "trueflyDebug hook"),
    "_patch_3d11.py": ("LINEAGE-APP", "brand animation embed"),
    "_patch_3d12.py": ("LINEAGE-APP", "lab rename copy"),
    "_patch_3d13.py": ("LINEAGE-APP", "hero badge animation"),
    "_patch_3d14_labplay.py": ("LINEAGE-APP", "per-lab play buttons"),
    "_patch_3d15_nolag.py": ("LINEAGE-APP", "UI jank fix while experiments run"),
    "_patch_3d18_framesim.py": ("LINEAGE-APP", "per-frame cost reduction"),
    "_patch_3d19_worker.py": ("LINEAGE-APP", "brain worker (brain_worker.js) extraction"),
    "_patch_3d20_perfhud.py": ("LINEAGE-APP", "perf HUD"),
    "_patch_chat12_lab.py": ("LINEAGE-APP", "Chat card UI"),
    "_patch_chat12_worker.py": ("PRODUCED-CURRENT-WORKER", "run_custom chat protocol in experiment_worker.js"),
    "_patch_chat12b.py": ("LINEAGE-APP", "chat follow-up"),
    "_patch_chat12c.py": ("LINEAGE-APP", "chat follow-up"),
    "_patch_chat12d.py": ("LINEAGE-APP", "chat follow-up"),
    "_patch_chat12e.py": ("LINEAGE-APP", "chat answer mode"),
    "_patch_chat12f.py": ("AUDIT-HELPER", "chat card audit assertions"),
    "_patch_chat12g.py": ("LINEAGE-APP", "chat follow-up"),
    "_patch_chat13_labs.py": ("LINEAGE-APP", "lab-group CSS"),
    "_patch_chat13b.py": ("LINEAGE-APP", "lab-group follow-up"),
    "_patch_ct3d_a.py": ("LINEAGE-APP", "CT-3D view A"),
    "_patch_ct3d_b.py": ("LINEAGE-APP", "CT-3D view B"),
    "_patch_e3_mbon.py": ("PRODUCED-CURRENT-CORE", "E3 drosophilaController anatomical upgrade (controllers.js)"),
    "_patch_plots11.py": ("PRODUCED-CURRENT-PLOTS", "per-region firing-change maps"),
    "_patch_plots11_ctrl.py": ("PRODUCED-CURRENT-CORE", "decision telemetry in classicalDemon (controllers.js)"),
    "_patch_plots11b.py": ("LINEAGE-APP", "plots panel layout"),
    "_patch_plots11c.py": ("LINEAGE-APP", "plots follow-up"),
    "_patch_plots11d.py": ("PRODUCED-CURRENT-PLOTS", "region-rate memory"),
    "_patch_plots11e.py": ("PRODUCED-CURRENT-PLOTS", "dot/hull layering"),
    "_patch_plots11f.py": ("PRODUCED-CURRENT-PLOTS", "hull tint rendering"),
    "_patch_plots11g.py": ("PRODUCED-CURRENT-PLOTS", "firing-delta dots"),
    "_patch_plots11h.py": ("PRODUCED-CURRENT-PLOTS", "delta thresholding"),
    "_patch_plots11i.py": ("LINEAGE-APP", "plots follow-up"),
    "_patch_plots11j.py": ("LINEAGE-APP", "plots follow-up"),
    "_check_exp14.py": ("AUDIT-HELPER", "structural audit for apparatus expansion"),
    "_check_chat12.py": ("AUDIT-HELPER", "chat patch audit"),
    "_check_chat13.py": ("AUDIT-HELPER", "lab-group audit"),
    "_check_patch15.py": ("AUDIT-HELPER", "script-block syntax checker (concept lives on in tests/run_smoke.js S2)"),
    "_check_plots.py": ("AUDIT-HELPER", "plots page probe"),
    "_check_plots.js": ("APP-SNAPSHOT", "full app snapshot used for plots testing"),
    "_check_3d5.js": ("APP-SNAPSHOT", "extracted module for node --check"),
    "_check_3d6.js": ("APP-SNAPSHOT", "extracted module for node --check"),
    "_check_3d6b.js": ("APP-SNAPSHOT", "extracted module for node --check"),
    "_check_3d6c.js": ("APP-SNAPSHOT", "extracted module for node --check"),
    "_check_3d8.js": ("APP-SNAPSHOT", "FULL 40MB app copy (module bundle)"),
    "_check_3d9.js": ("APP-SNAPSHOT", "extracted module for node --check"),
    "_check_3d10.js": ("AUDIT-HELPER", "patch 10 audit"),
    "_check_3d10.tmp.mjs": ("APP-SNAPSHOT", "FULL 40MB app copy (module bundle)"),
    "_check_3d10_module.mjs": ("APP-SNAPSHOT", "FULL 40MB app copy (module bundle)"),
    "_check_3d13.js": ("APP-SNAPSHOT", "extracted module for node --check"),
    "_extract_3d10.py": ("AUDIT-HELPER", "companion extractor for patch 10"),
    "_extract_module_js.py": ("AUDIT-HELPER", "module extractor (superseded by tests/run_smoke.js S2)"),
    "_fix_patch6.py": ("ONE-OFF-FIX", "encoding fixer for _patch_3d6.py itself"),
    "_inspect_glb.js": ("AUDIT-HELPER", "GLB node dump"),
    "_audit_glbs.py": ("AUDIT-HELPER", "GLB asset inspector"),
    "_probe_anatfill.py": ("DEBUG-PROBE", "anatomy fill probe"),
    "_probe_anchors.py": ("DEBUG-PROBE", "anchor probe"),
    "_probe_chat12.js": ("DEBUG-PROBE", "chat probe"),
    "_probe_debug.py": ("DEBUG-PROBE", "DOM probe"),
    "_probe_exp14.js": ("DEBUG-PROBE", "apparatus core probe"),
    "_probe_exp14b.js": ("DEBUG-PROBE", "apparatus core probe"),
    "_probe_exp14c.js": ("DEBUG-PROBE", "apparatus core probe"),
    "_probe_firevec.py": ("DEBUG-PROBE", "fireVec probe"),
    "_probe_glb.py": ("DEBUG-PROBE", "glb probe"),
    "_probe_glb2.py": ("DEBUG-PROBE", "glb probe"),
    "_probe_hull.py": ("DEBUG-PROBE", "hull probe"),
    "_probe_hullfield.py": ("DEBUG-PROBE", "hull field probe"),
    "_probe_integrity.py": ("DEBUG-PROBE", "dataset integrity probe"),
    "_probe_it.py": ("DEBUG-PROBE", "scratch"),
    "_probe_layout.py": ("DEBUG-PROBE", "layout probe"),
    "_probe_makesim.py": ("DEBUG-PROBE", "makeSim probe"),
    "_probe_mcns.py": ("DEBUG-PROBE", "MCNS probe"),
    "_probe_scatter.py": ("DEBUG-PROBE", "scattter probe"),
    "_probe_switch.py": ("DEBUG-PROBE", "dataset switch probe"),
    "_smoke_chat12.js": ("EARLY-TEST", "early chat worker smoke (superseded by tests/run_smoke.js)"),
    "_smoke_exp14.js": ("EARLY-TEST", "early apparatus smoke (superseded by tests/run_smoke.js S6/S7)"),
    "_smoke_exp14b.js": ("EARLY-TEST", "early apparatus smoke variant"),
    "_smoke_exp14w.js": ("EARLY-TEST", "early worker smoke"),
    "_smoke_plots11.js": ("EARLY-TEST", "early E2/E8 benchmark smoke"),
    "_time_mcns.js": ("BENCH-HELPER", "MCNS vs FAFB headless timing"),
    "_bw_poolsync_patch.py": ("PRODUCED-CURRENT-WORKER", "brain-worker pool sync"),
    "_bw_watchdog_patch.py": ("PRODUCED-CURRENT-WORKER", "brain-worker watchdog"),
    "_gen_payload.js": ("PRODUCED-CURRENT-DATA", "generated research_data/_payload_e*.json fixtures"),
    "_gen_payload_e10.js": ("PRODUCED-CURRENT-DATA", "generated E10 payload fixture"),
    "_lab_sweep.js": ("EXPERIMENT-RUNNER", "lab sweep runner"),
    "_tmp_blk00.mjs": ("APP-SNAPSHOT", "tracked 40MB module-wrapped app copy (untrack at next history rewrite)"),
    "_tmp_blk01.js": ("APP-SNAPSHOT", "companion block"),
}


def classify(name):
    return DISPOSITION.get(name, ("TEMPORARY", "scratch script; purpose not individually audited (default disposition)"))


def main():
    files = sorted(glob.glob("archive/untracked/*")) + sorted(glob.glob("archive/_*"))
    entries = []
    for f in files:
        name = os.path.basename(f)
        tag, why = classify(name)
        entries.append((f, name, tag, why, os.path.getsize(f)))

    groups = {"PRODUCED": [], "LINEAGE": [], "SNAPSHOT": [], "HELPER": [],
              "PROBE": [], "EARLYTEST": [], "OTHER": []}
    for e in entries:
        f, name, tag, why, size = e
        if tag.startswith("PRODUCED-CURRENT"):
            groups["PRODUCED"].append(e)
        elif tag.startswith("LINEAGE") or tag == "EXPERIMENT-RUNNER":
            groups["LINEAGE"].append(e)
        elif tag == "APP-SNAPSHOT":
            groups["SNAPSHOT"].append(e)
        elif tag in ("AUDIT-HELPER", "BENCH-HELPER", "ONE-OFF-FIX"):
            groups["HELPER"].append(e)
        elif tag == "DEBUG-PROBE":
            groups["PROBE"].append(e)
        elif tag == "EARLY-TEST":
            groups["EARLYTEST"].append(e)
        else:
            groups["OTHER"].append(e)

    def table(items):
        out = ["| File | Bytes | Disposition | Purpose |", "|---|---:|---|---|"]
        for f, name, tag, why, size in items:
            out.append(f"| `{f}` | {size:,} | {tag} | {why} |")
        return "\n".join(out)

    md = f"""# Script Archive Index

**Created:** {datetime.date.today().isoformat()} · **Archived scripts:** {len(entries)} · **Deleted: none**

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

{table(groups['PRODUCED'])}

## App patch lineage (keep for provenance; optional at release)

{table(groups['LINEAGE'])}

## Full-app snapshots (safe to delete; duplicated HTML)

{table(groups['SNAPSHOT'])}

## Audit helpers / one-off fixes (safe to delete)

{table(groups['HELPER'])}

## Debug probes (safe to delete)

{table(groups['PROBE'])}

## Early tests (safe to delete)

{table(groups['EARLYTEST'])}

## Other / unaudited

{table(groups['OTHER'])}

## Duplicate functionality observed

- **Module extraction + `node --check`:** `_extract_3d10.py`, `_extract_module_js.py`, `_check_patch15.py` all do the same thing → replaced by `tests/run_smoke.js` S2.
- **Early apparatus smoke tests:** `_smoke_exp14.js`, `_smoke_exp14b.js`, `_smoke_exp14w.js` overlap → replaced by `tests/run_smoke.js` S6–S8.
- **GLB inspection:** `_inspect_glb.js` + `_audit_glbs.py` + `_probe_glb*.py` overlap → a single entry point would suffice; archived as-is.
- **App snapshots:** `_check_3d8.js`, `_check_3d10.tmp.mjs`, `_check_3d10_module.mjs`, `_tmp_blk00.mjs` are near-identical ~40 MB copies (~160 MB waste; kept only until the next history rewrite untracks them).

## Reference updates made with this archive

- `README.md` anatomy section: `_rebuild_anatomy.py` → `tools/rebuild_anatomy.py`
- `.gitignore`: scratch patterns replaced by `archive/untracked/` ignore rules
"""
    with open("SCRIPT_ARCHIVE_INDEX.md", "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"wrote SCRIPT_ARCHIVE_INDEX.md with {len(entries)} entries")


if __name__ == "__main__":
    main()
