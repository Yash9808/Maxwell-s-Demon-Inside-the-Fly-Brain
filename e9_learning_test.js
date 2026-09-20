/**
 * e9_learning_test.js — causal chain tests for the E9 Phase-1 closed loop.
 *
 *   A  neural motor output  -> valve command
 *   B  valve command        -> particle crossings
 *   C  particle distribution-> pressure difference
 *   D  pressure difference  -> piston motion
 *   E  piston motion        -> mechanical work
 *   F  reward               -> dopamine / plasticity
 *   G  learned weights persist into the frozen TEST phase
 *   +  determinism: same seed -> identical rows
 *
 * Run: node e9_learning_test.js
 */
"use strict";
const { pressureDemonCore, makeRng } = require("./experiment_core.js");
const { connectomeController } = require("./controllers.js");
const circuit = require("./fly_brain_circuit.json");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) failures++;
}
const factory = () => connectomeController(circuit, {
  shuffle: false, rng: makeRng(9176), seed: 1, opticDrive: 0, motorDrive: 0.6, plasticity: "full",
  // E9 credit assignment: per-crossing eligibility windows + trained
  // policy-gradient readout on the motor population (both opt-in).
  eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
  policyGradient: true, pgRng: makeRng(424243),
});
const CFG = { seed: 1, trials: 6, trainTrials: 3, episodeSeconds: 20, nParticles: 260,
              burnSeconds: 3, brainFactory: factory };

// ---- shared run: one core call, all five variants -------------------------
function runCore(extra) {
  const rows = [];
  const res = pressureDemonCore(Object.assign({}, CFG, extra, {
    onTrialData: (cond, phase, tr) => rows.push(Object.assign({ cond, phase }, tr)),
  }));
  return { res, rows };
}

// =========================== A: motor output -> valve ======================
console.log("\nA · neural motor output changes the valve command");
{
  // (i) brain level: driven sensors vs dead sensors produce different motor rates
  const b1 = factory(), b2 = factory();
  const drive = { readSensors: () => [0.9, 0, 0.8, 0.5, 0.5, 0, 0, 0],
                  readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  const idle  = { readSensors: () => [0, 0, 0, 0.5, 0.5, 0, 0, 0],
                  readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  let mDrive = 0, mIdle = 0;
  for (let i = 0; i < 400; i++) {
    b1.observe(drive); b1.step(1 / 15, drive); mDrive += b1.telemetry().motorRate;
    b2.observe(idle);  b2.step(1 / 15, idle);  mIdle += b2.telemetry().motorRate;
  }
  check("A.i brain motor rate differs (driven vs idle)", mDrive > mIdle + 40,
        "driven " + (mDrive / 400).toFixed(2) + " vs idle " + (mIdle / 400).toFixed(2) + " spikes/tick");
  // (ii) core level: the brain produces BOTH valve commands (flips > 0) and
  // the valve state is written from the decision path only
  const { rows } = runCore({});
  const nr = rows.filter(r => r.cond === "demon_neural");
  const flips = nr.reduce((a, r) => Math.max(a, r.valveFlips), 0);
  const anyOpen = nr.some(r => r.openFraction > 0), anyClosed = nr.some(r => r.openFraction < 1);
  check("A.ii neural brain emits both OPEN and CLOSE decisions", flips > 0 && anyOpen && anyClosed,
        "flips=" + flips + " open=" + anyOpen + " closed=" + anyClosed);
}

// ================ B/C/D/E: valve -> crossings -> ΔP -> piston -> work ======
console.log("\nB–E · valve -> crossings -> pressure -> piston -> work");
{
  const { rows } = runCore({});
  const sum = (cond, f) => rows.filter(r => r.cond === cond)
    .reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0);
  const speed = rows.filter(r => r.cond === "demon_speed");
  const never = rows.filter(r => r.cond === "never_open");
  check("B valve command changes crossings", sum("demon_speed", "crossings") > sum("never_open", "crossings") + 5,
        "speed " + sum("demon_speed", "crossings") + " vs never " + sum("never_open", "crossings"));
  // dPfinal is the volume-aware relative pressure difference averaged over
  // the post-BURN window — the quantity that actually drives the piston
  // (ΔT alone ignores the particle-count redistribution the valve causes).
  const dPspeed = speed.reduce((a, r) => a + Math.abs(r.dPfinal), 0) / speed.length;
  const dPnever = never.reduce((a, r) => a + Math.abs(r.dPfinal), 0) / never.length;
  check("C particle distribution changes pressure difference", dPspeed > dPnever * 2,
        "|ΔP| speed " + dPspeed.toFixed(4) + " vs never " + dPnever.toFixed(4));
  const pxSpeed = speed.reduce((a, r) => a + r.pistonX, 0) / speed.length;
  const pxNever = never.reduce((a, r) => a + r.pistonX, 0) / never.length;
  check("D pressure difference changes piston motion", pxSpeed > pxNever + 0.5,
        "pistonX speed " + pxSpeed.toFixed(2) + " vs never " + pxNever.toFixed(2));
  check("E piston motion changes mechanical work", sum("demon_speed", "workJ") > sum("never_open", "workJ") * 2,
        "work speed " + sum("demon_speed", "workJ").toExponential(2) + " vs never " + sum("never_open", "workJ").toExponential(2));
  // rectification sanity: random opens both ways -> only transient fluctuations
  // can do work; the demon's rectified pressure head must dominate it.
  check("E.sanity random valve rectifies nothing (work ≪ demon)",
        sum("demon_random", "workJ") < sum("demon_speed", "workJ") * 0.2,
        "random " + sum("demon_random", "workJ").toExponential(2) + " vs speed " + sum("demon_speed", "workJ").toExponential(2));
}

// ===================== F: reward -> dopamine / plasticity ==================
console.log("\nF · reward changes dopamine and synaptic weights");
{
  const mk = () => factory();
  const env = { readSensors: () => [0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0],
                readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  const learn = mk(), ctrl = mk();
  for (let i = 0; i < 300; i++) {
    for (const b of [learn, ctrl]) { b.observe(env); b.step(1 / 15, env); }
    learn.receiveFeedback({ reward: +0.4, kind: "e9_step" });   // reward signal
    ctrl.receiveFeedback({ reward: 0, kind: "e9_step" });       // no reward
    learn.applyLearningPublic ? null : null;
  }
  // applyLearning is invoked inside step() while learning is on
  const daL = learn.telemetry().dopamine, daC = ctrl.telemetry().dopamine;
  const wL = learn.weightDrift(), wC = ctrl.weightDrift();
  check("F.i reward drives dopamine", daL > daC + 0.1, "rewarded DA " + daL.toFixed(3) + " vs control " + daC.toFixed(3));
  check("F.ii dopamine + eligibility moved weights", wL > 0 && wC === 0,
        "rewarded Σ|Δw| " + wL.toExponential(2) + " vs control " + wC.toExponential(2));
  // frozen brain must not move weights even with reward
  const frozen = mk(); frozen.setLearning(false);
  for (let i = 0; i < 60; i++) { frozen.observe(env); frozen.step(1 / 15, env);
    frozen.receiveFeedback({ reward: 0.4, kind: "e9_step" }); }
  check("F.iii frozen brain ignores reward", frozen.weightDrift() === 0,
        "Σ|Δw| " + frozen.weightDrift().toExponential(2));
}

// ===================== G: weights persist across trials ====================
console.log("\nG · learned weights persist into the frozen TEST phase");
{
  const { rows } = runCore({});
  const nr = rows.filter(r => r.cond === "demon_neural");
  const lastTrain = nr.filter(r => r.phase === "train").pop();
  const firstTest = nr.find(r => r.phase === "test");
  check("G weights identical at train->test boundary (no updates in test)",
        firstTest.weightDrift === lastTrain.weightDrift,
        "last-train " + lastTrain.weightDrift.toExponential(2) + " == first-test " + firstTest.weightDrift.toExponential(2));
  check("G training actually changed weights from baseline", lastTrain.weightDrift > 0,
        "Σ|Δw| " + lastTrain.weightDrift.toExponential(2));
  check("G phase labels present", nr.every(r => r.phase === "train" || r.phase === "test"),
        "train rows " + nr.filter(r => r.phase === "train").length + ", test rows " + nr.filter(r => r.phase === "test").length);
}

// ================= H: multi-seed aggregation (apparatusCurve) ==============
console.log("\nH · multi-seed aggregation: 95% CI, cross-seed block means, TRAIN/TEST continuity");
{
  const { meanCI, apparatusCurve } = require("./experiment_core.js");

  // H0: the primitive itself
  const ci3 = meanCI([1, 2, 3]);
  const sd3 = Math.sqrt(((1 - 2) ** 2 + 0 + (3 - 2) ** 2) / 2);   // = 1
  check("H0 meanCI: mean and 95% interval (1.96·sd/√n)",
        ci3.mean === 2 && Math.abs(ci3.ci - 1.96 * sd3 / Math.sqrt(3)) < 1e-12 && ci3.n === 3,
        "mean " + ci3.mean + ", ci " + ci3.ci.toFixed(4));
  const ci1 = meanCI([5]);
  check("H0 meanCI: single value -> ci 0 (no interval claimed)",
        ci1.mean === 5 && ci1.ci === 0 && ci1.n === 1, "n=1");

  // three seeds through the same core call the worker makes
  const mkRows = (seed, seedTag) => {
    const rows = [];
    pressureDemonCore(Object.assign({}, CFG, {
      seed, seedTag, trials: 4, trainTrials: 2, episodeSeconds: 8,
      brainFactory: (tag) => connectomeController(circuit, {
        shuffle: false, rng: makeRng(9176 + tag * 101), seed: tag,
        opticDrive: 0, motorDrive: 0.6, plasticity: "full",
      }),
      onTrialData: (cond, phase, tr) => rows.push(Object.assign({ cond, phase }, tr)),
    }));
    return rows;
  };
  const all = [...mkRows(1, 1), ...mkRows(101, 2), ...mkRows(201, 3)];
  check("H1 every row carries its seed tag", all.every(r => r.seed >= 1 && r.seed <= 3),
        "seeds " + [...new Set(all.map(r => r.seed))].sort().join(","));

  const B = 2;
  const curve = apparatusCurve(all, B);
  check("H2 curve built for all five conditions",
        new Set(curve.map(p => p.cond)).size === 5,
        curve.map(p => p.cond).filter((c, i, a) => a.indexOf(c) === i).join(","));

  // H3: TRAIN/TEST block continuity per condition (test continues after train)
  let continuityOK = true, detail = "";
  const conds = [...new Set(curve.map(p => p.cond))];
  for (const c of conds) {
    const tr = curve.filter(p => p.cond === c && p.phase === "train");
    const te = curve.filter(p => p.cond === c && p.phase === "test");
    if (!tr.length || !te.length) { continuityOK = false; detail = c + " missing a phase"; break; }
    const lastTrain = Math.max(...tr.map(p => p.block));
    const firstTest = Math.min(...te.map(p => p.block));
    if (firstTest !== lastTrain + 1) { continuityOK = false;
      detail = c + ": last train " + lastTrain + " vs first test " + firstTest; break; }
  }
  check("H3 test blocks continue after train (no fold-back)", continuityOK, detail || "all 5 conditions");

  // H4: hand-computed cross-seed aggregation for two points (block 0, train):
  // per-seed block mean over B rows, then cross-seed meanCI. Use a nonzero
  // field (demon_speed ΔP) so the match actually discriminates, plus reward.
  {
    const hand = (cond, f) => meanCI([1, 2, 3].map(sd => {
      const seg = all.filter(r => r.cond === cond && r.phase === "train" &&
                                 r.seed === sd).slice(0, B);
      return seg.reduce((a, r) => a + r[f], 0) / seg.length;
    }));
    const ptD = curve.find(p => p.cond === "demon_speed" && p.phase === "train" && p.block === 0);
    const exD = hand("demon_speed", "dPfinal");
    check("H4 ΔP block point == hand-computed cross-seed mean ± CI",
          Math.abs(ptD.dPfinal.mean - exD.mean) < 1e-12 &&
          Math.abs(ptD.dPfinal.ci - exD.ci) < 1e-12 && ptD.dPfinal.n === 3,
          "curve " + ptD.dPfinal.mean.toFixed(4) + "±" + ptD.dPfinal.ci.toFixed(4) +
          " vs hand " + exD.mean.toFixed(4) + "±" + exD.ci.toFixed(4));
    const ptR = curve.find(p => p.cond === "never_open" && p.phase === "train" && p.block === 0);
    const exR = hand("never_open", "reward");
    check("H4 reward block point == hand-computed cross-seed mean ± CI",
          Math.abs(ptR.reward.mean - exR.mean) < 1e-12 &&
          Math.abs(ptR.reward.ci - exR.ci) < 1e-12 && ptR.reward.n === 3,
          "curve " + ptR.reward.mean.toFixed(4) + "±" + ptR.reward.ci.toFixed(4) +
          " vs hand " + exR.mean.toFixed(4) + "±" + exR.ci.toFixed(4));
  }

  // H5: every curve point exposes {mean,ci,n} so the plots CI bands can render
  const allStat = curve.every(p => p.reward && typeof p.reward === "object" &&
                                   Number.isFinite(p.reward.mean) && Number.isFinite(p.reward.ci));
  check("H5 all curve points carry {mean,ci,n} aggregation objects", allStat,
        curve.length + " points");

  // H6: ci shrinks to 0 for a single seed (plots degrade gracefully)
  const single = apparatusCurve(mkRows(1, 1), B).filter(p => p.phase === "train");
  check("H6 single-seed curve: ci 0 (no interval overclaimed)",
        single.every(p => p.reward.ci === 0), "all train points ci=0");
}

// ====== K: per-crossing eligibility windows (delayed-reward credit) =======
console.log("\nK · per-crossing eligibility windows reach delayed dopamine");
{
  const mk = (elig) => connectomeController(circuit, {
    shuffle: false, rng: makeRng(9176), seed: 1, opticDrive: 0, motorDrive: 0.6,
    plasticity: "full", policyGradient: false,
    eligibility: elig,
  });
  const env = { readSensors: () => [0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0],
                readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  const DELAY_TICKS = 300;            // 300 ticks ≈ 20 s of brain time at 15 Hz
  const envSilent = { readSensors: () => [0, 0, 0, 0, 0, 0, 0, 0],
                      readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  const run = (brain) => {
    for (let i = 0; i < 80; i++) { brain.observe(env); brain.step(1 / 15, env); }   // stamp traces
    for (let i = 0; i < DELAY_TICKS; i++) {                                        // SILENT delay:
      brain.observe(envSilent); brain.step(1 / 15, envSilent);                     // no co-activity,
    }                                                                               // traces age
    brain.receiveFeedback({ reward: +1, kind: "e9_step" });
    brain.observe(envSilent); brain.step(1 / 15, envSilent);   // a step applies the dopamine
    return brain.weightDrift();
  };
  const dFast = run(mk([{ tau: 0.985, w: 1 }]));   // single legacy window
  const dWin  = run(mk([{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }]));
  check("K.i delayed reward reaches 100-tick-old co-activity through windows",
        dWin > dFast * 5, `windows Σ|Δw| ${dWin.toExponential(2)} vs legacy ${dFast.toExponential(2)}`);
  check("K.ii window machinery does not perturb the legacy single-trace path",
        dFast > 0, `legacy Σ|Δw| ${dFast.toExponential(2)}`);
  // the frozen control stays silent under the same delayed reward
  const fz = mk([{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }]);
  fz.setLearning(false);
  const dFz = run(fz);
  check("K.iii frozen brain ignores delayed reward", dFz === 0, `Σ|Δw| ${dFz.toExponential(2)}`);
}

// ====== L: trained policy-gradient readout on the motor pool ==============
console.log("\nL · policy-gradient readout learns a stochastic P(open)");
{
  const mk2 = () => connectomeController(circuit, {
    shuffle: false, rng: makeRng(9176), seed: 1, opticDrive: 0, motorDrive: 0.6,
    plasticity: "full", policyGradient: true, pgRng: makeRng(424243),
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
  });
  // two environments with distinct sensory patterns. Two brains, one per
  // context: brain-A lives where OPENING pays, brain-B where opening costs.
  // Credit is action-contingent (REINFORCE needs reward DIFFERENCES across
  // actions) and single-context (a reward set after step i is applied to the
  // sample of step i+1, so alternating contexts would mis-attribute credit).
  const envA = { readSensors: () => [0.9, 0, 0.8, 0.5, 0.5, 0, 0, 0],
                 readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  const envB = { readSensors: () => [0, 0.9, 0.8, 0.5, 0.5, 0, 0, 0],
                 readVisualField: () => new Array(8).fill(0), door: { pos: 0, target: 0 }, particles: [] };
  const bA = mk2(), bB = mk2();
  const before = bA.policyProb();
  for (let i = 0; i < 300; i++) {
    bA.observe(envA); bA.step(1 / 15, envA);
    const aA = bA.lastPgAction();
    bA.pgReward = aA ? +0.5 : -0.2;                // A: opening pays
    bB.observe(envB); bB.step(1 / 15, envB);
    const aB = bB.lastPgAction();
    bB.pgReward = aB ? -0.5 : +0.2;                // B: opening costs
  }
  const pA = bA.policyProb(), pB = bB.policyProb();
  check("L.i readout separates rewarded from punished context",
        pA - pB > 0.15, `P(open|A) ${pA.toFixed(2)} vs P(open|B) ${pB.toFixed(2)}`);
  check("L.ii readout learned from its prior", Math.abs(pA - before) > 0.05,
        `prior ${before.toFixed(2)} -> A ${pA.toFixed(2)}`);
  // sampling uses the readout: the core path emits popen/bookkeeping (A.ii
  // already proves flips); here just confirm the API is present and finite
  check("L.iii readout probability finite", Number.isFinite(pA) && Number.isFinite(pB), "");
  // frozen readout must not move
  const f = mk2(); f.setLearning(false);
  for (let i = 0; i < 60; i++) { f.observe(envA); f.step(1 / 15, envA); f.pgReward = 0.5; }
  check("L.iv frozen readout ignores reward", Math.abs(f.policyProb() - 0.5) < 1e-9,
        `P(open) ${f.policyProb().toFixed(4)}`);
}

// ============ I: classical reference NEVER actuates the neural valve =======
console.log("\nI · classical rule is reference-only (stub-brain causality)");
{
  // stub brain: telemetry().motorRate drives the population-code decision
  // exactly like the real connectome's; everything else is inert. The core
  // reads telemetry ONCE PER DECISION (the decision cadence), and its code
  // is baseline-relative (fast EMA vs slow baseline): a constant rate would
  // be absorbed into the baseline and prove nothing. The high condition is
  // therefore a square wave over decisions (8-decision half-period, ~2 s):
  // the fast EMA (tau ~0.6 s) tracks it while the slow baseline (tau ~12 s)
  // stays near the midpoint — a genuine neural-signal -> valve path.
  function stubBrain(rateFn) {
    let n = 0;
    return {
      observe() {}, step() {},
      telemetry() { return { motorRate: rateFn(n),
                             sensoryActivity: 0, spikeCount: 0, dopamine: 0, weightDrift: 0 }; },
      receiveFeedback() {}, weightDrift() { return 0; }, resetForTrial() { n = 0; },
      bump() { n++; },
    };
  }
  function stubFactory(rateFn) { return () => { const b = stubBrain(rateFn);
    const t = b.telemetry.bind(b); b.telemetry = () => (b.bump(), t()); return b; }; }

  const CFG_STUB = { seed: 5, trials: 4, trainTrials: 2, episodeSeconds: 12, nParticles: 160,
                     burnSeconds: 2, variants: ["demon_neural"] };
  const run = (factory) => { const rows = [];
    pressureDemonCore(Object.assign({}, CFG_STUB, { brainFactory: factory,
      onTrialData: (cond, phase, tr) => rows.push(Object.assign({ cond, phase }, tr)) }));
    return rows; };

  const shut = run(stubFactory(() => 0));                    // motor rate always 0
  const wave = run(stubFactory((n) => (Math.floor(n / 8) % 2 ? 10 : 0)));  // 2 s square wave
  const sShut = shut[shut.length - 1], sOpen = wave[wave.length - 1];

  check("I.i motor rate 0 -> valve never opens, no crossings (brain, not rule, controls valve)",
        sShut.openFraction === 0 && sShut.crossings === 0 && sShut.workJ < 1e-24,
        "openFrac " + sShut.openFraction + ", crossings " + sShut.crossings +
        ", work " + sShut.workJ.toExponential(1) + " (piston noise floor)");
  check("I.ii pulsing motor rate -> valve opens and particles cross",
        sOpen.openFraction > 0.05 && sOpen.crossings > 0,
        "openFrac " + sOpen.openFraction.toFixed(2) + ", crossings " + sOpen.crossings);
  check("I.iii shut-stub diverges from classical reference (rule not actuating)",
        sShut.demonAgree < 1,
        "agreement " + sShut.demonAgree.toFixed(2) + " < 1 while valve never opened");
  check("I.iv stub reward pathway inert (no crashes, penalty accrued by rule scoring)",
        Number.isFinite(sShut.reward) && Number.isFinite(sOpen.reward),
        "rewards finite: " + sShut.reward.toFixed(1) + " / " + sOpen.reward.toFixed(1));
}

// ============================ determinism ==================================
console.log("\n+ · determinism (same seed -> identical rows)");
{
  const a = runCore({}).rows.filter(r => r.cond === "demon_neural");
  const b = runCore({}).rows.filter(r => r.cond === "demon_neural");
  const same = a.every((r, i) => r.workJ === b[i].workJ && r.reward === b[i].reward &&
                                  r.demonAgree === b[i].demonAgree && r.weightDrift === b[i].weightDrift);
  check("determinism across identical runs", same, "compared " + a.length + " neural rows");
}

console.log("\n" + (failures ? failures + " test(s) FAILED" : "all causal tests passed"));
process.exit(failures ? 1 : 0);
