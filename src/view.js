// The picture: the screen-sized targets, the quality governor that shrinks
// them when the frames get dear, the orbit camera, and render() itself.
// Every scenario page draws through this; what differs between them is the
// sim it is handed, never the drawing.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var gl = null, canvas = null, S = null, sim = null, report = null;
var gProg, blurProg, shadeProg, sunProg, brightProg, bloomProg, toneProg, fxaaProg, starProg, skyProg;
var sparkProg, atmProg, raysProg;   // the cinema: compiled here, the same on every page
var vao = null, starVao = null, STAR_COUNT = 0, MAX_POINT = 0;
// A particle drawn at its own size is right when everything is at the same
// distance from the camera. It is not right when a few motes come between the
// camera and a planet: those draw as saucers. A page whose scene is deep can
// cap what one is allowed to cover.
var maxPoint = 0, radPow = 0;
var pal = new Float32Array(24);   // eight materials, this scenario's
// the look a page asks for on top of the shared one: whether its bodies are
// balls — round enough to take the ball's normal and silhouette — which of
// its materials are metal, and how much surface to draw on the skin: 0 the
// flat material, 1 the noise, 2 with craters
var LK = { balls: false, detail: 0, metal: new Float32Array(8) };
var dummyHome = null;             // for a sim whose particles have no home
var lastLights = null;
// the picture's view of each body, eased: the report that places them
// comes every few dozen frames, and a ball, a light or a shell that jumps
// with it pulses on everything it touches. Per body: the offset that
// absorbs a report's jump, the radius, the surface temperature, the hot
// centroid and its spread, and the atmosphere's fade. Reset with the run
var bodySmooth = [], lightGen = -1;
var DEV = CC.dev, LOOK = CC.look, FOV = CC.FOV, glowCol = CC.glowCol, run = CC.run;
var BLUR_PASSES = DEV.BLUR_PASSES, DPR_CAP = DEV.DPR_CAP;
var MATH = CC.math, perspective = MATH.perspective, lookAt = MATH.lookAt, mul = MATH.mul;
var GLH = CC.gl, floatTex, screenTarget, freeScreen, bloomTarget;
CC.onSim(function (s) { sim = s; });
CC.onReport(function (r) { report = r; });

// the galactic frame, in the stars' equatorial one: the north galactic pole
// and the centre (J2000), from which the plane's own axes follow
function radec(ra, dec) { var r = ra * Math.PI / 180, d = dec * Math.PI / 180, c = Math.cos(d); return [c * Math.cos(r), Math.sin(d), c * Math.sin(r)]; }
var NGP = radec(192.8595, 27.1284), GC = radec(266.4051, -28.9362);
var GX = (function () { var k = NGP[0] * GC[0] + NGP[1] * GC[1] + NGP[2] * GC[2], v = [GC[0] - NGP[0] * k, GC[1] - NGP[1] * k, GC[2] - NGP[2] * k], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
var GY = [GX[1] * NGP[2] - GX[2] * NGP[1], GX[2] * NGP[0] - GX[0] * NGP[2], GX[0] * NGP[1] - GX[1] * NGP[0]];   // GX × NGP: longitude grows toward Cygnus, as it should — Deneb at l = 84°
var LMC = radec(80.894, -69.756), SMC = radec(13.187, -72.829);

// ---------- screen-sized targets ----------
var gbuf = null, blurA = null, blurB = null, bloomA = null, bloomB = null, bloomC = null, bloomD = null, skyT = null;
var raysT = null, hiA = null, hiB = null;   // the light shafts, and the brightest for the lens's streak and ghosts — a quarter of the size each
var bloomW = 0, bloomH = 0, bloom2W = 0, bloom2H = 0, ldr = null;
var hdr = { fbo: null, tex: null, depth: null, w: 0, h: 0 };   // the context arrives at init(), which fills these
// The picture is drawn at this much of a side on top of the pixel-ratio cap.
// A phone that starts at sixty does not stay there — it warms, and ten minutes
// in the frame takes twice as long — so rather than stutter it draws fewer
// pixels, and takes them back when the frames come easily again. Only the
// picture moves; the physics never sees it.
var RENDER_SCALES = [1, 0.85, 0.72], scaleIdx = 0, scaleT0 = 0, easyRuns = 0;
var renderScale = 1;
function governQuality(now, fps) {
  if (!sim || sim.phase === 'settle' || run.paused || !fps) { scaleT0 = now; return; }
  if (now - scaleT0 < 2500) return;
  scaleT0 = now;
  if (fps < 40 && scaleIdx < RENDER_SCALES.length - 1) { scaleIdx++; easyRuns = 0; }
  else if (fps > 56 && scaleIdx > 0) { if (++easyRuns < 3) return; easyRuns = 0; scaleIdx--; }   // seven seconds of comfort before it climbs
  else { easyRuns = 0; return; }
  renderScale = RENDER_SCALES[scaleIdx];
}
function freeBloom(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
function resize() {
  var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP) * renderScale;
  var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (w === hdr.w && h === hdr.h) return;
  canvas.width = w; canvas.height = h;
  freeScreen(gbuf); freeScreen(blurA); freeScreen(blurB);
  gbuf = screenTarget(w, h, true); blurA = screenTarget(w, h, false); blurB = screenTarget(w, h, false);
  if (hdr.tex) gl.deleteTexture(hdr.tex);
  hdr.tex = floatTex(w, h, null, gl.RGBA16F, gl.HALF_FLOAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);   // the bloom's bright pass reads it between texels
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  freeBloom(bloomA); freeBloom(bloomB); freeBloom(bloomC); freeBloom(bloomD); freeBloom(skyT); freeBloom(ldr);
  freeBloom(raysT); freeBloom(hiA); freeBloom(hiB);
  bloomW = Math.ceil(w / 4); bloomH = Math.ceil(h / 4);
  bloom2W = Math.ceil(w / 16); bloom2H = Math.ceil(h / 16);
  bloomA = bloomTarget(bloomW, bloomH); bloomB = bloomTarget(bloomW, bloomH);
  bloomC = bloomTarget(bloom2W, bloom2H); bloomD = bloomTarget(bloom2W, bloom2H);
  skyT = bloomTarget(bloomW, bloomH);
  raysT = bloomTarget(bloomW, bloomH); hiA = bloomTarget(bloomW, bloomH); hiB = bloomTarget(bloomW, bloomH);
  ldr = bloomTarget(w, h, true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hdr.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hdr.tex, 0);
  gl.bindRenderbuffer(gl.RENDERBUFFER, hdr.depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, hdr.depth);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  hdr.w = w; hdr.h = h;
}

// ---------- camera ----------
var cam = { yaw: 0.35, pitch: 0.42, dist: 7.5 };
// how far in and out the wheel and the pinch may go. A planet is looked at
// from a few radii; a crater from a few of its own, which is a different
// number of length units, so the page says.
var distMin = 1.5, distMax = 80;
var camTarget = [0, 0, 0], camPos = [0, 0, 0];
var pointers = new Map(), pinch0 = 0, dist0 = 0;
// Until somebody takes hold of it the camera drifts round the scene, slowly
// enough that the stars are seen to move behind the planet and no faster;
// the first drag or wheel ends it for good. A paused run holds still.
var touched = false, lastFrameT = 0;
// The pointer, the wheel and the pinch. Wired at init(), when there is a
// canvas to wire them to.
function wireCamera() {
  canvas.addEventListener('pointerdown', function (e) {
    touched = true;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) { var p = Array.from(pointers.values()); pinch0 = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); dist0 = cam.dist; }
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', function (e) {
    var prev = pointers.get(e.pointerId);
    if (!prev) return;
    var cur = [e.clientX, e.clientY];
    if (pointers.size === 1) {
      cam.yaw -= (cur[0] - prev[0]) * 0.005;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + (cur[1] - prev[1]) * 0.005));
    }
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch0 > 0) {
      var p = Array.from(pointers.values());
      var d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      cam.dist = Math.max(distMin, Math.min(distMax, dist0 * pinch0 / Math.max(d, 1)));
    }
  });
  function endPointer(e) { pointers.delete(e.pointerId); if (pointers.size === 0) canvas.classList.remove('dragging'); }
  // Safari answers a two-finger pinch by zooming the page; the sim wants it
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    touched = true;
    cam.dist = Math.max(distMin, Math.min(distMax, cam.dist * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
}

// ---------- drawing ----------
// stage timing, for the console: profileStages = true wraps each stage of
// render() in its own timer query, stageTimes() reads them back
var stageQ = [], stageExt = null, profileStages = false, curQ = null;
function mark(name) {
  if (!profileStages) return;
  if (!stageExt) stageExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (curQ) gl.endQuery(stageExt.TIME_ELAPSED_EXT);
  curQ = null;
  if (name) { curQ = gl.createQuery(); gl.beginQuery(stageExt.TIME_ELAPSED_EXT, curQ); stageQ.push([name, curQ]); }
}
var SUN = (function () { var v = [-0.6, 0.45, 0.6], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
function render() {
  var w = hdr.w, h = hdr.h;
  var full = S.shade !== false;   // the page's shading switch: the full look, or the plain one to read the run by
  var nowT = performance.now(), wall = nowT / 1000;
  if (lastFrameT && LOOK.idleSpin && S.drift !== false && !touched && !run.paused && sim && sim.phase !== 'settle') cam.yaw += LOOK.idleSpin * Math.min((nowT - lastFrameT) / 1000, 0.1);
  lastFrameT = nowT;
  var goal = (S.follow && sim) ? sim.com1 : [0, 0, 0];
  for (var i = 0; i < 3; i++) camPos[i] += (goal[i] - camPos[i]) * 0.08;
  var cy = Math.cos(cam.pitch), sy = Math.sin(cam.pitch);
  var eye = [camPos[0] + cam.dist * cy * Math.sin(cam.yaw), camPos[1] + cam.dist * sy, camPos[2] + cam.dist * cy * Math.cos(cam.yaw)];
  var proj = perspective(FOV, w / h, 0.05, 3000), view = lookAt(eye, camPos, [0, 1, 0]);
  var vp = mul(proj, view);
  var px = (h / 2) / Math.tan(FOV / 2);

  var sunEye = [
    view[0] * SUN[0] + view[4] * SUN[1] + view[8] * SUN[2],
    view[1] * SUN[0] + view[5] * SUN[1] + view[9] * SUN[2],
    view[2] * SUN[0] + view[6] * SUN[1] + view[10] * SUN[2]];
  // eye to world, for the sky: the view's rotation, turned round
  var invRot = [view[0], view[4], view[8], view[1], view[5], view[9], view[2], view[6], view[10]];
  var toEye = function (x, y, z) {
    return [view[0] * x + view[4] * y + view[8] * z + view[12], view[1] * x + view[5] * y + view[9] * z + view[13], view[2] * x + view[6] * y + view[10] * z + view[14]];
  };

  mark('bodies');
  if (sim) {
    // 1. the bodies as sphere impostors: material, heat, depth, home
    var g = gProg.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gbuf.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.useProgram(gProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.src.vel);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sim.src.aux);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sim.mat);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, sim.home || dummyHome);
    gl.uniform1i(g.uPos, 0); gl.uniform1i(g.uVel, 1); gl.uniform1i(g.uAux, 2);
    gl.uniform2i(g.uSize, sim.W, sim.H);
    gl.uniformMatrix4fv(g.uView, false, view);
    gl.uniformMatrix4fv(g.uProj, false, proj);
    gl.uniform1i(g.uMat, 3);
    gl.uniform1i(g.uHome, 4); gl.uniform1f(g.uHomeOn, sim.home && full && LK.detail > 0 ? 1 : 0);
    gl.uniform1fv(g['uMetal[0]'], LK.metal);
    gl.uniform1f(g.uRadPow, radPow);
    gl.uniform1f(g.uRad, sim.a);
    gl.uniform1f(g.uPx, px);
    gl.uniform1f(g.uMaxPt, maxPoint);
    gl.uniform1f(g.uFat, LOOK.fat);
    gl.uniform1f(g.uP22, proj[10]);
    gl.uniform1f(g.uP32, proj[14]);
    gl.uniform3fv(g['uPal[0]'], pal);
    gl.drawArrays(gl.POINTS, 0, sim.N);

    // 2. bilateral blur, two particles wide, x then y, twice over. A tap a
    //    pixel up to twelve; past that the taps spread. Close in — a
    //    particle sixty pixels across, the taps five apart — the comb of
    //    them showed through the skin as stripes: the raw depth steps at
    //    every disc's edge, each tap crossing an edge is a step in the sum,
    //    and the normal, a difference of neighbours, blinks with the comb's
    //    period. So a coarse comb is preceded by a dense pass, a tap a
    //    pixel over the comb's own spacing, that turns the edges into ramps
    //    the comb can cross smoothly
    mark('blur');
    var rpx = sim.a * px / cam.dist * 2.0;
    var taps = Math.max(1, Math.min(12, Math.round(rpx)));
    var step = Math.max(1, rpx / taps), pre = step > 1.5 ? Math.ceil(step) : 0;
    var b = blurProg.u;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(blurProg.p);
    gl.uniform1i(b.uMat, 0); gl.uniform1i(b.uDep, 1); gl.uniform1i(b.uHome, 2);
    gl.uniform1f(b.uRange, LOOK.range * sim.a);
    gl.uniform2i(b.uRes, w, h);
    var from = gbuf, ping = [blurA, blurB], passes = [];
    if (pre) passes.push([pre, 1], [pre, 1]);
    for (var k = 0; k < BLUR_PASSES; k++) passes.push([taps, step]);
    for (var pass = 0; pass < passes.length; pass++) {
      var to = ping[pass & 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.mat);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, from.dep);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, from.home);
      gl.uniform1i(b.uTaps, passes[pass][0]);
      gl.uniform1f(b.uStep, passes[pass][1]);
      gl.uniform2i(b.uDir, 1 - (pass & 1), pass & 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      from = to;
    }
  }

  // the sky, at a quarter of the size: the band is soft, and the noise it
  // is made of would cost at full
  mark('sky');
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, skyT.fbo);
  gl.viewport(0, 0, bloomW, bloomH);
  var sk = skyProg.u;
  gl.useProgram(skyProg.p);
  gl.uniform2f(sk.uRes, bloomW, bloomH);
  gl.uniform2f(sk.uInvP, 1 / proj[0], 1 / proj[5]);
  gl.uniformMatrix3fv(sk.uInvRot, false, invRot);
  gl.uniform3fv(sk.uNGP, NGP); gl.uniform3fv(sk.uGX, GX); gl.uniform3fv(sk.uGY, GY);
  gl.uniform3fv(sk.uLMC, LMC); gl.uniform3fv(sk.uSMC, SMC);
  gl.uniform1f(sk.uMw, S.stars ? LOOK.mw : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // the bodies, as the picture knows them: the largest and the second from
  // the last report, carried forward by their drift since. Each is a ball
  // for the skin to lean on, an occluder in the sun and in the other's
  // light, and — hot, past the settle — a light itself, shining with the
  // glow of its surface temperature, brighter than the sun on anything near
  var nl = 0, lp = [0, 0, 0, 0, 0, 0], lc = [0, 0, 0, 0, 0, 0], lr = [1, 1], no = 0, occ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var nb = 0, ball = [0, 0, 0, 1, 0, 0, 0, 1], lball = [-1, -1];
  // the atmosphere on each ball: what it scatters, what it glows with, how
  // thick it is. A cold body's is thin and blue — this is the blue planet —
  // a warm one's thicker and the colour of its glow, a hot one's the rock
  // vapour it is boiling off, glowing of itself and puffed out
  var atmCol = [0, 0, 0, 0, 0, 0], atmEm = [0, 0, 0, 0, 0, 0], atmH = [0, 0], atmHot = [0, 0, 0, 0, 0, 0, 0, 0], aball = [0, 0, 0, 1, 0, 0, 0, 1];
  var occlude = function (c, r) { occ[no * 4] = c[0]; occ[no * 4 + 1] = c[1]; occ[no * 4 + 2] = c[2]; occ[no * 4 + 3] = r; no++; };
  if (sim && report && report.com && sim.phase !== 'settle') {
    var lag = sim.t - (report.t || sim.t), hot = sim.phase === 'full';
    var bodies = [{ com: report.com, core: report.core, vel: report.vel || [0, 0, 0], R: report.R, Redge: report.Redge, mass: report.largest || 0, imp: report.largestImp || 0, Tsurf: report.Tsurf || 0, hotCom: report.hotCom, hotR: report.hotR }];
    if (report.second && report.second.com) bodies.push({ com: report.second.com, core: report.second.core, vel: report.second.vel, R: report.second.R, Redge: report.second.Redge, mass: report.second.mass, imp: report.second.imp || 0, Tsurf: report.second.Tsurf || 0, hotCom: report.second.hotCom, hotR: report.second.hotR, dist: report.second.dist || 0 });
    // the radius a body's skin is drawn at: where the analysis found its
    // density fall away, plus the particle that stands on that edge — the
    // mass says where a cold ball of it would end, and a hot one, puffed up
    // by the impact, stands well above that. Without the edge, the mass at
    // the density of what the body is made of, which may be lighter than
    // Earth's while the report's radius is at Earth's density
    var v1 = sim.R1 > 0 ? sim.R1 * sim.R1 * sim.R1 / sim.M1 : 1, v2 = sim.R2 > 0 ? sim.R2 * sim.R2 * sim.R2 / sim.M2 : v1;
    bodies.forEach(function (bd, bi) {
      // the picture's view of the body, eased. The report comes every few
      // dozen frames and moves the centre of mass a little each time — as
      // grains join the group and leave it — and everything drawn from it,
      // the ball, the shadows, the light, the vapour, jumped with it. So
      // each body keeps an offset that absorbs a report's jump and decays
      // over a dozen frames, and its radius, temperature and hot centroid
      // are eased; a second body that changes identity — another clump
      // named — starts afresh, its atmosphere fading in
      // the body's own centre — the core the analysis finds, not the group's
      // centre of mass, which the arm pulls about — carried by its drift
      var cb = bd.core || bd.com;
      var pc = [cb[0] + bd.vel[0] * lag, cb[1] + bd.vel[1] * lag, cb[2] + bd.vel[2] * lag];
      // the radius a body's skin is drawn at: where the analysis found its
      // density fall away, plus the particle that stands on that edge; or the
      // mass at the density of what it is made of
      var Rd = bd.Redge > 0 ? bd.Redge + sim.a : Math.cbrt(bd.mass * ((1 - bd.imp) * v1 + bd.imp * v2)) + 0.45 * sim.a;
      var hcw = bd.hotCom || cb, hoff = [hcw[0] - cb[0], hcw[1] - cb[1], hcw[2] - cb[2]];
      // the atmosphere is a planet's: the largest body's always, the
      // second's when it is heavy enough to have degassed one and hold it —
      // past Mercury's mass, so a Mars-sized impactor wears one and a
      // moonlet out of the disk does not — and stands clear of the first; a
      // clump in the arm is neither round nor airy, and a shell round it was
      // a ring on a lump
      var planet = bi === 0 || (bd.mass >= 0.06 && bd.dist > bodies[0].R + 2.5 * bd.R);
      var fresh = function (k) { return { off: [0, 0, 0], prev: pc, rep: report, R: Rd, Ts: bd.Tsurf, hot: hoff.slice(), hotR: bd.hotR || 0, k: k }; };
      var bs = bodySmooth[bi];
      if (!bs || lightGen !== sim.gen) bs = bodySmooth[bi] = fresh(planet ? 1 : 0);
      else if (bs.rep !== report) {
        if (Math.hypot(bs.prev[0] - pc[0], bs.prev[1] - pc[1], bs.prev[2] - pc[2]) > 1.5 * Rd) bs = bodySmooth[bi] = fresh(0);
        else { for (var q4 = 0; q4 < 3; q4++) bs.off[q4] += bs.prev[q4] - pc[q4]; bs.rep = report; }
      }
      bs.prev = pc;
      for (var q5 = 0; q5 < 3; q5++) { bs.off[q5] *= 0.93; bs.hot[q5] += (hoff[q5] - bs.hot[q5]) * 0.08; }
      bs.R += (Rd - bs.R) * 0.1; bs.Ts += (bd.Tsurf - bs.Ts) * 0.08; bs.hotR += ((bd.hotR || 0) - bs.hotR) * 0.08;
      bs.k += ((planet ? 1 : 0) - bs.k) * 0.08;
      var cw = [pc[0] + bs.off[0], pc[1] + bs.off[1], pc[2] + bs.off[2]];
      var e = toEye(cw[0], cw[1], cw[2]);
      occlude(e, bd.R);                                  // every body shadows the other's light
      var myBall = -1;
      if (LK.balls && full && nb < 2 && bd.mass > 0) {
        ball[nb * 4] = e[0]; ball[nb * 4 + 1] = e[1]; ball[nb * 4 + 2] = e[2]; ball[nb * 4 + 3] = bs.R;
        aball[nb * 4] = e[0]; aball[nb * 4 + 1] = e[1]; aball[nb * 4 + 2] = e[2]; aball[nb * 4 + 3] = bs.R;
        // What the shell scatters. Not the thin blue air of today — that is
        // nitrogen, and two billion years of oxygen, away — but the steam a
        // magma ocean boils off: water and carbon dioxide at tens to
        // hundreds of bars, white with cloud rather than blue with Rayleigh.
        // A lighter body degassed a shorter column and holds it further out,
        // its gravity being lower — the column goes as the cube root of the
        // mass, the height as its reciprocal — so a Mars wears half the haze
        // twice as high, which is what a Mars does
        var Ts = hot ? bs.Ts : 0, heat = Math.min(Math.max((Ts - 700) / 2000, 0), 1);
        var mk = Math.cbrt(Math.max(bd.mass, 0.02)), ck = 0.24 * Math.min(1, mk);
        var gc = glowCol(Math.max(Ts, 900));
        for (var q3 = 0; q3 < 3; q3++) {
          atmCol[nb * 3 + q3] = LOOK.atm * LOOK.atmCol[q3] * ck * bs.k;
          atmEm[nb * 3 + q3] = LOOK.atm * LOOK.atmHot * heat * gc[q3] * 0.45 * bs.k;
        }
        atmH[nb] = LOOK.atmH * Math.min(2, 1 / mk);
        // the vapour is where the heat is: the hot centroid, and its spread
        // taken out to the edge of the hot grains — a uniform ball's rms is
        // 0.775 of its radius
        var eh = toEye(cw[0] + bs.hot[0], cw[1] + bs.hot[1], cw[2] + bs.hot[2]);
        atmHot[nb * 4] = eh[0]; atmHot[nb * 4 + 1] = eh[1]; atmHot[nb * 4 + 2] = eh[2]; atmHot[nb * 4 + 3] = 1.3 * bs.hotR;
        myBall = nb++;
      }
      if (!hot || bd.Tsurf < 900) return;
      lball[nl] = myBall;                                // the light leaves its own ball's skin alone
      // the light sits where the heat is — the glow-weighted centroid of the
      // body's hot grains, their spread for its radius — eased like the rest
      var hr = Math.min(Math.max(LOOK.hotLight && bs.hotR > 0 ? bs.hotR : bd.R, 0.25 * bd.R), bd.R);   // never wider than the body: hot ejecta still in its group would swell the light past the disk it should be lighting
      var c = glowCol(bs.Ts), kk = S.glow * LOOK.magma * (1 + LOOK.reach * LOOK.reach);
      var lo = LOOK.hotLight ? bs.hot : [0, 0, 0];
      var el = toEye(cw[0] + lo[0], cw[1] + lo[1], cw[2] + lo[2]);
      lp[nl * 3] = el[0]; lp[nl * 3 + 1] = el[1]; lp[nl * 3 + 2] = el[2];
      lc[nl * 3] = c[0] * kk; lc[nl * 3 + 1] = c[1] * kk; lc[nl * 3 + 2] = c[2] * kk;
      lr[nl] = hr * hr;
      nl++;
    });
    lightGen = sim.gen;
    // the impactor, while its material is still a ball inside the merged
    // group — the first hour, before it is smeared over the planet — is a
    // ball in the planet's light too: it hides the planet from its own
    // far side, and from what the contact throws off it
    if (hot && report.impMass > 0.003) {
      var ri = Math.cbrt(report.impMass / S.dens);
      if (report.impRms < 1.3 * 0.775 * ri) occlude(toEye(report.impCom[0] + report.vel[0] * lag, report.impCom[1] + report.vel[1] * lag, report.impCom[2] + report.vel[2] * lag), ri);
    }
  }

  // 3. compose: the lit skin, then the sky and the sun behind it, and the stars
  mark('shade');
  gl.bindFramebuffer(gl.FRAMEBUFFER, hdr.fbo);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  if (sim) {
    var s = shadeProg.u;
    gl.depthFunc(gl.ALWAYS);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(shadeProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, blurB.mat);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurB.dep);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, gbuf.dep);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, blurB.home);
    gl.uniform1i(s.uMat, 0); gl.uniform1i(s.uDep, 1); gl.uniform1i(s.uDepRaw, 2); gl.uniform1i(s.uHome, 3);
    gl.uniform2f(s.uInvP, 1 / proj[0], 1 / proj[5]);
    gl.uniform2f(s.uRes, w, h);
    gl.uniform3fv(s.uSunEye, sunEye);
    gl.uniform1f(s.uGlow, S.glow);
    gl.uniform1f(s.uGlowT, LOOK.glowT); gl.uniform1f(s.uWhite, LOOK.white);
    gl.uniform1i(s.uNO, no); gl.uniform4fv(s['uOcc[0]'], occ);
    lastLights = { nl: nl, lp: lp.slice(), lc: lc.slice(), lr: lr.slice(), eye: eye.slice(), view: Array.from(view), loc: [s['uLPos[0]'], s['uLCol[0]'], s['uLR2[0]'], s.uNL] };
    gl.uniform1i(s.uNL, nl);
    gl.uniform3fv(s['uLPos[0]'], lp); gl.uniform3fv(s['uLCol[0]'], lc); gl.uniform1fv(s['uLR2[0]'], lr); gl.uniform1iv(s['uLBall[0]'], lball);
    gl.uniform1f(s.uReach2, LOOK.reach * LOOK.reach);
    gl.uniform1f(s.uEmberMax, LOOK.emberMax);
    gl.uniform1f(s.uEdge, LOOK.edge); gl.uniform1f(s.uEdgeSoft, LOOK.edgeSoft); gl.uniform1f(s.uRad, sim.a);
    gl.uniform1i(s.uNB, nb); gl.uniform4fv(s['uBall[0]'], ball);
    gl.uniform1f(s.uBallK, LOOK.ball);
    gl.uniform1f(s.uCut, LOOK.cut >= 0 ? LOOK.cut : (sim.phase === 'approach' ? 1 : 0));   // the ball's silhouette cuts its skin only while the bodies are whole balls
    gl.uniform1f(s.uDetail, full && sim.home ? LK.detail : 0);
    gl.uniform1f(s.uBump, LOOK.bump);
    gl.uniform1f(s.uFull, full ? 1 : 0);
    gl.uniform1f(s.uDbg, LOOK.dbg || 0);
    gl.uniform1f(s.uP22, proj[10]);
    gl.uniform1f(s.uP32, proj[14]);
    gl.uniform1f(s.uShadow, full ? LOOK.shadows : 0);
    gl.uniform1f(s.uConv, LOOK.conv);
    gl.uniformMatrix3fv(s.uInvRot, false, invRot);
    gl.uniform3fv(s.uEyeW, eye);
    gl.uniform1f(s.uTime, (sim.t || 0) * 0.15);
    gl.uniform1f(s.uSparkOn, full && LOOK.spark > 0 && S.sparks !== false ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }
  gl.depthFunc(gl.LESS);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  // the sky, and the sun in it when it is ahead of the camera
  mark('sun+stars');
  var su = sunProg.u;
  gl.useProgram(sunProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, skyT.tex);
  gl.uniform1i(su.uSky, 0);
  gl.uniform2f(su.uInvRes, 1 / w, 1 / h);
  gl.uniform2f(su.uRes, w, h);
  gl.uniform2f(su.uInvP, 1 / proj[0], 1 / proj[5]);
  gl.uniform3fv(su.uSunEye, sunEye);
  gl.uniform1f(su.uSunR, LOOK.sunR); gl.uniform1f(su.uSunI, sunEye[2] < 0 ? LOOK.sunI : 0); gl.uniform1f(su.uHalo, LOOK.halo);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (S.stars) {
    gl.useProgram(starProg.p);
    gl.uniformMatrix4fv(starProg.u.uVP, false, vp);
    gl.uniform3fv(starProg.u.uEye, eye);
    gl.uniform1f(starProg.u.uBright, 0.5);
    gl.uniform1f(starProg.u.uPx, Math.max(1, h / 900));
    gl.uniform1f(starProg.u.uT, performance.now() / 1000);
    gl.bindVertexArray(starVao);
    gl.drawArrays(gl.POINTS, 0, STAR_COUNT);
    gl.bindVertexArray(vao);
  }
  // the sparks: the loose hot grains once more, as comets, over the skin
  // and behind whatever stands in front of them
  mark('sparks');
  if (sim && full && LOOK.spark > 0 && S.sparks !== false && sim.phase !== 'settle') {
    var sp = sparkProg.u;
    gl.useProgram(sparkProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.src.pos);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.src.vel);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sim.src.aux);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sim.mat);
    gl.uniform1i(sp.uPos, 0); gl.uniform1i(sp.uVel, 1); gl.uniform1i(sp.uAux, 2); gl.uniform1i(sp.uMat, 3);
    gl.uniform2i(sp.uSize, sim.W, sim.H);
    gl.uniformMatrix4fv(sp.uView, false, view);
    gl.uniformMatrix4fv(sp.uProj, false, proj);
    gl.uniform2f(sp.uRes, w, h);
    gl.uniform1f(sp.uRad, sim.a); gl.uniform1f(sp.uRadPow, radPow); gl.uniform1f(sp.uPx, px);
    gl.uniform1f(sp.uSpSize, LOOK.sparkSize);
    // the streak is the grain's own motion over the last few frames: a frame
    // of the run is its step times the speed, or the rigid flight's own step
    var fdt = (sim.phase === 'approach' ? 0.0025 : (sim.dt || 0)) * (S.speed || 1);
    gl.uniform1f(sp.uStretch, fdt * LOOK.sparkTrail);
    gl.uniform1f(sp.uK, S.glow * LOOK.spark * 0.6);
    gl.uniform1f(sp.uT0, 1100);
    gl.uniform1f(sp.uGlowT, LOOK.glowT); gl.uniform1f(sp.uWhite, LOOK.white);
    gl.drawArrays(gl.TRIANGLES, 0, sim.N * 6);
  }
  // the atmosphere, over everything: the shell's light in front of the skin
  mark('atm');
  gl.disable(gl.DEPTH_TEST);
  if (sim && full && nb > 0 && LOOK.atm > 0 && S.atm !== false) {
    var at = atmProg.u;
    gl.useProgram(atmProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, blurB.dep);
    gl.uniform1i(at.uDep, 0);
    gl.uniform2f(at.uInvP, 1 / proj[0], 1 / proj[5]);
    gl.uniform2f(at.uRes, w, h);
    gl.uniform3fv(at.uSunEye, sunEye);
    gl.uniform1i(at.uNB, nb); gl.uniform4fv(at['uBall[0]'], aball);
    gl.uniform3fv(at['uAtmCol[0]'], atmCol); gl.uniform3fv(at['uAtmEm[0]'], atmEm); gl.uniform1fv(at['uAtmH[0]'], atmH); gl.uniform4fv(at['uAtmHot[0]'], atmHot);
    gl.uniform1f(at.uRad, sim.a);
    gl.uniform1f(at.uEdge, LOOK.edge); gl.uniform1f(at.uEdgeSoft, LOOK.edgeSoft);
    gl.uniform1f(at.uK, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.disable(gl.BLEND);
  // the light shafts, at a quarter of the size: the sun's glare walked
  // toward the sun past the skin
  mark('rays');
  gl.bindFramebuffer(gl.FRAMEBUFFER, raysT.fbo);
  gl.viewport(0, 0, bloomW, bloomH);
  if (sim && full && LOOK.rays > 0 && S.lens !== false && sunEye[2] < -0.05) {
    var ry = raysProg.u;
    gl.useProgram(raysProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, blurB.dep);
    gl.uniform1i(ry.uDep, 0);
    gl.uniform2f(ry.uRes, bloomW, bloomH); gl.uniform2f(ry.uFull, w, h);
    gl.uniform2f(ry.uInvP, 1 / proj[0], 1 / proj[5]);
    gl.uniform3fv(ry.uSunEye, sunEye);
    gl.uniform1f(ry.uSunR, LOOK.sunR);
    gl.uniform1f(ry.uK, LOOK.rays);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }

  // 4. bloom: the bright part at a quarter size, a narrow blur then a wide
  //    one; then at a sixteenth, the widest
  mark('bloom');
  gl.viewport(0, 0, bloomW, bloomH);
  gl.useProgram(brightProg.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hdr.tex);
  gl.uniform1i(brightProg.u.uHdr, 0);
  gl.uniform2f(brightProg.u.uInvRes, 1 / w, 1 / h);
  gl.uniform1f(brightProg.u.uThr, LOOK.bloomThr);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(bloomProg.p);
  gl.uniform1i(bloomProg.u.uSrc, 0);
  gl.uniform2f(bloomProg.u.uInvRes, 1 / bloomW, 1 / bloomH);
  var bp = [bloomA, bloomB];
  for (var bpass = 0; bpass < 4; bpass++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bp[(bpass + 1) & 1].fbo);
    gl.bindTexture(gl.TEXTURE_2D, bp[bpass & 1].tex);
    gl.uniform2f(bloomProg.u.uDir, 1 - (bpass & 1), bpass & 1);
    gl.uniform1f(bloomProg.u.uStep, bpass < 2 ? 1.5 : 3.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.viewport(0, 0, bloom2W, bloom2H);
  gl.useProgram(brightProg.p);                   // with no threshold, the bright pass is a 4× downsample
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomC.fbo);
  gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
  gl.uniform2f(brightProg.u.uInvRes, 1 / bloomW, 1 / bloomH);
  gl.uniform1f(brightProg.u.uThr, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(bloomProg.p);
  gl.uniform2f(bloomProg.u.uInvRes, 1 / bloom2W, 1 / bloom2H);
  var bq = [bloomC, bloomD];
  for (var bpass2 = 0; bpass2 < 2; bpass2++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bq[(bpass2 + 1) & 1].fbo);
    gl.bindTexture(gl.TEXTURE_2D, bq[bpass2 & 1].tex);
    gl.uniform2f(bloomProg.u.uDir, 1 - (bpass2 & 1), bpass2 & 1);
    gl.uniform1f(bloomProg.u.uStep, 1.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // the lens: what is brighter than streakThr — the sun, the hottest of
  //    the splash — softened a little for the ghosts, then smeared across
  //    the frame for the anamorphic streak; the bloom's own scratch target
  //    carries the streak, being free by now
  mark('lens');
  gl.viewport(0, 0, bloomW, bloomH);
  if (full && S.lens !== false && (LOOK.streak > 0 || LOOK.ghosts > 0)) {
    gl.useProgram(brightProg.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hiA.fbo);
    gl.bindTexture(gl.TEXTURE_2D, hdr.tex);
    gl.uniform2f(brightProg.u.uInvRes, 1 / w, 1 / h);
    gl.uniform1f(brightProg.u.uThr, LOOK.streakThr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(bloomProg.p);
    gl.uniform2f(bloomProg.u.uInvRes, 1 / bloomW, 1 / bloomH);
    // every step off the integer: taps on texel centres comb a point into
    // a grid, which the ghosts then magnified seven times
    var lens = [[hiA, hiB, 1, 0, 1.5], [hiB, hiA, 0, 1, 1.5], [hiA, hiB, 1, 0, 2.5], [hiB, bloomB, 1, 0, 5.5], [bloomB, hiB, 1, 0, 11.5]];
    for (var lp2 = 0; lp2 < lens.length; lp2++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lens[lp2][1].fbo);
      gl.bindTexture(gl.TEXTURE_2D, lens[lp2][0].tex);
      gl.uniform2f(bloomProg.u.uDir, lens[lp2][2], lens[lp2][3]);
      gl.uniform1f(bloomProg.u.uStep, lens[lp2][4]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  // 5. the film: tone map with the vignette, then FXAA on the way to the screen
  mark('tone+fxaa');
  gl.bindFramebuffer(gl.FRAMEBUFFER, ldr.fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(toneProg.p);
  var dbg = window.DBG | 0;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dbg === 1 ? gbuf.dep : dbg === 2 ? blurA.dep : dbg === 3 ? blurB.dep : hdr.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bloomC.tex);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, raysT.tex);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hiB.tex);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, hiA.tex);
  gl.uniform1i(toneProg.u.uHdr, 0); gl.uniform1i(toneProg.u.uBloom, 1); gl.uniform1i(toneProg.u.uBloom2, 2);
  gl.uniform1i(toneProg.u.uRays, 3); gl.uniform1i(toneProg.u.uStreak, 4); gl.uniform1i(toneProg.u.uGhost, 5);
  var film = !dbg && full && S.lens !== false;   // the plain look is for reading the run by: no lens, no grain; and the page has a switch
  gl.uniform1f(toneProg.u.uStreakK, film ? LOOK.streak : 0); gl.uniform1f(toneProg.u.uGhostK, film ? LOOK.ghosts : 0);
  gl.uniform1f(toneProg.u.uHaze, film ? LOOK.haze : 0); gl.uniform1f(toneProg.u.uGrade, film ? LOOK.grade : 0);
  gl.uniform1f(toneProg.u.uT, wall);
  gl.uniform2f(toneProg.u.uInvRes, 1 / w, 1 / h);
  gl.uniform1f(toneProg.u.uBloomK, LOOK.bloomK); gl.uniform1f(toneProg.u.uBloomK2, LOOK.bloomK2);
  gl.uniform1f(toneProg.u.uDbg, dbg ? 1 : 0);
  gl.uniform1f(toneProg.u.uExposure, S.exposure);
  gl.uniform1f(toneProg.u.uFilmic, LOOK.filmic);
  gl.uniform1f(toneProg.u.uVig, dbg ? 0 : LOOK.vignette);
  gl.uniform1f(toneProg.u.uSat, LOOK.sat);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(fxaaProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ldr.tex);
  gl.uniform1i(fxaaProg.u.uSrc, 0);
  gl.uniform2f(fxaaProg.u.uInvRes, 1 / w, 1 / h);
  gl.uniform1f(fxaaProg.u.uOn, dbg ? 0 : LOOK.fxaa);
  gl.uniform1f(fxaaProg.u.uCA, film ? LOOK.ca : 0); gl.uniform1f(fxaaProg.u.uGrain, film ? LOOK.grain : 0);
  gl.uniform1f(fxaaProg.u.uT, wall);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  mark(null);
}

CC.view = {

  init: function (o) {

    gl = o.gl; canvas = o.canvas; S = o.S;
    for (var i = 0; i < o.pal.length && i < 8; i++) pal.set(o.pal[i], i * 3);

    floatTex = GLH.floatTex; screenTarget = GLH.screenTarget; freeScreen = GLH.freeScreen; bloomTarget = GLH.bloomTarget;

    vao = GLH.vao; MAX_POINT = GLH.MAX_POINT; maxPoint = MAX_POINT;

    starVao = o.starVao; STAR_COUNT = o.starCount;

    gProg = o.progs.g; blurProg = o.progs.blur; shadeProg = o.progs.shade; sunProg = o.progs.sun;

    brightProg = o.progs.bright; bloomProg = o.progs.bloom; toneProg = o.progs.tone;

    fxaaProg = o.progs.fxaa; starProg = o.progs.star;

    // the pass every page draws the same way is compiled here rather than handed in
    skyProg = GLH.program(CC.glsl.QUAD_VS, CC.glsl.SKY_FS);
    sparkProg = GLH.program(CC.glsl.SPARK_VS, CC.glsl.SPARK_FS);
    atmProg = GLH.program(CC.glsl.QUAD_VS, CC.glsl.ATM_FS);
    raysProg = GLH.program(CC.glsl.QUAD_VS, CC.glsl.RAYS_FS);
    dummyHome = floatTex(1, 1, new Float32Array(4));

    hdr.fbo = gl.createFramebuffer(); hdr.depth = gl.createRenderbuffer();
    wireCamera();

  },

  render: render, resize: resize, governQuality: governQuality,

  cam: cam,

  get hdr() { return hdr; },
  set profileStages(v) { if (v && !profileStages) stageQ = []; profileStages = !!v; },
  stageTimes: function () {   // null until the GPU has answered
    var out = {}, i, q;
    for (i = 0; i < stageQ.length; i++) if (!gl.getQueryParameter(stageQ[i][1], gl.QUERY_RESULT_AVAILABLE)) return null;
    for (i = 0; i < stageQ.length; i++) { q = stageQ[i]; out[q[0]] = (out[q[0]] || 0) + gl.getQueryParameter(q[1], gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q[1]); }
    stageQ = [];
    return out;
  },

  get lights() { return lastLights; },

  setTarget: function (t) { camTarget = t; },
  get sun() { return SUN; },   // a page that wants its subject lit has to know where the light is
  setRadPow: function (e) { radPow = e; },
  setMaxPoint: function (px) { maxPoint = px > 0 ? Math.min(px, MAX_POINT) : MAX_POINT; },
  setPalette: function (p) { for (var i = 0; i < p.length && i < 8; i++) pal.set(p[i], i * 3); },
  // what the page's bodies are to the picture — see LK
  setLook: function (o) {
    if (o.balls !== undefined) LK.balls = !!o.balls;
    if (o.detail !== undefined) LK.detail = o.detail;
    if (o.metal) { LK.metal.fill(0); for (var i = 0; i < o.metal.length && i < 8; i++) LK.metal[i] = o.metal[i]; }
  },
  clampDist: function (lo, hi) { distMin = lo; distMax = hi; cam.dist = Math.max(lo, Math.min(hi, cam.dist)); },
  // the drift: a script that places the camera wants it to stay put
  get touched() { return touched; }, set touched(v) { touched = !!v; }

};

})();
