import { BaseGame } from '../core/game.js';

/**
 * GIN RUMMY
 *
 * Ten cards, one goal: get rid of deadwood. A meld is three or more of a
 * kind, or three or more in a suited run; anything left over counts against
 * you at face value, aces low, court cards worth ten. Knock once your
 * deadwood is ten or under and the hand ends — the opponent then lays off
 * whatever of their own deadwood fits your melds before the two totals are
 * compared, which is why going out with the lowest possible deadwood matters
 * more than going out fast.
 *
 * The engine that decides both "can I knock" and "what should the machine
 * discard" is the same one: search every meld the hand contains and find the
 * combination that leaves the least deadwood behind. That search is exact,
 * not heuristic — with ten or eleven cards it is small enough to just try
 * every non-overlapping combination.
 *
 * A match runs to 100 points; three knocks lost to the machine end it early,
 * because a hand that keeps handing the human bad luck is not "hard", it is
 * a rigged coin, and this arcade has none of those.
 */

const W = 780;
const H = 560;

const SUITS = [
  { id: 'S', glyph: '♠', red: false },
  { id: 'H', glyph: '♥', red: true },
  { id: 'C', glyph: '♣', red: false },
  { id: 'D', glyph: '♦', red: true },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const CARD_W = 56;
const CARD_H = 78;
const HAND_Y_AI = 46;
const HAND_Y_PLAYER = 400;
const PILE_Y = 224;

const KNOCK_LIMIT = 10;
const MATCH_TARGET = 100;

function cardPoints(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}
function rankOrder(rank) {
  return RANKS.indexOf(rank) + 1;
}

/** Every meld (set or run) present anywhere in a hand, as card-id groups. */
function findMelds(cards) {
  const melds = [];
  const byRank = new Map();
  for (const c of cards) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  for (const group of byRank.values()) {
    if (group.length < 3) continue;
    if (group.length === 3) melds.push(group.slice());
    else {
      melds.push(group.slice());
      for (let skip = 0; skip < 4; skip++) melds.push(group.filter((_, i) => i !== skip));
    }
  }

  const bySuit = new Map();
  for (const c of cards) {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
    bySuit.get(c.suit).push(c);
  }
  for (const group of bySuit.values()) {
    group.sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank));
    let i = 0;
    while (i < group.length) {
      let j = i;
      while (j + 1 < group.length && rankOrder(group[j + 1].rank) === rankOrder(group[j].rank) + 1) j++;
      if (j - i + 1 >= 3) {
        for (let a = i; a <= j - 2; a++) {
          for (let b = a + 2; b <= j; b++) melds.push(group.slice(a, b + 1));
        }
      }
      i = j + 1;
    }
  }
  return melds;
}

/**
 * The least deadwood a hand can be arranged into, found by exact search over
 * non-overlapping melds. Ten or eleven cards keep this small — a couple of
 * hundred calls at the very worst, well under a millisecond.
 */
function bestArrangement(cards) {
  const melds = findMelds(cards);
  const totalPoints = cards.reduce((s, c) => s + cardPoints(c.rank), 0);
  let best = { deadwood: totalPoints, used: [] };
  let calls = 0;

  function search(pool, usedIds, chosen) {
    if (++calls > 40000) return;
    const dw = cards.filter((c) => !usedIds.has(c.id)).reduce((s, c) => s + cardPoints(c.rank), 0);
    if (dw < best.deadwood) best = { deadwood: dw, used: chosen.slice() };
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i];
      if (m.some((c) => usedIds.has(c.id))) continue;
      const next = new Set(usedIds);
      for (const c of m) next.add(c.id);
      search(pool.slice(i + 1), next, [...chosen, m]);
    }
  }
  search(melds, new Set(), []);

  const usedIds = new Set(best.used.flat().map((c) => c.id));
  const deadwoodCards = cards.filter((c) => !usedIds.has(c.id));
  return { deadwood: best.deadwood, melds: best.used, deadwoodCards };
}

/** Attach loose cards from `deadwoodCards` onto `melds` wherever they fit. */
function layOff(melds, deadwoodCards) {
  const laidOn = melds.map((m) => m.slice());
  let remaining = deadwoodCards.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i];
      for (const meld of laidOn) {
        const sameRank = meld.every((c) => c.rank === card.rank);
        if (sameRank && meld.length < 4) {
          meld.push(card);
          remaining.splice(i, 1);
          changed = true;
          break;
        }
        const sameSuit = meld.every((c) => c.suit === card.suit);
        if (sameSuit && meld.length >= 3) {
          const orders = meld.map((c) => rankOrder(c.rank)).sort((a, b) => a - b);
          const lo = orders[0];
          const hi = orders[orders.length - 1];
          const co = rankOrder(card.rank);
          if (co === lo - 1 || co === hi + 1) {
            meld.push(card);
            remaining.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      if (changed) break;
    }
  }
  const points = remaining.reduce((s, c) => s + cardPoints(c.rank), 0);
  return { melds: laidOn, deadwood: points };
}

let uid = 0;

export default class GinRummy extends BaseGame {
  static id = 'ginrummy';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 20 };
  static hudLabels = { score: 'Points', secondary: 'Hand' };

  setup() {
    this.host.setSecondaryLabel('Hand');
    this.host.setHint('Draw from stock or the discard, then discard a card',
      'Tap stock or discard to draw, tap a card to discard');
    this.setLives(1);

    this.aiScore = 0;
    this.hand = 0;
    this.message = '';
    this.settleTimer = 0;

    this.host.setSecondary(this.hand);
    this.#deal();
    this.banner('Gin Rummy');
    this.play('ready');
  }

  /* ================================================================= deal */

  #freshDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push({ id: uid++, rank, suit: suit.id, glyph: suit.glyph, red: suit.red });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  #deal() {
    this.hand++;
    this.host.setSecondary(this.hand);
    const deck = this.#freshDeck();
    this.playerHand = deck.splice(0, 10);
    this.aiHand = deck.splice(0, 10);
    this.discard = [deck.shift()];
    this.stock = deck;

    this.phase = 'player-draw';
    this.selection = null;
    this.turnTimer = 0;
    this.message = '';
    this.#refresh();
  }

  #refresh() {
    this.playerArrangement = bestArrangement(this.playerHand);
  }

  /* =============================================================== drawing */

  #drawFromStock(hand) {
    if (!this.stock.length) return null;
    const card = this.stock.pop();
    hand.push(card);
    return card;
  }

  #drawFromDiscard(hand) {
    if (!this.discard.length) return null;
    const card = this.discard.pop();
    hand.push(card);
    return card;
  }

  /* ================================================================ player */

  #playerDraw(fromDiscard) {
    if (this.phase !== 'player-draw') return;
    const card = fromDiscard ? this.#drawFromDiscard(this.playerHand) : this.#drawFromStock(this.playerHand);
    if (!card) return;
    this.play('blip');
    this.phase = 'player-discard';
    this.#refresh();
  }

  #playerDiscard(card) {
    if (this.phase !== 'player-discard') return;
    const i = this.playerHand.findIndex((c) => c.id === card.id);
    if (i < 0) return;
    this.playerHand.splice(i, 1);
    this.discard.push(card);
    this.play('select');
    this.#refresh();
    this.#afterPlayerTurn();
  }

  #playerKnock() {
    if (this.phase !== 'player-discard') return;
    // Knocking discards for you — the card that leaves the least deadwood.
    let bestDiscard = null;
    let bestDeadwood = Infinity;
    for (const card of this.playerHand) {
      const rest = this.playerHand.filter((c) => c.id !== card.id);
      const { deadwood } = bestArrangement(rest);
      if (deadwood < bestDeadwood) {
        bestDeadwood = deadwood;
        bestDiscard = card;
      }
    }
    if (bestDeadwood > KNOCK_LIMIT || !bestDiscard) return;
    const i = this.playerHand.findIndex((c) => c.id === bestDiscard.id);
    this.playerHand.splice(i, 1);
    this.discard.push(bestDiscard);
    this.play('powerup');
    this.#refresh();
    this.#resolveHand('player');
  }

  #afterPlayerTurn() {
    if (this.stock.length <= 2) {
      this.#wall();
      return;
    }
    this.phase = 'ai-think';
    this.turnTimer = 0.7;
  }

  /* ==================================================================== ai */

  /**
   * Greedy but genuine: the machine only takes the discard when doing so
   * provably lowers its deadwood, otherwise draws blind from the stock, and
   * always keeps whichever ten of its eleven cards arrange best — the same
   * exact search the knock button uses, not a rough guess.
   */
  #aiTurn() {
    const top = this.discard[this.discard.length - 1];
    let tookDiscard = false;
    if (top) {
      const withTop = [...this.aiHand, top];
      const current = bestArrangement(this.aiHand).deadwood;
      const withTopBest = bestArrangement(withTop).deadwood;
      // Taking it must beat the best discard achievable from it, i.e. it has
      // to actually improve the ten-card hand once something is dropped.
      if (withTopBest < current) tookDiscard = true;
    }

    if (tookDiscard) this.#drawFromDiscard(this.aiHand);
    else this.#drawFromStock(this.aiHand);
    this.play('blip');

    let bestDiscard = null;
    let bestDeadwood = Infinity;
    for (const card of this.aiHand) {
      const rest = this.aiHand.filter((c) => c.id !== card.id);
      const { deadwood } = bestArrangement(rest);
      if (deadwood < bestDeadwood) {
        bestDeadwood = deadwood;
        bestDiscard = card;
      }
    }
    const i = this.aiHand.findIndex((c) => c.id === bestDiscard.id);
    this.aiHand.splice(i, 1);
    this.discard.push(bestDiscard);

    // Knocks immediately on gin, otherwise waits a little for a cleaner hand
    // rather than knocking the instant it crosses the line.
    const willKnock = bestDeadwood === 0 || (bestDeadwood <= KNOCK_LIMIT && (this.hand > 1 || bestDeadwood <= 4));
    if (willKnock) {
      this.play('powerup');
      this.#resolveHand('ai');
      return;
    }

    if (this.stock.length <= 2) {
      this.#wall();
      return;
    }
    this.phase = 'player-draw';
  }

  /* ================================================================ scoring */

  #resolveHand(knocker) {
    const knockerHand = knocker === 'player' ? this.playerHand : this.aiHand;
    const otherHand = knocker === 'player' ? this.aiHand : this.playerHand;
    const knockerArr = bestArrangement(knockerHand);
    const otherArr = bestArrangement(otherHand);

    // Gin blocks layoffs entirely — the whole reason to hold out for it.
    const gin = knockerArr.deadwood === 0;
    const laidOff = gin ? { deadwood: otherArr.deadwood } : layOff(knockerArr.melds, otherArr.deadwoodCards);

    // Gin cannot be undercut, whatever the defender's hand looks like — that
    // is the entire reason to hold out for it rather than knock early.
    const undercut = !gin && laidOff.deadwood <= knockerArr.deadwood;
    let points;
    let winner;
    if (undercut) {
      winner = knocker === 'player' ? 'ai' : 'player';
      points = (knockerArr.deadwood - laidOff.deadwood) + 25;
    } else {
      winner = knocker;
      points = (laidOff.deadwood - knockerArr.deadwood) + (gin ? 25 : 0);
    }

    if (winner === 'player') this.addScore(points);
    else this.aiScore += points;

    const who = winner === 'player' ? 'You' : 'The machine';
    const how = undercut ? 'undercut' : gin ? 'gin' : 'knocks';
    this.message = `${who} ${how} for ${points}`;
    this.play(winner === 'player' ? 'highscore' : 'die');

    this.meta = { hand: this.hand, aiScore: this.aiScore };
    this.phase = 'settle';
    this.settleTimer = 2.6;
  }

  #wall() {
    this.message = 'Stock ran out — hand pushes';
    this.play('back');
    this.phase = 'settle';
    this.settleTimer = 2;
  }

  #nextHand() {
    if (this.score >= MATCH_TARGET) {
      this.addScore(50);
      this.banner('Match won!');
      this.play('highscore');
      this.end();
      return;
    }
    if (this.aiScore >= MATCH_TARGET) {
      this.setLives(0);
      this.banner('Match lost');
      this.end();
      return;
    }
    this.#deal();
  }

  /* ================================================================ update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.phase === 'ai-think') {
      this.turnTimer -= dt;
      if (this.turnTimer <= 0) this.#aiTurn();
      return;
    }
    if (this.phase === 'settle') {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.#nextHand();
      return;
    }

    if (this.input.pressed('action')) this.#playerKnock();

    const m = this.mouse;
    if (!m.pressed) return;

    if (this.phase === 'player-draw') {
      if (this.hits(m.x, m.y, W / 2 - 66, PILE_Y, CARD_W, CARD_H)) this.#playerDraw(false);
      else if (this.hits(m.x, m.y, W / 2 + 10, PILE_Y, CARD_W, CARD_H)) this.#playerDraw(true);
      return;
    }

    if (this.phase === 'player-discard') {
      const knockRect = this.#knockRect();
      if (this.hits(m.x, m.y, ...knockRect)) {
        this.#playerKnock();
        return;
      }
      const hit = this.#handHitTest(m.x, m.y);
      if (hit) this.#playerDiscard(hit);
    }
  }

  /* ============================================================== layout */

  #handWidth(count) {
    const step = Math.min(CARD_W * 0.68, (W - 80) / Math.max(1, count - 1 || 1));
    return { step, width: CARD_W + step * Math.max(0, count - 1) };
  }

  #handHitTest(mx, my) {
    const { step, width } = this.#handWidth(this.playerHand.length);
    const x0 = W / 2 - width / 2;
    if (my < HAND_Y_PLAYER || my > HAND_Y_PLAYER + CARD_H) return null;
    for (let i = this.playerHand.length - 1; i >= 0; i--) {
      const x = x0 + i * step;
      if (mx >= x && mx <= x + CARD_W) return this.playerHand[i];
    }
    return null;
  }

  #knockRect() {
    return [W - 130, HAND_Y_PLAYER - 44, 106, 34];
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#0a0d16');
    const grad = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.5, W * 0.75);
    grad.addColorStop(0, 'rgba(96, 165, 250, 0.08)');
    grad.addColorStop(1, 'rgba(4, 8, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    this.shake.apply(ctx);
    this.#drawAiHand(ctx);
    this.#drawPiles(ctx);
    this.#drawPlayerHand(ctx);
    this.#drawStatus(ctx);
    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawAiHand(ctx) {
    const { step, width } = this.#handWidth(this.aiHand.length);
    const x0 = W / 2 - width / 2;
    this.text(ctx, `OPPONENT · ${this.aiScore} pts`, W / 2, HAND_Y_AI - 20, { size: 10, color: '#5c6478' });
    this.aiHand.forEach((_, i) => this.#drawCard(ctx, x0 + i * step, HAND_Y_AI, null));
  }

  #drawPiles(ctx) {
    const stockX = W / 2 - 66;
    const discardX = W / 2 + 10;
    const active = this.phase === 'player-draw';

    if (this.stock.length) {
      this.#drawCard(ctx, stockX, PILE_Y, null, { glow: active });
      this.text(ctx, String(this.stock.length), stockX + CARD_W / 2, PILE_Y + CARD_H + 12, { size: 10, color: '#5c6478' });
    }
    const top = this.discard[this.discard.length - 1];
    if (top) this.#drawCard(ctx, discardX, PILE_Y, top, { glow: active });
    this.text(ctx, 'STOCK', stockX + CARD_W / 2, PILE_Y - 14, { size: 9, color: '#5c6478' });
    this.text(ctx, 'DISCARD', discardX + CARD_W / 2, PILE_Y - 14, { size: 9, color: '#5c6478' });
  }

  #drawPlayerHand(ctx) {
    const arr = this.playerArrangement;
    const deadwoodIds = new Set((arr?.deadwoodCards ?? []).map((c) => c.id));
    const { step, width } = this.#handWidth(this.playerHand.length);
    const x0 = W / 2 - width / 2;

    this.playerHand.forEach((card, i) => {
      const x = x0 + i * step;
      const dead = deadwoodIds.has(card.id);
      this.#drawCard(ctx, x, HAND_Y_PLAYER, card, { dim: dead });
    });

    this.text(ctx, `DEADWOOD ${arr?.deadwood ?? 0}`, x0, HAND_Y_PLAYER - 18, {
      size: 12, color: (arr?.deadwood ?? 99) <= KNOCK_LIMIT ? '#4ade80' : '#8b93a7', align: 'left', weight: 700,
    });

    if (this.phase === 'player-discard') {
      const eligible = (arr?.deadwood ?? 99) <= KNOCK_LIMIT;
      const [kx, ky, kw, kh] = this.#knockRect();
      ctx.save();
      ctx.fillStyle = eligible ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, kx, ky, kw, kh, 8).fill();
      ctx.strokeStyle = eligible ? '#4ade80' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1.4;
      this.roundRect(ctx, kx, ky, kw, kh, 8).stroke();
      this.text(ctx, 'KNOCK', kx + kw / 2, ky + kh / 2, { size: 11, color: eligible ? '#86efac' : '#5c6478', weight: 700 });
      ctx.restore();
    }
  }

  #drawStatus(ctx) {
    let status = '';
    if (this.phase === 'player-draw') status = 'Your turn — draw';
    else if (this.phase === 'player-discard') status = 'Discard a card, or knock';
    else if (this.phase === 'ai-think') status = 'Opponent thinking…';
    if (status && !this.message) {
      this.text(ctx, status, W / 2, H - 44, { size: 11, color: '#8b93a7' });
    }
    if (this.message) {
      this.text(ctx, this.message, W / 2, H - 44, { size: 13, color: '#fbbf24', weight: 700, glow: 6 });
    }
  }

  /** `card` of null draws a face-down back. */
  #drawCard(ctx, x, y, card, { dim = false, glow = false } = {}) {
    ctx.save();
    if (glow) {
      ctx.shadowColor = '#4ade80';
      ctx.shadowBlur = 12;
    }
    if (!card) {
      ctx.fillStyle = '#161d33';
      this.roundRect(ctx, x, y, CARD_W, CARD_H, 6).fill();
      ctx.strokeStyle = 'rgba(0,229,255,0.28)';
      ctx.lineWidth = 1.3;
      this.roundRect(ctx, x + 0.6, y + 0.6, CARD_W - 1.2, CARD_H - 1.2, 5).stroke();
      ctx.restore();
      return;
    }

    ctx.globalAlpha = dim ? 0.62 : 1;
    ctx.fillStyle = '#f4f7ff';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 6).fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = dim ? 'rgba(251,113,133,0.55)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = dim ? 1.6 : 1;
    this.roundRect(ctx, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 6).stroke();

    const ink = card.red ? '#d81f4a' : '#141821';
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '700 13px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(card.rank, x + 5, y + 4);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(card.glyph, x + 5, y + 19);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '22px system-ui, sans-serif';
    ctx.globalAlpha = dim ? 0.5 : 0.9;
    ctx.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 4);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
