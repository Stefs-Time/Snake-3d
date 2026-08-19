import { BaseGame } from '../core/game.js';

/**
 * BLACKJACK
 *
 * A six-deck shoe against a dealer who plays a fixed, published strategy —
 * stand on all 17s, no peek unless the up-card could make one. That peek
 * matters: a real dealer checks for blackjack immediately when showing an
 * Ace or a ten, and if you skip it a player natural can "win" against a
 * dealer blackjack it should have pushed against. Getting that one rule
 * wrong is the difference between a fair game and a leak.
 *
 * Betting is escrowed the moment a chip is clicked, the same way a real
 * table's stack shrinks as you place chips, and winnings are the only thing
 * the leaderboard ever sees — a losing hand costs chips, never score, so a
 * bad run cannot submit a negative number.
 */

const W = 760;
const H = 560;

const CARD_W = 60;
const CARD_H = 84;
const OVERLAP = 24; // horizontal step between cards in a hand

const SUITS = [
  { id: 'S', glyph: '♠', red: false },
  { id: 'H', glyph: '♥', red: true },
  { id: 'C', glyph: '♣', red: false },
  { id: 'D', glyph: '♦', red: true },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const DECKS = 6;
const RESHUFFLE_BELOW = 60; // cards left in the shoe before a fresh shuffle

const CHIP_VALUES = [10, 25, 50, 100];
const CHIP_COLORS = { 10: '#38bdf8', 25: '#4ade80', 50: '#fb923c', 100: '#c084fc' };
const START_CHIPS = 1000;

const DEALER_Y = 68;
const PLAYER_Y = 296;
const BAR_Y = 452;

/** Padding baked around each card sprite so its shadow has room to land. */
const PAD = 4;

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

function rankValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

/** Soft-ace-aware total: 11s demote to 1 one at a time until at or under 21. */
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += rankValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  if (aces === 0) soft = false;
  return { total, soft };
}

export default class Blackjack extends BaseGame {
  static id = 'blackjack';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 20 };
  static hudLabels = { score: 'Winnings', secondary: 'Chips' };

  setup() {
    this.host.setSecondaryLabel('Chips');
    this.host.setHint('Click chips to bet, then Deal · Hit, Stand, Double or Split',
      'Tap chips to bet, then Deal · Hit, Stand, Double or Split');
    this.setLives(1);
    this.layers = new Map();

    this.shoe = [];
    this.holeFlip = 1;
    this.chips = START_CHIPS;
    this.bet = 0;
    this.hands = [];
    this.dealerHand = [];
    this.dealerHoleHidden = true;
    this.activeHand = 0;
    this.phase = 'bet'; // bet -> player -> dealer -> settle -> bet
    this.settleTimer = 0;
    this.dealerTimer = 0;
    this.roundNo = 0;
    this.message = '';

    this.host.setSecondary(this.chips);
    this.banner('Place your bet');
    this.play('ready');
  }

  teardown() {
    this.layers?.clear();
  }

  /* ================================================================= shoe */

  #freshShoe() {
    const shoe = [];
    for (let d = 0; d < DECKS; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          shoe.push({ rank, suit: suit.id, glyph: suit.glyph, red: suit.red });
        }
      }
    }
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
  }

  #draw() {
    if (this.shoe.length <= RESHUFFLE_BELOW) this.shoe = this.#freshShoe();
    const card = this.shoe.pop();
    card.t = 0; // slides in over the next few frames
    return card;
  }

  /* =============================================================== betting */

  #addChip(value) {
    if (this.phase !== 'bet') return;
    if (this.chips < value) {
      this.play('hit');
      return;
    }
    this.chips -= value;
    this.bet += value;
    this.host.setSecondary(this.chips);
    this.play('blip');
  }

  #clearBet() {
    if (this.phase !== 'bet' || this.bet === 0) return;
    this.chips += this.bet;
    this.bet = 0;
    this.host.setSecondary(this.chips);
    this.play('back');
  }

  /* ================================================================= deal */

  #startRound() {
    if (this.phase !== 'bet' || this.bet <= 0) return;
    this.roundNo++;
    this.host.setSecondary(this.chips);

    const playerCards = [this.#draw(), this.#draw()];
    this.dealerHand = [this.#draw(), this.#draw()];
    this.dealerHoleHidden = true;

    this.hands = [{
      cards: playerCards,
      bet: this.bet,
      done: false,
      doubled: false,
      isSplit: false,
      splitAces: false,
      result: null,
    }];
    this.activeHand = 0;

    // A real dealer only checks the hole card when the up-card could make a
    // natural — anything else cannot possibly complete to 21 on two cards.
    const up = this.dealerHand[0];
    const dealerCouldHaveNatural = up.rank === 'A' || rankValue(up.rank) === 10;
    const dealerNatural = dealerCouldHaveNatural && handValue(this.dealerHand).total === 21;
    const playerNatural = handValue(playerCards).total === 21;

    if (dealerNatural || playerNatural) {
      this.dealerHoleHidden = false;
      this.holeFlip = 0;
      const hand = this.hands[0];
      if (playerNatural && dealerNatural) {
        hand.result = 'push';
        this.chips += hand.bet;
      } else if (playerNatural) {
        hand.result = 'blackjack';
        this.chips += Math.round(hand.bet * 2.5);
        const won = Math.round(hand.bet * 1.5);
        this.#award(won, { x: W / 2, y: PLAYER_Y - 10, color: '#ffd23f', label: `+$${won}` });
        this.particles.emit(W / 2, PLAYER_Y + CARD_H / 2, {
          count: 22, speed: 150, color: '#ffd23f', life: 0.6, size: 2.6, shape: 'circle',
        });
      } else {
        hand.result = 'lose';
      }
      this.host.setSecondary(this.chips);
      this.message = playerNatural && dealerNatural ? 'Push — both blackjack'
        : playerNatural ? 'Blackjack!' : 'Dealer blackjack';
      this.play(playerNatural && !dealerNatural ? 'highscore' : playerNatural ? 'back' : 'die');
      this.meta = { round: this.roundNo, chips: this.chips };
      this.phase = 'settle';
      this.settleTimer = 2.4;
      return;
    }

    this.phase = 'player';
    this.play('select');
  }

  #award(points, at) {
    if (points > 0) this.addScore(points, at);
  }

  /* ============================================================== actions */

  get #hand() {
    return this.hands[this.activeHand];
  }

  #canDouble(hand) {
    return hand.cards.length === 2 && !hand.splitAces && this.chips >= hand.bet;
  }

  #canSplit(hand) {
    if (this.hands.length > 1 || hand.cards.length !== 2) return false;
    if (this.chips < hand.bet) return false;
    return rankValue(hand.cards[0].rank) === rankValue(hand.cards[1].rank);
  }

  #hit() {
    const hand = this.#hand;
    if (!hand || hand.done || this.phase !== 'player') return;
    hand.cards.push(this.#draw());
    this.play('blip');
    if (handValue(hand.cards).total > 21) {
      hand.done = true;
      hand.result = 'bust';
      this.#advanceHand();
    }
  }

  #stand() {
    const hand = this.#hand;
    if (!hand || hand.done || this.phase !== 'player') return;
    hand.done = true;
    this.play('select');
    this.#advanceHand();
  }

  #double() {
    const hand = this.#hand;
    if (!hand || hand.done || this.phase !== 'player' || !this.#canDouble(hand)) return;
    this.chips -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    this.host.setSecondary(this.chips);
    hand.cards.push(this.#draw());
    this.play('powerup');
    hand.done = true;
    if (handValue(hand.cards).total > 21) hand.result = 'bust';
    this.#advanceHand();
  }

  #split() {
    const hand = this.#hand;
    if (!hand || hand.done || this.phase !== 'player' || !this.#canSplit(hand)) return;
    this.chips -= hand.bet;
    this.host.setSecondary(this.chips);

    const isAces = hand.cards[0].rank === 'A';
    const second = {
      cards: [hand.cards.pop()],
      bet: hand.bet,
      done: false,
      doubled: false,
      isSplit: true,
      splitAces: isAces,
      result: null,
    };
    hand.isSplit = true;
    hand.splitAces = isAces;

    hand.cards.push(this.#draw());
    second.cards.push(this.#draw());

    // Split aces get exactly one card each and cannot be acted on further —
    // the standard rule that keeps a pair of aces from being farmed for 21s.
    if (isAces) {
      hand.done = true;
      second.done = true;
    }

    this.hands = [hand, second];
    this.play('toggle');
    if (isAces) this.#advanceHand();
  }

  #advanceHand() {
    this.activeHand++;
    while (this.activeHand < this.hands.length && this.hands[this.activeHand].done) {
      this.activeHand++;
    }
    if (this.activeHand >= this.hands.length) this.#startDealer();
  }

  /* =========================================================== dealer AI */

  #startDealer() {
    // No point drawing a card the table will never see: every hand busted.
    if (this.hands.every((h) => h.result === 'bust')) {
      this.dealerHoleHidden = false;
      this.holeFlip = 0;
      this.#settle();
      return;
    }
    this.phase = 'dealer';
    this.dealerHoleHidden = false;
    this.holeFlip = 0;
    this.dealerTimer = 0.7;
  }

  #dealerStep() {
    // Stands on all 17s, including soft — the common, simple table rule.
    const { total } = handValue(this.dealerHand);
    if (total < 17) {
      this.dealerHand.push(this.#draw());
      this.play('blip');
      this.dealerTimer = 0.7;
      return;
    }
    this.#settle();
  }

  #settle() {
    const dealer = handValue(this.dealerHand);
    const dealerBust = dealer.total > 21;

    const n = this.hands.length;
    this.hands.forEach((hand, i) => {
      if (hand.result) return; // already resolved (bust, or a natural)
      const total = handValue(hand.cards).total;
      const cx = n === 1 ? W / 2 : W * (i === 0 ? 0.3 : 0.7);
      if (dealerBust || total > dealer.total) {
        hand.result = 'win';
        this.chips += hand.bet * 2;
        this.#award(hand.bet, { x: cx, y: PLAYER_Y - 10, color: '#4ade80', label: `+$${hand.bet}` });
        this.particles.emit(cx, PLAYER_Y + CARD_H / 2, {
          count: 14, speed: 130, color: '#39ff88', life: 0.55, size: 2.6, shape: 'circle',
        });
      } else if (total === dealer.total) {
        hand.result = 'push';
        this.chips += hand.bet;
      } else {
        hand.result = 'lose';
      }
    });

    this.host.setSecondary(this.chips);
    const wins = this.hands.filter((h) => h.result === 'win' || h.result === 'blackjack').length;
    const allBust = this.hands.every((h) => h.result === 'bust');
    this.message = allBust ? 'Bust'
      : dealerBust ? 'Dealer busts!'
      : wins === this.hands.length ? 'You win!' : wins > 0 ? 'Split result' : 'Dealer wins';
    this.play(wins > 0 ? 'highscore' : dealerBust ? 'highscore' : 'die');
    this.meta = { round: this.roundNo, chips: this.chips };
    this.phase = 'settle';
    this.settleTimer = 2.2;
  }

  #nextRound() {
    // Below the smallest chip there is no legal bet left to place.
    if (this.chips < CHIP_VALUES[0]) {
      this.setLives(0);
      this.end();
      return;
    }
    this.bet = 0;
    this.hands = [];
    this.dealerHand = [];
    this.dealerHoleHidden = true;
    this.holeFlip = 1;
    this.phase = 'bet';
    this.message = '';
  }

  /* ================================================================ input */

  update(dt) {
    this.updateEffects(dt);
    for (const c of this.dealerHand) {
      if (c.t < 1) c.t = Math.min(1, c.t + dt / 0.26);
    }
    for (const hand of this.hands) {
      for (const c of hand.cards) {
        if (c.t < 1) c.t = Math.min(1, c.t + dt / 0.26);
      }
    }
    if (this.holeFlip < 1) this.holeFlip = Math.min(1, this.holeFlip + dt / 0.3);
    if (this.over) return;

    if (this.phase === 'dealer') {
      this.dealerTimer -= dt;
      if (this.dealerTimer <= 0) this.#dealerStep();
    } else if (this.phase === 'settle') {
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.#nextRound();
    }

    if (this.input.keyPressed('KeyH')) this.#hit();
    if (this.input.keyPressed('KeyT')) this.#stand();
    if (this.input.keyPressed('KeyO')) this.#double();
    if (this.input.keyPressed('KeyI')) this.#split();
    if (this.input.keyPressed('Enter')) this.#startRound();

    const m = this.mouse;
    if (!m.pressed) return;

    for (const btn of this.#buttons()) {
      if (!btn.enabled) continue;
      if (this.hits(m.x, m.y, btn.x, btn.y, btn.w, btn.h)) {
        btn.action();
        return;
      }
    }
  }

  /* ============================================================= buttons */

  #buttons() {
    const out = [];
    const chipY = BAR_Y;
    const chipW = 58;
    const gap = 10;
    let x = 24;

    if (this.phase === 'bet') {
      for (const value of CHIP_VALUES) {
        out.push({
          id: `chip${value}`, label: `$${value}`, x, y: chipY, w: chipW, h: 46,
          enabled: this.chips >= value, kind: 'chip', value,
          action: () => this.#addChip(value),
        });
        x += chipW + gap;
      }
      out.push({
        id: 'clear', label: 'CLEAR', x, y: chipY, w: 78, h: 46, enabled: this.bet > 0,
        action: () => this.#clearBet(),
      });
      x += 78 + gap;
      out.push({
        id: 'deal', label: 'DEAL', x, y: chipY, w: 100, h: 46, enabled: this.bet > 0, primary: true,
        action: () => this.#startRound(),
      });
    } else if (this.phase === 'player') {
      const hand = this.#hand;
      const w = 130;
      const labels = [
        { id: 'hit', label: 'HIT', enabled: true, action: () => this.#hit() },
        { id: 'stand', label: 'STAND', enabled: true, action: () => this.#stand() },
        { id: 'double', label: 'DOUBLE', enabled: hand ? this.#canDouble(hand) : false, action: () => this.#double() },
        { id: 'split', label: 'SPLIT', enabled: hand ? this.#canSplit(hand) : false, action: () => this.#split() },
      ];
      let bx = W / 2 - (labels.length * (w + gap) - gap) / 2;
      for (const def of labels) {
        out.push({ ...def, x: bx, y: chipY, w, h: 46, primary: def.id === 'hit' });
        bx += w + gap;
      }
    }
    return out;
  }

  #drawButtons(ctx) {
    for (const btn of this.#buttons()) {
      ctx.save();
      const on = btn.enabled;
      if (btn.kind === 'chip') {
        const cx = btn.x + btn.w / 2;
        const cy = btn.y + btn.h / 2;
        this.glowCircle(ctx, cx, cy, 22, on ? CHIP_COLORS[btn.value] : '#2a3142', on ? 10 : 0);
        // The dashed edge spots that make a chip read as a chip.
        ctx.strokeStyle = 'rgba(4,6,10,0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 6.5]);
        ctx.beginPath();
        ctx.arc(cx, cy, 18.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.stroke();
        this.text(ctx, btn.label, cx, cy, {
          size: 11, color: on ? '#04060a' : '#5c6478', weight: 700,
        });
      } else {
        ctx.fillStyle = !on ? 'rgba(255,255,255,0.03)' : btn.primary ? 'rgba(74,222,128,0.22)' : 'rgba(255,255,255,0.06)';
        this.roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 8).fill();
        ctx.strokeStyle = !on ? 'rgba(255,255,255,0.08)' : btn.primary ? '#4ade80' : 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1.4;
        this.roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 8).stroke();
        this.text(ctx, btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2, {
          size: 12, color: !on ? '#5c6478' : btn.primary ? '#86efac' : '#e9edf6', weight: 700,
        });
      }
      ctx.restore();
    }
  }

  /* ================================================================= draw */

  draw(ctx) {
    ctx.drawImage(this.#felt(), 0, 0, W, H);

    ctx.save();
    this.shake.apply(ctx);

    this.#drawDealer(ctx);
    this.#drawPlayer(ctx);
    this.#drawBetTray(ctx);
    this.#drawButtons(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawHand(ctx, cards, x, y, hideLast) {
    cards.forEach((card, i) => {
      const cx = x + i * OVERLAP;
      const hidden = hideLast && i === cards.length - 1;
      this.#drawCard(ctx, cx, y, hidden ? null : card, { t: card.t ?? 1 });
    });
  }

  #handWidth(count) {
    return CARD_W + Math.max(0, count - 1) * OVERLAP;
  }

  #drawDealer(ctx) {
    const { total } = handValue(this.dealerHand);
    const width = this.#handWidth(this.dealerHand.length);
    const x = W / 2 - width / 2;
    this.text(ctx, 'DEALER', W / 2, DEALER_Y - 18, { size: 10, color: '#5c6478' });
    this.dealerHand.forEach((card, i) => {
      const hidden = this.dealerHoleHidden && i === 1;
      const flip = !this.dealerHoleHidden && i === 1 ? this.holeFlip : 1;
      this.#drawCard(ctx, x + i * OVERLAP, DEALER_Y, hidden ? null : card, { t: card.t ?? 1, flip });
    });
    if (!this.dealerHoleHidden && this.dealerHand.length) {
      this.text(ctx, String(total), W / 2, DEALER_Y + CARD_H + 8, { size: 13, color: '#e9edf6', weight: 700 });
    }
  }

  #drawPlayer(ctx) {
    const n = this.hands.length;
    this.hands.forEach((hand, i) => {
      const cx = n === 1 ? W / 2 : W * (i === 0 ? 0.3 : 0.7);
      const width = this.#handWidth(hand.cards.length);
      const x = cx - width / 2;
      const active = this.phase === 'player' && i === this.activeHand;

      this.#drawHand(ctx, hand.cards, x, PLAYER_Y, false);

      const { total, soft } = handValue(hand.cards);
      const label = hand.result === 'bust' ? 'BUST'
        : hand.result === 'blackjack' ? 'BLACKJACK'
        : soft ? `${total} soft` : String(total);
      this.text(ctx, label, cx, PLAYER_Y + CARD_H + 10, {
        size: 13, color: hand.result === 'bust' ? '#fb7185' : active ? '#4ade80' : '#e9edf6', weight: 700,
        glow: active ? 8 : 0,
      });

      if (hand.result && hand.result !== 'bust' && hand.result !== 'blackjack') {
        const text = hand.result === 'win' ? 'WIN' : hand.result === 'push' ? 'PUSH' : 'LOSE';
        const color = hand.result === 'win' ? '#4ade80' : hand.result === 'push' ? '#fbbf24' : '#fb7185';
        this.text(ctx, text, cx, PLAYER_Y + CARD_H + 30, { size: 11, color });
      }

      if (active) {
        ctx.save();
        ctx.strokeStyle = 'rgba(74,222,128,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        this.roundRect(ctx, x - 8, PLAYER_Y - 8, width + 16, CARD_H + 16, 10).stroke();
        ctx.restore();
      }
    });

    if (this.message) {
      this.text(ctx, this.message, W / 2, PLAYER_Y - 26, { size: 14, color: '#fbbf24', weight: 700, glow: 6 });
    }
  }

  #drawBetTray(ctx) {
    const bet = this.phase === 'bet' ? this.bet : this.hands.reduce((n, h) => n + h.bet, 0);
    this.text(ctx, `BET  $${bet}`, W / 2, BAR_Y - 18, { size: 11, color: '#8b93a7' });
    if (bet <= 0 || this.phase !== 'bet') return;

    // The escrowed bet as real chip stacks, broken down greedily by value.
    ctx.save();
    let remaining = bet;
    const stacks = [];
    for (let i = CHIP_VALUES.length - 1; i >= 0; i--) {
      const v = CHIP_VALUES[i];
      const count = Math.floor(remaining / v);
      remaining -= count * v;
      if (count > 0) stacks.push({ value: v, count: Math.min(count, 8) });
    }
    const stackW = 30;
    let sx = W / 2 - (stacks.length * stackW) / 2 + stackW / 2;
    const sy = BAR_Y - 40;
    for (const stack of stacks) {
      for (let i = 0; i < stack.count; i++) {
        const cy = sy - i * 4;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(sx, cy + 2, 12, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CHIP_COLORS[stack.value];
        ctx.beginPath();
        ctx.ellipse(sx, cy, 12, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(4,6,10,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      sx += stackW;
    }
    ctx.restore();
  }

  /** `card` of null draws a face-down back. `t` slides it in, `flip` turns it. */
  #drawCard(ctx, x, y, card, { t = 1, flip = 1 } = {}) {
    const e = 1 - (1 - t) ** 3;
    const yy = y - (1 - e) * 26;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2.5);
    if (flip < 1) {
      const w = Math.max(2, CARD_W * Math.abs(Math.cos(flip * Math.PI)));
      const sprite = this.#cardSprite(flip > 0.5 ? card : null);
      ctx.drawImage(sprite, x + (CARD_W - w) / 2 - PAD, yy - PAD, w + PAD * 2, CARD_H + PAD * 2);
    } else {
      ctx.drawImage(this.#cardSprite(card), x - PAD, yy - PAD, CARD_W + PAD * 2, CARD_H + PAD * 2);
    }
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

  /** The table, painted once: green wash, corner vignette, faint weave. */
  #felt() {
    return this.#layer('felt', W, H, (g) => {
      g.fillStyle = '#07110c';
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W / 2, H * 0.3, 40, W / 2, H * 0.5, W * 0.75);
      glow.addColorStop(0, 'rgba(74,222,128,0.11)');
      glow.addColorStop(1, 'rgba(4,12,8,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      const vig = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.4)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);
      // The dealer's arc, the one line every blackjack table has.
      g.strokeStyle = 'rgba(74,222,128,0.14)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(W / 2, DEALER_Y - 130, 320, Math.PI * 0.22, Math.PI * 0.78);
      g.stroke();
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
    this.roundRect(g, x, y, CARD_W, CARD_H, 7).fill();
    g.restore();
    g.strokeStyle = 'rgba(13,18,30,0.5)';
    g.lineWidth = 1;
    this.roundRect(g, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 6.5).stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    this.roundRect(g, x + 1.5, y + 1.5, CARD_W - 3, CARD_H - 3, 5.5).stroke();

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
      g.font = `700 ${Math.round(17 * s)}px ui-monospace, "SF Mono", Menlo, monospace`;
      g.fillText(card.rank, x + 14 * s, y + 15 * s);
      g.font = `${Math.round(14 * s)}px system-ui, sans-serif`;
      g.fillText(card.glyph, x + 14 * s, y + 32 * s);
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
      const py = y + 22 * s;
      const pw = CARD_W - 38 * s;
      const ph = CARD_H - 44 * s;
      g.strokeStyle = card.red ? 'rgba(225,29,85,0.45)' : 'rgba(28,34,48,0.4)';
      g.lineWidth = 1;
      this.roundRect(g, px, py, pw, ph, 5 * s).stroke();
      this.roundRect(g, px + 2.5 * s, py + 2.5 * s, pw - 5 * s, ph - 5 * s, 3.5 * s).stroke();
      g.font = `700 ${Math.round(30 * s)}px ui-monospace, "SF Mono", Menlo, monospace`;
      g.fillText(card.rank, x + CARD_W / 2, y + CARD_H / 2 - 7 * s);
      g.font = `${Math.round(16 * s)}px system-ui, sans-serif`;
      g.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 16 * s);
    } else {
      // Number cards carry their real pip layout, lower half upside down.
      g.font = `${Math.round(15 * s)}px system-ui, sans-serif`;
      const left = x + 27 * s;
      const right = x + CARD_W - 27 * s;
      const top = y + 26 * s;
      const bottom = y + CARD_H - 26 * s;
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
    this.roundRect(g, x, y, CARD_W, CARD_H, 7).fill();
    g.restore();
    g.strokeStyle = 'rgba(0,229,255,0.45)';
    g.lineWidth = 1.4;
    this.roundRect(g, x + 0.7, y + 0.7, CARD_W - 1.4, CARD_H - 1.4, 6).stroke();

    g.save();
    this.roundRect(g, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 4).clip();
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
    this.roundRect(g, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 4).stroke();

    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#131b33';
    g.fillRect(-13 * s, -13 * s, 26 * s, 26 * s);
    g.strokeStyle = 'rgba(0,229,255,0.55)';
    g.lineWidth = 1.2;
    g.shadowColor = '#00e5ff';
    g.shadowBlur = 7;
    g.strokeRect(-10 * s, -10 * s, 20 * s, 20 * s);
    g.strokeStyle = 'rgba(255,46,136,0.6)';
    g.shadowColor = '#ff2e88';
    g.strokeRect(-5 * s, -5 * s, 10 * s, 10 * s);
    g.restore();
  }
}
