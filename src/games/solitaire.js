import { BaseGame } from '../core/game.js';

/**
 * SOLITAIRE — Klondike
 *
 * Draw one or draw three, chosen from the control in the play bar. Draw three
 * is the traditional game and only every third card of the stock is reachable
 * without cycling, which is most of what makes a deal hard; draw one is far
 * more forgiving and most deals are winnable. Because that gap is real, draw
 * three carries a 1.25x multiplier on the points it is easy to farm.
 *
 * Interaction is click-to-move rather than drag-and-drop, which is both easier
 * on a touchscreen and faster once you trust it: click a card to pick it up
 * (with every face-up card below it, since a tableau run moves as a unit),
 * then click where it should go. Double-clicking sends a card straight to its
 * foundation, and there is a full undo stack because a game you cannot take
 * back is a game you stop playing.
 */

const W = 760;
const H = 640;

const CARD_W = 84;
const CARD_H = 118;
const MARGIN = 16;
const COL_GAP = 12;
const FAN_DOWN = 24; // vertical offset between face-up tableau cards
const FAN_HIDDEN = 11; // tighter offset for face-down cards

const TOP_Y = MARGIN;
const TABLEAU_Y = TOP_Y + CARD_H + 26;

const SUITS = [
  { id: 'S', glyph: '♠', red: false },
  { id: 'H', glyph: '♥', red: true },
  { id: 'C', glyph: '♣', red: false },
  { id: 'D', glyph: '♦', red: true },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RED = '#ff5c7a';
const BLACK = '#e9edf6';

export default class Solitaire extends BaseGame {
  static id = 'solitaire';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Moves' };

  static options = [
    {
      id: 'draw',
      label: 'Draw',
      default: 'three',
      choices: [
        {
          value: 'one',
          label: 'One',
          hint: 'Draw one card at a time — every card in the stock is reachable.',
        },
        {
          value: 'three',
          label: 'Three',
          hint: 'Draw three at a time, the traditional game. Scores 1.25x.',
        },
      ],
    },
  ];

  setup() {
    this.host.setSecondaryLabel('Moves');
    this.setLives(1);
    this.drawCount = this.option('draw') === 'one' ? 1 : 3;
    this.#applyDrawHint();

    this.#deal();
    this.banner('Klondike');
    this.play('ready');
  }

  /* ================================================================ modes */

  /**
   * Switching draw mode applies to the next turn of the stock rather than
   * restarting — the deal itself is identical either way, so there is nothing
   * to rebuild and no reason to take the player's board away.
   */
  onOptionChange(id, value) {
    if (id !== 'draw') return false;
    this.drawCount = value === 'one' ? 1 : 3;
    this.#applyDrawHint();
    return true;
  }

  #applyDrawHint() {
    this.host.setHint(
      this.drawCount === 1
        ? 'Draw one · click a card, then its destination · U to undo'
        : 'Draw three · click a card, then its destination · U to undo',
    );
  }

  /** Draw three is the harder game, so the points it yields are worth more. */
  get #multiplier() {
    return this.drawCount === 3 ? 1.25 : 1;
  }

  /* ================================================================= deal */

  #deal() {
    const deck = [];
    for (const suit of SUITS) {
      RANKS.forEach((rank, i) => {
        deck.push({ suit: suit.id, red: suit.red, glyph: suit.glyph, rank, value: i + 1, faceUp: false });
      });
    }
    // Fisher-Yates on the game's seeded generator.
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    /** Seven piles, the nth holding n cards with only the last face up. */
    this.tableau = Array.from({ length: 7 }, () => []);
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const card = deck.pop();
        card.faceUp = row === col;
        this.tableau[col].push(card);
      }
    }

    this.stock = deck;
    this.waste = [];
    this.foundations = { S: [], H: [], C: [], D: [] };

    this.selection = null; // { from, index }
    this.moves = 0;
    this.history = [];
    this.lastClick = { at: 0, key: '' };
    this.won = false;

    this.host.setSecondary(0);
  }

  /* =========================================================== snapshots */

  /** Undo works on whole-state snapshots — a Klondike position is tiny. */
  #snapshot() {
    this.history.push(
      JSON.stringify({
        tableau: this.tableau,
        stock: this.stock,
        waste: this.waste,
        foundations: this.foundations,
        score: this.score,
        moves: this.moves,
      }),
    );
    if (this.history.length > 120) this.history.shift();
  }

  #undo() {
    const snap = this.history.pop();
    if (!snap) return;
    const s = JSON.parse(snap);
    this.tableau = s.tableau;
    this.stock = s.stock;
    this.waste = s.waste;
    this.foundations = s.foundations;
    this.score = s.score;
    this.moves = s.moves;
    this.selection = null;
    this.host.setScore(this.score);
    this.host.setSecondary(this.moves);
    this.play('back');
  }

  /* =============================================================== rules */

  /** Tableau accepts a descending run of alternating colours; empty takes a King. */
  #canStackOnTableau(card, pile) {
    if (!pile.length) return card.value === 13;
    const top = pile[pile.length - 1];
    if (!top.faceUp) return false;
    return top.red !== card.red && top.value === card.value + 1;
  }

  /** Foundations build up by suit from the Ace. */
  #canStackOnFoundation(card, suit) {
    if (card.suit !== suit) return false;
    const pile = this.foundations[suit];
    return card.value === pile.length + 1;
  }

  #foundationFor(card) {
    return this.#canStackOnFoundation(card, card.suit) ? card.suit : null;
  }

  /* ============================================================== moving */

  /** All the cards that travel with the one you clicked. */
  #grabbed(from, index) {
    if (from.zone === 'tableau') return this.tableau[from.col].slice(index);
    if (from.zone === 'waste') return this.waste.slice(-1);
    if (from.zone === 'foundation') return this.foundations[from.suit].slice(-1);
    return [];
  }

  #removeGrabbed(from, index) {
    if (from.zone === 'tableau') return this.tableau[from.col].splice(index);
    if (from.zone === 'waste') return this.waste.splice(-1);
    if (from.zone === 'foundation') return this.foundations[from.suit].splice(-1);
    return [];
  }

  /** Every positive award goes through here so the multiplier applies once. */
  #award(points, at) {
    this.addScore(Math.round(points * this.#multiplier), at);
  }

  /** Turning over a newly exposed tableau card is worth points. */
  #revealAfterMove(from) {
    if (from.zone !== 'tableau') return;
    const pile = this.tableau[from.col];
    const top = pile[pile.length - 1];
    if (top && !top.faceUp) {
      top.faceUp = true;
      this.#award(5);
      this.play('blip');
    }
  }

  #tryMove(from, index, to) {
    const cards = this.#grabbed(from, index);
    if (!cards.length) return false;
    const [lead] = cards;

    if (to.zone === 'foundation') {
      // Only ever one card at a time onto a foundation.
      if (cards.length !== 1 || !this.#canStackOnFoundation(lead, to.suit)) return false;
      this.#snapshot();
      this.#removeGrabbed(from, index);
      this.foundations[to.suit].push(lead);
      this.#award(from.zone === 'tableau' ? 10 : 12);
      this.play('powerup');
    } else if (to.zone === 'tableau') {
      if (!this.#canStackOnTableau(lead, this.tableau[to.col])) return false;
      this.#snapshot();
      const moved = this.#removeGrabbed(from, index);
      this.tableau[to.col].push(...moved);
      // Pulling a card back out of a foundation costs what it earned.
      if (from.zone === 'foundation') this.addScore(-12);
      else this.addScore(1);
      this.play('select');
    } else {
      return false;
    }

    this.#revealAfterMove(from);
    this.moves++;
    this.host.setSecondary(this.moves);
    this.selection = null;
    this.#checkWin();
    return true;
  }

  /** Send a card straight to a foundation if it will go. */
  #autoToFoundation(from, index) {
    const cards = this.#grabbed(from, index);
    if (cards.length !== 1) return false;
    const suit = this.#foundationFor(cards[0]);
    if (!suit) return false;
    return this.#tryMove(from, index, { zone: 'foundation', suit });
  }

  #drawFromStock() {
    this.#snapshot();
    if (!this.stock.length) {
      if (!this.waste.length) return;
      // Recycling the waste costs points, as it does in the standard scoring.
      this.stock = this.waste.reverse().map((c) => ({ ...c, faceUp: false }));
      this.waste = [];
      this.addScore(-20);
      this.play('back');
    } else {
      for (let i = 0; i < this.drawCount && this.stock.length; i++) {
        const card = this.stock.pop();
        card.faceUp = true;
        this.waste.push(card);
      }
      this.play('blip');
    }
    this.moves++;
    this.host.setSecondary(this.moves);
    this.selection = null;
  }

  #checkWin() {
    const total = Object.values(this.foundations).reduce((n, p) => n + p.length, 0);
    this.meta = { moves: this.moves, foundation: total, draw: this.drawCount };
    if (total < 52 || this.won) return;
    this.won = true;
    this.#award(1000);
    this.banner('Solved!');
    this.play('highscore');
    this.end();
  }

  /* ============================================================== layout */

  #columnX(col) {
    return MARGIN + col * (CARD_W + COL_GAP);
  }

  #foundationX(i) {
    return W - MARGIN - CARD_W - (3 - i) * (CARD_W + COL_GAP);
  }

  /** Screen position of every tableau card, so hit-testing and drawing agree. */
  #tableauCardY(col, index) {
    let y = TABLEAU_Y;
    for (let i = 0; i < index; i++) {
      y += this.tableau[col][i].faceUp ? FAN_DOWN : FAN_HIDDEN;
    }
    return y;
  }

  #pileHeight(col) {
    const pile = this.tableau[col];
    if (!pile.length) return CARD_H;
    return this.#tableauCardY(col, pile.length - 1) - TABLEAU_Y + CARD_H;
  }

  /* =============================================================== input */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.input.keyPressed('KeyU') || this.input.pressed('secondary')) {
      this.#undo();
      return;
    }

    const m = this.mouse;
    if (!m.pressed) return;

    const target = this.#hitTest(m.x, m.y);
    if (!target) {
      this.selection = null;
      return;
    }

    // Double-click sends a card home without needing a destination.
    const key = JSON.stringify(target);
    const now = performance.now();
    const isDouble = key === this.lastClick.key && now - this.lastClick.at < 420;
    this.lastClick = { key, at: now };

    if (target.zone === 'stock') {
      this.#drawFromStock();
      return;
    }

    if (isDouble && target.index != null) {
      if (this.#autoToFoundation(target, target.index)) return;
    }

    /* --- nothing held: pick something up --- */
    if (!this.selection) {
      if (target.index == null) return; // an empty pile is not a source
      const cards = this.#grabbed(target, target.index);
      if (!cards.length || !cards[0].faceUp) return;
      // A tableau run is only movable if it is a valid descending sequence.
      if (target.zone === 'tableau' && !this.#isRun(cards)) return;
      this.selection = { from: target, index: target.index };
      this.play('hover');
      return;
    }

    /* --- something held: try to place it --- */
    const from = this.selection.from;
    const sameSpot =
      from.zone === target.zone && from.col === target.col && from.suit === target.suit;
    if (sameSpot) {
      this.selection = null;
      return;
    }

    if (!this.#tryMove(from, this.selection.index, target)) {
      // An illegal drop re-targets rather than just failing silently.
      this.selection = null;
      if (target.index != null) {
        const cards = this.#grabbed(target, target.index);
        if (cards.length && cards[0].faceUp && (target.zone !== 'tableau' || this.#isRun(cards))) {
          this.selection = { from: target, index: target.index };
        }
      }
      this.play('back');
    }
  }

  /** Descending, alternating colours — the only shape that moves as a unit. */
  #isRun(cards) {
    for (let i = 1; i < cards.length; i++) {
      const a = cards[i - 1];
      const b = cards[i];
      if (!b.faceUp || a.value !== b.value + 1 || a.red === b.red) return false;
    }
    return true;
  }

  #hitTest(x, y) {
    /* --- stock and waste --- */
    if (y >= TOP_Y && y <= TOP_Y + CARD_H) {
      if (this.hits(x, y, MARGIN, TOP_Y, CARD_W, CARD_H)) return { zone: 'stock' };
      const wasteX = MARGIN + CARD_W + COL_GAP;
      // The waste fans three across; the rightmost is the live one.
      if (this.hits(x, y, wasteX, TOP_Y, CARD_W + 44, CARD_H) && this.waste.length) {
        return { zone: 'waste', index: this.waste.length - 1 };
      }
      for (let i = 0; i < 4; i++) {
        if (this.hits(x, y, this.#foundationX(i), TOP_Y, CARD_W, CARD_H)) {
          const suit = SUITS[i].id;
          const pile = this.foundations[suit];
          return { zone: 'foundation', suit, index: pile.length ? pile.length - 1 : null };
        }
      }
      return null;
    }

    /* --- tableau --- */
    for (let col = 0; col < 7; col++) {
      const cx = this.#columnX(col);
      if (x < cx || x > cx + CARD_W) continue;
      const pile = this.tableau[col];

      if (!pile.length) {
        if (this.hits(x, y, cx, TABLEAU_Y, CARD_W, CARD_H)) return { zone: 'tableau', col, index: null };
        continue;
      }

      // Walk from the bottom of the fan up, so the topmost card wins.
      for (let i = pile.length - 1; i >= 0; i--) {
        const cy = this.#tableauCardY(col, i);
        const height = i === pile.length - 1 ? CARD_H : pile[i + 1].faceUp ? FAN_DOWN : FAN_HIDDEN;
        if (y >= cy && y <= cy + height) return { zone: 'tableau', col, index: i };
      }
      if (y >= TABLEAU_Y && y <= TABLEAU_Y + this.#pileHeight(col)) {
        return { zone: 'tableau', col, index: pile.length - 1 };
      }
    }
    return null;
  }

  /* ================================================================ draw */

  draw(ctx) {
    this.clear(ctx, '#08110d');

    // Baize: a soft green wash so it reads as a card table, not a void.
    const grad = ctx.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.5, W * 0.8);
    grad.addColorStop(0, 'rgba(74, 222, 128, 0.10)');
    grad.addColorStop(1, 'rgba(4, 12, 8, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    this.shake.apply(ctx);

    this.#drawStock(ctx);
    this.#drawWaste(ctx);
    this.#drawFoundations(ctx);
    this.#drawTableau(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #slot(ctx, x, y, label) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 9).stroke();
    ctx.restore();
    if (label) {
      this.text(ctx, label, x + CARD_W / 2, y + CARD_H / 2, {
        size: 26, color: 'rgba(255,255,255,0.16)',
      });
    }
  }

  #drawStock(ctx) {
    if (this.stock.length) {
      this.#drawCard(ctx, MARGIN, TOP_Y, null);
      this.text(ctx, String(this.stock.length), MARGIN + CARD_W / 2, TOP_Y + CARD_H + 13, {
        size: 10, color: '#8b93a7',
      });
    } else {
      this.#slot(ctx, MARGIN, TOP_Y, '↻');
    }
  }

  #drawWaste(ctx) {
    const x = MARGIN + CARD_W + COL_GAP;
    if (!this.waste.length) {
      this.#slot(ctx, x, TOP_Y, '');
      return;
    }
    // Show the last three, fanned, with only the top one live.
    const shown = this.waste.slice(-3);
    shown.forEach((card, i) => {
      const cx = x + i * 22;
      const selected =
        this.selection?.from.zone === 'waste' && i === shown.length - 1;
      this.#drawCard(ctx, cx, TOP_Y, card, { selected });
    });
  }

  #drawFoundations(ctx) {
    SUITS.forEach((suit, i) => {
      const x = this.#foundationX(i);
      const pile = this.foundations[suit.id];
      if (!pile.length) {
        this.#slot(ctx, x, TOP_Y, suit.glyph);
        return;
      }
      const selected = this.selection?.from.zone === 'foundation' && this.selection.from.suit === suit.id;
      this.#drawCard(ctx, x, TOP_Y, pile[pile.length - 1], { selected });
    });
  }

  #drawTableau(ctx) {
    for (let col = 0; col < 7; col++) {
      const x = this.#columnX(col);
      const pile = this.tableau[col];

      if (!pile.length) {
        this.#slot(ctx, x, TABLEAU_Y, '');
        continue;
      }

      pile.forEach((card, i) => {
        const y = this.#tableauCardY(col, i);
        const sel = this.selection;
        const selected =
          sel?.from.zone === 'tableau' && sel.from.col === col && i >= sel.index;
        this.#drawCard(ctx, x, y, card.faceUp ? card : null, { selected });
      });
    }
  }

  /** `card` of null draws a face-down back. */
  #drawCard(ctx, x, y, card, { selected = false } = {}) {
    ctx.save();

    if (selected) {
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 18;
    }

    if (!card) {
      // Back: deep indigo with a lattice.
      ctx.fillStyle = '#161d33';
      this.roundRect(ctx, x, y, CARD_W, CARD_H, 9).fill();
      ctx.strokeStyle = 'rgba(0,229,255,0.30)';
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, x + 0.75, y + 0.75, CARD_W - 1.5, CARD_H - 1.5, 8).stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,229,255,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -CARD_H; i < CARD_W; i += 11) {
        ctx.moveTo(x + i, y + CARD_H - 6);
        ctx.lineTo(x + i + CARD_H - 12, y + 6);
      }
      ctx.save();
      this.roundRect(ctx, x + 6, y + 6, CARD_W - 12, CARD_H - 12, 5).clip();
      ctx.stroke();
      ctx.restore();
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#f4f7ff';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 9).fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? '#ffd23f' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = selected ? 2 : 1;
    this.roundRect(ctx, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 9).stroke();

    const ink = card.red ? '#d81f4a' : '#141821';
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.font = '700 17px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(card.rank, x + 7, y + 6);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(card.glyph, x + 7, y + 25);

    // The big centre pip.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '40px system-ui, sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 4);
    ctx.globalAlpha = 1;

    // Mirrored index in the opposite corner.
    ctx.save();
    ctx.translate(x + CARD_W - 7, y + CARD_H - 6);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 17px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(card.rank, 0, 0);
    ctx.restore();

    ctx.restore();
  }
}

export { RED, BLACK };
