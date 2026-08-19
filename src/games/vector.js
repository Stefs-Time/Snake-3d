import { BaseGame } from '../core/game.js';

/**
 * VECTOR
 *
 * Everything here is drawn as line art, and everything moves under momentum.
 * There is no braking — you turn to face where you came from and thrust to
 * cancel your drift, which is the skill the whole game is built on. Rocks
 * split when shot, so a clean screen is always three bad decisions away.
 */

const W = 640;
const H = 480;

const SIZES = {
  large: { radius: 44, points: 20, next: 'medium' },
  medium: { radius: 24, points: 50, next: 'small' },
  small: { radius: 13, points: 100, next: null },
};

export default class Vector extends BaseGame {
  static id = 'vector';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'dpad';
  static touchButtons = { action: 'FIRE', secondary: 'HYPER' };
  static smooth = true;
  static hudPad = { top: 30, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Wave' };

  setup() {
    this.host.setSecondaryLabel('Wave');
    this.host.setHint('← → turn · ↑ thrust · Space fire · Shift hyperspace',
      'Pad to turn and thrust · FIRE · HYPER');

    this.wave = 1;
    this.setLives(3);

    this.bullets = [];
    this.rocks = [];
    this.saucer = null;
    this.saucerTimer = 28;
    this.hyperCooldown = 0;

    this.#buildBackdrop();
    this.#resetShip(true);
    this.#spawnWave();
  }

  /**
   * Space itself never changes, so the nebula haze and the starfield are
   * rendered once to an offscreen canvas at 2x and blitted every frame.
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
    const haze = b.createRadialGradient(W * 0.3, H * 0.25, 40, W * 0.3, H * 0.25, H * 0.9);
    haze.addColorStop(0, 'rgba(125,211,252,0.07)');
    haze.addColorStop(1, 'rgba(4,6,10,0)');
    b.fillStyle = haze;
    b.fillRect(0, 0, W, H);
    const haze2 = b.createRadialGradient(W * 0.78, H * 0.8, 30, W * 0.78, H * 0.8, H * 0.7);
    haze2.addColorStop(0, 'rgba(180,123,255,0.06)');
    haze2.addColorStop(1, 'rgba(4,6,10,0)');
    b.fillStyle = haze2;
    b.fillRect(0, 0, W, H);

    for (let i = 0; i < 110; i++) {
      const x = this.random() * W;
      const y = this.random() * H;
      const size = this.random() < 0.85 ? 1.2 : 2;
      b.fillStyle = `rgba(255,255,255,${(0.1 + this.random() * 0.35).toFixed(3)})`;
      b.fillRect(x, y, size, size);
    }
    this.backdrop = canvas;
  }

  #resetShip(fresh = false) {
    this.ship = {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      cooldown: 0,
      // Blinking and untouchable for a moment after a respawn.
      invulnerable: fresh ? 2 : 3,
      thrusting: false,
      alive: true,
    };
  }

  #spawnWave() {
    this.host.setSecondary(this.wave);
    const count = Math.min(11, 3 + this.wave);

    for (let i = 0; i < count; i++) {
      // Never spawn a rock on top of the ship.
      let x;
      let y;
      do {
        x = this.random() * W;
        y = this.random() * H;
      } while (Math.hypot(x - this.ship.x, y - this.ship.y) < 140);
      this.rocks.push(this.#makeRock(x, y, 'large'));
    }

    this.banner(`Wave ${this.wave}`);
    this.play('ready');
  }

  #makeRock(x, y, size) {
    const def = SIZES[size];
    const speed = (26 + this.random() * 34) * (1 + (this.wave - 1) * 0.07);
    const angle = this.random() * Math.PI * 2;

    // A fixed, lumpy silhouette per rock so they all look hand-cut.
    const vertices = [];
    const points = 9 + Math.floor(this.random() * 4);
    for (let i = 0; i < points; i++) {
      vertices.push(0.68 + this.random() * 0.5);
    }

    return {
      x, y, size,
      radius: def.radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (this.random() - 0.5) * 1.6,
      rotation: this.random() * Math.PI * 2,
      vertices,
    };
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);

    this.#updateRocks(dt);
    this.#updateBullets(dt);
    this.#updateSaucer(dt);

    if (!this.ship.alive) {
      // Shots already in flight still count while the wreck settles.
      this.#checkBulletCollisions();
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0 && this.#centreClear()) {
        const lives = this.lives - 1;
        this.setLives(Math.max(0, lives));
        if (lives <= 0) {
          this.meta = { wave: this.wave };
          this.end();
          return;
        }
        this.#resetShip();
      }
      return;
    }

    this.#updateShip(dt);
    this.#checkBulletCollisions();
    if (this.ship.alive) this.#checkShipCollisions();

    if (!this.rocks.length && !this.saucer) {
      this.wave++;
      this.addScore(250);
      this.play('levelup');
      this.#spawnWave();
    }
  }

  /** Never respawn straight into a rock — wait for the middle to open up. */
  #centreClear() {
    for (const rock of this.rocks) {
      if (Math.hypot(rock.x - W / 2, rock.y - H / 2) < rock.radius + 80) return false;
    }
    return true;
  }

  #updateShip(dt) {
    const ship = this.ship;
    if (ship.invulnerable > 0) ship.invulnerable -= dt;
    ship.cooldown -= dt;
    this.hyperCooldown -= dt;

    ship.angle += this.input.axisX() * 3.4 * dt;

    ship.thrusting = this.input.held('up');
    if (ship.thrusting) {
      ship.vx += Math.cos(ship.angle) * 260 * dt;
      ship.vy += Math.sin(ship.angle) * 260 * dt;
      if (this.random() < 0.35) this.play('thrust');
      this.particles.emit(
        ship.x - Math.cos(ship.angle) * 14,
        ship.y - Math.sin(ship.angle) * 14,
        {
          count: 2, speed: 120, color: '#ff9f43', life: 0.3, size: 2,
          angle: ship.angle + Math.PI, spread: 0.8,
        },
      );
    }

    // Space is not quite frictionless here — a tiny drag keeps it playable.
    const drag = Math.pow(0.6, dt);
    ship.vx *= drag;
    ship.vy *= drag;

    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > 340) {
      ship.vx = (ship.vx / speed) * 340;
      ship.vy = (ship.vy / speed) * 340;
    }

    ship.x = wrap(ship.x + ship.vx * dt, W);
    ship.y = wrap(ship.y + ship.vy * dt, H);

    // Only your own shots count against the magazine — saucer fire sharing
    // the array must not eat into it.
    let inFlight = 0;
    for (const bullet of this.bullets) {
      if (bullet.friendly) inFlight++;
    }
    if (this.input.pressed('action') && ship.cooldown <= 0 && inFlight < 5) {
      this.bullets.push({
        x: ship.x + Math.cos(ship.angle) * 14,
        y: ship.y + Math.sin(ship.angle) * 14,
        vx: Math.cos(ship.angle) * 430 + ship.vx,
        vy: Math.sin(ship.angle) * 430 + ship.vy,
        life: 1.1,
        friendly: true,
      });
      ship.cooldown = 0.2;
      this.play('laser');
    }

    if (this.input.pressed('secondary') && this.hyperCooldown <= 0) this.#hyperspace();
  }

  /** Escape anywhere on the map — occasionally into something solid. */
  #hyperspace() {
    this.hyperCooldown = 3;
    this.particles.emit(this.ship.x, this.ship.y, {
      count: 20, speed: 160, color: '#7dd3fc', life: 0.5, size: 2.5,
    });
    this.ship.x = 40 + this.random() * (W - 80);
    this.ship.y = 40 + this.random() * (H - 80);
    this.ship.vx = 0;
    this.ship.vy = 0;
    this.play('powerup');

    // The classic risk: a one-in-eight chance the jump goes wrong.
    if (this.random() < 0.12) {
      this.#destroyShip();
    } else {
      this.ship.invulnerable = 1;
    }
  }

  #updateRocks(dt) {
    for (const rock of this.rocks) {
      rock.x = wrap(rock.x + rock.vx * dt, W);
      rock.y = wrap(rock.y + rock.vy * dt, H);
      rock.rotation += rock.spin * dt;
    }
  }

  #updateBullets(dt) {
    for (const bullet of this.bullets) {
      bullet.x = wrap(bullet.x + bullet.vx * dt, W);
      bullet.y = wrap(bullet.y + bullet.vy * dt, H);
      bullet.life -= dt;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  #updateSaucer(dt) {
    if (!this.saucer) {
      this.saucerTimer -= dt;
      if (this.saucerTimer <= 0 && this.rocks.length) {
        const fromLeft = this.random() < 0.5;
        this.saucer = {
          x: fromLeft ? -30 : W + 30,
          y: 60 + this.random() * (H - 120),
          vx: fromLeft ? 78 : -78,
          fireTimer: 1.4,
          radius: 16,
        };
        this.saucerTimer = 30 + this.random() * 15;
      }
      return;
    }

    const s = this.saucer;
    s.x += s.vx * dt;
    s.y += Math.sin(performance.now() / 700) * 26 * dt;

    if (s.x < -50 || s.x > W + 50) {
      this.saucer = null;
      return;
    }

    s.fireTimer -= dt;
    if (s.fireTimer <= 0) {
      s.fireTimer = 1.6;
      // No target while the ship is a debris field.
      if (!this.ship.alive) return;
      // It leads the ship slightly, but not perfectly.
      const angle = Math.atan2(this.ship.y - s.y, this.ship.x - s.x) + (this.random() - 0.5) * 0.5;
      this.bullets.push({
        x: s.x, y: s.y,
        vx: Math.cos(angle) * 240,
        vy: Math.sin(angle) * 240,
        life: 2,
        friendly: false,
      });
      this.play('blip');
    }
  }

  /* =========================================================== collisions */

  #checkBulletCollisions() {
    /* --- bullets against rocks --- */
    for (const bullet of this.bullets) {
      if (!bullet.friendly) continue;
      for (let i = this.rocks.length - 1; i >= 0; i--) {
        const rock = this.rocks[i];
        if (Math.hypot(bullet.x - rock.x, bullet.y - rock.y) > rock.radius) continue;
        bullet.life = 0;
        this.#splitRock(i);
        break;
      }
    }

    /* --- bullets against the saucer --- */
    if (this.saucer) {
      for (const bullet of this.bullets) {
        if (!bullet.friendly) continue;
        if (Math.hypot(bullet.x - this.saucer.x, bullet.y - this.saucer.y) > this.saucer.radius) continue;
        bullet.life = 0;
        this.addScore(500, { x: this.saucer.x, y: this.saucer.y, color: '#ff2e88', label: '500' });
        this.particles.emit(this.saucer.x, this.saucer.y, {
          count: 26, speed: 190, color: '#ff2e88', life: 0.7, size: 3,
        });
        this.play('explode');
        this.shake.add(8);
        this.saucer = null;
        break;
      }
    }
  }

  #checkShipCollisions() {
    if (this.ship.invulnerable > 0) return;

    /* --- the ship against everything --- */
    for (const rock of this.rocks) {
      if (Math.hypot(this.ship.x - rock.x, this.ship.y - rock.y) < rock.radius * 0.78 + 7) {
        this.#destroyShip();
        return;
      }
    }
    for (const bullet of this.bullets) {
      if (bullet.friendly) continue;
      if (Math.hypot(this.ship.x - bullet.x, this.ship.y - bullet.y) < 10) {
        this.#destroyShip();
        return;
      }
    }
    if (this.saucer && Math.hypot(this.ship.x - this.saucer.x, this.ship.y - this.saucer.y) < 22) {
      this.#destroyShip();
    }
  }

  #splitRock(index) {
    const rock = this.rocks[index];
    const def = SIZES[rock.size];
    this.addScore(def.points, { x: rock.x, y: rock.y, color: '#7dd3fc', label: String(def.points) });
    this.play('explode');
    this.shake.add(rock.size === 'large' ? 6 : 3);
    this.particles.emit(rock.x, rock.y, {
      count: rock.size === 'large' ? 22 : 12,
      speed: 150, color: '#cfe8ff', life: 0.6, size: 2.4,
    });

    this.rocks.splice(index, 1);
    if (!def.next) return;

    for (let i = 0; i < 2; i++) {
      const child = this.#makeRock(rock.x, rock.y, def.next);
      // Children inherit some of the parent's momentum and fly apart.
      const angle = Math.atan2(rock.vy, rock.vx) + (i === 0 ? 0.6 : -0.6);
      const speed = Math.hypot(rock.vx, rock.vy) * 1.25 + 20;
      child.vx = Math.cos(angle) * speed;
      child.vy = Math.sin(angle) * speed;
      this.rocks.push(child);
    }
  }

  #destroyShip() {
    this.ship.alive = false;
    this.respawnTimer = 1.8;
    this.play('die');
    this.shake.add(14);
    this.particles.emit(this.ship.x, this.ship.y, {
      count: 34, speed: 200, color: '#7dd3fc', life: 0.9, size: 3,
    });
    this.meta = { wave: this.wave };
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.backdrop, 0, 0, W, H);

    for (const rock of this.rocks) this.#drawRock(ctx, rock);
    if (this.saucer) this.#drawSaucer(ctx);

    ctx.save();
    ctx.lineWidth = 1.5;
    for (const bullet of this.bullets) {
      // A short streak behind each shot sells the speed.
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      const tail = bullet.friendly ? 7 : 5;
      ctx.strokeStyle = bullet.friendly ? 'rgba(255,255,255,0.35)' : 'rgba(255,92,122,0.4)';
      ctx.beginPath();
      ctx.moveTo(bullet.x, bullet.y);
      ctx.lineTo(bullet.x - (bullet.vx / speed) * tail, bullet.y - (bullet.vy / speed) * tail);
      ctx.stroke();
    }
    ctx.restore();
    for (const bullet of this.bullets) {
      this.glowCircle(ctx, bullet.x, bullet.y, bullet.friendly ? 2.4 : 3, bullet.friendly ? '#ffffff' : '#ff5c7a', 10);
    }

    if (this.ship.alive) this.#drawShip(ctx);

    // Hyperspace recharge, tucked into the corner where the eye can find it.
    if (this.hyperCooldown > 0) {
      const t = 1 - Math.min(1, this.hyperCooldown / 3);
      ctx.save();
      ctx.fillStyle = 'rgba(125,211,252,0.25)';
      ctx.fillRect(12, H - 14, 44, 3);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(12, H - 14, 44 * t, 3);
      ctx.restore();
      this.text(ctx, 'HYPER', 34, H - 22, { size: 8, color: 'rgba(125,211,252,0.6)' });
    }

    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawShip(ctx) {
    const ship = this.ship;
    // Blink while invulnerable.
    if (ship.invulnerable > 0 && Math.floor(performance.now() / 90) % 2 === 0) return;

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.strokeStyle = '#7dd3fc';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-11, 9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-11, -9);
    ctx.closePath();
    ctx.stroke();

    if (ship.thrusting && Math.floor(performance.now() / 50) % 2 === 0) {
      ctx.strokeStyle = '#ff9f43';
      ctx.shadowColor = '#ff9f43';
      ctx.beginPath();
      ctx.moveTo(-7, 5);
      ctx.lineTo(-17, 0);
      ctx.lineTo(-7, -5);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawRock(ctx, rock) {
    ctx.save();
    ctx.translate(rock.x, rock.y);
    ctx.rotate(rock.rotation);
    ctx.strokeStyle = '#cfe8ff';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    rock.vertices.forEach((scale, i) => {
      const angle = (i / rock.vertices.length) * Math.PI * 2;
      const x = Math.cos(angle) * rock.radius * scale;
      const y = Math.sin(angle) * rock.radius * scale;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    // A whisper of fill gives the outline a body to hang on.
    ctx.fillStyle = 'rgba(125,211,252,0.06)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  #drawSaucer(ctx) {
    const s = this.saucer;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.strokeStyle = '#ff2e88';
    ctx.shadowColor = '#ff2e88';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 0); ctx.lineTo(18, 0);
    ctx.moveTo(-10, -6); ctx.lineTo(10, -6);
    ctx.moveTo(-18, 0); ctx.lineTo(-10, -6);
    ctx.moveTo(18, 0); ctx.lineTo(10, -6);
    ctx.moveTo(-18, 0); ctx.lineTo(-9, 7);
    ctx.moveTo(18, 0); ctx.lineTo(9, 7);
    ctx.moveTo(-9, 7); ctx.lineTo(9, 7);
    ctx.moveTo(-6, -6); ctx.lineTo(-4, -12);
    ctx.lineTo(4, -12); ctx.lineTo(6, -6);
    ctx.stroke();
    ctx.restore();
  }
}

/** Toroidal wrap — leave one edge, arrive at the other. */
function wrap(value, max) {
  if (value < 0) return value + max;
  if (value > max) return value - max;
  return value;
}
