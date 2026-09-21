/**
 * p1_dynamics.js — Stage C: per-type dynamics framework (parameter classes).
 *
 * MANDATE: the global {decay 0.86, threshold 30, refractory 3, weight scale
 * 0.02} of the legacy model must not remain the only possible model. This
 * module resolves PER-NEURON parameters from neuron TYPE (Stage B metadata:
 * layer x neurotransmitter class), from documented PARAMETER CLASSES — never
 * random values, never fabricated flyvis numbers.
 *
 * Every parameter carries a provenance tag from the P1 standard:
 *   SOURCE-DERIVED  computed from workspace v783 data (here: only the
 *                   membership facts that SELECT a class are source-derived)
 *   MODEL-ASSUMED   fixed value of a documented parameter class (biologically
 *                   ORDERED, not measured — see class table)
 *   EMPIRICAL       measured in a published experiment (none used here)
 *   TUNED           adjusted to make a benchmark behave (none used here; the
 *                   legacy TUNED gains are kept ONLY in the legacy-compat map)
 *   UNKNOWN         no basis; runtime behavior must degrade gracefully
 *
 * Class ordering rationale (MODEL-ASSUMED, relative not absolute):
 *   photoreceptor-pathway / optic neurons: short membrane time constants
 *     (phasic transmission), low threshold, short refractory.
 *   central neurons: medium tau, standard threshold.
 *   motor output: longer integration, higher threshold (stability).
 *   modulatory (da/ser/oct): very sparse firing via high threshold + long
 *     refractory; they carry reward state, not fast signalling.
 *   inhibitory-variant (ntSign<0): parameters of their neuropil class; their
 *     polarity lives on EDGES (sign), not on the membrane rule.
 *
 * Where SOURCE-DERIVED refinement would attach (documented, not implemented —
 * no data in workspace): flyvis per-cell-type membrane parameter tables
 * (tauMem/theta per T4/T5/Mi class), marked UNKNOWN here.
 */
"use strict";

const PROV = { SOURCE_DERIVED: 0, MODEL_ASSUMED: 1, EMPIRICAL: 2, TUNED: 3, UNKNOWN: 4 };
const PROV_NAME = ["SOURCE-DERIVED", "MODEL-ASSUMED", "EMPIRICAL", "TUNED", "UNKNOWN"];

/**
 * Parameter classes. Tick unit = one simulation tick (dt semantics inherited
 * from the caller; 1 tick ~ 1 frame ~ 16.7 ms in the legacy app).
 *
 * Legend per class: Vrest [model units], tauMem [dimensionless per-tick leak
 * factor], theta [spike threshold, model units], tRef [ticks], noiseSigma
 * [per-event kick scale], gain [input-drive gain multipliers: optic, al,
 * stim, motor, noiseRate(events/neuron/tick)].
 */
const PARAM_CLASSES = {
  // Legacy values preserved verbatim for the legacy-compat configuration
  // (provenance TUNED: README documents opticDrive 0.25 calibration).
  legacy_global: {
    desc: "the shipped one-size-fits-all rule (decay .86, thr 30, ref 3)",
    Vrest: 0, tauMem: 0.86, theta: 30, tRef: 3, noiseSigma: 0,
    gain: { optic: 14, al: 12, stim: 16, motor: 8, noiseRate: 0 },
    prov: { Vrest: PROV.TUNED, tauMem: PROV.TUNED, theta: PROV.TUNED,
            tRef: PROV.TUNED, gain: PROV.TUNED },
  },
  optic_phasic: {
    desc: "visual-pathway class: fast, phasic, low threshold",
    Vrest: 0, tauMem: 0.80, theta: 24, tRef: 2, noiseSigma: 0.6,
    gain: { optic: 16, al: 0, stim: 18, motor: 0, noiseRate: 0.010 },
    prov: { Vrest: PROV.MODEL_ASSUMED, tauMem: PROV.MODEL_ASSUMED,
            theta: PROV.MODEL_ASSUMED, tRef: PROV.MODEL_ASSUMED, gain: PROV.MODEL_ASSUMED },
  },
  central_standard: {
    desc: "central-brain class: medium integration",
    Vrest: 0, tauMem: 0.86, theta: 30, tRef: 3, noiseSigma: 0.5,
    gain: { optic: 0, al: 12, stim: 14, motor: 0, noiseRate: 0.006 },
    prov: { Vrest: PROV.MODEL_ASSUMED, tauMem: PROV.MODEL_ASSUMED,
            theta: PROV.MODEL_ASSUMED, tRef: PROV.MODEL_ASSUMED, gain: PROV.MODEL_ASSUMED },
  },
  motor_integrating: {
    desc: "motor-output class: longer integration, higher threshold",
    Vrest: 0, tauMem: 0.90, theta: 34, tRef: 4, noiseSigma: 0.4,
    gain: { optic: 0, al: 0, stim: 0, motor: 8, noiseRate: 0.004 },
    prov: { Vrest: PROV.MODEL_ASSUMED, tauMem: PROV.MODEL_ASSUMED,
            theta: PROV.MODEL_ASSUMED, tRef: PROV.MODEL_ASSUMED, gain: PROV.MODEL_ASSUMED },
  },
  modulatory_slow: {
    desc: "da/ser/oct class: sparse, long refractory (reward state carriers)",
    Vrest: 0, tauMem: 0.92, theta: 40, tRef: 8, noiseSigma: 0.3,
    gain: { optic: 0, al: 0, stim: 8, motor: 0, noiseRate: 0.002 },
    prov: { Vrest: PROV.MODEL_ASSUMED, tauMem: PROV.MODEL_ASSUMED,
            theta: PROV.MODEL_ASSUMED, tRef: PROV.MODEL_ASSUMED, gain: PROV.MODEL_ASSUMED },
  },
};

/** Stage C STDP defaults (pairwise, all-or-none traces, dopamine-gated).
 *  All MODEL-ASSUMED: the mandate requires causal STDP to EXIST with
 *  documented parameters; no measured LTP/LTD magnitudes are claimed. */
const STDP_DEFAULTS = {
  tauPre: 20,      // ticks (pairwise trace decay)
  tauPost: 20,     // ticks
  Aplus: 0.10,     // LTP magnitude on post-after-pre
  Aminus: 0.12,    // LTD magnitude on pre-after-post (slight stability bias)
  prov: { tauPre: PROV.MODEL_ASSUMED, tauPost: PROV.MODEL_ASSUMED,
          Aplus: PROV.MODEL_ASSUMED, Aminus: PROV.MODEL_ASSUMED },
};

/**
 * Resolve type key per circuit neuron from Stage B metadata.
 * key = "<classId>" | classId + "|inh" (polarity kept explicit for tests).
 */
function typeKeyOf(rec, layerOf) {
  const layer = layerOf !== undefined ? layerOf : rec.layer;
  const nt = rec ? rec.nt_class : "UNKNOWN";
  const sign = ntSignPrior(nt);
  if (sign === -1 && (nt === "dopaminergic" || nt === "serotonergic" || nt === "octopaminergic"))
    return "modulatory_slow";
  if (layer === 1) return "optic_phasic";       // optic lobe (ME/LO/LOP)
  if (layer === 4) return "motor_integrating";  // GNG/SAD
  return "central_standard";                    // AL, LH/MB, SMP/SIP/SLP
}

function ntSignPrior(ntClass) {
  switch (ntClass) {
    case "cholinergic": case "glutamatergic": return 1;
    case "GABAergic": case "serotonergic": case "dopaminergic": return -1;
    default: return 0; // mixed_uncertain, no_outgoing, UNKNOWN
  }
}

/**
 * Build per-neuron dynamics arrays for the whole circuit.
 *
 * @param circuit legacy circuit { layers, ... }
 * @param neuronTable Stage B table (p1_celltypes.buildNeuronTable) or null
 *        (falls back to class by layer only, nt UNKNOWN)
 * @param opts { profile: "typed" | "legacy" }
 * @returns per-neuron Float32/Uint8 arrays + per-neuron provenance tags +
 *          a manifest for the report.
 */
function resolveDynamics(circuit, neuronTable, opts) {
  const profile = (opts && opts.profile) || "typed";
  const N = circuit.layers.reduce((a, l) => a + l.length, 0);
  const Vrest = new Float32Array(N), tauMem = new Float32Array(N);
  const theta = new Float32Array(N), tRef = new Uint8Array(N);
  const noiseSigma = new Float32Array(N);
  const gainOptic = new Float32Array(N), gainAL = new Float32Array(N);
  const gainStim = new Float32Array(N), gainMotor = new Float32Array(N);
  const noiseRate = new Float32Array(N);
  const typeKey = new Array(N);
  const provPerNeuron = new Uint8Array(N);   // coarse: worst-case tag of its class params
  const counts = {};
  let overridesApplied = 0;

  let p = 0;
  for (let li = 0; li < circuit.layers.length; li++) {
    for (let k = 0; k < circuit.layers[li].length; k++, p++) {
      const i = circuit.layers[li][k];
      const rec = neuronTable ? neuronTable.records[i] : null;
      // imported cell-type override (e.g. future flyvis parameter tables):
      // requires explicit provenance != MODEL-ASSUMED to have been registered
      const ov = rec ? OVERRIDES.get(rec.cell_type) : undefined;
      const baseKey = profile === "legacy" ? "legacy_global" : typeKeyOf(rec, li);
      const key = ov ? rec.cell_type : baseKey;
      typeKey[i] = key;
      const C = ov ? mergeClass(PARAM_CLASSES[baseKey], ov) : PARAM_CLASSES[key];
      if (!C) throw new Error("unknown parameter class: " + key);
      Vrest[i] = C.Vrest; tauMem[i] = C.tauMem; theta[i] = C.theta;
      tRef[i] = C.tRef; noiseSigma[i] = C.noiseSigma;
      gainOptic[i] = C.gain.optic; gainAL[i] = C.gain.al;
      gainStim[i] = C.gain.stim; gainMotor[i] = C.gain.motor;
      noiseRate[i] = C.gain.noiseRate;
      // per-neuron provenance: imported overrides carry their own tag; classes
      // contribute their worst (highest index = least certain) tag
      const ovTag = ov ? ov.provenance : -1;
      provPerNeuron[i] = Math.max(ovTag, C.prov.Vrest, C.prov.tauMem, C.prov.theta, C.prov.tRef);
      if (ov) overridesApplied++;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return {
    N, Vrest, tauMem, theta, tRef, noiseSigma,
    gain: { optic: gainOptic, al: gainAL, stim: gainStim, motor: gainMotor, noiseRate },
    typeKey, counts, provPerNeuron, overridesApplied,
    manifest: {
      profile,
      classes: PARAM_CLASSES,
      stdp: STDP_DEFAULTS,
      class_counts: counts,
      note: "All non-legacy parameters are MODEL-ASSUMED parameter classes; " +
            "no EMPIRICAL or flyvis-derived values exist in this workspace " +
            "(verified by audit A5). UNKNOWN refinements attach via " +
            "p1_dynamics.setClassOverride() when real tables are imported.",
    },
  };
}

/** Merge an imported override onto a base class (partial params allowed). */
function mergeClass(base, ov) {
  const p = Object.assign({}, base, ov.params);
  p.gain = Object.assign({}, base.gain, (ov.params && ov.params.gain) || {});
  p.prov = Object.assign({}, base.prov, (ov.params && ov.params.prov) || {});
  return p;
}

/**
 * Explicit override hook for imported, source-derived parameter tables
 * (e.g. a future flyvis export of per-cell-type tau/theta). Keys are cell
 * types from p1_celltypes.import; values partial class dicts. Overriding
 * requires provenance != MODEL-ASSUMED, else it throws (no silent tuning).
 */
const OVERRIDES = new Map();
function setClassOverride(typeKeyOrCellType, params, provenance) {
  if (provenance === undefined || provenance === PROV.MODEL_ASSUMED)
    throw new Error("setClassOverride requires an explicit provenance != MODEL-ASSUMED");
  OVERRIDES.set(typeKeyOrCellType, { params, provenance });
}
function clearOverrides() { OVERRIDES.clear(); }

module.exports = { PARAM_CLASSES, STDP_DEFAULTS, resolveDynamics, typeKeyOf,
                   ntSignPrior, setClassOverride, clearOverrides,
                   PROV, PROV_NAME, OVERRIDES };
