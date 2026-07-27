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
    this.pool = HANGMAN_CATEGORIES.flatMap((cat) =>
      cat.words.map((word) => ({ word, category: cat.name })),
    );
    this.#newWord();

    this.banner('Six guesses');
    this.play('ready');
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
  }

  #guess(letter) {
    if (this.roundOver || this.guessed.has(letter)) return;
    this.guessed.add(letter);

    if (this.answer.includes(letter)) {
      const hits = [...this.answer].filter((c) => c === letter).length;
      this.addScore(25 * hits);
      this.play('select');
      this.#checkSolved();
      return;
    }

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
    this.addScore(points);
    this.banner(spare === this.allowance ? 'Flawless!' : 'Got it');
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
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
        if (this.hits(px, py, key.x, key.y, key.w, key.h)) return key.label;
      }
    }
    return null;
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#080a10');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawGallows(ctx);
    this.#drawWord(ctx);
    this.#drawKeyboard(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  /**
   * The rope is drawn in stages, one per wrong guess. When the allowance is
   * shorter than six the later stages are skipped, so a tighter game still
   * ends with a completed figure.
   */
  #drawGallows(ctx) {
    const x = GALLOWS_X;
    const y = GALLOWS_Y;

    ctx.save();
    ctx.strokeStyle = '#3f4a5f';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 54, y + 200);
    ctx.lineTo(x + 30, y + 200); // base
    ctx.moveTo(x - 12, y + 200);
    ctx.lineTo(x - 12, y); // post
    ctx.lineTo(x + 58, y); // beam
    ctx.lineTo(x + 58, y + 26); // rope
    ctx.stroke();
    ctx.restore();

    const lost = this.roundOver === 'lost';
    const color = lost ? '#fb7185' : '#e9edf6';
    // Map the allowance onto the six stages so a shorter rope still completes.
    const shown = Math.ceil((this.wrong / this.allowance) * MAX_WRONG);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = lost ? 14 : 6;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    const head = { x: x + 58, y: y + 48 };
    if (shown >= 1) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (shown >= 2) {
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + 22);
      ctx.lineTo(head.x, head.y + 92);
      ctx.stroke();
    }
    if (shown >= 3) {
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + 40);
      ctx.lineTo(head.x - 34, head.y + 68);
      ctx.stroke();
    }
    if (shown >= 4) {
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + 40);
      ctx.lineTo(head.x + 34, head.y + 68);
      ctx.stroke();
    }
    if (shown >= 5) {
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + 92);
      ctx.lineTo(head.x - 30, head.y + 140);
      ctx.stroke();
    }
    if (shown >= 6) {
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + 92);
      ctx.lineTo(head.x + 30, head.y + 140);
      ctx.stroke();
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
        this.text(ctx, letter, x + (slot - 3) / 2, y - 4, {
          size: Math.min(30, slot * 0.86),
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
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
        const used = this.guessed.has(key.label);
        const hit = used && this.answer.includes(key.label);

        ctx.save();
        ctx.fillStyle = hit ? 'rgba(74,222,128,0.28)' : used ? 'rgba(255,255,255,0.03)' : '#232b3b';
        this.roundRect(ctx, key.x, key.y, key.w, key.h, 7).fill();
        if (hit) {
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 1.2;
          this.roundRect(ctx, key.x, key.y, key.w, key.h, 7).stroke();
        }
        ctx.restore();

        this.text(ctx, key.label, key.x + key.w / 2, key.y + key.h / 2, {
          size: 17,
          color: hit ? '#86efac' : used ? '#3a4152' : '#e9edf6',
        });
      }
    }
  }
}
