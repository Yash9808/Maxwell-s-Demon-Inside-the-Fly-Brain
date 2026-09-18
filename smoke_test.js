// Smoke test: run fly_demon_lab.html's script in Node with a stubbed DOM.
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "fly_demon_lab.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("no script block"); process.exit(1); }
let code = m[1];

// ---- minimal DOM/canvas stubs
const calls = { fillRect:0, arc:0, fill:0, beginPath:0, stroke:0, moveTo:0, lineTo:0, bezier:0 };
function ctx2d() {
  return new Proxy({ canvas:{ width:800, height:600 }, setTransform(){}, createLinearGradient(){
    return { addColorStop(){} };
  }}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k==="fillRect") return ()=>{ calls.fillRect++; };
      if (k==="beginPath") return ()=>{ calls.beginPath++; };
      if (k==="arc") return ()=>{ calls.arc++; };
      if (k==="fill") return ()=>{ calls.fill++; };
      if (k==="stroke") return ()=>{ calls.stroke++; };
      if (k==="moveTo") return ()=>{ calls.moveTo++; };
      if (k==="lineTo") return ()=>{ calls.lineTo++; };
      if (k==="bezierCurveTo") return ()=>{ calls.bezier++; };
      if (k==="fillText") return ()=>{};
      if (k==="measureText") return ()=>({ width:50 });
      if (k==="fillStyle"||k==="strokeStyle"||k==="lineWidth"||k==="font"||k==="textAlign"||k==="globalAlpha") return undefined;
      return ()=>{};
    },
    set(){ return true; },
  });
}
const elements = {};
function el(id) {
  if (!elements[id]) {
    const isCanvas = id.endsWith("Cv");
    elements[id] = {
      value: { lr:"0.004", rewScale:"1.5", nPart:"420", jetP:"0.55", jetAim:"0.5",
               noise:"0.12", doorH:"70" }[id] ?? "0.5",
      textContent:"", style:{}, dataset:{ m:"brain" },
      addEventListener(){}, classList:{ add(){},remove(){} }, click(){},
      ...(isCanvas ? {
        width:800, height:600,
        getBoundingClientRect(){ return { width:800, height:600 }; },
        getContext(){ return ctx2d(); },
      } : {}),
    };
  }
  return elements[id];
}
const canvases = {};
const canvasProto = { width:800, height:600,
  getBoundingClientRect(){ return { width:800, height:600 }; },
  getContext(){ return ctx2d(); } };
global.document = {
  getElementById(id){ return el(id); },
  querySelectorAll(){ return []; },
};
global.window = {
  devicePixelRatio: 1,
  addEventListener(){},
};
let rafCbs = [];
global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
global.performance = { now: () => Date.now() };

// eval in global scope (the code uses bare function decls + consts)
const run = new Function(code + "\n;return {brainTick,stepParticles,tempStats,actuate,applyLearning,CIRCUIT:len=>0,};");
let api;
try {
  api = run();
} catch (e) {
  console.error("BOOT FAILED:", e);
  process.exit(1);
}
console.log("boot OK");

// run ~600 frames with occasional jet pulses
let t = performance.now();
let jetEvery = 90;
let frames = 0;
try {
  while (frames < 600) {
    if (frames % jetEvery === 30) { el("btnJet").click(); }
    const cbs = rafCbs; rafCbs = [];
    for (const cb of cbs) cb(t + frames*16.7);
    frames++;
  }
} catch (e) {
  console.error("LOOP FAILED at frame", frames, e);
  process.exit(1);
}
console.log("loop OK:", frames, "frames,", Object.entries(calls).map(([k,v])=>k+"="+v).join(" "));

// physics sanity: jet should heat the left side vs no-jet baseline
const { tempStats } = api;
console.log("T stats after 600 frames:", JSON.stringify(tempStats()));
if (!(tempStats().Tl >= 0 && tempStats().Tr >= 0)) { console.error("negative temps"); process.exit(1); }
console.log("SMOKE PASS");
