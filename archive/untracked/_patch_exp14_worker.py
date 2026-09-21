import io

p = "experiment_worker.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in d else "\n"
def nl(s):
    return s.replace("\r\n", "\n").replace("\n", NL) if NL else s

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# ---- registry: E9/E10/E11 (app class, no circuit, apparatus env id) ---------
E5LINE = '  e5: { label: "E5 \u00b7 Full Comparator Study",'
E9BLOCK = (
'  e9: { label: "E9 \u00b7 Pressure Demon",\n'
'        needsCircuit: false,\n'
'        apparatus: "pressureDemonCore",          // CORE function name\n'
'        apparatusEnv: "pressure",                // 3D environment id\n'
'        controllers: () => ({}),\n'
'        physics: () => ({ nParticles: 260, noise: 0 }),\n'
'        seeds: 1, train: 12, test: 12, episode: 20 },\n'
'  e10: { label: "E10 \u00b7 Smoluchowski Trapdoor",\n'
'        needsCircuit: false,\n'
'        apparatus: "smoluchowskiCore",\n'
'        apparatusEnv: "trapdoor",\n'
'        controllers: () => ({}),\n'
'        physics: () => ({ nParticles: 220, noise: 0 }),\n'
'        seeds: 1, train: 8, test: 8, episode: 16 },\n'
'  e11: { label: "E11 \u00b7 Feynman Ratchet & Pawl",\n'
'        needsCircuit: false,\n'
'        apparatus: "feynmanRatchetCore",\n'
'        apparatusEnv: "ratchet",\n'
'        controllers: () => ({}),\n'
'        physics: () => ({ nParticles: 0, noise: 0 }),\n'
'        seeds: 1, train: 10, test: 10, episode: 12 },\n')

rep(E5LINE, E9BLOCK + E5LINE)

# ---- runExperiment: apparatus branch (cores stream onState/onTrialData and
# have no _raw seeds, so they must not go through the runBenchmark pipeline) --
ANCH = ('  const t0 = Date.now();\n'
        '\n'
        '  // per-condition accumulation of full trial rows (streamed via onTrialData)\n'
        '  const trialRows = {};     // key -> [row, ...]\n'
        '  let lastEmit = 0;\n')

APP = (
'  const t0 = Date.now();\n'
'\n'
'  // per-condition accumulation of full trial rows (streamed via onTrialData)\n'
'  const trialRows = {};     // key -> [row, ...]\n'
'  let lastEmit = 0;\n'
'\n'
'  // ---- apparatus experiments (E9/E10/E11): self-contained cores that stream\n'
'  // live 3D state + one metrics row per episode. They bypass runBenchmark\n'
'  // (no _raw seeds / per-neuron vectors) and reuse everything else: rows ->\n'
'  // curve -> sparklines, provenance, plots broadcast.\n'
'  if (spec.apparatus) {\n'
'    const coreFn = CORE[spec.apparatus];\n'
'    const nTrials = train + test;\n'
'    try {\n'
'      const res = coreFn({\n'
'        seed: opts.seed !== undefined ? opts.seed : 1,\n'
'        trials: nTrials,\n'
'        episodeSeconds: episode,\n'
'        nParticles: (spec.physics && spec.physics(0, 1) || {}).nParticles || 260,\n'
'        onTrialData: (cond, phase, tr) => {\n'
'          pushRow(cond, phase, tr);\n'
'          emit(expId, phase, (tr.trial || 0) + 1, nTrials, 1, false);\n'
'        },\n'
'        onState: (st) => postMessage({ type: "app_state", expId, state: st }),\n'
'      });\n'
'      const { curve } = buildCurve();\n'
'      const conditions = {};\n'
'      for (const [key, cond] of Object.entries(res.conditions)) {\n'
'        const { _apparatus, ...rest } = cond;\n'
'        conditions[key] = rest;\n'
'      }\n'
'      const prov = {\n'
'        experiment: expId, label: spec.label,\n'
'        seeds: 1, trainTrials: train, testTrials: test,\n'
'        episodeSeconds: episode,\n'
'        nParticles: (spec.physics && (spec.physics(0, 1) || {}).nParticles) || 260,\n'
'        noise: 0, dt: 1 / 60, tKelvin: 300, simToJoule: 1e-21,\n'
'        apparatus: spec.apparatusEnv,\n'
'        software: "Fly-Demon Lab v2 experiment list",\n'
'        startedISO: new Date(t0).toISOString(),\n'
'        elapsedSeconds: (Date.now() - t0) / 1000,\n'
'      };\n'
'      postMessage({ type: "done", expId, summary: { conditions, curve },\n'
'                    rows: [], provenance: prov, apparatus: spec.apparatusEnv });\n'
'    } catch (err) {\n'
'      postMessage({ type: "error", expId, message: String(err && err.stack || err) });\n'
'    }\n'
'    return;\n'
'  }\n')

rep(ANCH, APP)

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("worker registry + apparatus branch added")
