import { BaseGame } from '../core/game.js';

/**
 * BULWARK — tower defense
 *
 * A fixed serpentine road, and everything else is yours to build on. Enemies
 * walk the road from the west gate to the east; if they reach it, the keep
 * takes damage.
 *
 * Two decisions carry the design. First, enemies are tracked by *distance
 * travelled along the path* rather than by position, which makes "shoot the
 * one closest to the exit" — the only targeting rule that is ever correct —
 * a single max() instead of a pathfinding problem. Second, calling a wave in
 * early pays a bounty proportional to the time you skipped, so the interesting
 * choice is not which tower to build but how much peace to sell.
 */

const COLS = 18;
const ROWS = 12;
const CELL = 36;

const MAP_X = 20;
const MAP_Y = 20;
const MAP_W = COLS * CELL;
const MAP_H = ROWS * CELL;

const PANEL_X = MAP_X + MAP_W + 22;
const PANEL_W = 176;

const W = PANEL_X + PANEL_W + 20;
const H = MAP_Y + MAP_H + 28;

const KEEP_HEALTH = 20;

/** Grid waypoints. The road runs through the centre of every cell between. */
const WAYPOINTS = [
  [-1, 2], [4, 2], [4, 6], [1, 6], [1, 9], [8, 9],
  [8, 4], [12, 4], [12, 10], [16, 10], [16, 6], [18, 6],
];

const TOWERS = {
  gun: {
    name: 'Gun', cost: 60, color: '#38bdf8', key: '1',
    range: 2.7, cooldown: 0.42, damage: 13, splash: 0, slow: 0, speed: 460,
    blurb: 'Fast. Single target.',
  },
  cannon: {
    name: 'Cannon', cost: 130, color: '#fb923c', key: '2',
    range: 3.0, cooldown: 1.35, damage: 34, splash: 1.25, slow: 0, speed: 300,
    blurb: 'Slow. Splash damage.',
  },
  frost: {
    name: 'Frost', cost: 95, color: '#67e8f9', key: '3',
    range: 2.5, cooldown: 0.9, damage: 7, splash: 0.9, slow: 0.45, speed: 340,
    blurb: 'Chills. Barely hurts.',
  },
  tesla: {
    name: 'Tesla', cost: 190, color: '#c084fc', key: '4',
    range: 2.3, cooldown: 0.85, damage: 30, splash: 0, slow: 0, speed: 0, chains: 3,
    blurb: 'Arcs to three at once.',
  },
};

const TOWER_IDS = Object.keys(TOWERS);
const MAX_LEVEL = 3;

const ENEMIES = {
  grunt: { hp: 62, speed: 46, gold: 8, armor: 0, radius: 10, color: '#a3e635' },
  runner: { hp: 40, speed: 92, gold: 7, armor: 0, radius: 8, color: '#fbbf24' },
  swarm: { hp: 24, speed: 66, gold: 4, armor: 0, radius: 7, color: '#f472b6' },
  tank: { hp: 230, speed: 30, gold: 22, armor: 7, radius: 13, color: '#94a3b8' },
  boss: { hp: 1400, speed: 27, gold: 140, armor: 14, radius: 18, color: '#fb7185' },
};

export default class Bulwark extends BaseGame {
  static id = 'bulwark';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 32, bottom: 20 };
  static hudLabels = { score: 'Score', secondary: 'Wave' };

  static options = [
    {
      id: 'pace',
      label: 'Pace',
      default: 'calm',
      choices: [
        { value: 'calm', label: 'Calm', hint: 'Twenty seconds to build between waves.' },
        { value: 'brisk', label: 'Brisk', hint: 'Eight seconds between waves, and 1.4x the score.' },
      ],
    },
  ];

  setup() {
    this.host.setSecondaryLabel('Wave');
    this.host.setHint('Pick a tower, click open ground · Space calls the next wave');

    this.#buildPath();
    this.#applyPace(this.option('pace'));

    this.gold = 220;
    this.health = KEEP_HEALTH;
    this.wave = 0;
    this.towers = [];
    this.enemies = [];
    this.shots = [];
    this.arcs = [];
    this.selectedType = 'gun';
    this.selectedTower = null;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.breakTimer = this.buildTime;
    this.leaked = 0;
    this.finished = false;

    this.setLives(4);
    this.host.setSecondary(0);
    this.banner('Hold the line');
    this.play('ready');
  }

  onOptionChange(id, value) {
    if (id !== 'pace') return false;
    this.#applyPace(value);
    return true;
  }

  #applyPace(value) {
    this.pace = value;
    this.buildTime = value === 'brisk' ? 8 : 20;
    this.scoreScale = value === 'brisk' ? 1.4 : 1;
  }

  /* ================================================================= path */

  #buildPath() {
    const toPixel = ([c, r]) => [MAP_X + (c + 0.5) * CELL, MAP_Y + (r + 0.5) * CELL];
    this.path = WAYPOINTS.map(toPixel);

    // Cumulative length, so a distance can be turned into a position.
    this.legs = [];
    let total = 0;
    for (let i = 0; i < this.path.length - 1; i++) {
      const [x1, y1] = this.path[i];
      const [x2, y2] = this.path[i + 1];
      const length = Math.hypot(x2 - x1, y2 - y1);
      this.legs.push({ x1, y1, x2, y2, start: total, length });
      total += length;
    }
    this.pathLength = total;

    // Every grid cell the road passes through is off limits for building.
    this.road = new Set();
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const [c1, r1] = WAYPOINTS[i];
      const [c2, r2] = WAYPOINTS[i + 1];
      const steps = Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1));
      for (let s = 0; s <= steps; s++) {
        const c = Math.round(c1 + ((c2 - c1) * s) / steps);
        const r = Math.round(r1 + ((r2 - r1) * s) / steps);
        this.road.add(`${c},${r}`);
      }
    }
  }

  /** Position along the road at a given distance from the gate. */
  #pointAt(distance) {
    if (distance <= 0) return [this.path[0][0], this.path[0][1]];
    for (const leg of this.legs) {
      if (distance <= leg.start + leg.length) {
        const t = (distance - leg.start) / leg.length;
        return [leg.x1 + (leg.x2 - leg.x1) * t, leg.y1 + (leg.y2 - leg.y1) * t];
      }
    }
    const last = this.path[this.path.length - 1];
    return [last[0], last[1]];
  }

  /* ================================================================ waves */

  /** Wave composition. Every fifth wave is a boss, escorted. */
  #composeWave(wave) {
    const queue = [];
    const push = (kind, count, gap) => {
      for (let i = 0; i < count; i++) queue.push({ kind, gap });
    };

    if (wave % 5 === 0) {
      push('grunt', 6 + wave, 0.5);
      push('boss', Math.ceil(wave / 10), 1.4);
      push('runner', 4 + wave, 0.32);
      return queue;
    }

    push('grunt', 5 + Math.floor(wave * 1.5), 0.62);
    if (wave >= 2) push('runner', 3 + wave, 0.36);
    if (wave >= 3) push('swarm', 6 + wave * 2, 0.2);
    if (wave >= 4) push('tank', Math.floor(wave / 2), 1.1);
    return queue;
  }

  #startWave({ early = false } = {}) {
    this.wave++;
    this.host.setSecondary(this.wave);
    this.meta = { wave: this.wave, pace: this.pace };

    if (early) {
      // The bounty is the peace you sold, at ten gold a second.
      const bounty = Math.round(this.breakTimer * 10);
      this.gold += bounty;
      this.#award(bounty * 4);
      this.banner(`+${bounty} early`);
      this.play('coin');
    } else {
      this.banner(`Wave ${this.wave}`);
      this.play('levelup');
    }

    this.spawnQueue = this.#composeWave(this.wave);
    this.spawnTimer = 0;
    this.breakTimer = 0;
  }

  #spawn(kind) {
    const def = ENEMIES[kind];
    // Health climbs steadily; speed only creeps, so the road stays readable.
    const scale = 1 + (this.wave - 1) * 0.19;
    this.enemies.push({
      kind,
      hp: def.hp * scale,
      maxHp: def.hp * scale,
      speed: def.speed * (1 + (this.wave - 1) * 0.012),
      armor: def.armor,
      gold: def.gold,
      radius: def.radius,
      color: def.color,
      distance: 0,
      slowUntil: 0,
      slowFactor: 1,
      hitFlash: 0,
    });
  }

  /* =============================================================== towers */

  #cellAt(x, y) {
    const c = Math.floor((x - MAP_X) / CELL);
    const r = Math.floor((y - MAP_Y) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c, r };
  }

  #towerAt(c, r) {
    return this.towers.find((t) => t.c === c && t.r === r) ?? null;
  }

  #upgradeCost(tower) {
    return Math.round(TOWERS[tower.type].cost * 0.85 * tower.level);
  }

  #sellValue(tower) {
    return Math.round(tower.spent * 0.6);
  }

  /** Stats for a tower at its current level. */
  #stats(tower) {
    const def = TOWERS[tower.type];
    const step = tower.level - 1;
    return {
      ...def,
      range: (def.range + step * 0.42) * CELL,
      damage: def.damage * (1 + step * 0.75),
      cooldown: def.cooldown * (1 - step * 0.14),
      splash: def.splash * CELL,
    };
  }

  #build(c, r) {
    const def = TOWERS[this.selectedType];
    if (this.road.has(`${c},${r}`) || this.#towerAt(c, r)) {
      this.play('hit');
      return;
    }
    if (this.gold < def.cost) {
      this.play('hit');
      this.banner('Not enough gold');
      return;
    }
    this.gold -= def.cost;
    this.towers.push({
      type: this.selectedType,
      c, r,
      x: MAP_X + (c + 0.5) * CELL,
      y: MAP_Y + (r + 0.5) * CELL,
      level: 1,
      cooldown: 0,
      spent: def.cost,
      angle: -Math.PI / 2,
    });
    this.play('select');
  }

  #upgrade(tower) {
    if (tower.level >= MAX_LEVEL) return;
    const cost = this.#upgradeCost(tower);
    if (this.gold < cost) {
      this.play('hit');
      return;
    }
    this.gold -= cost;
    tower.spent += cost;
    tower.level++;
    this.play('powerup');
  }

  #sell(tower) {
    this.gold += this.#sellValue(tower);
    this.towers = this.towers.filter((t) => t !== tower);
    this.selectedTower = null;
    this.play('back');
  }

  /* ============================================================== combat */

  #damage(enemy, amount, source) {
    // Armour is flat reduction, with a floor so nothing is ever immune.
    const dealt = Math.max(1, amount - enemy.armor);
    enemy.hp -= dealt;
    enemy.hitFlash = 0.12;

    if (source?.slow) {
      enemy.slowUntil = 1.7;
      enemy.slowFactor = 1 - source.slow;
    }
    if (enemy.hp > 0) return;

    const [x, y] = this.#pointAt(enemy.distance);
    this.gold += enemy.gold;
    this.#award(enemy.gold * 6);
    this.particles.emit(x, y, {
      count: enemy.kind === 'boss' ? 30 : 10,
      speed: 130, color: enemy.color, life: 0.5, size: 3,
    });
    if (enemy.kind === 'boss') this.shake.add(9);
    this.play(enemy.kind === 'boss' ? 'explode' : 'blip');
  }

  #award(points) {
    this.addScore(Math.round(points * this.scoreScale));
  }

  #fire(tower, dt) {
    tower.cooldown -= dt;
    if (tower.cooldown > 0) return;

    const stats = this.#stats(tower);

    // Always the enemy furthest along the road — the only one that matters.
    let target = null;
    for (const enemy of this.enemies) {
      const [x, y] = this.#pointAt(enemy.distance);
      if (Math.hypot(x - tower.x, y - tower.y) > stats.range) continue;
      if (!target || enemy.distance > target.distance) target = enemy;
    }
    if (!target) return;

    const [tx, ty] = this.#pointAt(target.distance);
    tower.angle = Math.atan2(ty - tower.y, tx - tower.x);
    tower.cooldown = stats.cooldown;

    if (stats.chains) {
      // Tesla hits instantly, arcing to the nearest few in range.
      const inRange = this.enemies
        .map((e) => ({ e, p: this.#pointAt(e.distance) }))
        .filter(({ p }) => Math.hypot(p[0] - tower.x, p[1] - tower.y) <= stats.range)
        .sort((a, b) => b.e.distance - a.e.distance)
        .slice(0, stats.chains);

      for (const { e, p } of inRange) {
        this.#damage(e, stats.damage, stats);
        this.arcs.push({ x1: tower.x, y1: tower.y, x2: p[0], y2: p[1], life: 0.12 });
      }
      this.play('laser');
      return;
    }

    this.shots.push({
      x: tower.x, y: tower.y,
      target,
      speed: stats.speed,
      damage: stats.damage,
      splash: stats.splash,
      slow: stats.slow,
      color: stats.color,
    });
    this.play(tower.type === 'cannon' ? 'drop' : 'blip');
  }

  #updateShots(dt) {
    for (const shot of this.shots) {
      const [tx, ty] = this.#pointAt(shot.target.distance);
      const dx = tx - shot.x;
      const dy = ty - shot.y;
      const dist = Math.hypot(dx, dy);
      const step = shot.speed * dt;

      if (dist <= step || shot.target.hp <= 0) {
        shot.hit = true;
        shot.x = tx;
        shot.y = ty;

        if (shot.splash > 0) {
          for (const enemy of this.enemies) {
            const [ex, ey] = this.#pointAt(enemy.distance);
            if (Math.hypot(ex - shot.x, ey - shot.y) <= shot.splash) {
              this.#damage(enemy, shot.damage, shot);
            }
          }
          this.particles.emit(shot.x, shot.y, {
            count: 10, speed: 110, color: shot.color, life: 0.35, size: 2.6,
          });
        } else if (shot.target.hp > 0) {
          this.#damage(shot.target, shot.damage, shot);
        }
        continue;
      }

      shot.x += (dx / dist) * step;
      shot.y += (dy / dist) * step;
    }
    this.shots = this.shots.filter((s) => !s.hit);
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    if (this.over) return;

    if (this.finished) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.end();
      return;
    }

    this.#handleInput();

    for (const arc of this.arcs) arc.life -= dt;
    this.arcs = this.arcs.filter((a) => a.life > 0);

    /* --- spawning --- */
    if (this.spawnQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const next = this.spawnQueue.shift();
        this.#spawn(next.kind);
        this.spawnTimer = next.gap;
      }
    } else if (!this.enemies.length) {
      // Wave cleared: pay a bonus, then count down to the next one.
      if (this.breakTimer <= 0 && this.wave > 0) {
        this.gold += 40 + this.wave * 12;
        this.#award(200 + this.wave * 60);
        this.breakTimer = this.buildTime;
        this.play('levelup');
      }
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.#startWave();
    }

    /* --- enemies --- */
    for (const enemy of this.enemies) {
      if (enemy.hitFlash > 0) enemy.hitFlash -= dt;
      if (enemy.slowUntil > 0) {
        enemy.slowUntil -= dt;
        if (enemy.slowUntil <= 0) enemy.slowFactor = 1;
      }
      enemy.distance += enemy.speed * enemy.slowFactor * dt;

      if (enemy.distance >= this.pathLength) {
        enemy.leaked = true;
        // Tougher enemies do more damage when they get through.
        this.health -= enemy.kind === 'boss' ? 6 : enemy.kind === 'tank' ? 3 : 1;
        this.leaked++;
        this.play('die');
        this.shake.add(7);
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 && !e.leaked);

    this.setLives(Math.max(0, Math.ceil((this.health / KEEP_HEALTH) * 4)));
    if (this.health <= 0) {
      this.health = 0;
      this.meta = { wave: this.wave, pace: this.pace };
      this.play('gameover');
      this.finished = true;
      this.breakTimer = 1.6;
      return;
    }

    /* --- towers --- */
    for (const tower of this.towers) this.#fire(tower, dt);
    this.#updateShots(dt);
  }

  #handleInput() {
    /* --- keyboard --- */
    for (const id of TOWER_IDS) {
      if (this.input.keyPressed(`Digit${TOWERS[id].key}`)) {
        this.selectedType = id;
        this.selectedTower = null;
        this.play('toggle');
      }
    }
    // Space calls the next wave in early, which is where the money is.
    if (this.input.keyPressed('Space') && this.breakTimer > 0 && !this.spawnQueue.length) {
      this.#startWave({ early: true });
    }

    /* --- pointer --- */
    const m = this.mouse;
    if (!m.pressed) return;

    // Panel first: it sits outside the map.
    if (m.x >= PANEL_X) {
      this.#panelClick(m.x, m.y);
      return;
    }

    const cell = this.#cellAt(m.x, m.y);
    if (!cell) return;

    const existing = this.#towerAt(cell.c, cell.r);
    if (existing) {
      this.selectedTower = existing === this.selectedTower ? null : existing;
      this.play('hover');
      return;
    }
    this.selectedTower = null;
    this.#build(cell.c, cell.r);
  }

  #panelClick(x, y) {
    TOWER_IDS.forEach((id, i) => {
      const [rx, ry, rw, rh] = this.#towerButtonRect(i);
      if (this.hits(x, y, rx, ry, rw, rh)) {
        this.selectedType = id;
        this.selectedTower = null;
        this.play('toggle');
      }
    });

    if (this.selectedTower) {
      const [ux, uy, uw, uh] = this.#upgradeRect();
      if (this.hits(x, y, ux, uy, uw, uh)) {
        this.#upgrade(this.selectedTower);
        return;
      }
      const [sx, sy, sw, sh] = this.#sellRect();
      if (this.hits(x, y, sx, sy, sw, sh)) {
        this.#sell(this.selectedTower);
        return;
      }
    }

    const [wx, wy, ww, wh] = this.#waveButtonRect();
    if (this.hits(x, y, wx, wy, ww, wh) && this.breakTimer > 0 && !this.spawnQueue.length) {
      this.#startWave({ early: true });
    }
  }

  /* =============================================================== layout */

  #towerButtonRect(i) {
    return [PANEL_X, MAP_Y + 54 + i * 62, PANEL_W, 54];
  }

  #upgradeRect() {
    return [PANEL_X, MAP_Y + 330, PANEL_W, 38];
  }

  #sellRect() {
    return [PANEL_X, MAP_Y + 374, PANEL_W, 32];
  }

  #waveButtonRect() {
    return [PANEL_X, MAP_Y + MAP_H - 44, PANEL_W, 44];
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#070b09');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawMap(ctx);
    this.#drawRange(ctx);
    this.#drawTowers(ctx);
    this.#drawEnemies(ctx);
    this.#drawShots(ctx);
    this.drawEffects(ctx);
    this.#drawPanel(ctx);

    ctx.restore();
  }

  #drawMap(ctx) {
    ctx.save();
    ctx.fillStyle = '#0c1410';
    ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);

    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
      ctx.moveTo(MAP_X + c * CELL, MAP_Y);
      ctx.lineTo(MAP_X + c * CELL, MAP_Y + MAP_H);
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.moveTo(MAP_X, MAP_Y + r * CELL);
      ctx.lineTo(MAP_X + MAP_W, MAP_Y + r * CELL);
    }
    ctx.stroke();
    ctx.restore();

    /* --- the road --- */
    ctx.save();
    ctx.strokeStyle = '#1e2a22';
    ctx.lineWidth = CELL * 0.86;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    this.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();

    // A dashed centre line that crawls, so the direction of travel is obvious.
    ctx.strokeStyle = 'rgba(163,230,53,0.28)';
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 13]);
    ctx.lineDashOffset = -(performance.now() / 40) % 22;
    ctx.beginPath();
    this.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();

    /* --- gate and keep --- */
    const [gx, gy] = this.path[0];
    const [kx, ky] = this.path[this.path.length - 1];
    this.text(ctx, 'GATE', gx + 26, gy - 22, { size: 9, color: '#5c6478' });
    this.glowRect(ctx, kx - 12, ky - CELL / 2, 10, CELL, '#fb7185', 14);
    this.text(ctx, 'KEEP', kx - 26, ky - 26, { size: 9, color: '#fb7185' });

    /* --- placement preview --- */
    const m = this.mouse;
    if (!m.active || m.x >= PANEL_X) return;
    const cell = this.#cellAt(m.x, m.y);
    if (!cell) return;

    const blocked = this.road.has(`${cell.c},${cell.r}`) || !!this.#towerAt(cell.c, cell.r);
    const affordable = this.gold >= TOWERS[this.selectedType].cost;
    const x = MAP_X + cell.c * CELL;
    const y = MAP_Y + cell.r * CELL;

    ctx.save();
    ctx.fillStyle = blocked || !affordable ? 'rgba(251,113,133,0.18)' : 'rgba(163,230,53,0.16)';
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.restore();

    if (!blocked && affordable) {
      const range = (TOWERS[this.selectedType].range) * CELL;
      ctx.save();
      ctx.strokeStyle = 'rgba(163,230,53,0.3)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #drawRange(ctx) {
    if (!this.selectedTower) return;
    const stats = this.#stats(this.selectedTower);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.selectedTower.x, this.selectedTower.y, stats.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  #drawTowers(ctx) {
    for (const tower of this.towers) {
      const def = TOWERS[tower.type];
      const selected = tower === this.selectedTower;

      ctx.save();
      ctx.fillStyle = '#131c18';
      this.roundRect(ctx, tower.x - CELL / 2 + 3, tower.y - CELL / 2 + 3, CELL - 6, CELL - 6, 7).fill();
      ctx.strokeStyle = selected ? '#ffffff' : def.color;
      ctx.lineWidth = selected ? 2 : 1.4;
      ctx.shadowColor = def.color;
      ctx.shadowBlur = 8;
      this.roundRect(ctx, tower.x - CELL / 2 + 3, tower.y - CELL / 2 + 3, CELL - 6, CELL - 6, 7).stroke();
      ctx.restore();

      // The barrel points wherever it last fired.
      ctx.save();
      ctx.translate(tower.x, tower.y);
      ctx.rotate(tower.angle);
      ctx.fillStyle = def.color;
      ctx.shadowColor = def.color;
      ctx.shadowBlur = 10;
      if (tower.type === 'tesla') {
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(0, -3, CELL * 0.42, 6);
        ctx.beginPath();
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Level pips along the bottom edge.
      for (let i = 0; i < tower.level; i++) {
        ctx.fillStyle = def.color;
        ctx.fillRect(tower.x - 8 + i * 7, tower.y + CELL / 2 - 8, 5, 2.5);
      }
    }
  }

  #drawEnemies(ctx) {
    for (const enemy of this.enemies) {
      const [x, y] = this.#pointAt(enemy.distance);
      const chilled = enemy.slowUntil > 0;

      ctx.save();
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : chilled ? '#7dd3fc' : enemy.color;
      ctx.shadowColor = enemy.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      if (enemy.kind === 'tank' || enemy.kind === 'boss') {
        // Armoured things are drawn as blocks, so they read as hard to move.
        const r = enemy.radius;
        ctx.rect(x - r, y - r, r * 2, r * 2);
      } else {
        ctx.arc(x, y, enemy.radius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();

      // Health bar, only once it means something.
      if (enemy.hp < enemy.maxHp) {
        const w = enemy.radius * 2.4;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - enemy.radius - 8, w, 4);
        ctx.fillStyle = enemy.hp / enemy.maxHp > 0.4 ? '#a3e635' : '#fb7185';
        ctx.fillRect(x - w / 2, y - enemy.radius - 8, w * (enemy.hp / enemy.maxHp), 4);
      }
    }
  }

  #drawShots(ctx) {
    for (const shot of this.shots) {
      this.glowCircle(ctx, shot.x, shot.y, shot.splash > 0 ? 5 : 3, shot.color, 10);
    }
    for (const arc of this.arcs) {
      ctx.save();
      ctx.globalAlpha = arc.life / 0.12;
      ctx.strokeStyle = '#c084fc';
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // A crooked bolt rather than a straight line.
      const segments = 5;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = arc.x1 + (arc.x2 - arc.x1) * t + (i && i < segments ? (this.random() - 0.5) * 12 : 0);
        const y = arc.y1 + (arc.y2 - arc.y1) * t + (i && i < segments ? (this.random() - 0.5) * 12 : 0);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ================================================================ panel */

  #drawPanel(ctx) {
    const cx = PANEL_X + PANEL_W / 2;

    /* --- purse and keep --- */
    this.text(ctx, `${this.gold}`, PANEL_X, MAP_Y + 4, {
      size: 20, color: '#fbbf24', align: 'left', glow: 8,
    });
    this.text(ctx, 'GOLD', PANEL_X + PANEL_W, MAP_Y + 6, {
      size: 9, color: '#5c6478', align: 'right',
    });

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.roundRect(ctx, PANEL_X, MAP_Y + 22, PANEL_W, 6, 3).fill();
    ctx.fillStyle = this.health > KEEP_HEALTH * 0.35 ? '#4ade80' : '#fb7185';
    this.roundRect(ctx, PANEL_X, MAP_Y + 22, Math.max(2, PANEL_W * (this.health / KEEP_HEALTH)), 6, 3).fill();
    ctx.restore();
    this.text(ctx, `KEEP ${Math.max(0, this.health)}`, PANEL_X, MAP_Y + 38, {
      size: 9, color: '#5c6478', align: 'left',
    });

    /* --- tower buttons --- */
    TOWER_IDS.forEach((id, i) => {
      const def = TOWERS[id];
      const [x, y, w, h] = this.#towerButtonRect(i);
      const on = id === this.selectedType;
      const affordable = this.gold >= def.cost;

      ctx.save();
      ctx.fillStyle = on ? `${def.color}22` : 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, x, y, w, h, 8).fill();
      ctx.strokeStyle = on ? def.color : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = on ? 1.6 : 1;
      this.roundRect(ctx, x, y, w, h, 8).stroke();
      ctx.restore();

      this.glowCircle(ctx, x + 20, y + 20, 7, affordable ? def.color : '#3a4152', on ? 10 : 4);
      this.text(ctx, def.name, x + 38, y + 15, {
        size: 12, color: affordable ? '#e9edf6' : '#5c6478', align: 'left',
      });
      this.text(ctx, `${def.cost}g`, x + w - 10, y + 15, {
        size: 11, color: affordable ? '#fbbf24' : '#5c6478', align: 'right',
      });
      this.text(ctx, def.blurb, x + 10, y + 38, { size: 9, color: '#5c6478', align: 'left', weight: 500 });

      // Hotkey badge, tucked into the corner away from the blurb.
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      this.roundRect(ctx, x + w - 24, y + 32, 15, 14, 4).fill();
      ctx.restore();
      this.text(ctx, def.key, x + w - 16.5, y + 39, { size: 9, color: '#8b93a7' });
    });

    /* --- selected tower --- */
    if (this.selectedTower) {
      const tower = this.selectedTower;
      const def = TOWERS[tower.type];
      const stats = this.#stats(tower);
      const maxed = tower.level >= MAX_LEVEL;

      this.text(ctx, `${def.name} · LV ${tower.level}`, PANEL_X, MAP_Y + 306, {
        size: 11, color: def.color, align: 'left', glow: 6,
      });
      this.text(ctx, `DMG ${Math.round(stats.damage)}`, PANEL_X + PANEL_W, MAP_Y + 306, {
        size: 10, color: '#5c6478', align: 'right',
      });

      const [ux, uy, uw, uh] = this.#upgradeRect();
      const cost = this.#upgradeCost(tower);
      const canAfford = !maxed && this.gold >= cost;
      ctx.save();
      ctx.fillStyle = canAfford ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, ux, uy, uw, uh, 8).fill();
      ctx.strokeStyle = canAfford ? '#4ade80' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, ux, uy, uw, uh, 8).stroke();
      ctx.restore();
      this.text(ctx, maxed ? 'MAX LEVEL' : `UPGRADE  ${cost}g`, ux + uw / 2, uy + uh / 2, {
        size: 11, color: maxed ? '#5c6478' : canAfford ? '#86efac' : '#5c6478',
      });

      const [sx, sy, sw, sh] = this.#sellRect();
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, sx, sy, sw, sh, 8).fill();
      ctx.strokeStyle = 'rgba(251,113,133,0.4)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, sx, sy, sw, sh, 8).stroke();
      ctx.restore();
      this.text(ctx, `SELL  ${this.#sellValue(tower)}g`, sx + sw / 2, sy + sh / 2, {
        size: 10, color: '#fb7185',
      });
    }

    /* --- wave button --- */
    const [wx, wy, ww, wh] = this.#waveButtonRect();
    const building = this.breakTimer > 0 && !this.spawnQueue.length;
    ctx.save();
    ctx.fillStyle = building ? 'rgba(251,191,36,0.16)' : 'rgba(255,255,255,0.03)';
    this.roundRect(ctx, wx, wy, ww, wh, 10).fill();
    ctx.strokeStyle = building ? '#fbbf24' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1.4;
    this.roundRect(ctx, wx, wy, ww, wh, 10).stroke();
    ctx.restore();

    if (building) {
      this.text(ctx, `CALL WAVE ${this.wave + 1}`, cx, wy + 16, { size: 11, color: '#fbbf24' });
      this.text(ctx, `+${Math.round(this.breakTimer * 10)}g  ·  ${Math.ceil(this.breakTimer)}s`, cx, wy + 32, {
        size: 10, color: '#8b93a7',
      });
    } else {
      this.text(ctx, `WAVE ${this.wave} INBOUND`, cx, wy + 16, { size: 11, color: '#8b93a7' });
      this.text(ctx, `${this.enemies.length + this.spawnQueue.length} left`, cx, wy + 32, {
        size: 10, color: '#5c6478',
      });
    }
  }
}
