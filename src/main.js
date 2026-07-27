import './styles/base.css';
import './styles/shell.css';
import './styles/hub.css';
import './styles/game.css';
import './styles/panels.css';

import { $, h } from './core/dom.js';
import { router } from './core/router.js';
import { settings } from './core/settings.js';
import { sfx } from './core/audio.js';
import { mountShell, setView, resetAccent } from './ui/shell.js';
import { renderHub, cleanup as cleanupHub } from './ui/hub.js';
import { renderLeaderboard } from './ui/leaderboard.js';
import { renderSettings } from './ui/settings.js';
import { renderAbout } from './ui/about.js';
import { renderPlay, destroyPlay } from './ui/play.js';
import { toast } from './ui/toast.js';
import { registerServiceWorker } from './pwa.js';

const app = $('#app');
mountShell(app);

/** Every route tears down whatever the last one left running. */
function transition(render, { accent = true } = {}) {
  return (params) => {
    cleanupHub();
    destroyPlay();
    if (accent) resetAccent();
    setView(render(params));
  };
}

router
  .add('/', transition(renderHub))
  .add('/play/:id', transition(renderPlay, { accent: false }))
  .add('/scores', transition(renderLeaderboard))
  .add('/scores/:id', transition(renderLeaderboard))
  .add('/settings', transition(renderSettings))
  .add('/about', transition(renderAbout))
  .fallback(() => {
    cleanupHub();
    destroyPlay();
    resetAccent();
    setView(
      h(
        'div.view__scroll.scroller',
        h(
          'div.board__empty',
          { style: { minHeight: '60vh' } },
          h('strong', '404 — wrong aisle'),
          h('p', 'There is no cabinet here.'),
          h('a.btn.btn--sm.btn--primary', { href: '/' }, 'Back to the arcade'),
        ),
      ),
    );
  });

router.start();

/* --------------------------------------------------------------- boot -- */

// Hand over from the pre-rendered boot screen once the first view is painted.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    app.hidden = false;
    const boot = $('#boot');
    boot?.classList.add('is-done');
    setTimeout(() => boot?.remove(), 700);
  });
});

/* ------------------------------------------------------- global keys -- */

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.code === 'KeyM') {
    const on = !settings.get('sound');
    settings.set('sound', on);
    toast(on ? 'Sound on' : 'Sound off');
  }
});

// Audio contexts need a gesture. Any first interaction will do.
const unlock = () => sfx.unlock();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

/* --------------------------------------------------------------- pwa -- */

registerServiceWorker();

window.addEventListener('offline', () => toast('Offline — local play still works.', { kind: 'warn' }));
window.addEventListener('online', () => toast('Back online.'));
