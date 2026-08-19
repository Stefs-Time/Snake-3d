import { BaseGame } from '../core/game.js';

/**
 * WORD LADDER
 *
 * Change one letter, get a real word, repeat until the start word has
 * become the end word. This is not Scrabble or a crossword — both need a
 * dictionary of tens of thousands of words to judge an arbitrary guess, and
 * this arcade ships none — so instead of validating against a live
 * dictionary, each ladder carries its own small, hand-verified chain, the
 * same way Hangman carries categories rather than looking a word up.
 *
 * Every chain here was checked by machine before it shipped: consecutive
 * rungs are the same length and differ in exactly one letter, never zero,
 * never two. That is a fact about the strings, checkable with no dictionary
 * at all, and it is the one thing this game can promise is never wrong.
 * Whether the individual words are "real" rests on picking common,
 * unambiguous ones by hand — CAT, DOG, WARM, COLD — rather than anything
 * obscure enough to need a second opinion.
 *
 * Three wrong full-word guesses on a rung reveal it rather than stalling the
 * run forever, the same guarantee Sudoku and Lights Out make in their own
 * way — you can always tell whether you are still making progress.
 */

const W = 660;
const H = 560;

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_H = 42;
const KEY_GAP = 6;
const KEYBOARD_Y = 380;

const TILE = 42;
const TILE_GAP = 8;
const ROW_GAP = 12;
const RUNGS_TOP = 108;

const MAX_WRONG = 3;

/** How many locked rungs stay on screen; older ones scroll away. */
const VISIBLE_ROWS = 4;

/** Room baked into a tile sprite for its soft glow. */
const SPRITE_PAD = 12;

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

/**
 * Every chain: same word length throughout, each pair differing in exactly
 * one position. Verified in isolation before being written here (see the
 * commit message) — a struct check, not a claim about the dictionary.
 */
const LADDERS = [
  ['HOUSE', 'MOUSE'],
  ['STONE', 'STORE'],
  ['FOOT', 'FOOD', 'GOOD'],
  ['CAT', 'COT', 'COG', 'DOG'],
  ['CAT', 'BAT', 'BAG', 'BIG'],
  ['DOG', 'DOT', 'DOE', 'TOE'],
  ['PEN', 'PEG', 'LEG', 'LOG'],
  ['TOP', 'TIP', 'TIN', 'TAN'],
  ['SUN', 'RUN', 'RUG', 'RAG'],
  ['MAN', 'MAT', 'MAP', 'MOP'],
  ['BALL', 'BALD', 'BOLD', 'BOLT'],
  ['NAME', 'GAME', 'GATE', 'LATE'],
  ['FIRE', 'HIRE', 'HIVE', 'HIDE'],
  ['COOL', 'COOK', 'BOOK', 'BOOM'],
  ['WIND', 'FIND', 'FINE', 'FIRE'],
  ['WARM', 'WORM', 'WORD', 'CORD', 'COLD'],
  ['HEAD', 'HEAL', 'TEAL', 'TELL', 'TALL', 'TAIL'],
];

function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

export default class WordLadder extends BaseGame {
  static id = 'wordladder';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Solved' };

  setup() {
    this.host.setSecondaryLabel('Solved');
    this.host.setHint('Change one letter each rung · Enter to submit',
      'Tap a letter, then a key · SUBMIT to check the rung');
    this.setLives(3);
    this.host.setSecondary(0);

    this.solved = 0;
    this.pool = [];
    // Gradients and glows are baked into sprites once, not painted per frame.
    this.layers = new Map();
    this.keys = KEY_ROWS.map((_, r) => this.#rowLayout(r));
    this.keyFlash = '';
    this.keyFlashT = 0;
    this.shakeRow = 0;
    this.lockPop = 0;
    this.#newLadder();
    this.banner('Word Ladder');
    this.play('ready');
  }

  resize() {
    this.layers?.clear();
  }

  #newLadder() {
    if (!this.pool.length) {
      this.pool = LADDERS.map((c, i) => i);
      for (let i = this.pool.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
      }
    }
    const chainIndex = this.pool.pop();
    this.chain = LADDERS[chainIndex];
    this.length = this.chain[0].length;
    this.rungs = [this.chain[0].split('')]; // locked rungs, index 0 is the given start
    this.step = 1; // which chain index we are trying to reach next
    this.working = this.chain[0].split('');
    this.selected = 0;
    this.wrongThisRung = 0;
    this.ladderReveals = 0;
    this.message = '';
    this.flashTimer = 0;
  }

  /* ============================================================== editing */

  #setLetter(letter) {
    if (this.over) return;
    this.working[this.selected] = letter;
    this.selected = Math.min(this.length - 1, this.selected + 1);
    this.keyFlash = letter;
    this.keyFlashT = 0.14;
    this.play('blip');
  }

  #backspace() {
    this.selected = Math.max(0, this.selected - 1);
  }

  #selectTile(i) {
    if (i < 0 || i >= this.length) return;
    this.selected = i;
    this.play('hover');
  }

  #submit() {
    this.keyFlash = 'SUBMIT';
    this.keyFlashT = 0.14;
    const guess = this.working.join('');
    const prev = this.chain[this.step - 1];
    const target = this.chain[this.step];
    const diff = diffCount(prev, guess);

    if (diff === 0) {
      this.message = 'Change a letter first';
      this.flashTimer = 1;
      this.shakeRow = 0.4;
      return;
    }
    if (diff > 1) {
      this.message = 'Only one letter may change';
      this.flashTimer = 1;
      this.shakeRow = 0.4;
      this.play('hit');
      return;
    }
    if (guess !== target) {
      this.wrongThisRung++;
      this.play('hit');
      this.shakeRow = 0.4;
      if (this.wrongThisRung >= MAX_WRONG) {
        this.#revealRung();
        return;
      }
      this.message = `Not quite — ${MAX_WRONG - this.wrongThisRung} left before a hint`;
      this.flashTimer = 1;
      return;
    }

    // Correct.
    this.rungs.push(target.split(''));
    this.lockPop = 0.3;
    const y = this.#activeY() - (TILE + ROW_GAP);
    this.addScore(this.wrongThisRung === 0 ? 50 : 25, {
      x: W / 2, y: y + TILE / 2 - 26, color: '#4ade80',
    });
    for (let i = 0; i < this.length; i++) {
      this.particles.emit(this.#rungX() + i * (TILE + TILE_GAP) + TILE / 2, y + TILE / 2, {
        count: 4, speed: 80, color: '#4ade80', life: 0.5, size: 2.4, shape: 'circle',
      });
    }
    this.play(this.wrongThisRung === 0 ? 'powerup' : 'select');
    this.#advanceRung();
  }

  #revealRung() {
    const target = this.chain[this.step];
    this.rungs.push(target.split(''));
    this.ladderReveals++;
    this.setLives(Math.max(0, this.lives - 1));
    this.message = `The word was ${target}`;
    this.flashTimer = 1.4;
    this.play('die');
    if (this.lives <= 0) {
      this.meta = { solved: this.solved };
      this.end();
      return;
    }
    this.#advanceRung();
  }

  #advanceRung() {
    this.step++;
    this.wrongThisRung = 0;
    if (this.step >= this.chain.length) {
      this.solved++;
      this.host.setSecondary(this.solved);
      this.addScore(this.ladderReveals === 0 ? 150 : 60, {
        x: W / 2, y: RUNGS_TOP + 60, color: '#ffd23f',
      });
      this.banner(this.ladderReveals === 0 ? 'Clean solve!' : 'Ladder complete');
      this.play('highscore');
      for (let i = 0; i < 8; i++) {
        this.particles.emit(W / 2 + (this.random() - 0.5) * 220, RUNGS_TOP + this.random() * 200, {
          count: 5, speed: 120, color: i % 2 ? '#4ade80' : '#ffd23f', life: 0.8, size: 2.8, shape: 'circle',
        });
      }
      this.#newLadder();
      return;
    }
    this.working = this.rungs[this.rungs.length - 1].slice();
    this.selected = 0;
  }

  /* ================================================================ input */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.keyFlashT > 0) this.keyFlashT -= dt;
    if (this.shakeRow > 0) this.shakeRow -= dt;
    if (this.lockPop > 0) this.lockPop -= dt;

    if (this.input.keyPressed('Enter')) {
      this.#submit();
      return;
    }
    if (this.input.keyPressed('Backspace')) {
      this.#backspace();
      return;
    }
    for (const code of this.#pressedLetterCodes()) {
      this.#setLetter(code.slice(3));
      return;
    }

    const m = this.mouse;
    if (!m.pressed) return;

    const tile = this.#tileAt(m.x, m.y);
    if (tile != null) {
      this.#selectTile(tile);
      return;
    }
    const key = this.#keyAt(m.x, m.y);
    if (key === 'SUBMIT') this.#submit();
    else if (key) this.#setLetter(key);
  }

  #pressedLetterCodes() {
    const out = [];
    for (const row of KEY_ROWS) {
      for (const ch of row) {
        const code = `Key${ch}`;
        if (this.input.keyPressed(code)) out.push(code);
      }
    }
    return out;
  }

  /* ============================================================== layout */

  #rungY(index) {
    return RUNGS_TOP + index * (TILE + ROW_GAP);
  }

  #rungX() {
    return W / 2 - (this.length * TILE + (this.length - 1) * TILE_GAP) / 2;
  }

  /** Long chains scroll: only the last few locked rungs stay on screen. */
  #firstVisible() {
    return Math.max(0, this.rungs.length - VISIBLE_ROWS);
  }

  /** Screen y of the active row — never past the keyboard, however long the chain. */
  #activeY() {
    return this.#rungY(this.rungs.length - this.#firstVisible());
  }

  #tileAt(mx, my) {
    // Only the active (bottom, unlocked) rung is editable.
    const y = this.#activeY();
    if (my < y || my > y + TILE) return null;
    const x0 = this.#rungX();
    for (let i = 0; i < this.length; i++) {
      const x = x0 + i * (TILE + TILE_GAP);
      if (this.hits(mx, my, x, y, TILE, TILE)) return i;
    }
    return null;
  }

  #rowLayout(rowIndex) {
    const letters = KEY_ROWS[rowIndex];
    const isLast = rowIndex === KEY_ROWS.length - 1;
    const unit = 34;
    const slots = letters.length + (isLast ? 1 : 0);
    const rowW = slots * unit + (slots - 1) * KEY_GAP + (isLast ? 40 : 0);
    let x = W / 2 - rowW / 2;
    const y = KEYBOARD_Y + rowIndex * (KEY_H + KEY_GAP);
    const keys = [];
    for (const ch of letters) {
      keys.push({ label: ch, x, y, w: unit, h: KEY_H });
      x += unit + KEY_GAP;
    }
    if (isLast) keys.push({ label: 'SUBMIT', x, y, w: unit + 40, h: KEY_H });
    return keys;
  }

  #keyAt(mx, my) {
    for (const row of this.keys) {
      for (const key of row) {
        if (this.hits(mx, my, key.x, key.y, key.w, key.h)) return key.label;
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

  /** One rung tile — keycap gradient, glow baked in for the lit states. */
  #tileSprite(kind) {
    const size = TILE + SPRITE_PAD * 2;
    return this.#layer(`tile:${kind}`, size, size, (g) => {
      const x = SPRITE_PAD;
      const y = SPRITE_PAD;
      const base = kind === 'locked' ? '#14331f' : kind === 'selected' ? '#3a3113' : '#161b26';
      if (kind === 'locked') {
        g.shadowColor = 'rgba(74,222,128,0.8)';
        g.shadowBlur = 10;
      } else if (kind === 'selected') {
        g.shadowColor = 'rgba(255,210,63,0.8)';
        g.shadowBlur = 12;
      }
      const grad = g.createLinearGradient(0, y, 0, y + TILE);
      grad.addColorStop(0, shade(base, 0.1));
      grad.addColorStop(1, shade(base, -0.25));
      g.fillStyle = grad;
      this.roundRect(g, x, y, TILE, TILE, 8).fill();
      g.shadowBlur = 0;

      g.strokeStyle = kind === 'locked' ? 'rgba(74,222,128,0.45)'
        : kind === 'selected' ? '#ffd23f' : 'rgba(255,255,255,0.16)';
      g.lineWidth = kind === 'selected' ? 2 : 1.2;
      this.roundRect(g, x + 0.75, y + 0.75, TILE - 1.5, TILE - 1.5, 8).stroke();

      // A thin top light, the thing that makes a flat rect read as a cap.
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 5, y + 1.5);
      g.lineTo(x + TILE - 5, y + 1.5);
      g.stroke();
    });
  }

  #keySprite(kind, w) {
    return this.#layer(`key:${kind}:${Math.round(w)}`, w, KEY_H, (g) => {
      const base = kind === 'submit' ? '#1a3a26' : '#232a39';
      const grad = g.createLinearGradient(0, 0, 0, KEY_H);
      grad.addColorStop(0, shade(base, 0.12));
      grad.addColorStop(1, shade(base, -0.2));
      g.fillStyle = grad;
      this.roundRect(g, 0, 0, w, KEY_H, 7).fill();
      g.strokeStyle = kind === 'submit' ? 'rgba(74,222,128,0.7)' : 'rgba(255,255,255,0.12)';
      g.lineWidth = 1.2;
      this.roundRect(g, 0.75, 0.75, w - 1.5, KEY_H - 1.5, 7).stroke();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(5, 1.5);
      g.lineTo(w - 5, 1.5);
      g.stroke();
    });
  }

  /** The static wells behind the ladder and the keyboard, plus the rails. */
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
      const wellTop = RUNGS_TOP - 14;
      const wellH = (VISIBLE_ROWS + 1) * (TILE + ROW_GAP) - ROW_GAP + 18;
      well(W / 2 - 190, wellTop, 380, wellH);
      const kbH = KEY_ROWS.length * (KEY_H + KEY_GAP) - KEY_GAP;
      well(W / 2 - 220, KEYBOARD_Y - 10, 440, kbH + 20);

      // Two faint side rails so the stack of rungs reads as a ladder.
      g.strokeStyle = 'rgba(74,222,128,0.14)';
      g.lineWidth = 3;
      for (const x of [W / 2 - 165, W / 2 + 165]) {
        g.beginPath();
        g.moveTo(x, wellTop + 12);
        g.lineTo(x, wellTop + wellH - 12);
        g.stroke();
      }
    });
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#0a0d16');
    ctx.save();
    this.shake.apply(ctx);
    ctx.drawImage(this.#backdrop(), 0, 0, W, H);
    this.#drawHeader(ctx);
    this.#drawRungs(ctx);
    this.#drawKeyboard(ctx);
    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawHeader(ctx) {
    const target = this.chain[this.chain.length - 1];
    this.text(ctx, `${this.chain[0]} → ${target}`, W / 2, 24, {
      size: 18, color: '#4ade80', weight: 700, glow: 8,
    });
    this.text(ctx, `${this.step} of ${this.chain.length - 1} rungs`, W / 2, 52, {
      size: 10, color: '#5c6478',
    });
    if (this.message && this.flashTimer > 0) {
      this.text(ctx, this.message, W / 2, 74, { size: 12, color: '#fbbf24', weight: 700 });
    }
  }

  #drawRungs(ctx) {
    const x0 = this.#rungX();
    const first = this.#firstVisible();
    if (first > 0) {
      this.text(ctx, `⋯ ${first} rung${first > 1 ? 's' : ''} above`, W / 2, RUNGS_TOP - 4, {
        size: 10, color: '#5c6478',
      });
    }
    for (let r = first; r < this.rungs.length; r++) {
      const y = this.#rungY(r - first);
      const fresh = r === this.rungs.length - 1 && r > 0 && this.lockPop > 0;
      this.#drawRow(ctx, x0, y, this.rungs[r], {
        locked: true,
        prev: r > 0 ? this.rungs[r - 1] : null,
        pop: fresh ? this.lockPop / 0.3 : 0,
      });
    }
    // The active row being edited.
    const wobble = this.shakeRow > 0 ? Math.sin(this.shakeRow * 60) * this.shakeRow * 16 : 0;
    this.#drawRow(ctx, x0 + wobble, this.#activeY(), this.working, { locked: false });
  }

  #drawRow(ctx, x0, y, letters, { locked, prev = null, pop = 0 }) {
    for (let i = 0; i < this.length; i++) {
      const x = x0 + i * (TILE + TILE_GAP);
      const selected = !locked && i === this.selected;
      const changed = locked && prev && letters[i] !== prev[i];
      const kind = locked ? 'locked' : selected ? 'selected' : 'active';
      const sprite = this.#tileSprite(kind);
      const size = TILE + SPRITE_PAD * 2;
      // A freshly locked rung eases in with a little swell.
      const s = pop > 0 ? 1 + Math.sin((1 - pop) * Math.PI) * 0.06 : 1;
      const grow = (size * s - size) / 2;
      ctx.drawImage(sprite, x - SPRITE_PAD - grow, y - SPRITE_PAD - grow, size * s, size * s);
      if (letters[i]) {
        this.text(ctx, letters[i], x + TILE / 2, y + TILE / 2 + 1, {
          size: 18,
          color: locked ? (changed ? '#c6ffd9' : '#86efac') : '#e9edf6',
          weight: 700,
          glow: changed ? 8 : 0,
        });
      }
    }
  }

  #drawKeyboard(ctx) {
    for (const row of this.keys) {
      for (const key of row) {
        const isSubmit = key.label === 'SUBMIT';
        const pressed = this.keyFlashT > 0 && this.keyFlash === key.label;
        const dy = pressed ? 1.5 : 0;
        ctx.drawImage(this.#keySprite(isSubmit ? 'submit' : 'none', key.w), key.x, key.y + dy, key.w, key.h);
        if (pressed) {
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          this.roundRect(ctx, key.x, key.y + dy, key.w, key.h, 7).fill();
          ctx.restore();
        }
        this.text(ctx, key.label, key.x + key.w / 2, key.y + dy + key.h / 2, {
          size: isSubmit ? 10 : 13, color: isSubmit ? '#86efac' : '#e9edf6', weight: 700,
        });
      }
    }
  }
}
