// Dump matrices/origins for wing chain nodes + images/materials count. (test)
const fs = require("fs");
const file = "fly.glb";
const buf = fs.readFileSync(file);
const len = buf.readUInt32LE(8);
let off = 12, json = null;
while (off < len) {
  const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off+4);
  if (ctype === 0x4E4F534A) json = JSON.parse(buf.slice(off+8, off+8+clen).toString("utf8"));
  off += 8 + clen;
}
console.log("images:", (json.images||[]).length, "textures:", (json.textures||[]).length,
            "materials:", (json.materials||[]).length,
            "materials:", (json.materials||[]).map(m=>m.name).join(","));
const targets = ["FLYALA","FLYALA0","FLYALI","FLYALI0","Sketchfab_model"];
const visit = (ni, pm, path) => {
  const n = json.nodes[ni];
  const m = mulMat(pm, n.matrix ? n.matrix.slice() : identity());
  if (targets.some(t => (n.name||"") === t) || /FLYA/.test(n.name||"") || /3DSMeshMatrix/.test(n.name||"")) {
    const o = xform(m, [0,0,0]);
    console.log(`${n.name||"(unnamed)"} @ depth${path.split("/").length-1} path=${path}`);
    console.log(`   matrix=${(n.matrix||[]).map(v=>+v.toFixed(2)).join(",")}`);
    console.log(`   worldOrigin=[${o.map(v=>+v.toFixed(1))}]`);
  }
  (n.children||[]).forEach(c=>visit(c, m, path + "/" + (n.name||ni)));
};
function identity(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
function mulMat(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function xform(m,p){return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];}
(json.scenes[0].nodes||[]).forEach(ni=>visit(ni, identity(), ""));
