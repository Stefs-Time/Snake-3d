/**
 * The contract every cabinet game implements.
 *
 * A game declares its logical resolution and never thinks about the display
 * again — the host scales the canvas, preserves the aspect ratio, and hands
 * over a context already sized in logical units. Games get scoring, lives,
 * particles, popups and screen shake for free, and only need to fill in
 * `setup`, `update` and `draw`.
 */

import { Particles, Popups, Shake, rng } from './fx.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';

export class BaseGame {
  /** Leaderboard key — must match an id in shared/catalog.js. */
  static id = 'unknown';
  /** Logical canvas size. Everything you draw is in these units. */
  static width = 640;
  static height = 480;
  /** '2d' gets a CanvasRenderingContext2D; 'webgl' means you own the canvas. */
  static renderer = '2d';
  /** Which on-screen controls to show: 'dpad' | 'swipe' | 'aim' | 'none'. */
  static touch = 'dpad';
  /** false keeps the chunky pixel look; true lets the browser smooth it. */
  static smooth = false;
  /**
   * Letterbox bands, in game units, reserved above and below the playfield so
   * the HUD overlay has somewhere to sit that is not on top of the game. The
   * host grows the canvas and shifts the origin, so a game's own coordinates
   * are unaffected — (0, 0) is still the top-left of the playfield.
   */
  static hudPad = { top: 0, bottom: 0 };

  /** Full canvas height including the HUD bands. */
  static get pixelHeight() {
    return this.height + this.hudPad.top + this.hudPad.bottom;
  }
  /** Shown under the score. Games may override per-run. */
  static hudLabels = { score: 'Score', secondary: 'Level' };

  /**
   * Choices the player can make about this cabinet, shown as a segmented
   * control in the play bar and remembered per game. Each entry is:
   *
   *   { id, label, choices: [{ value, label, hint }], default }
   *
   * Read the current value with `this.option(id)`. Implement
   * `onOptionChange(id, value)` and return true to apply a change without
   * restarting the run; return false (or omit it) and the host restarts.
   *
   * @type {Array<{id: string, label: string, default: string,
   *   choices: Array<{value: string, label: string, hint?: string}>}>}
   */
  static options = [];

  /** @param {import('../ui/play.js').PlayHost} host */
  constructor(host) {
    this.host = host;
    this.canvas = host.canvas;
    this.ctx = host.ctx;
    this.input = host.input;
    this.width = this.constructor.width;
    this.height = this.constructor.height;

    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.over = false;

    this.particles = new Particles();
    this.popups = new Popups();
    this.shake = new Shake();
    this.random = rng((Math.random() * 2 ** 32) >>> 0);

    /** Anything here is attached to the submitted score. */
    this.meta = {};
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Called once, after the canvas exists and before the loop starts. */
  setup() {}

  /** Fixed 1/60s step. Put all game rules here. */
  update(_dt) {}

  /** Once per animation frame. `alpha` interpolates toward the next step. */
  draw(_ctx, _alpha) {}

  /** Release timers, WebGL resources, listeners. */
  teardown() {}

  /** The player's current choice for one of this cabinet's options. */
  option(id) {
    const def = this.constructor.options.find((o) => o.id === id);
    return settings.getOption(this.constructor.id, id, def?.default);
  }

  /* --------------------------------------------------------------- utils */

  /** Advance the shared effects. Call from `update` when you want them. */
  updateEffects(dt) {
    this.particles.update(dt);
    this.popups.update(dt);
    this.shake.update(dt);
  }

  /** Draw particles and popups. Call late in `draw`. */
  drawEffects(ctx) {
    this.particles.draw(ctx);
    this.popups.draw(ctx, 'ui-monospace, monospace');
  }

  /**
   * Award points, optionally with a popup where it happened.
   * @param {number} points
   * @param {{x?: number, y?: number, color?: string, label?: string}} [at]
   */
  addScore(points, at) {
    this.score += points;
    this.host.setScore(this.score);
    if (at && at.x != null) {
      this.popups.add(at.x, at.y, at.label ?? `+${points}`, at.color ?? '#ffffff');
    }
  }

  setLives(n) {
    this.lives = n;
    this.host.setLives(n);
  }

  setLevel(n) {
    this.level = n;
    this.host.setSecondary(n);
  }

  /** Big centred text — "READY", "LEVEL 3", "WAVE CLEAR". */
  banner(text) {
    this.host.banner(text);
  }

  play(sound) {
    sfx.play(sound);
  }

  tone(freq, opts) {
    sfx.tone(freq, opts);
  }

  /** End the run. The host takes over from here with the game-over flow. */
  end() {
    if (this.over) return;
    this.over = true;
    this.host.endRun({ score: this.score, meta: this.meta });
  }

  /* ----------------------------------------------------- drawing helpers */

  /** Fill the playfield with the cabinet's dark background. */
  clear(ctx, color = '#04060a') {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** A neon rectangle: solid core plus a soft outer glow. */
  glowRect(ctx, x, y, w, h, color, blur = 12) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  glowCircle(ctx, x, y, r, color, blur = 14) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  glowLine(ctx, x1, y1, x2, y2, color, width = 2, blur = 10) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /** Monospace text, centred by default. */
  text(ctx, str, x, y, { size = 14, color = '#e9edf6', align = 'center', weight = 700, glow = 0 } = {}) {
    ctx.save();
    ctx.font = `${weight} ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /* ------------------------------------------------------ pointer input */

  /**
   * The pointer in game coordinates, with the HUD band subtracted so (0, 0) is
   * the top-left of the playfield — the same space `draw` works in.
   * `pressed` and `released` are single-frame edges.
   */
  get mouse() {
    const p = this.input.pointer;
    const pad = this.constructor.hudPad;
    return {
      x: p.x * this.width,
      y: p.y * this.constructor.pixelHeight - pad.top,
      down: p.down,
      pressed: p.pressed,
      released: p.released,
      active: p.active,
    };
  }

  /** Point-in-rectangle, for hit-testing anything the pointer can click. */
  hits(px, py, x, y, w, h) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  /** Trace a rounded rectangle. Call fill() or stroke() yourself. */
  roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    return ctx;
  }

  /* ------------------------------------------------------ more drawing */

  /** A faint dot grid, the shared visual language of the 2D cabinets. */
  drawGrid(ctx, cell = 32, color = 'rgba(255,255,255,0.045)') {
    ctx.save();
    ctx.fillStyle = color;
    for (let x = cell; x < this.width; x += cell) {
      for (let y = cell; y < this.height; y += cell) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    ctx.restore();
  }
}
