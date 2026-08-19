import { BaseGame } from '../core/game.js';

/**
 * CONNECT FOUR
 *
 * Not solved by brute force in a frame, so the opponent is a real search:
 * minimax with alpha-beta pruning, moves ordered from the centre outward
 * (centre columns take part in more lines, so they are usually better, and
 * trying them first is what makes the pruning bite). The evaluation counts
 * every window of four and rewards ones the machine is close to filling while
 * punishing ones you are.
 *
 * Difficulty is search depth, from three plies up to seven as the matches go
 * on. Depth alone is enough — there is no need to make it play badly on
 * purpose, because a shallow search genuinely misses threats.
 */

const COLS = 7;
const ROWS = 6;
const CELL = 74;

const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;

const W = BOARD_W + 60;
const H = BOARD_H + 130;
const BOARD_X = 30;
const BOARD_Y = 96;

const HUMAN = 1;
const AI = 2;

const DISC_R = CELL * 0.4;

/** Every line of four on the board, computed once. */
const WINDOWS = (() => {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) out.push([r * COLS + c, r * COLS + c + 1, r * COLS + c + 2, r * COLS + c + 3]);
      if (r + 3 < ROWS) out.push([r * COLS + c, (r + 1) * COLS + c, (r + 2) * COLS + c, (r + 3) * COLS + c]);
      if (c + 3 < COLS && r + 3 < ROWS) {
        out.push([r * COLS + c, (r + 1) * COLS + c + 1, (r + 2) * COLS + c + 2, (r + 3) * COLS + c + 3]);
      }
      if (c - 3 >= 0 && r + 3 < ROWS) {
        out.push([r * COLS + c, (r + 1) * COLS + c - 1, (r + 2) * COLS + c - 2, (r + 3) * COLS + c - 3]);
      }
    }
  }
  return out;
})();

/** Centre-out, so alpha-beta gets its best cutoffs early. */
const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

export default class ConnectFour extends BaseGame {
  static id = 'connectfour';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Round' };

  setup() {
    this.host.setSecondaryLabel('Round');
    this.host.setHint('Click a column to drop · four in a row wins',
      'Tap a column to drop · four in a row wins');
    this.setLives(3);

    this.round = 1;
    this.wins = 0;
    this.#buildLayers();
    this.#buildSprites();
    this.#newGame(HUMAN);
    this.banner('Drop one');
    this.play('ready');
  }

  /** The backdrop and the punched slab never change — paint them once. */
  #buildLayers() {
    const scale = 2;

    const bg = document.createElement('canvas');
    bg.width = W * scale;
    bg.height = H * scale;
    let c = bg.getContext('2d');
    c.scale(scale, scale);
    const glow = c.createRadialGradient(W / 2, BOARD_Y + BOARD_H / 2, 60, W / 2, BOARD_Y + BOARD_H / 2, W * 0.75);
    glow.addColorStop(0, 'rgba(56,189,248,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 32; x < W; x += 32) {
      for (let y = 32; y < H; y += 32) c.fillRect(x - 1, y - 1, 2, 2);
    }
    this.bgLayer = bg;

    const slab = document.createElement('canvas');
    slab.width = W * scale;
    slab.height = H * scale;
    c = slab.getContext('2d');
    c.scale(scale, scale);
    const body = c.createLinearGradient(0, BOARD_Y - 10, 0, BOARD_Y + BOARD_H + 10);
    body.addColorStop(0, '#1a2450');
    body.addColorStop(0.5, '#131c3d');
    body.addColorStop(1, '#0e1530');
    c.fillStyle = body;
    this.roundRect(c, BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 14);
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const x = BOARD_X + col * CELL + CELL / 2;
        const y = BOARD_Y + r * CELL + CELL / 2;
        c.moveTo(x + DISC_R, y);
        c.arc(x, y, DISC_R, 0, Math.PI * 2, true);
      }
    }
    c.fill('evenodd');
    // Each hole gets a machined rim so the slab reads as having thickness.
    c.lineWidth = 1.5;
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const x = BOARD_X + col * CELL + CELL / 2;
        const y = BOARD_Y + r * CELL + CELL / 2;
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.beginPath();
        c.arc(x, y, DISC_R + 1, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = 'rgba(56,189,248,0.14)';
        c.beginPath();
        c.arc(x, y, DISC_R + 2.5, 0, Math.PI * 2);
        c.stroke();
      }
    }
    c.strokeStyle = 'rgba(56,189,248,0.28)';
    c.lineWidth = 1.5;
    this.roundRect(c, BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 14).stroke();
    this.slabLayer = slab;
  }

  #buildSprites() {
    const make = (player) => {
      const scale = 3;
      const size = CELL;
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = size * scale;
      const c = cnv.getContext('2d');
      c.scale(scale, scale);
      const cx = size / 2;
      const cy = size / 2;
      const color = player === HUMAN ? '#fbbf24' : '#fb7185';
      const deep = player === HUMAN ? '#8a5a06' : '#8a1f3c';
      const mid = player === HUMAN ? '#f59e0b' : '#f43f5e';

      const body = c.createRadialGradient(cx - DISC_R * 0.3, cy - DISC_R * 0.35, DISC_R * 0.1, cx, cy, DISC_R * 1.05);
      body.addColorStop(0, player === HUMAN ? '#ffe28a' : '#ff9ab5');
      body.addColorStop(0.55, mid);
      body.addColorStop(1, deep);
      c.save();
      c.shadowColor = color;
      c.shadowBlur = 10;
      c.fillStyle = body;
      c.beginPath();
      c.arc(cx, cy, DISC_R, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // The pressed ring every plastic checker has.
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, DISC_R * 0.62, 0, Math.PI * 2);
      c.stroke();

      const dome = c.createRadialGradient(cx - DISC_R * 0.28, cy - DISC_R * 0.36, 0, cx - DISC_R * 0.28, cy - DISC_R * 0.36, DISC_R * 0.75);
      dome.addColorStop(0, 'rgba(255,255,255,0.55)');
      dome.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = dome;
      c.beginPath();
      c.arc(cx, cy, DISC_R, 0, Math.PI * 2);
      c.fill();

      return cnv;
    };
    this.discSprites = { [HUMAN]: make(HUMAN), [AI]: make(AI) };
  }

  #newGame(starter) {
    this.cells = Array(COLS * ROWS).fill(0);
    this.turn = starter;
    this.winLine = null;
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = starter === AI ? 0.7 : 0;
    this.falling = null; // { col, row, player, y, vy }
    this.depth = Math.min(7, 3 + Math.floor((this.round - 1) / 2) * 2);
    this.host.setSecondary(this.round);
  }

  /* ================================================================= board */

  static #dropRow(cells, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (!cells[r * COLS + col]) return r;
    return -1;
  }

  static #winnerOf(cells) {
    for (const w of WINDOWS) {
      const first = cells[w[0]];
      if (first && w.every((i) => cells[i] === first)) return { player: first, line: w };
    }
    return cells.every(Boolean) ? { player: 0, line: null } : null;
  }

  /**
   * Positive is good for the machine. Each window contributes by how close it
   * is to being filled, and a window containing both players is dead so it
   * contributes nothing.
   */
  static #evaluate(cells) {
    let score = 0;
    for (const w of WINDOWS) {
      let mine = 0;
      let yours = 0;
      for (const i of w) {
        if (cells[i] === AI) mine++;
        else if (cells[i] === HUMAN) yours++;
      }
      if (mine && yours) continue;
      if (mine === 3) score += 60;
      else if (mine === 2) score += 8;
      else if (mine === 1) score += 1;
      if (yours === 3) score -= 80; // block a little harder than you build
      else if (yours === 2) score -= 9;
      else if (yours === 1) score -= 1;
    }
    // Centre control is worth having on its own.
    for (let r = 0; r < ROWS; r++) {
      const v = cells[r * COLS + 3];
      if (v === AI) score += 4;
      else if (v === HUMAN) score -= 4;
    }
    return score;
  }

  static #search(cells, depth, alpha, beta, maximising) {
    const outcome = ConnectFour.#winnerOf(cells);
    if (outcome) {
      if (outcome.player === AI) return 100000 + depth;
      if (outcome.player === HUMAN) return -100000 - depth;
      return 0;
    }
    if (depth === 0) return ConnectFour.#evaluate(cells);

    let best = maximising ? -Infinity : Infinity;
    for (const col of COLUMN_ORDER) {
      const row = ConnectFour.#dropRow(cells, col);
      if (row < 0) continue;
      const index = row * COLS + col;
      cells[index] = maximising ? AI : HUMAN;
      const value = ConnectFour.#search(cells, depth - 1, alpha, beta, !maximising);
      cells[index] = 0;

      if (maximising) {
        best = Math.max(best, value);
        alpha = Math.max(alpha, value);
      } else {
        best = Math.min(best, value);
        beta = Math.min(beta, value);
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  #chooseColumn() {
    let bestScore = -Infinity;
    let choices = [];
    for (const col of COLUMN_ORDER) {
      const row = ConnectFour.#dropRow(this.cells, col);
      if (row < 0) continue;
      const index = row * COLS + col;
      this.cells[index] = AI;
      const value = ConnectFour.#search(this.cells, this.depth - 1, -Infinity, Infinity, false);
      this.cells[index] = 0;

      if (value > bestScore) {
        bestScore = value;
        choices = [col];
      } else if (value === bestScore) {
        choices.push(col);
      }
    }
    return choices.length ? choices[Math.floor(this.random() * choices.length)] : -1;
  }

  /* =============================================================== playing */

  #drop(col, player) {
    const row = ConnectFour.#dropRow(this.cells, col);
    if (row < 0) {
      this.play('hit');
      return false;
    }
    // The disc animates down; the board is only written when it lands.
    this.falling = { col, row, player, y: BOARD_Y - CELL * 0.6, vy: 0 };
    this.turn = 0; // nobody moves while a disc is in flight
    this.play('drop');
    return true;
  }

  #land() {
    const { col, row, player } = this.falling;
    this.cells[row * COLS + col] = player;
    this.falling = null;
    this.shake.add(3);
    this.play('bounce');

    const outcome = ConnectFour.#winnerOf(this.cells);
    if (outcome) {
      this.winLine = outcome.line;
      this.#finish(outcome.player);
      return;
    }
    this.turn = player === HUMAN ? AI : HUMAN;
    if (this.turn === AI) this.aiTimer = 0.4;
  }

  #finish(winner) {
    this.result = winner;
    this.settleTimer = 1.8;
    this.meta = { round: this.round, wins: this.wins };

    if (winner === HUMAN) {
      this.wins++;
      this.addScore(800 + this.round * 250);
      this.banner('Four!');
      this.play('highscore');
      this.shake.add(8);
      if (this.winLine) {
        for (const i of this.winLine) {
          this.particles.emit(
            BOARD_X + (i % COLS) * CELL + CELL / 2,
            BOARD_Y + Math.floor(i / COLS) * CELL + CELL / 2,
            { count: 12, speed: 130, color: '#fbbf24', life: 0.6, size: 3 },
          );
        }
      }
    } else if (winner === AI) {
      this.banner('Beaten');
      this.play('die');
      this.shake.add(8);
    } else {
      this.addScore(200);
      this.banner('Full board');
      this.play('back');
    }
  }

  #afterGame() {
    if (this.result === AI) {
      const lives = this.lives - 1;
      this.setLives(Math.max(0, lives));
      if (lives <= 0) {
        this.meta = { round: this.round, wins: this.wins };
        this.end();
        return;
      }
      this.#newGame(HUMAN);
      return;
    }
    // Winning or drawing moves you up a round, and the search gets deeper.
    this.round++;
    this.#newGame(this.round % 2 === 0 ? AI : HUMAN);
  }

  /* ================================================================ update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.falling) {
      this.falling.vy += 2600 * dt;
      this.falling.y += this.falling.vy * dt;
      const target = BOARD_Y + this.falling.row * CELL + CELL / 2;
      if (this.falling.y >= target) this.#land();
      return;
    }

    if (this.result !== null) {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.#afterGame();
      return;
    }

    if (this.turn === AI) {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        const col = this.#chooseColumn();
        if (col >= 0) this.#drop(col, AI);
      }
      return;
    }

    if (this.turn !== HUMAN) return;
    const m = this.mouse;
    if (!m.pressed) return;
    const col = Math.floor((m.x - BOARD_X) / CELL);
    if (col < 0 || col >= COLS) return;
    this.#drop(col, HUMAN);
  }

  /* ================================================================== draw */

  draw(ctx) {
    this.clear(ctx, '#060812');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawHeader(ctx);
    // Discs first, then the slab punched with holes on top of them — that is
    // what makes a disc look like it is inside the frame rather than on it.
    this.#drawDiscs(ctx);
    this.#drawSlab(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawHeader(ctx) {
    const label =
      this.result === HUMAN ? 'YOU WIN'
      : this.result === AI ? 'CPU WINS'
      : this.result === 0 ? 'DRAWN'
      : this.turn === AI ? 'CPU THINKING' : 'YOUR TURN';
    const color =
      this.result === AI ? '#fb7185' : this.turn === AI && this.result === null ? '#8b93a7' : '#fbbf24';

    this.text(ctx, label, W / 2, 22, { size: 14, color, glow: 10 });
    // Bottom-left, out of the way of the column hint that hangs over the board.
    this.text(ctx, `SEARCH DEPTH ${this.depth}`, BOARD_X, H - 14, {
      size: 10, color: '#5c6478', align: 'left',
    });

    // Column hint under the pointer.
    const m = this.mouse;
    if (this.turn !== HUMAN || !m.active || this.falling) return;
    const col = Math.floor((m.x - BOARD_X) / CELL);
    if (col < 0 || col >= COLS) return;
    if (ConnectFour.#dropRow(this.cells, col) < 0) return;
    this.glowCircle(ctx, BOARD_X + col * CELL + CELL / 2, BOARD_Y - CELL * 0.46, DISC_R * 0.8, '#fbbf24', 14);
  }

  #drawDiscs(ctx) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const player = this.cells[r * COLS + c];
        if (!player) continue;
        const winning = this.winLine?.includes(r * COLS + c);
        this.#disc(
          ctx,
          BOARD_X + c * CELL + CELL / 2,
          BOARD_Y + r * CELL + CELL / 2,
          player,
          winning ? 1.06 + Math.sin(performance.now() / 120) * 0.06 : 1,
        );
      }
    }

    if (this.falling) {
      this.#disc(
        ctx,
        BOARD_X + this.falling.col * CELL + CELL / 2,
        this.falling.y,
        this.falling.player,
        1,
      );
    }
  }

  /** One dark slab with the cells cut out of it, drawn over the discs. */
  #drawSlab(ctx) {
    ctx.save();
    ctx.fillStyle = '#141c3a';
    this.roundRect(ctx, BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 14);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = BOARD_X + c * CELL + CELL / 2;
        const y = BOARD_Y + r * CELL + CELL / 2;
        ctx.moveTo(x + DISC_R, y);
        ctx.arc(x, y, DISC_R, 0, Math.PI * 2, true);
      }
    }
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(56,189,248,0.28)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 14).stroke();
    ctx.restore();
  }

  #disc(ctx, x, y, player, scale) {
    const color = player === HUMAN ? '#fbbf24' : '#fb7185';
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, DISC_R * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - DISC_R * 0.24, y - DISC_R * 0.28, DISC_R * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
