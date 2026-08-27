// The picture: sphere impostors, the bilateral blur that melts them into a
// skin, the shading, the sun, bloom, the film.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var G = CC.glsl || (CC.glsl = {});
var GLSL_MATCOL = G.GLSL_MATCOL, GLSL_GLOW = G.GLSL_GLOW;



// The body, in three screen-space passes — the trick fluid renderers use.
// 1. Every body-particle is a sphere impostor with per-fragment depth; the
//    pass keeps its material colour, its heat, and its view-space depth.
// 2. A bilateral blur one particle wide smooths depth and colour along the
//    surface but never across a silhouette — the balls melt into a skin.
// 3. Normals come from the smoothed depth, and the skin is lit by the sun.
var G_VS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uVel;',
  'uniform sampler2D uAux;',
  'uniform ivec2 uSize;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform float uRad;',
  'uniform sampler2D uMat;',
  'uniform float uRadPow;',   // 0 — every particle the same size; 1/3 — by the cube root of its mass
  'uniform float uPx;',
  'uniform float uMaxPt;',
  'uniform float uFat;',
  GLSL_MATCOL,
  'out float vZc;',
  'out float vR;',
  'out float vNb;',
  'out vec4 vMat;',        // rgb — material, a — temperature
  'void main() {',
  '  ivec2 tc = ivec2(gl_VertexID % uSize.x, gl_VertexID / uSize.x);',
  '  vec4 P = texelFetch(uPos, tc, 0);',
  '  vec4 e = uView * vec4(P.xyz, 1.0);',
  '  vNb = texelFetch(uAux, tc, 0).w;',
  '  vZc = e.z;',
  '  vR = uRad * pow(max(texelFetch(uMat, tc, 0).r, 1e-9), uRadPow) * mix(1.0, uFat, smoothstep(0.0, 6.0, vNb));',    // packed particles run fat, so the skin has no gaps
  '  vMat = vec4(matColor(P.w), texelFetch(uVel, tc, 0).w);',
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
  'layout(location = 0) out vec4 oMat;',
  'layout(location = 1) out vec4 oDep;',   // r — view depth, g — neighbours, and in its fraction the coverage: 1 wherever a particle drew
  'void main() {',
  '  vec2 d = gl_PointCoord * 2.0 - 1.0;',
  '  float r2 = dot(d, d);',
  '  if (r2 > 1.0) discard;',
  '  float ze = min(vZc + vR * sqrt(1.0 - r2), -0.05);',
  '  gl_FragDepth = ((uP22 * ze + uP32) / (-ze)) * 0.5 + 0.5;',
  '  oMat = vMat;',
  '  oDep = vec4(-ze, vNb + 0.999, 0.0, 1.0);',
  '}'
].join('\n');

var BLUR_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform sampler2D uMat;',
  'uniform sampler2D uDep;',
  'uniform ivec2 uDir;',
  'uniform int uTaps;',
  'uniform float uStep;',
  'uniform float uRange;',      // the depth jump that ends a surface
  'uniform ivec2 uRes;',
  'layout(location = 0) out vec4 oMat;',
  'layout(location = 1) out vec4 oDep;',
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  vec2 d0 = texelFetch(uDep, me, 0).rg;',
  '  float z0 = d0.r, nb = floor(d0.g);',
  '  float sigc = float(uTaps) * uStep * 0.18 + 0.5;',
  '  int ct = min(uTaps, int(ceil(2.5 * sigc / uStep)));',                                      // its own reach, narrower than the depth blur's
  '  float cw = 0.0, cs = 0.0;',
  '  for (int i = -ct; i <= ct; i++) {',
  '    float x = float(i) * uStep;',
  '    ivec2 c = clamp(me + uDir * int(round(x)), ivec2(0), uRes - 1);',
  '    float g = exp(-x * x / (2.0 * sigc * sigc));',
  '    cw += g; cs += g * fract(texelFetch(uDep, c, 0).g);',
  '  }',
  '  float cov = cs / cw * 0.999;',
  '  if (z0 <= 0.0) { oMat = vec4(0.0); oDep = vec4(0.0, cov, 0.0, 1.0); return; }',
  '  float sig = (float(uTaps) * uStep * 0.5 + 0.5) * max(smoothstep(1.0, 5.0, nb), 0.05);',   // loners and small clumps keep their shape
  '  float ws = 0.0, zs = 0.0;',
  '  vec4 ms = vec4(0.0);',
  '  for (int i = -uTaps; i <= uTaps; i++) {',
  '    float x = float(i) * uStep;',
  '    ivec2 c = clamp(me + uDir * int(round(x)), ivec2(0), uRes - 1);',
  '    float z = texelFetch(uDep, c, 0).r;',
  '    if (z <= 0.0) continue;',
  '    float dz = (z - z0) / uRange;',
  '    float w = exp(-x * x / (2.0 * sig * sig) - dz * dz);',
  '    ws += w; zs += w * z; ms += w * texelFetch(uMat, c, 0);',
  '  }',
  '  oDep = vec4(zs / ws, nb + cov, 0.0, 1.0);',
  '  oMat = ms / ws;',
  '}'
].join('\n');

var SHADE_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform sampler2D uMat;',
  'uniform sampler2D uDep;',
  'uniform sampler2D uDepRaw;',  // the depth before the blur: the particles themselves
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
  'uniform float uReach2;',     // the fall-off, 1/(d²/R² + reach²): inverse-square far off, kept from blowing up close in
  'uniform float uRad;',        // a particle's radius, to know how many pixels wide one stands here
  'uniform float uEdge;',       // where the silhouette ends, in coverage, and how soft its last pixel is
  'uniform float uEdgeSoft;',
  'uniform float uDbg;',        // LOOK.dbg: 1 the ember alone, 2 the particle normal, 3 the direction to the first light, 4 the skin normal
  'uniform int uNO;',           // what casts shadows in that light, as balls: the planet, the impactor while it is one, the second body
  'uniform vec4 uOcc[3];',      // centre in eye space, radius
  'out vec4 o;',
  GLSL_GLOW,
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
  '  if (alpha <= 0.0) discard;',
  '  vec3 p = posAt(uDep, me);',
  '  bool edge, edgeR;',
  '  vec3 n = normalAt(uDep, me, p, edge);',                            // the skin's
  '  vec3 nR = normalAt(uDepRaw, me, posAt(uDepRaw, me), edgeR);',      // the particle's own: honest at a silhouette, where the smoothed skin's turns any way
  '  vec4 m = texelFetch(uMat, me, 0);',
  '  float lit = 0.12 + 0.88 * max(0.0, dot(n, uSunEye));',
  '  lit *= 0.7 + 0.3 * n.z;',                       // the limb turns away
  '  float molten = smoothstep(1300.0, 2100.0, m.a);',                            // past the melting point the crust is gone: dark rock, lit by itself
  '  vec3 alb = mix(m.rgb, m.rgb * 0.25 + vec3(0.05, 0.03, 0.02), molten);',
  // the hot bodies' light on everything else — the disk in the planet's
  // glow — by the skin's normal or the particle's, whichever faces the light
  // less: along a silhouette the smoothed skin's normal is noise, and this
  // light is twenty times the sun's, so the noise would be a bright rim
  '  vec3 ember = vec3(0.0);',
  '  for (int i = 0; i < 2; i++) if (i < uNL && !edge && !edgeR) {',
  '    vec3 l = uLPos[i] - p;',
  '    float d2 = dot(l, l) / uLR2[i];',
  '    vec3 lh = normalize(l);',
  '    ember += uLCol[i] * min(max(0.0, dot(n, lh)), max(0.0, dot(nR, lh))) / (d2 + uReach2) * smoothstep(1.0, 2.0, d2) * shadow(p, uLPos[i], sqrt(uLR2[i]));',   // and not the body's own skin: convex, it cannot light itself
  '  }',
  '  gl_FragDepth = ((uP22 * (-z) + uP32) / z) * 0.5 + 0.5;',
  '  if (uDbg > 0.5) { vec3 lh0 = normalize(uLPos[0] - p); o = vec4(uDbg < 1.5 ? ember : uDbg < 2.5 ? nR * 0.5 + 0.5 : uDbg < 3.5 ? lh0 * 0.5 + 0.5 : n * 0.5 + 0.5, 1.0); return; }',
  '  o = vec4(alb * (lit + ember) + glow(m.a) * uGlow, alpha);',
  '}'
].join('\n');

// 4. Bloom: what is brighter than white — the glow, the hottest sparks —
//    taken at a quarter of the size and blurred twice over, a narrow halo
//    and a wide one, then laid back over the picture.
var BRIGHT_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uHdr;',
  'uniform vec2 uInvRes;',       // of the canvas
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

// the sun: a disk where SUN is, with a glare round it, drawn into the HDR
// canvas behind everything so the bodies hide it; the bloom does the rest
var SUN_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform vec2 uRes;',
  'uniform vec2 uInvP;',
  'uniform vec3 uSunEye;',
  'uniform float uSunR;',       // the disk's angular radius, radians
  'uniform float uSunI;',
  'uniform float uHalo;',
  'out vec4 o;',
  'void main() {',
  '  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;',
  '  vec3 ray = normalize(vec3(ndc * uInvP, -1.0));',
  '  if (dot(ray, uSunEye) < 0.7) discard;',
  '  float th = 2.0 * asin(min(0.5 * length(ray - uSunEye), 1.0));',   // the angle off the sun's centre, exact where it is small
  '  float px = uInvP.y * 2.0 / uRes.y;',                               // one pixel in radians
  '  float disk = 1.0 - smoothstep(uSunR - px, uSunR + px, th);',
  '  float x = max(th - uSunR, 0.0);',
  '  float halo = uHalo * (0.6 * exp(-x / (2.0 * uSunR)) + 0.12 * exp(-x / 0.05) + 0.02 * exp(-x / 0.3));',
  '  gl_FragDepth = 0.9999;',
  '  o = vec4(vec3(1.0, 0.96, 0.88) * (disk * uSunI) + vec3(1.0, 0.8, 0.55) * halo, 1.0);',
  '}'
].join('\n');

var TONE_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform sampler2D uHdr;',
  'uniform sampler2D uBloom;',
  'uniform vec2 uInvRes;',
  'uniform float uBloomK;',
  'uniform float uExposure;',
  'uniform float uFilmic;',
  'uniform float uVig;',
  'uniform float uDbg;',
  'out vec4 o;',
  // the ACES fit (Narkowicz): a toe that keeps the shadows dark and a
  // shoulder that takes the hottest to white without a flat clip
  'vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',
  'void main() {',
  '  vec3 c = texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0).rgb;',
  '  if (uDbg > 0.5) { o = vec4(vec3(fract(c.r * 4.0)) * step(0.001, c.r), 1.0); return; }',
  '  c += texture(uBloom, gl_FragCoord.xy * uInvRes).rgb * uBloomK;',
  '  vec2 q = gl_FragCoord.xy * uInvRes - 0.5;',
  '  float vig = 1.0 - uVig * pow(dot(q, q) * 2.0, 1.1);',             // the corners are 1 − uVig, the centre untouched
  '  c *= uExposure * vig;',
  '  c = uFilmic > 0.0 ? aces(c * uFilmic) : pow(vec3(1.0) - exp(-c), vec3(0.92));',
  '  o = vec4(vec3(0.016, 0.024, 0.04) * vig + c, 1.0);',
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
  'out vec4 o;',
  'float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy * uInvRes;',
  '  vec3 m = texture(uSrc, uv).rgb;',
  '  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
  '  vec3 dither = vec3((n - 0.5) / 255.0);',
  '  if (uOn < 0.5) { o = vec4(m + dither, 1.0); return; }',
  '  vec3 nw = texture(uSrc, uv + vec2(-1.0, -1.0) * uInvRes).rgb, ne = texture(uSrc, uv + vec2(1.0, -1.0) * uInvRes).rgb;',
  '  vec3 sw = texture(uSrc, uv + vec2(-1.0, 1.0) * uInvRes).rgb, se = texture(uSrc, uv + vec2(1.0, 1.0) * uInvRes).rgb;',
  '  float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(m);',
  '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
  '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
  '  if (lMax - lMin < max(0.03, lMax * 0.125)) { o = vec4(m + dither, 1.0); return; }',   // no edge here
  '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));',
  '  float reduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);',
  '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);',
  '  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uInvRes;',
  '  vec3 a = 0.5 * (texture(uSrc, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uSrc, uv + dir * (2.0 / 3.0 - 0.5)).rgb);',
  '  vec3 b = a * 0.5 + 0.25 * (texture(uSrc, uv - dir * 0.5).rgb + texture(uSrc, uv + dir * 0.5).rgb);',
  '  float lB = luma(b);',
  '  o = vec4(((lB < lMin || lB > lMax) ? a : b) + dither, 1.0);',
  '}'
].join('\n');


G.G_VS = G_VS; G.G_FS = G_FS; G.BLUR_FS = BLUR_FS; G.SHADE_FS = SHADE_FS;
G.BRIGHT_FS = BRIGHT_FS; G.BLOOM_FS = BLOOM_FS; G.SUN_FS = SUN_FS;
G.TONE_FS = TONE_FS; G.FXAA_FS = FXAA_FS;

})();
