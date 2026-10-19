# PHASE 3A — Brain Region Visual Regression (Shader Root Cause)

Recorded: 2026-09-25 · branch `deployment/phase-02` · companion to
`PHASE_03_BEHAVIOR.md` (Phase 3 backend experiment) and
`PHASE_02_REPRODUCIBILITY.md` (visual baseline). Status: **root-caused,
fixed with a one-line shader correction, verified live, and gated against
recurrence by a new static test (S11).**

## 1. Symptom and acceptance criterion

The user reported the **brain region disappeared** from the 3D lab
(`fly_demon_3d.html`) after recent implementation work. The Phase 3A brief
required settling, with evidence, which of five regression classes applied
(frontend rendering / scene layout / data-API wiring / visualization state /
actual neural simulation), and required TWO independent acceptances:

1. **Computational brain** — the neural controller exists and responds.
2. **Visible brain region** — the region renders at its intended location.

## 2. Verdict up front

| Class | Finding |
| --- | --- |
| Neural simulation | **Healthy** — 106,765 neurons / 553,807 edges attached, spikes accumulating, all backend suites green |
| Data/API wiring, scene layout, visibility state | **Healthy** — group present (43 objects, scale 1, visible, correct home `(760,190,0)`, in-frustum, unoccluded, 0 NaN) |
| **Frontend rendering** | **ROOT CAUSE** — the brain-cloud shader program failed GLSL compilation; three.js drops invalid programs silently, so the mesh drew nothing while the scene graph stayed "healthy" |

The regression was **not** caused by Phase 2/3 embodiment work (that work
touches only the backend `embodiment/` path; the GPU code arrived with an
uncommitted frontend workstream absent from HEAD).

## 3. Root cause (failure family, with two members)

three.js compiles one GLSL program per material. If compilation or linking
fails, the renderer logs `WebGL: INVALID_OPERATION: useProgram: program not
valid` and **draws nothing for that mesh — silently**, every frame, while
all scene-graph properties (`visible`, `scale`, `parent`, counts) remain
normal. Two members of this family were found in the brain's render path:

**P11 — neuron cloud (the disappearance).** The `onBeforeCompile` patch on
the 106,765-instance `InstancedMesh` injected `transformed *= aPulseScale;`
into the vertex shader but never declared the custom attribute. An
undeclared identifier is a hard GLSL error → program invalid → the entire
neuron cloud renders nothing. Reproduced live by raw-compiling the material's
exact GLSL against the WebGL context:

    ERROR: 0:19: 'aPulseScale' : undeclared identifier
    (→ "Vertex shader is not compiled" at link)

**P10 — connectome cable (companion member).** The `P10_EDGE_VERT` /
`P10_EDGE_FRAG` ShaderMaterial wrote the shared varying `vFogDepth` in the
vertex stage while the fragment stage (which reads it via
`#include <fog_fragment>`) lacked its declaration — same silent-drop
failure, affecting the brain's wiring lines. This fix (adding the missing
`varying float vFogDepth;` to both stages) landed in the worktree from the
same frontend workstream **while Phase 3A diagnostics were running**; the
live instrumentation independently confirmed both the failure mode and the
correctness of that fix before it was known to exist on disk.

The faint "cyan streak" visible during the regression was the brain's
edge-line cables (separate, valid material) rendering without the cloud.

## 4. Why diagnosis was hard (methods record)

Four measurement traps were identified and overcome; recorded here because
they will bite any future live-GL investigation on this app:

1. **Console rate-limiting** — the browser caps repeated WebGL errors
   ("too many errors"), so console silence does *not* imply program health.
   Reliable alternative: sample `gl.getError()` per frame, or hook
   `useProgram` and check `LINK_STATUS`.
2. **Hidden-tab rAF suspension** — offscreen/occluded tabs stop
   `requestAnimationFrame`, so rAF-based probes go silent and draw-error
   captures stay empty (no frames → no draws). Some mid-session "clean"
   readings were artifacts of this. Reliable alternative: drive
   `renderer.render(scene, camera)` manually (exposed at
   `__appScene.renderer`) and sample the error flag after each call.
3. **The error flag is a single latch, not a counter** — `getError` returns
   and clears one flag, so "1 error in a window" cannot distinguish a
   transient from a per-frame failure. Per-frame sampling (dirty N/N frames)
   or draw-call hooks are required.
4. **Probe hooks can break the page** — an early `drawArrays` wrapper
   mis-forwarded arguments and itself produced per-frame exceptions; GL-hook
   evidence was only trusted after re-verifying with fixed wrappers on a
   fresh load.

The decisive instruments, in order of value: (a) raw-compiling the live
material's exact shader strings via `gl.createShader/compileShader` to get
the true info log; (b) hooking `useProgram` to capture
`getProgramInfoLog` ("Vertex shader is not compiled") at first use; (c)
per-object hide/show bisection with per-frame error sampling, which localized
the failing draw to the brain group's child 0 (cloud) and child 8 (cable).

## 5. Exact fix (minimal, no replacement visualization)

**P11** — one declaration line added to the existing patch string in
`fly_demon_3d.html` (the only behavioral change; everything else in the
patch is untouched):

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nattribute float aPulseScale;"
    )

**P11 test pin** — `tests/p11_instance_upload_parity.test.js` pinned the old
broken `onBeforeCompile` source; its pin was updated to require the
*corrected* implementation (declaration + transform present), i.e. a
stricter pin, not a weaker one. Parity suite: 5/5.

**P10** — fixed by the concurrent frontend workstream (fragment-stage
`varying float vFogDepth;` + comments); adopted after independent live
verification (§3). Both fixes coexist in the current file; served bytes ==
disk bytes (verified via `cmp` against the dev server).

No new visualization system, placeholder, animation, or decorative brain
was introduced; the original cloud/cable pipeline is restored as-is.

## 6. Live verification (after/acceptance evidence)

Fresh page load against the current file, both fixes present in the loaded
source:

- **Manual render sweep**: 40 consecutive `renderer.render()` calls,
  **0 GL errors** (per-call `getError` sampling; scheduler-independent
  method, immune to the hidden-tab trap).
- **Scene integrity**: cloud InstancedMesh with `aPulseScale` attribute,
  `count = 106,765`; cable material carries both vFogDepth declarations.
- **Visual**: screenshot shows the full jet-colored neuron cloud rendering
  in the lab's right half at its intended home, LIVE CONNECTOME panel
  counting spikes (1,435,269 during verification), data integrity block
  reporting source 139,255 neurons / 16,847,997 edges, 99.9% anatomical
  mapping, 46 measured hulls.
- **Backend still running**: neuron/edge counts and spike accumulation
  live throughout.

Known non-issue: port 8793 (`warp_server.py`, an optional experimental
sidecar) was not running during verification — the app treats it as
optional (`BASE` fallback); its absence does not affect the brain region.

## 7. Static gate so this class cannot ship again

New suite **`tests/glsl_shader_integrity.test.js`** (6/6 green), wired into
the standard battery as **S11** in `tests/run_smoke.js` (battery now
42/42 ALL GREEN):

- Extracts every GLSL program: shader consts (`P10_EDGE_VERT/_FRAG`),
  inline `vertexShader:`/`fragmentShader:` literals, and every
  `onBeforeCompile` injection (escape-decoding applied so analysis sees
  runtime text).
- Fails on: assignment targets never declared; custom-attribute-style
  identifiers (`aCamelCase`, `p10…`) lacking an in-stage
  `attribute/varying/uniform` declaration; patch injections using any
  identifier outside a documented base-scope allowlist (`transformed`,
  `mvPosition`); varyings consumed in a stage (directly or via an include
  such as `<fog_fragment>`) without that stage's declaration; `#include`
  chunks missing from the installed three.module.js or from the explicit
  `CHUNK_PROVIDES` / `CHUNK_DECLARES` tables (declaring chunks like
  `fog_pars_*` are distinguished from read-only chunks like
  `fog_fragment` — a distinction mutation testing proved necessary).
- **Proven by mutation testing**: two mutants of the real file were
  generated reproducing the actual Phase 3A bugs (P11 declaration removed;
  P10 fragment declaration removed). Both fail the suite with precise
  messages; the real file passes. In-suite negative fixtures pin all
  detection paths, and extraction-structure pins fail loudly if the shader
  code moves or is renamed (the suite cannot silently degrade to checking
  nothing).

## 8. Regression battery (post-fix)

| Suite | Result |
| --- | --- |
| `tests/closed_loop.test.js` (flybody) | 14/14 |
| `tests/closed_loop.test.js` (mock) | 12 pass / 0 fail / 2 by-design skips |
| `tests/stage5_task.test.js` | 13 pass / 0 fail / 1 by-design skip |
| `tests/phase3_behavior.test.js` (flybody) | 8 pass / 0 fail / 1 by-design skip |
| `tests/phase3_behavior.test.js` (mock) | 2 pass / 0 fail / 7 by-design skips |
| P8/P9/P10/P11 frontend parity suites | 28/28 |
| `tests/run_smoke.js` (incl. new S11) | 42/42 ALL GREEN |
| `deployment/deploy_runner.js protocol` | PASS |
| Phase 02 visual baseline replay | MATCH=true (`477eb89d…`) |

Contract invariants untouched by the fix (frontend-only change):
`OBS_DIM = 15`, protocol v1, 8 visual + 7 proprio/contact channels,
200 motor spikes, 200→16 decoder, 16→59 actuator map, reward and learning
pathways.

## 9. Provenance and attribution

- The GPU shader paths (P10/P11) and their regressions arrive from an
  **uncommitted frontend workstream** (absent from HEAD; `vFogDepth` count
  in HEAD: 0). Phase 2/3 embodiment files contain no rendering code and
  did not cause the symptom.
- The P10 fix itself is part of that workstream (landed 17:52Z during
  diagnosis); Phase 3A verified it independently rather than duplicating it.
- Phase 3A's own changes: the P11 declaration line
  (`fly_demon_3d.html`), the strengthened P11 parity pin
  (`tests/p11_instance_upload_parity.test.js`), the new integrity suite
  (`tests/glsl_shader_integrity.test.js`), and S11 integration
  (`tests/run_smoke.js`).

## 10. Residual risks / follow-ups

- Other frontend GPU code (`brain_worker.js`, celltypes workers) has not
  yet been swept for the same failure class; S11 currently covers
  `fly_demon_3d.html` only.
- The live-diagnosis traps in §4 argue for a small permanent debug page or
  in-app GL health indicator (error-flag latch, per-material link status)
  so future regressions are user-visible instead of silent.
- Per the Phase 3A brief, the **pillar task remains paused**; the next
  behavioral task (Phase 3B) should spawn the fly with meaningful target
  separation for real learning headroom.
