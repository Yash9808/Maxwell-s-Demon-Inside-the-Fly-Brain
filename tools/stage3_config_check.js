#!/usr/bin/env node
/**
 * stage3_config_check.js — stage2-style config validator, extended for the
 * Stage-3 demon-observation registered arm. Validates a benchmark --config
 * JSON (Stage-1/2/3 layout) and, NEW, the demonObs fields:
 *
 *   - demonObs (top-level default or per-arm): boolean, DEFAULT false
 *     (browser #demonObsChk parity);
 *   - demonObsGain: number in 1..24, DEFAULT 12 (browser DEMON_OBS_INPUT_GAIN);
 *   - when ANY arm carries demonObs true: the input-layer reserved band must
 *     be derivable from the real circuit (FAFB expectation [2472, 2875),
 *     403 neurons — the pre-registered map);
 *   - observed-arm rows/manifest contract reminder: demonObsOn, demonObsGain,
 *     obsBandLo/Hi/Neurons (rows + manifest) appear ONLY when ON.
 *
 * It validates ONLY shape and derivability — it never runs the seed table
 * (dry-run attract: node tools/stage2_parallel.js for that) and does not
 * touch any §13-pinned file.
 *
 * Usage:
 *   node tools/stage3_config_check.js <config.json> [<config.json> ...]
 *   node tools/stage3_config_check.js              # checks the in-repo smoke+demonobs configs
 *
 * Exit 0 = every check passed; exit 1 = any failure.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const CORE = require(path.join(__dirname, "..", "experiment_core.js"));

const ROOT = path.join(__dirname, "..");
const configs = process.argv.slice(2);
if (!configs.length) {
  configs.push("tests/stage1_smoke_tiny_config.json");
  configs.push("tests/stage1_smoke_demonobs_off_config.json");
  const onCfg = path.join(ROOT, "research_data", "stage3_demonobs_on_smoke_config.json");
  if (fs.existsSync(onCfg)) configs.push("research_data/stage3_demonobs_on_smoke_config.json");
}

let bad = 0;
const ok = (cond, msg, extra) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}${extra ? "   " + extra : ""}`);
  if (!cond) bad++;
};

for (const rel of configs) {
  const abs = path.join(ROOT, rel);
  console.log(`\n=== config ${rel} ===`);
  if (!fs.existsSync(abs)) { console.log(`  FAIL  config file missing`); bad++; continue; }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(abs, "utf8")); }
  catch (e) { console.log(`  FAIL  config is not valid JSON: ${e.message}`); bad++; continue; }

  ok(typeof cfg === "object" && !Array.isArray(cfg), "config object");
  ok(cfg.physics && typeof cfg.physics === "object", "physics block present");
  ok(cfg.phases && cfg.phases.train && cfg.phases.post !== undefined, "phases block present");
  ok(cfg.seedTable && Array.isArray(cfg.seedTable.pairs), "seedTable.pairs present");
  ok(cfg.arms && typeof cfg.arms === "object" && Object.keys(cfg.arms).length >= 2, "arms block (>= 2 arms)");

  // ---- demonObs flag schema (Stage-3) -------------------------------------
  const armKeys = Object.keys(cfg.arms);
  const topOn = cfg.demonObs !== undefined ? !!cfg.demonObs : false;
  const effective = armKeys.map(k =>
    [k, cfg.arms[k].demonObs !== undefined ? !!cfg.arms[k].demonObs : topOn]);
  const onArms = effective.filter(([, on]) => on).map(([k]) => k);
  ok(cfg.demonObs === undefined || typeof cfg.demonObs === "boolean", "top-level demonObs boolean or absent");
  ok(cfg.demonObsGain === undefined || (typeof cfg.demonObsGain === "number" && cfg.demonObsGain >= 1 && cfg.demonObsGain <= 24),
     "top-level demonObsGain number in 1..24 or absent", String(cfg.demonObsGain));
  for (const k of armKeys) {
    const a = cfg.arms[k];
    ok(a.demonObs === undefined || typeof a.demonObs === "boolean", `arm ${k}: demonObs boolean or absent`);
    ok(a.demonObsGain === undefined || (typeof a.demonObsGain === "number" && a.demonObsGain >= 1 && a.demonObsGain <= 24),
       `arm ${k}: demonObsGain number in 1..24 or absent`);
  }
  ok(true, `effective obs arms: ${onArms.length ? onArms.join(", ") : "(none)"} ` +
           `(top-level default ${topOn})`);
  if (onArms.length) {
    // derivability from the REAL circuit, same slice math as the injector
    let circuit = null;
    try { circuit = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8")); } catch (e) {}
    const band = CORE.demonObsBand(circuit);
    ok(!!band, "input-layer reserved band derivable from the real circuit");
    if (band) {
      ok(band.lo === 2472 && band.hi === 2875 && band.neurons === 403,
         "band matches the FAFB pre-registered map [2472, 2875) = 403 neurons",
         `[${band.lo}, ${band.hi}) = ${band.neurons} of ${band.inputLayer}`);
      const gains = onArms.map(k =>
        cfg.arms[k].demonObsGain !== undefined ? cfg.arms[k].demonObsGain
        : cfg.demonObsGain !== undefined ? cfg.demonObsGain : 12);
      ok(gains.every(g => g >= 1 && g <= 24), "all obs-arm gains in 1..24", gains.join(","));
      ok(true, "rows+manifest contract when ON: demonObsOn, demonObsGain, obsBandLo/Hi/Neurons (runner emits; consumer verifies)");
    }
  }
}

console.log("");
if (bad) { console.log(`FAILED: ${bad} check(s)`); process.exit(1); }
console.log("all config checks passed.");
