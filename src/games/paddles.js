import { BaseGame } from '../core/game.js';

/**
 * PADDLES
 *
 * First to eleven. The opponent is deliberately imperfect: it tracks the ball
 * with a reaction delay and a small aim error, and both shrink as the rally
 * gets longer. So the machine gets better the longer you keep the ball alive,
 * which means the rally itself is the difficulty curve.
 */

const W = 640;
const H = 420;

const PADDLE_W = 10;
const PADDLE_H = 74;
const BALL = 9;
const WIN_SCORE = 11;

const BASE_SPEED = 300;
const MAX_ANGLE = Math.PI / 3.4;

export default class Paddles extends BaseGame {
  static id = 'paddles';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'dpad';
  static touchButtons = { action: 'SERVE' };
  static smooth = true;
  static hudPad = { top: 34, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Match' };

  setup() {
    this.host.setSecondaryLabel('Match');
    this.host.setHint('↑ ↓ or drag to move · Space to serve', 'Drag to move · SERVE to play the ball');
    this.setLives(1);

    this.player = { y: H / 2, score: 0, velocity: 0 };
    this.opponent = { y: H / 2, score: 0, target: H / 2, reaction: 0 };

    this.rally = 0;
    this.longestRally = 0;
    this.ballPulse = 0;
    this.serveTo = 1; // 1 serves toward the opponent
    this.#buildBackdrop();
    this.#serve();

    this.banner('First to 11');
    this.play('ready');
  }

  /**
   * The court never changes, so the washes, the centre line and the rails are
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
    // Each player owns a faint wash of their own colour.
    const wash = b.createLinearGradient(0, 0, W, 0);
    wash.addColorStop(0, 'rgba(163,255,92,0.05)');
    wash.addColorStop(0.5, 'rgba(4,6,10,0)');
    wash.addColorStop(1, 'rgba(255,255,255,0.04)');
    b.fillStyle = wash;
    b.fillRect(0, 0, W, H);
    const pool = b.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, H * 0.85);
    pool.addColorStop(0, 'rgba(0,229,255,0.06)');
    pool.addColorStop(1, 'rgba(4,6,10,0)');
    b.fillStyle = pool;
    b.fillRect(0, 0, W, H);

    b.strokeStyle = 'rgba(255,255,255,0.14)';
    b.lineWidth = 3;
    b.setLineDash([10, 14]);
    b.beginPath();
    b.moveTo(W / 2, 10);
    b.lineTo(W / 2, H - 10);
    b.stroke();
    b.setLineDash([]);
    b.strokeStyle = 'rgba(255,255,255,0.07)';
    b.lineWidth = 2;
    b.beginPath();
    b.arc(W / 2, H / 2, 56, 0, Math.PI * 2);
    b.stroke();

    // The rails the ball bounces off.
    b.strokeStyle = 'rgba(0,229,255,0.25)';
    b.shadowColor = '#00e5ff';
    b.shadowBlur = 8;
    b.lineWidth = 2;
    b.beginPath();
    b.moveTo(6, 2);
    b.lineTo(W - 6, 2);
    b.moveTo(6, H - 2);
    b.lineTo(W - 6, H - 2);
    b.stroke();
    this.backdrop = canvas;
  }

  #serve() {
    this.waiting = true;
    this.rally = 0;
    this.ball = {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      speed: BASE_SPEED,
      trail: [],
    };
    this.host.setSecondary(`${this.player.score} - ${this.opponent.score}`);
  }

  #launch() {
    this.waiting = false;
    const angle = (this.random() - 0.5) * 0.7;
    this.ball.vx = Math.cos(angle) * this.ball.speed * this.serveTo;
    this.ball.vy = Math.sin(angle) * this.ball.speed;
    this.play('laser');
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.ballPulse > 0) this.ballPulse = Math.max(0, this.ballPulse - dt * 5);
    this.#updatePlayer(dt);

    if (this.waiting) {
      this.ball.x = W / 2;
      this.ball.y = H / 2;
      this.opponent.y += (H / 2 - this.opponent.y) * Math.min(1, dt * 4);
      if (this.input.pressed('action')) this.#launch();
      return;
    }

    this.#updateOpponent(dt);
    this.#updateBall(dt);
  }

  #updatePlayer(dt) {
    const previous = this.player.y;

    if (this.input.pointer.active) {
      // `mouse` maps the pointer into playfield space with the HUD bands
      // subtracted — raw pointer.y is normalised over the whole canvas,
      // bands included, which put the paddle above the finger.
      const target = clamp(this.mouse.y, PADDLE_H / 2, H - PADDLE_H / 2);
      this.player.y += (target - this.player.y) * Math.min(1, dt * 16);
    }
    this.player.y += this.input.axisY() * 420 * dt;
    this.player.y = clamp(this.player.y, PADDLE_H / 2, H - PADDLE_H / 2);
    this.player.velocity = (this.player.y - previous) / Math.max(dt, 0.0001);
  }

  #updateOpponent(dt) {
    const ai = this.opponent;

    // Skill scales with the current rally and the opponent's deficit.
    const skill = Math.min(1, 0.42 + this.rally * 0.045 + this.opponent.score * 0.02);
    const reactionDelay = 0.16 * (1 - skill) + 0.02;

    ai.reaction -= dt;
    if (ai.reaction <= 0) {
      ai.reaction = reactionDelay;
      if (this.ball.vx > 0) {
        // Predict where the ball will cross the paddle, bouncing off walls.
        let y = this.ball.y;
        let vy = this.ball.vy;
        let x = this.ball.x;
        let guard = 0;
        while (x < W - 40 && guard++ < 40) {
          const dtStep = 0.02;
          x += this.ball.vx * dtStep;
          y += vy * dtStep;
          if (y < BALL || y > H - BALL) vy = -vy;
        }
        // A deliberate aim error that shrinks as the rally grows.
        const error = (1 - skill) * PADDLE_H * 0.9 * (this.random() - 0.5) * 2;
        ai.target = y + error;
      } else {
        // Drift back toward the middle between rallies.
        ai.target = H / 2 + (this.random() - 0.5) * 40;
      }
    }

    const speed = 200 + skill * 260;
    const delta = ai.target - ai.y;
    ai.y += clamp(delta, -speed * dt, speed * dt);
    ai.y = clamp(ai.y, PADDLE_H / 2, H - PADDLE_H / 2);
  }

  #updateBall(dt) {
    const ball = this.ball;
    const fastest = Math.max(Math.abs(ball.vx), Math.abs(ball.vy));
    const steps = Math.max(1, Math.ceil((fastest * dt) / (BALL * 0.8)));
    const sdt = dt / steps;

    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      /* --- top and bottom --- */
      if (ball.y < BALL) { ball.y = BALL; ball.vy = Math.abs(ball.vy); this.#wallBounce(); }
      if (ball.y > H - BALL) { ball.y = H - BALL; ball.vy = -Math.abs(ball.vy); this.#wallBounce(); }

      /* --- paddles --- */
      if (ball.vx < 0 && ball.x - BALL <= 30 + PADDLE_W && ball.x > 20) {
        if (Math.abs(ball.y - this.player.y) <= PADDLE_H / 2 + BALL) {
          this.#paddleBounce(this.player, 1, this.player.velocity);
        }
      }
      if (ball.vx > 0 && ball.x + BALL >= W - 30 - PADDLE_W && ball.x < W - 20) {
        if (Math.abs(ball.y - this.opponent.y) <= PADDLE_H / 2 + BALL) {
          this.#paddleBounce(this.opponent, -1, 0);
        }
      }

      /* --- points --- */
      if (ball.x < -20) { this.#point('opponent'); return; }
      if (ball.x > W + 20) { this.#point('player'); return; }
    }

    ball.trail.unshift({ x: ball.x, y: ball.y });
    if (ball.trail.length > 12) ball.trail.pop();
  }

  #wallBounce() {
    this.ballPulse = Math.max(this.ballPulse, 0.5);
    this.play('bounce');
    this.particles.emit(this.ball.x, this.ball.y, {
      count: 4, speed: 70, color: '#8b93a7', life: 0.25, size: 2,
    });
  }

  #paddleBounce(paddle, direction, paddleVelocity) {
    const ball = this.ball;
    const offset = clamp((ball.y - paddle.y) / (PADDLE_H / 2), -1, 1);
    const angle = offset * MAX_ANGLE;

    this.rally++;
    this.longestRally = Math.max(this.longestRally, this.rally);
    ball.speed = Math.min(700, BASE_SPEED + this.rally * 14);

    ball.vx = Math.cos(angle) * ball.speed * direction;
    // Paddle motion adds spin, so a moving paddle changes the return.
    ball.vy = Math.sin(angle) * ball.speed + clamp(paddleVelocity * 0.12, -110, 110);
    ball.x = direction > 0 ? 30 + PADDLE_W + BALL : W - 30 - PADDLE_W - BALL;

    this.ballPulse = 1;

    // Points for keeping a rally alive, weighted toward long ones.
    this.addScore(5 + this.rally * 2);
    this.play('hit');
    this.shake.add(1.6);
    this.particles.emit(ball.x, ball.y, {
      count: 6, speed: 90, color: direction > 0 ? '#a3ff5c' : '#ffffff', life: 0.3, size: 2.4,
      angle: direction > 0 ? 0 : Math.PI, spread: 1.4,
    });
  }

  #point(winner) {
    if (winner === 'player') {
      this.player.score++;
      this.addScore(150 + this.rally * 10);
      this.banner('Point');
      this.play('powerup');
      this.serveTo = -1;
    } else {
      this.opponent.score++;
      this.banner('Lost it');
      this.play('die');
      this.serveTo = 1;
    }

    this.shake.add(7);
    this.meta = { rally: this.longestRally, match: `${this.player.score}-${this.opponent.score}` };
    // Keep the HUD honest even on match point, when #serve never runs again.
    this.host.setSecondary(`${this.player.score} - ${this.opponent.score}`);

    if (this.player.score >= WIN_SCORE) {
      this.addScore(2000);
      this.banner('You win');
      this.play('highscore');
      this.end();
      return;
    }
    if (this.opponent.score >= WIN_SCORE) {
      this.end();
      return;
    }
    this.#serve();
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.backdrop, 0, 0, W, H);

    /* --- the match score, big and faint behind everything --- */
    this.text(ctx, String(this.player.score), W / 2 - 70, 56, {
      size: 52, color: 'rgba(163,255,92,0.32)',
    });
    this.text(ctx, String(this.opponent.score), W / 2 + 70, 56, {
      size: 52, color: 'rgba(255,255,255,0.22)',
    });

    /* --- ball trail, fading and shrinking as it ages --- */
    ctx.save();
    ctx.fillStyle = '#ffffff';
    const trail = this.ball.trail;
    for (let i = 0; i < trail.length; i++) {
      const k = 1 - i / trail.length;
      const s = BALL * (0.45 + k * 0.55);
      ctx.globalAlpha = k * 0.4;
      ctx.fillRect(trail[i].x - s / 2, trail[i].y - s / 2, s, s);
    }
    ctx.restore();

    /* --- paddles --- */
    this.#drawPaddle(ctx, 30, this.player.y, '#a3ff5c', 18);
    this.#drawPaddle(ctx, W - 30 - PADDLE_W, this.opponent.y, '#ffffff', 14);

    /* --- ball, swelling briefly off a bounce --- */
    const pulse = this.ballPulse * this.ballPulse;
    const size = BALL + pulse * 3;
    this.glowRect(ctx, this.ball.x - size / 2, this.ball.y - size / 2, size, size, '#ffffff', 18 + pulse * 12);

    if (this.waiting) {
      // A gentle arrow showing which way the serve will go.
      const throb = 0.45 + 0.3 * Math.sin(performance.now() / 300);
      const ax = W / 2 + this.serveTo * 42;
      ctx.save();
      ctx.globalAlpha = throb;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(ax, H / 2 - 7);
      ctx.lineTo(ax + this.serveTo * 11, H / 2);
      ctx.lineTo(ax, H / 2 + 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      this.text(ctx, this.host.isTouch ? 'TAP SERVE TO PLAY' : 'PRESS SPACE TO SERVE', W / 2, H - 46, {
        size: 12, color: '#ffd23f', glow: 12,
      });
    }
    if (this.rally > 3) {
      this.text(ctx, `RALLY ${this.rally}`, W / 2, H - 20, {
        size: 11, color: 'rgba(255,255,255,0.4)',
      });
    }

    this.drawEffects(ctx);
    ctx.restore();
  }

  #drawPaddle(ctx, x, y, color, blur) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    this.roundRect(ctx, x, y - PADDLE_H / 2, PADDLE_W, PADDLE_H, 5);
    ctx.fill();
    // An inner sheen so the bat reads as a lit tube, not a flat bar.
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this.roundRect(ctx, x + 2, y - PADDLE_H / 2 + 4, 2.5, PADDLE_H - 8, 2);
    ctx.fill();
    ctx.restore();
  }
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}
