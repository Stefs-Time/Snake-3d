import { BaseGame } from '../core/game.js';

/**
 * BASTION — defend the line
 *
 * Six cities, three batteries, thirty shells a wave. Click where you want an
 * interceptor to detonate and the nearest battery with ammunition fires at
 * that point; the blast expands, holds, and collapses, and anything that flies
 * through it dies.
 *
 * The whole game is in the word *nearest*. Ammunition is per battery, so the
 * flank you have been defending runs dry first, and the shot you want is
 * suddenly a long slow arc from the other side of the map. Leading the target
 * is not optional — you are aiming at where a missile will be, not where it is.
 *
 * You never really win. The waves come faster until they do not stop.
 */

const W = 780;
const H = 520;

const GROUND_Y = H - 54;
const CITY_COUNT = 6;
const BATTERY_AMMO = 10;

const BLAST_MAX = 46;
const BLAST_GROW = 130; // pixels per second
const BLAST_HOLD = 0.42;

const CITY_COLOR = '#38bdf8';
const BATTERY_COLOR = '#a3e635';
const ENEMY_COLOR = '#fb7185';
const SMART_COLOR = '#c084fc';

export default class Bastion extends BaseGame {
  static id = 'bastion';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Wave' };

  setup() {
    this.host.setSecondaryLabel('Wave');
    this.host.setHint('Click to detonate · the nearest loaded battery fires');

    // Batteries at both ends and the middle; cities fill the gaps between.
    this.batteries = [0.06, 0.5, 0.94].map((f) => ({
      x: W * f,
      y: GROUND_Y,
      ammo: BATTERY_AMMO,
      alive: true,
    }));

    this.cities = [];
    const slots = [0.17, 0.26, 0.35, 0.65, 0.74, 0.83];
    for (let i = 0; i < CITY_COUNT; i++) {
      this.cities.push({ x: W * slots[i], y: GROUND_Y, alive: true, rubble: 0 });
    }

    this.wave = 0;
    this.incoming = [];
    this.shells = [];
    this.blasts = [];
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    this.state = 'brief';
    this.stateTimer = 1.6;
    this.finished = false;

    this.setLives(CITY_COUNT);
    this.host.setSecondary(0);
    this.banner('Defend');
    this.play('ready');
  }

  /* ================================================================ waves */

  #startWave() {
    this.wave++;
    this.host.setSecondary(this.wave);
    this.meta = { wave: this.wave, cities: this.#aliveCities() };

    // Reload every battery that still stands.
    for (const battery of this.batteries) if (battery.alive) battery.ammo = BATTERY_AMMO;

    this.spawnQueue = 8 + this.wave * 3;
    this.spawnTimer = 0;
    this.enemySpeed = 34 + this.wave * 5.5;
    this.state = 'wave';
    this.banner(`Wave ${this.wave}`);
    this.play('levelup');
  }

  #targets() {
    const list = [
      ...this.cities.filter((c) => c.alive),
      ...this.batteries.filter((b) => b.alive),
    ];
    return list.length ? list : this.cities;
  }

  #spawnIncoming(fromX = null, fromY = null, speedScale = 1) {
    const target = this.#targets()[Math.floor(this.random() * this.#targets().length)];
    const x = fromX ?? this.random() * W;
    const y = fromY ?? -10;
    // Aim at the target with a little scatter, so a salvo spreads.
    const tx = target.x + (this.random() - 0.5) * 30;
    const ty = GROUND_Y;
    const angle = Math.atan2(ty - y, tx - x);
    const speed = this.enemySpeed * speedScale;

    // From wave four, some warheads split partway down.
    const canSplit = this.wave >= 4 && fromX === null && this.random() < 0.22;

    this.incoming.push({
      x, y,
      startX: x, startY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      splitAt: canSplit ? GROUND_Y * (0.32 + this.random() * 0.2) : null,
      smart: canSplit,
    });
  }

  /* =============================================================== firing */

  #fire(tx, ty) {
    if (ty >= GROUND_Y - 6) return;

    // The nearest battery that still has shells — the constraint the whole
    // game is built around.
    let best = null;
    let bestDist = Infinity;
    for (const battery of this.batteries) {
      if (!battery.alive || battery.ammo <= 0) continue;
      const d = Math.hypot(battery.x - tx, battery.y - ty);
      if (d < bestDist) {
        bestDist = d;
        best = battery;
      }
    }
    if (!best) {
      this.play('hit');
      return;
    }

    best.ammo--;
    const angle = Math.atan2(ty - best.y, tx - best.x);
    const speed = 420;
    this.shells.push({
      x: best.x, y: best.y - 12,
      startX: best.x, startY: best.y - 12,
      tx, ty,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
    this.play('laser');
  }

  #detonate(x, y, fromChain = false) {
    this.blasts.push({ x, y, r: 2, phase: 'grow', hold: BLAST_HOLD });
    if (!fromChain) this.play('explode');
    this.shake.add(fromChain ? 1.5 : 3);
    this.particles.emit(x, y, {
      count: 10, speed: 90, color: '#fbbf24', life: 0.4, size: 2.4,
    });
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.finished) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.end();
      this.#advanceWorld(dt);
      return;
    }

    if (this.state === 'brief') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.#startWave();
      return;
    }

    if (this.state === 'tally') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'brief';
        this.stateTimer = 1.2;
      }
      this.#advanceWorld(dt);
      return;
    }

    /* --- spawning --- */
    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.#spawnIncoming();
        this.spawnQueue--;
        this.spawnTimer = Math.max(0.24, 1.5 - this.wave * 0.07);
      }
    }

    this.#handleInput();
    this.#advanceWorld(dt);

    /* --- wave over? --- */
    if (this.spawnQueue <= 0 && !this.incoming.length && !this.shells.length && !this.blasts.length) {
      this.#tallyWave();
    }
  }

  #handleInput() {
    const m = this.mouse;
    if (m.pressed) this.#fire(m.x, m.y);
  }

  #advanceWorld(dt) {
    /* --- incoming --- */
    for (const missile of this.incoming) {
      missile.x += missile.vx * dt;
      missile.y += missile.vy * dt;

      // MIRV: one warhead becomes three on the way down.
      if (missile.splitAt !== null && missile.y >= missile.splitAt) {
        missile.splitAt = null;
        for (let i = 0; i < 2; i++) this.#spawnIncoming(missile.x, missile.y, 1.05);
      }

      if (missile.y >= GROUND_Y) {
        missile.dead = true;
        this.#impact(missile.x);
      }
    }

    /* --- our shells --- */
    for (const shell of this.shells) {
      shell.x += shell.vx * dt;
      shell.y += shell.vy * dt;
      // Arrived at the aim point?
      if ((shell.vy < 0 && shell.y <= shell.ty) || (shell.vy > 0 && shell.y >= shell.ty) ||
          Math.hypot(shell.x - shell.tx, shell.y - shell.ty) < 8) {
        shell.dead = true;
        this.#detonate(shell.tx, shell.ty);
      }
    }

    /* --- blasts --- */
    for (const blast of this.blasts) {
      if (blast.phase === 'grow') {
        blast.r += BLAST_GROW * dt;
        if (blast.r >= BLAST_MAX) blast.phase = 'hold';
      } else if (blast.phase === 'hold') {
        blast.hold -= dt;
        if (blast.hold <= 0) blast.phase = 'shrink';
      } else {
        blast.r -= BLAST_GROW * 1.3 * dt;
        if (blast.r <= 0) blast.dead = true;
      }

      // Anything flying through a live blast dies, and its death is a blast.
      for (const missile of this.incoming) {
        if (missile.dead) continue;
        if (Math.hypot(missile.x - blast.x, missile.y - blast.y) > blast.r) continue;
        missile.dead = true;
        this.addScore(Math.round((missile.smart ? 60 : 25) * (1 + this.wave * 0.15)));
        this.#detonate(missile.x, missile.y, true);
      }
    }

    this.incoming = this.incoming.filter((m) => !m.dead);
    this.shells = this.shells.filter((s) => !s.dead);
    this.blasts = this.blasts.filter((b) => !b.dead);

    for (const city of this.cities) if (city.rubble > 0) city.rubble -= dt;
  }

  #impact(x) {
    this.#detonate(x, GROUND_Y - 6, true);
    this.shake.add(8);

    // Whatever is closest to the impact takes it.
    let hit = null;
    let bestDist = 42;
    for (const item of [...this.cities, ...this.batteries]) {
      if (!item.alive) continue;
      const d = Math.abs(item.x - x);
      if (d < bestDist) {
        bestDist = d;
        hit = item;
      }
    }
    if (!hit) return;

    hit.alive = false;
    hit.rubble = 0.6;
    this.play('die');
    this.particles.emit(hit.x, GROUND_Y - 10, {
      count: 24, speed: 150, color: ENEMY_COLOR, life: 0.8, size: 3, gravity: 220,
    });

    const alive = this.#aliveCities();
    this.setLives(alive);
    if (alive === 0) {
      this.meta = { wave: this.wave, cities: 0 };
      this.play('gameover');
      this.banner('Overrun');
      this.finished = true;
      this.stateTimer = 2;
    }
  }

  #aliveCities() {
    return this.cities.filter((c) => c.alive).length;
  }

  #tallyWave() {
    // Unspent ammunition and surviving cities both pay — the classic bonus,
    // and the reason not to panic-fire.
    const ammo = this.batteries.reduce((n, b) => n + (b.alive ? b.ammo : 0), 0);
    const cities = this.#aliveCities();
    const bonus = ammo * 25 * this.wave + cities * 120 * this.wave;
    this.addScore(bonus);

    // Every few waves a flattened city is rebuilt, if any were spared.
    if (this.wave % 3 === 0 && cities > 0) {
      const dead = this.cities.find((c) => !c.alive);
      if (dead) {
        dead.alive = true;
        this.setLives(this.#aliveCities());
        this.banner('City rebuilt');
        this.play('powerup');
      }
    }

    this.state = 'tally';
    this.stateTimer = 1.8;
    this.tally = { ammo, cities, bonus };
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#05060e');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawSky(ctx);
    this.#drawTrails(ctx);
    this.#drawGround(ctx);
    this.#drawBlasts(ctx);
    this.#drawCrosshair(ctx);
    this.drawEffects(ctx);
    this.#drawHud(ctx);

    ctx.restore();
  }

  #drawSky(ctx) {
    // A sparse, deterministic starfield.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 46; i++) {
      const x = ((i * 9301 + 49297) % 233280) / 233280 * W;
      const y = ((i * 4931 + 7907) % 233280) / 233280 * (GROUND_Y - 40);
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  #drawTrails(ctx) {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    for (const missile of this.incoming) {
      ctx.strokeStyle = missile.smart ? 'rgba(192,132,252,0.5)' : 'rgba(251,113,133,0.45)';
      ctx.beginPath();
      ctx.moveTo(missile.startX, missile.startY);
      ctx.lineTo(missile.x, missile.y);
      ctx.stroke();

      ctx.save();
      ctx.fillStyle = missile.smart ? SMART_COLOR : ENEMY_COLOR;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(missile.x, missile.y, missile.smart ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const shell of this.shells) {
      ctx.strokeStyle = 'rgba(163,230,53,0.6)';
      ctx.beginPath();
      ctx.moveTo(shell.startX, shell.startY);
      ctx.lineTo(shell.x, shell.y);
      ctx.stroke();

      // A small cross marking where it will go off.
      ctx.strokeStyle = 'rgba(163,230,53,0.35)';
      ctx.beginPath();
      ctx.moveTo(shell.tx - 4, shell.ty);
      ctx.lineTo(shell.tx + 4, shell.ty);
      ctx.moveTo(shell.tx, shell.ty - 4);
      ctx.lineTo(shell.tx, shell.ty + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawGround(ctx) {
    ctx.save();
    ctx.fillStyle = '#101a12';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    this.glowLine(ctx, 0, GROUND_Y, W, GROUND_Y, BATTERY_COLOR, 2, 10);

    /* --- cities --- */
    for (const city of this.cities) {
      if (!city.alive) {
        ctx.save();
        ctx.fillStyle = '#2a2f3a';
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(city.x - 16 + i * 9, GROUND_Y - 5, 7, 5);
        }
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.fillStyle = CITY_COLOR;
      ctx.shadowColor = CITY_COLOR;
      ctx.shadowBlur = 10;
      // A little skyline rather than a block.
      const heights = [10, 18, 13, 22, 12];
      heights.forEach((hgt, i) => {
        ctx.fillRect(city.x - 18 + i * 8, GROUND_Y - hgt, 6, hgt);
      });
      ctx.restore();
    }

    /* --- batteries --- */
    for (const battery of this.batteries) {
      if (!battery.alive) {
        ctx.fillStyle = '#2a2f3a';
        ctx.fillRect(battery.x - 14, GROUND_Y - 6, 28, 6);
        continue;
      }
      const empty = battery.ammo <= 0;
      ctx.save();
      ctx.fillStyle = empty ? '#3a4152' : BATTERY_COLOR;
      ctx.shadowColor = BATTERY_COLOR;
      ctx.shadowBlur = empty ? 0 : 12;
      ctx.beginPath();
      ctx.moveTo(battery.x - 16, GROUND_Y);
      ctx.lineTo(battery.x - 8, GROUND_Y - 16);
      ctx.lineTo(battery.x + 8, GROUND_Y - 16);
      ctx.lineTo(battery.x + 16, GROUND_Y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Shells left, drawn as a little rack.
      for (let i = 0; i < battery.ammo; i++) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        ctx.fillStyle = BATTERY_COLOR;
        ctx.fillRect(battery.x - 13 + col * 6, GROUND_Y + 8 + row * 6, 3, 4);
      }
      if (empty) {
        this.text(ctx, 'EMPTY', battery.x, GROUND_Y + 16, { size: 9, color: '#fb7185' });
      }
    }
  }

  #drawBlasts(ctx) {
    for (const blast of this.blasts) {
      const t = Math.min(1, blast.r / BLAST_MAX);
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 40) * 0.15;
      ctx.fillStyle = t > 0.7 ? '#fde047' : '#fbbf24';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(blast.x, blast.y, Math.max(0, blast.r), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  #drawCrosshair(ctx) {
    const m = this.mouse;
    if (!m.active || this.finished) return;

    const loaded = this.batteries.some((b) => b.alive && b.ammo > 0);
    const color = loaded && m.y < GROUND_Y - 6 ? BATTERY_COLOR : '#fb7185';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(m.x - 10, m.y);
    ctx.lineTo(m.x - 3, m.y);
    ctx.moveTo(m.x + 3, m.y);
    ctx.lineTo(m.x + 10, m.y);
    ctx.moveTo(m.x, m.y - 10);
    ctx.lineTo(m.x, m.y - 3);
    ctx.moveTo(m.x, m.y + 3);
    ctx.lineTo(m.x, m.y + 10);
    ctx.stroke();
    ctx.restore();
  }

  #drawHud(ctx) {
    if (this.state === 'tally' && this.tally) {
      const cx = W / 2;
      this.text(ctx, 'WAVE CLEAR', cx, GROUND_Y * 0.34, { size: 20, color: '#fbbf24', glow: 14 });
      this.text(ctx, `${this.tally.ammo} shells spare  ·  ${this.tally.cities} cities standing`,
        cx, GROUND_Y * 0.34 + 28, { size: 12, color: '#8b93a7' });
      this.text(ctx, `+${this.tally.bonus}`, cx, GROUND_Y * 0.34 + 52, {
        size: 16, color: '#a3e635', glow: 8,
      });
      return;
    }

    if (this.state === 'wave' && this.spawnQueue > 0) {
      this.text(ctx, `${this.spawnQueue + this.incoming.length} INBOUND`, W - 16, 14, {
        size: 11, color: '#fb7185', align: 'right',
      });
    }
  }
}
