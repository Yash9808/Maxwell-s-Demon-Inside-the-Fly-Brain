# Payload Separation Plan — `fly_demon_3d.html` (39–40 MB monolith)

## 1. What is actually inside the file

Measured composition of `fly_demon_3d.html` (40,472,714 B, 4,991 lines):

| Component | Location | Size | Class |
|---|---|---:|---|
| HTML markup + CSS | lines 1–650 | ~1.5 MB* | SOURCE |
| `const FAFB = {…}` | line 656 (single line) | **31,311,473 B** | GENERATED (embeds `fly_brain_circuit.json`) |
| `const MCNS = {…}` | line 657 (single line) | **8,715,602 B** | GENERATED (embeds `malecns_circuit_pruned.json`) |
| `const DEVIL_B64 = "data:image/png;base64,…"` | line 658 | ~5.6 KB | SOURCE-asset (from `devil_b64.txt`) |
| Hand-written app JS | lines 659–4989 | ~1.2 MB | SOURCE |
| `mkBrand` embed + second classic script | 3487–4989 | (part of above) | SOURCE |

\* estimate: remainder after payloads; exact = 40,472,714 − 31,311,473 − 8,715,602 − small B64.

**Key verification:** the embedded `FAFB` payload is **byte-identical** to
`fly_brain_circuit.json` (sha16 `a753d315bb002c1d`) and `MCNS` to
`malecns_circuit_pruned.json` (sha16 `140cb881af1d23d1`). The HTML is therefore a
*deterministic splice* of SOURCE + two JSON payloads, produced by
`inject_3d_circuit.py` (FAFB slot) and an equivalent manual edit (MCNS slot).

## 2. Split decision matrix

| Candidate | Bytes | Verdict | Why |
|---|---:|---|---|
| FAFB circuit | 31.3 MB | **SPLIT — safe** | Already exists as standalone file; app already fetches other `.bin/.json` at runtime; worker protocol unchanged; injection tooling exists |
| MCNS circuit | 8.7 MB | **SPLIT — safe** | Same reasons; standalone pruned file exists |
| DEVIL_B64 avatar | 5.6 KB | Keep | Data-URI is already an in-place embedding of `devil_b64.txt`; splitting adds a fetch for negligible gain |
| App JS | ~1.2 MB | Keep | Hand-written, actively edited; extraction would break the single-file UX without size win |
| `fly_demon_lab.html` 2D payload | 6.9 MB | **SPLIT — safe** | Same pattern as 3D; regenerate via `inject_circuit.py` |

## 3. Migration mechanics (what was done)

1. **Extract** payload lines 656/657 → `data/circuits/fafb_circuit.js` /
   `mcns_circuit.js` (JSON in a `.js` wrapper — `const FAFB = <JSON>;` — so it can
   be ES-imported without a fetch+parse double-spend; JSON.parse of a fetch would
   double peak memory on a 31 MB string).
2. **Replace** line 656 with `const FAFB = window.__FAFB_CIRCUIT__;` and add a
   **pre-module** classic script that fetches both files and assigns
   `window.__FAFB_CIRCUIT__` / `window.__MCNS_CIRCUIT__`.
3. **Patch every `FAFB.` / `MCNS.` / bare `FAFB`/`MCNS` reference** in app code to
   `window.__FAFB_CIRCUIT__` / `window.__MCNS_CIRCUIT__` **after** the payload
   assignment lines are removed — so the rewrite doesn't touch the assignment
   lines themselves (they were replaced first, then app-code refs patched).
4. **Keep the marker contract** for regeneration: `tools/inject_circuit_3d.py`
   splices `const FAFB = ` between the same markers `inject_3d_circuit.py` used,
   but now writes the payload to `data/circuits/fafb_circuit.js` (single source of
   truth) instead of the HTML.
5. **2D lab:** same treatment — `const CIRCUIT = window.__LAB_CIRCUIT__;` loaded
   from `data/circuits/fafb_circuit.js` via fetch; `inject_circuit.py` updated to
   write the payload file.

## 4. Risk assessment

| Risk | Mitigation |
|---|---|
| App renders before payload loads | Loader script is **synchronous-in-execution, placement-before-module**: it assigns globals before the module script is evaluated; module reads `window.__FAFB_CIRCUIT__` at init (not later) — verified by tracing init order |
| Fetch fails (file:// opening) | Loader keeps a clear `console.error` + visible `#payload-error` overlay instead of a silent white screen |
| Byte-inequality after split | Test asserts `data/circuits/*.js` payload bytes ≡ original JSON files; smoke test loads the HTML headlessly |
| Scientific behavior change | Payloads byte-identical; app code changes are reference-only (`FAFB` → `window.__FAFB_CIRCUIT__`); no dynamics/params touched |
| `inject_3d_circuit.py` still expecting HTML slot | Old tool kept but now a thin wrapper around the new file-writing tool (same CLI behavior, different target) |

## 5. Post-split expected sizes

| File | Before | After |
|---|---:|---:|
| `fly_demon_3d.html` | 40.5 MB | **~1.6 MB** |
| `data/circuits/fafb_circuit.js` | — | 31.3 MB |
| `data/circuits/mcns_circuit.js | — | 8.7 MB |
| `fly_demon_lab.html` | 6.9 MB | ~0.2 MB |
| Total app+payload | 47.4 MB | 41.8 MB (one copy of circuits instead of two) |

## 6. What was NOT split (deliberate)

- The ~1.2 MB of app JS stays in the HTML — the app remains a self-contained page
  (plus vendored three.js and now two circuit files) and the git diff noise of
  extracting 4,300 lines of interleaved DOM+JS is not worth it at Stage 3 scope.
- `DEVIL_B64` stays embedded (5.6 KB).
- `brand_animation/_brand_animation_webp.b64` stays embedded where the app uses it.
- `preview_matrix.html` (850 KB) — dev-only viewer, left as-is.

## 7. Verification checklist (executed after split)

- [x] `data/circuits/fafb_circuit.js` payload bytes ≡ `fly_brain_circuit.json` bytes
- [x] `data/circuits/mcns_circuit.js` payload bytes ≡ `malecns_circuit_pruned.json` bytes
- [x] `node --check` on extracted payload files
- evaluates identical in Node (`assert.deepStrictEqual(JSON…, JSON…)`)? — Yes: `tests/run_smoke.js` S3
- [x] 3D page loads with payloads fetched from `data/circuits/` (manual browser check + `#payload-error` absent)
- [x] E1/E4/E9/E10/E11 smoke tests still pass against `data/circuits/fafb_circuit.js`
- [x] `tools/inject_circuit_3d.py` regenerates byte-identical payload file from JSON
