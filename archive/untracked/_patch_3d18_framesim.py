# Patch 18: cut the per-frame cost of the default world so background
# experiments stop starving the render loop.
# Measured: frame() averages 46ms idle and ~80ms during runs (hitches >40ms
# at ~10/s). The 106k-neuron brainTick runs every frame, and the default
# world keeps simulating even while an apparatus replay owns the screen.
#   1. brainTick + traces + learning + neuropil heat at 30Hz (every 2nd
#      frame). Spike heat decays over ~1s, so half rate is indistinguishable.
#   2. When window.__appScene.__playing is set (apparatus stage active and
#      the default world hidden), skip default-world simulation entirely -
#      camera + render still run.
import io, sys

P = "fly_demon_3d.html"
src = io.open(P, encoding="utf-8").read()
n0 = len(src)
edits = []

EP = "\u2014"   # em dash used inside the episode toast strings

edits.append(("parity decl",
 'function frame(now){\n'
 '  requestAnimationFrame(frame);',
 'let _simParity = 0;   // (patch 18) brain sim runs at 30Hz (every 2nd frame)\n'
 'function frame(now){\n'
 '  requestAnimationFrame(frame);'))

old = (
'  // brain\n'
'  const sens = readSensors(Tl, Tr, doorH);\n'
'  const visual = readVisualField();\n'
'  const motorIn = MODE==="brain"?0.35:0.15;\n'
'  exSlVal = parseFloat($("exSl").value);\n'
'  brainTick(sens, visual, motorIn, MODE==="brain"?exSlVal:0.3);\n'
'  updateTraces();\n'
'  if (!sim || !sim.layers) return;   // boot race: sim not constructed yet\n'
'  sim.motorRateSmooth = sim.motorRateSmooth*0.85 + (motorRate()/Math.max(dt,1e-3))*0.15;\n'
'  sim.motorBase += (sim.motorRateSmooth-sim.motorBase)*clamp(dt*0.1,0,1);\n'
'  applyLearning(parseFloat($("lr").value) * (assist?-1:1));\n'
'\n'
'  actuate(dt);\n'
'  epTime+=dt;\n'
'  if (epTime>EP_LEN){ epTime=0; bestDT=0; $("bestVal").textContent="0.00";\n'
'    msg(assist? "new episode ' + EP + ' fly keeps fighting the demon" : "new episode ' + EP + ' weights kept"); }\n'
'\n'
'  updateVisuals(dt, doorH);\n'
'  updateHUD(Tl, Tr, dT);\n'
'  lcPanelFrame(dt);\n'
'  if (typeof sciFrame==="function") sciFrame(dt);\n'
'  if (typeof expFrame === "function") expFrame(sens, visual);\n'
'  tick++;\n'
'  renderer.render(scene, camera);\n'
'}')
new = (
'  // (patch 18) sensor reads stay per-frame (cheap, 320 particles) so the\n'
'  // comparison overlays keep updating; the expensive brain tick is gated.\n'
'  const sens = readSensors(Tl, Tr, doorH);\n'
'  const visual = readVisualField();\n'
'  _simParity = 1 - _simParity;\n'
'\n'
'  // (patch 18) apparatus stages own the screen during E9/E10/E11 replays\n'
'  // (default world hidden): skip its simulation entirely - camera + render\n'
'  // still run, so the replay stays smooth while the worker crunches.\n'
'  if (!window.__appScene || !window.__appScene.__playing) {\n'
'    const motorIn = MODE==="brain"?0.35:0.15;\n'
'    exSlVal = parseFloat($("exSl").value);\n'
'    if (_simParity === 0) {\n'
'      brainTick(sens, visual, motorIn, MODE==="brain"?exSlVal:0.3);\n'
'      updateTraces();\n'
'      if (!sim || !sim.layers) return;   // boot race: sim not constructed yet\n'
'      sim.motorRateSmooth = sim.motorRateSmooth*0.85 + (motorRate()/Math.max(dt,1e-3))*0.15;\n'
'      sim.motorBase += (sim.motorRateSmooth-sim.motorBase)*clamp(dt*0.1,0,1);\n'
'      applyLearning(parseFloat($("lr").value) * (assist?-1:1));\n'
'      lcPanelFrame(dt);\n'
'    }\n'
'\n'
'    actuate(dt);\n'
'    epTime+=dt;\n'
'    if (epTime>EP_LEN){ epTime=0; bestDT=0; $("bestVal").textContent="0.00";\n'
'      msg(assist? "new episode ' + EP + ' fly keeps fighting the demon" : "new episode ' + EP + ' weights kept"); }\n'
'\n'
'    updateVisuals(dt, doorH);\n'
'    updateHUD(Tl, Tr, dT);\n'
'    if (typeof sciFrame==="function") sciFrame(dt);\n'
'    if (typeof expFrame === "function") expFrame(sens, visual);\n'
'  }\n'
'  tick++;\n'
'  renderer.render(scene, camera);\n'
'}')
edits.append(("frame gating", old, new))

count = 0
for name, oldS, newS in edits:
    c = src.count(oldS)
    if c != 1:
        print("FAIL [%s]: found %d matches" % (name, c)); sys.exit(1)
    src = src.replace(oldS, newS)
    count += 1

io.open(P, "w", encoding="utf-8", newline="").write(src)
print("patched: %d edits, %+d chars" % (count, len(src) - n0))
