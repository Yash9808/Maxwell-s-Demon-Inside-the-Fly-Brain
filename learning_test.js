// Learning test: does dopamine-gated plasticity make the door policy more
// selective (open when door-area particles are SLOW, closed when FAST)?
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "fly_demon_lab.html"), "utf8");
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

const calls = {};
function ctx2d() {
  return new Proxy({ canvas:{width:800,height:600}, setTransform(){},
    createLinearGradient(){ return { addColorStop(){} }; } }, {
    get(t,k){
      if (k in t) return t[k];
      if (k==="measureText") return ()=>({width:50});
      if (typeof calls[k]==="number") return ()=>{ calls[k]++; };
      return ()=>{};
    },
    set(){ return true; },
  });
}
const elements = {};
function el(id){
  if (!elements[id]){
    const isCv = id.endsWith("Cv");
    elements[id] = { value:{lr:"0.008",rewScale:"2",nPart:"420",jetP:"0.55",jetAim:"0.5",
      noise:"0.12",doorH:"70"}[id] ?? "0.5",
      textContent:"", style:{}, dataset:{},
      addEventListener(){}, classList:{add(){},remove(){}}, click(){},
      ...(isCv?{width:800,height:600,getBoundingClientRect:()=>({width:800,height:600}),
               getContext:()=>ctx2d()}:{}) };
  }
  return elements[id];
}
global.document = { getElementById:el, querySelectorAll:()=>[] };
global.window = { devicePixelRatio:1, addEventListener(){} };
let raf = [];
global.requestAnimationFrame = cb => { raf.push(cb); return raf.length; };
global.performance = { now:()=>Date.now() };

// expose internals for measurement
const api = new Function(code + `
;return { getState: () => ({ W, W0, WSCALE, plastic, isExc, src, dst, CIRCUIT,
  door: door.pos, DA: DA.v, motorRateSmooth, motorBase, exAmp, crossGood,
  crossBad, P, chamber, tempStats, readSensors, jetFire }) };`)();

const S = () => api.getState();
let t = Date.now(), frames = 0;
const JV = el("jetP"), JA = el("jetAim");

function runFrames(n){
  for (let i=0;i<n;i++){
    if (frames % 210 === 30) S().jetFire(parseFloat(JV.value), parseFloat(JA.value));
    const cbs = raf; raf = [];
    for (const cb of cbs) cb(t + frames*16.7);
    frames++;
  }
}

// --- measurement helper: door-open probability conditioned on door sensor
function policySelectivity(){
  const s = S().readSensors();
  const doorFast = s[5];
  const openNow = S().door > 0.3;
  return { doorFast, openNow };
}
const samples = [];

console.log("frame | exAmp | DA     | doorPos | doorFast | good:bad crossings | open-rate");
const history = [];
for (let block=0; block<9; block++){
  const g0 = S().crossGood, b0 = S().crossBad;
  let opens = 0, Nsamp = 0;
  for (let k=0;k<50;k++){
    runFrames(20);
    const ps = policySelectivity();
    opens += ps.openNow?1:0; Nsamp++;
    samples.push(ps);
  }
  const st = S();
  const dG = st.crossGood-g0, dB = st.crossBad-b0;
  const ratio = dB>0 ? dG/dB : NaN;
  history.push({ frame:frames, da:st.DA, door:st.door, ex:st.exAmp,
                 good:dG, bad:dB, ratio, openRate: opens/Nsamp,
                 doorFast:samples[samples.length-1].doorFast });
  console.log(
    String(frames).padStart(5), "|",
    st.exAmp.toFixed(2), "|",
    st.DA.toFixed(2).padStart(6), "|",
    st.door.toFixed(2).padStart(7), "|",
    (samples[samples.length-1].doorFast).toFixed(2).padStart(8), "|",
    `${dG}:${dB}`.padStart(10), "|",
    (opens/Nsamp).toFixed(2)
  );
}

// summary: does the good:bad crossing ratio improve over training?
const ratios = history.map(h=>h.ratio).filter(r=>!isNaN(r));
if (ratios.length >= 4){
  const half = Math.floor(ratios.length/2);
  const early = ratios.slice(0,half).reduce((a,b)=>a+b,0)/half;
  const late = ratios.slice(-half).reduce((a,b)=>a+b,0)/half;
  console.log(`\ngood:bad ratio early=${early.toFixed(2)} late=${late.toFixed(2)} ` +
    (late > early+0.05 ? "IMPROVED ✔" : late < early-0.05 ? "WORSENED ✘" : "FLAT ≈"));
}
const last = history[history.length-1];
console.log(`door activity: open-rate ${last.openRate.toFixed(2)}, exploration amp ${last.ex.toFixed(2)}`);

// Save the measured series and the strongest learned synapses for the
// publication figure generator. Scores are normalized to each edge's initial
// magnitude so large structural edges do not dominate only by synapse count.
const finalState = S();
const layerOf = (idx) => {
  let li=0, start=0;
  while (li<finalState.CIRCUIT.layers.length-1 && idx>=start+finalState.CIRCUIT.layers[li].length){
    start += finalState.CIRCUIT.layers[li].length; li++;
  }
  return li;
};
const plasticity = [];
for (let i=0;i<finalState.W.length;i++){
  const baseline = finalState.W0[i]*finalState.WSCALE*(finalState.isExc[i]?1:-1);
  const delta = finalState.W[i]-baseline;
  const score = Math.abs(delta)/Math.max(Math.abs(finalState.W0[i]*finalState.WSCALE),1e-6);
  if (score>1e-5) plasticity.push({ edge:i, source:finalState.src[i], target:finalState.dst[i],
    sourceLayer:layerOf(finalState.src[i]), targetLayer:layerOf(finalState.dst[i]),
    delta, score, direction:delta>=0?"strengthened":"weakened" });
}
plasticity.sort((a,b)=>b.score-a.score);
const result = {
  dataset:"FAFB v783 compact browser circuit",
  frames, parameters:{ learningRate:el("lr").value, dopamineScale:el("rewScale").value,
    particles:el("nPart").value, jetPower:el("jetP").value, noise:el("noise").value },
  layerNames:finalState.CIRCUIT.layer_names,
  layerSizes:finalState.CIRCUIT.layers.map(layer=>layer.length),
  history, policySamples:samples, plasticity:plasticity.slice(0,180)
};
fs.writeFileSync(path.join(__dirname,"learning_curve.json"), JSON.stringify(result,null,2));
console.log("wrote learning_curve.json");
