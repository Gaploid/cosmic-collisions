// Shader snippets every scenario page shares: the hash, the glow of hot rock,
// the material palette, and the vertex shader that covers the screen.
(function () {
'use strict';
var CC = window.CC || (window.CC = {});
var G = CC.glsl || (CC.glsl = {});

// ---------- shaders ----------
var GLSL_HASH = [
  'uint hash(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }',
  'float rnd(uint x) { return float(hash(x)) * (1.0 / 4294967296.0); }'
].join('\n');
// hot rock's own light, by its temperature: the Planckian colour — deep red
// past 900 K, orange by 5000, yellow by 20 000, white past 40 000 — and a
// brightness that climbs with it and levels off: not T⁴, which would burn
// out at 3000 K, but a 5000 K surface matches a sunlit one and a 15 000 K
// one is twice as bright. The material the contact throws out comes off at
// 10 000–40 000 K, the far side of the target sits at 1000: both have to
// read. The knobs are in LOOK.
var GLSL_GLOW = [
  'uniform float uGlowT;',       // the temperature scale of the brightness: 2.5 × (1 − e^−((T−800)/uGlowT)^1.3)
  'uniform float uWhite;',       // where the colour reaches white
  'vec3 glow(float T) {',
  '  vec3 c = vec3(1.0, pow(clamp((T - 950.0) / (uWhite - 950.0), 0.0, 1.0), 0.6), pow(clamp((T - 1900.0) / (uWhite - 1900.0), 0.0, 1.0), 2.0));',   // blue stays out until the green is nearly in: fire, not pink
  '  return c * 2.5 * (1.0 - exp(-pow(max(T - 800.0, 0.0) / uGlowT, 1.3)));',
  '}'
].join('\n');
// What a particle is made of. P.w is the index of its material and the page
// says what the eight of them look like — the giant impact spends six on two
// bodies of core, mantle and crust (w = layer + 4·body, so the impactor's core
// is gold against Earth's silver and can be followed down); the crater spends
// its own on basement, platform, the impactor's melt and the frozen rock that
// stands in for the rest of the world.
var GLSL_MATCOL = [
  'uniform vec3 uPal[8];',
  'vec3 matColor(float w) {',
  '  return uPal[clamp(int(w + 0.5), 0, 7)];',
  '}'
].join('\n');

var QUAD_VS = [
  '#version 300 es',
  'void main() {',
  '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
  '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
  '}'
].join('\n');


G.GLSL_HASH = GLSL_HASH; G.GLSL_GLOW = GLSL_GLOW; G.GLSL_MATCOL = GLSL_MATCOL; G.QUAD_VS = QUAD_VS;

})();
