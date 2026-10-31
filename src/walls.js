import * as THREE from 'three';

// Wall finishes, generated once on the GPU into high-resolution textures:
//   map        base color (linear)
//   normalMap  surface relief (finite differences of a height field)
//   roughMap   roughness in G (the clear coat's, for wood)
// The wall is WALL.width x WALL.height world units (1 unit ~ 4 cm); one texture
// spans it and repeats in Y for very tall (portrait) screens.
export const WALL = { width: 64, height: 32 };

// Per finish: material settings, the color behind the wall, and the gallery light.
export const WALLS = {
  wood: {
    background: 0x8a7458,
    light: 0xffe2c0,
    wrapT: THREE.RepeatWrapping,
    material: { roughness: 2.6, clearcoat: 1, clearcoatRoughness: 1, clearcoatNormalScale: new THREE.Vector2(0.8, 0.8) },
  },
  paint: {
    background: 0xe4e2dd,
    light: 0xfff3e6,
    wrapT: THREE.MirroredRepeatWrapping,
    material: { roughness: 1 },
  },
  concrete: {
    background: 0x8c8a86,
    light: 0xfff1e2,
    wrapT: THREE.MirroredRepeatWrapping,
    material: { roughness: 1 },
  },
};

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform int uMode;
uniform vec2 uTexel; // world units per texel

const vec2 SIZE = vec2(${WALL.width.toFixed(1)}, ${WALL.height.toFixed(1)});

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

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Scratches: random segments per cell, checked over neighbours.
float scratches(vec2 p, float cell, int s, float density, float maxLen, float width) {
  vec2 g = floor(p / cell);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = ivec2(g) + ivec2(i, j);
    for (int k = 0; k < 2; k++) {
      int sk = s + k * 31;
      if (h1(c, sk) > density) continue;
      vec2 o = (vec2(c) + h2(c, sk + 3)) * cell;
      // Mostly near-horizontal, like things dragged along a wall.
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

// Round marks scattered over cells: returns summed Gaussian bumps of radius rMin..rMax.
float spots(vec2 p, float cell, int s, float density, float rMin, float rMax) {
  vec2 g = floor(p / cell);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = ivec2(g) + ivec2(i, j);
    if (h1(c, s) > density) continue;
    vec2 o = (vec2(c) + h2(c, s + 3)) * cell;
    float r = mix(rMin, rMax, pow(h1(c, s + 5), 2.0));
    float d = length(p - o) / r;
    m += exp(-d * d) * (0.4 + 0.6 * h1(c, s + 9));
  }
  return m;
}
`;

const WOOD = /* glsl */ `
const float ROWS = 11.0;
const float PH = SIZE.y / ROWS;

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

struct Wood { float grain; float fibers; float pores; float fleck; float curl; float mineral; float knot; float stain; float edge; Board b; };

Wood woodAt(vec2 p) {
  Wood w;
  Board b = boardAt(p);
  w.b = b;
  int s = int(b.seed * 100000.0);
  vec2 l = b.local;
  // Pin knots on some boards: a dark core the growth rings bend around.
  w.knot = 0.0;
  float bend = 0.0;
  for (int k = 0; k < 2; k++) {
    if (h1(ivec2(s, 60 + k), 61) > 0.45) continue;
    vec2 kc = vec2(b.len * (0.1 + 0.8 * h1(ivec2(s, 62 + k), 63)), PH * (0.2 + 0.6 * h1(ivec2(s, 64 + k), 65)));
    float r = 0.06 + 0.12 * h1(ivec2(s, 66 + k), 67);
    float d = length((l - kc) * vec2(0.45, 1.0)) / r;
    w.knot = max(w.knot, exp(-d * d * 1.5));
    bend += 2.5 * exp(-d * 0.35) * sign(l.y - kc.y);
  }
  // Flat-sawn growth rings: long gentle arches distorted by low-frequency noise.
  float warp = fbm(vec2(l.x * 0.05, l.y * 0.35), s, 4);
  float arch = pow(abs(l.x / b.len - 0.5 - (b.seed - 0.5) * 0.4) * 2.0, 2.0) * 3.0;
  float rings = (l.y + b.seed * 40.0) * (1.4 + b.seed) + warp * 7.0 - arch + bend;
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
  // Uneven aging: blotchy discoloration under the finish.
  w.stain = smoothstep(0.55, 0.85, fbm(p * vec2(0.18, 0.3), 71, 4));
  // Distance to the plank's edges (row seam and butt joints).
  w.edge = min(min(l.y, PH - l.y), min(l.x, b.len - l.x));
  return w;
}

float scratchBig(vec2 p) { return scratches(p, 0.9, 101, 0.4, 1.6, 0.010); }
float scratchFine(vec2 p) { return scratches(p, 0.3, 211, 0.3, 0.4, 0.005); }
float dings(vec2 p) { return spots(p, 1.1, 307, 0.3, 0.015, 0.09); }

float height(vec2 p) {
  Wood w = woodAt(p);
  float ly = w.b.local.y / PH;
  float cup = (1.0 - pow((ly - 0.5) * 2.0, 2.0)) * 0.012;
  float bevel = -0.03 * (1.0 - smoothstep(0.0, 0.045, w.edge));
  // Neighbouring boards never sit perfectly flush.
  float h = cup + bevel + (w.b.seed - 0.5) * 0.006;
  h += (w.fibers - 0.5) * 0.0014 - w.pores * 0.0025 + w.curl * 0.0006 - w.knot * 0.002;
  // Finish: orange peel and sanding swirls.
  h += (vnoise(p * 45.0, 501) - 0.5) * 0.0005 + (fbm(p * vec2(9.0, 6.0), 503, 2) - 0.5) * 0.0008;
  h -= scratchBig(p) * 0.0035 + scratchFine(p) * 0.0018;
  h -= dings(p) * 0.004;
  // Chipped edges at the seams.
  h -= spots(p, 0.5, 331, 0.5, 0.02, 0.06) * 0.006 * (1.0 - smoothstep(0.0, 0.12, w.edge));
  return h;
}

vec3 albedo(vec2 p) {
  Wood w = woodAt(p);
  float bs = w.b.seed;
  // Hard maple under a slightly amber clear coat (sRGB).
  vec3 base = mix(vec3(0.84, 0.69, 0.49), vec3(0.76, 0.59, 0.40), bs);
  base *= 0.93 + 0.12 * h1(ivec2(int(bs * 1000.0), 4), 41);
  float streaks = fbm(vec2(w.b.local.x * 0.08, w.b.local.y * 3.0), int(bs * 9999.0), 4);
  vec3 c = base * (0.9 + 0.16 * streaks);
  c = mix(c, c * vec3(0.86, 0.78, 0.66), w.grain * 0.55);
  c *= 0.97 + 0.06 * w.fibers;
  c = mix(c, c * vec3(0.92, 0.84, 0.74), w.fleck * 0.25);
  c *= 1.0 - w.pores * 0.05;
  c *= 1.0 + w.curl * 0.035;
  c = mix(c, vec3(0.52, 0.47, 0.40), w.mineral * 0.5);
  c = mix(c, vec3(0.30, 0.20, 0.12), w.knot * 0.8);
  c = mix(c, c * vec3(0.9, 0.82, 0.72), w.stain * 0.35);
  // Seams read darker; scratches and dings bruise the finish lighter.
  c *= mix(0.45, 1.0, smoothstep(0.0, 0.05, w.edge));
  c = mix(c, vec3(0.96, 0.93, 0.88), clamp(scratchBig(p) * 0.1 + dings(p) * 0.06, 0.0, 1.0));
  return c;
}

float roughness(vec2 p) {
  // Clear coat: satin and glossy areas, smudges, wipe marks; damage scatters light.
  float satin = smoothstep(0.4, 0.75, fbm(p * vec2(0.12, 0.2), 413, 4));
  float smudge = fbm(p * vec2(0.9, 1.4), 401, 5);
  float wipes = fbm(vec2(p.x * 0.08, p.y * 1.2), 409, 4);
  float r = 0.1 + 0.16 * satin + 0.06 * smoothstep(0.5, 0.8, smudge) + 0.06 * wipes;
  r += (vnoise(p * 30.0, 417) - 0.5) * 0.04;
  r += scratchBig(p) * 0.35 + scratchFine(p) * 0.2 + dings(p) * 0.15;
  return r;
}
`;

const PAINT = /* glsl */ `
// Gallery drywall in flat white: roller stipple, taped joints every ~1.2 m,
// filled nail holes that flash slightly, and the odd faint scuff.
float jointDist(vec2 p) { return abs(mod(p.x - 2.0, 30.0) - 15.0); }
float patches(vec2 p) { return spots(p, 5.0, 601, 0.25, 0.12, 0.5); }
float scuffs(vec2 p) { return scratches(p, 3.0, 611, 0.12, 1.2, 0.02); }

float height(vec2 p) {
  float h = (fbm(p * 0.08, 621, 4) - 0.5) * 0.02;           // the wall is never truly flat
  h += exp(-pow((15.0 - jointDist(p)) / 0.9, 2.0)) * 0.004; // feathered joint compound
  h += (fbm(p * 22.0, 623, 3) - 0.5) * 0.0018;              // roller stipple
  h += (vnoise(p * 90.0, 627) - 0.5) * 0.0005;
  h += patches(p) * 0.0015;
  h -= scuffs(p) * 0.0015;
  return h;
}

vec3 albedo(vec2 p) {
  vec3 c = vec3(0.925, 0.92, 0.9);
  c *= 1.0 + (fbm(p * 0.1, 631, 4) - 0.5) * 0.025 + (fbm(p * 1.5, 633, 3) - 0.5) * 0.012;
  c = mix(c, vec3(0.6, 0.6, 0.6), scuffs(p) * 0.08);
  c = mix(c, vec3(0.95, 0.945, 0.93), clamp(patches(p), 0.0, 1.0) * 0.3);
  return c;
}

float roughness(vec2 p) {
  float r = 0.82 + (fbm(p * 0.6, 641, 3) - 0.5) * 0.08;
  r -= clamp(patches(p), 0.0, 1.0) * 0.12;                   // flashing over filler
  r -= exp(-pow((15.0 - jointDist(p)) / 0.9, 2.0)) * 0.04;
  r -= scuffs(p) * 0.2;                                      // burnished scuffs
  return r;
}
`;

const CONCRETE = /* glsl */ `
// Microcement: a thin troweled cement coat, sealed to a satin finish. Seamless,
// built from overlapping arc-shaped trowel sweeps of slightly different tone, with
// fine darker "burn" lines where the trowel edge pressed, soft cloudy color, and
// a sheen that is higher where the strokes were burnished.
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

// Gradient noise (smoother and less grid-aligned than value noise), 0..1.
float gnoise(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a00 = h1(c, s) * 6.2831853, a10 = h1(c + ivec2(1, 0), s) * 6.2831853;
  float a01 = h1(c + ivec2(0, 1), s) * 6.2831853, a11 = h1(c + ivec2(1, 1), s) * 6.2831853;
  float v00 = dot(vec2(cos(a00), sin(a00)), f), v10 = dot(vec2(cos(a10), sin(a10)), f - vec2(1.0, 0.0));
  float v01 = dot(vec2(cos(a01), sin(a01)), f - vec2(0.0, 1.0)), v11 = dot(vec2(cos(a11), sin(a11)), f - vec2(1.0));
  return 0.5 + 0.75 * mix(mix(v00, v10, u.x), mix(v01, v11, u.x), u.y);
}
float gfbm(vec2 p, int s, int oct) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    sum += amp * gnoise(p, s + o * 101);
    norm += amp; amp *= 0.5; p = ROT * p * 2.07 + 13.7;
  }
  return sum / norm;
}

// The topmost trowel sweep covering p. Each sweep is a band along an arc; later
// (higher-priority) sweeps lie over earlier ones.
// Returns: x = tone offset, y = burnish (sheen), z = edge line, w = coverage.
const float CELL = 4.0;
vec4 trowel(vec2 p) {
  vec2 g = floor(p / CELL);
  float best = -1.0;
  vec4 r = vec4(0.0);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    ivec2 c = ivec2(g) + ivec2(i, j);
    for (int k = 0; k < 2; k++) {
      int s = 801 + k * 37;
      vec2 o = (vec2(c) + h2(c, s)) * CELL;                   // a point on the sweep
      float R = 3.0 + 6.0 * h1(c, s + 3);                     // arc radius
      float dir = h1(c, s + 5) * 6.2831853;
      vec2 ctr = o - vec2(cos(dir), sin(dir)) * R;            // arc center
      vec2 d = p - ctr;
      float rad = length(d);
      float w = 0.7 + 1.0 * h1(c, s + 7);                     // half width of the trowel band
      if (abs(rad - R) > w + 0.2) continue;                   // cheap reject before the trig
      float span = 0.35 + 0.5 * h1(c, s + 9);                 // half angle swept
      float da = abs(mod(atan(d.y, d.x) - dir + 3.14159265, 6.2831853) - 3.14159265);
      // Wobbly edges: the trowel never runs perfectly true.
      float wob = (gnoise(vec2(atan(d.y, d.x) * R * 0.6, float(k)), s + 11) - 0.5) * 0.35;
      float across = abs(rad - R + wob) / w;
      float along = da * R / (span * R + 0.5);
      float inside = max(across, along);
      if (inside > 1.0) continue;
      float pri = h1(c, s + 13);
      // A soft burnished margin where the trowel's edge pressed; only the
      // topmost sweep shows it, since later passes smooth over earlier ones.
      float e = exp(-pow((1.0 - across) * w / 0.12, 2.0)) * smoothstep(1.0, 0.6, along);
      if (pri > best) {
        best = pri;
        // Sweeps feather out toward their ends, blending into what lies beneath.
        float fade = smoothstep(1.0, 0.3, inside);
        r = vec4((h1(c, s + 15) - 0.5) * fade + r.x * (1.0 - fade), h1(c, s + 17) * fade + r.y * (1.0 - fade), e * fade, 1.0);
      }
    }
  }
  return r;
}

float pinholes(vec2 p) { return spots(p, 0.8, 851, 0.08, 0.01, 0.025); }

float height(vec2 p) {
  vec4 t = trowel(p);
  float h = (gfbm(p * 0.1, 861, 4) - 0.5) * 0.01;            // the substrate is never quite flat
  h += t.x * 0.0012 + t.z * 0.0006;                           // sweep layers and their edge ridges
  h += (gfbm(p * 6.0, 863, 3) - 0.5) * 0.0008;                // fine filler texture
  h += (gnoise(p * 40.0, 865) - 0.5) * 0.0003;
  h -= pinholes(p) * 0.004;
  return h;
}

vec3 albedo(vec2 p) {
  vec4 t = trowel(p);
  float g = 0.6;
  g *= 1.0 + (gfbm(p * 0.05, 871, 5) - 0.5) * 0.3;            // broad clouding
  g *= 1.0 + (gfbm(p * 0.35, 873, 4) - 0.5) * 0.12;
  g *= 1.0 + t.x * 0.13;                                       // each sweep a slightly different tone
  g *= 1.0 - t.z * 0.03;                                       // faint trowel burnish
  g *= 1.0 + (gnoise(p * 30.0, 875) - 0.5) * 0.05 + (gnoise(p * 80.0, 876) - 0.5) * 0.03;
  g *= 1.0 - pinholes(p) * 0.3;
  vec3 c = vec3(g) * vec3(1.0, 0.975, 0.94);                  // warm greige
  return c * mix(vec3(1.0), vec3(0.98, 0.99, 1.02), gfbm(p * 0.04, 877, 3));
}

float roughness(vec2 p) {
  vec4 t = trowel(p);
  // Satin sealer; burnished sweeps and their pressed edges shine more.
  float r = 0.5 - t.y * 0.16 - t.z * 0.12;
  r += (gfbm(p * 0.2, 881, 4) - 0.5) * 0.12;
  return r + pinholes(p) * 0.2;
}
`;

const MAIN = /* glsl */ `
void main() {
  vec2 p = vUv * SIZE;
  if (uMode == 0) {
    outColor = vec4(pow(clamp(albedo(p), 0.0, 1.0), vec3(2.2)), 1.0);
  } else if (uMode == 1) {
    vec2 e = uTexel;
    float hc = height(p);
    float hx = height(p + vec2(e.x, 0.0));
    float hy = height(p + vec2(0.0, e.y));
    vec3 n = normalize(vec3(-(hx - hc) / e.x, -(hy - hc) / e.y, 1.0));
    outColor = vec4(n * 0.5 + 0.5, 1.0);
  } else {
    float r = clamp(roughness(p), 0.0, 1.0);
    outColor = vec4(r, r, r, 1.0);
  }
}
`;

const SOURCES = { wood: WOOD, paint: PAINT, concrete: CONCRETE };

const VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function bake(renderer, material, mode, w, h, wrapT, anisotropy) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT,
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
  return rt;
}

export function createWallTextures(renderer, kind) {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: COMMON + SOURCES[kind] + MAIN,
    uniforms: { uMode: { value: 0 }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });
  // 4096 x 2048 where supported: ~64 texels per world unit, about screen density.
  const w = Math.min(renderer.capabilities.maxTextureSize, 4096);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const wrapT = WALLS[kind].wrapT;
  const targets = [bake(renderer, material, 0, w, w / 2, wrapT, aniso), bake(renderer, material, 1, w, w / 2, wrapT, aniso), bake(renderer, material, 2, w / 2, w / 4, wrapT, aniso)];
  material.dispose();
  return {
    map: targets[0].texture,
    normalMap: targets[1].texture,
    roughMap: targets[2].texture,
    dispose: () => targets.forEach((t) => t.dispose()),
  };
}
