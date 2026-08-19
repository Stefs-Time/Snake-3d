import { BaseGame } from '../core/game.js';
import { ANSWERS, isValidGuess } from './words.js';

/**
 * LEXICON — five letters, six guesses
 *
 * The scoring rule that matters is the duplicate-letter one, and it is where
 * most clones get it wrong. Marking is two passes: first claim every exact
 * position, then hand out "present" marks only from the letters that were not
 * already claimed. So guessing SPEED against ERASE marks one E present and
 * leaves the other grey — because there is only one spare E to give.
 *
 * Solve a word and another one arrives, so a run is a streak rather than a
 * single puzzle. Three failures ends it.
 */

const COLS = 5;
const ROWS = 6;

const TILE = 62;
const TILE_GAP = 8;
const BOARD_W = COLS * TILE + (COLS - 1) * TILE_GAP;

const W = 560;
const H = 668;
const BOARD_X = (W - BOARD_W) / 2;
const BOARD_Y = 16;
const BOARD_H = ROWS * TILE + (ROWS - 1) * TILE_GAP;

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_H = 54;
const KEY_GAP = 6;
const KEYBOARD_Y = BOARD_Y + BOARD_H + 26;

const FLIP_TIME = 0.26; // per tile

const COLORS = {
  correct: '#4ade80',
  present: '#facc15',
  absent: '#39404f',
  empty: '#161b26',
  border: 'rgba(255,255,255,0.14)',
};

/** Room baked into a tile sprite for its soft glow. */
const SPRITE_PAD = 14;

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

export default class Lexicon extends BaseGame {
  static id = 'lexicon';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Solved' };

  setup() {
    this.host.setSecondaryLabel('Solved');
    this.host.setHint('Type a five-letter word · Enter to submit',
      'Tap the keyboard below · ENTER to submit');
    this.setLives(3);

    this.solved = 0;
    this.streak = 0;
    this.host.setSecondary(0);
    // Gradients and glows are baked into sprites once, not painted per frame.
    this.layers = new Map();
    this.keyFlash = '';
    this.keyFlashT = 0;
    this.typePop = 0;
    this.typeCol = -1;
    this.winRow = -1;
    this.winT = 0;
    // Draw answers without repeats until the pool runs dry.
    this.pool = [...ANSWERS];
    this.#newWord();

    this.banner('Five letters');
    this.play('ready');
  }

  resize() {
    this.layers?.clear();
  }

  #newWord() {
    if (!this.pool.length) this.pool = [...ANSWERS];
    const i = Math.floor(this.random() * this.pool.length);
    this.answer = this.pool.splice(i, 1)[0];

    this.guesses = []; // [{ word, marks }]
    this.current = '';
    this.keyState = {}; // letter -> 'correct' | 'present' | 'absent'
    this.flip = null; // { row, t }
    this.shakeRow = 0;
    this.message = '';
    this.messageTimer = 0;
    this.roundOver = false;
    this.winRow = -1;
    this.winT = 0;
  }

  /* ================================================================ marks */

  /**
   * Two passes: exact matches first, then presents drawn from what is left.
   * Without the tally, a guess with two of a letter gets two marks even when
   * the answer only has one.
   */
  #mark(guess) {
    const marks = Array(COLS).fill('absent');
    const remaining = {};

    for (let i = 0; i < COLS; i++) {
      if (guess[i] === this.answer[i]) marks[i] = 'correct';
      else remaining[this.answer[i]] = (remaining[this.answer[i]] ?? 0) + 1;
    }

    for (let i = 0; i < COLS; i++) {
      if (marks[i] === 'correct') continue;
      const letter = guess[i];
      if (remaining[letter] > 0) {
        marks[i] = 'present';
        remaining[letter]--;
      }
    }
    return marks;
  }

  /** The keyboard only ever gets better news, never worse. */
  #updateKeyState(guess, marks) {
    const rank = { absent: 0, present: 1, correct: 2 };
    for (let i = 0; i < COLS; i++) {
      const letter = guess[i];
      const next = marks[i];
      const now = this.keyState[letter];
      if (!now || rank[next] > rank[now]) this.keyState[letter] = next;
    }
  }

  /* =============================================================== input */

  #type(letter) {
    if (this.current.length >= COLS || this.flip) return;
    this.current += letter;
    this.typePop = 0.16;
    this.typeCol = this.current.length - 1;
    this.keyFlash = letter;
    this.keyFlashT = 0.14;
    this.play('blip');
  }

  #backspace() {
    if (!this.current.length || this.flip) return;
    this.current = this.current.slice(0, -1);
    this.keyFlash = 'BACK';
    this.keyFlashT = 0.14;
    this.play('back');
  }

  #submit() {
    if (this.flip || this.roundOver) return;
    this.keyFlash = 'ENTER';
    this.keyFlashT = 0.14;
    if (this.current.length < COLS) {
      this.#say('Needs five letters');
      this.shakeRow = 0.4;
      this.play('hit');
      return;
    }
    if (!isValidGuess(this.current)) {
      this.#say('Letters only');
      this.shakeRow = 0.4;
      this.play('hit');
      return;
    }

    const marks = this.#mark(this.current);
    this.guesses.push({ word: this.current, marks });
    this.#updateKeyState(this.current, marks);
    this.flip = { row: this.guesses.length - 1, t: 0 };
    this.current = '';
  }

  #say(text, dur = 1.6) {
    this.message = text;
    this.messageTimer = dur;
  }

  /* ============================================================ outcomes */

  #afterReveal() {
    const last = this.guesses[this.guesses.length - 1];

    if (last.word === this.answer) {
      const used = this.guesses.length;
      const points = Math.max(200, 1200 - (used - 1) * 180) + this.streak * 100;
      const rowY = BOARD_Y + (used - 1) * (TILE + TILE_GAP) + TILE / 2;
      this.addScore(points, { x: W / 2, y: rowY - 44, color: COLORS.correct });
      this.solved++;
      this.streak++;
      this.host.setSecondary(this.solved);
      this.meta = { solved: this.solved, streak: this.streak };
      this.banner(['Genius', 'Sharp', 'Solid', 'Steady', 'Close', 'Phew'][used - 1] ?? 'Solved');
      this.play('highscore');
      this.winRow = used - 1;
      this.winT = 0.9;
      for (let c = 0; c < COLS; c++) {
        this.particles.emit(BOARD_X + c * (TILE + TILE_GAP) + TILE / 2, rowY, {
          count: 6, speed: 110, color: COLORS.correct, life: 0.7, size: 2.6, shape: 'circle',
        });
      }
      this.roundOver = true;
      this.nextTimer = 1.5;
      return;
    }

    if (this.guesses.length >= ROWS) {
      this.streak = 0;
      const lives = this.lives - 1;
      this.setLives(Math.max(0, lives));
      this.play('die');
      this.shake.add(9);
      this.#say(`It was ${this.answer}`, 2.5);
      this.roundOver = true;
      this.nextTimer = 2.6;
      if (lives <= 0) {
        this.meta = { solved: this.solved, answer: this.answer };
        this.nextTimer = 2.6;
        this.finalRound = true;
      }
      return;
    }

    this.play('select');
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.messageTimer > 0) this.messageTimer -= dt;
    if (this.shakeRow > 0) this.shakeRow -= dt;
    if (this.keyFlashT > 0) this.keyFlashT -= dt;
    if (this.typePop > 0) this.typePop -= dt;
    if (this.winT > 0) this.winT -= dt;

    /* --- reveal animation --- */
    if (this.flip) {
      this.flip.t += dt;
      if (this.flip.t >= FLIP_TIME * COLS) {
        this.flip = null;
        this.#afterReveal();
      }
      return;
    }

    /* --- between words --- */
    if (this.roundOver) {
      this.nextTimer -= dt;
      if (this.nextTimer <= 0) {
        if (this.finalRound) this.end();
        else this.#newWord();
      }
      return;
    }

    this.#handleKeyboard();
    this.#handlePointer();
  }

  #handleKeyboard() {
    for (const code of this.input.codeEdges) {
      if (/^Key[A-Z]$/.test(code)) this.#type(code.slice(3));
    }
    // Deliberately not `pressed('action')`: on a touch device that fires for
    // every tap, which would submit the moment you pressed a letter key.
    if (this.input.keyPressed('Enter') || this.input.keyPressed('NumpadEnter')) this.#submit();
    if (this.input.keyPressed('Backspace')) this.#backspace();
  }

  #handlePointer() {
    const m = this.mouse;
    if (!m.pressed) return;
    const key = this.#keyAt(m.x, m.y);
    if (!key) return;
    if (key === 'ENTER') this.#submit();
    else if (key === 'BACK') this.#backspace();
    else this.#type(key);
  }

  /* ============================================================== layout */

  /** Geometry for one keyboard row, shared by drawing and hit-testing. */
  #rowLayout(rowIndex) {
    const letters = KEY_ROWS[rowIndex];
    const isLast = rowIndex === 2;
    const slots = letters.length + (isLast ? 2 : 0); // ENTER and BACK are wide
    const unit = (W - 20 - KEY_GAP * (slots - 1)) / (KEY_ROWS[0].length + 1.0);
    const wide = unit * 1.5;
    const widths = [];

    if (isLast) widths.push(wide);
    for (let i = 0; i < letters.length; i++) widths.push(unit);
    if (isLast) widths.push(wide);

    const total = widths.reduce((a, b) => a + b, 0) + KEY_GAP * (widths.length - 1);
    const startX = (W - total) / 2;
    const y = KEYBOARD_Y + rowIndex * (KEY_H + KEY_GAP);

    const keys = [];
    let x = startX;
    widths.forEach((w, i) => {
      let label;
      if (isLast && i === 0) label = 'ENTER';
      else if (isLast && i === widths.length - 1) label = 'BACK';
      else label = letters[isLast ? i - 1 : i];
      keys.push({ label, x, y, w, h: KEY_H });
      x += w + KEY_GAP;
    });
    return keys;
  }

  #keyAt(px, py) {
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
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

  /** One tile face — keycap gradient, and for marks a baked-in glow. */
  #tileSprite(kind) {
    const size = TILE + SPRITE_PAD * 2;
    return this.#layer(`tile:${kind}`, size, size, (g) => {
      const x = SPRITE_PAD;
      const y = SPRITE_PAD;
      const marked = kind === 'correct' || kind === 'present' || kind === 'absent';

      if (kind === 'correct' || kind === 'present') {
        g.shadowColor = COLORS[kind];
        g.shadowBlur = 13;
      }
      const grad = g.createLinearGradient(0, y, 0, y + TILE);
      if (marked) {
        grad.addColorStop(0, shade(COLORS[kind], 0.16));
        grad.addColorStop(1, shade(COLORS[kind], -0.14));
      } else {
        grad.addColorStop(0, shade(COLORS.empty, 0.06));
        grad.addColorStop(1, shade(COLORS.empty, -0.3));
      }
      g.fillStyle = grad;
      this.roundRect(g, x, y, TILE, TILE, 7).fill();
      g.shadowBlur = 0;

      // A thin top light, the thing that makes a flat rect read as a cap.
      g.strokeStyle = marked ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 6, y + 1.5);
      g.lineTo(x + TILE - 6, y + 1.5);
      g.stroke();

      if (!marked) {
        g.strokeStyle = kind === 'active' ? 'rgba(255,255,255,0.34)' : COLORS.border;
        g.lineWidth = 1.5;
        this.roundRect(g, x + 0.75, y + 0.75, TILE - 1.5, TILE - 1.5, 7).stroke();
      }
    });
  }

  #keySprite(state, w) {
    const key = `key:${state}:${Math.round(w)}`;
    return this.#layer(key, w, KEY_H, (g) => {
      const base = state === 'none' ? '#2b3242' : COLORS[state];
      const grad = g.createLinearGradient(0, 0, 0, KEY_H);
      grad.addColorStop(0, shade(base, state === 'absent' ? 0.04 : 0.14));
      grad.addColorStop(1, shade(base, -0.18));
      g.fillStyle = grad;
      this.roundRect(g, 0, 0, w, KEY_H, 6).fill();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(5, 1.5);
      g.lineTo(w - 5, 1.5);
      g.stroke();
    });
  }

  /** The static wells behind the board and the keyboard. */
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
      well(BOARD_X - 14, BOARD_Y - 12, BOARD_W + 28, BOARD_H + 24);
      const kbH = KEY_ROWS.length * (KEY_H + KEY_GAP) - KEY_GAP;
      well(8, KEYBOARD_Y - 10, W - 16, kbH + 20);
    });
  }

  /* ================================================================ draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.#backdrop(), 0, 0, W, H);
    this.#drawBoard(ctx);
    this.#drawKeyboard(ctx);

    if (this.messageTimer > 0) {
      const alpha = Math.min(1, this.messageTimer * 2);
      ctx.save();
      ctx.globalAlpha = alpha;
      const w = 240;
      ctx.fillStyle = 'rgba(233,237,246,0.95)';
      this.roundRect(ctx, (W - w) / 2, BOARD_Y + BOARD_H + 2, w, 30, 8).fill();
      this.text(ctx, this.message, W / 2, BOARD_Y + BOARD_H + 17, { size: 12, color: '#0b0e15' });
      ctx.restore();
    }

    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawBoard(ctx) {
    for (let row = 0; row < ROWS; row++) {
      const guess = this.guesses[row];
      const isCurrent = row === this.guesses.length && !this.flip;
      const wobble =
        isCurrent && this.shakeRow > 0 ? Math.sin(this.shakeRow * 60) * this.shakeRow * 18 : 0;
      const isWinRow = row === this.winRow && this.winT > 0;

      for (let col = 0; col < COLS; col++) {
        const x = BOARD_X + col * (TILE + TILE_GAP) + wobble;
        let y = BOARD_Y + row * (TILE + TILE_GAP);

        let letter = '';
        let mark = null;
        let progress = 1;

        if (guess) {
          letter = guess.word[col];
          mark = guess.marks[col];
          if (this.flip && this.flip.row === row) {
            // Each tile turns a beat after the one before it.
            const local = (this.flip.t - col * FLIP_TIME) / FLIP_TIME;
            progress = Math.max(0, Math.min(1, local));
            if (progress <= 0.5) mark = null; // colour appears at the halfway point
          }
        } else if (isCurrent) {
          letter = this.current[col] ?? '';
        }

        if (isWinRow) {
          // A little wave rolls along the solved row, one tile after another.
          const ph = Math.max(0, Math.min(1, (0.9 - this.winT) * 2.4 - col * 0.14));
          y -= Math.sin(ph * Math.PI) * 6;
        }

        const pop = isCurrent && col === this.typeCol && this.typePop > 0
          ? 1 + (this.typePop / 0.16) * 0.14 : 1;
        this.#drawTile(ctx, x, y, letter, mark, progress, isCurrent && col === this.current.length, pop);
      }
    }
  }

  #drawTile(ctx, x, y, letter, mark, progress, isCursor, pop = 1) {
    // The flip is a vertical squash through the midpoint.
    const scaleY = Math.abs(Math.cos(Math.min(1, progress) * Math.PI));
    const flipping = progress < 1;
    const h = flipping ? TILE * Math.max(0.06, scaleY) : TILE;
    const oy = (TILE - h) / 2;
    const sy = h / TILE;

    const kind = mark ?? (letter || isCursor ? 'active' : 'empty');
    const sprite = this.#tileSprite(kind);
    const size = TILE + SPRITE_PAD * 2;
    ctx.drawImage(sprite, x - SPRITE_PAD, y + oy - SPRITE_PAD * sy, size, size * sy);

    if (letter && (!flipping || scaleY > 0.3)) {
      const dark = mark === 'correct' || mark === 'present';
      this.text(ctx, letter, x + TILE / 2, y + TILE / 2 + 1, {
        size: 30 * pop,
        color: dark ? '#0b0e15' : '#e9edf6',
      });
    }
  }

  #drawKeyboard(ctx) {
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
        const state = this.keyState[key.label];
        const wide = key.label.length > 1;
        const pressed = this.keyFlashT > 0 && this.keyFlash === key.label;
        const dy = pressed ? 1.5 : 0;

        ctx.drawImage(this.#keySprite(state ?? 'none', key.w), key.x, key.y + dy, key.w, key.h);
        if (pressed) {
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          this.roundRect(ctx, key.x, key.y + dy, key.w, key.h, 6).fill();
          ctx.restore();
        }

        const dark = state === 'correct' || state === 'present';
        this.text(ctx, key.label, key.x + key.w / 2, key.y + dy + key.h / 2, {
          size: wide ? 11 : 17,
          color: dark ? '#0b0e15' : state === 'absent' ? '#7a8496' : '#e9edf6',
        });
      }
    }
  }
}
