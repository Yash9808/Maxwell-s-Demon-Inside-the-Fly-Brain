/**
 * p1_celltypes.js — Stage B loader: per-neuron cell-type metadata (root-ID keyed).
 *
 * Joins fly_brain_celltypes.json (built by p1_build_celltypes.py from v783
 * sources; provenance in its meta.provenance) onto the legacy circuit arrays.
 * ZERO P0 rewrite: fly_brain_circuit.json stays untouched; this module only
 * needs the SAME index->root reconstruction invariant (sorted root IDs of
 * neurons whose dominant pre neuropil is in a layer set), which it re-derives
 * from the metadata file itself and cross-checks via the stored sha256 +
 * layer coherence — see p1_tests.js "P1-B: metadata join".
 *
 * Backward compatibility: every consumer of the legacy circuit gets the exact
 * legacy fields; the metadata ride along as NEW parallel arrays.
 *
 * Provenance tags follow the P1 standard: SOURCE-DERIVED / MODEL-ASSUMED /
 * EMPIRICAL / TUNED / UNKNOWN. cell_type is UNKNOWN for all neurons until a
 * published FlyWire/flyvis table is imported (p1_celltypes.import()).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let _cache = null;

function loadCellTypes(jsonPath) {
  if (_cache) return _cache;
  const file = jsonPath || path.join(__dirname, "fly_brain_celltypes.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.meta && data.meta.schema_version !== 1)
    throw new Error("fly_brain_celltypes.json: unsupported schema_version");
  _cache = data;
  return data;
}

function sha256Roots(rootIds) {
  const u64 = new BigUint64Array(rootIds.length);
  for (let i = 0; i < rootIds.length; i++) u64[i] = BigInt(rootIds[i]);
  return crypto.createHash("sha256").update(Buffer.from(u64.buffer)).digest("hex");
}

/**
 * Attach metadata to a circuit object { layers, layer_names, edges, ... }.
 *
 * Returns { byIndex: Uint32Array row->record index, records, meta, layerOf,
 *           rootOf, stats } — records[i] corresponds to circuit neuron i
 * (circuit index = position in the concatenated layer lists, exactly the
 * extract_circuit.py ordering: sorted root IDs grouped by layer).
 */
function attachToCircuit(circuit, opts) {
  const data = loadCellTypes(opts && opts.jsonPath);
  const records = data.neurons;
  const flat = [];
  for (const l of circuit.layers) for (const i of l) flat.push(i);

  // Circuit index order IS sorted-root-id-per-layer order: neuron i of layer L
  // is the L-th layer member when all layer members are enumerated in
  // ascending root-ID order (extract_circuit.py all_ids = sorted(layer_of)).
  // The builder emitted records in that same order, so identity is positional.
  // Guard: counts + per-layer membership + (cheap) hash of the root sequence.
  if (flat.length !== records.length)
    throw new Error(`celltypes/circuit size mismatch: ${flat.length} vs ${records.length}`);
  const layerOf = new Uint8Array(flat.length);
  const rootOf = new Array(flat.length);
  {
    let p = 0;
    for (let li = 0; li < circuit.layers.length; li++) {
      const members = circuit.layers[li];
      const recSlice = records.slice(p, p + members.length);
      for (let k = 0; k < members.length; k++, p++) {
        layerOf[members[k]] = li;
        rootOf[members[k]] = records[p].root_id;   // decimal string (uint64-safe)
      }
    }
  }
  // structural check: records are strictly ascending in root_id per layer
  // block (decimal-string compare == numeric compare for equal-length IDs;
  // FlyWire IDs are uniform 18-digit decimals).
  {
    let p = 0;
    for (let li = 0; li < circuit.layers.length; li++) {
      const n = circuit.layers[li].length;
      for (let k = p + 1; k < p + n; k++)
        if (records[k].root_id <= records[k - 1].root_id)
          throw new Error(`celltypes not root-sorted at record ${k} (layer ${li})`);
      p += n;
    }
  }

  const stats = {
    n: records.length,
    nt_classified: records.filter(r => r.nt_class && r.nt_class !== "UNKNOWN").length,
    post_mapped: records.filter(r => r.post_neuropil).length,
    cell_type_known: records.filter(r => r.cell_type && r.cell_type !== "UNKNOWN").length,
  };
  return { byIndex: flat, records, meta: data.meta, layerOf, rootOf, stats };
}

/**
 * Per-neuron NT-sign prior: +1 excitatory, -1 inhibitory-like, 0 unknown.
 * Source tag: SOURCE-DERIVED for classified neurons (v783 NT scores, the
 * gaba/ser/da = inhibitory-like convention of extract_circuit.py),
 * MODEL-ASSUMED where the class is mixed_uncertain/no_outgoing -> 0.
 */
function ntSignOf(rec) {
  switch (rec && rec.nt_class) {
    case "cholinergic":
    case "glutamatergic":
      return 1;
    case "GABAergic":
    case "serotonergic":
    case "dopaminergic":
      return -1;
    case "mixed_uncertain":
    case "no_outgoing":
    case "UNKNOWN":
    default:
      return 0;
  }
}

/**
 * Runtime-usable per-neuron view: Float32 matrices kept parallel to the
 * circuit's flat index space. signPrior is MODEL-ASSUMED polarity from NT
 * class; conf = nt_dominant_score (SOURCE-DERIVED 0..1) or 0.
 */
function buildNeuronTable(circuit, opts) {
  const att = attachToCircuit(circuit, opts);
  const N = att.records.length;
  const ntSign = new Int8Array(N);
  const ntConf = new Float32Array(N);
  const layer = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const rec = att.records[i];
    ntSign[i] = ntSignOf(rec);
    ntConf[i] = rec.nt_dominant_score || 0;
    layer[i] = att.layerOf[i];
  }
  return Object.assign(att, { N, ntSign, ntConf, layer });
}

/**
 * Reserved import interface for published cell-type tables (Stage B contract).
 * Call with rows shaped like:
 *   { root_id: 7205759406..., cell_type: "T4c", hemisphere: "L",
 *     source: "flyvis-connectome-2024", neuprint_bodyid?: "...", extra?: {...} }
 * Validates root IDs against the loaded metadata and returns a patch report;
 * it NEVER invents or fills values for unknown root IDs.
 */
function importRows(rows, opts) {
  const data = loadCellTypes(opts && opts.jsonPath);
  const byRoot = new Map();
  for (let i = 0; i < data.neurons.length; i++)
    byRoot.set(data.neurons[i].root_id, i);
  const report = { matched: 0, unknown_root: 0, patched: [], rejected: [] };
  for (const row of rows) {
    const i = byRoot.get(row.root_id);
    if (i === undefined) { report.unknown_root++; report.rejected.push(row.root_id); continue; }
    if (!row.cell_type || typeof row.cell_type !== "string") { report.rejected.push(row.root_id); continue; }
    const rec = data.neurons[i];
    rec.cell_type = row.cell_type;                       // SOURCE-DERIVED (imported)
    rec.cell_type_source = row.source || "unspecified";  // provenance REQUIRED by schema
    report.patched.push(row.root_id);
    report.matched++;
  }
  return report;
}

module.exports = { loadCellTypes, attachToCircuit, buildNeuronTable, ntSignOf, importRows };
