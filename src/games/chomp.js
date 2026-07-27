import { BaseGame } from '../core/game.js';

/**
 * CHOMP — a maze chase
 *
 * The maze is the 28x31 classic. What makes this game worth re-implementing is
 * the ghosts: they are not four copies of the same chase routine, they are four
 * different target-picking rules running through the same movement code.
 *
 *   Blinky aims at you.
 *   Pinky aims four tiles in front of you.
 *   Inky aims at the point you get by doubling the vector from Blinky to two
 *     tiles ahead of you — which is why he seems to cut you off from nowhere.
 *   Clyde aims at you until he gets within eight tiles, then bolts for his
 *     corner, which is why he feels like he loses his nerve.
 *
 * Everything else — scatter/chase waves, the cornering allowance, the tunnel
 * slowdown — follows the original's behaviour.
 */

const TILE = 16;
const COLS = 28;
const ROWS = 31;

/* eslint-disable */
const MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '######.##### ## #####.######',
  '######.##          ##.######',
  '######.## ###--### ##.######',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '######.## ######## ##.######',
  '######.##          ##.######',
  '######.## ######## ##.######',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];
/* eslint-enable */

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const DIR_NAMES = ['up', 'left', 'down', 'right']; // original tie-break order
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Scatter/chase schedule in seconds. The last chase never ends. */
const WAVES = [
  { mode: 'scatter', time: 7 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 7 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 5 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 5 },
  { mode: 'chase', time: Infinity },
];

const GHOSTS = [
  { name: 'blinky', color: '#ff2e88', corner: { x: 25, y: 0 }, start: { x: 13.5, y: 11 }, release: 0 },
  { name: 'pinky', color: '#ffb8de', corner: { x: 2, y: 0 }, start: { x: 13.5, y: 14 }, release: 2 },
  { name: 'inky', color: '#00e5ff', corner: { x: 27, y: 30 }, start: { x: 11.5, y: 14 }, release: 6 },
  { name: 'clyde', color: '#ff9f43', corner: { x: 0, y: 30 }, start: { x: 15.5, y: 14 }, release: 11 },
];

const DOOR_TILE = { x: 13.5, y: 12 };
const EXIT_TILE = { x: 13.5, y: 11 };
const FRUIT_TILE = { x: 13.5, y: 17 };
const FRUITS = [
  { name: 'cherry', value: 100, color: '#ff2e88' },
  { name: 'strawberry', value: 300, color: '#ff5c7a' },
  { name: 'orange', value: 500, color: '#ff9f43' },
  { name: 'apple', value: 700, color: '#39ff88' },
  { name: 'melon', value: 1000, color: '#00e5ff' },
];

export default class Chomp extends BaseGame {
  static id = 'chomp';
  static width = COLS * TILE;
  static height = ROWS * TILE;
  static renderer = '2d';
  static touch = 'move';
  static smooth = true;
  static hudPad = { top: 36, bottom: 28 };
  static hudLabels = { score: 'Score', secondary: 'Level' };

  setup() {
    this.host.setSecondaryLabel('Level');
    this.host.setHint('Arrows or swipe to turn');

    this.#parseMaze();
    this.#buildWallEdges();

    this.level = 1;
    this.setLives(3);
    this.#startLevel();
  }

  /* ============================================================== the maze */

  #parseMaze() {
    // `grid` holds terrain, `dots` holds what is left to eat.
    this.grid = MAZE.map((row) => [...row.padEnd(COLS, ' ')]);
    this.dots = this.grid.map((row) => row.map((c) => (c === '.' ? 1 : c === 'o' ? 2 : 0)));
    this.totalDots = this.dots.flat().filter(Boolean).length;
  }

  #isWall(col, row) {
    if (row < 0 || row >= ROWS) return true;
    // Columns wrap: the tunnel joins the two sides of the maze.
    const c = ((col % COLS) + COLS) % COLS;
    const cell = this.grid[row][c];
    return cell === '#';
  }

  /** The ghost-house door is solid for Pac-Man, passable for ghosts going home. */
  #isDoor(col, row) {
    if (row < 0 || row >= ROWS) return false;
    const c = ((col % COLS) + COLS) % COLS;
    return this.grid[row][c] === '-';
  }

  /**
   * Precompute the maze outline once: every edge between a wall tile and a
   * non-wall tile becomes a line segment. Drawing those as a single glowing
   * path is both faster and much better looking than filling wall tiles.
   */
  #buildWallEdges() {
    const edges = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (this.grid[row][col] !== '#') continue;
        const x = col * TILE;
        const y = row * TILE;
        // Only draw the side that faces open space.
        if (!this.#isWall(col, row - 1)) edges.push([x, y, x + TILE, y]);
        if (!this.#isWall(col, row + 1)) edges.push([x, y + TILE, x + TILE, y + TILE]);
        if (!this.#isWall(col - 1, row)) edges.push([x, y, x, y + TILE]);
        if (!this.#isWall(col + 1, row)) edges.push([x + TILE, y, x + TILE, y + TILE]);
      }
    }
    this.wallEdges = edges;
  }

  /* ============================================================== a level */

  #startLevel() {
    this.host.setSecondary(this.level);

    this.waveIndex = 0;
    this.waveTimer = WAVES[0].time;
    this.mode = 'scatter';
    this.frightenedTimer = 0;
    this.ghostsEaten = 0;
    this.dotsEaten = 0;
    this.fruit = null;
    this.fruitTimer = 0;
    this.fruitsShown = 0;

    this.#resetActors();
    this.state = 'ready';
    this.stateTimer = 2;
    this.banner('Ready');
    this.play('ready');
  }

  #resetActors() {
    this.pac = {
      x: 13.5 * TILE,
      y: 23 * TILE + TILE / 2,
      dir: 'left',
      queued: null,
      speed: 6.6 * TILE,
      mouth: 0,
    };

    this.ghosts = GHOSTS.map((def) => ({
      ...def,
      x: def.start.x * TILE,
      y: def.start.y * TILE + TILE / 2,
      dir: def.name === 'blinky' ? 'left' : 'up',
      state: def.name === 'blinky' ? 'hunt' : 'house',
      releaseTimer: def.release,
      bob: 0,
      frightened: false,
    }));
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    this.pac.mouth += dt * 12;

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
        this.level++;
        this.#startLevel();
      }
      return;
    }

    if (this.state === 'eaten') {
      // A brief freeze while the score for an eaten ghost is displayed.
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'play';
      return;
    }

    this.#updateModes(dt);
    this.#updatePac(dt);
    for (const ghost of this.ghosts) this.#updateGhost(ghost, dt);
    this.#checkCollisions();
    this.#updateFruit(dt);
  }

  #updateModes(dt) {
    if (this.frightenedTimer > 0) {
      this.frightenedTimer -= dt;
      if (this.frightenedTimer <= 0) {
        for (const ghost of this.ghosts) ghost.frightened = false;
        this.ghostsEaten = 0;
      }
      return; // the wave clock is suspended while ghosts are frightened
    }

    const wave = WAVES[this.waveIndex];
    if (!wave || wave.time === Infinity) return;

    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveIndex = Math.min(this.waveIndex + 1, WAVES.length - 1);
      const next = WAVES[this.waveIndex];
      this.mode = next.mode;
      this.waveTimer = next.time;
      // A mode change makes every ghost turn around where it stands.
      for (const ghost of this.ghosts) {
        if (ghost.state === 'hunt') ghost.reverseRequested = true;
      }
    }
  }

  /* ------------------------------------------------------------- pac-man */

  #updatePac(dt) {
    const pac = this.pac;

    const requested = this.input.takeDirection();
    if (requested) pac.queued = requested;

    // Slightly slower while a level is fresh, faster as you clear it out.
    const speed = pac.speed * (this.#inTunnel(pac) ? 0.7 : 1);
    this.#move(pac, speed * dt, {
      onCenter: (entity) => {
        // Turn as soon as the requested direction opens up.
        if (entity.queued && this.#canEnter(entity, entity.queued)) {
          entity.dir = entity.queued;
          entity.queued = null;
        }
        this.#eatAt(entity);
        return this.#canEnter(entity, entity.dir);
      },
      // A reversal takes effect immediately rather than waiting for the next
      // tile centre — that instant about-turn is a big part of how the
      // original feels. It still has to be a legal move: parked nose-first
      // against a wall, "back the way you came" can point straight into it.
      preTurn: (entity) => {
        if (!entity.queued || entity.queued !== OPPOSITE[entity.dir]) return false;
        if (!this.#canEnter(entity, entity.queued)) return false;
        entity.dir = entity.queued;
        entity.queued = null;
        return true;
      },
    });
  }

  #eatAt(entity) {
    const col = this.#colOf(entity);
    const row = this.#rowOf(entity);
    const dot = this.dots[row]?.[col];
    if (!dot) return;

    this.dots[row][col] = 0;
    this.dotsEaten++;

    if (dot === 1) {
      this.addScore(10);
      this.play('blip');
    } else {
      this.addScore(50);
      this.#frighten();
    }

    this.particles.emit(col * TILE + TILE / 2, row * TILE + TILE / 2, {
      count: dot === 2 ? 12 : 3,
      speed: dot === 2 ? 90 : 34,
      color: dot === 2 ? '#00e5ff' : '#ffd8a8',
      life: 0.35,
      size: 2,
      drag: 0.9,
    });

    if (this.dotsEaten === 70 || this.dotsEaten === 170) this.#spawnFruit();

    if (this.dotsEaten >= this.totalDots) {
      this.state = 'cleared';
      this.stateTimer = 2.2;
      this.banner('Maze clear');
      this.play('levelup');
      this.addScore(500 + this.level * 100);
    }
  }

  #frighten() {
    // Frightened time shrinks as levels climb; by level 9 it is barely a pause.
    const duration = Math.max(1, 7 - (this.level - 1) * 0.6);
    this.frightenedTimer = duration;
    this.ghostsEaten = 0;
    for (const ghost of this.ghosts) {
      if (ghost.state === 'hunt' || ghost.state === 'leaving') {
        ghost.frightened = true;
        ghost.reverseRequested = true;
      }
    }
    this.play('powerup');
    this.shake.add(3);
  }

  /* -------------------------------------------------------------- ghosts */

  #updateGhost(ghost, dt) {
    if (ghost.state === 'house') {
      ghost.bob += dt * 3;
      ghost.y = ghost.start.y * TILE + TILE / 2 + Math.sin(ghost.bob) * 5;
      ghost.releaseTimer -= dt;
      // Ghosts also leave once you have eaten enough of the maze.
      if (ghost.releaseTimer <= 0 || this.dotsEaten > 30 + ghost.release * 6) {
        ghost.state = 'leaving';
      }
      return;
    }

    if (ghost.state === 'leaving') {
      this.#moveToward(ghost, EXIT_TILE, 5.2 * TILE * dt);
      if (Math.abs(ghost.x - EXIT_TILE.x * TILE) < 1 && Math.abs(ghost.y - (EXIT_TILE.y * TILE + TILE / 2)) < 1) {
        ghost.state = 'hunt';
        ghost.dir = 'left';
      }
      return;
    }

    if (ghost.state === 'eyes') {
      // Race home along the corridors, then drop into the house.
      const target = DOOR_TILE;
      const arrived =
        Math.abs(ghost.x - target.x * TILE) < 2 && Math.abs(ghost.y - (target.y * TILE + TILE / 2)) < 2;
      if (arrived) {
        ghost.state = 'returning';
        return;
      }
      this.#move(ghost, 13 * TILE * dt, {
        allowDoor: true,
        onCenter: (entity) => {
          entity.dir = this.#chooseDirection(entity, target, { allowDoor: true });
          return true;
        },
      });
      return;
    }

    if (ghost.state === 'returning') {
      this.#moveToward(ghost, { x: 13.5, y: 14 }, 6 * TILE * dt);
      if (Math.abs(ghost.y - (14 * TILE + TILE / 2)) < 2) {
        ghost.state = 'leaving';
        ghost.frightened = false;
      }
      return;
    }

    /* --- normal hunting --- */
    let speed = 5.9 * TILE;
    if (ghost.frightened) speed = 3.4 * TILE;
    else if (this.#inTunnel(ghost)) speed = 3.2 * TILE;
    // Blinky speeds up ("Cruise Elroy") once the maze is nearly clear.
    else if (ghost.name === 'blinky' && this.totalDots - this.dotsEaten < 40) speed = 6.6 * TILE;

    this.#move(ghost, speed * dt, {
      onCenter: (entity) => {
        if (entity.reverseRequested) {
          entity.reverseRequested = false;
          if (this.#canEnter(entity, OPPOSITE[entity.dir])) entity.dir = OPPOSITE[entity.dir];
        }
        entity.dir = this.#chooseDirection(entity, this.#targetFor(entity));
        return true;
      },
    });
  }

  /** Where each ghost wants to be — the whole personality of the game. */
  #targetFor(ghost) {
    if (ghost.frightened) return null; // random walk
    if (this.mode === 'scatter') return ghost.corner;

    const pacCol = this.#colOf(this.pac);
    const pacRow = this.#rowOf(this.pac);
    const facing = DIRS[this.pac.dir];

    switch (ghost.name) {
      case 'blinky':
        return { x: pacCol, y: pacRow };

      case 'pinky': {
        // Four tiles ahead — including the original's overflow when facing up,
        // which also shifts the target four tiles left. It is a bug, and it is
        // load-bearing for how the game feels, so it stays.
        const t = { x: pacCol + facing.x * 4, y: pacRow + facing.y * 4 };
        if (this.pac.dir === 'up') t.x -= 4;
        return t;
      }

      case 'inky': {
        const pivot = { x: pacCol + facing.x * 2, y: pacRow + facing.y * 2 };
        if (this.pac.dir === 'up') pivot.x -= 2;
        const blinky = this.ghosts[0];
        const bc = this.#colOf(blinky);
        const br = this.#rowOf(blinky);
        return { x: pivot.x * 2 - bc, y: pivot.y * 2 - br };
      }

      case 'clyde': {
        const dist = Math.hypot(this.#colOf(ghost) - pacCol, this.#rowOf(ghost) - pacRow);
        return dist > 8 ? { x: pacCol, y: pacRow } : ghost.corner;
      }

      default:
        return { x: pacCol, y: pacRow };
    }
  }

  /**
   * At every tile centre a ghost picks the exit that gets it closest to its
   * target, never reversing. Frightened ghosts pick at random instead.
   */
  #chooseDirection(ghost, target, { allowDoor = false } = {}) {
    const options = [];
    for (const name of DIR_NAMES) {
      if (name === OPPOSITE[ghost.dir]) continue;
      if (!this.#canEnter(ghost, name, { allowDoor })) continue;
      options.push(name);
    }
    if (!options.length) return OPPOSITE[ghost.dir];

    if (!target) return options[Math.floor(this.random() * options.length)];

    const col = this.#colOf(ghost);
    const row = this.#rowOf(ghost);
    let best = options[0];
    let bestDist = Infinity;
    for (const name of options) {
      const d = DIRS[name];
      const dist = (col + d.x - target.x) ** 2 + (row + d.y - target.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = name;
      }
    }
    return best;
  }

  /* --------------------------------------------------------- collisions */

  #checkCollisions() {
    const pacCol = this.#colOf(this.pac);
    const pacRow = this.#rowOf(this.pac);

    for (const ghost of this.ghosts) {
      if (ghost.state === 'eyes' || ghost.state === 'returning' || ghost.state === 'house') continue;
      if (this.#colOf(ghost) !== pacCol || this.#rowOf(ghost) !== pacRow) continue;

      if (ghost.frightened) {
        this.ghostsEaten++;
        const points = 200 * 2 ** (this.ghostsEaten - 1);
        this.addScore(points, { x: ghost.x, y: ghost.y, color: '#00e5ff', label: String(points) });
        ghost.state = 'eyes';
        ghost.frightened = false;
        this.play('powerup');
        this.shake.add(5);
        this.state = 'eaten';
        this.stateTimer = 0.4;
        this.particles.emit(ghost.x, ghost.y, {
          count: 16, speed: 130, color: '#00e5ff', life: 0.5, size: 3,
        });
      } else {
        this.#loseLife();
      }
      return;
    }
  }

  #loseLife() {
    this.state = 'dying';
    this.stateTimer = 1.6;
    this.play('die');
    this.shake.add(10);
    this.particles.emit(this.pac.x, this.pac.y, {
      count: 26, speed: 150, color: '#ffd23f', life: 0.8, size: 3,
    });
  }

  #afterDeath() {
    const lives = this.lives - 1;
    this.setLives(lives);
    if (lives <= 0) {
      this.meta = { level: this.level };
      this.end();
      return;
    }
    this.#resetActors();
    this.state = 'ready';
    this.stateTimer = 1.6;
    this.banner('Ready');
  }

  /* -------------------------------------------------------------- fruit */

  #spawnFruit() {
    const def = FRUITS[Math.min(this.level - 1, FRUITS.length - 1)];
    this.fruit = { ...def, x: FRUIT_TILE.x * TILE, y: FRUIT_TILE.y * TILE + TILE / 2 };
    this.fruitTimer = 9;
    this.fruitsShown++;
  }

  #updateFruit(dt) {
    if (!this.fruit) return;
    this.fruitTimer -= dt;
    if (this.fruitTimer <= 0) {
      this.fruit = null;
      return;
    }
    if (Math.hypot(this.pac.x - this.fruit.x, this.pac.y - this.fruit.y) < TILE) {
      this.addScore(this.fruit.value, {
        x: this.fruit.x, y: this.fruit.y, color: this.fruit.color, label: String(this.fruit.value),
      });
      this.play('powerup');
      this.particles.emit(this.fruit.x, this.fruit.y, {
        count: 18, speed: 120, color: this.fruit.color, life: 0.6, size: 3,
      });
      this.fruit = null;
    }
  }

  /* ------------------------------------------------------------ movement */

  #colOf(entity) {
    return ((Math.floor(entity.x / TILE) % COLS) + COLS) % COLS;
  }

  #rowOf(entity) {
    return Math.max(0, Math.min(ROWS - 1, Math.floor(entity.y / TILE)));
  }

  #inTunnel(entity) {
    const row = this.#rowOf(entity);
    const col = this.#colOf(entity);
    return row === 14 && (col < 6 || col > 21);
  }

  /** Can this entity step one tile in `dir` from its current tile? */
  #canEnter(entity, dir, { allowDoor = false } = {}) {
    const d = DIRS[dir];
    const col = this.#colOf(entity) + d.x;
    const row = this.#rowOf(entity) + d.y;
    if (this.#isDoor(col, row)) return allowDoor;
    return !this.#isWall(col, row);
  }

  /**
   * Move an entity along its facing direction, stopping at tile centres to
   * make decisions. Splitting the movement at centres keeps turns exact no
   * matter how much distance a frame covers.
   */
  #move(entity, distance, { onCenter, preTurn, allowDoor = false } = {}) {
    const width = COLS * TILE;
    let remaining = distance;
    let guard = 0;

    while (remaining > 0 && guard++ < 8) {
      // Normalise into the board *before* any tile maths. Skipping this is
      // subtle and severe: once x drifts negative in the tunnel, colOf wraps
      // to column 27 while x is still around zero, so the computed distance to
      // the next tile centre becomes the width of the whole maze. The entity
      // then glides clear across the board without a single wall check.
      if (entity.x < 0) entity.x += width;
      else if (entity.x >= width) entity.x -= width;

      // preTurn may flip the direction, so resolve it before reading `dir`.
      if (preTurn?.(entity)) continue;

      const d = DIRS[entity.dir];
      const centerX = (this.#colOf(entity) + 0.5) * TILE;
      const centerY = (this.#rowOf(entity) + 0.5) * TILE;

      // Standing exactly on a centre means the next step covers a whole tile,
      // so the tile ahead has to be legal before we commit to it. Callers also
      // check this from onCenter, but that check happens *after* the move — so
      // anything that changes direction mid-loop would otherwise slip through.
      // This is the invariant that keeps actors inside the maze.
      const onCentre =
        Math.abs(entity.x - centerX) < 0.01 && Math.abs(entity.y - centerY) < 0.01;
      if (onCentre && !this.#canEnter(entity, entity.dir, { allowDoor })) break;

      // Distance until the next tile centre along the current axis.
      let toCentre;
      if (d.x !== 0) {
        const target = d.x > 0 ? centerX + (entity.x >= centerX - 0.001 ? TILE : 0)
                               : centerX - (entity.x <= centerX + 0.001 ? TILE : 0);
        toCentre = Math.abs(target - entity.x);
      } else {
        const target = d.y > 0 ? centerY + (entity.y >= centerY - 0.001 ? TILE : 0)
                               : centerY - (entity.y <= centerY + 0.001 ? TILE : 0);
        toCentre = Math.abs(target - entity.y);
      }

      if (remaining < toCentre) {
        entity.x += d.x * remaining;
        entity.y += d.y * remaining;
        remaining = 0;
      } else {
        entity.x += d.x * toCentre;
        entity.y += d.y * toCentre;
        remaining -= toCentre;

        // Snap exactly onto the centre before deciding.
        entity.x = (this.#colOf(entity) + 0.5) * TILE;
        entity.y = (this.#rowOf(entity) + 0.5) * TILE;

        const mayContinue = onCenter ? onCenter(entity) : true;
        if (!mayContinue) break;
      }
    }

    // And once more on the way out, so the entity is always left on the board.
    if (entity.x < 0) entity.x += width;
    else if (entity.x >= width) entity.x -= width;
  }

  /** Straight-line drift, used inside the ghost house where walls do not apply. */
  #moveToward(entity, tile, distance) {
    const tx = tile.x * TILE;
    const ty = tile.y * TILE + TILE / 2;
    const dx = tx - entity.x;
    const dy = ty - entity.y;

    // Line up horizontally first, then travel vertically through the door.
    if (Math.abs(dx) > 1) {
      const step = Math.min(Math.abs(dx), distance);
      entity.x += Math.sign(dx) * step;
      entity.dir = dx > 0 ? 'right' : 'left';
      return;
    }
    entity.x = tx;
    const step = Math.min(Math.abs(dy), distance);
    entity.y += Math.sign(dy) * step;
    entity.dir = dy > 0 ? 'down' : 'up';
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, '#04060a');
    ctx.save();
    this.shake.apply(ctx);

    this.#drawMaze(ctx);
    this.#drawDots(ctx);
    this.#drawFruit(ctx);
    this.#drawPac(ctx);
    for (const ghost of this.ghosts) this.#drawGhostBody(ctx, ghost);
    this.drawEffects(ctx);

    if (this.state === 'ready') {
      this.text(ctx, 'READY!', this.width / 2, 17 * TILE + TILE / 2, {
        size: 20, color: '#ffd23f', glow: 18,
      });
    }

    ctx.restore();
  }

  #drawMaze(ctx) {
    const flash = this.state === 'cleared' && Math.floor(this.stateTimer * 6) % 2 === 0;
    const color = flash ? '#ffffff' : '#2563eb';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = flash ? '#ffffff' : '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of this.wallEdges) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.restore();

    // The ghost-house door.
    ctx.save();
    ctx.strokeStyle = '#ffb8de';
    ctx.shadowColor = '#ffb8de';
    ctx.shadowBlur = 6;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(13 * TILE, 12 * TILE + TILE / 2);
    ctx.lineTo(15 * TILE, 12 * TILE + TILE / 2);
    ctx.stroke();
    ctx.restore();
  }

  #drawDots(ctx) {
    const pulse = 0.6 + Math.abs(Math.sin(performance.now() / 260)) * 0.4;
    ctx.save();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const dot = this.dots[row][col];
        if (!dot) continue;
        const x = col * TILE + TILE / 2;
        const y = row * TILE + TILE / 2;
        if (dot === 1) {
          ctx.fillStyle = '#ffd8a8';
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        } else {
          ctx.globalAlpha = pulse;
          ctx.shadowColor = '#ffd23f';
          ctx.shadowBlur = 12;
          ctx.fillStyle = '#ffd23f';
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
        }
      }
    }
    ctx.restore();
  }

  #drawFruit(ctx) {
    if (!this.fruit) return;
    const bob = Math.sin(performance.now() / 200) * 2;
    this.glowCircle(ctx, this.fruit.x, this.fruit.y + bob, 6, this.fruit.color, 14);
    ctx.save();
    ctx.strokeStyle = '#39ff88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.fruit.x, this.fruit.y + bob - 5);
    ctx.lineTo(this.fruit.x + 4, this.fruit.y + bob - 10);
    ctx.stroke();
    ctx.restore();
  }

  #drawPac(ctx) {
    if (this.state === 'dying') {
      // The classic death spiral: the mouth opens until he vanishes.
      const t = 1 - this.stateTimer / 1.6;
      const open = Math.min(1, t * 1.4) * Math.PI;
      if (open >= Math.PI) return;
      ctx.save();
      ctx.translate(this.pac.x, this.pac.y);
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, TILE * 0.46, open - Math.PI / 2, -open - Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    const angleOf = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
    const facing = angleOf[this.pac.dir] ?? 0;
    const open = (Math.abs(Math.sin(this.pac.mouth)) * 0.28 + 0.03) * Math.PI;

    ctx.save();
    ctx.translate(this.pac.x, this.pac.y);
    ctx.rotate(facing);
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, TILE * 0.46, open, Math.PI * 2 - open);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  #drawGhostBody(ctx, ghost) {
    const r = TILE * 0.46;
    const x = ghost.x;
    const y = ghost.y;
    const eyesOnly = ghost.state === 'eyes' || ghost.state === 'returning';

    if (!eyesOnly) {
      let color = ghost.color;
      if (ghost.frightened) {
        // Flash white in the last two seconds, as a warning.
        const ending = this.frightenedTimer < 2 && Math.floor(this.frightenedTimer * 6) % 2 === 0;
        color = ending ? '#ffffff' : '#2b6cff';
      }

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.15, r, Math.PI, 0);
      ctx.lineTo(x + r, y + r * 0.72);
      // The skirt, animated so it ripples as they move.
      const wobble = Math.sin(performance.now() / 90) > 0 ? 0 : 1;
      const feet = 4;
      for (let i = 0; i < feet; i++) {
        const segment = (r * 2) / feet;
        const px = x + r - segment * (i + 0.5);
        const up = (i + wobble) % 2 === 0;
        ctx.lineTo(px, y + r * (up ? 0.42 : 0.75));
      }
      ctx.lineTo(x - r, y + r * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Eyes — always drawn, and always looking where the ghost is going.
    const look = DIRS[ghost.dir] ?? DIRS.left;
    const frightenedFace = ghost.frightened && !eyesOnly;

    if (frightenedFace) {
      ctx.fillStyle = '#ffffff';
      for (const dx of [-r * 0.34, r * 0.34]) {
        ctx.fillRect(x + dx - 2, y - r * 0.28, 4, 4);
      }
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const px = x - r * 0.6 + (i * r * 1.2) / 4;
        const py = y + r * 0.28 + (i % 2 === 0 ? 0 : -3);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      return;
    }

    for (const dx of [-r * 0.36, r * 0.36]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x + dx, y - r * 0.22, r * 0.26, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b2436';
      ctx.beginPath();
      ctx.arc(x + dx + look.x * r * 0.12, y - r * 0.22 + look.y * r * 0.14, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
