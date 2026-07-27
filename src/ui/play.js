import { h, fill, fmt } from '../core/dom.js';
import { getGame } from '../../shared/catalog.js';
import { Loop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { sfx } from '../core/audio.js';
import { api } from '../core/api.js';
import { router } from '../core/router.js';
import { loadGame } from '../games/index.js';
import { setAccent } from './shell.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

/** The live host, so the router can tear it down on navigation. */
let active = null;

export function renderPlay(params) {
  destroyPlay();
  const def = getGame(params.id);
  if (!def) {
    return h(
      'div.view__scroll.scroller',
      h('div.board__empty', h('strong', 'No such cabinet'), h('p', 'That game is not in the arcade.'),
        h('a.btn.btn--sm', { href: '/' }, 'Back to the arcade')),
    );
  }

  const host = new PlayHost(def);
  active = host;
  return host.root;
}

export function destroyPlay() {
  active?.destroy();
  active = null;
}

/* ============================================================== the host == */

export class PlayHost {
  constructor(def) {
    this.def = def;
    this.game = null;
    this.loop = null;
    this.input = null;
    this.paused = false;
    this.finished = false;
    this.startedAt = 0;

    setAccent(def.accent, def.accent2);
    document.body.classList.toggle('is-touch', isTouchDevice());

    this.#buildDom();
    this.#loadGame();
  }

  /* ------------------------------------------------------------------ dom */

  #buildDom() {
    const def = this.def;

    this.canvas = h('canvas', { 'aria-label': `${def.title} playfield` });
    this.hudScore = h('div.hud__value', '0');
    this.hudSecondary = h('div.hud__value', '1');
    this.hudSecondaryLabel = h('div.hud__label', 'Level');
    this.hudLives = h('div.hud__lives');
    this.hudBanner = h('div.hud__banner');
    this.hudHint = h('div.hud__hint', def.controls[0]);

    this.hud = h(
      'div.hud',
      h(
        'div.hud__top',
        h('div.hud__stat', h('div.hud__label', def.scoreLabel), this.hudScore),
        h('div.hud__stat.hud__stat--right', this.hudSecondaryLabel, this.hudSecondary, this.hudLives),
      ),
      this.hudBanner,
      h('div.hud__bottom', this.hudHint, h('div.hud__hint', h('span', { ref: (n) => (this.fpsEl = n) }, ''))),
    );

    this.touchLayer = this.#buildTouchControls();
    this.overlayHost = h('div', { style: { display: 'contents' } });

    this.frame = h(
      'div.cabinet__frame',
      this.canvas,
      this.hud,
      this.touchLayer,
      h('div.cabinet__glare'),
      this.overlayHost,
    );

    this.cabinet = h('div.cabinet', this.frame);
    this.screen = h('div.play__screen', this.cabinet);

    this.root = h(
      'div.play',
      h(
        'div.play__bar',
        h('a.play__back', { href: '/', onclick: () => sfx.play('back') }, icon('back', { size: 13 }), 'Arcade'),
        h('div.play__ident', h('h1', def.title), h('span', `${def.codename} · ${def.year}`)),
        h(
          'div.play__bar-tools',
          h('button.icon-btn', {
            type: 'button', 'aria-label': 'Pause', title: 'Pause (P)',
            onclick: () => this.togglePause(),
          }, icon('pause', { size: 18 })),
          h('button.icon-btn', {
            type: 'button', 'aria-label': 'Restart', title: 'Restart (R)',
            onclick: () => this.restart(),
          }, icon('restart', { size: 18 })),
          h('button.icon-btn', {
            type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen',
            onclick: () => this.#toggleFullscreen(),
          }, icon('expand', { size: 18 })),
        ),
      ),
      this.screen,
    );

    this.resizeObserver = new ResizeObserver(() => this.#fit());
    this.resizeObserver.observe(this.screen);
  }

  #buildTouchControls() {
    const key = (dir, iconName) =>
      h('button.touch__key', { type: 'button', dataset: { dir }, 'aria-label': dir }, icon(iconName, { size: 16 }));

    this.touchKeys = {
      up: key('up', 'arrowUp'),
      down: key('down', 'arrowDown'),
      left: key('left', 'arrowLeft'),
      right: key('right', 'arrowRight'),
    };

    this.touchAction = h('button.touch__action', { type: 'button', 'aria-label': 'Action' }, 'A');
    this.touchSecondary = h('button.touch__action.touch__action--secondary', { type: 'button', 'aria-label': 'Secondary' }, 'B');

    return h(
      'div.touch',
      { dataset: { scheme: 'dpad' } },
      h('div.touch__pad', ...Object.values(this.touchKeys)),
      this.touchAction,
      this.touchSecondary,
    );
  }

  /* --------------------------------------------------------------- loading */

  async #loadGame() {
    this.#showOverlay(loadingOverlay(this.def));

    let GameClass;
    try {
      GameClass = await loadGame(this.def.id);
    } catch (err) {
      console.error(err);
      this.#showOverlay(
        errorOverlay('This cabinet failed to load.', () => router.go('/')),
      );
      return;
    }

    // The player may have navigated away while the chunk downloaded.
    if (active !== this) return;

    this.GameClass = GameClass;
    this.#start();
  }

  #start() {
    const GameClass = this.GameClass;
    this.finished = false;
    this.paused = false;
    this.#clearOverlay();

    this.canvas.classList.toggle('smooth', GameClass.smooth !== false);
    this.touchLayer.dataset.scheme = GameClass.touch ?? 'dpad';

    // A fresh Input per run so no key is stuck down from the last one.
    this.input?.destroy();
    this.input = new Input(this.frame, { scheme: GameClass.touch ?? 'dpad' });
    for (const [dir, el] of Object.entries(this.touchKeys)) this.input.bindButton(el, dir);
    this.input.bindButton(this.touchAction, 'action');
    this.input.bindButton(this.touchSecondary, 'secondary');

    this.ctx = GameClass.renderer === 'webgl' ? null : this.canvas.getContext('2d', { alpha: false });

    this.#fit();

    this.game = new GameClass(this);
    this.setScore(0);
    this.setSecondary(1);
    this.setLives(this.game.lives);
    this.hudSecondaryLabel.textContent = GameClass.hudLabels?.secondary ?? 'Level';

    this.game.setup();

    this.loop?.stop();
    this.loop = new Loop(
      (dt) => this.#update(dt),
      (alpha, frameDt) => this.#render(alpha, frameDt),
    );
    this.startedAt = performance.now();
    this.loop.start();

    sfx.unlock();
    settings.set('credits', settings.get('credits'));
    api.recordPlay(this.def.id);
  }

  /* ------------------------------------------------------------ loop hooks */

  #update(dt) {
    const input = this.input;
    input.beginFrame();

    if (input.pressed('pause') && !this.finished) {
      this.togglePause();
      input.endFrame();
      return;
    }
    if (input.pressed('restart') && !this.finished) {
      input.endFrame();
      this.restart();
      return;
    }

    if (!this.paused && !this.finished) this.game.update(dt);
    input.endFrame();
  }

  #render(alpha, frameDt) {
    if (this.ctx) {
      const dpr = this.dpr ?? 1;
      const GameClass = this.GameClass;
      const pad = GameClass.hudPad ?? { top: 0, bottom: 0 };

      this.ctx.save();
      // Wipe the whole canvas, bands included, so glow bleeding past the
      // playfield edge cannot accumulate in the letterbox.
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.fillStyle = '#04060a';
      this.ctx.fillRect(0, 0, GameClass.width, GameClass.pixelHeight);
      // Shift the origin so the game still draws from (0, 0).
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, pad.top * dpr);
      this.game.draw(this.ctx, alpha);
      this.ctx.restore();
    } else {
      this.game.draw(null, alpha);
    }

    if (this.fpsEl && frameDt) {
      this.fpsFrames = (this.fpsFrames ?? 0) + 1;
      if (this.fpsFrames % 30 === 0) {
        this.fpsEl.textContent = `${Math.round(this.loop.fps)} FPS`;
      }
    }
  }

  /* ------------------------------------------------------------- sizing */

  #fit() {
    const GameClass = this.GameClass;
    if (!GameClass) return;

    // Measure the inner box, not the padded screen — otherwise the cabinet is
    // sized to include the padding and overflows the viewport.
    const rect = this.cabinet.getBoundingClientRect();
    const aspect = GameClass.width / GameClass.pixelHeight;
    let w = rect.width;
    let h2 = rect.height;

    if (w / h2 > aspect) w = h2 * aspect;
    else h2 = w / aspect;

    w = Math.max(160, Math.floor(w));
    h2 = Math.max(120, Math.floor(h2));

    this.frame.style.width = `${w}px`;
    this.frame.style.height = `${h2}px`;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;

    if (GameClass.renderer === 'webgl') {
      // Three.js owns the drawing buffer; it just needs the CSS box.
      this.game?.resize?.(w, h2, dpr);
    } else {
      this.canvas.width = Math.round(GameClass.width * dpr);
      this.canvas.height = Math.round(GameClass.pixelHeight * dpr);
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = GameClass.smooth !== false;
      }
    }
  }

  /* ---------------------------------------------------------- hud surface */

  setScore(value) {
    this.hudScore.textContent = fmt(value);
    bump(this.hudScore);
  }

  setSecondary(value) {
    this.hudSecondary.textContent = typeof value === 'number' ? fmt(value) : String(value);
    bump(this.hudSecondary);
  }

  setSecondaryLabel(label) {
    this.hudSecondaryLabel.textContent = label;
  }

  setLives(count) {
    const total = Math.max(count, 3);
    fill(
      this.hudLives,
      ...Array.from({ length: total }, (_, i) =>
        h(`div.hud__life${i < count ? '' : '.is-spent'}`),
      ),
    );
  }

  setHint(text) {
    this.hudHint.textContent = text;
  }

  banner(text) {
    this.hudBanner.textContent = text;
    this.hudBanner.classList.remove('is-shown');
    void this.hudBanner.offsetWidth; // restart the animation
    this.hudBanner.classList.add('is-shown');
  }

  /* -------------------------------------------------------- run lifecycle */

  togglePause() {
    if (this.finished || !this.loop) return;
    this.paused = !this.paused;
    this.loop.setPaused(this.paused);
    if (this.paused) {
      sfx.play('back');
      this.#showOverlay(this.#pauseOverlay());
    } else {
      sfx.play('select');
      this.#clearOverlay();
    }
  }

  restart() {
    if (!this.GameClass) return;
    this.game?.teardown();
    this.loop?.stop();
    sfx.play('coin');
    this.#start();
  }

  /** Called by the game when the run is over. */
  endRun({ score, meta }) {
    if (this.finished) return;
    this.finished = true;
    this.loop.setPaused(true);

    const duration = Math.round((performance.now() - this.startedAt) / 1000);
    const isLocalBest = settings.recordRun(this.def.id, score);

    sfx.play(isLocalBest && score > 0 ? 'highscore' : 'gameover');
    this.#showOverlay(this.#gameOverOverlay({ score, meta, duration, isLocalBest }));
  }

  /* ------------------------------------------------------------- overlays */

  #showOverlay(node) {
    fill(this.overlayHost, node);
  }

  #clearOverlay() {
    fill(this.overlayHost);
  }

  #pauseOverlay() {
    return h(
      'div.overlay',
      h(
        'div.overlay__panel',
        h('div.overlay__eyebrow', 'Paused'),
        h('div.overlay__title', this.def.title),
        h(
          'div.overlay__meta',
          h('div', h('b', fmt(this.game?.score ?? 0)), h('span', this.def.scoreLabel)),
          h('div', h('b', fmt(this.game?.level ?? 1)), h('span', 'Level')),
        ),
        h(
          'div.overlay__actions',
          h('button.btn.btn--primary', { type: 'button', onclick: () => this.togglePause() },
            icon('play', { size: 14, fill: true }), 'Resume'),
          h('button.btn', { type: 'button', onclick: () => this.restart() },
            icon('restart', { size: 14 }), 'Restart'),
          h('a.btn.btn--ghost', { href: '/' }, 'Quit'),
        ),
        h('div.overlay__hint', 'Press P or Esc to resume'),
      ),
    );
  }

  #gameOverOverlay({ score, meta, duration, isLocalBest }) {
    const def = this.def;
    const qualifies = score > 0;
    const initialsEl = qualifies ? this.#initialsEntry({ score, meta, duration }) : null;

    const metaRow = h('div.overlay__meta');
    metaRow.append(h('div', h('b', fmt(settings.bestFor(def.id))), h('span', 'Your best')));
    if (meta?.level) metaRow.append(h('div', h('b', fmt(meta.level)), h('span', 'Level')));
    if (meta?.wave) metaRow.append(h('div', h('b', fmt(meta.wave)), h('span', 'Wave')));
    if (meta?.lines) metaRow.append(h('div', h('b', fmt(meta.lines)), h('span', 'Lines')));
    if (meta?.length) metaRow.append(h('div', h('b', fmt(meta.length)), h('span', 'Length')));
    metaRow.append(h('div', h('b', `${duration}s`), h('span', 'Duration')));

    return h(
      'div.overlay',
      h(
        'div.overlay__panel',
        h('div.overlay__eyebrow', isLocalBest && score > 0 ? 'New personal best' : 'Game over'),
        h('div.overlay__title', isLocalBest && score > 0 ? 'Record!' : 'Game Over'),
        h('div.overlay__score', fmt(score)),
        h('div.overlay__score-label', def.scoreLabel),
        metaRow,
        initialsEl,
        h(
          'div.overlay__actions',
          h('button.btn.btn--primary', { type: 'button', onclick: () => this.restart() },
            icon('restart', { size: 14 }), 'Play again'),
          h('a.btn', { href: `/scores/${def.id}` }, icon('trophy', { size: 14 }), 'Scores'),
          h('a.btn.btn--ghost', { href: '/' }, 'Arcade'),
        ),
        h('div.overlay__hint', 'Press R to play again'),
      ),
    );
  }

  /**
   * Three-slot initials entry, driven by the keyboard on desktop and a hidden
   * input on touch so the on-screen keyboard appears.
   */
  #initialsEntry({ score, meta, duration }) {
    const chars = [...settings.get('initials').padEnd(3, 'A')].slice(0, 3);
    let cursor = 0;
    let submitted = false;

    const slots = chars.map((c, i) =>
      h(`div.initials__slot${i === 0 ? '.is-active' : ''}`, c),
    );

    const hiddenInput = h('input.initials__input', {
      type: 'text',
      maxlength: '3',
      autocomplete: 'off',
      autocapitalize: 'characters',
      'aria-label': 'Your initials',
    });

    const paint = () => {
      slots.forEach((slot, i) => {
        slot.textContent = chars[i];
        slot.classList.toggle('is-active', i === cursor && !submitted);
      });
    };

    const submitBtn = h(
      'button.btn.btn--sm.btn--primary',
      { type: 'button', style: { marginTop: '16px' } },
      'Submit score',
    );

    const status = h('div.overlay__hint', 'Type three characters, then submit');

    const doSubmit = async () => {
      if (submitted) return;
      submitted = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      const initials = chars.join('').replace(/[^A-Z0-9]/g, '') || 'AAA';
      settings.set('initials', initials);

      try {
        const res = await api.submit(this.def.id, { initials, score, duration, meta });
        submitBtn.textContent = 'Submitted';
        status.textContent = res.ranked
          ? `You are #${res.rank} in the world on ${this.def.title}.`
          : 'Saved — just outside the top 100.';
        sfx.play('powerup');
        toast(res.ranked ? `Rank #${res.rank}!` : 'Score submitted.');
      } catch (err) {
        submitted = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Retry';
        status.textContent = api.online
          ? err.message || 'Could not reach the leaderboard.'
          : 'You are offline — your local best is safe.';
      }
      paint();
    };

    submitBtn.addEventListener('click', doSubmit);

    const onKey = (e) => {
      if (submitted) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        doSubmit();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        cursor = Math.max(0, cursor - 1);
        chars[cursor] = 'A';
        paint();
        return;
      }
      if (e.key === 'ArrowLeft') { cursor = Math.max(0, cursor - 1); paint(); return; }
      if (e.key === 'ArrowRight') { cursor = Math.min(2, cursor + 1); paint(); return; }

      const ch = e.key.toUpperCase();
      if (/^[A-Z0-9]$/.test(ch)) {
        e.preventDefault();
        chars[cursor] = ch;
        sfx.play('blip');
        cursor = Math.min(2, cursor + 1);
        paint();
      }
    };

    window.addEventListener('keydown', onKey);
    this.initialsCleanup = () => window.removeEventListener('keydown', onKey);

    hiddenInput.addEventListener('input', () => {
      const v = hiddenInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      for (let i = 0; i < 3; i++) chars[i] = v[i] ?? 'A';
      cursor = Math.min(2, v.length);
      paint();
    });

    const slotsRow = h('div.initials__slots', {
      onclick: () => hiddenInput.focus(),
    }, ...slots);

    return h(
      'div.initials',
      h('div.initials__prompt', 'Enter your initials'),
      slotsRow,
      hiddenInput,
      submitBtn,
      status,
    );
  }

  /* ------------------------------------------------------------ utilities */

  async #toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.screen.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      toast('Fullscreen is not available here.', { kind: 'warn' });
    }
  }

  destroy() {
    this.loop?.stop();
    this.game?.teardown();
    this.input?.destroy();
    this.resizeObserver?.disconnect();
    this.initialsCleanup?.();
    document.body.classList.remove('is-touch');
    this.game = null;
  }
}

/* ================================================================ helpers == */

function bump(el) {
  el.classList.remove('is-bump');
  void el.offsetWidth;
  el.classList.add('is-bump');
}

function isTouchDevice() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function loadingOverlay(def) {
  return h(
    'div.overlay',
    h(
      'div.overlay__panel',
      h('div.overlay__eyebrow', 'Loading cabinet'),
      h('div.overlay__title', def.title),
      h('div.overlay__hint', { style: { marginTop: '18px' } }, def.tagline),
    ),
  );
}

function errorOverlay(message, onBack) {
  return h(
    'div.overlay',
    h(
      'div.overlay__panel',
      h('div.overlay__eyebrow', 'Fault'),
      h('div.overlay__title', 'Out of order'),
      h('div.overlay__hint', { style: { marginTop: '16px' } }, message),
      h('div.overlay__actions', h('button.btn', { type: 'button', onclick: onBack }, 'Back to the arcade')),
    ),
  );
}
