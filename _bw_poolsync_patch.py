# (patch 20c) publish-pool fix: the page held worker buffers as TypedArray VIEWS
# and tried to transfer the views back - TypedArrays are not transferable, so
# the postMessage threw DataCloneError inside catch(e){} and the buffers never
# returned. The worker's publish pool starved and it self-healed at ~0.66
# publishes/s (the perf badge read "bw 1/s"). Return the underlying ArrayBuffers
# instead; worker accepts views-or-buffers defensively and caps pool growth.
import io

def edit(path, pairs):
    s = io.open(path, encoding="utf-8").read()
    n0 = len(s)
    for old, new in pairs:
        assert s.count(old) == 1, "%s: anchor x%d: %r" % (path, s.count(old), old[:70])
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(s)
    print("patched %s: %+d chars, %d edits" % (path, len(s) - n0, len(pairs)))

# ---- page side ----
REPLAY_OLD = '            try { w.postMessage({ type:"buffers", spikes:m.spikes }, [m.spikes]); } catch(e){}'
REPLAY_NEW = '            try { const rb2 = m.spikes.buffer || m.spikes; w.postMessage({ type:"buffers", spikes:rb2 }, [rb2]); } catch(e){}'

edit("fly_demon_3d.html", [
    # 1) mirror-return: transfer the ArrayBuffer, not the Uint8Array view
    ('          const ret = s._bwAvail;\n          if (ret) { try { w.postMessage({ type:"buffers", spikes:ret }, [ret]); } catch(e){} }',
     '          const ret = s._bwAvail;\n          if (ret && ret.buffer) { try { const rb = ret.buffer; w.postMessage({ type:"buffers", spikes:rb }, [rb]); } catch(e){} }'),
    # 2) replay branch: same view-vs-buffer bug
    (REPLAY_OLD, REPLAY_NEW),
    # 2b) drop the stale mirror reference while replay owns the bitmap
    ('          } else {\n            // trial replay owns the bitmap: hand the fresh frame straight back\n' + REPLAY_NEW + '\n          }',
     '          } else {\n            // trial replay owns the bitmap: hand the fresh frame straight back\n' + REPLAY_NEW + '\n            s._bwAvail = null;   // replay owns s.spikes; mirror ref would go stale\n          }'),
    # 3) weight-return: same fix
    ('            if (oldW) { try { w.postMessage({ type:"buffers", W:oldW }, [oldW]); } catch(e){} }',
     '            if (oldW && oldW.buffer) { try { const wb2 = oldW.buffer; w.postMessage({ type:"buffers", W:wb2 }, [wb2]); } catch(e){} }'),
])

# ---- worker side: accept views or buffers, cap pool growth ----
edit("brain_worker.js", [
    ('      if (m.spikes && m.spikes.byteLength === S.N) spikePool.push(m.spikes);\n      if (m.W && m.W.byteLength === S.NE * 4) wPool.push(m.W);',
     '      const sb = m.spikes && (m.spikes.buffer || m.spikes);   // view or ArrayBuffer\n      if (sb && sb.byteLength === S.N && spikePool.length < 8) spikePool.push(sb);\n      const wb = m.W && (m.W.buffer || m.W);\n      if (wb && wb.byteLength === S.NE * 4 && wPool.length < 4) wPool.push(wb);'),
])
