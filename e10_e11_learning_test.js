/**
 * e10_e11_learning_test.js — causal chain tests for the E10 (Smoluchowski
 * trapdoor) and E11 (Feynman ratchet) closed loops, mirroring the E9 test
 * conventions.
 *
 *   E10  M  neural gate action (hold/release) -> door physics -> crossings
 *        S  sensor audit: 8 derived channels, in range, no future info
 *        B  physical outcome (sorted crossings) -> reward components
 *        C  reward -> dopamine -> plasticity (weights move only in TRAIN)
 *        T  TEST phase frozen: brain identical, weights unchanged
 *   E11  N  neural pawl action (lift/engage) -> hop physics -> rotation
 *        S  sensor audit (same contract)
 *        B  physical outcome (signed work) -> reward components
 *        C  reward -> dopamine -> plasticity (weights move only in TRAIN)
 *        T  TEST phase frozen: brain identical, weights unchanged
 *   E11  Q  detailed-balance equilibrium: no brain can extract positive work
 *        from a single bath (signed work <= 0 for physics, learning and
 *        frozen brains alike)
 *        + determinism: same seed -> identical rows
 *
 * Run: node e10_e11_learning_test.js
 */
"use strict";
const { smoluchowskiCore, feynmanRatchetCore, makeRng } = require("./experiment_core.js");
const { connectomeController } = require("./controllers.js");
const circuit = require("./fly_brain_circuit.json");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) failures++;
}
const factory = () => connectomeController(circuit, {
  shuffle: false, rng: makeRng(9176), seed: 1, opticDrive: 0, motorDrive: 0.6, plasticity: "full",
  eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
  policyGradient: true, pgRng: makeRng(424243),
});

// ======================= E10 · Smoluchowski trapdoor ========================
console.log("\nE10-M · neural gate action changes the door physics");
{
  // Same gas, same seed, only the brain's held action differs. Action codes:
  // 1 = door.hold=1 (flap PINNED shut), 0 = door.hold=0 (spring flap free).
  // The forced action is injected through the core's real PG-sampling path
  // (lastPgAction is read AFTER brain.step), so the actuator->physics link
  // under test is the production one.
  function runWithAction(action) {
    const rows = [];
    smoluchowskiCore({
      seed: 3, trials: 2, trainTrials: 2, episodeSeconds: 12, nParticles: 220,
      variants: ["trapdoor_neural"],
      brainFactory: () => {
        const brain = factory();
        brain.lastPgAction = () => action;   // force through the core's path
        return brain;
      },
      onTrialData: (c, p, r) => rows.push(r),
    });
    return rows.reduce((a, r) => a + r.crossings, 0);
  }
  const pinned = runWithAction(1), free = runWithAction(0);
  check("E10-M.i forced-HOLD pins the flap (zero crossings)",
        pinned === 0, "pinned " + pinned);
  check("E10-M.i2 forced-RELEASE lets molecules cross",
        free > 10, "free " + free);
  // (ii) brain-driven run: the gate actuates at all (hold fraction leaves 0)
  const rows = [];
  smoluchowskiCore({
    seed: 5, trials: 4, trainTrials: 4, episodeSeconds: 12, nParticles: 220,
    brainFactory: factory,
    onTrialData: (c, p, r) => rows.push(r),
  });
  const neural = rows.filter(r => r.condition === "trapdoor_neural");
  const holds = neural.map(r => r.holdFraction);
  check("E10-M.ii neural gate actuates (hold fraction varies, 0 < f <= 1)",
        holds.every(f => f > 0 && f <= 1) && Math.min(...holds) < 0.95,
        "hold fractions " + holds.map(f => f.toFixed(2)).join(","));
}

console.log("\nE10-S · sensors are physically derived and in range");
{
  const seen = [];
  smoluchowskiCore({
    seed: 11, trials: 1, trainTrials: 1, episodeSeconds: 8, nParticles: 220,
    brainFactory: () => {
      const brain = factory();
      const orig = brain.observe.bind(brain);
      brain.observe = (env) => { seen.push(env.readSensors()); return orig(env); };
      return brain;
    },
  });
  // event-locked decisions expose 10 channels (2 learned-contrast channels
  // appended); clock mode still returns the legacy 8. All values in range.
  // Event mode fires only on approach-box entries (~3-4/s), so dozens of
  // samples per 8 s episode is the expected regime.
  const ok = seen.length > 10 && seen.every(s =>
    (s.length === 8 || s.length === 10) &&
    s.every(v => isFinite(v) && v >= -1.01 && v <= 1.01));
  check("E10-S.i all channels in [-1,1] every decision (8 legacy / 10 event)", ok,
        seen.length + " samples, " + seen[0].length + " ch");
  // channel 6 (hold) is the brain's own actuator state, channels 0-2 count
  // molecules in the approach box: at least one sample must show molecules
  const seesMolecules = seen.some(s => s[0] > 0 || s[1] > 0 || s[2] > 0);
  check("E10-S.ii approach-box channels respond to real molecules", seesMolecules);
  // learned-contrast channels (event mode): approaching-molecule channels
  // must fire on real visitors (not hard-wired, not dead)
  const ch8Live = seen.some(s => s[8] > 0), ch9Live = seen.some(s => s[9] > 0);
  check("E10-S.iii event channels (visitors, fastVisitors) respond", ch8Live && ch9Live);
}

console.log("\nE10-B · physical outcome -> reward");
{
  const rows = [];
  smoluchowskiCore({
    seed: 5, trials: 4, trainTrials: 4, episodeSeconds: 12, nParticles: 220,
    brainFactory: factory,
    onTrialData: (c, p, r) => rows.push(r),
  });
  const neural = rows.filter(r => r.condition === "trapdoor_neural");
  // Reward bookkeeping identity: every episode's selection reward must equal
  // wSelect*(sorted) - 1.5*wSelect*(leaked) — crossings priced exactly as
  // E10_REWARD_DOC promises.
  const doc = neural.every(r =>
    Math.abs(r.rewardSelection - (0.3 * r.crossLR - 0.45 * r.crossRL)) < 1e-9);
  check("E10-B.i crossing reward = wSelect*(sorted) - 1.5*wSelect*(leaks)",
        doc, neural.map(r => r.rewardSelection.toFixed(1)).join(","));
  // Forced-RELEASE run: the flap is free, so R->L leaks MUST occur, and the
  // 1.5x leak cost must actually be paid in the bookkeeping.
  const leakRows = [];
  smoluchowskiCore({
    seed: 7, trials: 2, trainTrials: 2, episodeSeconds: 12, nParticles: 220,
    variants: ["trapdoor_neural"],
    brainFactory: () => {
      const brain = factory();
      brain.lastPgAction = () => 0;        // never hold -> free flap -> leaks
      return brain;
    },
    onTrialData: (c, p, r) => leakRows.push(r),
  });
  const leakEp = leakRows.find(r => r.crossRL > 0);
  check("E10-B.ii forced-release leaks R->L and pays the 1.5x cost",
        !!leakEp && leakEp.rewardSelection < 0.3 * leakEp.crossLR &&
        Math.abs(leakEp.rewardSelection -
          (0.3 * leakEp.crossLR - 0.45 * leakEp.crossRL)) < 1e-9,
        leakEp ? "lr " + leakEp.crossLR + " rl " + leakEp.crossRL +
                 " sel " + leakEp.rewardSelection.toFixed(2) : "no leak episode");
}

console.log("\nE10-C/T · reward -> plasticity -> frozen TEST");
{
  const rows = [];
  smoluchowskiCore({
    seed: 5, trials: 8, trainTrials: 4, episodeSeconds: 12, nParticles: 220,
    brainFactory: factory,
    onTrialData: (c, p, r) => rows.push(r),
  });
  const neural = rows.filter(r => r.condition === "trapdoor_neural");
  const frozen = rows.filter(r => r.condition === "trapdoor_frozen");
  const nTrainW = neural.slice(0, 4).map(r => r.weightDrift);
  const nTestW = neural.slice(4).map(r => r.weightDrift);
  const fTrainW = frozen.slice(0, 4).map(r => r.weightDrift);
  const grows = nTrainW[3] >= nTrainW[0];
  const frozenFlat = fTrainW.every(w => w === 0);
  check("E10-C.i weights move in TRAIN (non-decreasing drift)", grows,
        "drift " + nTrainW.map(w => w.toExponential(1)).join(" -> "));
  check("E10-C.ii frozen control never moves weights", frozenFlat,
        "drifts " + fTrainW.map(w => w.toExponential(1)).join(","));
  check("E10-T.i TEST freezes: no weight growth after trainTrials",
        nTestW.every(w => w === nTrainW[3]),
        "test drifts " + nTestW.map(w => w.toExponential(1)).join(","));
}

// ======================= E11 · Feynman ratchet ==============================
console.log("\nE11-N · neural pawl action changes the hop physics");
{
  // Same bath, same seed, only the brain's pawl decision differs. The pawl
  // does NOT clamp the wheel: engagement RAISES every hop's energy barrier
  // (bath cost + EPS), so detailed balance predicts total hop rate
  // x exp(-EPS) = 0.905 in BOTH directions, and the wheel back-drives in
  // either state (no policy can rectify an equilibrium bath).
  function runWithAction(action) {
    const rows = [];
    feynmanRatchetCore({
      seed: 3, trials: 2, trainTrials: 2, episodeSeconds: 12,
      variants: ["ratchet_neural"],
      brainFactory: () => {
        const brain = factory();
        brain.lastPgAction = () => action;   // force through the core's path
        return brain;
      },
      onTrialData: (c, p, r) => rows.push(r),
    });
    return rows[0];
  }
  const engaged = runWithAction(1), lifted = runWithAction(0);
  const hopRatio = (engaged.forwardSteps + engaged.reverseSteps) /
                   (lifted.forwardSteps + lifted.reverseSteps);
  check("E11-N.i engaged/lifted hop-rate ratio = exp(-EPS) (detailed balance)",
        Math.abs(hopRatio - Math.exp(-0.10)) < 0.08,
        "ratio " + hopRatio.toFixed(3) + " vs " + Math.exp(-0.10).toFixed(3));
  check("E11-N.ii wheel back-drives in BOTH pawl states (no free rectification)",
        lifted.reverseSteps > 0 && engaged.reverseSteps > 0,
        "rev lifted " + lifted.reverseSteps + " engaged " + engaged.reverseSteps);
  // (iii) brain-driven run actuates at all
  const rows = [];
  feynmanRatchetCore({
    seed: 5, trials: 3, trainTrials: 3, episodeSeconds: 12,
    brainFactory: factory,
    onTrialData: (c, p, r) => rows.push(r),
  });
  const neural = rows.filter(r => r.condition === "ratchet_neural");
  const liftF = neural.map(r => r.liftFraction);
  check("E11-N.iii neural pawl actuates (0 < lift fraction < 1)",
        liftF.every(f => f > 0 && f < 1),
        "lift fractions " + liftF.map(f => f.toFixed(2)).join(","));
}

console.log("\nE11-S · sensors are physically derived and in range");
{
  const seen = [];
  feynmanRatchetCore({
    seed: 11, trials: 1, trainTrials: 1, episodeSeconds: 8,
    brainFactory: () => {
      const brain = factory();
      const orig = brain.observe.bind(brain);
      brain.observe = (env) => { seen.push(env.readSensors()); return orig(env); };
      return brain;
    },
  });
  const ok = seen.length > 30 && seen.every(s => s.length === 8 && s.every(v => v >= -1.01 && v <= 1.01));
  check("E11-S.i all 8 channels in [-1,1] every decision", ok,
        seen.length + " samples");
  // hot/cold bath channels (5, 6) must match the variant's temperatures
  const tOk = seen.every(s => Math.abs(s[5] - 0.5) < 1e-9 && Math.abs(s[6] - 0.5) < 1e-9);
  check("E11-S.ii bath-temperature channels report Th = Tc = 1 (equilibrium)", tOk);
}

console.log("\nE11-B · physical outcome (signed work) -> reward");
{
  const rows = [];
  feynmanRatchetCore({
    seed: 5, trials: 6, trainTrials: 6, episodeSeconds: 12,
    brainFactory: factory,
    onTrialData: (c, p, r) => rows.push(r),
  });
  const neural = rows.filter(r => r.condition === "ratchet_neural");
  // signed work must equal netRotation * load (no clamp can hide losses)
  const signedOk = neural.every(r =>
    Math.abs(r.workJEp - r.netPerEpisode * r.torque * 1e-21) < 1e-25);
  check("E11-B.i signed work = netRotation x load (honest accounting)", signedOk);
  // hop rewards sum to wStep*fwd - 1.5*wStep*rev (the documented contract)
  const hopOk = neural.every(r =>
    Math.abs(r.rewardSelection -
      (0.3 * r.forwardSteps - 0.45 * r.reverseSteps)) < 1e-9);
  check("E11-B.ii hop reward = wStep*fwd - 1.5*wStep*rev", hopOk,
        "ep1 hop reward " + (neural[0] ? neural[0].rewardSelection.toFixed(1) : "-") +
        " vs hops " + (neural[0] ? (neural[0].forwardSteps - neural[0].reverseSteps) : "-"));
}

console.log("\nE11-C/T · reward -> plasticity -> frozen TEST");
{
  const rows = [];
  feynmanRatchetCore({
    seed: 5, trials: 8, trainTrials: 4, episodeSeconds: 12,
    brainFactory: factory,
    onTrialData: (c, p, r) => rows.push(r),
  });
  const neural = rows.filter(r => r.condition === "ratchet_neural");
  const frozen = rows.filter(r => r.condition === "ratchet_frozen");
  const nTrainW = neural.slice(0, 4).map(r => r.weightDrift);
  const nTestW = neural.slice(4).map(r => r.weightDrift);
  const fTrainW = frozen.slice(0, 4).map(r => r.weightDrift);
  const moves = Math.max(...nTrainW) > 0;
  const frozenFlat = fTrainW.every(w => w === 0);
  check("E11-C.i weights move in TRAIN (drift > 0)", moves,
        "drift " + nTrainW.map(w => w.toExponential(1)).join(" -> "));
  check("E11-C.ii frozen control never moves weights", frozenFlat,
        "drifts " + fTrainW.map(w => w.toExponential(1)).join(","));
  check("E11-T.i TEST freezes: no weight growth after trainTrials",
        nTestW.every(w => w === nTrainW[3]),
        "test drifts " + nTestW.map(w => w.toExponential(1)).join(","));
}

console.log("\nE11-Q · equilibrium second-law audit (no brain, no tuning)");
{
  // Th = Tc: for EVERY policy (physics default, learning brain, frozen brain)
  // the signed work must not be positive. The rates obey detailed balance
  // with an explicit barrier, so any persistent positive extraction would be
  // a physics bug, not a learning result.
  const phys = feynmanRatchetCore({ seed: 21, trials: 8, episodeSeconds: 16 });
  const pEq = phys.conditions.ratchet_equilibrium.summary;
  check("E11-Q.i equilibrium physics never extracts positive work",
        pEq.testWorkJ.mean <= 0,
        "signed work/ep " + pEq.testWorkJ.mean.toExponential(2) + " J");
  const grad = phys.conditions.ratchet_gradient.summary;
  check("E11-Q.ii Th > Tc still extracts positive work",
        grad.testWorkJ.mean > 0,
        "signed work/ep " + grad.testWorkJ.mean.toExponential(2) + " J");

  const rowsEq = [], rowsFrozen = [];
  feynmanRatchetCore({
    seed: 21, trials: 8, trainTrials: 8, episodeSeconds: 16,
    variants: ["ratchet_neural"],
    brainFactory: factory,
    onTrialData: (c, p, r) => rowsEq.push(r),
  });
  feynmanRatchetCore({
    seed: 21, trials: 8, trainTrials: 0, episodeSeconds: 16,
    variants: ["ratchet_frozen"],
    brainFactory: factory,
    onTrialData: (c, p, r) => rowsFrozen.push(r),
  });
  const wEq = rowsEq.map(r => r.workJEp);
  const wFr = rowsFrozen.map(r => r.workJEp);
  check("E11-Q.iii learning brain cannot extract positive work at equilibrium",
        wEq.every(w => w <= 0) || wEq.reduce((a, b) => a + b, 0) <= 0,
        "signed work/ep " + (wEq.reduce((a, b) => a + b, 0) / wEq.length).toExponential(2) + " J");
  check("E11-Q.iv frozen brain cannot extract positive work at equilibrium",
        wFr.reduce((a, b) => a + b, 0) <= 0,
        "signed work/ep " + (wFr.reduce((a, b) => a + b, 0) / wFr.length).toExponential(2) + " J");
}

console.log("\nDET · determinism: same seed -> identical rows");
{
  function runOnce() {
    const rows = [];
    smoluchowskiCore({
      seed: 42, trials: 2, trainTrials: 1, episodeSeconds: 10, nParticles: 220,
      brainFactory: factory,
      onTrialData: (c, p, r) => rows.push([c, p, r.reward, r.crossLR, r.crossRL, r.weightDrift]),
    });
    feynmanRatchetCore({
      seed: 42, trials: 2, trainTrials: 1, episodeSeconds: 10,
      brainFactory: factory,
      onTrialData: (c, p, r) => rows.push([c, p, r.reward, r.forwardSteps, r.reverseSteps, r.weightDrift]),
    });
    return JSON.stringify(rows);
  }
  check("DET.i identical trajectories for identical seeds", runOnce() === runOnce());
}

console.log("\n" + (failures ? failures + " FAILURE(S)" : "ALL TESTS PASS"));
process.exit(failures ? 1 : 0);
