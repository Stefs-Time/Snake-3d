/**
 * Fixed-timestep game loop with interpolated rendering.
 *
 * Simulation runs in exact 1/60s steps so physics and collision are identical
 * on a 60Hz laptop and a 144Hz monitor. Rendering happens once per animation
 * frame and receives `alpha`, the fraction of the way into the next step, so
 * fast-moving things can be drawn between simulation states instead of
 * stepping visibly.
 */

const STEP = 1 / 60;
const MAX_FRAME = 0.25; // never simulate more than a quarter second at once

export class Loop {
  /**
   * @param {(dt: number) => void} update
   * @param {(alpha: number, dt: number) => void} render
   */
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.paused = false;
    this.accumulator = 0;
    this.last = 0;
    this.frameId = 0;
    /** Wall-clock seconds actually simulated — used for score timing. */
    this.elapsed = 0;
    this.fps = 60;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.accumulator = 0;
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.frameId = requestAnimationFrame(this.#tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    document.removeEventListener('visibilitychange', this.#onVisibility);
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    // Drop the backlog so unpausing does not fast-forward the simulation.
    this.last = performance.now();
    this.accumulator = 0;
  }

  // Arrow fields rather than methods: these are handed to addEventListener and
  // requestAnimationFrame, so they must carry `this` with them. (A private
  // method cannot be reassigned, so binding one in the constructor throws.)
  #onVisibility = () => {
    // Tabbing away should never cost you a life.
    if (document.hidden) this.setPaused(true);
  };

  #tick = (now) => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.#tick);

    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME;
    if (frame > 0) this.fps += ((1 / frame) - this.fps) * 0.05;

    if (this.paused) {
      this.render(1, 0);
      return;
    }

    this.accumulator += frame;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 8) {
      this.update(STEP);
      this.elapsed += STEP;
      this.accumulator -= STEP;
      steps++;
    }

    this.render(this.accumulator / STEP, frame);
  };
}

export { STEP };
