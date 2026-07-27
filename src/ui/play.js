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

/** How long each HUD control hint holds before the next one takes over. */
const HINT_PERIOD = 6200;

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
    this.briefing = false;
    this.startedAt = 0;
    this.isTouch = isTouchDevice();
    /** The HUD hint cycles through these; a game's own hint takes slot 0. */
    this.hintLines = [...this.controlLines];
    this.hintIndex = 0;

    setAccent(def.accent, def.accent2);
    document.body.classList.toggle('is-touch', this.isTouch);

    this.#buildDom();
    this.#loadGame();
  }

  /**
   * The control lines to show. "Space to serve" is a lie on a phone, so every
   * cabinet carries a touch phrasing that names the gesture and the on-screen
   * button instead of a key that is not there.
   */
  get controlLines() {
    return this.isTouch && this.def.controlsTouch?.length
      ? this.def.controlsTouch
      : this.def.controls;
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
    this.hudHint = h('div.hud__hint', this.controlLines[0]);

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

    // The touch controls are a sibling of the screen, not a child of the
    // frame. Sitting inside it they were painted over the playfield — a d-pad
    // across the bottom-left of Chomp's maze — and every press also reached
    // the frame's own pointer handler, so sliding a thumb off a key registered
    // as a swipe. In portrait they now occupy their own row below the cabinet.
    this.frame = h(
      'div.cabinet__frame',
      this.canvas,
      this.hud,
      h('div.cabinet__glare'),
      this.overlayHost,
    );

    this.cabinet = h('div.cabinet', this.frame);
    this.screen = h('div.play__screen', this.cabinet);

    this.root = h(
      'div.play',
      h(
        'div.play__bar',
        h('a.play__back', { href: '/', onclick: () => sfx.play('back') },
          icon('back', { size: 13 }), h('span', 'Arcade')),
        h('div.play__ident', h('h1', def.title), h('span', `${def.codename} · ${def.year}`)),
        h(
          'div.play__bar-tools',
          (this.optionsBar = h('div.play__options')),
          h('button.icon-btn', {
            type: 'button', 'aria-label': 'How to play', title: 'How to play (?)',
            onclick: () => this.showBriefing(),
          }, icon('info', { size: 18 })),
          h('button.icon-btn', {
            type: 'button', 'aria-label': 'Pause', title: 'Pause (P)',
            onclick: () => this.togglePause(),
          }, icon('pause', { size: 18 })),
          h('button.icon-btn', {
            type: 'button', 'aria-label': 'Restart', title: 'Restart (R)',
            onclick: () => this.restart(),
          }, icon('restart', { size: 18 })),
          h('button.icon-btn.icon-btn--wide-only', {
            type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen',
            onclick: () => this.#toggleFullscreen(),
          }, icon('expand', { size: 18 })),
        ),
      ),
      this.screen,
      this.touchLayer,
    );

    this.resizeObserver = new ResizeObserver(() => this.#fit());
    this.resizeObserver.observe(this.screen);

    // `?` opens the how-to-play card from anywhere. It is deliberately not a
    // letter: every letter on the keyboard is already spoken for by some game.
    this.onHelpKey = (e) => {
      if (e.key !== '?' || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (this.briefing) this.dismissBriefing();
      else this.showBriefing();
    };
    window.addEventListener('keydown', this.onHelpKey);
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
      // Grouped so the pair stays together at one end of the deck, whichever
      // of the two is actually shown.
      h('div.touch__buttons', this.touchSecondary, this.touchAction),
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
    this.#endBriefing();
    this.#clearOverlay();

    this.canvas.classList.toggle('smooth', GameClass.smooth !== false);
    this.touchLayer.dataset.scheme = GameClass.touch ?? 'dpad';
    // The HUD needs the scheme too, so its hint can clear the d-pad.
    this.frame.dataset.scheme = GameClass.touch ?? 'dpad';
    this.#labelTouchButtons();
    this.#renderOptions();

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

    // Reset the hint cycle before setup, so a hint the game sets there wins.
    this.hintLines = [...this.controlLines];
    this.hintIndex = 0;
    this.#paintHint(this.hintLines[0]);

    this.game.setup();
    this.#startHintCycle();

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

    // `?debug` exposes the running cabinet for the console and the smoke
    // tests. Off by default so nothing leaks into a normal session.
    if (location.search.includes('debug')) window.__cabinet = this;

    // First visit to this cabinet: explain it before it starts moving.
    if (!settings.hasBriefed(this.def.id)) this.showBriefing({ auto: true });
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

    // The HUD is DOM text over a canvas that scales, so on a small frame it
    // stayed full size and ran into the game's own labels. Tie it to the frame
    // instead of the viewport: 520px wide is the size it was drawn for.
    const k = Math.max(0.58, Math.min(1, w / 520));
    this.frame.style.setProperty('--hud-k', k.toFixed(3));

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

  /**
   * The on-screen buttons used to be a fixed "A" and "B" shown or hidden by
   * touch scheme, which meant a phone could not reach Blockfall's hold slot,
   * Vector's hyperspace or Solitaire's undo at all — and where a button did
   * appear, its letter said nothing about what it did. Each game now names
   * the buttons it reads, and only those appear.
   */
  #labelTouchButtons() {
    const labels = this.GameClass.touchButtons ?? {};
    const set = (el, text) => {
      el.hidden = !text;
      if (!text) return;
      el.textContent = text;
      el.setAttribute('aria-label', text);
    };
    set(this.touchAction, labels.action);
    set(this.touchSecondary, labels.secondary);
    this.touchSecondary.classList.toggle(
      'touch__action--solo',
      Boolean(labels.secondary) && !labels.action,
    );

    // A deck with nothing in it is a band of wasted screen, so collapse it.
    // The pointer games are played by tapping the board itself.
    const scheme = this.GameClass.touch ?? 'dpad';
    const hasPad = scheme === 'dpad' || scheme === 'move';
    const hasButtons = Boolean(labels.action || labels.secondary);
    this.touchLayer.hidden = !hasPad && !hasButtons;
    this.touchLayer.dataset.deck =
      hasPad && hasButtons ? 'both' : hasPad ? 'pad' : 'buttons';
  }

  /* -------------------------------------------------------------- options */

  /**
   * Cabinet options as a segmented control. A game that implements
   * `onOptionChange` and returns true handles the change live; anything else
   * restarts the run, because most options change how a game is set up.
   */
  #renderOptions() {
    const defs = this.GameClass.options ?? [];
    fill(this.optionsBar);
    this.optionsBar.hidden = defs.length === 0;

    for (const def of defs) {
      const current = settings.getOption(this.def.id, def.id, def.default);

      const buttons = def.choices.map((choice) =>
        h(
          `button.play__opt-btn${choice.value === current ? '.is-on' : ''}`,
          {
            type: 'button',
            title: choice.hint ?? choice.label,
            'aria-pressed': String(choice.value === current),
            onclick: () => this.#chooseOption(def, choice.value),
          },
          choice.label,
        ),
      );

      // The hint used to live in a `title` attribute, which a touchscreen can
      // never show, and in a toast *after* the change was already made. It is
      // now visible next to the choice it describes, before you commit to it.
      this.optionsBar.append(
        h(
          'div.play__opt-wrap',
          h(
            'div.play__opt',
            { role: 'group', 'aria-label': def.label },
            h('span.play__opt-label', def.label),
            ...buttons,
          ),
          h('div.play__opt-hint', this.#optionHintFor(def)),
        ),
      );
    }
  }

  /** The hint under the segmented control, describing the live choice. */
  #optionHintFor(def) {
    const current = settings.getOption(this.def.id, def.id, def.default);
    const choice = def.choices.find((c) => c.value === current);
    return choice?.hint ?? '';
  }

  #chooseOption(def, value) {
    if (settings.getOption(this.def.id, def.id, def.default) === value) return;
    settings.setOption(this.def.id, def.id, value);
    sfx.play('toggle');

    const handled = this.game?.onOptionChange?.(def.id, value) === true;
    if (handled) {
      this.#renderOptions();
      const choice = def.choices.find((c) => c.value === value);
      if (choice?.hint) toast(choice.hint);
    } else {
      this.restart();
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

  /**
   * A game's own hint is contextual and usually better than anything in the
   * catalog, so it takes the first slot rather than cancelling the cycle — the
   * other two control lines still get their turn.
   */
  setHint(text, touchText) {
    const shown = (this.isTouch && touchText) || text;
    this.hintLines = [shown, ...this.controlLines.filter((line) => line !== shown)];
    this.hintIndex = 0;
    this.#paintHint(shown);
    this.#startHintCycle();
  }

  #paintHint(text) {
    if (this.hudHint.textContent === text) return;
    this.hudHint.textContent = text;
    this.hudHint.classList.remove('is-fresh');
    void this.hudHint.offsetWidth; // restart the fade
    this.hudHint.classList.add('is-fresh');
  }

  /**
   * Every game writes three control lines into the catalog and only the first
   * was ever shown. They now rotate, so the whole control scheme surfaces
   * without costing a pixel of screen.
   */
  #startHintCycle() {
    clearInterval(this.hintTimer);
    if (this.hintLines.length < 2) return;
    this.hintTimer = setInterval(() => {
      if (this.paused || this.briefing || this.finished) return;
      this.hintIndex = (this.hintIndex + 1) % this.hintLines.length;
      this.#paintHint(this.hintLines[this.hintIndex]);
    }, HINT_PERIOD);
  }

  banner(text) {
    this.hudBanner.textContent = text;
    this.hudBanner.classList.remove('is-shown');
    void this.hudBanner.offsetWidth; // restart the animation
    this.hudBanner.classList.add('is-shown');
  }

  /* ------------------------------------------------------------- briefing */

  /**
   * The how-to-play card. Shown once per cabinet on the first visit and on
   * demand after that, built entirely from catalog data that until now only
   * appeared on the About page — or, in the case of two thirds of the control
   * lines, nowhere at all.
   */
  showBriefing({ auto = false } = {}) {
    if (this.briefing || this.finished || !this.loop) return;
    this.briefing = true;
    this.resumePausedAfterBriefing = this.paused;
    this.loop.setPaused(true);
    settings.markBriefed(this.def.id);
    if (!auto) sfx.play('select');

    this.briefKeys = (e) => {
      if (!['Escape', 'Enter', ' ', 'p', 'P'].includes(e.key)) return;
      e.preventDefault();
      this.dismissBriefing();
    };
    window.addEventListener('keydown', this.briefKeys);

    this.#showOverlay(this.#briefingOverlay(auto));
  }

  dismissBriefing() {
    if (!this.briefing) return;
    this.#endBriefing();
    sfx.play(this.resumePausedAfterBriefing ? 'back' : 'coin');

    // Reopening the card from a paused game returns you to the pause screen,
    // not straight back into play.
    if (this.resumePausedAfterBriefing) {
      this.#showOverlay(this.#pauseOverlay());
    } else {
      this.input?.reset();
      this.loop.setPaused(false);
      this.#clearOverlay();
    }
  }

  #endBriefing() {
    if (this.briefKeys) window.removeEventListener('keydown', this.briefKeys);
    this.briefKeys = null;
    this.briefing = false;
  }

  #briefingOverlay(auto) {
    const def = this.def;
    const best = settings.bestFor(def.id);
    const optionDefs = this.GameClass?.options ?? [];

    const section = (heading, ...rows) =>
      h('div.brief__section', h('div.brief__heading', heading), ...rows);

    return h(
      'div.overlay.overlay--brief',
      h(
        'div.overlay__panel.overlay__panel--brief',
        h('div.overlay__eyebrow', auto ? 'First visit' : 'How to play'),
        h('div.overlay__title', def.title),
        h('p.brief__tagline', def.tagline),

        // Only the middle scrolls: on a short cabinet the Start button has to
        // stay in view, or the card looks broken rather than long.
        h(
          'div.brief__body.scroller',
          h('p.brief__blurb', def.blurb),

          section(
            'Controls',
            h('ul.brief__list', ...this.controlLines.map((line) => h('li', line))),
          ),

          optionDefs.length
          ? section(
              'Options',
              h(
                'ul.brief__list',
                ...optionDefs.map((opt) => {
                  const current = settings.getOption(def.id, opt.id, opt.default);
                  const choice = opt.choices.find((c) => c.value === current);
                  return h(
                    'li',
                    h('b', `${opt.label}: ${choice?.label ?? current}`),
                    choice?.hint ? ` — ${choice.hint}` : '',
                  );
                }),
              ),
              h('div.brief__note', 'Change these in the bar above the screen at any time.'),
            )
            : null,

          section(
            'Scoring',
            h(
              'div.brief__scoring',
              h('span', def.scoreLabel),
              best > 0
                ? h('span.brief__best', `Your best · ${fmt(best)}`)
                : h('span.brief__best', 'No run yet'),
            ),
          ),
        ),

        h(
          'div.overlay__actions',
          h('button.btn.btn--primary', { type: 'button', onclick: () => this.dismissBriefing() },
            icon('play', { size: 14, fill: true }), auto ? 'Start' : 'Back to the game'),
          h('a.btn.btn--ghost', { href: `/scores/${def.id}` }, icon('trophy', { size: 14 }), 'Scores'),
        ),
        h('div.overlay__hint', 'Press ? for this card at any time'),
      ),
    );
  }

  /* -------------------------------------------------------- run lifecycle */

  togglePause() {
    if (this.finished || !this.loop || this.briefing) return;
    this.paused = !this.paused;
    this.loop.setPaused(this.paused);
    if (this.paused) {
      sfx.play('back');
      this.#showOverlay(this.#pauseOverlay());
    } else {
      sfx.play('select');
      this.input?.reset();
      this.#clearOverlay();
    }
  }

  restart() {
    if (!this.GameClass) return;
    this.#endBriefing();
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
    this.#endBriefing();
    clearInterval(this.hintTimer);
    if (this.onHelpKey) window.removeEventListener('keydown', this.onHelpKey);
    this.onHelpKey = null;
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
