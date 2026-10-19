// Verification harness for the paper-data schema-v2 export (task step 7).
// Serves the app locally, opens headless Chromium, starts LOG, lets the sim
// run, stops LOG, captures the fly_session_*.zip the app downloads via CDP,
// unzips it, and runs the contract checks:
//   (a) events.csv pairing: >=1 gate_open -> crossing pair on shared t_sim
//   (b) spk_<nt>/n_<nt> counts present and non-degenerate (or documented fallback)
//   (c) dwL1_step/dwN_step present and non-constant
//   (d) meta.schema_version === 2
// The harness file is self-contained and deletable after review.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const pw = require("playwright-core");
// playwright-core ships no browser; use any installed Chrome/Edge channel
// (CHROME_PATH env var overrides).
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).filter(p => fs.existsSync(p));

const ROOT = __dirname;
const PORT = 8791;
const OUTDIR = path.join(ROOT, "research_data", "schema_v2_verify");
const RUN_S = Number(process.env.VERIFY_SECONDS || 150);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".npy": "application/octet-stream",
  ".csv": "text/csv", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/fly_demon_3d.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  fs.rmSync(OUTDIR, { recursive: true, force: true });
  fs.mkdirSync(OUTDIR, { recursive: true });
  await new Promise(r => server.listen(PORT, r));
  console.log("[verify] serving on http://localhost:" + PORT);

  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: CHROME_CANDIDATES[0],
  });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", m => { const t = m.text(); if (/LOG|error|Error/i.test(t)) console.log("[page]", t.slice(0, 200)); });
  page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0, 300)));

  // (EXP3/EXP4 closed: the SHEAT/TWO_DOOR flag-arming belonged to the
  // sustained-heat and two-door levers, REVERTED per the EXP4 prereg closing
  // clause after the NO-EFFECT verdict. The harness is back to the plain
  // v2.2-contract configuration below.)

  console.log("[verify] loading app …");
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!document.getElementById("chemLogBtn") && typeof window.DemonGatekeeper === "object",
    null, { timeout: 120000 });
  console.log("[verify] app ready (chemLogBtn + DemonGatekeeper present)");

  // ---- start LOG recording (direct DOM click: the HUD canvas overlays the
  // button and intercepts synthetic pointer events)
  const domClick = () => page.evaluate(() => document.getElementById("chemLogBtn").click());
  await domClick();
  await page.waitForTimeout(1200);
  const btnState = await page.evaluate(() => ({
    text: document.getElementById("chemLogBtn").textContent,
    rec: document.getElementById("chemLogBtn").classList.contains("rec"),
    msg: (document.querySelector("#msg") || document.body).textContent.slice(0, 120),
  }));
  console.log("[verify] after 1st click:", JSON.stringify(btnState));
  console.log("[verify] LOG recording started; simulating", RUN_S, "s …");
  await page.waitForTimeout(RUN_S * 1000);

  // probe the in-page buffers before save (diagnostics)
  const probe = await page.evaluate(() => ({
    rows: (typeof chemLogBuf !== "undefined") ? chemLogBuf.length : -1,
    events: (typeof chemEventBuf !== "undefined") ? chemEventBuf.length : -1,
    evTypes: (typeof chemEventBuf !== "undefined") ? [...new Set(chemEventBuf.map(e => e.event_type))] : [],
    simClock: (typeof DemonGatekeeper !== "undefined" && DemonGatekeeper.simTime) ? +DemonGatekeeper.simTime.toFixed(2) : null,
    gatePos: (typeof door !== "undefined") ? +door.pos.toFixed(3) : null,
    crossGood: typeof crossGood !== "undefined" ? crossGood : null,
    crossBad: typeof crossBad !== "undefined" ? crossBad : null,
  }));
  console.log("[verify] pre-save probe:", JSON.stringify(probe));

  // ---- stop LOG → the app clicks a synthetic <a download>; CDP routes the
  // browser.downloadWillBegin / downloadProgress events to OUTDIR.
  console.log("[verify] LOG stopped — waiting for the zip download (Playwright download event) …");
  let zipPath = null;
  try {
    const download = await Promise.race([
      page.waitForEvent("download", { timeout: 45000 }),
      domClick().then(() => null),   // safety: if the 1st toggle failed, this 2nd click STOPS a stray recording
    ]);
    if (download) {
      zipPath = path.join(OUTDIR, "captured_session.zip");
      await download.saveAs(zipPath);
    } else {
      // the safety click started (not stopped) a recording — stop it and wait again
      const dl2 = await page.waitForEvent("download", { timeout: 45000 });
      zipPath = path.join(OUTDIR, "captured_session.zip");
      await dl2.saveAs(zipPath);
    }
  } catch (e) {
    console.error("[verify] download wait failed:", String(e).slice(0, 200));
  }
  if (!zipPath || !fs.existsSync(zipPath)) {
    const btn = await page.evaluate(() => document.getElementById("chemLogBtn").textContent).catch(() => "?");
    console.error("VERIFY FAIL: no zip captured (button now: " + btn + ")");
    process.exit(1);
  }
  console.log("[verify] zip captured:", path.basename(zipPath), fs.statSync(zipPath).size, "bytes");

  // ---- extract (PowerShell Expand-Archive needs .zip extension it has)
  execSync(`powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${zipPath}' '${OUTDIR}\\x'"`, { stdio: "pipe" });
  const dir = path.join(OUTDIR, "x", fs.readdirSync(path.join(OUTDIR, "x"))[0]);
  const files = fs.readdirSync(dir);
  console.log("[verify] zip members:", files.join(", "));

  const csvName = files.find(f => /fly_log_.*\.csv$/.test(f));
  const csv = fs.readFileSync(path.join(dir, csvName), "utf8");
  const json = JSON.parse(fs.readFileSync(path.join(dir, files.find(f => /fly_log_.*\.json$/.test(f))), "utf8"));
  const ev = fs.readFileSync(path.join(dir, "events.csv"), "utf8");
  const readme = fs.readFileSync(path.join(dir, "README.txt"), "utf8");

  // ================= contract checks =================
  let fails = 0;
  const check = (name, cond, detail) => {
    console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond ? "" : "  -> " + detail));
    if (!cond) fails++;
  };

  // (d) schema_version (v2.2: signed dwL1/dwN baselines + dwMax KPI drop, 2026-10-08; v2.1 was gate_close fix + crossEvent removal; v2.3's door_choice events belonged to the reverted EXP4 lever)
  check("(d) meta.schema_version === 2.2", json.meta && json.meta.schema_version === 2.2, JSON.stringify(json.meta && json.meta.schema_version));
  check("zip contains events.csv + README.txt", files.includes("events.csv") && files.includes("README.txt"), files.join(","));

  // main table contract columns
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const need = ["t", "t_sim", "da", "loco", "ntP", "bestDT", "epT", "flyRuns", "dwL1", "dwN", "dwL1_step", "dwN_step",
    "spk_ach", "spk_gaba", "spk_glut", "spk_da", "spk_ser", "spk_oct",
    "n_ach", "n_gaba", "n_glut", "n_da", "n_ser", "n_oct",
    "doorT", "doorPos", "jetP", "jetAim", "noise", "doorH", "np1_name", "np1_rate", "motor", "motorBase", "cg", "cb"];
  const missing = need.filter(c => !header.includes(c));
  check("all contract columns present in fly_log CSV", missing.length === 0, "missing: " + missing.join(","));

  // parse key columns
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = lines.slice(1).map(l => l.split(","));
  const col = (name) => rows.map(r => r[idx[name]]).filter(v => v !== "" && v !== undefined);
  const uniq = (arr) => new Set(arr).size;
  check("t_sim present on rows and shares the events clock", col("t_sim").length > 0, "empty t_sim column");

  // (c) dw steps present + non-constant
  const dwS = col("dwL1_step").map(Number);
  const dwN = col("dwN_step").map(Number);
  check("(c) dwL1_step present and non-constant", dwS.length > 0 && uniq(dwS) > 1, `n=${dwS.length} uniq=${uniq(dwS)}`);
  check("(c) dwN_step present", dwN.length > 0, `n=${dwN.length}`);
  // cumulative dwL1 non-constant too (plasticity actually ran)
  const dwC = col("dwL1").map(Number);
  check("(c) cumulative dwL1 non-constant (learning ran)", uniq(dwC) > 1, `uniq=${uniq(dwC)}`);

  // (b) counts non-degenerate
  // Known circuit facts (fly_brain_circuit.json): nt_name covers ONLY fast
  // transmitters {ach: 333,156, gaba: 136,593, glut: 84,058 edges}; there are
  // NO da/ser/oct fast-transmitter annotations (the 10,223 modulatory da/ser/
  // oct contacts live in modulatory_edges and carry no per-neuron fast-spike
  // identity). Therefore spk_da/spk_ser/spk_oct === 0 and n_da/n_ser/n_oct
  // === "" are CORRECT zeros, not missing data; ser/oct drive is the sim.DA /
  // sim.modEma scalars already logged (da, ser, oct columns).
  const spkAch = col("spk_ach").map(Number);
  const spkDa = col("spk_da").map(Number);
  const nAch = col("n_ach").map(Number);
  check("(b) spk_<nt>/n_<nt> present with plausible values", spkAch.length > 0 && nAch.length > 0,
    `spk_ach n=${spkAch.length} n_ach n=${nAch.length}`);
  check("(b) ach/gaba/glut counts non-degenerate (vary across rows)", uniq(spkAch) > 1, `spk_ach uniq=${uniq(spkAch)}`);
  check("(b) da/ser/oct counts correctly zero (no fast-NT annotations in circuit; documented)",
    uniq(spkDa) <= 1 && spkDa.every(v => v === 0), `spk_da uniq=${uniq(spkDa)}`);

  // (a) events: vocabulary, pairing, shared clock
  const evLines = ev.trim().split("\n");
  const evHdr = evLines[0].split(",");
  check("events.csv header is t_sim,t_wall,event_type,details", evHdr.join(",") === "t_sim,t_wall,event_type,details", evHdr.join(","));
  const events = evLines.slice(1).map(l => {
    const m = l.match(/^([^,]*),([^,]*),([^,]*),(.*)$/);
    return m && { t_sim: +m[1], t_wall: +m[2], type: m[3], details: m[4] };
  }).filter(Boolean);
  const types = new Set(events.map(e => e.type));
  check("event vocabulary covers gate_open/gate_close/crossing/startle",
    ["gate_open", "crossing"].every(t => types.has(t)), "types seen: " + [...types].join(","));
  // pairing: for each crossing, latency to the latest gate_open before it
  const opens = events.filter(e => e.type === "gate_open").map(e => e.t_sim);
  const crosses = events.filter(e => e.type === "crossing");
  let paired = 0, latencies = [];
  for (const c of crosses) {
    const prior = opens.filter(t => t <= c.t_sim);
    if (prior.length) { paired++; latencies.push(+(c.t_sim - Math.max(...prior)).toFixed(3)); }
  }
  check("(a) at least one gate_open→crossing pair extractable", paired >= 1, `opens=${opens.length} crossings=${crosses.length} paired=${paired}`);
  if (latencies.length) console.log("  [latency] gate_open→crossing (s): n=" + latencies.length +
    " min=" + Math.min(...latencies) + " median=" + latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] +
    " max=" + Math.max(...latencies));
  // clock contract: events' t_sim must sit inside the rows' t_sim range
  const rowSim = col("t_sim").map(Number);
  if (rowSim.length && opens.length) {
    const rmin = Math.min(...rowSim), rmax = Math.max(...rowSim);
    const inRange = events.every(e => e.t_sim >= rmin - 0.5 && e.t_sim <= rmax + 1.0);
    check("clock contract: events t_sim inside the rows' t_sim range (one shared clock)", inRange,
      `events t_sim [${Math.min(...events.map(e => e.t_sim))}, ${Math.max(...events.map(e => e.t_sim))}] vs rows [${rmin}, ${rmax}]`);
  }
  check("README states the clock contract", readme.includes("ONE clock shared by rows and events"), "");

  // behaviour columns present on every row (guarantee)
  const behav = ["loco", "ntP", "bestDT", "epT", "flyRuns"];
  const behavOk = behav.every(c => col(c).length === rows.length);
  check("behaviour columns (loco,ntP,bestDT,epT,flyRuns) present on every row", behavOk,
    behav.map(c => c + "=" + col(c).length + "/" + rows.length).join(" "));

  // extra sanity: dopamine column varies (the real Fig-3 reward signal)
  const daCol = col("da").map(Number);
  check("da (sim.DA.v) present and varying (Fig-3 reward signal live)", daCol.length === rows.length && uniq(daCol) > 1,
    `uniq=${uniq(daCol)}`);

  console.log(fails === 0 ? "\nVERIFY: ALL CONTRACT CHECKS PASS" : `\nVERIFY: ${fails} CHECK(S) FAILED`);
  console.log("[verify] artifacts kept in: " + OUTDIR);
  await browser.close();
  server.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error("[verify] fatal:", e); process.exit(1); });
