// The picture: the screen-sized targets, the quality governor that shrinks
// them when the frames get dear, the orbit camera, and render() itself.
// Every scenario page draws through this; what differs between them is the
// sim it is handed, never the drawing.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var gl = null, canvas = null, S = null, sim = null, report = null;
var gProg, blurProg, shadeProg, sunProg, brightProg, bloomProg, toneProg, fxaaProg, starProg;
var vao = null, starVao = null, STAR_COUNT = 0, MAX_POINT = 0;
// the two crusts, this scenario's: everything else the palette decides
var COL_TARGET = [1, 1, 1], COL_IMPACTOR = [1, 1, 1];
var lastLights = null;
var DEV = CC.dev, LOOK = CC.look, FOV = CC.FOV, glowCol = CC.glowCol, run = CC.run;
var BLUR_PASSES = DEV.BLUR_PASSES, DPR_CAP = DEV.DPR_CAP;
var MATH = CC.math, perspective = MATH.perspective, lookAt = MATH.lookAt, mul = MATH.mul;
var GLH = CC.gl, floatTex, screenTarget, freeScreen, bloomTarget;
CC.onSim(function (s) { sim = s; });
CC.onReport(function (r) { report = r; });

// ---------- screen-sized targets ----------
var gbuf = null, blurA = null, blurB = null, bloomA = null, bloomB = null, bloomW = 0, bloomH = 0, ldr = null;
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
  if (bloomA) { gl.deleteTexture(bloomA.tex); gl.deleteFramebuffer(bloomA.fbo); gl.deleteTexture(bloomB.tex); gl.deleteFramebuffer(bloomB.fbo); }
  if (ldr) { gl.deleteTexture(ldr.tex); gl.deleteFramebuffer(ldr.fbo); }
  bloomW = Math.ceil(w / 4); bloomH = Math.ceil(h / 4);
  bloomA = bloomTarget(bloomW, bloomH); bloomB = bloomTarget(bloomW, bloomH);
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
var camTarget = [0, 0, 0], camPos = [0, 0, 0];
var pointers = new Map(), pinch0 = 0, dist0 = 0;
// The pointer, the wheel and the pinch. Wired at init(), when there is a
// canvas to wire them to.
function wireCamera() {
  canvas.addEventListener('pointerdown', function (e) {
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
      cam.dist = Math.max(1.5, Math.min(80, dist0 * pinch0 / Math.max(d, 1)));
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
    cam.dist = Math.max(1.5, Math.min(80, cam.dist * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
}

// ---------- drawing ----------
var SUN = (function () { var v = [-0.6, 0.45, 0.6], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
function render() {
  var w = hdr.w, h = hdr.h;
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

  if (sim) {
    // 1. the bodies as sphere impostors: material, heat, depth
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
    gl.uniform1i(g.uPos, 0); gl.uniform1i(g.uVel, 1); gl.uniform1i(g.uAux, 2);
    gl.uniform2i(g.uSize, sim.W, sim.H);
    gl.uniformMatrix4fv(g.uView, false, view);
    gl.uniformMatrix4fv(g.uProj, false, proj);
    gl.uniform1f(g.uRad, sim.a);
    gl.uniform1f(g.uPx, px);
    gl.uniform1f(g.uMaxPt, MAX_POINT);
    gl.uniform1f(g.uFat, LOOK.fat);
    gl.uniform1f(g.uP22, proj[10]);
    gl.uniform1f(g.uP32, proj[14]);
    gl.uniform3fv(g.uCol0, COL_TARGET);
    gl.uniform3fv(g.uCol1, COL_IMPACTOR);
    gl.drawArrays(gl.POINTS, 0, sim.N);

    // 2. bilateral blur, two particles wide, x then y, twice over
    var rpx = sim.a * px / cam.dist * 2.0;
    var taps = Math.max(1, Math.min(12, Math.round(rpx)));
    var b = blurProg.u;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(blurProg.p);
    gl.uniform1i(b.uMat, 0); gl.uniform1i(b.uDep, 1);
    gl.uniform1i(b.uTaps, taps);
    gl.uniform1f(b.uStep, Math.max(1, rpx / taps));
    gl.uniform1f(b.uRange, 4.0 * sim.a);
    gl.uniform2i(b.uRes, w, h);
    var from = gbuf, ping = [blurA, blurB];
    for (var pass = 0; pass < BLUR_PASSES; pass++) {
      var to = ping[pass & 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.mat);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, from.dep);
      gl.uniform2i(b.uDir, 1 - (pass & 1), pass & 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      from = to;
    }
  }

  // 3. compose: the lit skin, then the stars over it
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
    gl.uniform1i(s.uMat, 0); gl.uniform1i(s.uDep, 1); gl.uniform1i(s.uDepRaw, 2);
    gl.uniform2f(s.uInvP, 1 / proj[0], 1 / proj[5]);
    gl.uniform2f(s.uRes, w, h);
    gl.uniform3fv(s.uSunEye, sunEye);
    gl.uniform1f(s.uGlow, S.glow);
    gl.uniform1f(s.uGlowT, LOOK.glowT); gl.uniform1f(s.uWhite, LOOK.white);
    // the hot bodies as lights: the planet and the second body, where the
    // last report put them plus their drift since, shining with the glow of
    // their surface temperature — brighter than the sun on anything near
    var nl = 0, lp = [0, 0, 0, 0, 0, 0], lc = [0, 0, 0, 0, 0, 0], lr = [1, 1], no = 0, occ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (report && report.Tsurf !== undefined && sim.phase === 'full') {
      var lag = sim.t - (report.t || sim.t), bodies = [report];
      if (report.second && report.second.com) bodies.push(report.second);
      var toEye = function (x, y, z) {
        return [view[0] * x + view[4] * y + view[8] * z + view[12], view[1] * x + view[5] * y + view[9] * z + view[13], view[2] * x + view[6] * y + view[10] * z + view[14]];
      };
      var occlude = function (c, r) { occ[no * 4] = c[0]; occ[no * 4 + 1] = c[1]; occ[no * 4 + 2] = c[2]; occ[no * 4 + 3] = r; no++; };
      bodies.forEach(function (b) {
        var e = toEye(b.com[0] + b.vel[0] * lag, b.com[1] + b.vel[1] * lag, b.com[2] + b.vel[2] * lag);
        occlude(e, b.R);                                  // every body shadows the other's light
        if (b.Tsurf < 900) return;
        lp[nl * 3] = e[0]; lp[nl * 3 + 1] = e[1]; lp[nl * 3 + 2] = e[2];
        var c = glowCol(b.Tsurf), k = S.glow * LOOK.magma * (1 + LOOK.reach * LOOK.reach);
        lc[nl * 3] = c[0] * k; lc[nl * 3 + 1] = c[1] * k; lc[nl * 3 + 2] = c[2] * k;
        lr[nl] = b.R * b.R;
        nl++;
      });
      // the impactor, while its material is still a ball inside the merged
      // group — the first hour, before it is smeared over the planet — is a
      // ball in the planet's light too: it hides the planet from its own
      // far side, and from what the contact throws off it
      if (report.impMass > 0.003) {
        var ri = Math.cbrt(report.impMass / S.dens);
        if (report.impRms < 1.3 * 0.775 * ri) occlude(toEye(report.impCom[0] + report.vel[0] * lag, report.impCom[1] + report.vel[1] * lag, report.impCom[2] + report.vel[2] * lag), ri);
      }
    }
    gl.uniform1i(s.uNO, no); gl.uniform4fv(s['uOcc[0]'], occ);
    lastLights = { nl: nl, lp: lp.slice(), lc: lc.slice(), lr: lr.slice(), eye: eye.slice(), view: Array.from(view), loc: [s['uLPos[0]'], s['uLCol[0]'], s['uLR2[0]'], s.uNL] };
    gl.uniform1i(s.uNL, nl);
    gl.uniform3fv(s['uLPos[0]'], lp); gl.uniform3fv(s['uLCol[0]'], lc); gl.uniform1fv(s['uLR2[0]'], lr);
    gl.uniform1f(s.uReach2, LOOK.reach * LOOK.reach);
    gl.uniform1f(s.uEdge, LOOK.edge); gl.uniform1f(s.uEdgeSoft, LOOK.edgeSoft); gl.uniform1f(s.uRad, sim.a);
    gl.uniform1f(s.uDbg, LOOK.dbg || 0);
    gl.uniform1f(s.uP22, proj[10]);
    gl.uniform1f(s.uP32, proj[14]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }
  gl.depthFunc(gl.LESS);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  if (LOOK.sunI > 0 && sunEye[2] < 0) {           // the sun is ahead of the camera
    var su = sunProg.u;
    gl.useProgram(sunProg.p);
    gl.uniform2f(su.uRes, w, h);
    gl.uniform2f(su.uInvP, 1 / proj[0], 1 / proj[5]);
    gl.uniform3fv(su.uSunEye, sunEye);
    gl.uniform1f(su.uSunR, LOOK.sunR); gl.uniform1f(su.uSunI, LOOK.sunI); gl.uniform1f(su.uHalo, LOOK.halo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
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
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  // 4. bloom: the bright part at a quarter size, a narrow blur then a wide one
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

  // 5. the film: tone map with the vignette, then FXAA on the way to the screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, ldr.fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(toneProg.p);
  var dbg = window.DBG | 0;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dbg === 1 ? gbuf.dep : dbg === 2 ? blurA.dep : dbg === 3 ? blurB.dep : hdr.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
  gl.uniform1i(toneProg.u.uHdr, 0); gl.uniform1i(toneProg.u.uBloom, 1);
  gl.uniform2f(toneProg.u.uInvRes, 1 / w, 1 / h);
  gl.uniform1f(toneProg.u.uBloomK, LOOK.bloomK);
  gl.uniform1f(toneProg.u.uDbg, dbg ? 1 : 0);
  gl.uniform1f(toneProg.u.uExposure, S.exposure);
  gl.uniform1f(toneProg.u.uFilmic, LOOK.filmic);
  gl.uniform1f(toneProg.u.uVig, dbg ? 0 : LOOK.vignette);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(fxaaProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ldr.tex);
  gl.uniform1i(fxaaProg.u.uSrc, 0);
  gl.uniform2f(fxaaProg.u.uInvRes, 1 / w, 1 / h);
  gl.uniform1f(fxaaProg.u.uOn, dbg ? 0 : LOOK.fxaa);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

CC.view = {

  init: function (o) {

    gl = o.gl; canvas = o.canvas; S = o.S;
    COL_TARGET = o.cols[0]; COL_IMPACTOR = o.cols[1];

    floatTex = GLH.floatTex; screenTarget = GLH.screenTarget; freeScreen = GLH.freeScreen; bloomTarget = GLH.bloomTarget;

    vao = GLH.vao; MAX_POINT = GLH.MAX_POINT;

    starVao = o.starVao; STAR_COUNT = o.starCount;

    gProg = o.progs.g; blurProg = o.progs.blur; shadeProg = o.progs.shade; sunProg = o.progs.sun;

    brightProg = o.progs.bright; bloomProg = o.progs.bloom; toneProg = o.progs.tone;

    fxaaProg = o.progs.fxaa; starProg = o.progs.star;

    hdr.fbo = gl.createFramebuffer(); hdr.depth = gl.createRenderbuffer();
    wireCamera();

  },

  render: render, resize: resize, governQuality: governQuality,

  cam: cam,

  get hdr() { return hdr; },

  get lights() { return lastLights; },

  setTarget: function (t) { camTarget = t; }

};

})();
