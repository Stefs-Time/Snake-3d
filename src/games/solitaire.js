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

/** Padding baked around each card sprite so its shadow has room to land. */
const PAD = 5;

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

export default class Solitaire extends BaseGame {
  static id = 'solitaire';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static touchButtons = { secondary: 'UNDO' };
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
    this.layers = new Map();
    this.drawCount = this.option('draw') === 'one' ? 1 : 3;
    this.#applyDrawHint();

    this.#deal();
    this.banner('Klondike');
    this.play('ready');
  }

  teardown() {
    this.layers?.clear();
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
    const draw = this.drawCount === 1 ? 'one' : 'three';
    this.host.setHint(
      `Draw ${draw} · click a card, then its destination · U to undo`,
      `Draw ${draw} · tap a card, then its destination · UNDO steps back`,
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
    this.flipping = [];
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
    this.flipping = [];
    for (const pile of [...this.tableau, this.stock, this.waste, ...Object.values(this.foundations)]) {
      for (const card of pile) card.flipT = 1;
    }
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
      top.flipT = 0;
      this.flipping.push(top);
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
      const fi = SUITS.findIndex((s) => s.id === to.suit);
      const fx = this.#foundationX(fi) + CARD_W / 2;
      const fy = TOP_Y + CARD_H / 2;
      this.#award(from.zone === 'tableau' ? 10 : 12, { x: fx, y: fy + CARD_H / 2 + 8, color: '#ffd23f' });
      const done = this.foundations[to.suit].length === 13;
      this.particles.emit(fx, fy, {
        count: done ? 26 : 9, speed: done ? 160 : 110,
        color: lead.red ? '#ff2e88' : '#00e5ff', life: 0.5, size: 2.6, shape: 'circle',
      });
      this.play('powerup');
    } else if (to.zone === 'tableau') {
      if (!this.#canStackOnTableau(lead, this.tableau[to.col])) return false;
      this.#snapshot();
      const moved = this.#removeGrabbed(from, index);
      this.tableau[to.col].push(...moved);
      // Pulling a card back out of a foundation costs what it earned.
      if (from.zone === 'foundation') this.addScore(-Math.min(this.score, Math.round(12 * this.#multiplier)));
      else if (from.zone === 'waste') this.#award(1);
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
    if (!this.stock.length && !this.waste.length) return;
    this.#snapshot();
    if (!this.stock.length) {
      // Recycling the waste costs points, as it does in the standard scoring.
      this.stock = this.waste.reverse().map((c) => ({ ...c, faceUp: false, flipT: 1 }));
      this.waste = [];
      this.addScore(-Math.min(20, this.score));
      this.play('back');
    } else {
      for (let i = 0; i < this.drawCount && this.stock.length; i++) {
        const card = this.stock.pop();
        card.faceUp = true;
        card.flipT = 0;
        this.flipping.push(card);
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
    if (this.flipping.length) {
      for (const card of this.flipping) card.flipT = Math.min(1, card.flipT + dt / 0.22);
      if (this.flipping[0].flipT >= 1) this.flipping = this.flipping.filter((c) => c.flipT < 1);
    }
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
        const height = i === pile.length - 1 ? CARD_H : pile[i].faceUp ? FAN_DOWN : FAN_HIDDEN;
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
    ctx.drawImage(this.#felt(), 0, 0, W, H);

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
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 9).fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.18)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x + 0.75, y + 0.75, CARD_W - 1.5, CARD_H - 1.5, 8).stroke();
    ctx.restore();
    if (label) {
      this.text(ctx, label, x + CARD_W / 2, y + CARD_H / 2, {
        size: 26, color: 'rgba(0,229,255,0.18)',
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
    const yy = selected ? y - 3 : y;
    if (selected) {
      ctx.save();
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255,210,63,0.85)';
      this.roundRect(ctx, x - 1.5, yy - 1.5, CARD_W + 3, CARD_H + 3, 10).fill();
      ctx.restore();
    }

    // A mid-flip card squashes through its own midline.
    const flip = card && card.flipT != null && card.flipT < 1 ? card.flipT : 1;
    if (flip < 1) {
      const w = Math.max(2, CARD_W * Math.abs(Math.cos(flip * Math.PI)));
      const sprite = this.#cardSprite(flip > 0.5 ? card : null);
      ctx.drawImage(sprite, x + (CARD_W - w) / 2 - PAD, yy - PAD, w + PAD * 2, CARD_H + PAD * 2);
    } else {
      ctx.drawImage(this.#cardSprite(card), x - PAD, yy - PAD, CARD_W + PAD * 2, CARD_H + PAD * 2);
    }

    if (selected) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      this.roundRect(ctx, x + 0.5, yy + 0.5, CARD_W - 1, CARD_H - 1, 9).stroke();
    }
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

  /** The baize, painted once: green wash, corner vignette, faint weave. */
  #felt() {
    return this.#layer('felt', W, H, (g) => {
      g.fillStyle = '#07110c';
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.5, W * 0.8);
      glow.addColorStop(0, 'rgba(74,222,128,0.11)');
      glow.addColorStop(1, 'rgba(4,12,8,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      const vig = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.78);
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
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 4;
    g.shadowOffsetY = 1.5;
    const body = g.createLinearGradient(0, y, 0, y + CARD_H);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.12, '#f5f8fe');
    body.addColorStop(1, '#dbe2f0');
    g.fillStyle = body;
    this.roundRect(g, x, y, CARD_W, CARD_H, 9 * s).fill();
    g.restore();
    g.strokeStyle = 'rgba(13,18,30,0.5)';
    g.lineWidth = 1;
    this.roundRect(g, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 8.5 * s).stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    this.roundRect(g, x + 1.5, y + 1.5, CARD_W - 3, CARD_H - 3, 7.5 * s).stroke();

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
      g.font = `700 ${Math.round(16 * s)}px ui-monospace, "SF Mono", Menlo, monospace`;
      g.fillText(card.rank, x + 13 * s, y + 14 * s);
      g.font = `${Math.round(13 * s)}px system-ui, sans-serif`;
      g.fillText(card.glyph, x + 13 * s, y + 30 * s);
      g.restore();
    }

    const v = card.value;
    if (v === 1) {
      g.font = `${Math.round(46 * s)}px system-ui, sans-serif`;
      g.shadowColor = card.red ? 'rgba(225,29,85,0.4)' : 'rgba(28,34,48,0.35)';
      g.shadowBlur = 10 * s;
      g.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 2 * s);
    } else if (v >= 11) {
      // Court cards get a double-ruled panel instead of a figure.
      const px = x + 18 * s;
      const py = y + 21 * s;
      const pw = CARD_W - 36 * s;
      const ph = CARD_H - 42 * s;
      g.strokeStyle = card.red ? 'rgba(225,29,85,0.45)' : 'rgba(28,34,48,0.4)';
      g.lineWidth = 1.2;
      this.roundRect(g, px, py, pw, ph, 6 * s).stroke();
      this.roundRect(g, px + 3 * s, py + 3 * s, pw - 6 * s, ph - 6 * s, 4 * s).stroke();
      g.font = `700 ${Math.round(32 * s)}px ui-monospace, "SF Mono", Menlo, monospace`;
      g.fillText(card.rank, x + CARD_W / 2, y + CARD_H / 2 - 8 * s);
      g.font = `${Math.round(17 * s)}px system-ui, sans-serif`;
      g.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 17 * s);
    } else {
      // Number cards carry their real pip layout, lower half upside down.
      g.font = `${Math.round(15 * s)}px system-ui, sans-serif`;
      const left = x + 26 * s;
      const right = x + CARD_W - 26 * s;
      const top = y + 25 * s;
      const bottom = y + CARD_H - 25 * s;
      for (const [cx, cy] of PIPS[v]) {
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
    g.shadowBlur = 4;
    g.shadowOffsetY = 1.5;
    const body = g.createLinearGradient(0, y, 0, y + CARD_H);
    body.addColorStop(0, '#1b2440');
    body.addColorStop(1, '#111830');
    g.fillStyle = body;
    this.roundRect(g, x, y, CARD_W, CARD_H, 9 * s).fill();
    g.restore();
    g.strokeStyle = 'rgba(0,229,255,0.45)';
    g.lineWidth = 1.4;
    this.roundRect(g, x + 0.7, y + 0.7, CARD_W - 1.4, CARD_H - 1.4, 8 * s).stroke();

    g.save();
    this.roundRect(g, x + 5 * s, y + 5 * s, CARD_W - 10 * s, CARD_H - 10 * s, 5 * s).clip();
    g.strokeStyle = 'rgba(0,229,255,0.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = -CARD_H; i < CARD_W + CARD_H; i += 9 * s) {
      g.moveTo(x + i, y + CARD_H);
      g.lineTo(x + i + CARD_H, y);
      g.moveTo(x + i, y);
      g.lineTo(x + i + CARD_H, y + CARD_H);
    }
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(0,229,255,0.28)';
    this.roundRect(g, x + 5 * s, y + 5 * s, CARD_W - 10 * s, CARD_H - 10 * s, 5 * s).stroke();

    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#131b33';
    g.fillRect(-17 * s, -17 * s, 34 * s, 34 * s);
    g.strokeStyle = 'rgba(0,229,255,0.55)';
    g.lineWidth = 1.4;
    g.shadowColor = '#00e5ff';
    g.shadowBlur = 8;
    g.strokeRect(-13 * s, -13 * s, 26 * s, 26 * s);
    g.strokeStyle = 'rgba(255,46,136,0.6)';
    g.shadowColor = '#ff2e88';
    g.strokeRect(-6 * s, -6 * s, 12 * s, 12 * s);
    g.restore();
  }
}

export { RED, BLACK };
