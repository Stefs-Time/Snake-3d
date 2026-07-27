/**
 * Visual garnish shared by the 2D games: a pooled particle system, floating
 * score popups, and screen shake. Nothing here affects gameplay — it can all
 * be switched off without changing a single rule.
 */

import { settings } from './settings.js';

export class Particles {
  constructor(limit = 400) {
    this.limit = limit;
    /** Flat pool; dead particles are reused rather than reallocated. */
    this.pool = Array.from({ length: limit }, () => ({ life: 0 }));
    this.cursor = 0;
  }

  #take() {
    // Round-robin: the oldest particle is the one we overwrite under pressure.
    for (let i = 0; i < this.limit; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.limit;
      if (p.life <= 0) return p;
    }
    return this.pool[this.cursor];
  }

  emit(x, y, opts = {}) {
    const count = opts.count ?? 8;
    const speed = opts.speed ?? 90;
    const spread = opts.spread ?? Math.PI * 2;
    const angle = opts.angle ?? 0;

    for (let i = 0; i < count; i++) {
      const p = this.#take();
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v + (opts.vx ?? 0);
      p.vy = Math.sin(a) * v + (opts.vy ?? 0);
      p.life = p.maxLife = (opts.life ?? 0.5) * (0.6 + Math.random() * 0.7);
      p.size = opts.size ?? 2.4;
      p.color = opts.color ?? '#ffffff';
      p.gravity = opts.gravity ?? 0;
      p.drag = opts.drag ?? 0.94;
      p.shape = opts.shape ?? 'square';
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.4);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + t * 0.6);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.pool) p.life = 0;
  }
}

/** Numbers that drift upward when you score. */
export class Popups {
  constructor() {
    this.items = [];
  }

  add(x, y, text, color = '#ffffff', size = 14) {
    this.items.push({ x, y, text, color, size, life: 0.9, maxLife: 0.9 });
    if (this.items.length > 24) this.items.shift();
  }

  update(dt) {
    for (const p of this.items) {
      p.life -= dt;
      p.y -= 34 * dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx, font = 'monospace') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.items) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.8);
      ctx.font = `700 ${p.size}px ${font}`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  clear() {
    this.items = [];
  }
}

/** Decaying screen shake. Respects the player's setting. */
export class Shake {
  constructor() {
    this.amount = 0;
    this.x = 0;
    this.y = 0;
  }

  add(amount) {
    if (!settings.get('shake')) return;
    this.amount = Math.min(24, this.amount + amount);
  }

  update(dt) {
    this.amount *= Math.pow(0.0016, dt); // ~decays over a quarter second
    if (this.amount < 0.05) this.amount = 0;
    this.x = (Math.random() - 0.5) * 2 * this.amount;
    this.y = (Math.random() - 0.5) * 2 * this.amount;
  }

  apply(ctx) {
    if (this.amount > 0) ctx.translate(this.x, this.y);
  }
}

/** Deterministic PRNG (mulberry32) — handy for reproducible levels. */
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
