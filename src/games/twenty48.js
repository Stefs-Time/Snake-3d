import { BaseGame } from '../core/game.js';

/**
 * 2048
 *
 * A slide is resolved column-by-column (or row-by-row) as a compaction: pull
 * everything toward the wall, merge each pair once, compact again. Recording
 * where every tile came from lets the render pass animate them sliding into
 * place rather than teleporting, which is most of what makes it feel good.
 */

const N = 4;
const W = 460;
const H = 460;
const PAD = 14;
const BOARD = W - PAD * 2;
const CELL = (BOARD - PAD * (N + 1)) / N;

const SLIDE_TIME = 0.11;
const SPAWN_TIME = 0.14;

/** Tile colours climb from cool to hot as the values grow. */
const TIERS = {
  2: ['#1b2230', '#c9d4e8'],
  4: ['#1d2a3d', '#d5e2f5'],
  8: ['#00506b', '#e6fbff'],
  16: ['#006c8c', '#e6fbff'],
  32: ['#0088a8', '#04060a'],
  64: ['#00a5bd', '#04060a'],
  128: ['#00c2c0', '#04060a'],
  256: ['#39ff88', '#04060a'],
  512: ['#ffd23f', '#04060a'],
  1024: ['#ff9f43', '#04060a'],
  2048: ['#ff2e88', '#ffffff'],
};

export default class Twenty48 extends BaseGame {
  static id = 'twenty48';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'swipe';
  static smooth = true;
  static hudPad = { top: 36, bottom: 28 };
  static hudLabels = { score: 'Score', secondary: 'Best tile' };

  setup() {
    this.host.setSecondaryLabel('Best tile');
    this.host.setHint('Arrows or swipe · U to undo');
    this.setLives(1);

    this.grid = Array.from({ length: N }, () => Array(N).fill(0));
    this.animations = [];
    this.animTimer = 0;
    this.history = null;
    this.won = false;
    this.best = 0;

    this.#spawnTile();
    this.#spawnTile();

    this.banner('Slide to merge');
    this.play('ready');
  }

  /* ============================================================== helpers */

  #emptyCells() {
    const cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) if (!this.grid[r][c]) cells.push([r, c]);
    }
    return cells;
  }

  #spawnTile() {
    const cells = this.#emptyCells();
    if (!cells.length) return null;
    const [r, c] = cells[Math.floor(this.random() * cells.length)];
    // Nine times out of ten it is a 2 — the 4 is what ruins your corner plan.
    this.grid[r][c] = this.random() < 0.9 ? 2 : 4;
    this.animations.push({ type: 'spawn', r, c, value: this.grid[r][c], t: 0 });
    return [r, c];
  }

  #canMove() {
    if (this.#emptyCells().length) return true;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = this.grid[r][c];
        if (c + 1 < N && this.grid[r][c + 1] === v) return true;
        if (r + 1 < N && this.grid[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  /* =============================================================== moving */

  /**
   * Compact one line toward index 0, merging equal neighbours once each.
   * Returns the new line plus the movement record used for animation.
   */
  #collapseLine(line, indices) {
    const filled = [];
    for (let i = 0; i < N; i++) {
      if (line[i]) filled.push({ value: line[i], from: indices[i] });
    }

    const result = [];
    const moves = [];
    let gained = 0;

    for (let i = 0; i < filled.length; i++) {
      const current = filled[i];
      const next = filled[i + 1];
      if (next && next.value === current.value) {
        const merged = current.value * 2;
        result.push(merged);
        gained += merged;
        const to = indices[result.length - 1];
        moves.push({ from: current.from, to, value: current.value, merged: true, result: merged });
        moves.push({ from: next.from, to, value: next.value, merged: true, result: merged });
        i++; // the pair is consumed
      } else {
        result.push(current.value);
        moves.push({ from: current.from, to: indices[result.length - 1], value: current.value, merged: false });
      }
    }

    while (result.length < N) result.push(0);
    return { line: result, moves, gained };
  }

  /** @param {'up'|'down'|'left'|'right'} direction */
  #slide(direction) {
    if (this.animations.length) return false;

    const before = this.grid.map((row) => [...row]);
    const beforeScore = this.score;

    const moves = [];
    let gained = 0;
    let changed = false;

    for (let i = 0; i < N; i++) {
      // Read each row or column in the direction of travel, then write it back.
      const line = [];
      const indices = [];
      for (let j = 0; j < N; j++) {
        let r;
        let c;
        if (direction === 'left') { r = i; c = j; }
        else if (direction === 'right') { r = i; c = N - 1 - j; }
        else if (direction === 'up') { r = j; c = i; }
        else { r = N - 1 - j; c = i; }
        line.push(this.grid[r][c]);
        indices.push([r, c]);
      }

      const collapsed = this.#collapseLine(line, indices);
      gained += collapsed.gained;

      for (let j = 0; j < N; j++) {
        const [r, c] = indices[j];
        if (this.grid[r][c] !== collapsed.line[j]) changed = true;
        this.grid[r][c] = collapsed.line[j];
      }
      moves.push(...collapsed.moves);
    }

    if (!changed) return false;

    // Only tiles that actually travelled need animating.
    for (const move of moves) {
      if (move.from[0] === move.to[0] && move.from[1] === move.to[1] && !move.merged) continue;
      this.animations.push({ type: 'slide', ...move, t: 0 });
    }

    this.history = { grid: before, score: beforeScore };

    if (gained) {
      this.addScore(gained);
      this.play('merge');
      this.shake.add(Math.min(5, Math.log2(gained)));
    } else {
      this.play('blip');
    }

    this.animTimer = SLIDE_TIME;
    this.pendingSpawn = true;
    return true;
  }

  #undo() {
    if (!this.history || this.animations.length) return;
    this.grid = this.history.grid.map((row) => [...row]);
    this.score = this.history.score;
    this.host.setScore(this.score);
    this.history = null;
    this.play('back');
    this.banner('Undo');
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);

    if (this.animTimer > 0) {
      this.animTimer -= dt;
      for (const anim of this.animations) anim.t += dt;
      if (this.animTimer <= 0) {
        this.animations = this.animations.filter((a) => a.type === 'spawn' && a.t < SPAWN_TIME);
        if (this.pendingSpawn) {
          this.pendingSpawn = false;
          this.#spawnTile();
          this.animTimer = SPAWN_TIME;
          this.#afterMove();
        }
      }
      return;
    }

    for (const anim of this.animations) anim.t += dt;
    this.animations = this.animations.filter((a) => a.t < SPAWN_TIME);

    if (this.input.keyPressed('KeyU') || this.input.pressed('secondary')) {
      this.#undo();
      return;
    }

    const direction = this.input.takeDirection();
    if (direction) this.#slide(direction);
  }

  #afterMove() {
    let best = 0;
    for (const row of this.grid) for (const v of row) best = Math.max(best, v);
    this.best = best;
    this.host.setSecondary(best);
    this.meta = { tile: best };

    if (best >= 2048 && !this.won) {
      this.won = true;
      this.banner('2048!');
      this.play('highscore');
      this.addScore(5000);
    }

    if (!this.#canMove()) {
      this.play('gameover');
      this.end();
    }
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    /* --- board --- */
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    roundRect(ctx, PAD, PAD, BOARD, BOARD, 10);
    ctx.fill();

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const { x, y } = this.#cellPos(r, c);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        roundRect(ctx, x, y, CELL, CELL, 7);
        ctx.fill();
      }
    }

    /* --- tiles that are mid-slide --- */
    const sliding = this.animations.filter((a) => a.type === 'slide');
    const slideProgress = sliding.length
      ? Math.min(1, (sliding[0].t ?? 0) / SLIDE_TIME)
      : 1;
    const movingTargets = new Set(sliding.map((a) => `${a.to[0]},${a.to[1]}`));

    if (sliding.length && slideProgress < 1) {
      // Draw the board as it was, with tiles interpolating toward their targets.
      for (const anim of sliding) {
        const from = this.#cellPos(anim.from[0], anim.from[1]);
        const to = this.#cellPos(anim.to[0], anim.to[1]);
        const e = easeOut(slideProgress);
        this.#tile(ctx, from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, anim.value, 1);
      }
      // Everything that did not move.
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (!this.grid[r][c]) continue;
          if (movingTargets.has(`${r},${c}`)) continue;
          const { x, y } = this.#cellPos(r, c);
          this.#tile(ctx, x, y, this.grid[r][c], 1);
        }
      }
    } else {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const value = this.grid[r][c];
          if (!value) continue;
          const spawn = this.animations.find(
            (a) => a.type === 'spawn' && a.r === r && a.c === c && a.t < SPAWN_TIME,
          );
          const scale = spawn ? 0.35 + easeOut(spawn.t / SPAWN_TIME) * 0.65 : 1;
          const { x, y } = this.#cellPos(r, c);
          this.#tile(ctx, x, y, value, scale);
        }
      }
    }

    this.drawEffects(ctx);
    ctx.restore();
  }

  #cellPos(r, c) {
    return {
      x: PAD * 2 + c * (CELL + PAD),
      y: PAD * 2 + r * (CELL + PAD),
    };
  }

  #tile(ctx, x, y, value, scale) {
    const [bg, fg] = TIERS[value] ?? ['#ff2e88', '#ffffff'];
    const inset = (CELL * (1 - scale)) / 2;
    const size = CELL * scale;

    ctx.save();
    if (value >= 128) {
      ctx.shadowColor = bg;
      ctx.shadowBlur = 8 + Math.log2(value) * 2;
    }
    ctx.fillStyle = bg;
    roundRect(ctx, x + inset, y + inset, size, size, 7 * scale);
    ctx.fill();
    ctx.restore();

    if (scale < 0.7) return;

    const digits = String(value).length;
    const fontSize = Math.round(CELL * (digits > 3 ? 0.28 : digits > 2 ? 0.34 : 0.42) * scale);
    this.text(ctx, String(value), x + CELL / 2, y + CELL / 2, {
      size: fontSize,
      color: fg,
      glow: value >= 512 ? 10 : 0,
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const easeOut = (t) => 1 - (1 - t) ** 3;
