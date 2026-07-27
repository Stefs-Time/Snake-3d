/**
 * Chiptune synthesizer.
 *
 * Every sound in the arcade is generated on the fly from oscillators and a
 * noise buffer — there is not a single audio file in this repository. A "voice"
 * is a small declarative spec, so adding a new effect is one line in SOUNDS.
 */

import { settings } from './settings.js';

/** @type {AudioContext|null} */
let ctx = null;
let master = null;
let noiseBuffer = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.get('volume');
  // A gentle low-pass keeps square waves from being shrill on laptop speakers.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 7200;
  master.connect(tone).connect(ctx.destination);

  const len = ctx.sampleRate * 0.6;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/**
 * Voice spec:
 *   type   'square' | 'sawtooth' | 'triangle' | 'sine' | 'noise'
 *   freq   starting frequency (Hz)
 *   to     frequency to glide toward (optional)
 *   dur    seconds
 *   gain   peak gain 0..1
 *   attack seconds to peak (default 0.005)
 *   curve  'exp' (default) | 'lin' for the frequency glide
 *   filter low-pass cutoff for noise voices
 *   delay  seconds to wait before starting
 */
function voice(spec) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + (spec.delay ?? 0);
  const dur = spec.dur ?? 0.12;
  const peak = (spec.gain ?? 0.3) * 0.9;

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + (spec.attack ?? 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let source;
  if (spec.type === 'noise') {
    source = c.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(spec.filter ?? 1200, t0);
    if (spec.filterTo) lp.frequency.exponentialRampToValueAtTime(spec.filterTo, t0 + dur);
    source.connect(lp).connect(env);
  } else {
    source = c.createOscillator();
    source.type = spec.type ?? 'square';
    source.frequency.setValueAtTime(spec.freq, t0);
    if (spec.to) {
      if (spec.curve === 'lin') source.frequency.linearRampToValueAtTime(spec.to, t0 + dur);
      else source.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), t0 + dur);
    }
    source.connect(env);
  }

  env.connect(master);
  source.start(t0);
  source.stop(t0 + dur + 0.02);
}

/** A sequence of notes, spaced by `step` seconds. */
function arp(notes, { type = 'square', step = 0.06, dur = 0.09, gain = 0.26 } = {}) {
  notes.forEach((freq, i) => voice({ type, freq, dur, gain, delay: i * step }));
}

const SOUNDS = {
  /* --- interface --- */
  hover: () => voice({ type: 'sine', freq: 620, dur: 0.05, gain: 0.08 }),
  select: () => arp([520, 780], { step: 0.05, dur: 0.08, gain: 0.2 }),
  back: () => arp([520, 340], { step: 0.05, dur: 0.08, gain: 0.16 }),
  coin: () => arp([988, 1319], { type: 'square', step: 0.07, dur: 0.14, gain: 0.24 }),
  toggle: () => voice({ type: 'square', freq: 440, to: 660, dur: 0.07, gain: 0.14 }),

  /* --- generic gameplay --- */
  blip: () => voice({ type: 'square', freq: 880, dur: 0.05, gain: 0.16 }),
  eat: () => voice({ type: 'square', freq: 660, to: 1180, dur: 0.09, gain: 0.22 }),
  bounce: () => voice({ type: 'square', freq: 420, to: 300, dur: 0.06, gain: 0.18 }),
  hit: () => voice({ type: 'square', freq: 300, to: 140, dur: 0.1, gain: 0.2 }),
  laser: () => voice({ type: 'sawtooth', freq: 1100, to: 260, dur: 0.13, gain: 0.16 }),
  thrust: () => voice({ type: 'noise', filter: 700, filterTo: 300, dur: 0.1, gain: 0.09 }),
  explode: () => {
    voice({ type: 'noise', filter: 1800, filterTo: 90, dur: 0.5, gain: 0.32 });
    voice({ type: 'square', freq: 140, to: 40, dur: 0.34, gain: 0.14 });
  },
  powerup: () => arp([523, 659, 784, 1047], { step: 0.055, dur: 0.1, gain: 0.22 }),
  levelup: () => arp([523, 659, 784, 1047, 1319], { step: 0.075, dur: 0.13, gain: 0.24 }),
  clear: () => arp([784, 988, 1175], { type: 'triangle', step: 0.05, dur: 0.14, gain: 0.24 }),
  drop: () => voice({ type: 'square', freq: 190, to: 90, dur: 0.08, gain: 0.18 }),
  rotate: () => voice({ type: 'square', freq: 520, dur: 0.04, gain: 0.11 }),
  merge: () => voice({ type: 'triangle', freq: 480, to: 760, dur: 0.11, gain: 0.2 }),

  /* --- run boundaries --- */
  ready: () => arp([392, 523, 659], { type: 'triangle', step: 0.13, dur: 0.2, gain: 0.2 }),
  die: () => {
    voice({ type: 'square', freq: 440, to: 60, dur: 0.6, gain: 0.26, curve: 'exp' });
    voice({ type: 'noise', filter: 900, filterTo: 100, dur: 0.4, gain: 0.14 });
  },
  gameover: () => arp([392, 349, 311, 262], { type: 'triangle', step: 0.17, dur: 0.3, gain: 0.24 }),
  highscore: () =>
    arp([523, 659, 784, 1047, 784, 1047, 1319], { step: 0.1, dur: 0.16, gain: 0.24 }),
};

export const sfx = {
  /** Browsers need a gesture before audio starts; call this from one. */
  unlock() {
    const c = ensure();
    if (c?.state === 'suspended') c.resume().catch(() => {});
  },

  play(name) {
    if (!settings.get('sound')) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    try {
      fn();
    } catch {
      /* an audio glitch must never break a game loop */
    }
  },

  /** Pitch-shifted blip, for things like ascending combo chains. */
  tone(freq, { dur = 0.08, gain = 0.18, type = 'square' } = {}) {
    if (!settings.get('sound')) return;
    try {
      voice({ type, freq, dur, gain });
    } catch {
      /* ignore */
    }
  },

  setVolume(v) {
    if (master) master.gain.value = v;
  },
};

settings.subscribe((key, value) => {
  if (key === 'volume') sfx.setVolume(value);
});
