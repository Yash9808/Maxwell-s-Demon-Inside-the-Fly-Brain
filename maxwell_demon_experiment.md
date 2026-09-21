# A Connectome-Driven Maxwell Demon in a Simulated Fly Brain

## Abstract

We implemented an interactive Maxwell-demon experiment in which a compact,
proofread Drosophila connectome drives a gate separating two chambers of an
idealized gas. The agent receives engineered sensory inputs describing chamber
temperature, particle distribution, jet activity, and particles near the gate.
Its spiking network controls the gate, while an eligibility-trace and dopamine
gating rule modifies selected excitatory synapses online. In the position-aware
3D version, the circuit includes antennal lobe, optic lobe (ME/LO/LOP),
lateral horn/mushroom body, central, and motor layers. A workspace benchmark
reported an increase in the good:bad crossing ratio from 1.55 early in training
to 4.56 late in a 9,000-frame run. This is a computational demonstration of
connectome-constrained control and reinforcement, not a biological emulation
of a living fly or a violation of the second law of thermodynamics.

## 1. Experimental objective

The experiment asks whether a fixed, data-derived neural wiring diagram can
support a useful policy when coupled to simple spiking dynamics and local,
reward-gated plasticity. The task is deliberately small: particles move in a
three-dimensional chamber, a central wall contains a controllable door, and a
heat jet creates a speed asymmetry. The demon attempts to regulate crossings so
that fast/hot and slow/cold particles become separated across the wall.

The intended computational problem is therefore a partially observed control
task:

1. infer particle state from a low-dimensional sensory interface;
2. integrate that information through a recurrent, signed network;
3. open or close the door at the appropriate time;
4. use the physical consequence of crossings as a teaching signal.

## 2. Connectome data and circuit construction

The underlying dataset is FlyWire FAFB materialization v783. The workspace
contains 139,255 proofread neuron root IDs and an aggregated table of
16,847,997 connection rows. Each connection row contains a synapse count and
mean predicted neurotransmitter scores for GABA, acetylcholine, glutamate,
octopamine, serotonin, and dopamine.

For the interactive circuit, neurons are assigned to layers using their
dominant presynaptic output neuropil. The current position-aware FAFB circuit
contains:

- antennal lobe (AL);
- optic lobe (ME/LO/LOP);
- lateral horn and mushroom body (LH/MB);
- central regions (SMP/SIP/SLP);
- motor regions (GNG/SAD).

The extracted circuit contains 106,765 neurons and 563,942 synapse-weighted
edges. Edges are signed using the dominant predicted transmitter in the
connection row (extraction v2.0-p0): cholinergic and glutamatergic evidence
is treated as excitatory (glutamate's uniform-excitatory treatment is a
documented approximation); GABAergic evidence is inhibitory. Dopamine,
serotonin, and octopamine are NOT signed weights: they are extracted as
separate modulatory channels (10,223 contacts) that feed the third-factor
gain on dopamine-gated plasticity.

### Position-derived optic input

The completed synapse-level table contains 130,054,535 rows and presynaptic
and postsynaptic nanometer coordinates. For each optic-lobe neuron, the
presynaptic coordinates are aggregated into a centroid and normalized within
the optic-lobe population. The 3D experiment converts particle positions into
eight coarse visual-field bins: four horizontal bins by two vertical bins.
Optic neurons receive current according to the visual bin associated with
that neuron's position-derived centroid.

This is a spatially informed interface, not a validated visual receptive-field
model. A synapse coordinate identifies where a synapse lies in the EM volume;
it does not, by itself, establish the neuron's photoreceptor tuning, direction
selectivity, or visual semantics.

Since Stage F, the runtimes convert particle positions into an 800-column
hexagonal retinotopic field (the Stage E lattice of `p1_retinotopy.py`,
nearest-node binning, relative-contrast coded so the busiest occupied column
maps to the drive a saturated legacy bin carried), and each optic neuron
receives current from its own source-derived column. The pre-F eight-bin
path remains available bit-for-bit (`opticInput: "legacy8bin"` in
connectomeController; `window.USE_LEGACY_8BIN` in the 3D app).

## 3. Neural dynamics

Each circuit neuron is represented by a lightweight leaky integrate-and-fire
state. At each simulation step:

- sensory and visual currents are injected into the input layers;
- membrane values decay toward baseline;
- neurons crossing threshold emit a spike and enter a short refractory period;
- spikes propagate through signed, synapse-count-scaled edges;
- motor-layer activity is decoded as a gate-opening drive.

The edge weight is initialized from the aggregated synapse count and scaled for
browser execution. This preserves relative structural strength but should not
be interpreted as a calibrated postsynaptic conductance.

The experimental I/O contract is intentionally explicit. Temperature, chamber
occupancy, jet activity, and gate-neighborhood speed are engineered sensory
variables. Motor-layer rate is converted to a scalar door command. These
interfaces are not read directly from a fly's body or experimentally measured
fly sensory neurons.

## 4. Physics and reward

Particles are modeled as colored, approximately hard discs/spheres with elastic
wall and pair interactions. Particle speed determines the displayed hot/cold
color and contributes to chamber temperature. A left-side heat jet periodically
injects kinetic energy. The central wall blocks particles except in the gate
opening.

At a gate crossing, the simulator compares the particle's kinetic energy with
the hot-side mean. A crossing that improves the desired speed separation
produces positive dopamine; a crossing that degrades it produces negative
dopamine. The reward is local in time and is not a thermodynamic measurement of
an entire closed system.

## 5. Online learning rule

The model uses a simplified three-factor plasticity rule:

1. presynaptic and postsynaptic co-activity creates a decaying eligibility trace;
2. a physical gate-crossing consequence supplies dopamine;
3. dopamine scales the subsequent change in eligible excitatory weights.

Weights are bounded around their initial values. The 3D interface also ranks the
180 largest live values of `|W - W₀|` and draws them over the brain panel. Teal
lines indicate strengthening and pink lines indicate weakening. This overlay
shows model state, not a direct measurement of synaptic plasticity in a real
fly.

The “help against the demon” mode reverses the sign of the learning objective,
allowing the simulated fly to learn behavior that frustrates the demon's
sorting goal. This is a deliberate adversarial mode, not an intrinsic goal
encoded in the connectome.

## 6. Learning curve

The repository's browser learning benchmark runs the model for 9,000 frames,
periodically firing the heat jet and sampling gate behavior. The reported
summary is:

| Training phase | Good:bad crossing ratio |
|---|---:|
| Early | 1.55 |
| Late | 4.56 |

The late/early ratio is approximately 2.94, corresponding to an approximately
194% increase relative to the early value. The ratio is a useful compact
indicator that reward-gated selectivity improved in that run: the gate produced
more beneficial than harmful crossings.

This should not be read as a smooth, universal learning law. The benchmark is a
single stochastic browser simulation with exploration noise, a particular jet
schedule, particle count, learning rate, and dopamine scale. A stronger result
would report multiple random seeds, confidence intervals, ablations, and a
held-out physics schedule. Important controls include a random policy, a
frozen-weight connectome, and a policy with the same I/O but no connectome.

## 7. What a real connectome demon can do in this model

A real connectome, used as a structural constraint, can provide:

- a measured population of neurons and edges rather than an arbitrary neural
  network;
- anatomical modularity and long-range pathways that constrain information
  flow;
- transmitter-prediction-based sign structure for coarse excitation and
  inhibition;
- parallel, recurrent state evolution under a spiking approximation;
- a substrate on which one can test whether local plasticity produces useful
  task adaptation;
- hypotheses about which layers and pathways carry the sensory-to-motor
  computation.

The connectome can therefore act as a biologically grounded architecture for a
controlled computational experiment. It can support comparison between
alternative input encodings, learning rules, circuit subgraphs, and ablations.

## 8. What it cannot establish

The experiment does **not** establish that a real fly would perform the task or
that the connectome alone specifies the fly's behavior. In particular, the
current system does not provide:

- membrane parameters, ion-channel dynamics, dendritic computation, synaptic
  delays, short-term plasticity, or neuromodulator release dynamics measured
  for every neuron; in particular there is **no explicit conduction delay** in
  either runtime (experiment path: same-tick propagation; browser mirror:
  1-tick buffered relay — see README, P0 audit A2),
- a validated per-edge sign for glutamatergic synapses: glutamate is treated
  **uniformly excitatory** as an approximation, while real-fly CNS glutamate
  is mixed (P0 audit A13) — the assumption is recorded in the circuit JSON's
  `provenance.assumptions` rather than silently enforced,
- biologically calibrated neuromodulation: dopamine/serotonin/octopamine act
  as third-factor channels that scale the dopamine-gated eligibility update
  with fixed structural gains (0.15), not measured dose-response dynamics;
- experimentally validated synaptic efficacies from the raw synapse counts;
- a complete, causally validated mapping from particle motion to fly visual and
  mechanosensory receptors;
- a complete fly brain-and-body simulation, musculature, or behavioral ecology;
- biological evidence that the chosen dopamine rule, reward timing, or weight
  bounds match Drosophila learning;
- a proof that the model's transmitter labels are definitive cell identities.

The classification and edge signs are based on predicted neurotransmitter
scores. The connection table is proofread but still represents a particular
materialization and a restricted partner scope. The optic coordinates are
anatomically grounded but are used through a coarse engineered visual mapping.

## 9. Maxwell's demon and thermodynamics

The simulated demon is a pedagogical sorting controller. It can create a
visible temperature or speed difference in the two chambers because the model
includes an external heat jet, an actively controlled gate, finite simulation
boundaries, and an information-processing agent whose energetic cost is not
modeled.

Consequently, the result is not a violation of the second law. A physical
Maxwell demon must account for measurement, memory, control work, dissipation,
and the reset or erasure of information. This browser experiment tracks the
sorting effect and a task reward, but not the full entropy budget. The correct
interpretation is: a connectome-constrained controller can learn a policy that
changes a simplified gas distribution under explicitly supplied energy and
information resources.

## 10. Reproducibility

From the project root:

```bash
python extract_circuit.py
python inject_3d_circuit.py
python launch_fly_demon_3d.py

# regenerate the measured series and publication figure
node learning_test.js
python plot_experiment_figures.py
```

The learning benchmark writes `learning_curve.json`; the figure generator then
writes a 300-dpi PNG and a vector PDF containing the learning curve, control
policy, and top synaptic changes. All reported biological quantities should be
interpreted within FAFB v783 and should not be silently mixed with root IDs from
another FlyWire materialization.
