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
const MAX_HANDS_LOST = 3;

/** Padding baked around each card sprite so its shadow has room to land. */
const PAD = 4;

/** One underline colour per meld, so the grouping reads at a glance. */
const MELD_COLORS = ['#00e5ff', '#39ff88', '#b47bff', '#ffd23f'];

/** Pip positions for 2–10, as [column, row] fractions of the pip box. */
const PIPS = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

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
    this.layers = new Map();

    this.aiScore = 0;
    this.aiHandWins = 0;
    this.hand = 0;
    this.message = '';
    this.settleTimer = 0;
    this.hoverId = null;

    this.host.setSecondary(this.hand);
    this.#deal();
    this.banner('Gin Rummy');
    this.play('ready');
  }

  teardown() {
    this.layers?.clear();
  }

  /* ================================================================= deal */

  #freshDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push({ id: uid++, rank, suit: suit.id, glyph: suit.glyph, red: suit.red, t: 1 });
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

    // The deal ripples across the table rather than appearing all at once.
    this.playerHand.forEach((c, i) => { c.t = -i * 0.05; });
    this.aiHand.forEach((c, i) => { c.t = -i * 0.05; });
    this.discard[0].t = -0.5;

    this.phase = 'player-draw';
    this.drawnDiscardId = null;
    this.turnTimer = 0;
    this.message = '';
    this.hoverId = null;
    this.#refresh();
  }

  /**
   * Recompute the best arrangement, then lay the hand out to match it: melds
   * grouped together on the left, deadwood sorted on the right. The hand is
   * the player's scratchpad — showing it pre-sorted is what makes the
   * deadwood count believable.
   */
  #refresh() {
    this.playerArrangement = bestArrangement(this.playerHand);
    const arr = this.playerArrangement;
    const ordered = [];
    this.meldSpans = [];
    arr.melds.forEach((meld, k) => {
      const sorted = meld.slice().sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank));
      this.meldSpans.push({ start: ordered.length, len: sorted.length, color: MELD_COLORS[k % MELD_COLORS.length] });
      ordered.push(...sorted);
    });
    ordered.push(...arr.deadwoodCards.slice().sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank)));
    this.playerHand = ordered;
  }

  /* =============================================================== drawing */

  #drawFromStock(hand) {
    if (!this.stock.length) return null;
    const card = this.stock.pop();
    card.t = 0;
    hand.push(card);
    return card;
  }

  #drawFromDiscard(hand) {
    if (!this.discard.length) return null;
    const card = this.discard.pop();
    card.t = 0;
    hand.push(card);
    return card;
  }

  /* ================================================================ player */

  #playerDraw(fromDiscard) {
    if (this.phase !== 'player-draw') return;
    const card = fromDiscard ? this.#drawFromDiscard(this.playerHand) : this.#drawFromStock(this.playerHand);
    if (!card) return;
    // A discard you just picked up cannot go straight back — the one thing a
    // draw from the discard pile commits you to.
    this.drawnDiscardId = fromDiscard ? card.id : null;
    this.play('blip');
    this.phase = 'player-discard';
    this.#refresh();
  }

  #playerDiscard(card) {
    if (this.phase !== 'player-discard') return;
    if (card.id === this.drawnDiscardId) {
      this.popups.add(W / 2, HAND_Y_PLAYER - 36, 'Just drawn — pick another', '#fb7185', 11);
      this.play('hit');
      return;
    }
    const i = this.playerHand.findIndex((c) => c.id === card.id);
    if (i < 0) return;
    this.playerHand.splice(i, 1);
    card.t = 0;
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
      if (card.id === this.drawnDiscardId) continue;
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
    bestDiscard.t = 0;
    this.discard.push(bestDiscard);
    this.play('powerup');
    this.#refresh();
    this.#resolveHand('player');
  }

  #afterPlayerTurn() {
    this.drawnDiscardId = null;
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

    const drawn = tookDiscard ? this.#drawFromDiscard(this.aiHand) : this.#drawFromStock(this.aiHand);
    // The machine plays by the same discard rule the player does.
    const bannedId = tookDiscard && drawn ? drawn.id : -1;
    this.play('blip');

    let bestDiscard = null;
    let bestDeadwood = Infinity;
    for (const card of this.aiHand) {
      if (card.id === bannedId) continue;
      const rest = this.aiHand.filter((c) => c.id !== card.id);
      const { deadwood } = bestArrangement(rest);
      if (deadwood < bestDeadwood) {
        bestDeadwood = deadwood;
        bestDiscard = card;
      }
    }
    const i = this.aiHand.findIndex((c) => c.id === bestDiscard.id);
    this.aiHand.splice(i, 1);
    bestDiscard.t = 0;
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

    if (winner === 'player') {
      this.addScore(points, { x: W / 2, y: PILE_Y - 30, color: gin ? '#ffd23f' : '#39ff88', label: `+${points}` });
      this.particles.emit(W / 2, PILE_Y + CARD_H / 2, {
        count: gin ? 30 : 18, speed: gin ? 170 : 130,
        color: gin ? '#ffd23f' : '#39ff88', life: 0.6, size: 2.6, shape: 'circle',
      });
    } else {
      this.aiScore += points;
      this.aiHandWins++;
      this.popups.add(W / 2, HAND_Y_AI + CARD_H + 24, `Machine +${points}`, '#fb7185', 12);
    }

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
    if (this.aiScore >= MATCH_TARGET || this.aiHandWins >= MAX_HANDS_LOST) {
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
    for (const c of this.playerHand) {
      if (c.t < 1) c.t = Math.min(1, c.t + dt / 0.26);
    }
    for (const c of this.aiHand) {
      if (c.t < 1) c.t = Math.min(1, c.t + dt / 0.26);
    }
    const top = this.discard[this.discard.length - 1];
    if (top && top.t < 1) top.t = Math.min(1, top.t + dt / 0.26);
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
    this.hoverId = this.phase === 'player-discard' ? this.#handHitTest(m.x, m.y)?.id ?? null : null;
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
    if (my < HAND_Y_PLAYER - 8 || my > HAND_Y_PLAYER + CARD_H) return null;
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
    ctx.drawImage(this.#felt(), 0, 0, W, H);

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
    this.aiHand.forEach((card, i) => this.#drawCard(ctx, x0 + i * step, HAND_Y_AI, null, { t: card.t }));
  }

  #drawPiles(ctx) {
    const stockX = W / 2 - 66;
    const discardX = W / 2 + 10;
    const active = this.phase === 'player-draw';

    if (active) {
      ctx.save();
      ctx.strokeStyle = 'rgba(74,222,128,0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      this.roundRect(ctx, stockX - 6, PILE_Y - 6, CARD_W + 12, CARD_H + 12, 8).stroke();
      this.roundRect(ctx, discardX - 6, PILE_Y - 6, CARD_W + 12, CARD_H + 12, 8).stroke();
      ctx.restore();
    }

    if (this.stock.length) {
      // A hint of depth: the shoe is a stack, not a single card.
      if (this.stock.length > 8) this.#drawCard(ctx, stockX + 2, PILE_Y + 2, null);
      this.#drawCard(ctx, stockX, PILE_Y, null);
      this.text(ctx, String(this.stock.length), stockX + CARD_W / 2, PILE_Y + CARD_H + 12, { size: 10, color: '#5c6478' });
    } else {
      this.#slot(ctx, stockX, PILE_Y);
    }
    const top = this.discard[this.discard.length - 1];
    const under = this.discard[this.discard.length - 2];
    if (under) this.#drawCard(ctx, discardX + 2, PILE_Y + 2, under);
    if (top) this.#drawCard(ctx, discardX, PILE_Y, top, { t: top.t });
    else this.#slot(ctx, discardX, PILE_Y);
    this.text(ctx, 'STOCK', stockX + CARD_W / 2, PILE_Y - 14, { size: 9, color: '#5c6478' });
    this.text(ctx, 'DISCARD', discardX + CARD_W / 2, PILE_Y - 14, { size: 9, color: '#5c6478' });
  }

  #drawPlayerHand(ctx) {
    const arr = this.playerArrangement;
    const { step, width } = this.#handWidth(this.playerHand.length);
    const x0 = W / 2 - width / 2;

    // Meld underlines first, so the cards sit on top of them.
    for (const span of this.meldSpans ?? []) {
      const sx = x0 + span.start * step;
      const sw = (span.len - 1) * step + CARD_W;
      ctx.save();
      ctx.fillStyle = span.color;
      ctx.globalAlpha = 0.55;
      ctx.shadowColor = span.color;
      ctx.shadowBlur = 6;
      this.roundRect(ctx, sx + 3, HAND_Y_PLAYER + CARD_H + 5, sw - 6, 3, 1.5).fill();
      ctx.restore();
    }

    this.playerHand.forEach((card, i) => {
      const x = x0 + i * step;
      const hovered = this.phase === 'player-discard' && card.id === this.hoverId;
      this.#drawCard(ctx, x, HAND_Y_PLAYER, card, { t: card.t, raise: hovered ? 8 : 0 });
    });

    const dw = arr?.deadwood ?? 0;
    this.text(ctx, `DEADWOOD ${dw}`, x0, HAND_Y_PLAYER - 18, {
      size: 12, color: dw <= KNOCK_LIMIT ? '#4ade80' : '#8b93a7', align: 'left', weight: 700,
      glow: dw <= KNOCK_LIMIT ? 6 : 0,
    });

    if (this.phase === 'player-discard') {
      const eligible = dw <= KNOCK_LIMIT;
      const [kx, ky, kw, kh] = this.#knockRect();
      ctx.save();
      ctx.fillStyle = eligible ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, kx, ky, kw, kh, 8).fill();
      ctx.strokeStyle = eligible ? '#4ade80' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1.4;
      if (eligible) {
        ctx.shadowColor = '#4ade80';
        ctx.shadowBlur = 10;
      }
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

  #slot(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 7).fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.18)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.4;
    this.roundRect(ctx, x + 0.7, y + 0.7, CARD_W - 1.4, CARD_H - 1.4, 6).stroke();
    ctx.restore();
  }

  /** `card` of null draws a face-down back. `t` slides it in, `raise` lifts it. */
  #drawCard(ctx, x, y, card, { t = 1, raise = 0 } = {}) {
    const tt = Math.max(0, t);
    const e = 1 - (1 - tt) ** 3;
    const yy = y - (1 - e) * 22 - raise;
    ctx.save();
    ctx.globalAlpha = Math.min(1, tt * 2.5);
    ctx.drawImage(this.#cardSprite(card), x - PAD, yy - PAD, CARD_W + PAD * 2, CARD_H + PAD * 2);
    ctx.restore();
  }

  /* ============================================================= sprites */

  /** Fetch-or-paint an offscreen layer, rendered once at device resolution. */
  #layer(key, w, h, paint) {
    let c = this.layers.get(key);
    if (c) return c;
    const dpr = Math.min(2, this.host.dpr || 1);
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    paint(g);
    this.layers.set(key, c);
    return c;
  }

  /** The table, painted once: violet wash, corner vignette, faint weave. */
  #felt() {
    return this.#layer('felt', W, H, (g) => {
      g.fillStyle = '#0a0d16';
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.5, W * 0.75);
      glow.addColorStop(0, 'rgba(180,123,255,0.09)');
      glow.addColorStop(1, 'rgba(4,8,16,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      const vig = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.4)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.02)';
      for (let y = 8; y < H; y += 16) {
        for (let x = 8; x < W; x += 16) g.fillRect(x, y, 1, 1);
      }
    });
  }

  #cardSprite(card) {
    const key = card ? `card:${card.rank}${card.suit}` : 'back';
    return this.#layer(key, CARD_W + PAD * 2, CARD_H + PAD * 2, (g) => {
      if (card) this.#paintFace(g, PAD, PAD, card);
      else this.#paintBack(g, PAD, PAD);
    });
  }

  /** Crisp card face: top-lit body, corner indices, pips or a court panel. */
  #paintFace(g, x, y, card) {
    const s = CARD_W / 84;
    const value = card.rank === 'A' ? 1
      : card.rank === 'J' ? 11 : card.rank === 'Q' ? 12 : card.rank === 'K' ? 13
      : Number(card.rank);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    const body = g.createLinearGradient(0, y, 0, y + CARD_H);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.12, '#f5f8fe');
    body.addColorStop(1, '#dbe2f0');
    g.fillStyle = body;
    this.roundRect(g, x, y, CARD_W, CARD_H, 6).fill();
    g.restore();
    g.strokeStyle = 'rgba(13,18,30,0.5)';
    g.lineWidth = 1;
    this.roundRect(g, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 5.5).stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    this.roundRect(g, x + 1.5, y + 1.5, CARD_W - 3, CARD_H - 3, 4.5).stroke();

    g.fillStyle = card.red ? '#e11d55' : '#1c2230';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // Corner indices, the second rotated into the opposite corner.
    for (const rot of [false, true]) {
      g.save();
      if (rot) {
        g.translate(x * 2 + CARD_W, y * 2 + CARD_H);
        g.rotate(Math.PI);
      }
      g.font = `700 ${Math.round(18 * s)}px ui-monospace, "SF Mono", Menlo, monospace`;
      g.fillText(card.rank, x + 14 * s, y + 15 * s);
      g.font = `${Math.round(15 * s)}px system-ui, sans-serif`;
      g.fillText(card.glyph, x + 14 * s, y + 33 * s);
      g.restore();
    }

    if (value === 1) {
      g.font = `${Math.round(44 * s)}px system-ui, sans-serif`;
      g.shadowColor = card.red ? 'rgba(225,29,85,0.4)' : 'rgba(28,34,48,0.35)';
      g.shadowBlur = 8 * s;
      g.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 2 * s);
    } else if (value >= 11) {
      // Court cards get a double-ruled panel instead of a figure.
      const px = x + 19 * s;
      const py = y + 24 * s;
      const pw = CARD_W - 38 * s;
      const ph = CARD_H - 48 * s;
      g.strokeStyle = card.red ? 'rgba(225,29,85,0.45)' : 'rgba(28,34,48,0.4)';
      g.lineWidth = 1;
      this.roundRect(g, px, py, pw, ph, 5 * s).stroke();
      this.roundRect(g, px + 2.5 * s, py + 2.5 * s, pw - 5 * s, ph - 5 * s, 3.5 * s).stroke();
      g.font = `700 ${Math.round(30 * s)}px ui-monospace, "SF Mono", Menlo, monospace`;
      g.fillText(card.rank, x + CARD_W / 2, y + CARD_H / 2 - 6 * s);
      g.font = `${Math.round(17 * s)}px system-ui, sans-serif`;
      g.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 18 * s);
    } else {
      // Number cards carry their real pip layout, lower half upside down.
      g.font = `${Math.round(17 * s)}px system-ui, sans-serif`;
      const left = x + 28 * s;
      const right = x + CARD_W - 28 * s;
      const top = y + 28 * s;
      const bottom = y + CARD_H - 28 * s;
      for (const [cx, cy] of PIPS[value]) {
        const px = left + (right - left) * cx;
        const py = top + (bottom - top) * cy;
        if (cy > 0.5) {
          g.save();
          g.translate(px, py);
          g.rotate(Math.PI);
          g.fillText(card.glyph, 0, s);
          g.restore();
        } else {
          g.fillText(card.glyph, px, py + s);
        }
      }
    }
  }

  /** Card back: indigo body, cyan lattice, a twin-diamond neon motif. */
  #paintBack(g, x, y) {
    const s = CARD_W / 84;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    const body = g.createLinearGradient(0, y, 0, y + CARD_H);
    body.addColorStop(0, '#1b2440');
    body.addColorStop(1, '#111830');
    g.fillStyle = body;
    this.roundRect(g, x, y, CARD_W, CARD_H, 6).fill();
    g.restore();
    g.strokeStyle = 'rgba(0,229,255,0.45)';
    g.lineWidth = 1.3;
    this.roundRect(g, x + 0.65, y + 0.65, CARD_W - 1.3, CARD_H - 1.3, 5).stroke();

    g.save();
    this.roundRect(g, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 3.5).clip();
    g.strokeStyle = 'rgba(0,229,255,0.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = -CARD_H; i < CARD_W + CARD_H; i += 8) {
      g.moveTo(x + i, y + CARD_H);
      g.lineTo(x + i + CARD_H, y);
      g.moveTo(x + i, y);
      g.lineTo(x + i + CARD_H, y + CARD_H);
    }
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(0,229,255,0.28)';
    this.roundRect(g, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 3.5).stroke();

    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#131b33';
    g.fillRect(-12 * s, -12 * s, 24 * s, 24 * s);
    g.strokeStyle = 'rgba(0,229,255,0.55)';
    g.lineWidth = 1.1;
    g.shadowColor = '#00e5ff';
    g.shadowBlur = 6;
    g.strokeRect(-9 * s, -9 * s, 18 * s, 18 * s);
    g.strokeStyle = 'rgba(255,46,136,0.6)';
    g.shadowColor = '#ff2e88';
    g.strokeRect(-4.5 * s, -4.5 * s, 9 * s, 9 * s);
    g.restore();
  }
}
