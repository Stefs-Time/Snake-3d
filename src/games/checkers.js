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
            const promo = !isKingVal(v) && nr === (isHumanVal(v) ? 0 : N - 1);
            simple.push({ from: { r, c }, path: [{ r: nr, c: nc }], captured: [], becameKing: promo });
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
    this.#buildBoardLayer();
    this.#buildSprites();
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
    this.#setLegal(legalMoves(this.cells, true));
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = 0;
    this.plySinceAction = 0;
    this.anim = null;
    this.lastMove = null;
    this.host.setSecondary(this.gameNo);
  }

  #setLegal(moves) {
    this.legal = moves;
    this.capturers = new Set(moves.filter((mv) => mv.captured.length).map((mv) => idx(mv.from.r, mv.from.c)));
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
    const mover = this.turn;
    this.cells = applyMove(this.cells, move);
    this.plySinceAction = move.captured.length || move.becameKing ? 0 : this.plySinceAction + 1;
    this.selection = null;

    const last = move.path[move.path.length - 1];
    this.lastMove = { from: idx(move.from.r, move.from.c), to: idx(last.r, last.c) };
    this.anim = {
      steps: [{ r: move.from.r, c: move.from.c }, ...move.path],
      val: this.cells[idx(last.r, last.c)],
      to: idx(last.r, last.c),
      captured: move.captured,
      capColor: mover === 'human' ? '#fb7185' : '#38bdf8',
      capIndex: 0,
      t: 0,
      dur: 0.15 * move.path.length,
    };
    if (move.becameKing) {
      this.popups.add(BOARD_X + last.c * CELL + CELL / 2, BOARD_Y + last.r * CELL + 8, 'KING', '#ffd23f');
      this.particles.emit(BOARD_X + last.c * CELL + CELL / 2, BOARD_Y + last.r * CELL + CELL / 2, {
        count: 16, speed: 140, color: '#ffd23f', life: 0.6, size: 2.6, shape: 'circle',
      });
    }

    if (move.captured.length > 1) this.shake.add(4);
    this.play(move.captured.length ? 'hit' : 'select');
    if (move.becameKing) this.play('powerup');

    this.turn = this.turn === 'human' ? 'ai' : 'human';
    this.#setLegal(legalMoves(this.cells, this.turn === 'human'));

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
      this.particles.emit(BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2, {
        count: 42, speed: 260, color: '#ffd23f', life: 0.9, size: 3, shape: 'circle',
      });
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

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const segs = a.steps.length - 1;
      const p = (a.t / a.dur) * segs;
      while (a.capIndex < a.captured.length && p >= a.capIndex + 0.5) {
        const capIdx = a.captured[a.capIndex++];
        this.particles.emit(
          BOARD_X + (capIdx % N) * CELL + CELL / 2,
          BOARD_Y + ((capIdx / N) | 0) * CELL + CELL / 2,
          { count: 14, speed: 130, color: a.capColor, life: 0.5, size: 2.8, shape: 'circle' },
        );
      }
      if (a.t >= a.dur) this.anim = null;
      else return;
    }

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

  /** The board never changes, so all its gradients are painted exactly once. */
  #buildBoardLayer() {
    const scale = 2;
    const layer = document.createElement('canvas');
    layer.width = W * scale;
    layer.height = H * scale;
    const c = layer.getContext('2d');
    c.scale(scale, scale);

    // Outer rim — an inset well the squares sit inside.
    const rim = c.createLinearGradient(0, BOARD_Y - 12, 0, BOARD_Y + BOARD + 12);
    rim.addColorStop(0, '#12241a');
    rim.addColorStop(1, '#081209');
    c.fillStyle = rim;
    this.roundRect(c, BOARD_X - 12, BOARD_Y - 12, BOARD + 24, BOARD + 24, 10).fill();
    c.strokeStyle = 'rgba(74,222,128,0.3)';
    c.lineWidth = 1.5;
    this.roundRect(c, BOARD_X - 12, BOARD_Y - 12, BOARD + 24, BOARD + 24, 10).stroke();
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(BOARD_X - 3, BOARD_Y - 3, BOARD + 6, BOARD + 6);

    for (let r = 0; r < N; r++) {
      for (let c2 = 0; c2 < N; c2++) {
        const x = BOARD_X + c2 * CELL;
        const y = BOARD_Y + r * CELL;
        const dark = (r + c2) % 2 === 1;
        const g = c.createLinearGradient(0, y, 0, y + CELL);
        if (dark) {
          g.addColorStop(0, '#17271c');
          g.addColorStop(1, '#0f1a12');
        } else {
          g.addColorStop(0, '#0b140e');
          g.addColorStop(1, '#080f0a');
        }
        c.fillStyle = g;
        c.fillRect(x, y, CELL, CELL);
        if (dark) {
          c.strokeStyle = 'rgba(74,222,128,0.06)';
          c.lineWidth = 1;
          c.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        }
      }
    }

    // A soft sheen falling across the playfield.
    const sheen = c.createLinearGradient(BOARD_X, BOARD_Y, BOARD_X + BOARD, BOARD_Y + BOARD);
    sheen.addColorStop(0, 'rgba(255,255,255,0.035)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.06)');
    c.fillStyle = sheen;
    c.fillRect(BOARD_X, BOARD_Y, BOARD, BOARD);

    // Quiet coordinates, the way a physical board etches them into the rim.
    c.font = '600 9px ui-monospace, monospace';
    c.fillStyle = 'rgba(134,239,172,0.35)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      c.fillText(String.fromCharCode(97 + i), BOARD_X + i * CELL + CELL / 2, BOARD_Y + BOARD + 8);
      c.fillText(String(N - i), BOARD_X - 8, BOARD_Y + i * CELL + CELL / 2);
    }

    this.boardLayer = layer;
  }

  #buildSprites() {
    const make = (human, king) => {
      const scale = 3;
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = CELL * scale;
      const c = cnv.getContext('2d');
      c.scale(scale, scale);
      const cx = CELL / 2;
      const cy = CELL / 2;
      const r = CELL * 0.36;
      const rim = human ? '#38bdf8' : '#fb7185';

      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.beginPath();
      c.ellipse(cx, cy + r * 0.16, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
      c.fill();

      const body = c.createRadialGradient(cx - r * 0.35, cy - r * 0.42, r * 0.15, cx, cy, r * 1.05);
      if (human) {
        body.addColorStop(0, '#ffffff');
        body.addColorStop(0.55, '#dbe4f4');
        body.addColorStop(1, '#93a8cc');
      } else {
        body.addColorStop(0, '#46536b');
        body.addColorStop(0.55, '#28334a');
        body.addColorStop(1, '#121826');
      }
      c.save();
      c.shadowColor = rim;
      c.shadowBlur = 8;
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

      // The turned ridge every real checker has.
      c.globalAlpha = 0.45;
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;

      // Dome highlight.
      const dome = c.createRadialGradient(cx - r * 0.3, cy - r * 0.42, 0, cx - r * 0.3, cy - r * 0.42, r * 0.75);
      dome.addColorStop(0, human ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.28)');
      dome.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = dome;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();

      if (king) {
        c.save();
        c.shadowColor = rim;
        c.shadowBlur = 6;
        c.fillStyle = rim;
        c.font = `700 ${CELL * 0.34}px ui-monospace, monospace`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('♛', cx, cy + 1);
        c.restore();
      }
      return cnv;
    };
    this.sprites = {
      [H_MAN]: make(true, false),
      [H_KING]: make(true, true),
      [A_MAN]: make(false, false),
      [A_KING]: make(false, true),
    };
  }

  #drawBoard(ctx) {
    ctx.drawImage(this.boardLayer, 0, 0, W, H);

    if (this.lastMove) {
      for (const [i, alpha] of [[this.lastMove.from, 0.1], [this.lastMove.to, 0.18]]) {
        const x = BOARD_X + (i % N) * CELL;
        const y = BOARD_Y + ((i / N) | 0) * CELL;
        ctx.fillStyle = `rgba(180,123,255,${alpha})`;
        ctx.fillRect(x, y, CELL, CELL);
      }
      const to = this.lastMove.to;
      ctx.strokeStyle = 'rgba(180,123,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(BOARD_X + (to % N) * CELL + 1.5, BOARD_Y + ((to / N) | 0) * CELL + 1.5, CELL - 3, CELL - 3);
    }
  }

  #drawHints(ctx) {
    if (this.turn !== 'human' || this.result !== null || this.anim) return;
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
      if (!this.capturers.size) return;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (!this.capturers.has(idx(r, c))) continue;
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
        const i = idx(r, c);
        const v = this.cells[i];
        if (v === EMPTY) continue;
        if (this.anim && i === this.anim.to) continue;
        ctx.drawImage(this.sprites[v], BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL);
      }
    }

    if (this.anim) {
      const a = this.anim;
      const segs = a.steps.length - 1;
      const p = Math.min(segs - 0.0001, (a.t / a.dur) * segs);
      const k = Math.floor(p);
      const f = smoothstep(p - k);
      const s0 = a.steps[k];
      const s1 = a.steps[k + 1];
      const x = BOARD_X + (s0.c + (s1.c - s0.c) * f) * CELL;
      const y = BOARD_Y + (s0.r + (s1.r - s0.r) * f) * CELL;
      // A slight lift at mid-hop sells the piece leaving the surface.
      const lift = 1 + Math.sin(f * Math.PI) * 0.1;
      const off = (CELL * (lift - 1)) / 2;
      ctx.drawImage(this.sprites[a.val], x - off, y - off, CELL * lift, CELL * lift);
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

const smoothstep = (t) => t * t * (3 - 2 * t);
