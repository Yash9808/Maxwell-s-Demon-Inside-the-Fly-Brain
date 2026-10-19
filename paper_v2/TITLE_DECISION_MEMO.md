# TITLE DECISION MEMO — connectome demon manuscript

Date: 2026-09-28 · Status: DECIDED (fallback ladder recorded) ·
Process: mirrors `paper_v2/TITLE_ANALYSIS_final.md` (validity classification →
per-term check → candidates → final), re-run against the **fresh 2026-09-28
evidence session** (browser E1–E11 captures, CI-grade headless reruns, closed-loop
runs). Evidence log: `paper_evidence/evidence_log.md`.

---

## 1. Decision

**Recommended title (use across manuscript, figures, legends, metadata):**

> **Information-limited sorting by a connectome-constrained spiking controller: an energy- and information-budgeted test of demon-like behaviour in a model Drosophila brain**

This is candidate C1 of `TITLE_ANALYSIS_final.md`, re-validated against fresh
numbers (§3). It keeps the discoverable demon search term while asserting only
what the controls support: sorting under an information limit, tested against a
budget — not demon-like performance.

**Fallback ladder (data-driven, in order):**
1. **T3 (above)** — primary.
2. **T2** — *What a real fly connectome can and cannot learn: a
   connectome-constrained spiking controller on a Maxwell-demon task*
   (adapted from B1). Use if reviewers/editors want the capability-scoping
   frame; "can and cannot" is now quantified (dynamics/MI: yes; task
   competence: no).
3. **T1-with-lens-note** — *A connectome-constrained Drosophila neural network
   as a Maxwell demon: an information-budgeted test in a simulated gas* — the
   working headline. Permitted **only** with the framing fix in §4 (demon as
   task frame, negative verdict reported); weakest because "as a Maxwell demon"
   still reads as a performance claim.
4. **No-colon variant** (venue style fallback, adapted from A2):
   *An energy- and information-budgeted Maxwell-demon test for
   connectome-constrained spiking controllers*.

**Original working title** (preserved per convention, not silent):
*"Learning to Act as Maxwell's Demon: A Connectome-Constrained Computational
Study of Information-Based Learning in the Drosophila Brain"* — superseded;
fails per-term checks below.

---

## 2. Fresh evidence inventory (2026-09-28 session, zero app code changes)

- All 11 experiments executed in the current app, headless Edge CDP; per-exp
  screenshots, sparklines, verdict chips (`paper_evidence/raw/card_e*.json`).
- CI-grade headless reruns (`paper_v2/paper_program.js`): E3 post-upgrade
  (288 rows, 26 s); E5 seeds 0+1 (250 rows each) → `paper_v2/raw/E5_rows_s{0,1}.jsonl`.
  Archived E4/E9/E10/E11 rows remain valid (connectomeController untouched).
- Closed loop, two independent entry points, same seed (11), 240 steps:
  browser one-click route (`experiment_plots.html#btnRunCLHere` → worker FAFB
  brain → sidecar → FlyBody/MuJoCo) — **causal gates 9/9 PASS** (76 s,
  `card_cl.json`); deterministic CLI (`tools/closed_loop_runner.js`) — **9/9
  PASS** (`paper_evidence/raw/cl_locomotion.jsonl`).
- Brain-outcome figures via the app's own Save PNG pipeline (provenance:
  n = 106,765 neurons, 400 bundles, 564,030 mapped edges).

## 3. Fresh headline numbers used for the decision

| Source | Result | Title implication |
|---|---|---|
| E5 browser card (fresh) | ⚖ classical_demon **1.00 ±0.00** > drosophila **0.50 ±0.05** ≈ shuffled_connectome **0.48 ±0.05**; "test agree 1.00 vs 0.50" | neural controllers do **not** approach demon competence; "as a demon" unsupported |
| E5 CI reruns (2 seeds) | connectome ≈ shuffled behaviour; MI differs (0.0034 vs 0.0070 bits, archived) | wiring **constrains dynamics** — "connectome-constrained" supported |
| E3 fresh rerun | dopamine-gated plasticity collapses door policy (open 0.497 → 0.000, n = 2) | learning is real but **not** demon-learning; "information-based" unsupported |
| E6 / ledger (archived, unchanged) | jet-subsidized entropy ≥ never-gate; bits used 10–120 ≪ bits needed ≈4.7–7.7×10⁴ | sorting is **information-limited**, subsidy-dominated |
| E9 (archived, unchanged) | valve accuracy 0.517 vs classical 0.911 (p_BH = 6×10⁻⁴); work ≈ 8×10⁻²⁴ J ≪ 1 Landauer bit | apparatus competence at chance; budget framing required |
| E11 (archived, unchanged) | ratchet +7.23 vs −2.01 steps/episode (p_BH = 7×10⁻⁴) — rectifies only under gradient | second-law boundary holds |
| CL (both routes, fresh) | 9/9 causal gates PASS, 240 real MuJoCo steps, seed 11 | "spiking controller" loop is genuine end-to-end; supports "connectome-constrained spiking controller" |

## 4. Candidate evaluation (criteria: accuracy to evidence · per-term
consistency · discoverability · venue fit · reviewer risk)

- **T1 (working headline)** — Accuracy: FAILS as written ("as a Maxwell demon"
  contradicted by E5 comparator + E9 chance accuracy + ledger). With the
  "demon = task frame, negative verdict" lens note it becomes CONDITIONAL.
  Discoverability: best. Risk: high that readers stop at the colon and cite it
  as a positive demon demonstration. → fallback #3.
- **T2 ("can and cannot learn")** — Accuracy: PASS (E4 real-vs-shuffled + E5 +
  E9 quantify both sides). Discoverability: good ("fly connectome", "Maxwell-
  demon task"). Risk: breadth — "what X can learn" promises generality beyond
  one operating point; MANUSCRIPT §Limitations pins single-operating-point
  scope. → fallback #2.
- **T3 (recommended)** — Accuracy: PASS term-by-term (§5). Discoverability:
  keeps "demon-like behaviour" and "connectome". Risk: length (two-clause),
  accepted per C1 precedent. → primary.
- **A1/A2/A3 (builder's ranked list)** — retained as *wording* bank for venue
  variants (e.g. no-colon A1 for Nature-style guides), not as claims: A1/A2
  assert demon operation and fail §5 as written.

## 5. Per-term consistency check — T3 (title ↔ abstract ↔ results ↔ figures)

- **"Information-limited"** → PASS. E6 (subsidy ≥ never-gate), E8 (behavioural
  price of reduced information ≈ 0 in-regime), ledger (bits ≪ needed). The
  limit is the finding, not a caveat.
- **"sorting"** → PASS. Door task + apparatus sorting/readouts (E1–E11).
- **"connectome-constrained"** → PASS. FlyWire FAFB v783, 106,765 neurons;
  real-vs-shuffled dynamics/MI contrast (E4/E5); CL loop carries the same
  brain into MuJoCo (fresh, 9/9 gates).
- **"spiking controller"** → PASS. LIF over the connectome, CSR propagation;
  deterministic closed-loop confirmation this session.
- **"energy- and information-budgeted test"** → PASS. Every trial carries the
  ledger (work in / extractable / Landauer / metered bits); E9 valve cannot pay
  one bit; statistics preregistered (BH-FDR, seeded permutation).
- **"demon-like behaviour"** → PASS: *behaviour on a demon-like task*, no
  performance assertion. Discussion already answers the §30 checklist (what is
  modeled / demonstrated / NOT demonstrated).
- **"model Drosophila brain"** → PASS with the computational-scope caveat the
  text already carries (model, not recording).

## 6. Cross-document sync actions (apply T3 consistently)

1. `MANUSCRIPT.md` title line → T3 (abstract §1 already matches the framing).
2. `build_nature_paper_docx.py` cover block → replace A1 headline with T3 and
   re-rank its alternative bullets to the §1 ladder (keep A1–A3 as venue
   variants only).
3. Figure/registry titles (`paper_v2/FIGURE_REGISTRY.md`,
   `paper_v2/legends/`) → T3 on regeneration.
4. Metadata/README blurb → T3 with the one-sentence significance from
   MANUSCRIPT.md ("jet-subsidized rather than information-driven … negative-
   control baseline and accounting standard").

## 7. Style note (recorded, not blocking)

Nature Portfolio guidance prefers titles without colons/active verbs; T3 and
T2 use colons by design (framing clause + descriptor), consistent with common
practice in the venue for two-part titles. If a specific venue's editor
objects, use fallback #4 (no-colon variant). "Maxwell's demon" possessive is
used in prose; title uses the compound "Maxwell-demon"/"demon-like" — applied
consistently in §6 sync.

---

*Decision record:* chosen 2026-09-28 on the fresh-session evidence (§2–§3);
supersedes the working title explicitly. Re-open this memo only if new
multi-seed evidence changes the E4/E5 real-vs-shuffled or E9 competence
verdicts.
