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
  4096: ['#b47bff', '#ffffff'],
  8192: ['#7c3aed', '#ffffff'],
};

/** Cached sprites render at 2x so the scaled canvas stays crisp on phones. */
const SPRITE_SCALE = 2;
const TILE_PAD = 16;

export default class Twenty48 extends BaseGame {
  static id = 'twenty48';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'swipe';
  static touchButtons = { secondary: 'UNDO' };
  static smooth = true;
  static hudPad = { top: 36, bottom: 28 };
  static hudLabels = { score: 'Score', secondary: 'Best tile' };

  setup() {
    this.host.setSecondaryLabel('Best tile');
    this.host.setHint('Arrows or swipe · U to undo', 'Swipe to slide · UNDO takes one back');
    this.setLives(1);

    this.grid = Array.from({ length: N }, () => Array(N).fill(0));
    this.animations = [];
    this.animTimer = 0;
    this.history = null;
    this.won = false;
    this.best = 0;
    this.pendingSpawn = false;
    this.mergedCells = [];
    this.pendingGain = 0;

    this.tileSprites = new Map();
    this.backdrop = this.#makeBackdrop();

    this.#spawnTile();
    this.#spawnTile();
    this.#refreshBest();

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
    // A slide may begin while spawn pops are still settling — only an
    // unresolved slide blocks input, so quick swipes are never eaten.
    if (this.pendingSpawn || this.animations.some((a) => a.type === 'slide')) return false;

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

    this.mergedCells = [];
    const seen = new Set();
    for (const move of moves) {
      if (!move.merged) continue;
      const key = `${move.to[0]},${move.to[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.mergedCells.push({ r: move.to[0], c: move.to[1], value: move.result });
    }
    this.pendingGain = gained;

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
    if (!this.history || this.pendingSpawn || this.animations.some((a) => a.type === 'slide')) return;
    this.grid = this.history.grid.map((row) => [...row]);
    this.score = this.history.score;
    this.host.setScore(this.score);
    this.history = null;
    this.animations = [];
    this.#refreshBest();
    this.play('back');
    this.banner('Undo');
  }

  #refreshBest() {
    let best = 0;
    for (const row of this.grid) for (const v of row) best = Math.max(best, v);
    this.best = best;
    this.host.setSecondary(best);
    this.meta = { tile: best };
    return best;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);

    if (this.animTimer > 0) {
      this.animTimer -= dt;
      for (const anim of this.animations) anim.t += dt;
      if (this.animTimer <= 0) {
        this.animations = this.animations.filter((a) => a.type !== 'slide' && a.t < SPAWN_TIME);
        if (this.pendingSpawn) {
          this.pendingSpawn = false;
          this.#landMerges();
          this.#spawnTile();
          this.animTimer = SPAWN_TIME;
          this.#afterMove();
        }
      }
      if (this.pendingSpawn) return;
    } else {
      for (const anim of this.animations) anim.t += dt;
      this.animations = this.animations.filter((a) => a.t < SPAWN_TIME);
    }

    if (this.over) return;

    if (this.input.keyPressed('KeyU') || this.input.pressed('secondary')) {
      this.#undo();
      return;
    }

    const direction = this.input.takeDirection();
    if (direction) this.#slide(direction);
  }

  /** The merged tiles have arrived: pop them and show what they paid. */
  #landMerges() {
    for (const { r, c, value } of this.mergedCells) {
      this.animations.push({ type: 'pop', r, c, t: 0 });
      const { x, y } = this.#cellPos(r, c);
      const [bg] = TIERS[value] ?? ['#ff2e88'];
      this.particles.emit(x + CELL / 2, y + CELL / 2, {
        count: value >= 128 ? 10 : 6,
        speed: 90,
        color: value >= 8 ? bg : '#7f9cc4',
        life: 0.35,
        size: 2.4,
      });
    }
    if (this.pendingGain && this.mergedCells.length) {
      const top = this.mergedCells.reduce((a, b) => (b.value > a.value ? b : a));
      const { x, y } = this.#cellPos(top.r, top.c);
      this.popups.add(x + CELL / 2, y + CELL / 2, `+${this.pendingGain}`, '#ffd23f', 15);
    }
    this.mergedCells = [];
    this.pendingGain = 0;
  }

  #afterMove() {
    const best = this.#refreshBest();

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
    ctx.drawImage(this.backdrop, 0, 0, W, H);

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
          const pop = spawn ? null : this.animations.find(
            (a) => a.type === 'pop' && a.r === r && a.c === c && a.t < SPAWN_TIME,
          );
          let scale = 1;
          if (spawn) scale = 0.35 + easeOut(spawn.t / SPAWN_TIME) * 0.65;
          else if (pop) scale = 1 + Math.sin(Math.PI * Math.min(1, pop.t / SPAWN_TIME)) * 0.12;
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
    const sprite = this.#tileSprite(value);
    const span = CELL + TILE_PAD * 2;
    const size = span * scale;
    ctx.drawImage(sprite, x + CELL / 2 - size / 2, y + CELL / 2 - size / 2, size, size);
  }

  /** One tile per value, glow, sheen and number baked, built on first sight. */
  #tileSprite(value) {
    let sprite = this.tileSprites.get(value);
    if (sprite) return sprite;

    const s = SPRITE_SCALE;
    const span = CELL + TILE_PAD * 2;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = Math.ceil(span * s);
    const g = sprite.getContext('2d');
    g.scale(s, s);

    const [bg, fg] = TIERS[value] ?? ['#ff2e88', '#ffffff'];
    if (value >= 128) {
      g.shadowColor = bg;
      g.shadowBlur = 8 + Math.log2(value) * 2;
    }
    g.fillStyle = bg;
    roundRect(g, TILE_PAD, TILE_PAD, CELL, CELL, 7);
    g.fill();
    g.shadowBlur = 0;

    const sheen = g.createLinearGradient(0, TILE_PAD, 0, TILE_PAD + CELL);
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = sheen;
    roundRect(g, TILE_PAD, TILE_PAD, CELL, CELL, 7);
    g.fill();

    const digits = String(value).length;
    const fontSize = Math.round(CELL * (digits > 3 ? 0.28 : digits > 2 ? 0.34 : 0.42));
    this.text(g, String(value), span / 2, span / 2, {
      size: fontSize,
      color: fg,
      glow: value >= 512 ? 10 : 0,
    });

    this.tileSprites.set(value, sprite);
    return sprite;
  }

  #makeBackdrop() {
    const s = SPRITE_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = W * s;
    canvas.height = H * s;
    const g = canvas.getContext('2d');
    g.scale(s, s);

    const wash = g.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, '#060a14');
    wash.addColorStop(1, '#04060a');
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);

    const well = g.createLinearGradient(0, PAD, 0, PAD + BOARD);
    well.addColorStop(0, 'rgba(255,255,255,0.05)');
    well.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.fillStyle = well;
    roundRect(g, PAD, PAD, BOARD, BOARD, 10);
    g.fill();

    g.strokeStyle = 'rgba(0,229,255,0.22)';
    g.shadowColor = '#00e5ff';
    g.shadowBlur = 10;
    g.lineWidth = 1.5;
    roundRect(g, PAD - 0.5, PAD - 0.5, BOARD + 1, BOARD + 1, 10);
    g.stroke();
    g.shadowBlur = 0;

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const { x, y } = this.#cellPos(r, c);
        g.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(g, x, y, CELL, CELL, 7);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.045)';
        roundRect(g, x, y, CELL, CELL, 7);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        g.lineWidth = 1;
        roundRect(g, x + 0.5, y + 0.5, CELL - 1, CELL - 1, 7);
        g.stroke();
      }
    }
    return canvas;
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
