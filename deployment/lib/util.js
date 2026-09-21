"use strict";
/** deployment/lib/util.js — shared utilities for the deployment runner. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const RUNS = path.join(ROOT, "deployment", "runs");

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function sha256Text(t) {
  return crypto.createHash("sha256").update(t, "utf8").digest("hex");
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout || "").trim() || null;
}

function utcStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function ensureRunDir(mode) {
  const d = path.join(RUNS, `${utcStamp()}_${mode}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Execute one suite command; capture combined output to logPath; measure time.
function runSuite(cmd, logPath, opts = {}) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
    timeout: opts.timeout || 600_000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  r.durationMs = Date.now() - t0;
  fs.writeFileSync(logPath, (r.stdout || "") + (r.stderr || ""));
  return r;
}

// node:test TAP-ish counts: "ℹ pass 14" / "# pass 14" / "ℹ fail 0"
function parseNodeTestCounts(text) {
  const grab = (label) => {
    const m = text.match(new RegExp(`(?:ℹ|#)\\s*${label}\\s+(\\d+)`));
    return m ? parseInt(m[1], 10) : null;
  };
  return { pass: grab("pass"), fail: grab("fail") };
}

// Generic counted-suite checker: node:test counts, custom "N/N PASS",
// or smoke-style "41 passed, 0 failed, N skipped" summaries.
function checkCounted(text, wantPass, wantTotal) {
  const c = parseNodeTestCounts(text);
  if (c.pass !== null) {
    return { ok: c.pass === wantPass && (c.fail === 0 || c.fail === null), checks: c };
  }
  const m = text.match(new RegExp(`${wantPass}/${wantTotal}\\s*(PASS|✓|ok)`, "i"));
  if (m) return { ok: true, checks: { matched: `${wantPass}/${wantTotal} PASS` } };
  const s = text.match(new RegExp(`${wantPass} passed,\\s*(\\d+) failed`));
  if (s) {
    const failed = parseInt(s[1], 10);
    return { ok: failed === 0, checks: { matched: s[0] } };
  }
  return { ok: false, why: `expected ${wantPass}/${wantTotal}` };
}

function suiteResult(name, cmd, r, opts = {}) {
  return {
    name,
    command: cmd,
    exit_code: r ? r.status : null,
    timed_out: Boolean(r && r.error),
    duration_ms: r ? r.durationMs : null,
    log: opts.logPath ? path.relative(ROOT, opts.logPath) : null,
    log_sha256: opts.logPath && fs.existsSync(opts.logPath) ? sha256File(opts.logPath) : null,
    pass: opts.pass === true,
    checks: opts.checks || null,
    error: opts.error || null,
  };
}

function needPython(jsonOut, varName) {
  const v = process.env[varName];
  if (!v) {
    jsonOut.suites.push({
      name: "environment_gate",
      pass: false,
      error: `${varName} not set — deterministic validation error (fail closed; no silent fallback). `
           + `Set it, e.g. export ${varName}="$PWD/.venv-embodiment/Scripts/python.exe".`,
    });
    return null;
  }
  if (!fs.existsSync(v)) {
    jsonOut.suites.push({
      name: "environment_gate",
      pass: false,
      error: `${varName} points to a nonexistent path: ${v}`,
    });
    return null;
  }
  return v;
}

module.exports = {
  ROOT, RUNS,
  sha256File, sha256Text, git, utcStamp, ensureRunDir,
  runSuite, parseNodeTestCounts, checkCounted, suiteResult, needPython,
};
