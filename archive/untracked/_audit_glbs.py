# -*- coding: utf-8 -*-
"""Inspect the 4 GLB assets WITHOUT touching the app: header JSON chunk,
mesh/primitive/material/texture counts, accessor min/max -> bounding boxes,
draw-call estimate, node transforms, and transparency feasibility."""
import json, struct
from pathlib import Path

FILES = {
    "larva_brain_axotactin": "drosophila_larve_brain__axotactin_enhancer_axog.glb",
    "unknown_b7c7":          "b7c7e51c-2912-4f77-bbdf-a440cfbb3527.glb",
    "fiji_brain_stl":        "fiji_sample_-_fly_brain_stl-binary_-_tarea_9.glb",
    "adult_fly_ct":          "drosophila_-_adult_fruit_fly_-_ct_scan.glb",
}

def read_glb_json(path):
    with open(path, "rb") as f:
        magic, ver, length = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67, "not glTF"
        clen, ctype = struct.unpack("<II", f.read(8))
        assert ctype == 0x4E4F534A, "first chunk not JSON"
        return json.loads(f.read(clen))

for key, fn in FILES.items():
    p = Path(fn)
    g = read_glb_json(p)
    meshes = g.get("meshes", [])
    prims = sum(len(m.get("primitives", [])) for m in meshes)
    mats = g.get("materials", [])
    texs = g.get("textures", [])
    imgs = g.get("images", [])
    nodes = g.get("nodes", [])
    # bounding box from POSITION accessors
    lo = [1e30]*3; hi = [-1e30]*3
    verts = 0
    for m in meshes:
        for pr in m.get("primitives", []):
            pa = pr.get("attributes", {}).get("POSITION")
            if pa is not None:
                acc = g["accessors"][pa]
                mn, mx = acc.get("min"), acc.get("max")
                if mn and mx:
                    for i in range(3):
                        lo[i] = min(lo[i], mn[i]); hi[i] = max(hi[i], mx[i])
                verts += acc.get("count", 0)
    # materials transparency
    blend = sum(1 for m in mats if m.get("alphaMode") == "BLEND")
    exts = set()
    for m in mats:
        exts.update(m.get("extensions", {}).keys())
    # scene extents
    ext = [hi[i]-lo[i] for i in range(3)]
    print(f"== {key}  ({p.stat().st_size/1e6:.1f} MB)")
    print(f"   meshes {len(meshes)}  primitives {prims}  materials {len(mats)} (BLEND {blend})  textures {len(texs)}  images {len(imgs)}")
    print(f"   nodes {len(nodes)}  total verts {verts:,}  extensions {sorted(exts) if exts else '-'}")
    if all(v < 1e29 for v in lo):
        print(f"   bbox min {[round(v,1) for v in lo]}  max {[round(v,1) for v in hi]}")
        print(f"   size {[round(v,1) for v in ext]}  (aspect x:y:z = {ext[0]/max(ext[1],1e-9):.2f}:{ext[1]/max(ext[1],1e-9):.2f}:1.00)")
    else:
        print("   bbox: no POSITION min/max (skinned or sparse)")
    # generator
    gen = g.get("asset", {}).get("generator", "?")
    print(f"   generator: {gen[:90]}")
    # node scale/translation samples (first 3 with transforms)
    tf = [(n.get("name","?"), n.get("translation"), n.get("scale"), n.get("rotation")) for n in nodes][:3]
    for t in tf: print("   node:", t)
    print()
