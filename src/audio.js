// Procedural split-flap sound, modelled on recordings of a large airport board.
// A leaf landing is shaped noise: in each third-octave band from 63 Hz to 16 kHz,
// white noise follows a loudness envelope (1 ms frames). Above ~900 Hz the envelope
// is the ~6 ms snap measured from close single-module clicks; below, a deeper
// 200-800 Hz "clack" rings for ~8 ms. Band levels are set so that a busy board
// matches the measured spectrum of a big board flipping: strongest at 300-630 Hz,
// with the treble well below it. Dense activity also drives a looping "rattle"
// bed built from hundreds of overlapping clicks.

const BANDS = Array.from({ length: 25 }, (_, k) => 1000 * 2 ** ((k - 12) / 3));
const FRAME = 0.001; // envelope frame; the first frame starts 1 ms before the hit

// Per band, level of each frame in 2 dB steps below the loudest frame of any band
// (one base-32 digit per frame, 0 = loudest). Corrected so that re-measuring the
// synthesized clicks reproduces the recording's envelopes.
const TEMPLATE = [
  'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', // 62 Hz
  'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', // 79 Hz
  'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', // 99 Hz
  'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', // 125 Hz
  'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', // 157 Hz
  'k35adekkoqqutvvvvvvvsqolmpvvvv', // 198 Hz
  'k35abggkknmonommjigghmouvvvvvv', // 250 Hz
  'e00479cdefeeecbabcdgikmnopoonm', // 315 Hz
  'b00146899999889abcdeffffffgghi', // 397 Hz
  'b0025677766789abbbcccdeefgghhh', // 500 Hz
  'h047888888aabcccdddeefgghhiijj', // 630 Hz
  'l48aaa9abcccddeffggghhijjkklmm', // 794 Hz
  'tjd867agqtkgvvvvvuuvuuuuuuuuuu', // 1000 Hz
  'ia5458bdbivvvvvvvvvvuuuuuuuuuu', // 1260 Hz
  '73467657vvvvvurppqpmsvvvuuuuuu', // 1587 Hz
  'rc67chltvvvvvvvvvvvvuuuuuuuuuu', // 2000 Hz
  '942534769vvvqsrppsqotvvuuuuuuu', // 2520 Hz
  'vk444bvvvvvupopsqptpvvuuuuuuuu', // 3175 Hz
  'v94649bvvvopqrprrqssvuuuuuuuuu', // 4000 Hz
  'v71135bvvvpqrsssstrqvuuuuuuuuu', // 5040 Hz
  'r215599e8vursttvtvvtuuuuuuuuuu', // 6350 Hz
  'e20246evvvpspssssurrvuuuuuuuuu', // 8000 Hz
  'b72558afcvssvuvvuuuuuuuuuuuuuu', // 10079 Hz
  '910236gvvvopsqrqsssrvuuuuuuuuu', // 12699 Hz
  '71023bvsvpsrssrqrttpvuuuuuuuuu', // 16000 Hz
];
export const CLICK = TEMPLATE.map((row) => [...row].map((c) => -2 * parseInt(c, 32)));

// Third-octave band-pass (RBJ, 0 dB peak) applied twice, in place.
function bandpass(x, sr, f) {
  const w = (2 * Math.PI * f) / sr;
  const alpha = Math.sin(w) / (2 * 4.32);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = b0 * (x[i] - x2) - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = y;
      x[i] = y;
    }
  }
}

export function makeClick(ctx, heavy, table = CLICK, normalize = true) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.075);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  // Band noise is filtered before the envelope is applied, so filter delay never
  // smears the timing; the warm-up lets the filters settle first.
  const warm = Math.ceil(sr * 0.02);
  const band = new Float32Array(warm + len);
  // Every landing differs a little: overall pace, and the balance between bands.
  const stretch = 0.92 + Math.random() * 0.16;

  table.forEach((row, b) => {
    const f = BANDS[b];
    if (f > sr * 0.45 || Math.max(...row) < -54) return;
    let gain = 10 ** (((Math.random() * 2 - 1) * 1.5) / 20);
    // The final leaf of a module lands harder, with a fuller clack.
    if (heavy && f < 800) gain *= 1.4;
    for (let i = 0; i < band.length; i++) band[i] = Math.random() * 2 - 1;
    bandpass(band, sr, f);
    // Narrow low bands carry less noise power; compensate so levels follow the table.
    const comp = gain * Math.sqrt(1000 / f);
    const last = row.length - 1;
    for (let i = 0; i < len; i++) {
      const p = i / (sr * FRAME * stretch) - 0.5;
      let db;
      if (p <= 0) db = row[0];
      else if (p >= last) db = row[last] - (p - last) * 3;
      else {
        const k = Math.floor(p);
        db = row[k] + (row[k + 1] - row[k]) * (p - k);
      }
      d[i] += band[warm + i] * comp * 10 ** (db / 20);
    }
  });

  // Fade the tail so the buffer ends cleanly.
  const fade = sr * 0.01;
  for (let i = len - fade; i < len; i++) d[i] *= (len - i) / fade;

  if (normalize) {
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] *= 0.85 / peak;
  }
  return buf;
}

export function makeRattle(ctx, clicks, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const out = buf.getChannelData(ch);
    const count = Math.floor(seconds * 420);
    for (let k = 0; k < count; k++) {
      const src = clicks[(Math.random() * clicks.length) | 0].getChannelData(0);
      const start = (Math.random() * len) | 0;
      const g = 0.25 + Math.random() * 0.75;
      const rate = 0.9 + Math.random() * 0.2;
      const n = Math.floor(src.length / rate);
      for (let i = 0; i < n; i++) out[(start + i) % len] += src[Math.floor(i * rate)] * g;
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    for (let i = 0; i < len; i++) out[i] *= 0.9 / peak;
  }
  return buf;
}

// Small-room impulse response: early reflections and a short diffuse tail.
function makeRoom(ctx, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.03) * 0.5;
    }
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(sr * (0.003 + Math.random() * 0.025));
      d[i] += (Math.random() > 0.5 ? 1 : -1) * (0.6 - k * 0.05);
    }
  }
  return buf;
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class FlapAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
    this.rate = 0;
  }

  // Must be called from a user gesture (required on iOS/Safari).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    s.connect(this.ctx.destination);
    s.start();
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;

    // The clicks already carry the fitted spectrum; this only trims resampling fizz.
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowpass';
    shelf.frequency.value = 17000;
    shelf.Q.value = 0.5;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0.55;
    this.bus.connect(shelf);
    shelf.connect(comp);

    const room = ctx.createConvolver();
    room.buffer = makeRoom(ctx, 0.4);
    const wet = ctx.createGain();
    // Just enough room to place the board in a space; the recording's echo is left out.
    wet.gain.value = 0.04;
    shelf.connect(room);
    room.connect(wet);
    wet.connect(comp);

    comp.connect(this.master);
    this.master.connect(ctx.destination);

    this.clicks = Array.from({ length: 12 }, () => makeClick(ctx, false));
    this.thuds = Array.from({ length: 5 }, () => makeClick(ctx, true));

    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    const bed = ctx.createBufferSource();
    bed.buffer = makeRattle(ctx, [...this.clicks, ...this.thuds], 2.5);
    bed.loop = true;
    bed.connect(this.bedGain);
    this.bedGain.connect(this.bus);
    bed.start();
  }

  setEnabled(on) {
    this.enabled = on;
    this.applyGain();
  }

  setVolume(v) {
    this.volume = v;
    this.applyGain();
  }

  applyGain() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.03);
  }

  // Called once per animation frame with the leaves that landed in that frame.
  frame(events, dt, cols) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const n = events.length;
    const inst = (n / Math.max(dt, 1)) * 1000; // flaps per second
    this.rate += (inst - this.rate) * Math.min(1, dt / 150);
    const bed = Math.min(0.45, Math.sqrt(Math.max(0, this.rate - 30)) / 70);
    this.bedGain.gain.setTargetAtTime(bed, ctx.currentTime, 0.06);
    if (!n) return;

    // Only a handful of voices per frame; louder as more leaves fall.
    const voices = Math.min(n, 5);
    const each = Math.min(1.25, Math.sqrt(n) / voices);
    const now = ctx.currentTime;
    const spread = Math.min(dt, 33) / 1000;
    for (let i = 0; i < voices; i++) {
      const e = events[(Math.random() * n) | 0];
      const src = ctx.createBufferSource();
      src.buffer = e.final ? pick(this.thuds) : pick(this.clicks);
      src.playbackRate.value = 0.9 + Math.random() * 0.12;
      const g = ctx.createGain();
      g.gain.value = each * (0.65 + Math.random() * 0.35) * (e.final ? 1 : 0.8);
      src.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = (cols > 1 ? (e.col / (cols - 1)) * 2 - 1 : 0) * 0.6;
        g.connect(p);
        p.connect(this.bus);
      } else {
        g.connect(this.bus);
      }
      src.start(now + 0.004 + Math.random() * spread);
    }
  }
}
