/**
 * _smoke_exp14w.js — run the REAL experiment_worker.js with the new
 * E9/E10/E11 apparatus experiments inside Node. Verifies: registry entries,
 * progress messages, app_state streaming (3D live state), done payload with
 * conditions/curve/provenance, and that E1 still runs unchanged.
 */
"use strict";
const fs = require("fs");

const messages = [];
global.self = { onmessage: null };
global.postMessage = (m) => messages.push(m);
global.XMLHttpRequest = class {
  open(m, u) { this.url = u; }
  send() { this.status = 200; this.responseText = fs.readFileSync(this.url, "utf8"); }
};
global.atob = (s) => Buffer.from(s, "base64").toString("binary");
global.btoa = (s) => Buffer.from(s, "binary").toString("base64");

const code = fs.readFileSync("experiment_worker.js", "utf8");
new Function("self", "postMessage", "XMLHttpRequest", "atob", "btoa", code + "\n//# sourceURL=experiment_worker.js")(
  global.self, global.postMessage, global.XMLHttpRequest, global.atob, global.btoa);

const emit = (m) => { global.self.onmessage({ data: m }); };

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) fails++;
};

// helper: run one experiment and collect its messages
function run(expId, opts) {
  const from = messages.length;
  emit({ type: "run", expId, circuit: null, opts: opts || {} });
  const out = messages.slice(from);
  const prog = out.filter(m => m.type === "progress");
  const done = out.find(m => m.type === "done" && m.expId === expId);
  const errs = out.filter(m => m.type === "error" && m.expId === expId);
  return { prog, done, errs, appStates: out.filter(m => m.type === "app_state") };
}

// ---- E9 · Pressure Demon ----------------------------------------------------
{
  const r = run("e9");
  check("E9 no errors", r.errs.length === 0, r.errs[0] && r.errs[0].message.slice(0, 90));
  check("E9 done with 3 conditions", r.done && Object.keys(r.done.summary.conditions).length === 3,
        r.done && Object.keys(r.done.summary.conditions).join(","));
  check("E9 progress streamed", r.prog.length >= 3, r.prog.length + " progress msgs");
  check("E9 app_state (3D live) streamed", r.appStates.length > 20, r.appStates.length + " states");
  const st = r.appStates[r.appStates.length - 1].state;
  check("E9 live state has piston+valve", st.kind === "pressure" &&
        Number.isFinite(st.piston) && Number.isFinite(st.valve), "piston " + (st.piston | 0) + " valve " + (+st.valve).toFixed(2));
  const demon = r.done.summary.conditions.demon_speed;
  const never = r.done.summary.conditions.never_open;
  check("E9 demon beats never-open on dT", demon.summary.testDT.mean > never.summary.testDT.mean,
        demon.summary.testDT.mean.toFixed(0) + " vs " + never.summary.testDT.mean.toFixed(0));
  check("E9 provenance marks apparatus", r.done.provenance.apparatus === "pressure");
}

// ---- E10 · Smoluchowski Trapdoor ---------------------------------------------
{
  const r = run("e10");
  check("E10 no errors", r.errs.length === 0, r.errs[0] && r.errs[0].message.slice(0, 90));
  check("E10 done with light+heavy", r.done && !!r.done.summary.conditions.trapdoor_light
        && !!r.done.summary.conditions.trapdoor_heavy);
  const light = r.done.summary.conditions.trapdoor_light.summary.testOpenFraction.mean;
  const heavy = r.done.summary.conditions.trapdoor_heavy.summary.testOpenFraction.mean;
  check("E10 light door passes more than heavy", light > heavy, light.toFixed(2) + " vs " + heavy.toFixed(2) + " crossings/s");
  const lr = r.appStates.filter(m => m.state.crossLR > 0).length;
  check("E10 door actually lets molecules through", r.appStates.length > 20 && lr > 0,
        r.appStates.length + " states, " + lr + " with crossings");
}

// ---- E11 · Feynman Ratchet ----------------------------------------------------
{
  const r = run("e11");
  check("E11 no errors", r.errs.length === 0, r.errs[0] && r.errs[0].message.slice(0, 90));
  check("E11 done with 3 variants", r.done && Object.keys(r.done.summary.conditions).length === 3,
        r.done && Object.keys(r.done.summary.conditions).join(","));
  const grad = r.done.summary.conditions.ratchet_gradient.summary.testDT.mean;
  const eq = r.done.summary.conditions.ratchet_equilibrium.summary.testDT.mean;
  check("E11 gradient rotates, equilibrium ~0", Math.abs(grad) > 5 && Math.abs(eq) < Math.abs(grad) * 0.3,
        "grad " + grad.toFixed(1) + " rad/s, eq " + eq.toFixed(1));
  check("E11 ratchet live state streams", r.appStates.some(m => m.state.kind === "ratchet" && Number.isFinite(m.state.ang)));
}

// ---- E1 regression (unchanged path) -------------------------------------------
{
  const r = run("e1", { train: 6, test: 2, episode: 4 });
  check("E1 still runs unchanged", r.errs.length === 0 && !!r.done && r.done.rows.length > 0,
        r.done && r.done.rows.length + " rows");
}

console.log("----\n" + (fails ? "FAIL " + fails : "ALL PASS"));
process.exit(fails ? 1 : 0);
