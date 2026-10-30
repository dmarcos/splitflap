import * as THREE from 'three';

// Flap sequence, in the order a module physically cycles through.
export const COLOR_TILES = {
  R: '#d42a20',
  O: '#ef6a1f',
  Y: '#f5b41c',
  G: '#16994a',
  B: '#1672c2',
  V: '#6b2f8b',
  W: '#f3f1ea',
};

export const CHARS = [
  ' ',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$()-+&=;:\'"%,./?°',
  ...Object.keys(COLOR_TILES).map((k) => `{${k}}`),
];
export const CHAR_INDEX = new Map(CHARS.map((c, i) => [c, i]));

export const THEMES = {
  black: { flap: '#141414', ink: '#f2f0e8', scuff: '255,255,255', frame: 0x0c0c0c, slot: 0x050505, wall: 0x8a7458 },
  white: { flap: '#eceae4', ink: '#1c1c1c', scuff: '0,0,0', frame: 0xe6e4de, slot: 0xbdbab3, wall: 0x8a7458 },
};

// Atlas layout: each slot holds one full flap (top + bottom half) plus transparent padding
// so mipmaps never bleed between neighbouring tiles.
const COLS = 8;
const ROWS = Math.ceil(CHARS.length / COLS);
const TW = 192;
const TH = 262; // matches the 1 : 1.36 module aspect
const PAD = 8;
const SW = TW + PAD * 2;
const SH = TH + PAD * 2;
const AW = COLS * SW;
const AH = ROWS * SH;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTile(ctx, x, y, ch, theme, font) {
  const half = TH / 2;
  const color = ch.length === 3 ? COLOR_TILES[ch[1]] : null;

  for (const isTop of [true, false]) {
    const hy = isTop ? y : y + half;
    ctx.save();
    roundRectPath(ctx, x, hy, TW, half, 4);
    ctx.clip();
    ctx.fillStyle = color || theme.flap;
    ctx.fillRect(x, hy, TW, half);
    // Molded-plastic falloff: top leaf brighter at its free edge, bottom leaf shaded under the hinge.
    const g = ctx.createLinearGradient(0, hy, 0, hy + half);
    if (isTop) {
      g.addColorStop(0, 'rgba(255,255,255,0.06)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.0)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
    } else {
      g.addColorStop(0, 'rgba(0,0,0,0.18)');
      g.addColorStop(0.18, 'rgba(0,0,0,0.0)');
      g.addColorStop(1, 'rgba(0,0,0,0.07)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, hy, TW, half);
    // Molded edge catching the light.
    roundRectPath(ctx, x + 1, hy + 1, TW - 2, half - 2, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  if (!color && ch !== ' ') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, TW, TH);
    ctx.clip();
    ctx.fillStyle = theme.ink;
    ctx.font = `600 ${Math.round(TH * 0.68)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const capH = ctx.measureText('H').actualBoundingBoxAscent || TH * 0.42;
    ctx.fillText(ch, x + TW / 2, y + half + capH / 2);
    ctx.restore();
  }
}

// Surface detail in a parallel atlas: R = bump height, G = roughness.
// Satin plastic, slightly raised and smoother printed ink, scuffs and smudges.
function drawSurface(ctx, x, y, ch, font) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, TW, TH);
  ctx.clip();
  ctx.fillStyle = 'rgb(150,150,0)';
  ctx.fillRect(x, y, TW, TH);
  for (const isTop of [true, false]) {
    roundRectPath(ctx, x + 1, (isTop ? y : y + TH / 2) + 1, TW - 2, TH / 2 - 2, 4);
    ctx.strokeStyle = 'rgb(110,150,0)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  for (let k = 0; k < 3; k++) {
    const cx = x + Math.random() * TW;
    const cy = y + Math.random() * TH;
    const r = 20 + Math.random() * 50;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(150,200,0,0.35)');
    g.addColorStop(1, 'rgba(150,200,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  if (ch.length === 1 && ch !== ' ') {
    ctx.fillStyle = 'rgb(178,118,0)';
    ctx.font = `600 ${Math.round(TH * 0.68)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const capH = ctx.measureText('H').actualBoundingBoxAscent || TH * 0.42;
    ctx.fillText(ch, x + TW / 2, y + TH / 2 + capH / 2);
  }
  ctx.restore();
}

// Scuffs from years of leaves rubbing each other: faint in color, grooves in the surface.
function drawWear(ctx, sctx, x, y, theme) {
  const n = 2 + Math.floor(Math.random() * 5);
  for (let k = 0; k < n; k++) {
    const x0 = x + Math.random() * TW;
    const y0 = y + Math.random() * TH;
    const ang = (Math.random() - 0.5) * 0.9 + (Math.random() < 0.7 ? 0 : Math.PI / 2);
    const len = 6 + Math.random() * 70;
    const a = 0.3 + Math.random() * 0.7;
    for (const [c, style, w] of [[ctx, `rgba(${theme.scuff},${0.07 * a})`, 1.2], [sctx, `rgba(125,190,0,${a})`, 1.2]]) {
      c.save();
      c.beginPath();
      c.rect(x, y, TW, TH);
      c.clip();
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      c.strokeStyle = style;
      c.lineWidth = w * (0.5 + Math.random());
      c.lineCap = 'round';
      c.stroke();
      c.restore();
    }
  }
}

// Fine grain so flat colors read as painted plastic rather than CG.
function addGrain(ctx) {
  const img = ctx.getImageData(0, 0, AW, AH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * 10;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

export function createAtlas(theme, font, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = AW;
  canvas.height = AH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const surfCanvas = document.createElement('canvas');
  surfCanvas.width = AW;
  surfCanvas.height = AH;
  const sctx = surfCanvas.getContext('2d');
  CHARS.forEach((ch, i) => {
    const x = (i % COLS) * SW + PAD;
    const y = Math.floor(i / COLS) * SH + PAD;
    drawTile(ctx, x, y, ch, theme, font);
    drawSurface(sctx, x, y, ch, font);
    drawWear(ctx, sctx, x, y, theme);
  });
  addGrain(ctx);

  const toTexture = (c, srgb) => {
    const tex = new THREE.CanvasTexture(c);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
  };
  return { map: toTexture(canvas, true), surface: toTexture(surfCanvas, false) };
}

// Point a 4-vertex PlaneGeometry's UVs at the top or bottom half of a tile.
export function setTileUV(attr, index, isTop) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x0 = col * SW + PAD;
  const y0 = row * SH + PAD;
  const u0 = x0 / AW;
  const u1 = (x0 + TW) / AW;
  const yA = isTop ? y0 : y0 + TH / 2;
  const yB = isTop ? y0 + TH / 2 : y0 + TH;
  const vT = 1 - yA / AH;
  const vB = 1 - yB / AH;
  const a = attr.array;
  a[0] = u0; a[1] = vT;
  a[2] = u1; a[3] = vT;
  a[4] = u0; a[5] = vB;
  a[6] = u1; a[7] = vB;
  attr.needsUpdate = true;
}
