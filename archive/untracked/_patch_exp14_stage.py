import io

p = "fly_demon_3d.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\n" if "\r\n" not in d else "\r\n"
def nl(s): return s.replace("\r\n", "\n").replace("\n", NL)

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# ============================================================ 1. CSS
rep("""  .exp-card.error { border-color: #f85149; }""",
"""  .exp-card.error { border-color: #f85149; }
  .app-hud { position:absolute; left:50%; transform:translateX(-50%); bottom:18px;
    display:flex; gap:8px; align-items:center; z-index:6;
    background:rgba(10,14,22,.72); border:1px solid rgba(255,255,255,.14);
    border-radius:10px; padding:8px 12px; font:12px/1.3 Consolas,monospace; color:#cfe3ff; }
  .app-hud b { color:#fff; }
  .app-hud .k { color:#8b98a5; }""")

# ============================================================ 2. three new cards in DEMON LAB
E1_OPEN = '<div class="exp-card" data-exp="e1" title="WATCH FOR: gate mostly closed, opening only for fast particles leaving the hot side / slow ones re-entering; DT grows slowly; good:bad crossings >> 1; memory bits stay tiny (a few per trial).">'
NEW_CARDS = '''<div class="exp-card" data-exp="e9" title="WATCH FOR: the selective valve builds a pressure difference that drives the piston against the spring; the random valve builds none; never-open is the noise floor. Mechanical work must exceed the Landauer bill of the bits to 'pay'.">
      <div class="exp-head"><b>E9 · Pressure Demon</b>
        <button class="exp-run" title="run in background">▶</button></div>
      <div class="exp-desc">The demon's speed-selective valve builds ΔP that drives a piston — mechanical work from information, with the Landauer bill on the ledger.</div>
      <div class="exp-meta"><span class="exp-eta">≈1 min</span><span class="exp-status">idle</span></div>
      <canvas class="exp-spark" width="220" height="44"></canvas>
      <div class="exp-verdicts"></div>
    </div>
<div class="exp-card" data-exp="e10" title="WATCH FOR: molecule impacts alone flip the spring trapdoor; a heavier door passes fewer molecules; the gas still relaxes to equilibrium — a Smoluchowski flap rectifies nothing on its own.">
      <div class="exp-head"><b>E10 · Smoluchowski Trapdoor</b>
        <button class="exp-run" title="run in background">▶</button></div>
      <div class="exp-desc">A spring trapdoor opened only by molecule impacts: heavier doors pass fewer molecules, yet the gas always relaxes to equilibrium — no demon here.</div>
      <div class="exp-meta"><span class="exp-eta">≈1 min</span><span class="exp-status">idle</span></div>
      <canvas class="exp-spark" width="220" height="44"></canvas>
      <div class="exp-verdicts"></div>
    </div>
<div class="exp-card" data-exp="e11" title="WATCH FOR: forward slips outweigh reversals only while Th > Tc; at Th = Tc the pawl lifts as often as it slips and the net rotation is zero — Feynman's rectification theorem, live.">
      <div class="exp-head"><b>E11 · Feynman Ratchet &amp; Pawl</b>
        <button class="exp-run" title="run in background">▶</button></div>
      <div class="exp-desc">Ratchet &amp; pawl between two baths: forward slips beat reversals only while Th &gt; Tc — at equilibrium the machine does nothing.</div>
      <div class="exp-meta"><span class="exp-eta">≈1 min</span><span class="exp-status">idle</span></div>
      <canvas class="exp-spark" width="220" height="44"></canvas>
      <div class="exp-verdicts"></div>
    </div>
''' + E1_OPEN
rep(E1_OPEN, NEW_CARDS)

# ============================================================ 3. apparatus stage module
STAGE = r'''  // ---- Apparatus stages for E9/E10/E11 (patch 14) ---------------------------
  // Experiment-specific 3D environments. Each stage is built ONCE at a remote
  // position (APP_STAGE_Y, far below the default world, beyond the fog) and
  // shown by MOVING the camera to it — no existing object is hidden, moved or
  // restyled, so the default scenario stays bit-identical whenever no
  // apparatus experiment is active. On run end (or ESC) the camera and orbit
  // state are restored to their saved values. All motion is driven by
  // app_state messages from the real worker simulation (sim-time paced,
  // wall-clock playback in the page) — the animation is the experiment.
  const APP_STAGE_Y = -2600;
  const APPARATUS_META = {
    e9:  { env: "pressure", kind: "pressure" },
    e10: { env: "trapdoor", kind: "trapdoor" },
    e11: { env: "ratchet",  kind: "ratchet" },
  };
  const __camSave = { orbit: null, target: null, auto: null, active: null };
  const appPlay = { buf: [], raf: 0, t0: 0, idx: 0, active: null };
  const appStages = {};
  function mkMat(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign(
      { color, roughness: 0.55, metalness: 0.25 }, opts || {}));
  }
  function appGlass(w, h, d, x) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.06,
        roughness: 0.2, metalness: 0, side: THREE.BackSide, depthWrite: false }));
    m.position.x = x || 0;
    return m;
  }
  function appParticles(N, color, size) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial(
      { color, size, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
    pts.frustumCulled = false;
    return pts;
  }
  function appMeter(text, x, y, z, w) {
    w = w || 320;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = 56;
    const g = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w * 0.5, 28, 1); sp.position.set(x, y, z);
    function set(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = "rgba(8,12,20,0.66)"; g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = "rgba(140,170,210,0.35)"; g.strokeRect(1, 1, cv.width - 2, cv.height - 2);
      g.fillStyle = "#d7e5f7"; g.font = "600 26px Consolas, monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t, cv.width / 2, cv.height / 2);
      tex.needsUpdate = true;
    }
    set(text);
    return { sp, set };
  }
  function appBar(x, z, hMax) {   // vertical temperature bar (scale.y driven)
    const m = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 14), mkMat(0xff7b54));
    m.position.set(x, 0, z); m.userData.hMax = hMax;
    return m;
  }
  // ---- E9 · pressure engine (true to sim: L=900 H=420 D=420 DH=240 PEXT=160)
  function buildPressureStage() {
    const grp = new THREE.Group(); grp.position.set(0, APP_STAGE_Y, 0);
    const L = 900, H = 420, D = 420, DH = 240, PEXT = 160;
    grp.add(appGlass(L + PEXT, H, D, (L + PEXT) / 2 - L / 2));
    const wallMat = mkMat(0x24303f, { metalness: 0.5, roughness: 0.4 });
    const slotTop = new THREE.Mesh(new THREE.BoxGeometry(6, (H - DH) / 2, D), wallMat);
    slotTop.position.set(0, (DH + H) / 4, 0); grp.add(slotTop);
    const slotBot = slotTop.clone(); slotBot.position.y = -(DH + H) / 4; grp.add(slotBot);
    const valve = new THREE.Mesh(new THREE.BoxGeometry(4, DH, DH),
      mkMat(0xd29922, { transparent: true, opacity: 0.6 }));
    grp.add(valve);
    // piston assembly (moves with the plate): plate | rod | load
    const piston = new THREE.Group();
    piston.add(new THREE.Mesh(new THREE.BoxGeometry(8, H, D), mkMat(0x8b949e, { metalness: 0.7, roughness: 0.3 })));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 180, 10), mkMat(0xadbac7));
    rod.rotation.z = Math.PI / 2; rod.position.x = 94; piston.add(rod);
    const load = new THREE.Mesh(new THREE.BoxGeometry(80, 140, 170), mkMat(0x6e7681));
    load.position.x = 224; piston.add(load);
    piston.position.set(L / 2 + 8, 0, 0); grp.add(piston);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(8, H, D), wallMat);
    bracket.position.set(L / 2 + PEXT + 66, 0, 0); grp.add(bracket);
    // spring-compression indicator between load back and bracket (scaled bar)
    const spring = new THREE.Mesh(new THREE.BoxGeometry(1, 80, 160), mkMat(0x58a6ff));
    grp.add(spring);
    const parts = appParticles(260, 0xffb36b, 9); grp.add(parts);
    // temperature bars + pressure arrow + meters
    const bl = appBar(-L / 2 + 60, 0, 160), br = appBar(L / 2 - 60, 0, 160);
    grp.add(bl); grp.add(br);
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(60, 6, 6), mkMat(0xf85149));
    shaft.position.x = -30; arrow.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(14, 30, 10), mkMat(0xf85149));
    tip.rotation.z = Math.PI / 2; tip.position.x = -75; arrow.add(tip);
    arrow.position.set(0, H / 2 + 70, 0); grp.add(arrow);
    const mP = appMeter("P₁ — · P₂ —", 0, H / 2 + 150, 0, 380);
    const mW = appMeter("W — · bits —", 0, -H / 2 - 90, 0, 460);
    grp.add(mP.sp); grp.add(mW.sp);
    function onState(s) {
      const n = s.pos.length / 3;
      const arr = parts.geometry.attributes.position.array;
      for (let i = 0; i < n * 3; i++) arr[i] = s.pos[i];
      parts.geometry.attributes.position.needsUpdate = true;
      parts.geometry.setDrawRange(0, n);
      valve.position.y = (s.valve * DH) / 2;
      valve.scale.y = Math.max(0.02, 1 - s.valve);
      piston.position.x = L / 2 + 8 - s.piston;
      const loadBack = L / 2 + 8 - s.piston + 264;
      const gap = Math.max(2, (L / 2 + PEXT + 62) - loadBack);
      spring.position.x = (loadBack + L / 2 + PEXT + 62) / 2;
      spring.scale.x = gap;
      spring.material.color.setHSL(0.55, 0.8, 0.35 + 0.3 * Math.min(1, gap / 150));
      bl.scale.y = Math.max(1, s.tl / bl.userData.hMax * 160);
      bl.position.y = bl.scale.y / 2;
      br.scale.y = Math.max(1, s.tr / br.userData.hMax * 160);
      br.position.y = br.scale.y / 2;
      br.material.color.setHSL(0.55 - 0.55 * Math.min(1, s.tr / 900), 0.85, 0.5);
      const dP = s.pr - s.pl;
      arrow.rotation.z = dP >= 0 ? 0 : Math.PI;
      arrow.scale.x = Math.max(0.15, Math.min(2.2, Math.abs(dP) * 6));
      mP.set("P₁ " + s.pl.toFixed(2) + " · P₂ " + s.pr.toFixed(2) + " · ΔT " + s.dT.toFixed(0));
      mW.set("W " + (s.workU * 1e-21).toExponential(2) + " J · bits " + s.bits + " · xings " + s.crossings);
    }
    return { grp, onState, cam: { tx: 380, ty: 0, tz: 0, dist: 1420, pitch: 0.30, yaw: -0.55 } };
  }
  // ---- E10 · Brownian trapdoor (true to sim: L=760 H=300 D=300 DH=120)
  function buildTrapdoorStage() {
    const grp = new THREE.Group(); grp.position.set(0, APP_STAGE_Y, 0);
    const L = 760, H = 300, D = 300, DH = 120;
    grp.add(appGlass(L, H, D, 0));
    const wallMat = mkMat(0x24303f, { metalness: 0.5, roughness: 0.4 });
    const slotTop = new THREE.Mesh(new THREE.BoxGeometry(5, (H - DH) / 2, D), wallMat);
    slotTop.position.set(0, (DH + H) / 4, 0); grp.add(slotTop);
    const slotBot = slotTop.clone(); slotBot.position.y = -(DH + H) / 4; grp.add(slotBot);
    // hinged flap: pivot at the slot top, swings up under impacts
    const doorGrp = new THREE.Group(); doorGrp.position.set(0, DH / 2, 0);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(3, DH - 4, DH - 4),
      mkMat(0xd29922, { transparent: true, opacity: 0.75 }));
    flap.position.y = -(DH - 4) / 2; doorGrp.add(flap);
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, DH - 4, 8), mkMat(0xadbac7));
    hinge.rotation.x = Math.PI / 2; doorGrp.add(hinge);
    grp.add(doorGrp);
    const parts = appParticles(220, 0x79c0ff, 8); grp.add(parts);
    const mL = appMeter("L —", -L / 2 - 130, 40, 0, 200);
    const mR = appMeter("R —", L / 2 + 130, 40, 0, 200);
    const mD = appMeter("door — · xings —", 0, H / 2 + 80, 0, 420);
    grp.add(mL.sp); grp.add(mR.sp); grp.add(mD.sp);
    // crossing pulse cones (flash when a crossing is counted)
    const pulseL = new THREE.Mesh(new THREE.ConeGeometry(12, 26, 10),
      new THREE.MeshBasicMaterial({ color: 0x3fb950, transparent: true, opacity: 0 }));
    pulseL.position.set(-70, 0, 0); pulseL.rotation.z = Math.PI; grp.add(pulseL);
    const pulseR = pulseL.clone(); pulseR.position.x = 70; pulseR.rotation.z = 0; grp.add(pulseR);
    let pL = 0, pR = 0, glowL = 0, glowR = 0;
    function onState(s) {
      const n = s.pos.length / 3;
      const arr = parts.geometry.attributes.position.array;
      for (let i = 0; i < n * 3; i++) arr[i] = s.pos[i];
      parts.geometry.attributes.position.needsUpdate = true;
      parts.geometry.setDrawRange(0, n);
      doorGrp.rotation.x = -s.door * 0.9;
      if (s.crossLR !== pL) { pL = s.crossLR; glowL = 1; }
      if (s.crossRL !== pR) { pR = s.crossRL; glowR = 1; }
      glowL *= 0.92; glowR *= 0.92;
      pulseL.material.opacity = glowL; pulseR.material.opacity = glowR;
      mL.set("L " + s.nl + " · T " + s.tl.toFixed(0));
      mR.set("R " + s.nr + " · T " + s.tr.toFixed(0));
      mD.set("door " + (s.door * 57.3).toFixed(0) + "° · L→R " + s.crossLR + " · R→L " + s.crossRL);
    }
    return { grp, onState, cam: { tx: 0, ty: 0, tz: 0, dist: 620, pitch: 0.16, yaw: 0.4 } };
  }
  // ---- E11 · ratchet & pawl (true to sim: TEETH=24)
  function buildRatchetStage() {
    const grp = new THREE.Group(); grp.position.set(0, APP_STAGE_Y, 0);
    const TEETH = 24;
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(90, 13, 12, 48), mkMat(0x8b949e, { metalness: 0.7, roughness: 0.3 })));
    for (let i = 0; i < TEETH; i++) {
      const a = (i / TEETH) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(6, 20, 6), mkMat(0xc9d1d9, { metalness: 0.6 }));
      tooth.position.set(Math.cos(a) * 102, Math.sin(a) * 102, 0);
      tooth.rotation.z = a + Math.PI / 2 + 0.45;   // asymmetric sawtooth lean
      wheel.add(tooth);
    }
    grp.add(wheel);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 180, 12), mkMat(0xadbac7));
    axle.rotation.x = Math.PI / 2; grp.add(axle);
    const fly = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.14, roughness: 0.3 }));
    fly.rotation.x = Math.PI / 2; grp.add(fly);
    // pawl on a top hinge, engaging the teeth
    const pawlGrp = new THREE.Group(); pawlGrp.position.set(-12, 128, 0);
    const pawl = new THREE.Mesh(new THREE.BoxGeometry(10, 58, 9), mkMat(0xd29922));
    pawl.position.y = -29; pawlGrp.add(pawl);
    const pHinge = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 8), mkMat(0xadbac7));
    pHinge.rotation.x = Math.PI / 2; pawlGrp.add(pHinge);
    grp.add(pawlGrp);
    // thermal reservoirs (glow tracks Th / Tc)
    const hot = new THREE.Mesh(new THREE.BoxGeometry(56, 110, 56),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xff5040, emissiveIntensity: 0.6, roughness: 0.5 }));
    hot.position.set(-220, -20, 0); grp.add(hot);
    const cold = new THREE.Mesh(new THREE.BoxGeometry(56, 110, 56),
      new THREE.MeshStandardMaterial({ color: 0x1d3a7f, emissive: 0x4090ff, emissiveIntensity: 0.6, roughness: 0.5 }));
    cold.position.set(220, -20, 0); grp.add(cold);
    // load: weight on a string off the axle — rises as the ratchet does work
    const string = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1, 6), mkMat(0xc9d1d9));
    grp.add(string);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(46, 46, 46), mkMat(0x6e7681, { metalness: 0.4 }));
    grp.add(weight);
    const mS = appMeter("ω — · fwd/rev —", 0, 210, 0, 460);
    const mW = appMeter("W — · Qh — · η —", 0, -235, 0, 520);
    grp.add(mS.sp); grp.add(mW.sp);
    let lastSnap = -1, kick = 0;
    function onState(s) {
      wheel.rotation.z = -s.ang;
      if (s.angSnap !== lastSnap) { lastSnap = s.angSnap; kick = 1; }
      kick *= 0.86;
      pawlGrp.rotation.z = -0.16 + kick * 0.3;
      hot.material.emissiveIntensity = 0.25 + 0.9 * (s.th - 1);
      cold.material.emissiveIntensity = 0.25 + 0.9 * (s.tc - 1);
      const lift = Math.min(400, Math.max(0, s.ang)) * 0.5;
      weight.position.y = -170 - lift;
      string.scale.y = 170 + lift + 8;
      string.position.y = -8 - (170 + lift) / 2;
      mS.set("ω " + s.vel.toFixed(1) + " rad/s · fwd " + s.fwd + " · rev " + s.rev + " · τ " + s.load.toFixed(3));
      const wJ = Math.max(0, s.ang) * s.load * 1e-21, eta = s.qh > 0 ? wJ / (s.qh * 1e-21) : 0;
      mW.set("W " + wJ.toExponential(2) + " J · Qh " + (s.qh * 1e-21).toExponential(2) + " · η " + (eta * 100).toFixed(2) + "%");
    }
    return { grp, onState, cam: { tx: 0, ty: 0, tz: 0, dist: 800, pitch: 0.32, yaw: 0.25 } };
  }
  appStages.pressure = { build: buildPressureStage, built: null };
  appStages.trapdoor = { build: buildTrapdoorStage, built: null };
  appStages.ratchet  = { build: buildRatchetStage,  built: null };
  // ---- activation / restore / playback ---------------------------------------
  function appActivate(which) {
    const st = appStages[which];
    if (!st) return;
    if (!st.built) { st.built = st.build(); scene.add(st.built.grp); }
    if (__camSave.active === which) return;
    if (!__camSave.active) {
      __camSave.orbit = { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist };
      __camSave.target = cameraTarget.clone();
      __camSave.auto = orbit.auto;
    }
    __camSave.active = which;
    orbit.yaw = st.built.cam.yaw; orbit.pitch = st.built.cam.pitch; orbit.dist = st.built.cam.dist;
    orbit.auto = 0;
    cameraTarget.set(st.built.cam.tx, st.built.cam.ty, st.built.cam.tz);
  }
  function appRestore() {
    if (!__camSave.active) return;
    const o = __camSave.orbit;
    orbit.yaw = o.yaw; orbit.pitch = o.pitch; orbit.dist = o.dist; orbit.auto = __camSave.auto;
    cameraTarget.copy(__camSave.target);
    __camSave.active = null;
    if (appPlay.raf) { cancelAnimationFrame(appPlay.raf); appPlay.raf = 0; }
    appPlay.buf = []; appPlay.active = null; appPlay.idx = 0;
  }
  function appPump() {
    const st = appStages[appPlay.active];
    if (!st || !st.built) { appPlay.raf = 0; return; }
    const el = (performance.now() - appPlay.t0) / 1000;
    while (appPlay.idx < appPlay.buf.length - 1 && appPlay.buf[appPlay.idx + 1].state.t <= el) appPlay.idx++;
    if (appPlay.idx < appPlay.buf.length) st.built.onState(appPlay.buf[appPlay.idx].state);
    appPlay.raf = requestAnimationFrame(appPump);
  }
  function appFeed(which, state) {
    if (appPlay.active !== which) {
      appPlay.active = which; appPlay.buf = []; appPlay.idx = 0; appPlay.t0 = performance.now();
      appActivate(which);
      if (!appPlay.raf) appPlay.raf = requestAnimationFrame(appPump);
    }
    appPlay.buf.push({ state });
    if (appPlay.buf.length > 6000) {          // memory guard: thin the oldest half
      appPlay.buf.splice(0, 3000);
      appPlay.idx = Math.max(0, appPlay.idx - 3000);
    }
  }

  function sixStep(expId) {'''
rep("  function sixStep(expId) {", STAGE)

# ============================================================ 4. message wiring
rep("""  function handleMsg(expId, m) {
    if (m.type === "progress") {""",
"""  function handleMsg(expId, m) {
    if (m.type === "app_state") { appFeed(expId, m.state); return; }
    if (m.type === "progress") {
      const appMeta = APPARATUS_META[expId];
      if (appMeta) appActivate(appMeta.env);""")

rep("""      drawSpark(cards[expId].querySelector(".exp-spark"), m.curve || []);
      renderVerdicts(expId, m.curve || []);""",
"""      drawSpark(cards[expId].querySelector(".exp-spark"), m.curve || []);
      if (APPARATUS_META[expId]) clearVerdicts(expId);
      else renderVerdicts(expId, m.curve || []);""")

rep("""    } else if (m.type === "done") {
      setStatus(expId, "done",
        `done ✓ ${m.rows.length} trials · ${(m.provenance.elapsedSeconds || 0).toFixed(0)}s`);""",
"""    } else if (m.type === "done") {
      const nTrials = APPARATUS_META[expId]
        ? (m.provenance.trainTrials + m.provenance.testTrials) : m.rows.length;
      setStatus(expId, "done",
        `done ✓ ${nTrials} trials · ${(m.provenance.elapsedSeconds || 0).toFixed(0)}s`);""")

rep("""                       summary: m.summary, rows: m.rows, provenance: m.provenance });
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);""",
"""                       summary: m.summary, rows: m.rows, provenance: m.provenance });
      if (APPARATUS_META[expId]) setTimeout(() => appRestore(), 1500);
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);""")

rep("""      CH.postMessage({ kind: "plots", type: "session_error", expId });
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);""",
"""      CH.postMessage({ kind: "plots", type: "session_error", expId });
      if (APPARATUS_META[expId]) appRestore();
      worker.terminate(); worker = null; current = null; startNext();
      sixStep(expId);""")

# ============================================================ 5. tail: ESC restore
rep("""  }
})();
</script>
</body>""",
"""  }
  // ESC leaves an apparatus stage and restores the default scene + camera.
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && __camSave.active) {
      appRestore();
      (typeof msg === "function" ? msg : window.__labMsg || (() => {}))(
        "apparatus closed — default scene restored", 2400);
    }
  });
})();
</script>
</body>""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("lab page: cards + apparatus stages + wiring done")
