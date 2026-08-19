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

/** How long a fresh daub takes to squash into place. */
const DAUB_POP = 0.22;

/** How long a completed line's strike takes to sweep across. */
const LINE_SWEEP = 0.4;

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
    this.time = 0;
    // Card chrome and daub stamps are baked into layers, not painted per frame.
    this.cardLayers = [null, null];
    this.stamps = null;
    this.#startRound();
    this.banner('Eyes down');
    this.play('ready');
  }

  resize() {
    this.cardLayers = [null, null];
    this.stamps = null;
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
    this.cardLayers = [null, null];
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
        cells.push({ col, row, value: free ? 0 : pool[row], daubed: free, free, pop: 0 });
      }
    }
    // key -> strike sweep progress, so a fresh line animates in.
    return { cells, lines: new Map() };
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
    // Tapping a mark you already made is a slip, not a foul.
    if (cell.daubed) return;
    if (!this.called.has(cell.value)) {
      // Daubing a number that has not been called is a penalty.
      this.addScore(-Math.min(25, this.score));
      this.play('hit');
      this.shake.add(4);
      return;
    }

    cell.daubed = true;
    cell.pop = 1;
    const px = this.#cellX(card, cell) + CELL / 2;
    const py = this.#cellY(card, cell) + CELL / 2;
    // Fresh calls are worth much more than ones you nearly let slip.
    const freshness = this.recent.indexOf(cell.value);
    const points = freshness === 0 ? 100 : freshness > 0 ? Math.max(30, 90 - freshness * 12) : 20;
    this.addScore(points, { x: px, y: py, color: COL_COLORS[cell.col], label: `+${points}` });
    this.particles.emit(px, py, {
      count: 8, speed: 90, color: COL_COLORS[cell.col], life: 0.4, size: 2.2,
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

      card.lines.set(line.key, 0);
      this.roundLines++;
      this.totalLines++;
      this.host.setSecondary(this.totalLines);
      this.addScore(500);
      const mid = line.cells[2];
      this.particles.emit(
        this.#cellX(card, { col: mid[0] }) + CELL / 2,
        this.#cellY(card, { row: mid[1] }) + CELL / 2,
        { count: 26, speed: 190, color: '#ffffff', life: 0.6, size: 2.6 },
      );
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
    this.time += dt;
    if (this.over) return;

    for (const card of this.cards) {
      for (const cell of card.cells) {
        if (cell.pop > 0) cell.pop = Math.max(0, cell.pop - dt / DAUB_POP);
      }
      for (const [key, t] of card.lines) {
        if (t < 1) card.lines.set(key, Math.min(1, t + dt / LINE_SWEEP));
      }
    }

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

  /**
   * All the card chrome — well, rim, header, cell keycaps and the resting
   * grey numbers — baked once per round. What draw() paints on top is only
   * state: live rings, daub stamps and strikes.
   */
  #cardLayer(index) {
    if (this.cardLayers[index]) return this.cardLayers[index];
    const card = this.cards[index];
    const dpr = Math.min(2, this.host.dpr || 1);
    const pad = 16;
    const w = CARD_W + pad * 2;
    const h = CARD_H + pad * 2;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(pad, pad);

    // The well the card sits in.
    const wellGrad = g.createLinearGradient(0, -8, 0, CARD_H + 8);
    wellGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
    wellGrad.addColorStop(1, 'rgba(255,255,255,0.015)');
    g.fillStyle = wellGrad;
    this.roundRect(g, -8, -8, CARD_W + 16, CARD_H + 16, 12).fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    this.roundRect(g, -7.5, -7.5, CARD_W + 15, CARD_H + 15, 12).stroke();

    // B I N G O header, one glow pass each.
    LETTERS.forEach((letter, i) => {
      g.save();
      g.font = '700 22px ui-monospace, "SF Mono", Menlo, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = COL_COLORS[i];
      g.shadowBlur = 10;
      g.fillStyle = COL_COLORS[i];
      g.fillText(letter, i * CELL + CELL / 2, 16);
      g.restore();
    });

    // Cell keycaps: a soft top-light face inside each square.
    g.font = '700 19px ui-monospace, "SF Mono", Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const cell of card.cells) {
      const x = cell.col * CELL;
      const y = 34 + cell.row * CELL;
      const face = g.createLinearGradient(0, y + 3, 0, y + CELL - 3);
      face.addColorStop(0, 'rgba(255,255,255,0.055)');
      face.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      face.addColorStop(1, 'rgba(255,255,255,0.008)');
      g.fillStyle = face;
      this.roundRect(g, x + 3, y + 3, CELL - 6, CELL - 6, 8).fill();
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      this.roundRect(g, x + 3.5, y + 3.5, CELL - 7, CELL - 7, 8).stroke();

      if (cell.free) {
        g.save();
        g.font = '700 12px ui-monospace, "SF Mono", Menlo, monospace';
        g.fillStyle = '#4ade80';
        g.shadowColor = '#4ade80';
        g.shadowBlur = 8;
        g.fillText('FREE', x + CELL / 2, y + CELL / 2);
        g.restore();
      } else {
        g.fillStyle = '#8b93a7';
        g.fillText(String(cell.value), x + CELL / 2, y + CELL / 2);
      }
    }

    this.cardLayers[index] = { canvas: c, pad };
    return this.cardLayers[index];
  }

  /** One daub stamp per column colour, glow baked in. */
  #daubSprites() {
    if (this.stamps) return this.stamps;
    const dpr = Math.min(2, this.host.dpr || 1);
    const pad = 16;
    const size = CELL + pad * 2;
    this.stamps = COL_COLORS.map((color) => {
      const c = document.createElement('canvas');
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const mid = size / 2;
      const r = CELL * 0.36;
      g.shadowColor = color;
      g.shadowBlur = 14;
      const grad = g.createRadialGradient(mid, mid - r * 0.35, r * 0.15, mid, mid, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, color);
      grad.addColorStop(1, color);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(mid, mid, r, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(mid, mid, r - 1, -Math.PI * 0.8, -Math.PI * 0.2);
      g.stroke();
      return { canvas: c, size, pad };
    });
    return this.stamps;
  }

  draw(ctx) {
    this.clear(ctx, '#0a0710');
    ctx.save();
    this.shake.apply(ctx);

    // A faint violet pool behind the table.
    const bg = ctx.createRadialGradient(W / 2, H * 0.55, 120, W / 2, H * 0.55, W * 0.6);
    bg.addColorStop(0, 'rgba(192,132,252,0.05)');
    bg.addColorStop(1, 'rgba(192,132,252,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

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
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 4, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
      ctx.restore();
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

    const layer = this.#cardLayer(index);
    ctx.drawImage(layer.canvas, x - layer.pad, y - layer.pad,
      CARD_W + layer.pad * 2, CARD_H + layer.pad * 2);

    const stamps = this.#daubSprites();
    const pulse = 0.35 + Math.sin(this.time * 5.5) * 0.22;

    for (const cell of card.cells) {
      if (cell.free) continue;
      const cxp = this.#cellX(card, cell);
      const cyp = this.#cellY(card, cell);

      if (cell.daubed) {
        const stamp = stamps[cell.col];
        // Ease out of the initial squash: big, then settled.
        const t = cell.pop;
        const scale = 1 + t * t * 0.5;
        const size = (CELL + stamp.pad * 2) * scale;
        const off = (size - CELL) / 2;
        ctx.drawImage(stamp.canvas, cxp - off, cyp - off, size, size);
        this.text(ctx, String(cell.value), cxp + CELL / 2, cyp + CELL / 2, {
          size: 19, color: '#0b0e15',
        });
        continue;
      }

      const live = this.called.has(cell.value);
      if (live) {
        this.text(ctx, String(cell.value), cxp + CELL / 2, cyp + CELL / 2, {
          size: 19, color: '#ffffff',
        });
        // A ring around anything called but not yet daubed — the thing to hunt.
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cxp + CELL / 2, cyp + CELL / 2, CELL * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* --- strike through completed lines, swept in --- */
    for (const line of this.#lineDefinitions()) {
      const t = card.lines.get(line.key);
      if (t == null) continue;
      const ease = 1 - (1 - t) * (1 - t);
      const first = line.cells[0];
      const last = line.cells[line.cells.length - 1];
      const x1 = x + first[0] * CELL + CELL / 2;
      const y1 = y + 34 + first[1] * CELL + CELL / 2;
      const x2 = x1 + (x + last[0] * CELL + CELL / 2 - x1) * ease;
      const y2 = y1 + (y + 34 + last[1] * CELL + CELL / 2 - y1) * ease;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.4 + 0.3 * (1 - ease) + 0.15;
      ctx.lineWidth = 3 + (1 - ease) * 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
