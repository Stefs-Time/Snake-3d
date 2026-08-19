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

/**
 * How many of these dice can actually be spent from this position. The rule
 * this backs is easy to forget: a player must use as many dice as possible,
 * and when only one of two can be played it must be the higher.
 */
function maxDiceUsable(points, bar, off, player, dice) {
  let best = 0;
  let calls = 0;
  function explore(state, remaining, used) {
    if (used > best) best = used;
    if (!remaining.length || best === dice.length || ++calls > 8000) return;
    for (const die of new Set(remaining)) {
      for (const move of movesForDie(state.points, state.bar, player, die)) {
        const rem = remaining.slice();
        rem.splice(rem.indexOf(die), 1);
        explore(applyMove(state, player, move), rem, used + 1);
        if (best === dice.length) return;
      }
    }
  }
  explore({ points, bar, off }, dice, 0);
  return best;
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
      // Longer spends win outright — using fewer dice than possible is not a
      // choice the rules offer — and a lone playable die must be the higher.
      const better = seq.length > best.seq.length
        || (seq.length === best.seq.length
          && (seq.length === 1 && seq[0].die !== best.seq[0].die
            ? seq[0].die > best.seq[0].die
            : value > best.value));
      if (better) best = { seq, value };
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
    this.#buildBoardLayer();
    this.#buildSprites();
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
    this.lastAiMoves = null;
    this.legalHuman = [];
    this.host.setSecondary(this.gameNo);
    this.#rollForTurn();
  }

  /**
   * The human's legal moves right now, filtered so that no move strands a die
   * that could otherwise have been played — the "must use both dice" rule.
   */
  #refreshLegal() {
    this.legalHuman = [];
    if (this.turn !== 'human' || this.result !== null || !this.remaining.length) return;
    const dice = this.remaining;
    const maxUse = maxDiceUsable(this.points, this.bar, this.off, 'human', dice);
    if (!maxUse) return;
    for (const die of new Set(dice)) {
      for (const move of movesForDie(this.points, this.bar, 'human', die)) {
        const next = applyMove({ points: this.points, bar: this.bar, off: this.off }, 'human', move);
        const rem = dice.slice();
        rem.splice(rem.indexOf(die), 1);
        if (1 + maxDiceUsable(next.points, next.bar, next.off, 'human', rem) === maxUse) {
          this.legalHuman.push(move);
        }
      }
    }
    if (maxUse === 1 && this.legalHuman.length) {
      const hi = Math.max(...this.legalHuman.map((mv) => mv.die));
      this.legalHuman = this.legalHuman.filter((mv) => mv.die === hi);
    }
    this.legalSources = [...new Set(this.legalHuman.map((mv) => mv.from))];
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
    else this.#refreshLegal();
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
    this.lastAiMoves = seq;
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
    if (wasHit) {
      this.shake.add(3);
      const { row } = pointSlot(move.to);
      this.particles.emit(pointX(move.to) + POINT_W / 2, row === 'top' ? BOARD_Y + 34 : BOARD_Y + BOARD_H - 34, {
        count: 12, speed: 120, color: player === 'human' ? '#fb7185' : '#38bdf8', life: 0.5, size: 2.6, shape: 'circle',
      });
    }
    if (move.to === 'off' && player === 'human') {
      this.popups.add(OFF_X + OFF_W / 2, BOARD_Y + ROW_H + 30, 'OFF', '#4ade80', 12);
    }
    const i = this.remaining.indexOf(move.die);
    if (i >= 0) this.remaining.splice(i, 1);
  }

  #playerMove(move) {
    this.#commitMove('human', move);
    this.selection = null;
    this.#refreshLegal();
    if (!this.remaining.length || !this.legalHuman.length) {
      this.remaining = [];
      this.#endTurn();
    }
  }

  /** Every legal destination for the currently selected source, one per remaining die. */
  #destinationsFrom(from) {
    const out = [];
    for (const move of this.legalHuman) {
      if (move.from === from) out.push(move);
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

    const canSelect = hit !== 'off' && this.legalHuman.some((mv) => mv.from === hit);
    if (canSelect) {
      this.selection = hit;
      this.play('hover');
    } else {
      this.selection = null;
    }
  }

  #hitTest(mx, my) {
    // Only the bottom tray is the human's — the top one belongs to the machine.
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

  /** The board is static, so every gradient on it is painted exactly once. */
  #buildBoardLayer() {
    const scale = 2;
    const layer = document.createElement('canvas');
    layer.width = W * scale;
    layer.height = H * scale;
    const c = layer.getContext('2d');
    c.scale(scale, scale);

    const frame = c.createLinearGradient(0, BOARD_Y - 10, 0, BOARD_Y + BOARD_H + 10);
    frame.addColorStop(0, '#241735');
    frame.addColorStop(1, '#130b1e');
    c.fillStyle = frame;
    this.roundRect(c, BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 10).fill();
    c.strokeStyle = 'rgba(192,132,252,0.35)';
    c.lineWidth = 1.5;
    this.roundRect(c, BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 10).stroke();

    const felt = c.createLinearGradient(0, BOARD_Y, 0, BOARD_Y + BOARD_H);
    felt.addColorStop(0, '#171126');
    felt.addColorStop(0.5, '#0e0a18');
    felt.addColorStop(1, '#171126');
    c.fillStyle = felt;
    c.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);

    for (let i = 0; i < 24; i++) {
      const { row } = pointSlot(i);
      const x = pointX(i);
      // Base sits on the outer edge; the tip reaches most of the way to the
      // middle, the way a physical board is cut.
      const base = row === 'top' ? BOARD_Y : BOARD_Y + BOARD_H;
      const tip = row === 'top' ? BOARD_Y + ROW_H * 0.86 : BOARD_Y + ROW_H + ROW_H * 0.14;
      const g = c.createLinearGradient(0, base, 0, tip);
      if (i % 2 === 0) {
        g.addColorStop(0, 'rgba(180,123,255,0.28)');
        g.addColorStop(1, 'rgba(180,123,255,0.04)');
      } else {
        g.addColorStop(0, 'rgba(0,229,255,0.18)');
        g.addColorStop(1, 'rgba(0,229,255,0.03)');
      }
      c.beginPath();
      c.moveTo(x + 2, base);
      c.lineTo(x + POINT_W / 2, tip);
      c.lineTo(x + POINT_W - 2, base);
      c.closePath();
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.06)';
      c.lineWidth = 1;
      c.stroke();
    }

    const barG = c.createLinearGradient(BOARD_X + 6 * POINT_W, 0, BOARD_X + 6 * POINT_W + BAR_W, 0);
    barG.addColorStop(0, 'rgba(0,0,0,0.55)');
    barG.addColorStop(0.5, 'rgba(30,20,48,0.9)');
    barG.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = barG;
    c.fillRect(BOARD_X + 6 * POINT_W, BOARD_Y, BAR_W, BOARD_H);
    c.strokeStyle = 'rgba(192,132,252,0.25)';
    c.lineWidth = 1;
    c.strokeRect(BOARD_X + 6 * POINT_W + 0.5, BOARD_Y, BAR_W - 1, BOARD_H);

    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.beginPath();
    c.moveTo(BOARD_X, BOARD_Y + ROW_H);
    c.lineTo(BOARD_X + BOARD_W, BOARD_Y + ROW_H);
    c.stroke();

    // Bear-off trays as inset wells.
    for (const y of [BOARD_Y, BOARD_Y + ROW_H]) {
      const well = c.createLinearGradient(OFF_X, 0, OFF_X + OFF_W, 0);
      well.addColorStop(0, 'rgba(255,255,255,0.05)');
      well.addColorStop(1, 'rgba(0,0,0,0.35)');
      c.fillStyle = well;
      this.roundRect(c, OFF_X, y, OFF_W, ROW_H, 6).fill();
      c.strokeStyle = 'rgba(255,255,255,0.14)';
      c.lineWidth = 1;
      this.roundRect(c, OFF_X, y, OFF_W, ROW_H, 6).stroke();
    }

    // Point numbers, etched quietly along the frame edges.
    c.font = '600 8px ui-monospace, monospace';
    c.fillStyle = 'rgba(192,132,252,0.4)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 24; i++) {
      const { row } = pointSlot(i);
      const x = pointX(i) + POINT_W / 2;
      const y = row === 'top' ? BOARD_Y - 16 : BOARD_Y + BOARD_H + 16;
      c.fillText(String(i + 1), x, y);
    }

    this.boardLayer = layer;
  }

  #buildSprites() {
    const make = (human) => {
      const scale = 3;
      const size = Math.ceil(CHECKER_R * 2 + 10);
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = size * scale;
      const c = cnv.getContext('2d');
      c.scale(scale, scale);
      const cx = size / 2;
      const cy = size / 2;
      const rim = human ? '#38bdf8' : '#fb7185';

      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.beginPath();
      c.ellipse(cx, cy + CHECKER_R * 0.14, CHECKER_R * 1.02, CHECKER_R * 0.9, 0, 0, Math.PI * 2);
      c.fill();

      const body = c.createRadialGradient(cx - CHECKER_R * 0.35, cy - CHECKER_R * 0.42, CHECKER_R * 0.15, cx, cy, CHECKER_R * 1.05);
      if (human) {
        body.addColorStop(0, '#ffffff');
        body.addColorStop(0.55, '#dbe4f4');
        body.addColorStop(1, '#8fa5cb');
      } else {
        body.addColorStop(0, '#48556e');
        body.addColorStop(0.55, '#2a354d');
        body.addColorStop(1, '#131a29');
      }
      c.save();
      c.shadowColor = rim;
      c.shadowBlur = 5;
      c.fillStyle = body;
      c.beginPath();
      c.arc(cx, cy, CHECKER_R, 0, Math.PI * 2);
      c.fill();
      c.restore();

      c.strokeStyle = rim;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(cx, cy, CHECKER_R, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 0.4;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, CHECKER_R * 0.62, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;

      const dome = c.createRadialGradient(cx - CHECKER_R * 0.3, cy - CHECKER_R * 0.4, 0, cx - CHECKER_R * 0.3, cy - CHECKER_R * 0.4, CHECKER_R * 0.8);
      dome.addColorStop(0, human ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)');
      dome.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = dome;
      c.beginPath();
      c.arc(cx, cy, CHECKER_R, 0, Math.PI * 2);
      c.fill();

      return { canvas: cnv, size };
    };
    this.checkerSprites = { human: make(true), ai: make(false) };
  }

  #drawBoard(ctx) {
    ctx.drawImage(this.boardLayer, 0, 0, W, H);
  }

  #drawHighlights(ctx) {
    if (this.turn !== 'human' || this.result !== null) return;

    // Where the machine just played, so its turn is legible after the fact.
    if (this.lastAiMoves) {
      ctx.save();
      ctx.fillStyle = 'rgba(251,113,133,0.1)';
      ctx.strokeStyle = 'rgba(251,113,133,0.35)';
      ctx.lineWidth = 1.5;
      for (const mv of this.lastAiMoves) {
        if (mv.to === 'off') continue;
        const { row } = pointSlot(mv.to);
        const x = pointX(mv.to);
        const y = row === 'top' ? BOARD_Y : BOARD_Y + ROW_H;
        ctx.fillRect(x + 1, y + 1, POINT_W - 2, ROW_H - 2);
        ctx.strokeRect(x + 1, y + 1, POINT_W - 2, ROW_H - 2);
      }
      ctx.restore();
    }

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

    // No selection yet: mark every checker that can legally move.
    if (this.selection == null) {
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffd23f';
      for (const from of this.legalSources ?? []) {
        if (from === 'bar') {
          ctx.lineWidth = 2.5;
          ctx.strokeRect(BOARD_X + 6 * POINT_W + 2, BOARD_Y + ROW_H + 2, BAR_W - 4, ROW_H - 4);
          continue;
        }
        const { row } = pointSlot(from);
        const x = pointX(from);
        const y = row === 'top' ? BOARD_Y + 2 : BOARD_Y + BOARD_H - 5;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(x + 8, y, POINT_W - 16, 3);
      }
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
        this.text(ctx, `${n}`, x, y, { size: 11, color: human ? '#0b1526' : '#e9edf6', weight: 700 });
      }
    }
  }

  #drawChecker(ctx, x, y, human) {
    const sprite = this.checkerSprites[human ? 'human' : 'ai'];
    ctx.drawImage(sprite.canvas, x - sprite.size / 2, y - sprite.size / 2, sprite.size, sprite.size);
  }

  #drawBar(ctx) {
    const cx = BOARD_X + 6 * POINT_W + BAR_W / 2;
    const humanShown = Math.min(this.bar.human, 4);
    for (let k = 0; k < humanShown; k++) {
      this.#drawChecker(ctx, cx, BOARD_Y + ROW_H + 24 + k * (CHECKER_R * 1.7), true);
    }
    if (this.bar.human > 4) {
      this.text(ctx, `${this.bar.human}`, cx, BOARD_Y + ROW_H + 24 + 3 * (CHECKER_R * 1.7), { size: 11, color: '#0b1526', weight: 700 });
    }
    const aiShown = Math.min(this.bar.ai, 4);
    for (let k = 0; k < aiShown; k++) {
      this.#drawChecker(ctx, cx, BOARD_Y + ROW_H - 24 - k * (CHECKER_R * 1.7), false);
    }
    if (this.bar.ai > 4) {
      this.text(ctx, `${this.bar.ai}`, cx, BOARD_Y + ROW_H - 24 - 3 * (CHECKER_R * 1.7), { size: 11, color: '#e9edf6', weight: 700 });
    }
  }

  #drawOff(ctx) {
    // Borne-off checkers pile up as flat slabs, the way they do at the side
    // of a real board.
    const slab = (count, color, fromY, dir) => {
      ctx.save();
      const shown = Math.min(count, 15);
      for (let k = 0; k < shown; k++) {
        const y = fromY + dir * k * 8;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        this.roundRect(ctx, OFF_X + 7, y, OFF_W - 14, 6, 3).fill();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffffff';
        this.roundRect(ctx, OFF_X + 9, y + 1, OFF_W - 26, 2, 1).fill();
      }
      ctx.restore();
    };
    slab(this.off.ai, '#7d2f44', BOARD_Y + 40, 1);
    slab(this.off.human, '#9db8dd', BOARD_Y + BOARD_H - 46, -1);

    this.text(ctx, `${this.off.ai}`, OFF_X + OFF_W / 2, BOARD_Y + 16, { size: 16, color: '#fb7185', weight: 700 });
    this.text(ctx, 'OFF', OFF_X + OFF_W / 2, BOARD_Y + 30, { size: 8, color: '#5c6478' });
    this.text(ctx, `${this.off.human}`, OFF_X + OFF_W / 2, BOARD_Y + BOARD_H - 16, { size: 16, color: '#38bdf8', weight: 700 });
    this.text(ctx, 'OFF', OFF_X + OFF_W / 2, BOARD_Y + BOARD_H - 30, { size: 8, color: '#5c6478' });
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

    // The whole roll stays visible; spent dice fade rather than vanish.
    const rem = this.remaining.slice();
    this.dice.forEach((d, i) => {
      const x = W / 2 - (this.dice.length * 26) / 2 + i * 26 + 13;
      const j = rem.indexOf(d);
      if (j >= 0) rem.splice(j, 1);
      this.#drawDie(ctx, x, 46, d, j < 0);
    });

    if (this.message) {
      this.text(ctx, this.message, W / 2, 74, { size: 11, color: '#fbbf24' });
    }
  }

  #drawDie(ctx, x, y, value, used = false) {
    ctx.save();
    if (used) ctx.globalAlpha = 0.3;
    const face = ctx.createLinearGradient(x - 10, y - 10, x + 10, y + 10);
    face.addColorStop(0, '#ffffff');
    face.addColorStop(1, '#c9d4ea');
    ctx.fillStyle = face;
    this.roundRect(ctx, x - 10, y - 10, 20, 20, 4).fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x - 10, y - 10, 20, 20, 4).stroke();
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
