// Audit patch 10/10b: TrueFly-glb must target fly.glb + the flyer avatar only.
const fs = require("fs");
const html = fs.readFileSync("fly_demon_3d.html", "utf8");
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error("module script not found"); process.exit(1); }
const js = m[1];
const checks = [
  ["loads fly.glb exactly once",            (js.match(/GLTFLoader\(\)\.load\("fly\.glb"/g) || []).length === 1],
  ["no CT-scan glb left in the page",       !html.includes("drosophila_-_adult_fruit_fly_-_ct_scan.glb")],
  ["no trueflyBuildLines remains",          !js.includes("trueflyBuildLines")],
  ["no TRUEFLY.geo / .lines remains",       !js.includes("TRUEFLY.geo") && !js.includes("TRUEFLY.lines")],
  ["apply() parents under flyGroup",        /trueflyApply[\s\S]{0,400}flyGroup\.add\(TRUEFLY\.root\)/.test(js)],
  ["apply() no longer touches brainHolder", !/function trueflyApply\(\)\{[\s\S]{0,600}brainHolder/.test(js)],
  ["wings flapped from the buzz loop",      /flyGroup\.userData\.wings\.forEach[\s\S]{0,200}trueflyWings\(t\*buzz/.test(js)],
  ["flap uses z hinge with side sign",      /w\.rotation\.z = side \* amp \* Math\.sin/.test(js)],
  ["flyGroup scale compensated",            /Math\.max\(size\.x, size\.y, size\.z, 1e-6\) \* flyGroup\.scale\.x/.test(js)],
  ["button handler no longer hijacks anatMode", !js.includes("TrueFly lives in the anatomical frame")],
  ["push-brace legs excluded from hiding",  /o !== pushLegL && o !== pushLegR/.test(js)],
];
let fail = 0;
for (const [name, ok] of checks) { console.log((ok ? "PASS" : "FAIL") + "  " + name); if (!ok) fail = 1; }
process.exit(fail);
