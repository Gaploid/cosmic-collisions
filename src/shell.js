// The shell every scenario page starts from: the GL context and the fallback
// when there is none, what the device is, the look of the heat, and the one
// place the run's shared state lives.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});

var $ = function (id) { return document.getElementById(id); };
function fail(msg) { var f = $('fallback'); f.innerHTML = msg; f.style.display = 'flex'; }

// ---------- what the device is ----------
// A phone has a tenth of a desktop's GPU behind a screen a fifth the size, so
// it gets the same collision at a quarter of the particles — 33k still
// splashes, still throws a disk, still gathers a moon — drawn at fewer pixels
// than its 3× display asks for. Anyone who wants to push their phone has the
// slider. A coarse pointer with a short side under 550 points is a phone; a
// coarse pointer with more is a tablet, and takes the step above.
var COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
var SHORT_SIDE = Math.min(screen.width || 9999, screen.height || 9999);
var PHONE = COARSE && SHORT_SIDE <= 550, TABLET = COARSE && !PHONE;
// the same short screen the CSS lays out for: the report drops its books there
var narrowMQ = typeof matchMedia === 'function' ? matchMedia('(max-width: 640px), (max-height: 560px)') : null;
var dev = {
  PHONE: PHONE, TABLET: TABLET,
  DPR_CAP: PHONE ? 1.25 : 1.5,      // a million half-float pixels an iPhone does not need
  BLUR_PASSES: PHONE ? 2 : 4,       // the bilateral blur, x then y — twice over where there is room for it
  ANALYZE_EVERY: PHONE ? 90 : 45,   // frames between looks: the read-back and the sort cost a phone more
  DEFAULT_N: PHONE ? 1 : TABLET ? 2 : 3,
  compact: !!(narrowMQ && narrowMQ.matches)
};
if (narrowMQ) {
  var onNarrow = function (e) { dev.compact = e.matches; };
  if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', onNarrow); else narrowMQ.addListener(onNarrow);
}

// the look of the heat: the glow's brightness scale and white point in K,
// what blooms (brighter than this), and how much of the halo is laid back;
// then the film: filmic 0 is the old 1 − e^−x, anything else the ACES fit
// with that much gain in front; vignette is how dark the corners go; the
// sun's disk radius in radians, its brightness and its glare; fxaa on or off.
// Then the silhouette: the coverage a packed skin is cut back to and how soft
// its last pixel is, and how fat a packed particle draws
var LOOK = { glowT: 12000, white: 40000, bloomThr: 1.0, bloomK: 0.3, magma: 20, reach: 2.0,
             filmic: 0.7, vignette: 0.35, sunR: 0.006, sunI: 40, halo: 1.0, fxaa: 1, edge: 0.88, edgeSoft: 0.1, fat: 1.3 };
// magma: the hot bodies' light on what is next to them, in their own
// brightness — the real figure is a hundred, a 3000 K surface outshines the
// sun that much at these distances, but the glow is compressed for the eye
// and its light with it; reach: in radii, how far it carries before the
// inverse square takes over
// the glow's colour and brightness, the same curve as GLSL_GLOW
function glowCol(T) {
  var c = function (x) { return Math.min(1, Math.max(0, x)); };
  var k = 2.5 * (1 - Math.exp(-Math.pow(Math.max(T - 800, 0) / LOOK.glowT, 1.3)));
  return [k, k * Math.pow(c((T - 950) / (LOOK.white - 950)), 0.6), k * Math.pow(c((T - 1900) / (LOOK.white - 1900)), 2.0)];
}

// ---------- the run's shared state ----------
// Two things more than one module both reads and writes, so they live in one
// object rather than in anybody's closure.
var run = { paused: false, lost: false };
// The sim and the report have a single writer each and readers everywhere.
// Rather than reach through an object for them on every line, each module
// keeps its own handle and the writer hands the new one round.
var simTaps = [], repTaps = [];
function onSim(fn) { simTaps.push(fn); }
function setSim(s) { for (var i = 0; i < simTaps.length; i++) simTaps[i](s); }
function onReport(fn) { repTaps.push(fn); }
function setReport(r) { for (var i = 0; i < repTaps.length; i++) repTaps[i](r); }

// The context, the two extensions the physics cannot do without, and the
// answer when a phone takes the context away. Null means the page should stop.
function boot() {
  var canvas = $('stage');
  var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) { fail('WebGL 2 is not available in this browser —<br>the simulation cannot run.'); return null; }
  if (!gl.getExtension('EXT_color_buffer_float')) { fail('This GPU cannot render to float textures —<br>the simulation cannot run.'); return null; }
  // the mesh deposit adds hundreds of contributions into a cell by blending: in
  // half floats the small ones are lost once the sum passes a thousand (2 % of
  // the mass, measured), so it blends in full floats where the GPU allows
  var floatBlend = !!gl.getExtension('EXT_float_blend');
  // A phone drops the GL context when it is backgrounded or when memory runs
  // short. Taking the event is what lets the browser hand one back; the state
  // behind it — every texture, every program, the run itself — went with it,
  // so the page starts over rather than draw into nothing.
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    run.lost = true;
    fail('The graphics context was lost —<br>restoring…');
  });
  canvas.addEventListener('webglcontextrestored', function () { location.reload(); });
  return { gl: gl, canvas: canvas, floatBlend: floatBlend };
}

CC.$ = $;
CC.fail = fail;
CC.dev = dev;
CC.look = LOOK;
CC.glowCol = glowCol;
CC.FOV = 38 * Math.PI / 180;
CC.SLOTS = 8;                                          // body-particles a contact cell can hold
CC.N_CHOICES = [16384, 32768, 65536, 131072, 262144];
CC.N_LABELS = ['16k', '33k', '65k', '131k', '262k'];
CC.run = run;
CC.onSim = onSim; CC.setSim = setSim;
CC.onReport = onReport; CC.setReport = setReport;
CC.boot = boot;
})();
