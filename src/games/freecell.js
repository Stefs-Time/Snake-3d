import { BaseGame } from '../core/game.js';

/**
 * FREECELL
 *
 * Every card dealt face up, which sounds like it should make the game easy
 * and instead makes it a puzzle rather than a gamble — nothing is hidden, so
 * a deal that cannot be solved is a flaw in the deal, not bad luck, and the
 * overwhelming majority of deals can be solved by a careful enough player.
 *
 * The four free cells are the whole idea: a card parked in one is a card you
 * have bought yourself room to work around, and the tableau otherwise stacks
 * exactly like Klondike — descending, alternating colours — except any card,
 * not just a King, may open an empty column.
 *
 * Moving several cards at once is really just moving them one at a time
 * through the free cells and back, so the number you may move together is
 * bounded by how much scratch space exists: `(free cells + 1) × 2^(empty
 * columns)`, not counting the column you are moving into. The game computes
 * that budget and enforces it exactly rather than pretending any run can
 * move anywhere.
 */

const W = 740;
const H = 640;

const CARD_W = 76;
const CARD_H = 106;
const MARGIN = 16;
const COL_GAP = 10;
const FAN_DOWN = 24;

const TOP_Y = MARGIN;
const TABLEAU_Y = TOP_Y + CARD_H + 30;
const COLS = 8;

const SUITS = [
  { id: 'S', glyph: '♠', red: false },
  { id: 'H', glyph: '♥', red: true },
  { id: 'C', glyph: '♣', red: false },
  { id: 'D', glyph: '♦', red: true },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export default class FreeCell extends BaseGame {
  static id = 'freecell';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static touchButtons = { secondary: 'UNDO' };
  static smooth = true;
  // A little taller than Solitaire's: the "FREE" label sits close to the top
  // of the canvas, and the DOM HUD's own label+value stack actually reaches
  // about 47px, past a 34px band, which let the two overlap.
  static hudPad = { top: 46, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Moves' };

  setup() {
    this.host.setSecondaryLabel('Moves');
    this.host.setHint('Click a card, then its destination · U to undo',
      'Tap a card, then its destination · UNDO steps back');
    this.setLives(1);

    this.#deal();
    this.banner('FreeCell');
    this.play('ready');
  }

  /* ================================================================= deal */

  #deal() {
    const deck = [];
    for (const suit of SUITS) {
      RANKS.forEach((rank, i) => {
        deck.push({ suit: suit.id, red: suit.red, glyph: suit.glyph, rank, value: i + 1 });
      });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Every card is dealt face up: four columns of seven, four of six.
    this.tableau = Array.from({ length: COLS }, () => []);
    let col = 0;
    while (deck.length) {
      this.tableau[col % COLS].push(deck.pop());
      col++;
    }

    this.freecells = [null, null, null, null];
    this.foundations = { S: [], H: [], C: [], D: [] };
    this.selection = null;
    this.moves = 0;
    this.history = [];
    this.lastClick = { at: 0, key: '' };
    this.won = false;
    this.host.setSecondary(0);
  }

  /* =========================================================== snapshots */

  #snapshot() {
    this.history.push(JSON.stringify({
      tableau: this.tableau, freecells: this.freecells, foundations: this.foundations,
      score: this.score, moves: this.moves,
    }));
    if (this.history.length > 150) this.history.shift();
  }

  #undo() {
    const snap = this.history.pop();
    if (!snap) return;
    const s = JSON.parse(snap);
    this.tableau = s.tableau;
    this.freecells = s.freecells;
    this.foundations = s.foundations;
    this.score = s.score;
    this.moves = s.moves;
    this.selection = null;
    this.host.setScore(this.score);
    this.host.setSecondary(this.moves);
    this.play('back');
  }

  /* =============================================================== rules */

  #canStackOnTableau(card, pile) {
    if (!pile.length) return true; // any card may open an empty column
    const top = pile[pile.length - 1];
    return top.red !== card.red && top.value === card.value + 1;
  }

  #canStackOnFoundation(card, suit) {
    if (card.suit !== suit) return false;
    return card.value === this.foundations[suit].length + 1;
  }

  #foundationFor(card) {
    return this.#canStackOnFoundation(card, card.suit) ? card.suit : null;
  }

  /** Descending, alternating colours — the only shape that moves as a unit. */
  #isRun(cards) {
    for (let i = 1; i < cards.length; i++) {
      const a = cards[i - 1];
      const b = cards[i];
      if (a.value !== b.value + 1 || a.red === b.red) return false;
    }
    return true;
  }

  /**
   * How many cards may move together: the free cells and empty columns are
   * scratch space, and each empty column doubles what the free cells alone
   * allow because a run can be split across it. The destination column never
   * counts among the empty ones — you cannot use where you are going as a
   * place to temporarily put things down.
   */
  #maxMove(destCol) {
    const emptyFree = this.freecells.filter((c) => !c).length;
    const emptyCols = this.tableau.filter((col, i) => i !== destCol && col.length === 0).length;
    return (emptyFree + 1) * 2 ** emptyCols;
  }

  /* ============================================================== moving */

  #grabbed(from) {
    if (from.zone === 'tableau') return this.tableau[from.col].slice(from.index);
    if (from.zone === 'free') return this.freecells[from.index] ? [this.freecells[from.index]] : [];
    if (from.zone === 'foundation') {
      const pile = this.foundations[from.suit];
      return pile.length ? [pile[pile.length - 1]] : [];
    }
    return [];
  }

  #removeGrabbed(from) {
    if (from.zone === 'tableau') return this.tableau[from.col].splice(from.index);
    if (from.zone === 'free') {
      const card = this.freecells[from.index];
      this.freecells[from.index] = null;
      return card ? [card] : [];
    }
    if (from.zone === 'foundation') return this.foundations[from.suit].splice(-1);
    return [];
  }

  #award(points, at) {
    this.addScore(points, at);
  }

  #tryMove(from, to) {
    const cards = this.#grabbed(from);
    if (!cards.length) return false;
    const [lead] = cards;

    if (to.zone === 'foundation') {
      if (cards.length !== 1 || !this.#canStackOnFoundation(lead, to.suit)) return false;
      this.#snapshot();
      this.#removeGrabbed(from);
      this.foundations[to.suit].push(lead);
      this.#award(15);
      this.play('powerup');
    } else if (to.zone === 'free') {
      if (cards.length !== 1 || this.freecells[to.index]) return false;
      this.#snapshot();
      this.#removeGrabbed(from);
      this.freecells[to.index] = lead;
      this.play('select');
    } else if (to.zone === 'tableau') {
      if (!this.#canStackOnTableau(lead, this.tableau[to.col])) return false;
      if (cards.length > this.#maxMove(to.col)) return false;
      const wasEmpty = this.tableau[from.zone === 'tableau' ? from.col : -1]?.length === cards.length;
      this.#snapshot();
      const moved = this.#removeGrabbed(from);
      this.tableau[to.col].push(...moved);
      if (from.zone === 'foundation') this.addScore(-15);
      else this.play('select');
      if (from.zone === 'tableau' && wasEmpty) this.#award(20); // cleared a column
    } else {
      return false;
    }

    this.moves++;
    this.host.setSecondary(this.moves);
    this.selection = null;
    this.#checkWin();
    return true;
  }

  #autoToFoundation(from) {
    const cards = this.#grabbed(from);
    if (cards.length !== 1) return false;
    const suit = this.#foundationFor(cards[0]);
    if (!suit) return false;
    return this.#tryMove(from, { zone: 'foundation', suit });
  }

  #checkWin() {
    const total = Object.values(this.foundations).reduce((n, p) => n + p.length, 0);
    this.meta = { moves: this.moves, foundation: total };
    if (total < 52 || this.won) return;
    this.won = true;
    this.#award(1200);
    this.banner('Solved!');
    this.play('highscore');
    this.end();
  }

  /* ============================================================== layout */

  #freeCellX(i) {
    return MARGIN + i * (CARD_W + COL_GAP);
  }

  #foundationX(i) {
    return W - MARGIN - CARD_W - (3 - i) * (CARD_W + COL_GAP);
  }

  #columnX(col) {
    return MARGIN + col * (CARD_W + COL_GAP);
  }

  #tableauCardY(col, index) {
    return TABLEAU_Y + index * FAN_DOWN;
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

    const key = JSON.stringify(target);
    const now = performance.now();
    const isDouble = key === this.lastClick.key && now - this.lastClick.at < 420;
    this.lastClick = { key, at: now };

    if (isDouble && this.#autoToFoundation(target)) return;

    if (!this.selection) {
      const cards = this.#grabbed(target);
      if (!cards.length) return;
      if (target.zone === 'tableau' && !this.#isRun(cards)) return;
      this.selection = { from: target };
      this.play('hover');
      return;
    }

    const from = this.selection.from;
    const sameSpot = from.zone === target.zone && from.col === target.col
      && from.suit === target.suit && from.index === target.index;
    if (sameSpot) {
      this.selection = null;
      return;
    }

    if (!this.#tryMove(from, target)) {
      this.selection = null;
      const cards = this.#grabbed(target);
      if (cards.length && (target.zone !== 'tableau' || this.#isRun(cards))) {
        this.selection = { from: target };
      }
      this.play('back');
    }
  }

  #hitTest(x, y) {
    if (y >= TOP_Y && y <= TOP_Y + CARD_H) {
      for (let i = 0; i < 4; i++) {
        if (this.hits(x, y, this.#freeCellX(i), TOP_Y, CARD_W, CARD_H)) return { zone: 'free', index: i };
      }
      for (let i = 0; i < 4; i++) {
        if (this.hits(x, y, this.#foundationX(i), TOP_Y, CARD_W, CARD_H)) return { zone: 'foundation', suit: SUITS[i].id };
      }
      return null;
    }

    for (let col = 0; col < COLS; col++) {
      const cx = this.#columnX(col);
      if (x < cx || x > cx + CARD_W) continue;
      const pile = this.tableau[col];

      if (!pile.length) {
        if (this.hits(x, y, cx, TABLEAU_Y, CARD_W, CARD_H)) return { zone: 'tableau', col, index: 0 };
        continue;
      }
      for (let i = pile.length - 1; i >= 0; i--) {
        const cy = this.#tableauCardY(col, i);
        const height = i === pile.length - 1 ? CARD_H : FAN_DOWN;
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
    const grad = ctx.createRadialGradient(W / 2, H * 0.3, 40, W / 2, H * 0.5, W * 0.8);
    grad.addColorStop(0, 'rgba(96, 165, 250, 0.09)');
    grad.addColorStop(1, 'rgba(4, 12, 8, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    this.shake.apply(ctx);
    this.#drawFreeCells(ctx);
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
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 8).stroke();
    ctx.restore();
    if (label) {
      this.text(ctx, label, x + CARD_W / 2, y + CARD_H / 2, { size: 22, color: 'rgba(255,255,255,0.16)' });
    }
  }

  #drawFreeCells(ctx) {
    this.freecells.forEach((card, i) => {
      const x = this.#freeCellX(i);
      const selected = this.selection?.from.zone === 'free' && this.selection.from.index === i;
      if (card) this.#drawCard(ctx, x, TOP_Y, card, { selected });
      else this.#slot(ctx, x, TOP_Y, '');
    });
    this.text(ctx, 'FREE', this.#freeCellX(0), TOP_Y - 8, { size: 9, color: '#5c6478', align: 'left' });
  }

  #drawFoundations(ctx) {
    SUITS.forEach((suit, i) => {
      const x = this.#foundationX(i);
      const pile = this.foundations[suit.id];
      const selected = this.selection?.from.zone === 'foundation' && this.selection.from.suit === suit.id;
      if (!pile.length) this.#slot(ctx, x, TOP_Y, suit.glyph);
      else this.#drawCard(ctx, x, TOP_Y, pile[pile.length - 1], { selected });
    });
  }

  #drawTableau(ctx) {
    for (let col = 0; col < COLS; col++) {
      const x = this.#columnX(col);
      const pile = this.tableau[col];
      if (!pile.length) {
        this.#slot(ctx, x, TABLEAU_Y, '');
        continue;
      }
      pile.forEach((card, i) => {
        const y = this.#tableauCardY(col, i);
        const sel = this.selection;
        const selected = sel?.from.zone === 'tableau' && sel.from.col === col && i >= sel.from.index;
        this.#drawCard(ctx, x, y, card, { selected });
      });
    }
  }

  #drawCard(ctx, x, y, card, { selected = false } = {}) {
    ctx.save();
    if (selected) {
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = '#f4f7ff';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 8).fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? '#ffd23f' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = selected ? 2 : 1;
    this.roundRect(ctx, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 8).stroke();

    const ink = card.red ? '#d81f4a' : '#141821';
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '700 15px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(card.rank, x + 6, y + 5);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(card.glyph, x + 6, y + 22);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '34px system-ui, sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText(card.glyph, x + CARD_W / 2, y + CARD_H / 2 + 4);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x + CARD_W - 6, y + CARD_H - 5);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 15px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(card.rank, 0, 0);
    ctx.restore();

    ctx.restore();
  }
}
