"use strict";
/**
 * dataset_export.js — C-3 (build-plan row 9): ONE standardized, reproducible
 * dataset format for every experiment run (E1-E11 family + Phase 3B), per
 * the Phase D requirement: fixed configuration + fixed seeds + raw per-trial
 * observations/actions/rewards/neural activity/DA/weights + metadata.
 *
 * exportRun(manifest, rows) writes TWO files (atomic pairs, shared stamp):
 *   <name>.csv         RFC-4180 CSV of the per-trial rows (uniform column
 *                      schema: METADATA COLUMNS FIRST, then the union of
 *                      numeric/bool row fields, sorted; non-numeric fields
 *                      are EXCLUDED except explicit allowlist entries)
 *   <name>.manifest.json  schema v1 manifest: experiment id, CLI/args, all
 *                      seeds, config, condition list, column list, row count,
 *                      sha256 of the CSV, git revision/dirty flag
 *
 * Rules:
 *  - DISPLAY payloads are excluded from the dataset (fireVec b64, layer
 *    rates maps, any value > 512 chars) — they are UI artifacts, not data.
 *  - The manifest pins the EXACT sha256 of the CSV it describes; a CSV and
 *    manifest that disagree are detectably torn.
 *  - CSV cells: numbers via String() (full double precision), strings
 *    RFC-4180 quoted (doubled quotes), null/undefined -> empty cell.
 *  - Determinism: same manifest-lite (without timestamps/sha) + same rows
 *    -> byte-identical CSV. Timestamps live ONLY in the manifest.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCHEMA_VERSION = 1;

// ---- row flattening ---------------------------------------------------------
// Fields that are display artifacts (or per-run blobs), never dataset columns.
const EXCLUDED_FIELDS = new Set(["fireVec", "layerRates", "vec", "n", "total"]);

function isPlainNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Union of dataset columns across rows: metadata columns first (in the
 *  given order, always present), then the rest sorted alphabetically. */
function columnUnion(rows, metaCols) {
  const seen = new Set(metaCols);
  const rest = new Set();
  for (const r of rows)
    for (const k of Object.keys(r)) {
      if (seen.has(k) || EXCLUDED_FIELDS.has(k)) continue;
      const v = r[k];
      if (isPlainNumber(v) || typeof v === "boolean") rest.add(k);
      // non-numeric, non-allowlisted fields are excluded by design
    }
  return metaCols.concat([...rest].sort());
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvEscapeDisplay(s) {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** RFC-4180 CSV: header + one row per record. Deterministic. */
function toCsv(rows, columns) {
  const head = columns.map(csvEscapeDisplay).join(",");
  const lines = rows.map(r => columns.map(c => csvCell(r[c])).join(","));
  return head + "\r\n" + lines.join("\r\n") + "\r\n";
}

// ---- git provenance (best-effort; never guessed) ----------------------------
function gitInfo(root) {
  const out = { git_revision: null, git_dirty: null };
  try {
    const { execSync } = require("child_process");
    out.git_revision = execSync("git rev-parse HEAD",
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    out.git_dirty = execSync("git status --porcelain",
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
  } catch (e) { /* git unavailable: stays null */ }
  return out;
}

// ---- public API --------------------------------------------------------------
/**
 * exportRun(manifest, rows, opts) -> { csv, manifestPath, csvPath, sha256 }
 *   manifest: {
 *     experiment: "e6" | "e9" | "e10" | ...        (required)
 *     label: human title                           (optional)
 *     question: the scientific question            (optional)
 *     config: { seeds, seedBase, trainTrials, ... full CLI/config echo }
 *     conditions: ["demon_neural", ...]
 *     protocol: string (train/frozen discipline description)
 *     metaColumns: ["experiment","condition","phase","seed","trial"] (default)
 *   }
 *   rows: per-trial records (any superset of the meta columns)
 *   opts: { dir (default research_data/), name (default <experiment>_dataset),
 *           root (git cwd, default repo root) }
 */
function exportRun(manifest, rows, opts) {
  opts = opts || {};
  if (!manifest || !manifest.experiment) throw new Error("manifest.experiment required");
  if (!Array.isArray(rows) || !rows.length) throw new Error("rows required (non-empty)");

  const metaCols = manifest.metaColumns ||
    ["experiment", "condition", "phase", "seed", "trial"];
  for (const mc of metaCols)
    if (!(mc in rows[0]))
      throw new Error("meta column '" + mc + "' missing from row 1");

  const columns = columnUnion(rows, metaCols);
  const csv = toCsv(rows, columns);
  const sha256 = crypto.createHash("sha256").update(csv, "utf8").digest("hex");

  const dir = opts.dir || path.join(__dirname, "research_data");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = (opts.name || manifest.experiment + "_dataset") + "_" + stamp;
  const csvPath = path.join(dir, name + ".csv");
  const manifestPath = path.join(dir, name + ".manifest.json");

  const git = opts.git === false ? { git_revision: null, git_dirty: null }
                                 : gitInfo(opts.root || __dirname);
  const doc = {
    schema_version: SCHEMA_VERSION,
    experiment: manifest.experiment,
    label: manifest.label || null,
    question: manifest.question || null,
    created_utc: new Date().toISOString(),
    protocol: manifest.protocol || null,
    config: manifest.config || {},
    conditions: manifest.conditions || [...new Set(rows.map(r => r.condition))],
    n_rows: rows.length,
    n_conditions: (manifest.conditions ||
      [...new Set(rows.map(r => r.condition))]).length,
    columns,
    meta_columns: metaCols,
    excluded_fields: [...EXCLUDED_FIELDS],
    csv_file: path.basename(csvPath),
    csv_sha256: sha256,
    csv_bytes: Buffer.byteLength(csv, "utf8"),
    git_revision: git.git_revision,
    git_dirty: git.git_dirty,
  };
  fs.writeFileSync(csvPath, csv, "utf8");
  fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return { csvPath, manifestPath, sha256, columns, n_rows: rows.length };
}

/** Verify a dataset pair: CSV re-hashes to the manifest's sha256 and the
 *  row/column counts agree. Returns { ok, errors[] }. */
function verifyDataset(csvPath, manifestPath) {
  const errors = [];
  const csv = fs.readFileSync(csvPath, "utf8");
  const man = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sha = crypto.createHash("sha256").update(csv, "utf8").digest("hex");
  if (sha !== man.csv_sha256) errors.push("sha256 mismatch: csv " + sha +
    " vs manifest " + man.csv_sha256);
  if (Buffer.byteLength(csv, "utf8") !== man.csv_bytes)
    errors.push("byte length mismatch");
  const lines = csv.trim().split(/\r\n/);
  if (lines.length - 1 !== man.n_rows)
    errors.push("row count mismatch: csv " + (lines.length - 1) +
      " vs manifest " + man.n_rows);
  const header = lines[0].split(",");
  for (const c of man.columns)
    if (!header.includes(c)) errors.push("manifest column missing in csv: " + c);
  return { ok: errors.length === 0, errors, manifest: man };
}

module.exports = { exportRun, verifyDataset, toCsv, columnUnion, csvCell,
                   EXCLUDED_FIELDS, SCHEMA_VERSION };
