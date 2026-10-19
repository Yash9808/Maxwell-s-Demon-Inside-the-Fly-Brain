#!/usr/bin/env node
/**
 * build_nmf_fly_glb.js — offline asset packer for the TrueFly-glb render path.
 *
 * Builds nmf_fly.glb: the NeuroMechFly 2.0 adult fruit-fly morphology as a
 * hierarchical glTF 2.0 scene, from:
 *   - the 85 body-segment OBJ meshes shipped in the flybody pip package
 *     (Apache-2.0, same morphology as NeuroMechFly 2.0 / Wang-Chen et al.,
 *     Nature s41586-025-09029-4), and
 *   - the MuJoCo MJCF body tree (fruitfly.xml), which supplies each body's
 *     pos/quat joint pivot and each geom's local pos/quat + material.
 *
 * Hierarchy/pivots come from the XML — NOT guesswork: each body node mirrors
 * the MJCF <body> nesting, and each geom is a child mesh with the XML's own
 * pos/quat transform applied.
 *
 * Output: nmf_fly.glb at the repo root (GLB = JSON chunk + BIN chunk, meshes
 * stored as indexed triangles with per-node local TRS). Y-up right-handed,
 * +X forward (same as three.js; the MJCF model is already +X nose-forward).
 *
 * Usage:  node tools/build_nmf_fly_glb.js [--pose nmf_pose_springref.json]
 *         (the --pose file comes from tools/export_nmf_pose.py: it bakes a
 *          MuJoCo pose — qpos_spring = the joints' passive rest angles — into
 *          the node TRS, so the asset matches the pose flybody renders)
 * Reads:  .venv-embodiment/Lib/site-packages/flybody/fruitfly/assets/  (85 OBJs + fruitfly.xml)
 * Writes: nmf_fly.glb, CREDITS entry appended by hand in the repo CREDITS file.
 * No runtime code is touched by this tool.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "..", ".venv-embodiment", "Lib", "site-packages", "flybody", "fruitfly", "assets");
const XML_PATH = path.join(ASSETS_DIR, "fruitfly.xml");
const OUT_PATH = path.join(__dirname, "..", "nmf_fly.glb");
const SCALE = 0.1;                 // MJCF default <mesh scale="0.1 0.1 0.1"/>

// ---------------- minimal OBJ parser (v/f, triangulated on read) -----------
function parseOBJ(text) {
  const v = [], idx = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      v.push(parseFloat(p[1]) * SCALE, parseFloat(p[2]) * SCALE, parseFloat(p[3]) * SCALE);
    } else if (line.startsWith("f ")) {
      const parts = line.trim().split(/\s+/).slice(1).map(tok => {
        const vi = parseInt(tok.split("/")[0], 10);
        return vi > 0 ? vi - 1 : v.length / 3 + vi;
      });
      for (let i = 2; i < parts.length; i++) { idx.push(parts[0], parts[i - 1], parts[i]); }
    }
  }
  return { positions: new Float32Array(v), indices: new Uint32Array(idx) };
}

// ---------------- MJCF XML tree parser -------------------------------------
function parseXMLTree(xml) {
  // token-walk the <body> nesting and capture each geom's attrs (geoms can span lines)
  const tree = [];
  const stack = [];
  const geomRe = /<geom\s+([\s\S]*?)\/>/g;
  const attr = (s, k) => { const r = s.match(new RegExp(k + '="([^"]+)"')); return r ? r[1] : null; };

  // Pre-extract all geoms in document order with their source offsets so we
  // can attribute them to the innermost enclosing <body>.
  const geoms = [];
  let m;
  while ((m = geomRe.exec(xml))) {
    geoms.push({ start: m.index, attrs: m[1] });
  }
  const bodyRe = /<body\s+([^>]*)>|<\/body>/g;
  let gi = 0;
  while ((m = bodyRe.exec(xml))) {
    if (m[0] === "</body>") { stack.pop(); continue; }
    const a = m[1];
    const node = {
      name: attr(a, "name"),
      pos: (attr(a, "pos") || "0 0 0").split(/\s+/).map(Number),
      quat: attr(a, "quat") ? attr(a, "quat").split(/\s+/).map(Number) : [0, 0, 0, 1],
      children: [], geoms: [],
    };
    // attach any geoms that start inside this body's tag span (before the next
    // <body> or </body> after this offset) — document order guarantees this is
    // the innermost enclosing body for geoms between this tag and the next tag.
    const nextTag = bodyRe.lastIndex;
    while (gi < geoms.length && geoms[gi].start < nextTag) {
      const g = geoms[gi];
      node.geoms.push({
        mesh: attr(g.attrs, "mesh"),
        pos: (attr(g.attrs, "pos") || "0 0 0").split(/\s+/).map(Number),
        quat: attr(g.attrs, "quat") ? attr(g.attrs, "quat").split(/\s+/).map(Number) : [0, 0, 0, 1],
        material: attr(g.attrs, "material") || null,
      });
      gi++;
    }
    if (stack.length) stack[stack.length - 1].children.push(node);
    else tree.push(node);
    stack.push(node);
  }
  return tree;
}

// ---------------- GLB writer ------------------------------------------------
// Nodes carry TRS (translation/rotation quaternion/scale). Meshes are
// referenced by node.mesh (single mesh per node). Materials by index.
function buildGLB(tree, meshCache, poseMap) {
  const json = {
    asset: { version: "2.0", generator: "tools/build_nmf_fly_glb.js (offline packer, NeuroMechFly 2.0 morphology)" },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
  };
  const bins = [];
  let binLen = 0;

  const matIndex = {};
  function materialFor(rgba, kind) {
    const key = kind || rgba.join(",");
    if (matIndex[key] !== undefined) return matIndex[key];
    const [r, g, b, a] = rgba;
    let mat;
    if (kind === "membrane") {
      mat = { name: "wing_membrane", pbrMetallicRoughness: { baseColorFactor: [0.539, 0.686, 0.8, 0.4], metallicFactor: 0, roughnessFactor: 0.55 }, alphaMode: "BLEND", doubleSided: true };
    } else {
      mat = { name: kind || "nmf_body", pbrMetallicRoughness: { baseColorFactor: [r, g, b, a], metallicFactor: 0.05, roughnessFactor: 0.6 } };
    }
    json.materials.push(mat);
    matIndex[key] = json.materials.length - 1;
    return matIndex[key];
  }
  const MATERIALS = {
    body: [0.674, 0.35, 0.143, 1],
    red: [0.8, 0.0279, 0.00154, 1],
    ocelli: [0.128, 0.0488, 0.0154, 1],
    black: [0, 0, 0, 1],
    "bristle-brown": [0, 0, 0, 1],
    lower: [0.799, 0.61, 0.386, 1],
    brown: [0.202, 0.0782, 0.0262, 1],
    membrane: [0.539, 0.686, 0.8, 0.4],
  };

  function accessor(buf, compType, count, type) {
    const bufferView = { buffer: 0, byteOffset: binLen, byteLength: buf.byteLength, target: 34962 };
    json.bufferViews.push(bufferView);
    const acc = { bufferView: json.bufferViews.length - 1, componentType: compType, count, type };
    if (type === "VEC3") {                     // positions: compute min/max now,
      const f = buf;                            // while we still hold this bin.
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < f.length; k += 3) for (let d = 0; d < 3; d++) { if (f[k + d] < min[d]) min[d] = f[k + d]; if (f[k + d] > max[d]) max[d] = f[k + d]; }
      acc.min = min; acc.max = max;
    }
    json.accessors.push(acc);
    bins.push(buf); binLen += buf.byteLength;
    return json.accessors.length - 1;
  }

  const nodeIdxByName = {};
  function addNode(b, parentIdx) {
    const node = { name: b.name, children: [] };
    // Pose source: when a pose map is supplied (--pose, from
    // tools/export_nmf_pose.py) each body node carries that pose's
    // parent-local transform instead of the raw XML qpos=0 one — the joints'
    // passive rest angles (springref) are already folded in by MuJoCo.
    const P = poseMap && poseMap[b.name];
    const q = P ? P.quat : b.quat;                 // MuJoCo wxyz
    node.translation = P ? P.pos : b.pos;
    node.rotation = [q[1], q[2], q[3], q[0]];      // -> glTF xyzw
    json.nodes.push(node);
    const myIdx = json.nodes.length - 1;
    nodeIdxByName[b.name] = myIdx;
    if (parentIdx !== null) json.nodes[parentIdx].children.push(myIdx);

    for (const g of b.geoms) {
      if (!g.mesh) continue;
      const entry = meshCache[g.mesh];
      if (!entry) { console.warn("  missing mesh:", g.mesh); continue; }
      const q = [g.quat[1], g.quat[2], g.quat[3], g.quat[0]];
      const gnode = {
        name: g.mesh,
        translation: g.pos,
        rotation: q,
        mesh: entry.meshIndex,
      };
      json.nodes.push(gnode);
      node.children.push(json.nodes.length - 1);
    }
    for (const c of b.children) addNode(c, myIdx);
    return myIdx;
  }

  // meshes: one glTF mesh per XML mesh name, indexed triangles
  for (const [name, entry] of Object.entries(meshCache)) {
    const posAcc = accessor(entry.positions, 5126, entry.positions.length / 3, "VEC3");
    const idxAcc = accessor(entry.indices, 5125, entry.indices.length, "SCALAR");
    json.meshes.push({ name, primitives: [{ attributes: { POSITION: posAcc }, indices: idxAcc, material: materialFor(MATERIALS[entry.kind] || MATERIALS.body, entry.kind) }] });
  }
  // sort not needed; mesh indices were assigned in meshCache insertion order,
  // and addNode references entry.meshIndex captured at cache build time.
  // NOTE: meshIndex must be assigned BEFORE addNode runs — build order below.

  const rootIdx = addNode(tree[0], null);
  json.scenes[0].nodes = [rootIdx];
  return { json, bins, binLen };
}

// ---------------- main -------------------------------------------------------
function main() {
  // optional: --pose <json> (or a bare json path) = bake a MuJoCo pose
  const argv = process.argv.slice(2);
  const pi = argv.findIndex(a => a === "--pose");
  const posePathArg = pi >= 0 ? argv[pi + 1] : argv.find(a => a.endsWith(".json"));
  let poseMap = null, poseInfo = "qpos = 0 (raw XML body frames)";
  if (posePathArg) {
    const pose = JSON.parse(fs.readFileSync(path.resolve(posePathArg), "utf8"));
    poseMap = pose.bodies;
    poseInfo = pose.pose || "baked pose";
    console.log("pose:", path.basename(posePathArg), "—", poseInfo, "(", Object.keys(poseMap).length, "bodies )");
  }
  const xml = fs.readFileSync(XML_PATH, "utf8");
  const tree = parseXMLTree(xml);
  console.log("root body:", tree[0].name, "top-level children:", tree[0].children.length);

  // collect every mesh referenced and load its OBJ
  const wantMeshes = new Set();
  (function walk(b) { for (const g of b.geoms) if (g.mesh) wantMeshes.add(g.mesh); b.children.forEach(walk); })(tree[0]);
  // resolve mesh name -> OBJ file from the <asset> block
  const assetBlock = xml.slice(xml.indexOf("<asset>"), xml.indexOf("</asset>"));
  const fileOf = {};
  for (const m of assetBlock.matchAll(/<mesh name="([^"]+)" file="([^"]+)"/g)) fileOf[m[1]] = m[2];

  const meshCache = {};
  let tris = 0, missing = 0;
  for (const name of wantMeshes) {
    const file = fileOf[name];
    if (!file) { console.warn("  no <mesh> def for", name); missing++; continue; }
    const p = path.join(ASSETS_DIR, file);
    if (!fs.existsSync(p)) { console.warn("  OBJ not found:", file); missing++; continue; }
    const o = parseOBJ(fs.readFileSync(p, "utf8"));
    if (!o.indices.length) { console.warn("  empty OBJ:", file); missing++; continue; }
    // material kind: trailing token of the mesh name after last '_' segment
    // (body/red/black/lower/brown/membrane/ocelli/bristle-brown); fall back body.
    const known = ["body", "red", "ocelli", "black", "bristle-brown", "lower", "brown", "membrane"];
    let kind = "body";
    for (const k of known) if (name.endsWith(k)) { kind = k; break; }
    meshCache[name] = { ...o, kind, meshIndex: Object.keys(meshCache).length };
    tris += o.indices.length / 3;
  }
  console.log("meshes packed:", Object.keys(meshCache).length, "missing:", missing, "triangles:", tris);

  const { json, bins, binLen } = buildGLB(tree, meshCache, poseMap);
  json.asset.extras = { pose: poseInfo, packer: "tools/build_nmf_fly_glb.js" };
  // glTF 2.0 requires the top-level buffers array; the GLB BIN chunk IS buffer 0.
  json.buffers = [{ byteLength: binLen }];

  // serialize GLB
  let enc = new TextEncoder().encode(JSON.stringify(json));
  if (enc.length % 4) {                       // glTF 2.0: the JSON chunk pads
    const pad = 4 - (enc.length % 4);         // with SPACES (0x20), the BIN
    const e2 = new Uint8Array(enc.length + pad);  // chunk with zeros. Zero-padding
    e2.set(enc); e2.fill(0x20, enc.length);       // the JSON made JSON.parse throw
    enc = e2;                                     // on the trailing NULs.
  }
  const bin = new Uint8Array(binLen);
  let off = 0;
  for (const b of bins) { bin.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), off); off += b.byteLength; }
  const binPad = (4 - (binLen % 4)) % 4;
  const total = 12 + 8 + enc.length + 8 + binLen + binPad;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546C67, true);          // magic 'glTF'
  dv.setUint32(4, 2, true);                    // version
  dv.setUint32(8, total, true);
  dv.setUint32(12, enc.length, true);
  dv.setUint32(16, 0x4E4F534A, true);          // 'JSON'
  new Uint8Array(out, 20).set(enc);
  const binHeaderOff = 20 + enc.length;
  dv.setUint32(binHeaderOff, binLen + binPad, true);
  dv.setUint32(binHeaderOff + 4, 0x004E4942, true); // 'BIN\0'
  new Uint8Array(out, binHeaderOff + 8).set(bin);

  fs.writeFileSync(OUT_PATH, Buffer.from(out));
  const kb = (total / 1024).toFixed(0);
  console.log("wrote", OUT_PATH, kb + " KB,", json.nodes.length, "nodes,", json.meshes.length, "meshes,", json.materials.length, "materials");
  // sanity: parse back the JSON chunk
  const back = fs.readFileSync(OUT_PATH);
  const jl = back.readUInt32LE(12);
  const j = JSON.parse(back.slice(20, 20 + jl).toString("utf8").replace(/[\s\u0000]+$/, ""));
  console.log("verify: GLB JSON chunk parses OK — nodes:", j.nodes.length, "meshes:", j.meshes.length, "scenes:", j.scenes.length);
}
main();
