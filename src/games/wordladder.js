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
    this.#newLadder();
    this.banner('Word Ladder');
    this.play('ready');
  }

  #newLadder() {
    if (!this.pool.length) this.pool = LADDERS.map((c, i) => i).sort(() => this.random() - 0.5);
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
    const guess = this.working.join('');
    const prev = this.chain[this.step - 1];
    const target = this.chain[this.step];
    const diff = diffCount(prev, guess);

    if (diff === 0) {
      this.message = 'Change a letter first';
      this.flashTimer = 1;
      return;
    }
    if (diff > 1) {
      this.message = 'Only one letter may change';
      this.flashTimer = 1;
      this.play('hit');
      return;
    }
    if (guess !== target) {
      this.wrongThisRung++;
      this.play('hit');
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
    this.addScore(this.wrongThisRung === 0 ? 50 : 25);
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
      this.addScore(this.ladderReveals === 0 ? 150 : 60);
      this.banner(this.ladderReveals === 0 ? 'Clean solve!' : 'Ladder complete');
      this.play('highscore');
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

  #tileAt(mx, my) {
    // Only the active (topmost, unlocked) rung is editable.
    const y = this.#rungY(this.rungs.length);
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
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
        if (this.hits(mx, my, key.x, key.y, key.w, key.h)) return key.label;
      }
    }
    return null;
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#0a0d16');
    ctx.save();
    this.shake.apply(ctx);
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
    for (let r = 0; r < this.rungs.length; r++) {
      const y = this.#rungY(r);
      const locked = true;
      this.#drawRow(ctx, x0, y, this.rungs[r], { locked });
    }
    // The active row being edited.
    const y = this.#rungY(this.rungs.length);
    this.#drawRow(ctx, x0, y, this.working, { locked: false });
  }

  #drawRow(ctx, x0, y, letters, { locked }) {
    for (let i = 0; i < this.length; i++) {
      const x = x0 + i * (TILE + TILE_GAP);
      const selected = !locked && i === this.selected;
      ctx.save();
      ctx.fillStyle = locked ? 'rgba(74,222,128,0.12)' : selected ? 'rgba(255,210,63,0.18)' : 'rgba(255,255,255,0.04)';
      this.roundRect(ctx, x, y, TILE, TILE, 8).fill();
      ctx.strokeStyle = locked ? 'rgba(74,222,128,0.4)' : selected ? '#ffd23f' : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = selected ? 2 : 1.2;
      this.roundRect(ctx, x, y, TILE, TILE, 8).stroke();
      ctx.restore();
      if (letters[i]) {
        this.text(ctx, letters[i], x + TILE / 2, y + TILE / 2, {
          size: 18, color: locked ? '#86efac' : '#e9edf6', weight: 700,
        });
      }
    }
  }

  #drawKeyboard(ctx) {
    for (let r = 0; r < KEY_ROWS.length; r++) {
      for (const key of this.#rowLayout(r)) {
        const isSubmit = key.label === 'SUBMIT';
        ctx.save();
        ctx.fillStyle = isSubmit ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.05)';
        this.roundRect(ctx, key.x, key.y, key.w, key.h, 7).fill();
        ctx.strokeStyle = isSubmit ? '#4ade80' : 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1.2;
        this.roundRect(ctx, key.x, key.y, key.w, key.h, 7).stroke();
        ctx.restore();
        this.text(ctx, key.label, key.x + key.w / 2, key.y + key.h / 2, {
          size: isSubmit ? 10 : 13, color: isSubmit ? '#86efac' : '#e9edf6', weight: 700,
        });
      }
    }
  }
}
