<p align="center">
  <img src="brand_animation/brand_animation_hero.webp" alt="Maxwell's Demon: Inside the Fly Brain" width="560">
</p>

<h1 align="center">Maxwell's Demon: Inside the Fly Brain</h1>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#the-3d-lab">3D Lab</a> &middot;
  <a href="#fly-action-modes--fighting-mode-callout">Fly Behavior</a> &middot;
  <a href="#background-experiments">Experiments</a> &middot;
  <a href="#thermodynamic-budget">Thermodynamics</a> &middot;
  <a href="#research-framework-v2">Benchmark</a> &middot;
  <a href="#datasets-fafb-v783">Data</a> &middot;
  <a href="#provenance--citation">Provenance</a>
</p>

**Maxwell's Demon: Inside the Fly Brain** runs a real electron-microscopy connectome — the FlyWire **FAFB v783** wiring of an adult fruit fly brain, **106,765 neurons / 563,942 synapses** simulated live (from a proofread source of 139,255 neurons / 16.85M edges) — as a **spiking brain inside your browser, on one `python` command: no GPU, no pip installs, no quantization**. The connectome plays Maxwell's demon: it watches a colored ideal gas straddle a door between hot and cold chambers, learns with dopamine-gated plasticity which crossings to admit, and is graded by a full thermodynamic ledger — work in, extractable free energy, Landauer erasure bill — that answers quantitatively *is the fly a Maxwell demon?* **Answer: no — the sorting is jet-subsidized, not information-driven, and the ledger shows exactly why.** Six comparator controllers (classical demon, random, ANN, mushroom-body, connectome, shuffled control) run seeded train&rarr;freeze&rarr;test benchmarks with 95% CIs, and every run exports publication-grade figures from real anatomy.

[![Stars](https://img.shields.io/github/stars/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain?style=flat&logo=github&label=Stars&color=0ea5e9)](https://github.com/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain/stargazers)
[![Forks](https://img.shields.io/github/forks/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain?style=flat&logo=github&label=Forks&color=0ea5e9)](https://github.com/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain/network/members)
[![Issues](https://img.shields.io/github/issues/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain?style=flat&label=Issues&color=0ea5e9)](https://github.com/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain/issues)
[![Last commit](https://img.shields.io/github/last-commit/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain?style=flat&label=last%20commit)](https://github.com/Yash9808/Maxwell-s-Demon-Inside-the-Fly-Brain/commits)

[![Code License](https://img.shields.io/badge/Code%20License-Apache%202.0-brightgreen)](LICENSE)
[![Data](https://img.shields.io/badge/Data-FlyWire%20FAFB%20v783%20%C2%B7%20MCNS-blue)](#provenance--citation)
[![Connectome](https://img.shields.io/badge/connectome-106%2C765%20neurons%20%C2%B7%20563%2C942%20synapses-informational)](#the-3d-lab)
[![format](https://img.shields.io/badge/format-HTML%20%2B%20Web%20Worker-purple)](#quickstart)
[![runtime](https://img.shields.io/badge/runtime-Python%20%E2%89%A5%203.10%20%C2%B7%20no%20GPU-lightgrey)](#quickstart)
[![author](https://img.shields.io/badge/author-Yash9808-blue)](https://github.com/Yash9808)

---

## Quickstart

Use the dependency-free launcher from the project root:

```bash
python launch_fly_demon_3d.py
```

It serves this folder on `127.0.0.1:8765` and opens `fly_demon_3d.html` in your browser. Keep the launcher terminal open while using the lab; press `Ctrl+C` to stop it. Use `--port 8787` if the default port is already busy, or `--no-browser` to serve without opening a window.

What you get on load: the full FAFB connectome simulating in a **Web Worker** (`brain: worker` badge, ~15 brain ticks/s, 44 fps rendering), a live spiking neuron cloud, the demon/gas apparatus, and the LIVE CONNECTOME telemetry panel — all client-side.

## Repository layout

- **Root** — everything needed to run the 3D lab: the app pages, workers, connectome data (`fly_brain_*`, `fly_head_shell_*`), skeletons, circuits, Three.js modules, and the launcher.
- **`Extras/`** — research data (feather/npy tables), analysis scripts, papers, benchmarks, and tooling kept out of the app's runtime path. The dataset documentation below refers to these files by name; they live under `Extras/` in this checkout.

## The 3D lab

`fly_demon_3d.html` — 3D version with switchable FAFB/MCNS brains, position-driven optic-lobe input, demon-scale procedural fly/demon avatars, an anatomical whole-CNS view, and a live overlay of the top strengthened/weakened synapses (&Delta;W).

During learning, the 3D brain panel ranks live |W &minus; W&#8320;| changes and draws the top 180 synapses as an overlay: teal lines are strengthened and pink lines are weakened. The overlay refreshes periodically so the most changed paths remain visible without drawing every edge at full brightness.

### Fly action modes + fighting-mode callout

The "What does the fly do?" section holds the two fly policies — 🪽 **help against the demon** (default) and 😈 **learn the demon's task** — with a boxed explanation beneath the buttons that swaps with the selection:

- **Fight mode** (green box): "The fly is fighting the demon! Plasticity sign is flipped: every 'good' crossing for the demon now weakens the fly's sort-policy — it re-learns to open the door only when it hurts the demon's sorting. Watch &Delta;T get dragged back toward 0."
- **Obey mode** (amber box): "The fly obeys the demon. Plasticity runs with its normal sign: the fly is rewarded for crossings that help the demon's sorting, so it learns the demon's task itself."

Both buttons switch the engine to brain mode automatically; the box text, border color and background change with the mode.

### Role-swap animation (fly's turn)

In fly-brain mode, when the connectome policy commits to a door action, the demon vanishes in a soft smoke poof (expanding grey puffs, a few warm embers), the fly flies to the demon's hover spot and takes the trident; the observation line arcs from the demon's spot. When the door shuts and the fly's turn ends, the fly returns to its perch and the demon re-forms with a reverse smoke pop, the trident flying back to his hand. Gating uses the fly's hysteresic `flyPhase` (not the flickery door target). Random/human modes never trigger the swap.

In fly-brain mode the connectome-driven fly also exhibits turn-taking: when its policy commits to a door action it physically flies to the door and pushes it open — docking at the door's edge, bracing two push-legs, leaning in with a rhythmic shove while it grinds open (buzz at maximum). Approach speed and wing buzz scale with the real motor-drive signal. The fly startles whenever the demon pounces on a crossing (wing buzz up to ~130 Hz, hop + recoil, harder for bad crossings), and whenever the fly learns from a crossing (a dopamine event) a valence-coded dashed observation line arcs fly&rarr;demon: cyan for reward, amber for punishment — the visual statement that information flows demon &rarr; fly &rarr; policy.

### Ghost-glass anatomical brain with live firing heat

The anatomical view is built from the real FAFB v783 anatomy: every one of the 106,765 circuit neurons is drawn at its measured mean post-synaptic synapse position (extracted offline from the 130M-row synapse-level table into `fly_brain_positions.bin` + `fly_brain_meta.json`, ~1 MB total).

Regenerate all three anatomy assets with one command (needs the 8.9 GB synapse table + both per-neuropil count tables):

```bash
python tools/rebuild_anatomy.py
```

The script reconstructs the circuit's index&rarr;root-ID mapping deterministically from the pre-count table (verified against `fly_brain_circuit.json`), computes mean POST-synapse positions per neuron in a canonical frame (FlyWire axes: optic lobes on scene X, dorsal up; median-centered; adaptive robust scale so the 99.5th-percentile brain radius maps to 400 scene units), assigns each neuron its primary input neuropil, and emits per-neuropil voxel-shell hulls (res 14 scene units, &ge;40 neurons per hull). Positions bin: Int16 x/y/z &times;10 + Uint8 primary-neuropil index (255 = unmapped), 7 bytes per neuron.

- **79 per-neuropil glass shells** — one translucent ellipsoid per real neuropil, centered and scaled at its measured centroid/spread (optic lobes, AL, MB, LH, central complexes, GNG…), each with a muted anatomical rest hue. The brain at rest looks like the published neuropil segmentations — it is never red at rest.
- **Firing = jet heat on top of the glass.** Each shell's neurons drive a jet-ramped emissive tint: blue &rarr; cyan &rarr; green &rarr; red as regional firing rate rises; quiet = clear glass. A `FIRING HEAT · JET` legend quantifies it.
- **Stimulus-locked firing.** Particle crossings pulse the sensory neuropils (AL + optic); the connectome's own edges propagate the signal — downstream layers are not force-injected, so what you see is the real topology responding to the task. Synaptic timing is runtime-specific (P0 audit A2): the browser view uses a 1-tick buffered relay, while the experiment path (`benchmark.js` / E-families) is same-tick by default; no explicit conduction delay is modeled in either path (`opts.synapticDelay` in `controllers.js` is the extension point).
- **Experiment-aware highlight.** While a background experiment runs, a pulsing gold ring marks the region that carries the task (optic for E7 sweeps, central/MB for E2–E5 learning, motor for E8 gate policy), and the mini-panel mirrors the same shells/heat.

In Anatomical 3D brain view the neuropils are rendered as reference-style ghost-glass shells (fresnel-shader white rims, like the published FAFB render): two large lateral optic lobes (EM synapse positions), the central brain mass, and a VNC volume when the dataset has one. Each shell carries a live uniform tint = that region's real spike mass (fast attack, ~1.2 s release). When a background experiment runs, the task-carrying region gets a semantic tint on top — optic teal for sensory sweeps (E7), central purple for learning runs (E2–E5), VNC amber for gate-policy experiments (E8).

### Real neuropil hull surfaces + scientific modes (v3)

46 per-neuropil hull surfaces (`fly_brain_hulls.bin`, regenerated by `tools/rebuild_anatomy.py` as voxel-shell meshes of each neuropil's real circuit neuron positions in the same canonical frame as the neuron cloud — provenance in `fly_brain_hulls.json`: `anchored: true` plus the exact frame string) replace ellipsoid shells in the anatomical view. Dark translucent neutral surfaces; never red at rest — firing heat lives on the neuron points (jet ramp), hulls only brighten slightly with their region's real firing mass (region-normalized /140).

Scientific mode chips in the LIVE CONNECTOME panel: **A** anatomy (activity hidden), **B** live (default), **D** regions (click a hull to isolate one neuropil: neuron count, active %, in/out edge mass), **E** inspect (click a neuron: its real incoming/outgoing edges + neuropil), **F** active connectome (only edges carrying recent co-activity, from the simulation's own E-trace), **C** replay (transport: play/step/reset slider over the last ~90 s of spike bitmaps; replay drives the same `sim.spikes` buffer the 3D view reads).

**Data-integrity panel** (always visible): source 139,255 proofread neurons vs 106,765 simulated (76.7%), source 16.85M edge rows vs 563,942 simulated (&ge;10-synapse aggregate, 3.35%), anatomical mapping coverage, unmapped counts, hull provenance. **The connectome is never presented as complete.**

Region &times; time firing heatmap strip (real `sim.spikes`, 7 anatomical regions, jet ramp) below the mode chips. Camera: anatomical view frames the ~880-unit brain from outside (dist 1750); wheel zoom extends to 3200. LC mini-panel: neutral slate base cloud (never red at rest), relative spike heat (running 95th-percentile normalization, disclosed on the legend), hull-ghost rims mirroring the 3D anatomy.

Remaining simplifications (disclosed, not hidden): hulls are synapse-density surfaces, not FlyWire mesh assets; spike bitmaps for replay are recorded every 2 ticks in a 900-frame ring buffer (≈29 s at 60 fps semantics); edge rendering samples ~6k of 563,942 edges — filtering is visual only, the simulation always uses the full edge set.

### LIVE CONNECTOME mini-panel (top-right)

A dark red-bordered HUD panel in the upper-right corner of the 3D view:

- **Neuron cloud** — the same coordinates as the 3D brain (anatomical EM positions or layered layout), drawn as a dim base cloud; neurons that spike each simulation tick glow bright orange with a ~10-frame heat decay — the live spiking of FAFB v783 / MCNS, not decoration.
- **Ghost-glass anatomy mirror** — in anatomical view the panel renders the same fresnel shell silhouettes as the 3D brain, each shell tinted by its live regional firing heat.
- **Jet colorbars** — a gradient bar (0 quiet &rarr; 1 fired now) under the canvas; the anatomical view adds a fixed `FIRING HEAT · JET` legend for the regional shell tints.
- **Header counters** — real neuron count and cumulative spike total since load; the REC dot pulses faster whenever an experiment/controller is active.
- **DESCENDING OUTPUT** — motor-layer spikes split left/right by anatomical side (peak-hold normalized), plus a dopamine (DA) bar driven by `sim.DA.v`.
- **Experiment badge** — the active foreground controller (COMPARE / ANN / FLY-KC) plus any background experiment card run (E1–E8); the border flashes red when it changes.
- Collapsible (– / +), repositions below the top bar when the HUD wraps, and shrinks responsively on narrow viewports.

Key calibrated findings baked into the defaults: at full sensory drive the motor layer saturates and real vs shuffled wiring behave identically, so the connectome controllers run at `opticDrive 0.25`, the sparsest regime where topology measurably shapes the door policy; the classical demon uses the canonical two-direction gate (slow-out-of-hot OR fast-back-into-hot), giving it healthy crossing statistics; MI instrumentation binarizes trial-cumulative spike counts sampled across all layers. **All reported quantities are computational measures of the simulated chamber, not biological measurements.**

## Background experiments

The 3D lab's left panel has an **Experiment list** section: eight cards (E1 classical demon, E2 ANN, E3 Drosophila-inspired, E4 connectome 4A/4B/4C, E5 full comparator study, E6 jet-closure paradox, E7 generalization sweep, E8 information-limited demons).

The three additions probe physics and information questions beyond the comparator study. **E6** decomposes sorting causally: with the door welded shut the jet still accumulates &Delta;H (subsidy without policy), while the demon's information shows in good:bad selectivity rather than raw &Delta;H — verified directly (a rule-inverted saboteur reduces &Delta;H 0.047&rarr;0.016 at 600 s but cannot flip the gradient; the jet dominates it). **E7** runs the demon across three physics regimes per seed (120/0, 320/0.12, 640/0.30 particles/noise) via a per-seed physics hook in `runBenchmark`. **E8** compares adaptive, fixed-threshold, and 4-decision-memory demons — the behavioral price of less measurement and memory.

Clicking ▶ runs the seeded benchmark in a background Web Worker (`experiment_worker.js`) with the PDF's phase structure (baseline &rarr; train &rarr; test), streaming live learning curves into a sparkline on each card and into a pop-out plots window (`experiment_plots.html`, opened via 📈 or automatically on start). The 3D lab keeps animating at full framerate. Per-trial rows use the same schema as `research_data/` JSONL.

The plots window offers CSV/JSON downloads of the finished run plus a seaborn-style picker (6 styles &times; 6 palettes &times; 4 plot kinds — darkgrid/whitegrid/dark/white/ticks/poster, deep/muted/bright/pastel/colorblind/tab10, line/step/area/point) that restyles all live panels and the PNG downloads, and a combined multi-panel export (⬇ combined figure) that composites all six panels — lettered A–F with a suptitle, provenance line, style stamp, a shared condition&rarr;color legend row, and a simulation-scope footnote — onto one print-resolution PNG. Individual panel PNGs also carry a legend strip, so every exported image is self-describing. **E4** runs the plasticity variants 4A (full), 4B (restricted to the sensory pathway), and 4C (shuffled control) on the currently selected FAFB/MCNS circuit.

The plots window adds three scientist-facing cards: an **expected-behaviour script** per experiment (what the demon/gate should do and what the fly should do, experiment by experiment), a **predictions-vs-observations checklist** auto-evaluated from the run's condition summaries (learning gain, sorting selectivity, &Delta;H, &Delta;T, gate economy, MI, thermodynamic regime — each marked ✓ observed / ✗ not observed / ≈ within noise, with a single-seed power warning), and a **crossing ledger** with per-condition action counts and an auto-generated behavioural reading. Hover any experiment card in the lab for a one-line "WATCH FOR" tooltip. While trials stream, each lab card also shows live verdict chips — a compact four-signal reading (learning trend ▲/▼, sort selectivity, &Delta;T, gate economy) computed from the block curve.

In the 3D lab these behaviours are animated: the chamber's center wall uses a double-guillotine door whose two panels slide apart exactly over the physics aperture (closed = solid green door, open = panels retracted), so the visual state always matches the simulated gate. The demon shows an intent pose when the door is about to open (lean toward the doorway, focused ice-blue gaze, trident pointing at it), its tail opens into a strike curl as intent rises and lashes on each crossing, and it reacts to each crossing by pointing its trident along the crossing particle's travel direction (firmer for faster particles).

### Brain-outcome snapshots (plots window)

**Headline view — real-anatomy firing maps:** the "Brain outcome — which neurons fired (real anatomy)" card renders every circuit neuron at its measured FAFB synapse position, jet-colored by its mean firing in the run (glow intensity ∝ spikes; blue quiet &rarr; red hottest; the grey point cloud is the brain contour). One map per condition, test phase preferred; ⬇ anatomy firing map (PNG) downloads the current map(s). The animated six-brain session figure uses these anatomy maps as panels.

All firing-activity views use a **jet thermal ramp** (deep blue &rarr; cyan &rarr; green &rarr; yellow &rarr; red) — the 3D neuropil shells, the LIVE CONNECTOME hot dots and shell tints, and every brain-outcome heatmap.

The plots window collects one mini heatmap per finished experiment in the "Brain outcome by experiment — snapshots" card: mean spikes/step per brain region across trial blocks in jet colors, one border-tinted snapshot per experiment id. Click any snapshot to download its PNG, or "⬇ all snapshots · contact sheet (PNG)" for the **"Six fly brains"** figure — numbered (a)–(f) jet subplots, one per experiment, 3 per row with a suptitle, 2&times; scale for print. Experiments without a fly brain (E1, E6) leave no snapshot by design.

**Animated session figure:** the lab page's "▶▶ run all six · animate figure" button queues E2&rarr;E3&rarr;E4&rarr;E5&rarr;E7&rarr;E8 in one serial session and announces it to the plots window, where a live animation canvas fills one numbered jet panel per finished experiment — dashed placeholders for pending slots (with live trial progress for the running one), a green progress bar, a pulsing LIVE chip, and a scan-sweep highlight on the panel that just landed. Failed experiments render as red ✕ panels. When the session ends "⬇ download session figure (PNG)" saves `six_fly_brains_session_figure.png`.

**Per-lab play buttons:** every lab header (🧪 DEMON LAB, 🧠 INFORMATION LAB, 🪰 FLY BRAIN) has its own green ▶ button that queues all of that department's experiments in run order and animates the same live session figure, scoped to the lab (e.g. DEMON LAB runs E1&rarr;E6&rarr;E7&rarr;E9&rarr;E10&rarr;E11). A lab session never mixes with "run all six": while one animates, further clicks queue silently behind it. Apparatus experiments without a fly brain (E10/E11) fall back to a compact agreement + &Delta;T block-curve panel so every slot fills. The ⚛ QUANTUM LAB / 🔬 REAL DEMONS headers also carry the button and answer with a "coming soon" toast until experiments land there.

A second card, **"Brain outcome — learning deltas (late − early)"**, shows what learning changed: per region (and per condition for multi-arm experiments), the difference between the second and first half of training trials, drawn with a diverging blue-white-red scale — blue = fires less after learning, red = fires more. Click any delta snapshot to download it, or "⬇ all deltas · six brains figure (PNG)" for `six_fly_brains_deltas_figure.png`. This works directly from the per-trial `layerRates` already recorded in every experiment row, so no re-runs are needed.

## Research framework (v2)

The PDF research plan is implemented as an additive, fully seeded framework around the existing apps:

- **`experiment_core.js`** — seeded PRNG, chamber physics, entropy / mutual information / Landauer metrics, and the train&rarr;freeze&rarr;test trial engine with a **Demon Similarity Index** (agreement with the canonical gate policy).
- **`controllers.js`** — six comparator controllers sharing one environment: classical Maxwell demon (two-direction gate policy), random, generic ANN, Drosophila-inspired mushroom-body network, the FAFB connectome, and a degree-preserving shuffled-connectome control.
- **`benchmark.js`** — CLI writing per-trial JSONL + summary JSON with 95% CIs:

```bash
node benchmark.js --quick   # 2 seeds x 40/10, 8 s episodes (smoke, ~3 min)
node benchmark.js           # study default: 5 seeds x 300/60, 12 s (~1 h)
node benchmark.js --full    # PDF spec: 10 seeds x 1000/200, 60 s (days)
```

- **`analysis/plot_research_figures.py`** — the 8-figure publication pack plus `results_table.txt` and `thermo_budget.txt` from any `research_data/` run.

## Thermodynamic budget

Every benchmark trial carries a full energy/information ledger (and the 3D experiment panel shows the same quantities live):

- **work_in** — signed net kinetic energy the heat jet injects (1 sim unit = 1e-21 J, the app-wide conversion).
- **extractable** — maximum reversible work obtainable by coupling the two chamber halves as finite reservoirs at kinetic temperatures: `W_max = U_hot · (1 − T_c/T_h)`.
- **efficiency** — extractable / work_in; the sorted state's free energy comes from the jet, so the second law is bounded by this ratio (≈1e-5 here).
- **Landauer bill** — `k_B·T_env·ln2 · measuredBits` at T_env = 300 K, where `measuredBits` meters door-decision flips plus per-crossing good/bad evaluations (the demon's memory traffic).
- **bits_used vs bits_needed** — the honest punchline: extracting the observed ~1.5e-16 J would require ~50,000–60,000 Landauer bits per trial, but the controllers write only ~10–75. **The demon's sorting is therefore jet-subsidized, not information-driven** — its erasure bill is negligible precisely because it barely memorizes. This is the quantitative answer to "is the fly a Maxwell demon?": not in this implementation, and the ledger shows exactly why.

`node benchmark.js` prints the budget table after the headline results.

## Performance engineering (patches 16–20)

**No-hang guarantee while experiments run (patches 16–18):** the 3D fly used to stutter badly (8–12 fps, 100–650 ms hitches) whenever a lab session ran. Fixes, all measured on the live page: apparatus `app_state` replay streams are time-gated in the worker (~30 Hz instead of ~460 structured clones/sec); experiment progress DOM/canvas work and the plots broadcast are paced on a 300 ms timer and skip redraws when the curve did not change; the 2 s e9 training-sweep poll only rebroadcasts when the sweep file actually changed; the apparatus replay pump runs on a timer instead of rAF; the 106k-neuron brain tick runs at 30 Hz, and the default world's simulation pauses while an apparatus stage owns the screen. Result during a full DEMON LAB session: mean frame ~11–15 ms (~60 fps badge), hitches >40 ms down from ~10/s to <0.3/s, worst hitch 652 ms &rarr; 87 ms, plots broadcast volume down ~8&times;.

**Patch 19 — the whole brain sim moved off the main thread (`brain_worker.js`):** the 106,765-neuron connectome tick (563k synaptic edges + dopamine-gated plasticity) no longer runs inside the render loop. The page ships a cheap ~30 Hz sensor packet to the worker and receives the spike bitmap + plastic weights back as zero-copy transferable buffers (ping-pong pool, never re-allocated), so every existing consumer — 3D point cloud, heat maps, trial replay, HUD, region stats, learning panel — reads the same `sim.spikes` / `sim.W` unchanged. Measured: idle mean frame 46 ms &rarr; ~8 ms with zero hitches >40 ms (worst 23 ms), ~10 ms mean during a running experiment. If the worker can't start (e.g. `file://`), the page transparently falls back to the legacy in-frame tick.

**Patch 20 — perf HUD, adaptive quality, watchdog:** a perf badge in the header shows avg frame interval · worst hitch this second · brain-worker ticks/s · JS heap, driven by its own rAF sampler. The same sampler drives an adaptive-quality controller (pixel ratio 1.0 &rarr; 0.85 &rarr; 0.7 with hysteresis and a toast), and a watchdog restarts the brain worker if it goes silent >5 s, then falls back to main-thread sim if still dead. Patch 20c fixed the real bug the badge exposed: worker buffers were returned as TypedArray views (not transferable), so `postMessage` threw silently and the publish pool starved — brain ticks had dropped to ~0.7/s while still looking smooth. With view&rarr;buffer returns fixed, the worker publishes at ~15 ticks/s.

**10-minute soak (all 3 labs back-to-back, 11 experiments):** every session green, worker ticks steady ~15/s the whole way, long tasks only around experiment boundaries (15/296 samples, 2.6 s total), worst frame gap 250 ms, heap sawtoothing 1026–1323 MB with no upward drift after four sessions.

## Datasets (FAFB v783)

Data files for the FlyWire Full Adult Fly Brain (FAFB) connectome, materialization version 783 (proofread-scope). **All root IDs refer to v783 and are stable only within that materialization.**

### Files

| File | Rows | Size | Contents |
|---|---|---|---|
| `proofread_root_ids_783.npy` | 139,255 | 1.1 MB | uint64 root IDs of all proofread neurons in v783 |
| `proofread_connections_783.feather` | 16,847,997 | 813 MB | Aggregated connectome edges between proofread neurons |
| `per_neuron_neuropil_count_pre_783.feather` | 2,781,037 | 17 MB | Per-neuron, per-neuropil output (presynaptic) synapse counts |
| `per_neuron_neuropil_count_post_783.feather` | 43,439,994 | 224 MB | Per-neuron, per-neuropil input (postsynaptic) synapse counts |
| `synapses_connections_783.feather` | 130,054,535 | 8.9 GB | Synapse-level connection table; verified readable through `fafb783.load_synapses()` |

### Schemas

**`proofread_connections_783.feather`** (edges, aggregated per pair × neuropil):
`pre_pt_root_id: int64` — presynaptic neuron · `post_pt_root_id: int64` — postsynaptic neuron · `neuropil: string` — FlyWire neuropil name (e.g. `MB_CA_L`, `ME_L`, `CRE_R`) · `syn_count: int64` — synapses in this pair/neuropil · `gaba_avg, ach_avg, glut_avg, oct_avg, ser_avg, da_avg: double` — mean per-synapse neurotransmitter prediction scores (0–1) for the pair/neuropil

**`per_neuron_neuropil_count_{pre,post}_783.feather`:**
`pre_pt_root_id` / `post_pt_root_id: int64` — neuron ID · `neuropil: string` — neuropil · `count: int64` — number of output (pre) / input (post) synapses in that neuropil

**Synapse-level table** (`synapses_connections_783.feather`):
`id: int64` — synapse ID · `pre_pt_root_id, post_pt_root_id: int64` · `connection_score: double, cleft_score: int64` — detection confidence · `gaba, ach, glut, oct, ser, da: double` — per-synapse NT scores · `neuropil: string` · `pre_pt_position_{x,y,z}, post_pt_position_{x,y,z}: int64` — nanometer coordinates

**`proofread_root_ids_783.npy`:** 1-D uint64 array of 139,255 root IDs.

### Provenance / naming

The `*.feather` / `*.npy` files follow the naming used by FlyWire community downloads (codex.flywire.ai / graphene materialization exports). The completed 9.5 GB synapse-level file is stored as `synapses_connections_783.feather` and opens as 130,054,535 rows through the loader.

## Scripts & tooling

| Script | Outputs | What it does |
|---|---|---|
| `analyze_v783.py` | `report_v783.md` | Dataset summary: NT composition, top neuropils, degree stats, cross-checks |
| `classify_neurons.py` | `neuron_nt_classification.csv`, `neuron_nt_summary_by_neuropil.csv`, `neuron_nt_report.md` | Classifies all 139,255 proofread neurons from synapse-count-weighted outgoing NT scores and summarizes classes by dominant output neuropil |
| `neuropil_matrix.py` | `neuropil_matrix.csv`, `neuropil_matrix.png`, `neuropil_matrix_top30.png`, `neuropil_matrix_report.md` | 79×79 (plus special rows) neuropil×neuropil synapse matrix: CSV, log-scale heatmap, annotated top-30 heatmap, ipsi/contra + mirror-asymmetry findings |
| `fafb783.py` | — | Loader module used by the scripts above |
| `extract_circuit.py` | `fly_brain_circuit.json` | Extracts a 5-layer visual subnetwork (AL &rarr; ME/LO/LOP &rarr; LH/MB &rarr; SMP/SIP/SLP &rarr; GNG/SAD) with real synapse-count weights, P0 NT semantics (schema 2: per-edge nt/sign/modulatory/modulatorType, deterministic syn-weighted majority aggregation, FlyWire root-ID provenance block), and optic-lobe visual channels derived from synapse positions. DA/ser/oct are exported as `modulatory_edges` (third-factor channels), never signed fast weights |
| `inject_circuit.py` | `fly_demon_lab.html` | Embeds the circuit JSON into the 2D app template |
| `inject_3d_circuit.py` | `fly_demon_3d.html` | Embeds the regenerated position-aware FAFB circuit into the 3D lab |
| `fly_demon_lab.html` | — | Maxwell Demon Lab: real-time browser app — the extracted fly brain (LIF spiking, dopamine-gated plasticity) drives a demon door that sorts a colored ideal gas; heat jet on the left, physics playground on the right. The stochastic `learning_test.js` benchmark records good:bad crossings over 9k frames and feeds the publication figure generator |
| `fly_demon_3d.html` | — | 3D version with switchable FAFB/MCNS brains, position-driven optic-lobe input, demon-scale procedural fly/demon avatars, an anatomical whole-CNS view, and a live overlay of the top strengthened/weakened synapses (ΔW) |
| `maxwell_demon_experiment.md` | — | Science-style description of the method, learning curve, connectome capabilities, and thermodynamic limitations |
| `plot_experiment_figures.py` | `maxwell_demon_figure.png`, `maxwell_demon_figure.pdf` | Publication-style three-panel figure for learning, control policy, and top synaptic plasticity |

`extract_circuit.py` uses the synapse-level table only for optic-lobe position centroids. It normalizes each ME/LO/LOP neuron's presynaptic (x, y, z) centroid into a position-derived visual channel, which the 3D lab matches against eight particle-field bins. Use `python extract_circuit.py --no-positions` for a connectivity-only fallback when the large synapse table is unavailable. After re-extracting, run `python inject_3d_circuit.py` to refresh the embedded FAFB circuit in the 3D page.

## Usage

```python
import fafb783

conns = fafb783.load_connections()      # 16.8M edges, memory-mapped
nt     = fafb783.load_synapses()        # 130M synapses, memory-mapped
pre    = fafb783.load_pre_counts()      # per-neuron output counts
post   = fafb783.load_post_counts()     # per-neuron input counts
ids    = fafb783.load_root_ids()        # 139,255 proofread neurons

fb.summary()                            # quick dataset health check
```

To classify every proofread neuron by its outgoing neurotransmitter predictions:

```bash
python classify_neurons.py
```

The default class requires a weighted dominant score of at least 0.50 and a 0.05 lead over the second transmitter. Adjust those thresholds with `--threshold` and `--min-margin`. The outputs include all proofread root IDs, including `mixed_uncertain` and `no_outgoing` rows; the neuropil summary uses the dominant output neuropil from the per-neuron presynaptic count table.

Everything is `pyarrow.feather.read_table(memory_map=True)`, so loading is lazy and uses file-backed memory; large aggregations should use Arrow/DuckDB-style operations or `pyarrow.compute` rather than materializing whole columns in pandas.

## Notes & caveats

- **v783-specific IDs.** Root IDs from any other materialization version will not match without ID mapping.
- **Proofread scope.** The connections table contains only pairs where both partners are proofread. Synapse-level counts from the big table will exceed edge sums when partners are unproofread.
- **NT scores are predictions** (Buhmann et al. synapse-type model), not experimental measurements; treat `*_avg > 0.5` as a soft call.
- **Environment.** All analysis scripts target Python ≥3.10 + pandas 3 / pyarrow 24.
- All reported quantities are computational measures of the simulated chamber, not biological measurements. The connectome is never presented as complete (see the in-app data-integrity panel).

## Provenance & citation

This project builds on the FlyWire community resources. If you use the data or the app, please cite:

- **FAFB connectome** — Dorkenwald et al., *Neuronal wiring diagram of an adult brain*, Nature 644:1312–1322 (2024), [10.1038/s41586-024-07558-y](https://doi.org/10.1038/s41586-024-07558-y) · [flywire.ai/?dataset=fafb](https://flywire.ai/?dataset=fafb)
- **MCNS connectome** — Berg et al., *Sexual dimorphism in the complete connectome of the Drosophila male CNS* (PMC12636603; Cell 2026) · [flywire.ai/?dataset=mcns](https://flywire.ai/?dataset=mcns)
- **Cell-type annotations** — Schlegel et al., *Whole-brain annotation and multi-connectome cell typing of Drosophila*, Nature 634:139–152 (2024), [10.1038/s41586-024-07686-5](https://doi.org/10.1038/s41586-024-07686-5)
- **Neurotransmitter predictions** — Buhmann et al., synapse-type prediction model (two-stage automated NT classification)
- **Skeletons** — FlyWire skeletons, [Zenodo 10877326](https://zenodo.org/records/10877326) / Schlegel et al. 2024, curated top-degree subset
- **`nmf_fly.glb` (NeuroMechFly 2.0 morphology)** — Wang-Chen, A. et al., *NeuroMechFly 2.0, a framework for simulating embodied sensorimotor control in adult Drosophila*, Nature (2025), [10.1038/s41586-025-09029-4](https://doi.org/10.1038/s41586-025-09029-4)

Full provenance (hashes, frames, import reports) is recorded in [`MANIFEST.json`](MANIFEST.json) and [`CREDITS`](CREDITS).

## License

Code is released under the **Apache License 2.0** — see [`LICENSE`](LICENSE). Connectome data and third-party assets remain under their upstream terms (see [Provenance & citation](#provenance--citation)).
