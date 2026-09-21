# Patch 20: perf HUD badge + adaptive quality. A dedicated rAF loop measures
# real inter-frame gaps (captures every stall source: worker messages, GC,
# done-payload processing). The badge shows avg frame interval, worst hitch in
# the window, brain-worker ticks/s and JS heap; click toggles it. Adaptive
# pixel ratio degrades render resolution when the frame budget is exceeded
# (4s @ >30ms avg) and restores it when comfortably fast (10s @ <15ms avg).
import io, sys

P = "fly_demon_3d.html"
src = io.open(P, encoding="utf-8").read()
n0 = len(src)
fail = []
def rep(old, new, tag):
    global src
    if src.count(old) != 1:
        fail.append((tag, src.count(old)))
        return
    src = src.replace(old, new)

# ---------------------------------------------------------------------------
# 1) badge markup next to the fps badge (click to toggle)
old = '  <span class="badge" id="fps">\u2014 fps</span>\n'
new = ('  <span class="badge" id="fps">\u2014 fps</span>\n'
       '  <span class="badge" id="perf" title="avg frame interval \\u00b7 worst hitch this second \\u00b7 brain worker ticks/s \\u00b7 JS heap (click to hide/show)">\u2026</span>\n')
rep(old, new, "badge-html")

# ---------------------------------------------------------------------------
# 2) brain-worker tick counter in the patch-19 bridge (for the HUD readout)
old = """        if (m.type==="state"){
          const ret = s._bwAvail;
"""
new = """        if (m.type==="state"){
          s._bwTicks = (s._bwTicks || 0) + 1;    // (patch 20) perf HUD readout
          const ret = s._bwAvail;
"""
rep(old, new, "bw-ticks")

# ---------------------------------------------------------------------------
# 3) perf HUD + adaptive pixel ratio, installed right before the loop starts
old = """  requestAnimationFrame(frame);
  msg(\"\u2640 FAFB v783 online \u2014 the fly is on the wall, the demon is watching\", 3200);
"""
new = """  // ---- perf HUD + adaptive quality (patch 20) ---------------------------
  // Own rAF loop: inter-frame gaps reflect true pacing including worker
  // messages, GC and done-payload bursts. DPR is the cheapest quality lever
  // for this fill-rate-bound scene; changes are stepped and announced.
  const perfHud = { el: document.getElementById("perf"), on: true,
    frames: 0, sumMs: 0, hitches: 0, worst: 0,
    lastSample: performance.now(), lastBw: 0, lastAvgGap: 0,
    lowRun: 0, highRun: 0,
    dpr: Math.min(devicePixelRatio || 1, 2),
    dprMax: Math.min(devicePixelRatio || 1, 2) };
  perfHud.el.style.cursor = "pointer";
  perfHud.el.addEventListener("click", () => {
    perfHud.on = !perfHud.on;
    perfHud.el.style.opacity = perfHud.on ? "1" : "0.45";
    if (!perfHud.on) perfHud.el.textContent = "perf off";
  });
  function perfApplyDpr() {
    renderer.setPixelRatio(perfHud.dpr);
    renderer.setSize(innerWidth, innerHeight);
  }
  let perfLastT = 0;
  function perfLoop(now) {
    requestAnimationFrame(perfLoop);
    if (perfLastT) {
      const gap = now - perfLastT;
      perfHud.frames++; perfHud.sumMs += gap;
      if (gap > 40) perfHud.hitches++;
      if (gap > perfHud.worst) perfHud.worst = gap;
    }
    perfLastT = now;
    if (now - perfHud.lastSample < 1000) return;
    const avg = perfHud.frames ? perfHud.sumMs / perfHud.frames : 0;
    perfHud.lastAvgGap = avg;
    const bwTicks = (sim && sim._bwTicks) ? sim._bwTicks - perfHud.lastBw : 0;
    if (sim) perfHud.lastBw = sim._bwTicks || 0;
    if (perfHud.on) {
      const heap = (performance.memory && performance.memory.usedJSHeapSize)
        ? " \\u00b7 " + (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + "MB" : "";
      perfHud.el.textContent = avg.toFixed(1) + "ms \\u00b7 max "
        + perfHud.worst.toFixed(0) + "ms \\u00b7 bw " + bwTicks + "/s" + heap;
      perfHud.el.style.color = avg > 34 ? "#ff7b72" : avg > 22 ? "#ffd23a" : "#8cff9a";
    }
    // adaptive resolution: degrade after 4s of >30ms average, restore after
    // 10s of <15ms average (hysteresis prevents oscillation)
    if (avg > 30) { perfHud.lowRun++; perfHud.highRun = 0; }
    else if (avg < 15) { perfHud.highRun++; perfHud.lowRun = 0; }
    else { perfHud.lowRun = 0; perfHud.highRun = 0; }
    if (perfHud.lowRun >= 4 && perfHud.dpr > 0.75) {
      perfHud.dpr = Math.max(0.75, perfHud.dpr - 0.25);
      perfApplyDpr();
      msg("perf: render resolution lowered to " + perfHud.dpr.toFixed(2) + "x to hold the frame budget", 2600);
      perfHud.lowRun = 0;
    } else if (perfHud.highRun >= 10 && perfHud.dpr < perfHud.dprMax) {
      perfHud.dpr = Math.min(perfHud.dprMax, perfHud.dpr + 0.25);
      perfApplyDpr();
      msg("perf: render resolution restored to " + perfHud.dpr.toFixed(2) + "x", 2600);
      perfHud.highRun = 0;
    }
    perfHud.frames = 0; perfHud.sumMs = 0; perfHud.hitches = 0; perfHud.worst = 0;
    perfHud.lastSample = now;
  }
  window.__perfHud = perfHud;
  requestAnimationFrame(perfLoop);
  requestAnimationFrame(frame);
  msg(\"\u2640 FAFB v783 online \u2014 the fly is on the wall, the demon is watching\", 3200);
"""
rep(old, new, "perf-hud")

# ---------------------------------------------------------------------------
if fail:
    print("FAILED anchors:")
    for t, c in fail: print("  ", t, "count=", c)
    sys.exit(1)
io.open(P, "w", encoding="utf-8", newline="").write(src)
print("patched", P, "+", len(src)-n0, "chars")
