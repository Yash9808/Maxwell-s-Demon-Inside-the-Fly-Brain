"""_check_exp14.py — structural audit for the E9/E10/E11 apparatus expansion."""
import re, sys

fails = 0
def chk(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  [" + str(detail) + "]") if detail else ""))
    if not ok: fails += 1

lab = open("fly_demon_3d.html", encoding="utf-8").read()
plots = open("experiment_plots.html", encoding="utf-8").read()
worker = open("experiment_worker.js", encoding="utf-8").read()
core = open("experiment_core.js", encoding="utf-8").read()

# ---- registry ---------------------------------------------------------------
for eid, fn, env in [("e9", "pressureDemonCore", "pressure"),
                     ("e10", "smoluchowskiCore", "trapdoor"),
                     ("e11", "feynmanRatchetCore", "ratchet")]:
    i = worker.find("  " + eid + ": {")
    ok = i > 0
    chk("registry " + eid, ok)
    if ok:
        j = worker.find("\n  e", i + 5)          # next top-level entry
        b = worker[i:j if j > i else i + 900]
        chk("registry " + eid + " apparatus=" + fn, ('apparatus: "' + fn + '"') in b)
        chk("registry " + eid + " env=" + env, ('apparatusEnv: "' + env + '"') in b)
        chk("registry " + eid + " needsCircuit false", "needsCircuit: false" in b)

chk("worker apparatus branch", "if (spec.apparatus) {" in worker)
chk("worker app_state message", 'type: "app_state"' in worker)
chk("worker flat rows sent", "rows: flatRows" in worker)
chk("worker generic curve", "function buildApparatusCurve(" in worker)
chk("worker dT alias", "pt.dT = pt.dTfinal" in worker)

# ---- cores -------------------------------------------------------------------
chk("core pressureDemonCore", "function pressureDemonCore(" in core)
chk("core smoluchowskiCore", "function smoluchowskiCore(" in core)
chk("core feynmanRatchetCore", "function feynmanRatchetCore(" in core)
chk("core thermal walls", "function _thermoWalls(" in core)
chk("core burn-in E9", "const BURN = Math.round((cfg.burnSeconds !== undefined ? cfg.burnSeconds : 10) / dt);" in core)
chk("core thermal leak is weak", "0.0008 * dt * 60" in core)
chk("core exports apparatus", "pressureDemonCore, smoluchowskiCore, feynmanRatchetCore" in core)

# ---- lab page: cards + labs ---------------------------------------------------
m = re.search(r'<details class="exp-lab" data-lab="demon"[^>]*>(.*?)</details>', lab, re.S)
chk("DEMON LAB details exists", bool(m))
if m:
    block = m.group(1)
    for eid in ["e1", "e6", "e7", "e9", "e10", "e11"]:
        chk("DEMON LAB contains " + eid, ('data-exp="' + eid + '"') in block)
m = re.search(r'<details class="exp-lab" data-lab="information"[^>]*>(.*?)</details>', lab, re.S)
chk("INFORMATION LAB intact", bool(m) and all(('data-exp="%s"' % e) in m.group(1) for e in ["e2", "e8"]))
m = re.search(r'<details class="exp-lab" data-lab="flybrain"[^>]*>(.*?)</details>', lab, re.S)
chk("FLY BRAIN intact", bool(m) and all(('data-exp="%s"' % e) in m.group(1) for e in ["e3", "e4", "e5"]))
ids = re.findall(r'data-exp="(e\d+|chat)"', lab)
chk("card ids unique", len(ids) == len(set(ids)), str(len(ids)) + " cards")
chk("E1-E8 cards untouched count", len([i for i in ids if i in
    ["e1","e2","e3","e4","e5","e6","e7","e8"]]) == 8)

# ---- lab page: stages + wiring ------------------------------------------------
for token in ["APP_STAGE_Y = -2600", "buildPressureStage", "buildTrapdoorStage",
              "buildRatchetStage", "function appActivate(", "function appRestore(",
              "function appFeed(", 'm.type === "app_state"', "APPARATUS_META",
              'addEventListener("keydown", (e) => {', "Escape"]:
    chk("lab has " + token, token in lab)
chk("stage y remote (no default-scene interference)", 'grp.position.set(0, APP_STAGE_Y, 0)' in lab)
chk("camera saved before switch", "__camSave.orbit" in lab)
chk("done keeps apparatus counts", "APPARATUS_META[expId]" in lab)
chk("chat card still last", lab.find('data-exp="chat"') > lab.find('data-exp="e11"'))

# ---- plots page ----------------------------------------------------------------
for token in ["const APP_SPEC", "function renderApparatus(", "e9: {", "e10: {", "e11: {",
              "Results by laboratory", "renderLabBoard", "LAB_STATE"]:
    chk("plots has " + token, token in plots)
chk("plots e9 spec has piston+work", "pistonX" in plots and "netWorkJ" in plots)
chk("plots e10 spec has door+counts", "trapdoorAngle" in plots and "leftCount" in plots)
chk("plots e11 spec has rotation+efficiency", "netPerEpisode" in plots and "efficiency" in plots)
chk("plots guards eff", "if (c.testWorkInJ && c.testExtractableJ && c.testWorkInJ.mean > 0)" in plots)
mb = re.search(r"const LABS = \[(.*?)\n\];", plots, re.S)
chk("plots LABS board found", bool(mb))
if mb:
    chk("plots board demon-lab first", mb.group(1).find('"e9"') < mb.group(1).find('"e2"'))
    chk("plots board has all 11", all(('"e%d"' % n) in mb.group(1) for n in range(1, 12)))

# ---- regression: E1-E8 spec untouched in worker ---------------------------------
m = re.search(r"const EXPERIMENTS = \{(.*?)\n\};", worker, re.S)
chk("EXPERIMENTS registry found", bool(m))
if m:
    reg = m.group(1)
    for eid, lbl in [("e1", "Classical Maxwell Demon"), ("e2", "Artificial Neural Demon"),
                     ("e3", "Drosophila-Inspired Network"), ("e4", "Connectome-Constrained"),
                     ("e5", "Full Comparator Study"), ("e6", "Jet-Closure Paradox"),
                     ("e7", "Generalization Sweep"), ("e8", "Information-Limited Demons")]:
        chk("registry keeps " + eid, eid in reg)
        chk("  label " + eid, lbl in reg)

print("----")
print(("FAIL " + str(fails)) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
