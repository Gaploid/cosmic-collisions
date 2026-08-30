// The self-gravitating engine: two bodies of particles under their own
// gravity — the 64³ particle mesh with the loose material corrected pairwise
// against it — with contacts, heat, an approach on rails and an analysis in a
// worker. The giant impact is built on it; so is anything else that wants a
// planet made of grains that can be knocked out of it.
//
// G = 1, Earth mass = 1, Earth radius = 1. Then the time unit is √(R³/GM) =
// 805 s (13.4 min), the velocity unit is 7.91 km/s, and escape speed off Earth
// is √2. Every body-particle carries the same mass, so a body's mass is a head
// count and — at Earth density — its radius is the cube root of its mass.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var gl = null, floatBlend = false;
var floatTex, simTarget, freeTarget, fboFor, makeGrid, freeGrid;
// the maths and the body builder are plain functions, loaded before this
// file, and the pairwise table below wants the random at load
var mulberry = CC.math.mulberry, ball = CC.bodies.ball, maclaurin = CC.bodies.maclaurin, turn = CC.bodies.turn;
var simProg, slotProg, depProg, coarseProg, monoProg, farProg, cellProg, rigidProg, diagProg, ppGatherProg, ppForceProg, permProg;
var SLOTS = CC.SLOTS, N_CHOICES = CC.N_CHOICES;
var T_UNIT = 805, V_UNIT = 7.91;
var E_KG = 6.256e7;                         // GM⊕/R⊕: the energy unit per kilogram, J/kg
var CP_ROCK = 1200, CP_IRON = 450;          // heat capacities, J/kg·K — molten silicate, liquid iron
var L_EM = 0.1163;                          // the Earth–Moon system's angular momentum today, 3.5e34 kg m²/s, in M⊕√(GM⊕R⊕)
// the heat a readout shows as a temperature: the mean rise over the whole
// mass, at the capacity of what that mass is. Iron holds under half of what
// rock does per kilogram and a third of a planet is iron, so rock's own
// capacity over everything reads a quarter low — the shader already gives
// each grain its own (uCpIron), and this is the same sum over the books
function meanK(r) { return r.Q / r.M * E_KG / (CP_ROCK + r.iron * (CP_IRON - CP_ROCK)); }
// A lattice of touching spheres fills 74 % of the space; a pile poured at
// random jams at about 64 %, and the onion the bodies are built as jams a
// little looser than the lattice it replaces — left at the lattice's radius
// its particles would stand the body 4 % wide of the radius its mass asks
// for, and 4 % less bound. The grains are that much smaller instead.
var JAM = 0.96;
var FL = 6.0, FH = 2 * FL / 64;             // gravity mesh: 64³ cells over ±6 R⊕ of its centre — two of them, see boxes()
var PP_CAP = 8192, PP_W = 128, PP_H = 64;   // the loose material the pairwise pass can take, as a 128×64 list
var PP_SLICES = 4;                          // the pairwise sum is done in this many parts, one atlas row of seats each (PPFORCE_FS and its readers count on four)
var PP_CUT = 5 * FH;                        // how far the pairwise correction reaches: five cells
var SEAT_SLACK = 0.6;                       // in radii: how far a particle may be from where its seat says — a fifteenth of a cell and a step of motion

// ---------- the meshes ----------
// the gravity mesh, the loose list, and the contact grid: GL objects, so
// they are made at init() rather than at load
var pm = null, pp = null, grid = null;

// The mesh's own force between two particles by their distance, for the
// pairwise pass to subtract. The two are put on the grid (a random offset, a
// random direction) and the mesh's arithmetic is repeated here — cloud-in-cell
// deposit, force and potential at each node's centre of mass with the near
// softening, own node left out, cloud-in-cell gather — less what the first
// particle feels alone, its self-force. Averaged over 80 placings a bin, 64
// bins to the cut-off; returned as force × r² and potential × r, which go to
// 1 and −1 where the mesh is Newton's.
function meshPairTable(bins, cut) {
  var rng = mulberry(777), eps2 = 0.5 * FH * FH, per = 80;
  var f = new Float32Array(bins), pt = new Float32Array(bins);
  function corners(p) {
    var g = [(p[0] + FL) / FH - 0.5, (p[1] + FL) / FH - 0.5, (p[2] + FL) / FH - 0.5];
    var fl = [Math.floor(g[0]), Math.floor(g[1]), Math.floor(g[2])], t = [g[0] - fl[0], g[1] - fl[1], g[2] - fl[2]], out = [];
    for (var k = 0; k < 8; k++) {
      var ox = k & 1, oy = (k >> 1) & 1, oz = k >> 2;
      out.push([(fl[0] + ox) + ',' + (fl[1] + oy) + ',' + (fl[2] + oz), (ox ? t[0] : 1 - t[0]) * (oy ? t[1] : 1 - t[1]) * (oz ? t[2] : 1 - t[2])]);
    }
    return out;
  }
  function field(parts, at) {
    var nodes = new Map(), i, k;
    for (i = 0; i < parts.length; i++) {
      var p = parts[i], cs = corners(p);
      for (k = 0; k < 8; k++) {
        var n = nodes.get(cs[k][0]), w = cs[k][1];
        if (!n) { n = { m: 0, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0, pot: 0 }; nodes.set(cs[k][0], n); }
        n.m += w; n.x += w * p[0]; n.y += w * p[1]; n.z += w * p[2];
      }
    }
    var list = Array.from(nodes.values());
    list.forEach(function (n) { n.x /= n.m; n.y /= n.m; n.z /= n.m; });
    list.forEach(function (c) {
      list.forEach(function (o) {
        if (o === c) return;
        var rx = o.x - c.x, ry = o.y - c.y, rz = o.z - c.z, inv = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + eps2), inv3 = inv * inv * inv;
        c.fx += rx * o.m * inv3; c.fy += ry * o.m * inv3; c.fz += rz * o.m * inv3; c.pot -= o.m * inv;
      });
    });
    var out = [0, 0, 0, 0], cs = corners(at);
    for (k = 0; k < 8; k++) {
      var n = nodes.get(cs[k][0]), w = cs[k][1];
      if (!n) continue;
      out[0] += w * n.fx; out[1] += w * n.fy; out[2] += w * n.fz; out[3] += w * n.pot;
    }
    return out;
  }
  for (var b = 0; b < bins; b++) {
    var r = (b + 0.5) / bins * cut, sf = 0, sp = 0;
    for (var s = 0; s < per; s++) {
      var p = [(rng() - 0.5) * FH, (rng() - 0.5) * FH, (rng() - 0.5) * FH];
      var z = 2 * rng() - 1, ph = rng() * 6.2831853, rr = Math.sqrt(1 - z * z), u = [rr * Math.cos(ph), rr * Math.sin(ph), z];
      var q = [p[0] + u[0] * r, p[1] + u[1] * r, p[2] + u[2] * r];
      var both = field([[p[0], p[1], p[2], 1], [q[0], q[1], q[2], 1]], p), alone = field([[p[0], p[1], p[2], 1]], p);
      sf += (both[0] - alone[0]) * u[0] + (both[1] - alone[1]) * u[1] + (both[2] - alone[2]) * u[2];
      sp += both[3] - alone[3];
    }
    f[b] = sf / per * r * r; pt[b] = sp / per * r;
  }
  return { f: f, p: pt };
}
var PP_TAB = meshPairTable(64, PP_CUT);

var sim = null, posBuf = null, velBuf = null, gen = 0;
var report = null;

function build(opt) {
  var N = N_CHOICES[opt.nIdx];
  var W = N >= 131072 ? 512 : N >= 32768 ? 256 : 128, H = N / W;
  var q = opt.q, dens = opt.dens, coreF = opt.core;
  var RHO_R = 2.5;                                     // core over mantle density: Earth's
  var coreV = coreF / (RHO_R - coreF * (RHO_R - 1));   // the core's share of the volume
  var coreF2 = opt.coreImp === undefined ? coreF : opt.coreImp;
  var coreV2 = coreF2 / (RHO_R - coreF2 * (RHO_R - 1));
  // every body-particle has the same radius and sits on the same lattice;
  // density is mass. Earth's volume is the unit, the impactor's follows from
  // its density, and the lattice spacing from the volume each particle gets.
  var V1 = 1, V2 = q / dens;
  var vp = (V1 + V2) / N;
  var s = Math.cbrt(16 * Math.PI * vp / 3);            // the FCC cell edge that gives that volume: the unit of spacing
  var a = JAM * s / (2 * Math.SQRT2);                  // body-particle radius: see JAM
  var n1 = Math.round(N * V1 / (V1 + V2)), n2 = N - n1;
  if (opt.n2 > 0) { n2 = opt.n2; n1 = N - n2; }
  else if (n2 < 16) { n2 = 16; n1 = N - n2; }
  var R1 = Math.cbrt(V1), R2 = Math.cbrt(V2), Rsum = R1 + R2;
  // spin: a fraction of breakup, √(M/R³) — 1 for Earth, √ρ for the impactor —
  // about the orbital axis, prograde when positive; each body is cut as the
  // Maclaurin spheroid for its rate, so it arrives already in equilibrium
  var w0 = [0, opt.spin0, 0], w1 = [0, opt.spin1 * Math.sqrt(dens), 0];
  var e1 = maclaurin(Math.abs(opt.spin0)), e2 = maclaurin(Math.abs(opt.spin1));
  var Re1 = R1 / Math.pow(1 - e1 * e1, 1 / 6), Re2 = R2 / Math.pow(1 - e2 * e2, 1 / 6);   // equatorial radii

  // layers by shell — the onion comes out sorted inside-out: the innermost
  // shells nearest coreV of the volume are core, the outer shell crust, the
  // rest mantle. Mass is relative to an Earth-mantle particle: core ×2.5,
  // the impactor's ×its density.
  var rng = mulberry(1234567);
  var b1 = ball(n1, s, a, rng, e1), b2 = ball(n2, s, a, rng, e2);
  var pos = new Float32Array(N * 4), vel = new Float32Array(N * 4);
  var matR = new Float32Array(N), lay = new Uint8Array(N);
  function layers(off, n, bounds, densB, cv) {
    var nCore = bounds.reduce(function (best, c) { return Math.abs(c - cv * n) < Math.abs(best - cv * n) ? c : best; }, 0);
    var nCrust = n - bounds[bounds.length - 2];
    var sum = 0;
    for (var j = 0; j < n; j++) {
      var layer = j < nCore ? 0 : j >= n - nCrust ? 2 : 1;
      lay[off + j] = layer;
      matR[off + j] = densB * (layer === 0 ? RHO_R : 1);
      sum += matR[off + j];
    }
    return sum;
  }
  var sum1 = layers(0, n1, b1.bounds, 1, coreV), sum2 = layers(n1, n2, b2.bounds, dens, coreV2);
  var mref = 1 / sum1;                                 // an Earth-mantle particle: Earth weighs 1
  if (opt.mImp > 0) {                                  // the rock at its true mass, however it is drawn
    var k2 = opt.mImp / (mref * sum2);
    for (var jj = n1; jj < N; jj++) matR[jj] *= k2;
    sum2 *= k2;
  }
  var M1 = 1, M2 = mref * sum2, M = M1 + M2;

  // the encounter: speed and angle are stated at contact, then walked back to
  // the start line with energy and angular momentum; from there the two-body
  // problem is integrated exactly while the bodies fly in rigid
  var vesc = Math.sqrt(2 * M / Rsum);
  var vc = opt.vfac * vesc;
  var bc = Rsum * Math.sin(opt.angle * Math.PI / 180);
  var D = Rsum + 3.7;   // the start line, 3.7 R⊕ short of contact: a few seconds of approach at 1×, to take the scene in
  var vD = Math.sqrt(Math.max(vc * vc - 2 * M * (1 / Rsum - 1 / D), 0.04));
  var bD = Math.min(bc * vc / vD, D * 0.95);
  var xD = -Math.sqrt(D * D - bD * bD);
  // the impactor comes in from above the orbital plane by incl: the impact
  // parameter stands out of the plane the bodies spin in, so the
  // encounter's angular momentum is tilted from the spins' and the merged
  // planet's axis leans with it — the obliquity a giant impact leaves
  var inc = (opt.incl || 0) * Math.PI / 180, bY = bD * Math.sin(inc), bZ = bD * Math.cos(inc);
  var c1 = [-xD * M2 / M, -bY * M2 / M, -bZ * M2 / M];   // barycentre at the origin
  var c2 = [xD + c1[0], bY + c1[1], bZ + c1[2]];
  var rel = { r: [xD, bY, bZ], v: [vD, 0, 0] };          // impactor relative to target
  var bulk0 = [0, 0, 0], bulk1 = [0, 0, 0];
  var i, o;
  for (i = 0; i < n1; i++) { o = i * 4; pos[o] = b1[i * 3] + c1[0]; pos[o + 1] = b1[i * 3 + 1] + c1[1]; pos[o + 2] = b1[i * 3 + 2] + c1[2]; pos[o + 3] = lay[i]; }
  for (i = 0; i < n2; i++) { o = (n1 + i) * 4; pos[o] = b2[i * 3] + c2[0]; pos[o + 1] = b2[i * 3 + 1] + c2[1]; pos[o + 2] = b2[i * 3 + 2] + c2[2]; pos[o + 3] = lay[n1 + i] + 4; }
  // and where each grain sat in its body when the body was built, in the
  // body's own frame — the picture draws its surface in these coordinates,
  // so the surface rides the material: it turns with the body, stretches
  // with the arm and goes with the ejecta. The impactor's are offset so the
  // two bodies do not wear the same pattern. Nothing in the physics reads it.
  var home = new Float32Array(N * 4), hrng = mulberry(99);
  for (i = 0; i < n1; i++) { o = i * 4; home[o] = b1[i * 3]; home[o + 1] = b1[i * 3 + 1]; home[o + 2] = b1[i * 3 + 2]; home[o + 3] = hrng(); }
  for (i = 0; i < n2; i++) { o = (n1 + i) * 4; home[o] = b2[i * 3] + 1.5; home[o + 1] = b2[i * 3 + 1] + 0.7; home[o + 2] = b2[i * 3 + 2] - 1.1; home[o + 3] = hrng(); }

  // contact spring: half a radius of overlap at the reference speed for an
  // Earth-mantle particle; the step from the lightest particle's period
  var vref = Math.max(1.5, vc);
  var k = 4 * mref * vref * vref / (a * a);
  var dt = 0.35 / Math.sqrt(2 * k / (mref * Math.min(1, dens)));   // the spring-dashpot is stable to ~1.4/ω
  var lnE = Math.log(opt.rest), zeta = -lnE / Math.sqrt(Math.PI * Math.PI + lnE * lnE);
  var cd = 2 * zeta * Math.sqrt(k * mref / 2);

  if (sim) { freeTarget(sim.src); freeTarget(sim.dst); gl.deleteTexture(sim.mat); gl.deleteTexture(sim.home); gl.deleteTexture(sim.diag); gl.deleteFramebuffer(sim.diagFbo); gl.deleteTexture(sim.perm); }
  var G = N >= 65536 ? 128 : 64;
  if (!grid || grid.G !== G) { freeGrid(grid); grid = makeGrid(G); }
  var settle = Math.ceil(0.6 / dt);
  sim = {
    N: N, W: W, H: H, n1: n1, n2: n2, m: mref, a: a, cell: 2.6 * a, dt: dt, k: k, c: cd,
    creep: 0.12, R1: R1, R2: R2, Re1: Re1, Re2: Re2, M1: M1, M2: M2, M: M, rel: rel, bulk0: bulk0, bulk1: bulk1, vc: vc, vesc: vesc,
    spin0: w0, spin1: w1, cen0: c1, cen1: c2,
    src: simTarget(W, H, pos, vel), dst: simTarget(W, H, null, null),
    mat: floatTex(W, H, matR, gl.R32F, gl.FLOAT, gl.RED), matR: matR,
    home: floatTex(W, H, home), homeArr: home,
    diag: floatTex(W, H, null), ref: null,
    t: -approachTime(rel, M, Re1 + Re2 + 2 * a), phase: 'settle', settleLeft: settle, settleTotal: settle, impactT: -1, com1: [0, 0, 0], stepNo: 0,
    damp: Math.exp(-dt * 12), soft: false, gen: ++gen,
    // the gravity mesh's boxes: where each stands, at what speed, as of when
    // — on the barycentre until the first look; placeBoxes() moves them
    boxes: [{ on: true, cen: [0, 0, 0], vel: [0, 0, 0], t: 0 }, { on: false, cen: [0, 0, 0], vel: [0, 0, 0], t: 0 }],
    // the temperature a mantle particle's heat makes: each side of a contact
    // books the pair's whole dissipation, so half of it is that side's
    tK: 0.5 * E_KG / CP_ROCK / mref,
    // touching particles share heat at this rate per neighbour — not
    // conduction, which would do nothing in hours across 200 km of rock, but
    // the mixing the impact does below the particle size: it evens out what
    // one contact happened to book against the next within minutes and
    // leaves the hemispheres to differ for the run
    kappa: 0.3
  };
  sim.diagFbo = fboFor(sim.diag);
  if (!pbo) pbo = [gl.createBuffer(), gl.createBuffer()];
  for (var b = 0; b < 2; b++) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[b]); gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 16 * 3, gl.STREAM_READ); }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  if (pending) { gl.deleteSync(pending.sync); pending = null; }
  if (sim.perm) gl.deleteTexture(sim.perm);
  sim.perm = floatTex(W, H, null, gl.R32F, gl.FLOAT, gl.RED);
  if (pp.slot) gl.deleteTexture(pp.slot);
  pp.slotArr = new Float32Array(N).fill(-1);
  pp.slot = floatTex(W, H, pp.slotArr, gl.R32F, gl.FLOAT, gl.RED);
  pp.count = 0; pp.loose = 0;
  CC.setSim(sim);            // the modules keep their own handle on the run
  setStaticUniforms();
  report = null; CC.setReport(null);
  return sim;
}


// Uniforms that hold for the whole run are set once here; the passes below
// only bind targets and textures and touch what changes.
function setStaticUniforms() {
  var g = grid, u;
  u = slotProg.u; gl.useProgram(slotProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uPrev, 1);
  gl.uniform2i(u.uSize, sim.W, sim.H);
  gl.uniform1f(u.uInvCell, 1 / sim.cell);
  gl.uniform1i(u.uGMask, g.G - 1); gl.uniform1i(u.uGShift, g.GShift);
  gl.uniform1i(u.uSXMask, g.SX - 1); gl.uniform1i(u.uSXShift, g.SXShift);
  gl.uniform2f(u.uAtlas, g.AW, g.AH);
  gl.uniform1f(u.uInvN, 1 / sim.N);

  u = depProg.u; gl.useProgram(depProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uMat, 1); gl.uniform1i(u.uMono, 2);
  gl.uniform2i(u.uSize, sim.W, sim.H);
  gl.uniform1f(u.uInvH, 1 / FH);
  gl.uniform1f(u.uEps2, FH * FH);

  gl.useProgram(coarseProg.p); gl.uniform1i(coarseProg.u.uFine, 0);
  gl.useProgram(monoProg.p); gl.uniform1i(monoProg.u.uCoarse, 0);
  gl.useProgram(farProg.p); gl.uniform1i(farProg.u.uCoarse, 0);

  u = cellProg.u; gl.useProgram(cellProg.p);
  gl.uniform1i(u.uFine, 0); gl.uniform1i(u.uCoarse, 1); gl.uniform1i(u.uFarA, 2); gl.uniform1i(u.uFarT0, 3); gl.uniform1i(u.uFarT1, 4);
  gl.uniform1f(u.uH, FH);
  gl.uniform1f(u.uEps2, 0.5 * FH * FH);
  gl.uniform1f(u.uGm, sim.m);

  u = simProg.u; gl.useProgram(simProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uVel, 1); gl.uniform1i(u.uForce, 2); gl.uniform1i(u.uMono, 3); gl.uniform1i(u.uForceB, 6); gl.uniform1i(u.uMonoB, 7); gl.uniform1i(u.uMat, 12); gl.uniform1i(u.uQ, 13);
  gl.uniform1i(u.uPPSlot, 14); gl.uniform1i(u.uPPForce, 15);
  gl.uniform1i(u.uSA, 4); gl.uniform1i(u.uSB, 5);
  gl.uniform2i(u.uSize, sim.W, sim.H);
  gl.uniform1f(u.uInvCell, 1 / sim.cell);
  gl.uniform1f(u.uCell, sim.cell);
  gl.uniform1i(u.uGMask, g.G - 1); gl.uniform1i(u.uGShift, g.GShift);
  gl.uniform1i(u.uSXMask, g.SX - 1); gl.uniform1i(u.uSXShift, g.SXShift);
  gl.uniform1f(u.uInvH, 1 / FH);
  gl.uniform1f(u.uDt, sim.dt);
  gl.uniform1f(u.uGm, sim.m);
  gl.uniform1f(u.uEps2, FH * FH);
  gl.uniform1f(u.uTouch, 2 * sim.a);
  gl.uniform1f(u.uLink2, sim.cell * sim.cell);
  gl.uniform1f(u.uReach2, Math.pow(sim.cell + SEAT_SLACK * sim.a, 2));
  gl.uniform1f(u.uK, sim.k);
  gl.uniform1f(u.uC, sim.c);
  gl.uniform1f(u.uInvM, 1 / sim.m);
  gl.uniform1f(u.uDamp, sim.damp);
  gl.uniform1f(u.uCreep, sim.creep);
  gl.uniform1f(u.uTk, sim.tK);
  gl.uniform1f(u.uKappa, sim.kappa);
  gl.uniform1f(u.uCpIron, CP_IRON / CP_ROCK);
  gl.uniform3fv(u.uSpin0, sim.spin0); gl.uniform3fv(u.uSpin1, sim.spin1);

  u = rigidProg.u; gl.useProgram(rigidProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uVel, 1); gl.uniform1i(u.uAux, 2); gl.uniform1i(u.uQ, 3);
  gl.uniform3fv(u.uSpin0, sim.spin0); gl.uniform3fv(u.uSpin1, sim.spin1);

  u = diagProg.u; gl.useProgram(diagProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uQ, 1); gl.uniform1i(u.uForce, 2); gl.uniform1i(u.uMono, 3); gl.uniform1i(u.uForceB, 6); gl.uniform1i(u.uMonoB, 7);
  gl.uniform1i(u.uPPSlot, 12); gl.uniform1i(u.uPPForce, 13);
  gl.uniform1i(u.uSA, 4); gl.uniform1i(u.uSB, 5);
  gl.uniform2i(u.uSize, sim.W, sim.H);
  gl.uniform1f(u.uInvCell, 1 / sim.cell);
  gl.uniform1i(u.uGMask, g.G - 1); gl.uniform1i(u.uGShift, g.GShift);
  gl.uniform1i(u.uSXMask, g.SX - 1); gl.uniform1i(u.uSXShift, g.SXShift);
  gl.uniform1f(u.uInvH, 1 / FH);
  gl.uniform1f(u.uEps2, FH * FH);
  gl.uniform1f(u.uGm, sim.m);

  u = ppGatherProg.u; gl.useProgram(ppGatherProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uMat, 1); gl.uniform1i(u.uIndex, 2);
  gl.uniform2i(u.uSize, sim.W, sim.H);
  gl.uniform1f(u.uInvH, 1 / FH);
  u = permProg.u; gl.useProgram(permProg.p);
  gl.uniform1i(u.uPos, 0); gl.uniform1i(u.uVel, 1); gl.uniform1i(u.uAux, 2); gl.uniform1i(u.uQ, 3); gl.uniform1i(u.uPerm, 4);
  gl.uniform2i(u.uSize, sim.W, sim.H);
  u = ppForceProg.u; gl.useProgram(ppForceProg.p);
  gl.uniform1i(u.uList, 0); gl.uniform1i(u.uTab, 1); gl.uniform1i(u.uBoxOf, 2);
  gl.uniform1f(u.uGm, sim.m);
  gl.uniform1f(u.uCut, PP_CUT);
  gl.uniform1f(u.uA2, sim.a * sim.a);
}

// Where the boxes stand this mesh step. The first is on the largest body's
// own centre, the second on the second body's while it is up — each where
// the last look put it, carried on at its speed since. A box's uniform is
// its half-width less its centre, so that p + uL is the place in it.
function boxes() {
  var b = sim.boxes, L = [], i, k;
  for (i = 0; i < 2; i++) { var dt = sim.t - b[i].t; for (k = 0; k < 3; k++) L.push(FL - b[i].cen[k] - b[i].vel[k] * dt); }
  var progs = [depProg, simProg, diagProg, ppGatherProg];
  for (i = 0; i < progs.length; i++) {
    var u = progs[i].u; gl.useProgram(progs[i].p);
    gl.uniform3f(u.uLA, L[0], L[1], L[2]); gl.uniform3f(u.uLB, L[3], L[4], L[5]); gl.uniform1f(u.uBoxB, b[1].on ? 1 : 0);
  }
}
// The boxes from a look. The second goes up when a second body of a
// twentieth of an Earth or more — enough for the mesh to hold on its own —
// stands so far off that it is about to leave the first box: its centre
// past the edge less 1.3 of its radii, its far side and the debris round
// it at the edge. Not sooner: while both are in the one box the mesh has
// their tides on each other cell by cell, and the far field the two boxes
// trade is only the first order of that. It comes down once the body is
// back within by half a radius more, or when there is no such body. Its
// mono texel is primed with the body, so its first deposit's scratch is
// not read off nothing.
function placeBoxes(r) {
  var b = sim.boxes, sec = r.second, B = b[1];
  b[0] = { on: true, cen: r.core, vel: r.bodyVel, t: r.t };
  if (sec && sec.mass > 0.05) {
    var d = Math.max(Math.abs(sec.core[0] - r.core[0]), Math.abs(sec.core[1] - r.core[1]), Math.abs(sec.core[2] - r.core[2])), far = FL - 1.3 * Math.cbrt(sec.mass);
    if (!B.on && d > far) {
      B.on = true;
      var w = sec.mass / sim.m, c = sec.core;
      gl.bindTexture(gl.TEXTURE_2D, pm[1].mono);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([c[0] * w, c[1] * w, c[2] * w, w]));
    } else if (B.on && d < far - 0.5) B.on = false;
    B.cen = sec.core; B.vel = sec.vel; B.t = r.t;
  } else B.on = false;
}

// 1. contact cells, one seat per pass: seat k is a channel of one of the
//    two textures, written under a colour mask, and read the seat before it
//    from the other; both are emptied once, the depth before every pass
function passSlots() {
  var g = grid, k;
  gl.useProgram(slotProg.p);
  gl.viewport(0, 0, g.AW, g.AH);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.clearColor(-1, -1, -1, -1);
  for (k = 0; k < 2; k++) { gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo[k]); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.activeTexture(gl.TEXTURE1);
  for (k = 0; k < SLOTS; k++) {
    var ch = k >> 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo[k & 1]);
    gl.colorMask(ch === 0, ch === 1, ch === 2, ch === 3);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, g.slot[(k - 1) & 1]);   // the seat before; for the first pass the other texture, unread, so the sampler has its kind of texture
    gl.uniform1i(slotProg.u.uK, k);
    gl.drawArrays(gl.POINTS, 0, sim.N);
  }
  gl.colorMask(true, true, true, true);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
}

// 2. mass onto the mesh — box b's own, and the strays' pull
function passDeposit(b) {
  var m = pm[b || 0];
  gl.useProgram(depProg.p);
  gl.uniform1i(depProg.u.uBox, b || 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, m.fineFbo);
  gl.viewport(0, 0, 512, 513);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.mat);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, m.mono);
  gl.drawArrays(gl.POINTS, 0, sim.N * 8);
  gl.disable(gl.BLEND);
}

// 3. the coarse mesh, 4. its total
function passCoarse(b) {
  var m = pm[b || 0];
  gl.useProgram(coarseProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, m.coarseFbo);
  gl.viewport(0, 0, 64, 64);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.fine);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(monoProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, m.monoFbo);
  gl.viewport(0, 0, 1, 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.coarse);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// 5. the far field of every block, 6. gravity at every occupied cell
function passCell(b) {
  var m = pm[b || 0];
  gl.useProgram(farProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, m.farFbo);
  gl.viewport(0, 0, 64, 64);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.coarse);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(cellProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, m.forceFbo);
  gl.viewport(0, 0, 512, 513);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.fine);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m.coarse);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, m.farA);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, m.farT0);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, m.farT1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
// the mesh, box by box: the first always, the second while it is up
function passMesh() {
  passDeposit(0); passCoarse(0); passCell(0);
  if (sim.boxes[1].on) { passDeposit(1); passCoarse(1); passCell(1); }
}

// 6. the particles: read src, write dst, swap
function passSim(settle, kick, gdt) {
  var g = grid, u = simProg.u;
  gl.useProgram(simProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.dst.fbo);
  gl.viewport(0, 0, sim.W, sim.H);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.src.vel);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pm[0].force);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, pm[0].mono);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, g.slot[0]);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, g.slot[1]);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, pm[1].force);
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, pm[1].mono);
  gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, sim.mat);
  gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, sim.src.q);
  gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, pp.slot);
  gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, pp.force);
  gl.uniform1f(u.uSettle, settle ? 1 : 0);
  gl.uniform1f(u.uKick, kick ? 1 : 0);
  gl.uniform1f(u.uGDt, gdt);
  gl.uniform3fv(u.uBulk0, sim.bulk0);
  gl.uniform3fv(u.uBulk1, sim.bulk1);
  gl.uniform3fv(u.uCen0, sim.cen0);
  gl.uniform3fv(u.uCen1, sim.cen1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  var t = sim.src; sim.src = sim.dst; sim.dst = t;
}

// the read-outs for the books, from cells and a mesh built for the positions
// as they are right now — so the seat check is exact and the potential current
function passDiag() {
  var g = grid;
  boxes();
  passSlots();
  passMesh(); passPP();
  gl.useProgram(diagProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.diagFbo);
  gl.viewport(0, 0, sim.W, sim.H);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.src.q);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pm[0].force);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, pm[0].mono);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, g.slot[0]);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, g.slot[1]);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, pm[1].force);
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, pm[1].mono);
  gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, pp.slot);
  gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, pp.force);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// 7. the loose material, pairwise: the list's positions gathered, then every
//    seat against the whole list, a slice of it per row of the force atlas
function passPP() {
  if (!pp.count) return;
  gl.useProgram(ppGatherProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, pp.listFbo);
  gl.viewport(0, 0, PP_W, PP_H);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.mat);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pp.index);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(ppForceProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, pp.forceFbo);
  gl.viewport(0, 0, PP_W, PP_H * PP_SLICES);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pp.list);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pp.tab);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pp.box);
  gl.uniform1i(ppForceProg.u.uCount, pp.count);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// One step. The contact cells are rebuilt every other step — a particle moves
// under 0.2 radii a step and the search radius has 0.6 to spare — and the
// gravity mesh every eighth: gravity changes on the scale of a time unit, a
// step is a thousandth of one. The mesh's pull is given all at once, on the
// step it is measured, as the impulse for the steps it stands for: used where
// it was measured it is time-symmetric, whereas held for four steps it lags —
// and a turning body feeling its own field a little behind it is braked by it
// like by a tide (0.4 % of the angular momentum in six time units).
var MESH_EVERY = 8;
// The spring was sized for the impact speed. An hour and a half past first
// touch the splash is over and relative speeds are a fraction of it, so the
// spring is let go to half its stiffness — the dashpot with it, so bounces
// stay the same — and the step, set by the spring's period, grows by √2. A
// body at rest overlaps 2 % of a radius instead of 1; a re-impact at a
// third of the impact speed overlaps what the impact did.
function soften() {
  sim.soft = true;
  sim.k *= 0.5; sim.c *= Math.SQRT1_2; sim.dt *= Math.SQRT2;
  sim.damp = Math.exp(-sim.dt * 12);
  setStaticUniforms();
}
function step(settle, kick) {
  if (!settle && !kick && !sim.soft && sim.t - sim.impactT > 1.5) soften();
  var n = sim.stepNo++;
  if (n % 2 === 0) passSlots();
  var mesh = n % MESH_EVERY === 0;
  if (mesh) { boxes(); passMesh(); passPP(); }
  passSim(settle, kick, mesh ? MESH_EVERY * sim.dt : 0);
}

// settling: n damped steps; when done, the approach begins
function settleSome(n) {
  n = Math.min(n, sim.settleLeft);
  for (var i = 0; i < n; i++) step(true, false);
  sim.settleLeft -= n;
  if (sim.settleLeft === 0) { sim.phase = 'approach'; analyzedAt = sim.stepNo; }   // the settle's steps are not the analysis's to count
}

// the approach: the two-body problem, leapfrog on the CPU, the bodies carried
// rigid on the GPU by the frame's mean velocities, each turned by its spin;
// at first touch, the kick
function centres(r) {
  var M = sim.M, M1 = sim.M1, M2 = sim.M2;
  return [[-r[0] * M2 / M, -r[1] * M2 / M, -r[2] * M2 / M], [r[0] * M1 / M, r[1] * M1 / M, r[2] * M1 / M]];
}
// how long the rigid flight takes from the start line to the equators
// touching: rigidStep's own leapfrog at its 1× step, run once at build, so
// the clock counts down to contact and reads zero when it happens
function approachTime(rel, M, touch) {
  var r = [rel.r[0], rel.r[1], rel.r[2]], v = [rel.v[0], rel.v[1], rel.v[2]], h = 0.01 / 8, t = 0;
  function acc() { var d2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], f = -M * Math.pow(d2, -1.5); return [r[0] * f, r[1] * f, r[2] * f]; }
  var a = acc();
  while (Math.hypot(r[0], r[1], r[2]) > touch && t < 200) {
    v[0] += a[0] * h * 0.5; v[1] += a[1] * h * 0.5; v[2] += a[2] * h * 0.5;
    r[0] += v[0] * h; r[1] += v[1] * h; r[2] += v[2] * h;
    a = acc();
    v[0] += a[0] * h * 0.5; v[1] += a[1] * h * 0.5; v[2] += a[2] * h * 0.5;
    t += h;
  }
  return t;
}
function rigidStep(dtF) {
  var r = sim.rel.r, v = sim.rel.v, M = sim.M, M1 = sim.M1, M2 = sim.M2;
  var r0 = [r[0], r[1], r[2]], n = 8, h = dtF / n, i, cen = centres(r0);
  function acc() { var d2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], f = -M * Math.pow(d2, -1.5); return [r[0] * f, r[1] * f, r[2] * f]; }
  var a = acc();
  for (i = 0; i < n; i++) {
    v[0] += a[0] * h * 0.5; v[1] += a[1] * h * 0.5; v[2] += a[2] * h * 0.5;
    r[0] += v[0] * h; r[1] += v[1] * h; r[2] += v[2] * h;
    a = acc();
    v[0] += a[0] * h * 0.5; v[1] += a[1] * h * 0.5; v[2] += a[2] * h * 0.5;
  }
  var mv = [(r[0] - r0[0]) / dtF, (r[1] - r0[1]) / dtF, (r[2] - r0[2]) / dtF];
  sim.bulk0 = [-mv[0] * M2 / M, -mv[1] * M2 / M, -mv[2] * M2 / M];
  sim.bulk1 = [mv[0] * M1 / M, mv[1] * M1 / M, mv[2] * M1 / M];
  var u = rigidProg.u;
  gl.useProgram(rigidProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.dst.fbo);
  gl.viewport(0, 0, sim.W, sim.H);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.src.vel);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sim.src.aux);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sim.src.q);
  gl.uniform3fv(u.uBulk0, sim.bulk0);
  gl.uniform3fv(u.uBulk1, sim.bulk1);
  gl.uniform3fv(u.uCen0, cen[0]);
  gl.uniform3fv(u.uCen1, cen[1]);
  gl.uniformMatrix3fv(u.uRot0, false, turn(sim.spin0, dtF));
  gl.uniformMatrix3fv(u.uRot1, false, turn(sim.spin1, dtF));
  gl.uniform1f(u.uDt, dtF);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  var t = sim.src; sim.src = sim.dst; sim.dst = t;
  sim.t += dtF;
  if (Math.hypot(r[0], r[1], r[2]) <= sim.Re1 + sim.Re2 + 2 * sim.a) {   // the equators touch
    sim.bulk0 = [-v[0] * M2 / M, -v[1] * M2 / M, -v[2] * M2 / M];
    sim.bulk1 = [v[0] * M1 / M, v[1] * M1 / M, v[2] * M1 / M];
    cen = centres(r); sim.cen0 = cen[0]; sim.cen1 = cen[1];
    sim.boxes[0] = { on: true, cen: cen[0], vel: sim.bulk0, t: sim.t };   // the first box on the target, where the approach has carried it —
    sim.boxes[1].on = false;                                               // and the second down: the bodies touch, and one box has the contact
    sim.stepNo = 0;           // the bodies have moved: rebuild cells and mesh
    step(false, true);
    sim.t += sim.dt;
    sim.phase = 'full';
    sim.impactT = sim.t;
  }
}

// ---------- who is where: clumps, orbits, escapes ----------
// Friends-of-friends on the CPU every few frames: anything within 2.4 radii
// is the same body. The largest group is "the planet"; everything else is in
// orbit around it or on its way out, by its energy in the planet's frame.
// Self-contained so it can run in a worker: positions, velocities, masses and
// the read-outs in, the report out. Counting sort into hashed cells, then
// union-find. Layer and body ride in P.w: layer + 4·body, layer 0 being core.
// The books come along: mass, momentum, angular momentum, the energies.
function fof(N, mref, a, P, V, R, D, spring, touch, cap, sort) {
  var L = 2.4 * a, L2 = L * L, inv = 1 / L, touch2 = touch * touch, elastic = 0;
  var T = 1 << 20, TM = T - 1;
  var cx = new Int32Array(N), cy = new Int32Array(N), cz = new Int32Array(N), key = new Int32Array(N);
  var cnt = new Int32Array(T + 1), i, j, k, s;
  for (i = 0; i < N; i++) {
    var qx = Math.floor(P[i * 4] * inv), qy = Math.floor(P[i * 4 + 1] * inv), qz = Math.floor(P[i * 4 + 2] * inv);
    cx[i] = qx; cy[i] = qy; cz[i] = qz;
    k = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791)) & TM;
    key[i] = k; cnt[k + 1]++;
  }
  for (k = 0; k < T; k++) cnt[k + 1] += cnt[k];
  var fill = new Int32Array(cnt.subarray(0, T)), order = new Int32Array(N);
  for (i = 0; i < N; i++) order[fill[key[i]]++] = i;
  var uf = new Int32Array(N);
  for (i = 0; i < N; i++) uf[i] = i;
  function find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
  for (i = 0; i < N; i++) {
    var px = P[i * 4], py = P[i * 4 + 1], pz = P[i * 4 + 2];
    for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      k = (((cx[i] + dx) * 73856093) ^ ((cy[i] + dy) * 19349663) ^ ((cz[i] + dz) * 83492791)) & TM;
      for (s = cnt[k]; s < cnt[k + 1]; s++) {
        j = order[s];
        if (j <= i) continue;
        var ex = P[j * 4] - px, ey = P[j * 4 + 1] - py, ez = P[j * 4 + 2] - pz;
        var e2 = ex * ex + ey * ey + ez * ez;
        if (e2 < L2) {
          var ri = find(i), rj = find(j); if (ri !== rj) uf[ri] = rj;
          if (e2 < touch2) { var ov = touch - Math.sqrt(e2); elastic += 0.5 * spring * ov * ov; }   // the spring energy of a contact
        }
      }
    }
  }
  var size = new Int32Array(N);
  for (i = 0; i < N; i++) size[find(i)]++;
  var g1 = -1, g2 = -1;
  for (i = 0; i < N; i++) if (size[i] > 0) {
    if (g1 < 0 || size[i] > size[g1]) { g2 = g1; g1 = i; }
    else if (g2 < 0 || size[i] > size[g2]) g2 = i;
  }
  var members = new Int32Array(N);
  function stats(root) {
    // one pass for the sums: the mass, its centre and velocity, the
    // impactor's and the iron's share, the impactor's own centre — which,
    // with the totals, gives the target's — and the group's members, for
    // the passes after
    var n = 0, mass = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, imp = 0, iron = 0, ix = 0, iy = 0, iz = 0, t, s, m, w;
    for (t = 0; t < N; t++) if (find(t) === root) {
      m = mref * R[t]; w = P[t * 4 + 3];
      members[n++] = t; mass += m;
      x += m * P[t * 4]; y += m * P[t * 4 + 1]; z += m * P[t * 4 + 2];
      vx += m * V[t * 4]; vy += m * V[t * 4 + 1]; vz += m * V[t * 4 + 2];
      if (w >= 3.5) { imp += m; ix += m * P[t * 4]; iy += m * P[t * 4 + 1]; iz += m * P[t * 4 + 2]; }
      if (w - 4 * Math.floor(w / 4) < 0.5) iron += m;
    }
    var gx = x / mass, gy = y / mass, gz = z / mass, Rg = Math.cbrt(mass);
    var icx = imp > 0 ? ix / imp : 0, icy = imp > 0 ? iy / imp : 0, icz = imp > 0 ? iz / imp : 0;
    // the body's own centre, for the picture. The centre of mass is not
    // it: while two bodies are one group in contact it sits between them,
    // and with an arm or a curtain of ejecta attached it stands well off
    // the body and lurches as clumps are counted in and out. So the centre
    // is sought from the centre of the material the group is mostly made
    // of — the target's, or the impactor's for a surviving impactor —
    // which is the right lobe even in contact, and walked from there to
    // the centroid of what lies within nine-tenths of the radius, three
    // times over: the arm, the curtain and the other body's near cap do
    // not pull it, and a merged body's iron draws it to the middle
    var tm = mass - imp, core = imp > tm ? [icx, icy, icz] : [(x - ix) / tm, (y - iy) / tm, (z - iz) / tm];
    var rc2 = 0.9 * 0.9 * Rg * Rg, it, sm, sx0, sy0, sz0, qx, qy, qz;
    for (it = 0; it < 3; it++) {
      sm = 0; sx0 = 0; sy0 = 0; sz0 = 0;
      for (s = 0; s < n; s++) {
        t = members[s]; qx = P[t * 4] - core[0]; qy = P[t * 4 + 1] - core[1]; qz = P[t * 4 + 2] - core[2];
        if (qx * qx + qy * qy + qz * qz < rc2) { m = mref * R[t]; sm += m; sx0 += m * P[t * 4]; sy0 += m * P[t * 4 + 1]; sz0 += m * P[t * 4 + 2]; }
      }
      if (sm > 0) core = [sx0 / sm, sy0 / sm, sz0 / sm];
    }
    // about that centre, all at once: the surface temperature the body
    // shines with, and lights the others by — over the outer fifth of the
    // radius, weighted by T², the light being the hot patches' and not the
    // average's, with the vapour's tens of thousands of kelvin capped
    // where the glow saturates anyway; where the heat is, for the
    // picture's light — the glow-weighted centroid of the hot grains and
    // their spread, since in contact the glow is the contact's and the
    // light should come from it; how spread the impactor's material is —
    // a ball still, in the first hour, that shadows the planet's light;
    // and the mass in shells out to three radii, for where the body ends
    var shell = 0.64 * Rg * Rg, Ts = 0, ws = 0, irms = 0;
    var NBIN = 96, dr = 3 * Rg / NBIN, hist = new Float64Array(NBIN), hs = 0, hx = 0, hy = 0, hz = 0, hr2 = 0;
    for (s = 0; s < n; s++) {
      t = members[s]; m = mref * R[t];
      var sx = P[t * 4] - core[0], sy = P[t * 4 + 1] - core[1], sz = P[t * 4 + 2] - core[2], r2s = sx * sx + sy * sy + sz * sz;
      var Th = V[t * 4 + 3];
      if (r2s > shell) { var Tt = Math.min(Th, 12000), wt = Tt * Tt; Ts += wt * Tt; ws += wt; }
      if (Th > 1200) { var wh = Math.min(Th, 12000); wh *= wh; hs += wh; hx += wh * P[t * 4]; hy += wh * P[t * 4 + 1]; hz += wh * P[t * 4 + 2]; hr2 += wh * r2s; }
      if (P[t * 4 + 3] >= 3.5) { var ex = P[t * 4] - icx, ey = P[t * 4 + 1] - icy, ez = P[t * 4 + 2] - icz; irms += m * (ex * ex + ey * ey + ez * ez); }
      var bi = Math.sqrt(r2s) / dr; hist[bi < NBIN - 1 ? bi | 0 : NBIN - 1] += m;
    }
    var hotCom = hs > 0 ? [hx / hs, hy / hs, hz / hs] : core.slice(), hotR = Rg;
    if (hs > 0) { var ox = hotCom[0] - core[0], oy = hotCom[1] - core[1], oz = hotCom[2] - core[2]; hotR = Math.sqrt(Math.max(hr2 / hs - (ox * ox + oy * oy + oz * oz), 0)); }   // the spread about the hot centroid, from the spread about the centre
    // and where the body ends, for the picture: the density of each shell,
    // and the first past the mantle's own where it falls under a third of
    // the mantle's. The mass-radius says where a cold ball of this would
    // end; a body hot from the impact stands well above it, and a skin cut
    // at the mass-radius peeled it. The mantle's own shells, and where the
    // search starts, go by the radius of the body's own material: in
    // contact the group's radius is the two bodies' together, and a search
    // begun at 0.85 of that began past the body's edge
    var Redge = 0;
    if (n >= 2000) {
      var Rb = Math.cbrt(Math.max(imp, tm)), rho = new Float64Array(NBIN), refS = 0, refN = 0, bq, rm;
      for (bq = 0; bq < NBIN; bq++) { rm = (bq + 0.5) * dr; rho[bq] = hist[bq] / (rm * rm * dr); if (rm > 0.6 * Rb && rm < 0.85 * Rb) { refS += rho[bq]; refN++; } }
      Redge = Rg;
      for (bq = 0; bq < NBIN; bq++) if ((bq + 0.5) * dr > 0.85 * Rb && refN > 0 && rho[bq] < 0.35 * refS / refN) { Redge = bq * dr; break; }
    }
    return { n: n, mass: mass, com: [gx, gy, gz], core: core, vel: [vx / mass, vy / mass, vz / mass], imp: imp / mass, iron: iron / mass, R: Rg, Redge: Redge, Tsurf: ws > 0 ? Ts / ws : 0,
             hotCom: hotCom, hotR: hotR, impMass: imp, impCom: [icx, icy, icz], impRms: imp > 0 ? Math.sqrt(irms / imp) : 0 };
  }
  var A = stats(g1), B = g2 >= 0 ? stats(g2) : null;
  // the planet's spin: angular momentum about its centre over the moment of
  // inertia about that axis — the length of its day — taken over the body
  // proper, what lies within 1.15 of its own radius of its core, about the
  // mean motion of that. The arm's and the disk's share of the group's
  // momentum and inertia is not the planet's, and with it counted the day
  // read nine hours one look and five the next, and the axis leaned ten
  // degrees more, as the arm was counted in and out of the group
  var rb2 = Math.pow(1.15 * Math.cbrt(Math.max(A.impMass, A.mass - A.impMass)), 2), cx0 = A.core[0], cy0 = A.core[1], cz0 = A.core[2];
  var bm = 0, bvx = 0, bvy = 0, bvz = 0, m, dx0, dy0, dz0;
  for (i = 0; i < N; i++) if (find(i) === g1) {
    dx0 = P[i * 4] - cx0; dy0 = P[i * 4 + 1] - cy0; dz0 = P[i * 4 + 2] - cz0;
    if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > rb2) continue;
    m = mref * R[i]; bm += m; bvx += m * V[i * 4]; bvy += m * V[i * 4 + 1]; bvz += m * V[i * 4 + 2];
  }
  if (bm > 0) { bvx /= bm; bvy /= bm; bvz /= bm; }
  var Lx = 0, Ly = 0, Lz = 0, I = 0;
  for (i = 0; i < N; i++) if (find(i) === g1) {
    dx0 = P[i * 4] - cx0; dy0 = P[i * 4 + 1] - cy0; dz0 = P[i * 4 + 2] - cz0;
    if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > rb2) continue;
    m = mref * R[i];
    var ux = V[i * 4] - bvx, uy = V[i * 4 + 1] - bvy, uz = V[i * 4 + 2] - bvz;
    Lx += m * (dy0 * uz - dz0 * uy); Ly += m * (dz0 * ux - dx0 * uz); Lz += m * (dx0 * uy - dy0 * ux);
  }
  var Lm = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz), lx = Lx / (Lm + 1e-30), ly = Ly / (Lm + 1e-30), lz = Lz / (Lm + 1e-30);
  // and the tilt of that axis from the orbital one, y — the obliquity
  var tilt = Math.acos(Math.max(-1, Math.min(1, ly))) * 180 / Math.PI;
  for (i = 0; i < N; i++) if (find(i) === g1) {
    dx0 = P[i * 4] - cx0; dy0 = P[i * 4 + 1] - cy0; dz0 = P[i * 4 + 2] - cz0;
    if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > rb2) continue;
    m = mref * R[i];
    var along = dx0 * lx + dy0 * ly + dz0 * lz;
    I += m * (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 - along * along);
  }
  var day = Lm > 1e-9 ? 2 * Math.PI * I / Lm * 805 / 3600 : Infinity;
  function energy(x, y, z, vx, vy, vz) {
    var r = Math.sqrt((x - A.com[0]) * (x - A.com[0]) + (y - A.com[1]) * (y - A.com[1]) + (z - A.com[2]) * (z - A.com[2]));
    var dv2 = (vx - A.vel[0]) * (vx - A.vel[0]) + (vy - A.vel[1]) * (vy - A.vel[1]) + (vz - A.vel[2]) * (vz - A.vel[2]);
    return 0.5 * dv2 - A.mass / Math.max(r, A.R);
  }
  // what is bound in orbit is the disk; its mass and angular momentum about
  // the planet say what Moon it makes, by Ida, Canup & Stewart's fit to
  // disk-accretion runs: M/M_D ≈ 1.9 j − 1.1 − 1.9 M_esc/M_D, with
  // j = J_D / (M_D √(G M a_R)), a_R the Roche limit for lunar density,
  // 2.9 R⊕, and a twentieth of the disk lost on the way.
  var orbit = 0, esc = 0, Dx = 0, Dy = 0, Dz = 0;
  for (i = 0; i < N; i++) if (find(i) !== g1) {
    m = mref * R[i];
    if (energy(P[i * 4], P[i * 4 + 1], P[i * 4 + 2], V[i * 4], V[i * 4 + 1], V[i * 4 + 2]) < 0) {
      orbit += m;
      dx0 = P[i * 4] - A.com[0]; dy0 = P[i * 4 + 1] - A.com[1]; dz0 = P[i * 4 + 2] - A.com[2];
      var wx = V[i * 4] - A.vel[0], wy = V[i * 4 + 1] - A.vel[1], wz = V[i * 4 + 2] - A.vel[2];
      Dx += m * (dy0 * wz - dz0 * wy); Dy += m * (dz0 * wx - dx0 * wz); Dz += m * (dx0 * wy - dy0 * wx);
    } else esc += m;
  }
  var jD = orbit > 0 ? Math.sqrt(Dx * Dx + Dy * Dy + Dz * Dz) / (orbit * Math.sqrt(A.mass * 2.9)) : 0;
  // and never more of a moon than there is disk to make it from: the fit is
  // a straight line in j and passes the disk's own mass at j = 1.13, which a
  // disk holding a moonlet already gathered well outside the Roche limit
  // reaches — so the twentieth lost on the way is also the cap
  var moon = Math.min(Math.max(0, orbit * (1.9 * jD - 1.1 - 1.9 * 0.05)), 0.95 * orbit);
  var second = null;
  if (B && B.n >= Math.max(8, N / 1000)) {
    var dAB = Math.sqrt((B.com[0] - A.com[0]) * (B.com[0] - A.com[0]) + (B.com[1] - A.com[1]) * (B.com[1] - A.com[1]) + (B.com[2] - A.com[2]) * (B.com[2] - A.com[2]));
    if (dAB > A.R + B.R + 2 * a) second = { mass: B.mass, dist: dAB, bound: energy(B.com[0], B.com[1], B.com[2], B.vel[0], B.vel[1], B.vel[2]) < 0, imp: B.imp, iron: B.iron,
                                             com: B.com, core: B.core, vel: B.vel, R: B.R, Redge: B.Redge, Tsurf: B.Tsurf, hotCom: B.hotCom, hotR: B.hotR };
  }
  // the books. Angular momentum about the origin, where the barycentre was
  // put. Potential energy off the mesh: half of m·φ for a particle on it (the
  // pair is counted from both ends), all of it for one beyond the mesh, which
  // feels the mesh's monopole and is not felt back. The heat is the ledger
  // each particle keeps, halved the same way. And the contact cells: who has
  // no seat in his, whose is full.
  var Mt = 0, px = 0, py = 0, pz = 0, Jx = 0, Jy = 0, Jz = 0, ke = 0, pe = 0, Q = 0, unseated = 0, full = 0, ironAll = 0;
  for (i = 0; i < N; i++) {
    m = mref * R[i];
    var bx = P[i * 4], by = P[i * 4 + 1], bz = P[i * 4 + 2], bu = V[i * 4], bv = V[i * 4 + 1], bw = V[i * 4 + 2];
    Mt += m; px += m * bu; py += m * bv; pz += m * bw;
    if (P[i * 4 + 3] - 4 * Math.floor(P[i * 4 + 3] / 4) < 0.5) ironAll += m;   // core material, either body's: what the heat's capacity is read from
    Jx += m * (by * bw - bz * bv); Jy += m * (bz * bu - bx * bw); Jz += m * (bx * bv - by * bu);
    ke += 0.5 * m * (bu * bu + bv * bv + bw * bw);
    var flag = D[i * 4 + 1], off = flag >= 2;
    pe += (off ? 1 : 0.5) * m * D[i * 4];
    Q += 0.5 * D[i * 4 + 3];
    if (flag - (off ? 2 : 0) < 0.5) unseated++;
    if (D[i * 4 + 2] >= 7.5) full++;
  }
  // the loose material, for the pairwise pass: everything beyond 1.3 radii of
  // the largest body's centre — and of the second's, if that is a body the
  // mesh can hold on its own (0.05 M⊕, two cells across). More than the pass
  // can take, and it takes the farthest from the planet: what will stay out,
  // not what is falling back in. The readout says how many were left.
  function far2(body, i) {
    var ex = P[i * 4] - body.com[0], ey = P[i * 4 + 1] - body.com[1], ez = P[i * 4 + 2] - body.com[2];
    return ex * ex + ey * ey + ez * ez;
  }
  function loose(i) { return far2(A, i) > 1.69 * A.R * A.R && !(bigB && far2(B, i) <= 1.69 * B.R * B.R); }
  var bigB = B && B.mass > 0.05, nLoose = 0, wr = 0, least = 0;
  for (i = 0; i < N; i++) if (loose(i)) nLoose++;
  if (nLoose > cap) {
    var ds = new Float64Array(nLoose), q = 0;
    for (i = 0; i < N; i++) if (loose(i)) ds[q++] = far2(A, i);
    ds.sort();
    least = ds[nLoose - cap];
  }
  var list = new Float32Array(Math.min(nLoose, cap));
  for (i = 0; i < N && wr < list.length; i++) if (loose(i) && far2(A, i) >= least) list[wr++] = i;
  // the spatial order, when asked: a Morton key of 7 bits an axis over the
  // largest body's box, a counting sort on it; perm says which particle goes where,
  // and the loose list is spoken in the new names
  var perm = null;
  if (sort) {
    var KB = 1 << 21, keys = new Int32Array(N), bins = new Int32Array(KB + 1), into = new Int32Array(N);
    perm = new Float32Array(N);
    for (i = 0; i < N; i++) {
      var mx = Math.min(127, Math.max(0, Math.floor((P[i * 4] - A.core[0] + 6) / 12 * 128))), my = Math.min(127, Math.max(0, Math.floor((P[i * 4 + 1] - A.core[1] + 6) / 12 * 128))), mz = Math.min(127, Math.max(0, Math.floor((P[i * 4 + 2] - A.core[2] + 6) / 12 * 128)));
      var mk = 0;
      for (k = 0; k < 7; k++) mk |= ((mx >> k) & 1) << (3 * k) | ((my >> k) & 1) << (3 * k + 1) | ((mz >> k) & 1) << (3 * k + 2);
      keys[i] = mk; bins[mk + 1]++;
    }
    for (k = 0; k < KB; k++) bins[k + 1] += bins[k];
    for (i = 0; i < N; i++) { var dst = bins[keys[i]]++; perm[dst] = i; into[i] = dst; }
    for (i = 0; i < list.length; i++) list[i] = into[list[i]];
  }
  return { largest: A.mass, largestImp: A.imp, largestIron: A.iron, day: day, tilt: tilt, axis: [lx, ly, lz], bodyVel: [bvx, bvy, bvz], orbit: orbit, escape: esc, second: second, com: A.com, core: A.core, vel: A.vel, R: A.R, Redge: A.Redge, Tsurf: A.Tsurf, hotCom: A.hotCom, hotR: A.hotR,
           impMass: A.impMass, impCom: A.impCom, impRms: A.impRms,
           M: Mt, iron: ironAll / Mt, drift: Math.sqrt(px * px + py * py + pz * pz) / Mt, L: Math.sqrt(Jx * Jx + Jy * Jy + Jz * Jz),
           KE: ke, PE: pe, EL: elastic, Q: Q, unseated: unseated / N, full: full / N,
           pp: { list: list, loose: nLoose }, jD: jD, moon: moon, perm: perm };
}

// the analysis runs in a worker when it can (a quarter million bodies take
// tens of milliseconds); the buffers go back and forth without copying
var worker = null, analyzing = false, diagBuf = null, analyzedAt = 0, analyses = 0;
// the read-back for the worker goes through pixel-pack buffers and a fence, so
// the frame never waits on the GPU for it: the copy is asked for, and the
// buffers are read a frame or two later, when the fence says the GPU is done
var pbo = null, pboSet = 0, pending = null, asyncRead = true;   // two, used in turn, each holding all three images: one is never written while its last copy is still to be read
try {
  var src = fof.toString() + '\nself.onmessage = function (e) { var d = e.data; var r = fof(d.N, d.m, d.a, d.P, d.V, d.R, d.D, d.k, d.touch, d.cap, d.sort); var tr = [d.P.buffer, d.V.buffer, d.D.buffer, r.pp.list.buffer]; if (r.perm) tr.push(r.perm.buffer); self.postMessage({ gen: d.gen, r: r, P: d.P, V: d.V, D: d.D, t: d.t }, tr); };';
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = function (e) {
    analyzing = false;
    posBuf = e.data.P; velBuf = e.data.V; diagBuf = e.data.D;
    if (sim && e.data.gen === sim.gen) { e.data.r.t = e.data.t; applyReport(e.data.r); }
  };
  worker.onerror = function () { worker = null; analyzing = false; };
} catch (e) { worker = null; }
function applyReport(r) {
  report = r; sim.com1 = r.com;
  placeBoxes(r);
  CC.setReport(r);
  // the books at the first look at a body that is under way — settled, and
  // carried by the approach. On the frame the settle ends the bodies are
  // still at rest, and a reference taken there would be missing the whole
  // orbit: the angular momentum would read a hundred and eighty per cent up
  // ever after
  var going = sim.phase === 'full' || sim.bulk0[0] !== 0 || sim.bulk0[1] !== 0 || sim.bulk0[2] !== 0;
  // and the scale the energy balance is read against: the kinetic and the
  // potential together, not the total — a shatter at 2.6 escape speeds has
  // a total of nothing, and read against it a hundredth was a hundred per cent
  if (!sim.ref && going) sim.ref = { E: r.KE + r.PE + r.EL, EQ: r.KE + r.PE + r.EL + r.Q, L: r.L, scale: r.KE - r.PE };
  if (r.perm) applyPerm(r.perm);
  setPP(r.pp);
}
// the particles rewritten in the order handed back: the four state textures
// by the permute pass, the masses on the CPU and back up, then fresh contact
// cells — the old ones name particles by their old places
function applyPerm(perm) {
  var N = sim.N, i, R = new Float32Array(N), old = sim.matR;
  for (i = 0; i < N; i++) R[i] = old[perm[i]];
  sim.matR = R;
  gl.bindTexture(gl.TEXTURE_2D, sim.mat); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.W, sim.H, gl.RED, gl.FLOAT, R);
  var Hm = new Float32Array(N * 4), oldH = sim.homeArr;
  for (i = 0; i < N; i++) { var s4 = perm[i] * 4, d4 = i * 4; Hm[d4] = oldH[s4]; Hm[d4 + 1] = oldH[s4 + 1]; Hm[d4 + 2] = oldH[s4 + 2]; Hm[d4 + 3] = oldH[s4 + 3]; }
  sim.homeArr = Hm;
  gl.bindTexture(gl.TEXTURE_2D, sim.home); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, Hm);
  gl.bindTexture(gl.TEXTURE_2D, sim.perm); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.W, sim.H, gl.RED, gl.FLOAT, perm);
  gl.useProgram(permProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.dst.fbo);
  gl.viewport(0, 0, sim.W, sim.H);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.src.vel);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sim.src.aux);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sim.src.q);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, sim.perm);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  var t = sim.src; sim.src = sim.dst; sim.dst = t;
  passSlots();
}
// the loose list onto the GPU — a seat per particle, the particle per seat —
// and the correction for it right away, so no seat waits on the next mesh step
function setPP(p) {
  var arr = pp.slotArr, list = p.list, n = list.length, k;
  arr.fill(-1);
  for (k = 0; k < n; k++) arr[list[k]] = k;
  pp.indexArr.fill(-1); pp.indexArr.set(list);
  gl.bindTexture(gl.TEXTURE_2D, pp.slot); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.W, sim.H, gl.RED, gl.FLOAT, arr);
  gl.bindTexture(gl.TEXTURE_2D, pp.index); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PP_W, PP_H, gl.RED, gl.FLOAT, pp.indexArr);
  pp.count = n; pp.loose = p.loose;
  if (n) passPP();
}
function analyze(sync) {
  if (analyzing && !sync) return;
  if (sync) sim.gen = ++gen;   // whatever the worker is still computing is for the state before this call: drop it
  analyzedAt = sim.stepNo;
  var sort = sim.phase === 'full' && analyses++ % 8 === 0;   // every eighth look, the particles are put in spatial order
  var N = sim.N;
  var P = (!sync && posBuf && posBuf.length === N * 4) ? posBuf : new Float32Array(N * 4);
  var V = (!sync && velBuf && velBuf.length === N * 4) ? velBuf : new Float32Array(N * 4);
  var D = (!sync && diagBuf && diagBuf.length === N * 4) ? diagBuf : new Float32Array(N * 4);
  passDiag();
  if (worker && !sync && asyncRead) {
    // into a pack buffer, all three images, no waiting; the frame loop collects it
    var s0 = pboSet; pboSet ^= 1;
    var bytes = sim.W * sim.H * 16;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[s0]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sim.src.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, bytes);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, 2 * bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    pending = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), gen: sim.gen, sort: sort, P: P, V: V, D: D, set: s0, t: sim.t };
    gl.flush();
    analyzing = true;
    posBuf = null; velBuf = null; diagBuf = null;
    return;
  }
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, D);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.src.fbo);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, P);
  gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, sim.W, sim.H, gl.RGBA, gl.FLOAT, V);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (worker && !sync) {
    analyzing = true;
    posBuf = null; velBuf = null; diagBuf = null;
    var R = sim.matR.slice();
    worker.postMessage({ gen: sim.gen, N: N, m: sim.m, a: sim.a, P: P, V: V, R: R, D: D, k: sim.k, touch: 2 * sim.a, cap: PP_CAP, sort: sort, t: sim.t }, [P.buffer, V.buffer, R.buffer, D.buffer]);
    return;
  }
  var r = fof(N, sim.m, sim.a, P, V, sim.matR, D, sim.k, 2 * sim.a, PP_CAP, sort);
  r.t = sim.t;
  applyReport(r);
}
// the pack buffers, once the fence has signalled: read, and off to the worker
function collect() {
  var st = gl.clientWaitSync(pending.sync, 0, 0);
  if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return;
  gl.deleteSync(pending.sync);
  var p = pending; pending = null;
  if (!sim || p.gen !== sim.gen) { analyzing = false; return; }
  var bytes = sim.W * sim.H * 16;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[p.set]);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, p.D);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, bytes, p.P);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 2 * bytes, p.V);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  var R = sim.matR.slice();
  worker.postMessage({ gen: sim.gen, N: sim.N, m: sim.m, a: sim.a, P: p.P, V: p.V, R: R, D: p.D, k: sim.k, touch: 2 * sim.a, cap: PP_CAP, sort: p.sort, t: p.t }, [p.P.buffer, p.V.buffer, R.buffer, p.D.buffer]);
}




// The context arrives once, from the page's boot; the programs are compiled
// here, since every page that runs this engine runs the same ones.
function init(o) {
  gl = o.gl; floatBlend = o.floatBlend;
  var G = CC.gl, SH = CC.glsl, program = G.program;
  floatTex = G.floatTex; simTarget = G.simTarget; freeTarget = G.freeTarget; fboFor = G.fboFor; makeGrid = G.makeGrid; freeGrid = G.freeGrid;
  simProg = program(SH.QUAD_VS, SH.simFS({ gravity: 'mesh' }));
  slotProg = program(SH.SLOT_VS, SH.SLOT_FS);
  depProg = program(SH.DEP_VS, SH.DEP_FS);
  coarseProg = program(SH.QUAD_VS, SH.COARSE_FS);
  monoProg = program(SH.QUAD_VS, SH.MONO_FS);
  farProg = program(SH.QUAD_VS, SH.FAR_FS);
  cellProg = program(SH.QUAD_VS, SH.CELL_FS);
  rigidProg = program(SH.QUAD_VS, SH.RIGID_FS);
  diagProg = program(SH.QUAD_VS, SH.DIAG_FS);
  ppGatherProg = program(SH.QUAD_VS, SH.PPGATHER_FS);
  ppForceProg = program(SH.QUAD_VS, SH.PPFORCE_FS);
  permProg = program(SH.QUAD_VS, SH.PERM_FS);
  // the mesh, twice over: a box on the largest body, and one for a second
  // body that is leaving it — placeBoxes() says when, boxes() where
  function meshBox() {
    var m = {
      fine: floatTex(512, 513, null, floatBlend ? gl.RGBA32F : gl.RGBA16F, floatBlend ? gl.FLOAT : gl.HALF_FLOAT),   // 64³: Σ w·xyz, Σ w — blendable; a scratch row below
      coarse: floatTex(64, 64, null),                              // 16³
      mono: floatTex(1, 1, null),
      farA: floatTex(64, 64, null), farT0: floatTex(64, 64, null), farT1: floatTex(64, 64, null),   // each block's far field: acceleration and potential, and the tidal tensor in six
      force: floatTex(512, 513, null)                              // acceleration and potential at every fine cell; the scratch row copied
    };
    m.fineFbo = fboFor(m.fine); m.coarseFbo = fboFor(m.coarse); m.monoFbo = fboFor(m.mono); m.forceFbo = fboFor(m.force);
    m.farFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.farFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, m.farA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, m.farT0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, m.farT1, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('far framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return m;
  }
  pm = [meshBox(), meshBox()];

  // the loose material's pairwise pass: a seat per particle (-1 for none), the
  // particle in each seat, the seats' positions gathered, the correction found
  pp = {
    index: floatTex(PP_W, PP_H, null, gl.R32F, gl.FLOAT, gl.RED),
    list: floatTex(PP_W, PP_H, null), force: floatTex(PP_W, PP_H * PP_SLICES, null),
    box: floatTex(PP_W, PP_H, null, gl.R32F, gl.FLOAT, gl.RED),   // the box each seat reads: which pairs a mesh gave a share
    tab: null, slot: null, slotArr: null, indexArr: new Float32Array(PP_CAP), count: 0, loose: 0
  };
  // the mesh's pair force and potential by distance, for the pairwise pass
  var tab = new Float32Array(PP_TAB.f.length * 2);
  for (var i = 0; i < PP_TAB.f.length; i++) { tab[i * 2] = PP_TAB.f[i]; tab[i * 2 + 1] = PP_TAB.p[i]; }
  pp.tab = floatTex(PP_TAB.f.length, 1, tab, gl.RG32F, gl.FLOAT, gl.RG);
  pp.listFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, pp.listFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pp.list, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, pp.box, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('list framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  pp.forceFbo = fboFor(pp.force);

}


CC.nbody = {
  init: init, build: build,
  step: step, settleSome: settleSome, rigidStep: rigidStep, analyze: analyze, collect: collect,
  sortNow: function () { analyses = 0; analyze(true); return report; },
  // for the console: a pass's program replaced by a variant, to time it in place
  setProg: function (name, vs, fs) {
    var p = CC.gl.program(vs, fs);
    if (name === 'sim') simProg = p; else if (name === 'slot') slotProg = p; else if (name === 'dep') depProg = p; else if (name === 'cell') cellProg = p; else if (name === 'far') farProg = p; else if (name === 'pp') ppForceProg = p;
    setStaticUniforms();
  },
  passes: { slots: passSlots, deposit: passDeposit, coarse: passCoarse, cell: passCell, mesh: passMesh, pp: passPP, sim: passSim, diag: passDiag },
  get sim() { return sim; },
  get report() { return report; },
  get pending() { return pending; },
  get analyzedAt() { return analyzedAt; },
  get pm() { return pm; },
  get grid() { return grid; },
  get progs() { return { sim: simProg, slot: slotProg, dep: depProg, cell: cellProg, far: farProg, pp: ppForceProg, gather: ppGatherProg }; },
  get pp() { return pp; },
  get state() { return { analyzing: analyzing, pending: !!pending, worker: !!worker, analyses: analyses, analyzedAt: analyzedAt, stepNo: sim && sim.stepNo, waitStatus: pending ? gl.clientWaitSync(pending.sync, 0, 0) : null }; },
  set meshEvery(n) { MESH_EVERY = n; },
  set asyncRead(v) { asyncRead = !!v; },
  T_UNIT: T_UNIT, V_UNIT: V_UNIT, E_KG: E_KG, CP_ROCK: CP_ROCK, CP_IRON: CP_IRON, L_EM: L_EM, JAM: JAM, PP_CAP: PP_CAP, meanK: meanK
};
})();