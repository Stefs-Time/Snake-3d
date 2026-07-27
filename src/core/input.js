/**
 * One input surface over four very different ones: keyboard, gamepad, an
 * on-screen d-pad, and raw touch (swipes plus a pointer position).
 *
 * Games ask two kinds of question:
 *   held('left')     — is it down right now (movement)
 *   pressed('left')  — did it go down since the last frame (discrete actions)
 *
 * `pressed` is edge-triggered and cleared by `endFrame()`, which the game loop
 * calls once per tick. That keeps a single keypress from firing twice.
 */

const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'action',
  Enter: 'action',
  ShiftLeft: 'secondary', ShiftRight: 'secondary',
  Escape: 'pause', KeyP: 'pause',
  KeyR: 'restart',
};

/** Keys we swallow so the page never scrolls mid-game. */
const SWALLOW = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);

const GAMEPAD_BUTTONS = {
  0: 'action', 1: 'secondary', 2: 'secondary', 3: 'action',
  9: 'pause', 8: 'restart',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

export class Input {
  /**
   * @param {HTMLElement} surface element that receives touch/pointer events
   * @param {{ scheme?: 'dpad'|'swipe'|'aim'|'none', deadzone?: number }} opts
   */
  constructor(surface, opts = {}) {
    this.surface = surface;
    this.scheme = opts.scheme ?? 'dpad';
    this.deadzone = opts.deadzone ?? 0.4;

    /** @type {Set<string>} actions currently down */
    this.down = new Set();
    /** @type {Set<string>} actions that went down this frame */
    this.edges = new Set();
    /** @type {Set<string>} raw KeyboardEvent.code values currently down */
    this.codes = new Set();
    /** @type {Set<string>} raw codes that went down this frame */
    this.codeEdges = new Set();
    /** @type {Array<'up'|'down'|'left'|'right'>} unconsumed swipes */
    this.swipes = [];

    /**
     * Normalised pointer position over the surface, 0..1, plus edge flags for
     * the frame in which the button went down or came up. The edges are
     * cleared by endFrame, exactly like key presses, so a click is handled
     * once no matter how many simulation steps a frame produces.
     */
    this.pointer = { x: 0.5, y: 0.5, active: false, down: false, pressed: false, released: false };

    this.gamepadIndex = null;
    this.prevPadButtons = new Set();
    this.touchStart = null;
    this.disposers = [];

    this.#bindKeyboard();
    this.#bindPointer();
    this.#bindGamepad();
  }

  /* ------------------------------------------------------------ queries -- */

  held(action) {
    return this.down.has(action);
  }

  pressed(action) {
    return this.edges.has(action);
  }

  key(code) {
    return this.codes.has(code);
  }

  keyPressed(code) {
    return this.codeEdges.has(code);
  }

  /** -1, 0 or 1 along an axis, from whichever device is providing input. */
  axisX() {
    return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
  }

  axisY() {
    return (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
  }

  /** Pop the oldest swipe, or null. */
  takeSwipe() {
    return this.swipes.shift() ?? null;
  }

  /** Direction from any device this frame — arrows, d-pad, or a swipe. */
  takeDirection() {
    for (const dir of ['up', 'down', 'left', 'right']) {
      if (this.pressed(dir)) return dir;
    }
    return this.takeSwipe();
  }

  /* -------------------------------------------------------------- frame -- */

  /** Poll devices that have no events. Call at the top of each tick. */
  beginFrame() {
    this.#pollGamepad();
  }

  /** Clear edge state. Call at the bottom of each tick. */
  endFrame() {
    this.edges.clear();
    this.codeEdges.clear();
    this.pointer.pressed = false;
    this.pointer.released = false;
  }

  /**
   * Drop everything, edges and held keys alike. Whenever the loop is stopped
   * the tick that would have consumed an edge never runs, so the press stays
   * latched and fires the instant play resumes — closing an overlay with Esc
   * would immediately pause the game it just resumed. The host calls this
   * every time it hands control back.
   */
  reset() {
    this.endFrame();
    this.down.clear();
    this.codes.clear();
  }

  /* ------------------------------------------------------------ sources -- */

  #press(action) {
    if (!this.down.has(action)) this.edges.add(action);
    this.down.add(action);
  }

  #release(action) {
    this.down.delete(action);
  }

  #bindKeyboard() {
    const onDown = (e) => {
      if (e.repeat) {
        if (SWALLOW.has(e.code)) e.preventDefault();
        return;
      }
      // Never steal keys while the player is typing their initials.
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (SWALLOW.has(e.code)) e.preventDefault();
      this.codes.add(e.code);
      this.codeEdges.add(e.code);
      const action = KEY_MAP[e.code];
      if (action) this.#press(action);
    };

    const onUp = (e) => {
      this.codes.delete(e.code);
      const action = KEY_MAP[e.code];
      if (action) this.#release(action);
    };

    // A lost window means every key is up — otherwise you come back sprinting.
    const onBlur = () => {
      this.down.clear();
      this.codes.clear();
    };

    window.addEventListener('keydown', onDown, { passive: false });
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    this.disposers.push(() => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  #bindPointer() {
    const el = this.surface;
    if (!el) return;

    const norm = (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.pointer.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      this.pointer.active = true;
    };

    const onMove = (e) => norm(e);

    const onDown = (e) => {
      norm(e);
      this.pointer.down = true;
      this.pointer.pressed = true;
      this.touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.scheme === 'aim' || this.scheme === 'swipe' || this.scheme === 'point') {
        this.#press('action');
      }
    };

    const onUp = (e) => {
      const wasDown = this.pointer.down;
      this.pointer.down = false;
      if (wasDown) this.pointer.released = true;
      if (this.scheme === 'aim' || this.scheme === 'swipe' || this.scheme === 'point') {
        this.#release('action');
      }

      const start = this.touchStart;
      this.touchStart = null;
      if (!start) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dist = Math.hypot(dx, dy);
      const elapsed = performance.now() - start.t;
      if (dist < 26 || elapsed > 700) return;

      this.swipes.push(
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up',
      );
      if (this.swipes.length > 4) this.swipes.shift();
    };

    const onLeave = () => {
      this.pointer.active = false;
      this.pointer.down = false;
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    this.disposers.push(() => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    });
  }

  #bindGamepad() {
    const onConnect = (e) => {
      this.gamepadIndex = e.gamepad.index;
    };
    const onDisconnect = () => {
      this.gamepadIndex = null;
    };
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    this.disposers.push(() => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    });
  }

  #pollGamepad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : [...pads].find(Boolean);
    if (!pad) return;

    const nowDown = new Set();

    pad.buttons.forEach((btn, i) => {
      if (!btn.pressed) return;
      const action = GAMEPAD_BUTTONS[i];
      if (action) nowDown.add(action);
    });

    const [ax, ay] = pad.axes;
    if (ax < -this.deadzone) nowDown.add('left');
    if (ax > this.deadzone) nowDown.add('right');
    if (ay < -this.deadzone) nowDown.add('up');
    if (ay > this.deadzone) nowDown.add('down');

    for (const action of nowDown) {
      if (!this.prevPadButtons.has(action)) this.#press(action);
      else this.down.add(action);
    }
    for (const action of this.prevPadButtons) {
      // Only release if the keyboard is not also holding it.
      if (!nowDown.has(action)) this.#release(action);
    }
    this.prevPadButtons = nowDown;
  }

  /* ---------------------------------------------------- virtual buttons -- */

  /** Wire an on-screen button to an action. Returns a disposer. */
  bindButton(el, action) {
    const press = (e) => {
      e.preventDefault();
      el.classList.add('is-down');
      this.#press(action);
    };
    const release = () => {
      el.classList.remove('is-down');
      this.#release(action);
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
    const dispose = () => {
      el.removeEventListener('pointerdown', press);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointerleave', release);
      el.removeEventListener('pointercancel', release);
    };
    this.disposers.push(dispose);
    return dispose;
  }

  destroy() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.down.clear();
    this.codes.clear();
  }
}
