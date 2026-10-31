import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CHARS, setTileUV } from './atlas.js';

// Module geometry (world units). Each module is two leaves split at a hinge.
const W = 1;
const H = 1.36;
const GAP = 0.026;
const HH = (H - GAP) / 2;
const SX = 1.14; // column pitch
const SY = 1.56; // row pitch
export const PITCH = { x: SX, y: SY };
const N = CHARS.length;
const BOUNCE_MS = 170;
// The lower leaf hangs slightly forward of vertical, so the halves catch light differently.
const TILT = 0.07;
const END = Math.PI - TILT;

// Satin painted-metal roughness with fingerprints and wipe marks, shared by the housing.
let housingRoughness = null;
function getHousingRoughness() {
  if (housingRoughness) return housingRoughness;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(0,120,0)';
  ctx.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 140; k++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 6 + Math.random() * 60;
    const v = Math.random() < 0.5 ? 90 : 170;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,${v},0,${0.15 + Math.random() * 0.25})`);
    g.addColorStop(1, `rgba(0,${v},0,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  housingRoughness = new THREE.CanvasTexture(c);
  housingRoughness.wrapS = housingRoughness.wrapT = THREE.RepeatWrapping;
  return housingRoughness;
}

function halfGeometry(isTop) {
  const g = new THREE.PlaneGeometry(W, HH);
  g.translate(0, (isTop ? 1 : -1) * (HH / 2 + GAP / 2), 0);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12).fill(1), 3));
  return g;
}

class Module {
  constructor(board, row, col, x, y) {
    this.row = row;
    this.col = col;
    this.cur = 0;
    this.next = 0;
    this.target = 0;
    this.flipping = false;
    this.t = 0;
    this.dur = 70;
    this.delay = 0;
    this.bounceT = -1;
    // Every physical module is slightly different: brightness, speed, alignment.
    this.tint = 0.92 + Math.random() * 0.08;
    this.pace = 0.88 + Math.random() * 0.24;

    const mat = board.material;
    this.group = new THREE.Group();
    this.group.position.set(x + (Math.random() - 0.5) * 0.008, y + (Math.random() - 0.5) * 0.008, 0);
    this.group.rotation.z = (Math.random() - 0.5) * 0.004;

    // Static leaves: the top of the next character, the bottom of the current one.
    this.top = new THREE.Mesh(halfGeometry(true), mat);
    this.bot = new THREE.Mesh(halfGeometry(false), mat);
    this.bot.rotation.x = -TILT;

    // The falling leaf: front shows the current top, back shows the next bottom.
    this.pivot = new THREE.Group();
    this.pivot.position.z = 0.006;
    this.front = new THREE.Mesh(halfGeometry(true), mat);
    this.front.position.z = 0.0015;
    this.back = new THREE.Mesh(halfGeometry(false), mat);
    this.back.rotation.x = Math.PI;
    this.back.position.z = -0.0015;
    this.pivot.add(this.front, this.back);

    this.group.add(this.top, this.bot, this.pivot);
    for (const m of [this.top, this.bot, this.front, this.back]) m.receiveShadow = true;
    board.group.add(this.group);

    for (const m of [this.top, this.front]) setTileUV(m.geometry.attributes.uv, 0, true);
    for (const m of [this.bot, this.back]) setTileUV(m.geometry.attributes.uv, 0, false);
    for (const m of [this.front, this.back]) this.shade(m, 1, 1);
    this.resetShade();
  }

  shade(mesh, a, b) {
    const attr = mesh.geometry.attributes.color;
    const c = attr.array;
    const ta = a * this.tint;
    const tb = b * this.tint;
    c.fill(ta, 0, 6);
    c.fill(tb, 6, 12);
    attr.needsUpdate = true;
  }

  resetShade() {
    this.shade(this.top, 1, 1);
    this.shade(this.bot, 1, 1);
  }

  // Fake contact shadows cast by the moving leaf onto the static ones.
  shadeFor(th) {
    const c = Math.max(0, Math.cos(th));
    const s = Math.sin(th);
    this.shade(this.top, 1 - 0.2 * c, 1 - 0.55 * c);
    const sb = th > Math.PI / 2 ? s * 0.9 : s * 0.55;
    this.shade(this.bot, 1 - 0.6 * sb, 1 - 0.22 * sb);
  }

  begin(flapMs) {
    this.bounceT = -1;
    this.next = (this.cur + 1) % N;
    setTileUV(this.top.geometry.attributes.uv, this.next, true);
    setTileUV(this.front.geometry.attributes.uv, this.cur, true);
    setTileUV(this.back.geometry.attributes.uv, this.next, false);
    this.flipping = true;
    this.t = 0;
    this.dur = flapMs * this.pace * (0.92 + Math.random() * 0.16);
  }

  land(events) {
    this.cur = this.next;
    this.flipping = false;
    setTileUV(this.bot.geometry.attributes.uv, this.cur, false);
    setTileUV(this.front.geometry.attributes.uv, this.cur, true);
    const final = this.cur === this.target;
    events.push({ col: this.col, final });
    if (final) {
      this.bounceT = 0;
    } else {
      this.pivot.rotation.x = 0;
      this.resetShade();
    }
  }

  step(dt, flapMs, events) {
    let active = false;

    if (this.bounceT >= 0) {
      this.bounceT += dt;
      if (this.bounceT >= BOUNCE_MS || this.cur !== this.target) {
        this.bounceT = -1;
        this.pivot.rotation.x = 0;
        this.resetShade();
      } else {
        // The leaf rebounds off the stop a couple of times before resting.
        const p = this.bounceT / BOUNCE_MS;
        const th = END - 0.3 * Math.abs(Math.sin(p * Math.PI * 1.7)) * (1 - p) * (1 - p);
        this.pivot.rotation.x = th;
        this.shadeFor(th);
      }
      active = true;
    }

    if (!this.flipping && this.cur !== this.target) {
      if (this.delay > 0) {
        this.delay -= dt;
        return true;
      }
      this.begin(flapMs);
    }

    if (this.flipping) {
      this.t += dt;
      const p = Math.min(1, this.t / this.dur);
      // Released by the pawl, then accelerating under gravity.
      const th = END * (0.18 * p + 0.82 * p * p);
      this.pivot.rotation.x = th;
      this.shadeFor(th);
      if (p >= 1) this.land(events);
      active = true;
    }

    return active;
  }

  get idle() {
    return !this.flipping && this.bounceT < 0 && this.cur === this.target;
  }
}

export class Board {
  constructor(scene, atlas, theme, rows, cols) {
    this.scene = scene;
    this.rows = rows;
    this.cols = cols;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.material = new THREE.MeshStandardMaterial({
      map: atlas.map,
      roughnessMap: atlas.surface,
      bumpMap: atlas.surface,
      bumpScale: 0.5,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      alphaTest: 0.5,
    });

    this.modules = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * SX;
        const y = ((rows - 1) / 2 - r) * SY;
        this.modules.push(new Module(this, r, c, x, y));
      }
    }

    const innerW = cols * SX + 0.12;
    const innerH = rows * SY + 0.12;
    this.width = innerW + 1.5;
    this.height = innerH + 1.5;

    const rough = getHousingRoughness();
    this.frameMat = new THREE.MeshPhysicalMaterial({
      color: theme.frame,
      roughness: 0.75,
      roughnessMap: rough,
      metalness: 0.2,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
    });
    const frame = new THREE.Mesh(new RoundedBoxGeometry(this.width, this.height, 0.9, 6, 0.32), this.frameMat);
    frame.position.z = -0.45 - 0.03;
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.group.add(frame);

    // Solari-style housing: a rail between every row, standing proud of the flaps,
    // and thin dividers between columns.
    this.housingMat = new THREE.MeshStandardMaterial({ color: theme.frame, roughness: 0.8, roughnessMap: rough, metalness: 0.25 });
    const railGeo = new RoundedBoxGeometry(innerW, 0.14, 0.32, 3, 0.04);
    const rails = new THREE.InstancedMesh(railGeo, this.housingMat, rows + 1);
    const m4 = new THREE.Matrix4();
    for (let r = 0; r <= rows; r++) {
      rails.setMatrixAt(r, m4.makeTranslation(0, ((rows - 1) / 2 - r + 0.5) * SY, 0.1));
    }
    const divGeo = new RoundedBoxGeometry(0.05, innerH, 0.16, 2, 0.02);
    const dividers = new THREE.InstancedMesh(divGeo, this.housingMat, cols + 1);
    for (let c = 0; c <= cols; c++) {
      dividers.setMatrixAt(c, m4.makeTranslation((c - cols / 2) * SX, 0, 0.02));
    }
    // They don't cast shadows onto the flaps: a shadow band across the top of every
    // cell makes the characters look off-center.
    for (const m of [rails, dividers]) {
      m.receiveShadow = true;
      this.group.add(m);
    }

    this.slotMat = new THREE.MeshStandardMaterial({ color: theme.slot, roughness: 0.9, metalness: 0 });
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(innerW, innerH), this.slotMat);
    slot.position.z = -0.012;
    slot.receiveShadow = true;
    this.group.add(slot);
  }

  setTargets(grid, stagger = 500) {
    for (const m of this.modules) {
      const t = grid[m.row]?.[m.col] ?? 0;
      if (t === m.target) continue;
      m.target = t;
      if (!m.flipping && m.cur !== t) m.delay = Math.random() * stagger;
    }
  }

  update(dt, flapMs) {
    const events = [];
    let active = false;
    for (const m of this.modules) if (m.step(dt, flapMs, events)) active = true;
    return { active, events };
  }

  get settled() {
    return this.modules.every((m) => m.idle);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.material.dispose();
    this.frameMat.dispose();
    this.housingMat.dispose();
    this.slotMat.dispose();
  }
}
