# -*- coding: utf-8 -*-
"""Patch 10: TrueFly-glb loads fly.glb (the fly that flies) and swaps it in for
the cartoon flyer avatar. fly.glb is auto-sized to the flyer's wingspan, yawed
to face +X, and its wing nodes are flapped from the existing buzz loop. The
central brain / neuron cloud is no longer touched by this mode."""
from pathlib import Path
import sys

P = Path("fly_demon_3d.html")
src = P.read_text(encoding="utf-8")
reps = []

# 1) button label -------------------------------------------------------------
reps.append((
'<button id="btnGlb" style="flex:1">🧬 TrueFly-glb</button>',
'<button id="btnGlb" style="flex:1">🪰 TrueFly-glb (fly)</button>'))

# 2) TrueFly module: load fly.glb sized/oriented for the flying avatar --------
reps.append((
r'''// ---- TrueFly-glb: real CT-scan fruit fly surface + live activity wiring ---
// The CT model REPLACES the point-cloud brain in this mode; active pathways
// are drawn as additive jet-colored lines through the brain volume (blue
// quiet/starting -> red peak), at the measured neuron positions.
const TRUEFLY = { on:false, ready:false, loading:false, root:null, lines:null,
                  geo:null };
function trueflyLoad(){
  if (TRUEFLY.ready || TRUEFLY.loading) return;
  TRUEFLY.loading = true;
  new GLTFLoader().load("drosophila_-_adult_fruit_fly_-_ct_scan.glb", (gltf) => {
    TRUEFLY.root = gltf.scene;
    // center + scale the CT scan onto the neuron-cloud volume (~760 units)
    const box = new THREE.Box3().setFromObject(TRUEFLY.root);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const s = 760 / Math.max(size.x, size.y, size.z, 1e-6);
    TRUEFLY.root.position.sub(c).multiplyScalar(s);
    TRUEFLY.root.scale.setScalar(s);
    // ghost the surface so the glow wiring inside stays readable
    TRUEFLY.root.traverse(o => { if (o.isMesh)
      o.material = new THREE.MeshPhongMaterial({ color:0x9fb4cc, shininess:30,
        transparent:true, opacity:0.14, depthWrite:false }); });
    TRUEFLY.ready = true; TRUEFLY.loading = false;
    if (TRUEFLY.on) trueflyApply();
    msg("TrueFly CT model loaded \u2014 activity wiring live", 3000);
  }, undefined, () => { TRUEFLY.loading = false;
    msg("TrueFly-glb: model failed to load", 4000); });
}
function trueflyBuildLines(){
  const pos = brainHolder.pos;
  const base = brainHolder.segIdx || [];
  const segPos = new Float32Array(base.length * 6);
  base.forEach((ei, k) => {
    const e = sim.circuit.edges[ei];
    segPos[k*6]   = pos[e.s*3];   segPos[k*6+1] = pos[e.s*3+1]; segPos[k*6+2] = pos[e.s*3+2];
    segPos[k*6+3] = pos[e.t*3];   segPos[k*6+4] = pos[e.t*3+1]; segPos[k*6+5] = pos[e.t*3+2];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(segPos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(base.length*6), 3));
  TRUEFLY.geo = geo;
  TRUEFLY.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    vertexColors:true, transparent:true, opacity:0.95,
    blending:THREE.AdditiveBlending, depthWrite:false }));
}
function trueflyApply(){
  const g = brainHolder.group;
  if (!g) return;
  if (TRUEFLY.on){
    if (TRUEFLY.root && !TRUEFLY.root.parent) g.add(TRUEFLY.root);
    if (!TRUEFLY.lines) trueflyBuildLines();
    if (TRUEFLY.lines && !TRUEFLY.lines.parent) g.add(TRUEFLY.lines);
    if (brainHolder.nodes) brainHolder.nodes.visible = false;
    if (brainHolder.edgeLines) brainHolder.edgeLines.visible = false;
    (brainHolder.shells || []).forEach(sh => { sh.grp.visible = false; });
  } else {
    if (TRUEFLY.root) g.remove(TRUEFLY.root);
    if (TRUEFLY.lines) g.remove(TRUEFLY.lines);
    if (brainHolder.nodes) brainHolder.nodes.visible = true;
    if (brainHolder.edgeLines) brainHolder.edgeLines.visible = true;
    (brainHolder.shells || []).forEach(sh => { sh.grp.visible = true; });
  }
}''',
r'''// ---- TrueFly-glb: the realistic fly (fly.glb) takes over the flying -------
// fly.glb is the FLY THAT FLIES, not the central brain: toggling it swaps the
// cartoon flyer avatar (flyGroup) for this textured Sketchfab fly, sized to
// the same wingspan and yawed to face +X like the avatar it replaces. The
// anatomical brain / neuron cloud is NOT touched by this mode.
const TRUEFLY = { on:false, ready:false, loading:false, root:null, wings:[],
                  hidden:[] };
function trueflyLoad(){
  if (TRUEFLY.ready || TRUEFLY.loading) return;
  TRUEFLY.loading = true;
  new GLTFLoader().load("fly.glb", (gltf) => {
    // --- size to the flyer it replaces ---------------------------------------
    // flyGroup body is ~57u nose-to-tail at 1.5x avatar scale; fly.glb is a
    // Sketchfab model facing +Z with a ~4000-unit wingspan, so normalize the
    // largest dimension to ~170 world units (cartoon fly incl. wings ~170u)
    // and yaw +90 deg so the +Z nose points along +X (flyGroup's forward).
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const s = 170 / Math.max(size.x, size.y, size.z, 1e-6);
    const inner = new THREE.Group();
    inner.add(gltf.scene);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/2, 0));
    inner.quaternion.copy(q);
    inner.scale.setScalar(s);
    inner.position.copy(c).multiplyScalar(-s).applyQuaternion(q); // center at origin
    TRUEFLY.root = inner;
    // collect the wing nodes (FLYALA/FLYALA0 hind, FLYALI/FLYALI0 fore wings)
    TRUEFLY.root.traverse(o => {
      if (/^FLYAL[AI]0?$/.test(o.name || "")) TRUEFLY.wings.push(o);
    });
    TRUEFLY.ready = true; TRUEFLY.loading = false;
    if (TRUEFLY.on) trueflyApply();
    msg("TrueFly model loaded \u2014 the realistic fly takes over the flying", 3000);
  }, undefined, () => { TRUEFLY.loading = false;
    msg("TrueFly-glb: fly.glb failed to load", 4000); });
}
function trueflyWings(phase, amp){ // fly.glb wing flutter, driven by the buzz loop
  TRUEFLY.wings.forEach((w,i)=>{
    const side = w.position.x >= 0 ? 1 : -1;  // hinge sign per wing side
    w.rotation.y = side * amp * Math.sin(phase + i*2.4);
  });
}
function trueflyApply(){
  if (!flyGroup) return;
  if (TRUEFLY.on){
    if (TRUEFLY.root && !TRUEFLY.root.parent) flyGroup.add(TRUEFLY.root);
    // hide the cartoon body parts; the group itself keeps pose/hover/position
    TRUEFLY.hidden = [];
    flyGroup.children.forEach(o => {
      if (o !== TRUEFLY.root && o.visible){ TRUEFLY.hidden.push(o); o.visible = false; }
    });
  } else {
    if (TRUEFLY.root && TRUEFLY.root.parent) flyGroup.remove(TRUEFLY.root);
    TRUEFLY.hidden.forEach(o => { if (o.parent === flyGroup) o.visible = true; });
    TRUEFLY.hidden = [];
  }
}'''))

# 3) button handler: no more hijacking the anatomical view --------------------
reps.append((
r'''$("btnGlb").addEventListener("click", () => {
  TRUEFLY.on = !TRUEFLY.on;
  $("btnGlb").classList.toggle("active", TRUEFLY.on);
  if (!anatMode){                    // TrueFly lives in the anatomical frame
    anatMode = true;
    $("btnAnat").classList.add("active");
    $("jetLegend").style.display = "";
    buildBrain(sim.circuit);
    cameraTarget.set(0, 520, 0); orbit.dist = 2000; orbit.pitch = 0.22;
  }
  trueflyLoad();                     // no-op once loaded / while loading
  if (TRUEFLY.ready) trueflyApply(); // otherwise applied by the loader
  msg(TRUEFLY.on
    ? "\U0001f9ec TrueFly CT model \u2014 glowing lines show live pathways through the real fly surface (blue quiet \u2192 red peak)"
    : "TrueFly off \u2014 back to the neuron cloud", 5200);
});''',
r'''$("btnGlb").addEventListener("click", () => {
  TRUEFLY.on = !TRUEFLY.on;
  $("btnGlb").classList.toggle("active", TRUEFLY.on);
  trueflyLoad();                     // no-op once loaded / while loading
  if (TRUEFLY.ready) trueflyApply(); // otherwise applied by the loader
  msg(TRUEFLY.on
    ? "\U0001f9ec TrueFly-glb \u2014 the realistic fly takes over the flying (wings buzz with drive; brain view untouched)"
    : "TrueFly off \u2014 back to the cartoon flyer", 5200);
});'''))

# 4) drop the CT wiring-lines update from the tick loop -----------------------
reps.append((
r'''  // TrueFly wiring: the same decaying heat drives jet colors on the
  // CT-mode glow lines (invisible when idle, blue -> red with activity).
  if (TRUEFLY.on && TRUEFLY.lines && brainHolder._eHeat){
    const HN = brainHolder._eHeat;
    const srcA = sim.src, base = brainHolder.segIdx;
    const colA = TRUEFLY.geo.getAttribute("color");
    let p95 = 0;
    for (let i = 0; i < HN.length; i += 11) if (HN[i] > p95) p95 = HN[i];
    const scale = Math.max(0.25, p95);
    for (let k = 0; k < base.length; k++){
      const ei = base[k];
      const h = Math.min(1, Math.pow(HN[srcA[ei]] / scale, 0.75));
      if (h < 0.07){ colA.setXYZ(k, 0, 0, 0); colA.setXYZ(k + base.length, 0, 0, 0); continue; }
      const rC = Math.min(1, Math.max(0, 1.5 - Math.abs(4*h - 3)));
      const gC = Math.min(1, Math.max(0, 1.5 - Math.abs(4*h - 2)));
      const bC = Math.min(1, Math.max(0, 1.5 - Math.abs(4*h - 1)));
      colA.setXYZ(k, rC, gC, bC); colA.setXYZ(k + base.length, rC, gC, bC);
    }
    colA.needsUpdate = true;
  }''',
r'''  // (TrueFly-glb: no per-tick wiring here — the fly.glb wing flutter is
  // driven from the fly-animation buzz loop instead.)'''))

# 5) flap the fly.glb wings from the existing wing-buzz loop ------------------
reps.append((
r'''  flyGroup.userData.wings.forEach((w,i)=>{ w.rotation.y = Math.sin(t*buzz + i)*(0.7 + 0.3*startle); });''',
r'''  flyGroup.userData.wings.forEach((w,i)=>{ w.rotation.y = Math.sin(t*buzz + i)*(0.7 + 0.3*startle); });
  if (TRUEFLY.on && TRUEFLY.ready) trueflyWings(t*buzz*0.35, 0.45 + 0.25*startle);  // fly.glb wing flutter'''))

for i, (old, new) in enumerate(reps):
    n = src.count(old)
    if n != 1:
        sys.exit(f"replacement {i}: expected exactly 1 occurrence, found {n}")
    src = src.replace(old, new)

P.write_text(src, encoding="utf-8")
print(f"patched OK: {len(reps)} replacements applied")
