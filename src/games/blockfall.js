import { BaseGame } from '../core/game.js';

/**
 * BLOCKFALL — a stacker with modern rules
 *
 * Specifically: a seven-bag randomiser (you get all seven pieces before any
 * repeats, so the I-piece drought that ruined the 1989 version cannot happen),
 * SRS rotation with the full wall-kick tables (which is what lets you spin a
 * piece into an overhang), a hold slot, a ghost preview, and lock delay with a
 * move-reset cap so you can slide a piece into place but not stall forever.
 */

const COLS = 10;
const ROWS = 20;
const CELL = 24;
const HIDDEN = 2; // spawn rows above the visible field

const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const PANEL = 88;

/** Spawn shapes. Coordinates are [x, y] inside the piece's rotation box. */
const PIECES = {
  I: { box: 4, color: '#00e5ff', cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { box: 4, color: '#ffd23f', cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  T: { box: 3, color: '#b47bff', cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { box: 3, color: '#39ff88', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { box: 3, color: '#ff2e88', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { box: 3, color: '#2b6cff', cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { box: 3, color: '#ff9f43', cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

const TYPES = Object.keys(PIECES);

/**
 * SRS wall kicks, keyed "from>to". The published tables use y-up; these are
 * negated so they match a y-down grid.
 */
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};

const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const LINE_SCORES = [0, 100, 300, 500, 800];
const LINE_NAMES = ['', 'Single', 'Double', 'Triple', 'BLOCKFALL!'];

export default class Blockfall extends BaseGame {
  static id = 'blockfall';
  static width = BOARD_W + PANEL * 2 + 24;
  static height = BOARD_H + 40;
  static renderer = '2d';
  static touch = 'dpad';
  static touchButtons = { action: 'DROP', secondary: 'HOLD' };
  static smooth = true;
  static hudPad = { top: 34, bottom: 26 };
  static hudLabels = { score: 'Score', secondary: 'Lines' };

  setup() {
    this.host.setSecondaryLabel('Lines');
    this.host.setHint('↑ rotate · Space hard drop · C hold', 'Pad up rotates · DROP · HOLD');
    this.setLives(1);

    this.boardX = PANEL + 16;
    this.boardY = 20;

    // The grid stores colours; null is empty. Two hidden rows sit on top.
    this.grid = Array.from({ length: ROWS + HIDDEN }, () => Array(COLS).fill(null));

    this.bag = [];
    this.queue = [this.#nextType(), this.#nextType(), this.#nextType()];
    this.hold = null;
    this.holdUsed = false;

    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.backToBack = false;

    this.dropTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.clearing = null;

    this.dasTimer = 0;
    this.dasDirection = 0;
    this.repeatTimer = 0;

    this.#spawn();
    this.banner('Ready');
    this.play('ready');
  }

  /* =========================================================== the bag == */

  #nextType() {
    if (!this.bag.length) {
      this.bag = [...TYPES];
      // Fisher-Yates on a copy of all seven — the whole point of the seven-bag.
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  #spawn(type = null) {
    const kind = type ?? this.queue.shift();
    if (!type) this.queue.push(this.#nextType());

    const def = PIECES[kind];
    this.piece = {
      type: kind,
      rotation: 0,
      x: Math.floor((COLS - def.box) / 2),
      // Spawn straddling the hidden rows so the bottom of the piece is already
      // visible on the top row of the well.
      y: 1,
      color: def.color,
    };
    this.dropTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;

    // Block out: the new piece has nowhere to go.
    if (this.#collides(this.piece, 0, 0, 0)) {
      this.meta = { lines: this.lines, level: this.level };
      this.play('die');
      this.shake.add(12);
      this.end();
    }
  }

  /* ========================================================== geometry == */

  /** Cells of a piece in board coordinates, for a given rotation and offset. */
  #cellsOf(piece, dx = 0, dy = 0, dr = 0) {
    const def = PIECES[piece.type];
    const rotation = (((piece.rotation + dr) % 4) + 4) % 4;
    const n = def.box;
    const out = [];

    for (const [cx, cy] of def.cells) {
      let x = cx;
      let y = cy;
      // Rotate clockwise `rotation` times inside the n x n box.
      for (let r = 0; r < rotation; r++) {
        const nx = n - 1 - y;
        const ny = x;
        x = nx;
        y = ny;
      }
      out.push([piece.x + x + dx, piece.y + y + dy]);
    }
    return out;
  }

  #collides(piece, dx, dy, dr) {
    for (const [x, y] of this.#cellsOf(piece, dx, dy, dr)) {
      if (x < 0 || x >= COLS) return true;
      if (y >= ROWS + HIDDEN) return true;
      if (y >= 0 && this.grid[y][x]) return true;
    }
    return false;
  }

  /* ============================================================ actions == */

  #move(dx) {
    if (this.#collides(this.piece, dx, 0, 0)) return false;
    this.piece.x += dx;
    this.#resetLock();
    return true;
  }

  #rotate(direction) {
    const from = this.piece.rotation;
    const to = (((from + direction) % 4) + 4) % 4;
    if (this.piece.type === 'O') return false; // O never needs a kick

    const table = this.piece.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}>${to}`] ?? [[0, 0]];

    for (const [kx, ky] of kicks) {
      if (!this.#collides(this.piece, kx, ky, direction)) {
        this.piece.x += kx;
        this.piece.y += ky;
        this.piece.rotation = to;
        this.#resetLock();
        this.play('rotate');
        return true;
      }
    }
    return false;
  }

  #resetLock() {
    // Sliding a piece along the floor buys you more time, but only 15 times.
    if (this.lockTimer > 0 && this.lockResets < 15) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  #holdPiece() {
    if (this.holdUsed) return;
    this.holdUsed = true;
    const current = this.piece.type;
    if (this.hold) {
      const swap = this.hold;
      this.hold = current;
      this.#spawn(swap);
    } else {
      this.hold = current;
      this.#spawn();
    }
    this.play('toggle');
  }

  #hardDrop() {
    let distance = 0;
    while (!this.#collides(this.piece, 0, distance + 1, 0)) distance++;
    this.piece.y += distance;
    this.addScore(distance * 2);
    this.shake.add(Math.min(6, 1 + distance * 0.25));
    this.play('drop');
    this.#lock();
  }

  #lock() {
    for (const [x, y] of this.#cellsOf(this.piece)) {
      if (y >= 0 && y < ROWS + HIDDEN) this.grid[y][x] = this.piece.color;
      this.particles.emit(
        this.boardX + x * CELL + CELL / 2,
        this.boardY + (y - HIDDEN) * CELL + CELL / 2,
        { count: 2, speed: 40, color: this.piece.color, life: 0.25, size: 2 },
      );
    }

    const full = [];
    for (let y = 0; y < ROWS + HIDDEN; y++) {
      if (this.grid[y].every(Boolean)) full.push(y);
    }

    if (full.length) {
      this.clearing = { rows: full, timer: 0.28 };
      this.#scoreLines(full.length);
    } else {
      this.combo = -1;
      this.holdUsed = false;
      this.#spawn();
    }
  }

  #scoreLines(count) {
    const isTetris = count === 4;
    let points = LINE_SCORES[count] * this.level;

    // Back-to-back tetrises are worth half again as much.
    if (isTetris && this.backToBack) points = Math.floor(points * 1.5);
    this.backToBack = isTetris;

    this.combo++;
    if (this.combo > 0) points += 50 * this.combo * this.level;

    this.addScore(points);
    this.lines += count;
    this.host.setSecondary(this.lines);
    this.meta = { lines: this.lines, level: this.level };

    const nextLevel = Math.floor(this.lines / 10) + 1;
    if (nextLevel !== this.level) {
      this.level = nextLevel;
      this.banner(`Level ${this.level}`);
      this.play('levelup');
    } else {
      this.banner(this.combo > 0 ? `${LINE_NAMES[count]} x${this.combo + 1}` : LINE_NAMES[count]);
      this.play(isTetris ? 'clear' : 'blip');
    }

    this.shake.add(count * 2.5);

    for (const row of this.clearing.rows) {
      for (let x = 0; x < COLS; x++) {
        this.particles.emit(
          this.boardX + x * CELL + CELL / 2,
          this.boardY + (row - HIDDEN) * CELL + CELL / 2,
          { count: 4, speed: 120, color: this.grid[row][x] ?? '#fff', life: 0.5, size: 3, gravity: 260 },
        );
      }
    }
  }

  #collapse() {
    for (const row of this.clearing.rows.sort((a, b) => a - b)) {
      this.grid.splice(row, 1);
      this.grid.unshift(Array(COLS).fill(null));
    }
    this.clearing = null;
    this.holdUsed = false;
    this.#spawn();
  }

  /* ============================================================= update == */

  /** Guideline gravity: seconds per cell, steepening fast after level 10. */
  #gravityInterval() {
    const l = this.level - 1;
    return Math.max(0.016, (0.8 - l * 0.007) ** l);
  }

  update(dt) {
    this.updateEffects(dt);

    if (this.clearing) {
      this.clearing.timer -= dt;
      if (this.clearing.timer <= 0) this.#collapse();
      return;
    }
    if (this.over) return;

    this.#handleInput(dt);

    // A hard drop during input handling may have locked the piece and started
    // a line clear — in which case there is nothing left to apply gravity to.
    if (this.clearing || this.over) return;

    // Gravity, with soft drop multiplying the fall rate.
    const soft = this.input.held('down');
    const interval = soft ? Math.min(this.#gravityInterval(), 0.03) : this.#gravityInterval();
    this.dropTimer += dt;

    while (this.dropTimer >= interval) {
      this.dropTimer -= interval;
      if (!this.#collides(this.piece, 0, 1, 0)) {
        this.piece.y++;
        if (soft) this.addScore(1);
        this.lockTimer = 0;
      } else {
        break;
      }
    }

    // Lock delay: only runs while the piece is actually resting on something.
    if (this.#collides(this.piece, 0, 1, 0)) {
      this.lockTimer += dt;
      if (this.lockTimer >= 0.5) this.#lock();
    } else {
      this.lockTimer = 0;
    }
  }

  #handleInput(dt) {
    const input = this.input;

    /* --- rotation --- */
    if (input.pressed('up') || input.keyPressed('KeyX')) this.#rotate(1);
    if (input.keyPressed('KeyZ') || input.keyPressed('ControlLeft')) this.#rotate(-1);

    /* --- hold --- */
    if (input.keyPressed('KeyC') || input.pressed('secondary')) this.#holdPiece();

    /* --- hard drop --- */
    if (input.pressed('action')) this.#hardDrop();

    /* --- horizontal movement with DAS --- */
    const direction = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);

    if (direction !== this.dasDirection) {
      this.dasDirection = direction;
      this.dasTimer = 0;
      this.repeatTimer = 0;
      if (direction !== 0) this.#move(direction);
      return;
    }

    if (direction === 0) return;

    this.dasTimer += dt;
    if (this.dasTimer >= 0.17) {
      this.repeatTimer += dt;
      // Auto-shift repeats about every 50ms once the initial delay passes.
      while (this.repeatTimer >= 0.05) {
        this.repeatTimer -= 0.05;
        if (!this.#move(direction)) break;
      }
    }
  }

  /* =============================================================== draw == */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawWell(ctx);
    this.#drawStack(ctx);
    if (!this.clearing && this.piece) {
      this.#drawGhost(ctx);
      this.#drawPiece(ctx);
    }
    this.#drawClearFlash(ctx);
    this.#drawPanels(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawWell(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(this.boardX, this.boardY, BOARD_W, BOARD_H);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(this.boardX + x * CELL, this.boardY);
      ctx.lineTo(this.boardX + x * CELL, this.boardY + BOARD_H);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(this.boardX, this.boardY + y * CELL);
      ctx.lineTo(this.boardX + BOARD_W, this.boardY + y * CELL);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,229,255,0.35)';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.boardX - 1, this.boardY - 1, BOARD_W + 2, BOARD_H + 2);
    ctx.restore();
  }

  #block(ctx, px, py, color, { alpha = 1, ghost = false } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (ghost) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeRect(px + 2.5, py + 2.5, CELL - 5, CELL - 5);
    } else {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = color;
      ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      // A lighter inner face gives the block a little depth.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha * 0.32;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 3, py + 3, CELL - 6, 3);
      ctx.fillRect(px + 3, py + 3, 3, CELL - 6);
    }
    ctx.restore();
  }

  #drawStack(ctx) {
    for (let y = HIDDEN; y < ROWS + HIDDEN; y++) {
      for (let x = 0; x < COLS; x++) {
        const color = this.grid[y][x];
        if (!color) continue;
        this.#block(ctx, this.boardX + x * CELL, this.boardY + (y - HIDDEN) * CELL, color);
      }
    }
  }

  #drawPiece(ctx) {
    for (const [x, y] of this.#cellsOf(this.piece)) {
      if (y < HIDDEN) continue;
      this.#block(ctx, this.boardX + x * CELL, this.boardY + (y - HIDDEN) * CELL, this.piece.color);
    }
  }

  #drawGhost(ctx) {
    let distance = 0;
    while (!this.#collides(this.piece, 0, distance + 1, 0)) distance++;
    if (distance === 0) return;
    for (const [x, y] of this.#cellsOf(this.piece, 0, distance)) {
      if (y < HIDDEN) continue;
      this.#block(ctx, this.boardX + x * CELL, this.boardY + (y - HIDDEN) * CELL, this.piece.color, {
        ghost: true,
      });
    }
  }

  #drawClearFlash(ctx) {
    if (!this.clearing) return;
    const t = this.clearing.timer / 0.28;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 24;
    for (const row of this.clearing.rows) {
      if (row < HIDDEN) continue;
      const h = CELL * t;
      ctx.fillRect(
        this.boardX,
        this.boardY + (row - HIDDEN) * CELL + (CELL - h) / 2,
        BOARD_W,
        h,
      );
    }
    ctx.restore();
  }

  /* --- hold and next --- */

  #drawPanels(ctx) {
    this.#panel(ctx, 12, this.boardY, 'HOLD', this.hold ? [this.hold] : []);
    this.#panel(ctx, this.boardX + BOARD_W + 16, this.boardY, 'NEXT', this.queue);

    // Level and combo readouts under the hold box.
    const x = 12 + PANEL / 2;
    this.text(ctx, 'LEVEL', x, this.boardY + 132, { size: 10, color: '#8b93a7' });
    this.text(ctx, String(this.level), x, this.boardY + 152, { size: 22, color: '#00e5ff', glow: 12 });

    if (this.combo > 0) {
      this.text(ctx, 'COMBO', x, this.boardY + 196, { size: 10, color: '#8b93a7' });
      this.text(ctx, `x${this.combo + 1}`, x, this.boardY + 216, {
        size: 20, color: '#ffd23f', glow: 12,
      });
    }
    if (this.backToBack) {
      this.text(ctx, 'B2B', x, this.boardY + 254, { size: 12, color: '#ff2e88', glow: 10 });
    }
  }

  #panel(ctx, x, y, label, types) {
    const height = 42 + Math.max(1, types.length) * 54;

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(x, y, PANEL, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, PANEL - 1, height - 1);
    ctx.restore();

    this.text(ctx, label, x + PANEL / 2, y + 16, { size: 10, color: '#8b93a7' });

    types.forEach((type, i) => {
      this.#drawMini(ctx, type, x + PANEL / 2, y + 56 + i * 54);
    });
  }

  /** A piece drawn small and centred, for the hold and next boxes. */
  #drawMini(ctx, type, cx, cy) {
    const def = PIECES[type];
    const size = 13;
    const xs = def.cells.map((c) => c[0]);
    const ys = def.cells.map((c) => c[1]);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * size;
    const h = (Math.max(...ys) - Math.min(...ys) + 1) * size;
    const ox = cx - w / 2 - Math.min(...xs) * size;
    const oy = cy - h / 2 - Math.min(...ys) * size;

    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = def.color;
    for (const [x, y] of def.cells) {
      ctx.fillRect(ox + x * size + 1, oy + y * size + 1, size - 2, size - 2);
    }
    ctx.restore();
  }
}
