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

export default class Bricks extends BaseGame {
  static id = 'bricks';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'aim';
  static smooth = true;
  static hudPad = { top: 30, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Level' };

  setup() {
    this.host.setSecondaryLabel('Level');
    this.host.setHint('← → or drag · Space to launch');

    this.level = 1;
    this.setLives(3);
    this.#startLevel();
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
    }];
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
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
      const steps = Math.max(1, Math.ceil((ball.speed * speedScale * dt) / (BALL_R * 1.4)));
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
        this.addScore(10 * this.level);
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
        this.effects.wide = 14;
        break;
      case 'laser':
        this.effects.laser = 12;
        break;
      case 'slow':
        this.effects.slow = 8;
        break;
      case 'multi': {
        const source = this.balls[0];
        if (!source) break;
        for (const spread of [-0.45, 0.45]) {
          const angle = Math.atan2(source.vy, source.vx) + spread;
          this.balls.push({
            x: source.x, y: source.y,
            vx: Math.cos(angle) * source.speed,
            vy: Math.sin(angle) * source.speed,
            speed: source.speed,
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
    this.glowLine(ctx, 0, 24, W, 24, '#2563eb', 2, 10);
    ctx.strokeStyle = 'rgba(37,99,235,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1, 24); ctx.lineTo(1, H);
    ctx.moveTo(W - 1, 24); ctx.lineTo(W - 1, H);
    ctx.stroke();

    /* --- bricks --- */
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      ctx.save();
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = brick.strength > 1 ? 16 : 9;
      ctx.fillStyle = brick.color;
      ctx.globalAlpha = brick.strength > 1 ? 1 : 0.88;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(brick.x + 2, brick.y + 2, brick.w - 4, 3);
      if (brick.strength > 1) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(brick.x + 3.5, brick.y + 3.5, brick.w - 7, brick.h - 7);
      }
      ctx.restore();
    }

    /* --- power-up drops --- */
    for (const drop of this.drops) {
      this.glowRect(ctx, drop.x - 11, drop.y - 7, 22, 14, drop.color, 12);
      this.text(ctx, drop.label, drop.x, drop.y, { size: 10, color: '#04060a' });
    }

    /* --- lasers --- */
    for (const laser of this.lasers) {
      this.glowRect(ctx, laser.x - 1.5, laser.y - 10, 3, 12, '#ff2e88', 10);
    }

    /* --- paddle --- */
    const p = this.paddle;
    const paddleColor = this.effects.laser > 0 ? '#ff2e88' : '#00e5ff';
    this.glowRect(ctx, p.x - p.w / 2, p.y, p.w, p.h, paddleColor, 16);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - p.w / 2 + 3, p.y + 2, p.w - 6, 3);
    ctx.restore();
    if (this.effects.laser > 0) {
      this.glowRect(ctx, p.x - p.w / 2 + 3, p.y - 6, 6, 6, '#ff2e88', 8);
      this.glowRect(ctx, p.x + p.w / 2 - 9, p.y - 6, 6, 6, '#ff2e88', 8);
    }

    /* --- balls --- */
    for (const ball of this.balls) {
      this.glowCircle(ctx, ball.x, ball.y, BALL_R, '#ffffff', 16);
    }

    /* --- active effect readout --- */
    const active = Object.entries(this.effects).filter(([, v]) => v > 0);
    active.forEach(([name], i) => {
      this.text(ctx, name.toUpperCase(), 14 + i * 58, H - 12, {
        size: 10, color: '#8b93a7', align: 'left',
      });
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
