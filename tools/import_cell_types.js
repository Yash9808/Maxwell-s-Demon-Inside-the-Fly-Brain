#!/usr/bin/env node
"use strict";
/**
 * tools/import_cell_types.js — Stage B reserved import path, executed.
 *
 * Imports the published FlyWire cell-type annotations (Schlegel et al.,
 * Nature 2024, "Whole-brain annotation and multi-connectome cell typing of
 * Drosophila", DOI 10.1038/s41586-024-07686-5; data hosted at
 * github.com/flyconnectome/flywire_annotations, whose root_ids are the
 * FlyWire v783 release — the SAME materialization as this repo's circuit)
 * into fly_brain_celltypes.json via the repo's own Stage B interface
 * p1_celltypes.importRows(). Nothing is invented: only (root_id, cell_type)
 * pairs present in BOTH the published table and the circuit metadata are
 * patched; every unmatched root is counted and reported.
 *
 * Provenance is recorded in the metadata file itself (meta.cell_type_import)
 * and per-record via cell_type_source (REQUIRED by the Stage B schema).
 *
 * Idempotent: re-running produces the same patched file. --dry-run reports
 * without writing. Raw TSV is NOT committed (data/annotations is ignored);
 * the sha256 below pins the exact source snapshot used.
 *
 * Usage:  node tools/import_cell_types.js [--dry-run] [--tsv <path>]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const TSV_DEFAULT = path.join(ROOT, "data", "annotations",
  "Supplemental_file1_neuron_annotations.tsv");
const JSON_PATH = path.join(ROOT, "fly_brain_celltypes.json");

// Source snapshot pin (downloaded 2026-09-21 from
// https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/
//   supplemental_files/Supplemental_file1_neuron_annotations.tsv)
const SOURCE = {
  publication: "Schlegel et al., Whole-brain annotation and multi-connectome cell typing of Drosophila, Nature 634:139-152 (2024)",
  doi: "10.1038/s41586-024-07686-5",
  table: "Supplemental_file1_neuron_annotations.tsv",
  host: "github.com/flyconnectome/flywire_annotations (main)",
  url: "https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv",
  root_id_materialization: "FlyWire v783 (same as circuit)",
  source: "flywire_annotations:Schlegel2024",
  tsv_sha256: "9a4f8b2f843196074431ebd7cd883536afa1be86c8a4ce90970441e8be81d1be",
  tsv_bytes: 31718505,
  imported_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  source_tag: "SOURCE-DERIVED (imported; never synthesized)",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tsvIdx = args.indexOf("--tsv");
const tsvPath = tsvIdx >= 0 ? path.resolve(args[tsvIdx + 1]) : TSV_DEFAULT;

// ---- 1. load + pin the published table -----------------------------------
if (!fs.existsSync(tsvPath))
  throw new Error(`annotations TSV not found at ${tsvPath} (download from ${SOURCE.url})`);
const tsvBuf = fs.readFileSync(tsvPath);
const tsvSha = crypto.createHash("sha256").update(tsvBuf).digest("hex");
if (tsvSha !== SOURCE.tsv_sha256)
  throw new Error(`annotations TSV sha256 mismatch: ${tsvSha} != ${SOURCE.tsv_sha256} — update SOURCE pin after re-verifying upstream`);
console.log(`TSV verified: ${SOURCE.tsv_bytes} bytes, sha256 ${tsvSha.slice(0, 16)}…`);

// ---- 2. parse (root_id + cell_type only; stream line-by-line) -------------
const lines = tsvBuf.toString("utf8").split("\n");
const header = lines[0].split("\t");
const iRoot = header.indexOf("root_id");
const iType = header.indexOf("cell_type");
if (iRoot < 0 || iType < 0)
  throw new Error(`TSV missing root_id/cell_type columns (header: ${header.join(",")})`);

const rows = [];
for (let l = 1; l < lines.length; l++) {
  const line = lines[l];
  if (!line) continue;
  const c = line.split("\t");
  const root = c[iRoot];
  const type = c[iType];
  if (!root || !type || type === "NA") continue;   // untyped neurons stay UNKNOWN
  rows.push({ root_id: root, cell_type: type, source: "flywire_annotations:Schlegel2024" });
}
console.log(`parsed ${rows.length.toLocaleString()} typed (root_id, cell_type) rows`);

// ---- 3. import through the repo's own validated interface ----------------
const ct = require(path.join(ROOT, "p1_celltypes.js"));
// Prime the cache with the on-disk metadata, then verify the root-sequence
// hash before any patching (loader invariant: identity is positional).
const before = ct.loadCellTypes(JSON_PATH);
console.log(`metadata: ${before.neurons.length.toLocaleString()} records; ` +
  `cell_type_known before = ${before.neurons.filter(r => r.cell_type && r.cell_type !== "UNKNOWN").length}`);

const report = ct.importRows(rows, { jsonPath: JSON_PATH });
console.log(`import report: matched=${report.matched.toLocaleString()} ` +
  `unknown_root=${report.unknown_root.toLocaleString()} ` +
  `rejected=${report.rejected.length.toLocaleString()}`);

// ---- 4. record provenance in the metadata itself -------------------------
const data = ct.loadCellTypes(JSON_PATH);
data.meta.cell_type_import = SOURCE;
data.meta.cell_type_import.matched = report.matched;
data.meta.cell_type_import.unknown_root = report.unknown_root;
const known = data.neurons.filter(r => r.cell_type && r.cell_type !== "UNKNOWN").length;
data.meta.n_cell_type_known = known;

const distinct = [...new Set(data.neurons
  .filter(r => r.cell_type && r.cell_type !== "UNKNOWN")
  .map(r => r.cell_type))].sort();

if (dryRun) {
  console.log(`[dry-run] would patch ${report.matched.toLocaleString()} records ` +
    `(${known.toLocaleString()} typed total, ${distinct.length} distinct types); file NOT written`);
  process.exit(0);
}

fs.writeFileSync(JSON_PATH,
  JSON.stringify(data) /* compact — schema-1 file is single-line */,
  "utf8");
console.log(`wrote ${path.basename(JSON_PATH)}: ${known.toLocaleString()} typed neurons, ` +
  `${distinct.length} distinct cell types`);
console.log(`sample types: ${distinct.slice(0, 12).join(", ")}${distinct.length > 12 ? ", …" : ""}`);
