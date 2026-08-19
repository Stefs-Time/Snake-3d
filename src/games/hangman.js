import { BaseGame } from '../core/game.js';
import { HANGMAN_CATEGORIES } from './words.js';

/**
 * HANGMAN
 *
 * Six wrong guesses and the drawing is finished. The category is given, which
 * is the difference between a game and a shrug — without it, a long word with
 * no vowels showing is pure guesswork.
 *
 * A run is a streak: solve a word and another arrives, and every third one
 * shortens your rope by taking a limb off the allowance. Three lost words ends
 * it. Repeating a letter is free rather than punished, because "you already
 * tried E" is a UI failure, not a game mechanic.
 */

const W = 660;
const H = 540;

const MAX_WRONG = 6;

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_H = 46;
const KEY_GAP = 6;
const KEYBOARD_Y = 336;

const GALLOWS_X = 108;
const GALLOWS_Y = 52;

/** How long one figure segment takes to stroke itself in. */
const STROKE_TIME = 0.35;

/** Mix a hex colour toward white (t > 0) or black (t < 0). */
function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const to = t < 0 ? 0 : 255;
  const k = Math.abs(t);
  const ch = (v) => Math.round(v + (to - v) * k);
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default class Hangman extends BaseGame {
  static id = 'hangman';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Solved' };

  setup() {
    this.host.setSecondaryLabel('Solved');
    this.host.setHint('Guess a letter · the category is your hint');
    this.setLives(3);
    this.host.setSecondary(0);

    this.solved = 0;
    this.streak = 0;
    this.finished = false;
    // Gradients and glows are baked into sprites once, not painted per frame.
    this.layers = new Map();
    this.keys = KEY_ROWS.map((_, r) => this.#rowLayout(r));
    this.pool = HANGMAN_CATEGORIES.flatMap((cat) =>
      cat.words.map((word) => ({ word, category: cat.name })),
    );
    this.#newWord();

    this.banner('Six guesses');
    this.play('ready');
  }

  resize() {
    this.layers?.clear();
  }

  #newWord() {
    if (!this.pool.length) {
      this.pool = HANGMAN_CATEGORIES.flatMap((cat) =>
        cat.words.map((word) => ({ word, category: cat.name })),
      );
    }
    const i = Math.floor(this.random() * this.pool.length);
    const entry = this.pool.splice(i, 1)[0];

    this.answer = entry.word;
    this.category = entry.category;
    this.guessed = new Set();
    this.wrong = 0;
    // Every third solve costs a limb of the allowance, to a floor of three.
    this.allowance = Math.max(3, MAX_WRONG - Math.floor(this.solved / 3));
    this.roundOver = null;
    this.nextTimer = 0;
    this.revealTimer = 0;
    this.strokeFrom = 0;
    this.strokeT = 1;
    this.hitLetter = '';
    this.hitPop = 0;
  }

  /** Where a given stage of the figure sits on the six-stage scale. */
  #stageShown(wrong) {
    return Math.ceil((wrong / this.allowance) * MAX_WRONG);
  }

  #guess(letter) {
    if (this.roundOver || this.guessed.has(letter)) return;
    this.guessed.add(letter);

    if (this.answer.includes(letter)) {
      const hits = [...this.answer].filter((c) => c === letter).length;
      const first = this.answer.indexOf(letter);
      this.addScore(25 * hits, {
        x: 300 + first * Math.min(38, (W - 330) / this.answer.length) + 14,
        y: GALLOWS_Y + 78,
        color: '#4ade80',
      });
      this.hitLetter = letter;
      this.hitPop = 0.3;
      this.play('select');
      this.#checkSolved();
      return;
    }

    this.strokeFrom = this.#stageShown(this.wrong);
    this.strokeT = 0;
    this.wrong++;
    this.play('hit');
    this.shake.add(4);
    if (this.wrong >= this.allowance) this.#lose();
  }

  #solvedWord() {
    return [...this.answer].every((c) => this.guessed.has(c));
  }

  #checkSolved() {
    if (!this.#solvedWord()) return;
    this.solved++;
    this.streak++;
    this.host.setSecondary(this.solved);

    const spare = this.allowance - this.wrong;
    const points = 300 + this.answer.length * 60 + spare * 120 + this.streak * 80;
    this.addScore(points, { x: 300 + 80, y: GALLOWS_Y + 84, color: '#4ade80' });
    this.banner(spare === this.allowance ? 'Flawless!' : 'Got it');
    const slot = Math.min(38, (W - 330) / this.answer.length);
    for (let i = 0; i < this.answer.length; i++) {
      this.particles.emit(300 + i * slot + slot / 2, GALLOWS_Y + 104, {
        count: 5, speed: 100, color: '#4ade80', life: 0.7, size: 2.6, shape: 'circle',
      });
    }
    this.play('highscore');
    this.roundOver = 'won';
    this.nextTimer = 1.6;
    this.meta = { solved: this.solved, streak: this.streak };
  }

  #lose() {
    this.streak = 0;
    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    this.play('die');
    this.shake.add(10);
    this.roundOver = 'lost';
    this.nextTimer = 2.6;
    this.meta = { solved: this.solved, answer: this.answer };
    if (lives <= 0) this.finished = true;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.strokeT < 1) this.strokeT = Math.min(1, this.strokeT + dt / STROKE_TIME);
    if (this.hitPop > 0) this.hitPop -= dt;

    if (this.roundOver) {
      this.revealTimer += dt;
      this.nextTimer -= dt;
      if (this.nextTimer <= 0) {
        if (this.finished) this.end();
        else this.#newWord();
      }
      return;
    }

    for (const code of this.input.codeEdges) {
      if (/^Key[A-Z]$/.test(code)) this.#guess(code.slice(3));
    }

    const m = this.mouse;
    if (!m.pressed) return;
    const key = this.#keyAt(m.x, m.y);
    if (key) this.#guess(key);
  }

  /* =============================================================== layout */

  #rowLayout(rowIndex) {
    const letters = KEY_ROWS[rowIndex];
    const unit = (W - 60 - KEY_GAP * 9) / 10;
    const total = letters.length * unit + KEY_GAP * (letters.length - 1);
    const startX = (W - total) / 2;
    const y = KEYBOARD_Y + rowIndex * (KEY_H + KEY_GAP);
    return [...letters].map((label, i) => ({
      label,
      x: startX + i * (unit + KEY_GAP),
      y,
      w: unit,
      h: KEY_H,
    }));
  }

  #keyAt(px, py) {
    for (const row of this.keys) {
      for (const key of row) {
        if (this.hits(px, py, key.x, key.y, key.w, key.h)) return key.label;
      }
    }
    return null;
  }

  /* ============================================================= sprites */

  /** Fetch-or-paint an offscreen layer, rendered once at device resolution. */
  #layer(key, w, h, paint) {
    let c = this.layers.get(key);
    if (c) return c;
    const dpr = Math.min(2, this.host.dpr || 1);
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    paint(g);
    this.layers.set(key, c);
    return c;
  }

  #keySprite(state, w) {
    return this.#layer(`key:${state}:${Math.round(w)}`, w, KEY_H, (g) => {
      const base = state === 'hit' ? '#1c4a2c' : state === 'miss' ? '#141926' : '#232b3b';
      if (state === 'hit') {
        g.shadowColor = 'rgba(74,222,128,0.7)';
        g.shadowBlur = 9;
      }
      const grad = g.createLinearGradient(0, 0, 0, KEY_H);
      grad.addColorStop(0, shade(base, state === 'miss' ? 0.03 : 0.12));
      grad.addColorStop(1, shade(base, -0.2));
      g.fillStyle = grad;
      this.roundRect(g, 0, 0, w, KEY_H, 7).fill();
      g.shadowBlur = 0;
      g.strokeStyle = state === 'hit' ? 'rgba(74,222,128,0.7)' : 'rgba(255,255,255,0.08)';
      g.lineWidth = 1.2;
      this.roundRect(g, 0.75, 0.75, w - 1.5, KEY_H - 1.5, 7).stroke();
      if (state !== 'miss') {
        g.strokeStyle = 'rgba(255,255,255,0.10)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(5, 1.5);
        g.lineTo(w - 5, 1.5);
        g.stroke();
      }
    });
  }

  /** Wells and the gallows frame — none of it ever moves. */
  #backdrop() {
    return this.#layer('backdrop', W, H, (g) => {
      const well = (x, y, w, h) => {
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, 'rgba(255,255,255,0.030)');
        grad.addColorStop(1, 'rgba(255,255,255,0.008)');
        g.fillStyle = grad;
        this.roundRect(g, x, y, w, h, 14).fill();
        g.strokeStyle = 'rgba(255,255,255,0.07)';
        g.lineWidth = 1;
        this.roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 14).stroke();
      };
      well(16, GALLOWS_Y - 34, 250, 254);
      well(282, GALLOWS_Y - 34, W - 298, 254);
      const kbH = KEY_ROWS.length * (KEY_H + KEY_GAP) - KEY_GAP;
      well(16, KEYBOARD_Y - 10, W - 32, kbH + 20);

      const x = GALLOWS_X;
      const y = GALLOWS_Y;
      const wood = g.createLinearGradient(0, y, 0, y + 200);
      wood.addColorStop(0, '#4a5670');
      wood.addColorStop(1, '#333d52');
      g.strokeStyle = wood;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x - 54, y + 200);
      g.lineTo(x + 30, y + 200); // base
      g.moveTo(x - 12, y + 200);
      g.lineTo(x - 12, y); // post
      g.lineTo(x + 58, y); // beam
      g.lineTo(x + 58, y + 26); // rope
      g.stroke();
    });
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#080a10');
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.#backdrop(), 0, 0, W, H);
    this.#drawFigure(ctx);
    this.#drawWord(ctx);
    this.#drawKeyboard(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  /**
   * The figure is drawn in stages, one per wrong guess, and each new segment
   * strokes itself in rather than appearing fully formed. When the allowance
   * is shorter than six the later stages are skipped, so a tighter game still
   * ends with a completed figure.
   */
  #drawFigure(ctx) {
    const lost = this.roundOver === 'lost';
    const color = lost ? '#fb7185' : '#e9edf6';
    // Map the allowance onto the six stages so a shorter rope still completes.
    const shown = this.#stageShown(this.wrong);
    if (shown <= 0) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = lost ? 14 : 6;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    const hx = GALLOWS_X + 58;
    const hy = GALLOWS_Y + 48;
    const lerpLine = (x1, y1, x2, y2, t) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      ctx.stroke();
    };
    const segments = [
      (t) => { // head
        ctx.beginPath();
        ctx.arc(hx, hy, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        ctx.stroke();
      },
      (t) => lerpLine(hx, hy + 22, hx, hy + 92, t), // body
      (t) => lerpLine(hx, hy + 40, hx - 34, hy + 68, t), // left arm
      (t) => lerpLine(hx, hy + 40, hx + 34, hy + 68, t), // right arm
      (t) => lerpLine(hx, hy + 92, hx - 30, hy + 140, t), // left leg
      (t) => lerpLine(hx, hy + 92, hx + 30, hy + 140, t), // right leg
    ];

    // Stages up to strokeFrom are settled; the newer ones sweep in, one after
    // another when a single miss adds more than one.
    const fresh = shown - this.strokeFrom;
    for (let s = 0; s < shown; s++) {
      let t = 1;
      if (s >= this.strokeFrom && fresh > 0) {
        t = Math.max(0, Math.min(1, this.strokeT * fresh - (s - this.strokeFrom)));
      }
      if (t > 0) segments[s](t);
    }
    ctx.restore();
  }

  #drawWord(ctx) {
    const panelX = 300;

    this.text(ctx, this.category.toUpperCase(), panelX, GALLOWS_Y + 6, {
      size: 11, color: '#c084fc', align: 'left', glow: 8,
    });

    // Remaining guesses as pips.
    for (let i = 0; i < this.allowance; i++) {
      const spent = i < this.wrong;
      ctx.save();
      ctx.fillStyle = spent ? '#3a4152' : '#fb7185';
      if (!spent) {
        ctx.shadowColor = '#fb7185';
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(panelX + 8 + i * 20, GALLOWS_Y + 34, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* --- the blanks --- */
    const letters = [...this.answer];
    const maxWidth = W - panelX - 30;
    const slot = Math.min(38, maxWidth / letters.length);
    const startX = panelX;
    const y = GALLOWS_Y + 108;

    letters.forEach((letter, i) => {
      const x = startX + i * slot;
      const known = this.guessed.has(letter);
      const reveal = this.roundOver === 'lost' && !known;

      ctx.save();
      ctx.strokeStyle = reveal ? 'rgba(251,113,133,0.5)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 18);
      ctx.lineTo(x + slot - 6, y + 18);
      ctx.stroke();
      ctx.restore();

      if (known || reveal) {
        // A freshly revealed letter lands with a small pop.
        const pop = known && letter === this.hitLetter && this.hitPop > 0
          ? 1 + Math.sin((1 - this.hitPop / 0.3) * Math.PI) * 0.18 : 1;
        this.text(ctx, letter, x + (slot - 3) / 2, y - 4, {
          size: Math.min(30, slot * 0.86) * pop,
          color: reveal ? '#fb7185' : '#e9edf6',
          glow: known ? 8 : 0,
        });
      }
    });

    if (this.roundOver === 'lost') {
      this.text(ctx, 'THE WORD WAS', panelX, y + 56, { size: 10, color: '#8b93a7', align: 'left' });
    }
    if (this.streak > 1 && !this.roundOver) {
      this.text(ctx, `STREAK ${this.streak}`, panelX, y + 56, {
        size: 11, color: '#fbbf24', align: 'left', glow: 8,
      });
    }
  }

  #drawKeyboard(ctx) {
    for (const row of this.keys) {
      for (const key of row) {
        const used = this.guessed.has(key.label);
        const hit = used && this.answer.includes(key.label);
        const state = hit ? 'hit' : used ? 'miss' : 'none';
        const dy = used ? 1.5 : 0;
        ctx.drawImage(this.#keySprite(state, key.w), key.x, key.y + dy, key.w, key.h);
        this.text(ctx, key.label, key.x + key.w / 2, key.y + dy + key.h / 2, {
          size: 17,
          color: hit ? '#86efac' : used ? '#3a4152' : '#e9edf6',
        });
      }
    }
  }
}
