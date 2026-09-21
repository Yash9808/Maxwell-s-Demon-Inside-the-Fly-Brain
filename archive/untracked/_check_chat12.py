"""_check_chat12.py — audit the Chat-provider patches (worker run_custom + lab chat card)."""
import io, re

fail = []

def ck(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond: fail.append(what)

# ---- worker ----------------------------------------------------------------
w = io.open("experiment_worker.js", encoding="utf-8", newline="").read()
ck('else if (m.type === "run_custom")' in w, "worker: run_custom branch")
ck("CHAT_FACTORIES" in w and "CHAT_ALIASES" in w, "worker: chat factory + alias tables")
ck("EXPERIMENTS.chat = {" in w, "worker: chat pseudo-experiment registered")
ck("chatDesign: spec.design || null" in w, "worker: provenance echoes design")
ck("spec.physics && (spec.physics(0, nSeeds)" in w, "worker: provenance honest nParticles/noise")
ck("nParticles: nP, noise: nN" in w, "worker: custom physics wired into spec.physics")
ck("label: \"\\uD83D\\uDCAC \" + name" in w, "worker: chat label prefix")
# aliases resolve the canonical five
ck(all(k in w for k in ["classical_demon:", "ann:", "drosophila:", "never_gate:", "random:"]),
   "worker: all five controllers exposed")
# node --check the worker separately in the shell; here just brace sanity on the new block
i = w.find("self.onmessage")
j = w.find("function runExperiment")
seg = w[i:j]
ck(seg.count("{") == seg.count("}"), "worker: new protocol block braces balanced")

# ---- lab page --------------------------------------------------------------
d = io.open("fly_demon_3d.html", encoding="utf-8", newline="").read()
for i_ in ["chatCard", "chatProv", "chatConnect", "chatCfg", "chatKey", "chatKeyHint",
           "chatHost", "chatModels", "chatModelTxt", "chatRec", "chatSave",
           "chatIdea", "chatGo"]:
    ck(len(re.findall('id="%s"' % i_, d)) == 1, "lab: id once — " + i_)
ck(d.count('data-exp="chat"') == 1, "lab: chat card data-exp once")
ck('id="chatCard" data-exp="chat"' in d, "lab: chat card shares exp-card shape")
ck(d.find('data-exp="e8"') < d.find('id="chatCard"') < d.find('id="expNote"'),
   "lab: chat card sits after E8, before the note")
ck('window.__chatSpec' in d and 'type: "run_custom"' in d, "lab: startNext sends run_custom")
ck("ollama" in d and "/api/tags" in d, "lab: Ollama detection via /api/tags")
ck("/v1/models" in d, "lab: LM Studio detection via /v1/models")
ck("parameter_size" in d and "quantization_level" in d, "lab: recommendation reads model metadata")
ck("platform.openai.com/api-keys" in d, "lab: API-key help link")
ck("host override" in d, "lab: Pi/LAN host override offered")
ck("api.openai.com/v1/chat/completions" in d, "lab: OpenAI chat call")
ck(d.count("CHAT_ALIASES") >= 1, "lab: alias table present")
# classic script balance (strip strings/comments first)
blocks = re.findall(r"<script>(.*?)</script>", d, re.S)
ck(len(blocks) >= 1, "lab: %d classic script block(s) found" % len(blocks))
for bi, b in enumerate(blocks):
    t = re.sub(r"`(?:[^`\\]|\\.)*`", "``", b, flags=re.S)
    t = re.sub(r'"(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\'', '""', t, flags=re.S)
    t = re.sub(r"//[^\n]*|/\*.*?\*/", "", t, flags=re.S)
    for o, c, nm in [("{", "}", "braces"), ("(", ")", "parens"), ("[", "]", "brackets")]:
        ck(t.count(o) == t.count(c),
           "lab: block %d %s balanced (%d/%d)" % (bi, nm, t.count(o), t.count(c)))

# ---- answer mode (patch 12e) ------------------------------------------------
ck('id="chatAnswer"' in d, "lab: answer readout box present")
ck("chatIndexBrain" in d and "window.__chatBrainIndex" in d, "lab: brain index built from done rows")
ck("layerRates" in d, "lab: index reads measured layerRates")
ck("testRegions" in d, "lab: index keeps test-phase breakdown")
ck("function chatGo" in d, "lab: question/design router installed")
ck('chatGoBtn.addEventListener("click", chatGo)' in d, "lab: button routes through chatGo")
ck("no finished runs yet" in d, "lab: honest guard before any data")

# ---- plots page untouched by this patch ------------------------------------
p = io.open("experiment_plots.html", encoding="utf-8", newline="").read()
ck(p.count("function collectBrainDeltas") == 1, "plots: single collectBrainDeltas (untouched)")

print("----")
print("FAILURES: %d" % len(fail))
raise SystemExit(1 if fail else 0)
