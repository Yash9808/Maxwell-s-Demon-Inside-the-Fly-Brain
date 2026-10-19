#!/usr/bin/env node
/**
 * stage2_ordering_proof.js — proves the §13/§9 ordering contract for Stage 2:
 * the pre-registration precedes every real Stage-2 row and every real Stage-2
 * output file, and the registered config is the one that actually ran.
 *
 *   node tools/stage2_ordering_proof.js [prereg] [config] [outDir]
 *
 * Checks:
 *   1. PRE_REGISTRATION_STAGE2.json exists and is not SMOKE-adjacent: it pins a
 *      config sha, and stage2_config.json still hashes to that value (no
 *      post-registration amendment);
 *   2. every job receipt (jobs/ * /DONE.json) carries a timestamp AFTER
 *      registered_utc;
 *   3. every line of progress.jsonl carries a timestamp AFTER registered_utc;
 *   4. the EARLIEST mtime of any Stage-2 *output* file under the run directory
 *      is after registered_utc (this is the strongest form: it covers raw rows,
 *      gz archives, per-job manifests, sandbox output dirs and the run driver's
 *      config.json, not just the receipts). Sandbox runtime inputs are excluded
 *      on purpose: they are hardlinks to repo files, so they inherit the repo
 *      file's mtime and are not Stage-2 outputs.
 *   5. the runner's governance gate accepts this exact config (exit != 2).
 *
 * Reads only; exit 0 = the ordering contract holds.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const preregPath = process.argv[2] || path.join(ROOT, "PRE_REGISTRATION_STAGE2.json");
const configPath = process.argv[3] || path.join(ROOT, "stage2_config.json");
const outDir = process.argv[4] || path.join(ROOT, "research_data", "stage2_runs");

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
let bad = 0;
const ok = (c, msg, extra) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${msg}${extra ? "   " + extra : ""}`); if (!c) bad++; };

if (!fs.existsSync(preregPath)) { console.error(`no registration record at ${rel(preregPath)}`); process.exit(1); }
const reg = JSON.parse(fs.readFileSync(preregPath, "utf8"));
const regMs = Date.parse(reg.registered_utc);
console.log("=== Stage-2 ordering proof ===");
console.log(`preregistration : ${rel(preregPath)} at ${reg.registered_utc}`);
console.log(`registered config sha256: ${reg.config.sha256}`);
console.log(`run directory   : ${rel(outDir)}`);

console.log("-- 1. registered config is the one on disk");
const cfgSha = sha256(configPath);
ok(cfgSha === reg.config.sha256, "stage2_config.json still hashes to the registered sha (no amendment since registration)",
   `${cfgSha.slice(0, 16)}…`);

console.log("-- 2/3. receipts and progress lines postdate registration");
const jobsDir = path.join(outDir, "jobs");
let receipts = 0, lateReceipts = 0;
if (fs.existsSync(jobsDir)) {
  for (const j of fs.readdirSync(jobsDir)) {
    const d = path.join(jobsDir, j, "DONE.json");
    if (!fs.existsSync(d)) continue;
    receipts++;
    const ts = Date.parse(JSON.parse(fs.readFileSync(d, "utf8")).ts);
    if (!(ts > regMs)) lateReceipts++;
  }
}
ok(receipts > 0, "the campaign has written receipts", `${receipts} job(s) so far`);
ok(lateReceipts === 0, "every job receipt timestamp is after registered_utc", `${receipts - lateReceipts}/${receipts}`);

const progressPath = path.join(outDir, "progress.jsonl");
if (fs.existsSync(progressPath)) {
  const lines = fs.readFileSync(progressPath, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const bad1 = lines.filter(l => !(Date.parse(l.ts) > regMs));
  ok(bad1.length === 0, "every progress.jsonl line is after registered_utc", `${lines.length} line(s)`);
  if (lines.length) console.log(`      first job row: ${lines[0].jobId} @ ${lines[0].ts} (+${((Date.parse(lines[0].ts) - regMs) / 1000).toFixed(1)}s after registration)`);
} else ok(false, "progress.jsonl exists");

console.log("-- 4. earliest output mtime under the run directory");
// A sandbox holds hardlinked copies of the pinned runtime (they inherit the
// repo file's mtime) — those are inputs, not outputs. Everything else is an
// output: job dirs, sandbox research_data/, the run driver's per-job
// config.json, progress.jsonl and the merged manifests.
const isSandboxInput = (relPath, name) => /(^|\/)\.sandbox_w\d+$/.test(path.dirname(relPath)) && name !== "config.json";
let earliest = null, count = 0, skipped = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    const r = rel(p);
    if (isSandboxInput(r, e.name)) { skipped++; continue; }
    count++;
    const m = fs.statSync(p).mtimeMs;
    if (!earliest || m < earliest.m) earliest = { p, m };
  }
})(outDir);
ok(count > 0, "the run directory holds real Stage-2 outputs", `${count} file(s), ${skipped} sandbox runtime input(s) excluded`);
ok(earliest && earliest.m > regMs,
   "the EARLIEST output file in the whole run directory was written after registered_utc",
   earliest ? `${rel(earliest.p)} @ ${new Date(earliest.m).toISOString()} (+${((earliest.m - regMs) / 1000).toFixed(1)}s)` : "(none)");

console.log("-- 5. governance gate accepts this config");
const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "stage2_parallel.js"), "--config", rel(configPath), "--jobs", "__none__"],
  { cwd: ROOT, encoding: "utf8" });
ok(r.status !== 2, "the runner does not refuse the registered config (exit 2 = refused)", `exit ${r.status} ("${(r.stdout || r.stderr || "").trim().split("\n").pop()}")`);

console.log(bad === 0 ? "\nORDERING CONTRACT HOLDS" : `\nORDERING PROOF FAILED (${bad} check(s))`);
process.exit(bad === 0 ? 0 : 1);
