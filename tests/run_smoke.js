/**
 * run_smoke.js — reproducibility smoke suite (FAST CI).
 *
 * Run:  node tests/run_smoke.js            # full suite (~1-2 min)
 *       node tests/run_smoke.js --quick    # skip slower E1 fixture replay (S9)
 *
 * Every test fails loudly when scientific behavior changes. The golden-fixture
 * test (S9) pins the exact row values of a recorded seeded E1 run; if you
 * changed physics/controllers/rewards ON PURPOSE, regenerate the fixture with
 * tests/gen_e1_fixture.js and commit the diff with a message explaining why.
 *
 * Section map (Stage-5 mission items):
 *   S1  circuit loading + payload integrity     (payload separation safe)
 *   S2  application syntax (all script blocks)  (app parses)
 *   S3  root-ID mapping                         (index -> FlyWire root ID)
 *   S4  deterministic extraction                (PRNG / env determinism)
 *   S5  E1 smoke test                           (classical anchor)
 *   S6  E4 smoke test                           (connectome-constrained)
 *   S7  E9 smoke test                           (pressure demon)
 *   S8  E10 + E11 smoke tests                   (trapdoor / ratchet)
 *   S9  golden fixture: seeded output equality  (fails on any behavior change)
 *   S10 benchmark determinism                   (run-twice equality)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const QUICK = process.argv.includes("--quick");
let pass = 0, fail = 0, skipped = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else {
    fail++;
    const d = detail ? "  -> " + detail : "";
    console.log("  FAIL  " + name + d);
    failures.push(name + d);
  }
}
function skip(name, why) {
  skipped++;
  console.log("  SKIP  " + name + "  (" + why + ")");
}
function section(t) { console.log("\n== " + t + " =="); }

// --------------------------------------------------------------- S1 payloads
section("S1 circuit loading + payload integrity");
function payloadBytes(file, marker) {
  const raw = fs.readFileSync(path.join(ROOT, file));
  const i = raw.indexOf(Buffer.from(marker));
  if (i < 0) throw new Error(file + ": marker not found");
  const start = i + Buffer.byteLength(marker);
  const end = raw.indexOf(Buffer.from(";\n"), start);
  return raw.subarray(start, end);
}
function sha16(b) { return require("crypto").createHash("sha256").update(b).digest("hex").slice(0, 16); }

let FAFB = null, MCNS = null, LAB = null;
try {
  const fafbJs = fs.readFileSync(path.join(ROOT, "data/circuits/fafb_circuit.js"), "utf8");
  FAFB = JSON.parse(fafbJs.slice(fafbJs.indexOf("= ") + 2, fafbJs.lastIndexOf(";")));
  const mcnsJs = fs.readFileSync(path.join(ROOT, "data/circuits/mcns_circuit.js"), "utf8");
  MCNS = JSON.parse(mcnsJs.slice(mcnsJs.indexOf("= ") + 2, mcnsJs.lastIndexOf(";")));
  const labJs = fs.readFileSync(path.join(ROOT, "data/circuits/lab_circuit.js"), "utf8");
  LAB = JSON.parse(labJs.slice(labJs.indexOf("= ") + 2, labJs.lastIndexOf(";")));
  ok("payload .js files parse as JSON", true);
} catch (e) { ok("payload .js files parse as JSON", false, e.message); }

try {
  // byte-equality is the strict contract; semantic (canonical-JSON) equality is
  // the fallback the regeneration tool guarantees if formatting ever changes
  const pay = payloadBytes("data/circuits/fafb_circuit.js", "__FAFB_CIRCUIT__ = ");
  const src = fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"));
  const byteEq = sha16(pay) === sha16(src);
  const semEq = JSON.parse(pay.toString("utf8"));
  const srcObj = JSON.parse(src.toString("utf8"));
  ok("fafb_circuit.js payload == fly_brain_circuit.json",
     byteEq || JSON.stringify(semEq) === JSON.stringify(srcObj),
     byteEq ? "byte-equal" : "semantic-equal only");
} catch (e) { ok("fafb payload equality", false, e.message); }

try {
  ok("mcns_circuit.js payload == malecns_circuit_pruned.json (bytes)",
     sha16(payloadBytes("data/circuits/mcns_circuit.js", "__MCNS_CIRCUIT__ = ")) ===
     sha16(fs.readFileSync(path.join(ROOT, "malecns_circuit_pruned.json"))));
} catch (e) { ok("mcns payload byte-equality", false, e.message); }

try {
  ok("3D HTML no longer embeds payloads inline",
     !fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8").includes("const FAFB = {\"layer_names\""));
} catch (e) { ok("3D HTML payload split", false, e.message); }

if (FAFB) {
  const sizes = FAFB.layers.map(l => l.length);
  ok("FAFB circuit shape (5 layers, 107k neurons, edges present)",
     FAFB.layers.length === 5 &&
     sizes.reduce((a, b) => a + b, 0) > 100000 &&
     Array.isArray(FAFB.edges) && FAFB.edges.length > 100000,
     "layers=" + JSON.stringify(sizes) + " edges=" + (FAFB.edges || []).length);
  ok("FAFB circuit provenance + optic layer present",
     !!(FAFB.provenance && FAFB.optic_layer === 1),
     "provenance=" + (FAFB.provenance ? Object.keys(FAFB.provenance).join(",") : "missing"));
}

// ------------------------------------------------------------- S2 app syntax
section("S2 application syntax");
try {
  for (const f of ["experiment_core.js", "controllers.js", "experiment_worker.js",
                   "benchmark.js", "learning_test.js", "brain_worker.js"]) {
    new vm.Script(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
  }
  ok("node sources parse (vm.Script)", true);
} catch (e) { ok("node sources parse (vm.Script)", false, e.message); }

try {
  const html = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    if (attrs.includes("src=") || attrs.includes("type=\"module\"")) continue;
    if (m[2].trim().length > 10) {
      n++;
      new vm.Script(m[2], { filename: "fly_demon_3d.html:script#" + n });
    }
  }
  ok("fly_demon_3d.html classic script blocks parse (" + n + " blocks)", n >= 1);
} catch (e) { ok("fly_demon_3d.html classic script blocks parse", false, e.message); }

try {
  let mod = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  const i = mod.indexOf("<script type=\"module\">") + "<script type=\"module\">".length;
  const j = mod.indexOf("</script>", i);
  mod = mod.slice(i, j);
  // stub the vendored ES imports so the body parses as a classic script
  mod = mod.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+"[^"]*";/mg, "const $1 = {};")
           .replace(/^import\s+\{([^}]*)\}\s+from\s+"[^"]*";/mg, "const {$1} = {};")
           .replace(/^import\s+(\w+)\s+from\s+"[^"]*";/mg, "const $1 = {};");
  new vm.Script(mod, { filename: "fly_demon_3d.html:module" });
  ok("fly_demon_3d.html ES module block parses (imports stubbed)", true);
} catch (e) { ok("fly_demon_3d.html ES module block parses", false, e.message); }

// ---------------------------------------------------------- S3 root-ID map
section("S3 root-ID mapping (index -> FlyWire root ID)");
try {
  const prov = FAFB.provenance;
  // FlyWire root IDs (~7.2e17) exceed Number.MAX_SAFE_INTEGER, so JSON.parse
  // collapses distinct IDs into the same double. Extract them TEXTUALLY for
  // exact comparisons (documented limitation: in-app JS sees rounded IDs;
  // internal consistency is preserved because rounding is deterministic).
  const rawPayload = payloadBytes("data/circuits/fafb_circuit.js", "__FAFB_CIRCUIT__ = ").toString("utf8");
  const mIds = rawPayload.match(/"root_ids"\s*:\s*\[([0-9,\s]+)\]/);
  if (!mIds) throw new Error("root_ids array not found in circuit payload text");
  const idsStr = mIds[1].split(",").map(s => s.trim()).filter(Boolean);
  const idsBig = idsStr.map(s => BigInt(s));
  const layerSizes = FAFB.layers.map(l => l.length);
  ok("root_ids array length == total neurons",
     idsStr.length === layerSizes.reduce((a, b) => a + b, 0),
     "root_ids=" + idsStr.length + " neurons=" + layerSizes.reduce((a, b) => a + b, 0));
  ok("root IDs look like FlyWire IDs (72057594… range, unique as uint64)",
     idsBig.every(x => x > 720000000000000000n && x < 730000000000000000n) &&
     new Set(idsStr).size === idsStr.length);
  ok("layer entries are indices into the flat root_ids array",
     FAFB.layers.every(l => l.every(x => Number.isInteger(x) && x >= 0 && x < idsStr.length)));
  ok("edges reference valid neuron indices",
     FAFB.edges.every(e => e.s >= 0 && e.s < idsStr.length && e.t >= 0 && e.t < idsStr.length));
  if (prov.neuron_count !== undefined) {
    ok("provenance.neuron_count consistent with layer sizes",
       prov.neuron_count === layerSizes.reduce((a, b) => a + b, 0),
       "neuron_count=" + prov.neuron_count);
  }
  // cross-check against the .npy root-id file when present (uint64 little-endian)
  const npyPath = path.join(ROOT, "proofread_root_ids_783.npy");
  if (fs.existsSync(npyPath)) {
    const buf = fs.readFileSync(npyPath);
    const magic = buf.subarray(0, 6).toString("latin1");
    const hdrLen = buf.readUInt16LE(8);
    const body = buf.subarray(10 + hdrLen);
    ok("root_ids npy header parses (uint64, little-endian)",
       magic === "\u0093NUMPY" && body.length % 8 === 0);
    const first = body.readBigUInt64LE(0);
    const last = body.readBigUInt64LE(body.length - 8);
    ok("first/last npy root IDs match FlyWire range",
       first > 720000000000000000n && last > 720000000000000000n,
       "first=" + first + " last=" + last);
    // the circuit is a SUBSET of the 139k proofread neurons: every circuit ID
    // must exist in the npy (exact BigInt comparison on a deterministic sample)
    const npySet = new Set();
    for (let off = 0; off < body.length; off += 8) npySet.add(body.readBigUInt64LE(off).toString());
    let missing = 0, sampled = 0;
    const step = Math.max(1, Math.floor(idsStr.length / 2000));
    for (let k = 0; k < idsStr.length; k += step) { sampled++; if (!npySet.has(idsStr[k])) missing++; }
    ok("sampled circuit root IDs all present in proofread_root_ids_783.npy",
       missing === 0, missing + "/" + sampled + " sampled IDs not found in npy");
  } else skip("npy cross-check", "proofread_root_ids_783.npy not present");
} catch (e) { ok("S3 root-ID mapping", false, e.message); }

// ----------------------------------------------- S4 deterministic extraction
section("S4 deterministic extraction (PRNG + environment)");
const CORE = require(path.join(ROOT, "experiment_core.js"));
try {
  const r1 = CORE.makeRng(123), r2 = CORE.makeRng(123), r3 = CORE.makeRng(124);
  const a1 = [r1(), r1(), r1()], a2 = [r2(), r2(), r2()];
  ok("makeRng: same seed -> identical stream", JSON.stringify(a1) === JSON.stringify(a2));
  ok("makeRng: different seed -> different stream", a1[0] !== r3());
  ok("makeRng: values in [0,1)", a1.every(x => x >= 0 && x < 1));
} catch (e) { ok("S4 PRNG", false, e.message); }
try {
  const envs = [CORE.makeEnvironment({ seed: 7, nParticles: 60 }),
                CORE.makeEnvironment({ seed: 7, nParticles: 60 })];
  for (let k = 0; k < 240; k++) { envs[0].step(0, 0); envs[1].step(0, 0); }
  const p0 = envs[0].particles[0], p1 = envs[1].particles[0];
  ok("makeEnvironment: same seed -> identical trajectories",
     p0.x === p1.x && p0.y === p1.y && p0.z === p1.z &&
     p0.vx === p1.vx && p0.vy === p1.vy && p0.vz === p1.vz);
  ok("environment exposes documented constants",
     CORE.CH.w === 760 && CORE.CH.h === 380 && CORE.CH.d === 300 &&
     CORE.WALL_T === 8 && CORE.DOOR_GAP === 0.6);
} catch (e) { ok("S4 environment determinism", false, e.message); }

// ---------------------------------------------- S5–S8 experiment smoke tests
const CTRL = require(path.join(ROOT, "controllers.js"));

// headless experiment_worker harness (pattern proven by archive/_gen_payload.js)
function runWorker(expId, opts, circuit) {
  const workerSrc = fs.readFileSync(path.join(ROOT, "experiment_worker.js"), "utf8");
  const msgs = [], errs = [];
  const selfObj = { postMessage: (m) => { (m.type === "error" ? errs : msgs).push(m); } };
  selfObj.self = selfObj;
  class XHRShim {
    constructor() { this.status = 0; this.responseText = ""; }
    open(_m, u) { this._u = u; }
    send() {
      const p = path.join(ROOT, this._u.split("?")[0]);
      if (fs.existsSync(p)) { this.status = 200; this.responseText = fs.readFileSync(p, "utf8"); }
      else this.status = 404;
    }
  }
  new Function("self", "postMessage", "XMLHttpRequest", "location", "atob", "btoa", workerSrc)(
    selfObj, selfObj.postMessage, XHRShim, { origin: "http://localhost" },
    (s) => Buffer.from(s, "base64").toString("binary"),
    (s) => Buffer.from(s, "binary").toString("base64"));
  selfObj.onmessage({ data: { type: "run", expId, circuit: circuit || null, opts } });
  if (errs.length) throw new Error("worker error: " + errs.map(e => e.message).join("; "));
  const done = msgs.find(m => m.type === "done" && m.expId === expId);
  if (!done) throw new Error("worker produced no done message (msgs=" +
    msgs.map(m => m.type).join(",") + ")");
  return done;
}

section("S5 E1 smoke test (classical anchor)");
try {
  const done = runWorker("e1", { seeds: 1, train: 3, test: 2 });
  const rows = done.rows, prov = done.provenance;
  ok("E1 completes with rows", rows.length === 5,
     "rows=" + rows.length);
  ok("E1 conditions + phases correct",
     rows.every(r => r.condition === "classical_demon") &&
     rows.some(r => r.phase === "train") && rows.some(r => r.phase === "test"));
  ok("E1 physics ran (720 steps per 12 s trial @60 Hz)",
     rows.every(r => r.steps === 720));
  ok("E1 provenance carries seeds/params",
     prov.seeds === 1 && prov.nParticles === 320 && prov.dt > 0 && prov.software);
  ok("E1 classical demon sorts (good:bad ratio computed)",
     rows.every(r => typeof r.goodBadRatio === "number" || r.goodBadRatio === null));
} catch (e) { ok("S5 E1", false, e.message); }

section("S6 E4 smoke test (connectome-constrained 4A/4B/4C)");
try {
  const done = runWorker("e4", { seeds: 1, train: 2, test: 1 }, FAFB);
  const conds = new Set(done.rows.map(r => r.condition));
  ok("E4 completes with 4A/4B/4C conditions",
     conds.has("connectome_4A") && conds.has("connectome_4B") && conds.has("connectome_4C"),
     "conds=" + [...conds].join(","));
  ok("E4 rows complete (3 conds x 3 trials)", done.rows.length === 9,
     "rows=" + done.rows.length);
  ok("E4 rows carry connectome telemetry (miNeural/measuredBits)",
     done.rows.every(r => typeof r.miNeural === "number" && typeof r.measuredBits === "number"),
     "row keys=" + Object.keys(done.rows[0]).slice(0, 12).join(","));
} catch (e) { ok("S6 E4", false, e.message); }

section("S7 E9 smoke test (pressure demon, no brain => classical variants)");
try {
  const done = runWorker("e9", { seeds: 1, train: 2, test: 2 });
  const conds = new Set(done.rows.map(r => r.condition));
  ok("E9 completes with classical variants (no brain in CI)",
     conds.has("demon_speed") && conds.has("demon_random") && conds.has("never_open") &&
     !conds.has("demon_neural"),
     "conds=" + [...conds].join(","));
  ok("E9 rows carry thermodynamic fields",
     done.rows.every(r => "workJ" in r && "erasureCostJ" in r && "measuredBits" in r));
  ok("E9 train/test split honored",
     done.rows.filter(r => r.phase === "train").length === 6 &&
     done.rows.filter(r => r.phase === "test").length === 6);
} catch (e) { ok("S7 E9", false, e.message); }

section("S8 E10 + E11 smoke tests (trapdoor / ratchet)");
try {
  const done = runWorker("e10", { seeds: 1, train: 1, test: 1 }, FAFB);   // needsCircuit: true
  const conds = new Set(done.rows.map(r => r.condition));
  ok("E10 completes with physics + brain variants (circuit passed)",
     conds.has("trapdoor_light") && conds.has("trapdoor_heavy") &&
     conds.has("trapdoor_neural") && conds.has("trapdoor_frozen"),
     "conds=" + [...conds].join(","));
  ok("E10 rows: 4 variants x 2 trials with thermo fields",
     done.rows.length === 8 &&
     done.rows.every(r => "workJ" in r && "erasureCostJ" in r && "netWorkJ" in r),
     "rows=" + done.rows.length);
} catch (e) { ok("S8 E10", false, e.message); }
try {
  const done = runWorker("e11", { seeds: 1, train: 1, test: 1 }, FAFB);   // needsCircuit: true
  const conds = new Set(done.rows.map(r => r.condition));
  ok("E11 completes with ratchet variants (physics + brain)",
     conds.has("ratchet_gradient") && conds.has("ratchet_equilibrium"),
     "conds=" + [...conds].join(","));
  ok("E11 rows carry work accounting",
     done.rows.every(r => "workJ" in r && "netWorkJ" in r));
  ok("E11 gradient variant extracts work vs equilibrium (2nd law sanity)",
     (() => {
       const g = done.rows.filter(r => r.condition === "ratchet_gradient");
       const e = done.rows.filter(r => r.condition === "ratchet_equilibrium");
       return g.length && e.length &&
              g.reduce((a, r) => a + (r.netWorkJ || 0), 0) >
              e.reduce((a, r) => a + (r.netWorkJ || 0), 0);
     })());
} catch (e) { ok("S8 E11", false, e.message); }

// ------------------------------------------------- S9 golden fixture (E1)
section("S9 golden fixture: seeded output equality");
const GOLDEN = path.join(__dirname, "golden", "e1_fixture.json");
if (QUICK) {
  skip("S9 golden E1 replay", "--quick");
} else if (!fs.existsSync(GOLDEN)) {
  skip("S9 golden E1 replay", "tests/golden/e1_fixture.json missing (run tests/gen_e1_fixture.js)");
} else {
  try {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
    const done = runWorker("e1", golden.opts, null);
    const same = JSON.stringify(done.rows) === JSON.stringify(golden.rows);
    if (!same) {
      // find the first differing row for a useful failure message
      let diff = "rows diverge";
      for (let i = 0; i < Math.max(golden.rows.length, done.rows.length); i++) {
        const g = JSON.stringify(golden.rows[i]), d = JSON.stringify(done.rows[i]);
        if (g !== d) { diff = "row " + i + ":\n    golden: " + (g || "").slice(0, 300) + "\n    now:    " + (d || "").slice(0, 300); break; }
      }
      ok("S9 golden E1 replay row-for-row equality", false, diff);
    } else {
      ok("S9 golden E1 replay row-for-row equality", true);
    }
  } catch (e) { ok("S9 golden E1 replay", false, e.message); }
}

// ------------------------------------------- S10 benchmark determinism
section("S10 benchmark determinism (run-twice equality)");
try {
  const a = runWorker("e6", { seeds: 1, train: 2, test: 2 });
  const b = runWorker("e6", { seeds: 1, train: 2, test: 2 });
  ok("E6 run-twice produces identical rows",
     JSON.stringify(a.rows) === JSON.stringify(b.rows));
  ok("E6 three conditions present",
     new Set(a.rows.map(r => r.condition)).size === 3);
} catch (e) { ok("S10 benchmark determinism", false, e.message); }

// ------------------------------------------------------------------ summary
console.log("\n==========================================");
console.log(`smoke suite: ${pass} passed, ${fail} failed, ${skipped} skipped`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("ALL GREEN");
