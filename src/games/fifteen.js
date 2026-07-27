import { BaseGame } from '../core/game.js';

/**
 * FIFTEEN
 *
 * The sliding tile puzzle. Only half of all tile arrangements are reachable —
 * the other half are the ones Sam Loyd offered a thousand dollars for in 1880,
 * safe in the knowledge that they cannot be solved. Rather than compute the
 * parity, the shuffle simply makes a few hundred legal moves from the solved
 * state, which cannot leave the reachable half.
 *
 * The scramble also avoids immediately undoing itself, so it does not walk in
 * circles and hand you a board that is three moves from done.
 */

const W = 520;
const H = 580;
const BOARD_TOP = 84;

const SIZES = { 3: 3, 4: 4, 5: 5 };

export default class Fifteen extends BaseGame {
  static id = 'fifteen';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Puzzle' };

  static options = [
    {
      id: 'size',
      label: 'Size',
      default: '4',
      choices: [
        { value: '3', label: '3×3', hint: 'Eight tiles. A warm-up.' },
        { value: '4', label: '4×4', hint: 'The classic fifteen puzzle.' },
        { value: '5', label: '5×5', hint: 'Twenty-four tiles. Bring patience.' },
      ],
    },
  ];

  setup() {
    this.host.setSecondaryLabel('Puzzle');
    this.host.setHint('Click a tile next to the gap · arrows also slide',
      'Tap a tile next to the gap');
    this.setLives(1);

    this.puzzleNo = 1;
    this.breakTimer = 0;
    this.totalMoves = 0;
    this.#build(this.option('size'));
    this.banner('Order the tiles');
    this.play('ready');
  }

  onOptionChange(id, value) {
    if (id !== 'size') return false;
    this.#build(value);
    return true;
  }

  #build(sizeKey) {
    this.n = SIZES[sizeKey] ?? 4;
    this.sizeKey = sizeKey;

    const span = Math.min(W - 70, H - BOARD_TOP - 70);
    this.cell = Math.floor(span / this.n);
    this.boardW = this.cell * this.n;
    this.boardX = (W - this.boardW) / 2;
    this.boardY = BOARD_TOP;

    // Solved state: 1..n²-1 then the gap, which is 0.
    this.tiles = Array.from({ length: this.n * this.n }, (_, i) => (i + 1) % (this.n * this.n));
    this.gap = this.n * this.n - 1;
    this.#scramble();

    this.moves = 0;
    this.elapsed = 0;
    this.solved = false;
    this.sliding = null; // { index, from: [x, y], t }
    this.host.setSecondary(this.puzzleNo);
    this.meta = { puzzle: this.puzzleNo, size: `${this.n}x${this.n}` };
  }

  /** Random legal moves from solved — always reachable, never a trick board. */
  #scramble() {
    let last = -1;
    const steps = this.n * this.n * 12;
    for (let i = 0; i < steps; i++) {
      const options = this.#neighboursOf(this.gap).filter((i2) => i2 !== last);
      const pick = options[Math.floor(this.random() * options.length)];
      last = this.gap;
      this.tiles[this.gap] = this.tiles[pick];
      this.tiles[pick] = 0;
      this.gap = pick;
    }
    // Vanishingly unlikely, but a solved scramble is not a puzzle.
    if (this.#isSolved()) this.#scramble();
  }

  #neighboursOf(index) {
    const n = this.n;
    const row = (index / n) | 0;
    const col = index % n;
    const out = [];
    if (row > 0) out.push(index - n);
    if (row < n - 1) out.push(index + n);
    if (col > 0) out.push(index - 1);
    if (col < n - 1) out.push(index + 1);
    return out;
  }

  #isSolved() {
    for (let i = 0; i < this.n * this.n; i++) {
      if (this.tiles[i] !== (i + 1) % (this.n * this.n)) return false;
    }
    return true;
  }

  #slide(index) {
    if (!this.#neighboursOf(this.gap).includes(index)) return false;

    const from = this.#cellXY(index);
    this.tiles[this.gap] = this.tiles[index];
    this.tiles[index] = 0;
    const moved = this.gap;
    this.gap = index;

    // Animate from where the tile was toward where it now is.
    this.sliding = { index: moved, from, t: 0 };
    this.moves++;
    this.totalMoves++;
    this.play('blip');

    if (this.#isSolved()) this.#solve();
    return true;
  }

  #solve() {
    this.solved = true;
    // Fewer moves and less time both pay; bigger boards pay much more.
    const par = this.n * this.n * 6;
    const efficiency = Math.max(0, par - this.moves) * 12;
    const speed = Math.max(0, 200 - Math.round(this.elapsed)) * 6;
    this.addScore(500 * (this.n - 2) + efficiency + speed);
    this.banner('Solved!');
    this.play('highscore');
    this.puzzleNo++;
    this.breakTimer = 1.8;
  }

  #cellXY(index) {
    return [
      this.boardX + (index % this.n) * this.cell,
      this.boardY + ((index / this.n) | 0) * this.cell,
    ];
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.sliding) {
      this.sliding.t += dt / 0.11;
      if (this.sliding.t >= 1) this.sliding = null;
    }

    if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.#build(this.sizeKey);
      return;
    }

    this.elapsed += dt;

    // Arrows slide the tile *into* the gap, which is the direction people
    // expect: pressing left moves the tile on the gap's right leftward.
    const n = this.n;
    const row = (this.gap / n) | 0;
    const col = this.gap % n;
    if (this.input.pressed('left') && col < n - 1) this.#slide(this.gap + 1);
    else if (this.input.pressed('right') && col > 0) this.#slide(this.gap - 1);
    else if (this.input.pressed('up') && row < n - 1) this.#slide(this.gap + n);
    else if (this.input.pressed('down') && row > 0) this.#slide(this.gap - n);

    const m = this.mouse;
    if (!m.pressed) return;
    const c = Math.floor((m.x - this.boardX) / this.cell);
    const r = Math.floor((m.y - this.boardY) / this.cell);
    if (c < 0 || c >= n || r < 0 || r >= n) return;
    if (!this.#slide(r * n + c)) this.play('hit');
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#070910');
    ctx.save();
    this.shake.apply(ctx);

    this.text(ctx, `${this.moves} MOVES`, W / 2, 34, { size: 16, color: '#a3e635', glow: 8 });
    this.text(ctx, `${Math.floor(this.elapsed / 60)}:${String(Math.floor(this.elapsed % 60)).padStart(2, '0')}`,
      W / 2, 58, { size: 11, color: '#5c6478' });

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    this.roundRect(ctx, this.boardX - 8, this.boardY - 8, this.boardW + 16, this.boardW + 16, 12).fill();
    ctx.restore();

    for (let i = 0; i < this.n * this.n; i++) {
      const value = this.tiles[i];
      if (!value) continue;

      let [x, y] = this.#cellXY(i);
      if (this.sliding?.index === i) {
        // Ease from the old position to the new one.
        const t = easeOut(Math.min(1, this.sliding.t));
        x = this.sliding.from[0] + (x - this.sliding.from[0]) * t;
        y = this.sliding.from[1] + (y - this.sliding.from[1]) * t;
      }
      this.#tile(ctx, x, y, value, value === i + 1);
    }

    this.drawEffects(ctx);
    ctx.restore();
  }

  #tile(ctx, x, y, value, home) {
    const pad = 4;
    const size = this.cell - pad * 2;

    ctx.save();
    // Tiles already in their final place go green, so progress is visible.
    ctx.fillStyle = home ? '#14351f' : '#1a2333';
    ctx.shadowColor = home ? '#4ade80' : '#38bdf8';
    ctx.shadowBlur = home ? 12 : 6;
    this.roundRect(ctx, x + pad, y + pad, size, size, 9).fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = home ? 'rgba(74,222,128,0.5)' : 'rgba(56,189,248,0.25)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x + pad, y + pad, size, size, 9).stroke();
    ctx.restore();

    this.text(ctx, String(value), x + this.cell / 2, y + this.cell / 2, {
      size: Math.round(this.cell * (value > 9 ? 0.34 : 0.4)),
      color: home ? '#86efac' : '#e9edf6',
    });
  }
}

const easeOut = (t) => 1 - (1 - t) ** 3;
