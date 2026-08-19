import { BaseGame } from '../core/game.js';
import { THEMES } from './words.js';

/**
 * WORD SEARCH
 *
 * Words are placed in all eight directions, and crucially they are allowed to
 * cross where their letters agree — a grid where nothing overlaps looks sparse
 * and reads as easy. Placement is try-and-retry against a compatibility check
 * rather than anything clever; with a 12x12 grid and ten words it settles in
 * a handful of attempts.
 *
 * Drag across a run of letters to claim it. The selection snaps to the nearest
 * of the eight lines, so a sloppy diagonal still counts.
 */

const SIZE = 12;
const CELL = 38;
const GRID_W = SIZE * CELL;

const W = 740;
const H = 520;
const GRID_X = 22;
const GRID_Y = 22;
const LIST_X = GRID_X + GRID_W + 26;

const ROUND_TIME = 150;

const DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, -1], [1, -1], [-1, 1],
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FOUND_COLORS = ['#c084fc', '#22d3ee', '#4ade80', '#facc15', '#fb7185', '#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#2dd4bf'];

/** How long a freshly found band takes to swell to full width. */
const BAND_POP = 0.35;

export default class WordSearch extends BaseGame {
  static id = 'wordsearch';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Found' };

  setup() {
    this.host.setSecondaryLabel('Found');
    this.host.setHint('Drag across the letters to claim a word');
    this.setLives(1);

    this.round = 0;
    this.roundBreak = 0;
    this.time = 0;
    // Gradients and the letter grid are baked into layers, not painted per frame.
    this.layers = new Map();
    this.letterLayer = null;
    this.themeOrder = THEMES.map((_, i) => i);
    for (let i = this.themeOrder.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.themeOrder[i], this.themeOrder[j]] = [this.themeOrder[j], this.themeOrder[i]];
    }

    this.#buildGrid();
    this.banner(this.theme.name);
    this.play('ready');
  }

  resize() {
    this.layers?.clear();
    this.letterLayer = null;
  }

  /* ============================================================ the grid */

  #buildGrid() {
    this.theme = THEMES[this.themeOrder[this.round % this.themeOrder.length]];
    this.grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
    this.placed = [];

    for (const word of this.theme.words) {
      const spot = this.#findSpot(word);
      if (!spot) continue; // a word that will not fit is simply left out
      const { row, col, dir } = spot;
      const cells = [];
      for (let i = 0; i < word.length; i++) {
        const r = row + dir[1] * i;
        const c = col + dir[0] * i;
        this.grid[r][c] = word[i];
        cells.push([r, c]);
      }
      this.placed.push({ word, cells, found: false, pop: 0, color: FOUND_COLORS[this.placed.length % FOUND_COLORS.length] });
    }

    // Fill the gaps. Drawing from the theme's own letters makes the noise
    // blend with the answers instead of standing out as filler.
    const pool = this.theme.words.join('') + LETTERS;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this.grid[r][c]) this.grid[r][c] = pool[Math.floor(this.random() * pool.length)];
      }
    }

    this.selection = null;
    this.foundCount = 0;
    this.letterLayer = null;
    this.timeLeft = ROUND_TIME;
    this.host.setSecondary(`0/${this.placed.length}`);
    this.meta = { round: this.round + 1, theme: this.theme.name };
  }

  #findSpot(word) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const dir = DIRECTIONS[Math.floor(this.random() * DIRECTIONS.length)];
      const row = Math.floor(this.random() * SIZE);
      const col = Math.floor(this.random() * SIZE);

      const endR = row + dir[1] * (word.length - 1);
      const endC = col + dir[0] * (word.length - 1);
      if (endR < 0 || endR >= SIZE || endC < 0 || endC >= SIZE) continue;

      let ok = true;
      for (let i = 0; i < word.length; i++) {
        const cell = this.grid[row + dir[1] * i][col + dir[0] * i];
        // Empty, or already holding the same letter — crossings are welcome.
        if (cell && cell !== word[i]) { ok = false; break; }
      }
      if (ok) return { row, col, dir };
    }
    return null;
  }

  /* =============================================================== input */

  #cellAt(px, py) {
    if (px < GRID_X || px >= GRID_X + GRID_W || py < GRID_Y || py >= GRID_Y + GRID_W) return null;
    return {
      col: Math.floor((px - GRID_X) / CELL),
      row: Math.floor((py - GRID_Y) / CELL),
    };
  }

  /**
   * Snap an arbitrary drag to the nearest of the eight lines, so the player
   * does not have to trace a diagonal precisely.
   */
  #lineBetween(start, end) {
    const dr = end.row - start.row;
    const dc = end.col - start.col;
    if (dr === 0 && dc === 0) return [[start.row, start.col]];

    // Whichever of the eight unit directions best matches the drag.
    const len = Math.hypot(dr, dc);
    let best = DIRECTIONS[0];
    let bestDot = -Infinity;
    for (const d of DIRECTIONS) {
      const dl = Math.hypot(d[0], d[1]);
      const dot = (dc * d[0] + dr * d[1]) / (len * dl);
      if (dot > bestDot) { bestDot = dot; best = d; }
    }

    // How far along that direction the drag reached, in whole cells.
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    const cells = [];
    for (let i = 0; i <= steps; i++) {
      const r = start.row + best[1] * i;
      const c = start.col + best[0] * i;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) break;
      cells.push([r, c]);
    }
    return cells;
  }

  #evaluate(cells) {
    if (cells.length < 2) return;
    const forward = cells.map(([r, c]) => this.grid[r][c]).join('');
    const backward = [...forward].reverse().join('');

    for (const entry of this.placed) {
      if (entry.found) continue;
      if (entry.word !== forward && entry.word !== backward) continue;
      // The letters must be the actual placement, not a coincidental match.
      const key = entry.cells.map((c) => c.join(',')).sort().join('|');
      const drawn = cells.map((c) => c.join(',')).sort().join('|');
      if (key !== drawn) continue;

      entry.found = true;
      entry.pop = 1;
      this.letterLayer = null;
      this.foundCount++;
      this.host.setSecondary(`${this.foundCount}/${this.placed.length}`);
      const [mr, mc] = entry.cells[Math.floor(entry.cells.length / 2)];
      const [mx, my] = this.#cellCentre(mr, mc);
      this.addScore(120 + entry.word.length * 20, { x: mx, y: my - 18, color: entry.color });
      this.play('powerup');
      this.shake.add(3);

      // A trail of sparks along the whole word, not just its middle.
      for (const [r, c] of entry.cells) {
        const [x, y] = this.#cellCentre(r, c);
        this.particles.emit(x, y, {
          count: 4, speed: 90, color: entry.color, life: 0.55, size: 2.6, shape: 'circle',
        });
      }

      if (this.foundCount >= this.placed.length) this.#finishRound();
      return;
    }
    this.play('hit');
  }

  #finishRound() {
    const bonus = 400 + Math.round(this.timeLeft) * 8;
    this.addScore(bonus, {
      x: GRID_X + GRID_W / 2, y: GRID_Y + GRID_W / 2, color: '#4ade80', label: `Bonus +${bonus}`,
    });
    this.banner('Grid clear');
    this.play('levelup');
    for (let i = 0; i < 10; i++) {
      this.particles.emit(
        GRID_X + this.random() * GRID_W, GRID_Y + this.random() * GRID_W, {
          count: 5, speed: 130, color: FOUND_COLORS[i % FOUND_COLORS.length], life: 0.8, size: 2.8, shape: 'circle',
        });
    }
    this.round++;
    this.roundBreak = 1.6;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    this.time += dt;
    for (const entry of this.placed) {
      if (entry.pop > 0) entry.pop = Math.max(0, entry.pop - dt / BAND_POP);
    }

    if (this.roundBreak > 0) {
      this.roundBreak -= dt;
      if (this.roundBreak <= 0) {
        this.#buildGrid();
        this.banner(this.theme.name);
      }
      return;
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.meta = { round: this.round + 1, found: this.foundCount };
      this.play('gameover');
      this.end();
      return;
    }

    const m = this.mouse;
    const cell = this.#cellAt(m.x, m.y);

    if (m.pressed && cell) {
      this.selection = { start: cell, cells: [[cell.row, cell.col]] };
      this.play('hover');
    } else if (m.down && this.selection && cell) {
      this.selection.cells = this.#lineBetween(this.selection.start, cell);
    }
    // Not an else: a tap fast enough to press and release in one step must
    // still resolve, or the selection lingers as a ghost.
    if (m.released && this.selection) {
      this.#evaluate(this.selection.cells);
      this.selection = null;
    }
  }

  /* ================================================================ draw */

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

  /** The static wells behind the grid and the word list. */
  #backdrop() {
    return this.#layer('backdrop', W, H, (g) => {
      const well = (x, y, w, h) => {
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, 'rgba(255,255,255,0.030)');
        grad.addColorStop(1, 'rgba(255,255,255,0.008)');
        g.fillStyle = grad;
        this.roundRect(g, x, y, w, h, 12).fill();
        g.strokeStyle = 'rgba(255,255,255,0.07)';
        g.lineWidth = 1;
        this.roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 12).stroke();
      };
      well(GRID_X - 12, GRID_Y - 12, GRID_W + 24, GRID_W + 24);
      well(LIST_X - 14, GRID_Y - 12, W - LIST_X + 6, GRID_W + 24);

      // A faint lattice so the letters read as cells rather than a wall.
      g.strokeStyle = 'rgba(255,255,255,0.04)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < SIZE; i++) {
        g.moveTo(GRID_X + i * CELL + 0.5, GRID_Y + 3);
        g.lineTo(GRID_X + i * CELL + 0.5, GRID_Y + GRID_W - 3);
        g.moveTo(GRID_X + 3, GRID_Y + i * CELL + 0.5);
        g.lineTo(GRID_X + GRID_W - 3, GRID_Y + i * CELL + 0.5);
      }
      g.stroke();
    });
  }

  /**
   * The letters, baked to a layer and repainted only when a word is found —
   * 144 text calls per event instead of per frame.
   */
  #letters() {
    if (this.letterLayer) return this.letterLayer;
    const dpr = Math.min(2, this.host.dpr || 1);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(GRID_W * dpr));
    c.height = Math.max(1, Math.round(GRID_W * dpr));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);

    const claimed = new Set();
    for (const entry of this.placed) {
      if (!entry.found) continue;
      for (const [r, cc] of entry.cells) claimed.add(r * SIZE + cc);
    }
    for (let r = 0; r < SIZE; r++) {
      for (let cc = 0; cc < SIZE; cc++) {
        const lit = claimed.has(r * SIZE + cc);
        this.text(g, this.grid[r][cc], cc * CELL + CELL / 2, r * CELL + CELL / 2, {
          size: 19,
          color: lit ? '#f4f7ff' : '#cbd5e6',
          weight: lit ? 700 : 600,
        });
      }
    }
    this.letterLayer = c;
    return c;
  }

  draw(ctx) {
    this.clear(ctx, '#06070d');
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.#backdrop(), 0, 0, W, H);
    this.#drawFoundBands(ctx);
    this.#drawSelection(ctx);
    ctx.drawImage(this.#letters(), GRID_X, GRID_Y, GRID_W, GRID_W);
    this.#drawList(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #cellCentre(r, c) {
    return [GRID_X + c * CELL + CELL / 2, GRID_Y + r * CELL + CELL / 2];
  }

  /** A found word is a thick translucent capsule laid under the letters. */
  #drawFoundBands(ctx) {
    for (const entry of this.placed) {
      if (!entry.found) continue;
      const [x1, y1] = this.#cellCentre(...entry.cells[0]);
      const [x2, y2] = this.#cellCentre(...entry.cells[entry.cells.length - 1]);
      // A fresh band swells out from a thin line, easing to rest.
      const t = 1 - entry.pop;
      const ease = 1 - (1 - t) * (1 - t) * (1 - t);
      ctx.save();
      ctx.strokeStyle = entry.color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = CELL * 0.78 * (0.3 + 0.7 * ease);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #drawSelection(ctx) {
    if (!this.selection?.cells.length) return;
    const cells = this.selection.cells;
    const [x1, y1] = this.#cellCentre(...cells[0]);
    const [x2, y2] = this.#cellCentre(...cells[cells.length - 1]);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#22d3ee';
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = CELL * 0.78;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // A bright spine so the snapped line is unmistakable mid-drag.
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
    this.glowCircle(ctx, x2, y2, 4, '#22d3ee', 10);
  }

  #drawList(ctx) {
    this.text(ctx, this.theme.name.toUpperCase(), LIST_X, GRID_Y + 6, {
      size: 13, color: '#c084fc', align: 'left', glow: 10,
    });

    // Timer bar — the only pressure in the game.
    const barW = W - LIST_X - 22;
    const pct = Math.max(0, this.timeLeft / ROUND_TIME);
    const low = pct < 0.2;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.roundRect(ctx, LIST_X, GRID_Y + 22, barW, 6, 3).fill();
    if (low) {
      // A slow breathing glow — urgency without a strobe.
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.time * 3);
      ctx.shadowColor = '#fb7185';
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = low ? '#fb7185' : '#22d3ee';
    this.roundRect(ctx, LIST_X, GRID_Y + 22, Math.max(2, barW * pct), 6, 3).fill();
    ctx.restore();
    this.text(ctx, `${Math.ceil(this.timeLeft)}s`, LIST_X + barW, GRID_Y + 40, {
      size: 11, color: low ? '#fb7185' : '#8b93a7', align: 'right',
    });

    this.placed.forEach((entry, i) => {
      const y = GRID_Y + 66 + i * 27;
      ctx.save();
      ctx.fillStyle = entry.found ? entry.color : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(LIST_X + 4, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.text(ctx, entry.word, LIST_X + 15, y, {
        size: 14,
        color: entry.found ? entry.color : '#8b93a7',
        align: 'left',
        weight: entry.found ? 700 : 500,
      });
      if (entry.found) {
        ctx.save();
        ctx.strokeStyle = entry.color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(LIST_X + 13, y);
        ctx.lineTo(LIST_X + 15 + entry.word.length * 8.5, y);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
}
