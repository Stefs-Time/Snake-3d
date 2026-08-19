import { h, fill } from '../core/dom.js';
import { settings } from '../core/settings.js';
import { sfx } from '../core/audio.js';
import { router } from '../core/router.js';
import { icon, brandMark } from './icons.js';
import { toast } from './toast.js';

/**
 * The persistent chrome: brand, navigation, credits, sound toggle and the
 * install button. Everything below it is swapped out by the router.
 */

let viewport = null;
let navLinks = [];
let creditsEl = null;
let soundBtn = null;
let installBtn = null;
let deferredInstall = null;

const NAV = [
  { href: '/', label: 'Arcade', match: (p) => p === '/' || p.startsWith('/play') },
  { href: '/scores', label: 'Scores', match: (p) => p.startsWith('/scores') },
  { href: '/settings', label: 'Config', match: (p) => p.startsWith('/settings') },
  { href: '/about', label: 'About', match: (p) => p.startsWith('/about') },
];

export function mountShell(root) {
  navLinks = NAV.map((item) =>
    h('a.nav__link', { href: item.href, dataset: { match: item.href } }, item.label),
  );

  creditsEl = h(
    'div.credits',
    { title: 'One credit per game you finish. Purely for nostalgia.' },
    'Credits',
    h('b', String(settings.get('credits'))),
  );

  soundBtn = h('button.icon-btn', {
    type: 'button',
    'aria-label': 'Toggle sound',
    title: 'Toggle sound (M)',
    onclick: () => {
      const on = !settings.get('sound');
      settings.set('sound', on);
      renderSoundIcon();
      if (on) sfx.play('toggle');
      toast(on ? 'Sound on' : 'Sound off');
    },
  });

  installBtn = h(
    'button.install-btn',
    { type: 'button', hidden: true, onclick: promptInstall },
    icon('install', { size: 14 }),
    h('span', 'Install'),
  );

  const topbar = h(
    'header.topbar',
    h(
      'a.brand',
      { href: '/', 'aria-label': 'Neon Cabinet home' },
      h('span.brand__mark', brandMark(26)),
      h('span.brand__name', h('b', 'NEON'), ' CABINET'),
    ),
    h('nav.nav', { 'aria-label': 'Primary' }, navLinks),
    h('div.topbar__spacer'),
    h(
      'div.topbar__tools',
      creditsEl,
      installBtn,
      soundBtn,
      h('a.icon-btn', {
        href: '/settings',
        'aria-label': 'Settings',
        title: 'Settings',
      }, icon('settings', { size: 18 })),
    ),
  );

  viewport = h('main.view', { id: 'viewport' });
  fill(root, topbar, viewport);

  renderSoundIcon();
  router.subscribe(syncNav);
  settings.subscribe((key) => {
    if (key === 'credits' || key === '*') {
      creditsEl.querySelector('b').textContent = String(settings.get('credits'));
    }
  });
  setupInstallPrompt();

  return viewport;
}

/**
 * Swap the current view.
 *
 * The node is placed directly into the viewport with no wrapper — a wrapper
 * would break the height chain that lets a game size its cabinet against the
 * available space.
 */
export function setView(node, { accent } = {}) {
  if (accent) setAccent(accent);
  node.classList.add('view__enter');
  fill(viewport, node);
  viewport.scrollTop = 0;
  return node;
}

/** Recolour the whole interface around the active game. */
export function setAccent(accent, accent2) {
  const root = document.documentElement;
  root.style.setProperty('--accent', accent);
  if (accent2) root.style.setProperty('--accent-2', accent2);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#06070b');
}

export function resetAccent() {
  setAccent('#00e5ff', '#ff2e88');
}

function syncNav(current) {
  const path = current?.path ?? '/';
  navLinks.forEach((link, i) => {
    link.classList.toggle('is-active', NAV[i].match(path));
  });
}

function renderSoundIcon() {
  const on = settings.get('sound');
  fill(soundBtn, icon(on ? 'sound' : 'mute', { size: 18 }));
  soundBtn.classList.toggle('is-on', on);
}

/* ------------------------------------------------------------- install -- */

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installBtn.hidden = true;
    toast('Installed. The cabinet now works offline.', { kind: 'info', ms: 4000 });
  });

  // Already running as an installed app? Nothing to offer.
  if (window.matchMedia('(display-mode: standalone)').matches) {
    installBtn.hidden = true;
  }
}

async function promptInstall() {
  if (!deferredInstall) {
    toast('Use your browser menu — "Add to Home Screen".', { ms: 4000 });
    return;
  }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') {
    installBtn.hidden = true;
    sfx.play('coin');
  }
  deferredInstall = null;
}
