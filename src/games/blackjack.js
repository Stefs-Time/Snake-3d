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

    this.shoe = [];
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
    return this.shoe.pop();
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
    if (this.bet <= 0) return;
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
      const hand = this.hands[0];
      if (playerNatural && dealerNatural) {
        hand.result = 'push';
        this.chips += hand.bet;
      } else if (playerNatural) {
        hand.result = 'blackjack';
        this.chips += Math.round(hand.bet * 2.5);
        this.#award(Math.round(hand.bet * 1.5));
      } else {
        hand.result = 'lose';
      }
      this.host.setSecondary(this.chips);
      this.message = playerNatural && dealerNatural ? 'Push — both blackjack'
        : playerNatural ? 'Blackjack!' : 'Dealer blackjack';
      this.play(playerNatural && !dealerNatural ? 'highscore' : playerNatural ? 'back' : 'die');
      this.phase = 'settle';
      this.settleTimer = 2.4;
      return;
    }

    this.phase = 'player';
    this.play('select');
  }

  #award(points) {
    if (points > 0) this.addScore(points);
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
      this.#settle();
      return;
    }
    this.phase = 'dealer';
    this.dealerHoleHidden = false;
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

    for (const hand of this.hands) {
      if (hand.result) continue; // already resolved (bust, or a natural)
      const total = handValue(hand.cards).total;
      if (dealerBust || total > dealer.total) {
        hand.result = 'win';
        this.chips += hand.bet * 2;
        this.#award(hand.bet);
      } else if (total === dealer.total) {
        hand.result = 'push';
        this.chips += hand.bet;
      } else {
        hand.result = 'lose';
      }
    }

    this.host.setSecondary(this.chips);
    const wins = this.hands.filter((h) => h.result === 'win' || h.result === 'blackjack').length;
    this.message = dealerBust ? 'Dealer busts!' : wins === this.hands.length ? 'You win!' : wins > 0 ? 'Split result' : 'Dealer wins';
    this.play(wins > 0 ? 'highscore' : dealerBust ? 'highscore' : 'die');
    this.meta = { round: this.roundNo, chips: this.chips };
    this.phase = 'settle';
    this.settleTimer = 2.2;
  }

  #nextRound() {
    if (this.chips <= 0) {
      this.setLives(0);
      this.end();
      return;
    }
    this.bet = 0;
    this.hands = [];
    this.phase = 'bet';
    this.message = '';
  }

  /* ================================================================ input */

  update(dt) {
    this.updateEffects(dt);
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
        this.glowCircle(ctx, btn.x + btn.w / 2, btn.y + btn.h / 2, 22, on ? CHIP_COLORS[btn.value] : '#2a3142', on ? 10 : 0);
        this.text(ctx, btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2, {
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
    this.clear(ctx, '#08110d');
    const grad = ctx.createRadialGradient(W / 2, H * 0.3, 40, W / 2, H * 0.5, W * 0.75);
    grad.addColorStop(0, 'rgba(74, 222, 128, 0.09)');
    grad.addColorStop(1, 'rgba(4, 12, 8, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

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
      this.#drawCard(ctx, cx, y, hidden ? null : card);
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
    this.#drawHand(ctx, this.dealerHand, x, DEALER_Y, this.dealerHoleHidden);
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
    const label = this.phase === 'bet'
      ? `BET  $${this.bet}`
      : `BET  $${this.hands.reduce((n, h) => n + h.bet, 0)}`;
    this.text(ctx, label, W / 2, BAR_Y - 18, { size: 11, color: '#8b93a7' });
  }

  /** `card` of null draws a face-down back. */
  #drawCard(ctx, x, y, card) {
    ctx.save();
    if (!card) {
      ctx.fillStyle = '#161d33';
      this.roundRect(ctx, x, y, CARD_W, CARD_H, 7).fill();
      ctx.strokeStyle = 'rgba(0,229,255,0.30)';
      ctx.lineWidth = 1.4;
      this.roundRect(ctx, x + 0.7, y + 0.7, CARD_W - 1.4, CARD_H - 1.4, 6).stroke();
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#f4f7ff';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 7).fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 7).stroke();

    const ink = card.red ? '#d81f4a' : '#141821';
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '700 14px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(card.rank, x + 6, y + 5);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(card.glyph, x + 6, y + 21);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '26px system-ui, sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 4);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
