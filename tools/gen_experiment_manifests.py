"""Generate experiments/*.json — machine-readable experiment manifests (Stage 6).

The EXECUTABLE source of truth is EXPERIMENTS in experiment_worker.js plus the
documented constants in experiment_core.js; these manifests mirror them for
consumers (dashboards, release tooling, reviewers). tests/run_smoke.js pins the
actual behavior (S5-S10 + golden fixture), so a stale manifest or a silent
change in the registry cannot pass CI unnoticed.

Re-run after any intentional change to the registry:
    python tools/gen_experiment_manifests.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "experiments"
OUT.mkdir(exist_ok=True)

CIRCUIT = ROOT / "fly_brain_circuit.json"
CIRCUIT_SHA = hashlib.sha256(CIRCUIT.read_bytes()).hexdigest() if CIRCUIT.exists() else None

COMMON_GAS = {
    "chamber": {"w": 760, "h": 380, "d": 300},
    "wall_thickness": 8,
    "door_gap": 0.6,
    "door_z_half": 105.0,
    "pmass_cap": 600,
    "dt_s": 0.016666666666666666,
    "env_defaults": {"nParticles": 320, "noise": 0.12, "doorHeight": 64,
                     "jetPower": 0.55, "jetAim": 0.5, "jetInterval": 3.5},
    "thermo": {"sim_to_joule": 1e-21, "T_env_K": 300, "kB_J": 1.38e-23},
    "seed_scheme": "env seed = 1 + seedIdx*101; controller rng = makeRng(seed ^ 0x5f5f)",
}
SEED_NOTE = "mulberry32 (experiment_core.js makeRng); seed = 1 + seedIdx*101"

MANIFESTS = {
    "e1": {
        "label": "E1 · Classical Maxwell Demon",
        "question": "Does an adaptive-threshold classical demon sort an ideal gas, and at what thermodynamic cost?",
        "needs_circuit": False,
        "physics": COMMON_GAS,
        "controllers": {"classical_demon": {"type": "classicalDemon", "params": {"adaptive": True}}},
        "reward": None,
        "seeds": 2, "train_trials": 60, "test_trials": 12, "episode_seconds": 12,
        "expected_conditions": ["classical_demon"],
    },
    "e2": {
        "label": "E2 · Artificial Neural Demon",
        "question": "Can a small learned ANN policy match the engineered demon on the same observations?",
        "needs_circuit": False,
        "physics": COMMON_GAS,
        "controllers": {"ann": {"type": "annController"}, "random": {"type": "randomController"}},
        "reward": None,
        "seeds": 2, "train_trials": 60, "test_trials": 12, "episode_seconds": 12,
        "expected_conditions": ["ann", "random"],
    },
    "e3": {
        "label": "E3 · Drosophila-Inspired Network",
        "question": "Does a PN→KC→MB-output LIF network with dopamine-gated plasticity learn the demon task?",
        "needs_circuit": False,
        "physics": COMMON_GAS,
        "controllers": {"drosophila": {"type": "drosophilaController"}},
        "reward": {"kind": "good/bad crossing feedback via receiveFeedback({good, dir})"},
        "seeds": 2, "train_trials": 60, "test_trials": 12, "episode_seconds": 12,
        "expected_conditions": ["drosophila"],
    },
    "e4": {
        "label": "E4 · Connectome-Constrained (4A/4B/4C)",
        "question": "Does real FAFB wiring beat restricted-pathway and shuffled controls at the demon task?",
        "needs_circuit": True,
        "physics": COMMON_GAS,
        "controllers": {
            "connectome_4A": {"type": "connectomeController", "params": {"shuffle": False, "seed": 1, "opticDrive": 0.25, "plasticity": "full"}},
            "connectome_4B": {"type": "connectomeController", "params": {"shuffle": False, "seed": 1, "opticDrive": 0.25, "plasticity": "restricted"}},
            "connectome_4C": {"type": "connectomeController", "params": {"shuffle": True, "seed": 7, "opticDrive": 0.25, "plasticity": "full"}},
        },
        "reward": {"kind": "good/bad crossing feedback via receiveFeedback({good, dir})"},
        "seeds": 1, "train_trials": 40, "test_trials": 10, "episode_seconds": 12,
        "expected_conditions": ["connectome_4A", "connectome_4B", "connectome_4C"],
        "note": "opticDrive 0.25 = sparsest regime where real vs shuffled wiring diverges (verified by sweep; aggregate 1.0 saturates the motor layer).",
    },
    "e5": {
        "label": "E5 · Full Comparator Study",
        "question": "Head-to-head: classical vs ANN vs drosophila vs connectome vs shuffled connectome, one seeded run with CIs.",
        "needs_circuit": True,
        "physics": COMMON_GAS,
        "controllers": {
            "classical_demon": {"type": "classicalDemon"},
            "ann": {"type": "annController"},
            "drosophila": {"type": "drosophilaController"},
            "connectome": {"type": "connectomeController", "params": {"shuffle": False, "seed": 1, "opticDrive": 0.25, "plasticity": "full"}},
            "shuffled_connectome": {"type": "connectomeController", "params": {"shuffle": True, "seed": 7, "opticDrive": 0.25, "plasticity": "full"}},
        },
        "reward": {"kind": "good/bad crossing feedback via receiveFeedback({good, dir})"},
        "seeds": 1, "train_trials": 40, "test_trials": 10, "episode_seconds": 12,
        "expected_conditions": ["classical_demon", "ann", "drosophila", "connectome", "shuffled_connectome"],
    },
    "e6": {
        "label": "E6 · Jet-Closure Paradox (causal decomposition)",
        "question": "Decompose ΔH causally: demon vs random vs never-gate with the jet running — is ΔH jet-subsidized?",
        "needs_circuit": False,
        "physics": COMMON_GAS,
        "controllers": {"classical_demon": {"type": "classicalDemon"},
                        "random": {"type": "randomController"},
                        "never_gate": {"type": "neverGateController"}},
        "reward": None,
        "seeds": 2, "train_trials": 60, "test_trials": 12, "episode_seconds": 12,
        "expected_conditions": ["classical_demon", "random", "never_gate"],
    },
    "e7": {
        "label": "E7 · Generalization Sweep (density × noise)",
        "question": "Does the learned sorting policy transfer across physics regimes (sparse/clean → dense/noisy)?",
        "needs_circuit": False,
        "physics": dict(COMMON_GAS, per_seed_regimes={
            "seedIdx1": {"nParticles": 120, "noise": 0.0},
            "seedIdx2": {"nParticles": 640, "noise": 0.30},
            "seedIdx3": {"nParticles": 320, "noise": 0.12},
        }),
        "controllers": {"classical_demon": {"type": "classicalDemon"}},
        "reward": None,
        "seeds": 3, "train_trials": 50, "test_trials": 10, "episode_seconds": 12,
        "expected_conditions": ["classical_demon"],
    },
    "e8": {
        "label": "E8 · Information-Limited Demons",
        "question": "What is the behavioral price of less measurement/memory (adaptive vs fixed vs mem4)?",
        "needs_circuit": False,
        "physics": COMMON_GAS,
        "controllers": {"demon_adaptive": {"type": "classicalDemon", "params": {"adaptive": True}},
                        "demon_fixed": {"type": "classicalDemon", "params": {"adaptive": False}},
                        "demon_mem4": {"type": "classicalDemon", "params": {"memSize": 4}}},
        "reward": None,
        "seeds": 2, "train_trials": 60, "test_trials": 12, "episode_seconds": 12,
        "expected_conditions": ["demon_adaptive", "demon_fixed", "demon_mem4"],
    },
    "e9": {
        "label": "E9 · Pressure Demon",
        "question": "Can the FAFB fly brain, as the valve controller, build ΔP and do net positive spring work against the Landauer bill?",
        "needs_circuit": True,
        "apparatus": "pressureDemonCore",
        "physics": {"chamber": {"L": 900, "H": 420, "D": 420, "door_h": 240, "piston_ext": 160},
                    "nParticles": 260, "noise": 0, "dt_s": 0.016666666666666666,
                    "spring_k": 0.002, "drag": 0.35, "piston_mass": 0.02,
                    "thermo": {"sim_to_joule": 1e-21, "T_env_K": 300, "kB_J": 1.38e-23}},
        "controllers": {"demon_neural": {"brain": "connectomeController", "params": {"eligibility": [[0.90, 0.45], [0.985, 0.35], [0.9995, 0.20]], "policyGradient": True, "pgRng": "makeRng(424243 + seedIdx*977)", "motorDrive": 0.6, "opticDrive": 0}},
                        "demon_frozen": {"brain": "connectomeController", "mode": "frozen weights"},
                        "demon_speed": {"type": "classical reference (selective valve)"},
                        "demon_random": {"type": "random valve"},
                        "never_open": {"type": "never-open control"}},
        "reward": {"wWork": 0.5, "wSelect": 0.3, "wWrong": 0.2, "W_NORM": 0.02,
                   "hysteresis": 0.08, "PG_CREDIT_GAMMA": 0.99, "decisionInterval_s": 0.25},
        "seeds": 3, "train_trials": 12, "test_trials": 12, "episode_seconds": 20,
        "expected_conditions": ["demon_neural", "demon_frozen", "demon_speed", "demon_random", "never_open"],
        "note": "Brain variants require the FAFB circuit at run time; ablation drops them (classical-only run stays intact).",
    },
    "e10": {
        "label": "E10 · Smoluchowski Trapdoor",
        "question": "Does a spring trapdoor (passive or brain-gated) sort the gas? (Expected: no — equilibrium wins.)",
        "needs_circuit": True,
        "apparatus": "smoluchowskiCore",
        "physics": {"chamber": {"L": 760, "H": 300, "D": 300, "slot_h": 120},
                    "nParticles": 220, "noise": 0, "dt_s": 0.016666666666666666,
                    "open_threshold": 0.22,
                    "trapdoor_mass": {"light": 0.02, "heavy": 0.12},
                    "thermo": {"sim_to_joule": 1e-21, "T_env_K": 300}},
        "controllers": {"trapdoor_light": {"mode": "physics"},
                        "trapdoor_heavy": {"mode": "physics"},
                        "trapdoor_neural": {"brain": "connectomeController"},
                        "trapdoor_frozen": {"brain": "connectomeController", "mode": "frozen weights"}},
        "reward": {"wWork": 0.5, "wSelect": 0.3, "wWrong": 0.15, "W_NORM": 3,
                   "decisionInterval_s": 0.25, "eventWindow_s": 0.6, "PG_CREDIT_GAMMA": 0.99},
        "seeds": 1, "train_trials": 8, "test_trials": 8, "episode_seconds": 16,
        "expected_conditions": ["trapdoor_light", "trapdoor_heavy", "trapdoor_neural", "trapdoor_frozen"],
    },
    "e11": {
        "label": "E11 · Feynman Ratchet & Pawl",
        "question": "Does the ratchet extract work only while Th > Tc (and nothing at equilibrium), brain-pawl included?",
        "needs_circuit": True,
        "apparatus": "feynmanRatchetCore",
        "physics": {"nParticles": 0, "noise": 0, "dt_s": 0.016666666666666666,
                    "teeth": 24, "pawl_lift_barrier": 0.10, "load_energy_bias_q": 6.95, "gamma": 3.0,
                    "baths": {"gradient": {"Th": 2.0, "Tc": 1.0}, "equilibrium": {"Th": 1.0, "Tc": 1.0}},
                    "load": {"default": 0.055, "heavy": 0.0825},
                    "thermo": {"sim_to_joule": 1e-21, "T_env_K": 300}},
        "controllers": {"ratchet_gradient": {"mode": "physics", "Th": 2.0, "Tc": 1.0, "load": 0.055},
                        "ratchet_equilibrium": {"mode": "physics", "Th": 1.0, "Tc": 1.0, "load": 0.055},
                        "ratchet_heavy_load": {"mode": "physics", "Th": 2.0, "Tc": 1.0, "load": 0.0825},
                        "ratchet_neural": {"brain": "connectomeController", "Th": 1.0, "Tc": 1.0},
                        "ratchet_frozen": {"brain": "connectomeController", "mode": "frozen weights"}},
        "reward": {"wWork": 0.5, "wStep": 0.3, "wWrong": 0.15, "W_NORM": 0.15,
                   "decisionInterval_s": 0.25, "PG_CREDIT_GAMMA": 0.99},
        "seeds": 1, "train_trials": 10, "test_trials": 10, "episode_seconds": 12,
        "expected_conditions": ["ratchet_gradient", "ratchet_equilibrium", "ratchet_heavy_load",
                                 "ratchet_neural", "ratchet_frozen"],
    },
}

for exp_id, m in MANIFESTS.items():
    doc = {
        "id": exp_id,
        "manifest_version": 1,
        "source_of_truth": "experiment_worker.js EXPERIMENTS.%s + documented constants in experiment_core.js" % exp_id,
        "label": m["label"],
        "question": m["question"],
        "needs_circuit": m["needs_circuit"],
        "dataset": ({"connectome": "FlyWire FAFB v783 (proofread scope)",
                     "circuit_file": "fly_brain_circuit.json",
                     "circuit_sha256": CIRCUIT_SHA} if m["needs_circuit"] else None),
        "physics": m["physics"],
        "controllers": m["controllers"],
        "reward_parameters": m["reward"],
        "seed": {"prng": SEED_NOTE, "n_seeds": m["seeds"]},
        "train_test_split": {"train_trials": m["train_trials"], "test_trials": m["test_trials"],
                             "episode_seconds": m["episode_seconds"],
                             "learning_on": "train phase only"},
        "expected_outputs": {
            "conditions": m["expected_conditions"],
            "rows": "one JSONL/row per condition×phase×trial×seed (schema identical to research_data/ rows; see run_smoke.js field assertions)",
            "summary": "per-condition mean±CI block aggregates (early/late/test windows)",
            "provenance": "run provenance echo (seeds, trials, physics, software tag, timestamps)",
        },
    }
    if m.get("note"):
        doc["note"] = m["note"]
    if m.get("apparatus"):
        doc["apparatus_core"] = "experiment_core.js.%s" % m["apparatus"]
    (OUT / f"{exp_id}.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print("wrote experiments/%s.json" % exp_id)

README = """# Experiment manifests (Stage 6)

One machine-readable manifest per experiment registry entry (E1–E11), generated by
`tools/gen_experiment_manifests.py` from the documented constants in
`experiment_worker.js` (registry: seeds / train / test / episode / controllers /
physics) and `experiment_core.js` (chamber geometry, reward coefficients,
thermodynamic constants).

**The executable source of truth is the code.** These files exist so that
reviewers, release tooling and dashboards can read experiment configurations
without parsing JavaScript. If a scientific parameter changes intentionally:

1. change the code,
2. re-run `python tools/gen_experiment_manifests.py`,
3. re-run `node tests/run_smoke.js` (S5–S10 + the golden fixture will flag any
   unintended behavioral drift),
4. commit code + manifests + fixture diff together with an explanation.
"""
(OUT / "README.md").write_text(README, encoding="utf-8")
print("wrote experiments/README.md")
