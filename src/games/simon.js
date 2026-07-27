import { BaseGame } from '../core/game.js';

/**
 * SIMON
 *
 * Watch, then repeat, one step longer every round. The pads use the original
 * four tones — E4, C#4, A3, E3 — which is what makes a long sequence learnable
 * at all: you stop memorising colours and start memorising a tune. Playback
 * also speeds up as the sequence grows, so the tune is the only thing that
 * scales.
 */

const W = 520;
const H = 520;

const CX = W / 2;
const CY = H / 2 + 6;
const OUTER = 200;
const INNER = 72;

const PADS = [
  { name: 'green', color: '#22c55e', lit: '#86efac', freq: 329.63, start: Math.PI, end: Math.PI * 1.5 },
  { name: 'red', color: '#ef4444', lit: '#fca5a5', freq: 440.0, start: Math.PI * 1.5, end: Math.PI * 2 },
  { name: 'yellow', color: '#eab308', lit: '#fde047', freq: 261.63, start: Math.PI * 0.5, end: Math.PI },
  { name: 'blue', color: '#3b82f6', lit: '#93c5fd', freq: 196.0, start: 0, end: Math.PI * 0.5 },
];

const STRIKES = 3;

export default class Simon extends BaseGame {
  static id = 'simon';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 26 };
  static hudLabels = { score: 'Score', secondary: 'Sequence' };

  setup() {
    this.host.setSecondaryLabel('Sequence');
    this.host.setHint('Watch, then repeat · click a pad or press Q W A S',
      'Watch, then repeat · tap a pad');
    this.setLives(STRIKES);

    this.sequence = [];
    this.longest = 0;
    this.host.setSecondary(0);
    this.litPad = -1;
    this.litTimer = 0;
    this.state = 'idle';
    this.stateTimer = 1;
    this.step = 0;
    this.inputIndex = 0;

    this.banner('Watch closely');
    this.play('ready');
  }

  /* =========================================================== sequencing */

  #extend() {
    this.sequence.push(Math.floor(this.random() * 4));
    this.longest = Math.max(this.longest, this.sequence.length);
    this.host.setSecondary(this.sequence.length);
    this.meta = { sequence: this.longest };
    this.state = 'playback';
    this.step = 0;
    this.stateTimer = 0.45;
    this.litPad = -1;
  }

  /** Playback quickens with length — the sequence gets harder, not just longer. */
  #beat() {
    return Math.max(0.22, 0.62 - this.sequence.length * 0.018);
  }

  #flash(pad, duration) {
    this.litPad = pad;
    this.litTimer = duration;
    this.tone(PADS[pad].freq, { dur: duration * 0.9, gain: 0.2, type: 'triangle' });
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.litTimer > 0) {
      this.litTimer -= dt;
      if (this.litTimer <= 0) this.litPad = -1;
    }

    switch (this.state) {
      case 'idle':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.#extend();
        break;

      case 'playback': {
        this.stateTimer -= dt;
        if (this.stateTimer > 0) break;
        if (this.step >= this.sequence.length) {
          this.state = 'input';
          this.inputIndex = 0;
          this.banner('Your turn');
          break;
        }
        const beat = this.#beat();
        this.#flash(this.sequence[this.step], beat * 0.62);
        this.step++;
        this.stateTimer = beat;
        break;
      }

      case 'input':
        this.#handleInput();
        break;

      case 'wrong':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          if (this.finished) this.end();
          else {
            // A strike replays the same sequence rather than extending it.
            this.state = 'playback';
            this.step = 0;
            this.stateTimer = 0.5;
            this.litPad = -1;
          }
        }
        break;

      case 'cleared':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.#extend();
        break;
    }
  }

  #handleInput() {
    const m = this.mouse;
    let pad = m.pressed ? this.#padAt(m.x, m.y) : -1;

    // Q W / A S map onto the four quadrants the way they sit on the keyboard,
    // so the game is playable without a pointer.
    if (pad < 0) {
      if (this.input.keyPressed('KeyQ')) pad = 0;
      else if (this.input.keyPressed('KeyW')) pad = 1;
      else if (this.input.keyPressed('KeyA')) pad = 2;
      else if (this.input.keyPressed('KeyS')) pad = 3;
    }
    if (pad < 0) return;

    this.#flash(pad, 0.22);

    if (pad !== this.sequence[this.inputIndex]) {
      this.#wrong();
      return;
    }

    this.inputIndex++;
    if (this.inputIndex < this.sequence.length) return;

    /* --- the whole sequence, repeated --- */
    const points = this.sequence.length * 100;
    this.addScore(points);
    this.play('powerup');
    this.shake.add(3);
    this.state = 'cleared';
    this.stateTimer = 0.7;
    this.banner(`${this.sequence.length} in a row`);
  }

  #wrong() {
    this.play('die');
    this.shake.add(12);
    this.particles.emit(CX, CY, { count: 24, speed: 180, color: '#fb7185', life: 0.7, size: 3 });

    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    this.state = 'wrong';
    this.stateTimer = 1.2;

    if (lives <= 0) {
      this.meta = { sequence: this.longest };
      this.finished = true;
      return;
    }

    // A strike costs the round, not the whole sequence — you start it again.
    this.banner('Wrong');
    this.step = 0;
    this.inputIndex = 0;
    this.stateTimer = 1.2;
  }

  /** Which pad is under this point? -1 for the hub or outside the ring. */
  #padAt(px, py) {
    const dx = px - CX;
    const dy = py - CY;
    const dist = Math.hypot(dx, dy);
    if (dist > OUTER || dist < INNER) return -1;

    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI * 2;

    return PADS.findIndex((pad) => angle >= pad.start && angle < pad.end);
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#06080e');
    ctx.save();
    this.shake.apply(ctx);

    PADS.forEach((pad, i) => this.#drawPad(ctx, pad, i));
    this.#drawHub(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawPad(ctx, pad, index) {
    const lit = this.litPad === index;
    const gap = 0.035; // radians of dark between the quadrants

    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER, pad.start + gap, pad.end - gap);
    ctx.arc(CX, CY, INNER, pad.end - gap, pad.start + gap, true);
    ctx.closePath();

    if (lit) {
      ctx.fillStyle = pad.lit;
      ctx.shadowColor = pad.color;
      ctx.shadowBlur = 40;
    } else {
      ctx.fillStyle = pad.color;
      ctx.globalAlpha = this.state === 'input' ? 0.55 : 0.34;
    }
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  #drawHub(ctx) {
    ctx.save();
    ctx.fillStyle = '#0b1018';
    ctx.beginPath();
    ctx.arc(CX, CY, INNER - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    const label =
      this.state === 'playback' ? 'WATCH'
      : this.state === 'input' ? 'REPEAT'
      : this.state === 'wrong' ? 'WRONG'
      : this.state === 'cleared' ? 'GOOD'
      : 'READY';

    const color =
      this.state === 'input' ? '#4ade80'
      : this.state === 'wrong' ? '#fb7185'
      : '#8b93a7';

    this.text(ctx, label, CX, CY - 12, { size: 13, color, glow: 8 });
    this.text(ctx, String(this.sequence.length), CX, CY + 14, { size: 26, color: '#e9edf6' });

    // Progress pips around the hub while you are repeating.
    if (this.state === 'input') {
      const total = this.sequence.length;
      for (let i = 0; i < total; i++) {
        const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
        const x = CX + Math.cos(a) * (INNER - 16);
        const y = CY + Math.sin(a) * (INNER - 16);
        ctx.fillStyle = i < this.inputIndex ? '#4ade80' : 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
