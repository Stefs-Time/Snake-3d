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
  static smooth = true;
  static hudPad = { top: 34, bottom: 24 };
  static hudLabels = { score: 'Score', secondary: 'Match' };

  setup() {
    this.host.setSecondaryLabel('Match');
    this.host.setHint('↑ ↓ or drag to move · Space to serve');
    this.setLives(1);

    this.player = { y: H / 2, score: 0, velocity: 0 };
    this.opponent = { y: H / 2, score: 0, target: H / 2, reaction: 0 };

    this.rally = 0;
    this.longestRally = 0;
    this.serveTo = 1; // 1 serves toward the opponent
    this.#serve();

    this.banner('First to 11');
    this.play('ready');
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
      this.player.y += (this.input.pointer.y * H - this.player.y) * Math.min(1, dt * 16);
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
    const steps = Math.max(1, Math.ceil((Math.abs(ball.vx) * dt) / (BALL * 0.8)));
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

    /* --- centre line --- */
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 14]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 10);
    ctx.lineTo(W / 2, H - 10);
    ctx.stroke();
    ctx.restore();

    /* --- the match score, big and faint behind everything --- */
    this.text(ctx, String(this.player.score), W / 2 - 70, 56, {
      size: 52, color: 'rgba(163,255,92,0.32)',
    });
    this.text(ctx, String(this.opponent.score), W / 2 + 70, 56, {
      size: 52, color: 'rgba(255,255,255,0.22)',
    });

    /* --- ball trail --- */
    this.ball.trail.forEach((point, i) => {
      const alpha = (1 - i / this.ball.trail.length) * 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(point.x - BALL / 2, point.y - BALL / 2, BALL, BALL);
      ctx.restore();
    });

    /* --- paddles --- */
    this.glowRect(ctx, 30, this.player.y - PADDLE_H / 2, PADDLE_W, PADDLE_H, '#a3ff5c', 18);
    this.glowRect(ctx, W - 30 - PADDLE_W, this.opponent.y - PADDLE_H / 2, PADDLE_W, PADDLE_H, '#ffffff', 14);

    /* --- ball --- */
    this.glowRect(ctx, this.ball.x - BALL / 2, this.ball.y - BALL / 2, BALL, BALL, '#ffffff', 18);

    if (this.waiting) {
      this.text(ctx, 'PRESS SPACE TO SERVE', W / 2, H - 46, {
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
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}
