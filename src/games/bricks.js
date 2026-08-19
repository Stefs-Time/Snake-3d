import { BaseGame } from '../core/game.js';

/**
 * BRICKS
 *
 * The one rule that makes this game work: where the ball lands on the paddle
 * decides the angle it leaves at. Hit it dead centre and the ball goes almost
 * straight up; catch it on the edge and it fires off at nearly 60 degrees.
 * That turns a reflex game into an aiming game, and it is why the paddle is
 * a tool rather than a wall.
 */

const W = 480;
const H = 560;

const COLS = 10;
const BRICK_W = 44;
const BRICK_H = 18;
const BRICK_TOP = 70;
const GAP = 4;

const BALL_R = 6;
const BASE_SPEED = 250;
const MAX_ANGLE = Math.PI / 3; // 60 degrees off vertical at the paddle edge

const ROW_COLORS = ['#ff2e88', '#ff5c7a', '#ff9f43', '#ffd23f', '#39ff88', '#00e5ff'];

const POWERUPS = [
  { kind: 'wide', color: '#00e5ff', label: 'W' },
  { kind: 'multi', color: '#ffd23f', label: 'M' },
  { kind: 'laser', color: '#ff2e88', label: 'L' },
  { kind: 'slow', color: '#39ff88', label: 'S' },
];

const EFFECT_TIME = { wide: 14, laser: 12, slow: 8 };
const EFFECT_COLOR = { wide: '#00e5ff', laser: '#ff2e88', slow: '#39ff88' };

const TRAIL_LEN = 9;

/** Cached sprites render at 2x so the scaled canvas stays crisp on phones. */
const SPRITE_SCALE = 2;
const SPRITE_PAD = 8;

export default class Bricks extends BaseGame {
  static id = 'bricks';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'aim';
  static touchButtons = { action: 'FIRE' };
  static smooth = true;
  static hudPad = { top: 30, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Level' };

  setup() {
    this.host.setSecondaryLabel('Level');
    this.host.setHint('← → or drag · Space to launch', 'Drag to steer · FIRE to launch');

    this.brickSprites = new Map();
    for (const color of ROW_COLORS) {
      this.brickSprites.set(color, this.#makeBrickSprite(color, false));
      this.brickSprites.set(`${color}+`, this.#makeBrickSprite(color, true));
    }
    this.backdrop = this.#makeBackdrop();

    this.level = 1;
    this.setLives(3);
    this.#startLevel();
  }

  /** A bevelled brick with its glow baked in — draw() never pays for shadowBlur. */
  #makeBrickSprite(color, strong) {
    const s = SPRITE_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = (BRICK_W + SPRITE_PAD * 2) * s;
    canvas.height = (BRICK_H + SPRITE_PAD * 2) * s;
    const g = canvas.getContext('2d');
    g.scale(s, s);

    g.shadowColor = color;
    g.shadowBlur = strong ? 14 : 8;
    g.globalAlpha = strong ? 1 : 0.88;
    g.fillStyle = color;
    this.roundRect(g, SPRITE_PAD, SPRITE_PAD, BRICK_W, BRICK_H, 3).fill();
    g.shadowBlur = 0;
    g.globalAlpha = 1;

    const bevel = g.createLinearGradient(0, SPRITE_PAD, 0, SPRITE_PAD + BRICK_H);
    bevel.addColorStop(0, 'rgba(255,255,255,0.4)');
    bevel.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = bevel;
    this.roundRect(g, SPRITE_PAD, SPRITE_PAD, BRICK_W, BRICK_H, 3).fill();

    if (strong) {
      g.globalAlpha = 0.55;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      this.roundRect(g, SPRITE_PAD + 3.5, SPRITE_PAD + 3.5, BRICK_W - 7, BRICK_H - 7, 2).stroke();
    }
    return canvas;
  }

  #makeBackdrop() {
    const s = SPRITE_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = W * s;
    canvas.height = H * s;
    const g = canvas.getContext('2d');
    g.scale(s, s);

    const wash = g.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, '#060a16');
    wash.addColorStop(0.45, '#04060a');
    wash.addColorStop(1, '#080611');
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 32; x < W; x += 32) {
      for (let y = 48; y < H; y += 32) g.fillRect(x - 1, y - 1, 2, 2);
    }

    g.shadowColor = '#2563eb';
    g.shadowBlur = 10;
    g.strokeStyle = '#2563eb';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 24);
    g.lineTo(W, 24);
    g.stroke();
    g.shadowBlur = 0;

    g.strokeStyle = 'rgba(37,99,235,0.35)';
    g.beginPath();
    g.moveTo(1, 24); g.lineTo(1, H);
    g.moveTo(W - 1, 24); g.lineTo(W - 1, H);
    g.stroke();
    return canvas;
  }

  #startLevel() {
    this.host.setSecondary(this.level);

    const rows = Math.min(6, 3 + Math.floor(this.level / 2));
    this.bricks = [];
    const offsetX = (W - (COLS * BRICK_W + (COLS - 1) * GAP)) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < COLS; col++) {
        // Higher rows take more hits as the levels climb.
        const strength = row < Math.floor(this.level / 3) ? 2 : 1;
        this.bricks.push({
          x: offsetX + col * (BRICK_W + GAP),
          y: BRICK_TOP + row * (BRICK_H + GAP),
          w: BRICK_W,
          h: BRICK_H,
          color: ROW_COLORS[row % ROW_COLORS.length],
          strength,
          alive: true,
        });
      }
    }

    this.paddle = { x: W / 2, y: H - 42, w: 84, h: 12, baseW: 84 };
    this.balls = [];
    this.drops = [];
    this.lasers = [];
    this.effects = { wide: 0, laser: 0, slow: 0 };

    this.#resetBall();
    this.banner(`Level ${this.level}`);
    this.play('ready');
  }

  #resetBall() {
    this.stuck = true;
    this.balls = [{
      x: this.paddle.x,
      y: this.paddle.y - BALL_R - 2,
      vx: 0,
      vy: 0,
      speed: BASE_SPEED + (this.level - 1) * 18,
      trail: [],
    }];
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;
    this.#updateTimers(dt);
    this.#updatePaddle(dt);

    if (this.stuck) {
      const ball = this.balls[0];
      ball.x = this.paddle.x;
      ball.y = this.paddle.y - BALL_R - 2;
      if (this.input.pressed('action')) {
        this.stuck = false;
        // Launch slightly off vertical, in the direction the paddle is moving.
        const angle = -Math.PI / 2 + (this.random() - 0.5) * 0.5;
        ball.vx = Math.cos(angle) * ball.speed;
        ball.vy = Math.sin(angle) * ball.speed;
        this.play('laser');
      }
      return;
    }

    this.#updateBalls(dt);
    if (this.over) return;
    this.#updateDrops(dt);
    this.#updateLasers(dt);

    if (!this.bricks.some((b) => b.alive)) {
      this.level++;
      this.addScore(1000);
      this.play('levelup');
      this.#startLevel();
    }
  }

  #updateTimers(dt) {
    for (const key of Object.keys(this.effects)) {
      if (this.effects[key] > 0) {
        this.effects[key] -= dt;
        if (this.effects[key] <= 0) this.effects[key] = 0;
      }
    }
    this.paddle.w = this.effects.wide > 0 ? this.paddle.baseW * 1.6 : this.paddle.baseW;
  }

  #updatePaddle(dt) {
    const p = this.paddle;
    const previous = p.x;

    // Pointer steering wins when the pointer is over the playfield.
    if (this.input.pointer.active) {
      p.x += (this.input.pointer.x * W - p.x) * Math.min(1, dt * 18);
    }
    p.x += this.input.axisX() * 420 * dt;
    p.x = Math.max(p.w / 2, Math.min(W - p.w / 2, p.x));
    this.paddleVelocity = (p.x - previous) / Math.max(dt, 0.0001);

    if (this.effects.laser > 0 && this.input.pressed('action')) {
      this.lasers.push({ x: p.x - p.w / 2 + 6, y: p.y }, { x: p.x + p.w / 2 - 6, y: p.y });
      this.play('laser');
    }
  }

  #updateBalls(dt) {
    const speedScale = this.effects.slow > 0 ? 0.68 : 1;

    for (const ball of this.balls) {
      // Substep so a fast ball cannot tunnel through a brick in one frame.
      // Measured from the real velocity — paddle spin can push it past speed.
      const velocity = Math.hypot(ball.vx, ball.vy);
      const steps = Math.max(1, Math.ceil((velocity * speedScale * dt) / (BALL_R * 1.4)));
      const sdt = dt / steps;

      for (let s = 0; s < steps; s++) {
        ball.x += ball.vx * speedScale * sdt;
        ball.y += ball.vy * speedScale * sdt;

        /* --- walls --- */
        if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); this.#wallHit(ball); }
        if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); this.#wallHit(ball); }
        if (ball.y < BALL_R + 24) { ball.y = BALL_R + 24; ball.vy = Math.abs(ball.vy); this.#wallHit(ball); }

        /* --- paddle --- */
        const p = this.paddle;
        if (
          ball.vy > 0 &&
          ball.y + BALL_R >= p.y && ball.y - BALL_R <= p.y + p.h &&
          ball.x >= p.x - p.w / 2 - BALL_R && ball.x <= p.x + p.w / 2 + BALL_R
        ) {
          ball.y = p.y - BALL_R;
          // Contact point maps to exit angle. This is the whole game.
          const offset = Math.max(-1, Math.min(1, (ball.x - p.x) / (p.w / 2)));
          const angle = -Math.PI / 2 + offset * MAX_ANGLE;
          // A moving paddle imparts a little extra sideways push.
          const spin = Math.max(-90, Math.min(90, this.paddleVelocity * 0.08));
          ball.speed = Math.min(560, ball.speed + 4);
          ball.vx = Math.cos(angle) * ball.speed + spin;
          ball.vy = Math.sin(angle) * ball.speed;
          this.play('bounce');
          this.particles.emit(ball.x, p.y, {
            count: 5, speed: 70, color: '#00e5ff', life: 0.3, size: 2, angle: -Math.PI / 2, spread: 1.6,
          });
        }

        /* --- bricks --- */
        this.#brickCollision(ball);
      }

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > TRAIL_LEN) ball.trail.shift();
    }

    /* --- balls lost off the bottom --- */
    const before = this.balls.length;
    this.balls = this.balls.filter((ball) => ball.y - BALL_R < H);
    if (this.balls.length === 0 && before > 0) this.#loseLife();
  }

  #wallHit(ball) {
    this.play('blip');
    this.particles.emit(ball.x, ball.y, {
      count: 3, speed: 60, color: '#8b93a7', life: 0.25, size: 2,
    });
  }

  #brickCollision(ball) {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      if (
        ball.x + BALL_R < brick.x || ball.x - BALL_R > brick.x + brick.w ||
        ball.y + BALL_R < brick.y || ball.y - BALL_R > brick.y + brick.h
      ) continue;

      // Reflect off whichever face the ball penetrated least — that is the
      // one it actually arrived through.
      const overlapLeft = ball.x + BALL_R - brick.x;
      const overlapRight = brick.x + brick.w - (ball.x - BALL_R);
      const overlapTop = ball.y + BALL_R - brick.y;
      const overlapBottom = brick.y + brick.h - (ball.y - BALL_R);
      const min = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

      if (min === overlapLeft) { ball.vx = -Math.abs(ball.vx); ball.x = brick.x - BALL_R; }
      else if (min === overlapRight) { ball.vx = Math.abs(ball.vx); ball.x = brick.x + brick.w + BALL_R; }
      else if (min === overlapTop) { ball.vy = -Math.abs(ball.vy); ball.y = brick.y - BALL_R; }
      else { ball.vy = Math.abs(ball.vy); ball.y = brick.y + brick.h + BALL_R; }

      brick.strength--;
      if (brick.strength <= 0) {
        brick.alive = false;
        this.addScore(10 * this.level, {
          x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, color: brick.color,
        });
        this.particles.emit(brick.x + brick.w / 2, brick.y + brick.h / 2, {
          count: 12, speed: 130, color: brick.color, life: 0.5, size: 3, gravity: 220,
        });
        this.#maybeDrop(brick);
      } else {
        this.addScore(5);
        this.particles.emit(ball.x, ball.y, {
          count: 4, speed: 70, color: brick.color, life: 0.3, size: 2,
        });
      }

      this.play('hit');
      this.shake.add(1.6);
      return; // one brick per substep keeps the bounce readable
    }
  }

  #maybeDrop(brick) {
    if (this.random() > 0.13) return;
    const def = POWERUPS[Math.floor(this.random() * POWERUPS.length)];
    this.drops.push({ ...def, x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, vy: 110 });
  }

  #updateDrops(dt) {
    for (const drop of this.drops) drop.y += drop.vy * dt;

    this.drops = this.drops.filter((drop) => {
      if (drop.y > H) return false;
      const p = this.paddle;
      if (drop.y > p.y - 8 && drop.y < p.y + p.h + 8 && Math.abs(drop.x - p.x) < p.w / 2 + 10) {
        this.#applyPowerup(drop);
        return false;
      }
      return true;
    });
  }

  #applyPowerup(drop) {
    this.play('powerup');
    this.addScore(50, { x: drop.x, y: drop.y, color: drop.color, label: '+50' });

    switch (drop.kind) {
      case 'wide':
        this.effects.wide = EFFECT_TIME.wide;
        break;
      case 'laser':
        this.effects.laser = EFFECT_TIME.laser;
        break;
      case 'slow':
        this.effects.slow = EFFECT_TIME.slow;
        break;
      case 'multi': {
        const source = this.balls[0];
        if (!source || this.stuck) break;
        for (const spread of [-0.45, 0.45]) {
          const angle = Math.atan2(source.vy, source.vx) + spread;
          this.balls.push({
            x: source.x, y: source.y,
            vx: Math.cos(angle) * source.speed,
            vy: Math.sin(angle) * source.speed,
            speed: source.speed,
            trail: [],
          });
        }
        break;
      }
    }
  }

  #updateLasers(dt) {
    for (const laser of this.lasers) laser.y -= 520 * dt;

    this.lasers = this.lasers.filter((laser) => {
      if (laser.y < 20) return false;
      for (const brick of this.bricks) {
        if (!brick.alive) continue;
        if (
          laser.x > brick.x && laser.x < brick.x + brick.w &&
          laser.y > brick.y && laser.y < brick.y + brick.h
        ) {
          brick.strength--;
          if (brick.strength <= 0) {
            brick.alive = false;
            this.addScore(10 * this.level);
            this.particles.emit(brick.x + brick.w / 2, brick.y + brick.h / 2, {
              count: 10, speed: 120, color: brick.color, life: 0.45, size: 2.6, gravity: 200,
            });
          }
          this.play('hit');
          return false;
        }
      }
      return true;
    });
  }

  #loseLife() {
    const lives = this.lives - 1;
    this.setLives(Math.max(0, lives));
    this.play('die');
    this.shake.add(10);
    this.effects = { wide: 0, laser: 0, slow: 0 };
    this.drops = [];
    this.lasers = [];

    if (lives <= 0) {
      this.meta = { level: this.level };
      this.end();
      return;
    }
    this.#resetBall();
    this.banner('Ball lost');
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    /* --- the frame --- */
    ctx.drawImage(this.backdrop, 0, 0, W, H);

    /* --- bricks --- */
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const sprite = this.brickSprites.get(brick.strength > 1 ? `${brick.color}+` : brick.color);
      ctx.drawImage(
        sprite,
        brick.x - SPRITE_PAD, brick.y - SPRITE_PAD,
        brick.w + SPRITE_PAD * 2, brick.h + SPRITE_PAD * 2,
      );
    }

    /* --- power-up drops --- */
    for (const drop of this.drops) {
      ctx.save();
      ctx.shadowColor = drop.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = drop.color;
      this.roundRect(ctx, drop.x - 11, drop.y - 8, 22, 16, 7).fill();
      ctx.restore();
      this.text(ctx, drop.label, drop.x, drop.y + 0.5, { size: 10, color: '#04060a' });
    }

    /* --- lasers --- */
    for (const laser of this.lasers) {
      this.glowRect(ctx, laser.x - 1.5, laser.y - 10, 3, 12, '#ff2e88', 10);
    }

    /* --- paddle --- */
    const p = this.paddle;
    const paddleColor = this.effects.laser > 0 ? '#ff2e88' : '#00e5ff';
    ctx.save();
    ctx.shadowColor = paddleColor;
    ctx.shadowBlur = 16;
    ctx.fillStyle = paddleColor;
    this.roundRect(ctx, p.x - p.w / 2, p.y, p.w, p.h, 5).fill();
    ctx.shadowBlur = 0;
    const sheen = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.45)');
    sheen.addColorStop(0.6, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = sheen;
    this.roundRect(ctx, p.x - p.w / 2, p.y, p.w, p.h, 5).fill();
    ctx.restore();
    if (this.effects.laser > 0) {
      this.glowRect(ctx, p.x - p.w / 2 + 3, p.y - 6, 6, 6, '#ff2e88', 8);
      this.glowRect(ctx, p.x + p.w / 2 - 9, p.y - 6, 6, 6, '#ff2e88', 8);
    }

    /* --- balls, each towing a fading trail --- */
    ctx.save();
    ctx.fillStyle = '#9be9ff';
    for (const ball of this.balls) {
      for (let i = 0; i < ball.trail.length; i++) {
        const t = (i + 1) / ball.trail.length;
        ctx.globalAlpha = t * 0.22;
        ctx.beginPath();
        ctx.arc(ball.trail[i].x, ball.trail[i].y, BALL_R * (0.35 + t * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    for (const ball of this.balls) {
      this.glowCircle(ctx, ball.x, ball.y, BALL_R, '#ffffff', 16);
    }

    /* --- active effect readout, with how long each has left --- */
    const active = Object.entries(this.effects).filter(([, v]) => v > 0);
    active.forEach(([name, left], i) => {
      const x = 14 + i * 64;
      this.text(ctx, name.toUpperCase(), x, H - 18, {
        size: 10, color: EFFECT_COLOR[name], align: 'left',
      });
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, H - 11, 44, 3);
      ctx.fillStyle = EFFECT_COLOR[name];
      ctx.fillRect(x, H - 11, 44 * Math.min(1, left / EFFECT_TIME[name]), 3);
      ctx.restore();
    });

    if (this.stuck) {
      this.text(ctx, 'PRESS SPACE TO LAUNCH', W / 2, H - 90, {
        size: 12, color: '#ffd23f', glow: 12,
      });
    }

    this.drawEffects(ctx);
    ctx.restore();
  }
}
