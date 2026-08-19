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
    this.host.setHint('Click a marked square · bracket to flip',
      'Tap a marked square · bracket to flip');
    this.setLives(3);

    this.gameNo = 1;
    this.#buildBoardLayer();
    this.#buildSprites();
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
    this.flipping = []; // { index, t, from, place } — discs mid-turn
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = 0;
    this.passed = 0;
    this.lastIndex = -1;
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
    // A real move breaks any run of passes.
    this.passed = 0;
    const other = player === HUMAN ? AI : HUMAN;
    const col0 = move.index % N;
    const row0 = (move.index / N) | 0;

    this.cells[move.index] = player;
    for (const g of move.gains) {
      this.cells[g] = player;
      // Flips ripple outward from the placed disc rather than all at once.
      const dist = Math.max(Math.abs((g % N) - col0), Math.abs(((g / N) | 0) - row0));
      this.flipping.push({ index: g, t: -dist * 0.045, from: other, place: false });
    }
    this.flipping.push({ index: move.index, t: 0, from: player, place: true });
    this.lastIndex = move.index;
    this.play(player === HUMAN ? 'select' : 'blip');
    if (move.gains.length > 3) this.shake.add(3);
    if (move.gains.length >= 5) {
      const x = BOARD_X + col0 * CELL + CELL / 2;
      const y = BOARD_Y + row0 * CELL + CELL / 2;
      this.particles.emit(x, y, {
        count: 16, speed: 150, color: player === HUMAN ? '#38bdf8' : '#fb7185', life: 0.55, size: 2.6, shape: 'circle',
      });
    }
    if (player === HUMAN && move.gains.length > 1) {
      this.popups.add(BOARD_X + col0 * CELL + CELL / 2, BOARD_Y + row0 * CELL + 6, `+${move.gains.length}`, '#38bdf8', 12);
    }

    this.turn = other;
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
      this.particles.emit(BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2, {
        count: 40, speed: 250, color: '#38bdf8', life: 0.9, size: 3, shape: 'circle',
      });
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

  /** The felt never changes, so it is painted once and blitted per frame. */
  #buildBoardLayer() {
    const scale = 2;
    const layer = document.createElement('canvas');
    layer.width = W * scale;
    layer.height = H * scale;
    const c = layer.getContext('2d');
    c.scale(scale, scale);

    const rim = c.createLinearGradient(0, BOARD_Y - 8, 0, BOARD_Y + BOARD + 8);
    rim.addColorStop(0, '#123726');
    rim.addColorStop(1, '#081f14');
    c.fillStyle = rim;
    this.roundRect(c, BOARD_X - 8, BOARD_Y - 8, BOARD + 16, BOARD + 16, 10).fill();
    c.strokeStyle = 'rgba(74,222,128,0.3)';
    c.lineWidth = 1.5;
    this.roundRect(c, BOARD_X - 8, BOARD_Y - 8, BOARD + 16, BOARD + 16, 10).stroke();

    // The felt itself, lit from the top-left the way the discs are.
    const felt = c.createRadialGradient(
      BOARD_X + BOARD * 0.35, BOARD_Y + BOARD * 0.3, BOARD * 0.1,
      BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2, BOARD * 0.85,
    );
    felt.addColorStop(0, '#0e3323');
    felt.addColorStop(1, '#092117');
    c.fillStyle = felt;
    c.fillRect(BOARD_X, BOARD_Y, BOARD, BOARD);

    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < N; i++) {
      c.moveTo(BOARD_X + i * CELL, BOARD_Y);
      c.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD);
      c.moveTo(BOARD_X, BOARD_Y + i * CELL);
      c.lineTo(BOARD_X + BOARD, BOARD_Y + i * CELL);
    }
    c.stroke();

    // Star points, as on a go board — they mark the corner-adjacent danger zone.
    c.fillStyle = 'rgba(74,222,128,0.35)';
    for (const [sr, sc] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
      c.beginPath();
      c.arc(BOARD_X + sc * CELL, BOARD_Y + sr * CELL, 2.5, 0, Math.PI * 2);
      c.fill();
    }

    c.font = '600 9px ui-monospace, monospace';
    c.fillStyle = 'rgba(134,239,172,0.35)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      c.fillText(String.fromCharCode(97 + i), BOARD_X + i * CELL + CELL / 2, BOARD_Y + BOARD + 13);
      c.fillText(String(i + 1), BOARD_X - 13, BOARD_Y + i * CELL + CELL / 2);
    }

    this.boardLayer = layer;
  }

  #buildSprites() {
    const make = (human) => {
      const scale = 3;
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = CELL * scale;
      const c = cnv.getContext('2d');
      c.scale(scale, scale);
      const cx = CELL / 2;
      const cy = CELL / 2;
      const r = CELL * 0.38;
      const rim = human ? '#38bdf8' : '#fb7185';

      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.beginPath();
      c.ellipse(cx, cy + r * 0.12, r * 1.0, r * 0.9, 0, 0, Math.PI * 2);
      c.fill();

      const body = c.createRadialGradient(cx - r * 0.35, cy - r * 0.42, r * 0.15, cx, cy, r * 1.05);
      if (human) {
        body.addColorStop(0, '#ffffff');
        body.addColorStop(0.55, '#dde6f5');
        body.addColorStop(1, '#93a8cc');
      } else {
        body.addColorStop(0, '#46536b');
        body.addColorStop(0.55, '#27324a');
        body.addColorStop(1, '#111726');
      }
      c.save();
      c.shadowColor = rim;
      c.shadowBlur = 7;
      c.fillStyle = body;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
      c.restore();

      c.strokeStyle = rim;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();

      const dome = c.createRadialGradient(cx - r * 0.3, cy - r * 0.42, 0, cx - r * 0.3, cy - r * 0.42, r * 0.8);
      dome.addColorStop(0, human ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)');
      dome.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = dome;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();

      return cnv;
    };
    this.discSprites = { [HUMAN]: make(true), [AI]: make(false) };
  }

  #drawBoard(ctx) {
    ctx.drawImage(this.boardLayer, 0, 0, W, H);
  }

  #drawDiscs(ctx) {
    for (let i = 0; i < N * N; i++) {
      const player = this.cells[i];
      if (!player) continue;
      const x = BOARD_X + (i % N) * CELL;
      const y = BOARD_Y + ((i / N) | 0) * CELL;

      const flip = this.flipping.find((f) => f.index === i);
      if (!flip) {
        ctx.drawImage(this.discSprites[player], x, y, CELL, CELL);
        continue;
      }

      if (flip.place) {
        // The new disc pops in.
        const t = Math.min(1, Math.max(0, flip.t) / 0.2);
        const s = CELL * (0.5 + 0.5 * (1 - (1 - t) ** 3));
        ctx.drawImage(this.discSprites[player], x + (CELL - s) / 2, y + (CELL - s) / 2, s, s);
        continue;
      }

      // A flip is a horizontal squash; the colour changes at the midpoint.
      const t = Math.min(1, Math.max(0, flip.t) / 0.26);
      const squash = Math.max(0.06, Math.abs(Math.cos(t * Math.PI)));
      const face = t < 0.5 ? flip.from : player;
      const w = CELL * squash;
      ctx.drawImage(this.discSprites[face], x + (CELL - w) / 2, y, w, CELL);
    }

    if (this.lastIndex >= 0 && this.cells[this.lastIndex]) {
      const x = BOARD_X + (this.lastIndex % N) * CELL + CELL / 2;
      const y = BOARD_Y + ((this.lastIndex / N) | 0) * CELL + CELL / 2;
      ctx.save();
      ctx.strokeStyle = '#ffd23f';
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
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

    const bar = (y, label, count, player, active) => {
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.55;
      if (active) {
        ctx.strokeStyle = player === HUMAN ? '#38bdf8' : '#fb7185';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(PANEL_X + 16, y, 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      const s = 36;
      ctx.drawImage(this.discSprites[player], PANEL_X + 16 - s / 2, y - s / 2, s, s);
      ctx.restore();
      this.text(ctx, String(count), PANEL_X + 44, y, { size: 24, color: '#e9edf6', align: 'left' });
      this.text(ctx, label, PANEL_X + 150, y, { size: 10, color: '#5c6478', align: 'right' });
    };

    bar(BOARD_Y + 46, 'YOU', human, HUMAN, this.turn === HUMAN && this.result === null);
    bar(BOARD_Y + 92, 'CPU', ai, AI, this.turn === AI && this.result === null);

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
