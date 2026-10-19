# UI PLAN — Maxwell's Demon: Inside the Fly Brain

Date: 2026-09-26 · Status: partially implemented (marked ✅), rest proposed
Scope: presentation/layout only; never the simulation, datasets, or science.

## Design principles (the "why" behind every placement)

1. **The stage is the hero.** The 3D viewports exist to watch a demon gate
   particles and a fly brain decide. Every panel is furniture around that
   story — nothing may permanently cover center stage.
2. **One exhibit per viewport.** Left = apparatus (chamber, gate, demon, fly).
   Right = brain. Enforced by camera layers so no zoom level mixes them.
3. **Controls near their subject.** Experiment controls live in the LEFT lab
   drawer (they drive the apparatus); brain inspection lives in the RIGHT
   connectome panel (it inspects the brain); time/learn telemetry attaches to
   whichever exhibit it describes.
4. **Read-only overlays may overlap the stage; input panels may not.** A HUD
   number floating over the 3D scene is fine. A panel you must click steals
   from the interaction space and gets a docked, collapsible slot.
5. **Progressive disclosure.** Everything secondary starts collapsed; the user
   opens what they follow. State persists (localStorage).

## Zone map

```
+----------------------------------------------------------------------+
| T0 top bar: brand · dataset · fps · backend badges · sim state        |
| T1 top bar right: nav tabs (INFORMATION/TEST) · pause · help         |
+------------------+------------------------------+--------------------+
| L1 lab drawer    |  S1 LEFT VIEWPORT            | R1 connectome pnl  |
| (collapsible)    |  apparatus: chamber + GATE   | (collapsible)      |
|  · dataset switch|  + gatekeeper + fly          |  · spike heat      |
|  · demon driver  |  (demon-centric framing)     |  · compare chips   |
|  · fly-goal      |                              |  · integrity       |
|  · experiment    |  S2 divider (drag)           |  · region firing   |
|    cards E1..E11 |------------------------------| R2 CAUSAL CHAIN    |
|    + ETAs        |  S3 RIGHT VIEWPORT           |    (collapsed bar  |
|  · watch speed   |  brain exhibit only          |     below R1)      |
+------------------+------------------------------+--------------------+
| B0 bottom: color legend strip (fixed, full width)                     |
+----------------------------------------------------------------------+
| Ephemeral center-bottom toasts (POOF, reforms, perf) — never docked   |
+----------------------------------------------------------------------+
```

## Placement decisions & rationale

- **T0/T1 top bar (full width, 1 row):** identity + global state first; every
  badge here is *answerable in one glance* (fps, backend, sim state). ✅ exists.
- **L1 lab drawer (left, collapsible [−]):** ALL simulation drivers + ALL
  experiment cards. Rationale: the left viewport it controls is adjacent —
  Fitts's law; and it can scroll independently without hiding the stage.
  Inside, order = dataset → demon driver → fly goal → experiments (→ chat),
  i.e. *setup before runs*. ✅ exists; experiment card order should follow
  the lab groupings it already has (DEMON LAB / INFORMATION / FLY BRAIN /
  QUANTUM / CLOSED-LOOP).
- **S1 left viewport:** the apparatus world ONLY (camera layer 0). Default
  framing is demon-centric: chamber fills the visible strip right of the
  drawer, gate + gatekeeper near center. ✅ implemented:
  `apparatusFraming()` → target (−730, −170, 0), dist 1350, pitch 0.35,
  yaw 0.15. The GATE beacon (pillars + tag) marks the door; the tag was
  raised above the demon's watch post so it can never cover him. ✅
- **S2 divider:** 4px DOM strip, draggable 0.15–0.85, persisted. It is the
  contract between the two exhibits; the 3D split line was retired. ✅
- **S3 right viewport:** brain ONLY (camera layer 1). Its camera tracks the
  brain group wherever staging re-parents it (guest stages, HF arena). ✅
- **R1 connectome panel (right, top:118px):** the ONLY permanently-open
  panel, because it is the live readout of the right viewport's exhibit.
  Collapsible; flash-on-event preserved. ✅ exists.
- **R2 CAUSAL CHAIN:** was z-55 at top:64px, overlapping R1 (the reported
  bug). Now: default-collapsed, docks BELOW R1's measured bottom, remembers
  open state. Rationale: it is a *follow-along* telemetry feed, not a
  control — it must never steal R1's space by default. ✅ fixed.
- **B0 legend strip:** full-width bottom, fixed height — the one place both
  exhibits' color languages coexist. ✅ exists.
- **Toasts:** center-bottom, ephemeral (fade ≤ 6 s). Narrative events (POOF,
  demon reforms) belong to the stage, not to a dock. ✅ exists.

## Remaining proposals (not yet implemented)

1. **Auto-collapse L1 on narrow viewports** (< 1200 px) with a [→] tab, so
   the apparatus keeps ≥ 60% of the visible strip.
2. **Right-viewport mini-HUD** (top-left of S3): current dataset, region
   under cursor, N active — reads without opening R1.
3. **Experiment card run-state mirrors on the stage:** when E9–E11 run, show
   a small stage-corner chip ("E9 · trial 12/24 · ×10") instead of relying
   on the lab-drawer status text.
4. **Framing presets:** buttons [Gate] [Whole lab] [Fly] that tween
   `apparatusFraming()` parameters; the demon-centric default is preset 1.
5. **Keyboard map** pinned to T1 (G = frame gate, B = frame brain, D =
   divider focus) once presets land.

## Non-goals

- No movement of simulation files, worker protocol, dataset schema, or any
  statistic. UI plan touches DOM/CSS/camera/presentation only.
- No auto-rotation: `orbit.auto` stays pinned 0 everywhere (user request).
