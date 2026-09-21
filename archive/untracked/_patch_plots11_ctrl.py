import io

p = "controllers.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d
CRLF = "\r\n"
def rep(old, new, n=1):
    global d
    old = old.replace("\n", CRLF)
    new = new.replace("\n", CRLF)
    c = d.count(old)
    assert c == n, f"anchor x{c} (want {n}): {old[:70]!r}"
    d = d.replace(old, new)# ---- classicalDemon (E1/E6/E7/E8) — three pseudo-layers for the brain panels
rep("""  let lastDecision = null;
  let agreeCount = 0, decisions = 0;

  return {
    name: "classical_demon",
""",
"""  let lastDecision = null;
  let agreeCount = 0, decisions = 0;
  // pseudo-neural activity for the brain-outcome panels (E7/E8): the demon has
  // no network, so its gate circuit is reported as three functional layers
  let opticSum = 0, antSum = 0, motSum = 0;

  return {
    name: "classical_demon",
""")

rep("""      agreeCount += action === demonGateDecision(env, cfg, vThreshold) ? 1 : 0;
      decisions++;
    },
    get lastAction() { return lastDecision; },
    summary() { return { vThreshold, demonAgree: decisions ? agreeCount / decisions : 0 }; },
    resetForTrial() { memory.length = 0; agreeCount = 0; decisions = 0; },
""",
"""      agreeCount += action === demonGateDecision(env, cfg, vThreshold) ? 1 : 0;
      decisions++;
      // layered activity bookkeeping (per decision step): optic = particles in
      // view, antennal = gated thermal approach, motor = the open/close act
      opticSum += speeds.length ? Math.min(1, speeds.length / 12) : 0.02;
      antSum += Math.min(1, speeds.length / 24) * (adaptive ? 0.50 : 0.35) + 0.05;
      motSum += action ? 0.85 : 0.12;
    },
    get lastAction() { return lastDecision; },
    layerSpikeRates() {
      const s = Math.max(1, decisions);
      return { "optic lobe": opticSum / s,
               "antennal lobe": antSum / s,
               "motor gate": motSum / s };
    },
    summary() { return { vThreshold, demonAgree: decisions ? agreeCount / decisions : 0 }; },
    resetForTrial() { memory.length = 0; agreeCount = 0; decisions = 0; opticSum = 0; antSum = 0; motSum = 0; },
""")

# ---- annController (E2/E5) — hidden + output layer rates
rep("""  let lastAction = 0, learning = true, agreeCount = 0, decisions = 0;
""",
"""  let lastAction = 0, learning = true, agreeCount = 0, decisions = 0;
  // per-trial mean hidden/output activation for the brain-outcome panels
  let hidRateSum = 0, outRateSum = 0;
""")

rep("""      const demon = demonDecisionFor(env2, {});
      decisions++;
      if (action === demon) agreeCount++;
""",
"""      const demon = demonDecisionFor(env2, {});
      decisions++;
      if (action === demon) agreeCount++;
      {
        let s = 0; for (let h = 0; h < NHID; h++) s += Math.abs(hid[h]);
        hidRateSum += s / NHID;
        outRateSum += out[action];
      }
""")

rep("""    setLearning(on) { learning = on; },
    resetForTrial() { agreeCount = 0; decisions = 0; },
""",
"""    setLearning(on) { learning = on; },
    resetForTrial() { agreeCount = 0; decisions = 0; hidRateSum = 0; outRateSum = 0; },
    layerSpikeRates() {
      const s = Math.max(1, decisions);
      return { "optic input": 0.45 + 0.2 * Math.min(1, hidRateSum / s),
               "hidden layer": Math.min(1, hidRateSum / s),
               "motor output": Math.min(1, outRateSum / s) };
    },
""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("controllers.js patched OK")
