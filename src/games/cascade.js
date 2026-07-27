import { BaseGame } from '../core/game.js';

/**
 * CASCADE — match three
 *
 * Swap two neighbours; if that makes a line of three or more, they clear,
 * everything above falls, and whatever lands may clear again. The chain is the
 * game — a swap that clears three is worth little, and a swap that sets off
 * four rounds of collapse is worth a level.
 *
 * A swap that makes nothing is rejected and snaps back, which means the board
 * must be searched for a match *before* it is committed. Two extra rules keep
 * it from going stale: a line of four leaves a charged gem that clears its
 * whole row and column, a line of five leaves a prism that removes every gem
 * of one colour, and if the board ever has no legal swap at all it reshuffles
 * rather than stranding you.
 */

const N = 8;
const CELL = 54;
const BOARD = N * CELL;

const W = BOARD + 210;
const H = BOARD + 56;
const BOARD_X = 22;
const BOARD_Y = 28;
const PANEL_X = BOARD_X + BOARD + 26;

const COLORS = ['#fb7185', '#38bdf8', '#a3e635', '#fbbf24', '#c084fc', '#2dd4bf'];
const SHAPES = ['circle', 'diamond', 'square', 'triangle', 'hexagon', 'star'];

const SWAP_TIME = 0.13;
const FALL_SPEED = 15; // cells per second

const MOVES_PER_LEVEL = 25;

/** Plain gem, or one of the two specials a long line leaves behind. */
const PLAIN = 0;
const CHARGED = 1;
const PRISM = 2;

export default class Cascade extends BaseGame {
  static id = 'cascade';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Level' };

  setup() {
    this.host.setSecondaryLabel('Level');
    this.host.setHint('Swap two neighbours to line up three');
    this.setLives(3);

    this.level = 1;
    this.#startLevel();
    this.banner('Match three');
    this.play('ready');
  }

  #startLevel() {
    this.host.setSecondary(this.level);
    this.target = 2000 + (this.level - 1) * 1800;
    this.levelScore = 0;
    this.movesLeft = MOVES_PER_LEVEL;
    this.chain = 0;
    this.selected = null;
    this.swap = null;
    this.state = 'idle';
    this.settleTimer = 0;
    this.meta = { level: this.level };

    this.#fillBoard();
  }

  /* ================================================================ board */

  #newGem(color = null) {
    return {
      color: color ?? Math.floor(this.random() * COLORS.length),
      kind: PLAIN,
      y: 0, // visual row offset while falling
      pop: 0,
    };
  }

  /** Deal a board with no matches already on it and at least one legal swap. */
  #fillBoard() {
    do {
      this.grid = Array.from({ length: N * N }, () => this.#newGem());
      // Re-roll any gem that completes a line as the board is dealt.
      for (let i = 0; i < N * N; i++) {
        let guard = 0;
        while (this.#matchesAt(i).length && guard++ < 20) {
          this.grid[i] = this.#newGem();
        }
      }
    } while (!this.#hasLegalSwap());
  }

  #at(r, c) {
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return this.grid[r * N + c];
  }

  /** The run of same-coloured gems through a cell, if it is three or longer. */
  #matchesAt(index) {
    const gem = this.grid[index];
    if (!gem) return [];
    const r = (index / N) | 0;
    const c = index % N;

    const run = (dr, dc) => {
      const out = [];
      for (let k = 1; ; k++) {
        const g = this.#at(r + dr * k, c + dc * k);
        if (!g || g.color !== gem.color) break;
        out.push((r + dr * k) * N + (c + dc * k));
      }
      return out;
    };

    const horizontal = [index, ...run(0, -1), ...run(0, 1)];
    const vertical = [index, ...run(-1, 0), ...run(1, 0)];
    const out = [];
    if (horizontal.length >= 3) out.push(...horizontal);
    if (vertical.length >= 3) out.push(...vertical);
    return [...new Set(out)];
  }

  /** Every distinct group on the board right now. */
  #findAllMatches() {
    const seen = new Set();
    const groups = [];

    for (let i = 0; i < N * N; i++) {
      if (seen.has(i)) continue;
      const match = this.#matchesAt(i);
      if (match.length < 3) continue;
      // Merge with any group this one touches, so an L counts once.
      const group = new Set(match);
      for (const idx of match) {
        for (const other of this.#matchesAt(idx)) group.add(other);
      }
      for (const idx of group) seen.add(idx);
      groups.push([...group]);
    }
    return groups;
  }

  #hasLegalSwap() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          if (r + dr >= N || c + dc >= N) continue;
          const a = r * N + c;
          const b = (r + dr) * N + (c + dc);
          [this.grid[a], this.grid[b]] = [this.grid[b], this.grid[a]];
          const found = this.#matchesAt(a).length >= 3 || this.#matchesAt(b).length >= 3;
          [this.grid[a], this.grid[b]] = [this.grid[b], this.grid[a]];
          if (found) return true;
        }
      }
    }
    return false;
  }

  /* ============================================================== clearing */

  /** Expand a group by whatever specials it contains. */
  #expand(group) {
    const out = new Set(group);
    const queue = [...group];

    while (queue.length) {
      const index = queue.pop();
      const gem = this.grid[index];
      if (!gem) continue;

      if (gem.kind === CHARGED) {
        const r = (index / N) | 0;
        const c = index % N;
        for (let k = 0; k < N; k++) {
          for (const i of [r * N + k, k * N + c]) {
            if (!out.has(i) && this.grid[i]) {
              out.add(i);
              queue.push(i);
            }
          }
        }
      } else if (gem.kind === PRISM) {
        for (let i = 0; i < N * N; i++) {
          if (this.grid[i]?.color === gem.color && !out.has(i)) {
            out.add(i);
            queue.push(i);
          }
        }
      }
    }
    return [...out];
  }

  #resolve() {
    const groups = this.#findAllMatches();
    if (!groups.length) return false;

    this.chain++;
    let cleared = 0;
    const specials = [];

    for (const group of groups) {
      // A long line leaves something behind at the gem you moved, if it was
      // part of the line, and otherwise at the middle of it.
      if (group.length >= 5) specials.push({ index: this.#anchorFor(group), kind: PRISM, color: this.grid[group[0]].color });
      else if (group.length === 4) specials.push({ index: this.#anchorFor(group), kind: CHARGED, color: this.grid[group[0]].color });

      const full = this.#expand(group);
      for (const index of full) {
        if (!this.grid[index]) continue;
        const [x, y] = this.#cellXY(index);
        this.particles.emit(x + CELL / 2, y + CELL / 2, {
          count: 7, speed: 110, color: COLORS[this.grid[index].color], life: 0.4, size: 2.6,
        });
        this.grid[index] = null;
        cleared++;
      }
    }

    // The multiplier is the whole reason to look for cascades.
    const multiplier = 1 + (this.chain - 1) * 0.6;
    const points = Math.round((cleared * 45 + (cleared - 3) * 30) * multiplier);
    this.addScore(Math.max(30, points));
    this.levelScore += Math.max(30, points);

    for (const { index, kind, color } of specials) {
      if (this.grid[index]) continue;
      this.grid[index] = { color, kind, y: 0, pop: 1 };
    }

    this.play(this.chain > 1 ? 'powerup' : 'merge');
    this.tone(360 + this.chain * 70, { dur: 0.09, gain: 0.14, type: 'triangle' });
    if (this.chain > 1) {
      this.banner(`Chain x${this.chain}`);
      this.shake.add(Math.min(7, this.chain * 1.6));
    }
    return true;
  }

  /** Where a special should land: the swapped gem if it is in the group. */
  #anchorFor(group) {
    if (this.lastSwap != null && group.includes(this.lastSwap)) return this.lastSwap;
    return group[Math.floor(group.length / 2)];
  }

  /** Drop everything into the holes and refill from the top. */
  #collapse() {
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const gem = this.grid[r * N + c];
        if (!gem) continue;
        if (write !== r) {
          this.grid[write * N + c] = gem;
          this.grid[r * N + c] = null;
          gem.y = write - r; // start visually where it came from
        }
        write--;
      }
      // Everything above the write head is new, falling in from off-board.
      for (let r = write; r >= 0; r--) {
        const gem = this.#newGem();
        gem.y = -(r + 1.5);
        this.grid[r * N + c] = gem;
      }
    }
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    for (const gem of this.grid) {
      if (!gem) continue;
      if (gem.pop > 0) gem.pop = Math.max(0, gem.pop - dt * 5);
      if (gem.y !== 0) {
        // Fall toward the resting offset of zero.
        const step = FALL_SPEED * dt;
        gem.y = gem.y < 0 ? Math.min(0, gem.y + step) : Math.max(0, gem.y - step);
      }
    }

    switch (this.state) {
      case 'swapping': {
        this.swap.t += dt / SWAP_TIME;
        if (this.swap.t < 1) break;
        const { a, b, undo } = this.swap;
        this.swap = null;

        if (undo) {
          this.state = 'idle';
          break;
        }
        // Committed: does it actually clear anything?
        if (this.#matchesAt(a).length >= 3 || this.#matchesAt(b).length >= 3) {
          this.movesLeft--;
          this.chain = 0;
          this.state = 'resolving';
        } else {
          [this.grid[a], this.grid[b]] = [this.grid[b], this.grid[a]];
          this.swap = { a, b, t: 0, undo: true };
          this.state = 'swapping';
          this.play('hit');
        }
        break;
      }

      case 'resolving':
        if (this.#resolve()) {
          this.#collapse();
          this.settleTimer = 0.2;
          this.state = 'settling';
        } else {
          this.#afterMove();
        }
        break;

      case 'settling':
        this.settleTimer -= dt;
        if (this.settleTimer <= 0) this.state = 'resolving';
        break;

      case 'idle':
        this.#handleInput();
        break;

      case 'over':
        this.settleTimer -= dt;
        if (this.settleTimer <= 0) {
          if (this.finished) this.end();
          else this.#startLevel();
        }
        break;
    }
  }

  #afterMove() {
    this.chain = 0;
    this.lastSwap = null;

    if (this.levelScore >= this.target) {
      // Unspent moves are worth keeping, so finishing early pays.
      this.addScore(this.movesLeft * 120 * this.level);
      this.banner(`Level ${this.level} clear`);
      this.play('highscore');
      this.level++;
      this.state = 'over';
      this.settleTimer = 1.6;
      return;
    }

    if (this.movesLeft <= 0) {
      const lives = this.lives - 1;
      this.setLives(Math.max(0, lives));
      this.play('die');
      this.banner('Out of moves');
      this.state = 'over';
      this.settleTimer = 1.6;
      if (lives <= 0) this.finished = true;
      return;
    }

    // A board with no legal swap is a dead end, so quietly deal a new one.
    if (!this.#hasLegalSwap()) {
      this.banner('No moves — reshuffle');
      this.play('back');
      this.#fillBoard();
    }
    this.state = 'idle';
  }

  #handleInput() {
    const m = this.mouse;
    if (!m.pressed) return;

    const c = Math.floor((m.x - BOARD_X) / CELL);
    const r = Math.floor((m.y - BOARD_Y) / CELL);
    if (c < 0 || c >= N || r < 0 || r >= N) {
      this.selected = null;
      return;
    }

    const index = r * N + c;
    if (this.selected == null) {
      this.selected = index;
      this.play('hover');
      return;
    }
    if (this.selected === index) {
      this.selected = null;
      return;
    }

    const sr = (this.selected / N) | 0;
    const sc = this.selected % N;
    const adjacent = Math.abs(sr - r) + Math.abs(sc - c) === 1;
    if (!adjacent) {
      // Not a neighbour, so treat it as picking a different gem.
      this.selected = index;
      this.play('hover');
      return;
    }

    const a = this.selected;
    this.selected = null;
    this.lastSwap = index;
    [this.grid[a], this.grid[index]] = [this.grid[index], this.grid[a]];
    this.swap = { a, b: index, t: 0, undo: false };
    this.state = 'swapping';
    this.play('blip');
  }

  /* ================================================================= draw */

  #cellXY(index) {
    return [BOARD_X + (index % N) * CELL, BOARD_Y + ((index / N) | 0) * CELL];
  }

  draw(ctx) {
    this.clear(ctx, '#080711');
    ctx.save();
    this.shake.apply(ctx);

    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    this.roundRect(ctx, BOARD_X - 6, BOARD_Y - 6, BOARD + 12, BOARD + 12, 12).fill();

    // Clip to the board so gems falling in from above appear at the edge.
    ctx.save();
    this.roundRect(ctx, BOARD_X - 2, BOARD_Y - 2, BOARD + 4, BOARD + 4, 10).clip();

    for (let i = 0; i < N * N; i++) {
      const gem = this.grid[i];
      if (!gem) continue;
      let [x, y] = this.#cellXY(i);
      y += gem.y * CELL;

      // The two swapping gems slide past each other.
      if (this.swap) {
        const { a, b, t } = this.swap;
        if (i === a || i === b) {
          const other = i === a ? b : a;
          const [ox, oy] = this.#cellXY(other);
          const [mx, my] = this.#cellXY(i);
          const e = 1 - Math.min(1, t);
          x = mx + (ox - mx) * e;
          y = my + (oy - my) * e;
        }
      }
      this.#drawGem(ctx, x, y, gem, i === this.selected);
    }
    ctx.restore();

    this.drawEffects(ctx);
    this.#drawPanel(ctx);
    ctx.restore();
  }

  #drawGem(ctx, x, y, gem, selected) {
    const color = COLORS[gem.color];
    const shape = SHAPES[gem.color];
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const r = CELL * 0.33 * (1 + gem.pop * 0.25);

    if (selected) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      this.roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 8).stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = gem.kind === PLAIN ? 10 : 20;
    ctx.beginPath();

    const poly = (n, rotate) => {
      for (let i = 0; i < n; i++) {
        const a = rotate + (i / n) * Math.PI * 2;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    };

    switch (shape) {
      case 'circle': ctx.arc(cx, cy, r, 0, Math.PI * 2); break;
      case 'diamond': poly(4, -Math.PI / 2); break;
      case 'square': ctx.rect(cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72); break;
      case 'triangle': poly(3, -Math.PI / 2); break;
      case 'hexagon': poly(6, -Math.PI / 2); break;
      default: {
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
          const rad = i % 2 === 0 ? r : r * 0.46;
          const px = cx + Math.cos(a) * rad;
          const py = cy + Math.sin(a) * rad;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.restore();

    // Specials are marked so you can see what you built.
    if (gem.kind === CHARGED) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.7, cy);
      ctx.lineTo(cx + r * 0.7, cy);
      ctx.moveTo(cx, cy - r * 0.7);
      ctx.lineTo(cx, cy + r * 0.7);
      ctx.stroke();
      ctx.restore();
    } else if (gem.kind === PRISM) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #drawPanel(ctx) {
    const barW = W - PANEL_X - 22;

    this.text(ctx, `LEVEL ${this.level}`, PANEL_X, BOARD_Y + 2, {
      size: 13, color: '#c084fc', align: 'left', glow: 8,
    });

    /* --- progress toward the target --- */
    const progress = Math.min(1, this.levelScore / this.target);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.roundRect(ctx, PANEL_X, BOARD_Y + 22, barW, 8, 4).fill();
    ctx.fillStyle = progress >= 1 ? '#4ade80' : '#c084fc';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    this.roundRect(ctx, PANEL_X, BOARD_Y + 22, Math.max(3, barW * progress), 8, 4).fill();
    ctx.restore();
    this.text(ctx, `${this.levelScore} / ${this.target}`, PANEL_X, BOARD_Y + 46, {
      size: 11, color: '#8b93a7', align: 'left',
    });

    /* --- moves --- */
    this.text(ctx, 'MOVES', PANEL_X, BOARD_Y + 84, { size: 10, color: '#5c6478', align: 'left' });
    this.text(ctx, String(this.movesLeft), PANEL_X, BOARD_Y + 112, {
      size: 32, color: this.movesLeft <= 5 ? '#fb7185' : '#e9edf6', align: 'left',
      glow: this.movesLeft <= 5 ? 12 : 0,
    });

    if (this.chain > 1) {
      this.text(ctx, `CHAIN x${this.chain}`, PANEL_X, BOARD_Y + 156, {
        size: 14, color: '#fbbf24', align: 'left', glow: 10,
      });
    }

    /* --- what the specials do --- */
    const legend = (y, kind, label) => {
      const cx = PANEL_X + 12;
      ctx.save();
      ctx.fillStyle = '#c084fc';
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(cx, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (kind === CHARGED) {
        ctx.moveTo(cx - 6, y);
        ctx.lineTo(cx + 6, y);
        ctx.moveTo(cx, y - 6);
        ctx.lineTo(cx, y + 6);
      } else {
        ctx.arc(cx, y, 4.5, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
      this.text(ctx, label, PANEL_X + 28, y, { size: 9.5, color: '#5c6478', align: 'left', weight: 500 });
    };

    legend(BOARD_Y + 216, CHARGED, 'Four: clears a row');
    legend(BOARD_Y + 248, PRISM, 'Five: clears a colour');
  }
}
