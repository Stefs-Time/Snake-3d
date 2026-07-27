import * as THREE from 'three';
import { BaseGame } from '../core/game.js';

/**
 * SNAKE 3D
 *
 * The rules are the ones you already know — the interesting part is the camera.
 * It rides behind the head, banks into turns, and pulls back as you grow, which
 * means "left" stops meaning a fixed world axis. So steering is interpreted
 * relative to the camera: press left and the snake turns left *from where you
 * are sitting*, whichever way it happens to be pointing.
 *
 * The body is one InstancedMesh, so a 200-segment snake is still a single draw
 * call, and positions are interpolated between simulation steps so movement
 * reads as smooth gliding rather than a grid shuffle.
 */

const GRID = 15; // cells per side
const CELL = 1; // world units per cell
const MAX_SEGMENTS = 400;

const DIRECTIONS = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

export default class Snake3D extends BaseGame {
  static id = 'snake3d';
  static width = 16;
  static height = 10;
  static renderer = 'webgl';
  static touch = 'dpad';
  static smooth = true;
  static hudLabels = { score: 'Score', secondary: 'Length' };

  setup() {
    this.host.setSecondaryLabel('Length');
    this.host.setHint('Steering is relative to the camera');

    this.#buildScene();
    this.#reset();

    this.banner('Ready');
    this.play('ready');
  }

  /* ================================================================ scene */

  #buildScene() {
    const canvas = this.canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x04060a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x04060a, 18, 46);

    this.camera = new THREE.PerspectiveCamera(58, 16 / 10, 0.1, 200);
    this.camera.position.set(0, 14, 16);
    this.cameraTarget = new THREE.Vector3();
    this.camYaw = 0;

    const half = (GRID * CELL) / 2;
    this.half = half;

    /* --- lighting: a cool ambient wash plus a warm key from above --- */
    this.scene.add(new THREE.AmbientLight(0x4466aa, 1.1));

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 18, 8);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff2e88, 0.5);
    rim.position.set(-10, 6, -12);
    this.scene.add(rim);

    // Travels with the head so the snake lights the floor beneath it.
    this.headLight = new THREE.PointLight(0x39ff88, 22, 12, 2);
    this.scene.add(this.headLight);

    this.foodLight = new THREE.PointLight(0xffd23f, 14, 9, 2);
    this.scene.add(this.foodLight);

    /* --- floor --- */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID * CELL, GRID * CELL),
      new THREE.MeshStandardMaterial({
        color: 0x080b12,
        roughness: 0.72,
        metalness: 0.35,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5;
    this.scene.add(floor);

    // Grid lines, drawn as one LineSegments so the whole floor is one draw call.
    const points = [];
    for (let i = 0; i <= GRID; i++) {
      const p = -half + i * CELL;
      points.push(p, -0.49, -half, p, -0.49, half);
      points.push(-half, -0.49, p, half, -0.49, p);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.scene.add(
      new THREE.LineSegments(
        gridGeo,
        new THREE.LineBasicMaterial({ color: 0x1b4a68, transparent: true, opacity: 0.55 }),
      ),
    );

    /* --- the neon rails that will kill you --- */
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      emissive: 0x00e5ff,
      emissiveIntensity: 1.5,
      roughness: 0.35,
      metalness: 0.6,
    });
    this.railMat = railMat;

    const railGeo = new THREE.BoxGeometry(GRID * CELL + 0.6, 0.5, 0.3);
    for (const [rx, rz, rot] of [
      [0, -half - 0.15, 0],
      [0, half + 0.15, 0],
      [-half - 0.15, 0, Math.PI / 2],
      [half + 0.15, 0, Math.PI / 2],
    ]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(rx, -0.25, rz);
      rail.rotation.y = rot;
      this.scene.add(rail);
    }

    /* --- the snake body, one instanced mesh --- */
    const segGeo = new THREE.BoxGeometry(CELL * 0.82, CELL * 0.82, CELL * 0.82);
    // The base colour is white so the per-instance tint below actually shows;
    // the emissive is kept low enough that it glows without washing out the
    // head-to-tail gradient.
    this.segmentMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x39ff88,
      emissiveIntensity: 0.45,
      roughness: 0.34,
      metalness: 0.3,
    });
    this.body = new THREE.InstancedMesh(segGeo, this.segmentMaterial, MAX_SEGMENTS);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.count = 0;
    this.body.frustumCulled = false;
    this.scene.add(this.body);

    // Per-instance colour so the head reads brighter than the tail.
    this.body.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_SEGMENTS * 3),
      3,
    );
    this.body.instanceColor.setUsage(THREE.DynamicDrawUsage);

    /* --- the food --- */
    this.food = new THREE.Mesh(
      new THREE.OctahedronGeometry(CELL * 0.36, 0),
      new THREE.MeshStandardMaterial({
        color: 0x2a2410,
        emissive: 0xffd23f,
        emissiveIntensity: 1.6,
        roughness: 0.2,
        metalness: 0.5,
      }),
    );
    this.scene.add(this.food);

    /* --- a pool of debris cubes for the eat/death bursts --- */
    const debrisGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    this.debrisMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveIntensity: 1.8,
    });
    this.debris = new THREE.InstancedMesh(debrisGeo, this.debrisMat, 120);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.scene.add(this.debris);
    this.debrisPool = Array.from({ length: 120 }, () => ({
      life: 0,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      rot: new THREE.Euler(),
    }));

    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.scratchA = new THREE.Vector3();
    this.scratchB = new THREE.Vector3();
    this.scratchC = new THREE.Vector3();

    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 500, Math.min(2, devicePixelRatio || 1));
  }

  /* ================================================================ state */

  #reset() {
    const mid = Math.floor(GRID / 2);
    this.cells = [
      { x: mid, z: mid },
      { x: mid, z: mid + 1 },
      { x: mid, z: mid + 2 },
    ];
    this.prevCells = this.cells.map((c) => ({ ...c }));
    this.direction = 'north';
    this.queuedDirection = null;
    this.pendingGrowth = 0;

    this.stepInterval = 0.19;
    this.stepTimer = 0;
    this.deathTimer = 0;
    this.dying = false;
    // A moment to get your bearings before the snake starts moving — without
    // it you have about a second from spawn to the far wall, which is a
    // cheap way to lose a run you never really started.
    this.readyTimer = 1.4;

    this.setLives(1);
    this.host.setSecondary(this.cells.length);

    this.#placeFood();

    // Start the camera already behind the snake rather than swinging in.
    this.camYaw = Math.atan2(-DIRECTIONS[this.direction].x, -DIRECTIONS[this.direction].z);
    this.camera.position.copy(this.#desiredCameraPosition());
  }

  #placeFood() {
    const occupied = new Set(this.cells.map((c) => `${c.x},${c.z}`));
    const free = [];
    for (let x = 0; x < GRID; x++) {
      for (let z = 0; z < GRID; z++) {
        if (!occupied.has(`${x},${z}`)) free.push({ x, z });
      }
    }
    if (!free.length) {
      // Filling the entire arena is a win; treat it as the run ending well.
      this.end();
      return;
    }
    this.foodCell = free[Math.floor(this.random() * free.length)];
  }

  /* ============================================================== helpers */

  /** Grid cell -> world position, written into `out` to avoid allocating. */
  #worldOf(cell, y = 0, out = new THREE.Vector3()) {
    return out.set(
      -this.half + (cell.x + 0.5) * CELL,
      y,
      -this.half + (cell.z + 0.5) * CELL,
    );
  }

  /**
   * Turn a d-pad press into a compass direction, rotated into the camera's
   * frame so "left" always means left on screen.
   *
   * The camera sits at head + (sin y, _, cos y) looking inward, so its forward
   * vector on the floor plane is F = (-sin y, -cos y) and its right is
   * R = (cos y, -sin y). We combine those by the stick input and snap the
   * result to whichever grid axis dominates.
   */
  #resolveInput() {
    const input = this.input;

    // Prefer the key-down edge so a quick tap is never dropped between frames,
    // then fall back to the held state for a thumb parked on the d-pad.
    let ix = (input.pressed('right') ? 1 : 0) - (input.pressed('left') ? 1 : 0);
    let iy = (input.pressed('down') ? 1 : 0) - (input.pressed('up') ? 1 : 0);

    if (!ix && !iy) {
      const swipe = input.takeSwipe();
      if (swipe) {
        ix = (swipe === 'right' ? 1 : 0) - (swipe === 'left' ? 1 : 0);
        iy = (swipe === 'down' ? 1 : 0) - (swipe === 'up' ? 1 : 0);
      }
    }
    if (!ix && !iy) {
      ix = input.axisX();
      iy = input.axisY(); // +1 is "down" on screen
    }
    if (!ix && !iy) return null;

    const yaw = this.camYaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    const worldX = ix * cos + iy * sin;
    const worldZ = -ix * sin + iy * cos;

    if (Math.abs(worldX) > Math.abs(worldZ)) return worldX > 0 ? 'east' : 'west';
    return worldZ > 0 ? 'south' : 'north';
  }

  /* =============================================================== update */

  update(dt) {
    this.updateEffects(dt);
    this.#updateDebris(dt);

    if (this.dying) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.end();
      this.#updateCamera(dt, 1);
      return;
    }

    const requested = this.#resolveInput();
    if (requested && requested !== OPPOSITE[this.direction] && requested !== this.direction) {
      this.queuedDirection = requested;
    }

    if (this.readyTimer > 0) {
      this.readyTimer -= dt;
      // Steering still registers during the countdown, so you can set off in
      // whichever direction you like the moment it ends.
      if (this.queuedDirection) {
        this.direction = this.queuedDirection;
        this.queuedDirection = null;
      }
      this.#updateCamera(dt, 0);
      return;
    }

    this.stepTimer += dt;
    while (this.stepTimer >= this.stepInterval) {
      this.stepTimer -= this.stepInterval;
      this.#step();
      if (this.dying) break;
    }

    this.#updateCamera(dt, this.stepTimer / this.stepInterval);
  }

  #step() {
    if (this.queuedDirection) {
      this.direction = this.queuedDirection;
      this.queuedDirection = null;
    }

    const delta = DIRECTIONS[this.direction];
    const head = this.cells[0];
    const next = { x: head.x + delta.x, z: head.z + delta.z };

    // Walls.
    if (next.x < 0 || next.x >= GRID || next.z < 0 || next.z >= GRID) {
      this.#die(next);
      return;
    }

    // Self. The tail cell is about to move away, so it is only fatal while
    // the snake is growing into it.
    const ignoreTail = this.pendingGrowth === 0;
    for (let i = 0; i < this.cells.length - (ignoreTail ? 1 : 0); i++) {
      if (this.cells[i].x === next.x && this.cells[i].z === next.z) {
        this.#die(next);
        return;
      }
    }

    this.prevCells = this.cells.map((c) => ({ ...c }));

    this.cells.unshift(next);
    if (this.pendingGrowth > 0) {
      this.pendingGrowth--;
      // Growing: the new tail segment starts where the old tail was.
      this.prevCells.push({ ...this.prevCells[this.prevCells.length - 1] });
    } else {
      this.cells.pop();
    }

    if (this.foodCell && next.x === this.foodCell.x && next.z === this.foodCell.z) {
      this.#eat(next);
    }
  }

  #eat(cell) {
    this.pendingGrowth += 2;

    const length = this.cells.length + this.pendingGrowth;
    const speedBonus = Math.round((0.2 - this.stepInterval) * 200);
    this.addScore(10 + Math.max(0, speedBonus));
    this.host.setSecondary(length);
    this.meta = { length };

    // The snake speeds up as it grows, down to a floor that stays playable.
    this.stepInterval = Math.max(0.075, 0.19 - length * 0.0032);
    const level = Math.min(9, 1 + Math.floor((0.19 - this.stepInterval) / 0.014));
    if (level !== this.level) {
      this.level = level;
      this.banner(`Speed ${level}`);
      this.play('levelup');
    } else {
      this.play('eat');
    }

    this.#burst(this.#worldOf(cell, 0), 0xffd23f, 14, 3.2);
    this.#placeFood();
  }

  #die(cell) {
    if (this.dying) return;
    this.dying = true;
    this.deathTimer = 1.15;
    this.meta = { length: this.cells.length };
    this.play('die');

    const at = this.#worldOf(
      { x: Math.max(0, Math.min(GRID - 1, cell.x)), z: Math.max(0, Math.min(GRID - 1, cell.z)) },
      0,
    );
    this.#burst(at, 0xff2e88, 40, 6);
    this.railMat.emissive.setHex(0xff2e88);
    this.segmentMaterial.emissive.setHex(0xff2e88);
  }

  /* ============================================================== effects */

  #burst(position, color, count, speed) {
    let spawned = 0;
    for (const p of this.debrisPool) {
      if (spawned >= count) break;
      if (p.life > 0) continue;
      p.life = p.maxLife = 0.5 + this.random() * 0.6;
      p.pos.copy(position);
      p.vel.set(
        (this.random() - 0.5) * speed,
        this.random() * speed * 0.8 + 1,
        (this.random() - 0.5) * speed,
      );
      p.spin.set(this.random() * 8, this.random() * 8, this.random() * 8);
      p.rot.set(0, 0, 0);
      p.color = color;
      spawned++;
    }
    this.debrisMat.emissive.setHex(color);
  }

  #updateDebris(dt) {
    let count = 0;
    for (const p of this.debrisPool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < -0.4) {
        p.pos.y = -0.4;
        p.vel.y *= -0.45;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;

      const scale = Math.max(0.01, p.life / p.maxLife);
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.copy(p.rot);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.debris.setMatrixAt(count, this.dummy.matrix);
      count++;
    }
    this.debris.count = count;
    if (count) this.debris.instanceMatrix.needsUpdate = true;
  }

  /* =============================================================== camera */

  #desiredCameraPosition() {
    const head = this.#worldOf(this.cells[0], 0);
    // Pull back and climb as the snake gets longer, so the arena stays legible.
    const growth = Math.min(1, this.cells.length / 45);
    const distance = 8.5 + growth * 6;
    const height = 8 + growth * 5.5;
    return new THREE.Vector3(
      head.x + Math.sin(this.camYaw) * distance,
      height,
      head.z + Math.cos(this.camYaw) * distance,
    );
  }

  #updateCamera(dt, alpha) {
    const delta = DIRECTIONS[this.direction];
    const targetYaw = Math.atan2(-delta.x, -delta.z);

    // Shortest-path yaw interpolation, so a left turn never spins the long way.
    let diff = targetYaw - this.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.camYaw += diff * Math.min(1, dt * 3.4);

    const desired = this.#desiredCameraPosition();
    this.camera.position.lerp(desired, Math.min(1, dt * 4.5));

    const head = this.#interpolatedSegment(0, alpha, this.scratchC);
    head.y += 0.6;
    this.cameraTarget.lerp(head, Math.min(1, dt * 6));
    this.camera.lookAt(this.cameraTarget);

    if (this.dying) {
      const shake = this.deathTimer * 0.35;
      this.camera.position.x += (this.random() - 0.5) * shake;
      this.camera.position.y += (this.random() - 0.5) * shake;
    }
  }

  /**
   * World position of segment `i`, interpolated between simulation steps.
   * Writes into a scratch vector — copy it if you need to keep the value.
   */
  #interpolatedSegment(i, alpha, out = this.scratchA) {
    const current = this.cells[i];
    const previous = this.prevCells[i] ?? current;
    this.#worldOf(previous, 0, out);
    this.#worldOf(current, 0, this.scratchB);
    return out.lerp(this.scratchB, alpha);
  }

  /* ================================================================= draw */

  draw(_ctx, alpha) {
    const t = performance.now() / 1000;
    const blend = this.dying ? 1 : alpha;

    /* --- body --- */
    const count = Math.min(this.cells.length, MAX_SEGMENTS);
    for (let i = 0; i < count; i++) {
      const pos = this.#interpolatedSegment(i, blend);
      // A gentle taper and a bob that runs down the length like a wave.
      const taper = 1 - Math.min(0.34, (i / Math.max(12, this.cells.length)) * 0.34);
      const wave = Math.sin(t * 6 - i * 0.45) * 0.035;

      this.dummy.position.set(pos.x, pos.y + wave, pos.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(taper * (i === 0 ? 1.08 : 1));
      this.dummy.updateMatrix();
      this.body.setMatrixAt(i, this.dummy.matrix);

      // Head reads near-white, fading to deep green down the tail.
      const heat = i === 0 ? 1 : Math.max(0.22, 1 - i * 0.05);
      this.tmpColor.setRGB(heat * heat * 0.85, heat, heat * 0.62);
      this.tmpColor.toArray(this.body.instanceColor.array, i * 3);
    }
    this.body.count = count;
    this.body.instanceMatrix.needsUpdate = true;
    this.body.instanceColor.needsUpdate = true;

    /* --- head light rides the head --- */
    const head = this.#interpolatedSegment(0, blend, this.scratchC);
    this.headLight.position.set(head.x, head.y + 1.6, head.z);
    this.headLight.intensity = this.dying ? 6 : 22;

    /* --- food --- */
    if (this.foodCell) {
      const fp = this.#worldOf(this.foodCell, 0, this.scratchA);
      this.food.visible = true;
      this.food.position.set(fp.x, fp.y + 0.18 + Math.sin(t * 3) * 0.16, fp.z);
      this.food.rotation.y = t * 1.6;
      this.food.rotation.x = t * 0.9;
      const pulse = 1 + Math.sin(t * 6) * 0.08;
      this.food.scale.setScalar(pulse);
      this.foodLight.position.set(fp.x, fp.y + 1.2, fp.z);
      this.foodLight.intensity = 10 + Math.sin(t * 6) * 4;
    } else {
      this.food.visible = false;
      this.foodLight.intensity = 0;
    }

    /* --- rails breathe with the music of the run --- */
    if (!this.dying) {
      this.railMat.emissiveIntensity = 1.2 + Math.sin(t * 2) * 0.3;
    } else {
      this.railMat.emissiveIntensity = 2 + Math.sin(t * 30) * 1.2;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /* =============================================================== resize */

  resize(width, height, dpr) {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /* ============================================================= teardown */

  teardown() {
    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
      else object.material?.dispose?.();
    });
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.scene = null;
    this.renderer = null;
  }
}
