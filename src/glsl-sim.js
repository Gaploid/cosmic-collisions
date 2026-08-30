// The physics shaders: contact cells, the particle mesh, the step itself.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var G = CC.glsl || (CC.glsl = {});
var GLSL_GLOW = G.GLSL_GLOW;

// ---------- the physics, in six passes a step ----------
// 3-D grids live in 2-D atlases: slices side by side. The gravity mesh is
// 64³ over ±6 R⊕ of its centre (8×8 slices of 64×64), its coarse twin 16³
// (4×4 of 16²).
var GLSL_GRID = [
  'ivec2 fineAt(ivec3 c) { return ivec2((c.z & 7) * 64 + c.x, (c.z >> 3) * 64 + c.y); }',
  'ivec2 coarseAt(ivec3 c) { return ivec2((c.z & 3) * 16 + c.x, (c.z >> 2) * 16 + c.y); }'
].join('\n');
// There are two of the mesh: a box that rides the largest body, and one that
// rides a second body of a twentieth of an Earth or more once it stands far
// enough off to be leaving the first — a hit & run's survivor, the twin a
// graze lets go. A particle is in the box it lies within (the nearer centre,
// in a box's own measure, where the two overlap) and reads its gravity
// there: its box's cells, the other box's contents as one mass, and the
// pull of the strays that are in neither. In neither, it gets both boxes as
// masses. A box comes as its half-width less its centre, so that p + uL is
// the place in it; −1 is neither, and g is that place.
var GLSL_BOX = [
  'uniform vec3 uLA;',
  'uniform vec3 uLB;',
  'uniform float uBoxB;',         // 1 — the second box is up
  'int boxOf(vec3 p, out vec3 g) {',
  '  vec3 gA = (p + uLA) * uInvH - 0.5, gB = (p + uLB) * uInvH - 0.5;',
  '  bool inA = all(greaterThanEqual(gA, vec3(0.0))) && all(lessThanEqual(gA, vec3(63.0)));',
  '  bool inB = uBoxB > 0.5 && all(greaterThanEqual(gB, vec3(0.0))) && all(lessThanEqual(gB, vec3(63.0)));',
  '  if (inA && inB) { vec3 dA = abs(gA - 31.5), dB = abs(gB - 31.5); inA = max(dA.x, max(dA.y, dA.z)) <= max(dB.x, max(dB.y, dB.z)); inB = !inA; }',
  '  g = inA ? gA : gB;',
  '  return inA ? 0 : inB ? 1 : -1;',
  '}'
].join('\n');
// A box's contents as one mass, from its mono texel: the pull at p, and the
// potential — for a particle in neither box. And the other box's pull on
// what is in a box: not at the particle but at its box's centre of mass,
// the same for every grain the box owns — so the two boxes pull each other
// along the one line between their centres, a central force, and momentum
// and angular momentum are kept exactly. Everything else was tried and
// measured on the shatter and the twins coming apart. Taken at each
// particle, two bodies that are not spheres pulled each other unequally by
// a few thousandths and walked the barycentre a metre a second every
// quarter hour while they were near. The pull at the centre carried out
// by the tidal tensor kept momentum but ran away on the debris five radii
// out, where a first order in the distance is no order at all, and took
// the energy books with it. A blend — uniform over the body, the point's
// own pull at the debris — leaked again through the seam, since the seam
// ran through the body once the debris had moved its centre of mass. So
// the box gives up the other's tide: a hundredth of its own gravity at the
// distance the second box goes up, and the cube of that after; and its
// debris feel the other box at its centre rather than at their own place,
// which is off by a factor at most for what has flown halfway across.
var GLSL_MASS = [
  'vec3 massAt(vec3 p, sampler2D m) { vec4 mono = texelFetch(m, ivec2(0), 0); vec3 r = mono.xyz / max(mono.w, 1e-6) - p; float inv = inversesqrt(dot(r, r) + uEps2); return r * (uGm * mono.w * inv * inv * inv); }',
  'float potAt(vec3 p, sampler2D m) { vec4 mono = texelFetch(m, ivec2(0), 0); vec3 r = mono.xyz / max(mono.w, 1e-6) - p; return -uGm * mono.w * inversesqrt(dot(r, r) + uEps2); }',
  'vec3 crossAt(sampler2D other, sampler2D mine) {',
  '  vec4 mo = texelFetch(other, ivec2(0), 0), mm = texelFetch(mine, ivec2(0), 0);',
  '  vec3 d = mo.xyz / max(mo.w, 1e-6) - mm.xyz / max(mm.w, 1e-6);',
  '  float inv = inversesqrt(dot(d, d) + uEps2);',
  '  return d * (uGm * mo.w * inv * inv * inv);',
  '}'
].join('\n');
// The contact grid is a hashed cube of G³ cells (G a power of two), one cell =
// one neighbour radius, wrapping around: far-apart particles may share a cell,
// the distance check sorts them out. The wrap is 5.9 R⊕ at 131k, and a plain
// one laid a moon at 4.7 R⊕ over the planet's limb once an orbit: the cells
// filled past their eight seats, the unseated pushed without being pushed
// back, and the system took a metre a second of momentum from every pass. So
// each period's image is skewed in y — by half a period for the period in x,
// a quarter for the one in z — and lands where nothing is: the planet, the
// disk and the moon all live near the plane y = 0. (A scrambling hash
// instead spreads the collisions evenly, and that is worse: two cells of
// the planet's own interior meeting in a seat overfill it, at a steady
// quarter of a per cent of the particles.)
var GLSL_HGRID = [
  'uniform int uGMask;',
  'uniform int uGShift;',
  'uniform int uSXMask;',
  'uniform int uSXShift;',
  'ivec2 hashAt(ivec3 c) {',
  '  ivec3 p = c >> uGShift;',                                            // which period of the wrap each coordinate is in
  '  c.y += (p.x << (uGShift - 1)) + (p.z << (uGShift - 2));',
  '  c.z += p.y << (uGShift - 1);',
  '  c &= uGMask;',
  '  return ivec2(((c.z & uSXMask) << uGShift) + c.x, ((c.z >> uSXShift) << uGShift) + c.y);',
  '}'
].join('\n');
// the seats of a cell: eight, in two texels — the even ones in uSA, the odd
// in uSB — so a cell is two fetches, not eight, and the two do not wait on
// each other. seat(k) picks the k-th out of the pair; k is a constant once
// the loop over the seats is unrolled, so the picking costs nothing. A seat
// is a bit pattern in a float: the particle's index in the low 18 bits, and
// in the 12 above where the particle sat in the cell when the cells were
// built, a fifteenth of it an axis — fifteen, not sixteen, and bit 30 set,
// so the exponent is never all ones nor all zeros and the pattern rides
// through the pipeline as a normal float, neither a NaN to be canonised nor
// a denormal to be flushed. −1 is an empty seat: the only pattern with the
// sign bit set
var GLSL_SLOTS = [
  'uniform sampler2D uSA;',
  'uniform sampler2D uSB;',
  'uint seat(int k, vec4 sa, vec4 sb) { vec4 s = (k & 1) == 0 ? sa : sb; int h = k >> 1; return floatBitsToUint(h == 0 ? s.x : h == 1 ? s.y : h == 2 ? s.z : s.w); }',
  'bool noSeat(uint v) { return (v & 0x80000000u) != 0u; }',
  'int seatIdx(uint v) { return int(v & 0x3FFFFu); }',
  'vec3 seatPos(uint v) { return (vec3(uvec3(v >> 18, v >> 22, v >> 26) & 15u) + 0.5) / 15.0; }'   // in cells, from the cell's corner
].join('\n');

// 1. Filling the contact cells, one seat per pass. Every particle draws a
//    one-pixel point at its cell; the depth test keeps the lowest index.
//    Next pass, particles already seated stay away — a depth-peel that stands
//    in for an atomic counter. The seats of a cell come out in rising order,
//    so whether a particle is seated is one look at the seat before this
//    one: it is still to be seated if that seat is taken by a lower index.
var SLOT_VS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',
  'uniform sampler2D uPrev;',     // the texture holding seat uK − 1
  'uniform ivec2 uSize;',
  'uniform int uK;',
  'uniform float uInvCell;',
  'uniform vec2 uAtlas;',
  'uniform float uInvN;',
  GLSL_HGRID,
  'flat out float vSeat;',
  'void main() {',
  '  int i = gl_VertexID;',
  '  vec3 g = texelFetch(uPos, ivec2(i % uSize.x, i / uSize.x), 0).xyz * uInvCell;',
  '  ivec2 a = hashAt(ivec3(floor(g)));',
  '  uint me = uint(i);',
  '  bool t = false;',
  '  if (uK > 0) {',
  '    vec4 s = texelFetch(uPrev, a, 0); int h = (uK - 1) >> 1;',
  '    uint prev = floatBitsToUint(h == 0 ? s.x : h == 1 ? s.y : h == 2 ? s.z : s.w);',
  '    t = (prev & 0x80000000u) != 0u || me <= (prev & 0x3FFFFu);',   // seated already, or the cell had nobody left last time
  '  }',
  '  uvec3 q = uvec3(clamp(fract(g) * 15.0, 0.0, 14.0));',
  '  vSeat = uintBitsToFloat(me | (q.x << 18) | (q.y << 22) | (q.z << 26) | 0x40000000u);',
  '  gl_PointSize = 1.0;',
  '  if (t) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); return; }',
  '  gl_Position = vec4((vec2(a) + 0.5) / uAtlas * 2.0 - 1.0, float(i) * uInvN * 2.0 - 1.0, 1.0);',
  '}'
].join('\n');
var SLOT_FS = [
  '#version 300 es',
  'precision highp float;',
  'flat in float vSeat;',
  'out vec4 o;',
  'void main() { o = vec4(vSeat); }'   // the seat in every channel: the colour mask picks the one being filled
].join('\n');

// 2. Mass onto the mesh: each particle is eight points, one per corner of its
//    cell, cloud-in-cell weights, added up by blending. Mass is in particles;
//    xyz carry mass-weighted position so a cell knows its centre of mass.
//    A particle in neither box adds instead, into the scratch texel on the
//    row below the atlas, the pull it has on the mesh (it feels the mesh's
//    monopole; this is the equal and opposite, per unit of mesh mass, from
//    last time's monopole), so the mesh is not pushed around one-sidedly.
//    The other box's own are left out altogether: the step gives them to
//    this box's particles as one mass, and this box's to theirs — and a
//    body's worth of points blended into one texel would be a stall.
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
  GLSL_BOX,
  'uniform int uBox;',            // the box this deposit is for
  'uniform float uEps2;',
  GLSL_GRID,
  'out vec4 vW;',
  'void main() {',
  // the particles are taken in a scrambled order — an odd multiple of the
  // index, modulo the count, which is a power of two — because in their own
  // order they come sorted by place, and a run of a few hundred points into
  // the same cell is a run of blends the ROP can only do one after the other
  '  int i = ((gl_VertexID >> 3) * 40503) & (uSize.x * uSize.y - 1), k = gl_VertexID & 7;',
  '  ivec2 tc = ivec2(i % uSize.x, i / uSize.x);',
  '  vec3 p = texelFetch(uPos, tc, 0).xyz;',
  '  float mr = texelFetch(uMat, tc, 0).r;',
  '  vec3 g;',
  '  int mine = boxOf(p, g);',
  '  gl_PointSize = 1.0;',
  '  if (mine != uBox) {',
  '    if (k != 0 || mine >= 0) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); vW = vec4(0.0); return; }',   // the other box's own: left out; a stray: its pull, once
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
// 5. The far field, block by block: for every occupied coarse block, the
//    pull of every block more than two away, at the block's centre of mass —
//    as an acceleration, its gradient (the tidal tensor) and the potential.
//    Block on block is equal and opposite, so what the far field does to
//    the mesh as a whole is nothing. It was not, when every fine cell summed
//    the far blocks for itself: a cell saw a block as a point at the block's
//    centre of mass, the block's cells saw the cell's block the same way,
//    and the two sums differ at the quadrupole — a self-force of a few
//    hundredths of a metre a second an hour, which walked the planet a
//    radius across the mesh in a hundred hours and carried the Moon over
//    the edge.
var FAR_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uCoarse;',
  GLSL_GRID,
  'layout(location = 0) out vec4 oA;',    // xyz — acceleration per unit mass, w — potential
  'layout(location = 1) out vec4 oT0;',   // Txx Tyy Tzz Txy
  'layout(location = 2) out vec4 oT1;',   // Txz Tyz — —
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  ivec3 c = ivec3(me.x & 15, me.y & 15, (me.y >> 4) * 4 + (me.x >> 4));',
  '  vec4 mc = texelFetch(uCoarse, me, 0);',
  '  oA = vec4(0.0); oT0 = vec4(0.0); oT1 = vec4(0.0);',
  '  if (mc.w <= 0.0) return;',
  '  vec3 x = mc.xyz / mc.w;',
  '  vec3 acc = vec3(0.0), td = vec3(0.0), to = vec3(0.0);',   // the tensor's diagonal, and its xy xz yz
  '  float pot = 0.0;',
  '  for (int kz = 0; kz < 16; kz++) for (int ky = 0; ky < 16; ky++) for (int kx = 0; kx < 16; kx++) {',
  '    ivec3 k = ivec3(kx, ky, kz), dd = abs(k - c);',
  '    if (max(dd.x, max(dd.y, dd.z)) <= 2) continue;',
  '    vec4 m = texelFetch(uCoarse, coarseAt(k), 0);',
  '    if (m.w <= 0.0) continue;',
  '    vec3 r = m.xyz / m.w - x;',
  '    float inv2 = 1.0 / dot(r, r), inv = sqrt(inv2), inv3 = inv * inv2, inv5 = inv3 * inv2;',
  '    acc += r * (m.w * inv3); pot -= m.w * inv;',
  '    td += m.w * (3.0 * r * r * inv5 - inv3);',
  '    to += m.w * (3.0 * vec3(r.x * r.y, r.x * r.z, r.y * r.z) * inv5);',
  '  }',
  '  oA = vec4(acc, pot); oT0 = vec4(td, to.x); oT1 = vec4(to.y, to.z, 0.0, 0.0);',
  '}'
].join('\n');
// 6. Gravity at every occupied fine cell: the 5³ coarse cells around it are
//    summed fine cell by fine cell (that block is 3.75 R⊕ wide, so the whole
//    planet is in it), the rest of the world as the cell's block's far
//    field, carried from the block's centre of mass to the cell by the
//    tidal tensor — so a block's cells feel the tide across it, and the
//    block as a whole feels exactly the block-to-block force. The
//    potential rides in w, for the energy books.
var CELL_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uFine;',
  'uniform sampler2D uCoarse;',
  'uniform sampler2D uFarA;',
  'uniform sampler2D uFarT0;',
  'uniform sampler2D uFarT1;',
  'uniform float uH;',
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
  '  for (int kz = -2; kz <= 2; kz++) for (int ky = -2; ky <= 2; ky++) for (int kx = -2; kx <= 2; kx++) {',
  '    ivec3 k = cc + ivec3(kx, ky, kz);',
  '    if (any(lessThan(k, ivec3(0))) || any(greaterThan(k, ivec3(15)))) continue;',
  '    vec4 m = texelFetch(uCoarse, coarseAt(k), 0);',
  '    if (m.w <= 0.0) continue;',                       // an empty block is nothing: most of the 125 are
  '    for (int fz = 0; fz < 4; fz++) for (int fy = 0; fy < 4; fy++) for (int fx = 0; fx < 4; fx++) {',
  '      ivec3 f = k * 4 + ivec3(fx, fy, fz);',
  '      if (f == c) continue;',
  '      vec4 mf = texelFetch(uFine, fineAt(f), 0);',
  '      if (mf.w <= 0.0) continue;',
  '      vec3 r = mf.xyz / mf.w - x;',
  '      float inv = inversesqrt(dot(r, r) + uEps2);',
  '      acc += r * (mf.w * inv * inv * inv); pot -= mf.w * inv;',
  '    }',
  '  }',
  '  ivec2 ca = coarseAt(cc);',
  '  vec4 mb = texelFetch(uCoarse, ca, 0), fa = texelFetch(uFarA, ca, 0), t0 = texelFetch(uFarT0, ca, 0), t1 = texelFetch(uFarT1, ca, 0);',
  '  vec3 d = x - mb.xyz / mb.w;',
  '  vec3 Td = vec3(t0.x * d.x + t0.w * d.y + t1.x * d.z, t0.w * d.x + t0.y * d.y + t1.y * d.z, t1.x * d.x + t1.y * d.y + t0.z * d.z);',
  '  acc += fa.xyz + Td;',
  '  pot += fa.w - dot(fa.xyz, d) - 0.5 * dot(d, Td);',
  '  o = vec4(acc * uGm, pot * uGm);',
  '}'
].join('\n');

// 6. The particles. Contacts from the 27 cells around (a spring-dashpot that
//    keeps the material incompressible and turns impact energy into heat),
//    gravity read off the mesh — or, off the mesh, from its total mass.
//    Symplectic Euler: kick, then drift.
// The step. Contacts, heat and the integration are the same wherever this
// runs; where the pull comes from is not, so the page says. 'mesh' is the
// self-gravitating particle mesh with its pairwise correction, 'field' a
// constant — a patch of ground small enough that gravity is g and down.
var SIM_PRE = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uPos;',      // xyz — position, w — body (0 target, 1 impactor)
  'uniform sampler2D uVel;',      // xyz — velocity, w — temperature, K
  'uniform sampler2D uMat;',      // r — mass, in Earth-mantle particles
  'uniform ivec2 uSize;',
  'uniform float uInvCell;',
  'uniform float uCell;',
  'uniform float uDt;',
  'uniform float uGDt;',          // the mesh gravity's time step: the steps it stands for, as one impulse — or 0
  'uniform float uTouch;',        // contact distance, 2a
  'uniform float uLink2;',        // neighbour radius²
  'uniform float uReach2;',       // (neighbour radius + what a seat's place can be off by)²: the cut for skipping a seat unfetched
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
  '    vec4 sa = texelFetch(uSA, a, 0), sb = texelFetch(uSB, a, 0);',
  '    for (int k = 0; k < 8; k++) {',
  '      uint sv = seat(k, sa, sb);',
  '      if (noSeat(sv)) break;',
  '      int j = seatIdx(sv);',
  '      if (j == myIdx) continue;',
  '      vec3 dq = lo + seatPos(sv) * uCell - p;',     // where it sat, to a fifteenth of a cell and a step of motion: most of the cells' seats are beyond reach, and are let go without a fetch
  '      if (dot(dq, dq) > uReach2) continue;',
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
];
var SIM_UNI_MESH = [
  GLSL_GRID,
  'uniform sampler2D uForce;',    // the first box's cells, with its scratch texel
  'uniform sampler2D uMono;',     // and its contents as one mass
  'uniform sampler2D uForceB;',   // the second box's
  'uniform sampler2D uMonoB;',
  'uniform float uInvH;',
  GLSL_BOX,
  'uniform float uGm;',
  'uniform float uEps2;',
  GLSL_MASS,
  'uniform sampler2D uPPSlot;',   // r — this particle's seat on the loose list, or -1
  'uniform sampler2D uPPForce;',  // the pairwise correction, by seat
];
var SIM_UNI_FIELD = [
  'uniform vec3 uGField;',   // the whole of gravity here: g, and down
];
var SIM_GRAV_MESH = [
  '  vec3 grav = vec3(0.0), g;',
  '  int box = boxOf(p, g);',
  '  if (box >= 0) {',
  '    vec3 f = floor(g), t = g - f;',
  '    ivec3 c0 = ivec3(f);',
  '    for (int k = 0; k < 8; k++) {',
  '      ivec3 o = ivec3(k & 1, (k >> 1) & 1, k >> 2);',
  '      vec3 w3 = mix(1.0 - t, t, vec3(o));',
  '      ivec2 at = fineAt(min(c0 + o, ivec3(63)));',
  '      grav += (box == 0 ? texelFetch(uForce, at, 0).xyz : texelFetch(uForceB, at, 0).xyz) * (w3.x * w3.y * w3.z);',
  '    }',
  '    grav -= (box == 0 ? texelFetch(uForce, ivec2(0, 512), 0).xyz : texelFetch(uForceB, ivec2(0, 512), 0).xyz) * uGm;',   // the strays in neither box pull back
  '    if (uBoxB > 0.5) grav += box == 0 ? crossAt(uMonoB, uMono) : crossAt(uMono, uMonoB);',   // and the other box's contents, as one mass at this box's centre
  '  } else {',
  '    grav = massAt(p, uMono);',
  '    if (uBoxB > 0.5) grav += massAt(p, uMonoB);',
  '  }',
  '  float seat = texelFetch(uPPSlot, me, 0).r;',
  '  if (seat >= 0.0) { ivec2 sc = ivec2(int(seat) & 127, int(seat) >> 7); for (int s = 0; s < 4; s++) grav += texelFetch(uPPForce, sc + ivec2(0, 64 * s), 0).xyz; }',
];
var SIM_GRAV_FIELD = [
  '  vec3 grav = uGField;'
];
var SIM_POST = [
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
];
// A page can also ask for one material to be held still — the floor and walls
// of a patch of ground, standing in for the rest of the world that is not in
// the box. It is opt-in because a material index means whatever the page says
// it means, and index 0 is the target's core in the giant impact.
function simFS(o) {
  var field = !!o && o.gravity === 'field';
  var frozen = !!o && o.frozen;
  var uni = (field ? SIM_UNI_FIELD : SIM_UNI_MESH).slice();
  if (frozen) uni = uni.concat(["uniform float uFrozen;   // the material that does not move"]);
  var post = SIM_POST;
  if (frozen) {
    post = [];
    for (var i = 0; i < SIM_POST.length; i++) {
      if (SIM_POST[i] === '  p += v * uDt;') post.push('  if (abs(body - uFrozen) < 0.5) v = vec3(0.0);');
      post.push(SIM_POST[i]);
    }
  }
  return SIM_PRE.slice(0, 4)
    .concat(uni, SIM_PRE.slice(4), field ? SIM_GRAV_FIELD : SIM_GRAV_MESH, post)
    .join('\n');
}

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
  'uniform sampler2D uForceB;',
  'uniform sampler2D uMonoB;',
  'uniform ivec2 uSize;',
  'uniform float uInvCell;',
  'uniform float uInvH;',
  GLSL_BOX,
  'uniform float uEps2;',
  'uniform float uGm;',
  GLSL_MASS,
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
  '  vec4 sa = texelFetch(uSA, a, 0), sb = texelFetch(uSB, a, 0);',
  '  for (int k = 0; k < 8; k++) {',
  '    uint sv = seat(k, sa, sb);',
  '    if (noSeat(sv)) break;',
  '    taken += 1.0;',
  '    if (seatIdx(sv) == myIdx) seated = 1.0;',
  '  }',
  '  float phi = 0.0, off = 0.0;',
  '  vec3 g;',
  '  int box = boxOf(p, g);',
  '  if (box >= 0) {',
  '    vec3 f = floor(g), t = g - f;',
  '    ivec3 c0 = ivec3(f);',
  '    for (int k = 0; k < 8; k++) {',
  '      ivec3 oo = ivec3(k & 1, (k >> 1) & 1, k >> 2);',
  '      vec3 w3 = mix(1.0 - t, t, vec3(oo));',
  '      ivec2 at = fineAt(min(c0 + oo, ivec3(63)));',
  '      phi += (box == 0 ? texelFetch(uForce, at, 0).w : texelFetch(uForceB, at, 0).w) * (w3.x * w3.y * w3.z);',
  '    }',
  '    if (uBoxB > 0.5) phi += box == 0 ? potAt(p, uMonoB) : potAt(p, uMono);',   // the other box's contents as one mass: a pair on the mesh, counted from both ends
  '  } else {',
  '    phi = potAt(p, uMono);',
  '    if (uBoxB > 0.5) phi += potAt(p, uMonoB);',
  '    off = 2.0;',
  '  }',
  '  float seat = texelFetch(uPPSlot, me, 0).r;',
  '  if (seat >= 0.0) { ivec2 sc = ivec2(int(seat) & 127, int(seat) >> 7); for (int s = 0; s < 4; s++) phi += texelFetch(uPPForce, sc + ivec2(0, 64 * s), 0).w; }',
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
  'uniform float uInvH;',
  GLSL_BOX,
  'layout(location = 0) out vec4 o;',      // xyz — position, w — mass, 0 for an empty seat
  'layout(location = 1) out float oBox;',  // the box the particle reads, −1 for neither
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  float fi = texelFetch(uIndex, me, 0).r;',
  '  if (fi < 0.0) { o = vec4(0.0); oBox = -1.0; return; }',
  '  int i = int(fi);',
  '  ivec2 t = ivec2(i % uSize.x, i / uSize.x);',
  '  vec3 p = texelFetch(uPos, t, 0).xyz, g;',
  '  oBox = float(boxOf(p, g));',
  '  o = vec4(p, texelFetch(uMat, t, 0).r);',
  '}'
].join('\n');
// …then every seat is summed against the whole list — in four slices, a
// quarter of the list each, that the readers add up: eight thousand seats
// are too few threads to keep a GPU busy, and four times that is not. The
// mesh's own pair force and potential come as tables by distance (see
// meshPairTable) — in a texture, not a uniform array: an index that differs
// from thread to thread into a uniform array is served one thread at a time,
// and that was most of the pass — Newton's is softened at the particle
// radius, and the difference is tapered out at the cut-off. A pair that
// does not read the same box got nothing from a mesh as a pair — the other
// side came as part of one mass, or not at all — and is given the whole of
// Newton: a moonlet straddling an edge stays bound — subtracting the
// table there took half its self-gravity, and the tide had the rest.
var PPFORCE_FS = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'precision highp sampler2D;',
  'uniform sampler2D uList;',
  'uniform sampler2D uBoxOf;',      // r — the box each seat reads
  'uniform int uCount;',
  'uniform float uGm;',
  'uniform float uCut;',
  'uniform float uA2;',             // particle radius²
  'uniform sampler2D uTab;',        // 64 × 1: r — the mesh's pair force × r², by r/uCut; g — its pair potential × r
  'out vec4 o;',                    // xyz — acceleration to add, w — potential to add, this slice's share
  'void main() {',
  '  ivec2 me = ivec2(gl_FragCoord.xy);',
  '  int slice = me.y >> 6; me.y &= 63;',
  '  int myIdx = me.y * 128 + me.x;',
  '  int share = (uCount + 3) >> 2, j0 = slice * share, j1 = min(j0 + share, uCount);',
  '  vec4 P = texelFetch(uList, me, 0);',
  '  if (myIdx >= uCount || P.w == 0.0) { o = vec4(0.0); return; }',
  '  float myBox = texelFetch(uBoxOf, me, 0).r;',
  '  vec3 acc = vec3(0.0);',
  '  float pot = 0.0, cut2 = uCut * uCut, a = sqrt(uA2);',
  '  for (int j = j0; j < j1; j++) {',
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
  '    vec2 T = mix(texelFetch(uTab, ivec2(k, 0), 0).rg, texelFetch(uTab, ivec2(k1, 0), 0).rg, t) * ((myBox >= 0.0 && texelFetch(uBoxOf, ivec2(j & 127, j >> 7), 0).r == myBox) ? 1.0 : 0.0);',   // the mesh's share, if a mesh gave this pair one: both read the same box
  '    float fn = invN * invN * invN * r - T.x / max(r2, uA2), mj = Q.w;',
  '    acc += d / max(r, 1e-6) * (mj * fn * taper);',
  '    pot += mj * (-invN - T.y / max(r, a)) * taper;',
  '  }',
  '  o = vec4(acc * uGm, pot * uGm);',
  '}'
].join('\n');


G.GLSL_GRID = GLSL_GRID; G.GLSL_HGRID = GLSL_HGRID; G.GLSL_SLOTS = GLSL_SLOTS;
G.SLOT_VS = SLOT_VS; G.SLOT_FS = SLOT_FS; G.DEP_VS = DEP_VS; G.DEP_FS = DEP_FS;
G.COARSE_FS = COARSE_FS; G.MONO_FS = MONO_FS; G.FAR_FS = FAR_FS; G.CELL_FS = CELL_FS; G.simFS = simFS;
G.RIGID_FS = RIGID_FS; G.PERM_FS = PERM_FS; G.DIAG_FS = DIAG_FS;
G.PPGATHER_FS = PPGATHER_FS; G.PPFORCE_FS = PPFORCE_FS;

})();
