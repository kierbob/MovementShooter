// Cartoon sound effects, synthesized with Web Audio (no files needed).
// To use a real recording instead, put it in assets/sounds/ and list it in SOUND_FILES:
//   SOUND_FILES = { shotgun: 'shotgun.ogg', explosion: ['boom1.ogg', 'boom2.ogg'] }
// A listed file always wins over the synth version.
import { settings } from './settings.js';

export const SOUND_FILES = {};

const now = (ctx) => ctx.currentTime;

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.lastPlayed = {};
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
  }

  // Browsers only allow audio after a click/key press.
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = settings.volume;
      const comp = this.ctx.createDynamicsCompressor(); // keeps stacked explosions from clipping
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.loadFiles();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos, yaw) {
    this.listener = { x: pos.x, y: pos.y, z: pos.z, yaw };
  }

  async loadFiles() {
    for (const [name, files] of Object.entries(SOUND_FILES)) {
      const list = Array.isArray(files) ? files : [files];
      try {
        this.buffers[name] = await Promise.all(list.map(async (f) => {
          const res = await fetch(`assets/sounds/${f}`);
          return this.ctx.decodeAudioData(await res.arrayBuffer());
        }));
      } catch (err) {
        console.warn(`Sound file for "${name}" failed to load, using synth.`, err);
      }
    }
  }

  // name: effect name. opts.pos: world position (pans + fades with distance). opts.vol: 0..1+.
  // opts.gap: minimum seconds between two plays of this sound (stops machine-gun stacking).
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = now(this.ctx);
    const gap = opts.gap ?? 0.015;
    if (t - (this.lastPlayed[name] ?? -1) < gap) return;
    this.lastPlayed[name] = t;

    // Positional: pan left/right relative to where you're looking, quieter with distance.
    let vol = opts.vol ?? 1, pan = 0;
    if (opts.pos) {
      const L = this.listener;
      const dx = opts.pos.x - L.x, dy = opts.pos.y - L.y, dz = opts.pos.z - L.z;
      const d = Math.hypot(dx, dy, dz);
      vol *= 1 / (1 + d * 0.07);
      if (d > 0.5) pan = Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d));
    }
    const out = this.ctx.createGain();
    out.gain.value = vol;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan * 0.8;
    out.connect(panner).connect(this.master);

    const files = this.buffers[name];
    if (files?.length) {
      const src = this.ctx.createBufferSource();
      src.buffer = files[Math.floor(Math.random() * files.length)];
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.08;
      src.connect(out);
      src.start();
      return;
    }
    SYNTH[name]?.(new Voice(this.ctx, out, this.noiseBuf), opts);
  }
}

// Little building blocks for the synth recipes below.
class Voice {
  constructor(ctx, out, noiseBuf) { this.ctx = ctx; this.out = out; this.noiseBuf = noiseBuf; }

  env(gain, start, vol, dur, attack = 0.003) {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  }

  // Oscillator sweeping f0 → f1 over dur. o: { delay, vibrato: { rate, depth } }
  tone(type, f0, f1, dur, vol, o = {}) {
    const start = this.ctx.currentTime + (o.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
    if (o.vibrato) {
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = o.vibrato.rate;
      lg.gain.value = o.vibrato.depth;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(start); lfo.stop(start + dur);
    }
    this.env(g, start, vol, dur, o.attack);
    osc.connect(g).connect(this.out);
    osc.start(start); osc.stop(start + dur + 0.02);
  }

  // Filtered noise burst, filter cutoff sweeping f0 → f1. o: { type, q, delay }
  noise(dur, vol, f0, f1, o = {}) {
    const start = this.ctx.currentTime + (o.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(f0, start);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + dur);
    const g = this.ctx.createGain();
    this.env(g, start, vol, dur, o.attack);
    src.connect(f).connect(g).connect(this.out);
    src.start(start, Math.random() * 0.5); src.stop(start + dur + 0.02);
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

// Recipes: exaggerated, bouncy, cartoon — not realistic gunfire.
const SYNTH = {
  // ---- guns ----
  shotgun: (v) => {
    v.noise(0.35, 0.9, 5000, 250);
    v.tone('sine', 150, 38, 0.3, 0.9);
    v.tone('square', 95, 50, 0.08, 0.25);
    v.noise(0.05, 0.3, 1800, 1800, { type: 'bandpass', q: 2, delay: 0.32 }); // pump click
    v.noise(0.05, 0.3, 2400, 2400, { type: 'bandpass', q: 2, delay: 0.42 });
  },
  rifle: (v) => {
    v.noise(0.08, 0.45, 3200, 1200, { type: 'bandpass', q: 0.8 });
    v.tone('square', rnd(400, 440), 150, 0.06, 0.16);
  },
  smg: (v) => {
    v.noise(0.05, 0.38, 4000, 1800, { type: 'bandpass', q: 0.9 });
    v.tone('square', rnd(600, 660), 250, 0.04, 0.12);
  },
  pistol: (v) => {
    v.noise(0.12, 0.6, 2600, 700, { type: 'bandpass', q: 0.7 });
    v.tone('triangle', 560, 120, 0.1, 0.35);
  },
  kickpistol: (v) => {
    v.noise(0.25, 0.9, 3000, 200);
    v.tone('sine', 115, 35, 0.3, 1);
    v.tone('triangle', 280, 900, 0.16, 0.14, { delay: 0.04, vibrato: { rate: 30, depth: 60 } }); // boing tail
  },
  rocket: (v) => {
    v.noise(0.5, 0.5, 500, 2600, { type: 'bandpass', q: 1.4 });
    v.tone('sawtooth', 80, 210, 0.4, 0.12);
    v.tone('sine', 120, 50, 0.15, 0.5);
  },
  dry: (v) => v.tone('square', 1500, 1400, 0.03, 0.12),
  reload: (v) => {
    v.noise(0.03, 0.3, 3000, 3000, { type: 'highpass' });
    v.tone('square', 900, 700, 0.03, 0.08);
    v.noise(0.04, 0.35, 2200, 2200, { type: 'bandpass', q: 3, delay: 0.2 });
    v.tone('square', 600, 1100, 0.05, 0.1, { delay: 0.2 });
  },
  switch: (v) => {
    v.tone('square', 1300, 900, 0.025, 0.08);
    v.noise(0.04, 0.2, 2500, 2500, { type: 'bandpass', q: 2, delay: 0.06 });
  },
  throw: (v) => v.noise(0.2, 0.35, 400, 1800, { type: 'bandpass', q: 1.2 }),
  knifeThrow: (v) => {
    v.noise(0.18, 0.3, 600, 2400, { type: 'bandpass', q: 1.5 });
    v.tone('sine', 2400, 1900, 0.2, 0.08);
  },

  // ---- explosions ----
  explosion: (v) => {
    v.tone('sine', 95, 26, 0.9, 1);
    v.noise(1.0, 0.9, 2000, 110);
    v.noise(0.12, 0.45, 3500, 3500, { type: 'highpass' });
    v.noise(0.4, 0.25, 900, 300, { type: 'bandpass', q: 3, delay: 0.15 }); // rumble tail
  },
  impulse: (v) => {
    v.tone('sine', 180, 950, 0.35, 0.6);
    v.tone('square', 90, 450, 0.3, 0.1);
    v.noise(0.3, 0.3, 1400, 4200, { type: 'bandpass', q: 1 });
  },

  // ---- hits ----
  impact: (v) => {
    v.noise(0.03, 0.15, 4000, 4000, { type: 'highpass' });
    v.tone('triangle', rnd(1100, 1400), 500, 0.035, 0.07);
  },
  hit: (v) => { // squish!
    v.noise(0.12, 0.5, 1400, 250, { type: 'bandpass', q: 3 });
    v.tone('sine', 700, 260, 0.09, 0.3);
  },
  headshot: (v) => { // ding!
    v.tone('sine', 1760, 1740, 0.5, 0.32);
    v.tone('sine', 2640, 2620, 0.35, 0.14);
    v.noise(0.02, 0.25, 5000, 5000, { type: 'highpass' });
  },
  kill: (v) => { // pop + happy arpeggio
    v.noise(0.08, 0.6, 3000, 400, { type: 'bandpass', q: 1.5 });
    v.tone('sine', 400, 1200, 0.08, 0.4);
    [523, 659, 784, 1046].forEach((f, i) => v.tone('triangle', f, f, 0.14, 0.2, { delay: 0.06 + i * 0.06 }));
  },

  // ---- movement ----
  jump: (v) => v.tone('sine', 250, 430, 0.1, 0.12),
  land: (v, o) => {
    const k = Math.min(1, o.strength ?? 0.5);
    v.tone('sine', 130, 55, 0.12, 0.2 + 0.3 * k);
    v.noise(0.08, 0.1 + 0.2 * k, 600, 150);
  },
  slide: (v) => v.noise(0.5, 0.3, 1400, 500, { type: 'bandpass', q: 0.8, attack: 0.02 }),
  wallJump: (v) => {
    v.tone('triangle', 300, 760, 0.12, 0.25);
    v.noise(0.03, 0.25, 2500, 2500, { type: 'bandpass', q: 2 });
  },
  pad: (v) => { // BOING
    v.tone('sine', 140, 620, 0.4, 0.55, { vibrato: { rate: 18, depth: 40 } });
    v.tone('triangle', 280, 1240, 0.3, 0.15);
  },

  // ---- bot arena ----
  botShot: (v) => { // pew!
    v.tone('square', 1300, 380, 0.14, 0.16);
    v.tone('sine', 900, 300, 0.12, 0.2);
  },
  hurt: (v) => { // oof
    v.noise(0.14, 0.45, 900, 200, { type: 'bandpass', q: 2 });
    v.tone('sine', 320, 120, 0.16, 0.45);
  },
  death: (v) => { // sad trombone
    [392, 370, 349, 311].forEach((f, i) => v.tone('triangle', f, i === 3 ? f * 0.85 : f, i === 3 ? 0.6 : 0.24, 0.22, {
      delay: i * 0.26, vibrato: i === 3 ? { rate: 6, depth: 10 } : undefined,
    }));
  },

  // ---- time trial ----
  teleport: (v) => {
    v.tone('sine', 200, 1600, 0.35, 0.35, { vibrato: { rate: 25, depth: 80 } });
    v.noise(0.35, 0.2, 800, 5000, { type: 'bandpass', q: 1.5 });
  },
  go: (v) => { v.tone('square', 880, 880, 0.18, 0.18); v.tone('square', 1320, 1320, 0.25, 0.14, { delay: 0.1 }); },
  finish: (v) => { // ta-da!
    [523, 659, 784, 1046, 1318].forEach((f, i) => v.tone('triangle', f, f, 0.22, 0.22, { delay: i * 0.08 }));
    v.tone('sine', 1046, 1046, 0.6, 0.15, { delay: 0.4 });
  },

  // ---- UI ----
  ui: (v) => v.tone('triangle', 660, 990, 0.06, 0.12),
};
