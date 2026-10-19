# FINAL QUALITY-CONTROL AUDIT — E1–E11 paper program

Date: 2026-09-23. Auditor: automated pipeline (`paper_program.js` → `paper_analysis.js` → `paper_figures.py`) with human-readable cross-checks below.

## 1. Experiment status ledger (no experiment silently omitted)

| Experiment | Status | Seeds | Rows | Key outcome (verdict class) |
|---|---|---|---|---|
| E1 · Classical Maxwell Demon | **COMPLETED** | 2 | 144 | reference: g:B 1.26 (cond), ledger 98 vs 68,427 bits — COMPLETED |
| E2 · Artificial Neural Demon | **COMPLETED** | 2 | 288 | ANN lock-open 0.994; worse-than-random selectivity — COMPLETED (negative for task) |
| E3 · Drosophila-Inspired Network | **COMPLETED** | 2 | 288 | policy collapse 0.497→0.000 openFrac; same in 20-seed campaign — COMPLETED (learning ≠ task success) |
| E4 · Connectome-Constrained 4A/4B/4C | **COMPLETED** | 2 | 300 | real vs shuffled ΔT +0.002, p_BH = 1.0 — COMPLETED (NO_EVIDENCE, matches 12-seed campaign) |
| E5 · Full Comparator Study | **COMPLETED** | 2 | 500 | full 5-condition comparator; MI measured — COMPLETED |
| E6 · Jet-Closure Paradox | **COMPLETED** | 2 | 432 | never-gate ΔH 0.037 ≥ demon 0.027 — COMPLETED (jet-subsidized) |
| E7 · Generalization Sweep | **COMPLETED** | 3 | 180 | selectivity persists across 3 regimes (2.50/1.63/1.62) — COMPLETED |
| E8 · Information-Limited Demons | **COMPLETED** | 2 | 432 | adaptive=fixed=mem4 bit-identical (mechanism inert here) — COMPLETED (honest null) |
| E9 · Pressure Demon | **COMPLETED** | 10 | 1200 | decisions at chance vs reference; work thermodynamically negligible; manipulation check passes — COMPLETED |
| E10 · Smoluchowski Trapdoor | **COMPLETED** | 10 | 800 | no active sorting; physics sanity passes (light vs heavy g = 3.8) — COMPLETED (expected negative) |
| E11 · Feynman Ratchet & Pawl | **COMPLETED** | 10 | 1000 | gradient vs equilibrium g = 11.5 (2nd-law boundary); brain-pawl no work — COMPLETED |

No FAILED runs; no runs excluded; all seeds retained in raw. Warnings: E4/E5 limited to n = 2 seeds by runtime (mitigated by prior 12–20-seed preregistered campaigns whose verdicts agree); E8's manipulation is inert in this regime (documented, S5).

## 2. Data audit

- Raw preserved: `paper_v2/raw/` 13 JSONL files, **5,564 rows**, written once (append-safe chunking for E4/E5; never overwritten). ✔
- Processed separate: `paper_v2/processed/` 22 CSVs (per-seed phase means + figure curves). ✔
- Seeds recorded: every meta file carries the seed rule + base; every row carries `seed`. ✔
- Parameters recorded: `*_meta.json` (physics, episodes, engine, Node version, timestamps); registry JSON. ✔
- Sample sizes recorded: n per condition in ANALYSIS_RESULTS and the report tables. ✔
- Failures documented: none occurred; the E4/E5 timeout handling used chunked reruns (documented in runner). ✔

## 3. Figures audit

- 7 main figures (Figs 1–7, `paper_figures.py`) **+ 8 brain/synthesis figures (Figs 8–15 incl. Fig 14g inset, `paper_brain_figures.py`, `figure14_door_brains.py`, `figure15_entropy_ledger.py`)** — 17 PNGs, all PNG (300 dpi) + PDF (vector). ✔
- Every data panel generated from `paper_v2/raw/`, `processed/brain/`, or `ANALYSIS_RESULTS.json` — no hand-entered values; generator scripts in repo. ✔
- Conceptual schematics (Fig 1; top chain of Fig 7) carry on-figure "Conceptual schematic — not experimental data" labels. ✔
- Provenance: `figures/PROVENANCE.json` + `PROVENANCE_fig14.json` + `PROVENANCE_fig15.json` map every panel → source files → data files → script. ✔
- Legends: `legends/FIGURE_LEGENDS.md` (what is shown, condition, n, uncertainty, tests, experiment IDs, scope labels). ✔
- **fireVec scope audit**: E3 payloads are 248-unit MB mini-circuit; E2/E5-ann are 18-unit ANN; only connectome conditions carry full FAFB vectors. Invalid FAFB-mapped E3/E5-ann bins were deleted and re-exported at honest scope (`brain_export.js` scope guard; MINI_E3.json). All brain panels labelled *model neural activity*. ✔
- Pixel/content QC: `figures/FIGURE_CONTENT_QC.json` — all 16 figure files have non-empty content in every quadrant; 3D panels (Figs 8–11) confirmed dark-background with activity point clouds present. ✔
- Figure registry: `FIGURE_REGISTRY.md` (Part 1 inventory, Part 2 required-plot mapping, Part 3 explicit NOT-AVAILABLE entries). ✔
- Final 15-question figure audit: `FIGURE_AUDIT.md` — **PASS**. ✔
- Known display notes: Fig 2a shows per-seed lines because the frozen control is bimodal across seeds (documented in legend); Fig 2b shows per-seed dots because n = 2 makes 95% CIs span-huge (documented). ✔

## 4. Manuscript audit

- Abstract contains only numbers present in `ANALYSIS_RESULTS.json` (spot-checked: 0.497→0.000; 0.994; +0.002/p_BH 1.0; 0.517 vs 0.911/p_BH 6×10⁻⁴; 10–120 vs 4.7–7.7×10⁴ bits; 7.23 vs −2.01/p_BH 7×10⁻⁴/g 11.5). ✔
- Results sections map 1:1 to experiment groups (incl. §2.7 brain-level outcome and §2.8 entropy/ledger from the brain-figure program); every claim traceable via SUPPLEMENTARY S7 matrix + S6b brain analytics. ✔
- Discussion distinguishes OBSERVED / INFERRED / HYPOTHESIS explicitly (§3.1, §3.3). ✔
- Methods reconstructed from actual implementation (engines, coefficients, seed rules, guards). ✔
- Limitations explicit (§3.5); computational-vs-biological discipline maintained throughout. ✔
- Negative findings reported prominently rather than buried (they are the paper's core findings). ✔
- References: 6 entries; 3 verified in-repo DOIs (Dorkenwald, Schlegel) or standard classics (Landauer, Smoluchowski, Feynman); the Buhmann-model DOI gap is disclosed, not fabricated. ✔

## 5. Title audit

- Original working title preserved and quoted in both title analyses. ✔
- Initial assessment (pre-execution): VALID WITH MODIFICATION (provisional). ✔
- Final assessment (post-execution): **VALID WITH MODIFICATION** — evidence-based (subsidy, ledger, competence). ✔
- Final title adopted openly and used consistently: MANUSCRIPT.md, TITLE_ANALYSIS_final.md, legends header, SUPPLEMENTARY header, this audit. ✔
- Title–abstract–results–figures–discussion consistency check completed (TITLE_ANALYSIS_final.md §per-term check). ✔

## 6. Non-negotiable rules — final compliance sweep

1. No fabricated data (all numbers from generated raw). ✔
2. No fabricated citations (disclosed gap). ✔
3. No fabricated figures (all panels from outputs; schematics labeled). ✔
4. No invented results (verdicts gated; degenerate contrasts flagged). ✔
5. No silently omitted experiments (ledger above; all 11 present). ✔
6. Raw never overwritten (append-only; separate processed). ✔
7. Schematics never presented as data (on-figure labels). ✔
8. Inference never presented as observation (evidence-class labels). ✔
9. No computational prediction stated as biological fact. ✔
10. No thermodynamic Maxwell-demon claim (the paper's central negative result). ✔
11. E1–E11 not forced to a conclusion (conclusions follow verdicts). ✔
12. Title changed openly, both titles recorded. ✔
13. Unsupported terminology flagged and replaced. ✔
14–15. Claim→evidence and figure→data traceability chains implemented and documented (S8). ✔
16–17. Story and title derived from completed experiments. ✔

**AUDIT VERDICT: PASS** — the pipeline produced a scientifically defensible, quantitatively supported, reproducible study whose manuscript, figures, conclusions, and title are consistent with what E1–E11 actually demonstrate.
