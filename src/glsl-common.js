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
// what a body-particle is made of, from P.w = layer + 4·body: crust in the
// body's colour, mantle a deep red, core metal — Earth's silver, the
// impactor's gold, so its core can be followed down
var GLSL_MATCOL = [
  'vec3 matColor(float w, vec3 c0, vec3 c1) {',
  '  float body = step(3.5, w), layer = w - 4.0 * body;',
  '  vec3 crust = mix(c0, c1, body);',
  '  vec3 mantle = mix(vec3(0.60, 0.22, 0.17), vec3(0.58, 0.30, 0.14), body);',
  '  vec3 core = mix(vec3(0.86, 0.86, 0.82), vec3(0.88, 0.72, 0.42), body);',
  '  return layer > 1.5 ? crust : (layer > 0.5 ? mantle : core);',
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
