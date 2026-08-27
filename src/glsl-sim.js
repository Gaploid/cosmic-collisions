// The physics shaders: contact cells, the particle mesh, the step itself.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var G = CC.glsl || (CC.glsl = {});
var GLSL_GLOW = G.GLSL_GLOW;

// ---------- the physics, in six passes a step ----------
// 3-D grids live in 2-D atlases: slices side by side. The gravity mesh is a
// fixed 64³ over ±6 R⊕ (8×8 slices of 64×64), its coarse twin 16³ (4×4 of 16²).
var GLSL_GRID = [
  'ivec2 fineAt(ivec3 c) { return ivec2((c.z & 7) * 64 + c.x, (c.z >> 3) * 64 + c.y); }',
  'ivec2 coarseAt(ivec3 c) { return ivec2((c.z & 3) * 16 + c.x, (c.z >> 2) * 16 + c.y); }'
].join('\n');
// The contact grid is a hashed cube of G³ cells (G a power of two), one cell =
// one neighbour radius, wrapping around: far-apart particles may share a cell,
// the distance check sorts them out.
var GLSL_HGRID = [
  'uniform int uGMask;',
  'uniform int uGShift;',
  'uniform int uSXMask;',
  'uniform int uSXShift;',
  'ivec2 hashAt(ivec3 c) { c &= uGMask; return ivec2(((c.z & uSXMask) << uGShift) + c.x, ((c.z >> uSXShift) << uGShift) + c.y); }'
].join('\n');
// the k-th seat of a cell, from the eight slot textures
var GLSL_SLOTS = [
  'float slotAt(int k, ivec2 a) {',
  '  if (k == 0) return texelFetch(uS0, a, 0).r;',
  '  if (k == 1) return texelFetch(uS1, a, 0).r;',
  '  if (k == 2) return texelFetch(uS2, a, 0).r;',
  '  if (k == 3) return texelFetch(uS3, a, 0).r;',
  '  if (k == 4) return texelFetch(uS4, a, 0).r;',
  '  if (k == 5) return texelFetch(uS5, a, 0).r;',
  '  if (k == 6) return texelFetch(uS6, a, 0).r;',
  '  return texelFetch(uS7, a, 0).r;',
  '}'
].join('\n');

// 1. Filling the contact cells, one slot per pass. Every particle draws a
//    one-pixel point at its cell; the depth test keeps the lowest index.
//    Next pass, particles already seated stay away — a depth-peel that stands
//    in for an atomic counter.
var SLOT_VS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uS0;', 'uniform sampler2D uS1;', 'uniform sampler2D uS2;', 'uniform sampler2D uS3;',
  'uniform sampler2D uS4;', 'uniform sampler2D uS5;', 'uniform sampler2D uS6;', 'uniform sampler2D uS7;',
  'uniform ivec2 uSize;',
  'uniform int uK;',
  'uniform float uInvCell;',
  'uniform vec2 uAtlas;',
  'uniform float uInvN;',
  GLSL_HGRID,
  'flat out float vIdx;',
  'void main() {',
  '  int i = gl_VertexID;',
  '  vec3 p = texelFetch(uPos, ivec2(i % uSize.x, i / uSize.x), 0).xyz;',
  '  ivec2 a = hashAt(ivec3(floor(p * uInvCell)));',
  '  float me = float(i);',
  '  bool t = false;',
  '  if (uK > 0) t = t || (texelFetch(uS0, a, 0).r == me);',
  '  if (uK > 1) t = t || (texelFetch(uS1, a, 0).r == me);',
  '  if (uK > 2) t = t || (texelFetch(uS2, a, 0).r == me);',
  '  if (uK > 3) t = t || (texelFetch(uS3, a, 0).r == me);',
  '  if (uK > 4) t = t || (texelFetch(uS4, a, 0).r == me);',
  '  if (uK > 5) t = t || (texelFetch(uS5, a, 0).r == me);',
  '  if (uK > 6) t = t || (texelFetch(uS6, a, 0).r == me);',
  '  if (uK > 7) t = t || (texelFetch(uS7, a, 0).r == me);',
  '  vIdx = me;',
  '  gl_PointSize = 1.0;',
  '  if (t) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); return; }',
  '  gl_Position = vec4((vec2(a) + 0.5) / uAtlas * 2.0 - 1.0, me * uInvN * 2.0 - 1.0, 1.0);',
  '}'
].join('\n');
var SLOT_FS = [
  '#version 300 es',
  'precision highp float;',
  'flat in float vIdx;',
  'out vec4 o;',
  'void main() { o = vec4(vIdx, 0.0, 0.0, 1.0); }'
].join('\n');

// 2. Mass onto the mesh: each particle is eight points, one per corner of its
//    cell, cloud-in-cell weights, added up by blending. Mass is in particles;
//    xyz carry mass-weighted position so a cell knows its centre of mass.
//    A particle beyond the mesh adds instead, into the scratch texel on the
//    row below the atlas, the pull it has on the mesh (it feels the mesh's
//    monopole; this is the equal and opposite, per unit of mesh mass, from
//    last time's monopole), so the mesh is not pushed around one-sidedly.
var DEP_VS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uMat;',      // r — mass, in Earth-mantle particles
  'uniform sampler2D uMono;',
  'uniform ivec2 uSize;',
  'uniform float uInvH;',
  'uniform float uL;',
  'uniform float uEps2;',
  GLSL_GRID,
  'out vec4 vW;',
  'void main() {',
  '  int i = gl_VertexID >> 3, k = gl_VertexID & 7;',
  '  ivec2 tc = ivec2(i % uSize.x, i / uSize.x);',
  '  vec3 p = texelFetch(uPos, tc, 0).xyz;',
  '  float mr = texelFetch(uMat, tc, 0).r;',
  '  vec3 g = (p + uL) * uInvH - 0.5;',
  '  gl_PointSize = 1.0;',
  '  if (any(lessThan(g, vec3(0.0))) || any(greaterThan(g, vec3(63.0)))) {',
  '    if (k != 0) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); vW = vec4(0.0); return; }',
  '    vec4 mono = texelFetch(uMono, ivec2(0), 0);',
  '    vec3 r = mono.xyz / max(mono.w, 1e-6) - p;',
  '    float inv = inversesqrt(dot(r, r) + uEps2);',
  '    gl_Position = vec4(0.5 / 512.0 * 2.0 - 1.0, 512.5 / 513.0 * 2.0 - 1.0, 0.0, 1.0);',
  '    vW = vec4(r * (mr * inv * inv * inv), mr);',
  '    return;',
  '  }',
  '  vec3 f = floor(g), t = g - f;',
  '  ivec3 o = ivec3(k & 1, (k >> 1) & 1, k >> 2);',
  '  ivec3 c = ivec3(f) + o;',
  '  vec3 w3 = mix(1.0 - t, t, vec3(o));',
  '  if (any(greaterThan(c, ivec3(63)))) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); vW = vec4(0.0); return; }',
  '  gl_Position = vec4((vec2(fineAt(c)) + 0.5) / vec2(512.0, 513.0) * 2.0 - 1.0, 0.0, 1.0);',
  '  vW = vec4(p, 1.0) * (w3.x * w3.y * w3.z * mr);',
  '}'
].join('\n');
var DEP_FS = [
  '#version 300 es',
  'precision highp float;',
  'in vec4 vW;',
  'out vec4 o;',
  'void main() { o = vW; }'
].join('\n');

// 3. The coarse mesh: every 4³ block of fine cells summed.
var COARSE_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uFine;',
  GLSL_GRID,
  'out vec4 o;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  ivec3 c = ivec3(me.x & 15, me.y & 15, (me.y >> 4) * 4 + (me.x >> 4));',
  '  vec4 s = vec4(0.0);',
  '  for (int z = 0; z < 4; z++) for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)',
  '    s += texelFetch(uFine, fineAt(c * 4 + ivec3(x, y, z)), 0);',
  '  o = s;',
  '}'
].join('\n');
// 4. Everything on the mesh as one mass, for particles that have left it.
var MONO_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform sampler2D uCoarse;',
  'out vec4 o;',
  'void main() {',
  '  vec4 s = vec4(0.0);',
  '  for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) s += texelFetch(uCoarse, ivec2(x, y), 0);',
  '  o = s;',
  '}'
].join('\n');
// 5. Gravity at every occupied fine cell: the 5³ coarse cells around it are
//    summed fine cell by fine cell (that block is 3.75 R⊕ wide, so the whole
//    planet is in it), the rest of the world as coarse centres of mass. The
//    potential rides in w, for the energy books.
var CELL_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uFine;',
  'uniform sampler2D uCoarse;',
  'uniform float uH;',
  'uniform float uL;',
  'uniform float uEps2;',
  'uniform float uGm;',
  GLSL_GRID,
  'out vec4 o;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  if (me.y >= 512) { o = texelFetch(uFine, me, 0); return; }',   // the scratch row: the pull of what is beyond the mesh, carried through
  '  ivec3 c = ivec3(me.x & 63, me.y & 63, (me.y >> 6) * 8 + (me.x >> 6));',
  '  vec4 mc = texelFetch(uFine, me, 0);',
  '  if (mc.w <= 0.0) { o = vec4(0.0); return; }',
  '  vec3 x = mc.xyz / mc.w;',      // at the cell's centre of mass, not its centre: cell on cell is then equal and opposite, and the mesh keeps momentum

  '  ivec3 cc = c >> 2;',
  '  vec3 acc = vec3(0.0);',
  '  float pot = 0.0;',
  '  for (int kz = 0; kz < 16; kz++) for (int ky = 0; ky < 16; ky++) for (int kx = 0; kx < 16; kx++) {',
  '    ivec3 k = ivec3(kx, ky, kz);',
  '    vec4 m = texelFetch(uCoarse, coarseAt(k), 0);',
  '    if (m.w <= 0.0) continue;',                       // an empty block, near or far, is nothing: most of the 125 near ones are
  '    ivec3 dd = abs(k - cc);',
  '    if (max(dd.x, max(dd.y, dd.z)) <= 2) {',
  '      for (int fz = 0; fz < 4; fz++) for (int fy = 0; fy < 4; fy++) for (int fx = 0; fx < 4; fx++) {',
  '        ivec3 f = k * 4 + ivec3(fx, fy, fz);',
  '        if (f == c) continue;',
  '        vec4 mf = texelFetch(uFine, fineAt(f), 0);',
  '        if (mf.w <= 0.0) continue;',
  '        vec3 r = mf.xyz / mf.w - x;',
  '        float inv = inversesqrt(dot(r, r) + uEps2);',
  '        acc += r * (mf.w * inv * inv * inv); pot -= mf.w * inv;',
  '      }',
  '    } else {',
  '      vec3 r = m.xyz / m.w - x; float inv = inversesqrt(dot(r, r)); acc += r * (m.w * inv * inv * inv); pot -= m.w * inv;',
  '    }',
  '  }',
  '  o = vec4(acc * uGm, pot * uGm);',
  '}'
].join('\n');

// 6. The particles. Contacts from the 27 cells around (a spring-dashpot that
//    keeps the material incompressible and turns impact energy into heat),
//    gravity read off the mesh — or, off the mesh, from its total mass.
//    Symplectic Euler: kick, then drift.
var SIM_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',      // xyz — position, w — body (0 target, 1 impactor)
  'uniform sampler2D uVel;',      // xyz — velocity, w — temperature, K
  'uniform sampler2D uForce;',
  'uniform sampler2D uMono;',
  'uniform sampler2D uMat;',      // r — mass, in Earth-mantle particles
  'uniform sampler2D uS0;', 'uniform sampler2D uS1;', 'uniform sampler2D uS2;', 'uniform sampler2D uS3;',
  'uniform sampler2D uS4;', 'uniform sampler2D uS5;', 'uniform sampler2D uS6;', 'uniform sampler2D uS7;',
  'uniform ivec2 uSize;',
  'uniform float uInvCell;',
  'uniform float uCell;',
  'uniform float uInvH;',
  'uniform float uL;',
  'uniform float uDt;',
  'uniform float uGDt;',          // the mesh gravity's time step: the steps it stands for, as one impulse — or 0
  'uniform float uGm;',
  'uniform float uEps2;',
  'uniform float uTouch;',        // contact distance, 2a
  'uniform float uLink2;',        // neighbour radius²
  'uniform float uK;',            // contact spring
  'uniform float uC;',            // contact dashpot
  'uniform float uInvM;',
  'uniform float uDamp;',
  'uniform float uCreep;',        // the fastest a particle may settle: overlaps left in the packing would otherwise fire it off
  'uniform float uTk;',           // kelvins per unit of heat in a mantle particle
  'uniform float uKappa;',        // how fast touching particles share their heat
  'uniform float uCpIron;',       // iron's heat capacity over the silicates'
  'uniform float uSettle;',       // 1 — damp everything (settling)
  'uniform float uKick;',         // 1 — set the bulk velocities this step
  'uniform vec3 uBulk0;',
  'uniform vec3 uBulk1;',
  'uniform vec3 uCen0;',          // the bodies' centres and spin rates, for
  'uniform vec3 uCen1;',          // settling and the kick
  'uniform vec3 uSpin0;',
  'uniform vec3 uSpin1;',
  'uniform sampler2D uQ;',        // r — the heat this particle holds
  'uniform sampler2D uPPSlot;',   // r — this particle's seat on the loose list, or -1
  'uniform sampler2D uPPForce;',  // the pairwise correction, by seat
  GLSL_GRID,
  GLSL_HGRID,
  GLSL_SLOTS,
  'layout(location = 0) out vec4 oPos;',
  'layout(location = 1) out vec4 oVel;',
  'layout(location = 2) out vec4 oAux;',   // xyz — gravity felt, w — neighbours
  'layout(location = 3) out vec4 oQ;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  int myIdx = me.y * uSize.x + me.x;',
  '  vec4 P = texelFetch(uPos, me, 0);',
  '  vec4 V = texelFetch(uVel, me, 0);',
  '  vec3 p = P.xyz, v = V.xyz;',
  '  float body = P.w;',
  '  float ri = texelFetch(uMat, me, 0).r;',
  '  float ci = ri * (mod(body, 4.0) < 0.5 ? uCpIron : 1.0);',   // heat capacity, in a mantle particle's: iron holds less per kilogram
  '  float Ti = V.w;',
  '  vec3 push = vec3(0.0);',
  '  float nb = 0.0, lost = 0.0, flow = 0.0;',
  '  ivec3 c = ivec3(floor(p * uInvCell));',
  '  vec3 c0 = vec3(c) * uCell;',
  '  for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {',
  '    vec3 lo = c0 + vec3(float(dx), float(dy), float(dz)) * uCell;',
  '    vec3 q = clamp(p, lo, lo + uCell) - p;',       // nearest point of that cell: too far, skip it
  '    if (dot(q, q) > uLink2) continue;',
  '    ivec2 a = hashAt(c + ivec3(dx, dy, dz));',
  '    for (int k = 0; k < 8; k++) {',
  '      float fj = slotAt(k, a);',
  '      if (fj < 0.0) break;',
  '      int j = int(fj);',
  '      if (j == myIdx) continue;',
  '      ivec2 tj = ivec2(j % uSize.x, j / uSize.x);',
  '      vec4 Pj = texelFetch(uPos, tj, 0);',
  '      vec3 d = Pj.xyz - p;',
  '      float r2 = dot(d, d);',
  '      if (r2 < uLink2) {',
  '        float r = sqrt(r2);',
  '        vec3 n = d / max(r, 1e-6);',
  '        float ov = uTouch - r;',
  '        if (ov > 0.0) {',
  '          vec4 Vj = texelFetch(uVel, tj, 0);',
  '          float rj = texelFetch(uMat, tj, 0).r;',
  '          float cij = uC * sqrt(2.0 * ri * rj / (ri + rj));',   // the dashpot for this pair's reduced mass
  '          float vn = dot(Vj.xyz - v, n);',
  '          float fs = uK * ov - cij * vn, fn = max(fs, 0.0), on = step(0.0, fs);',
  '          push -= n * fn;',
  '          lost += cij * vn * vn * on + uK * ov * vn * (1.0 - on);',   // the dashpot's work — or, with the no-tension clamp holding, the spring energy that just vanishes (vn > 0 there, so never negative)
  '          float cj = rj * (mod(Pj.w, 4.0) < 0.5 ? uCpIron : 1.0);',
  '          flow += (Vj.w - Ti) * (2.0 * ci * cj / (ci + cj));',      // heat crosses the contact, hot to cold — the other side books the same number with the sign turned, so none is made or lost
  '        }',
  '        nb += 1.0;',
  '      }',
  '    }',
  '  }',
  '  vec3 grav = vec3(0.0);',
  '  vec3 g = (p + uL) * uInvH - 0.5;',
  '  if (all(greaterThanEqual(g, vec3(0.0))) && all(lessThanEqual(g, vec3(63.0)))) {',
  '    vec3 f = floor(g), t = g - f;',
  '    ivec3 c0 = ivec3(f);',
  '    for (int k = 0; k < 8; k++) {',
  '      ivec3 o = ivec3(k & 1, (k >> 1) & 1, k >> 2);',
  '      vec3 w3 = mix(1.0 - t, t, vec3(o));',
  '      grav += texelFetch(uForce, fineAt(min(c0 + o, ivec3(63))), 0).xyz * (w3.x * w3.y * w3.z);',
  '    }',
  '    grav -= texelFetch(uForce, ivec2(0, 512), 0).xyz * uGm;',   // what is beyond the mesh pulls back
  '  } else {',
  '    vec4 mono = texelFetch(uMono, ivec2(0), 0);',
  '    vec3 r = mono.xyz / max(mono.w, 1e-6) - p;',
  '    float inv = inversesqrt(dot(r, r) + uEps2);',
  '    grav = r * (uGm * mono.w * inv * inv * inv);',
  '  }',
  '  float seat = texelFetch(uPPSlot, me, 0).r;',
  '  if (seat >= 0.0) grav += texelFetch(uPPForce, ivec2(int(seat) & 127, int(seat) >> 7), 0).xyz;',
  '  v += push * (uInvM / ri) * uDt + grav * uGDt;',
  '  vec3 vr = cross(body < 3.5 ? uSpin0 : uSpin1, p - (body < 3.5 ? uCen0 : uCen1));',   // the body's spin at p
  '  if (uSettle > 0.5) {',                                                                    // damp everything but the spin,
  '    vec3 dv = (v - vr) * uDamp;',                                                           // and let nothing run: a pile
  '    float sp = length(dv);',                                                                // packed by hand has overlaps in it,
  '    v = vr + dv * min(1.0, uCreep / max(sp, 1e-9));',                                       // and a deep one is worth escape speed
  '  }',
  '  if (uKick > 0.5) v = (body < 3.5 ? uBulk0 : uBulk1) + vr;',
  // the heat: what the contacts dissipate stays in the material — nothing
  // radiates it away in hours — and spreads by contact; the settling's is
  // not counted, the bodies arrive cold
  '  float Q = uSettle > 0.5 ? 0.0 : texelFetch(uQ, me, 0).r + (lost + flow * uKappa / uTk) * uDt;',
  '  p += v * uDt;',
  '  oPos = vec4(p, body);',
  '  oVel = vec4(v, uTk * Q / ci);',   // w — the temperature this heat makes, in kelvins
  '  oAux = vec4(grav, nb);',
  '  oQ = vec4(Q, 0.0, 0.0, 0.0);',
  '}'
].join('\n');

// The approach is a two-body problem solved on the CPU; the bodies fly in
// rigid, this pass just carries them — and turns each about its centre.
var RIGID_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uVel;',
  'uniform sampler2D uAux;',
  'uniform vec3 uBulk0;',
  'uniform vec3 uBulk1;',
  'uniform vec3 uCen0;',          // centres at the start of the step
  'uniform vec3 uCen1;',
  'uniform vec3 uSpin0;',
  'uniform vec3 uSpin1;',
  'uniform mat3 uRot0;',          // this step's turn
  'uniform mat3 uRot1;',
  'uniform float uDt;',
  'uniform sampler2D uQ;',
  'layout(location = 0) out vec4 oPos;',
  'layout(location = 1) out vec4 oVel;',
  'layout(location = 2) out vec4 oAux;',
  'layout(location = 3) out vec4 oQ;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  vec4 P = texelFetch(uPos, me, 0);',
  '  bool tgt = P.w < 3.5;',
  '  vec3 bulk = tgt ? uBulk0 : uBulk1, cen = tgt ? uCen0 : uCen1;',
  '  vec3 arm = (tgt ? uRot0 : uRot1) * (P.xyz - cen);',
  '  oPos = vec4(cen + arm + bulk * uDt, P.w);',
  '  oVel = vec4(bulk + cross(tgt ? uSpin0 : uSpin1, arm), texelFetch(uVel, me, 0).w);',   // so the readout sees the approach, spin and all

  '  oAux = texelFetch(uAux, me, 0);',
  '  oQ = texelFetch(uQ, me, 0);',
  '}'
].join('\n');

// Putting the particles in spatial order. The lattice is built inside-out,
// and the impact scrambles that; the contact loop then reaches for its
// neighbours' positions all over the texture. Every so often the analysis
// hands back a Morton order of where everything is now, and this pass
// rewrites every per-particle texture in it — a relabelling, nothing else,
// so the physics is the same and the neighbours are next to each other.
var PERM_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uVel;',
  'uniform sampler2D uAux;',
  'uniform sampler2D uQ;',
  'uniform sampler2D uPerm;',       // r — which particle goes here
  'uniform ivec2 uSize;',
  'layout(location = 0) out vec4 oPos;',
  'layout(location = 1) out vec4 oVel;',
  'layout(location = 2) out vec4 oAux;',
  'layout(location = 3) out vec4 oQ;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  int s = int(texelFetch(uPerm, me, 0).r);',
  '  ivec2 t = ivec2(s % uSize.x, s / uSize.x);',
  '  oPos = texelFetch(uPos, t, 0);',
  '  oVel = texelFetch(uVel, t, 0);',
  '  oAux = texelFetch(uAux, t, 0);',
  '  oQ = texelFetch(uQ, t, 0);',
  '}'
].join('\n');

// Read-outs for the books, run only when the analysis runs: the mesh
// potential at the particle (the monopole's, off the mesh), whether it got a
// seat in its contact cell and how many seats that cell has taken, and the
// energy it has dissipated.
var DIAG_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uQ;',
  'uniform sampler2D uForce;',
  'uniform sampler2D uMono;',
  'uniform sampler2D uS0;', 'uniform sampler2D uS1;', 'uniform sampler2D uS2;', 'uniform sampler2D uS3;',
  'uniform sampler2D uS4;', 'uniform sampler2D uS5;', 'uniform sampler2D uS6;', 'uniform sampler2D uS7;',
  'uniform ivec2 uSize;',
  'uniform float uInvCell;',
  'uniform float uInvH;',
  'uniform float uL;',
  'uniform float uEps2;',
  'uniform float uGm;',
  'uniform sampler2D uPPSlot;',
  'uniform sampler2D uPPForce;',
  GLSL_GRID,
  GLSL_HGRID,
  GLSL_SLOTS,
  'out vec4 o;',                  // x — potential, y — seated, +2 off the mesh, z — seats taken in its cell, w — dissipated
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  int myIdx = me.y * uSize.x + me.x;',
  '  vec3 p = texelFetch(uPos, me, 0).xyz;',
  '  ivec2 a = hashAt(ivec3(floor(p * uInvCell)));',
  '  float seated = 0.0, taken = 0.0;',
  '  for (int k = 0; k < 8; k++) {',
  '    float fj = slotAt(k, a);',
  '    if (fj < 0.0) break;',
  '    taken += 1.0;',
  '    if (int(fj) == myIdx) seated = 1.0;',
  '  }',
  '  float phi = 0.0, off = 0.0;',
  '  vec3 g = (p + uL) * uInvH - 0.5;',
  '  if (all(greaterThanEqual(g, vec3(0.0))) && all(lessThanEqual(g, vec3(63.0)))) {',
  '    vec3 f = floor(g), t = g - f;',
  '    ivec3 c0 = ivec3(f);',
  '    for (int k = 0; k < 8; k++) {',
  '      ivec3 oo = ivec3(k & 1, (k >> 1) & 1, k >> 2);',
  '      vec3 w3 = mix(1.0 - t, t, vec3(oo));',
  '      phi += texelFetch(uForce, fineAt(min(c0 + oo, ivec3(63))), 0).w * (w3.x * w3.y * w3.z);',
  '    }',
  '  } else {',
  '    vec4 mono = texelFetch(uMono, ivec2(0), 0);',
  '    vec3 r = mono.xyz / max(mono.w, 1e-6) - p;',
  '    phi = -uGm * mono.w * inversesqrt(dot(r, r) + uEps2);',
  '    off = 2.0;',
  '  }',
  '  float seat = texelFetch(uPPSlot, me, 0).r;',
  '  if (seat >= 0.0) phi += texelFetch(uPPForce, ivec2(int(seat) & 127, int(seat) >> 7), 0).w;',
  '  o = vec4(phi, seated + off, taken, texelFetch(uQ, me, 0).r);',
  '}'
].join('\n');

// 7. The loose material — everything beyond 1.3 radii of the planet's centre:
//    the tidal arm from its root out, the disk, the escapers — gets the
//    gravity among itself corrected pairwise, P³M-style: what Newton gives a
//    pair less what the mesh already gave it, out to five cells. A moonlet a
//    cell or two across, which the mesh can only smear, then binds as it
//    should; the planet, ten cells across, stays on the mesh. First the list's
//    positions are gathered into a compact texture…
var PPGATHER_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uMat;',
  'uniform sampler2D uIndex;',      // r — the particle in this seat, or -1
  'uniform ivec2 uSize;',
  'out vec4 o;',                    // xyz — position, w — mass, or -1 for an empty seat
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  float fi = texelFetch(uIndex, me, 0).r;',
  '  if (fi < 0.0) { o = vec4(0.0, 0.0, 0.0, -1.0); return; }',
  '  int i = int(fi);',
  '  ivec2 t = ivec2(i % uSize.x, i / uSize.x);',
  '  o = vec4(texelFetch(uPos, t, 0).xyz, texelFetch(uMat, t, 0).r);',
  '}'
].join('\n');
// …then every seat is summed against the whole list. The mesh's own pair
// force and potential come as tables by distance (see meshPairTable), Newton's
// is softened at the particle radius, and the difference is tapered out at
// the cut-off.
var PPFORCE_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uList;',
  'uniform int uCount;',
  'uniform float uGm;',
  'uniform float uCut;',
  'uniform float uA2;',             // particle radius²
  'uniform float uTab[64];',        // the mesh's pair force × r², by r/uCut
  'uniform float uPot[64];',        // its pair potential × r
  'out vec4 o;',                    // xyz — acceleration to add, w — potential to add
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  int myIdx = me.y * 128 + me.x;',
  '  vec4 P = texelFetch(uList, me, 0);',
  '  if (myIdx >= uCount || P.w < 0.0) { o = vec4(0.0); return; }',
  '  vec3 acc = vec3(0.0);',
  '  float pot = 0.0, cut2 = uCut * uCut, a = sqrt(uA2);',
  '  for (int j = 0; j < uCount; j++) {',
  '    if (j == myIdx) continue;',
  '    vec4 Q = texelFetch(uList, ivec2(j & 127, j >> 7), 0);',
  '    vec3 d = Q.xyz - P.xyz;',
  '    float r2 = dot(d, d);',
  '    if (r2 >= cut2) continue;',
  '    float r = sqrt(r2);',
  '    float x = clamp(r / uCut * 64.0 - 0.5, 0.0, 63.0);',
  '    int k = int(x), k1 = min(k + 1, 63);',
  '    float t = x - float(k);',
  '    float invN = inversesqrt(r2 + uA2);',
  '    float taper = smoothstep(uCut, 0.8 * uCut, r);',
  '    float fn = invN * invN * invN * r - mix(uTab[k], uTab[k1], t) / max(r2, uA2);',
  '    acc += d / max(r, 1e-6) * (Q.w * fn * taper);',
  '    pot += Q.w * (-invN - mix(uPot[k], uPot[k1], t) / max(r, a)) * taper;',
  '  }',
  '  o = vec4(acc * uGm, pot * uGm);',
  '}'
].join('\n');


G.GLSL_GRID = GLSL_GRID; G.GLSL_HGRID = GLSL_HGRID; G.GLSL_SLOTS = GLSL_SLOTS;
G.SLOT_VS = SLOT_VS; G.SLOT_FS = SLOT_FS; G.DEP_VS = DEP_VS; G.DEP_FS = DEP_FS;
G.COARSE_FS = COARSE_FS; G.MONO_FS = MONO_FS; G.CELL_FS = CELL_FS; G.SIM_FS = SIM_FS;
G.RIGID_FS = RIGID_FS; G.PERM_FS = PERM_FS; G.DIAG_FS = DIAG_FS;
G.PPGATHER_FS = PPGATHER_FS; G.PPFORCE_FS = PPFORCE_FS;

})();
