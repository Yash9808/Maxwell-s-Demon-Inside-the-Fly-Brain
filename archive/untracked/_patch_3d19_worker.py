# Patch 19: move the 106k-neuron brain simulation into brain_worker.js so the
# 3D fly holds ~60fps at idle. The main page keeps MIRRORED state (spikes
# bitmap + plastic weights + DA/motor scalars) updated by zero-copy
# transferable buffers, so every existing consumer (point cloud, heat maps,
# replay, HUD, region stats, learning panel) reads sim.spikes / sim.W
# unchanged. Falls back to the legacy in-frame tick if the worker can't start.
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
# 1) makeSim gains the worker plumbing and boots the simulation worker.
#    Edge arrays stay on the main thread (replay + plasticity panel index
#    them); the worker gets its own copies. The optic channel table is built
#    here from circuit.optic_channels (already normalized u/v pairs).
old = """  return { circuit, layers, N, NE, layerStart, V, spikes, refac,
           src, dst, W, W0, isExc, plastic, E, WS,
           DA:{v:0}, motorRateSmooth:0, motorBase:0 };
}
let sim = null;
"""
new = """  const s = { circuit, layers, N, NE, layerStart, V, spikes, refac,
           src, dst, W, W0, isExc, plastic, E, WS,
           DA:{v:0}, motorRateSmooth:0, motorBase:0,
           _bw:null, _bwReady:false, _bwBroken:false, _bwNext:0, _bwLast:null,
           _bwAvail:null, _bwWAvail:null };
  s._bwStart = ()=>{ try {
      if (s._bw) { try { s._bw.terminate(); } catch(e){} s._bw = null; }
      const w = new Worker("brain_worker.js");
      const off = [0]; for (const l of layers) off.push(off[off.length-1] + l.length);
      const memb = new Int32Array(off[off.length-1]);
      layers.forEach((l,li)=> memb.set(l, off[li]));
      const w0 = new Float32Array(NE), sign = new Uint8Array(NE);
      for (let i=0;i<NE;i++){ w0[i]=W0[i]; sign[i]=isExc[i]; }
      let opticChan = null;
      const oLayer = circuit.optic_layer ?? -1;
      if (oLayer >= 0 && layers[oLayer] && circuit.optic_channels){
        const optic = layers[oLayer], om = circuit.optic_channels;
        opticChan = new Uint8Array(optic.length);
        for (let k=0;k<optic.length;k++){
          const f = om[String(optic[k])];
          opticChan[k] = f ? Math.min(7, (f[0]*4|0) + ((f[1]*2|0)*4)) : (k % 8);
        }
      }
      const stimLayers = [0,1].filter(li => li < layers.length);
      w.postMessage({ type:"init", N, NE, members:memb, layerOff:off,
        src:s.src, dst:s.dst, w0, sign, opticChan, opticLayer:oLayer,
        stimLayers }, [memb.buffer, w0.buffer, sign.buffer]);
      w.onmessage = (ev)=>{
        const m = ev.data;
        if (m.type==="state"){
          const ret = s._bwAvail;
          if (ret) { try { w.postMessage({ type:"buffers", spikes:ret }, [ret]); } catch(e){} }
          let replaying = false;
          try { replaying = RP.playing || RP.pos >= 0; } catch(e){}
          if (!replaying){
            s.spikes = m.spikes;               // mirrored bitmap (worker-owned)
            s.DA.v = m.dav; s.motorRateSmooth = m.mrs; s.motorBase = m.mb;
            s._bwAvail = m.spikes;
          } else {
            // trial replay owns the bitmap: hand the fresh frame straight back
            try { w.postMessage({ type:"buffers", spikes:m.spikes }, [m.spikes]); } catch(e){}
          }
          if (m.W){
            const oldW = s._bwWAvail;
            if (!replaying) s.W = m.W;
            s._bwWAvail = m.W;
            if (oldW) { try { w.postMessage({ type:"buffers", W:oldW }, [oldW]); } catch(e){} }
          }
        } else if (m.type==="ready"){
          s._bwReady = true;
          msg("brain sim in worker \\u2014 " + s.N.toLocaleString() + " neurons off the render thread");
        } else if (m.type==="error"){
          console.error("[brain_worker]", m.message);
          msg("worker brain failed \\u2014 falling back to main-thread sim");
          s._bwReady = false; s._bwBroken = true;
        }
      };
      w.onerror = (e)=>{ console.error("[brain_worker]", e.message||e);
        s._bwReady = false; s._bwBroken = true; };
      s._bw = w;
    } catch(e) { s._bwBroken = true; }
  };
  s._bwStart();
  return s;
}
let sim = null;
"""
rep(old, new, "makeSim")

# ---------------------------------------------------------------------------
# 2) brainTick: worker feeder first; legacy in-frame body kept as fallback.
old = """function brainTick(s, visual, motorDrive, exAmp){
  if (!sim || !sim.layers) return;   // boot race: frame loop can start before sim exists
  const { layers, layerStart, V, refac, N } = sim;
"""
new = """function brainTick(s, visual, motorDrive, exAmp){
  if (!sim || !sim.layers) return;   // boot race: frame loop can start before sim exists
  // (patch 19) worker path: ship a cheap input packet (~30Hz); the 563k-edge
  // connectome tick + plasticity run in brain_worker.js. Falls through to the
  // legacy in-frame body below if the worker is unavailable.
  if (sim._bw && sim._bwReady && !sim._bwBroken){
    const nowT = performance.now();
    if (!sim._bwLast) sim._bwLast = { s:new Float32Array(7), v:new Float32Array(8), ex:0, md:0.35 };
    const L = sim._bwLast;
    for (let i=0;i<7;i++) L.s[i] = (s && s.length>i) ? s[i] : L.s[i];
    for (let i=0;i<8;i++) L.v[i] = (visual && visual.length>i) ? visual[i] : L.v[i];
    L.ex = exAmp; L.md = motorDrive;
    if (nowT >= sim._bwNext){
      sim._bwNext = nowT + 33;
      sim._bw.postMessage({ type:"tick", s:L.s, visual:L.v, motorDrive:L.md,
        exAmp:L.ex, lr: parseFloat($("lr").value)*(assist?-1:1), dt:0.016 });
    }
    return;
  }
  const { layers, layerStart, V, refac, N } = sim;
"""
rep(old, new, "brainTick-head")

# ---------------------------------------------------------------------------
# 3) frame(): the brain tick runs always (worker keeps telemetry warm during
#    apparatus replays); actuate/HUD/world visuals stay gated to replays.
#    Legacy scalar updates + learning run only in fallback mode.
old = """  if (!window.__appScene || !window.__appScene.__playing) {
    const motorIn = MODE==="brain"?0.35:0.15;
    exSlVal = parseFloat($("exSl").value);
    if (_simParity === 0) {
      brainTick(sens, visual, motorIn, MODE==="brain"?exSlVal:0.3);
      updateTraces();
      if (!sim || !sim.layers) return;   // boot race: sim not constructed yet
      sim.motorRateSmooth = sim.motorRateSmooth*0.85 + (motorRate()/Math.max(dt,1e-3))*0.15;
      sim.motorBase += (sim.motorRateSmooth-sim.motorBase)*clamp(dt*0.1,0,1);
      applyLearning(parseFloat($("lr").value) * (assist?-1:1));
      lcPanelFrame(dt);
    }

    actuate(dt);
"""
new = """  { // (patch 19) the brain sim lives in brain_worker.js now: it keeps ticking
    // even while an apparatus replay owns the screen (telemetry + plots stay
    // warm). World visuals/actuation still pause during replays.
    const motorIn = MODE==="brain"?0.35:0.15;
    exSlVal = parseFloat($("exSl").value);
    const bwLive = sim && sim._bw && sim._bwReady && !sim._bwBroken;
    if (_simParity === 0) {
      brainTick(sens, visual, motorIn, MODE==="brain"?exSlVal:0.3);
      if (!bwLive) updateTraces();
      if (!sim || !sim.layers) return;   // boot race: sim not constructed yet
      if (!bwLive) {
        sim.motorRateSmooth = sim.motorRateSmooth*0.85 + (motorRate()/Math.max(dt,1e-3))*0.15;
        sim.motorBase += (sim.motorRateSmooth-sim.motorBase)*clamp(dt*0.1,0,1);
        applyLearning(parseFloat($("lr").value) * (assist?-1:1));
      }
      lcPanelFrame(dt);
    }

    if (!window.__appScene || !window.__appScene.__playing) {
    actuate(dt);
"""
rep(old, new, "frame-sim-block")

old = """    if (typeof sciFrame==="function") sciFrame(dt);
    if (typeof expFrame === "function") expFrame(sens, visual);
  }
  tick++;
"""
new = """    if (typeof sciFrame==="function") sciFrame(dt);
    if (typeof expFrame === "function") expFrame(sens, visual);
    }
  }
  tick++;
"""
rep(old, new, "frame-close")

# ---------------------------------------------------------------------------
# 4) reward(): forward the dopamine shift + stimulus pulse to the worker.
old = """  sim.DA.v = clamp(sim.DA.v + q*0.6*rs, -1.5, 3);
  // sensory pulse into the real connectome: every crossing excites AL+optic
  sim._stimPulse = Math.min(1, (sim._stimPulse || 0) + 0.7 + Math.abs(q) * 0.5);
"""
new = """  sim.DA.v = clamp(sim.DA.v + q*0.6*rs, -1.5, 3);
  // sensory pulse into the real connectome: every crossing excites AL+optic
  sim._stimPulse = Math.min(1, (sim._stimPulse || 0) + 0.7 + Math.abs(q) * 0.5);
  if (sim._bw && sim._bwReady && !sim._bwBroken) sim._bw.postMessage({ type:"reward",
    dq: q*0.6*rs, stim: 0.7 + Math.abs(q)*0.5 });
"""
rep(old, new, "reward")

# ---------------------------------------------------------------------------
if fail:
    print("FAILED anchors:")
    for t, c in fail: print("  ", t, "count=", c)
    sys.exit(1)
io.open(P, "w", encoding="utf-8", newline="").write(src)
print("patched", P, "+", len(src)-n0, "chars")
