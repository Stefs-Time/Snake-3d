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

/** Cached sprites render at 2x so the scaled canvas stays crisp on phones. */
const SPRITE_SCALE = 2;
const PLATE_PAD = 12;

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

    // The plates and the well are sized to the cell, so both bake per build.
    this.plates = { home: this.#makePlate(true), away: this.#makePlate(false) };
    this.backdrop = this.#makeBackdrop();

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

    // A tile arriving home gets a quiet green spark — progress you can see.
    if (this.tiles[moved] === moved + 1) {
      const [x, y] = this.#cellXY(moved);
      this.particles.emit(x + this.cell / 2, y + this.cell / 2, {
        count: 6, speed: 60, color: '#4ade80', life: 0.35, size: 2.2,
      });
    }

    if (this.#isSolved()) this.#solve();
    return true;
  }

  #solve() {
    this.solved = true;
    // Fewer moves and less time both pay; bigger boards pay much more.
    const par = this.n * this.n * 6;
    const efficiency = Math.max(0, par - this.moves) * 12;
    const speed = Math.max(0, 200 - Math.round(this.elapsed)) * 6;
    const points = 500 * (this.n - 2) + efficiency + speed;
    this.addScore(points, {
      x: this.boardX + this.boardW / 2,
      y: this.boardY + this.boardW / 2,
      color: '#4ade80',
    });
    this.banner('Solved!');
    this.play('highscore');
    this.shake.add(4);

    // A shower from every tile, staggered down the rows.
    for (let i = 0; i < this.n * this.n; i++) {
      if (!this.tiles[i]) continue;
      const [x, y] = this.#cellXY(i);
      this.particles.emit(x + this.cell / 2, y + this.cell / 2, {
        count: 4, speed: 120, color: i % 2 ? '#4ade80' : '#a3e635',
        life: 0.7, size: 2.6, gravity: 180,
      });
    }

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

    ctx.drawImage(this.backdrop, 0, 0, W, H);

    /* --- readouts above the board --- */
    this.text(ctx, String(this.moves), this.boardX + 2, 46, {
      size: 24, color: '#a3e635', align: 'left', glow: 8,
    });
    this.text(ctx,
      `${Math.floor(this.elapsed / 60)}:${String(Math.floor(this.elapsed % 60)).padStart(2, '0')}`,
      this.boardX + this.boardW - 2, 46, { size: 24, color: '#e9edf6', align: 'right' });
    this.text(ctx, `${this.n}×${this.n} · PUZZLE ${this.puzzleNo}`, W / 2, 46, {
      size: 11, color: '#5c6478',
    });

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
    const plate = home ? this.plates.home : this.plates.away;
    ctx.drawImage(
      plate,
      x - PLATE_PAD, y - PLATE_PAD,
      this.cell + PLATE_PAD * 2, this.cell + PLATE_PAD * 2,
    );
    this.text(ctx, String(value), x + this.cell / 2, y + this.cell / 2 + 1, {
      size: Math.round(this.cell * (value > 9 ? 0.34 : 0.4)),
      color: home ? '#a7f3c4' : '#e9edf6',
    });
  }

  /** One tile plate per state, bevel and glow baked — draw() stays flat. */
  #makePlate(home) {
    const s = SPRITE_SCALE;
    const span = this.cell + PLATE_PAD * 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = span * s;
    const g = canvas.getContext('2d');
    g.scale(s, s);

    const pad = PLATE_PAD + 4;
    const size = span - pad * 2;

    g.fillStyle = home ? '#14351f' : '#1a2333';
    g.shadowColor = home ? '#4ade80' : '#38bdf8';
    g.shadowBlur = home ? 14 : 8;
    this.roundRect(g, pad, pad, size, size, 9).fill();
    g.shadowBlur = 0;

    // Top light, bottom shade — the tile reads as a physical piece.
    const bevel = g.createLinearGradient(0, pad, 0, pad + size);
    bevel.addColorStop(0, 'rgba(255,255,255,0.14)');
    bevel.addColorStop(0.4, 'rgba(255,255,255,0.02)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = bevel;
    this.roundRect(g, pad, pad, size, size, 9).fill();

    g.strokeStyle = home ? 'rgba(74,222,128,0.55)' : 'rgba(56,189,248,0.3)';
    g.lineWidth = 1.5;
    this.roundRect(g, pad, pad, size, size, 9).stroke();

    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    this.roundRect(g, pad + 2, pad + 2, size - 4, size - 4, 7).stroke();
    return canvas;
  }

  /** Every static pixel — wash, framed well, empty sockets — baked per size. */
  #makeBackdrop() {
    const s = SPRITE_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = W * s;
    canvas.height = H * s;
    const g = canvas.getContext('2d');
    g.scale(s, s);

    g.fillStyle = '#070910';
    g.fillRect(0, 0, W, H);
    const wash = g.createRadialGradient(
      W / 2, this.boardY + this.boardW / 2, this.boardW * 0.2,
      W / 2, this.boardY + this.boardW / 2, this.boardW,
    );
    wash.addColorStop(0, 'rgba(56,189,248,0.06)');
    wash.addColorStop(1, 'rgba(56,189,248,0)');
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 26; x < W; x += 26) {
      for (let y = 26; y < H; y += 26) g.fillRect(x - 1, y - 1, 2, 2);
    }

    /* --- the board well --- */
    const bx = this.boardX;
    const by = this.boardY;
    const bw = this.boardW;
    const deep = g.createLinearGradient(0, by, 0, by + bw);
    deep.addColorStop(0, 'rgba(0,0,0,0.4)');
    deep.addColorStop(1, 'rgba(0,0,0,0.15)');
    g.fillStyle = 'rgba(255,255,255,0.03)';
    this.roundRect(g, bx - 10, by - 10, bw + 20, bw + 20, 14).fill();
    g.fillStyle = deep;
    this.roundRect(g, bx - 6, by - 6, bw + 12, bw + 12, 12).fill();

    g.strokeStyle = 'rgba(56,189,248,0.3)';
    g.shadowColor = '#38bdf8';
    g.shadowBlur = 12;
    g.lineWidth = 1.5;
    this.roundRect(g, bx - 10.5, by - 10.5, bw + 21, bw + 21, 14).stroke();
    g.shadowBlur = 0;

    // Sockets where the tiles sit, so the gap reads as a hole, not a glitch.
    for (let r = 0; r < this.n; r++) {
      for (let c = 0; c < this.n; c++) {
        const x = bx + c * this.cell + 4;
        const y = by + r * this.cell + 4;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        this.roundRect(g, x, y, this.cell - 8, this.cell - 8, 9).fill();
        g.strokeStyle = 'rgba(255,255,255,0.04)';
        g.lineWidth = 1;
        this.roundRect(g, x + 0.5, y + 0.5, this.cell - 9, this.cell - 9, 9).stroke();
      }
    }

    /* --- readout labels --- */
    this.text(g, 'MOVES', bx + 2, 24, { size: 10, color: '#5c6478', align: 'left' });
    this.text(g, 'TIME', bx + bw - 2, 24, { size: 10, color: '#5c6478', align: 'right' });
    return canvas;
  }
}

const easeOut = (t) => 1 - (1 - t) ** 3;
