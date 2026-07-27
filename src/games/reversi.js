import { BaseGame } from '../core/game.js';

/**
 * REVERSI
 *
 * Two rules and a lifetime of trouble: a move must bracket at least one of the
 * opponent's discs, and everything bracketed flips. What makes it worth an AI
 * is that disc count is a terrible guide to who is winning — the player ahead
 * in the middlegame is usually the one who will lose, because having more
 * discs means having fewer safe moves.
 *
 * So the machine scores positions, not discs: corners are worth a great deal,
 * the squares next to them are actively bad (they hand the corner over), and
 * mobility — how many legal moves each side has — is weighted heavily until
 * the endgame, when raw count finally starts to matter.
 */

const N = 8;
const CELL = 58;
const BOARD = N * CELL;

const W = BOARD + 210;
const H = BOARD + 74;
const BOARD_X = 24;
const BOARD_Y = 46;
const PANEL_X = BOARD_X + BOARD + 26;

const HUMAN = 1;
const AI = 2;

const DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Positional value per square. Corners are gold; the diagonal neighbours of a
 * corner (the "X-squares") are the worst places on the board.
 */
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

export default class Reversi extends BaseGame {
  static id = 'reversi';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 22 };
  static hudLabels = { score: 'Score', secondary: 'Game' };

  static options = [
    {
      id: 'level',
      label: 'Level',
      default: 'medium',
      choices: [
        { value: 'easy', label: 'Easy', hint: 'The machine looks one move ahead.' },
        { value: 'medium', label: 'Medium', hint: 'The machine looks three moves ahead.' },
        { value: 'hard', label: 'Hard', hint: 'The machine looks five moves ahead. Good luck.' },
      ],
    },
  ];

  setup() {
    this.host.setSecondaryLabel('Game');
    this.host.setHint('Click a marked square · bracket to flip');
    this.setLives(3);

    this.gameNo = 1;
    this.#applyLevel(this.option('level'));
    this.#newGame();
    this.banner('Reversi');
    this.play('ready');
  }

  onOptionChange(id, value) {
    if (id !== 'level') return false;
    this.#applyLevel(value);
    return true;
  }

  #applyLevel(value) {
    this.depth = value === 'easy' ? 1 : value === 'hard' ? 5 : 3;
    this.levelName = value;
  }

  #newGame() {
    this.cells = Array(N * N).fill(0);
    // The standard opening four, placed diagonally in the middle.
    this.cells[27] = this.cells[36] = HUMAN;
    this.cells[28] = this.cells[35] = AI;

    this.turn = HUMAN;
    this.flipping = []; // { index, t } — discs mid-turn
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = 0;
    this.passed = 0;
    this.host.setSecondary(this.gameNo);
    this.#refreshMoves();
  }

  /* ================================================================= rules */

  /** Discs that would flip if `player` played `index`. Empty means illegal. */
  static #gains(cells, index, player) {
    if (cells[index]) return [];
    const other = player === HUMAN ? AI : HUMAN;
    const col = index % N;
    const row = (index / N) | 0;
    const out = [];

    for (const [dx, dy] of DIRS) {
      const run = [];
      let c = col + dx;
      let r = row + dy;
      while (c >= 0 && c < N && r >= 0 && r < N && cells[r * N + c] === other) {
        run.push(r * N + c);
        c += dx;
        r += dy;
      }
      // Only counts if the run is closed off by one of your own discs.
      if (run.length && c >= 0 && c < N && r >= 0 && r < N && cells[r * N + c] === player) {
        out.push(...run);
      }
    }
    return out;
  }

  static #legalMoves(cells, player) {
    const moves = [];
    for (let i = 0; i < N * N; i++) {
      const gains = Reversi.#gains(cells, i, player);
      if (gains.length) moves.push({ index: i, gains });
    }
    return moves;
  }

  static #counts(cells) {
    let human = 0;
    let ai = 0;
    for (const v of cells) {
      if (v === HUMAN) human++;
      else if (v === AI) ai++;
    }
    return { human, ai };
  }

  #refreshMoves() {
    this.moves = Reversi.#legalMoves(this.cells, this.turn);
  }

  /* ==================================================================== ai */

  static #evaluate(cells) {
    const { human, ai } = Reversi.#counts(cells);
    const filled = human + ai;
    const endgame = filled > 52;

    let positional = 0;
    for (let i = 0; i < N * N; i++) {
      if (cells[i] === AI) positional += WEIGHTS[i];
      else if (cells[i] === HUMAN) positional -= WEIGHTS[i];
    }

    const myMoves = Reversi.#legalMoves(cells, AI).length;
    const yourMoves = Reversi.#legalMoves(cells, HUMAN).length;
    const mobility = (myMoves - yourMoves) * (endgame ? 4 : 22);

    // Disc count only becomes the point once the board is nearly full.
    const material = (ai - human) * (endgame ? 22 : 1);
    return positional + mobility + material;
  }

  static #search(cells, player, depth, alpha, beta) {
    if (depth === 0) return Reversi.#evaluate(cells);

    const moves = Reversi.#legalMoves(cells, player);
    if (!moves.length) {
      const other = player === HUMAN ? AI : HUMAN;
      // Both stuck: the game is over, so score it as it stands.
      if (!Reversi.#legalMoves(cells, other).length) return Reversi.#evaluate(cells);
      return Reversi.#search(cells, other, depth - 1, alpha, beta);
    }

    // Corners first — the strongest moves, so pruning cuts sooner.
    moves.sort((a, b) => WEIGHTS[b.index] - WEIGHTS[a.index]);
    const maximising = player === AI;
    let best = maximising ? -Infinity : Infinity;

    for (const move of moves) {
      const snapshot = cells.slice();
      cells[move.index] = player;
      for (const g of move.gains) cells[g] = player;

      const value = Reversi.#search(cells, player === HUMAN ? AI : HUMAN, depth - 1, alpha, beta);
      for (let i = 0; i < snapshot.length; i++) cells[i] = snapshot[i];

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

  #chooseMove() {
    const moves = this.moves;
    if (!moves.length) return null;

    let bestValue = -Infinity;
    let choices = [];
    for (const move of moves) {
      const snapshot = this.cells.slice();
      this.cells[move.index] = AI;
      for (const g of move.gains) this.cells[g] = AI;
      const value = Reversi.#search(this.cells, HUMAN, this.depth - 1, -Infinity, Infinity);
      this.cells = snapshot;

      if (value > bestValue) {
        bestValue = value;
        choices = [move];
      } else if (value === bestValue) {
        choices.push(move);
      }
    }
    return choices[Math.floor(this.random() * choices.length)];
  }

  /* =============================================================== playing */

  #apply(move, player) {
    this.cells[move.index] = player;
    for (const g of move.gains) {
      this.cells[g] = player;
      this.flipping.push({ index: g, t: 0 });
    }
    this.flipping.push({ index: move.index, t: 0 });
    this.play(player === HUMAN ? 'select' : 'blip');
    if (move.gains.length > 3) this.shake.add(3);

    this.turn = player === HUMAN ? AI : HUMAN;
    this.#refreshMoves();

    if (!this.moves.length) {
      this.passed++;
      // Two passes in a row and nobody can move: the game is done.
      if (this.passed >= 2) {
        this.#finish();
        return;
      }
      this.banner('No move — pass');
      this.turn = this.turn === HUMAN ? AI : HUMAN;
      this.#refreshMoves();
      if (!this.moves.length) this.#finish();
    } else {
      this.passed = 0;
    }

    if (this.turn === AI && this.result === null) this.aiTimer = 0.45;
  }

  #finish() {
    const { human, ai } = Reversi.#counts(this.cells);
    this.result = human > ai ? HUMAN : ai > human ? AI : 0;
    this.settleTimer = 2.4;
    this.meta = { game: this.gameNo, level: this.levelName, discs: `${human}-${ai}` };

    if (this.result === HUMAN) {
      // The margin is the interesting number, so it is what pays.
      this.addScore(600 + (human - ai) * 60 + this.depth * 200);
      this.banner(`You win ${human}-${ai}`);
      this.play('highscore');
    } else if (this.result === AI) {
      this.banner(`Lost ${ai}-${human}`);
      this.play('die');
    } else {
      this.addScore(300);
      this.banner('Drawn');
      this.play('back');
    }
  }

  #afterGame() {
    if (this.result === AI) {
      const lives = this.lives - 1;
      this.setLives(Math.max(0, lives));
      if (lives <= 0) {
        this.end();
        return;
      }
    }
    this.gameNo++;
    this.#newGame();
  }

  /* ================================================================ update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    for (const f of this.flipping) f.t += dt;
    this.flipping = this.flipping.filter((f) => f.t < 0.26);

    if (this.result !== null) {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.#afterGame();
      return;
    }

    if (this.turn === AI) {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        const move = this.#chooseMove();
        if (move) this.#apply(move, AI);
        else this.#finish();
      }
      return;
    }

    const m = this.mouse;
    if (!m.pressed) return;
    const col = Math.floor((m.x - BOARD_X) / CELL);
    const row = Math.floor((m.y - BOARD_Y) / CELL);
    if (col < 0 || col >= N || row < 0 || row >= N) return;

    const move = this.moves.find((mv) => mv.index === row * N + col);
    if (!move) {
      this.play('hit');
      return;
    }
    this.#apply(move, HUMAN);
  }

  /* ================================================================== draw */

  draw(ctx) {
    this.clear(ctx, '#05100c');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawBoard(ctx);
    this.#drawDiscs(ctx);
    this.#drawHints(ctx);
    this.#drawPanel(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawBoard(ctx) {
    ctx.save();
    ctx.fillStyle = '#0c2b1e';
    this.roundRect(ctx, BOARD_X - 8, BOARD_Y - 8, BOARD + 16, BOARD + 16, 10).fill();
    ctx.strokeStyle = 'rgba(74,222,128,0.3)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, BOARD_X - 8, BOARD_Y - 8, BOARD + 16, BOARD + 16, 10).stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      ctx.moveTo(BOARD_X + i * CELL, BOARD_Y);
      ctx.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD);
      ctx.moveTo(BOARD_X, BOARD_Y + i * CELL);
      ctx.lineTo(BOARD_X + BOARD, BOARD_Y + i * CELL);
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawDiscs(ctx) {
    for (let i = 0; i < N * N; i++) {
      const player = this.cells[i];
      if (!player) continue;
      const x = BOARD_X + (i % N) * CELL + CELL / 2;
      const y = BOARD_Y + ((i / N) | 0) * CELL + CELL / 2;

      // A flip is a horizontal squash; the colour changes at the midpoint.
      const flip = this.flipping.find((f) => f.index === i);
      const t = flip ? Math.min(1, flip.t / 0.26) : 1;
      const squash = flip ? Math.abs(Math.cos(t * Math.PI)) : 1;
      const color = player === HUMAN ? '#e9edf6' : '#1f2937';
      const rim = player === HUMAN ? '#38bdf8' : '#fb7185';

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.max(0.06, squash), 1);
      ctx.shadowColor = rim;
      ctx.shadowBlur = 10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rim;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Legal moves as faint rings, so the rules teach themselves. */
  #drawHints(ctx) {
    if (this.turn !== HUMAN || this.result !== null) return;
    const pulse = 0.35 + Math.abs(Math.sin(performance.now() / 420)) * 0.3;

    for (const move of this.moves) {
      const x = BOARD_X + (move.index % N) * CELL + CELL / 2;
      const y = BOARD_Y + ((move.index / N) | 0) * CELL + CELL / 2;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.text(ctx, String(move.gains.length), x, y, { size: 12, color: 'rgba(56,189,248,0.75)' });
    }
  }

  #drawPanel(ctx) {
    const { human, ai } = Reversi.#counts(this.cells);
    const cx = PANEL_X + 84;

    this.text(ctx, 'DISCS', cx, BOARD_Y + 6, { size: 10, color: '#5c6478' });

    const bar = (y, label, count, color, active) => {
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.55;
      this.glowCircle(ctx, PANEL_X + 16, y, 13, color, active ? 14 : 4);
      ctx.restore();
      this.text(ctx, String(count), PANEL_X + 44, y, { size: 24, color: '#e9edf6', align: 'left' });
      this.text(ctx, label, PANEL_X + 150, y, { size: 10, color: '#5c6478', align: 'right' });
    };

    bar(BOARD_Y + 46, 'YOU', human, '#e9edf6', this.turn === HUMAN && this.result === null);
    bar(BOARD_Y + 92, 'CPU', ai, '#1f2937', this.turn === AI && this.result === null);

    // Proportion bar — the shape of the game at a glance.
    const total = Math.max(1, human + ai);
    const barW = 156;
    ctx.save();
    ctx.fillStyle = '#1f2937';
    this.roundRect(ctx, PANEL_X, BOARD_Y + 122, barW, 8, 4).fill();
    ctx.fillStyle = '#e9edf6';
    this.roundRect(ctx, PANEL_X, BOARD_Y + 122, Math.max(3, (barW * human) / total), 8, 4).fill();
    ctx.restore();

    this.text(ctx, `LEVEL ${this.levelName.toUpperCase()}`, PANEL_X, BOARD_Y + 158, {
      size: 10, color: '#4ade80', align: 'left',
    });
    this.text(ctx, `DEPTH ${this.depth}`, PANEL_X, BOARD_Y + 178, {
      size: 10, color: '#5c6478', align: 'left',
    });

    if (this.result === null) {
      this.text(ctx, this.turn === HUMAN ? 'YOUR TURN' : 'THINKING', PANEL_X, BOARD_Y + 218, {
        size: 12, color: this.turn === HUMAN ? '#38bdf8' : '#8b93a7', align: 'left', glow: 8,
      });
      this.text(ctx, `${this.moves.length} legal moves`, PANEL_X, BOARD_Y + 240, {
        size: 10, color: '#5c6478', align: 'left',
      });
    }
  }
}
