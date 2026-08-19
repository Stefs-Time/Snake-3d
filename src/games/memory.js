import { BaseGame } from '../core/game.js';

/**
 * MEMORY
 *
 * Pairs, with the symbols drawn procedurally rather than pulled from a font —
 * so they are legible at any size, they glow like everything else in the
 * cabinet, and nothing has to be downloaded. Each round adds a pair and a
 * little less time, and matching two in a row builds a combo, which is what
 * turns "turn cards over" into something you can play well or badly.
 */

const W = 680;
const H = 500;

const SHAPES = [
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon',
  'ring', 'cross', 'bolt', 'moon', 'heart', 'spiral',
];
const COLORS = [
  '#38bdf8', '#f472b6', '#4ade80', '#fbbf24', '#c084fc', '#fb7185',
  '#22d3ee', '#a3e635', '#fb923c', '#e879f9', '#2dd4bf', '#facc15',
];

const FLIP_TIME = 0.2;
const HOLD_TIME = 0.75; // how long a mismatched pair stays visible

/** Padding baked around each card sprite so its glow has room to land. */
const PAD = 8;

/** Rounds get one more pair and slightly less time each. */
const ROUNDS = [
  { cols: 4, rows: 3, time: 70 },
  { cols: 4, rows: 4, time: 78 },
  { cols: 6, rows: 4, time: 96 },
  { cols: 6, rows: 4, time: 84 },
  { cols: 6, rows: 4, time: 72 },
];

export default class Memory extends BaseGame {
  static id = 'memory';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 34, bottom: 26 };
  static hudLabels = { score: 'Score', secondary: 'Round' };

  setup() {
    this.host.setSecondaryLabel('Round');
    this.host.setHint('Turn two cards and remember what you saw');
    this.setLives(3);
    this.layers = new Map();

    this.round = 0;
    this.breakTimer = 0;
    this.rings = [];
    this.hoverCard = null;
    this.#deal();

    this.banner('Find the pairs');
    this.play('ready');
  }

  teardown() {
    this.layers?.clear();
  }

  #deal() {
    const config = ROUNDS[Math.min(this.round, ROUNDS.length - 1)];
    this.cols = config.cols;
    this.rows = config.rows;
    this.timeLeft = config.time;
    this.roundTime = config.time;

    const pairs = (this.cols * this.rows) / 2;
    const kinds = [];
    for (let i = 0; i < pairs; i++) kinds.push(i, i);
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }

    this.cards = kinds.map((kind, i) => ({
      kind,
      col: i % this.cols,
      row: Math.floor(i / this.cols),
      faceUp: false,
      matched: false,
      flip: 0, // 0 face-down .. 1 face-up
      settle: 0, // rises briefly when the pair lands
    }));

    this.picked = [];
    this.holdTimer = 0;
    this.matches = 0;
    this.combo = 0;
    this.flips = 0;
    this.rings = [];
    this.hoverCard = null;
    this.host.setSecondary(this.round + 1);
    this.meta = { round: this.round + 1 };

    /* --- layout --- */
    const maxW = W - 60;
    const maxH = H - 90;
    const size = Math.min(maxW / this.cols, maxH / this.rows) - 10;
    this.cardW = size;
    this.cardH = size * 1.18;
    if (this.cardH * this.rows + (this.rows - 1) * 10 > maxH) {
      this.cardH = (maxH - (this.rows - 1) * 10) / this.rows;
      this.cardW = this.cardH / 1.18;
    }
    this.gridW = this.cols * this.cardW + (this.cols - 1) * 10;
    this.gridH = this.rows * this.cardH + (this.rows - 1) * 10;
    this.originX = (W - this.gridW) / 2;
    this.originY = 54 + (H - 54 - this.gridH) / 2;
  }

  #cardRect(card) {
    return [
      this.originX + card.col * (this.cardW + 10),
      this.originY + card.row * (this.cardH + 10),
      this.cardW,
      this.cardH,
    ];
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    for (const card of this.cards) {
      const target = card.faceUp || card.matched ? 1 : 0;
      card.flip += Math.sign(target - card.flip) * Math.min(dt / FLIP_TIME, Math.abs(target - card.flip));
      if (card.settle > 0) card.settle = Math.max(0, card.settle - dt / 0.35);
    }
    if (this.rings.length) {
      for (const ring of this.rings) ring.life -= dt;
      this.rings = this.rings.filter((r) => r.life > 0);
    }

    const m = this.mouse;
    this.hoverCard = null;

    if (this.breakTimer > 0) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) {
        if (this.finished) this.end();
        else this.#deal();
      }
      return;
    }

    /* --- a mismatched pair turning back over --- */
    if (this.holdTimer > 0) {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        for (const card of this.picked) card.faceUp = false;
        this.picked = [];
      }
      return;
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.#timeout();
      return;
    }

    if (this.picked.length >= 2) return;

    for (const card of this.cards) {
      if (card.matched || card.faceUp) continue;
      const [x, y, w, h] = this.#cardRect(card);
      if (!this.hits(m.x, m.y, x, y, w, h)) continue;
      this.hoverCard = card;

      if (!m.pressed) return;
      card.faceUp = true;
      this.picked.push(card);
      this.flips++;
      this.play('blip');
      if (this.picked.length === 2) this.#resolve();
      return;
    }
  }

  #resolve() {
    const [a, b] = this.picked;

    if (a.kind !== b.kind) {
      this.combo = 0;
      this.holdTimer = HOLD_TIME;
      this.play('hit');
      return;
    }

    a.matched = true;
    b.matched = true;
    a.settle = 1;
    b.settle = 1;
    this.matches++;
    this.combo++;
    this.picked = [];

    // Back-to-back matches are worth progressively more.
    const points = 150 + (this.combo - 1) * 75;
    const color = COLORS[a.kind % COLORS.length];
    const [x, y, w, h] = this.#cardRect(b);
    this.addScore(points, { x: x + w / 2, y: y + h / 2, color, label: `+${points}` });
    this.play('powerup');
    this.shake.add(3);
    if (this.combo > 1) this.banner(`Combo x${this.combo}`);

    // Both halves of the pair ripple, so the eye connects them.
    for (const card of [a, b]) {
      const [cx, cy, cw, ch] = this.#cardRect(card);
      this.rings.push({
        x: cx + cw / 2, y: cy + ch / 2, r0: Math.min(cw, ch) * 0.4,
        life: 0.45, maxLife: 0.45, color,
      });
      this.particles.emit(cx + cw / 2, cy + ch / 2, {
        count: 10, speed: 110, color, life: 0.5, size: 2.8, shape: 'circle',
      });
    }

    if (this.matches * 2 === this.cards.length) this.#clearRound();
  }

  #clearRound() {
    // Fewer flips than cards means you were genuinely remembering.
    const perfect = this.flips === this.cards.length;
    const bonus = 500 + Math.round(this.timeLeft) * 10 + (perfect ? 1500 : 0);
    this.addScore(bonus);
    this.banner(perfect ? 'Flawless!' : 'Cleared');
    this.play('highscore');
    this.round++;
    this.breakTimer = 1.8;
  }

  #timeout() {
    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    this.play('die');
    this.shake.add(10);
    this.meta = { round: this.round + 1, matches: this.matches };
    this.breakTimer = 1.6;
    if (lives <= 0) this.finished = true;
    else this.banner('Out of time');
  }

  /* ================================================================= draw */

  draw(ctx) {
    ctx.drawImage(this.#backdrop(), 0, 0, W, H);
    ctx.save();
    this.shake.apply(ctx);

    this.#drawTimer(ctx);
    for (const card of this.cards) this.#drawCard(ctx, card);
    this.#drawRings(ctx);
    this.drawEffects(ctx);

    ctx.restore();
  }

  #drawTimer(ctx) {
    const barW = W - 80;
    const pct = Math.max(0, Math.min(1, this.timeLeft / this.roundTime));
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    this.roundRect(ctx, 40, 26, barW, 7, 4).fill();
    ctx.fillStyle = pct < 0.25 ? '#fb7185' : '#38bdf8';
    ctx.shadowColor = pct < 0.25 ? '#fb7185' : '#38bdf8';
    ctx.shadowBlur = 10;
    this.roundRect(ctx, 40, 26, Math.max(2, barW * pct), 7, 4).fill();
    ctx.restore();

    if (this.combo > 1) {
      this.text(ctx, `COMBO x${this.combo}`, W / 2, 14, { size: 11, color: '#fbbf24', glow: 8 });
    }
  }

  #drawRings(ctx) {
    if (!this.rings.length) return;
    ctx.save();
    ctx.lineWidth = 2.5;
    for (const ring of this.rings) {
      const k = 1 - ring.life / ring.maxLife;
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = ring.color;
      ctx.shadowColor = ring.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r0 + k * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawCard(ctx, card) {
    const [x, y, w, h] = this.#cardRect(card);
    // The flip is a horizontal squash through the midpoint.
    const t = card.flip;
    const scaleX = Math.abs(Math.cos(t * Math.PI));
    const showFace = t > 0.5;
    const drawW = Math.max(2, w * (t === 0 || t === 1 ? 1 : scaleX));
    const sx = drawW / w;
    const sprite = showFace ? this.#faceSprite(card.kind) : this.#backSprite();

    ctx.save();
    if (card.matched) ctx.globalAlpha = 0.55;
    const lift = card.settle > 0 ? Math.sin(card.settle * Math.PI) * 4 : 0;
    ctx.drawImage(sprite, x + (w - drawW) / 2 - PAD * sx, y - PAD - lift, (w + PAD * 2) * sx, h + PAD * 2);
    ctx.restore();

    if (!showFace && card === this.hoverCard) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56,189,248,0.6)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      this.roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 9).stroke();
      ctx.restore();
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

  /** The table, painted once: cool wash, corner vignette, faint dot grid. */
  #backdrop() {
    return this.#layer('bg', W, H, (g) => {
      g.fillStyle = '#070a12';
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.5, W * 0.75);
      glow.addColorStop(0, 'rgba(56,189,248,0.07)');
      glow.addColorStop(1, 'rgba(4,8,16,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      const vig = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.38)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let y = 16; y < H; y += 32) {
        for (let x = 16; x < W; x += 32) g.fillRect(x - 1, y - 1, 2, 2);
      }
    });
  }

  #sizeKey() {
    return `${Math.round(this.cardW)}x${Math.round(this.cardH)}`;
  }

  /** Card face: dark top-lit panel, neon edge and glyph baked in one pass. */
  #faceSprite(kind) {
    const w = this.cardW;
    const h = this.cardH;
    return this.#layer(`face:${kind}:${this.#sizeKey()}`, w + PAD * 2, h + PAD * 2, (g) => {
      const color = COLORS[kind % COLORS.length];
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 5;
      g.shadowOffsetY = 2;
      const body = g.createLinearGradient(0, PAD, 0, PAD + h);
      body.addColorStop(0, '#1c2436');
      body.addColorStop(0.16, '#161d2c');
      body.addColorStop(1, '#0f1420');
      g.fillStyle = body;
      this.roundRect(g, PAD, PAD, w, h, 10).fill();
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      this.roundRect(g, PAD + 2, PAD + 2, w - 4, h - 4, 8).stroke();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.shadowColor = color;
      g.shadowBlur = 12;
      this.roundRect(g, PAD + 1, PAD + 1, w - 2, h - 2, 9).stroke();
      this.#drawSymbol(g, kind, PAD + w / 2, PAD + h / 2, Math.min(w, h) * 0.3);
    });
  }

  /** Card back: indigo body, cyan lattice, concentric-ring motif. */
  #backSprite() {
    const w = this.cardW;
    const h = this.cardH;
    return this.#layer(`back:${this.#sizeKey()}`, w + PAD * 2, h + PAD * 2, (g) => {
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 5;
      g.shadowOffsetY = 2;
      const body = g.createLinearGradient(0, PAD, 0, PAD + h);
      body.addColorStop(0, '#152036');
      body.addColorStop(1, '#0d1322');
      g.fillStyle = body;
      this.roundRect(g, PAD, PAD, w, h, 10).fill();
      g.restore();
      g.strokeStyle = 'rgba(56,189,248,0.32)';
      g.lineWidth = 1.5;
      this.roundRect(g, PAD + 0.75, PAD + 0.75, w - 1.5, h - 1.5, 9).stroke();

      g.save();
      this.roundRect(g, PAD + 5, PAD + 5, w - 10, h - 10, 6).clip();
      g.strokeStyle = 'rgba(56,189,248,0.1)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = -h; i < w + h; i += 10) {
        g.moveTo(PAD + i, PAD + h);
        g.lineTo(PAD + i + h, PAD);
        g.moveTo(PAD + i, PAD);
        g.lineTo(PAD + i + h, PAD + h);
      }
      g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(56,189,248,0.2)';
      this.roundRect(g, PAD + 5, PAD + 5, w - 10, h - 10, 6).stroke();

      const cx = PAD + w / 2;
      const cy = PAD + h / 2;
      const r = Math.min(w, h);
      g.strokeStyle = 'rgba(56,189,248,0.5)';
      g.lineWidth = 1.4;
      g.shadowColor = '#38bdf8';
      g.shadowBlur = 8;
      g.beginPath();
      g.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(255,46,136,0.4)';
      g.shadowColor = '#ff2e88';
      g.beginPath();
      g.arc(cx, cy, r * 0.31, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(56,189,248,0.7)';
      g.shadowColor = '#38bdf8';
      g.beginPath();
      g.arc(cx, cy, r * 0.045, 0, Math.PI * 2);
      g.fill();
    });
  }

  /** Twelve distinct shapes, all drawn from paths. */
  #drawSymbol(ctx, kind, cx, cy, r) {
    const shape = SHAPES[kind % SHAPES.length];
    const color = COLORS[kind % COLORS.length];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    const poly = (n, rotate = 0, radius = r) => {
      for (let i = 0; i < n; i++) {
        const a = rotate + (i / n) * Math.PI * 2;
        const px = Math.cos(a) * radius;
        const py = Math.sin(a) * radius;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    };

    switch (shape) {
      case 'circle':
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'square':
        ctx.rect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
        ctx.fill();
        break;
      case 'triangle':
        poly(3, -Math.PI / 2);
        ctx.fill();
        break;
      case 'diamond':
        poly(4, -Math.PI / 2);
        ctx.fill();
        break;
      case 'hexagon':
        poly(6, -Math.PI / 2);
        ctx.fill();
        break;
      case 'star': {
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
          const radius = i % 2 === 0 ? r : r * 0.45;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'ring':
        ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
        ctx.lineWidth = r * 0.42;
        ctx.stroke();
        break;
      case 'cross':
        ctx.moveTo(-r * 0.8, -r * 0.8);
        ctx.lineTo(r * 0.8, r * 0.8);
        ctx.moveTo(r * 0.8, -r * 0.8);
        ctx.lineTo(-r * 0.8, r * 0.8);
        ctx.lineWidth = r * 0.34;
        ctx.stroke();
        break;
      case 'bolt':
        ctx.moveTo(r * 0.28, -r);
        ctx.lineTo(-r * 0.5, r * 0.12);
        ctx.lineTo(r * 0.04, r * 0.12);
        ctx.lineTo(-r * 0.28, r);
        ctx.lineTo(r * 0.55, -r * 0.16);
        ctx.lineTo(-r * 0.02, -r * 0.16);
        ctx.closePath();
        ctx.fill();
        break;
      case 'moon':
        ctx.arc(0, 0, r, Math.PI * 0.35, Math.PI * 1.65);
        ctx.arc(-r * 0.42, 0, r * 0.82, Math.PI * 1.6, Math.PI * 0.4, true);
        ctx.closePath();
        ctx.fill();
        break;
      case 'heart':
        ctx.moveTo(0, r * 0.85);
        ctx.bezierCurveTo(-r * 1.5, -r * 0.2, -r * 0.5, -r * 1.1, 0, -r * 0.35);
        ctx.bezierCurveTo(r * 0.5, -r * 1.1, r * 1.5, -r * 0.2, 0, r * 0.85);
        ctx.fill();
        break;
      case 'spiral':
        ctx.lineWidth = 2.6;
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 4;
          const radius = (i / 60) * r;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
        break;
      default:
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
  }
}
