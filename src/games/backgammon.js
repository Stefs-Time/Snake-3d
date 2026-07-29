import { BaseGame } from '../core/game.js';

/**
 * BACKGAMMON
 *
 * Twenty-four points, numbered 0-23 here rather than the traditional 1-24.
 * You move from 23 toward 0, home is 0-5, and you bear off past the low
 * edge; the machine moves the other way, home 18-23, bearing off past the
 * high edge — the same board, mirrored, which is what makes hitting a blot
 * mean something different depending on whose it is.
 *
 * A checker on the bar must re-enter before anything else moves, and once
 * the whole side is home a die may bear a checker off outright — exactly,
 * or with anything larger only once nothing sits on a higher point. Getting
 * that last clause wrong is the single most common bug in an amateur
 * implementation of this game, so it is unit-tested against eight hand-built
 * positions, including one that specifically checks an oversized die is
 * refused while a farther checker still exists.
 *
 * The machine cannot search the way Reversi or Checkers do — the branching
 * factor of every future dice roll makes that impractical here — so instead,
 * for the dice it has actually rolled, it tries every legal way to spend
 * them and keeps the sequence a simple position heuristic likes best. It
 * faces the same dice luck you do; the difference is judgement, not
 * information.
 *
 * The doubling cube is not implemented — a deliberate simplification, not an
 * oversight, in the same spirit as skipping insurance in Blackjack.
 */

const W = 820;
const H = 500;

const BOARD_X = 20;
const BOARD_Y = 90;
const POINT_W = 56;
const BAR_W = 40;
const ROW_H = 170;
const BOARD_W = POINT_W * 12 + BAR_W;
const BOARD_H = ROW_H * 2;

const OFF_X = BOARD_X + BOARD_W + 10;
const OFF_W = 50;

const CHECKER_R = POINT_W * 0.4;
const MAX_STACK_SHOWN = 5;

/** Board-space slot for a point index, used by both layout and hit-testing. */
function pointSlot(i) {
  if (i <= 5) return { row: 'bottom', half: 'right', slot: i };
  if (i <= 11) return { row: 'bottom', half: 'left', slot: 11 - i };
  if (i <= 17) return { row: 'top', half: 'left', slot: i - 12 };
  return { row: 'top', half: 'right', slot: 23 - i };
}

function pointX(i) {
  const { half, slot } = pointSlot(i);
  const base = half === 'left' ? BOARD_X : BOARD_X + 6 * POINT_W + BAR_W;
  return base + slot * POINT_W;
}

/* ================================================================= rules */

function startingPoints() {
  const points = new Array(24).fill(0);
  points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5;
  points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5;
  return points;
}

function humanAllInHome(points, bar) {
  if (bar.human > 0) return false;
  for (let i = 6; i < 24; i++) if (points[i] > 0) return false;
  return true;
}
function aiAllInHome(points, bar) {
  if (bar.ai > 0) return false;
  for (let i = 0; i < 18; i++) if (points[i] < 0) return false;
  return true;
}
function canLand(points, player, target) {
  const v = points[target];
  return player === 'human' ? v >= -1 : v <= 1;
}

/** Every legal single-die move for `player`, respecting mandatory bar re-entry. */
function movesForDie(points, bar, player, die) {
  const moves = [];
  const dir = player === 'human' ? -1 : 1;
  const barCount = player === 'human' ? bar.human : bar.ai;
  if (barCount > 0) {
    const entry = player === 'human' ? 24 - die : die - 1;
    if (canLand(points, player, entry)) moves.push({ from: 'bar', to: entry, die });
    return moves;
  }
  const allHome = player === 'human' ? humanAllInHome(points, bar) : aiAllInHome(points, bar);
  for (let p = 0; p < 24; p++) {
    const owns = player === 'human' ? points[p] > 0 : points[p] < 0;
    if (!owns) continue;
    const target = p + dir * die;
    if (target >= 0 && target <= 23) {
      if (canLand(points, player, target)) moves.push({ from: p, to: target, die });
    } else if (allHome) {
      const distance = player === 'human' ? p + 1 : 24 - p;
      if (die === distance) {
        moves.push({ from: p, to: 'off', die });
      } else if (die > distance) {
        const noneFarther = player === 'human'
          ? !points.slice(p + 1, 6).some((v) => v > 0)
          : !points.slice(18, p).some((v) => v < 0);
        if (noneFarther) moves.push({ from: p, to: 'off', die });
      }
    }
  }
  return moves;
}

function applyMove(state, player, move) {
  const points = state.points.slice();
  const bar = { ...state.bar };
  const off = { ...state.off };
  if (move.from === 'bar') bar[player]--;
  else points[move.from] -= player === 'human' ? 1 : -1;

  if (move.to === 'off') {
    off[player]++;
  } else {
    const landing = points[move.to];
    const isOpponentBlot = player === 'human' ? landing === -1 : landing === 1;
    if (isOpponentBlot) {
      const opp = player === 'human' ? 'ai' : 'human';
      bar[opp]++;
      points[move.to] = 0;
    }
    points[move.to] += player === 'human' ? 1 : -1;
  }
  return { points, bar, off };
}

function pipCount(points, bar, player) {
  let pips = bar[player] * 25;
  for (let i = 0; i < 24; i++) {
    const v = points[i];
    if (player === 'human' && v > 0) pips += v * (i + 1);
    if (player === 'ai' && v < 0) pips += -v * (24 - i);
  }
  return pips;
}

/* ==================================================================== ai */

function evaluate(state, player) {
  const opp = player === 'human' ? 'ai' : 'human';
  let score = 0;
  score += (state.off[player] - state.off[opp]) * 400;
  score -= state.bar[player] * 150;
  score += state.bar[opp] * 150;
  score += (pipCount(state.points, state.bar, opp) - pipCount(state.points, state.bar, player)) * 2;
  for (let i = 0; i < 24; i++) {
    const v = state.points[i];
    const mine = player === 'human' ? v === 1 : v === -1;
    const theirs = player === 'human' ? v === -1 : v === 1;
    if (mine) score -= 6;
    if (theirs) score += 4;
  }
  return score;
}

/**
 * Every way to spend a dice roll, evaluated at the end of each complete
 * spend. Not a search over future rolls — nobody can afford that here —
 * just an exhaustive look at what this roll can actually do.
 */
function bestSequence(points, bar, off, player, dice) {
  let best = { seq: [], value: -Infinity };
  let calls = 0;
  function explore(state, remaining, seq) {
    if (++calls > 20000) return;
    const uniqueDice = [...new Set(remaining)];
    let any = false;
    for (const die of uniqueDice) {
      const moves = movesForDie(state.points, state.bar, player, die);
      for (const move of moves) {
        any = true;
        const nextState = applyMove(state, player, move);
        const remainingAfter = remaining.slice();
        remainingAfter.splice(remainingAfter.indexOf(die), 1);
        explore(nextState, remainingAfter, [...seq, move]);
      }
    }
    if (!any && seq.length) {
      const value = evaluate(state, player);
      if (value > best.value) best = { seq, value };
    }
  }
  explore({ points, bar, off }, dice, []);
  return best.seq;
}

function rollDice(random) {
  const a = 1 + Math.floor(random() * 6);
  const b = 1 + Math.floor(random() * 6);
  return a === b ? [a, a, a, a] : [a, b];
}

export default class Backgammon extends BaseGame {
  static id = 'backgammon';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Game' };

  setup() {
    this.host.setSecondaryLabel('Game');
    this.host.setHint('Click a checker, then a highlighted point',
      'Tap a checker, then a highlighted point');
    this.setLives(3);

    this.gameNo = 1;
    this.#newGame();
    this.banner('Backgammon');
    this.play('ready');
  }

  #newGame() {
    this.points = startingPoints();
    this.bar = { human: 0, ai: 0 };
    this.off = { human: 0, ai: 0 };
    this.turn = 'human';
    this.dice = [];
    this.remaining = [];
    this.selection = null;
    this.result = null;
    this.settleTimer = 0;
    this.aiTimer = 0;
    this.message = '';
    this.consecutivePasses = 0;
    this.host.setSecondary(this.gameNo);
    this.#rollForTurn();
  }

  #rollForTurn() {
    this.dice = rollDice(this.random);
    this.remaining = this.dice.slice();
    this.selection = null;
    this.play('blip');

    if (!this.#anyMovePossible()) {
      this.message = `${this.turn === 'human' ? 'You have' : 'The machine has'} no legal move`;
      this.remaining = [];
      // A fully mutual, unbroken block is not a reachable position in real
      // play, but this bounds the recursion into a hard defensive floor
      // rather than trusting the board never to produce one.
      this.consecutivePasses++;
      if (this.consecutivePasses > 40) {
        this.result = 'draw';
        this.settleTimer = 2;
        this.banner('Stalemate');
        return;
      }
      this.#endTurn();
      return;
    }
    this.message = '';
    if (this.turn === 'ai') this.aiTimer = 0.6;
  }

  #anyMovePossible() {
    return this.remaining.some((d) => movesForDie(this.points, this.bar, this.turn, d).length > 0);
  }

  #endTurn() {
    if (this.#checkWin()) return;
    this.turn = this.turn === 'human' ? 'ai' : 'human';
    this.#rollForTurn();
  }

  #checkWin() {
    if (this.off.human < 15 && this.off.ai < 15) return false;
    const winner = this.off.human === 15 ? 'human' : 'ai';
    const loser = winner === 'human' ? 'ai' : 'human';
    // Real bonus scoring: a gammon (loser bore nothing off) doubles the
    // stake, a backgammon (loser still has a checker in the winner's home
    // or on the bar) trebles it.
    let multiplier = 1;
    if (this.off[loser] === 0) {
      multiplier = 2;
      const winnerHome = winner === 'human' ? [18, 19, 20, 21, 22, 23] : [0, 1, 2, 3, 4, 5];
      const loserOwns = (v) => (loser === 'human' ? v > 0 : v < 0);
      const stillDeep = this.bar[loser] > 0 || winnerHome.some((i) => loserOwns(this.points[i]));
      if (stillDeep) multiplier = 3;
    }

    this.result = winner;
    this.settleTimer = 2.6;
    this.meta = { game: this.gameNo, multiplier };

    if (winner === 'human') {
      this.addScore(150 * multiplier);
      this.banner(multiplier === 3 ? 'Backgammon!' : multiplier === 2 ? 'Gammon!' : 'You win!');
      this.play('highscore');
    } else {
      this.banner('The machine wins');
      this.play('die');
    }
    return true;
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

  /* ==================================================================== ai */

  #aiTurn() {
    const seq = bestSequence(this.points, this.bar, this.off, 'ai', this.remaining);
    if (!seq.length) {
      this.remaining = [];
      this.#endTurn();
      return;
    }
    for (const move of seq) this.#commitMove('ai', move);
    this.remaining = [];
    this.#endTurn();
  }

  /* ================================================================ moves */

  #commitMove(player, move) {
    this.consecutivePasses = 0;
    const wasHit = move.to !== 'off' && (player === 'human' ? this.points[move.to] === -1 : this.points[move.to] === 1);
    const next = applyMove({ points: this.points, bar: this.bar, off: this.off }, player, move);
    this.points = next.points;
    this.bar = next.bar;
    this.off = next.off;
    this.play(wasHit ? 'hit' : move.to === 'off' ? 'powerup' : 'select');
    if (wasHit) this.shake.add(3);
    const i = this.remaining.indexOf(move.die);
    if (i >= 0) this.remaining.splice(i, 1);
  }

  #playerMove(move) {
    this.#commitMove('human', move);
    this.selection = null;
    if (!this.remaining.length || !this.#anyMovePossible()) {
      this.remaining = [];
      this.#endTurn();
    }
  }

  /** Every legal destination for the currently selected source, one per remaining die. */
  #destinationsFrom(from) {
    const out = [];
    for (const die of new Set(this.remaining)) {
      for (const move of movesForDie(this.points, this.bar, 'human', die)) {
        if (move.from === from) out.push(move);
      }
    }
    return out;
  }

  /* ================================================================ input */

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
      if (this.aiTimer <= 0) this.#aiTurn();
      return;
    }

    const m = this.mouse;
    if (!m.pressed) return;
    const hit = this.#hitTest(m.x, m.y);
    if (hit == null) return;

    if (this.selection != null) {
      const dests = this.#destinationsFrom(this.selection);
      const options = dests.filter((mv) => mv.to === hit);
      if (options.length) {
        // Several dice can occasionally reach the same bear-off; the
        // smallest is always at least as useful for whatever is left.
        options.sort((a, b) => a.die - b.die);
        this.#playerMove(options[0]);
        return;
      }
      if (hit === this.selection) {
        this.selection = null;
        return;
      }
    }

    const canSelect = this.bar.human > 0 ? hit === 'bar'
      : hit !== 'bar' && hit !== 'off' && this.points[hit] > 0;
    if (canSelect) {
      this.selection = hit;
      this.play('hover');
    } else {
      this.selection = null;
    }
  }

  #hitTest(mx, my) {
    if (this.hits(mx, my, OFF_X, BOARD_Y, OFF_W, ROW_H)) return 'off';
    if (this.hits(mx, my, OFF_X, BOARD_Y + ROW_H, OFF_W, ROW_H)) return 'off';
    if (this.bar.human > 0 && this.hits(mx, my, BOARD_X + 6 * POINT_W, BOARD_Y + ROW_H, BAR_W, ROW_H)) return 'bar';
    for (let i = 0; i < 24; i++) {
      const { row } = pointSlot(i);
      const x = pointX(i);
      const y = row === 'top' ? BOARD_Y : BOARD_Y + ROW_H;
      if (this.hits(mx, my, x, y, POINT_W, ROW_H)) return i;
    }
    return null;
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#0a0d16');
    ctx.save();
    this.shake.apply(ctx);
    this.#drawBoard(ctx);
    this.#drawHighlights(ctx);
    this.#drawCheckers(ctx);
    this.#drawBar(ctx);
    this.#drawOff(ctx);
    this.#drawStatus(ctx);
    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawBoard(ctx) {
    ctx.save();
    ctx.fillStyle = '#161020';
    this.roundRect(ctx, BOARD_X - 6, BOARD_Y - 6, BOARD_W + 12, BOARD_H + 12, 8).fill();
    ctx.strokeStyle = 'rgba(192,132,252,0.3)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, BOARD_X - 6, BOARD_Y - 6, BOARD_W + 12, BOARD_H + 12, 8).stroke();

    for (let i = 0; i < 24; i++) {
      const { row } = pointSlot(i);
      const x = pointX(i);
      const y = row === 'top' ? BOARD_Y : BOARD_Y + ROW_H;
      const apex = row === 'top' ? y + ROW_H : y;
      const tip = row === 'top' ? y + ROW_H * 0.86 : y + ROW_H * 0.14;
      ctx.beginPath();
      ctx.moveTo(x, apex);
      ctx.lineTo(x + POINT_W / 2, tip);
      ctx.lineTo(x + POINT_W, apex);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.02)';
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(BOARD_X + 6 * POINT_W, BOARD_Y, BAR_W, BOARD_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(BOARD_X, BOARD_Y + ROW_H);
    ctx.lineTo(BOARD_X + BOARD_W, BOARD_Y + ROW_H);
    ctx.stroke();
    ctx.restore();
  }

  #drawHighlights(ctx) {
    if (this.turn !== 'human' || this.result !== null) return;
    const targets = this.selection != null ? this.#destinationsFrom(this.selection) : [];
    const pulse = 0.35 + Math.abs(Math.sin(performance.now() / 420)) * 0.3;

    if (this.selection === 'bar') {
      // handled via targets below
    } else if (this.selection != null && this.selection !== 'off') {
      const x = pointX(this.selection);
      const { row } = pointSlot(this.selection);
      const y = row === 'top' ? BOARD_Y : BOARD_Y + ROW_H;
      ctx.save();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, POINT_W - 4, ROW_H - 4);
      ctx.restore();
    }

    for (const mv of targets) {
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = mv.to === 'off' ? '#4ade80' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      if (mv.to === 'off') {
        // The human's own tray is always the bottom half — this function
        // already returned above unless it is the human's turn.
        ctx.strokeRect(OFF_X + 3, BOARD_Y + ROW_H + 3, OFF_W - 6, ROW_H - 6);
      } else {
        const x = pointX(mv.to);
        const { row } = pointSlot(mv.to);
        const y = row === 'top' ? BOARD_Y : BOARD_Y + ROW_H;
        ctx.beginPath();
        ctx.arc(x + POINT_W / 2, y + ROW_H / 2, CHECKER_R * 1.3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // No selection yet, but a checker is on the bar: point at it.
    if (this.selection == null && this.bar.human > 0) {
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(BOARD_X + 6 * POINT_W + 2, BOARD_Y + ROW_H + 2, BAR_W - 4, ROW_H - 4);
      ctx.restore();
    }
  }

  #drawCheckers(ctx) {
    for (let i = 0; i < 24; i++) {
      const count = this.points[i];
      if (!count) continue;
      const human = count > 0;
      const n = Math.abs(count);
      const { row } = pointSlot(i);
      const x = pointX(i) + POINT_W / 2;
      const dir = row === 'top' ? 1 : -1;
      const startY = row === 'top' ? BOARD_Y + CHECKER_R + 4 : BOARD_Y + BOARD_H - CHECKER_R - 4;
      const shown = Math.min(n, MAX_STACK_SHOWN);
      for (let k = 0; k < shown; k++) {
        const y = startY + dir * k * (CHECKER_R * 1.7);
        this.#drawChecker(ctx, x, y, human);
      }
      if (n > MAX_STACK_SHOWN) {
        const y = startY + dir * (shown - 1) * (CHECKER_R * 1.7);
        this.text(ctx, `${n}`, x, y, { size: 11, color: '#04060a', weight: 700 });
      }
    }
  }

  #drawChecker(ctx, x, y, human) {
    ctx.save();
    ctx.shadowColor = human ? '#38bdf8' : '#fb7185';
    ctx.shadowBlur = 6;
    ctx.fillStyle = human ? '#e9edf6' : '#1f2937';
    ctx.beginPath();
    ctx.arc(x, y, CHECKER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = human ? '#38bdf8' : '#fb7185';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  #drawBar(ctx) {
    const cx = BOARD_X + 6 * POINT_W + BAR_W / 2;
    for (let k = 0; k < this.bar.human; k++) {
      this.#drawChecker(ctx, cx, BOARD_Y + ROW_H + 24 + k * (CHECKER_R * 1.7), true);
    }
    for (let k = 0; k < this.bar.ai; k++) {
      this.#drawChecker(ctx, cx, BOARD_Y + ROW_H - 24 - k * (CHECKER_R * 1.7), false);
    }
  }

  #drawOff(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(OFF_X, BOARD_Y, OFF_W, ROW_H);
    ctx.strokeRect(OFF_X, BOARD_Y + ROW_H, OFF_W, ROW_H);
    ctx.restore();
    this.text(ctx, `${this.off.ai}`, OFF_X + OFF_W / 2, BOARD_Y + 16, { size: 16, color: '#fb7185', weight: 700 });
    this.text(ctx, 'OFF', OFF_X + OFF_W / 2, BOARD_Y + 34, { size: 8, color: '#5c6478' });
    this.text(ctx, `${this.off.human}`, OFF_X + OFF_W / 2, BOARD_Y + BOARD_H - 32, { size: 16, color: '#38bdf8', weight: 700 });
    this.text(ctx, 'OFF', OFF_X + OFF_W / 2, BOARD_Y + BOARD_H - 16, { size: 8, color: '#5c6478' });
  }

  #drawStatus(ctx) {
    const humanPips = pipCount(this.points, this.bar, 'human');
    const aiPips = pipCount(this.points, this.bar, 'ai');
    this.text(ctx, `YOU · ${humanPips} pips`, BOARD_X, 22, { size: 11, color: '#38bdf8', align: 'left' });
    this.text(ctx, `CPU · ${aiPips} pips`, BOARD_X + BOARD_W, 22, { size: 11, color: '#fb7185', align: 'right' });

    const label = this.turn === 'human' ? 'YOUR ROLL' : 'OPPONENT ROLLS';
    this.text(ctx, label, W / 2, 22, {
      size: 11, color: this.turn === 'human' && this.result === null ? '#4ade80' : '#8b93a7', glow: 4,
    });

    const dice = this.turn === 'human' ? this.remaining : this.dice;
    dice.forEach((d, i) => {
      const x = W / 2 - (dice.length * 26) / 2 + i * 26 + 13;
      this.#drawDie(ctx, x, 46, d);
    });

    if (this.message) {
      this.text(ctx, this.message, W / 2, 74, { size: 11, color: '#fbbf24' });
    }
  }

  #drawDie(ctx, x, y, value) {
    ctx.save();
    ctx.fillStyle = '#f4f7ff';
    this.roundRect(ctx, x - 10, y - 10, 20, 20, 4).fill();
    ctx.fillStyle = '#141821';
    const pips = {
      1: [[0, 0]], 2: [[-5, -5], [5, 5]], 3: [[-5, -5], [0, 0], [5, 5]],
      4: [[-5, -5], [5, -5], [-5, 5], [5, 5]],
      5: [[-5, -5], [5, -5], [0, 0], [-5, 5], [5, 5]],
      6: [[-5, -5], [5, -5], [-5, 0], [5, 0], [-5, 5], [5, 5]],
    }[value] ?? [];
    for (const [dx, dy] of pips) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
