import { BaseGame } from '../core/game.js';

/**
 * TIC TAC TOE
 *
 * Solved game, so a perfect opponent can never lose and the honest version of
 * this is unplayable. The interesting design question is therefore how the
 * machine should be imperfect, and the answer here is *rarely, and by a
 * decision rather than by a wobble*: it searches the whole tree with minimax
 * and plays the best move, except with some probability it deliberately picks
 * a lesser one. That probability shrinks every match, so a run is a ladder —
 * early matches are winnable, and by match five you are drawing at best.
 *
 * A match is first to three. Losing a match costs a life.
 */

const W = 520;
const H = 560;

const CELL = 132;
const BOARD = CELL * 3;
const BOARD_X = (W - BOARD) / 2;
const BOARD_Y = 108;

const HUMAN = 1;
const AI = 2;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6], // diagonals
];

const WIN_TARGET = 3; // games needed to take a match

export default class TicTacToe extends BaseGame {
  static id = 'tictactoe';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Match' };

  setup() {
    this.host.setSecondaryLabel('Match');
    this.host.setHint('Click a square · first to three takes the match',
      'Tap a square · first to three takes the match');
    this.setLives(3);

    this.match = 1;
    this.matchesWon = 0;
    this.#startMatch();
    this.banner('Your move');
    this.play('ready');
  }

  #startMatch() {
    this.wins = 0;
    this.losses = 0;
    this.draws = 0;
    this.host.setSecondary(`${this.match}`);
    // The opponent errs less with every match; by five it plays perfectly.
    this.mistakeChance = Math.max(0, 0.42 - (this.match - 1) * 0.11);
    this.#newGame(HUMAN);
  }

  #newGame(starter) {
    this.cells = Array(9).fill(0);
    this.turn = starter;
    this.winningLine = null;
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = starter === AI ? 0.6 : 0;
    this.placed = new Map(); // index -> age, for the pop-in animation
  }

  /* ================================================================= rules */

  static #winnerOf(cells) {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
        return { player: cells[a], line };
      }
    }
    return cells.every(Boolean) ? { player: 0, line: null } : null;
  }

  /**
   * Full minimax — the tree is only a few hundred thousand nodes at worst and
   * memoisation is not worth the lines. Depth is folded into the score so the
   * machine prefers winning sooner and losing later, which is what stops it
   * making moves that look idle when it is already beaten.
   */
  static #minimax(cells, player, depth) {
    const outcome = TicTacToe.#winnerOf(cells);
    if (outcome) {
      if (outcome.player === AI) return 10 - depth;
      if (outcome.player === HUMAN) return depth - 10;
      return 0;
    }

    const scores = [];
    for (let i = 0; i < 9; i++) {
      if (cells[i]) continue;
      cells[i] = player;
      scores.push(TicTacToe.#minimax(cells, player === AI ? HUMAN : AI, depth + 1));
      cells[i] = 0;
    }
    return player === AI ? Math.max(...scores) : Math.min(...scores);
  }

  #chooseMove() {
    const moves = [];
    for (let i = 0; i < 9; i++) {
      if (this.cells[i]) continue;
      this.cells[i] = AI;
      moves.push({ index: i, score: TicTacToe.#minimax(this.cells, HUMAN, 0) });
      this.cells[i] = 0;
    }
    if (!moves.length) return -1;

    moves.sort((a, b) => b.score - a.score);
    const best = moves[0].score;

    // The deliberate error: take a move that is not the best one available.
    if (this.random() < this.mistakeChance) {
      const weaker = moves.filter((m) => m.score < best);
      if (weaker.length) return weaker[Math.floor(this.random() * weaker.length)].index;
    }

    const equal = moves.filter((m) => m.score === best);
    return equal[Math.floor(this.random() * equal.length)].index;
  }

  /* =============================================================== playing */

  #place(index, player) {
    this.cells[index] = player;
    this.placed.set(index, 0);
    this.play(player === HUMAN ? 'select' : 'blip');

    const outcome = TicTacToe.#winnerOf(this.cells);
    if (outcome) {
      this.winningLine = outcome.line;
      this.#finishGame(outcome.player);
      return;
    }
    this.turn = player === HUMAN ? AI : HUMAN;
    if (this.turn === AI) this.aiTimer = 0.35 + this.random() * 0.3;
  }

  #finishGame(winner) {
    this.result = winner;
    this.settleTimer = 1.5;

    if (winner === HUMAN) {
      this.wins++;
      this.addScore(400 + this.match * 150);
      this.banner('You win');
      this.play('powerup');
      this.shake.add(4);
    } else if (winner === AI) {
      this.losses++;
      this.banner('Lost that one');
      this.play('die');
      this.shake.add(6);
    } else {
      this.draws++;
      this.addScore(80);
      this.banner('Draw');
      this.play('back');
    }
    this.meta = { match: this.match, matches: this.matchesWon };
  }

  #afterGame() {
    if (this.wins >= WIN_TARGET) {
      this.matchesWon++;
      this.match++;
      this.addScore(2000 + this.matchesWon * 500);
      this.banner(`Match ${this.matchesWon}`);
      this.play('highscore');
      this.meta = { match: this.match, matches: this.matchesWon };
      this.#startMatch();
      return;
    }

    if (this.losses >= WIN_TARGET) {
      const lives = this.lives - 1;
      this.setLives(Math.max(0, lives));
      this.play('gameover');
      if (lives <= 0) {
        this.meta = { match: this.match, matches: this.matchesWon };
        this.end();
        return;
      }
      this.banner('Match lost');
      this.#startMatch();
      return;
    }

    // Alternate who opens, which is the only fairness lever the game has.
    this.#newGame((this.wins + this.losses + this.draws) % 2 === 0 ? HUMAN : AI);
  }

  /* ================================================================ update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    for (const [index, age] of this.placed) this.placed.set(index, age + dt);

    if (this.result !== null) {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.#afterGame();
      return;
    }

    if (this.turn === AI) {
      // A beat before it answers, so a move does not feel like a reflex.
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        const move = this.#chooseMove();
        if (move >= 0) this.#place(move, AI);
      }
      return;
    }

    const m = this.mouse;
    if (!m.pressed) return;
    const col = Math.floor((m.x - BOARD_X) / CELL);
    const row = Math.floor((m.y - BOARD_Y) / CELL);
    if (col < 0 || col > 2 || row < 0 || row > 2) return;
    const index = row * 3 + col;
    if (this.cells[index]) {
      this.play('hit');
      return;
    }
    this.#place(index, HUMAN);
  }

  /* ================================================================== draw */

  draw(ctx) {
    this.clear(ctx, '#070910');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawSeries(ctx);
    this.#drawGrid(ctx);

    for (let i = 0; i < 9; i++) {
      if (!this.cells[i]) continue;
      const age = this.placed.get(i) ?? 1;
      const pop = Math.min(1, age / 0.16);
      this.#drawMark(ctx, i, this.cells[i], easeOut(pop));
    }

    if (this.winningLine) this.#drawStrike(ctx);
    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawSeries(ctx) {
    this.text(ctx, `MATCH ${this.match}`, W / 2, 30, { size: 12, color: '#8b93a7' });

    // Three pips a side: the first to fill them takes the match.
    const pip = (x, y, filled, color) => {
      ctx.save();
      if (filled) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
      }
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    for (let i = 0; i < WIN_TARGET; i++) {
      pip(W / 2 - 96 + i * 22, 62, i < this.wins, '#22d3ee');
      pip(W / 2 + 52 + i * 22, 62, i < this.losses, '#fb7185');
    }
    this.text(ctx, 'YOU', W / 2 - 118, 62, { size: 10, color: '#22d3ee', align: 'right' });
    this.text(ctx, 'CPU', W / 2 + 140, 62, { size: 10, color: '#fb7185', align: 'left' });
  }

  #drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(BOARD_X + i * CELL, BOARD_Y + 10);
      ctx.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD - 10);
      ctx.moveTo(BOARD_X + 10, BOARD_Y + i * CELL);
      ctx.lineTo(BOARD_X + BOARD - 10, BOARD_Y + i * CELL);
    }
    ctx.stroke();
    ctx.restore();

    // A hint of where the pointer is, but only where a move is legal.
    const m = this.mouse;
    if (this.turn !== HUMAN || this.result !== null || !m.active) return;
    const col = Math.floor((m.x - BOARD_X) / CELL);
    const row = Math.floor((m.y - BOARD_Y) / CELL);
    if (col < 0 || col > 2 || row < 0 || row > 2) return;
    if (this.cells[row * 3 + col]) return;
    ctx.save();
    ctx.fillStyle = 'rgba(34,211,238,0.07)';
    this.roundRect(ctx, BOARD_X + col * CELL + 6, BOARD_Y + row * CELL + 6, CELL - 12, CELL - 12, 10).fill();
    ctx.restore();
  }

  #drawMark(ctx, index, player, scale) {
    const cx = BOARD_X + (index % 3) * CELL + CELL / 2;
    const cy = BOARD_Y + Math.floor(index / 3) * CELL + CELL / 2;
    const r = CELL * 0.28 * scale;
    const color = player === HUMAN ? '#22d3ee' : '#fb7185';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();

    if (player === HUMAN) {
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
    } else {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawStrike(ctx) {
    const [a, , c] = this.winningLine;
    const point = (i) => [
      BOARD_X + (i % 3) * CELL + CELL / 2,
      BOARD_Y + Math.floor(i / 3) * CELL + CELL / 2,
    ];
    const [x1, y1] = point(a);
    const [x2, y2] = point(c);
    // Grow the strike out from the first cell over the settle beat.
    const t = Math.min(1, (1.5 - this.settleTimer) / 0.32);

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = this.result === HUMAN ? '#22d3ee' : '#fb7185';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + (x2 - x1) * easeOut(t), y1 + (y2 - y1) * easeOut(t));
    ctx.stroke();
    ctx.restore();
  }
}

const easeOut = (t) => 1 - (1 - t) ** 3;
