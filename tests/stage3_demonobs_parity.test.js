#!/usr/bin/env node
/**
 * stage3_demonobs_parity.test.js — demon-observation registered-arm tests
 * (Stage-3 prep; engineering tests only, they generate no EVIDENTIAL rows).
 *
 *   node tests/stage3_demonobs_parity.test.js
 *
 * What it proves:
 *   1. (unit) env-level demon FSM: obs tail ordering EXACTLY mirrors
 *      fly_demon_3d.html demonObsVector(); OFF envs stay bit-identical and
 *      ON envs consume no rng (particle trajectories match arm-for-arm);
 *   2. (unit) runBenchmark stamps demonObsOn/demonObsGain/obsBand* on rows of
 *      arms with the flag and on NO rows without it;
 *   3. (integration) OFF-path byte parity: a fresh config-mode run with
 *      demonObs:false yields rows BYTE-IDENTICAL to the pre-change runner
 *      (golden fixtures under tests/fixtures/stage3_demonobs_off/);
 *   4. (integration) ON-path: a senior connectome arm with demonObs:true
 *      carries demonObsOn + the FAFB band [2472, 2875) (403 neurons) per row
 *      and the manifest block.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const CORE = require(path.join(__dirname, "..", "experiment_core.js"));
const CTRL = require(path.join(__dirname, "..", "controllers.js"));

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "stage3_demonobs_off");

let failures = 0;
function ok(cond, label, extra) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? "   " + extra : ""}`);
  if (!cond) failures++;
}

console.log("=== 1. env-level demon FSM (obs ordering + zero-rng additivity) ===");
{
  const base = CORE.makeEnvironment({ seed: 5, nParticles: 60 });
  const obs = CORE.makeEnvironment({ seed: 5, nParticles: 60, demonObs: true });
  ok(base.readSensors().length === 7, "OFF env: 7 base sensor channels");
  const o = obs.readSensors();
  ok(o.length === 15, "ON env: 7 base + 8 obs channels", `len=${o.length}`);
  ok(JSON.stringify(o.slice(0, 7)) === JSON.stringify(base.readSensors()), "first 7 channels byte-identical to OFF");
  // FSM: command with a closed (eased) door → ATTEND first; once the eased
  // aperture crosses 0.6 (browser's open flag) the arm flips to HOLD.
  for (let k = 0; k < 2; k++) { obs.door.target = 1; obs.step(1 / 60); }
  const s1 = obs.readSensors();
  ok(s1.slice(7, 12).join(",") === "0,1,0,0,0", "cmd + eased-closed door => ATTEND one-hot (WATCH,ATTEND,HOLD,STRIKE,RECOIL)");
  let guard = 0;
  while (obs.door.pos <= 0.6 && guard++ < 60) { obs.step(1 / 60); }
  const s2 = obs.readSensors();
  ok(s2.slice(7, 12).join(",") === "0,0,1,0,0", "eased-open door (pos > 0.6) => HOLD one-hot");
  // obs indexes (browser obs_0..obs_7 = tail 7..14): 5 timeSinceAction, 6 goodRate, 7 gateCmd
  ok(s1[14] === 1 && s2[14] === 1, "obs_gateCmd = door.target (clamped 0..1)");
  ok(s1[13] === 0.5 && s2[13] === 0.5, "obs_goodRate 0.5 prior before any crossing");
  ok(s1[12] > 0 && s1[12] <= 1, "obs_timeSinceAction = clamp((simTime − last transition)/2, 0, 1)");
  // crossing → STRIKE: use the FSM's documented event contract directly
  const fsm = CORE.makeDemonFsm();
  fsm.step(1 / 60); fsm.step(1 / 60);
  fsm.onDoorRegime(false, false);                                  // browser: WATCH
  fsm.onCrossing(0.8, 200);                                        // good crossing
  ok(fsm.S.state === "STRIKE", "good crossing => STRIKE");
  const thr = fsm.S.rolling.length === 1 && fsm.S.rolling[0] === 1;
  ok(thr, "rolling-20 crossing valence window fed (1 = good)");
  // zero-prior cumulative fallback after reset
  fsm.reset();
  ok(fsm.S.state === "WATCH" && fsm.S.rolling.length === 0 && fsm.S.crossGood === 0 && fsm.S.crossBad === 0,
     "FSM reset clears valence memory");
  // env additivity: with obs the PARTICLE TRAJECTORY is unchanged (no rng)
  const a = CORE.makeEnvironment({ seed: 77, nParticles: 200 });
  const b = CORE.makeEnvironment({ seed: 77, nParticles: 200, demonObs: true });
  let same = true;
  for (let i = 0; i < 300; i++) {
    if (i === 120) { a.door.target = 1; b.door.target = 1; }
    const sa = a.readSensors(), sb = b.readSensors();
    if (JSON.stringify(sa) !== JSON.stringify(sb.slice(0, 7))) same = false;
    a.step(1 / 60); b.step(1 / 60);
  }
  let divergence = 0;
  for (let i = 0; i < 200; i++)
    if (a.particles[i].x !== b.particles[i].x || a.particles[i].vx !== b.particles[i].vx) divergence++;
  ok(same, "base-7 sensor stream identical across the obs flag");
  ok(divergence === 0, "env particle stream unchanged by the obs flag (zero rng)", `divergence=${divergence}`);
}

console.log("=== 2. runBenchmark row provenance (per-arm stamping) ===");
{
  const stub = (rng, env, cfg) => ({
    step(dt, env2) { env2.door.target = rng() < 0.2 ? 1 : 0; },
  });
  const common = {
    seed: 3, nSeeds: 1, trialsTrain: 1, trialsTest: 0,
    episodeSeconds: 1, nParticles: 60, noise: 0, doorHeight: 64,
    controllers: { on: stub, off: stub },
  };
  const stamped = CORE.runBenchmark(Object.assign({}, common, {
    demonObs: true, demonObsArms: { on: true, off: false },
    demonObsGain: 9, demonObsBand: { lo: 1, hi: 2, neurons: 1, inputLayer: 2 },
  }));
  const rowsOf = (key) => stamped.conditions[key]._raw[0].trials;
  const on = rowsOf("on"), off = rowsOf("off");
  ok(on.length === 1 && on[0].demonObsOn === true, "flagged arm row carries demonObsOn");
  ok(on[0].demonObsGain === 9 && on[0].obsBandLo === 1 && on[0].obsBandHi === 2 && on[0].obsBandNeurons === 1,
     "flagged arm row carries gain + echoed band");
  ok(!("demonObsOn" in off[0]) && !("obsBandNeurons" in off[0]),
     "unflagged arm in the same run gains NO obs keys");
  const plain = CORE.runBenchmark(Object.assign({}, common));
  ok(JSON.stringify(plain.conditions.on._raw[0].trials) === JSON.stringify(CORE.runBenchmark(Object.assign({}, common, {
    demonObs: false, demonObsArms: { on: false, off: false }, demonObsGain: 9,
  })).conditions.on._raw[0].trials),
     "OFF run with the flag declared byte-identical to a plain run (row streams)");
}

console.log("=== 3. OFF-path byte parity vs pre-change runner (golden fixture) ===");
{
  const cfgPath = "tests/stage1_smoke_demonobs_off_config.json";
  const before = fs.readdirSync(path.join(ROOT, "research_data"))
    .filter(f => f.startsWith("stage1_trials_"));
  execFileSync(process.execPath, ["benchmark.js", "--config", cfgPath],
               { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const after = fs.readdirSync(path.join(ROOT, "research_data"))
    .filter(f => f.startsWith("stage1_trials_"));
  const fresh = after.filter(f => !before.includes(f));
  ok(fresh.length === 1, "config-mode OFF run produced exactly one new trials file",
     fresh.join(","));
  if (fresh.length === 1) {
    const got = fs.readFileSync(path.join(ROOT, "research_data", fresh[0]));
    const golden = fs.readFileSync(path.join(FIX, "config_mode_trials.jsonl"));
    ok(got.equals(golden), "OFF rows BYTE-IDENTICAL to the pre-change runner fixture",
       `${got.length}B vs ${golden.length}B`);
  }
}

console.log("=== 4. ON-path: connectome arm carries the registered band ===");
{
  const onCfg = {
    configVersion: 1, stage: 1, SMOKE: true,
    smokeNote: "demon-observation ON-arm smoke (tests/stage3_demonobs_parity.test.js): engineering sanity only, tiny phases, seeds deliberately OUTSIDE every pilot/Stage-2 table.",
    protocol: { document: "Confirmatory_experiment_protocol_v1.md", version: "v1.1", status: "SMOKE — engineering sanity only" },
    runtime: { engine: "experiment_core.js", driver: "benchmark.js --config" },
    demonObs: true, demonObsGain: 12,
    physics: { dt: 0.016666666666666666, nParticles: 320, noise: 0.12, doorHeight: 64,
               jetPower: 0.55, jetAim: 0.5, jetInterval: 3.5, tKelvin: 300, simToJoule: 1e-21,
               landauerBitJ: 2.871e-21, lr: 0.004 },
    phases: { pre: { trials: 0, episodeSeconds: 2, learning: false },
              train: { trials: 1, episodeSeconds: 2, learning: true },
              post: { trials: 1, episodeSeconds: 2, learning: false } },
    frozenPreSeconds: 0,
    arms: {
      armA_real_connectome_obs: { kind: "connectome", shuffle: false, plasticity: "full",
                                  opticDrive: 0.25, opticInput: "legacy8bin", demonObs: true, demonObsGain: 12 },
      armE_random_action_floor: { kind: "random", policy: "randomActionFloor" },
    },
    seedTable: { seedStride: 101, consumedPairs: 1,
                 pairs: [{ k: 1, environmentSeed: 5301, networkSeed: 7301, topologySeed: 6701 }] },
  };
  const tmpPath = path.join(ROOT, "research_data", "stage3_demonobs_on_smoke_config.json");
  fs.writeFileSync(tmpPath, JSON.stringify(onCfg, null, 2) + "\n");
  const before = fs.readdirSync(path.join(ROOT, "research_data"))
    .filter(f => f.startsWith("stage1_trials_"));
  const manBefore = new Set(fs.readdirSync(path.join(ROOT, "research_data"))
    .filter(f => f.startsWith("stage1_manifest_")));
  execFileSync(process.execPath, ["benchmark.js", "--config", "research_data/stage3_demonobs_on_smoke_config.json"],
               { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const after = fs.readdirSync(path.join(ROOT, "research_data"))
    .filter(f => f.startsWith("stage1_trials_"));
  const fresh = after.filter(f => !before.includes(f));
  ok(fresh.length === 1, "ON-arm run produced exactly one new trials file", fresh.join(","));
  if (fresh.length === 1) {
    const lines = fs.readFileSync(path.join(ROOT, "research_data", fresh[0]), "utf8")
      .trim().split("\n").map(l => JSON.parse(l));
    const obsRows = lines.filter(r => r.condition === "armA_real_connectome_obs");
    const otherRows = lines.filter(r => r.condition === "armE_random_action_floor");
    ok(obsRows.length === 2 && obsRows.every(r => r.demonObsOn === true),
       "connectome obs-arm rows carry demonObsOn", `${obsRows.length} rows`);
    ok(obsRows.every(r => r.obsBandLo === 2472 && r.obsBandHi === 2875 && r.obsBandNeurons === 403),
       "connectome obs-arm rows carry the FAFB reserved band [2472, 2875) = 403 neurons",
       JSON.stringify([obsRows[0].obsBandLo, obsRows[0].obsBandHi, obsRows[0].obsBandNeurons]));
    ok(obsRows.every(r => r.demonObsGain === 12), "obs rows echo the gain");
    ok(otherRows.every(r => r.demonObsOn === true && r.obsBandNeurons !== undefined),
       "row-level provenance appears on EVERY trial row of the run");
    const manifestName = fs.readdirSync(path.join(ROOT, "research_data"))
      .filter(f => f.startsWith("stage1_manifest_") && !manBefore.has(f)).sort().pop();
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "research_data", manifestName), "utf8"));
    ok(manifest.demonObs && manifest.demonObs.on === true &&
       manifest.demonObs.band && manifest.demonObs.band.lo === 2472 &&
       manifest.demonObs.band.neurons === 403 &&
       Array.isArray(manifest.demonObs.arms) && manifest.demonObs.arms.length === 2,
       "manifest carries the demonObs block (arms + band)",
       "arms=" + (manifest.demonObs.arms || []).join(","));
  }
  try { fs.unlinkSync(tmpPath); } catch (e) {}
}

console.log("");
if (failures) { console.log(`FAILED: ${failures} check(s)`); process.exit(1); }
console.log("ALL demon-observation registered-arm checks passed.");
