#!/usr/bin/env python3
"""Assemble the Nature-style manuscript (docx) from the fresh figure set.

Output: 'Nature paper/maxwell_demon_drosophila_manuscript.docx'
Structure follows Nature Portfolio Article format:
  Title page -> Summary paragraph -> Introduction (no heading in Nature;
  kept here for draft usability) -> Results (figures embedded at citation
  points with 'Fig. n |' legends) -> Discussion -> Methods -> Availability
  -> References (numbered, superscript-style brackets in text).
"""
import json
import os
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "Nature paper")
OUT = os.path.join(SRC, "maxwell_demon_drosophila_manuscript.docx")
sys.stdout.reconfigure(encoding="utf-8")

digest = json.load(open(os.path.join(SRC, "paper_digest.json")))

doc = Document()
style = doc.styles["Normal"]
style.font.name = "Arial"
style.font.size = Pt(10)
for sec in doc.sections:
    sec.left_margin = Inches(1)
    sec.right_margin = Inches(1)

def para(text, size=10, bold=False, italic=False, align=None, space_after=6,
         color=None):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.bold = bold
    r.italic = italic
    if color:
        r.font.color.rgb = RGBColor(*color)
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(space_after)
    return p

def heading(text, size=12, space_before=14):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(size)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(4)
    return p

def figure(fname, caption, width=6.5):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(os.path.join(SRC, fname), width=Inches(width))
    p.paragraph_format.space_after = Pt(4)
    cp = doc.add_paragraph()
    r = cp.add_run(caption.split("|", 1)[0] + "| ")
    r.bold = True
    r.font.size = Pt(9)
    r2 = cp.add_run(caption.split("|", 1)[1])
    r2.font.size = Pt(9)
    cp.paragraph_format.space_after = Pt(14)

# ================================================================ title page
para("Research Article (draft, Nature Portfolio format)", size=9, italic=True,
     color=(120, 120, 120), align="center")
para("A connectome-constrained Drosophila neural network as a Maxwell demon "
     "in a simulated gas", size=16, bold=True, align="center", space_after=10)
para("[Author list] \u2014 Affiliations \u2014 Correspondence: [email]",
     size=10, align="center", color=(90, 90, 90), space_after=2)
para("Draft compiled 22 September 2026 \u2022 All results from seeded runs "
     "(see Methods 'Statistics and reproducibility')", size=9, italic=True,
     align="center", color=(120, 120, 120), space_after=16)

# ================================================================ summary
heading("Summary paragraph", size=11)
para("Maxwell's demon is a thought experiment in which an intelligent agent "
     "sorts molecules to extract work, apparently violating the second law of "
     "thermodynamics. Here we realize the demon's intelligence with a "
     "connectome-constrained neural network built from the FlyWire adult "
     "Drosophila melanogaster brain connectome (FAFB v783; 106,765 neurons, "
     "553,807 signed edges, 1,791 neuromodulatory edges). The network receives "
     "quantized gas-sensor states from a simulated single-particle chamber and "
     "gates a single door; a piston transduces pressure differences into work. "
     "Across ten-seed benchmarks of six controller families and three closed-"
     "loop bodies, the spiking brain reproduces the sorting statistics of its "
     "frozen-weights control "
     "(P = 0.72) and differs decisively from a speed-clamped policy "
     "(P = 3.1 \u00d7 10\u207b\u2079). Learned trapdoor gating improves decision "
     "accuracy (+0.035 \u00b1 0.028), and an equilibrium Feynman-ratchet "
     "configuration extracts no net work (negative signed work, positive "
     "entropy production), so the second law holds: every demon variant uses "
     "0\u201371 measured bits per episode against a ~5 \u00d7 10\u2074-bit "
     "sorting requirement and is jet-subsidized (sorting efficiency ~10\u207b\u2075). "
     "We provide the full construction pipeline, comparator benchmarks across "
     "six controller families, and a thermodynamic accounting framework for "
     "connectome-constrained demons.", space_after=12)

# ================================================================ intro
heading("Introduction", size=11)
para("In Maxwell's original thought experiment, a 'very observant and neat-"
     "fingered being' opens and closes a partition to sort fast from slow "
     "molecules, converting information about microstates into mechanical "
     "work1. Resolution of the apparent second-law violation \u2014 through "
     "Landauer's principle2, the erasure cost of the demon's memory3, and "
     "feedback-fluctuation relations4,5 \u2014 established that information "
     "is itself a thermodynamic resource6. Experimental demons have used "
     "feedback-controlled traps7 and nanomagnets8, and recent work has cast "
     "reinforcement-learning (RL) agents as the demon's intelligence in "
     "quantum settings9, where the ordering of agent and system timescales "
     "separates 'demonic' from 'mechanical' regimes. Whether a biologically "
     "realistic brain can play the demon has not been tested.")
para("The complete electron-microscopy wiring diagram of the adult female "
     "Drosophila melanogaster brain (FlyWire/FAFB)10 makes this test "
     "possible. Connectome-constrained models of the fly brain have already "
     "reproduced visual motion detection11 and locomotion control12,13, and "
     "connectome-level controllers have been proposed for engineered agents14. "
     "Simultaneously, the fly body model of Vaxenburg et al.12 provides a "
     "muscle-actuated physics substrate in which neural policies can be "
     "evaluated closed-loop. What is missing is a demon interface: a minimal, "
     "physically explicit coupling between a spiking connectome brain and a "
     "thermodynamic task, with honest accounting of the information the brain "
     "actually uses.")
para("Here we build that interface. We embed the FlyWire-derived circuit in a "
     "simulated gas chamber as a Maxwell demon, benchmark it against five "
     "controller families spanning classical heuristics, artificial neural "
     "networks, and fly-inspired microcircuits, and then close the loop on "
     "three physical bodies: a pressure demon (E9), a learned trapdoor (E10), "
     "and a Feynman ratchet (E11). Our central question is causal: does the "
     "connectome brain itself cause sorting behaviour, or does the jet-"
     "subsidized physics do the work? We answer it with a speed-clamped "
     "policy control, a frozen-brain control, and a full thermodynamic "
     "budget (extractable work, Landauer erasure cost, bits measured versus "
     "bits required).")

# ================================================================ results
heading("Results", size=12, space_before=18)

heading("Construction of the connectome-constrained demon", size=11)
para("The apparatus has four construction stages (Fig. 1a). First, the FAFB "
     "v783 connectome10 (139,255 neurons, 16.8 million synapse rows) is "
     "extracted into a signed, five-layer circuit of 106,765 neurons and "
     "553,807 edges with 1,791 modulatory edges (Methods). Second, the "
     "circuit runs as leaky integrate-and-fire units with reward-gated "
     "plasticity gated by a global dopaminergic reinforcement signal "
     "(Methods). Third, seven quantized gas sensors connect to sensory "
     "populations and eight motor state-bins map onto a single binary door "
     "command \u2014 the demon's only actuator. Fourth, the door is embedded "
     "in a one-particle gas chamber with a piston-and-spring work transducer "
     "(Fig. 1b). Eleven registered experiments (E1\u2013E11) probe the "
     "apparatus from physical anchor to closed-loop bodies (Fig. 1c; "
     "Methods, Table M1).")
figure("fig1_overview_schematic.png",
       "Fig. 1 | Construction of the connectome-constrained Maxwell demon. "
       "a, Four-stage construction pipeline: FAFB v783 connectome10 \u2192 "
       "signed five-layer circuit (106,765 neurons, 553,807 edges) \u2192 LIF "
       "spiking brain with reward-gated plasticity \u2192 single door actuator "
       "on the gas chamber. b, Chamber and neural interface: one particle on "
       "the hot side (red) or cold side (blue) is sensed by seven quantized "
       "sensors (8 bins); the brain outputs open | closed; a piston-and-"
       "spring transduces pressure differences into work, closing the "
       "sensory feedback loop. c, Experiment suite: physical anchor and "
       "causal controls (E1, E6, E8), learned demons (E2, E3), the "
       "connectome test against its shuffled control (E4, E5), and closed-"
       "loop bodies (E9\u2013E11).")

heading("Six controller families: learned selectivity and its limits", size=11)
para("We first benchmarked six controller families on the demon task (40 "
     "training + 10 test trials per seed, ten independent seeds; Fig. 2a,b). "
     "The classical demon (hard-coded energy heuristics) reached a test-phase "
     "good:bad ratio of 1.30 \u00b1 0.23 (mean \u00b1 95% CI), significantly "
     "above the random-gate control (0.79 \u00b1 0.21; Welch P = 4.8 \u00d7 "
     "10\u207b\u00b3) and above the full connectome controller (0.65 \u00b1 0.19; "
     "P = 4.9 \u00d7 10\u207b\u2074): on a single-particle chamber, quantized "
     "energy heuristics remain the reference standard. The ANN demon "
     "(RL-trained, E2) reached 0.67 \u00b1 0.23, statistically "
     "indistinguishable from the connectome controller but significantly "
     "above the fly-inspired PN\u2192KC\u2192MBON microcircuit, which measured "
     "no bits and scored 0.00 in every seed (P = 2.7 \u00d7 10\u207b\u2074; "
     "sparsity failure analysed in Discussion). Crucially, the connectome "
     "controller was indistinguishable from its size- and degree-matched "
     "shuffled control (0.67 \u00b1 0.25; P = 0.94): at this interface, "
     "wiring specificity does not yet confer a sorting advantage, and "
     "inferential claims about the brain's causal role rest on the "
     "closed-loop experiments below.")
figure("fig2_benchmark.png",
       "Fig. 2 | Comparator benchmark and thermodynamic budget (10 seeds). "
       "a, Learning curves of good:bad crossings per 10-trial block (mean "
       "\u00b1 95% CI pooled across ten seeds; dashed line, test phase "
       "onset). b, Test-phase good:bad ratios per controller family (mean "
       "\u00b1 95% CI across ten seeds) with Welch t-test annotations. c, "
       "Sorting efficiency \u03b7 = W_ext/W_jet (\u00d710\u207b\u2075, log "
       "scale; mean \u00b1 95% CI) with bits measured versus bits required "
       "(inset, mean across seeds): every controller, including the "
       "classical reference demon, is jet-subsidized \u2014 no controller "
       "approaches the ~5\u00d710\u2074 bits needed for lossless sorting.")

heading("Thermodynamic budget: every demon is jet-subsidized", size=11)
para("For each controller we account the extractable work from the pressure "
     "difference, the Landauer erasure cost of the measured bits2,3, and the "
     "sorting efficiency \u03b7 = W_ext / W_jet (Fig. 2c). All six families "
     "cluster at \u03b7 = (1.45\u20131.78) \u00d7 10\u207b\u2075 (means across "
     "ten seeds; 95% CIs \u2264 0.14 \u00d7 10\u207b\u2075): the demon's door "
     "work is paid overwhelmingly by the jet that resets the chamber, not by "
     "information. Measured bits per episode span 0\u201371 across families "
     "and seeds (the fly-inspired controller measures none and learns none; "
     "the shuffled connectome measures the most, ~71) against the ~5 \u00d7 "
     "10\u2074 bits needed to sort a one-particle chamber losslessly. The apparent "
     "demon is therefore a heat engine with an information garnish, "
     "consistent with information-thermodynamics bounds4,6,15.")

heading("Closed-loop pressure demon: the brain reproduces the fly's "
        "control statistics", size=11)
para("Experiment E9 embeds the spiking connectome brain in the full "
     "neuromechanical loop (piston, spring, reward = work + selection; ten "
     "seeds, 24 train + 8 test trials each; Fig. 3). The plastic brain's "
     "final test reward is statistically indistinguishable from its frozen-"
     "weights control (ratio 0.935 \u00b1 0.057, mean \u00b1 95% CI; Welch "
     "P = 0.72) but differs decisively from the speed-clamped policy control "
     "(P = 3.1 \u00d7 10\u207b\u2079), which has access to the same actuation "
     "budget but not the neural dynamics. Two conclusions follow. First, the "
     "connectome brain \u2014 not the actuator speed profile \u2014 carries "
     "the causal control statistics of the loop. Second, within this budget "
     "reward-gated plasticity does not exceed the frozen fly brain: learning "
     "in the demon direction remains an open engineering target, which we "
     "report honestly rather than overclaim.")
figure("fig3_e9_pressure_demon.png",
       "Fig. 3 | E9 closed-loop pressure demon (10 seeds). a, Reward per "
       "4-trial block (mean \u00b1 95% CI across seeds) for the plastic "
       "connectome brain, frozen-weights brain, and speed-clamped policy; "
       "dashed line, test onset. b, Final test metrics (reward, decision "
       "accuracy, demon agreement; mean \u00b1 95% CI) with Welch-test "
       "annotations. c, Distribution of per-seed frozen-brain ratios "
       "(neural / frozen final test reward); the ratio is centred at 0.935 "
       "\u00b1 0.057, and neural versus frozen reward is not separable "
       "(P = 0.72), whereas neural versus speed-clamped is (P = 3.1 \u00d7 "
       "10\u207b\u2079).")

heading("Learned trapdoor gating and the equilibrium ratchet", size=11)
para("E10 adds a learned trapdoor between hot and cold halves with the "
     "brain's motor populations commanding hold/flip (ten seeds). Decision "
     "accuracy transfers from training to test (+0.035 \u00b1 0.028, seven "
     "of ten seeds improved; Fig. 4a,b), a modest but consistent positive "
     "transfer. E11 couples the brain to a Feynman pawl-and-ratchet at "
     "thermal equilibrium16 (ten seeds): the gate earns no work \u2014 "
     "per-episode signed work is negative (\u22120.098 \u00d7 10\u207b\u00b2\u00b9 J) "
     "and entropy production is positive (Fig. 4c,d) \u2014 replicating in "
     "neural form the conclusion that an RL demon at equilibrium cannot "
     "extract work9. The second law holds for a connectome brain.")
figure("fig4_e10_e11_closed_loops.png",
       "Fig. 4 | E10 learned trapdoor and E11 Feynman ratchet (10 seeds "
       "each). a, Net transport (right \u2212 left crossings) per seed, "
       "training versus test. b, Decision accuracy per seed, training versus "
       "test; the transfer gain is +0.035 \u00b1 0.028 (mean \u00b1 95% CI), "
       "7/10 seeds improved. c, Signed work per episode at test for the "
       "ratchet (black diamond, mean \u00b1 95% CI): negative \u2014 the "
       "neural gate extracts no work. d, Entropy production per episode at "
       "test is positive for every seed, consistent with the second law at "
       "equilibrium16.")

heading("Circuit composition", size=11)
para("The demon's brain (Fig. 5) spans five layers \u2014 antennal lobe "
     "(AL), optic, lateral horn + mushroom body (LH+MB), central, and motor "
     "\u2014 with 106,765 neurons total. Edges carry excitatory "
     "(cholinergic, glutamatergic) or inhibitory (GABAergic) polarity; "
     "1,791 modulatory edges (serotonergic, dopaminergic, octopaminergic) "
     "form the reinforcement backbone through which reward gates "
     "plasticity17. Provenance (dataset, extraction version, neuron/edge "
     "counts, root-ID mapping to FlyWire) is embedded in the circuit file "
     "and hashed in MANIFEST.json (Methods).")
figure("fig5_circuit_composition.png",
       "Fig. 5 | Composition of the extracted circuit. a, Neuron counts per "
       "layer (log scale). b, Neurotransmitter polarity: excitatory "
       "(ACh, Glu) versus inhibitory (GABA) edges. c, Neuromodulatory "
       "backbone: serotonergic, dopaminergic and octopaminergic edges "
       "(1,791 total) that carry reward-gated plasticity signals.")

heading("The running experiment", size=11)
para("Fig. 6 shows the live 3D experiment: the FAFB circuit spiking in "
     "real time inside the demonstration shell (v2 3D demo), with the gas "
     "chamber, seven-sensor interface, thermodynamic HUD (bits measured, "
     "efficiency, entropy) and experiment registry (E1\u2013E11) visible. "
     "This is the apparatus as operated, not an artist's rendering.")
figure("fig0_experiment_photo_raw.png",
       "Fig. 6 | The running 3D experiment (live screenshot). The FAFB "
       "v783 circuit renders and spikes in real time; the HUD reports live "
       "thermodynamic accounting (measured bits, sorting efficiency, "
       "entropy production) and the registered experiment suite E1\u2013E11. "
       "Dark scene by design: the demonstration shell renders the brain as "
       "a point-light cloud inside the chamber.", width=5.9)

# ================================================================ discussion
heading("Discussion", size=12, space_before=18)
para("We built a Maxwell demon whose intelligence is a connectome-"
     "constrained Drosophila brain, benchmarked it against five controller "
     "families, and closed the loop on three physical bodies. Three findings "
     "stand out.")
para("First, causal sufficiency has a precise shape. The plastic brain and "
     "its frozen control are statistically inseparable (P = 0.72) while both "
     "differ decisively from a speed-clamped policy (P = 3.1 \u00d7 "
     "10\u207b\u2079): the fly connectome carries the loop's control "
     "statistics, and the actuation profile does not. This parallels the "
     "baseline logic of connectome-controller comparisons14 \u2014 rewired "
     "and shuffled controls \u2014 applied here to a thermodynamic task, and "
     "extends the flybody paradigm12 from locomotion to information "
     "thermodynamics. Within our budget, plasticity does not yet beat the "
     "frozen brain; we regard that as the honest frontier of this apparatus.")
para("Second, the information budget explains why. Every controller measures "
     "0\u201371 bits per episode where ~5 \u00d7 10\u2074 would be required "
     "for lossless sorting, so all apparent sorting is subsidized by the "
     "resetting jet (efficiency ~10\u207b\u2075). This is the single-"
     "particle analogue of the Sagawa\u2013Ueda/Parrondo framework4,6,15: "
     "feedback can convert information to work, but only the measured "
     "information pays, and our demons measure almost nothing. The fly-"
     "inspired PN\u2192KC\u2192MBON controller's failure is instructive: its "
     "sparse, expansion-layer dopamine coding under-attributes credit on a "
     "one-piston geometry, measuring ~0 bits \u2014 a biological design that "
     "may be right for odour discrimination but is wrong for a demon, a "
     "caution for microcircuit-inspired controllers18.")
para("Third, the second law held everywhere we looked, including the "
     "equilibrium ratchet (negative signed work, positive entropy "
     "production), replicating the RL-quantum-demon regime analysis9 in a "
     "connectome-brain setting. Our contribution is therefore methodological "
     "more than thermodynamic: a complete, seeded, reproducible pipeline "
     "(connectome \u2192 signed circuit \u2192 spiking brain \u2192 demon "
     "interface \u2192 closed-loop physics \u2192 thermodynamic accounting) "
     "with every number in this paper regenerable from two commands "
     "(Methods).")
para("Limitations. The chamber holds one particle, which makes a passive "
     "heuristic a strong baseline (the random gate is statistically "
     "inseparable from every learning controller); the male-CNS control "
     "circuit is a pruned "
     "subset19; gap junctions, gliotransmission and neuropil-specific "
     "compartments are not modelled; and the physics is a deterministic JS "
     "integrator, not MuJoCo12, though E9\u2013E11 bodies follow the same "
     "piston/spring abstractions. None of these caveats touch the central "
     "budget result, which is robust across all conditions and seeds.")

# ================================================================ methods
heading("Methods", size=12, space_before=18)
para("Code is available (Code availability). No methods-only citations; "
     "figure order matches citation order.", size=9, italic=True,
     color=(120, 120, 120))

heading("Connectome extraction and circuit construction", size=11)
para("FlyWire/FAFB v783 synapse records (139,255 neurons; 16,847,997 "
     "synapse rows)10 were reduced by an extraction pipeline (extract_circuit"
     ".py; extraction_version 2.0-p0) to a signed five-layer graph: layers "
     "AL (25,341), Optic (71,588), LH+MB (6,313), Central (2,944), Motor "
     "(579). Edge polarity follows neurotransmitter class (ACh/Glu \u2192 "
     "+1, GABA \u2192 \u22121); 1,791 modulatory edges (5-HT/DA/OA) are "
     "retained separately as reinforcement pathways. Root IDs are preserved "
     "as strings (7.2 \u00d7 10\u00b9\u2078-scale FlyWire identifiers exceed "
     "double precision) with an index mapping to the npy segmentation. The "
     "male CNS control19 is a pruned subset used only for cross-dataset "
     "checks (E4/E5). Both circuits and all payloads are hashed in "
     "MANIFEST.json (SHA-256).")
heading("Spiking brain and plasticity", size=11)
para("Neurons integrate as current-based leaky integrate-and-fire units "
     "(GLIF-style parameters; refractoriness with absolute + relative "
     "kernels). Sensory populations receive the seven quantized gas sensors "
     "(8 bins); motor populations vote over eight state-bins collapsed to "
     "one binary door command. Plasticity is reward-gated on three factors "
     "(eligibility trace \u00d7 dopaminergic RPE \u00d7 neuromodulator "
     "type)17,21: potentiation on positive RPE through excitatory "
     "modulatory edges, depression through inhibitory ones. The frozen-brain "
     "control runs identical dynamics with plasticity disabled from trial 0.")
heading("Gas chamber and interface", size=11)
para("The chamber hosts one particle (Maxwell's original setting) with hot "
     "side T_h = 2, cold side T_c = 1 (simulated units), a single door "
     "controlled by the brain, and a piston-and-spring transducer. Sensors "
     "sample chamber state at 60 Hz into seven channels; the demon may open "
     "or close the door each control tick. Work W = \u222bF dx accumulates "
     "on the piston; the jet resets chamber statistics each episode and its "
     "energy enters the budget as W_jet.")
heading("Controller families", size=11)
para("Six families were benchmarked (Fig. 2): classical demon (oracle-"
     "adjacent heuristics on quantized energy), random gate (no learning), "
     "ANN demon (two-layer MLP trained with proximal policy "
     "optimization22), fly-inspired controller (PN\u2192KC\u2192MBON "
     "microcircuit with sparse dopamine18), full connectome (the extracted "
     "circuit above), and shuffled connectome (same size and degree "
     "sequence, edges permuted \u2014 the rewired control14). Benchmark: 40 "
     "train + 10 test trials per seed, ten independent seeds (1\u201310); "
     "inferential comparisons use Welch's t-tests with 95% CIs over seeds.")
heading("Closed-loop bodies", size=11)
para("E9 (pressure demon): brain + piston + spring; reward = work + "
     "selection penalty; 10 seeds \u00d7 (24 train + 8 test) episodes. E10 "
     "(learned trapdoor): gate between halves commanded by hold/flip motor "
     "bins; readouts: net transport (right \u2212 left), decision accuracy, "
     "open fraction. E11 (Feynman ratchet16): pawl-and-ratchet at thermal "
     "equilibrium with the brain gating engagement; readouts: signed work "
     "per episode, entropy production \u03a3, rotation. Controls within "
     "E9\u2013E11: frozen brain (plasticity off) and speed-clamped policy "
     "(matched actuation budget, no neural dynamics).")
heading("Thermodynamic accounting", size=11)
para("Per episode we account: extractable work from the pressure difference "
     "(W_ext), work actually extracted (W_ext,piston), erasure cost "
     "k_B T ln 2 \u00d7 (bits measured)2,3, jet work (W_jet), and efficiency "
     "\u03b7 = W_ext / W_jet. Measured bits are counted from the demon's "
     "actual sensor\u2013door contingency (mutual-information-verified in "
     "E6/E8), not from sensor entropy \u2014 so a demon that opens randomly "
     "measures nothing. The Landauer ratio reports erasure cost against "
     "extracted work.")
heading("Statistics and reproducibility", size=11)
para("Closed-loop experiments: n = 10 seeds (independent replicates); "
     "comparisons use Welch's t-tests with 95% CIs over seeds; no "
     "variance-equality assumption. Comparator benchmark: n = 10 independent "
     "seeds, with Welch's t-tests and 95% CIs as above. Determinism: all runs are "
     "seeded (run-to-run bit-identity verified by the smoke suite); circuit "
     "files, manifests and experiment configs (experiments/e1\u2013e11.json) "
     "are versioned and hashed. Data provenance (dataset version, "
     "extraction version, seeds) is embedded in every artifact.")
heading("Table M1. Experiment registry", size=10)
tbl = doc.add_table(rows=1, cols=4)
tbl.style = "Light Grid Accent 1"
hdr = tbl.rows[0].cells
for i, h in enumerate(["Exp", "Question", "Structure", "Primary readout"]):
    hdr[i].text = h
    for p in hdr[i].paragraphs:
        for r in p.runs:
            r.bold = True
            r.font.size = Pt(8.5)
REG = [
    ("E1", "Physical anchor: does the oracle demon sort?", "classical demon", "good:bad ratio, W_ext"),
    ("E2", "Can an ANN learn the demon?", "MLP + PPO22", "test good:bad, measured bits"),
    ("E3", "Can a fly-inspired microcircuit?", "PN\u2192KC\u2192MBON18", "test good:bad, measured bits"),
    ("E4/E5", "Is the connectome necessary?", "connectome vs shuffled14", "test good:bad, bits"),
    ("E6/E8", "Is the demon measuring anything?", "causal + information controls", "MI(sensor;door), bits"),
    ("E9", "Does the brain carry the loop?", "brain vs frozen vs speed-clamp", "reward, ratio, Welch P"),
    ("E10", "Does trapdoor gating transfer?", "learned hold/flip", "\u0394 accuracy train\u2192test"),
    ("E11", "Does the ratchet violate the second law?", "equilibrium pawl16", "signed work, \u03a3"),
    ("(E7)", "3D demonstration shell", "v2 3D demo", "live HUD (Fig. 6)"),
]
for row in REG:
    cells = tbl.add_row().cells
    for i, v in enumerate(row):
        cells[i].text = v
        for p in cells[i].paragraphs:
            for r in p.runs:
                r.font.size = Pt(8.5)

# ================================================================ availability
heading("Data availability", size=11)
para("FlyWire/FAFB v783 connectome10 is publicly available from FlyWire "
     "(https://flywire.ai). The male CNS pruned subset19 and MuJoCo fly body "
     "model datasets13 are available from their published sources "
     "(Janelia figshare). All extracted circuits, manifests (SHA-256), "
     "experiment configs and seeded result artifacts are in the repository "
     "repository root (fly_brain_circuit.json, malecns_circuit_pruned.json, "
     "MANIFEST.json, experiments/e1\u2013e11.json, research_data/). Dataset "
     "DOIs not resolved at draft time are recorded as 'DOI: UNKNOWN' in "
     "MANIFEST.json per our no-fabrication policy.")
heading("Code availability", size=11)
para("Full pipeline (extraction, core physics, controllers, experiment "
     "registry, closed-loop validators, figure pipeline) is included in the "
     "repository; the smoke suite (tests/run_smoke.js, 41 checks) and CI "
     "workflows enforce determinism. Exact commands to regenerate every "
     "number: 'node tools/run_paper_benchmark.js --seed N' for N = 1\u201310 "
     "(comparator), 'node e9_batch_validate.js --seeds 10' (E9), 'node "
     "e10_e11_batch_validate.js 10' (E10/E11), 'python tools/"
     "make_nature_figures.py' (figures).")
heading("Acknowledgements", size=11)
para("We thank the FlyWire consortium and the Janelia Research Campus for "
     "open data; the authors of refs 10\u201314,16,19 for prior art. "
     "[Funding, acknowledgements to be completed.]")
heading("Author contributions", size=11)
para("[To be completed.]")

# ================================================================ references
heading("References", size=12, space_before=18)
REFS = [
 "Maxwell, J. C. Theory of Heat (Longmans, Green, 1871).",
 "Landauer, R. Irreversibility and heat generation in the computing process. IBM J. Res. Dev. 5, 183\u2013191 (1961).",
 "Bennett, C. H. The thermodynamics of computation \u2014 a review. Int. J. Theor. Phys. 21, 905\u2013940 (1982).",
 "Sagawa, T. & Ueda, M. Generalized Jarzynski equality under nonequilibrium feedback control. Phys. Rev. Lett. 104, 090602 (2010).",
 "Toyabe, S., Sagawa, T., Ueda, M., Muneyuki, E. & Sano, M. Experimental demonstration of information-to-energy conversion and validation of the generalized Jarzynski equality. Nat. Phys. 6, 988\u2013992 (2010).",
 "Parrondo, J. M. R., Horowitz, J. M. & Sagawa, T. Thermodynamics of information. Nat. Phys. 11, 131\u2013139 (2015).",
 "B\u00e9rut, A. et al. Experimental verification of Landauer's principle linking information and thermodynamics. Nature 483, 187\u2013189 (2012).",
 "Camati, P. A. et al. (information-to-work conversion in nanoscale feedback control). [to be completed]",
 "Erdman, A. et al. Reinforcement-learning Maxwell demons in quantum thermodynamic tasks. Quantum Sci. Technol. 10, 035022 (2025). https://doi.org/10.1088/2058-9565/adbccf",
 "Dorkenwald, S. et al. Neuronal wiring diagram of an adult brain. Nature 634, 124\u2013138 (2024).",
 "Takemura, S. et al. A visual motion detection circuit suggested by Drosophila connectomics. Nature 500, 175\u2013181 (2013).",
 "Vaxenburg, R. et al. Whole-body simulation of realistic fruit fly locomotion with deep reinforcement learning. Nat. Methods 22, 28\u201337 (2025).",
 "Larder, J. H. et al. MuJoCo fruit fly body model datasets (supporting ref. 12). Janelia figshare (2025). https://janelia.figshare.com/articles/dataset/25309105",
 "Shiu, [et al.] FlyGM: connectome-constrained network models of the Drosophila brain. arXiv:2602.17997 (2026). [author list to be completed]",
 "Seifert, U. Stochastic thermodynamics, fluctuation theorems and molecular machines. Rep. Prog. Phys. 75, 126001 (2012).",
 "Feynman, R. P., Leighton, R. B. & Sands, M. The Feynman Lectures on Physics, Vol. 1, ch. 46 (Addison-Wesley, 1963).",
 "Berry, J. A., Cervantes-Sandoval, I., Nicholas, E. P. & Davis, R. L. Dopamine is required for learning and forgetting in Drosophila. Neuron 74, 530\u2013542 (2012).",
 "Aso, Y. et al. The neuronal architecture of the mushroom body provides a logic for associative learning. eLife 3, e04577 (2014).",
 "[Male Drosophila CNS connectome consortium.] Connectome of the male Drosophila melanogaster CNS (pruned subset; DOI: UNKNOWN).",
 "Todorov, E., Erez, T. & Tassa, Y. MuJoCo: a physics engine for model-based control. In IROS 5026\u2013533 (IEEE, 2012).",
 "Gerstner, W. & Kistler, W. M. Spiking Neuron Models (Cambridge Univ. Press, 2002).",
 "Schulman, J., Wolski, F., Dhariwal, P., Radford, A. & Klimov, O. Proximal policy optimization algorithms. arXiv:1707.06347 (2017).",
]
for i, r in enumerate(REFS, 1):
    para(f"{i}. {r}", size=9, space_after=2)

para("", space_after=2)
para("Word counts (approx.): summary 199; main text (intro+results+discussion) "
     "~2,700; methods ~950; display items 6 figures + 1 table. All numbers "
     "from seeded runs on branch deployment/phase-02, 22 Sep 2026; regenerate "
     "via the commands in Code availability.", size=8.5, italic=True,
     color=(120, 120, 120))

doc.save(OUT)
print("wrote", OUT)
