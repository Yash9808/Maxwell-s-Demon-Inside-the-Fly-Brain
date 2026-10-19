"use strict";
/**
 * e3r2_wrapper.js — E3R2 reward-shaping wrapper (purely additive; R2 study).
 *
 * WRAPS the unmodified drosophilaController. Nothing in the network, the
 * physics (experiment_core.js), or the existing controller library
 * (controllers.js) is touched — that file currently carries a collaborator's
 * uncommitted changes, so this study adds new files instead of editing it.
 *
 * R1 diagnosis (VALIDATION_REPORT.md / raw_e3.csv):
 *   The door-avoidance collapse has two compounding causes:
 *   (1) SILENCE — a closed door generates zero crossing events, so the only
 *       learning channel (env.onCrossing -> controller.receiveFeedback) is
 *       dead in the collapsed state; the race-contrast escape gradient in the
 *       brain never fires.
 *   (2) VALUE ASYMMETRY — P(good) < 0.5 for every unselective policy
 *       (random P=0.383, frozen P=0.403, classical P=0.492), so
 *       E[fb | open] < E[fb | closed] = 0 and closing is optimal even for
 *       engaged policies below classical selectivity.
 *
 * R2 arms (PRE_REGISTERED_CRITERIA_E3R2.json):
 *   R2A_cost  — calibrated closed-door dwell cost: synthetic punishment
 *               events {good:false, kind:"dwell_cost"} delivered from step()
 *               (NOT from receiveFeedback — that callback never fires in the
 *               collapsed state, which is the bug being fixed) at rate
 *               kappa=0.005 events/step while door.target===0 during TRAIN.
 *               Real crossing feedback is forwarded UNCHANGED (centered
 *               shaping: flapping is not made attractive, silence is made
 *               costly).
 *   R2B_floor — mechanism ablation: no dwell cost; during TRAIN each step the
 *               wrapper forces door.target=1 with probability floorP=0.05
 *               AFTER the brain's own decision (actuation overlay). Tests
 *               whether mere feedback access suffices.
 *   off       — pass-through (used for verification against R1 rows).
 *
 * Identity used by the analysis: with plasticity off, the brain's
 * receiveFeedback returns immediately, so an R2A-mode wrapper around a
 * plasticity-off brain is trajectory-identical to the bare frozen controller
 * (verified by a spot check in e3r2_campaign.js). The R2B overlay DOES
 * actuate a frozen brain, so the R2B frozen control is run for real.
 */
"use strict";

const CTRL = require("./controllers");

/** PRE-REGISTERED constants (PRE_REGISTERED_CRITERIA_E3R2.json). */
const KAPPA = 0.005;    // dwell-punishment event rate, per step
const FLOOR_P = 0.05;   // forced-open probability per TRAIN step (R2B)

/** Deterministic threshold scheduler: fires exactly at rate accumulation 1. */
function EventTimer(acc0) { this.acc = acc0; }
EventTimer.prototype.fire = function (rate) {
  this.acc += rate;
  if (this.acc >= 1) { this.acc -= 1; return 1; }
  return 0;
};

/**
 * Wrap an inner E3 door-task controller factory.
 * @param {"off"|"R2A_cost"|"R2B_floor"} mode
 * @param {function} innerFactory e.g. CTRL.drosophilaController
 * @param {object} [o] { kappa, floorP, forceNoLearn }
 */
function e3r2Wrap(mode, innerFactory, o) {
  if (!["off", "R2A_cost", "R2B_floor"].includes(mode)) {
    throw new Error("e3r2Wrap: unknown mode " + mode);
  }
  o = o || {};
  const kappa  = mode === "R2A_cost" ? (o.kappa  !== undefined ? o.kappa  : KAPPA) : 0;
  const floorP = mode === "R2B_floor" ? (o.floorP !== undefined ? o.floorP : FLOOR_P) : 0;
  const forceNoLearn = !!o.forceNoLearn;
  return function wrappedFactory(rng, env, cfg) {
    const inner = innerFactory(rng, env, cfg);
    const timer = new EventTimer(0.5);   // first dwell event after ~100 closed steps
    let phaseTrain = true;               // set by the trial loop via setLearning
    let steps = 0, dwellEvents = 0, forcedOpenSteps = 0;
    const api = {
      name: "drosophila_e3r2_" + mode + (forceNoLearn ? "_frozen" : ""),
      observe(x) { inner.observe(x); },
      step(dt, e) {
        inner.step(dt, e);
        if (phaseTrain && mode === "R2B_floor" && rng() < floorP) {
          e.door.target = 1;             // actuation overlay; brain untouched
          forcedOpenSteps++;
        }
        if (phaseTrain && mode === "R2A_cost" && e.door.target === 0) {
          if (timer.fire(kappa)) {
            dwellEvents++;
            inner.receiveFeedback({ good: false, kind: "dwell_cost" });
          }
        }
        steps++;
      },
      receiveFeedback(fb) {
        // Real crossing feedback forwarded UNCHANGED in every mode.
        inner.receiveFeedback(fb);
      },
      setLearning(on) {
        phaseTrain = on;
        if (inner.setLearning) inner.setLearning(forceNoLearn ? false : on);
      },
      resetForTrial() {
        timer.acc = 0.5; steps = 0; dwellEvents = 0; forcedOpenSteps = 0;
        if (inner.resetForTrial) inner.resetForTrial();
      },
      summary() {
        const s = inner.summary ? Object.assign({}, inner.summary()) : {};
        s.dwellCostEvents = dwellEvents;
        s.forcedOpenSteps = forcedOpenSteps;
        s.e3r2Mode = mode;
        s.e3r2Steps = steps;
        return s;
      },
    };
    if (inner.layerSpikeRates) api.layerSpikeRates = () => inner.layerSpikeRates();
    if (inner.fireVec) api.fireVec = () => inner.fireVec();
    if (inner.neuralActivity) api.neuralActivity = () => inner.neuralActivity();
    if (inner.particleSample) api.particleSample = (e2) => inner.particleSample(e2);
    return api;
  };
}

module.exports = { e3r2Wrap, EventTimer, KAPPA, FLOOR_P };
