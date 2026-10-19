// GLSL SHADER INTEGRITY (static) — guards against the Phase 3A regression class.
//
// Phase 3A root cause: a GPU patch used a custom attribute (`aPulseScale`) in
// injected GLSL without declaring it, and a second patch family used a shared
// varying (`vFogDepth`) declared in only one shader stage. Both compile errors
// are SILENT at runtime: three.js drops the program and the mesh renders
// nothing (the "vanishing brain"), while the scene graph stays healthy.
//
// This suite statically extracts every GLSL program in fly_demon_3d.html —
//   (a) template-literal shader consts (P10_EDGE_VERT / P10_EDGE_FRAG),
//   (b) inline `vertexShader:` / `fragmentShader:` literals,
//   (c) every `onBeforeCompile` patch injection string —
// and fails when an identifier is used but never plausibly declared:
//   1. assignment targets must be declared (typed decl, #define, builtin,
//      three.js prelude, or a known #include chunk's external identifiers),
//   2. identifiers following three.js custom-attribute naming convention
//      (aCamelCase / p10-style) must be declared in the same stage,
//   3. inside patch injections, EVERY identifier must be declared (patches
//      are tiny, self-contained, and where 3A-class bugs live),
//   4. varyings referenced in both stages must be declared in BOTH stages,
//   5. every `#include <name>` must be a real chunk in the installed
//      three.module.js and covered by the chunk table below.
// Negative fixtures at the bottom prove each detection actually fires.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// GLSL_TEST_HTML overrides the analyzed file (used by mutation testing).
const HTML_PATH = process.env.GLSL_TEST_HTML || path.join(ROOT, 'fly_demon_3d.html');
const THREE_PATH = process.env.GLSL_TEST_THREE || path.join(ROOT, 'three.module.js');

// --------------------------------------------------------------------------
// Extraction
// --------------------------------------------------------------------------

const TEMPLATE = /`(?:[^`\\]|\\[\s\S])*`/g;

// Decode JS string/template escape sequences so analysis sees the RUNTIME
// text ("\nattribute" is a newline + `attribute` at runtime, not an
// identifier). Unknown escapes lose the backslash, matching JS leniency.
function decodeEscapes(s) {
  return s.replace(/\\(u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|\r\n|[\s\S])/g,
    (m, e) => {
      if (e === 'n' || e === '\n') return '\n';
      if (e === 't' || e === '\t') return '\t';
      if (e === 'r') return '';
      if (e === '0') return '\0';
      if (e === 'b') return '\b';
      if (e === 'f') return '\f';
      if (e === 'v') return '\v';
      return e;
    });
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

// Shader consts following this repo's naming convention: P<digits>_<UPPER>.
function extractShaderConsts(src) {
  const out = [];
  const re = /const\s+(P\d+_[A-Z0-9_]+)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    TEMPLATE.lastIndex = m.index + m[0].length;
    const t = TEMPLATE.exec(src);
    if (!t || t.index !== m.index + m[0].length) continue;
    const name = m[1];
    out.push({
      kind: 'const', name,
      stage: name.endsWith('_VERT') ? 'vertex' : name.endsWith('_FRAG') ? 'fragment' : null,
      glsl: decodeEscapes(t[0].slice(1, -1)),
      line: lineOf(src, m.index),
    });
  }
  return out;
}

// Inline material shader literals: `vertexShader: \`...\`` etc.
function extractInlineShaders(src) {
  const out = [];
  const re = /\b(vertexShader|fragmentShader)\s*:\s*/g;
  let m;
  while ((m = re.exec(src))) {
    TEMPLATE.lastIndex = m.index + m[0].length;
    const t = TEMPLATE.exec(src);
    if (!t || t.index !== m.index + m[0].length) continue; // identifier ref, not literal
    out.push({
      kind: 'inline', name: m[1],
      stage: m[1] === 'vertexShader' ? 'vertex' : 'fragment',
      glsl: decodeEscapes(t[0].slice(1, -1)),
      line: lineOf(src, m.index),
    });
  }
  return out;
}

// onBeforeCompile patches: balanced-brace scan of the assigned function body,
// then every quoted string in the body that carries GLSL content.
function extractPatches(src) {
  const out = [];
  const anchor = /\.onBeforeCompile\s*=\s*/g;
  let a;
  while ((a = anchor.exec(src))) {
    const open = src.indexOf('{', a.index + a[0].length);
    if (open < 0) continue;
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = src.slice(a.index, end + 1);
    const injections = { vertex: [], fragment: [] };
    const touches = { vertex: /shader\.vertexShader/.test(body), fragment: /shader\.fragmentShader/.test(body) };
    const qs = /"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'/g;
    let s;
    while ((s = qs.exec(body))) {
      const val = decodeEscapes(s[1] !== undefined ? s[1] : s[2]);
      if (/(#\s*include|\battribute\s|\bvarying\s|\buniform\s|void\s+main|gl_\b|\bvec[234]\s|\bfloat\s)/.test(val)) {
        // An injection lands in the stage(s) the patch rewrites; when the body
        // touches only one shader property we can attribute it precisely.
        if (touches.vertex && !touches.fragment) injections.vertex.push(val);
        else if (touches.fragment && !touches.vertex) injections.fragment.push(val);
        else { injections.vertex.push(val); injections.fragment.push(val); }
      }
    }
    out.push({ kind: 'patch', line: lineOf(src, a.index), injections, touches, body });
  }
  return out;
}

// --------------------------------------------------------------------------
// GLSL analysis
// --------------------------------------------------------------------------

function stripComments(glsl) {
  return glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// Remove member access (`v.xyz`, `tex.coord`) so swizzles/fields never count
// as standalone identifiers.
function stripMemberAccess(glsl) {
  return glsl.replace(/\.\s*[A-Za-z_]\w*/g, '.');
}

const GLSL_KEYWORDS = new Set(('if else for while return break continue struct in out inout ' +
  'uniform varying attribute const precision highp mediump lowp discard true false void ' +
  'float int uint bool vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uvec2 uvec3 uvec4 ' +
  'mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 ' +
  'sampler2D sampler3D samplerCube sampler2DShadow texture2D texture').split(' '));

// Declared by three.js's program prelude for (non-raw) ShaderMaterial and
// built-in materials, plus the renderer-provided color-space helper.
const THREE_PRELUDE = new Set(('position normal tangent uv uv1 uv2 color modelMatrix modelViewMatrix ' +
  'projectionMatrix viewMatrix normalMatrix cameraPosition isOrthographic linearToOutputTexel').split(' '));

const GLSL_BUILTINS = new Set(('radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt ' +
  'inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot ' +
  'cross normalize faceforward reflect refract dFdx dFdy fwidth shadow2D').split(' '));

// External identifiers provided by three.js ShaderChunks used in this file.
// Keyed by chunk name; if a shader gains an #include not listed here the test
// fails and asks for a conscious table update (never silently guess).
//
// CHUNK_PROVIDES — identifiers the chunk DEFINES or READS (locals like
// `transformed`, or varyings it consumes like fog_fragment reading vFogDepth).
// These satisfy in-stage "known" checks and mark CONSUMPTION in pair checks.
const CHUNK_PROVIDES = {
  common: ['PI', 'RECIPROCAL_PI', 'RECIPROCAL_PI2', 'EPSILON', 'saturate', 'whiteComplement',
    'pow2', 'pow3', 'pow4', 'max3', 'average', 'rand', 'highp_rand'],
  begin_vertex: ['transformed'],
  project_vertex: ['mvPosition'],
  fog_pars_vertex: ['vFogDepth', 'fogDepth', 'fogColor', 'fogNear', 'fogFar', 'fogDensity'],
  fog_vertex: ['vFogDepth', 'fogDepth', 'mvPosition'],
  fog_pars_fragment: ['vFogDepth', 'fogColor', 'fogNear', 'fogFar', 'fogDensity'],
  fog_fragment: ['vFogDepth', 'fogColor', 'fogNear', 'fogFar', 'fogFactor'],
  colorspace_fragment: ['linearToOutputTexel'],
};
// CHUNK_DECLARES — chunks that actually DECLARE a cross-stage varying
// (the *_pars_* chunks). A read-only chunk (fog_fragment) must NOT count as a
// declaration, otherwise a shader that consumes a varying through an include
// while omitting the pars declaration would silently pass (caught live via
// mutation testing of the P10 regression).
const CHUNK_DECLARES = {
  fog_pars_vertex: ['vFogDepth'],
  fog_pars_fragment: ['vFogDepth'],
};

// three.js custom-attribute naming convention: aCamelCase / p10-style slots.
function looksLikeCustomAttribute(name) {
  return /^(a[A-Z]|p\d)/.test(name);
}

function harvestDeclared(glsl) {
  const declared = new Set();
  // qualified global declarations (also captures comma lists)
  const reQ = /\b(?:attribute|varying|uniform|const)\s+\w+\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/g;
  let m;
  while ((m = reQ.exec(glsl))) m[1].split(',').forEach((n) => declared.add(n.trim()));
  // any typed declaration (globals AND locals: `float x =`, `for(int i =`, params)
  const reT = /\b(?:highp|mediump|lowp)?\s*(?:void|float|int|uint|bool|vec[234]|ivec[234]|bvec[234]|uvec[234]|mat[234](?:x[234])?|sampler(?:2D|3D|Cube)(?:Shadow)?)\s+([A-Za-z_]\w*)\s*(?=[;,)=\[])/g;
  while ((m = reT.exec(glsl))) declared.add(m[1]);
  const reD = /#\s*define\s+([A-Za-z_]\w*)/g;
  while ((m = reD.exec(glsl))) declared.add(m[1]);
  const reF = /\b(?:void|float|int|bool|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g;
  while ((m = reF.exec(glsl))) declared.add(m[1]);
  return declared;
}

function harvestIncludes(glsl) {
  const found = [];
  const re = /#\s*include\s*<([\w/]+)>/g;
  let m;
  while ((m = re.exec(glsl))) found.push(m[1]);
  return found;
}

function harvestAssignmentTargets(glsl) {
  const targets = new Set();
  const re = /(?:^|[^\w.>=!<+\-*/&|])([A-Za-z_]\w*)\s*(?:=(?!=)|\+=|-=|\*=|\/=|%=>?)/g;
  let m;
  while ((m = re.exec(glsl))) targets.add(m[1]);
  return targets;
}

function harvestIdentifiers(glsl) {
  const ids = new Set();
  const re = /\b([A-Za-z_]\w*)\b/g;
  let m;
  while ((m = re.exec(glsl))) ids.add(m[1]);
  return ids;
}

// Locals that a material's STANDARD chunk chain defines before the common
// onBeforeCompile injection points (`transformed` from <begin_vertex>). A patch
// injection is inserted INTO the base shader, so these exist in its scope.
// Kept minimal and explicit: custom names still must be declared in the patch.
const PATCH_BASE_SCOPE = new Set(['transformed', 'mvPosition']);

// Core per-stage check. `mode: 'patch'` also flags every undeclared READ
// (patch injections are small and must be fully self-describing apart from the
// base shader's standard scope above).
function checkStage(stage, glslRaw, mode) {
  const findings = [];
  const stripped = stripMemberAccess(stripComments(glslRaw));
  const includes = harvestIncludes(stripped);
  // Analyze the shader body WITHOUT the include directives themselves (their
  // words are not identifiers), but keep chunk-provided names in scope.
  const glsl = stripped.replace(/#\s*include\s*<[\w/]+>/g, ' ');
  const declared = harvestDeclared(glsl);
  for (const inc of includes) {
    const base = inc.split('/').pop();
    if (!(base in CHUNK_PROVIDES)) {
      findings.push(`#include <${inc}> not covered by CHUNK_PROVIDES — extend the table consciously`);
    }
  }
  const chunkNames = new Set();
  for (const inc of includes) {
    const base = inc.split('/').pop();
    for (const n of CHUNK_PROVIDES[base] || []) chunkNames.add(n);
    for (const n of CHUNK_DECLARES[base] || []) chunkNames.add(n);
  }
  const known = (n) =>
    declared.has(n) || chunkNames.has(n) || GLSL_KEYWORDS.has(n) ||
    THREE_PRELUDE.has(n) || GLSL_BUILTINS.has(n) || n.startsWith('gl_') ||
    (mode === 'patch' && PATCH_BASE_SCOPE.has(n));

  const targets = harvestAssignmentTargets(glsl);
  for (const t of targets) {
    if (!known(t)) findings.push(`${stage}: assignment target "${t}" is never declared`);
  }
  for (const id of harvestIdentifiers(glsl)) {
    if (looksLikeCustomAttribute(id) && !declared.has(id) && !GLSL_KEYWORDS.has(id)) {
      findings.push(`${stage}: custom-attribute-style identifier "${id}" is used but has no attribute/varying/uniform declaration in this stage`);
    }
    if (mode === 'patch' && !known(id)) {
      findings.push(`${stage} (patch): identifier "${id}" is used but never declared and not provided by an #include`);
    }
  }
  return { findings, declared, includes: includes.map((i) => i.split('/').pop()) };
}

// Cross-stage varying consistency for a (vertex, fragment) program pair.
// A stage "consumes" a varying either by naming it directly or by including
// a chunk that reads it (e.g. <fog_fragment> reads vFogDepth), and a chunk
// that DECLARES it (<fog_pars_*> counts as that stage's declaration.
function checkPair(name, vertRes, fragRes) {
  const findings = [];
  const isVaryingDecl = (src, n) => new RegExp(`\\bvarying\\s+\\w+\\s+${n}\\b`).test(src);
  const vdecl = [...vertRes.declared].filter((n) => isVaryingDecl(vertRes.src, n));
  const fdecl = [...fragRes.declared].filter((n) => isVaryingDecl(fragRes.src, n));
  const sets = (res) => {
    const provides = new Set(), declares = new Set();
    for (const c of res.includes || []) {
      for (const n of CHUNK_PROVIDES[c] || []) provides.add(n);
      for (const n of CHUNK_DECLARES[c] || []) declares.add(n);
    }
    return { provides, declares };
  };
  const v = sets(vertRes), f = sets(fragRes);
  const used = (res, n) => new RegExp(`\\b${n}\\b`).test(res.src);
  const fDeclAll = new Set([...fdecl, ...f.declares]);
  const vDeclAll = new Set([...vdecl, ...v.declares]);
  for (const n of vdecl) {
    const refFrag = used(fragRes, n) || f.provides.has(n);
    if (refFrag && !fDeclAll.has(n)) {
      findings.push(`${name}: varying "${n}" declared in vertex and consumed in fragment but missing its fragment declaration`);
    }
  }
  for (const n of fdecl) {
    const refVert = used(vertRes, n) || v.provides.has(n);
    if (refVert && !vDeclAll.has(n)) {
      findings.push(`${name}: varying "${n}" declared in fragment and consumed in vertex but missing its vertex declaration`);
    }
  }
  return findings;
}

function analyzePrograms(programs) {
  const results = [];
  for (const p of programs) {
    const res = checkStage(p.stage, p.glsl, 'shader');
    res.src = stripMemberAccess(stripComments(p.glsl));
    res.label = `${p.kind}:${p.name}@L${p.line}`;
    results.push(res);
  }
  return results;
}

// --------------------------------------------------------------------------
// The real-file suite
// --------------------------------------------------------------------------

test('shader extraction finds the known GLSL programs in fly_demon_3d.html', () => {
  const src = fs.readFileSync(HTML_PATH, 'utf8');
  const consts = extractShaderConsts(src);
  const inline = extractInlineShaders(src);
  const patches = extractPatches(src);
  // Structure pins: if extraction goes stale (renamed consts, moved patches),
  // fail loudly here instead of silently checking nothing.
  assert.ok(consts.some((c) => c.name === 'P10_EDGE_VERT' && c.stage === 'vertex'), 'P10_EDGE_VERT const not found');
  assert.ok(consts.some((c) => c.name === 'P10_EDGE_FRAG' && c.stage === 'fragment'), 'P10_EDGE_FRAG const not found');
  const vInline = inline.filter((s) => s.stage === 'vertex');
  const fInline = inline.filter((s) => s.stage === 'fragment');
  assert.ok(vInline.length >= 1 && fInline.length >= 1, 'inline vertex/fragment literals not found');
  assert.ok(patches.length >= 1, 'onBeforeCompile patch not found');
  const p11 = patches.find((p) => /aPulseScale/.test(p.body));
  assert.ok(p11, 'P11 patch (aPulseScale) not found — the brain cloud patch must exist and declare its attribute');
});

test('every shader/patch in fly_demon_3d.html declares what it uses', () => {
  const src = fs.readFileSync(HTML_PATH, 'utf8');
  const consts = extractShaderConsts(src);
  const inline = extractInlineShaders(src);
  const patches = extractPatches(src);

  const findings = [];

  // (a)+(b) full shader programs
  const programs = analyzePrograms([...consts, ...inline].filter((p) => p.stage));
  for (const res of programs) findings.push(...res.findings);

  // (b) cross-stage consistency: const pairs by suffix, inline pairs by order
  const vConsts = consts.filter((c) => c.stage === 'vertex');
  for (const v of vConsts) {
    const frag = consts.find((c) => c.name === v.name.replace(/_VERT$/, '_FRAG'));
    if (frag) {
      const vr = checkStage('vertex', v.glsl, 'shader'); vr.src = stripMemberAccess(stripComments(v.glsl));
      const fr = checkStage('fragment', frag.glsl, 'shader'); fr.src = stripMemberAccess(stripComments(frag.glsl));
      findings.push(...checkPair(v.name, vr, fr));
    }
  }
  const vInl = inline.filter((s) => s.stage === 'vertex');
  const fInl = inline.filter((s) => s.stage === 'fragment');
  for (const v of vInl) {
    const frag = fInl.find((f) => f.line > v.line);
    if (frag) {
      const vr = checkStage('vertex', v.glsl, 'shader'); vr.src = stripMemberAccess(stripComments(v.glsl));
      const fr = checkStage('fragment', frag.glsl, 'shader'); fr.src = stripMemberAccess(stripComments(frag.glsl));
      findings.push(...checkPair(`inline@L${v.line}`, vr, fr));
    }
  }

  // (c) patch injections — fully self-describing
  for (const p of patches) {
    for (const stage of ['vertex', 'fragment']) {
      const joined = p.injections[stage].join('\n');
      if (!joined) continue;
      findings.push(...checkStage(stage, joined, 'patch').findings.map((f) => `${f} (patch@L${p.line})`));
    }
  }

  assert.deepStrictEqual(findings, [], `undeclared GLSL identifiers found:\n  ${findings.join('\n  ')}`);
});

test('every #include chunk exists in the installed three.module.js', () => {
  assert.ok(fs.existsSync(THREE_PATH), `three.module.js not found at ${THREE_PATH}`);
  const three = fs.readFileSync(THREE_PATH, 'utf8');
  const src = fs.readFileSync(HTML_PATH, 'utf8');
  const chunks = new Set();
  for (const p of [...extractShaderConsts(src), ...extractInlineShaders(src)]) {
    for (const c of harvestIncludes(stripComments(p.glsl))) chunks.add(c);
  }
  for (const p of extractPatches(src)) {
    for (const stage of ['vertex', 'fragment']) {
      for (const c of harvestIncludes(stripComments(p.injections[stage].join('\n')))) chunks.add(c);
    }
  }
  assert.ok(chunks.size >= 1, 'expected at least one #include across shaders');
  for (const c of chunks) {
    assert.ok(new RegExp(`\\b${c}\\s*:`).test(three), `chunk <${c}> not found in three.module.js`);
  }
});

// --------------------------------------------------------------------------
// Negative fixtures — prove the checker catches the Phase 3A bug classes.
// --------------------------------------------------------------------------

test('fixture: undeclared attribute in a patch injection is caught (P11 class)', () => {
  const broken = [
    '#include <common>',
    'transformed *= aPulseScale;',
  ].join('\n');
  const fixed = [
    '#include <common>',
    'attribute float aPulseScale;',
    'transformed *= aPulseScale;',
  ].join('\n');
  const bad = checkStage('vertex', broken, 'patch');
  assert.ok(bad.findings.some((f) => f.includes('aPulseScale')), 'broken fixture NOT flagged');
  const good = checkStage('vertex', fixed, 'patch');
  assert.deepStrictEqual(good.findings, [], `fixed fixture falsely flagged: ${good.findings}`);
});

test('fixture: undeclared shared varying is caught (P10 class)', () => {
  const vertBroken = [
    'varying vec3 vColor;',
    'varying float vFogDepth;', // sibling declared
    'attribute float p10Edge;',
    'attribute float p10T;',
    'void main(){',
    '  vColor = vec3(1.0);',
    '  float fogD = -12.0;',
    '  vFogDepth2 = fogD;', // BUG: assigned, never declared in this stage
    '  gl_Position = vec4(p10Edge + p10T, 0.0, 1.0);',
    '}',
  ].join('\n');
  const fragOk = [
    'varying vec3 vColor;',
    'varying float vFogDepth2;',
    'uniform vec3 fogColor;',
    'uniform float fogNear;',
    'uniform float fogFar;',
    'void main(){',
    '  gl_FragColor = vec4(vColor, 1.0);',
    '  #include <fog_fragment>',
    '}',
  ].join('\n');
  // direct stage check catches the assignment-target violation
  const bad = checkStage('vertex', vertBroken, 'shader');
  assert.ok(bad.findings.some((f) => f.includes('vFogDepth2')), 'P10-class assignment NOT flagged');
  // pair check catches the missing-declaration-in-vertex direction
  const fragPair = checkStage('fragment', fragOk, 'shader');
  fragPair.src = stripMemberAccess(stripComments(fragOk));
  const fragOnlyVert = [
    'void main(){',
    '  vFogDepth2 = 1.0;', // used in vertex without declaration
    '}',
  ].join('\n');
  const vr = checkStage('vertex', fragOnlyVert, 'shader');
  vr.src = stripMemberAccess(stripComments(fragOnlyVert));
  const pair = checkPair('fixture', vr, fragPair);
  assert.ok(pair.some((f) => f.includes('vFogDepth2')), 'P10-class pair mismatch NOT flagged');
  // and the honest variant passes
  const vertFixed = vertBroken.replace('  vFogDepth2 = fogD;', '  vFogDepth2 = fogD;').replace(
    'attribute float p10T;', 'attribute float p10T;\n    varying float vFogDepth2;'
  ).replace('varying float vFogDepth;', 'varying float vFogDepth;\n    varying float vFogDepth2;');
  const good = checkStage('vertex', vertFixed, 'shader');
  assert.ok(!good.findings.some((f) => f.includes('vFogDepth2')), 'fixed vertex falsely flagged');
});

test('fixture: unknown #include is caught (chunk table is conscious)', () => {
  const src = '#include <not_a_real_chunk_made_up>\nvoid main(){}';
  const res = checkStage('fragment', src, 'shader');
  assert.ok(res.findings.some((f) => f.includes('not_a_real_chunk_made_up')), 'unknown chunk NOT flagged');
});
