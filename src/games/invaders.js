import { BaseGame } from '../core/game.js';

/**
 * INVADERS
 *
 * The famous difficulty curve was an accident: the 1978 hardware could only
 * redraw so many sprites per frame, so the fewer aliens were left, the faster
 * the whole formation moved. It turned out to be the best pacing mechanic in
 * the game, so it is reproduced here deliberately — step interval is a
 * function of how many aliens are still alive.
 */

const W = 448;
const H = 512;

const COLS = 11;
const ROWS = 5;
const ALIEN_W = 24;
const ALIEN_H = 16;
const GAP_X = 14;
const GAP_Y = 12;

const ROW_TYPES = [2, 1, 1, 0, 0]; // 2 = squid (top, worth most), 0 = grunt
const ROW_POINTS = [10, 20, 30];
const ROW_COLORS = ['#39ff88', '#00e5ff', '#b47bff'];

const PLAYER_Y = H - 54;
const FLOOR_Y = H - 30;

export default class Invaders extends BaseGame {
  static id = 'invaders';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'dpad';
  static touchButtons = { action: 'FIRE' };
  static smooth = true;
  static hudPad = { top: 30, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Wave' };

  setup() {
    this.host.setSecondaryLabel('Wave');
    this.host.setHint('← → to move · Space to fire', 'Pad to move · FIRE to shoot');

    this.wave = 1;
    this.setLives(3);
    this.#buildBackdrop();
    this.#startWave();
  }

  /**
   * The sky never changes, so the vignette, stars and dot grid are rendered
   * once to an offscreen canvas at 2x and blitted every frame.
   */
  #buildBackdrop() {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const b = canvas.getContext('2d');
    b.scale(scale, scale);

    b.fillStyle = '#04060a';
    b.fillRect(0, 0, W, H);
    const sky = b.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, 'rgba(180,123,255,0.10)');
    sky.addColorStop(0.55, 'rgba(4,6,10,0)');
    sky.addColorStop(1, 'rgba(0,229,255,0.06)');
    b.fillStyle = sky;
    b.fillRect(0, 0, W, H);

    for (let i = 0; i < 70; i++) {
      const x = this.random() * W;
      const y = this.random() * (H - 90);
      b.fillStyle = `rgba(255,255,255,${(0.08 + this.random() * 0.28).toFixed(3)})`;
      b.fillRect(x, y, 1.5, 1.5);
    }

    b.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = 64; x < W; x += 64) {
      for (let y = 64; y < H; y += 64) b.fillRect(x - 1, y - 1, 2, 2);
    }
    this.backdrop = canvas;
  }

  #startWave() {
    this.host.setSecondary(this.wave);

    this.aliens = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        this.aliens.push({
          col,
          row,
          type: ROW_TYPES[row],
          x: 40 + col * (ALIEN_W + GAP_X),
          y: 70 + row * (ALIEN_H + GAP_Y) + Math.min(4, this.wave - 1) * 18,
          alive: true,
        });
      }
    }

    this.direction = 1;
    this.stepTimer = 0;
    this.frame = 0;
    this.dropQueued = false;

    this.player = { x: W / 2, y: PLAYER_Y, w: 34, h: 12, cooldown: 0, dead: 0 };
    this.bullets = [];
    this.bombs = [];
    this.ufo = null;
    this.ufoTimer = 12 + this.random() * 10;

    this.#buildShields();

    this.state = 'ready';
    this.stateTimer = 1.6;
    this.banner(`Wave ${this.wave}`);
    this.play('ready');
  }

  /**
   * Shields are a grid of small blocks so they erode realistically — each hit
   * removes a few blocks around the impact rather than the whole shield.
   */
  #buildShields() {
    const SHAPE = [
      '  ######  ',
      ' ######## ',
      '##########',
      '##########',
      '###    ###',
      '##      ##',
    ];
    const BLOCK = 5;
    this.shields = [];

    for (let s = 0; s < 4; s++) {
      const baseX = 55 + s * 96;
      const baseY = H - 150;
      const blocks = [];
      SHAPE.forEach((line, row) => {
        [...line].forEach((ch, col) => {
          if (ch === '#') {
            blocks.push({
              x: baseX + col * BLOCK, y: baseY + row * BLOCK, size: BLOCK,
              alive: true, top: row < 2,
            });
          }
        });
      });
      this.shields.push(blocks);
    }
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);

    if (this.state === 'ready') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'play';
      return;
    }

    if (this.state === 'dying') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.#afterDeath();
      return;
    }

    if (this.state === 'cleared') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.wave++;
        this.#startWave();
      }
      return;
    }

    this.#updatePlayer(dt);
    this.#updateFormation(dt);
    this.#updateUfo(dt);
    this.#updateProjectiles(dt);
  }

  #updatePlayer(dt) {
    const p = this.player;
    const speed = 210;
    p.x += this.input.axisX() * speed * dt;
    p.x = Math.max(p.w / 2 + 6, Math.min(W - p.w / 2 - 6, p.x));

    p.cooldown -= dt;
    // Holding fire auto-repeats, but only one shot is ever in flight.
    if (this.input.held('action') && p.cooldown <= 0 && this.bullets.length === 0) {
      this.bullets.push({ x: p.x, y: p.y - 12, vy: -420 });
      p.cooldown = 0.28;
      this.play('laser');
    }
  }

  #updateFormation(dt) {
    const alive = this.aliens.filter((a) => a.alive);
    if (!alive.length) {
      this.state = 'cleared';
      this.stateTimer = 1.8;
      this.addScore(500 + this.wave * 100);
      this.banner('Wave clear');
      this.play('levelup');
      return;
    }

    // An alien that descends far enough to touch the cannon destroys it —
    // otherwise the formation could sit in the player's lap with no effect
    // until the separate landing check fired.
    const p = this.player;
    for (const alien of alive) {
      if (
        alien.y + ALIEN_H > p.y - 12 &&
        alien.x + ALIEN_W > p.x - p.w / 2 && alien.x < p.x + p.w / 2
      ) {
        this.#playerHit();
        return;
      }
    }

    // This is the whole trick: fewer aliens, faster steps.
    const ratio = alive.length / (COLS * ROWS);
    const interval = Math.max(0.055, (0.55 * ratio + 0.05) / (1 + (this.wave - 1) * 0.12));

    this.stepTimer += dt;
    if (this.stepTimer < interval) return;
    this.stepTimer -= interval;
    this.frame++;

    if (this.dropQueued) {
      this.dropQueued = false;
      this.direction *= -1;
      for (const alien of alive) alien.y += 14;
      this.play('hit');
    } else {
      const step = 8;
      for (const alien of alive) alien.x += step * this.direction;

      const minX = Math.min(...alive.map((a) => a.x));
      const maxX = Math.max(...alive.map((a) => a.x));
      if (minX < 22 || maxX > W - 22 - ALIEN_W) this.dropQueued = true;

      this.tone(120 + (1 - ratio) * 140 + (this.frame % 4) * 18, { dur: 0.05, gain: 0.09, type: 'square' });
    }

    // Landing is an instant loss, however many lives are left.
    if (alive.some((a) => a.y + ALIEN_H >= FLOOR_Y - 10)) {
      this.setLives(0);
      this.#playerHit(true);
      return;
    }

    this.#alienFire(alive);
  }

  #alienFire(alive) {
    // Only the front alien in a column can shoot.
    const frontline = new Map();
    for (const alien of alive) {
      const current = frontline.get(alien.col);
      if (!current || alien.y > current.y) frontline.set(alien.col, alien);
    }
    const shooters = [...frontline.values()];
    const chance = 0.035 + this.wave * 0.008 + (1 - alive.length / (COLS * ROWS)) * 0.05;
    if (this.random() > chance || this.bombs.length >= 4) return;

    const shooter = shooters[Math.floor(this.random() * shooters.length)];
    this.bombs.push({ x: shooter.x + ALIEN_W / 2, y: shooter.y + ALIEN_H, vy: 150 + this.wave * 12 });
  }

  #updateUfo(dt) {
    if (this.ufo) {
      this.ufo.x += this.ufo.vx * dt;
      if (this.ufo.x < -40 || this.ufo.x > W + 40) this.ufo = null;
      return;
    }
    this.ufoTimer -= dt;
    if (this.ufoTimer <= 0) {
      const fromLeft = this.random() < 0.5;
      this.ufo = { x: fromLeft ? -30 : W + 30, y: 40, vx: fromLeft ? 90 : -90 };
      this.ufoTimer = 18 + this.random() * 14;
    }
  }

  #updateProjectiles(dt) {
    /* --- player shots --- */
    for (const bullet of this.bullets) {
      bullet.y += bullet.vy * dt;
    }
    this.bullets = this.bullets.filter((bullet) => {
      if (bullet.y < 20) return false;
      if (this.#hitShield(bullet.x, bullet.y, 3)) return false;

      if (this.ufo && Math.abs(bullet.x - this.ufo.x) < 20 && Math.abs(bullet.y - this.ufo.y) < 10) {
        const points = [50, 100, 150, 300][Math.floor(this.random() * 4)];
        this.addScore(points, { x: this.ufo.x, y: this.ufo.y, color: '#ff2e88', label: String(points) });
        this.particles.emit(this.ufo.x, this.ufo.y, {
          count: 24, speed: 160, color: '#ff2e88', life: 0.6, size: 3,
        });
        this.play('powerup');
        this.shake.add(6);
        this.ufo = null;
        return false;
      }

      for (const alien of this.aliens) {
        if (!alien.alive) continue;
        if (
          bullet.x > alien.x && bullet.x < alien.x + ALIEN_W &&
          bullet.y > alien.y && bullet.y < alien.y + ALIEN_H
        ) {
          alien.alive = false;
          this.addScore(ROW_POINTS[alien.type], {
            x: alien.x + ALIEN_W / 2, y: alien.y, color: ROW_COLORS[alien.type],
          });
          this.particles.emit(alien.x + ALIEN_W / 2, alien.y + ALIEN_H / 2, {
            count: 14, speed: 130, color: ROW_COLORS[alien.type], life: 0.5, size: 2.6,
          });
          this.play('explode');
          this.shake.add(2.5);
          this.meta = { wave: this.wave };
          return false;
        }
      }
      return true;
    });

    /* --- alien bombs --- */
    for (const bomb of this.bombs) {
      bomb.y += bomb.vy * dt;
    }
    this.bombs = this.bombs.filter((bomb) => {
      if (bomb.y > FLOOR_Y) return false;
      if (this.#hitShield(bomb.x, bomb.y, 4)) return false;

      const p = this.player;
      if (
        bomb.x > p.x - p.w / 2 && bomb.x < p.x + p.w / 2 &&
        bomb.y > p.y - p.h && bomb.y < p.y + p.h
      ) {
        this.#playerHit();
        return false;
      }
      return true;
    });
  }

  /** Erode a shield around an impact. Returns true if something was hit. */
  #hitShield(x, y, radius) {
    for (const shield of this.shields) {
      for (const block of shield) {
        if (!block.alive) continue;
        if (
          x >= block.x - radius && x <= block.x + block.size + radius &&
          y >= block.y - radius && y <= block.y + block.size + radius
        ) {
          // Take out a small cluster so damage looks like a bite, not a pixel.
          for (const other of shield) {
            if (!other.alive) continue;
            if (Math.hypot(other.x - block.x, other.y - block.y) <= radius + 3) {
              other.alive = false;
              this.particles.emit(other.x + 2, other.y + 2, {
                count: 2, speed: 50, color: '#39ff88', life: 0.3, size: 2,
              });
            }
          }
          return true;
        }
      }
    }
    return false;
  }

  #playerHit(fatal = false) {
    if (this.state === 'dying') return;
    this.state = 'dying';
    this.stateTimer = 1.4;
    this.fatal = fatal;
    this.play('explode');
    this.shake.add(12);
    this.particles.emit(this.player.x, this.player.y, {
      count: 30, speed: 170, color: '#ffd23f', life: 0.9, size: 3, gravity: 120,
    });
    this.bombs = [];
    this.bullets = [];
  }

  #afterDeath() {
    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    this.meta = { wave: this.wave };
    if (lives <= 0 || this.fatal) {
      this.end();
      return;
    }
    this.player.x = W / 2;
    this.state = 'ready';
    this.stateTimer = 1.2;
    this.banner('Ready');
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.backdrop, 0, 0, W, H);

    /* --- aliens --- */
    const wobble = this.frame % 2;
    for (const alien of this.aliens) {
      if (!alien.alive) continue;
      this.#drawAlien(ctx, alien, wobble);
    }

    /* --- ufo --- */
    if (this.ufo) {
      ctx.save();
      ctx.shadowColor = '#ff2e88';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ff2e88';
      ctx.beginPath();
      ctx.ellipse(this.ufo.x, this.ufo.y, 20, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(this.ufo.x - 8, this.ufo.y - 11, 16, 6);
      // Hull lights and a dim glass dome.
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const dx of [-12, 0, 12]) ctx.fillRect(this.ufo.x + dx - 1.5, this.ufo.y - 1.5, 3, 3);
      ctx.fillStyle = 'rgba(255,184,222,0.5)';
      ctx.fillRect(this.ufo.x - 6, this.ufo.y - 10, 12, 3);
      ctx.restore();
    }

    /* --- shields --- */
    for (const shield of this.shields) {
      for (const block of shield) {
        if (!block.alive) continue;
        ctx.fillStyle = block.top ? '#8affc0' : '#39ff88';
        ctx.fillRect(block.x, block.y, block.size, block.size);
      }
    }

    /* --- player --- */
    if (this.state !== 'dying') {
      const p = this.player;
      ctx.save();
      ctx.shadowColor = '#b47bff';
      ctx.shadowBlur = 12;
      const hull = ctx.createLinearGradient(0, p.y - 12, 0, p.y + p.h);
      hull.addColorStop(0, '#ffffff');
      hull.addColorStop(0.45, '#d9c7ff');
      hull.addColorStop(1, '#9578e8');
      ctx.fillStyle = hull;
      ctx.fillRect(p.x - p.w / 2, p.y, p.w, p.h);
      ctx.fillRect(p.x - 4, p.y - 7, 8, 8);
      ctx.fillRect(p.x - 1.5, p.y - 12, 3, 6);
      // A warm muzzle tip while the shot is ready.
      if (p.cooldown <= 0 && this.bullets.length === 0) {
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(p.x - 1.5, p.y - 14, 3, 2);
      }
      ctx.restore();
    }

    /* --- projectiles --- */
    for (const bullet of this.bullets) {
      this.glowRect(ctx, bullet.x - 1.5, bullet.y, 3, 12, '#ffffff', 10);
    }
    for (const bomb of this.bombs) {
      ctx.save();
      ctx.strokeStyle = '#ff5c7a';
      ctx.shadowColor = '#ff5c7a';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      // A little zig-zag, so bombs read differently from your own shots.
      for (let i = 0; i < 4; i++) {
        const y = bomb.y - i * 4;
        const x = bomb.x + (i % 2 === 0 ? -3 : 3);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    /* --- floor --- */
    this.glowLine(ctx, 0, FLOOR_Y, W, FLOOR_Y, '#b47bff', 2, 12);

    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawAlien(ctx, alien, wobble) {
    const color = ROW_COLORS[alien.type];
    const x = alien.x;
    const y = alien.y;
    const u = ALIEN_W / 12; // sprite unit

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;

    if (alien.type === 2) {
      // Squid.
      ctx.fillRect(x + u * 4, y, u * 4, u * 3);
      ctx.fillRect(x + u * 2, y + u * 3, u * 8, u * 4);
      ctx.fillRect(x, y + u * 5, u * 12, u * 3);
      ctx.fillRect(x + u * (wobble ? 1 : 2), y + u * 8, u * 2, u * 2);
      ctx.fillRect(x + u * (wobble ? 9 : 8), y + u * 8, u * 2, u * 2);
    } else if (alien.type === 1) {
      // Crab.
      ctx.fillRect(x + u, y, u * 10, u * 2);
      ctx.fillRect(x, y + u * 2, u * 12, u * 5);
      ctx.fillRect(x + u * (wobble ? 0 : 1), y + u * 7, u * 3, u * 3);
      ctx.fillRect(x + u * (wobble ? 9 : 8), y + u * 7, u * 3, u * 3);
    } else {
      // Grunt.
      ctx.fillRect(x + u * 2, y, u * 8, u * 6);
      ctx.fillRect(x, y + u * 2, u * 12, u * 4);
      ctx.fillRect(x + u * (wobble ? 1 : 3), y + u * 6, u * 2, u * 3);
      ctx.fillRect(x + u * (wobble ? 9 : 7), y + u * 6, u * 2, u * 3);
    }

    // Eyes.
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#04060a';
    ctx.fillRect(x + u * 3.5, y + u * 3, u * 1.6, u * 1.6);
    ctx.fillRect(x + u * 7, y + u * 3, u * 1.6, u * 1.6);
    ctx.restore();
  }
}
