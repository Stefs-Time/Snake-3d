import { h, fmt } from '../core/dom.js';
import { settings } from '../core/settings.js';
import { sfx } from '../core/audio.js';
import { GAMES } from '../../shared/catalog.js';
import { toast } from './toast.js';

export function renderSettings() {
  const rows = [
    toggleRow({
      key: 'sound',
      title: 'Sound',
      note: 'Every effect is synthesized in the browser — there are no audio files to download.',
      onchange: (on) => on && sfx.play('toggle'),
    }),
    sliderRow({
      key: 'volume',
      title: 'Volume',
      note: 'Applies to all cabinets.',
    }),
    toggleRow({
      key: 'crt',
      title: 'CRT overlay',
      note: 'Scanlines, vignette and the occasional flicker. Turn it off for a flat, modern look.',
    }),
    toggleRow({
      key: 'shake',
      title: 'Screen shake',
      note: 'Impacts nudge the screen. Disable if it bothers you — it changes nothing about play.',
    }),
    initialsRow(),
  ];

  return h(
    'div.view__scroll.scroller',
    h(
      'div.section-head',
      h('h2', 'Configuration'),
      h('div.section-head__rule'),
      h('span.section-head__note', 'Saved on this device'),
    ),
    h('div.settings', ...rows, personalBests(), dangerZone()),
  );
}

/* ------------------------------------------------------------------ rows -- */

function toggleRow({ key, title, note, onchange }) {
  const button = h('button.switch', {
    type: 'button',
    role: 'switch',
    'aria-checked': String(settings.get(key)),
    'aria-label': title,
    onclick: () => {
      const next = !settings.get(key);
      settings.set(key, next);
      button.setAttribute('aria-checked', String(next));
      sfx.play('toggle');
      onchange?.(next);
    },
  });

  return h('div.setting', h('div.setting__text', h('h4', title), h('p', note)), button);
}

function sliderRow({ key, title, note }) {
  const input = h('input.slider', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: String(settings.get(key)),
    'aria-label': title,
    oninput: (e) => settings.set(key, Number(e.target.value)),
    onchange: () => sfx.play('blip'),
  });

  return h('div.setting', h('div.setting__text', h('h4', title), h('p', note)), input);
}

function initialsRow() {
  const input = h('input', {
    type: 'text',
    maxlength: '3',
    value: settings.get('initials'),
    'aria-label': 'Your initials',
    spellcheck: 'false',
    autocomplete: 'off',
    oninput: (e) => {
      const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      e.target.value = clean;
      if (clean) settings.set('initials', clean);
    },
  });

  return h(
    'div.setting',
    h(
      'div.setting__text',
      h('h4', 'Your initials'),
      h('p', 'Three characters, the way the machine intended. Used when you submit a score.'),
    ),
    h('div.field', input),
  );
}

function personalBests() {
  const played = GAMES.filter((g) => settings.bestFor(g.id) > 0);

  return h(
    'div',
    h('h3', {
      style: {
        margin: '38px 0 4px',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        letterSpacing: '0.26em',
        textTransform: 'uppercase',
        color: 'var(--accent)',
      },
    }, 'Personal bests'),
    played.length === 0
      ? h('p', { style: { color: 'var(--ink-dim)', fontSize: '13.5px', padding: '14px 0' } },
          'Nothing yet. Play a game and this fills in.')
      : played.map((game) =>
          h(
            'div.setting',
            h(
              'div.setting__text',
              h('h4', game.title),
              h('p', `${game.scoreLabel} · ${settings.all.plays[game.id] ?? 0} runs`),
            ),
            h('div', {
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: '19px',
                fontWeight: '700',
                color: game.accent,
              },
            }, fmt(settings.bestFor(game.id))),
          ),
        ),
  );
}

function dangerZone() {
  return h(
    'div.setting',
    { style: { marginTop: '24px', borderBottom: 'none' } },
    h(
      'div.setting__text',
      h('h4', 'Reset this device'),
      h('p', 'Clears your local high scores, run counts and preferences. Scores already submitted to the global board stay there.'),
    ),
    h(
      'button.btn.btn--sm.btn--danger',
      {
        type: 'button',
        onclick: (e) => {
          const btn = e.currentTarget;
          if (btn.dataset.armed !== 'yes') {
            btn.dataset.armed = 'yes';
            btn.textContent = 'Tap again to confirm';
            setTimeout(() => {
              btn.dataset.armed = '';
              btn.textContent = 'Reset';
            }, 4000);
            return;
          }
          settings.reset();
          toast('Local data cleared.', { kind: 'warn' });
          btn.dataset.armed = '';
          btn.textContent = 'Reset';
        },
      },
      'Reset',
    ),
  );
}
