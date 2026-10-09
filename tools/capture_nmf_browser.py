#!/usr/bin/env python
"""capture_nmf_browser.py — capture the LIVE app's own render of nmf_fly.glb,
from the same named views the offline MuJoCo reference uses.

Companion to tools/render_nmf_reference.py. That tool renders the source of
truth (flybody's MuJoCo model at qpos = qpos_spring) offline; this one renders
the shipped asset (nmf_fly.glb) inside the running app, through the app's own
WebGLRenderer/scene/materials, and writes both to the same directory so the two
can be compared side by side (tools/compose_nmf_reference_plate.py).

What "the live app" means here, precisely:

  * the page is the real fly_demon_3d.html, served by launch_fly_demon_3d.py;
  * the asset is loaded by the app's own TrueFly loader (window.__clGlbPrime,
    the CL-drive warm-up hook), so nmf_fly.glb, its CONFORM fit, its wing rest
    quaternions and its 170u normalization are all the app's;
  * the camera is NOT the app's director: the harness frames the glb subtree's
    own AABB with the same fov/fill the MuJoCo tool uses, so the two frames are
    the same view of the same object. The harness therefore
      - freezes the app's rAF loop (our render is the last one presented),
      - zeroes flyGroup's director yaw/lean, and puts both wing bodies back on
        their baked qpos_spring rest quaternion,
      - hides every other scene object, so the fly stands against the plain
        scene background (the HUD cannot leak in: the image is read back from
        the WebGL drawing buffer, not composited from the DOM),
      - measures the asset's own AABB in the PACKER's coordinates (wrappers
        pinned to identity) so it can be compared with MuJoCo's model AABB.

Outputs (research_data/truefly/reference/):
  browser_<view>.png      the app's render, one per view
  browser_probe.png       self-check render: analytic landmark projection vs the
                          rendered position of welded marker spheres
  browser_facts.json      poses/scale, AABBs, per-view landmark pixels,
                          projection self-check error, asset + page hashes

Usage:
  python tools/capture_nmf_browser.py [--size 640] [--port 8765] [--chrome <exe>]
Run with the same interpreter the rest of the CDP tools use (needs
websocket-client, numpy, Pillow).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

import numpy as np
import websocket
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUTDIR = os.path.join(ROOT, "research_data", "truefly", "reference")
APP_PATH = "/fly_demon_3d.html"

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# Views. REPEAT of tools/render_nmf_reference.py's VIEWS: same (azimuth,
# elevation) in the MuJoCo free-camera convention, mapped here through the
# documented model -> rig axis conform (model +X -> rig +X, model +Z (dorsal) ->
# rig +Y, model +Y (lateral) -> rig -Z), so both tools point at the same view of
# the same fly. `up` is the muJoCo up axis (+Z = dorsal) mapped the same way,
# except dorsal, where the up axis is degenerate and the model's own nose axis
# (+X) is used instead -- the value the offline render measured (nose at 89.7
# deg = up the frame).
VIEWS = [
    {"name": "dorsal", "az": 180.0, "el": 89.5, "up_model": (1.0, 0.0, 0.0)},
    {"name": "lateral", "az": 270.0, "el": 0.0, "up_model": (0.0, 0.0, 1.0)},
    {"name": "front", "az": 0.0, "el": 0.0, "up_model": (0.0, 0.0, 1.0)},
    {"name": "quarter", "az": 315.0, "el": 20.0, "up_model": (0.0, 0.0, 1.0)},
]

FOVY = 45.0          # = flybody's <visual><global fovy="45">; three.js fov is vertical too
FILL = 0.8           # object radius as a fraction of the frame half-height

# Same list as the offline tool; the glb carries the MJCF body names.
LANDMARKS = ["thorax", "head", "abdomen", "wing_left", "wing_right",
             "claw_T1_left", "claw_T3_left", "claw_T1_right"]

MODEL_TO_RIG = np.array([[1.0, 0.0, 0.0],     # rig_x = model_x
                         [0.0, 0.0, 1.0],     # rig_y = model_z  (dorsal)
                         [0.0, -1.0, 0.0]])   # rig_z = -model_y


def eye_dir_model(az_deg, el_deg):
    """MuJoCo free-camera eye direction, measured convention (az=0 -> +X,
    az=90 -> -Y, az=270 -> +Y)."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    return np.array([math.cos(el) * math.cos(az), -math.cos(el) * math.sin(az),
                     math.sin(el)])


def rig_views():
    out = []
    for v in VIEWS:
        eye = MODEL_TO_RIG @ eye_dir_model(v["az"], v["el"])
        up = MODEL_TO_RIG @ np.array(v["up_model"], float)
        out.append({"name": v["name"], "eye": [round(float(x), 9) for x in eye],
                    "up": [round(float(x), 9) for x in up],
                    "az": v["az"], "el": v["el"]})
    return out


# ------------------------------------------------------------------- CDP -----
def find_chrome(explicit=None):
    if explicit:
        return explicit
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("no Chrome/Edge found (pass --chrome)")


def launch_chrome(exe, dbg_port, size, log_path):
    profile = tempfile.mkdtemp(prefix="nmf_capture_chrome_")
    extra = []
    if os.environ.get("NMF_SOFTWARE_GL"):     # opt-in software GL (see docstring)
        extra = ["--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    args = [exe, "--headless=new", "--remote-debugging-port=%d" % dbg_port,
            "--remote-allow-origins=*"] + extra + [
            "--hide-scrollbars", "--mute-audio", "--no-first-run",
            "--no-default-browser-check", "--window-size=%d,%d" % (size, size),
            "--user-data-dir=" + profile, "about:blank"]
    log = open(log_path, "wb")
    proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % dbg_port,
                                        timeout=2) as r:
                json.load(r)
            return proc, profile, log
        except Exception:
            time.sleep(0.5)
    raise SystemExit("chrome devtools never came up on port %d" % dbg_port)


def new_tab(dbg_port, url):
    req = urllib.request.Request(
        "http://127.0.0.1:%d/json/new?%s" % (dbg_port, urllib.parse.quote(url, safe="")),
        method="PUT")
    info = json.loads(urllib.request.urlopen(req, timeout=30).read())
    ws = websocket.create_connection(info["webSocketDebuggerUrl"], timeout=300,
                                     suppress_origin=True, max_size=256 * 1024 * 1024)
    return ws, info


class Cdp:
    """Minimal id-matched CDP client. Non-response messages (events such as
    Inspector.detached or a Target crash report) are kept, not dropped: they are
    what explains a capture that dies mid-way."""

    def __init__(self, ws):
        self.ws = ws
        self.mid = 0
        self.events = []

    def send(self, method, params=None):  # noqa: D401 (CDP call, id-matched)
        self.mid += 1
        mid = self.mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + 300
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            if len(self.events) < 400:
                self.events.append(msg)
        raise RuntimeError("timeout in " + method)

    def notable_events(self, limit=12):
        keep = ["Inspector.detached", "Target.targetCrashed", "Target.crashed",
                "Page.javascriptDialogOpening", "Runtime.executionContextDestroyed",
                "Log.entryAdded"]
        out = []
        for m in self.events:
            meth = m.get("method", "")
            if any(k in meth for k in keep):
                out.append(meth + " " + json.dumps(m.get("params", {}))[:200])
        return out[-limit:]

    def evaluate(self, expr, await_promise=True):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                           "awaitPromise": await_promise})
        if os.environ.get("NMF_DEBUG"):
            print("CDP_RAW", json.dumps(r)[:600])
        if r.get("exceptionDetails"):
            det = r["exceptionDetails"]
            desc = (det.get("exception") or {}).get("description") or det.get("text")
            line = det.get("lineNumber")
            raise RuntimeError("JS exception (line %s): %s" % (line, desc))
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError("JS error: " + str(res))
        return res.get("value")


def close_tab(dbg_port, info):
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/json/close/%s" % (dbg_port, info["id"]),
                               timeout=10).read()
    except Exception:
        pass


# ------------------------------------------------------------ local server ---
def server_answers(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, APP_PATH), timeout=4) as r:
            body = r.read(4096)
            return r.status == 200 and b"<html" in body.lower()
    except Exception:
        return False


def ensure_server(port):
    """Reuse the app's launcher if it is already serving this port; otherwise
    start one (killed at exit). Never opens a browser window."""
    if server_answers(port):
        print("server: reusing the already-running app on port %d" % port)
        return None, port
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "launch_fly_demon_3d.py"),
                             "--port", str(port), "--no-browser"],
                            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True)
    deadline = time.time() + 60
    while time.time() < deadline:
        if server_answers(port):
            print("server: started launch_fly_demon_3d.py on port %d (pid %d)"
                  % (port, proc.pid))
            return proc, port
        if proc.poll() is not None:
            raise SystemExit("launcher exited: " + (proc.stdout.read() or ""))
        time.sleep(0.5)
    raise SystemExit("server on port %d never answered" % port)


# ------------------------------------------------------------------- JS ------
# The setup runs as three small evaluates, each followed by a liveness ping: a
# browser that dies mid-capture then fails on a named stage instead of on the
# next unrelated call.
JS_STAGE_FREEZE = r"""
(async () => {
  const S = window.__appScene, D = window.__trueflyDebug;
  if (!S || !D || !D.tf) throw new Error("app hooks missing");
  // the app exports its three.js namespace as window.THREE (fly_demon_3d.html
  // L1126); fall back to the page's own module file so the revision matches
  const THREE = window.THREE || (await import("./three.module.js"));
  if (!THREE) throw new Error("three.js namespace not reachable");
  const N = __SIZE__;                 // square capture size, drawing-buffer px
  const tf = D.tf, fg = D.fg, renderer = S.renderer, scene = S.scene;
  if (!tf.ready) throw new Error("TrueFly asset not loaded");
  const inner = tf.root, gltfScene = inner.children[0];
  const out = {asset: tf.asset, warnings: []};

  // (1) freeze the app's animation loop: our render must be the last presented
  window.requestAnimationFrame = () => 0;

  // (2) record the app state we are about to override (director pose, fit)
  out.state_before_pixelRatio = renderer.getPixelRatio();
  out.state_before_buffer = [S.renderer.getContext().drawingBufferWidth,
                             S.renderer.getContext().drawingBufferHeight];
  out.state_before = {
    flyGroup_rotation_xyz: [fg.rotation.x, fg.rotation.y, fg.rotation.z],
    flyGroup_position_xyz: [fg.position.x, fg.position.y, fg.position.z],
    flyGroup_scale: fg.scale.x,
    inner_scale: inner.scale.x,
    inner_quaternion_xyzw: inner.quaternion.toArray(),
    inner_position_xyz: inner.position.toArray(),
    conform_quaternion_xyzw: gltfScene.quaternion.toArray(),
  };

  window.__nmfFrozen = out;
  return JSON.stringify(out);
})();
"""

JS_STAGE_MEASURE = r"""
(async () => {
  const S = window.__appScene, D = window.__trueflyDebug;
  const THREE = window.THREE;
  const N = __SIZE__;
  const tf = D.tf, fg = D.fg, renderer = S.renderer, scene = S.scene;
  const inner = tf.root, gltfScene = inner.children[0];
  const out = window.__nmfFrozen;

  // (3) rig-frame orientation: the ASSET is what is under test, so the
  //     director's yaw/lean is zeroed and both wings are put back on their
  //     baked rest quaternion (what trueflyWings composes onto). The reset is
  //     re-applied before EVERY render: an in-flight app frame can still run
  //     once after the rAF override and would write the director pose back.
  const resetPose = () => {
    fg.rotation.set(0, 0, 0);
    (tf.wings || []).forEach(w => {
      if (w.userData && w.userData.nmfRest) w.quaternion.copy(w.userData.nmfRest);
    });
    scene.updateMatrixWorld(true);
  };
  resetPose();
  out.wing_rest_applied = (tf.wings || []).filter(w => w.userData && w.userData.nmfRest)
                                          .map(w => w.name);
  if (out.wing_rest_applied.length !== 2) {
    out.warnings.push("expected 2 wing bodies, got " + out.wing_rest_applied.length);
  }

  // (4) nothing but the glb subtree: the fly against the plain background
  out.hidden = {scene: [], flyGroup: []};
  scene.children.forEach(c => {
    if (c === fg || c.isLight) { return; }
    if (c.visible) { c.visible = false; out.hidden.scene.push(c.name || c.type); }
  });
  fg.children.forEach(c => {
    if (c === inner) { return; }
    if (c.visible) { c.visible = false; out.hidden.flyGroup.push(c.name || c.type); }
  });
  out.lights_kept = scene.children.filter(c => c.isLight).length;
  scene.updateMatrixWorld(true);

  // (5) AABBs. `glb_units` pins BOTH wrappers to identity, so it is the asset
  //     in the packer's own coordinates -- directly comparable with MuJoCo's
  //     model-frame AABB. `flyGroup_local` keeps the app's fit.
  const q = inner.quaternion.clone(), p = inner.position.clone(), s = inner.scale.clone();
  const gq = gltfScene.quaternion.clone();
  inner.quaternion.identity(); inner.position.set(0, 0, 0); inner.scale.setScalar(1);
  gltfScene.quaternion.identity();
  inner.updateMatrixWorld(true);
  const glbBoxWorld = new THREE.Box3().setFromObject(gltfScene, true);
  inner.quaternion.copy(q); inner.position.copy(p); inner.scale.copy(s);
  gltfScene.quaternion.copy(gq);
  scene.updateMatrixWorld(true);
  const worldBox = new THREE.Box3().setFromObject(inner, true);

  // back into flyGroup-local coordinates. flyGroup's rotation is zero and its
  // scale is uniform, so the inverse of its world matrix is rotation-free and
  // an axis-aligned box stays axis-aligned through it.
  const invFg = new THREE.Matrix4().copy(fg.matrixWorld).invert();
  const glbBox = glbBoxWorld.clone().applyMatrix4(invFg);
  const localBox = worldBox.clone().applyMatrix4(invFg);
  const size = worldBox.getSize(new THREE.Vector3());
  const centre = worldBox.getCenter(new THREE.Vector3());
  const glbSize = glbBox.getSize(new THREE.Vector3());
  const glbCentre = glbBox.getCenter(new THREE.Vector3());
  const rec = v => [+v.x.toFixed(6), +v.y.toFixed(6), +v.z.toFixed(6)];
  const R = size.length() / 2;
  const dist = R / (__FILL__ * Math.tan(__FOV__ * Math.PI / 360));

  const gl = renderer.getContext();
  let glRenderer = null;
  try {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { glRenderer = "unavailable"; }

  out.aabb = {
    glb_units: {size: rec(glbSize), centre: rec(glbCentre)},
    flyGroup_local: {size: rec(localBox.getSize(new THREE.Vector3())),
                     centre: rec(localBox.getCenter(new THREE.Vector3()))},
    world: {size: rec(size), centre: rec(centre)},
  };
  out.framing = {fov_y_deg: __FOV__, fill: __FILL__, radius_world: R,
                 distance_world: dist, aspect: 1};

  // landmark world positions: the glb carries one node per MJCF BODY, and the
  // node's origin IS that body's frame origin (same value as data.xpos offline).
  // GLTFLoader may hand a single-primitive node back as a Mesh, so accept any
  // non-mesh match first and report what was found.
  const findBody = n => {
    const hits = [];
    inner.traverse(o => { if (o.name === n) hits.push(o); });
    const pick = hits.find(o => !o.isMesh && !o.isSkinnedMesh) || hits[0] || null;
    return {pick, types: hits.map(o => o.type)};
  };
  out.landmarks_world = {};
  out.landmarks_node_type = {};
  const lmMissing = [];
  __LANDMARKS__.forEach(n => {
    const r = findBody(n);
    out.landmarks_node_type[n] = r.types;
    if (!r.pick) { lmMissing.push(n); return; }
    const w = r.pick.getWorldPosition(new THREE.Vector3());
    out.landmarks_world[n] = rec(w);
  });
  out.landmarks_missing = lmMissing;

  const readback = () => {
    const buf = new Uint8Array(BW * BH * 4);
    gl.readPixels(0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let str = '', CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) {
      str += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    }
    return btoa(str);
  };
  // Capture size = the drawing buffer the app already has (kept square by the
  // harness's square viewport). The renderer is deliberately NOT resized: the
  // viewport, the projection and the readback all take this one value, so a
  // stale drawingBufferWidth cannot silently shift every projected landmark.
  let BW = 0, BH = 0;
  const prep = () => {
    resetPose();
    renderer.setScissorTest(false);      // undo the app's dual-viewport scissor
    BW = gl.drawingBufferWidth;
    BH = gl.drawingBufferHeight;
    renderer.setViewport(0, 0, BW, BH);
  };
  prep();
  if (BW !== BH) {
    out.warnings.push("drawing buffer is not square: " + BW + "x" + BH);
  }
  out.buffer = {before: [out.state_before_buffer[0], out.state_before_buffer[1]],
                at_capture: [BW, BH], requested: N,
                pixelRatio_before: out.state_before_pixelRatio,
                gl_version: gl.getParameter(gl.VERSION), gl_renderer: glRenderer};

  const makeCam = v => {
    const cam = new THREE.PerspectiveCamera(__FOV__, 1, 1, 6000);
    const dir = new THREE.Vector3(v.eye[0], v.eye[1], v.eye[2]).normalize();
    cam.up.set(v.up[0], v.up[1], v.up[2]);
    cam.position.copy(centre).addScaledVector(dir, dist);
    cam.lookAt(centre);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  };
  const project = (cam, vec3) => {
    const p = vec3.clone().project(cam);
    return [(p.x * 0.5 + 0.5) * BW, (1 - (p.y * 0.5 + 0.5)) * BH];
  };

  window.__nmf = {v: {THREE, tf, fg, inner, renderer, scene, gl,
                      R, dist, centre, size, rec, readback, prep, resetPose,
                      makeCam, project, buf: () => [BW, BH]}};
  return JSON.stringify(out);
})();
"""

JS_SETUP = JS_STAGE_FREEZE + "\n" + JS_STAGE_MEASURE

JS_VIEW = r"""
window.__nmf && (async () => {
  const V = window.__nmf.v;
  const v = (__VIEWS__).find(x => x.name === __NAME__);
  const cam = V.makeCam(v);
  V.prep();
  V.renderer.render(V.scene, cam);
  const png = V.readback();
  const lm = {};
  __LANDMARKS__.forEach(n => {
    const hits = [];
    V.inner.traverse(o => { if (o.name === n) hits.push(o); });
    const hit = hits.find(o => !o.isMesh && !o.isSkinnedMesh) || hits[0] || null;
    if (!hit) { lm[n] = null; return; }
    lm[n] = V.project(cam, hit.getWorldPosition(new V.THREE.Vector3()))
              .map(t => +t.toFixed(2));
  });
  return JSON.stringify({
    name: v.name,
    buffer: V.buf(),
    camera: {eye_dir: v.eye, up: v.up, position: V.rec(cam.position),
             lookat: V.rec(V.centre), distance: V.dist, fov_y_deg: __FOV__,
             az_mujoco: v.az, el_mujoco: v.el},
    landmark_px: lm,
    png_b64: png,
  });
})();
"""

# Analytic-vs-rendered sanity check of the harness's own projection math: three
# emissive marker spheres are placed where nothing can occlude them in the
# lateral view, projected analytically, then located in a real render.
JS_PROBE = r"""
window.__nmf && (async () => {
  const V = window.__nmf.v, THREE = V.THREE;
  const v = ({name: "probe", eye: [0, 0, -1], up: [0, 1, 0]});
  const cam = V.makeCam(v);
  // rig axes are parallel to the world axes here (flyGroup rotation zeroed), so
  // these offsets are rig-X / rig-Y: all three land clear of the fly in the
  // lateral view (the fly's half extents are ~0.87R along X and ~0.28R along Y).
  const off = [[0.95, -0.75, 0.0], [-0.95, -0.75, 0.0], [0.0, 0.75, 0.0]]
    .map(o => new THREE.Vector3(V.centre.x + o[0] * V.R, V.centre.y + o[1] * V.R,
                                V.centre.z + o[2] * V.R));
  const mat = new THREE.MeshBasicMaterial({color: 0xff00ff, fog: false});
  const geo = new THREE.SphereGeometry(V.R * 0.03, 16, 12);
  const balls = off.map(p => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p);
    m.layers.set(0);
    V.scene.add(m);
    return m;
  });
  V.scene.updateMatrixWorld(true);
  const analytic = off.map(p => V.project(cam, p).map(t => +t.toFixed(2)));
  V.prep();
  V.renderer.render(V.scene, cam);
  const png = V.readback();
  balls.forEach(b => { V.scene.remove(b); });
  geo.dispose(); mat.dispose();
  V.scene.updateMatrixWorld(true);
  return JSON.stringify({camera: {eye_dir: v.eye, up: v.up, distance: V.dist},
                         buffer: V.buf(),
                         analytic_px: analytic, png_b64: png});
})();
"""


def kill_tree(proc):
    """Chrome leaves renderer/GPU children behind; kill the whole tree."""
    if proc.poll() is None:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=30)
            else:
                proc.terminate()
        except Exception:
            proc.terminate()


def blobs(img_rgb, rgb=(255, 0, 255), tol=90, min_px=10, join_px=25):
    """Centroids of the drawn marker spheres, grouped by proximity."""
    d = np.abs(img_rgb.astype(np.int16) - np.array(rgb, np.int16)).max(axis=2)
    m = d <= tol
    if m.sum() < min_px:
        return []
    ys, xs = np.nonzero(m)
    groups = []
    for x, y in zip(xs.tolist(), ys.tolist()):
        for g in groups:
            if abs(g["x"] / g["n"] - x) < join_px and abs(g["y"] / g["n"] - y) < join_px:
                g["x"] += x
                g["y"] += y
                g["n"] += 1
                break
        else:
            groups.append({"x": x, "y": y, "n": 1})
    return [(g["x"] / g["n"], g["y"] / g["n"], g["n"]) for g in groups if g["n"] > min_px]


def silhouette(img):
    """Foreground mask: everything that is not the plain scene background."""
    bg = img[0, 0].astype(np.int16)
    fg = np.abs(img.astype(np.int16) - bg).max(axis=2) > 12
    if not fg.any():
        return fg, None
    ys, xs = np.nonzero(fg)
    return fg, {"bbox_xyxy": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                "width_px": int(xs.max() - xs.min()), "height_px": int(ys.max() - ys.min()),
                "fill_fraction_of_frame": round(float(fg.mean()), 4),
                "centroid_px": [round(float(xs.mean()), 2), round(float(ys.mean()), 2)]}


def view_facts(img, res, name):
    """One view's entry in browser_facts.json."""
    _fg, sil = silhouette(img)
    return {"camera": res["camera"], "buffer": res["buffer"],
            "landmark_px": res["landmark_px"], "silhouette": sil,
            "png": "browser_%s.png" % name}


def build_facts(args, url, setup, probe, found, probe_err, probe_px):
    facts = {
        "page": url,
        "page_sha256": hashlib.sha256(open(os.path.join(ROOT, "fly_demon_3d.html"),
                                           "rb").read()).hexdigest(),
        "asset": setup["asset"],
        "glb_sha256": hashlib.sha256(open(os.path.join(ROOT, "nmf_fly.glb"),
                                          "rb").read()).hexdigest(),
        "image_size_px": args.size,
        "frames": "rig frame: nose +X, dorsal +Y, lateral +/-Z "
                  "(model frame: nose +X, dorsal +Z, lateral +/-Y)",
        "fill_fraction": FILL,
        "fovy_deg": FOVY,
        "harness": {
            "camera": "harness-framed (not the app director): glb-subtree AABB centre, "
                      "distance = R/(fill*tan(fovy/2)), square 1:1, the app's own "
                      "WebGLRenderer/scene/materials; director yaw+lean zeroed and both "
                      "wings put back on their baked rest quaternion",
            "frozen": "window.requestAnimationFrame replaced by a no-op so the "
                      "harness render is the last presented frame",
            "image_source": "WebGL readPixels from the drawing buffer (no DOM, no HUD)",
            "director_neutralized": {"flyGroup_rotation_xyz_before":
                                     setup["state_before"]["flyGroup_rotation_xyz"],
                                     "wing_rest_applied": setup["wing_rest_applied"]},
            "hidden": setup["hidden"],
            "lights_kept": setup["lights_kept"],
            "buffer": setup["buffer"],
            "warnings": setup["warnings"],
        },
        "state_before": setup["state_before"],
        "aabb": setup["aabb"],
        "framing": setup["framing"],
        "landmarks": LANDMARKS,
        "landmarks_world": setup["landmarks_world"],
        "landmarks_node_type": setup["landmarks_node_type"],
        "landmarks_missing": setup["landmarks_missing"],
        "projection_self_check": {
            "analytic_px": probe["analytic_px"],
            "rendered_px": [[round(b[0], 2), round(b[1], 2), b[2]] for b in found],
            "max_error_px": round(probe_err, 3) if probe_err else None,
            "png": "browser_probe.png" if probe_px is not None else None,
            "note": "three markers welded into the scene at known rig-frame offsets, "
                    "projected analytically with the same camera that rendered them",
        },
        "views": {},
    }
    return facts


def write_facts(path, facts):
    """Facts are re-written after every view: a browser that dies mid-run must
    not take the captures that already succeeded with it."""
    with open(path, "w") as f:
        json.dump(facts, f, indent=1, sort_keys=True)


def to_png(b64, width, height, path):
    """WebGL readPixels is RGBA and bottom-up; PNG (and the offline renders)
    are top-down, so flip the rows."""
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 4)[::-1, :, :3]
    Image.fromarray(arr).save(path)
    return arr


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--size", type=int, default=640)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--dbg-port", type=int, default=9345)
    ap.add_argument("--chrome", default=None)
    ap.add_argument("--outdir", default=OUTDIR)
    ap.add_argument("--keep-chrome", action="store_true")
    ap.add_argument("--views", default="",
                    help="comma-separated subset of views (default: all)")
    ap.add_argument("--skip-probe", action="store_true",
                    help="skip the projection self-check render")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    views = rig_views()
    if args.views:
        want = [s.strip() for s in args.views.split(",") if s.strip()]
        views = [v for v in views if v["name"] in want]
        if not views:
            raise SystemExit("no such view(s): " + args.views)
    server_proc, port = ensure_server(args.port)
    chrome_log = os.path.join(tempfile.gettempdir(), "nmf_capture_chrome.log")
    chrome_proc, profile, logf = launch_chrome(find_chrome(args.chrome), args.dbg_port,
                                               args.size, chrome_log)
    ws, tab = None, None
    try:
        t_start = time.time()
        url = "http://127.0.0.1:%d%s?cdp=1" % (port, APP_PATH)
        ws, tab = new_tab(args.dbg_port, url)
        cdp = Cdp(ws)
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        cdp.send("Log.enable")
        cdp.send("Emulation.setDeviceMetricsOverride",
                 {"width": args.size, "height": args.size, "deviceScaleFactor": 1,
                  "mobile": False})

        def wait(expr, tries, what, delay=1.0):
            for _ in range(tries):
                try:
                    if cdp.evaluate(expr):
                        return True
                except Exception:
                    pass
                time.sleep(delay)
            raise SystemExit("timed out waiting for " + what)

        wait("!!(window.__appScene && window.__trueflyDebug && window.__trueflyDebug.tf)",
             180, "app hooks")
        cdp.evaluate("window.__trueflyDebug.tf.on = true; window.__clGlbPrime(); true")
        wait("window.__trueflyDebug.tf.ready === true && !!window.__trueflyDebug.tf.root",
             180, "nmf_fly.glb load")
        # let the first frame after load settle (the loader applies the mode)
        time.sleep(2.0)
        print("page: TrueFly asset =", cdp.evaluate("window.__trueflyDebug.tf.asset"))
        print("page: wings found    =", cdp.evaluate("window.__trueflyDebug.tf.wings.length"))

        def stage(label, js):
            """Evaluate one setup stage, ping the page before and after it."""
            if cdp.evaluate("1+1") != 2:
                raise RuntimeError("page unreachable before stage " + label)
            val = cdp.evaluate(js)
            print("  stage %-9s ok (%.1fs)" % (label, time.time() - t_start))
            return val

        def fill(js):
            return (js.replace("__LANDMARKS__", json.dumps(LANDMARKS))
                      .replace("__FILL__", repr(FILL))
                      .replace("__FOV__", repr(FOVY))
                      .replace("__SIZE__", str(args.size)))

        frozen = json.loads(stage("freeze", fill(JS_STAGE_FREEZE)))
        setup = json.loads(stage("measure", fill(JS_STAGE_MEASURE)))
        setup = dict(frozen, **setup)
        time.sleep(0.8)      # let the frozen loop finish its in-flight frame
        # re-render once more after the freeze, then probe + views
        probe = {"png_b64": None, "buffer": [args.size, args.size],
                 "analytic_px": [], "camera": {}}
        if not args.skip_probe:
            probe = json.loads(cdp.evaluate(JS_PROBE))
        bw, bh = probe["buffer"]
        if (bw, bh) != (args.size, args.size):
            print("WARNING: probe drawing buffer is %dx%d, requested %dx%d"
                  % (bw, bh, args.size, args.size))
        probe_px = (to_png(probe["png_b64"], bw, bh,
                           os.path.join(args.outdir, "browser_probe.png"))
                    if probe["png_b64"] else None)

        # ---- projection self-check: analytic vs the rendered marker blobs ----
        found = sorted(blobs(probe_px), key=lambda b: b[0]) if probe_px is not None else []
        analytic = sorted([tuple(p) for p in probe["analytic_px"]], key=lambda p: p[0])
        errs = [math.hypot(ax - fx, ay - fy) for (ax, ay), (fx, fy, _n) in zip(analytic, found)]
        probe_err = max(errs) if errs else None

        # ---- views (still inside the live browser's scope) -------------------
        facts = build_facts(args, url, setup, probe, found, probe_err, probe_px)
        write_facts(os.path.join(args.outdir, "browser_facts.json"), facts)
        if setup["landmarks_missing"]:
            print("WARNING: landmarks not found in the glb:", setup["landmarks_missing"])
        t0 = time.time()
        for v in views:
            print("capture: view %s ... (t+%.1fs)" % (v["name"], time.time() - t0))
            js = (JS_VIEW.replace("__VIEWS__", json.dumps(views))
                         .replace("__NAME__", json.dumps(v["name"]))
                         .replace("__LANDMARKS__", json.dumps(LANDMARKS))
                         .replace("__FOV__", repr(FOVY)))
            try:
                res = json.loads(cdp.evaluate(js))
            except Exception as e:
                # a dead CDP socket means the tab went away mid-capture; say so
                # instead of failing on the next unrelated call
                print("capture of view %s failed: %s" % (v["name"], e))
                for ev in cdp.notable_events():
                    print("  cdp event:", ev)
                print("  chrome log tail (%s):" % chrome_log)
                tail = open(chrome_log, "rb").read().decode("utf8", "replace").splitlines()[-12:]
                for line in tail:
                    print("   |", line)
                write_facts(os.path.join(args.outdir, "browser_facts.json"), facts)
                print("  partial facts written for the views that succeeded:",
                      sorted(facts["views"]))
                raise
            vw, vh = res["buffer"]
            img = to_png(res["png_b64"], vw, vh,
                         os.path.join(args.outdir, "browser_%s.png" % v["name"]))
            facts["views"][v["name"]] = view_facts(img, res, v["name"])
            write_facts(os.path.join(args.outdir, "browser_facts.json"), facts)
            print("%-8s silhouette %sx%s (%.1f%% of frame)  landmarks %d/%d"
                  % (v["name"], facts["views"][v["name"]]["silhouette"]["width_px"],
                     facts["views"][v["name"]]["silhouette"]["height_px"],
                     100 * facts["views"][v["name"]]["silhouette"]["fill_fraction_of_frame"],
                     len([x for x in res["landmark_px"].values() if x]), len(LANDMARKS)))
    finally:
        if ws:
            ws.close()
        if tab:
            close_tab(args.dbg_port, tab)
        if not args.keep_chrome:
            kill_tree(chrome_proc)
            shutil.rmtree(profile, ignore_errors=True)
        logf.close()
        if server_proc:
            server_proc.terminate()
            print("server: stopped the launcher we started")

    print("setup:", json.dumps({k: setup[k] for k in
                                ("asset", "warnings", "buffer", "framing")}, indent=1))
    print("AABB glb units :", setup["aabb"]["glb_units"])
    print("AABB rig-local :", setup["aabb"]["flyGroup_local"])
    print("pose before    : flyGroup rot %s scale %s | conform %s"
          % ([round(v, 4) for v in setup["state_before"]["flyGroup_rotation_xyz"]],
             round(setup["state_before"]["flyGroup_scale"], 4),
             [round(v, 4) for v in setup["state_before"]["conform_quaternion_xyzw"]]))
    print("hidden         : scene %d objs, flyGroup %d children"
          % (len(setup["hidden"]["scene"]), len(setup["hidden"]["flyGroup"])))
    if probe_err is None:
        print("projection self-check: skipped or unmatched (markers found: %d/%d)"
              % (len(found), len(analytic)))
    else:
        print("projection self-check: %d/%d markers found, max error %.2f px"
              % (len(found), len(analytic), probe_err))
    path = os.path.join(args.outdir, "browser_facts.json")
    print("wrote", os.path.relpath(path, ROOT).replace("\\", "/"))
    if probe_err is None:
        return 2
    return 0 if probe_err < 2.0 else 1


if __name__ == "__main__":
    sys.exit(main())
