# PPT VISUAL REFERENCE ANALYSIS

Source: `fly.pptx` (3 embedded media images; slides 7–8 carry the figure requirements).
Reference only — no PPT artwork is copied; every figure in this paper is generated from
actual E1–E11 outputs (`paper_v2/raw/`, `paper_v2/processed/brain/`).

---

## Reference image 1 — "DEMON LAB" slide

* **What it shows:** white-background scientific layout; small paired condition bars
  (red vs blue) at center-bottom on a near-white field; restrained text blocks.
* **Why effective:** one accent pair per comparison; the reader sees the *contrast*, not
  decoration. High ink-to-information ratio.
* **Transfer:** white figure background; a two-color condition vocabulary (condition A vs
  condition B) used identically across every panel; comparisons shown as paired bars/points.
* **Not copied:** the slide's layout/text is presentation furniture, not data.

## Reference image 2 — "INFORMATION LAB" slide

* **What it shows:** same layout family with **yellow/amber accents** marking the
  information-processing condition.
* **Why effective:** a second accent hue separates *information* quantities from
  *behaviour* quantities at a glance.
* **Transfer:** amber is reserved for information-theoretic quantities (MI, entropy,
  bits); the red/blue pair is reserved for learned vs control conditions. Consistent
  across Figs 2–13.
* **Not copied:** exact colors of the slide (which are decorative), any slide text.

## Reference image 3 — "FLY BRAIN" slide

* **What it shows:** dark-background 3D view of a dense blue point cloud in the FlyWire
  canonical frame — the laboratory app's brain-outcome view: the run's actual per-neuron
  firing rendered on real FAFB anatomy.
* **Why effective:** anatomy first; activity is data projected onto anatomy, so
  "where" is answered before "how much."
* **Transfer:** our brain figures (Figs 8–11) render the **actual model neuron positions**
  (`fly_brain_positions.json`, 106,765 FAFB v783 neurons) and **46 real neuropil hull
  meshes** (`fly_brain_hulls.json/bin`), with per-neuron model spike counts decoded from
  the raw rows' `fireVec` payloads. Panel a of Fig 8 reproduces the reference's dark 3D
  look deliberately (activity reads best on dark); all other panels are white-background
  scientific plots per this paper's style contract.
* **Not copied:** the specific screenshot; our rendering is regenerated from our own
  model's recorded states.

## Slide 7 — "predictions vs observations plots for E1–E11"

* **Transfer:** Fig 13 panel a plots the committed preregistered endpoints
  (`PRE_REGISTERED_CRITERIA.json`, written before the multi-seed campaigns) against the
  observed signed contrasts from this run.

## Slide 8 — "crossing ledger + per-condition 3D brain views + cell-type firing"

* **Transfer:** crossing ledger → Fig 13 panel c (per-experiment behaviour counts);
  3D views per condition → Figs 8/10 (trained vs frozen; early vs late);
  cell-type firing → Fig 9 panels c/d (published Schlegel-2024 annotations).

---

## Design contract adopted for this paper

1. White background everywhere except the two 3D-context panels (Fig 8a, Fig 10a) where
   dark backgrounds make point-cloud activity legible; each is explicitly labeled as
   **connectome-constrained model neural activity** (not biological firing).
2. Condition vocabulary fixed across all figures: learned = red, frozen/control = blue,
   reference = gray, information quantities = amber.
3. Color-blind-safe amber/blue pair for dichotomies; no red-green encoding.
4. Every brain panel states its data source (fireVec → decoded counts) and window.
5. Observed vs inferred vs causal wording follows the manuscript's claim discipline.
6. Anatomical chain per figure: ANATOMY → NEURONS → ACTIVITY → INFORMATION → LEARNING →
   DECISION → ACTION → BEHAVIOUR, with each arrow backed by a quantitative panel.
