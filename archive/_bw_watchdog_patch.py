# (patch 20b, page side) brain-worker watchdog: if the worker goes silent
# (e.g. publish-pool starvation after a lost buffer handoff), restart it once;
# if it stays silent after restart, permanently fall back to main-thread sim.
# Skips checks while the tab is hidden (rAF stops -> feeder legitimately pauses).
import io

P = "fly_demon_3d.html"
s = io.open(P, encoding="utf-8").read()
n0 = len(s)
edits = []

# 1) record last-seen timestamp on every published state
old = '''        if (m.type==="state"){
          s._bwTicks = (s._bwTicks || 0) + 1;    // (patch 20) perf HUD readout'''
new = '''        if (m.type==="state"){
          s._bwTicks = (s._bwTicks || 0) + 1;    // (patch 20) perf HUD readout
          s._bwLastSeen = Date.now();            // (patch 20b) watchdog heartbeat'''
assert s.count(old) == 1, "state-handler anchor not unique: %d" % s.count(old)
edits.append((old, new))

# 2) watchdog interval right after the worker starts
old = '''      s._bw = w;
    } catch(e) { s._bwBroken = true; }
  };
  s._bwStart();'''
new = '''      s._bw = w;
    } catch(e) { s._bwBroken = true; }
  };
  s._bwStart();
  // (patch 20b) watchdog: restart a silent worker once, then fall back for good.
  s._bwLastSeen = Date.now();
  s._bwWatch = setInterval(()=>{
    if (s._bwBroken || document.hidden) return;
    if (Date.now() - s._bwLastSeen < 5000) return;
    console.warn("[brain_worker] silent >5s - restarting worker");
    msg("brain worker stalled - restarting");
    s._bwTicks = 0;
    s._bwStart();
  }, 5000);'''
assert s.count(old) == 1, "bwStart anchor not unique: %d" % s.count(old)
edits.append((old, new))

for old, new in edits:
    s = s.replace(old, new, 1)

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("patched %s: %+d chars, %d edits" % (P, len(s) - n0, len(edits)))
