import * as THREE from 'three';
import { createAtlas, THEMES } from './atlas.js';
import { Board, PITCH } from './board.js';
import { layout, hasLiveTokens } from './layout.js';
import { FlapAudio } from './audio.js';
import { initUI } from './ui.js';
import { createWallTextures, WALL, WALLS } from './walls.js';
import { createEnvironment } from './environment.js';

const FONT = '"Barlow", "Helvetica Neue", Arial, sans-serif';
const STORAGE_KEY = 'splitflap.v1';

const DEFAULTS = {
  messages: [
    { text: '{r}{o}{y}{g}{b}{v}\nGOOD MORNING\n{v}{b}{g}{y}{o}{r}', duration: 12 },
    { text: 'THE BEST WAY TO PREDICT THE FUTURE IS TO INVENT IT\n\n- ALAN KAY', duration: 15 },
    { text: '{time}\n{date}', duration: 12 },
  ],
  loop: true,
  sound: true,
  volume: 0.7,
  speed: 66,
  align: 'center',
  theme: 'black',
  size: 'auto',
  wall: 'wood',
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') return { ...structuredClone(DEFAULTS), ...saved };
  } catch {}
  return structuredClone(DEFAULTS);
}

const state = loadState();
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, 300);
}

// ---------- Renderer & scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Only the static housing casts shadows, so the map is redrawn on rebuild only.
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const envMap = createEnvironment(renderer);
scene.environment = envMap;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(26, 1, 5, 400);

const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
key.position.set(-8, 26, 17);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.01;
key.shadow.radius = 4;
scene.add(key, key.target);

// Overhead gallery wash: bright above the board, falling off toward the corners,
// and grazing enough to bring out the wall's texture. Its color follows the wall.
const wash = new THREE.SpotLight(0xffe2c0, 300, 0, 0.8, 1, 2);
wash.position.set(0, 21, 12);
wash.target.position.set(0, 2, -1);
scene.add(wash, wash.target);

const fill = new THREE.DirectionalLight(0xdde6ff, 0.35);
fill.position.set(14, -6, 18);
scene.add(fill);

// The wall plane is twice the textures' height (they repeat in Y) to cover tall
// portrait screens. Its finish is chosen in settings and baked on the GPU.
const wall = new THREE.Mesh(new THREE.PlaneGeometry(WALL.width, WALL.height * 2), new THREE.MeshPhysicalMaterial());
wall.position.z = -0.94;
wall.receiveShadow = true;
scene.add(wall);
let wallTex = null;

function buildWall() {
  if (!WALLS[state.wall]) state.wall = 'wood';
  const spec = WALLS[state.wall];
  wallTex?.dispose();
  wallTex = createWallTextures(renderer, state.wall);
  for (const tex of [wallTex.map, wallTex.normalMap, wallTex.roughMap]) tex.repeat.set(1, 2);
  const coat = spec.material.clearcoat
    ? { clearcoatRoughnessMap: wallTex.roughMap, clearcoatNormalMap: wallTex.normalMap }
    : {};
  wall.material.dispose();
  wall.material = new THREE.MeshPhysicalMaterial({
    ...spec.material,
    ...coat,
    map: wallTex.map,
    normalMap: wallTex.normalMap,
    roughnessMap: wallTex.roughMap,
    metalness: 0,
    envMap,
    envMapIntensity: 1,
  });
  wash.color.set(spec.light);
  scene.background = new THREE.Color(spec.background);
  document.body.style.background = `#${scene.background.getHexString()}`;
  renderer.shadowMap.needsUpdate = true;
  dirty = true;
}

let atlas = null;
let atlasTheme = null;
let board = null;
let dirty = true;

// "auto" fills the screen: the classic 6 x 22 in landscape; in portrait, a taller,
// narrower grid sized so the board covers most of the screen's height.
function autoDims() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect >= 1.2) return [6, 22];
  const cols = aspect < 0.62 ? 10 : 13;
  const width = cols * PITCH.x + 1.62;
  const rows = Math.floor(((width / aspect) * 0.82 - 1.62) / PITCH.y);
  return [Math.max(4, Math.min(16, rows)), cols];
}
const dims = () => (state.size === 'auto' ? autoDims() : state.size.split('x').map(Number));

function buildBoard() {
  const theme = THEMES[state.theme] ?? THEMES.black;
  if (atlasTheme !== state.theme) {
    atlas?.map.dispose();
    atlas?.surface.dispose();
    atlas = createAtlas(theme, FONT, renderer.capabilities.getMaxAnisotropy());
    atlasTheme = state.theme;
  }
  board?.dispose();
  const [rows, cols] = dims();
  board = new Board(scene, atlas, theme, rows, cols);
  // Fit the shadow frustum tightly around the board for crisp rail shadows.
  Object.assign(key.shadow.camera, { left: -board.width / 2 - 3, right: board.width / 2 + 3, top: board.height / 2 + 3, bottom: -board.height / 2 - 3 });
  key.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
  fit();
}

function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const margin = 1.06;
  const d = Math.max((board.height * margin) / (2 * t), (board.width * margin) / (2 * t * camera.aspect));
  camera.position.set(0, 0, d);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  dirty = true;
}
// On rotation (or any resize) an auto-sized board is rebuilt to the new grid.
let resizeTimer;
function onResize() {
  fit();
  if (state.size !== 'auto') return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const [rows, cols] = dims();
    if (rows === board.rows && cols === board.cols) return;
    buildBoard();
    ui.renderList();
    if (started) show(current, 300);
  }, 250);
}
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);

// ---------- Audio ----------
const audio = new FlapAudio();
audio.enabled = state.sound;
audio.volume = state.volume;

// ---------- Message playback ----------
let started = false;
let current = 0;
let phase = 'idle'; // flipping -> holding -> (advance) | done
let holdLeft = 0;
let gridKey = '';
let liveTimer = 0;
let editTimer;

function gridFor(i) {
  const [rows, cols] = dims();
  return layout(state.messages[i]?.text ?? '', rows, cols, state.align);
}

function show(i, stagger = 600) {
  const len = state.messages.length;
  if (!len) {
    current = 0;
    board.setTargets([], stagger);
    phase = 'done';
    ui.setActive(-1);
    return;
  }
  current = ((i % len) + len) % len;
  const grid = gridFor(current);
  gridKey = grid.flat().join(',');
  board.setTargets(grid, stagger);
  phase = 'flipping';
  ui.setActive(current);
}

function advance() {
  const len = state.messages.length;
  if (len <= 1 || (current + 1 >= len && !state.loop)) {
    phase = 'done';
    return;
  }
  show(current + 1);
}

function tickPlayer(ms) {
  if (!started) return;
  if (phase === 'flipping' && board.settled) {
    phase = 'holding';
    holdLeft = (state.messages[current]?.duration ?? 10) * 1000;
  } else if (phase === 'holding') {
    holdLeft -= ms;
    if (holdLeft <= 0) advance();
  }

  // Keep {time}/{date} messages current; only the changed modules flip.
  liveTimer += ms;
  if (liveTimer >= 1000) {
    liveTimer = 0;
    const m = state.messages[current];
    if (m && hasLiveTokens(m.text)) {
      const grid = gridFor(current);
      const k = grid.flat().join(',');
      if (k !== gridKey) {
        gridKey = k;
        board.setTargets(grid, 200);
      }
    }
  }
}

// ---------- UI ----------
function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
  } else {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    req?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  }
}
if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
  document.getElementById('btn-fullscreen').style.display = 'none';
}

const ui = initUI({
  state,
  dims,
  save,
  onShow: (i) => show(i, 300),
  onNext: () => show(current + 1, 300),
  onFullscreen: toggleFullscreen,
  onEdit: (i) => {
    save();
    if (i !== current || !started) return;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => show(current, 200), 700);
  },
  onAdd: () => {
    state.messages.push({ text: '', duration: 10 });
    save();
  },
  onReorder: (a, b) => {
    const m = state.messages;
    [m[a], m[b]] = [m[b], m[a]];
    if (current === a) current = b;
    else if (current === b) current = a;
    save();
    ui.renderList();
    ui.setActive(current);
  },
  onDelete: (i) => {
    state.messages.splice(i, 1);
    save();
    ui.renderList();
    if (i === current) show(current, 300);
    else {
      if (i < current) current--;
      ui.setActive(current);
    }
  },
  onSetting: (k) => {
    save();
    if (k === 'sound') audio.setEnabled(state.sound);
    else if (k === 'volume') audio.setVolume(state.volume);
    else if (k === 'align') {
      ui.renderList();
      show(current, 300);
    } else if (k === 'wall') {
      buildWall();
    } else if (k === 'theme' || k === 'size') {
      buildBoard();
      ui.renderList();
      if (started) show(current, 600);
    }
  },
});

// Keep the iPad/laptop screen on while the board is displayed.
let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) keepAwake();
});

const startEl = document.getElementById('start');
startEl.addEventListener('pointerdown', () => {
  audio.unlock();
  if (started) return;
  started = true;
  startEl.classList.add('gone');
  document.body.classList.remove('not-started');
  keepAwake();
  setTimeout(() => show(0, 900), 250);
});
// iOS may suspend audio when backgrounded; resume on the next touch.
window.addEventListener('pointerdown', () => {
  if (started && audio.ctx?.state !== 'running') audio.unlock();
});

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - last;
  last = now;
  const dt = Math.min(raw, 50);
  const { active, events } = board.update(dt, state.speed);
  audio.frame(events, dt, board.cols);
  tickPlayer(raw);
  if (active || dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
}

try {
  await Promise.race([document.fonts.load(`600 100px ${FONT}`), new Promise((r) => setTimeout(r, 2500))]);
} catch {}
buildWall();
buildBoard();
requestAnimationFrame(frame);
