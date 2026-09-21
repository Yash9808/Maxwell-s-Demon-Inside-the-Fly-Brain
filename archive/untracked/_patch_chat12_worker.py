import io

p = "experiment_worker.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def crlf(s):
    return s.replace("\r\n", "\n").replace("\n", "\r\n")

def rep(old, new, n=1):
    global d
    old, new = crlf(old), crlf(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# 1) message protocol: accept run_custom (an LLM-designed experiment) ----------
rep("""self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "run") runExperiment(m.expId, m.circuit, m.opts || {});
  else if (m.type === "ping") postMessage({ type: "pong" });
};
""",
"""self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "run") runExperiment(m.expId, m.circuit, m.opts || {});
  else if (m.type === "run_custom") {
    try { registerCustom(m); runExperiment("chat", m.circuit, m.opts || {}); }
    catch (err) { postMessage({ type: "error", expId: "chat",
                                message: "custom spec: " + String(err && err.message || err) }); }
  }
  else if (m.type === "ping") postMessage({ type: "pong" });
};

// ------------------------------------------------- chat-designed experiments
// The lab page's Chat card lets an LLM (GPT API / local Ollama / LM Studio)
// design an experiment; the design arrives as `spec`, gets registered as the
// pseudo-experiment "chat", and then runs through the exact same pipeline as
// E1-E8 (same rows, curve, provenance and plots broadcasts).
const CHAT_FACTORIES = {
  classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
  ann:             (rng, env, cfg) => CTRL.annController(rng, env, cfg),
  drosophila:      (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg),
  never_gate:      (rng, env, cfg) => CTRL.neverGateController(rng, env, cfg),
  random:          (rng, env, cfg) => CTRL.randomController(rng, env, cfg),
};
const CHAT_ALIASES = {
  classical_demon: "classical_demon", classical: "classical_demon",
  demon: "classical_demon", classic: "classical_demon", physical: "classical_demon",
  ann: "ann", mlp: "ann", neural: "ann", network: "ann",
  drosophila: "drosophila", fly: "drosophila", fly_brain: "drosophila",
  mb: "drosophila", mushroom: "drosophila", mushroom_body: "drosophila",
  never_gate: "never_gate", nevergate: "never_gate", never: "never_gate",
  random: "random", control: "random", baseline: "random",
};
function registerCustom(m) {
  const s = m.spec || {};
  if (!s || typeof s !== "object") throw new Error("spec missing");
  const name = String(s.name || "Chat experiment").slice(0, 60);
  const conds = Array.isArray(s.conditions) ? s.conditions : [];
  const ids = [];
  for (const c of conds) {
    const k = CHAT_ALIASES[String(c).toLowerCase().trim()];
    if (k && !ids.includes(k)) ids.push(k);
  }
  if (!ids.length) ids.push("classical_demon");
  if (ids.length > 4) ids.length = 4;
  const nP = Math.max(40, Math.min(640, Math.round(Number(s.nParticles) || 320)));
  const nN = Math.max(0, Math.min(0.4, Number(s.noise) || 0.12));
  const ep = Math.max(4, Math.min(12, Math.round(Number(s.episodeSeconds) || 12)));
  const tr = Math.max(8, Math.min(60, Math.round(Number(s.trainTrials) || 40)));
  const te = Math.max(4, Math.min(12, Math.round(Number(s.testTrials) || 8)));
  const controllers = () => {
    const out = {};
    ids.forEach((k, i) => {
      const key = k + "_" + (i + 1);
      out[key] = (rng, env, cfg) => CHAT_FACTORIES[k](rng, env, cfg);
    });
    return out;
  };
  EXPERIMENTS.chat = {
    label: "\\uD83D\\uDCAC " + name,
    needsCircuit: false,
    controllers,
    physics: () => ({ nParticles: nP, noise: nN }),
    seeds: 1, train: tr, test: te, episode: ep,
    design: s,                    // echoed into provenance for the paper trail
  };
}
""")

# 2) provenance: honest nParticles/noise + the LLM design echo -----------------
rep("""      software: "Fly-Demon Lab v2 experiment list",
""",
"""      software: "Fly-Demon Lab v2 experiment list",
      chatDesign: spec.design || null,
""")
rep("""      episodeSeconds: episode, nParticles: 320, noise: 0.12, doorHeight: 64,
""",
"""      episodeSeconds: episode, doorHeight: 64,
      nParticles: (spec.physics && (spec.physics(0, nSeeds) || {}).nParticles) || 320,
      noise: (spec.physics && (spec.physics(0, nSeeds) || {}).noise) || 0.12,
""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("worker patch applied:", p)
