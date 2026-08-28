// The GL the scenarios share: compiling a program, the float textures the
// physics lives in, the framebuffers around them, and the contact grid.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var gl = null, floatBlend = false, SLOTS = 0;

// ---------- GL helpers ----------
function compile(type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}
function program(vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p: p, u: u };
}
function floatTex(w, h, data, internal, type, format) {
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal || gl.RGBA32F, w, h, 0, format || gl.RGBA, type || gl.FLOAT, data || null);
  return t;
}
function simTarget(w, h, pos, vel) {
  var t = { pos: floatTex(w, h, pos), vel: floatTex(w, h, vel), aux: floatTex(w, h, null), q: floatTex(w, h, null, gl.R32F, gl.FLOAT, gl.RED), fbo: gl.createFramebuffer() };
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.pos, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.vel, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t.aux, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, t.q, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('sim framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t;
}
function freeTarget(t) {
  if (!t) return;
  gl.deleteTexture(t.pos); gl.deleteTexture(t.vel); gl.deleteTexture(t.aux); gl.deleteTexture(t.q); gl.deleteFramebuffer(t.fbo);
}

function fboFor(tex, depthRb) {
  var f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('mesh framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return f;
}

// the contact grid: G³ hashed cells, SLOTS seats each, in two RGBA32F
// textures — the even seats in the first, the odd in the second, so that a
// pass that reads the seat before its own never reads the texture it writes.
// A seat is a bit pattern carried in the float: the particle's index in the
// low 18 bits, where it sat in the cell in the 12 above, and a bit that
// keeps the pattern a normal float; −1 is an empty seat (see GLSL_SLOTS)
function makeGrid(G) {
  var SX = G === 128 ? 16 : 8;
  var g = { G: G, SX: SX, GShift: Math.log2(G), SXShift: Math.log2(SX), AW: SX * G, AH: (G / SX) * G, slot: [], fbo: [], depth: gl.createRenderbuffer() };
  gl.bindRenderbuffer(gl.RENDERBUFFER, g.depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, g.AW, g.AH);
  for (var k = 0; k < 2; k++) {
    g.slot.push(floatTex(g.AW, g.AH, null));
    g.fbo.push(fboFor(g.slot[k], g.depth));
  }
  return g;
}
function freeGrid(g) {
  if (!g) return;
  for (var k = 0; k < g.slot.length; k++) { gl.deleteTexture(g.slot[k]); gl.deleteFramebuffer(g.fbo[k]); }
  gl.deleteRenderbuffer(g.depth);
}

// ---------- screen-sized targets ----------
// material + depth + home triples for the body passes, and the HDR canvas
// everything is composed into before tone mapping
function screenTarget(w, h, withDepth) {
  // the home field in full floats: close in, a pixel's step in it is a
  // quarter of a half-float's quantum, and the relief, which is its screen
  // derivative, came out as terraces
  var t = { fbo: gl.createFramebuffer(), mat: floatTex(w, h, null, gl.RGBA16F, gl.HALF_FLOAT), dep: floatTex(w, h, null, gl.RG32F, gl.FLOAT, gl.RG),
            home: floatTex(w, h, null), rb: null };
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.mat, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.dep, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t.home, 0);
  if (withDepth) {
    t.rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.rb);
  }
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('screen framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t;
}
function freeScreen(t) {
  if (!t) return;
  gl.deleteTexture(t.mat); gl.deleteTexture(t.dep); gl.deleteTexture(t.home); gl.deleteFramebuffer(t.fbo);
  if (t.rb) gl.deleteRenderbuffer(t.rb);
}
// the bloom's pair, a quarter of the canvas each way, filtered so the taps
// can fall between texels; and, in bytes, the tone-mapped frame FXAA reads
function bloomTarget(w, h, bytes) {
  var t = { fbo: gl.createFramebuffer(), tex: bytes ? floatTex(w, h, null, gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA) : floatTex(w, h, null, gl.RGBA16F, gl.HALF_FLOAT) };
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('bloom framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t;
}

// The context arrives once, from CC.boot(); everything above closes over it.

CC.gl = {

  init: function (boot) {

    gl = boot.gl; floatBlend = boot.floatBlend; SLOTS = CC.SLOTS;

    CC.gl.vao = gl.createVertexArray();

    gl.bindVertexArray(CC.gl.vao);   // attribute-less drawing: every vertex is made from gl_VertexID

    CC.gl.MAX_POINT = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];

  },

  vao: null, MAX_POINT: 0,

  compile: compile, program: program, floatTex: floatTex, simTarget: simTarget, freeTarget: freeTarget,

  fboFor: fboFor, makeGrid: makeGrid, freeGrid: freeGrid,

  screenTarget: screenTarget, freeScreen: freeScreen, bloomTarget: bloomTarget

};

})();
