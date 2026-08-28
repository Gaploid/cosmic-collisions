// The picture: sphere impostors, the bilateral blur that melts them into a
// skin, the surface drawn on that skin, the shading, the sky, the sun,
// bloom, the film.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var G = CC.glsl || (CC.glsl = {});
var GLSL_MATCOL = G.GLSL_MATCOL, GLSL_GLOW = G.GLSL_GLOW, GLSL_HASH = G.GLSL_HASH;

// Noise, for the surface and for the sky: gradient noise on an integer
// lattice keyed by the engine's own hash, its fractal sum, and a cellular
// noise whose cells are craters. Three dimensions throughout — the surface is
// sampled in the grain's own coordinates and the sky by direction — so there
// is no seam and no pole anywhere.
var GLSL_NOISE = [
  GLSL_HASH,
  'vec3 grad3(ivec3 c) {',
  '  uint h = hash(uint(c.x + 0x4000) * 0x9E3779B1u ^ uint(c.y + 0x4000) * 0x85EBCA77u ^ uint(c.z + 0x4000) * 0xC2B2AE3Du);',
  '  return vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) * (2.0 / 1023.0) - 1.0;',
  '}',
  'float gnoise(vec3 p) {',
  '  vec3 i = floor(p), f = p - i, u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
  '  ivec3 c = ivec3(i);',
  '  float a = dot(grad3(c), f), b = dot(grad3(c + ivec3(1, 0, 0)), f - vec3(1.0, 0.0, 0.0));',
  '  float cc = dot(grad3(c + ivec3(0, 1, 0)), f - vec3(0.0, 1.0, 0.0)), d = dot(grad3(c + ivec3(1, 1, 0)), f - vec3(1.0, 1.0, 0.0));',
  '  float e = dot(grad3(c + ivec3(0, 0, 1)), f - vec3(0.0, 0.0, 1.0)), g = dot(grad3(c + ivec3(1, 0, 1)), f - vec3(1.0, 0.0, 1.0));',
  '  float hh = dot(grad3(c + ivec3(0, 1, 1)), f - vec3(0.0, 1.0, 1.0)), k = dot(grad3(c + ivec3(1, 1, 1)), f - vec3(1.0, 1.0, 1.0));',
  '  return mix(mix(mix(a, b, u.x), mix(cc, d, u.x), u.y), mix(mix(e, g, u.x), mix(hh, k, u.x), u.y), u.z);',
  '}',
  'float fbm(vec3 p, int oct) {',
  '  float s = 0.0, a = 0.5;',
  '  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * gnoise(p); p = p * 2.03 + vec3(11.7, 5.3, 7.9); a *= 0.5; }',
  '  return s;',
  '}',
  // craters: a jittered lattice of cells, a bowl in the cells that have one
  // (a fraction fill of them), each of its own size. The surface cuts the
  // lattice on a curve, so a bowl is big where the cut passes near its centre
  // and small or absent where it passes wide: a spread of sizes for free.
  // Returns the height — the floor down, the rim up — and a mask of the floor.
  'vec2 craters(vec3 p, float fill) {',
  '  vec3 i = floor(p), f = p - i;',
  '  float best = 9.0;',
  '  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {',
  '    vec3 g = grad3(ivec3(i) + ivec3(x, y, z)) * 0.5 + 0.5;',
  '    if (g.z > fill) continue;',
  '    vec3 r = vec3(float(x), float(y), float(z)) + g * 0.7 + 0.15 - f;',
  '    float rr = 0.2 + 0.24 * g.y;',
  '    best = min(best, dot(r, r) / (rr * rr));',
  '  }',
  '  float d = sqrt(best);',
  '  float bowl = d < 1.0 ? -(1.0 - d * d) : 0.0;',
  '  float rim = smoothstep(0.7, 1.0, d) * (1.0 - smoothstep(1.0, 1.45, d));',
  '  return vec2(bowl * 0.8 + rim * 0.5, 1.0 - smoothstep(0.8, 1.0, d));',
  '}'
].join('\n');


// The body, in three screen-space passes — the trick fluid renderers use.
// 1. Every body-particle is a sphere impostor with per-fragment depth; the
//    pass keeps its material colour, its heat, its view-space depth, and its
//    home — where it sat in its body when the body was built.
// 2. A bilateral blur one particle wide smooths depth, colour and home along
//    the surface but never across a silhouette — the balls melt into a skin,
//    and the homes into a coordinate field that rides the material.
// 3. Normals come from the smoothed depth, a surface is drawn in the home
//    coordinates, and the skin is lit by the sun.
var G_VS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uVel;',
  'uniform sampler2D uAux;',
  'uniform sampler2D uHome;',  // xyz — the particle's place in its body's own frame; a sim without one binds a dummy and uHomeOn is 0
  'uniform float uHomeOn;',
  'uniform ivec2 uSize;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform float uRad;',
  'uniform sampler2D uMat;',
  'uniform float uRadPow;',   // 0 — every particle the same size; 1/3 — by the cube root of its mass
  'uniform float uPx;',
  'uniform float uMaxPt;',
  'uniform float uFat;',
  'uniform float uMetal[8];',  // which materials are metal, by index — the page says
  GLSL_MATCOL,
  'out float vZc;',
  'out float vR;',
  'out float vNb;',
  'out vec4 vMat;',        // rgb — material, a — temperature
  'out vec4 vHome;',       // xyz — home, w — metal
  'void main() {',
  '  ivec2 tc = ivec2(gl_VertexID % uSize.x, gl_VertexID / uSize.x);',
  '  vec4 P = texelFetch(uPos, tc, 0);',
  '  vec4 e = uView * vec4(P.xyz, 1.0);',
  '  vNb = texelFetch(uAux, tc, 0).w;',
  '  vZc = e.z;',
  '  vR = uRad * pow(max(texelFetch(uMat, tc, 0).r, 1e-9), uRadPow) * mix(1.0, uFat, smoothstep(0.0, 6.0, vNb));',    // packed particles run fat, so the skin has no gaps
  '  vMat = vec4(matColor(P.w), texelFetch(uVel, tc, 0).w);',
  '  vHome = vec4(texelFetch(uHome, tc, 0).xyz * uHomeOn, uMetal[clamp(int(P.w + 0.5), 0, 7)]);',
  '  gl_Position = uProj * e;',
  '  gl_PointSize = clamp(2.1 * vR * uPx / max(-e.z, 0.05), 1.0, uMaxPt);',
  '}'
].join('\n');

var G_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform float uP22;',
  'uniform float uP32;',
  'in float vZc;',
  'in float vR;',
  'in float vNb;',
  'in vec4 vMat;',
  'in vec4 vHome;',
  'layout(location = 0) out vec4 oMat;',
  'layout(location = 1) out vec4 oDep;',   // r — view depth, g — neighbours, and in its fraction the coverage: 1 wherever a particle drew
  'layout(location = 2) out vec4 oHome;',
  'void main() {',
  '  vec2 d = gl_PointCoord * 2.0 - 1.0;',
  '  float r2 = dot(d, d);',
  '  if (r2 > 1.0) discard;',
  '  float ze = min(vZc + vR * sqrt(1.0 - r2), -0.05);',
  '  gl_FragDepth = ((uP22 * ze + uP32) / (-ze)) * 0.5 + 0.5;',
  '  oMat = vMat;',
  '  oDep = vec4(-ze, vNb + 0.999, 0.0, 1.0);',
  '  oHome = vHome;',
  '}'
].join('\n');

var BLUR_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform sampler2D uMat;',
  'uniform sampler2D uDep;',
  'uniform sampler2D uHome;',
  'uniform ivec2 uDir;',
  'uniform int uTaps;',
  'uniform float uStep;',
  'uniform float uRange;',      // the depth jump that ends a surface
  'uniform ivec2 uRes;',
  'layout(location = 0) out vec4 oMat;',
  'layout(location = 1) out vec4 oDep;',
  'layout(location = 2) out vec4 oHome;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  vec2 d0 = texelFetch(uDep, me, 0).rg;',
  '  float z0 = d0.r, nb = floor(d0.g);',
  '  float sigc = float(uTaps) * uStep * 0.18 + 0.5;',
  '  int ct = min(uTaps, int(ceil(2.5 * sigc / uStep)));',                                      // its own reach, narrower than the depth blur's
  // and, over the same reach, the most neighbours any pixel of the same
  // surface has. A grain that fell back onto a skin has few of its own, but
  // it lies in a skin that has many, and it is drawn as part of that skin:
  // left to its own count it stood as a raw ball on a smoothed surface, and
  // the next pass smeared its pixel-snapped edge along the skin as streaks
  // that flickered whenever the camera moved. A loner in space, or a mote in
  // front of a body, has no such neighbour at its depth and keeps its own
  '  float cw = 0.0, cs = 0.0, nbx = nb;',
  '  for (int i = -ct; i <= ct; i++) {',
  '    float x = float(i) * uStep;',
  '    ivec2 c = clamp(me + uDir * int(round(x)), ivec2(0), uRes - 1);',
  '    float g = exp(-x * x / (2.0 * sigc * sigc));',
  '    vec2 dc = texelFetch(uDep, c, 0).rg;',
  '    cw += g; cs += g * fract(dc.g);',
  '    if (dc.r > 0.0 && abs(dc.r - z0) < uRange) nbx = max(nbx, floor(dc.g));',
  '  }',
  '  float cov = cs / cw * 0.999;',
  '  if (z0 <= 0.0) { oMat = vec4(0.0); oDep = vec4(0.0, cov, 0.0, 1.0); oHome = vec4(0.0); return; }',
  '  nb = nbx;',
  '  float sig = (float(uTaps) * uStep * 0.5 + 0.5) * max(smoothstep(1.0, 5.0, nb), 0.05);',   // loners and small clumps keep their shape
  '  float ws = 0.0, zs = 0.0;',
  '  vec4 ms = vec4(0.0), hs = vec4(0.0);',
  '  for (int i = -uTaps; i <= uTaps; i++) {',
  '    float x = float(i) * uStep;',
  '    ivec2 c = clamp(me + uDir * int(round(x)), ivec2(0), uRes - 1);',
  '    float z = texelFetch(uDep, c, 0).r;',
  '    if (z <= 0.0) continue;',
  '    float dz = (z - z0) / uRange;',
  '    float w = exp(-x * x / (2.0 * sig * sig) - dz * dz);',
  '    ws += w; zs += w * z; ms += w * texelFetch(uMat, c, 0); hs += w * texelFetch(uHome, c, 0);',
  '  }',
  '  oDep = vec4(zs / ws, nb + cov, 0.0, 1.0);',
  '  oMat = ms / ws;',
  '  oHome = hs / ws;',
  '}'
].join('\n');

// The sparks: a loose grain hot enough to glow is drawn once more, after the
// skin, as the comet it is — a soft halo a few of its radii wide, brighter
// at the head and stretched back along its own motion by however far it
// moved in the last few frames, added into the picture in front of whatever
// is behind it. Six vertices a particle from gl_VertexID; a grain that does
// not qualify is a degenerate triangle the rasteriser drops.
var SPARK_VS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uVel;',
  'uniform sampler2D uAux;',
  'uniform sampler2D uMat;',
  'uniform ivec2 uSize;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform vec2 uRes;',
  'uniform float uRad;',
  'uniform float uRadPow;',
  'uniform float uPx;',
  'uniform float uSpSize;',    // the halo's radius, in the grain's own
  'uniform float uStretch;',   // the streak: world length per unit velocity
  'uniform float uK;',         // the halo's brightness, on the glow's
  'uniform float uT0;',        // the temperature a grain starts to spark at
  GLSL_GLOW,
  'flat out vec2 vH;',         // head and tail, in pixels
  'flat out vec2 vT;',
  'flat out float vR;',
  'flat out vec3 vCol;',
  'void main() {',
  '  int id = gl_VertexID / 6, c = gl_VertexID - id * 6;',
  '  ivec2 tc = ivec2(id % uSize.x, id / uSize.x);',
  '  vec4 P = texelFetch(uPos, tc, 0), V = texelFetch(uVel, tc, 0);',
  '  float nb = texelFetch(uAux, tc, 0).w, T = V.w;',
  '  vec4 e = uView * vec4(P.xyz, 1.0);',
  '  vH = vec2(0.0); vT = vec2(0.0); vR = 0.0; vCol = vec3(0.0);',
  '  if (T < uT0 || nb > 2.5 || e.z > -0.1) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }',
  '  float rad = uRad * pow(max(texelFetch(uMat, tc, 0).r, 1e-9), uRadPow);',
  '  float hk = clamp((T - uT0) / 6000.0, 0.0, 1.0);',
  '  float rpx = rad * uPx / (-e.z);',
  '  float r = clamp(uSpSize * rpx * (0.7 + 0.4 * hk), 2.0, 28.0);',
  '  vec3 ve = mat3(uView) * V.xyz;',
  '  vec3 et = e.xyz - ve * uStretch;',
  '  et.z = min(et.z, -0.1);',
  '  vec4 ch = uProj * vec4(e.xyz + vec3(0.0, 0.0, 1.5 * rad), 1.0), ct = uProj * vec4(et, 1.0);',   // a grain lying on the skin is drawn a little in front of it
  '  vec2 h = (ch.xy / ch.w * 0.5 + 0.5) * uRes, t = (ct.xy / ct.w * 0.5 + 0.5) * uRes;',
  '  vec2 ax = t - h; float len = length(ax), maxLen = 8.0 * r;',
  '  if (len > maxLen) { ax *= maxLen / len; t = h + ax; len = maxLen; }',
  '  vec2 a = len > 0.5 ? ax / len : vec2(1.0, 0.0), pp = vec2(-a.y, a.x);',
  '  int k = c < 3 ? c : (c == 3 ? 2 : (c == 4 ? 1 : 3));',                       // two triangles over the four corners: head-left, head-right, tail-left, tail-right
  '  vec2 q = (k < 2 ? h - a * r : t + a * r) + pp * r * ((k & 1) == 0 ? 1.0 : -1.0);',
  '  gl_Position = vec4((q / uRes * 2.0 - 1.0) * ch.w, ch.z, ch.w);',
  '  vH = h; vT = t; vR = r;',
  '  vCol = glow(T) * uK;',
  '}'
].join('\n');

var SPARK_FS = [
  '#version 300 es',
  'precision highp float;',
  'flat in vec2 vH;',
  'flat in vec2 vT;',
  'flat in float vR;',
  'flat in vec3 vCol;',
  'out vec4 o;',
  'void main() {',
  '  vec2 pa = gl_FragCoord.xy - vT, ba = vH - vT;',
  '  float bb = dot(ba, ba);',
  '  float u = bb > 1e-4 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 1.0;',            // 0 at the tail, 1 at the head
  '  vec2 q = pa - ba * u;',
  '  float d2 = dot(q, q) / (vR * vR);',
  '  float I = 0.35 * exp(-d2 * 2.2) * (0.12 + 0.88 * u * u) + exp(-d2 * 12.0) * u;',
  '  o = vec4(vCol * I, 1.0);',
  '}'
].join('\n');

var SHADE_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uMat;',
  'uniform sampler2D uDep;',
  'uniform sampler2D uDepRaw;',  // the depth before the blur: the particles themselves
  'uniform sampler2D uHome;',    // the smoothed home field: xyz — the grain's own coordinates, w — how much of the material is metal
  'uniform vec2 uInvP;',        // 1/P00, 1/P11
  'uniform vec2 uRes;',
  'uniform vec3 uSunEye;',
  'uniform float uGlow;',
  'uniform float uP22;',
  'uniform float uP32;',
  'uniform int uNL;',           // the hot bodies as lights, up to two:
  'uniform vec3 uLPos[2];',     // where, in eye space
  'uniform vec3 uLCol[2];',     // the light at their surface
  'uniform float uLR2[2];',     // their radius²
  'uniform int uLBall[2];',     // the ball each light belongs to, or −1
  'uniform float uReach2;',     // the fall-off, 1/(d²/R² + reach²): inverse-square far off, kept from blowing up close in
  'uniform float uEmberMax;',   // the knee on the hot bodies\' light, in the sun\'s units
  'uniform float uRad;',        // a particle's radius, to know how many pixels wide one stands here
  'uniform float uEdge;',       // where the silhouette ends, in coverage, and how soft its last pixel is
  'uniform float uEdgeSoft;',
  'uniform float uDbg;',        // LOOK.dbg: 1 the ember alone, 2 the particle normal, 3 the direction to the first light, 4 the skin normal, 5 the home field, 6 the surface tone
  'uniform int uNO;',           // what casts shadows in that light, as balls: the planet, the impactor while it is one, the second body
  'uniform vec4 uOcc[3];',      // centre in eye space, radius
  'uniform int uNB;',           // the bodies as balls, up to two: centre in eye space, and the radius their skin is drawn at
  'uniform vec4 uBall[2];',
  'uniform float uBallK;',      // how far the skin\'s normal is pulled to the ball\'s where the skin is the ball\'s own
  'uniform float uCut;',        // 1 — the ball\'s silhouette cuts its skin: only while the body is a whole ball, before the impact; after it the skin wears a loose layer of what fell back, which sits above any radius and was peeled
  'uniform float uDetail;',     // 0 — the flat material; 1 — the surface; 2 — with craters
  'uniform float uBump;',       // the surface\'s relief, in particle radii
  'uniform float uFull;',       // 1 — the full look: specular, the wrap at the terminator, a cool fill; 0 — the plain one
  'uniform float uShadow;',     // 1 — the bodies shadow each other and the disk in the sun
  'uniform float uConv;',       // the convection cells on a melt, their contrast
  'uniform mat3 uInvRot;',      // eye to world, for those cells: they are drawn in the body\'s frame, which the camera does not turn
  'uniform vec3 uEyeW;',
  'uniform float uSparkOn;',    // 1 — a loose hot grain is the spark pass to draw: its disc here keeps a quarter of its glow
  'uniform float uTime;',       // the run\'s clock, slowed, to turn them with
  'out vec4 o;',
  GLSL_GLOW,
  GLSL_NOISE,
  // a normal from a vector that might be nothing — the alternative, when it is;
  // one NaN in the picture is a black rectangle once the bloom has blurred it
  'vec3 safeNorm(vec3 v, vec3 alt) { float l = dot(v, v); return (l > 1e-16 && !any(isnan(v))) ? v * inversesqrt(l) : alt; }',
  // how much of the light at L, a ball of radius R, reaches p: the run from
  // p to the ball's surface against each occluder — the light's own ball
  // aside, and a ball behind p (away from the light) aside — with a soft edge
  'float shadow(vec3 p, vec3 L, float R) {',
  '  vec3 toL = L - p;',
  '  float len = length(toL), lit = 1.0;',
  '  vec3 dir = toL / max(len, 1e-6);',
  '  float seg = max(len - R, 0.0);',
  '  for (int i = 0; i < 3; i++) if (i < uNO) {',
  '    vec3 C = uOcc[i].xyz; float r = uOcc[i].w;',
  '    float along = dot(C - p, dir);',
  '    if (distance(C, L) < r || along <= 0.0) continue;',
  '    lit *= smoothstep(0.85 * r, 1.05 * r, distance(p + dir * min(along, seg), C));',
  '  }',
  '  return lit;',
  '}',
  'vec3 posAt(sampler2D dep, ivec2 c) {',
  '  float z = texelFetch(dep, c, 0).r;',
  '  vec2 ndc = (vec2(c) + 0.5) / uRes * 2.0 - 1.0;',
  '  return vec3(ndc * uInvP * z, -z);',
  '}',
  // the normal from the neighbours on the same surface — in front of the
  // camera z is negative, the background reads 0, and a jump of more than
  // six pixels' worth of depth is a step down to whatever is behind, not a
  // slope — the nearer of the two a side when both are. On a silhouette,
  // with no neighbour to take a slope from on some axis, the normal points
  // outward along the screen: lit by the sun from that side, never toward
  // the body it belongs to
  'vec3 normalAt(sampler2D dep, ivec2 me, vec3 p, out bool edge) {',
  '  vec3 pr = posAt(dep, me + ivec2(1, 0)), pl = posAt(dep, me - ivec2(1, 0)), pu = posAt(dep, me + ivec2(0, 1)), pd = posAt(dep, me - ivec2(0, 1));',
  '  float jump = -p.z * 12.0 * uInvP.x / uRes.x;',
  '  bool hr = pr.z < 0.0 && abs(pr.z - p.z) < jump, hl = pl.z < 0.0 && abs(pl.z - p.z) < jump;',
  '  bool hu = pu.z < 0.0 && abs(pu.z - p.z) < jump, hd = pd.z < 0.0 && abs(pd.z - p.z) < jump;',
  '  vec3 r = pr - p, l = p - pl, u = pu - p, d = p - pd;',
  '  vec3 dx = hr && hl ? (abs(r.z) < abs(l.z) ? r : l) : hr ? r : l;',
  '  vec3 dy = hu && hd ? (abs(u.z) < abs(d.z) ? u : d) : hu ? u : d;',
  '  edge = !(hr || hl) || !(hu || hd);',
  '  vec3 n = edge ? normalize(vec3(float(!hr) - float(!hl), float(!hu) - float(!hd), 0.3)) : normalize(cross(dx, dy));',
  '  return n.z < 0.0 ? -n : n;',
  '}',
  // the surface, in the grain's own coordinates: continents and hills from
  // the noise, craters on top — a height for the relief, a tone for the
  // albedo (0 in the lowlands, 1 on the highlands), the crater floors, and
  // a crack pattern for the crust a magma ocean wears
  'void surface(vec3 q, out float h, out float tone, out float floors, out float crack) {',
  '  int oct = uDetail > 1.5 ? 4 : 3;',
  '  float cont = fbm(q * 1.7, oct);',
  '  float det = fbm(q * 6.5 + 3.1, oct - 1);',
  '  vec2 c = vec2(0.0);',
  '  if (uDetail > 1.5) c = craters(q * 3.0, 0.5) + 0.55 * craters(q * 8.0 + 7.0, 0.6);',
  '  h = cont + det * 0.4 + c.x * 0.35;',
  '  tone = clamp(0.5 + cont * 1.4 + det * 0.45 + c.x * 0.5, 0.0, 1.0);',
  '  floors = clamp(c.y, 0.0, 1.0);',
  '  crack = 1.0 - smoothstep(0.0, 0.12, abs(fbm(q * 8.0 + 21.0, 3)));',
  '}',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  vec2 d = texelFetch(uDep, me, 0).rg;',
  '  float z = d.r;',
  '  if (z <= 0.0) discard;',
  // the outline: the skin's silhouette is the union of the discs drawn at it,
  // a staircase of them, and the blur cannot help — it never reaches across
  // into the background. The coverage can: the tips of the discs stand under
  // it and are cut, the rest of the edge fades over its last pixel instead of
  // stepping. What is cut back is only what has a staircase to lose: a packed
  // surface, drawn by discs several pixels wide. A lone fragment is all edge —
  // and so is everything once the view is far enough out that a particle is a
  // pixel or two, where the coverage of a dot that small is under a half
  // wherever you stand on it and cutting would erase the spray
  '  float dpx = uRad * uRes.x / (uInvP.x * z);',                                                // this particle, across, in pixels
  '  float cut = mix(0.35, uEdge, smoothstep(2.0, 6.0, floor(d.g))) * smoothstep(2.5, 6.0, dpx);',
  '  float alpha = smoothstep(cut - uEdgeSoft, cut + uEdgeSoft, fract(d.g));',
  '  vec3 p = posAt(uDep, me);',
  '  vec3 ray = normalize(p);',
  // how near the skin's silhouette this pixel is, by the coverage: full
  // through the skin, falling over the last few pixels before the edge —
  // where the blur had one side to average and the skin's normal is a guess
  '  float sil = 1.0 - smoothstep(0.55, 0.95, fract(d.g));',
  '  bool edge, edgeR;',
  '  vec3 n = normalAt(uDep, me, p, edge);',                            // the skin's
  '  vec3 nR = normalAt(uDepRaw, me, posAt(uDepRaw, me), edgeR);',      // the particle's own: honest at a silhouette, where the smoothed skin's turns any way
  '  vec4 m = texelFetch(uMat, me, 0);',
  '  vec4 hm = texelFetch(uHome, me, 0);',
  '  float metal = clamp(hm.w, 0.0, 1.0);',
  // whether the home field is a surface here. On rock that holds together
  // the field moves across the screen as the skin does — a pixel's step in
  // home is a pixel's step in space — and a texture drawn in it stands
  // still on the rock. Where the material churns, a magma ocean convecting
  // at the grain scale or two bodies' grains mixed at the contact, the
  // field jumps from pixel to pixel and shifts from frame to frame, and a
  // texture drawn in it shimmers. So the surface fades out where the
  // field's gradient outruns the skin's own, and the melt there is drawn
  // smooth — which is what a churning melt is
  '  vec3 fw = fwidth(hm.xyz), fp = fwidth(p);',
  '  float coh = 1.0 - smoothstep(2.5, 6.0, length(fw) / max(length(fp), 1e-7));',
  // the balls. Where the skin is a body's own — within a few particles of the
  // radius its skin is drawn at, and facing the way the ball's surface faces
  // there — the body is known to be round, and the skin's normal is a noisy
  // estimate of that: it is pulled toward the ball's, all the way on a
  // silhouette where the estimate is nothing. And the ball's silhouette is
  // exact where the coverage cut's is a staircase of discs: the ray's
  // closest approach to the centre against the radius, feathered over a
  // pixel — but only while the body is a whole ball, on the approach.
  // After the impact the skin wears what fell back on it, a loose layer
  // that sits above any radius the analysis can name, and a cut at that
  // radius peeled the layer off as a glowing rind with a black gap under
  // it. The facing test keeps another body's skin out of both: the
  // impactor crossing the planet's shell on its way in faces its own
  // centre, not the planet's, and is neither pulled nor cut; nor is a
  // droplet two particles up, nor the arm
  '  float onBall = 0.0; vec3 nBall = n;',
  '  float selfB[2]; selfB[0] = 0.0; selfB[1] = 0.0;',   // how much this pixel is each ball's own skin, for the ball's light to leave alone
  '  vec3 nA = safeNorm(mix(n, nR, max(sil, edge ? 1.0 : 0.0)), n);',   // the particle's own along the silhouette, where the skin's is a guess
  '  for (int i = 0; i < 2; i++) if (i < uNB) {',
  '    vec3 c = p - uBall[i].xyz; float r = length(c), R = uBall[i].w;',
  '    vec3 nb0 = c / max(r, 1e-6);',
  '    float agree = smoothstep(0.35, 0.7, dot(nA, nb0));',
  '    float w = (1.0 - smoothstep(0.05 * R, 0.14 * R, abs(r - R))) * agree;',
  '    selfB[i] = (1.0 - smoothstep(3.0 * uRad, 8.0 * uRad, abs(r - R))) * agree;',
  '    if (w > onBall) { onBall = w; nBall = nb0; }',
  '    if (uCut > 0.5 && abs(r - R) < 1.5 * uRad && agree > 0.5) {',
  '      float b = length(uBall[i].xyz - ray * dot(uBall[i].xyz, ray));',
  '      float pxw = -uBall[i].z * uInvP.x * 2.0 / uRes.x;',
  '      alpha = min(alpha, 1.0 - smoothstep(R - pxw, R + pxw, b));',
  '    }',
  '  }',
  '  float pull = onBall * mix(uBallK, 1.0, max(sil, edge ? 1.0 : 0.0));',
  '  n = safeNorm(mix(n, nBall, pull), n);',
  '  nR = safeNorm(mix(nR, nBall, pull), nR);',
  '  bool rim = edge && onBall < 0.5;',
  // the surface, and its relief: the height's slope across the screen, from
  // the derivatives the hardware keeps, tilts the normal — bump mapping with
  // no parametrisation (Mikkelsen) — with a cap on the tilt where the home
  // field jumps between grains of different origin, and none across a step
  '  float h = 0.0, tone = 0.5, floors = 0.0, crack = 0.0;',
  '  if (uDetail > 0.5) surface(hm.xyz, h, tone, floors, crack);',
  '  tone = mix(0.5, tone, coh); floors *= coh; crack *= coh;',
  '  float hh = h * uRad * uBump * coh;',
  '  vec3 dpx_ = dFdx(p), dpy_ = dFdy(p);',
  '  float dhx = dFdx(hh), dhy = dFdy(hh);',
  '  if (uDetail > 0.5 && !edge) {',
  '    float jump = z * 12.0 * uInvP.x / uRes.x;',
  '    vec3 r1 = cross(dpy_, n), r2 = cross(n, dpx_);',
  '    float det = dot(dpx_, r1);',
  '    vec3 gv = sign(det) * (dhx * r1 + dhy * r2);',
  '    float gl = length(gv), lim = abs(det) * 1.8;',
  '    if (gl > lim) gv *= lim / gl;',
  '    vec3 nb = abs(det) * n - gv;',
  '    if (dot(dpx_, dpx_) + dot(dpy_, dpy_) < jump * jump * 4.0 && abs(det) > 1e-12 && !any(isnan(nb))) n = safeNorm(nb, n);',
  '  }',
  '  if (alpha <= 0.0) discard;',
  // the material: the palette's colour, darker and deeper in the lowlands,
  // pale on the highlands; past the melting point the crust is gone — dark
  // rock, lit by itself — and a crust on its way there chars first
  '  float molten = smoothstep(1300.0, 2100.0, m.a), warm = smoothstep(700.0, 1300.0, m.a);',
  '  vec3 base = m.rgb;',
  '  float lum = dot(base, vec3(0.3, 0.59, 0.11));',
  '  vec3 low = mix(vec3(lum), base, 1.45) * 0.5, high = mix(vec3(lum), base, 0.45) * 1.35;',
  '  vec3 alb = uDetail > 0.5 ? mix(low, high, tone) * (1.0 - 0.3 * floors) : base;',
  '  alb = mix(alb, alb * 0.3 + vec3(0.03, 0.015, 0.01), max(molten, 0.5 * warm));',
  '  alb *= 1.0 - 0.6 * metal;',
  // the sun: Lambert with a little wrap at the terminator and a cool fill
  // for the night side — no shadow of one ball on the other: the balls are
  // where the mass is, not where the skin is, and a body half into the
  // planet was standing in the planet's shadow from the inside; the hot
  // bodies' light on everything else — the disk in the planet's glow — by
  // the skin's normal, and along a silhouette by the particle's own where
  // that faces the light less: there the smoothed skin's normal is noise,
  // and this light is twenty times the sun's, so the noise would be a
  // bright rim. Only there — taken across the whole skin, the particle's
  // normal printed every grain on a lit face as its own crescent, a
  // honeycomb that slid over the surface as the camera turned
  '  vec3 V = -ray;',
  '  float NoV = max(dot(n, V), 1e-3), NoL = dot(n, uSunEye);',
  '  float wrap = 0.06 * uFull;',
  '  float diff = clamp((NoL + wrap) / (1.0 + wrap), 0.0, 1.0);',
  // the sun's shadow: a body's ball between this pixel and the sun, when
  // the pixel is not that body's own skin — the terminator is the skin's
  // own business, and a body in contact stands inside the other's ball, so
  // a pixel within the ball's reach is left to its own normal. The edge
  // is the sun's half-degree, a penumbra that widens with the throw:
  // the Moon's shadow on the planet is a sharp dot, the planet's on the
  // disk a soft band
  '  float sunLit = 1.0;',
  '  for (int i = 0; i < 3; i++) if (i < uNO && uShadow > 0.5) {',
  '    vec3 pc = uOcc[i].xyz - p; float r = uOcc[i].w;',
  '    float along = dot(pc, uSunEye);',
  '    if (along <= 0.0 || dot(pc, pc) < 1.44 * r * r) continue;',
  '    float pen = max(0.03 * r, along * 0.0093);',
  '    sunLit *= smoothstep(r - pen, r + pen, length(pc - uSunEye * along));',
  '  }',
  '  diff *= sunLit;',
  '  vec3 sunC = vec3(1.0, 0.97, 0.92) * 0.9;',
  '  vec3 amb = mix(vec3(0.12), vec3(0.055, 0.07, 0.10) * (0.75 + 0.25 * n.y), uFull);',
  // A hot moonlet a few radii off outshines the sun on the planet's night
  // side by the inverse square, and its light ended in a hard terminator,
  // so the planet read as three zones — sunlit, moonlit, its own glow —
  // with seams between them. So a body's light wraps past its terminator,
  // as a light with a size does, and runs into a soft knee that lets it
  // outshine the sun by so much and no more: the seams go, the fill stays
  // A body's light leaves the body's own skin alone — convex, it cannot
  // light itself, and the loose grains lying on it would sparkle. Which
  // skin is its own is the ball's: the pixels within a few particles of
  // the ball's radius that face the way the ball faces there. It used to
  // be a sphere round the light instead, everything nearer than the
  // light's radius, and while two bodies were one group in contact that
  // sphere cut across the second body as a flat zone with a hard edge.
  // The sphere remains for a light with no ball to its name
  '  vec3 ember = vec3(0.0);',
  '  float ew = 0.35 * uFull;',
  '  for (int i = 0; i < 2; i++) if (i < uNL && !rim) {',
  '    vec3 l = uLPos[i] - p;',
  '    float d2 = dot(l, l) / uLR2[i];',
  '    vec3 lh = normalize(l);',
  '    float fn = dot(n, lh);',
  '    float face = mix(fn, min(fn, dot(nR, lh)), sil * (1.0 - onBall));',
  '    float own = uLBall[i] >= 0 ? 1.0 - selfB[uLBall[i]] : smoothstep(1.0, 3.0, d2);',
  '    ember += uLCol[i] * clamp((face + ew) / (1.0 + ew), 0.0, 1.0) / (d2 + uReach2) * own * shadow(p, uLPos[i], sqrt(uLR2[i]));',
  '  }',
  '  ember = mix(ember, ember / (1.0 + ember / uEmberMax), uFull);',
  '  vec3 col = alb * (diff * sunC + amb + ember);',
  // the sun's glint: GGX, rough on the crust, glossy on the magma, and the
  // metals reflecting in their own colour
  '  float rough = mix(mix(0.85, 0.3, molten), 0.45, metal);',
  '  vec3 H = safeNorm(uSunEye + V, n);',
  '  float NoH = max(dot(n, H), 0.0), VoH = clamp(dot(V, H), 0.0, 1.0), NoLc = max(NoL, 0.0), a2 = rough * rough * rough * rough;',
  '  float Dg = a2 / (3.14159 * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));',
  '  float Vis = 0.5 / max(NoLc * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoLc * NoLc * (1.0 - a2) + a2), 1e-4);',
  '  vec3 F0 = mix(vec3(0.04), base, metal);',
  '  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);',
  '  col += uFull * Dg * Vis * F * NoLc * sunC * sunLit;',
  // its own light: the glow by temperature, and on a magma ocean the crust it
  // wears — dark plates, the melt bright in the cracks between them; a crust
  // only warm shows the same cracks in red. The vapour, past a few thousand
  // kelvin, has no crust to wear
  '  float plates = molten * (1.0 - smoothstep(6000.0, 16000.0, m.a));',
  '  float em = uDetail > 0.5 ? mix(1.0, 0.3 + 1.7 * crack, max(plates * 0.9, warm * (1.0 - molten) * 0.7)) : 1.0;',
  // the cells of a convecting melt. A churning surface has no coordinates
  // of its own — the home field jumps from grain to grain there, and the
  // surface drawn in it fades out — so its cells are drawn in the body's
  // frame, a few grains across, and turned slowly with the run's clock:
  // the melt reads as a melt rather than as a flat glow
  '  if (uConv > 0.0 && molten > 0.0 && uFull > 0.5) {',
  '    vec3 wp = uNB > 0 ? uInvRot * (p - uBall[0].xyz) : uInvRot * p + uEyeW;',
  '    float cv = fbm(wp / (7.0 * uRad) + uTime * vec3(0.31, 0.23, 0.27), 3);',
  '    float cw = molten * (1.0 - 0.6 * coh) * uConv * (1.0 - smoothstep(6000.0, 16000.0, m.a));',
  '    em *= mix(1.0, clamp(0.6 + 1.4 * (cv + 0.35), 0.2, 2.0), cw);',
  '  }',
  // a grain on its own, hot, is drawn as a comet by the spark pass — a
  // soft core in place of this disc's hard-edged square — so the disc keeps
  // a quarter of its glow and hands the rest over
  '  em *= mix(1.0, 0.25, uSparkOn * (1.0 - smoothstep(1.5, 3.0, floor(d.g))) * smoothstep(900.0, 1300.0, m.a));',
  '  vec3 emis = glow(m.a) * uGlow * em;',
  '  gl_FragDepth = ((uP22 * (-z) + uP32) / z) * 0.5 + 0.5;',
  '  if (uDbg > 0.5) { vec3 lh0 = normalize(uLPos[0] - p); o = vec4(uDbg < 1.5 ? ember : uDbg < 2.5 ? nR * 0.5 + 0.5 : uDbg < 3.5 ? lh0 * 0.5 + 0.5 : uDbg < 4.5 ? n * 0.5 + 0.5 : uDbg < 5.5 ? fract(hm.xyz) : vec3(tone), 1.0); return; }',
  '  o = vec4(col + emis, alpha);',
  '}'
].join('\n');


// 4. Bloom: what is brighter than white — the glow, the hottest sparks —
//    taken at a quarter of the size and blurred twice over, a narrow halo
//    and a wide one, then at a sixteenth for the widest, and laid back over
//    the picture.
var BRIGHT_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uHdr;',
  'uniform vec2 uInvRes;',       // of the source
  'uniform float uThr;',
  'out vec4 o;',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy * 4.0 * uInvRes;',    // the middle of this texel's 4×4 block; four bilinear taps cover it
  '  vec3 c = texture(uHdr, uv + vec2(-1.0, -1.0) * uInvRes).rgb + texture(uHdr, uv + vec2(1.0, -1.0) * uInvRes).rgb',
  '         + texture(uHdr, uv + vec2(-1.0, 1.0) * uInvRes).rgb + texture(uHdr, uv + vec2(1.0, 1.0) * uInvRes).rgb;',
  '  c *= 0.25;',
  '  float l = max(c.r, max(c.g, c.b));',
  '  o = vec4(c * (max(l - uThr, 0.0) / max(l, 1e-4)), 1.0);',
  '}'
].join('\n');
var BLOOM_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uSrc;',
  'uniform vec2 uInvRes;',
  'uniform vec2 uDir;',
  'uniform float uStep;',        // tap spacing; the gaussian is two of them wide
  'out vec4 o;',
  'const float W[5] = float[5](0.204, 0.180, 0.124, 0.067, 0.028);',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy * uInvRes;',
  '  vec3 c = texture(uSrc, uv).rgb * W[0];',
  '  for (int i = 1; i < 5; i++) {',
  '    vec2 d = uDir * (float(i) * uStep) * uInvRes;',
  '    c += (texture(uSrc, uv + d).rgb + texture(uSrc, uv - d).rgb) * W[i];',
  '  }',
  '  o = vec4(c, 1.0);',
  '}'
].join('\n');

// the sky behind the stars: the Milky Way, where it really is. The stars sit
// in equatorial coordinates, so the galactic plane is a fixed great circle
// among them — its pole at RA 192.86°, Dec +27.13°, its centre at RA 266.41°,
// Dec −28.94° — and the Galaxy is drawn in the longitude and latitude of that
// circle, the way it looks from inside it: a thin disc, thicker and brighter
// toward the centre in Sagittarius and thin and faint toward the anticentre;
// the bulge, a swell of ±20° about the centre; the star clouds that mottle
// it; the dust along the plane that darkens the very equator everywhere, and
// the Great Rift, the lane that splits the band in two from Cygnus down
// through Aquila to the centre; and off the band the two Magellanic Clouds.
// All of it faint — it is the backdrop, not the subject. Drawn at a quarter
// of the size, since it is soft, and the sun pass lays it under everything.
var SKY_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'uniform vec2 uRes;',
  'uniform vec2 uInvP;',
  'uniform mat3 uInvRot;',      // eye to world
  'uniform vec3 uNGP;',         // the galactic pole, and in the plane: toward the centre, and 90° on toward Cygnus
  'uniform vec3 uGX;',
  'uniform vec3 uGY;',
  'uniform vec3 uLMC;',         // the Magellanic Clouds
  'uniform vec3 uSMC;',
  'uniform float uMw;',
  'out vec4 o;',
  GLSL_NOISE,
  'void main() {',
  '  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;',
  '  vec3 d = uInvRot * normalize(vec3(ndc * uInvP, -1.0));',
  '  float b = asin(clamp(dot(d, uNGP), -1.0, 1.0)), ab = abs(b);',
  '  float l = atan(dot(d, uGY), dot(d, uGX));',                                       // 0 at the centre, +90° in Cygnus
  '  float toward = 0.5 + 0.5 * cos(l);',                                               // 1 at the centre, 0 at the anticentre
  '  float hb = 0.05 + 0.10 * toward * toward;',                                        // the disc\'s half-thickness: 3° at the anticentre, 9° at the centre
  '  float disc = exp(-ab / hb) * (0.3 + 0.7 * toward * toward);',
  '  disc += 0.7 * exp(-(l - 1.4) * (l - 1.4) / 0.06 - (b - 0.02) * (b - 0.02) / 0.02);',   // the Cygnus star cloud, and Carina–Centaurus, the bright stretch of the southern band
  '  disc += 0.5 * exp(-(l + 0.9) * (l + 0.9) / 0.32 - b * b / 0.02);',
  '  float bulge = 1.5 * exp(-l * l / 0.18 - (b + 0.01) * (b + 0.01) / 0.045);',
  '  float n1 = fbm(d * 9.0, 4), n2 = fbm(d * 23.0 + 7.0, 3);',
  '  float clouds = 0.7 + 0.6 * n1 + 0.25 * n2;',                                       // the star clouds, a few degrees across
  '  float lane = exp(-b * b / 0.0008);',                                                // the dust on the very equator, 1° either side
  '  float rw = smoothstep(-0.25, 0.1, l) * (1.0 - smoothstep(1.45, 1.75, l));',        // the Great Rift runs from just past the centre to Cygnus
  '  float b0 = -0.02 + 0.03 * sin(l * 3.0 + 1.0);',                                    // and wanders a little off the plane
  '  float rift = rw * exp(-(b - b0) * (b - b0) / 0.004);',                               // 2.6° either side
  '  float dn = 0.5 + 0.5 * fbm(d * 14.0 + 3.0, 4), dn2 = 0.5 + 0.5 * fbm(d * 31.0 + 11.0, 3);',   // patchy, as dust is, on two scales
  '  float dust = clamp(0.35 * lane * (0.5 + dn2) + 0.8 * rift * (0.25 + 0.55 * dn + 0.35 * dn2) + 0.35 * dn * exp(-ab / 0.06), 0.0, 0.8);',
  '  float mw = (disc + bulge * exp(-ab / 0.25)) * clouds * (1.0 - dust);',
  '  vec3 dl = d - uLMC, ds = d - uSMC;',
  '  float clouds2 = 0.5 * exp(-dot(dl, dl) / 0.004) + 0.3 * exp(-dot(ds, ds) / 0.0012);',
  '  vec3 col = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.9, 0.75), toward) * mw + vec3(0.9, 0.93, 1.0) * clouds2;',   // bluish white out along the arms, warm toward the bulge
  '  o = vec4(col * uMw, 1.0);',
  '}'
].join('\n');

// the sun: a disk where SUN is, with a glare round it, and the sky under it,
// drawn into the HDR canvas behind everything so the bodies hide it; the
// bloom does the rest
var SUN_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uSky;',
  'uniform vec2 uInvRes;',      // of the canvas
  'uniform vec2 uRes;',
  'uniform vec2 uInvP;',
  'uniform vec3 uSunEye;',
  'uniform float uSunR;',       // the disk's angular radius, radians
  'uniform float uSunI;',       // its brightness — 0 when it is behind the camera
  'uniform float uHalo;',
  'out vec4 o;',
  'void main() {',
  '  vec3 c = texture(uSky, gl_FragCoord.xy * uInvRes).rgb;',
  '  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;',
  '  vec3 ray = normalize(vec3(ndc * uInvP, -1.0));',
  '  if (uSunI > 0.0 && dot(ray, uSunEye) > 0.7) {',
  '    float th = 2.0 * asin(min(0.5 * length(ray - uSunEye), 1.0));',   // the angle off the sun's centre, exact where it is small
  '    float px = uInvP.y * 2.0 / uRes.y;',                               // one pixel in radians
  '    float disk = 1.0 - smoothstep(uSunR - px, uSunR + px, th);',
  '    float x = max(th - uSunR, 0.0);',
  '    float halo = uHalo * (0.6 * exp(-x / (2.0 * uSunR)) + 0.12 * exp(-x / 0.05) + 0.02 * exp(-x / 0.3));',
  '    c += vec3(1.0, 0.96, 0.88) * (disk * uSunI) + vec3(1.0, 0.8, 0.55) * halo;',
  '  }',
  '  gl_FragDepth = 0.9999;',
  '  o = vec4(c, 1.0);',
  '}'
].join('\n');

// The atmosphere: a shell round each ball, thin on a cold body and puffed
// on a hot one, that scatters the sun's light — the path through it is
// longest at the limb, so the limb glows, and brightest looking toward the
// sun, so a planet in front of the sun wears a ring — and, on a hot body,
// glows with its own vapour. Integrated along the ray in eight steps from
// where it enters the shell to where it meets the ball or the skin, and
// added over the picture. A shell thinner than the pixels is drawn as wide
// as them and as much fainter, so the far view keeps a soft limb and not a
// crawling one.
var ATM_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uDep;',       // the skin's depth, smoothed
  'uniform vec2 uInvP;',
  'uniform vec2 uRes;',
  'uniform vec3 uSunEye;',
  'uniform int uNB;',
  'uniform vec4 uBall[2];',        // centre in eye space, the radius the skin is drawn at
  'uniform vec3 uAtmCol[2];',      // what the shell scatters
  'uniform vec3 uAtmEm[2];',       // and what it glows with of itself
  'uniform float uAtmH[2];',       // its thickness, in radii
  'uniform vec4 uAtmHot[2];',      // where the body's heat is, in eye space, and how far it reaches: the vapour is boiled off there
  'uniform float uRad;',           // a particle's radius: how far the skin may stand off the ball
  'uniform float uEdge;',          // the skin's silhouette cut and its feather, as the shade pass has them
  'uniform float uEdgeSoft;',
  'uniform float uK;',
  'out vec4 o;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  vec2 ndc = (vec2(me) + 0.5) / uRes * 2.0 - 1.0;',
  '  vec3 ray = normalize(vec3(ndc * uInvP, -1.0));',
  '  vec2 dep = texelFetch(uDep, me, 0).rg;',
  '  float zs = dep.r;',
  // the skin's last pixels are feathered — part skin, part what is behind
  // — and the shell treats them as that much outside: keyed to the
  // silhouette and run the whole chord, or the dark feather stood as a
  // line between the haze and the surface
  '  float skinA = zs > 0.0 ? smoothstep(uEdge - uEdgeSoft, uEdge + uEdgeSoft, fract(dep.g)) : 0.0;',
  '  float ts = zs > 0.0 ? zs / (-ray.z) : 1e9;',
  '  vec3 col = vec3(0.0);',
  '  float fwd = pow(max(dot(ray, uSunEye), 0.0), 8.0);',
  '  for (int i = 0; i < 2; i++) if (i < uNB) {',
  '    vec3 C = uBall[i].xyz; float R = uBall[i].w, H = uAtmH[i];',
  '    if (R <= 0.0 || H <= 0.0) continue;',
  '    float pxu = 0.5 * uRes.y / uInvP.y / max(-C.z, 0.05);',
  '    float thick = H * R * pxu, k = 1.0;',
  '    if (thick < 3.0) { k = thick / 3.0; H = 3.0 / (R * pxu); }',
  '    vec3 hotC = uAtmHot[i].xyz; float hotR = uAtmHot[i].w, hotK = length(uAtmEm[i]) > 0.0 ? 1.0 : 0.0;',
  '    float Hm = H * (1.0 + 1.5 * hotK), Ro = R * (1.0 + Hm) + 3.0 * uRad;',   // the shell as wide as the vapour can puff it, and as far out as the skin may stand
  '    float b = dot(ray, C), cc = dot(C, C);',
  '    float disc = b * b - (cc - Ro * Ro);',
  '    if (disc <= 0.0) continue;',
  '    float sq = sqrt(disc), t0 = max(b - sq, 0.0), t1 = b + sq;',
  // the ball is where the mass is, and the skin stands a particle or two
  // off it either way — after the impact it is not cut to the ball. So
  // outside the silhouette the shell is keyed to the skin: a walk across
  // the screen toward the ball's centre finds where the skin starts, and
  // the shell's floor is set there, within a few particles of the ball
  '    float Rl = R;',
  '    if (skinA < 0.999) {',
  '      vec2 cpx = ((C.xy / (-C.z)) / uInvP * 0.5 + 0.5) * uRes - gl_FragCoord.xy;',
  '      float dl = length(cpx), span = (Hm * R + 3.0 * uRad) * pxu, g = 3.0 * span;',
  '      if (dl > 1.0) {',
  // three walks abreast, two particles apart along the limb, and their
  // mean: the silhouette is a staircase of discs, and a floor that followed
  // every step of it was a frill
  '        vec2 st = cpx / dl * max(span / 10.0, 1.0), tg = vec2(-st.y, st.x) / length(st) * (2.0 * uRad * pxu);',
  '        g = 0.0;',
  '        for (int w = -1; w <= 1; w++) {',
  '          vec2 o0 = gl_FragCoord.xy + tg * float(w); float gw = span;',
  '          for (int m = 1; m <= 10; m++) if (texelFetch(uDep, ivec2(o0 + st * float(m)), 0).r > 0.0) {',
  '            float lo = float(m - 1), hi = float(m);',   // then to a pixel, so the floor is not a staircase of the walk's steps either
  '            for (int n = 0; n < 3; n++) { float mid = 0.5 * (lo + hi); if (texelFetch(uDep, ivec2(o0 + st * mid), 0).r > 0.0) hi = mid; else lo = mid; }',
  '            gw = length(st) * hi; break;',
  '          }',
  '          g += gw;',
  '        }',
  '      }',
  '      Rl = clamp(sqrt(max(cc - b * b, 0.0)) - g / (3.0 * pxu), R - 3.0 * uRad, R + 3.0 * uRad);',
  '    }',
  '    float di = b * b - (cc - Rl * Rl), dR = b * b - (cc - R * R);',
  '    float tOut = di > 0.0 ? min(t1, b - sqrt(di)) : t1;',                       // outside: to the shell's floor, or the whole chord
  '    float tIn = min(min(t1, ts), dR > 0.0 ? b - sqrt(dR) : t1);',              // on the skin: to the skin
  '    t1 = mix(tOut, tIn, skinA);',
  '    if (t1 <= t0) continue;',
  '    float dt = (t1 - t0) / 8.0;',
  // the vapour: over the heat — a plume over the contact at first, the
  // whole shell once the body is molten through — the shell is thicker,
  // glows of itself, and scatters warm rather than blue
  '    float acc = 0.0, lit = 0.0, hotA = 0.0;',
  '    for (int j = 0; j < 8; j++) {',
  '      vec3 x = ray * (t0 + dt * (float(j) + 0.5)); vec3 rel = x - C; float r = length(rel);',
  '      float dh = max(distance(x, hotC) - hotR, 0.0) / (0.3 * R);',
  '      float hw = hotK * exp(-dh * dh);',
  '      float hgt = clamp((r - Rl) / (H * R * (1.0 + 1.5 * hw)), 0.0, 1.0);',
  '      float dens = exp(-hgt * 3.0) * (1.0 - hgt) * (1.0 - hgt);',
  '      float day = smoothstep(-0.2, 0.35, dot(rel / max(r, 1e-6), uSunEye));',
  '      acc += dens; lit += dens * day * (1.0 - hw); hotA += dens * hw;',
  '    }',
  '    float norm = dt / (H * R) * k * uK;',
  '    col += (uAtmCol[i] * lit * (1.0 + 2.0 * fwd) + vec3(1.0, 0.55, 0.3) * 0.35 * hotA * (1.0 + fwd) + uAtmEm[i] * hotA) * norm;',
  '  }',
  '  o = vec4(col, 1.0);',
  '}'
].join('\n');

// The light shafts: from every pixel a walk toward the sun, adding up the
// sun's glare wherever the skin is not in the way — the streaks a planet in
// front of the sun throws, at a quarter of the size, laid over by the tone
// pass. Nothing when the sun is behind the camera or well off the frame.
var RAYS_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uDep;',       // the skin's depth, at the full size
  'uniform vec2 uRes;',            // of this target
  'uniform vec2 uFull;',           // of the depth
  'uniform vec2 uInvP;',
  'uniform vec3 uSunEye;',
  'uniform float uSunR;',
  'uniform float uK;',
  GLSL_HASH,
  'float sunAt(vec2 ndc) {',
  '  vec3 ray = normalize(vec3(ndc * uInvP, -1.0));',
  '  float th = 2.0 * asin(min(0.5 * length(ray - uSunEye), 1.0));',
  '  float x = max(th - uSunR, 0.0);',
  '  return 1.0 - smoothstep(0.5 * uSunR, 2.5 * uSunR, th) + 0.35 * exp(-x / (4.0 * uSunR)) + 0.25 * exp(-x / 0.12) + 0.05 * exp(-x / 0.35);',
  '}',
  'out vec4 o;',
  'void main() {',
  '  if (uSunEye.z >= -0.05 || uK <= 0.0) { o = vec4(0.0); return; }',
  '  vec2 sun = uSunEye.xy / (-uSunEye.z) / uInvP;',
  '  if (max(abs(sun.x), abs(sun.y)) > 2.5) { o = vec4(0.0); return; }',
  '  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;',
  '  float j = rnd(uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u);',
  '  vec2 d = (sun - ndc) / 40.0;',
  '  float acc = 0.0, w = 1.0, ws = 0.0;',
  '  for (int i = 0; i < 40; i++) {',
  '    vec2 q = ndc + d * (float(i) + j);',
  '    float free = 1.0;',
  '    if (abs(q.x) < 1.0 && abs(q.y) < 1.0) free = texelFetch(uDep, ivec2((q * 0.5 + 0.5) * uFull), 0).r > 0.0 ? 0.0 : 1.0;',
  '    acc += sunAt(q) * free * w; ws += w; w *= 0.95;',
  '  }',
  '  o = vec4(vec3(1.0, 0.9, 0.75) * (acc / ws * uK), 1.0);',
  '}'
].join('\n');

var TONE_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uHdr;',
  'uniform sampler2D uBloom;',
  'uniform sampler2D uBloom2;',
  'uniform vec2 uInvRes;',
  'uniform float uBloomK;',
  'uniform float uBloomK2;',
  'uniform float uExposure;',
  'uniform float uFilmic;',
  'uniform float uVig;',
  'uniform float uSat;',
  'uniform float uDbg;',
  'uniform sampler2D uRays;',     // the light shafts
  'uniform sampler2D uStreak;',   // the brightest, smeared across
  'uniform sampler2D uGhost;',    // the brightest, softened, for the ghosts
  'uniform float uStreakK;',
  'uniform float uGhostK;',
  'uniform float uHaze;',         // the heat shimmer
  'uniform float uGrade;',        // the split tone
  'uniform float uT;',
  'out vec4 o;',
  // a ghost is a sample of the brightest flipped through the centre of the
  // lens, and nothing where that lands off the frame
  'vec3 ghost(vec2 u) {',
  '  vec2 w = smoothstep(vec2(0.0), vec2(0.12), u) * smoothstep(vec2(1.0), vec2(0.88), u);',
  '  vec3 g = texture(uGhost, clamp(u, 0.0, 1.0)).rgb;',
  '  return g / (1.0 + g) * w.x * w.y;',
  '}',
  // the ACES fit (Narkowicz): a toe that keeps the shadows dark and a
  // shoulder that takes the hottest to white without a flat clip
  'vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy * uInvRes;',
  '  if (uDbg > 0.5) { vec3 cd = texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0).rgb; o = vec4(vec3(fract(cd.r * 4.0)) * step(0.001, cd.r), 1.0); return; }',
  // the heat shimmer: the air over what glows bends the picture a little —
  // the widest bloom's slope, as a lens, with a slow wobble under it
  '  vec2 off = vec2(0.0);',
  '  if (uHaze > 0.0) {',
  '    vec2 e = uInvRes * 6.0;',
  '    float l0 = dot(texture(uBloom2, uv).rgb, vec3(0.33)), lx = dot(texture(uBloom2, uv + vec2(e.x, 0.0)).rgb, vec3(0.33)), ly = dot(texture(uBloom2, uv + vec2(0.0, e.y)).rgb, vec3(0.33));',
  '    float lq = min(l0, 1.5);',
  '    off = uHaze * uInvRes * (vec2(lx - l0, ly - l0) * 40.0 + lq * 1.2 * vec2(sin(uv.y * 90.0 + uT * 2.7 + lq * 5.0), cos(uv.x * 83.0 + uT * 2.1)));',
  '  }',
  '  vec3 c = texture(uHdr, uv + off).rgb;',
  '  c += texture(uBloom, uv).rgb * uBloomK + texture(uBloom2, uv).rgb * uBloomK2;',
  '  c += texture(uRays, uv).rgb;',
  '  c += texture(uStreak, uv).rgb * vec3(0.45, 0.6, 1.0) * uStreakK;',
  '  if (uGhostK > 0.0) {',
  '    vec2 q0 = uv - 0.5;',
  '    vec3 gs = ghost(0.5 - q0 * 0.55) * vec3(0.7, 0.8, 1.0) + ghost(0.5 - q0 * 1.35) * vec3(1.0, 0.75, 0.6) * 0.6 + ghost(0.5 + q0 * 0.3) * vec3(0.8, 1.0, 0.85) * 0.4;',
  '    c += gs * uGhostK;',
  '  }',
  '  vec2 q = uv - 0.5;',
  '  float vig = 1.0 - uVig * pow(dot(q, q) * 2.0, 1.1);',             // the corners are 1 − uVig, the centre untouched
  '  c *= uExposure * vig;',
  '  c = uFilmic > 0.0 ? aces(c * uFilmic) : pow(vec3(1.0) - exp(-c), vec3(0.92));',
  '  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSat);',
  // the split tone: the shadows a little cool, the lights a little warm
  '  float lg = dot(c, vec3(0.2126, 0.7152, 0.0722));',
  '  c += uGrade * (vec3(-0.02, 0.0, 0.045) * (1.0 - lg) * (1.0 - lg) + vec3(0.035, 0.012, -0.03) * lg * lg);',
  '  o = vec4(vec3(0.016, 0.024, 0.04) * vig + clamp(c, 0.0, 1.0), 1.0);',
  '}'
].join('\n');

// the last pass: FXAA over the tone-mapped frame — the impostors' silhouettes
// and the star points are aliased — and the dither on the way out
var FXAA_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uSrc;',
  'uniform vec2 uInvRes;',
  'uniform float uOn;',
  'uniform float uCA;',           // the chromatic aberration, in pixels at the corner
  'uniform float uGrain;',
  'uniform float uT;',
  'out vec4 o;',
  GLSL_HASH,
  'float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
  // the lens's last word: the red and the blue pulled apart toward the
  // corners, and the grain, fresh every frame and mostly in the dark
  'vec3 finish(vec3 c, vec2 uv) {',
  '  vec2 q0 = uv - 0.5;',
  '  float rad2 = dot(q0, q0) * 2.0;',
  '  if (uCA > 0.0) {',
  '    vec2 off = q0 * rad2 * uCA * uInvRes * 1.4;',
  '    float w = smoothstep(0.1, 0.5, rad2);',
  '    c.r = mix(c.r, texture(uSrc, uv + off).r, w);',
  '    c.b = mix(c.b, texture(uSrc, uv - off).b, w);',
  '  }',
  '  float g = rnd(uint(gl_FragCoord.x) * 7919u + uint(gl_FragCoord.y) * 104729u + uint(uT * 60.0) * 15485863u) - 0.5;',
  '  return c + g * uGrain * (0.3 + 0.7 * (1.0 - luma(c)));',
  '}',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy * uInvRes;',
  '  vec3 m = texture(uSrc, uv).rgb;',
  '  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
  '  vec3 dither = vec3((n - 0.5) / 255.0);',
  '  if (uOn < 0.5) { o = vec4(finish(m, uv) + dither, 1.0); return; }',
  '  vec3 nw = texture(uSrc, uv + vec2(-1.0, -1.0) * uInvRes).rgb, ne = texture(uSrc, uv + vec2(1.0, -1.0) * uInvRes).rgb;',
  '  vec3 sw = texture(uSrc, uv + vec2(-1.0, 1.0) * uInvRes).rgb, se = texture(uSrc, uv + vec2(1.0, 1.0) * uInvRes).rgb;',
  '  float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(m);',
  '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
  '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
  '  if (lMax - lMin < max(0.03, lMax * 0.125)) { o = vec4(finish(m, uv) + dither, 1.0); return; }',   // no edge here
  '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));',
  '  float reduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);',
  '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);',
  '  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uInvRes;',
  '  vec3 a = 0.5 * (texture(uSrc, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uSrc, uv + dir * (2.0 / 3.0 - 0.5)).rgb);',
  '  vec3 b = a * 0.5 + 0.25 * (texture(uSrc, uv - dir * 0.5).rgb + texture(uSrc, uv + dir * 0.5).rgb);',
  '  float lB = luma(b);',
  '  o = vec4(finish((lB < lMin || lB > lMax) ? a : b, uv) + dither, 1.0);',
  '}'
].join('\n');


G.GLSL_NOISE = GLSL_NOISE;
G.G_VS = G_VS; G.G_FS = G_FS; G.BLUR_FS = BLUR_FS; G.SHADE_FS = SHADE_FS;
G.BRIGHT_FS = BRIGHT_FS; G.BLOOM_FS = BLOOM_FS; G.SKY_FS = SKY_FS; G.SUN_FS = SUN_FS;
G.TONE_FS = TONE_FS; G.FXAA_FS = FXAA_FS;
G.SPARK_VS = SPARK_VS; G.SPARK_FS = SPARK_FS; G.ATM_FS = ATM_FS; G.RAYS_FS = RAYS_FS;

})();
