import { BaseGame } from '../core/game.js';

/**
 * SUDOKU
 *
 * Puzzles are generated, not shipped. Two steps: fill an empty grid by
 * backtracking with the candidates shuffled, which yields a random complete
 * solution; then dig holes out of it, and after each hole check that the
 * puzzle still has exactly one solution — put the digit back if it does not.
 *
 * That uniqueness check is what separates a Sudoku from a grid of numbers. A
 * puzzle with two solutions cannot be reasoned to an answer, only guessed at,
 * and a player can always tell.
 *
 * The solver counts solutions rather than finding one, and gives up the moment
 * it sees a second, which keeps generation to a few milliseconds.
 */

const N = 9;
const CELL = 54;
const BOARD = N * CELL;

const PAD_COLS = 3;
const PAD_W = 168;

const W = BOARD + PAD_W + 62;
const H = BOARD + 54;
const BOARD_X = 24;
const BOARD_Y = 26;
const PAD_X = BOARD_X + BOARD + 30;

/** Givens per difficulty. Fewer clues is not automatically harder, but it correlates. */
const LEVELS = {
  easy: { clues: 44, multiplier: 1, label: 'Easy' },
  medium: { clues: 34, multiplier: 1.6, label: 'Medium' },
  hard: { clues: 27, multiplier: 2.4, label: 'Hard' },
};

const MISTAKE_LIMIT = 3;

export default class Sudoku extends BaseGame {
  static id = 'sudoku';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Puzzle' };

  static options = [
    {
      id: 'level',
      label: 'Level',
      default: 'easy',
      choices: [
        { value: 'easy', label: 'Easy', hint: 'Around 44 given digits.' },
        { value: 'medium', label: 'Medium', hint: 'Around 34 givens, and 1.6x the score.' },
        { value: 'hard', label: 'Hard', hint: 'Around 27 givens, and 2.4x the score.' },
      ],
    },
  ];

  setup() {
    this.host.setSecondaryLabel('Puzzle');
    this.host.setHint('Click a cell, then a number · N for notes');
    this.setLives(MISTAKE_LIMIT);

    this.puzzleNo = 1;
    this.notesMode = false;
    this.breakTimer = 0;
    this.#generate(this.option('level'));
    this.banner('Sudoku');
    this.play('ready');
  }

  /** Changing level starts a fresh puzzle, because it *is* a fresh puzzle. */
  onOptionChange(id, value) {
    if (id !== 'level') return false;
    this.#generate(value);
    this.banner(LEVELS[value].label);
    return true;
  }

  /* ============================================================ generation */

  static #candidatesFor(grid, index, value) {
    const row = (index / N) | 0;
    const col = index % N;
    for (let i = 0; i < N; i++) {
      if (grid[row * N + i] === value) return false;
      if (grid[i * N + col] === value) return false;
    }
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if (grid[r * N + c] === value) return false;
      }
    }
    return true;
  }

  /** Backtracking fill with shuffled candidates — a random complete grid. */
  #fill(grid, index = 0) {
    if (index >= N * N) return true;
    if (grid[index]) return this.#fill(grid, index + 1);

    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = digits.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [digits[i], digits[j]] = [digits[j], digits[i]];
    }

    for (const d of digits) {
      if (!Sudoku.#candidatesFor(grid, index, d)) continue;
      grid[index] = d;
      if (this.#fill(grid, index + 1)) return true;
      grid[index] = 0;
    }
    return false;
  }

  /**
   * Count solutions, stopping at `limit`. Always branching on the cell with
   * the fewest candidates keeps this fast enough to run once per dug hole.
   */
  static #countSolutions(grid, limit = 2) {
    let bestIndex = -1;
    let bestOptions = null;

    for (let i = 0; i < N * N; i++) {
      if (grid[i]) continue;
      const options = [];
      for (let d = 1; d <= 9; d++) if (Sudoku.#candidatesFor(grid, i, d)) options.push(d);
      if (!options.length) return 0; // dead end
      if (!bestOptions || options.length < bestOptions.length) {
        bestIndex = i;
        bestOptions = options;
        if (options.length === 1) break; // cannot do better than forced
      }
    }
    if (bestIndex === -1) return 1; // grid is full and legal

    let found = 0;
    for (const d of bestOptions) {
      grid[bestIndex] = d;
      found += Sudoku.#countSolutions(grid, limit - found);
      grid[bestIndex] = 0;
      if (found >= limit) break;
    }
    return found;
  }

  #generate(level) {
    this.level = level;
    this.levelDef = LEVELS[level] ?? LEVELS.easy;

    const solution = new Array(N * N).fill(0);
    this.#fill(solution);
    this.solution = solution;

    const puzzle = solution.slice();
    const order = Array.from({ length: N * N }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let remaining = N * N;
    for (const index of order) {
      if (remaining <= this.levelDef.clues) break;
      const saved = puzzle[index];
      puzzle[index] = 0;
      // Put it straight back if the puzzle stopped having one answer.
      if (Sudoku.#countSolutions(puzzle.slice(), 2) !== 1) puzzle[index] = saved;
      else remaining--;
    }

    this.given = puzzle.map((v) => v !== 0);
    this.cells = puzzle;
    this.notes = Array.from({ length: N * N }, () => new Set());
    this.selected = null;
    this.elapsed = 0;
    this.mistakes = 0;
    this.solved = false;
    this.clues = remaining;
    this.setLives(MISTAKE_LIMIT);
    this.host.setSecondary(this.puzzleNo);
    this.meta = { puzzle: this.puzzleNo, level: this.level };
  }

  /* ================================================================ rules */

  /** Cells that clash with this one, for the red highlight. */
  #conflicts(index) {
    const value = this.cells[index];
    if (!value) return false;
    const row = (index / N) | 0;
    const col = index % N;
    for (let i = 0; i < N; i++) {
      const a = row * N + i;
      const b = i * N + col;
      if (a !== index && this.cells[a] === value) return true;
      if (b !== index && this.cells[b] === value) return true;
    }
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        const i = r * N + c;
        if (i !== index && this.cells[i] === value) return true;
      }
    }
    return false;
  }

  #enter(value) {
    const index = this.selected;
    if (index == null || this.given[index]) return;

    if (this.notesMode) {
      if (this.cells[index]) return;
      const set = this.notes[index];
      // Erase in notes mode wipes the cell's pencil marks rather than
      // pencilling in a nonexistent zero.
      if (value === 0) set.clear();
      else if (set.has(value)) set.delete(value);
      else set.add(value);
      this.play('blip');
      return;
    }

    if (value === 0) {
      this.cells[index] = 0;
      this.play('back');
      return;
    }

    if (this.cells[index] === value) {
      this.cells[index] = 0;
      this.play('back');
      return;
    }

    this.cells[index] = value;
    this.notes[index].clear();

    if (value !== this.solution[index]) {
      // Wrong digits are called out immediately — hunting a mistake made
      // twenty moves ago is not a puzzle, it is a chore.
      this.mistakes++;
      this.setLives(Math.max(0, MISTAKE_LIMIT - this.mistakes));
      this.play('hit');
      this.shake.add(6);
      this.addScore(-40);
      if (this.mistakes >= MISTAKE_LIMIT) {
        this.play('gameover');
        this.breakTimer = 1.4;
        this.finished = true;
      }
      return;
    }

    // Clearing a note of this digit from the row, column and box is the
    // bookkeeping every player does by hand anyway.
    this.#pruneNotes(index, value);
    this.addScore(Math.round(25 * this.levelDef.multiplier));
    this.play('select');
    this.#checkSolved();
  }

  #pruneNotes(index, value) {
    const row = (index / N) | 0;
    const col = index % N;
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let i = 0; i < N; i++) {
      this.notes[row * N + i].delete(value);
      this.notes[i * N + col].delete(value);
    }
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) this.notes[r * N + c].delete(value);
    }
  }

  #checkSolved() {
    for (let i = 0; i < N * N; i++) if (this.cells[i] !== this.solution[i]) return;
    this.solved = true;
    const speed = Math.max(0, 900 - Math.round(this.elapsed) * 2);
    this.addScore(Math.round((1200 + speed) * this.levelDef.multiplier));
    this.banner('Solved!');
    this.play('highscore');
    this.puzzleNo++;
    this.breakTimer = 2;
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) {
        if (this.finished) this.end();
        else this.#generate(this.level);
      }
      return;
    }

    this.elapsed += dt;

    /* --- keyboard --- */
    for (let d = 1; d <= 9; d++) {
      if (this.input.keyPressed(`Digit${d}`) || this.input.keyPressed(`Numpad${d}`)) this.#enter(d);
    }
    if (this.input.keyPressed('Backspace') || this.input.keyPressed('Delete')) this.#enter(0);
    if (this.input.keyPressed('KeyN')) {
      this.notesMode = !this.notesMode;
      this.play('toggle');
    }
    if (this.selected != null) {
      const row = (this.selected / N) | 0;
      const col = this.selected % N;
      if (this.input.pressed('left')) this.selected = row * N + Math.max(0, col - 1);
      if (this.input.pressed('right')) this.selected = row * N + Math.min(N - 1, col + 1);
      if (this.input.pressed('up')) this.selected = Math.max(0, row - 1) * N + col;
      if (this.input.pressed('down')) this.selected = Math.min(N - 1, row + 1) * N + col;
    }

    /* --- pointer --- */
    const m = this.mouse;
    if (!m.pressed) return;

    const col = Math.floor((m.x - BOARD_X) / CELL);
    const row = Math.floor((m.y - BOARD_Y) / CELL);
    if (col >= 0 && col < N && row >= 0 && row < N) {
      this.selected = row * N + col;
      this.play('hover');
      return;
    }

    const pad = this.#padHit(m.x, m.y);
    if (pad !== null) this.#enter(pad);
  }

  /* =============================================================== layout */

  #padCellRect(i) {
    const size = PAD_W / PAD_COLS;
    return [
      PAD_X + (i % PAD_COLS) * size,
      BOARD_Y + 56 + Math.floor(i / PAD_COLS) * size,
      size - 6,
      size - 6,
    ];
  }

  #padHit(x, y) {
    for (let i = 0; i < 9; i++) {
      const [rx, ry, rw, rh] = this.#padCellRect(i);
      if (this.hits(x, y, rx, ry, rw, rh)) return i + 1;
    }
    const [ex, ey, ew, eh] = this.#eraseRect();
    if (this.hits(x, y, ex, ey, ew, eh)) return 0;
    const [nx, ny, nw, nh] = this.#notesRect();
    if (this.hits(x, y, nx, ny, nw, nh)) {
      this.notesMode = !this.notesMode;
      this.play('toggle');
      return null;
    }
    return null;
  }

  #eraseRect() {
    const size = PAD_W / PAD_COLS;
    return [PAD_X, BOARD_Y + 56 + 3 * size + 8, PAD_W / 2 - 5, 40];
  }

  #notesRect() {
    const size = PAD_W / PAD_COLS;
    return [PAD_X + PAD_W / 2 + 5, BOARD_Y + 56 + 3 * size + 8, PAD_W / 2 - 5, 40];
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#070a11');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawGrid(ctx);
    this.#drawNumbers(ctx);
    this.#drawPad(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawGrid(ctx) {
    const selected = this.selected;
    const selValue = selected != null ? this.cells[selected] : 0;

    for (let i = 0; i < N * N; i++) {
      const x = BOARD_X + (i % N) * CELL;
      const y = BOARD_Y + ((i / N) | 0) * CELL;

      let fill = 'rgba(255,255,255,0.022)';
      if (selected != null) {
        const sameRow = ((i / N) | 0) === ((selected / N) | 0);
        const sameCol = i % N === selected % N;
        const sameBox =
          Math.floor(((i / N) | 0) / 3) === Math.floor(((selected / N) | 0) / 3) &&
          Math.floor((i % N) / 3) === Math.floor((selected % N) / 3);
        if (sameRow || sameCol || sameBox) fill = 'rgba(56,189,248,0.06)';
        // Every cell holding the same digit lights up — the single most
        // useful piece of assistance a Sudoku can offer.
        if (selValue && this.cells[i] === selValue) fill = 'rgba(56,189,248,0.16)';
        if (i === selected) fill = 'rgba(56,189,248,0.26)';
      }

      ctx.fillStyle = fill;
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      if (i % 3 === 0) continue;
      ctx.moveTo(BOARD_X + i * CELL, BOARD_Y);
      ctx.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD);
      ctx.moveTo(BOARD_X, BOARD_Y + i * CELL);
      ctx.lineTo(BOARD_X + BOARD, BOARD_Y + i * CELL);
    }
    ctx.stroke();

    // The box borders are what make a Sudoku readable at a glance.
    ctx.strokeStyle = 'rgba(56,189,248,0.5)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= N; i += 3) {
      ctx.moveTo(BOARD_X + i * CELL, BOARD_Y);
      ctx.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD);
      ctx.moveTo(BOARD_X, BOARD_Y + i * CELL);
      ctx.lineTo(BOARD_X + BOARD, BOARD_Y + i * CELL);
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawNumbers(ctx) {
    for (let i = 0; i < N * N; i++) {
      const x = BOARD_X + (i % N) * CELL + CELL / 2;
      const y = BOARD_Y + ((i / N) | 0) * CELL + CELL / 2;
      const value = this.cells[i];

      if (!value) {
        const notes = this.notes[i];
        if (!notes.size) continue;
        for (const d of notes) {
          const nx = x + ((d - 1) % 3 - 1) * (CELL / 3.2);
          const ny = y + (Math.floor((d - 1) / 3) - 1) * (CELL / 3.2);
          this.text(ctx, String(d), nx, ny, { size: 12, color: '#5c6478', weight: 500 });
        }
        continue;
      }

      const bad = this.#conflicts(i);
      const color = bad ? '#fb7185' : this.given[i] ? '#e9edf6' : '#38bdf8';
      this.text(ctx, String(value), x, y, {
        size: 27,
        color,
        weight: this.given[i] ? 700 : 500,
        glow: bad ? 10 : 0,
      });
    }
  }

  #drawPad(ctx) {
    this.text(ctx, LEVELS[this.level].label.toUpperCase(), PAD_X, BOARD_Y + 8, {
      size: 12, color: '#38bdf8', align: 'left', glow: 8,
    });
    this.text(ctx, `${this.clues} clues`, PAD_X + PAD_W, BOARD_Y + 8, {
      size: 10, color: '#5c6478', align: 'right',
    });
    this.text(ctx, `${Math.floor(this.elapsed / 60)}:${String(Math.floor(this.elapsed % 60)).padStart(2, '0')}`,
      PAD_X, BOARD_Y + 30, { size: 14, color: '#8b93a7', align: 'left' });
    this.text(ctx, `${MISTAKE_LIMIT - this.mistakes} left`, PAD_X + PAD_W, BOARD_Y + 30, {
      size: 11, color: this.mistakes ? '#fb7185' : '#5c6478', align: 'right',
    });

    // How many of each digit are still to place — a real solving aid.
    const placed = Array(10).fill(0);
    for (const v of this.cells) if (v) placed[v]++;

    for (let i = 0; i < 9; i++) {
      const digit = i + 1;
      const [x, y, w, h] = this.#padCellRect(i);
      const done = placed[digit] >= 9;

      ctx.save();
      ctx.fillStyle = done ? 'rgba(255,255,255,0.03)' : 'rgba(56,189,248,0.10)';
      this.roundRect(ctx, x, y, w, h, 8).fill();
      ctx.strokeStyle = done ? 'rgba(255,255,255,0.06)' : 'rgba(56,189,248,0.3)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, x, y, w, h, 8).stroke();
      ctx.restore();

      this.text(ctx, String(digit), x + w / 2, y + h / 2 - 3, {
        size: 22, color: done ? '#3a4152' : '#e9edf6',
      });
      this.text(ctx, String(Math.max(0, 9 - placed[digit])), x + w / 2, y + h - 10, {
        size: 9, color: done ? '#2c3242' : '#5c6478',
      });
    }

    const chip = (rect, label, on) => {
      const [x, y, w, h] = rect;
      ctx.save();
      ctx.fillStyle = on ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.04)';
      this.roundRect(ctx, x, y, w, h, 10).fill();
      ctx.strokeStyle = on ? '#fbbf24' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, x, y, w, h, 10).stroke();
      ctx.restore();
      this.text(ctx, label, x + w / 2, y + h / 2, {
        size: 11, color: on ? '#fbbf24' : '#8b93a7',
      });
    };

    chip(this.#eraseRect(), 'ERASE', false);
    chip(this.#notesRect(), 'NOTES', this.notesMode);
  }
}
