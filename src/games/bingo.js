import { BaseGame } from '../core/game.js';

/**
 * BINGO
 *
 * Two cards, one caller, and no auto-daubing — you have to spot your own
 * numbers, which is the entire game. The caller speeds up as the round goes on,
 * so the pressure is in keeping up with two cards at once rather than in luck.
 * Missing a number is not fatal; you can still daub it later, but the points
 * for a quick daub decay, so it costs you.
 *
 * Standard B-I-N-G-O columns: each column draws from its own range of fifteen,
 * and the centre square is free.
 */

const W = 760;
const H = 520;

const CARD_COLS = 5;
const CARD_ROWS = 5;
const CELL = 62;
const CARD_W = CARD_COLS * CELL;
const CARD_H = CARD_ROWS * CELL + 34; // header strip

const CARD_Y = 92;
const CARD_GAP = 40;
const CARD_X = [
  (W - CARD_W * 2 - CARD_GAP) / 2,
  (W - CARD_W * 2 - CARD_GAP) / 2 + CARD_W + CARD_GAP,
];

const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COL_COLORS = ['#fb7185', '#fbbf24', '#4ade80', '#38bdf8', '#c084fc'];

const CALL_START = 3.4;
const CALL_MIN = 1.5;

export default class Bingo extends BaseGame {
  static id = 'bingo';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Lines' };

  setup() {
    this.host.setSecondaryLabel('Lines');
    this.host.setHint('Click your numbers as they are called', 'Tap your numbers as they are called');
    this.setLives(3);

    this.round = 1;
    this.totalLines = 0;
    this.breakTimer = 0;
    this.#startRound();
    this.banner('Eyes down');
    this.play('ready');
  }

  #startRound() {
    this.cards = [this.#makeCard(), this.#makeCard()];

    // The bag: 75 numbers, drawn without replacement.
    this.bag = Array.from({ length: 75 }, (_, i) => i + 1);
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }

    this.called = new Set();
    this.recent = [];
    this.current = null;
    this.callTimer = 2.2;
    this.callInterval = CALL_START;
    this.roundLines = 0;
    this.host.setSecondary(this.totalLines);
  }

  /** A standard card: column n draws from n*15+1 .. n*15+15, centre is free. */
  #makeCard() {
    const cells = [];
    for (let col = 0; col < CARD_COLS; col++) {
      const pool = Array.from({ length: 15 }, (_, i) => col * 15 + i + 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (let row = 0; row < CARD_ROWS; row++) {
        const free = col === 2 && row === 2;
        cells.push({ col, row, value: free ? 0 : pool[row], daubed: free, free });
      }
    }
    return { cells, lines: new Set() };
  }

  /* =============================================================== calling */

  #call() {
    if (!this.bag.length) {
      this.#endRound(false);
      return;
    }
    const value = this.bag.pop();
    this.called.add(value);
    this.current = { value, age: 0 };
    this.recent.unshift(value);
    if (this.recent.length > 8) this.recent.pop();

    // A tone that climbs with the number, so the caller has a sound of its own.
    this.tone(220 + value * 6, { dur: 0.12, gain: 0.16, type: 'triangle' });

    // The caller quickens as the round wears on.
    this.callInterval = Math.max(CALL_MIN, CALL_START - this.called.size * 0.032 - (this.round - 1) * 0.2);
    this.callTimer = this.callInterval;
  }

  /* =============================================================== daubing */

  #daub(card, cell) {
    if (cell.daubed || !this.called.has(cell.value)) {
      // Daubing a number that has not been called is a penalty.
      this.addScore(-25);
      this.play('hit');
      this.shake.add(4);
      return;
    }

    cell.daubed = true;
    // Fresh calls are worth much more than ones you nearly let slip.
    const freshness = this.recent.indexOf(cell.value);
    const points = freshness === 0 ? 100 : freshness > 0 ? Math.max(30, 90 - freshness * 12) : 20;
    this.addScore(points, {
      x: this.#cellX(card, cell) + CELL / 2,
      y: this.#cellY(card, cell) + CELL / 2,
      color: COL_COLORS[cell.col],
      label: `+${points}`,
    });
    this.play('blip');
    this.#checkLines(card);
  }

  /** Rows, columns and both diagonals. */
  #lineDefinitions() {
    if (this.#lines) return this.#lines;
    const lines = [];
    for (let r = 0; r < CARD_ROWS; r++) {
      lines.push({ key: `r${r}`, cells: Array.from({ length: 5 }, (_, c) => [c, r]) });
    }
    for (let c = 0; c < CARD_COLS; c++) {
      lines.push({ key: `c${c}`, cells: Array.from({ length: 5 }, (_, r) => [c, r]) });
    }
    lines.push({ key: 'd1', cells: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]] });
    lines.push({ key: 'd2', cells: [[4, 0], [3, 1], [2, 2], [1, 3], [0, 4]] });
    this.#lines = lines;
    return lines;
  }

  #lines = null;

  #checkLines(card) {
    for (const line of this.#lineDefinitions()) {
      if (card.lines.has(line.key)) continue;
      const complete = line.cells.every(([c, r]) =>
        card.cells.find((cell) => cell.col === c && cell.row === r).daubed,
      );
      if (!complete) continue;

      card.lines.add(line.key);
      this.roundLines++;
      this.totalLines++;
      this.host.setSecondary(this.totalLines);
      this.addScore(500);
      this.play('powerup');
      this.shake.add(7);
      this.banner('Line!');
      this.meta = { lines: this.totalLines, round: this.round };
    }

    // A full house ends the round early and pays well.
    if (card.cells.every((cell) => cell.daubed)) this.#endRound(true);
  }

  #endRound(fullHouse) {
    if (fullHouse) {
      this.addScore(2500);
      this.banner('Full house!');
      this.play('highscore');
      this.round++;
      this.breakTimer = 2.2;
      return;
    }

    // The bag ran out. Every line you got keeps you in; no lines costs a life.
    if (this.roundLines > 0) {
      this.addScore(300 * this.roundLines);
      this.banner('Round over');
      this.play('levelup');
      this.round++;
      this.breakTimer = 2;
      return;
    }

    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    this.play('die');
    if (lives <= 0) {
      this.meta = { lines: this.totalLines, round: this.round };
      this.end();
      return;
    }
    this.banner('No lines');
    this.round++;
    this.breakTimer = 2;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.#startRound();
      return;
    }

    if (this.current) this.current.age += dt;

    this.callTimer -= dt;
    if (this.callTimer <= 0) this.#call();

    const m = this.mouse;
    if (!m.pressed) return;

    for (const card of this.cards) {
      for (const cell of card.cells) {
        const x = this.#cellX(card, cell);
        const y = this.#cellY(card, cell);
        if (this.hits(m.x, m.y, x, y, CELL, CELL)) {
          this.#daub(card, cell);
          return;
        }
      }
    }
  }

  /* =============================================================== layout */

  #cardIndex(card) {
    return this.cards.indexOf(card);
  }

  #cellX(card, cell) {
    return CARD_X[this.#cardIndex(card)] + cell.col * CELL;
  }

  #cellY(card, cell) {
    return CARD_Y + 34 + cell.row * CELL;
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#0a0710');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawCaller(ctx);
    for (const card of this.cards) this.#drawCard(ctx, card);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawCaller(ctx) {
    /* --- the current ball, front and centre --- */
    const cx = W / 2;
    const cy = 44;

    if (this.current) {
      const pop = Math.max(0, 1 - this.current.age * 4);
      const r = 30 + pop * 6;
      const col = Math.floor((this.current.value - 1) / 15);
      const color = COL_COLORS[col];

      this.glowCircle(ctx, cx, cy, r, color, 20 + pop * 24);
      this.text(ctx, `${LETTERS[col]}${this.current.value}`, cx, cy, {
        size: 22, color: '#0b0e15',
      });
    } else {
      this.text(ctx, 'WAITING', cx, cy, { size: 14, color: '#8b93a7' });
    }

    /* --- the ones before it, fading back --- */
    this.recent.slice(1).forEach((value, i) => {
      const col = Math.floor((value - 1) / 15);
      const x = cx + 74 + i * 46;
      ctx.save();
      ctx.globalAlpha = Math.max(0.15, 0.7 - i * 0.09);
      this.glowCircle(ctx, x, cy, 17, COL_COLORS[col], 6);
      ctx.restore();
      this.text(ctx, String(value), x, cy, { size: 12, color: '#0b0e15' });
    });

    /* --- how much of the bag is left --- */
    const barW = 150;
    const pct = this.bag.length / 75;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.roundRect(ctx, cx - 74 - barW - 16, cy - 3, barW, 6, 3).fill();
    ctx.fillStyle = '#fbbf24';
    this.roundRect(ctx, cx - 74 - barW - 16, cy - 3, Math.max(2, barW * pct), 6, 3).fill();
    ctx.restore();
    this.text(ctx, `${this.bag.length} LEFT`, cx - 74 - barW - 16, cy + 18, {
      size: 10, color: '#8b93a7', align: 'left',
    });
  }

  #drawCard(ctx, card) {
    const index = this.#cardIndex(card);
    const x = CARD_X[index];
    const y = CARD_Y;

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    this.roundRect(ctx, x - 8, y - 8, CARD_W + 16, CARD_H + 16, 12).fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x - 8, y - 8, CARD_W + 16, CARD_H + 16, 12).stroke();
    ctx.restore();

    /* --- B I N G O header --- */
    LETTERS.forEach((letter, i) => {
      this.text(ctx, letter, x + i * CELL + CELL / 2, y + 16, {
        size: 22, color: COL_COLORS[i], glow: 10,
      });
    });

    /* --- cells --- */
    for (const cell of card.cells) {
      const cxp = this.#cellX(card, cell);
      const cyp = this.#cellY(card, cell);

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cxp + 0.5, cyp + 0.5, CELL - 1, CELL - 1);
      ctx.restore();

      if (cell.free) {
        this.text(ctx, 'FREE', cxp + CELL / 2, cyp + CELL / 2, { size: 12, color: '#4ade80' });
      }

      if (cell.daubed) {
        this.glowCircle(ctx, cxp + CELL / 2, cyp + CELL / 2, CELL * 0.36, COL_COLORS[cell.col], 12);
      }

      if (!cell.free) {
        const live = !cell.daubed && this.called.has(cell.value);
        this.text(ctx, String(cell.value), cxp + CELL / 2, cyp + CELL / 2, {
          size: 19,
          color: cell.daubed ? '#0b0e15' : live ? '#ffffff' : '#8b93a7',
        });
        // A ring around anything called but not yet daubed — the thing to hunt.
        if (live) {
          ctx.save();
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 180) * 0.25;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cxp + CELL / 2, cyp + CELL / 2, CELL * 0.36, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* --- strike through completed lines --- */
    for (const line of this.#lineDefinitions()) {
      if (!card.lines.has(line.key)) continue;
      const first = line.cells[0];
      const last = line.cells[line.cells.length - 1];
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + first[0] * CELL + CELL / 2, y + 34 + first[1] * CELL + CELL / 2);
      ctx.lineTo(x + last[0] * CELL + CELL / 2, y + 34 + last[1] * CELL + CELL / 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
