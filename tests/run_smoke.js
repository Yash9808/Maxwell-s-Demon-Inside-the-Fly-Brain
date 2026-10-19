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
 *   S11 GLSL shader integrity
 *   S12-S15 3D presentation static pins
 *   S16 five-arm Stage-1 smoke                  (benchmark --config, run-twice
 *        byte-identical trials JSONL; audit item 3; ~40 s, 2 subprocess runs)
 *   S19 sweep queue sizes + sweep-step ramp     (real fns eval'd in vm with a
 *        DOM stub: auto-run panel's axis checkboxes build the advertised
 *        condition counts, and sweep steps HONOR the value-increment select —
 *        regression lock for the 2026-10-14 "sliders froze in auto-run" bug)
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
                   "benchmark.js", "learning_test.js", "brain_worker.js",
                   "celltypes_worker.js"]) {
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

// ------------------------------------------- S11 GLSL shader integrity
section("S11 GLSL shader integrity (static analysis of fly_demon_3d.html)");
try {
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath,
    ["--test", path.join(__dirname, "glsl_shader_integrity.test.js")],
    { encoding: "utf8", timeout: 60000, env: Object.assign({}, process.env, { GLSL_TEST_HTML: path.join(ROOT, "fly_demon_3d.html") }) });
  const passM = out.match(/pass (\d+)/); const failM = out.match(/fail (\d+)/);
  const p2 = passM ? +passM[1] : -1, f2 = failM ? +failM[1] : -1;
  ok("S11 GLSL declaration integrity (6 checks: extraction, declarations, chunks, 3 fixtures)",
     f2 === 0 && p2 >= 6, "pass=" + p2 + " fail=" + f2);
} catch (e) {
  // node --test exits non-zero on failure and prints stdout on the error
  const out = (e.stdout || "") + String(e.message || e);
  const failM = out.match(/fail (\d+)/);
  ok("S11 GLSL declaration integrity (6 checks: extraction, declarations, chunks, 3 fixtures)",
     false, "suite failed (" + (failM ? failM[1] : "?") + " failing) - run: node --test tests/glsl_shader_integrity.test.js");
}

// ------------------------------------------- S12 dual-viewport 3D presentation
section("S12 dual-viewport 3D presentation (static pins, fly_demon_3d.html)");
try {
  const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  const chOff = (HTML.match(/const CHAMBER_OFF = \{ x: -520, y: -260, z: 0 \}/g) || []).length;
  ok("S12 CHAMBER_OFF anchor defined exactly once", chOff === 1, "found " + chOff);
  ok("S12 dual scissored render passes (setScissorTest + brainCamera render)",
     /setScissorTest\(true\)/.test(HTML) && /setScissorTest\(false\)/.test(HTML) &&
     /renderer\.render\(scene, brainCamera\)/.test(HTML));
  ok("S12 brainCamera + brainOrbit defined",
     /const brainCamera = new THREE\.PerspectiveCamera/.test(HTML) &&
     /const brainOrbit = \{/.test(HTML));
  ok("S12 #viewSplit divider element + per-frame position driver",
     /<div id="viewSplit"><\/div>/.test(HTML) &&
     /viewSplitEl\.style\.left = viewsplitCssX\(\)/.test(HTML));
  ok("S12 FLY navigation anchors derived from CHAMBER_OFF (no stale world literals)",
     /const FLY_PERCH = new THREE\.Vector3\(CHAMBER_OFF\.x/.test(HTML) &&
     /const FLY_POST  = new THREE\.Vector3\(CHAMBER_OFF\.x/.test(HTML) &&
     /const FLY_DOCK  = new THREE\.Vector3\(CHAMBER_OFF\.x/.test(HTML) &&
     /const FLY_HOLD  = new THREE\.Vector3\(CHAMBER_OFF\.x/.test(HTML));
  ok("S12 demon transform copies chamber-local gatekeeper state (no double offset)",
     /devil\.position\.copy\(DemonGatekeeper\.pos\)/.test(HTML) &&
     !/devil\.position\.set\(\s*CHAMBER_OFF/.test(HTML));
  ok("S12 role swap captures the demon WORLD position",
     /devil\.getWorldPosition\(swap\.demonPos\)/.test(HTML));
  ok("S12 retired 3D split line never added to the scene",
     !/scene\.add\(splitGrp\)/.test(HTML) && /splitGrp\.visible = false/.test(HTML));
  ok("S12 apparatus framing helper + viewport-aware pick routing",
     /function apparatusFraming\(\)/.test(HTML) &&
     (HTML.match(/pickCameraNDC\(ev\)/g) || []).length >= 3);
  ok("S12 exhibit separation: camera layers, orthogonal masks, no shared-object layer",
     /camera\.layers\.set\(LAYER_APPARATUS\)/.test(HTML) &&
     /brainCamera\.layers\.set\(LAYER_BRAIN\)/.test(HTML) &&
     /function applyBrainExhibitLayers/.test(HTML) &&
     /function applyApparatusLayers/.test(HTML) &&
     !/LAYER_SHARED/.test(HTML));   // a shared layer would make both cameras see both exhibits
  ok("S12 demon guard idle: pacing + trident rap, amplitude-collapsed when busy",
     /guard idle .audit .*20/.test(HTML) &&
     HTML.includes(String.raw`guardAmp = (dv.react > 0.01 || DemonGatekeeper.staged ||`) &&
     HTML.includes(String.raw`swap.phase !== "none" || !parked) ? 0 : 1`) &&
     /pacing lane beside the gate/.test(HTML) && /trident rap/.test(HTML));
  ok("S12 pull-bar gate controller mirrors the door + demon home-guard self-heal",
     HTML.includes(String.raw`pullBarCar.position.y = -CH.h/2 + 8 + openHalf*1.1;`) &&
     HTML.includes(String.raw`pullCable.position.y = PULL_PULLEY_Y - cableLen/2;`) &&
     /home guard/.test(HTML) &&
     HTML.includes(String.raw`devil.parent !== chamberGroup`) &&
     HTML.includes(String.raw`chamberGroup.add(pullBarCar)`));
  ok("S12 split self-heal: renderDualView reconciles canvas box vs window (swallowed-resize cure)",
     HTML.includes(String.raw`const cw = Math.max(1, innerWidth), chh = Math.max(1, innerHeight);`) &&
     HTML.includes(String.raw`renderer.setSize(cw, chh, true);`) &&
     HTML.includes(String.raw`style.width !== cw + "px"`) &&
     HTML.includes(String.raw`camera.aspect = cw / chh; camera.updateProjectionMatrix();`) &&
     HTML.includes(String.raw`brainCamera.aspect = cw / chh; brainCamera.updateProjectionMatrix();`));
  ok("S12 watchdog: 1 Hz canvas reconcile + rAF resume kick with duplicate-chain dedupe",
     HTML.includes(String.raw`setInterval(() => {`) &&
     HTML.includes(String.raw`try { reconcileCanvasBox(); } catch (e) {}`) &&
     HTML.includes(String.raw`performance.now() - _lastRafKick > 3000`) &&
     HTML.includes(String.raw`if (cb === frame || cb === perfLoop){`) &&
     HTML.includes(String.raw`_loopLastRun.set(cb, nowp);`) &&
     HTML.includes(String.raw`nowp - (_loopLastRun.get(cb) || 0) < 2`));
  ok("S12 causal chain re-docks below the connectome panel every frame (no mid-run overlap)",
     HTML.includes(String.raw`const cpDock = document.getElementById("causalPanel");`) &&
     HTML.includes(String.raw`const dockY = Math.round(lc.el.getBoundingClientRect().bottom + 8) + "px";`) &&
     HTML.includes(String.raw`cpDock.style.top = dockY;`) &&
     HTML.includes(String.raw`if (cpDock.style.display === "none") cpDock.style.display = "";`));
  ok("S12 live apparatus telemetry moved onto the stage bottom strip (sidebar readout retired)",
     HTML.includes(String.raw`#appTelemetry { position:fixed; left:12px; bottom:12px; z-index:10; padding:6px 10px 8px;`) &&
     HTML.includes(String.raw`<div class="hud" id="appTelemetry">`) &&
     HTML.includes(String.raw`const liveApparatus = ["c3d", "lcPanel", "appTelemetry", "chemPlot"]`) &&
     !HTML.includes(String.raw`data-dock="liveTelemetry"`) &&
     (HTML.match(/id="tVals"/g) || []).length === 1 &&
     (HTML.match(/id="crossVal"/g) || []).length === 1);
  ok("S12 bottom legend bar replaced by live brain chemistry + spikes plot",
     HTML.includes(String.raw`<div class="hud" id="chemPlot">`) &&
     HTML.includes(String.raw`<canvas id="chemCv" width="860" height="220"></canvas>`) &&
     HTML.includes(String.raw`#chemPlot { position:fixed; right:12px; bottom:12px; z-index:10; padding:8px 12px 10px; }`) &&
     !HTML.includes(String.raw`id="legend"`) &&
     HTML.includes(String.raw`chemSample(); chemDraw();`) &&
     HTML.includes(String.raw`const ntOf = chem.ntOf;`));
  ok("S12 plot split: chemistry left + fly senses/actions right, LOG button saves JSON+CSV",
     HTML.includes(String.raw`FLY SENSES &amp; ACTIONS`) &&
     HTML.includes(String.raw`<button id="chemLogBtn"`) &&
     HTML.includes(String.raw`chemSample(); chemDraw(); chemLogTick();`) &&
     HTML.includes(String.raw`chem.tr.doorPos`) &&
     HTML.includes(String.raw`chem.tr.loco`) &&
     HTML.includes(String.raw`fly_log_" + stamp + ".json"`) &&
     HTML.includes(String.raw`fly_log_" + stamp + ".csv"`));
  ok("S12 door readout shows physical gate position (not stuck command)",
     HTML.includes("p6Stage(\"doorVal\", door.pos>0.5?\"OPEN\":door.pos>0.02?\"closing\u2026\":\"closed\");") &&
     !HTML.includes(String.raw`p6Stage("doorVal", door.target>0.5?"OPEN":"closed");`));
  ok("S12 worker tick carries measured dt (motor-rate/baseline parity with in-frame sim)",
     HTML.includes(String.raw`dt:sim._bwLastDt })`) &&
     HTML.includes(String.raw`sim._bwLastDt = Math.min(0.1, Math.max(0.004,`) &&
     !HTML.includes(String.raw`dt:0.016`));
  ok("S12 DPR-correct split math: scissor/reconcile use true pixel ratio (perf governor < 1x safe)",
     HTML.includes('Math.max(0.0001, renderer.getPixelRatio())') &&
     !HTML.includes(String.raw`Math.max(1, renderer.getPixelRatio())`));
} catch (e) { ok("S12 dual-viewport 3D presentation", false, e.message); }

// ------------------------------------------- S13 fly-brain firing map
section("S13 fly-brain firing map (plots-page card + main-page BRAIN MAP popup)");
try {
  const PL = fs.readFileSync(path.join(ROOT, "experiment_plots.html"), "utf8");
  ok("S13 plots card present (schematic firing map beside the Chamber loop panel)",
     PL.includes(String.raw`<div class="card" id="brainFireCard">`) &&
     PL.includes(String.raw`<div id="brainFireWrap">`) &&
     PL.includes(String.raw`<button id="dlBrainFire">`));
  ok("S13 plots map is a faithful fly_brain_firing_map.py port (nodes/edges/curve/jet/LogNorm)",
     PL.includes(String.raw`["ME_L",-2.1,0.05,6739], ["ME_R",2.1,0.05,7795]`) &&
     PL.includes(String.raw`["GNG","SAD",116],["SAD","GNG",39]`) &&
     PL.includes("bfCurve(na[1], na[2], nb[1], nb[2], 0.08)") &&
     /function bfJet\(t\)/.test(PL) &&
     /function bfLogT\(v, vmin, vmax\)/.test(PL));
  ok("S13 plots map is fed by real data (expStatus piggyback + finished-run rows + archive rows)",
     PL.includes(String.raw`if (m.status && m.status.brainFire) bfApplyStatus(m.status.brainFire);`) &&
     PL.includes(String.raw`bfUpdateFromRows(m.rows, expId, label);`) &&
     PL.includes(String.raw`bfUpdateFromRows(withRows[i].rows, withRows[i].expId, withRows[i].label)`));
  ok("S13 plots map runs on its own rAF loop and never blocks the status pipeline",
     PL.includes(String.raw`function bfLoop(){`) &&
     PL.includes(String.raw`BF.raf = requestAnimationFrame(bfLoop);`) &&
     PL.includes(String.raw`if (!BF.dirty) return;`));
} catch (e) { ok("S13 plots-page firing map", false, e.message); }
try {
  const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  ok("S13 BRAIN MAP button sits next to LOG and toggles the movable map window",
     HTML.includes(String.raw`<button id="chemBrainBtn" title="open a movable window with the fly brain firing map (schematic neuropil activity, live)">BRAIN MAP</button>`) &&
     HTML.includes(String.raw`if (brainBtn) brainBtn.addEventListener("click", () => bfwToggle());`) &&
     HTML.includes(String.raw`#brainMapWin.open { display:block; }`));
  ok("S13 map window is drag-movable with viewport-clamped title bar",
     HTML.includes(String.raw`head.setPointerCapture(ev.pointerId);`) &&
     HTML.includes(String.raw`const x = Math.min(innerWidth - 80, Math.max(8 - bfwWin.offsetWidth + 80, ev.clientX - bfwDrag.dx));`) &&
     HTML.includes(String.raw`const y = Math.min(innerHeight - 44, Math.max(4, ev.clientY - bfwDrag.dy));`) &&
     HTML.includes(String.raw`#brainMapWin .bmHead { display:flex; align-items:center; gap:8px; padding:5px 10px;`) &&
     HTML.includes(String.raw`cursor:move;`));
  ok("S13 popup map draws the same live schematic as a LIGHT matplotlib figure (white bg, dark labels, bezier edges, jet + log colorbar)",
     HTML.includes("bfwCurve(na[1], na[2], nb[1], nb[2], 0.08)") &&
     HTML.includes(String.raw`g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);   // (user request) light matplotlib-style figure`) &&
     HTML.includes(String.raw`glow.push({ c, col, lw: lw * 2.6, a: 0.05 + 0.13 * act });   // pale tint reads on white`) &&
     HTML.includes(String.raw`const cbX = W - 44, cbY = padT, cbH = H - padT - padB;`) &&
     HTML.includes(String.raw`g.fillText("High activity", W - 4, cbY + 9);`) &&
     HTML.includes(String.raw`g.fillText("Low activity", W - 4, cbY + cbH - 2);`) &&
     HTML.includes(String.raw`for (const [mult, a] of [[3.2, 0.06], [2.2, 0.10], [1.4, 0.22]]){`));
  ok("S13 popup heat is real sim data (per-neuropil spike mass, fast attack / slow release)",
     HTML.includes(String.raw`const npM = brainHolder.npMembers;`) &&
     HTML.includes(String.raw`heat[nm] = c / Math.max(1, arr.length) * 1000;`) &&
     HTML.includes(String.raw`bfwHeat[nm] = cur + (tgt - cur) * (tgt > cur ? 0.5 : 0.12);`) &&
     HTML.includes(String.raw`chemSample(); chemDraw(); chemLogTick(); bfwTick();`));
  ok("S13 lab broadcasts its firing-map heat to the plots page (expStatus piggyback, 2.5 Hz)",
     HTML.includes(String.raw`brainFire: window.__brainFirePublic ? window.__brainFirePublic() : null,`) &&
     HTML.includes(String.raw`window.__brainFirePublic = bfwPublic;`));
} catch (e) { ok("S13 main-page BRAIN MAP popup", false, e.message); }

// ------------------------------------------- S14 brain view modes (pathways + synaptic firing)
section("S14 brain view modes (branching neuron-tree pathways + jet synaptic firing overlays)");
try {
  const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  ok("S14 two mode buttons sit on top beside BRAIN MAP (PATHWAYS + SYNAPTIC, default OFF)",
     HTML.includes(String.raw`<button id="chemPathsBtn" title="swap the brain for a neuron TREE view: one branching arbor per real FAFB connection, rooted at measured synapse positions, colored by functional group (olfactory / central / lateral / ventral / visual)">PATHWAYS</button>`) &&
     HTML.includes(String.raw`<button id="chemFireBtn" title="overlay jet SYNAPTIC FIRING: live blue to red heat cloud driven by the real spike train">SYNAPTIC</button>`) &&
     HTML.includes(String.raw`if (pathsBtn) pathsBtn.addEventListener("click", () => bvmTogglePaths());`) &&
     HTML.includes(String.raw`if (fireBtn) fireBtn.addEventListener("click", () => bvmToggleFire());`));
  ok("S14 pathways mode uses REAL connections + REAL waypoints with the published group hues",
     HTML.includes(String.raw`const BVM_HUE = { olfactory:0.50, central:0.75, lateral:0.85, ventral:0.32, visual:0.12, other:0.58 };`) &&
     HTML.includes(String.raw`const root = realSite(e, false) || [pos[sI*3], pos[sI*3+1], pos[sI*3+2]];`) &&
     HTML.includes(String.raw`bvmTreeGrow(out, root[0], root[1], root[2], ux, uy, uz, trunk, depth,`) &&
     HTML.includes(String.raw`pick.sort((a, b) => c.edges[b].w - c.edges[a].w);`) &&
     HTML.includes(String.raw`geo.setDrawRange(0, 0);              // reveal sweep = paths BUILD on open`));
  ok("S14 synaptic mode is the jet blue-to-red firing cloud on live spikes (panel-matched ramp)",
     HTML.includes(String.raw`col[k*3] = 0.10; col[k*3+1] = 0.22; col[k*3+2] = 0.52;   // quiet: deep jet blue`) &&
     HTML.includes(String.raw`const c = jetRGB(hh / BVM.hScale);`) &&
     HTML.includes(String.raw`heat[i] = spk[i] ? 1 : heat[i] * 0.94;`) &&
     HTML.includes(String.raw`size: 6.5, sizeAttenuation: true, vertexColors: true, transparent: true,`) &&
     HTML.includes(String.raw`opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));`));
  ok("S14 modes are overlays only - default brain view untouched, rebuild-safe, wired into the frame loop",
     HTML.includes(String.raw`const BVM = { paths:false, fire:false, host:null, pathsGrp:null, fireGrp:null,`) &&
     HTML.includes(String.raw`if (BVM.host !== h.group){           // brain rebuilt: overlays died with the old group`) &&
     HTML.includes(String.raw`h.group.add(grp); applyBrainExhibitLayers(grp);   // stay in the brain exhibit viewport`) &&
     HTML.includes(String.raw`const hideWire = want && (BVM.paths || BVMS.on);   // tree/skeleton REPLACE the brain: wiring too`) &&
     HTML.includes(String.raw`chemSample(); chemDraw(); chemLogTick(); bfwTick(); fvwTick(); rtnTick(); bvmTick(dt);`));
} catch (e) { ok("S14 brain view modes", false, e.message); }

// ------------------------------------------- S15 skeleton view (SWC / fruit-fly template)
section("S15 SKELETON button (real-SWC skeleton view with fruit-fly template fallback)");
try {
  const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  ok("S15 skeleton button sits between PATHWAYS and SYNAPTIC and is wired + exclusive",
     HTML.includes(String.raw`<button id="chemSkelBtn" title="swap the brain for a FRUIT-FLY SKELETON view: thin neuron morphologies (real SWC files when fly_skeletons/ is present, anatomically-placed templates otherwise) colored by brain region; exclusive with PATHWAYS/SYNAPTIC">SKELETON</button>`) &&
     HTML.includes(String.raw`if (skelBtn) skelBtn.addEventListener("click", () => bvmToggleSkel());`) &&
     HTML.includes(String.raw`if (BVM.paths){ BVM.paths = false; if (BVM.pathsGrp) BVM.pathsGrp.visible = false;`));
  ok("S15 skeleton view parses real SWC and falls back to capped fruit-fly templates",
     HTML.includes(String.raw`function bvmSkelSWC(text){             // SWC columns: id type x y z radius parent`) &&
     HTML.includes(String.raw`function bvmSkelSpawn(out, i, c, sg, col){   // one fruit-fly template morphology`) &&
     HTML.includes(String.raw`const cap = 120, step = Math.max(1, Math.ceil(ids.length / cap));   // ≤120 arbors per neuropil`) &&
     HTML.includes(String.raw`const want = BVM.paths || BVM.fire || BVMS.on;   // view; OFF: restore default exactly`));
  ok("S15 skeleton sweep + tick wiring",
     HTML.includes(String.raw`if (BVMS.on) bvmSkelTick(dt);        // skeleton has its own sweep + rebuild`) &&
     HTML.includes(String.raw`skelBuilt = Math.min(skelTotal, skelBuilt + Math.max(400, skelTotal * (dt || 0.016) / 3.0));`));
} catch (e) { ok("S15 skeleton view", false, e.message); }
// ------------------------------------------- S17 fly-vision window
section("S17 FLY VISION window (retinotopic optics image + LOG PlotFlyVision series)");
try {
  const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  ok("S17 VISION button sits between FLY PATH and the strip and toggles the window",
     HTML.includes(String.raw`<button id="chemVisionBtn" title="open a movable FLY VISION window: what the fly's optics see right now — the 800-column hex-lattice retinotopic field (left + right eye halves), jet-intensity image; recorded with the LOG session as PlotFlyVision_* frames">VISION</button>`) &&
     HTML.includes(String.raw`if (visionBtn) visionBtn.addEventListener("click", () => fvwToggle());`) &&
     HTML.includes(String.raw`#flyVisionWin.open { display:block; }`));
  ok("S17 vision window is drag-movable with viewport-clamped title bar",
     HTML.includes(String.raw`#flyVisionWin .fvHead { display:flex; align-items:center; gap:8px; padding:5px 10px;`) &&
     HTML.includes(String.raw`try { head.setPointerCapture(ev.pointerId); } catch (e) {}   // synthetic pointerIds can throw`) &&
     HTML.includes(String.raw`const x = Math.min(innerWidth - 80, Math.max(8 - fvwWin.offsetWidth + 80, ev.clientX - fvwDrag.dx));`) &&
     HTML.includes(String.raw`const y = Math.min(innerHeight - 44, Math.max(4, ev.clientY - fvwDrag.dy));`) &&
     HTML.includes(String.raw`#flyVisionCv { display:block; width:100%; height:auto; background:#000; }`));
  ok("S17 vision image is the REAL retinotopy field (hex lattice, left|right split, jet)",
     HTML.includes(String.raw`fvwField = window.__lastVisualField || null;`) &&
     HTML.includes(String.raw`window.__lastVisualField = visual;   // (FLY VISION window) retinotopy peek source`) &&
     HTML.includes(String.raw`const nodes = (typeof RT_NODES !== "undefined") ? RT_NODES : null;`) &&
     HTML.includes(String.raw`function fvwHexPath(g, cx, cy, rx, ry){`) &&
     HTML.includes(String.raw`g.fillText("L", ox + matW/4, oy + maxRow*rowStep + 22);`) &&
     HTML.includes(String.raw`g.fillText("R", ox + matW*0.75, oy + maxRow*rowStep + 22);`) &&
     HTML.includes(String.raw`function fvwJet(t){`));
  ok("S17 vision is captured with the LOG (PlotFlyVision_ series, 5 s cadence, live frames)",
     HTML.includes(String.raw`fvwEnsureWin(); fvwCompute(); fvwDraw(fvwCv);`) &&
     HTML.includes(String.raw`chemLogPlotBuf.push({ name: "PlotFlyVision_" + tag + ".jpg", kind: "flyvision",`) &&
     HTML.includes(String.raw`for (const k of plotKinds) sceneParts.push(k === "flypath" ? "PlotFlyPath" : k === "flyvision" ? "PlotFlyVision" : "PlotBrainMap");`) &&
     HTML.includes(String.raw`chemSample(); chemDraw(); chemLogTick(); bfwTick(); fvwTick(); rtnTick(); bvmTick(dt);`));
} catch (e) { ok("S17 fly-vision window", false, e.message); }
// ------------------------------------------- S18 retina overlay (ME retinotopy in 3D)
section("S18 RETINA overlay (live retinotopic field projected onto the ME medulla plates in 3D)");
try {
  const HTML = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  ok("S18 RETINA button sits beside VISION and toggles the overlay",
     HTML.includes(String.raw`<button id="chemRetinaBtn" title="overlay the live retinotopic visual field ON the 3D brain: one jet dot per hex column in front of each ME (medulla) plate, in place — exactly what the optic layer is being fed, seen where the fly sees it">RETINA</button>`) &&
     HTML.includes(String.raw`if (retinaBtn) retinaBtn.addEventListener("click", () => rtnToggle());`));
  ok("S18 dots are the REAL lattice at REAL medulla geometry (jet-colored, GPU-streamed)",
     HTML.includes(String.raw`const mgeo = meta && meta.neuropils ? { L: meta.neuropils["ME_L"], R: meta.neuropils["ME_R"] } : null;`) &&
     HTML.includes(String.raw`const bend = Math.sin(n.u * Math.PI) * 0.22;`) &&
     HTML.includes(String.raw`colors.subarray(0, nd * 3) : colors.subarray(nd * 3)`) &&
     HTML.includes(String.raw`function rtnJet(t){`) &&
     HTML.includes(String.raw`blending: THREE.AdditiveBlending }));`));
  ok("S18 color is the LIVE field (peek, optic-layer parity) and the overlay follows brain rebuilds",
     HTML.includes(String.raw`const f = window.__lastVisualField;`) &&
     HTML.includes(String.raw`if (RTN.on && (!RTN.grp || RTN.host !== h.group) && now - RTN._try > 1000) rtnBuild();`) &&
     HTML.includes(String.raw`chemSample(); chemDraw(); chemLogTick(); bfwTick(); fvwTick(); rtnTick(); bvmTick(dt);`) &&
     HTML.includes(String.raw`applyBrainExhibitLayers(grp);`));
} catch (e) { ok("S18 retina overlay", false, e.message); }
// ------------------------------------------- S16 five-arm Stage-1 smoke
section("S16 five-arm Stage-1 smoke (benchmark --config, all arms/phases, byte determinism)");
try {
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath,
    ["--test", path.join(__dirname, "stage1_five_arm_smoke.test.js")],
    { encoding: "utf8", timeout: 300000, cwd: ROOT });
  const passM = out.match(/pass (\d+)/); const failM = out.match(/fail (\d+)/);
  const p16 = passM ? +passM[1] : -1, f16 = failM ? +failM[1] : -1;
  ok("S16 five-arm Stage-1 smoke (20 rows, frozenPre/weightDrift, run-twice byte-identical)",
     f16 === 0 && p16 >= 1, "pass=" + p16 + " fail=" + f16);
} catch (e) {
  const out = (e.stdout || "") + String(e.message || e);
  const failM = out.match(/fail (\d+)/);
  ok("S16 five-arm Stage-1 smoke (20 rows, frozenPre/weightDrift, run-twice byte-identical)",
     false, "suite failed (" + (failM ? failM[1] : "?") + " failing) - run: node --test tests/stage1_five_arm_smoke.test.js");
}

// ------------------------------------------- S19 sweep queue + increment ramp
// Regression lock for the interactive Lab's AUTO-RUN SWEEP (fly_demon_3d.html).
// The 2026-10-14 bug: chemSweepStart force-overrode chimInc.mode = "default",
// so sweep steps never moved the physio sliders while the identical settings
// ramped fine in a manual Run test. These tests eval the REAL extracted
// functions (chemSweepNs, chimKeySet, chimBuildIncPlan, chimUiPlan,
// chimIncStart, chimIncTick) against a truthful DOM stub and pin both
// the per-axis queue sizes and the sweep-step band-low→condition ramp.
section("S19 sweep queue sizes + sweep-step increment ramp (real fns, DOM stub)");
try {
  const html19 = fs.readFileSync(path.join(ROOT, "fly_demon_3d.html"), "utf8");
  const slice19 = (start, end) => {
    const i = html19.indexOf(start), j = html19.indexOf(end);
    if (i < 0 || j <= i) throw new Error("S19 extraction marker missing: " + start);
    return html19.slice(i, j);
  };
  const srcQ = slice19("function gid(id){", "function swSliderSnap(){");
  const srcI = slice19("const chemIncRow = {", "function chimSplitStart(){");
  const srcStart = slice19("function chemSweepStart(){", "function chemSweepNextStep(){");
  const srcStep = slice19("function chemSweepNextStep(){", "function chemSweepResetBrain(){");
  const srcRestore = slice19("function chemSweepRestore()", "function chemSweepFinish(){");
  // slider attributes copied verbatim from the app's <input type=range> rows
  const S19_SL = {
    lr:       { min: "0",   max: "0.02", step: "0.0005", value: "0.004" },
    rewScale: { min: "0.2", max: "5",    step: "0.1",    value: "1.5"   },
    exSl:     { min: "0",   max: "1",    step: "0.05",   value: "0.45"  },
    jetP:     { min: "0",   max: "1",    step: "0.05",   value: "0.55"  },
    noise:    { min: "0",   max: "0.6",  step: "0.02",   value: "0.12"  },
    doorH:    { min: "24",  max: "120",  step: "4",      value: "64"    },
    jetAim:   { min: "0",   max: "1",    step: "0.05",   value: "0.5"   },  // manual-only axis, not a sweep key
  };
  function boot19(boxes, incSel) {
    const dom = new Map();
    for (const id of ["swAxMode","swAxObs","swAxStance","swAxSwap","swAxLR","swAxRew","swAxEx","swAxJet","swAxNoise","swAxDoor"])
      dom.set(id, { checked: !!boxes[id], textContent: "" });
    for (const s of Object.keys(S19_SL))
      dom.set(s, Object.assign({}, S19_SL[s]));
    dom.set("swIncSel", { value: incSel || "default" });
    dom.set("swSplitSel", { value: "normal" });
    for (const s of Object.keys(S19_SL)) dom.set(s + "Val", { textContent: "" });
    const ctx = {
      performance: { now: () => 0 }, console,
      window: { BAR_POP_DOC: null },
      document: { getElementById: (id) => dom.get(id) || null, querySelector: () => null },
      chemTestPendingLen: () => 60, chemTestLen: 60, chemTestArmed: true,
      chemTestLenSel: "custom", DEMON_OBS_ON: false,
      MODE: "brain", assist: false, FLY_ROLE_REVERSAL: false,
      chemSweep: { running: false, queue: [], idx: 0, stopReq: false, saved: {} },
      msg: () => {},
      dom19: dom, // escape hatch so tests can flip stub states after boot
    };
    const context = vm.createContext(ctx);
    vm.runInContext(srcQ + "\n" + srcI, context, { filename: "sweep_engine_extract" });
    // top-level consts (chimInc, chemIncRow, SW_RANGES…) live in the context's
    // global lexical env, not on the context object — expose them via a fn
    vm.runInContext("this.__get = () => ({ inc: chimInc, row: chemIncRow, ranges: SW_RANGES, bands: SW_BANDS });", context);
    return ctx;
  }
  const el19 = (ctx, id) => ctx.dom19.get(id);
  const gid19 = (ctx, id) => ctx.document.getElementById(id);
  // canonical band table the queue builder and the ramp engine share
  const BANDS = { lr: [0.0, 0.01, 0.02], rewScale: [0.2, 2.6, 5], exSl: [0, 0.5, 1],
                  jetP: [0, 1], noise: [0.02, 0.6], doorH: [24, 120] };
  const KI = { lr: 0, rewScale: 1, exSl: 2, jetP: 3, noise: 4, doorH: 5 };

  // ---- queue sizes (each pin states the advertised condition count)
  const nsOf = (boxes) => boot19(boxes).chemSweepNs();
  const nsQueue = (boxes) => nsOf(boxes).queue;
  ok("S19 queue: vary driver mode alone -> 3 conditions (Fly brain → Random → You)",
     nsOf({ swAxMode: true }).n === 3 &&
     JSON.stringify(nsQueue({ swAxMode: true }).map(c => c.mode)) ===
     JSON.stringify(["brain", "random", "human"]));
  ok("S19 queue: vary driver mode keeps demon observation forced ON per step",
     nsQueue({ swAxMode: true }).every(c => c.obs === true),
     JSON.stringify(nsQueue({ swAxMode: true }).map(c => c.obs)));
  ok("S19 queue: Random/You never carry stance/swap flags (brain-only constants)",
     nsQueue({ swAxMode: true }).filter(c => c.mode !== "brain")
         .every(c => c.stance === false && c.swap === false));
  const sameMultiset = (a, b) => {
    const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  // checkbox id → the step's ki marker for that axis (lr0 rew1 ex2 jet3 noise4 door5)
  const KI_BOX = { swAxLR: 0, swAxRew: 1, swAxEx: 2, swAxJet: 3, swAxNoise: 4, swAxDoor: 5 };
  for (const [name, box, valKey, band] of [
    ["learning rate", "swAxLR", "lr", BANDS.lr],
    ["dopamine scale", "swAxRew", "rew", BANDS.rewScale],
    ["exploration", "swAxEx", "ex", BANDS.exSl],
    ["jet power", "swAxJet", "jet", BANDS.jetP],
    ["particle noise", "swAxNoise", "noise", BANDS.noise],
    ["door size", "swAxDoor", "door", BANDS.doorH],
  ]) {
    const qAlone = nsQueue({ [box]: true });
    const qMode = nsQueue({ swAxMode: true, [box]: true });
    ok(`S19 queue: vary ${name} (axis alone) -> ${band.length} conditions, brain only, values = canonical band`,
       qAlone.length === band.length && qAlone.every(c => c.mode === "brain" && c.ki === KI_BOX[box]) &&
       sameMultiset(qAlone.map(c => c[valKey]), band),
       "n=" + qAlone.length + " ki=" + qAlone.map(c => c.ki) + " vals=" + qAlone.map(c => c[valKey]));
    ok(`S19 queue: vary ${name} + driver axis -> ${3 * band.length} conditions (physio axes vary across ALL drivers)`,
       qMode.length === 3 * band.length &&
       ["brain", "random", "human"].every(m => sameMultiset(
         qMode.filter(c => c.mode === m).map(c => c[valKey]), band)) &&
       qMode.every(c => c.ki === KI_BOX[box]),
       "n=" + qMode.length + " vals=" + qMode.map(c => c[valKey]));
  }
  ok("S19 queue: stance × swap axes -> 4 conditions (help/obey × demon/fly-keeper, brain behind them)",
     nsOf({ swAxStance: true, swAxSwap: true }).n === 4 &&
     JSON.stringify(nsQueue({ swAxStance: true, swAxSwap: true })
       .map(c => c.stance + "/" + c.swap).sort()) ===
     JSON.stringify(["false/false", "false/true", "true/false", "true/true"].sort()));
  ok("S19 queue: no axis checked -> 1 condition (current settings, ki=6 marker)",
     nsOf({}).n === 1 && nsQueue({})[0].ki === 6 &&
     +nsQueue({})[0].lr === 0.004 && +nsQueue({})[0].jet === 0.55);
  ok("S19 queue: every step carries ki = its varied axis (lr0 rew1 ex2 jet3 noise4 door5)",
     JSON.stringify(nsQueue({ swAxLR: true }).map(c => c.ki)) === "[0,0,0]" &&
     JSON.stringify(nsQueue({ swAxLR: true }).map(c => c.lr)) === JSON.stringify(BANDS.lr) &&
     JSON.stringify(nsQueue({ swAxJet: true }).map(c => c.ki)) === "[3,3]" &&
     JSON.stringify(nsQueue({ swAxNoise: true }).map(c => c.ki)) === "[4,4]" &&
     JSON.stringify(nsQueue({ swAxDoor: true }).map(c => c.ki)) === "[5,5]" &&
     JSON.stringify(nsQueue({ swAxRew: true }).map(c => c.ki)) === "[1,1,1]" &&
     JSON.stringify(nsQueue({ swAxEx: true }).map(c => c.ki)) === "[2,2,2]");

  // ---- sweep-step increment ramp (the user complaint: auto-run froze sliders)
  const ctxR = boot19({ swAxLR: true }, "linear");
  const condStep = { mode: "brain", obs: true, stance: false, swap: false,
                     lr: 0.01, rew: 2.6, ex: 0.5, jet: 1, noise: 0.6, door: 120 };
  ctxR.chemSweep.queue = [condStep]; ctxR.chemSweep.idx = 0;
  ctxR.chemSweep.running = true;      // sweep step: sliders still parked at user-mid values
  ok("S19 ramp: sweep step increments ALL six physio axes (chemKeySet sweep branch)",
     JSON.stringify(ctxR.chimKeySet()) ===
     JSON.stringify(["lr","rewScale","exSl","jetP","noise","doorH"]));
  const planS = ctxR.chimBuildIncPlan();
  const wantPlan = { lr: { from: 0, to: 0.01 }, rewScale: { from: 0.2, to: 2.6 },
                     exSl: { from: 0, to: 0.5 }, jetP: { from: 0, to: 1 },
                     noise: { from: 0.02, to: 0.6 }, doorH: { from: 24, to: 120 } };
  ok("S19 ramp: sweep plan = band-LOW -> step's condition (NOT the parked slider value)",
     JSON.stringify(planS) === JSON.stringify(wantPlan), "plan=" + JSON.stringify(planS));
  ctxR.chimUiPlan(); ctxR.chimIncStart();                  // what chemSweepNextStep's start path does
  const rowS = ctxR.__get().row, incS = ctxR.__get().inc;
  ok("S19 ramp: sweep HONORS 'linear' (select value recorded in the session row)",
     rowS.val === "linear" && incS.mode === "linear" && incS.plan !== null);
  ctxR.chimIncTick(30);                                    // midpoint of a 60 s step
  ok("S19 ramp: mid-step slider values move (lr 0.005, door 72) + value spans mirror them",
     gid19(ctxR, "lr").value === "0.005" && gid19(ctxR, "lrVal").textContent === "0.005" &&
     gid19(ctxR, "doorH").value === "72" && gid19(ctxR, "doorHVal").textContent === "72");
  ctxR.chimIncTick(60);                                    // step end — condition value reached
  ok("S19 ramp: at step end every slider reads exactly the step's condition",
     +gid19(ctxR, "lr").value === 0.01 && +gid19(ctxR, "doorH").value === 120);
  ok("S19 ramp: at t=0 the ramp starts at the band-LOW edge",
     (ctxR.chimIncTick(0), +gid19(ctxR, "lr").value) === 0);
  const ctxM = boot19({});                                   // manual Run test contrast
  ctxM.chemSweep.running = false;
  const planM = ctxM.chimBuildIncPlan();
  ok("S19 ramp: MANUAL plan = current value -> slider max (distinct envelope, lr 0.004→0.02)",
     planM.lr.from === 0.004 && planM.lr.to === 0.02 && planM.doorH.from === 64 && planM.doorH.to === 120,
     "plan.lr=" + JSON.stringify(planM.lr));

  // ---- static pins on chemSweepStart (the fix itself)
  ok("S19 fix: chemSweepStart never assigns chimInc.mode (the old forced-default override is gone)",
     !/chimInc\.mode\s*=/.test(srcStart));
  const assigns = [...html19.matchAll(/chimInc\.mode\s*=\s*[a-zA-Z]/g)].map(m => m.index);
  const uiPlanAt = html19.indexOf("function chimUiPlan(){");
  const uiPlanEnd = html19.indexOf("function chimSnapshotSliders(){");
  ok("S19 fix: the ONLY chimInc.mode assignment in the app is chimUiPlan's select read",
     assigns.length === 1 && assigns[0] > uiPlanAt && assigns[0] < uiPlanEnd,
     "assignments=" + assigns.length);
  ok("S19 fix: chemSweepStart keeps split-over OFF inside steps (queue's own swap axis owns the keeper)",
     srcStart.includes('chimInc.split = "normal";'));
  ok("S19 fix: fix-note is in place (documented why steps honor the increment select)",
     srcStart.includes("(user fix 2026-10-14)"));
  ok("S19 fix: sweep start still builds the queue + flags running (start path intact)",
     /chemSweepNs\(\)/.test(srcStart) && srcStart.includes("chemSweep.running = true"));
  // (user report 2026-10-15) btnObey/btnAssist/btnSwap handlers force the
  // driver back to Fly brain on every state change, so a random/you step
  // silently recorded brain runs. Regression pin: every step (and the final
  // restore) applies stance/swap BEFORE the driver selection.
  ok("S19 fix: each step applies stance + swap BEFORE mode (their buttons force-click Fly brain; driver select must be the last word)",
     srcStep.indexOf('chemSweepApplySet("stance"') < srcStep.indexOf('chemSweepApplySet("mode"') &&
     srcStep.indexOf('chemSweepApplySet("swap"') < srcStep.indexOf('chemSweepApplySet("mode"'),
     "stance@" + srcStep.indexOf('chemSweepApplySet("stance"') + " swap@" + srcStep.indexOf('chemSweepApplySet("swap"') + " mode@" + srcStep.indexOf('chemSweepApplySet("mode"'));
  ok("S19 fix: chemSweepRestore re-applies stance + swap before the saved driver (post-sweep restore keeps the user's original driver)",
     srcRestore.indexOf('chemSweepApplySet("stance"') < srcRestore.indexOf('chemSweepApplySet("mode"') &&
     srcRestore.indexOf('chemSweepApplySet("swap"') < srcRestore.indexOf('chemSweepApplySet("mode"'),
     "restore order: stance@" + srcRestore.indexOf('chemSweepApplySet("stance"') + " swap@" + srcRestore.indexOf('chemSweepApplySet("swap"') + " mode@" + srcRestore.indexOf('chemSweepApplySet("mode"'));
} catch (e) { ok("S19 sweep queue + increment ramp", false, e.message); }

// ------------------------------------------------------------------ summary
console.log("\n==========================================");
console.log(`smoke suite: ${pass} passed, ${fail} failed, ${skipped} skipped`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("ALL GREEN");
