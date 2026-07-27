import { BaseGame } from '../core/game.js';

/**
 * MINEFIELD
 *
 * Two details separate a good implementation from a frustrating one. The first
 * click is always safe — mines are laid *after* it, avoiding the opening tile
 * and its neighbours, so no run ends on move one. And revealing a zero flood
 * fills outward, because clicking empty squares one at a time is not a game.
 *
 * Flagging works three ways so it is comfortable everywhere: right-click,
 * shift-click, or a flag mode you can toggle with F for touchscreens.
 */

const COLS = 16;
const ROWS = 16;
const CELL = 30;

const W = COLS * CELL + 40;
const H = ROWS * CELL + 78;
const GRID_X = 20;
const GRID_Y = 56;

const NUMBER_COLORS = [
  '', '#38bdf8', '#4ade80', '#fb7185', '#c084fc',
  '#fbbf24', '#22d3ee', '#e9edf6', '#94a3b8',
];

export default class Minefield extends BaseGame {
  static id = 'minefield';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Board' };

  setup() {
    this.host.setSecondaryLabel('Board');
    this.host.setHint('Click to clear · F or right-click to flag');
    this.setLives(3);

    this.board = 1;
    this.flagMode = false;
    this.breakTimer = 0;
    this.#newBoard();

    this.banner('Mind your step');
    this.play('ready');
  }

  #newBoard() {
    this.mineCount = Math.min(70, 34 + (this.board - 1) * 6);
    this.cells = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => ({
        r, c, mine: false, revealed: false, flagged: false, near: 0, boom: false,
      })),
    );
    this.laid = false;
    this.cleared = 0;
    this.elapsed = 0;
    this.exploded = false;
    this.host.setSecondary(this.board);
    this.meta = { board: this.board };
  }

  /** Mines are laid after the first click so it can never be fatal. */
  #layMines(safeR, safeC) {
    const spots = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
        spots.push([r, c]);
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    for (let i = 0; i < Math.min(this.mineCount, spots.length); i++) {
      const [r, c] = spots[i];
      this.cells[r][c].mine = true;
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.cells[r][c].near = this.#neighbours(r, c).filter((n) => n.mine).length;
      }
    }
    this.laid = true;
  }

  #neighbours(r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        out.push(this.cells[rr][cc]);
      }
    }
    return out;
  }

  /* ============================================================== actions */

  #reveal(cell) {
    if (cell.revealed || cell.flagged) return;
    if (!this.laid) this.#layMines(cell.r, cell.c);

    if (cell.mine) {
      cell.boom = true;
      this.#explode();
      return;
    }

    // Iterative flood fill — a recursive one blows the stack on a big board.
    const stack = [cell];
    let opened = 0;
    while (stack.length) {
      const current = stack.pop();
      if (current.revealed || current.flagged) continue;
      current.revealed = true;
      opened++;
      this.cleared++;
      if (current.near === 0) {
        for (const n of this.#neighbours(current.r, current.c)) {
          if (!n.revealed && !n.mine) stack.push(n);
        }
      }
    }

    this.addScore(opened * 5);
    this.play(opened > 4 ? 'clear' : 'blip');
    this.#checkWin();
  }

  /** Clicking a satisfied number opens its remaining neighbours. */
  #chord(cell) {
    if (!cell.revealed || cell.near === 0) return;
    const around = this.#neighbours(cell.r, cell.c);
    const flags = around.filter((n) => n.flagged).length;
    if (flags !== cell.near) return;
    for (const n of around) if (!n.flagged && !n.revealed) this.#reveal(n);
  }

  #toggleFlag(cell) {
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    this.play('toggle');
  }

  #flagsUsed() {
    let n = 0;
    for (const row of this.cells) for (const cell of row) if (cell.flagged) n++;
    return n;
  }

  #explode() {
    this.exploded = true;
    for (const row of this.cells) {
      for (const cell of row) if (cell.mine) cell.revealed = true;
    }
    this.play('explode');
    this.shake.add(14);
    const boom = this.cells.flat().find((c) => c.boom);
    if (boom) {
      this.particles.emit(
        GRID_X + boom.c * CELL + CELL / 2,
        GRID_Y + boom.r * CELL + CELL / 2,
        { count: 30, speed: 190, color: '#fb7185', life: 0.8, size: 3 },
      );
    }

    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    if (lives <= 0) {
      this.meta = { board: this.board };
      this.breakTimer = 1.6;
      this.finished = true;
    } else {
      this.banner('Boom');
      this.breakTimer = 1.8;
    }
  }

  #checkWin() {
    const safe = ROWS * COLS - this.mineCount;
    if (this.cleared < safe) return;
    const bonus = 800 + Math.max(0, Math.round(240 - this.elapsed) * 6);
    this.addScore(bonus);
    this.banner('Swept');
    this.play('highscore');
    this.board++;
    this.breakTimer = 1.8;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) {
        if (this.finished) this.end();
        else this.#newBoard();
      }
      return;
    }

    this.elapsed += dt;

    if (this.input.keyPressed('KeyF')) {
      this.flagMode = !this.flagMode;
      this.play('toggle');
    }

    const m = this.mouse;
    if (!m.pressed) return;

    // The flag toggle chip, for anyone without a keyboard.
    if (this.hits(m.x, m.y, W - 118, 18, 100, 26)) {
      this.flagMode = !this.flagMode;
      this.play('toggle');
      return;
    }

    const c = Math.floor((m.x - GRID_X) / CELL);
    const r = Math.floor((m.y - GRID_Y) / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;

    const cell = this.cells[r][c];
    const flagging = this.flagMode || this.input.held('secondary');

    if (flagging) this.#toggleFlag(cell);
    else if (cell.revealed) this.#chord(cell);
    else this.#reveal(cell);
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#080a10');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawHeader(ctx);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) this.#drawCell(ctx, this.cells[r][c]);
    }

    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawHeader(ctx) {
    const remaining = this.mineCount - this.#flagsUsed();
    this.text(ctx, `⚑ ${remaining}`, GRID_X, 30, { size: 16, color: '#fb7185', align: 'left' });
    this.text(ctx, `${Math.floor(this.elapsed)}s`, W / 2, 30, { size: 14, color: '#8b93a7' });

    // Flag-mode chip.
    const x = W - 118;
    ctx.save();
    ctx.fillStyle = this.flagMode ? 'rgba(251,113,133,0.22)' : 'rgba(255,255,255,0.05)';
    this.roundRect(ctx, x, 18, 100, 26, 13).fill();
    ctx.strokeStyle = this.flagMode ? '#fb7185' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x, 18, 100, 26, 13).stroke();
    ctx.restore();
    this.text(ctx, this.flagMode ? 'FLAG ON' : 'FLAG OFF', x + 50, 31, {
      size: 10, color: this.flagMode ? '#fb7185' : '#8b93a7',
    });
  }

  #drawCell(ctx, cell) {
    const x = GRID_X + cell.c * CELL;
    const y = GRID_Y + cell.r * CELL;
    const inset = 1;

    if (!cell.revealed) {
      ctx.save();
      ctx.fillStyle = '#1b2230';
      this.roundRect(ctx, x + inset, y + inset, CELL - inset * 2, CELL - inset * 2, 4).fill();
      // A top highlight so unopened cells read as raised.
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 3, y + 3, CELL - 6, 2);
      ctx.restore();

      if (cell.flagged) {
        ctx.save();
        ctx.shadowColor = '#fb7185';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x + CELL * 0.38, y + CELL * 0.22);
        ctx.lineTo(x + CELL * 0.38, y + CELL * 0.78);
        ctx.stroke();
        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.moveTo(x + CELL * 0.38, y + CELL * 0.22);
        ctx.lineTo(x + CELL * 0.72, y + CELL * 0.36);
        ctx.lineTo(x + CELL * 0.38, y + CELL * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      return;
    }

    ctx.save();
    ctx.fillStyle = cell.boom ? 'rgba(251,113,133,0.35)' : 'rgba(255,255,255,0.035)';
    this.roundRect(ctx, x + inset, y + inset, CELL - inset * 2, CELL - inset * 2, 4).fill();
    ctx.restore();

    if (cell.mine) {
      this.glowCircle(ctx, x + CELL / 2, y + CELL / 2, CELL * 0.22, cell.boom ? '#ffffff' : '#fb7185', 10);
      return;
    }

    if (cell.near > 0) {
      this.text(ctx, String(cell.near), x + CELL / 2, y + CELL / 2, {
        size: 16, color: NUMBER_COLORS[cell.near],
      });
    }
  }
}
