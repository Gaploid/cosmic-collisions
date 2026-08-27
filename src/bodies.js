// Building a body out of particles: the onion of Fibonacci shells, the
// relaxation that takes the overlaps out of it, and the two bits of
// rigid-body geometry that go with them.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});

// ---------- building a run ----------
// A body is an onion: concentric shells, each holding as many particles as
// its own volume is worth, laid out over the shell by the Fibonacci spiral.
// A lattice cut to a sphere was tried first and is terraced — its planes meet
// the surface in steps a particle high, and the skin draws every step as a
// ring — where an onion's outer shell IS the surface, even at the particle
// scale. A spinning body is cut as the Maclaurin spheroid of eccentricity e
// that is a spinning fluid's equilibrium: its shells are the spheroids
// (ae − t, ce − t), each sampled evenly by area over the reduced latitude,
// turned and flipped at random so no two line up, with a little jitter on
// top. Shells smaller than their own thickness would crowd their particles
// closer than a diameter, so the innermost few are scattered through a seed
// of the shape the shells leave — a ball, or a lens when the body is one.
// The points come out sorted inside-out, with each shell's first index in
// .bounds so the core and the crust can be whole shells.
function ball(n, s, a, rng, e) {
  var R = Math.cbrt(3 * n * s * s * s / (16 * Math.PI));
  var ae = R / Math.pow(1 - e * e, 1 / 6), ce = ae * Math.sqrt(1 - e * e);   // a²c = R³: the volume is the sphere's
  var vp = s * s * s / 4, unit = 3 * vp / (4 * Math.PI), jit = 0.06 * s;
  var h = s * Math.sqrt(1 / 3);                              // shell spacing: the layer spacing of the lattice this replaces
  var K = Math.max(1, Math.round(ce / h)), GA = Math.PI * (3 - Math.sqrt(5)), NB = 256;
  h = ce / K;
  var shells = [], total = 0, kept = 0, j, b;
  for (j = 0; j < K; j++) {                                  // outermost first
    var A = ae - j * h, C = ce - j * h;
    if (C - h * 0.5 < h) break;                              // too small to be a shell
    var Am = A - h * 0.5, Cm = C - h * 0.5;
    var cum = new Float64Array(NB + 1);                      // area from the south pole up, by reduced latitude
    for (b = 0; b < NB; b++) {
      var be = (b + 0.5) * Math.PI / NB - Math.PI / 2, cb = Math.cos(be), sb = Math.sin(be);
      cum[b + 1] = cum[b] + Am * cb * Math.sqrt(Cm * Cm * cb * cb + Am * Am * sb * sb);
    }
    var want = (A * A * C - (A - h) * (A - h) * (C - h)) / unit;
    shells.push({ A: Am, C: Cm, cum: cum, want: want });
    total += want;
    kept = j + 1;
  }
  var As = ae - kept * h, Cs = ce - kept * h;
  total += Math.max(As * As * Cs, 0) / unit;                 // and the seed's share
  var out = new Float32Array(n * 3), bounds = [n], i = n, acc = 0;
  for (j = 0; j < shells.length; j++) {
    var sh = shells[j];
    acc += sh.want * n / total;
    var m = Math.min(Math.min(Math.round(acc), n) - (n - i), i), lo = i - m;
    var phi0 = rng() * 2 * Math.PI, flip = rng() < 0.5 ? -1 : 1;
    for (var q = 0, bb = 0; q < m; q++) {
      var u = (q + 0.5) / m * sh.cum[NB];
      while (bb < NB - 1 && sh.cum[bb + 1] < u) bb++;
      var lat = (bb + (u - sh.cum[bb]) / (sh.cum[bb + 1] - sh.cum[bb])) * Math.PI / NB - Math.PI / 2;
      var phi = phi0 + q * GA, rc = sh.A * Math.cos(lat), o = (lo + q) * 3;
      out[o] = rc * Math.cos(phi) + (rng() - 0.5) * jit;
      out[o + 1] = flip * sh.C * Math.sin(lat) + (rng() - 0.5) * jit;
      out[o + 2] = rc * Math.sin(phi) + (rng() - 0.5) * jit;
    }
    i = lo;
    bounds.push(lo);
  }
  var lam = Math.cbrt(i * vp / Math.max(4 / 3 * Math.PI * As * As * Cs, 1e-12));   // the seed keeps the leftover's shape — flat when the body is
  for (var k = 0; k < i; k++) {                              // the last few, at the right density, anywhere inside it
    var ux, uy, uz, u2;
    do { ux = rng() * 2 - 1; uy = rng() * 2 - 1; uz = rng() * 2 - 1; u2 = ux * ux + uy * uy + uz * uz; } while (u2 > 1);
    out[k * 3] = ux * As * lam; out[k * 3 + 1] = uy * Cs * lam; out[k * 3 + 2] = uz * As * lam;
  }
  bounds.push(0);
  bounds.reverse();
  out.bounds = bounds;
  out.relax = relax(out, n, a, ae - h * 0.5, ce - h * 0.5);
  return out;
}

// The shells are not in registry, and a spiral cannot pack a sphere as
// tightly as the plane packs: particles land some way inside each other, and
// at the surface the contact spring is a hundred times gravity — left to the
// settle those overlaps would fire particles off like popcorn. So the pile is
// relaxed first, with no inertia at all: every pair closer than the target is
// pushed apart by half its overlap, sweep after sweep over a cell grid. A
// target a little under a diameter keeps the pile at the radius its mass asks
// for — the mean overlap left, a tenth of a particle, is about what the weight
// of the rock above presses out anyway. Nothing may leave the body's own
// spheroid on the way: at a free surface the only way out of an overlap is
// outward, and a particle that takes it stands proud of the skin as a pimple
// — held in, the crowd goes sideways instead and the surface stays a surface.
//
// A body is held in by its own spheroid; a patch of ground is held in by
// something else — its walls, and the flat sky over it — so a caller with a
// different shape to keep can pass confine(out, x, y, z) and put the particle
// back itself. Sweeps too: a lattice jittered hard enough to lose its rows
// needs more of them than a spiral that was nearly right to begin with.
var RELAX_SWEEPS = 10, RELAX_TARGET = 0.96, RELAX_REGRID = 4;
function relax(p, n, a, A, C, confine, sweeps) {
  var D = 2 * a * RELAX_TARGET, cs = 2.2 * a, i, j, k, o, q, iA2 = 1 / (A * A), iC2 = 1 / (C * C);
  var nSweeps = sweeps || RELAX_SWEEPS, held = confine ? [0, 0, 0] : null;
  var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (i = 0; i < n; i++) for (k = 0; k < 3; k++) { var v = p[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  var gx = Math.floor((hi[0] - lo[0]) / cs) + 3, gy = Math.floor((hi[1] - lo[1]) / cs) + 3, gz = Math.floor((hi[2] - lo[2]) / cs) + 3, nc = gx * gy * gz;
  var start = new Int32Array(nc + 1), order = new Int32Array(n), cell = new Int32Array(n), worst = 0, sweep;
  for (sweep = 0; sweep < nSweeps; sweep++) {
    if (sweep % RELAX_REGRID === 0) {                        // the pile barely moves: the grid keeps for a few sweeps
      start.fill(0);
      for (i = 0; i < n; i++) {
        var cx = Math.min(Math.max(Math.floor((p[i * 3] - lo[0]) / cs) + 1, 0), gx - 1);
        var cy = Math.min(Math.max(Math.floor((p[i * 3 + 1] - lo[1]) / cs) + 1, 0), gy - 1);
        var cz = Math.min(Math.max(Math.floor((p[i * 3 + 2] - lo[2]) / cs) + 1, 0), gz - 1);
        cell[i] = (cx * gy + cy) * gz + cz;
        start[cell[i] + 1]++;
      }
      for (k = 0; k < nc; k++) start[k + 1] += start[k];
      for (i = 0; i < n; i++) order[start[cell[i]]++] = i;
      for (k = nc; k > 0; k--) start[k] = start[k - 1];
      start[0] = 0;
    }
    worst = 0;
    for (i = 0; i < n; i++) {
      var c = cell[i], x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      for (o = 0; o < 27; o++) {
        var cc = c + ((o % 3) - 1) * gy * gz + ((Math.floor(o / 3) % 3) - 1) * gz + (Math.floor(o / 9) - 1);
        if (cc < 0 || cc >= nc) continue;
        for (q = start[cc]; q < start[cc + 1]; q++) {
          j = order[q];
          if (j <= i) continue;
          var dx = p[j * 3] - x, dy = p[j * 3 + 1] - y, dz = p[j * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= D * D) continue;
          var d = Math.sqrt(d2) || 1e-9, ov = D - d, mv = 0.5 * ov / d;
          if (ov > worst) worst = ov;
          dx *= mv; dy *= mv; dz *= mv;
          x -= dx; y -= dy; z -= dz;
          p[j * 3] += dx; p[j * 3 + 1] += dy; p[j * 3 + 2] += dz;
        }
      }
      if (held) { confine(held, x, y, z); x = held[0]; y = held[1]; z = held[2]; }
      else {
        var qq = (x * x + z * z) * iA2 + y * y * iC2;
        if (qq > 1.0) { var f = 1 / Math.sqrt(qq); x *= f; y *= f; z *= f; }
      }
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    }
  }
  return { sweeps: sweep, worst: worst / a };
}

// The Maclaurin spheroid: a uniform fluid spinning at the fraction f of its
// breakup rate √(GM/R³) settles into an oblate spheroid whose eccentricity
// e solves  (4/3) f² = (2√(1−e²)/e³)(3 − 2e²)·asin e − 6(1−e²)/e².
// The right side peaks at 0.449 (e ≈ 0.93); f ≤ 0.55 keeps to the sequence.
function maclaurin(f) {
  var want = 4 / 3 * f * f;
  if (want < 1e-6) return 0;
  function g(e) { var s2 = 1 - e * e; return 2 * Math.sqrt(s2) / (e * e * e) * (3 - 2 * e * e) * Math.asin(e) - 6 * s2 / (e * e); }
  var lo = 0.01, hi = 0.93;
  if (want >= g(hi)) return hi;
  for (var i = 0; i < 60; i++) { var m = 0.5 * (lo + hi); if (g(m) < want) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}
// the matrix (column-major) of turning at the rate w for dt
function turn(w, dt) {
  var m = Math.hypot(w[0], w[1], w[2]);
  if (m < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  var x = w[0] / m, y = w[1] / m, z = w[2] / m, th = m * dt, c = Math.cos(th), s = Math.sin(th), t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y,
          t * x * y - s * z, t * y * y + c, t * y * z + s * x,
          t * x * z + s * y, t * y * z - s * x, t * z * z + c];
}

CC.bodies = { ball: ball, relax: relax, maclaurin: maclaurin, turn: turn };
})();
