# Patch 16: stop the UI jank while background experiments run.
# Measured on the live page: during a lab session fps drops to 8-12 with
# 100-250ms long tasks at ~2.5Hz. Sources, in order of impact:
#   1. "progress" worker messages (every 400ms) did full DOM updates
#      (status + spark canvas + verdict chips + broadcast) on EVERY message.
#   2. appPump ran strictly via rAF and did DOM writes every tick while the
#      apparatus stage was on screen - competing with the 3D fly render.
#   3. e9BatchHudHtml rebuilt an SVG from up to ~200 sweep points on every
#      e9 frame and every 2s poll.
#   4. The 2s e9 training-sweep poll re-broadcast the WHOLE sweep JSON
#      (hundreds of KB) on the plots BroadcastChannel every 2s, forever.
# Strategy: pace UI work on setTimeout so it never fights the 3D render
# loop; redraw only when data changed; broadcast only on change.
import io, sys

P = "fly_demon_3d.html"
src = io.open(P, encoding="utf-8").read()
n0 = len(src)
edits = []

# --------------------------------------------------- 1) progress msg pacing --
MD = "\u00b7"   # middle dot, kept as a variable so no anchor line depends on it
old = (
'    if (m.type === "progress") {\n'
'      const appMeta = APPARATUS_META[expId];\n'
'      if (appMeta) appActivate(appMeta.env);\n'
'      window.EXP = window.EXP || {};\n'
'      EXP.activeId = expId;\n'
'      EXP.activeKind = ({ e2: "learning", e3: "learning", e4: "learning",\n'
'                          e5: "learning", e7: "sensory", e8: "gate" })[expId] || null;\n'
'      setStatus(expId, "running",\n'
'        `${m.phase} ${m.trial + 1}/${m.nTrials} ' + MD + ' seed ${m.seedIdx + 1}/${m.nSeeds}`);\n'
'      drawSpark(cards[expId].querySelector(".exp-spark"), m.curve || []);\n'
'      if (APPARATUS_META[expId]) clearVerdicts(expId);\n'
'      else renderVerdicts(expId, m.curve || []);\n'
'      CH.postMessage({ kind: "plots", type: "progress", expId,\n'
'                       label: m.label || expId.toUpperCase(), curve: m.curve,\n'
'                       phase: m.phase, trial: m.trial, nTrials: m.nTrials,\n'
'                       seedIdx: m.seedIdx, nSeeds: m.nSeeds });\n'
'    } else if (m.type === "done") {'
)
new = (
'    if (m.type === "progress") {\n'
'      // (patch 16) full-speed sim made the page jerky: pace the canvas + DOM +\n'
'      // broadcast work on a timer instead of per-message, and skip redraws\n'
'      // when nothing visible changed. The status line still updates per beat.\n'
'      const appMeta = APPARATUS_META[expId];\n'
'      if (appMeta) appActivate(appMeta.env);\n'
'      window.EXP = window.EXP || {};\n'
'      EXP.activeId = expId;\n'
'      EXP.activeKind = ({ e2: "learning", e3: "learning", e4: "learning",\n'
'                          e5: "learning", e7: "sensory", e8: "gate" })[expId] || null;\n'
'      const label = `${m.phase} ${m.trial + 1}/${m.nTrials} ' + MD + ' seed ${m.seedIdx + 1}/${m.nSeeds}`;\n'
'      const changed = m.curve !== EXP_UI.lastCurve[expId];\n'
'      const sig = label + (changed ? "|*" : "|=");\n'
'      setStatus(expId, "running", label);\n'
'      EXP_UI.pending[expId] = { m, label, sig, changed };\n'
'      if (!EXP_UI.timer[expId]) {\n'
'        EXP_UI.timer[expId] = setTimeout(() => {\n'
'          const p = EXP_UI.pending[expId];\n'
'          delete EXP_UI.pending[expId]; delete EXP_UI.timer[expId];\n'
'          if (!p) return;\n'
'          if (p.sig === EXP_UI.lastSig[p.m.expId]) return;   // nothing new to draw\n'
'          EXP_UI.lastSig[p.m.expId] = p.sig;\n'
'          drawSpark(cards[p.m.expId].querySelector(".exp-spark"), p.m.curve || []);\n'
'          if (APPARATUS_META[p.m.expId]) clearVerdicts(p.m.expId);\n'
'          else renderVerdicts(p.m.expId, p.m.curve || []);\n'
'          CH.postMessage({ kind: "plots", type: "progress", expId: p.m.expId,\n'
'                           label: p.m.label || p.m.expId.toUpperCase(), curve: p.m.curve,\n'
'                           phase: p.m.phase, trial: p.m.trial, nTrials: p.m.nTrials,\n'
'                           seedIdx: p.m.seedIdx, nSeeds: p.m.nSeeds });\n'
'          if (p.changed) EXP_UI.lastCurve[p.m.expId] = p.m.curve;\n'
'        }, 300);\n'
'      }\n'
'    } else if (m.type === "done") {'
)
edits.append(("progress pacing", old, new))

# EXP_UI pacing store next to the queue state
old = ('  let worker = null, current = null;\n'
       '  const queue = [];')
new = ('  let worker = null, current = null;\n'
       '  const queue = [];\n'
       '  // (patch 16) per-experiment UI pacing + change-detection for progress msgs\n'
       '  const EXP_UI = { timer: {}, pending: {}, lastSig: {}, lastCurve: {}; };')
edits.append(("EXP_UI store", old, new.replace('; };', ' }')))

# -------------------------------------------------------- 2) appPump pacing --
old = ('    appGuestsIdle(cur ? cur.state : null);\n'
       '    appHud().innerHTML = "apparatus replay \u00d7" + APP_REPLAY +\n'
       '      " \u00b7 <b>" + (cur ? cur.state.cond : "") + "</b> \u00b7 t=" +\n'
       '      (cur ? cur.state.t.toFixed(1) : "0") + "s \u00b7 ESC = exit";\n'
       '    if (appPlay.active === "pressure") e9HudUpdate(cur ? cur.state : null);')
new = ('    appGuestsIdle(cur ? cur.state : null);\n'
       '    // (patch 16) one DOM write per change, not per tick\n'
       '    const hudTxt = "apparatus replay \u00d7" + APP_REPLAY +\n'
       '      " \u00b7 <b>" + (cur ? cur.state.cond : "") + "</b> \u00b7 t=" +\n'
       '      (cur ? cur.state.t.toFixed(1) : "0") + "s \u00b7 ESC = exit";\n'
       '    if (hudTxt !== appPlay.lastHud) { appHud().innerHTML = hudTxt; appPlay.lastHud = hudTxt; }\n'
       '    if (appPlay.active === "pressure") e9HudUpdate(cur ? cur.state : null);')
edits.append(("appPump hud write", old, new))

old = ('    appPlay.raf = requestAnimationFrame(appPump);\n'
       '  }')
new = ('    // (patch 16) timer-paced instead of rAF-paced: the replay updates on its\n'
       '    // own ~24fps clock and never competes with the 3D fly render loop.\n'
       '    appPlay.raf = setTimeout(appPump, 42);\n'
       '  }')
edits.append(("appPump timer", old, new))

old = ('    if (appPlay.raf) { cancelAnimationFrame(appPlay.raf); appPlay.raf = 0; }\n'
       '    appPlay.buf = []; appPlay.active = null; appPlay.idx = 0;')
new = ('    if (appPlay.raf) { clearTimeout(appPlay.raf); appPlay.raf = 0; }\n'
       '    appPlay.buf = []; appPlay.active = null; appPlay.idx = 0; appPlay.lastHud = "";')
edits.append(("appRestore clear", old, new))

# --------------------------------------------------- 3) e9 HUD SVG caching ---
# ASCII-only anchor: wrap the builder so the SVG html is cached per payload.
old = '  function e9BatchHudHtml(B) {\n'
new = ('  function e9BatchHudHtml(B) {   // (patch 16) caching wrapper\n'
       '    if (B && B.__hudHtml) return B.__hudHtml;\n'
       '    const __html = e9BatchHudHtmlBuild(B);\n'
       '    try { if (B && __html) B.__hudHtml = __html; } catch (e) {}\n'
       '    return __html;\n'
       '  }\n'
       '  function e9BatchHudHtmlBuild(B) {\n')
edits.append(("hud wrapper", old, new))

# ------------------------------------------- 4) broadcast only when changed --
old = ('  function e9BatchApply(j) {\n'
       '    E9_BATCH.last = j;\n'
       '    if (E9_BATCH.bc) {\n'
       '      try {')
new = ('  function e9BatchApply(j) {\n'
       '    // (patch 16) broadcast only when the sweep file actually changed; the old\n'
       '    // code re-posted the full (hundreds-of-KB) sweep JSON every 2s forever,\n'
       '    // waking every plots-window listener and churning GC for nothing.\n'
       '    const __changed = !E9_BATCH.last || j.episode !== E9_BATCH.last.episode ||\n'
       '      j.seedsComplete !== E9_BATCH.last.seedsComplete ||\n'
       '      j.timestamp !== E9_BATCH.last.timestamp ||\n'
       '      (j.points || []).length !== (E9_BATCH.last.points || []).length;\n'
       '    E9_BATCH.last = j;\n'
       '    if (!__changed) return;\n'
       '    if (E9_BATCH.bc) {\n'
       '      try {')
edits.append(("poll change-gate", old, new))

# ------------------------------------------------------------------- apply --
count = 0
for name, oldS, newS in edits:
    c = src.count(oldS)
    if c != 1:
        print("FAIL [%s]: found %d matches" % (name, c))
        sys.exit(1)
    src = src.replace(oldS, newS)
    count += 1

io.open(P, "w", encoding="utf-8", newline="").write(src)
print("patched %s: %d edits, %+d chars" % (P, count, len(src) - n0))
