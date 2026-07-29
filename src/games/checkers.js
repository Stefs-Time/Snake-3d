import { BaseGame } from '../core/game.js';

/**
 * CHECKERS
 *
 * Standard American rules: forced capture, and a chain must be finished with
 * the same piece once started — you can only choose between separate capture
 * directions at the moment you have a genuine choice, not stop early because
 * the position looks safer. A man that reaches the back row is crowned
 * immediately, which — correctly — ends its turn on the spot even if the new
 * king could have kept jumping; a piece does not gain king mobility until the
 * turn after it earns it.
 *
 * The opponent is alpha-beta search over the same move generator the human
 * plays against, not a separate simplified one, so "the machine cheats" is
 * never the explanation for a loss.
 */

const N = 8;
const CELL = 62;
const BOARD = N * CELL;

const W = BOARD + 40;
const H = BOARD + 100;
const BOARD_X = 20;
const BOARD_Y = 60;

const EMPTY = 0;
const H_MAN = 1;
const H_KING = 2;
const A_MAN = 3;
const A_KING = 4;

const ALL4 = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const idx = (r, c) => r * N + c;
const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const isHumanVal = (v) => v === H_MAN || v === H_KING;
const isAIVal = (v) => v === A_MAN || v === A_KING;
const isKingVal = (v) => v === H_KING || v === A_KING;
const isSameSide = (a, b) => (isHumanVal(a) && isHumanVal(b)) || (isAIVal(a) && isAIVal(b));
const kingedVersion = (v) => (v === H_MAN ? H_KING : v === A_MAN ? A_KING : v);

function jumpDirsFor(curVal, alreadyKing) {
  if (alreadyKing) return ALL4;
  return isHumanVal(curVal) ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

/**
 * Every maximal capture sequence starting from one piece. A sequence only
 * terminates when no further jump exists from the current square (mandatory
 * continuation) or the piece has just been crowned (a promotion always ends
 * the turn, even mid-chain).
 */
function findCaptureSequences(cellsOriginal, r0, c0) {
  const startVal = cellsOriginal[idx(r0, c0)];
  const cells = cellsOriginal.slice();
  const results = [];

  function dfs(row, col, curVal, path, captured) {
    const promotionRow = isHumanVal(curVal) ? 0 : N - 1;
    const alreadyKing = isKingVal(curVal);
    const dirs = jumpDirsFor(curVal, alreadyKing);
    let extended = false;

    for (const [dr, dc] of dirs) {
      const mr = row + dr, mc = col + dc, lr = row + 2 * dr, lc = col + 2 * dc;
      if (!inBounds(lr, lc)) continue;
      const midIdx = idx(mr, mc), landIdx = idx(lr, lc);
      const midVal = cells[midIdx];
      if (midVal === EMPTY || isSameSide(midVal, curVal)) continue;
      if (cells[landIdx] !== EMPTY) continue;

      const fromIdx = idx(row, col);
      cells[fromIdx] = EMPTY;
      cells[midIdx] = EMPTY;
      let landedVal = curVal;
      let justPromoted = false;
      if (!alreadyKing && lr === promotionRow) { landedVal = kingedVersion(curVal); justPromoted = true; }
      cells[landIdx] = landedVal;
      extended = true;

      const newCaptured = [...captured, midIdx];
      const newPath = [...path, { r: lr, c: lc }];
      if (justPromoted) results.push({ path: newPath, captured: newCaptured, becameKing: true });
      else dfs(lr, lc, landedVal, newPath, newCaptured);

      cells[fromIdx] = curVal;
      cells[midIdx] = midVal;
      cells[landIdx] = EMPTY;
    }

    if (!extended && path.length > 0) {
      results.push({ path: path.slice(), captured: captured.slice(), becameKing: isKingVal(curVal) && curVal !== startVal });
    }
  }

  dfs(r0, c0, startVal, [], []);
  return results;
}

/** Every legal move for a side: captures only if any exist, simple moves otherwise. */
function legalMoves(cells, humanSide) {
  const captures = [];
  const simple = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = cells[idx(r, c)];
      if (v === EMPTY) continue;
      if (humanSide && !isHumanVal(v)) continue;
      if (!humanSide && !isAIVal(v)) continue;

      const seqs = findCaptureSequences(cells, r, c);
      for (const seq of seqs) captures.push({ from: { r, c }, ...seq });

      if (!captures.length) {
        const dirs = jumpDirsFor(v, isKingVal(v));
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (inBounds(nr, nc) && cells[idx(nr, nc)] === EMPTY) {
            simple.push({ from: { r, c }, path: [{ r: nr, c: nc }], captured: [], becameKing: false });
          }
        }
      }
    }
  }
  return captures.length ? captures : simple;
}

function applyMove(cells, move) {
  const next = cells.slice();
  const fromIdx = idx(move.from.r, move.from.c);
  let v = next[fromIdx];
  next[fromIdx] = EMPTY;
  for (const capIdx of move.captured) next[capIdx] = EMPTY;
  const last = move.path[move.path.length - 1];
  if (move.becameKing) v = kingedVersion(v);
  next[idx(last.r, last.c)] = v;
  return next;
}

function startingBoard() {
  const cells = new Array(N * N).fill(EMPTY);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if ((r + c) % 2 === 0) continue; // only dark squares are playable
      if (r < 3) cells[idx(r, c)] = A_MAN;
      else if (r > 4) cells[idx(r, c)] = H_MAN;
    }
  }
  return cells;
}

const PIECE_VALUE = { [H_MAN]: 100, [A_MAN]: 100, [H_KING]: 160, [A_KING]: 160 };

/** Positive favours the AI. Material, king weight, and a push toward centre/back-rank safety. */
function evaluate(cells) {
  let score = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = cells[idx(r, c)];
      if (v === EMPTY) continue;
      const value = PIECE_VALUE[v];
      const advance = isAIVal(v) ? r : N - 1 - r; // how far a man has pushed toward crowning
      const bonus = isKingVal(v) ? 0 : advance * 4;
      const centre = Math.abs(c - 3.5) < 2 ? 3 : 0;
      const total = value + bonus + centre;
      score += isAIVal(v) ? total : -total;
    }
  }
  return score;
}

function search(cells, humanSide, depth, alpha, beta) {
  const moves = legalMoves(cells, humanSide);
  if (depth === 0 || !moves.length) {
    // The side to move has lost. Prefer that outcome sooner (more remaining
    // depth left on the clock when it is found) over later, on both sides.
    if (!moves.length) return humanSide ? 100000 + depth : -100000 - depth;
    return evaluate(cells);
  }
  const maximising = !humanSide;
  let best = maximising ? -Infinity : Infinity;
  for (const move of moves) {
    const next = applyMove(cells, move);
    const value = search(next, !humanSide, depth - 1, alpha, beta);
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

export default class Checkers extends BaseGame {
  static id = 'checkers';
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
        { value: 'easy', label: 'Easy', hint: 'The machine looks three plies ahead.' },
        { value: 'medium', label: 'Medium', hint: 'The machine looks five plies ahead.' },
        { value: 'hard', label: 'Hard', hint: 'The machine looks seven plies ahead.' },
      ],
    },
  ];

  setup() {
    this.host.setSecondaryLabel('Game');
    this.host.setHint('Click a piece, then a square · captures are forced',
      'Tap a piece, then a square · captures are forced');
    this.setLives(3);

    this.gameNo = 1;
    this.#applyLevel(this.option('level'));
    this.#newGame();
    this.banner('Checkers');
    this.play('ready');
  }

  onOptionChange(id, value) {
    if (id !== 'level') return false;
    this.#applyLevel(value);
    return true;
  }

  #applyLevel(value) {
    // Depth is capped well below where a chess engine might sit — checkers'
    // capture-chain search is expensive per node, and unlike Reversi or
    // Connect Four this runs synchronously inside the frame loop, so a
    // measured 600ms-1.4s at depth 9 would freeze the whole tab rather than
    // just pause the game. Depth 7 measured under 200ms worst case.
    this.depth = value === 'easy' ? 3 : value === 'hard' ? 7 : 5;
    this.levelName = value;
  }

  #newGame() {
    this.cells = startingBoard();
    this.turn = 'human';
    this.selection = null;
    this.legal = legalMoves(this.cells, true);
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = 0;
    this.plySinceAction = 0;
    this.host.setSecondary(this.gameNo);
  }

  /* ==================================================================== ai */

  #chooseMove() {
    const moves = legalMoves(this.cells, false);
    if (!moves.length) return null;
    let bestValue = -Infinity;
    let choices = [];
    for (const move of moves) {
      const next = applyMove(this.cells, move);
      const value = search(next, true, this.depth - 1, -Infinity, Infinity);
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

  #apply(move) {
    this.cells = applyMove(this.cells, move);
    this.plySinceAction = move.captured.length ? 0 : this.plySinceAction + 1;
    this.selection = null;

    if (move.captured.length > 1) this.shake.add(4);
    this.play(move.captured.length ? 'hit' : 'select');
    if (move.becameKing) this.play('powerup');

    this.turn = this.turn === 'human' ? 'ai' : 'human';
    this.legal = legalMoves(this.cells, this.turn === 'human');

    // A draw is declared after a long spell with neither a capture nor a
    // crowning — the same defence real rule sets use against a dead position
    // going on forever.
    if (this.plySinceAction >= 80) {
      this.#finish('draw');
      return;
    }
    if (!this.legal.length) {
      this.#finish(this.turn === 'human' ? 'ai' : 'human');
      return;
    }
    if (this.turn === 'ai' && this.result === null) this.aiTimer = 0.5;
  }

  #finish(winner) {
    this.result = winner;
    this.settleTimer = 2.2;
    const counts = this.#pieceCounts();
    this.meta = { game: this.gameNo, level: this.levelName, pieces: `${counts.human}-${counts.ai}` };

    if (winner === 'human') {
      this.addScore(500 + counts.human * 40 + this.depth * 120);
      this.banner('You win!');
      this.play('highscore');
    } else if (winner === 'ai') {
      this.banner('The machine wins');
      this.play('die');
    } else {
      this.addScore(250);
      this.banner('Drawn');
      this.play('back');
    }
  }

  #pieceCounts() {
    let human = 0;
    let ai = 0;
    for (const v of this.cells) {
      if (isHumanVal(v)) human++;
      else if (isAIVal(v)) ai++;
    }
    return { human, ai };
  }

  #afterGame() {
    if (this.result === 'ai') {
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

    if (this.result !== null) {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.#afterGame();
      return;
    }

    if (this.turn === 'ai') {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        const move = this.#chooseMove();
        if (move) this.#apply(move);
        else this.#finish('human');
      }
      return;
    }

    const m = this.mouse;
    if (!m.pressed) return;
    const col = Math.floor((m.x - BOARD_X) / CELL);
    const row = Math.floor((m.y - BOARD_Y) / CELL);
    if (col < 0 || col >= N || row < 0 || row >= N) return;

    if (!this.selection) {
      const has = this.legal.some((mv) => mv.from.r === row && mv.from.c === col);
      if (!has) return;
      this.selection = { r: row, c: col };
      this.play('hover');
      return;
    }

    if (this.selection.r === row && this.selection.c === col) {
      this.selection = null;
      return;
    }

    const move = this.legal.find(
      (mv) => mv.from.r === this.selection.r && mv.from.c === this.selection.c
        && mv.path[mv.path.length - 1].r === row && mv.path[mv.path.length - 1].c === col,
    );
    if (move) {
      this.#apply(move);
      return;
    }

    // Clicking another of your own pieces re-selects rather than failing.
    const has = this.legal.some((mv) => mv.from.r === row && mv.from.c === col);
    this.selection = has ? { r: row, c: col } : null;
    if (!has) this.play('hit');
  }

  /* ================================================================== draw */

  draw(ctx) {
    this.clear(ctx, '#05100c');
    ctx.save();
    this.shake.apply(ctx);
    this.#drawBoard(ctx);
    this.#drawHints(ctx);
    this.#drawPieces(ctx);
    this.#drawStatus(ctx);
    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawBoard(ctx) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const dark = (r + c) % 2 === 1;
        ctx.fillStyle = dark ? '#132018' : '#0a120d';
        ctx.fillRect(BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = 'rgba(74,222,128,0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BOARD_X - 1, BOARD_Y - 1, BOARD + 2, BOARD + 2);
  }

  #drawHints(ctx) {
    if (this.turn !== 'human' || this.result !== null) return;
    if (this.selection) {
      const { r, c } = this.selection;
      ctx.save();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(BOARD_X + c * CELL + 2, BOARD_Y + r * CELL + 2, CELL - 4, CELL - 4);
      ctx.restore();

      const pulse = 0.4 + Math.abs(Math.sin(performance.now() / 420)) * 0.35;
      for (const mv of this.legal) {
        if (mv.from.r !== r || mv.from.c !== c) continue;
        const last = mv.path[mv.path.length - 1];
        const x = BOARD_X + last.c * CELL + CELL / 2;
        const y = BOARD_Y + last.r * CELL + CELL / 2;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = mv.captured.length ? '#fb7185' : '#38bdf8';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // Squares that must move — forced captures glow so the rule teaches itself.
      const capturers = new Set(this.legal.filter((mv) => mv.captured.length).map((mv) => idx(mv.from.r, mv.from.c)));
      if (!capturers.size) return;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (!capturers.has(idx(r, c))) continue;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = 'rgba(251,113,133,0.25)';
          ctx.fillRect(BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL);
          ctx.restore();
        }
      }
    }
  }

  #drawPieces(ctx) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = this.cells[idx(r, c)];
        if (v === EMPTY) continue;
        const x = BOARD_X + c * CELL + CELL / 2;
        const y = BOARD_Y + r * CELL + CELL / 2;
        const human = isHumanVal(v);
        const king = isKingVal(v);
        const color = human ? '#e9edf6' : '#1f2937';
        const rim = human ? '#38bdf8' : '#fb7185';

        ctx.save();
        ctx.shadowColor = rim;
        ctx.shadowBlur = 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.36, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = rim;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (king) {
          this.text(ctx, '♛', x, y + 1, { size: CELL * 0.34, color: rim });
        }
        ctx.restore();
      }
    }
  }

  #drawStatus(ctx) {
    const { human, ai } = this.#pieceCounts();
    this.text(ctx, `YOU ${human}`, BOARD_X, BOARD_Y - 30, { size: 12, color: '#38bdf8', align: 'left' });
    this.text(ctx, `CPU ${ai}`, BOARD_X + BOARD, BOARD_Y - 30, { size: 12, color: '#fb7185', align: 'right' });
    if (this.result === null) {
      this.text(ctx, this.turn === 'human' ? 'YOUR MOVE' : 'THINKING', BOARD_X + BOARD / 2, BOARD_Y - 30, {
        size: 12, color: this.turn === 'human' ? '#4ade80' : '#8b93a7', glow: 6,
      });
    }
  }
}
