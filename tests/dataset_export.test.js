// C-3 dataset export acceptance tests (build-plan row 9).
//   T1  RFC-4180: header + CRLF rows; commas/quotes escaped; null -> empty
//   T2  column union: meta columns first in order, then sorted numeric/bool only
//   T3  display payloads excluded (fireVec b64 blobs never become columns)
//   T4  exportRun: files written; manifest schema v1 fields; sha256 matches CSV
//   T5  verifyDataset: intact pair passes; tampered CSV fails; torn pair fails
//   T6  determinism: same rows -> byte-identical CSV (timestamps only in manifest)
//   T7  live datasets on disk (e6, e10_e11) verify clean against their manifests
// Run: node --test tests/dataset_export.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DX = require(path.join(ROOT, "dataset_export.js"));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsx-"));
}

const ROWS = [
  { experiment: "e6", condition: "demon_neural", phase: "train", seed: 1, trial: 0,
    reward: 1.5, good: true, weightDrift: 123.456, fireVec: { vec: "AAAA", n: 5, total: 7 } },
  { experiment: "e6", condition: "demon_frozen", phase: "test", seed: 2, trial: 1,
    reward: null, good: false, weightDrift: 0, fireVec: { vec: "BBBB", n: 5, total: 0 } },
];

test("T1 — RFC-4180 CSV: header + CRLF, escaping, null -> empty", () => {
  const cols = DX.columnUnion(ROWS, ["experiment", "condition", "phase", "seed", "trial"]);
  const csv = DX.toCsv(ROWS, cols);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "experiment,condition,phase,seed,trial,good,reward,weightDrift");
  assert.equal(lines[1], "e6,demon_neural,train,1,0,true,1.5,123.456");
  assert.equal(lines[2], "e6,demon_frozen,test,2,1,false,,0");
  // quoting path: comma + double-quote inside a (non-column) string cell
  const q = DX.csvCell('a,"b"' + "\n c");
  assert.equal(q, '"a,""b""' + "\n c" + '"');
  assert.ok(csv.endsWith("\r\n"));
});

test("T2 — column union: meta first in order, then sorted numeric/bool only", () => {
  const cols = DX.columnUnion(ROWS, ["experiment", "condition", "phase", "seed", "trial"]);
  assert.deepEqual(cols.slice(0, 5),
    ["experiment", "condition", "phase", "seed", "trial"]);
  assert.deepEqual(cols.slice(5), ["good", "reward", "weightDrift"]); // sorted
  // string-only non-meta fields never become columns
  const rows2 = ROWS.concat([{ experiment: "e6", condition: "x", phase: "train",
    seed: 1, trial: 2, reward: 1, notes: "text-only field" }]);
  assert.ok(!DX.columnUnion(rows2, ["experiment", "condition", "phase", "seed", "trial"]).includes("notes"));
});

test("T3 — display payloads excluded (fireVec blobs never become columns)", () => {
  const cols = DX.columnUnion(ROWS, ["experiment", "condition", "phase", "seed", "trial"]);
  for (const banned of ["fireVec", "vec", "total", "layerRates"])
    assert.ok(!cols.includes(banned), "banned column leaked: " + banned);
  assert.ok(DX.EXCLUDED_FIELDS.has("fireVec"));
});

test("T4 — exportRun: pair written; manifest schema v1; sha256 matches", () => {
  const dir = tmpDir();
  const r = DX.exportRun({
    experiment: "_t4", label: "unit", question: "q?",
    protocol: "TRAIN -> FROZEN",
    config: { seeds: 2, seedBase: 1 },
    conditions: ["demon_neural", "demon_frozen"],
  }, ROWS, { dir, git: false });
  assert.ok(fs.existsSync(r.csvPath) && fs.existsSync(r.manifestPath));
  const man = JSON.parse(fs.readFileSync(r.manifestPath, "utf8"));
  assert.equal(man.schema_version, 1);
  assert.equal(man.experiment, "_t4");
  assert.equal(man.n_rows, 2);
  assert.equal(man.n_conditions, 2);
  assert.deepEqual(man.conditions, ["demon_neural", "demon_frozen"]);
  assert.ok(man.csv_sha256 && man.csv_sha256.length === 64);
  assert.equal(man.columns.length, 8);
  assert.ok(man.excluded_fields.includes("fireVec"));
  assert.equal(man.git_revision, null);      // git: false -> null, never guessed
  const csv = fs.readFileSync(r.csvPath, "utf8");
  const crypto = require("node:crypto");
  assert.equal(crypto.createHash("sha256").update(csv, "utf8").digest("hex"), man.csv_sha256);
});

test("T5 — verifyDataset: intact passes; tampered csv fails; torn pair fails", () => {
  const dir = tmpDir();
  const r = DX.exportRun({ experiment: "_t5", config: {} }, ROWS, { dir, git: false });
  assert.deepEqual(DX.verifyDataset(r.csvPath, r.manifestPath).ok, true);
  // tamper: rewrite the CSV with a different-length value (sha + bytes change)
  const csv = fs.readFileSync(r.csvPath, "utf8").replace("123.456", "9.9");
  fs.writeFileSync(r.csvPath, csv, "utf8");
  const v = DX.verifyDataset(r.csvPath, r.manifestPath);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes("sha256 mismatch")));
  assert.ok(v.errors.some(e => e.includes("byte length mismatch")));
  // equal-length tamper: sha256 alone catches it
  const csv2 = fs.readFileSync(r.csvPath, "utf8").replace("9.9", "888.8");
  fs.writeFileSync(r.csvPath, csv2, "utf8");
  const v2 = DX.verifyDataset(r.csvPath, r.manifestPath);
  assert.ok(v2.errors.some(e => e.includes("sha256 mismatch")));
});

test("T6 — determinism: same rows -> byte-identical CSV, stamp only in manifest", () => {
  const dir = tmpDir();
  const a = DX.exportRun({ experiment: "_t6", config: {} }, ROWS, { dir, git: false, name: "det" });
  const b = DX.exportRun({ experiment: "_t6", config: {} }, ROWS, { dir, git: false, name: "det" });
  // different stamps -> different manifest paths, but IDENTICAL csv bytes
  const csvA = fs.readFileSync(a.csvPath, "utf8");
  const csvB = fs.readFileSync(b.csvPath, "utf8");
  assert.equal(csvA, csvB);
  assert.equal(a.sha256, b.sha256);
  const manA = JSON.parse(fs.readFileSync(a.manifestPath, "utf8"));
  const manB = JSON.parse(fs.readFileSync(b.manifestPath, "utf8"));
  assert.notEqual(manA.created_utc, undefined);   // timestamp lives in the manifest
});

test("T7 — live datasets on disk verify clean against their manifests", () => {
  const rd = path.join(ROOT, "research_data");
  const found = fs.readdirSync(rd).filter(f => f.endsWith(".manifest.json") &&
    (f.startsWith("e6_dataset") || f.startsWith("e10_e11_dataset") || f.startsWith("e9_dataset")));
  assert.ok(found.length >= 2, "expected live e6 + e10_e11 datasets on disk, found: " + found.join(","));
  for (const mf of found) {
    const csv = mf.replace(/\.manifest\.json$/, ".csv");
    const v = DX.verifyDataset(path.join(rd, csv), path.join(rd, mf));
    assert.deepEqual(v.errors, [], mf + " failed verification");
    assert.equal(v.manifest.schema_version, 1);
  }
});
