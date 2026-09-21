# -*- coding: utf-8 -*-
"""Patch 10b: TrueFly-glb corrections after review.
1) divide the 1.5x flyGroup avatar scale out of the glb size (it is parented
   under flyGroup, so scale compounds),
2) record hidden children by reference instead of only-then-visible (robust
   across brain rebuilds while TrueFly is on),
3) flap about the z axis with mirrored signs (nose +Z, wings sweep along +/-X),
4) keep the cartoon push-brace legs visible while TrueFly is on (they brace
   against the door; the glb model would clip through the door otherwise)."""
from pathlib import Path
import sys

P = Path("fly_demon_3d.html")
src = P.read_text(encoding="utf-8")
reps = []

# 1) compensate the flyGroup scale in the loader ------------------------------
reps.append((
r'''    const s = 170 / Math.max(size.x, size.y, size.z, 1e-6);
    const inner = new THREE.Group();''',
r'''    // flyGroup carries a 1.5x avatar scale which compounds onto the glb, so
    // divide it out to land on the true 170u wingspan in world space
    const s = 170 / (Math.max(size.x, size.y, size.z, 1e-6) * flyGroup.scale.x);
    const inner = new THREE.Group();'''))

# 2) reference-based hide/restore + keep push-brace legs visible --------------
reps.append((
r'''function trueflyApply(){
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
}''',
r'''function trueflyApply(){
  if (!flyGroup) return;
  if (TRUEFLY.on){
    if (TRUEFLY.root && !TRUEFLY.root.parent) flyGroup.add(TRUEFLY.root);
    // hide the cartoon body parts; the group itself keeps pose/hover/position.
    // Hidden set is tracked by reference so it survives brain rebuilds while
    // the mode is on. The push-brace legs stay visible (they brace on the
    // door while pushing; the glb body would clip through the door instead).
    TRUEFLY.hidden = flyGroup.children.filter(o =>
      o !== TRUEFLY.root && o !== pushLegL && o !== pushLegR);
    flyGroup.children.forEach(o => { if (TRUEFLY.hidden.includes(o)) o.visible = false; });
  } else {
    if (TRUEFLY.root && TRUEFLY.root.parent) flyGroup.remove(TRUEFLY.root);
    flyGroup.children.forEach(o => { if (TRUEFLY.hidden.includes(o)) o.visible = true; });
    TRUEFLY.hidden = [];
  }
}'''))

# 3) flap about z with mirrored side signs -------------------------------------
reps.append((
r'''function trueflyWings(phase, amp){ // fly.glb wing flutter, driven by the buzz loop
  TRUEFLY.wings.forEach((w,i)=>{
    const side = w.position.x >= 0 ? 1 : -1;  // hinge sign per wing side
    w.rotation.y = side * amp * Math.sin(phase + i*2.4);
  });
}''',
r'''function trueflyWings(phase, amp){ // fly.glb wing flutter, driven by the buzz loop
  // nose is +Z and the wings sweep back along +/-X, so the hinge is the z
  // axis; mirror the sign per wing side so both wings beat together
  TRUEFLY.wings.forEach((w,i)=>{
    const side = w.position.x >= 0 ? 1 : -1;
    w.rotation.z = side * amp * Math.sin(phase + i*2.4);
  });
}'''))

for i, (old, new) in enumerate(reps):
    n = src.count(old)
    if n != 1:
        sys.exit(f"replacement {i}: expected exactly 1 occurrence, found {n}")
    src = src.replace(old, new)

P.write_text(src, encoding="utf-8")
print(f"patched OK: {len(reps)} replacements applied")
