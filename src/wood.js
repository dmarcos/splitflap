import * as THREE from 'three';

// Maple plank wall, generated once on the GPU into high-resolution textures:
//   map        base color (linear)
//   normalMap  plank cupping, bevels, grain, pores, curly figure, scratches, dents
//   coatMap    clear-coat roughness in G (smudges, wipe marks, scratches)
// The wall is WALL.width x WALL.height world units; one texture spans it, and the
// planks tile seamlessly in Y for very tall (portrait) screens.
export const WALL = { width: 64, height: 32 };

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform int uMode;
uniform vec2 uTexel; // world units per texel

const vec2 SIZE = vec2(${WALL.width.toFixed(1)}, ${WALL.height.toFixed(1)});
const float ROWS = 11.0;
const float PH = SIZE.y / ROWS;

uint hash(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float h1(ivec2 c, int s) { return float(hash(uvec3(ivec3(c, s)))) * (1.0 / 4294967295.0); }
vec2 h2(ivec2 c, int s) { return vec2(h1(c, s), h1(c, s + 7919)); }

float vnoise(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a = h1(c, s), b = h1(c + ivec2(1, 0), s), d = h1(c + ivec2(0, 1), s), e = h1(c + ivec2(1, 1), s);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
float fbm(vec2 p, int s, int oct) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    sum += amp * vnoise(p, s + o * 101);
    norm += amp; amp *= 0.5; p = p * 2.03 + 17.1;
  }
  return sum / norm;
}

struct Board { float row; float id; vec2 local; float len; float seed; };

Board boardAt(vec2 p) {
  Board b;
  b.row = floor(p.y / PH);
  int rowMod = int(mod(b.row, ROWS)); // wraps vertically
  b.len = 15.0 + 16.0 * h1(ivec2(rowMod, 5), 13);
  float off = h1(ivec2(rowMod, 3), 11) * b.len;
  b.id = floor((p.x + off) / b.len);
  b.local = vec2(p.x + off - b.id * b.len, p.y - b.row * PH);
  b.seed = h1(ivec2(rowMod, int(b.id) + 50), 17);
  return b;
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Scratches in the finish: random segments per cell, checked over neighbours.
float scratches(vec2 p, float cell, int s, float density, float maxLen, float width) {
  vec2 g = floor(p / cell);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = ivec2(g) + ivec2(i, j);
    for (int k = 0; k < 2; k++) {
      int sk = s + k * 31;
      if (h1(c, sk) > density) continue;
      vec2 o = (vec2(c) + h2(c, sk + 3)) * cell;
      // Mostly near-horizontal wipes, like things dragged along a wall.
      float ang = mix(h1(c, sk + 5) * 6.2831, (h1(c, sk + 9) - 0.5) * 0.5, 0.55);
      float len = maxLen * (0.15 + 0.85 * h1(c, sk + 7));
      vec2 d = vec2(cos(ang), sin(ang)) * len * 0.5;
      float w = width * (0.5 + h1(c, sk + 13));
      float dist = segDist(p, o - d, o + d);
      float along = clamp(dot(p - (o - d), d) / dot(d, d) * 0.5, 0.0, 1.0);
      float taper = sin(along * 3.14159);
      m = max(m, (1.0 - smoothstep(0.0, w, dist)) * taper * (0.4 + 0.6 * h1(c, sk + 17)));
    }
  }
  return m;
}

float dents(vec2 p, int s) {
  float cell = 1.6;
  vec2 g = floor(p / cell);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = ivec2(g) + ivec2(i, j);
    if (h1(c, s) > 0.22) continue;
    vec2 o = (vec2(c) + h2(c, s + 3)) * cell;
    float r = 0.02 + 0.07 * h1(c, s + 5);
    float d = length(p - o) / r;
    m += exp(-d * d) * (0.4 + 0.6 * h1(c, s + 9));
  }
  return m;
}

struct Wood { float grain; float fibers; float pores; float fleck; float curl; float mineral; float edge; Board b; };

Wood woodAt(vec2 p) {
  Wood w;
  Board b = boardAt(p);
  w.b = b;
  int s = int(b.seed * 100000.0);
  vec2 l = b.local;
  // Flat-sawn growth rings: long gentle arches distorted by low-frequency noise.
  float warp = fbm(vec2(l.x * 0.05, l.y * 0.35), s, 4);
  float arch = pow(abs(l.x / b.len - 0.5 - (b.seed - 0.5) * 0.4) * 2.0, 2.0) * 3.0;
  float rings = (l.y + b.seed * 40.0) * (1.4 + b.seed) + warp * 7.0 - arch;
  float fr = fract(rings);
  w.grain = smoothstep(0.75, 0.93, fr) * (1.0 - smoothstep(0.93, 1.0, fr)) * (0.4 + 0.6 * fbm(vec2(l.x * 0.3, l.y * 2.0), s + 3, 3));
  w.fibers = fbm(vec2(l.x * 2.0, l.y * 55.0), s + 5, 3);
  // Tiny pores stretched along the grain, clustered rather than evenly sprinkled.
  w.pores = smoothstep(0.88, 0.97, vnoise(vec2(l.x * 28.0, l.y * 300.0), s + 7)) * smoothstep(0.4, 0.8, vnoise(vec2(l.x * 3.0, l.y * 25.0), s + 8));
  w.fleck = smoothstep(0.86, 0.97, vnoise(vec2(l.x * 70.0, l.y * 14.0), s + 9)) * fbm(vec2(l.x * 0.5, l.y * 2.0), s + 10, 2);
  // Curly figure on some boards: ripples across the grain.
  float curly = step(0.6, h1(ivec2(s, 1), 23));
  w.curl = curly * sin(l.x * (9.0 + 6.0 * b.seed) + fbm(vec2(l.x * 0.4, l.y * 1.5), s + 11, 3) * 6.0);
  // Occasional mineral streak running with the grain.
  float hasMin = step(0.75, h1(ivec2(s, 2), 29));
  float my = PH * (0.2 + 0.6 * h1(ivec2(s, 3), 31));
  w.mineral = hasMin * exp(-pow((l.y - my + (fbm(vec2(l.x * 0.15, 0.0), s + 13, 3) - 0.5) * 0.8) / 0.12, 2.0))
            * smoothstep(0.35, 0.7, fbm(vec2(l.x * 0.1, 3.0), s + 14, 3));
  // Distance to the plank's edges (row seam and butt joints).
  w.edge = min(min(l.y, PH - l.y), min(l.x, b.len - l.x));
  return w;
}

float scratchBig(vec2 p) { return scratches(p, 0.9, 101, 0.35, 1.6, 0.010); }
float scratchFine(vec2 p) { return scratches(p, 0.35, 211, 0.25, 0.4, 0.005); }

float heightAt(vec2 p) {
  Wood w = woodAt(p);
  float ly = w.b.local.y / PH;
  float cup = (1.0 - pow((ly - 0.5) * 2.0, 2.0)) * 0.012;
  float bevel = -0.03 * (1.0 - smoothstep(0.0, 0.045, w.edge));
  float h = cup + bevel;
  h += (w.fibers - 0.5) * 0.0012 - w.pores * 0.0025 + w.curl * 0.0006;
  h -= scratchBig(p) * 0.0035 + scratchFine(p) * 0.0018;
  h -= dents(p, 307) * 0.004;
  return h;
}

void main() {
  vec2 p = vUv * SIZE;
  if (uMode == 0) {
    Wood w = woodAt(p);
    float bs = w.b.seed;
    // Hard maple under a slightly amber clear coat (sRGB).
    vec3 base = mix(vec3(0.84, 0.69, 0.49), vec3(0.78, 0.61, 0.41), bs);
    base *= 0.94 + 0.1 * h1(ivec2(int(bs * 1000.0), 4), 41);
    float streaks = fbm(vec2(w.b.local.x * 0.08, w.b.local.y * 3.0), int(bs * 9999.0), 4);
    vec3 c = base * (0.92 + 0.14 * streaks);
    c = mix(c, c * vec3(0.86, 0.78, 0.66), w.grain * 0.55);
    c *= 0.97 + 0.06 * w.fibers;
    c = mix(c, c * vec3(0.92, 0.84, 0.74), w.fleck * 0.25);
    c *= 1.0 - w.pores * 0.05;
    c *= 1.0 + w.curl * 0.035;
    c = mix(c, vec3(0.52, 0.47, 0.40), w.mineral * 0.5);
    // Seams read darker; scratches in the finish read slightly whiter.
    c *= mix(0.45, 1.0, smoothstep(0.0, 0.05, w.edge));
    c = mix(c, vec3(0.96, 0.93, 0.88), scratchBig(p) * 0.08);
    outColor = vec4(pow(c, vec3(2.2)), 1.0);
  } else if (uMode == 1) {
    vec2 e = uTexel;
    float hc = heightAt(p);
    float hx = heightAt(p + vec2(e.x, 0.0));
    float hy = heightAt(p + vec2(0.0, e.y));
    vec3 n = normalize(vec3(-(hx - hc) / e.x, -(hy - hc) / e.y, 1.0));
    outColor = vec4(n * 0.5 + 0.5, 1.0);
  } else {
    // Clear-coat roughness: smudges and wipe marks; scratches scatter light.
    float smudge = fbm(p * vec2(0.9, 1.4), 401, 5);
    float wipes = fbm(vec2(p.x * 0.08, p.y * 1.2), 409, 4);
    float r = 0.08 + 0.05 * smoothstep(0.5, 0.8, smudge) + 0.05 * wipes;
    r += scratchBig(p) * 0.35 + scratchFine(p) * 0.2 + dents(p, 307) * 0.1;
    outColor = vec4(r, r, r, 1.0);
  }
}
`;

const VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function bake(renderer, material, mode, w, h, anisotropy) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.RepeatWrapping,
    anisotropy,
  });
  material.uniforms.uMode.value = mode;
  material.uniforms.uTexel.value.set(WALL.width / w, WALL.height / h);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(prev);
  return rt.texture;
}

export function createWoodTextures(renderer) {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uMode: { value: 0 }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });
  // 4096 x 2048 where supported: ~64 texels per world unit, about screen density.
  const w = Math.min(renderer.capabilities.maxTextureSize, 4096);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const textures = {
    map: bake(renderer, material, 0, w, w / 2, aniso),
    normalMap: bake(renderer, material, 1, w, w / 2, aniso),
    coatMap: bake(renderer, material, 2, w / 2, w / 4, aniso),
  };
  material.dispose();
  return textures;
}
