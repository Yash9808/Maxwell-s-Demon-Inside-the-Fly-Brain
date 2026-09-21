
// ==== Brain outcome — 3D CT anatomy viewer ==================================
// The real adult-fly CT scan (drosophila_-_adult_fruit_fly_-_ct_scan.glb),
// made translucent, with the run's actual per-neuron firing (worker
// fireVecMean — the same signal the main screen's spiking brain shows)
// rendered inside the head at real FAFB positions, plus firing paths drawn
// along the real connectome (fly_brain_circuit.json) between neurons that
// actually fired.
import * as THREE from "./three.module.js";
import { GLTFLoader } from "./GLTFLoader.module.js";

// CT alignment (computed from the GLB head-cavity centroid and the FAFB
// cloud bounds): CT units -> scene units, head cavity lands on the cloud.
const CT_SCALE = 705.0;
const CT_OFFSET = new THREE.Vector3(38.9, 32.2, -652.9);

const V = { ready:false, renderer:null, scene:null, cam:null, fly:null,
            pts:null, posGeo:null, lines:null, linesGeo:null, N:0,
            POS:null, PRIM:null, npRegion:null,
            edges:null,                      // {s,t,w,sign} parallel arrays, weight-sorted
            rows:null, label:"", conds:[], cur:null,
            restMode:true };

const mount = document.getElementById("ct3dMount");
const legend = document.getElementById("ct3dLegend");
const chipsEl = document.getElementById("ct3dChips");
const loadEl = document.getElementById("ct3dLoad");

// ---- jet colormap (same scale family as the 2D maps) -----------------------
function jet(t){
  t = Math.min(1, Math.max(0, t));
  return [Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 3))),
          Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 2))),
          Math.min(1, Math.max(0, 1.5 - Math.abs(4*t - 1)))];
}

// ---- renderer / scene / camera ---------------------------------------------
function ensureView(){
  if (V.ready) return;
  const renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070d, 1);
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = "position:absolute; inset:0; width:100%; height:100%; display:block";
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x080a10, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(600, 900, 800); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0x88aaff, 0.5); dl2.position.set(-700, -300, -600); scene.add(dl2);

  const cam = new THREE.PerspectiveCamera(40, 2, 5, 9000);
  // orbit state (damped): start framed on the brain/head, three-quarter view
  const orb = { th: 0.55, ph: 1.12, r: 2500, tgt: new THREE.Vector3(20, -30, 40),
                dth: 0.55, dph: 1.12, dr: 2500 };
  let drag = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!drag) return;
    orb.dth -= (e.clientX - drag.x) * 0.0055;
    orb.dph = Math.min(2.6, Math.max(0.25, orb.dph - (e.clientY - drag.y) * 0.0045));
    drag = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointerup", () => { drag = null; });
  renderer.domElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    orb.dr = Math.min(6500, Math.max(260, orb.dr * (1 + Math.sign(e.deltaY) * 0.12)));
  }, { passive:false });

  new ResizeObserver(() => {
    const w = mount.clientWidth || 640, h = mount.clientHeight || 360;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }).observe(mount);

  // toolbar: CT visibility + reset view
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute; top:8px; right:8px; display:flex; gap:6px; z-index:5";
  const mkBtn = (txt, title, fn) => {
    const b = document.createElement("button");
    b.textContent = txt; b.title = title;
    b.style.cssText = "background:#161b22; color:#c9d1d9; border:1px solid #30363d; border-radius:6px;" +
                      "padding:3px 9px; font:11.5px ui-sans-serif,system-ui; cursor:pointer";
    b.onclick = fn; bar.appendChild(b); return b;
  };
  const ctBtn = mkBtn("CT shell", "show/hide the translucent CT fly", () => {
    if (V.fly) V.fly.visible = !V.fly.visible;
    ctBtn.style.opacity = (V.fly && !V.fly.visible) ? 0.45 : 1;
  });
  mkBtn("reset view", "back to the default camera", () => {
    orb.dth = 0.55; orb.dph = 1.12; orb.dr = 2500;
  });
  mount.appendChild(bar);

  V.renderer = renderer; V.scene = scene; V.cam = cam; V.orb = orb;
  V.ready = true;
  (function loop(){
    requestAnimationFrame(loop);
    if (!V.ready) return;
    const o = V.orb, k = 0.12;
    o.th += (o.dth - o.th) * k; o.ph += (o.dph - o.ph) * k; o.r += (o.dr - o.r) * k;
    V.cam.position.set(
      o.tgt.x + o.r * Math.sin(o.ph) * Math.sin(o.th),
      o.tgt.y + o.r * Math.cos(o.ph),
      o.tgt.z + o.r * Math.sin(o.ph) * Math.cos(o.th));
    V.cam.lookAt(o.tgt);
    V.renderer.render(V.scene, V.cam);
  })();
}

// ---- real neuron positions (FAFB, same file as the 2D maps) ----------------
async function loadPositions(){
  const [buf, meta] = await Promise.all([
    fetch("fly_brain_positions.bin", { cache:"no-cache" }).then(r => r.ok ? r.arrayBuffer() : null),
    fetch("fly_brain_meta.json",     { cache:"no-cache" }).then(r => r.ok ? r.json() : null),
  ]);
  if (!buf || !meta) throw new Error("positions unavailable");
  const n = meta.n = Math.floor(buf.byteLength / 7);   // 7 B/neuron
  V.N = n; V.POS = new Int16Array(buf, 0, n * 3); V.PRIM = new Uint8Array(buf, n * 6, n);
  V.npRegion = new Map();
  for (const rk in meta.region_of)
    for (const nm of meta.region_of[rk]) V.npRegion.set(nm, rk);
  // points cloud: hidden (black) until a firing vector arrives; resting tint
  // shows the anatomy inside the CT even before any run
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    pos[i*3] = V.POS[i*3] * 0.1; pos[i*3+1] = V.POS[i*3+1] * 0.1; pos[i*3+2] = V.POS[i*3+2] * 0.1;
    col[i*3] = 0.05; col[i*3+1] = 0.09; col[i*3+2] = 0.14;   // dim resting blue
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size:3.0, vertexColors:true, transparent:true,
    opacity:0.95, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
  V.pts = new THREE.Points(g, mat); V.pts.renderOrder = 3;
  V.posGeo = g;
}

// ---- real connectome: strongest synapses between placed neurons ------------
async function loadCircuit(){
  try {
    const j = await fetch("fly_brain_circuit.json", { cache:"no-cache" }).then(r => r.ok ? r.json() : null);
    if (!j || !j.edges) return;
    const E = j.edges, n = E.length;
    const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    const wOf = (i) => E[i].w;
    // weight-sort a sampled subset (top ~300k by counting-sort on w<=64)
    const cnt = new Uint32Array(65);
    for (let i = 0; i < n; i++) cnt[Math.min(64, E[i].w)]++;
    const order = new Uint32Array(n); let fill = 0;
    const start = new Uint32Array(65); let acc = 0;
    for (let w = 64; w >= 1; w--){ start[w] = acc; acc += cnt[w]; }
    for (let i = 0; i < n; i++) order[start[Math.min(64, E[i].w)]++] = i;
    const cap = Math.min(n, 300000);
    const s = new Uint32Array(cap), t = new Uint32Array(cap), w = new Uint8Array(cap), sg = new Int8Array(cap);
    for (let k = 0; k < cap; k++){ const e = E[order[k]]; s[k] = e.s; t[k] = e.t; w[k] = e.w; sg[k] = e.sign || 1; }
    V.edges = { s, t, w, sg, n: cap };
    // if a firing vector was already applied before the circuit arrived, redraw paths now
    if (V.cur && V.rows){ const fv = fireVec(V.cur); if (fv) applyFiring(V.cur, fv.vec, fv.measured); }
  } catch (e) { /* circuit paths optional — neurons still render */ }
}

// ---- the CT scan itself -----------------------------------------------------
async function loadCT(){
  const gltf = await new GLTFLoader().loadAsync("drosophila_-_adult_fruit_fly_-_ct_scan.glb");
  const fly = gltf.scene;
  fly.traverse((o) => {
    if (o.isMesh){
      o.material = new THREE.MeshStandardMaterial({ color:0x9fb0c6, transparent:true, opacity:0.10,
        depthWrite:false, side:THREE.DoubleSide, roughness:0.85, metalness:0.05 });
      o.renderOrder = 1;
    }
  });
  fly.scale.setScalar(CT_SCALE);
  fly.position.copy(CT_OFFSET);
  fly.visible = V.flyVisible !== false;
  V.fly = fly;
  V.scene.add(fly);
  if (loadEl) loadEl.remove();
}

// ---- firing vector per condition (same source as the 2D maps) ---------------
function fireVec(cond){
  const hooks = window.__ct3dHooks;
  if (hooks && hooks.fireVecFor && V.rows){
    const fv = hooks.fireVecFor(V.rows, cond);
    if (fv) return fv;
  }
  return null;
}

// ---- apply firing: light neurons + draw real firing paths -------------------
const _active = [];
function applyFiring(cond, fv, measured){
  if (!V.posGeo) return;
  const colA = V.posGeo.attributes.color;
  const arr = colA.array, n = V.N;
  _active.length = 0;
  for (let i = 0; i < n; i++){
    const v = fv ? fv[i] : 0;
    if (v){
      _active.push(i);
      const c = jet(0.15 + 0.85 * (v / 255));
      const I = 0.55 + 0.45 * (v / 255);
      arr[i*3] = c[0] * I; arr[i*3+1] = c[1] * I; arr[i*3+2] = c[2] * I;
    } else {
      arr[i*3] = 0.05; arr[i*3+1] = 0.09; arr[i*3+2] = 0.14;   // resting dim blue
    }
  }
  colA.needsUpdate = true;

  // firing paths: real synapses (strongest first) whose BOTH ends fired,
  // colored by sign — green excitatory, red inhibitory
  let segs = 0;
  if (V.edges){
    const { s, t, sg } = V.edges;
    const cap = 4000;
    const lp = new Float32Array(cap * 6), lc = new Float32Array(cap * 6);
    for (let k = 0; k < V.edges.n && segs < cap; k++){
      const a = s[k], b = t[k];
      if (!fv || !fv[a] || !fv[b]) continue;
      const inh = sg[k] < 0;
      const r = inh ? 0.92 : 0.20, g2 = inh ? 0.34 : 0.85, b2 = inh ? 0.38 : 0.45;
      lp[segs*6]   = V.POS[a*3]*0.1; lp[segs*6+1] = V.POS[a*3+1]*0.1; lp[segs*6+2] = V.POS[a*3+2]*0.1;
      lp[segs*6+3] = V.POS[b*3]*0.1; lp[segs*6+4] = V.POS[b*3+1]*0.1; lp[segs*6+5] = V.POS[b*3+2]*0.1;
      lc[segs*6] = r; lc[segs*6+1] = g2; lc[segs*6+2] = b2;
      lc[segs*6+3] = r; lc[segs*6+4] = g2; lc[segs*6+5] = b2;
      segs++;
    }
    if (!V.lines){
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
      lg.setAttribute("color", new THREE.BufferAttribute(lc, 3));
      const lm = new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, opacity:0.55,
        depthWrite:false, blending:THREE.AdditiveBlending });
      V.lines = new THREE.LineSegments(lg, lm); V.lines.renderOrder = 2;
      V.linesGeo = lg; V.scene.add(V.lines);
    } else {
      V.linesGeo.attributes.position.array.set(lp.subarray(0, segs * 6));
      V.linesGeo.attributes.color.array.set(lc.subarray(0, segs * 6));
      V.linesGeo.setDrawRange(0, segs * 2);
      V.linesGeo.attributes.position.needsUpdate = true;
      V.linesGeo.attributes.color.needsUpdate = true;
    }
  }
  if (!cond){
    legend.innerHTML = "<b style='color:#c9d1d9'>" + (V.label || "") + "</b>" +
      " — " + n.toLocaleString() + " neurons at real FAFB positions inside the CT head (resting). " +
      "Run a fly-brain experiment to see firing.";
    return;
  }
  const pct = ((100 * _active.length) / n).toFixed(1);
  legend.innerHTML =
    "<b style='color:#c9d1d9'>" + (V.label || "") + "</b> · condition <b style='color:#58a6ff'>" + cond + "</b>" +
    (measured ? " — measured per-neuron firing" : " — region-mean firing over real positions") +
    " · <b>" + _active.length.toLocaleString() + "</b> neurons fired (" + pct + "% of " + n.toLocaleString() + ")" +
    " · <b style='color:#35d07a'>" + segs.toLocaleString() + "</b> firing paths (real synapses; green excitatory, red inhibitory)" +
    " · drag to orbit · wheel to zoom";
}

// ---- condition chips ---------------------------------------------------------
function buildChips(){
  chipsEl.innerHTML = "";
  const rows = V.rows || [];
  V.conds = [];
  for (const r of rows){
    const c = r.condition || "run";
    if (!V.conds.includes(c) && (r.fireVecMean || r.layerRates)) V.conds.push(c);
  }
  if (!V.conds.length){
    const s = document.createElement("span");
    s.style.cssText = "color:#8b98a5; font:12px ui-sans-serif,system-ui";
    s.textContent = (V.label || "this experiment") +
      " has no fly-brain firing (physics-only run) — the CT anatomy view shows E2–E5 runs";
    chipsEl.appendChild(s);
    applyFiring(null, null, false);
    return;
  }
  for (const c of V.conds){
    const b = document.createElement("button");
    b.textContent = c;
    b.style.cssText = "background:#161b22; color:#c9d1d9; border:1px solid #30363d; border-radius:14px;" +
      "padding:4px 14px; font:12px ui-sans-serif,system-ui; cursor:pointer";
    b.onclick = () => setCond(c);
    b.dataset.cond = c;
    chipsEl.appendChild(b);
  }
  setCond(V.conds[V.conds.length - 1]);     // latest condition by default
}
function setCond(c){
  V.cur = c;
  for (const b of chipsEl.querySelectorAll("button")){
    const on = b.dataset.cond === c;
    b.style.borderColor = on ? "#58a6ff" : "#30363d";
    b.style.color = on ? "#58a6ff" : "#c9d1d9";
    b.style.boxShadow = on ? "0 0 0 1px #58a6ff inset" : "none";
  }
  const fv = fireVec(c);
  if (fv) applyFiring(c, fv.vec, fv.measured);
}

// ---- public hook -------------------------------------------------------------
function showRun(rows, label){
  V.rows = rows || []; V.label = label || "";
  if (V.ready) buildChips();
}
window.__ct3dBrain = { showRun, setCond };

// ---- boot ---------------------------------------------------------------------
(async () => {
  try {
    ensureView();
    await loadPositions();
    V.scene.add(V.pts);
    loadCircuit();
    await loadCT();
    if (V.rows) buildChips();
    else {
      applyFiring(null, null, false);
      legend.textContent = "CT fly loaded — the brain cloud inside the head is the run's " +
        "real neuron set. Run any fly-brain experiment (E2–E5) to see it fire.";
    }
  } catch (e) {
    if (loadEl) loadEl.textContent = "CT anatomy unavailable (" + e.message + ") — 2D maps below still work";
  }
})();
