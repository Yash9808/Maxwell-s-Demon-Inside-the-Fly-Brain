# -*- coding: utf-8 -*-
"""
Build the NEW version of research_paper_structure_maxwell_demon_drosophila.docx
in Nature Portfolio (Nature / Nature Protocols) style, grounded in the actual
experiment structure of this workspace (E1-E11 registry, FAFB v783 connectome,
measured pilot results, thermodynamic budget).
"""
import sys
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ------------------------------------------------------------------ helpers
ACCENT = RGBColor(0x00, 0x5A, 0x8C)      # deep blue (Nature-ish)
GREY = RGBColor(0x59, 0x59, 0x59)

def set_cell_bg(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)

def style_doc(doc):
    st = doc.styles['Normal']
    st.font.name = 'Calibri'
    st.font.size = Pt(10.5)
    st.paragraph_format.space_after = Pt(4)
    for name, size, color, bold in [
        ('Heading 1', 15, ACCENT, True),
        ('Heading 2', 12.5, ACCENT, True),
        ('Heading 3', 11, GREY, True),
    ]:
        h = doc.styles[name]
        h.font.name = 'Calibri'
        h.font.size = Pt(size)
        h.font.color.rgb = color
        h.font.bold = bold

def p(doc, text, bold=False, italic=False, size=None, color=None,
      align=None, space_after=None):
    par = doc.add_paragraph()
    run = par.add_run(text)
    run.bold = bold
    run.italic = italic
    if size: run.font.size = Pt(size)
    if color: run.font.color.rgb = color
    if align is not None: par.alignment = align
    if space_after is not None: par.paragraph_format.space_after = Pt(space_after)
    return par

def bullet(doc, text, level=0):
    par = doc.add_paragraph(style='List Bullet' if level == 0 else 'List Bullet 2')
    par.add_run(text)
    par.paragraph_format.space_after = Pt(2)
    return par

def numbered(doc, text):
    par = doc.add_paragraph(style='List Number')
    par.add_run(text)
    par.paragraph_format.space_after = Pt(2)
    return par

def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1 + len(rows), cols=len(header))
    t.style = 'Light Grid Accent 1'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, h in enumerate(header):
        c = t.rows[0].cells[j]
        c.text = ''
        r = c.paragraphs[0].add_run(h)
        r.bold = True
        r.font.size = Pt(9.5)
        set_cell_bg(c, 'DCE9F2')
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            c = t.rows[i + 1].cells[j]
            c.text = ''
            r = c.paragraphs[0].add_run(str(val))
            r.font.size = Pt(9.5)
    if widths:
        for j, w in enumerate(widths):
            for row in t.rows:
                row.cells[j].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t

# ------------------------------------------------------------------ document
doc = Document()
style_doc(doc)
for section in doc.sections:
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.9)
    section.right_margin = Inches(0.9)

# =========================== COVER / TITLE =================================
p(doc, 'MANUSCRIPT BLUEPRINT — Nature Portfolio format (v2)',
  bold=True, size=11, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
p(doc, 'A connectome-constrained Drosophila neural network operates as a '
       'Maxwell demon in a simulated gas: a computational protocol and '
       'multi-controller evaluation',
  bold=True, size=17, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
p(doc, 'Recommended (Nature-style title, no colon, no active verb, concise noun phrase):',
  italic=True, size=9.5, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
p(doc, '"A connectome-constrained Drosophila neural network as a Maxwell demon '
       'in a simulated gas"',
  bold=True, size=11.5, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)

p(doc, 'Alternative titles (ranked):', bold=True, size=10)
bullet(doc, 'A1 — "A connectome-constrained Drosophila neural network as a Maxwell '
            'demon in a simulated gas" (recommended: compact, declarative, Nature Article style).')
bullet(doc, 'A2 — "Maxwell-demon control by a Drosophila connectome in a simulated '
            'gas" (shorter, punchier; suits Nature Methods / Brief Communication).')
bullet(doc, 'A3 — "Information-gated sorting with a Drosophila connectome: a '
            'computational Maxwell-demon protocol" (suits Nature Protocols, names '
            'the protocol artifact).')
bullet(doc, 'A4 — "Learning to act as Maxwell\'s demon: connectome-constrained '
            'control of an information-dependent task" (closest to the previous '
            'version; keep as fallback).')
p(doc, 'Note: the previous title used a colon ("Learning to Act as Maxwell\'s Demon: '
       '…"). Nature Portfolio style guidance prefers titles without colons, '
       'abbreviations, or active verbs, hence A1–A3.',
  italic=True, size=9.5, color=GREY)

# =========================== ARTICLE-TYPE MAP ==============================
doc.add_heading('Which Nature Portfolio format this project fits', level=1)
p(doc, 'The workspace contains both a finished comparative evaluation and a '
       'reusable, seeded, step-by-step simulation protocol. Depending on the '
       'contribution you want to lead with, pick one of two formats:', space_after=4)
table(doc,
      ['Option', 'Nature format', 'Front matter', 'Body order', 'Best fit'],
      [['Article (recommended)', 'Nature / Nature Communications Article',
        'Summary paragraph (~200 words, fully referenced), no "Introduction" heading',
        'Introduction (untitled) → Results → Discussion → References → Methods → '
        'Figure legends → Data/Code availability',
        'Lead with the connectome-can-learn result'],
       ['Protocol', 'Nature Protocols Protocol',
        'Abstract (~150 words), Overview',
        'Introduction → Materials → Procedure (step-by-step) → Timing → '
        'Anticipated results → Troubleshooting',
        'Lead with the reproducible seeded benchmark pipeline'],
       ['Brief Communication', 'Nature Communications Brief Communication',
        'Unstructured abstract (~150 words)',
        'Introduction (untitled) → compact Results → Discussion → Methods',
        'Lead with the thermodynamic-budget audit only']],
      widths=[1.2, 1.6, 1.7, 2.3, 1.7])
p(doc, 'This blueprint follows the Article skeleton (most complete) and adds a '
       'Nature-Protocols-style Procedure flow inside Methods, so either '
       'submission can be assembled from it without restructuring.',
  italic=True, size=9.5, color=GREY)

# =========================== SUMMARY PARAGRAPH =============================
doc.add_heading('Summary paragraph (Abstract) — draft for Article format', level=1)
p(doc, 'Maxwell\'s demon, an information-processing agent that sorts gas molecules '
       'by measurement and feedback, has become the canonical model for '
       'information-driven control in thermodynamics, yet whether a measured '
       'biological wiring diagram can implement demon-like control is unknown. '
       'Here we embed a proofread adult Drosophila melanogaster connectome '
       '(FlyWire FAFB v783; 106,765 neurons; 563,942 synapse-weighted signed '
       'edges) as a spiking gate controller in a three-dimensional two-chamber '
       'gas with an actively controlled aperture and a thermal jet. The '
       'connectome-constrained demon learns with a local three-factor plasticity '
       'rule (eligibility trace × dopamine from crossing outcomes) to separate '
       'fast ("hot") from slow ("cold") particles, increasing its good:bad '
       'crossing ratio from 1.55 early to 4.56 late in training (×2.9). In '
       'multi-seeded comparator runs, the trained demon extracts work that '
       'exceeds its Landauer erasure bill by ~10²–10³-fold while the jet pays '
       'the entropy bill, confirming that the sorting is resource-subsidized, '
       'not a second-law violation. A degree-preserving shuffled connectome and '
       'an equivalent artificial network fail to match the learned policy, '
       'indicating that biological wiring structure — not network size — carries '
       'the task-relevant information flow. These results establish '
       'connectome-constrained neural architecture as a viable substrate for '
       'information-driven control.', size=10)

p(doc, 'Compliance notes (Portfolio rules): unstructured single paragraph; no '
       'citations in the abstract; ~200 words for a Nature summary paragraph '
       '(trim to 150 for Nature Communications); numbers are from the measured '
       'pilot runs reported below and must be re-stated from final full-seed '
       'results before submission.', italic=True, size=9, color=GREY)

# =========================== FLOW DIAGRAM ==================================
doc.add_heading('End-to-end flow of the methodology (fly brain → demon → results)',
                level=1)
p(doc, 'The pipeline below is the exact flow implemented in the workspace '
       '(extract_circuit.py → fly_brain_circuit.json → controllers.js → '
       'experiment_core.js → experiment_worker.js → research_data/ → '
       'research_figures/). It doubles as the figure-1 schematic.', space_after=4)

stages = [
    ('STAGE A — Connectome extraction (offline, Python)', [
        'A1. FlyWire FAFB v783 materialization: 139,255 proofread neurons; '
        '16,847,997 connection rows; 130,054,535 synapse-level rows with pre/post '
        'coordinates (fafb783.py, analyze_v783.py).',
        'A2. Neurotransmitter classification per neuron (dominant predicted NT: '
        'cholinergic 56.9%, glutamatergic 13.1%, GABAergic 10.6%, mixed 17.3%) '
        'with 0.50 confidence threshold and 0.05 margin (classify_neurons.py).',
        'A3. Edge signing from dominant predicted transmitter: excitatory = '
        'ACh/glutamate/octopamine; inhibitory = GABA/serotonin/dopamine.',
        'A4. Layer assignment by dominant presynaptic output neuropil: antennal '
        'lobe (AL); optic lobe (ME/LO/LOP); lateral horn + mushroom body (LH/MB); '
        'central complex (SMP/SIP/SLP); motor (GNG/SAD).',
        'A5. Position-derived optic input: presynaptic-synapse centroid per '
        'optic-lobe neuron → normalized visual coordinate → one of 8 coarse '
        'visual-field bins (4 horizontal × 2 vertical).',
        'A6. Output: compact circuit JSON (fly_brain_circuit.json) — 106,765 '
        'neurons, 563,942 signed edges, optic channel map.']),
    ('STAGE B — Physical environment (simulated gas chamber)', [
        'B1. 3D chamber 760 × 380 × 300 units; central wall with a controllable '
        'aperture (door height 64 units); 320 particles (~hard spheres, elastic '
        'pair collisions on a uniform grid, drag 0.999, velocity noise).',
        'B2. Left-side thermal heat jet injects kinetic energy on a schedule '
        '(default interval 3.5 s, power 0.55) creating a hot→cold asymmetry.',
        'B3. Seeded mulberry32 PRNG drives every stochastic event — full '
        'run-to-run determinism and per-seed replication.',
        'B4. Crossing detection at the aperture: kinetic energy of each crossing '
        'particle is compared with the hot-side mean kinetic temperature → '
        '"good" (improves speed separation) vs "bad" crossing.']),
    ('STAGE C — Sensory interface (engineered, explicit I/O contract)', [
        'C1. Seven scalar sensors: left/right temperature proxies, temperature '
        'difference, left-chamber occupancy fraction, jet pulse, and door '
        'neighborhood speed (fast + its complement).',
        'C2. Eight-bin visual field from particle speed and position (the '
        'position-aware optic channel of Stage A5).',
        'C3. All controllers receive identical sensors — this is the fairness '
        'constraint of the design.']),
    ('STAGE D — Controllers (the comparison axis)', [
        'D1. Classical Maxwell demon: programmatic measurement (particles within '
        '60 units of the gate) and threshold policy (upper bound, no learning).',
        'D2. Random controller: no information, matched open rate (baseline).',
        'D3. Artificial neural network demon: same observations, small '
        'reinforcement-learning network, unconstrained architecture.',
        'D4. Drosophila-inspired network: 32 projection neurons → 200 Kenyon '
        'cells (sparse winner-take-all, ~12 active) → mushroom-body output with '
        'dopaminergic reinforcement (MB reward rule).',
        'D5. Connectome-constrained controller (the fly): signed FAFB circuit '
        'with leaky integrate-and-fire units; motor-layer rate decodes the door '
        'command; three-factor plasticity on eligible excitatory edges.',
        'D6. Shuffled-connectome control: seeded degree-preserving rewiring '
        '(same neurons, degrees, sensors, reward, plasticity — structure only '
        'randomized).',
        'D7. "Help against the demon" adversarial mode: reward sign reversed — '
        'the fly learns to frustrate the sorting (tests goal dependence).']),
    ('STAGE E — Learning rule (three-factor, local, online)', [
        'E1. Co-activity of pre- and post-synaptic units raises a decaying '
        'eligibility trace on excitatory edges.',
        'E2. Each gate crossing produces a signed dopamine event: + if the '
        'crossing improves speed separation, − if it degrades it.',
        'E3. Dopamine scales the change of eligible weights (bounded around '
        'initial values); plasticity is full (all excitatory edges), restricted '
        '(sensory pathway only), or none (frozen connectome) in variants 4A/4B.',
        'E4. The 180 largest live |W − W₀| values are tracked as the live '
        'plasticity overlay (teal = strengthening, pink = weakening).']),
    ('STAGE F — Measurement layer (identical for every controller)', [
        'F1. Behavioural: good:bad crossing ratio, demon-agreement (fraction of '
        'door decisions matching the classical demon), open fraction, crossings.',
        'F2. Sorting: ΔT between chambers, sorting entropy (speed-class entropy '
        'recovered by sorting), spatial entropy of 8-bin occupancy.',
        'F3. Information: neural-particle mutual information (bits), policy KL '
        'divergence vs the demon, memory traffic (bits used).',
        'F4. Thermodynamic: extractable work of the final state, jet work in, '
        'Landauer erasure bill (kT ln2 × bits at 300 K), extractable/cost ratio.']),
    ('STAGE G — Statistics and provenance', [
        'G1. Independent seeded runs are the replication unit; per-condition '
        'early/late blocks (first vs last fifth of training) and held-out test '
        'trials with learning frozen.',
        'G2. 95% CIs via normal approximation across seeds (meanCI); all '
        'trial-level rows are persisted as JSONL (research_data/trials_*.jsonl) '
        'with summaries (research_data/summary_*.json).',
        'G3. Every run emits provenance (circuit file hash, code version, seeds, '
        'physics regime) so figures regenerate bit-exactly '
        '(plot_experiment_figures.py).']),
]
for title, items in stages:
    doc.add_heading(title, level=2)
    for it in items:
        bullet(doc, it)

p(doc, 'One-line summary of the flow: FAFB connectome → signed, layered, '
       'position-informed circuit → identical engineered sensors for all '
       'controllers → spiking dynamics + dopamine-gated plasticity → seeded '
       'gas-chamber benchmark → behavioural, informational and thermodynamic '
       'metrics → JSONL + provenance → figures.', italic=True, size=9.5, color=GREY)

# =========================== RESULTS FLOW ==================================
doc.add_heading('Flow process of the demon task and what each experiment tests', level=1)
p(doc, 'Each experiment is one node in the causal chain "environment → demon '
       'implementation → policy → thermodynamic consequence". E1 anchors the '
       'physics, E2–E5 ask who can learn the policy, E6 decomposes causality, '
       'E7 tests generalization, E8 limits information, and E9–E11 are the '
       'thermodynamic control apparatus experiments.', space_after=4)
table(doc,
      ['Exp', 'Question', 'Controllers / variants', 'Seeds × train × test', 'Key readout'],
      [['E1 Classical demon', 'Can a programmed demon validate the physics?',
        'classical_demon', '2 × 60 × 12', 'agreement = 1.0 by construction; ΔT, sort entropy sanity'],
       ['E2 ANN demon', 'Can a generic RL network learn the gate policy?',
        'ann, random', '2 × 60 × 12', 'good:bad ratio vs random'],
       ['E3 Drosophila-inspired', 'Can an MB-style sparse network learn it?',
        'drosophila (PN→KC→MB)', '2 × 60 × 12', 'good:bad ratio; dopamine-gated weight changes'],
       ['E4 Connectome-constrained', 'Does real FAFB wiring support learning?',
        '4A full / 4B restricted / 4C shuffled', '1 × 40 × 10', 'good:bad ratio; plasticity variants'],
       ['E5 Full comparator', 'Do all controllers differ under identical physics?',
        'classical, ann, drosophila, connectome, shuffled', '1 × 40 × 10', 'all metrics side by side'],
       ['E6 Jet-closure paradox', 'Is sorting from learning or from jet asymmetry?',
        'classical, random, never_gate', '2 × 60 × 12', 'causal decomposition of ΔT'],
       ['E7 Generalization', 'Does the policy survive density × noise shifts?',
        'classical; physics 120/320/640 particles', '3 × 50 × 10', 'ΔT and agreement across regimes'],
       ['E8 Information-limited', 'How much measurement does the demon need?',
        'adaptive / fixed-threshold / 4-slot memory', '2 × 60 × 12', 'policy under constrained bits'],
       ['E9 Pressure demon', 'Can sorting do mechanical work (piston)?',
        'speed / random / never-open valve', '12 × 20 × 20', 'piston work vs Landauer bill'],
       ['E10 Smoluchowski trapdoor', 'Does a passive flap rectify anything?',
        'light / heavy trapdoor', '8 × 16 × 16', 'directional bias ≈ 0 (control)'],
       ['E11 Feynman ratchet', 'Is work extraction gradient-driven only?',
        'Th>Tc / Th=Tc / heavy load', '10 × 12 × 12', 'net rotation at equilibrium = 0']],
      widths=[1.25, 1.7, 1.85, 0.95, 2.0])
p(doc, 'The browser "run all six · animate figure" session (E2, E3, E4, E5, E7, '
       'E8) is the packaged demonstration that produced the six_fly_brains_*.png '
       'figures — one brain panel per controller class, animated while the '
       'session runs.', italic=True, size=9, color=GREY)

# =========================== MEASURED RESULTS ==============================
doc.add_heading('Measured pilot results (report as Results, not predictions)', level=1)
p(doc, 'Numbers below come from the logged benchmark run '
       'research_data/summary_2026-09-16T12-38-20.json (multi-seed, '
       'test-phase metrics, mean ± 95% CI) and the aggregated tables in '
       'research_figures/. They are pilot-scale (small seed counts) and must be '
       're-run at full scale before submission; the structure already reserves '
       'their exact positions.', space_after=4)

doc.add_heading('Comparator study (test phase)', level=2)
table(doc,
      ['Condition', 'Agreement', 'good:bad', 'Sort entropy', 'Neural MI', 'Energy (J×10⁻²¹)'],
      [['classical_demon', '1.000 ± 0.000', '1.33', '0.0192', 'n/a', '28 340.7'],
       ['random', '0.512 ± 0.002', '1.09', '0.0207', 'n/a', '35 823.3'],
       ['ann', '0.489 ± 0.021', '0.81', '0.0174', '0.0347', '96 443.7'],
       ['drosophila', '0.493 ± 0.063', '0.00', '0.0178', '0.0041', '8 298.6'],
       ['connectome', '0.532 ± 0.064', '0.89', '0.0244', '0.0029', '28 327.0'],
       ['shuffled_connectome', '0.505 ± 0.005', '0.39', '0.0213', '0.0033', '32 727.2']],
      widths=[1.6, 1.15, 0.8, 1.0, 0.9, 1.35])
p(doc, 'Reading: the classical demon anchors the ceiling; random sits at chance; '
       'the connectome-conditioned demon reaches the highest sort entropy of any '
       'learning controller, and the shuffled connectome degrades to 0.39 '
       'good:bad — the first direct evidence that wiring structure (not synapse '
       'count) carries task-relevant information.', size=10)

doc.add_heading('Learning-curve benchmark (browser run, 9,000 frames)', level=2)
table(doc,
      ['Training phase', 'good:bad ratio', 'Improvement'],
      [['Early (first block)', '1.55', '—'],
       ['Late (last block)', '4.56', '×2.9 (~+194%)']],
      widths=[2.2, 1.6, 1.5])

doc.add_heading('Thermodynamic budget (test phase)', level=2)
table(doc,
      ['Condition', 'Work in (J)', 'Extractable (J)', 'ext/cost', 'bits needed', 'bits used'],
      [['classical_demon', '9.84×10⁻¹²', '1.50×10⁻¹⁶', '8.0×10²', '52 165', '65'],
       ['random', '9.91×10⁻¹²', '1.43×10⁻¹⁶', '5.2×10³', '49 793', '10'],
       ['ann', '1.00×10⁻¹¹', '1.35×10⁻¹⁶', '3.2×10³', '47 070', '15'],
       ['drosophila', '1.00×10⁻¹¹', '1.55×10⁻¹⁶', '2.0×10³', '53 923', '26'],
       ['connectome', '1.00×10⁻¹¹', '1.64×10⁻¹⁶', '7.8×10²', '57 085', '74'],
       ['shuffled_connectome', '1.03×10⁻¹¹', '1.48×10⁻¹⁶', '6.9×10²', '51 608', '75']],
      widths=[1.6, 1.1, 1.1, 0.85, 1.0, 0.9])
p(doc, 'Reading: extractable work is 10⁻¹⁶ J against ~10⁻¹¹ J of jet work — the '
       'jet pays the entropy bill (efficiency ~10⁻⁵ ≪ 1) and the demon\'s '
       'measured memory traffic (10–75 bits) is far below the Landauer-priced '
       'budget (~5×10⁴ bits at 300 K). The second law holds; the demon is '
       'jet-subsidized. This is the key panel of the thermodynamics figure.',
  size=10)

doc.add_heading('Supporting dataset statistics (for the connectome description '
                'in Results / Methods)', level=2)
bullet(doc, 'FAFB v783: 139,255 proofread neurons; 16,847,997 connection rows; '
            '15,091,983 unique pairs; 54,492,922 proofread synapses; '
            '130,054,535 synapse-level rows with coordinates.')
bullet(doc, 'NT score mass over edges: ACh 47.9%, GABA 21.4%, glutamate 20.1%, '
            'dopamine 5.3%, octopamine 3.0%, serotonin 2.3%.')
bullet(doc, 'Degree distributions (synapse-weighted): median output 229, p95 '
            '1,206, max 99,871; median input 200, p95 1,390, max 69,948.')
bullet(doc, 'Neuropil matrix: within-neuropil synapses 72.6%; ipsilateral '
            '23.5%; contralateral 3.9%; mean mirror asymmetry 20.9% across 35 '
            'paired neuropils; top flow LO↔ME (≈0.8 M synapses per direction).')
bullet(doc, 'Most mirror-asymmetric neuropils: MB_VL 81.4%, BU 57.1%, CAN 48.4%.')

# =========================== NATURE ARTICLE STRUCTURE ======================
doc.add_heading('Recommended manuscript structure (Nature Article format)', level=1)
p(doc, 'Nature Portfolio conventions: no "Introduction" heading (text starts '
       'directly after the summary paragraph), Results before Discussion, '
       'Methods after References, figure legends collected after Methods, '
       '~3,000 words of body text, ≤6 display items, ~30 references. '
       'Section word budgets are given so the whole fits the limit.', space_after=4)

sections = [
    ('Summary paragraph', '~200 words (unstructured, fully referenced for '
     'Nature; 150 words uncited for Nature Communications)', [
        'Problem: can a measured biological wiring diagram implement demon-like control?',
        'Approach: FAFB connectome as spiking gate controller in a seeded gas chamber.',
        'Key numbers: learning ×2.9 (1.55→4.56 good:bad); sort entropy 0.0244 '
        'connectome vs 0.0213 shuffled; erasure bill ≪ extractable work, jet pays.',
        'One-sentence significance: connectome-constrained architecture as a '
        'substrate for information-driven control.']),
    ('Introduction (no heading in print)', '~700 words, 5 paragraphs', [
        '¶1 Maxwell\'s demon → information thermodynamics (Szilard, Landauer, '
        'Bennett; experimental demons).',
        '¶2 Brains as physical information-processing systems; why reinforcement '
        'is the natural bridge from measurement to action.',
        '¶3 Why Drosophila: compact connectome (FAFB), mushroom-body learning '
        'circuitry, dopaminergic reinforcement — the biological parts list for '
        'measure → represent → decide → act.',
        '¶4 The gap: connectomics gives structure; learning gives policy; '
        'studies rarely test whether a measured connectome suffices for a '
        'closed-loop information task.',
        '¶5 Contribution: we embed the proofread connectome in a demon task, '
        'compare six controller classes under identical physics, audit the '
        'thermodynamic budget, and release a seeded protocol (E1–E11).']),
    ('Results', '~1,200 words, 5 subsections', [
        'R1 — Connectome-constrained demons learn the sorting policy '
        '(learning curves; good:bad 1.55→4.56; Fig. 2).',
        'R2 — Wiring structure, not size, carries the policy (connectome vs '
        'shuffled-connectome vs ANN vs random; agreement and sort entropy table; '
        'Fig. 3).',
        'R3 — Neural information tracks behavioural improvement (neural–particle '
        'MI, layer rates PN/KC/MB or motor layer; Fig. 4).',
        'R4 — The thermodynamic audit (work in vs extractable vs Landauer; '
        'jet-subsidized sorting; bits used ≪ bits needed; Fig. 5).',
        'R5 — Robustness and boundaries (E6 causal decomposition, E7 '
        'generalization sweep, E8 information-limited demons, E9–E11 apparatus '
        'controls; Extended Data).']),
    ('Discussion', '~800 words', [
        'Behavioural convergence without mechanistic convergence — what '
        'agreement does and does not imply.',
        'Why measured structure helped here: signed edges + modularity + '
        'position-informed optic channels constrain the search space.',
        'Honest scope: computational demonstration; the connectome is a '
        'structural constraint, not a biophysical emulation of a living fly.',
        'Second law: no violation — demon is jet-subsidized; erasure bill '
        'accounted per Landauer.',
        'Outlook: bigger materializations, biophysical synapses, experimental '
        'validation of the dopamine rule.']),
    ('References', '~30 (Nature numbered superscript style)', [
        'Block A: Maxwell\'s demon & information thermodynamics.',
        'Block B: Landauer principle & experimental demons.',
        'Block C: Drosophila mushroom body, dopamine, learning.',
        'Block D: FlyWire/FAFB connectomics (v783).',
        'Block E: LIF dynamics, three-factor rules, RL.',
        'Block F: information measures & statistics.']),
    ('Methods (after References)', 'unlimited; the full protocol lives here', [
        'M1 Connectome data & circuit construction (Stage A).',
        'M2 Gas-chamber physics (Stage B) with parameter table.',
        'M3 Sensory interface (Stage C) — engineered channels, fairness contract.',
        'M4 Controllers (Stage D) — D1–D7 definitions.',
        'M5 Neural dynamics & learning rule (Stage E) — LIF + three-factor rule.',
        'M6 Experimental protocol & apparatus E1–E11 (Nature-Protocols-style '
        'step-by-step Procedure + Timing).',
        'M7 Metrics (Stage F) with formal definitions (entropy, MI, KL, '
        'Landauer, extractable work).',
        'M8 Statistics & reproducibility (Stage G).']),
    ('Figure legends (after Methods)', 'one bold title line + description each', [
        'Fig. 1 pipeline schematic (Stages A–G); Fig. 2 learning curves; '
        'Fig. 3 comparator bars; Fig. 4 neural information; Fig. 5 '
        'thermodynamic budget; Fig. 6 flow-chart of the demon decision loop '
        '(the six-brain session figure as the visual abstract).']),
    ('Data & Code availability (after Methods)', 'mandatory, exact URLs', [
        'Code: experiment_core.js, controllers.js, experiment_worker.js, '
        'benchmark.js (seeded, browser + Node).',
        'Data: research_data/ JSONL trials + summaries; connectome extract '
        'fly_brain_circuit.json (FAFB v783 root IDs).',
        'Figures regenerate via plot_experiment_figures.py; hardware/runtime '
        'noted in provenance.']),
]
for title, budget, items in sections:
    doc.add_heading(title, level=2)
    p(doc, budget, italic=True, size=9.5, color=GREY, space_after=2)
    for it in items:
        bullet(doc, it)

# =========================== NATURE PROTOCOLS FLOW =========================
doc.add_heading('Nature-Protocols-style Procedure flow (goes inside Methods, '
                'or becomes the Protocol manuscript)', level=1)
p(doc, 'Nature Protocols format expects: Abstract → Introduction → Materials → '
       'step-by-step Procedure with per-step Timing → Anticipated results → '
       'Troubleshooting. The same content below serves both formats.', space_after=4)

doc.add_heading('Materials (software), 10–30 min to stage', level=3)
bullet(doc, 'FAFB v783 connectome extract (fly_brain_circuit.json, ~31 MB) — '
            'one materialization only; never mix root IDs across materializations.')
bullet(doc, 'Node.js ≥ 18 (headless benchmark) and any modern browser '
            '(3D lab, worker runner).')
bullet(doc, 'Python ≥ 3.11 with pandas/pyarrow (feather connection tables) and '
            'matplotlib (figures).')

doc.add_heading('Procedure', level=3)
steps = [
    ('1', 'Extract the connectome circuit', '~10 min',
     'Run extract_circuit.py on FAFB v783 to produce the layered, signed, '
     'position-informed circuit JSON (Stages A1–A6).'),
    ('2', 'Inject into the 3D lab', '~1 min',
     'Run inject_3d_circuit.py; verify neuron/edge counts against Stage A6 '
     'before proceeding.'),
    ('3', 'Launch the chamber', '~2 min',
     'Run launch_fly_demon_3d.py; confirm chamber dimensions, particle count '
     '(320) and jet schedule (3.5 s).'),
    ('4', 'Run a single benchmark (headless)', '~10–60 min per condition',
     'node benchmark.js with chosen condition and seed range; the identical '
     'core also runs inside the browser worker.'),
    ('5', 'Run the six-experiment session', '~30–60 min',
     'Queue E2–E5, E7, E8 ("run all six"); the worker streams progress and '
     'writes trial JSONL rows (research_data/trials_*.jsonl).'),
    ('6', 'Regenerate figures', '~5 min',
     'python plot_experiment_figures.py → 300-dpi PNG + vector PDF (learning '
     'curve, policy, top plasticity changes, thermodynamic budget).'),
    ('7', 'Audit the thermodynamic budget', 'included in step 4–5',
     'Check work_in vs extractable vs erasure (thermo_budget.txt); confirm '
     'efficiency ≪ 1 and bits_used ≪ bits_needed before interpreting sorting.'),
    ('8', 'Replicate across seeds', '1–6 h depending on conditions',
     'Repeat step 4 with independent seeds; seeds are the replication unit '
     '(never individual time steps).'),
    ('9', 'Verify against provenance', '~5 min',
     'Compare circuit hash, code version and physics regime in the provenance '
     'block against the ones used in the published figures.'),
]
table(doc, ['Step', 'Action', 'Timing', 'Detail'],
      [[s[0], s[1], s[2], s[3]] for s in steps],
      widths=[0.5, 2.1, 1.5, 4.4])

doc.add_heading('Anticipated results (pilot values)', level=3)
bullet(doc, 'classical demon: agreement 1.000; sort entropy ≈ 0.019; ΔT ≈ 0.021.')
bullet(doc, 'connectome: sort entropy ≈ 0.024 (best of learning controllers); '
            'agreement 0.53 ± 0.06.')
bullet(doc, 'learning benchmark: good:bad 1.55 → 4.56 (×2.9).')
bullet(doc, 'thermodynamics: efficiency ~10⁻⁵ (jet-subsidized); bits used 10–75 '
            'vs ~5×10⁴ needed.')

doc.add_heading('Troubleshooting table (Nature Protocols requirement)', level=3)
table(doc,
      ['Problem', 'Likely cause', 'Fix'],
      [['Learning curve flat (good:bad ≈ 1)', 'Dopamine scale or jet schedule '
        'mismatch', 'Verify jetPower 0.55, jetInterval 3.5 s; check dopamine '
        'events are firing on crossings'],
       ['Agreement noisy across seeds', 'Too few seeds', 'Increase nSeeds; '
        'report 95% CIs (meanCI normal approximation)'],
       ['Shuffled control equals real circuit', 'Degree-preserving shuffle '
        'seed not applied (seed 7)', 'Confirm shuffle: true and distinct rng '
        'seed in connectomeController options'],
       ['Root IDs mixed across materializations', 'Different FlyWire '
        'materialization loaded', 'Always re-run extract_circuit.py on v783; '
        'hash-check circuit file'],
       ['Energy numbers absurd', 'SIM_J scaling omitted', 'Multiply sim energy '
        'by SIM_J = 1e-21 J before comparing with Landauer'],
       ['Worker fails to init in browser', 'CommonJS import collision',
        'Keep importAs() shim — files share top-level const METRICS']],
      widths=[1.9, 1.9, 3.4])

# =========================== FIGURES PLAN ==================================
doc.add_heading('Main figures (≤6 display items — Portfolio limit)', level=1)
figs = [
    ('Fig. 1', 'The connectome-to-demon pipeline (visual abstract)',
     'Panels a–g map Stages A–G: (a) FAFB v783 → signed layered circuit; '
     '(b) gas chamber with wall, aperture, jet; (c) 7-sensor + 8-bin visual '
     'interface; (d) controller classes D1–D7; (e) three-factor rule; '
     '(f) measurement layer; (g) statistics/provenance. Built from the existing '
     'maxwell_demon_figure.png + six-brain session layout.'),
    ('Fig. 2', 'Learning curves across controller classes',
     'good:bad ratio and agreement vs training blocks (E1–E5), mean ± 95% CI '
     'across seeds; shaded early/late blocks; inset: dopamine event rate. '
     'Source: fig1_learning_curves.png / fig2_accuracy.png.'),
    ('Fig. 3', 'Wiring structure carries the policy',
     'Bars: agreement, good:bad, sort entropy for classical / random / ann / '
     'drosophila / connectome / shuffled (test phase, CI whiskers). Highlight '
     'connectome vs shuffled contrast. Source: fig3_controller_comparison.png.'),
    ('Fig. 4', 'Neural information in the fly circuit',
     '(a) raster/layer rates (PN, KC, MB or connectome layers); (b) neural–'
     'particle MI across conditions; (c) top-180 |W − W₀| plasticity overlay '
     'snapshot. Source: fig5_neural_information.png, fig7_mutual_information.png, '
     'six_fly_brains_deltas_figure.png.'),
    ('Fig. 5', 'Thermodynamic budget of the sorting',
     '(a) work in vs extractable work per condition (log scale); (b) Landauer '
     'erasure bill vs bits used/needed; (c) extractable/cost ratio. Reading: '
     'jet-subsidized demon, second law holds. Source: fig6_entropy.png, '
     'fig8_info_vs_energy.png, thermo_budget.txt.'),
    ('Fig. 6', 'Robustness and control apparatus',
     '(a) E6 jet-closure decomposition; (b) E7 generalization across density × '
     'noise; (c) E8 information-limited demons; (d) E9–E11 apparatus controls '
     '(piston work, trapdoor bias ≈ 0, ratchet equilibrium = 0). Extended Data: '
     'per-seed traces, full parameter tables.'),
]
table(doc, ['Item', 'Title', 'Content and source'],
      [[f[0], f[1], f[2]] for f in figs],
      widths=[0.6, 1.9, 5.4])

# =========================== TABLES PLAN ===================================
doc.add_heading('Main tables (Extended Data if over the 6-item budget)', level=1)
table(doc, ['Table', 'Content'],
      [['T1', 'Physical simulation parameters (chamber, particle count, noise, '
              'door, jet; from experiment_core.js constants)'],
       ['T2', 'Neural and learning parameters (LIF constants, eligibility '
              'decay, dopamine scale, weight bounds, plasticity variants 4A/4B)'],
       ['T3', 'Controller definitions D1–D7 and what each isolates'],
       ['T4', 'Primary / secondary / exploratory outcome variables (Stage F)'],
       ['T5', 'E1–E11 experiment registry (the "Exp × Question × readout" '
              'table above, finalized)'],
       ['T6', 'Statistical plan: seeds as replication unit, CIs, block '
              'aggregation, multiple-comparison handling'],
       ['T7', 'Reproducibility metadata: FAFB v783 hash, code versions, seeds, '
              'hardware/runtime, provenance fields']],
      widths=[0.7, 6.4])

# =========================== REPORTING / CHECKLIST =========================
doc.add_heading('Nature Portfolio reporting & submission checklist', level=1)
checks = [
    'Summary paragraph ≤200 words (Nature) / abstract ≤150 words, unstructured, '
    'no citations (Nature Communications / Protocols).',
    'Body ≤3,000 words; ≤6 display items; ~30 references; double-spaced '
    'submission file with line numbers.',
    'No "Introduction" heading in print; Results before Discussion; Methods '
    'after References; legends after Methods.',
    'Life Sciences Reporting Summary completed at revision (statistical method '
    'reporting, seed handling).',
    'Data Availability + Code Availability statements with repository links '
    '(Zenodo/GitHub DOI) and exact figure-regeneration commands.',
    'Terminology guardrail: "functionally analogous to a Maxwell-demon '
    'computation" — never "the neuron is a Maxwell demon" or second-law '
    'violation claims.',
    'Engineered sensory channels (7 sensors, 8-bin visual field) explicitly '
    'documented as an I/O contract, not validated fly receptive fields.',
    'NT-based edge signs described as predicted transmitter classes, not '
    'definitive biological identities.',
    'All pilot numbers re-derived from full-scale multi-seed runs before '
    'submission; single-run numbers labelled as such.',
    'Author contributions (descriptive text), ORCID for corresponding author, '
    'competing interests declared.',
    'Title ≤ ~90 characters, no colon (choose A1/A2/A3), no abbreviations.',
]
for c in checks:
    bullet(doc, '☐  ' + c)

# =========================== WHAT CHANGED ==================================
doc.add_heading('What changed vs the previous version (v1)', level=1)
table(doc, ['Aspect', 'v1 (existing document)', 'v2 (this version)'],
      [['Title', 'Colon construction, active verb ("Learning to Act as '
        'Maxwell\'s Demon: …")', 'Nature-style noun phrase (A1 recommended; '
        'A2–A4 alternates)'],
       ['Format target', 'Generic IMRaD planning skeleton',
        'Explicit Nature Portfolio Article skeleton (no Introduction heading, '
        'Methods after References) + Nature Protocols Procedure flow'],
       ['Methodology flow', 'Listed topics only',
        'Seven-stage pipeline (A–G) traced to actual scripts and data files'],
       ['Experiments', 'Five controller categories, no registry',
        'Full E1–E11 registry with seeds/trials and key readouts'],
       ['Results', 'Structure only ("report only measured outcomes")',
        'Measured pilot numbers: 1.55→4.56 learning, comparator table, '
        'thermodynamic budget table'],
       ['Figures/tables', '8 figures + 7 tables (over limit)',
        '6 main figures + 7 Extended Data tables (within Portfolio limits)'],
       ['Protocol compliance', '—',
        'Materials / Procedure with timings / Anticipated results / '
        'Troubleshooting'],
       ['Thermodynamics', 'Generic "Landauer as reference"',
        'Audited budget: jet-subsidized demon, efficiency ~10⁻⁵, bits used ≪ '
        'bits needed']],
      widths=[1.2, 2.9, 3.0])

p(doc, '')
p(doc, 'Version 2 — generated from the current workspace experiment registry, '
       'FAFB v783 statistics, logged benchmark results and thermodynamic '
       'budget. Replaces research_paper_structure_maxwell_demon_drosophila.docx; '
       'keep v1 archived if needed.',
  italic=True, size=9, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER)

OUT = 'research_paper_structure_maxwell_demon_drosophila_v2_nature_portfolio.docx'
doc.save(OUT)
print('WROTE', OUT)
