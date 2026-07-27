import { h, fill, fmt, ago } from '../core/dom.js';
import { GAMES, getGame } from '../../shared/catalog.js';
import { api } from '../core/api.js';
import { settings } from '../core/settings.js';
import { sfx } from '../core/audio.js';
import { router } from '../core/router.js';
import { icon } from './icons.js';

export function renderLeaderboard(params) {
  const initial = getGame(params.id) ?? GAMES[0];
  const rows = h('div.board__rows');
  const head = h('div.board__head');
  const tabs = h('div.board__tabs', { role: 'tablist' });

  let active = initial.id;

  const select = (game, { push = true } = {}) => {
    active = game.id;
    for (const tab of tabs.children) {
      tab.classList.toggle('is-active', tab.dataset.game === game.id);
      tab.setAttribute('aria-selected', tab.dataset.game === game.id ? 'true' : 'false');
    }
    document.documentElement.style.setProperty('--accent', game.accent);
    renderHead(head, game);
    loadRows(rows, game);
    if (push) router.go(`/scores/${game.id}`, { replace: true });
  };

  for (const game of GAMES) {
    tabs.append(
      h(
        'button.board__tab',
        {
          type: 'button',
          role: 'tab',
          dataset: { game: game.id },
          style: { '--tab-accent': game.accent },
          onclick: () => {
            sfx.play('select');
            select(game);
          },
        },
        h('i'),
        game.title,
      ),
    );
  }

  const view = h(
    'div.view__scroll.scroller',
    h(
      'div.section-head',
      h('h2', 'High scores'),
      h('div.section-head__rule'),
      h('span.section-head__note', api.online ? 'Live from the server' : 'Offline'),
    ),
    h('div.board', tabs, h('div.board__panel', head, rows)),
  );

  select(initial, { push: false });
  return view;
}

function renderHead(head, game) {
  fill(
    head,
    h(
      'div',
      h('h3', game.title),
      h('p', `Top ten by ${game.scoreLabel.toLowerCase()} · ${game.genre} · ${game.year}`),
    ),
    h(
      'a.btn.btn--sm',
      { href: `/play/${game.id}`, onclick: () => sfx.play('coin') },
      icon('play', { size: 12, fill: true }),
      'Play',
    ),
  );
}

async function loadRows(container, game) {
  // Skeleton while the request is in flight.
  fill(
    container,
    ...Array.from({ length: 6 }, (_, i) =>
      h(
        'div.row',
        { style: { opacity: String(1 - i * 0.13) } },
        h('div.skeleton', { style: { width: '18px' } }),
        h('div.skeleton', { style: { width: '46px' } }),
        h('div.skeleton', { style: { width: '60%' } }),
        h('div.skeleton', { style: { width: '52px' } }),
      ),
    ),
  );

  const you = settings.get('initials');
  const localBest = settings.bestFor(game.id);

  try {
    const { scores } = await api.top(game.id, 10);

    if (!scores.length) {
      fill(
        container,
        h(
          'div.board__empty',
          h('strong', 'No scores yet'),
          h('p', `Nobody has put their initials on ${game.title}. The top spot is open.`),
          h(
            'a.btn.btn--primary.btn--sm',
            { href: `/play/${game.id}` },
            icon('play', { size: 12, fill: true }),
            'Claim it',
          ),
        ),
      );
      return;
    }

    fill(
      container,
      ...scores.map((entry, i) =>
        h(
          `div.row${entry.initials === you && entry.score === localBest ? '.is-you' : ''}`,
          h('div.row__rank', String(i + 1).padStart(2, '0')),
          h('div.row__initials', entry.initials),
          h('div.row__meta', describeMeta(entry, game)),
          h('div.row__score', fmt(entry.score)),
        ),
      ),
    );
  } catch {
    fill(
      container,
      h(
        'div.board__empty',
        icon('wifiOff', { size: 26 }),
        h('strong', 'Board unavailable'),
        h(
          'p',
          localBest > 0
            ? `You are offline. Your personal best here is ${fmt(localBest)}.`
            : 'You are offline. Scores will sync when you reconnect.',
        ),
      ),
    );
  }
}

function describeMeta(entry, game) {
  const bits = [ago(entry.at)];
  const meta = entry.meta ?? {};
  if (meta.level) bits.push(`level ${meta.level}`);
  if (meta.wave) bits.push(`wave ${meta.wave}`);
  if (meta.lines) bits.push(`${meta.lines} lines`);
  if (meta.length) bits.push(`length ${meta.length}`);
  if (meta.mode) bits.push(String(meta.mode));
  if (meta.draw) bits.push(`draw ${meta.draw}`);
  if (meta.tile) bits.push(`tile ${meta.tile}`);
  return bits.join(' · ') || game.scoreLabel;
}
