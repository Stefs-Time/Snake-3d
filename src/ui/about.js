import { h } from '../core/dom.js';
import { GAMES } from '../../shared/catalog.js';

export function renderAbout() {
  return h(
    'div.view__scroll.scroller',
    h(
      'div.section-head',
      h('h2', 'About the cabinet'),
      h('div.section-head__rule'),
      h('span.section-head__note', 'v1.0'),
    ),
    h(
      'div.about',
      h(
        'p',
        h('b', 'Neon Cabinet'),
        ' is twenty-five games behind one front end, built to be installed rather than ' +
          'bookmarked. Add it to your home screen and it launches full-screen, works with no ' +
          'connection, and keeps your high scores on the device.',
      ),

      h('h3', 'Controls'),
      h(
        'div.keymap',
        h('div', h('kbd', '↑'), h('kbd', '↓'), h('kbd', '←'), h('kbd', '→'), 'Move'),
        h('div', h('kbd', 'W'), h('kbd', 'A'), h('kbd', 'S'), h('kbd', 'D'), 'Also move'),
        h('div', h('kbd', 'Space'), 'Fire / confirm'),
        h('div', h('kbd', 'P'), ' or ', h('kbd', 'Esc'), 'Pause'),
        h('div', h('kbd', 'R'), 'Restart the run'),
        h('div', h('kbd', 'M'), 'Mute'),
      ),
      h(
        'p',
        'A connected gamepad is picked up automatically — d-pad and left stick to move, ' +
          'A to act, Start to pause. On a touchscreen you get an on-screen pad, and the ' +
          'puzzle games take swipes.',
      ),

      h('h3', 'The lineup'),
      h(
        'ul',
        ...GAMES.map((game) =>
          h('li', h('b', { style: { color: game.accent } }, game.title), ` — ${game.blurb}`),
        ),
      ),

      h('h3', 'How it is built'),
      h(
        'ul',
        h('li', 'No UI framework. The interface is about 60 lines of hyperscript and a stylesheet.'),
        h('li', h('code', 'Three.js'), ' powers Snake 3D and is code-split, so the 2D games never download it.'),
        h('li', 'Every sound effect is synthesized with the Web Audio API at runtime — there is not one audio file in the repository.'),
        h('li', 'The app icons are generated at build time by a small PNG encoder, so no binary assets are committed either.'),
        h('li', 'A fixed-timestep loop runs the simulation at exactly 60Hz and interpolates rendering, so a 144Hz monitor plays identically to a 60Hz one.'),
        h('li', 'The service worker precaches the shell and serves assets stale-while-revalidate, which is what makes offline play work.'),
        h('li', 'Leaderboards are a small Express API. It writes to a JSON file by default and switches to Postgres on its own if ', h('code', 'DATABASE_URL'), ' is set.'),
      ),

      h('h3', 'Privacy'),
      h(
        'p',
        'Nothing is collected. Preferences and personal bests live in ',
        h('code', 'localStorage'),
        '. The only thing that ever reaches the server is a score you deliberately submit: ' +
          'three characters and a number.',
      ),

      h('h3', 'Credit where it is due'),
      h(
        'p',
        'These are re-implementations of games that shaped the medium, written from ' +
          'their published rules and behaviour. All original trademarks belong to their ' +
          'respective owners; nothing here uses their assets or code.',
      ),
    ),
  );
}
