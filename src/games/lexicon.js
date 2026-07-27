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
    // Draw answers without repeats until the pool runs dry.
    this.pool = [...ANSWERS];
    this.#newWord();

    this.banner('Five letters');
    this.play('ready');
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
    this.play('blip');
  }

  #backspace() {
    if (!this.current.length || this.flip) return;
    this.current = this.current.slice(0, -1);
    this.play('back');
  }

  #submit() {
    if (this.flip || this.roundOver) return;
    if (this.current.length < COLS) {
      this.#say('Needs five letters');
      this.shakeRow = 0.4;
      this.play('hit');
      return;
    }
    if (!isValidGuess(this.current)) {
      this.#say('Letters only');
      this.shakeRow = 0.4;
      return;
    }

    const marks = this.#mark(this.current);
    this.guesses.push({ word: this.current, marks });
    this.#updateKeyState(this.current, marks);
    this.flip = { row: this.guesses.length - 1, t: 0 };
    this.current = '';
  }

  #say(text) {
    this.message = text;
    this.messageTimer = 1.6;
  }

  /* ============================================================ outcomes */

  #afterReveal() {
    const last = this.guesses[this.guesses.length - 1];

    if (last.word === this.answer) {
      const used = this.guesses.length;
      const points = Math.max(200, 1200 - (used - 1) * 180) + this.streak * 100;
      this.addScore(points);
      this.solved++;
      this.streak++;
      this.host.setSecondary(this.solved);
      this.meta = { solved: this.solved, streak: this.streak };
      this.banner(['Genius', 'Sharp', 'Solid', 'Steady', 'Close', 'Phew'][used - 1] ?? 'Solved');
      this.play('highscore');
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
      this.#say(`It was ${this.answer}`);
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

  /* ================================================================ draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

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

      for (let col = 0; col < COLS; col++) {
        const x = BOARD_X + col * (TILE + TILE_GAP) + wobble;
        const y = BOARD_Y + row * (TILE + TILE_GAP);

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

        this.#drawTile(ctx, x, y, letter, mark, progress, isCurrent && col === this.current.length);
      }
    }
  }

  #drawTile(ctx, x, y, letter, mark, progress, isCursor) {
    // The flip is a vertical squash through the midpoint.
    const scaleY = Math.abs(Math.cos(Math.min(1, progress) * Math.PI));
    const flipping = progress < 1;
    const h = flipping ? TILE * Math.max(0.06, scaleY) : TILE;
    const oy = (TILE - h) / 2;

    ctx.save();
    if (mark) {
      ctx.fillStyle = COLORS[mark];
      if (mark !== 'absent') {
        ctx.shadowColor = COLORS[mark];
        ctx.shadowBlur = 14;
      }
      this.roundRect(ctx, x, y + oy, TILE, h, 7).fill();
    } else {
      ctx.fillStyle = COLORS.empty;
      this.roundRect(ctx, x, y + oy, TILE, h, 7).fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = letter || isCursor ? 'rgba(255,255,255,0.34)' : COLORS.border;
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, x + 0.75, y + oy + 0.75, TILE - 1.5, h - 1.5, 7).stroke();
    }
    ctx.restore();

    if (letter && (!flipping || scaleY > 0.3)) {
      const dark = mark === 'correct' || mark === 'present';
      this.text(ctx, letter, x + TILE / 2, y + TILE / 2, {
        size: 30,
        color: dark ? '#0b0e15' : '#e9edf6',
      });
    }
  }

  #drawKeyboard(ctx) {
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
        const state = this.keyState[key.label];
        const wide = key.label.length > 1;

        ctx.save();
        ctx.fillStyle = state ? COLORS[state] : '#2b3242';
        this.roundRect(ctx, key.x, key.y, key.w, key.h, 6).fill();
        ctx.restore();

        const dark = state === 'correct' || state === 'present';
        this.text(ctx, key.label, key.x + key.w / 2, key.y + key.h / 2, {
          size: wide ? 11 : 17,
          color: dark ? '#0b0e15' : state === 'absent' ? '#7a8496' : '#e9edf6',
        });
      }
    }
  }
}
