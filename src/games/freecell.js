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
    this.layers = new Map();

    this.#deal();
    this.banner('FreeCell');
    this.play('ready');
  }

  teardown() {
    this.layers?.clear();
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
      const fi = SUITS.findIndex((s) => s.id === to.suit);
      const fx = this.#foundationX(fi) + CARD_W / 2;
      this.#award(15, { x: fx, y: TOP_Y + CARD_H + 8, color: '#ffd23f' });
      const done = this.foundations[to.suit].length === 13;
      this.particles.emit(fx, TOP_Y + CARD_H / 2, {
        count: done ? 26 : 9, speed: done ? 160 : 110,
        color: lead.red ? '#ff2e88' : '#00e5ff', life: 0.5, size: 2.6, shape: 'circle',
      });
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
      const destHadCards = this.tableau[to.col].length > 0;
      this.#snapshot();
      const moved = this.#removeGrabbed(from);
      this.tableau[to.col].push(...moved);
      if (from.zone === 'foundation') this.addScore(-15);
      else this.play('select');
      // Cleared a column — but shuttling a pile between empty columns is not
      // clearing anything, so the landing spot must have held cards.
      if (from.zone === 'tableau' && wasEmpty && destHadCards) this.#award(20);
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
    ctx.drawImage(this.#felt(), 0, 0, W, H);

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
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    this.roundRect(ctx, x, y, CARD_W, CARD_H, 8).fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.18)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x + 0.75, y + 0.75, CARD_W - 1.5, CARD_H - 1.5, 7).stroke();
    ctx.restore();
    if (label) {
      this.text(ctx, label, x + CARD_W / 2, y + CARD_H / 2, { size: 22, color: 'rgba(0,229,255,0.18)' });
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
    const yy = selected ? y - 3 : y;
    if (selected) {
      ctx.save();
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255,210,63,0.85)';
      this.roundRect(ctx, x - 1.5, yy - 1.5, CARD_W + 3, CARD_H + 3, 9).fill();
      ctx.restore();
    }
    ctx.drawImage(this.#cardSprite(card), x - PAD, yy - PAD, CARD_W + PAD * 2, CARD_H + PAD * 2);
    if (selected) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      this.roundRect(ctx, x + 0.5, yy + 0.5, CARD_W - 1, CARD_H - 1, 8).stroke();
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

  /** The table, painted once: cool blue wash, corner vignette, faint weave. */
  #felt() {
    return this.#layer('felt', W, H, (g) => {
      g.fillStyle = '#080f14';
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W / 2, H * 0.3, 40, W / 2, H * 0.5, W * 0.8);
      glow.addColorStop(0, 'rgba(96,165,250,0.11)');
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
    return this.#layer(`card:${card.rank}${card.suit}`, CARD_W + PAD * 2, CARD_H + PAD * 2, (g) => {
      this.#paintFace(g, PAD, PAD, card);
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
    this.roundRect(g, x, y, CARD_W, CARD_H, 8).fill();
    g.restore();
    g.strokeStyle = 'rgba(13,18,30,0.5)';
    g.lineWidth = 1;
    this.roundRect(g, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 7.5).stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    this.roundRect(g, x + 1.5, y + 1.5, CARD_W - 3, CARD_H - 3, 6.5).stroke();

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
}
