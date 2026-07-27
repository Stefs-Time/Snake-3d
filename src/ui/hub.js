import { h, fmt } from '../core/dom.js';
import { GAMES } from '../../shared/catalog.js';
import { settings } from '../core/settings.js';
import { api } from '../core/api.js';
import { sfx } from '../core/audio.js';
import { icon, gameGlyph } from './icons.js';
import { attachPreview, PREVIEWS, stopPreviews } from './previews.js';

let disposers = [];
/** Card previews are torn down and rebuilt on every filter change. */
let cardDisposers = [];
let heroTimer = 0;

const NUMBER_WORDS = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen', 'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three',
  'Twenty-four', 'Twenty-five', 'Twenty-six', 'Twenty-seven', 'Twenty-eight',
  'Twenty-nine', 'Thirty',
];

/** So the headline stays true when a cabinet is added. */
const countWord = (n) => NUMBER_WORDS[n] ?? String(n);

export function renderHub() {
  cleanup();

  const statsRow = h('div.hero__stats');
  const grid = h('div.grid');
  const genres = ['All', ...new Set(GAMES.map((g) => g.genre))];
  let filter = 'All';

  /**
   * Rebuild the wall for the chosen genre. Previews are disposed and
   * re-attached rather than hidden, so the ones that are not on screen stop
   * costing anything.
   */
  const paint = () => {
    for (const dispose of cardDisposers) dispose();
    cardDisposers = [];
    grid.replaceChildren();
    const shown = GAMES.filter((g) => filter === 'All' || g.genre === filter);
    for (const game of shown) grid.append(gameCard(game));
    countNote.textContent = `${shown.length} ${shown.length === 1 ? 'cabinet' : 'cabinets'}`;
  };

  const countNote = h('span.section-head__note', `${GAMES.length} cabinets`);

  const filterRow = h(
    'div.filters',
    { role: 'group', 'aria-label': 'Filter by genre' },
    ...genres.map((genre) =>
      h(
        `button.filter${genre === 'All' ? '.is-on' : ''}`,
        {
          type: 'button',
          onclick: (e) => {
            filter = genre;
            for (const btn of filterRow.children) btn.classList.toggle('is-on', btn === e.currentTarget);
            sfx.play('select');
            paint();
          },
        },
        genre,
        h('i', String(GAMES.filter((g) => genre === 'All' || g.genre === genre).length)),
      ),
    ),
  );

  const heroCanvas = h('canvas', { 'aria-hidden': 'true' });
  const heroLabel = h('span', GAMES[0].title);

  const view = h(
    'div.view__scroll.scroller',
    h(
      'section.hero',
      h(
        'div.hero__copy',
        h('p.eyebrow', `${GAMES.length} cabinets · installable · plays offline`),
        h(
          'h1.hero__title.chromatic',
          `${countWord(GAMES.length)} classics.`,
          h('br'),
          h('em', 'One cabinet.'),
        ),
        h(
          'p.hero__sub',
          'Snake lifted into 3D, a maze chase with the original ghost AI intact, ' +
            'a stacker with modern rotation rules — then a quieter corner with ' +
            'solitaire, sudoku and word games, board games with an opponent ' +
            'that actually searches, and a tower defense to hold the line. ' +
            'Install it once and the whole arcade works on a plane.',
        ),
        h(
          'div.hero__actions',
          h(
            'a.btn.btn--primary',
            { href: `/play/${GAMES[0].id}`, onclick: () => sfx.play('coin') },
            icon('play', { size: 15, fill: true }),
            'Play Snake 3D',
          ),
          h('a.btn.btn--ghost', { href: '/scores' }, icon('trophy', { size: 15 }), 'Leaderboards'),
        ),
        statsRow,
      ),
      h(
        'div.hero__cabinet',
        h('div.hero__badge', h('i'), heroLabel),
        heroCanvas,
      ),
    ),
    h(
      'div.section-head',
      h('h2', 'Select your game'),
      h('div.section-head__rule'),
      countNote,
    ),
    filterRow,
    grid,
    h(
      'p.hub__note',
      h('b', 'Tip: '),
      'Everything here works with a keyboard, a gamepad, or your thumbs. ' +
        'Scores you set are saved on this device — submit one at the end of a run ' +
        'to put your initials on the global board.',
    ),
  );

  paint();
  renderStats(statsRow);
  startHeroAttract(heroCanvas, heroLabel);

  return view;
}

/* ------------------------------------------------------------------ card -- */

function gameCard(game) {
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const best = settings.bestFor(game.id);

  const card = h(
    'a.card',
    {
      href: `/play/${game.id}`,
      style: { '--card-accent': game.accent },
      onmouseenter: () => sfx.play('hover'),
      onclick: () => sfx.play('select'),
      'aria-label': `Play ${game.title} — ${game.tagline}`,
    },
    h(
      'div.card__stage',
      canvas,
      h('span.card__year', String(game.year)),
      h('span.card__glyph', gameGlyph(game, { size: 20 })),
    ),
    h(
      'div.card__body',
      h('div.card__title', h('h3', game.title), h('span.card__genre', game.genre)),
      h('p.card__tagline', game.tagline),
      h(
        'div.card__foot',
        h(
          'span.card__best',
          best > 0 ? ['Best ', h('b', fmt(best))] : 'Not played yet',
        ),
        h('span.card__play', 'Play', icon('arrowRight', { size: 11 })),
      ),
    ),
  );

  cardDisposers.push(attachPreview(canvas, game.id, { accent: game.accent, accent2: game.accent2 }));
  return card;
}

/* ----------------------------------------------------------------- stats -- */

async function renderStats(row) {
  const localPlays = settings.totalPlays();
  const localBest = Object.values(settings.all.best).reduce((a, b) => a + (b.score ?? 0), 0);

  const stat = (value, label) =>
    h('div.stat', h('div.stat__value', value), h('div.stat__label', label));

  row.append(
    stat(String(GAMES.length), 'Cabinets'),
    stat(fmt(localPlays), 'Your runs'),
    stat(fmt(localBest), 'Your total'),
  );

  // Global numbers are a bonus — the hub must never wait on the network.
  try {
    const { totals } = await api.stats();
    if (totals?.plays > 0) {
      row.append(stat(fmt(totals.plays), 'Runs worldwide'));
    }
  } catch {
    /* offline, or the server has nothing yet */
  }
}

/* -------------------------------------------------------- hero attract -- */

/**
 * The marquee cycles through every game's preview, four seconds each, with a
 * crossfade — the same loop an idle cabinet runs to pull you in.
 */
function startHeroAttract(canvas, label) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let index = 0;
  let raf = 0;
  let switchedAt = performance.now();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const DURATION = 4200;
  const FADE = 500;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const age = now - switchedAt;

    if (age > DURATION) {
      index = (index + 1) % GAMES.length;
      switchedAt = now;
      label.textContent = GAMES[index].title;
    }

    const game = GAMES[index];
    const w = canvas.width / dpr;
    const hgt = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);

    // Fade in at the start of a slot, out at the end.
    const fadeIn = Math.min(1, age / FADE);
    const fadeOut = Math.min(1, Math.max(0, (DURATION - age) / FADE));
    ctx.globalAlpha = Math.min(fadeIn, fadeOut);

    const draw = PREVIEWS[game.id] ?? PREVIEWS.default;
    try {
      draw(ctx, w, hgt, now / 1000, game.accent, game.accent2);
    } catch {
      /* keep the marquee alive */
    }
    ctx.restore();
  };

  raf = requestAnimationFrame(frame);
  disposers.push(() => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  });
}

/* --------------------------------------------------------------- unmount -- */

export function cleanup() {
  for (const dispose of [...disposers, ...cardDisposers]) dispose();
  disposers = [];
  cardDisposers = [];
  clearInterval(heroTimer);
  stopPreviews();
}
