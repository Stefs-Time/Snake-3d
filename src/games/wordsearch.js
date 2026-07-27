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
    this.themeOrder = THEMES.map((_, i) => i);
    for (let i = this.themeOrder.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.themeOrder[i], this.themeOrder[j]] = [this.themeOrder[j], this.themeOrder[i]];
    }

    this.#buildGrid();
    this.banner(this.theme.name);
    this.play('ready');
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
      this.placed.push({ word, cells, found: false, color: FOUND_COLORS[this.placed.length % FOUND_COLORS.length] });
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
      this.foundCount++;
      this.host.setSecondary(`${this.foundCount}/${this.placed.length}`);
      this.addScore(120 + entry.word.length * 20);
      this.play('powerup');
      this.shake.add(3);

      const [mr, mc] = entry.cells[Math.floor(entry.cells.length / 2)];
      this.particles.emit(GRID_X + mc * CELL + CELL / 2, GRID_Y + mr * CELL + CELL / 2, {
        count: 16, speed: 120, color: entry.color, life: 0.6, size: 3,
      });

      if (this.foundCount >= this.placed.length) this.#finishRound();
      return;
    }
    this.play('hit');
  }

  #finishRound() {
    const bonus = 400 + Math.round(this.timeLeft) * 8;
    this.addScore(bonus);
    this.banner('Grid clear');
    this.play('levelup');
    this.round++;
    this.roundBreak = 1.6;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

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
    } else if (m.released && this.selection) {
      this.#evaluate(this.selection.cells);
      this.selection = null;
    }
  }

  /* ================================================================ draw */

  draw(ctx) {
    this.clear(ctx, '#06070d');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawFoundBands(ctx);
    this.#drawSelection(ctx);
    this.#drawLetters(ctx);
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
      ctx.save();
      ctx.strokeStyle = entry.color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = CELL * 0.78;
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
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = CELL * 0.78;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  #drawLetters(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, GRID_X - 6, GRID_Y - 6, GRID_W + 12, GRID_W + 12, 10).stroke();
    ctx.restore();

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const [x, y] = this.#cellCentre(r, c);
        this.text(ctx, this.grid[r][c], x, y, {
          size: 19,
          color: '#cbd5e6',
          weight: 600,
        });
      }
    }
  }

  #drawList(ctx) {
    this.text(ctx, this.theme.name.toUpperCase(), LIST_X, GRID_Y + 6, {
      size: 13, color: '#c084fc', align: 'left', glow: 10,
    });

    // Timer bar — the only pressure in the game.
    const barW = W - LIST_X - 22;
    const pct = this.timeLeft / ROUND_TIME;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.roundRect(ctx, LIST_X, GRID_Y + 22, barW, 6, 3).fill();
    ctx.fillStyle = pct < 0.2 ? '#fb7185' : '#22d3ee';
    this.roundRect(ctx, LIST_X, GRID_Y + 22, Math.max(2, barW * pct), 6, 3).fill();
    ctx.restore();
    this.text(ctx, `${Math.ceil(this.timeLeft)}s`, LIST_X + barW, GRID_Y + 40, {
      size: 11, color: '#8b93a7', align: 'right',
    });

    this.placed.forEach((entry, i) => {
      const y = GRID_Y + 66 + i * 27;
      this.text(ctx, entry.word, LIST_X, y, {
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
        ctx.moveTo(LIST_X - 2, y);
        ctx.lineTo(LIST_X + entry.word.length * 9.4, y);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
}
