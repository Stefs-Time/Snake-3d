/**
 * The arcade catalog — the single source of truth for both the client hub and
 * the server-side score validator. Keep this file free of browser and Node
 * APIs so it can be imported from either side.
 */

/**
 * @typedef {object} GameDef
 * @property {string}   id           URL slug and leaderboard key
 * @property {string}   title        Display name
 * @property {string}   codename     Short cabinet label
 * @property {string}   tagline      One line for the hub card
 * @property {string}   blurb        Longer copy for the detail panel
 * @property {number}   year         Year the original landed, for flavour
 * @property {string}   genre        Category chip
 * @property {string}   accent       Neon accent, hex
 * @property {string}   accent2      Secondary neon, hex
 * @property {string}   glyph        Inline SVG path data for the cabinet icon
 * @property {string[]} controls     Human-readable control hints
 * @property {string}   scoreLabel   What the number on the leaderboard means
 * @property {number}   scoreCeiling Server-side sanity ceiling for submissions
 * @property {boolean}  is3d         Whether it needs the Three.js chunk
 */

/** @type {GameDef[]} */
export const GAMES = [
  {
    id: 'snake3d',
    title: 'Snake 3D',
    codename: 'SNK-3D',
    tagline: 'The classic, lifted off the page.',
    blurb:
      'A neon serpent loose on a floating arena. Same rules your calculator taught you — eat, grow, never bite yourself — except now the camera banks with every turn and the walls are the only thing between you and the void.',
    year: 1976,
    genre: 'Arcade',
    accent: '#39ff88',
    accent2: '#00e5ff',
    glyph: 'M4 16h6a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h4M18 4l2 2-2 2',
    controls: ['Arrows / WASD to steer', 'Steering is relative to the camera', 'P to pause'],
    scoreLabel: 'Score',
    scoreCeiling: 2_000_000,
    is3d: true,
  },
  {
    id: 'chomp',
    title: 'Chomp',
    codename: 'CHOMP',
    tagline: 'Four ghosts. One maze. No mercy.',
    blurb:
      'A faithful maze-chase with the original ghost personalities intact: Blinky hunts you down, Pinky cuts you off, Inky plays the angles, and Clyde does whatever Clyde does. Scatter and chase waves flip on the real timetable.',
    year: 1980,
    genre: 'Maze',
    accent: '#ffd23f',
    accent2: '#ff5c7a',
    glyph: 'M12 3a9 9 0 1 0 8.2 12.7L12 12l8.2-3.7A9 9 0 0 0 12 3Z',
    controls: ['Arrows / WASD to move', 'Swipe on touch', 'Space to pause'],
    scoreLabel: 'Score',
    scoreCeiling: 5_000_000,
    is3d: false,
  },
  {
    id: 'blockfall',
    title: 'Blockfall',
    codename: 'BLK-FL',
    tagline: 'Seven shapes, infinite regret.',
    blurb:
      'Modern-rules stacking: a seven-bag randomiser so you are never starved of an I-piece, super-rotation wall kicks, a hold slot, a ghost preview, and lock delay that forgives exactly one mistake.',
    year: 1984,
    genre: 'Puzzle',
    accent: '#00e5ff',
    accent2: '#b47bff',
    glyph: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z',
    controls: ['← → to move, ↓ to soft drop', 'Space to hard drop', 'Z / X to rotate, C to hold'],
    scoreLabel: 'Score',
    scoreCeiling: 10_000_000,
    is3d: false,
  },
  {
    id: 'invaders',
    title: 'Invaders',
    codename: 'INVDRS',
    tagline: 'They speed up as you win.',
    blurb:
      'The descending grid marches faster with every alien you remove — the original difficulty curve was a hardware limitation, and it was too good to fix. Four destructible shields, one bonus saucer, no second chances.',
    year: 1978,
    genre: 'Shooter',
    accent: '#b47bff',
    accent2: '#39ff88',
    glyph: 'M7 6v2H5v4H3v4h4v-2h2v2h6v-2h2v2h4v-4h-2V8h-2V6h-2v2H9V6zM9 12h2v2H9zm4 0h2v2h-2z',
    controls: ['← → to move', 'Space to fire', 'Hold to auto-fire'],
    scoreLabel: 'Score',
    scoreCeiling: 2_000_000,
    is3d: false,
  },
  {
    id: 'bricks',
    title: 'Bricks',
    codename: 'BRICKS',
    tagline: 'One ball against a wall.',
    blurb:
      'Where the ball hits the paddle decides where it goes — the edges are steep, the centre is flat, and that is the whole game. Falling power-ups hand you a wider paddle, a laser, or two more balls to lose track of.',
    year: 1976,
    genre: 'Action',
    accent: '#ff5c7a',
    accent2: '#ffd23f',
    glyph: 'M3 5h6v3H3zm8 0h10v3H11zM3 10h10v3H3zm12 0h6v3h-6zM8 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    controls: ['← → or mouse to steer', 'Space to launch', 'Space to fire lasers'],
    scoreLabel: 'Score',
    scoreCeiling: 1_000_000,
    is3d: false,
  },
  {
    id: 'vector',
    title: 'Vector',
    codename: 'VECTOR',
    tagline: 'Inertia is the real enemy.',
    blurb:
      'Thrust, drift, and learn to shoot backwards. Big rocks split into medium rocks, medium into small, and small into the sinking feeling that you have made the screen worse. Hyperspace when it all goes wrong.',
    year: 1979,
    genre: 'Shooter',
    accent: '#7dd3fc',
    accent2: '#ffffff',
    glyph: 'M12 3 4 20l8-5 8 5z',
    controls: ['← → to rotate, ↑ to thrust', 'Space to fire', 'Shift for hyperspace'],
    scoreLabel: 'Score',
    scoreCeiling: 2_000_000,
    is3d: false,
  },
  {
    id: 'paddles',
    title: 'Paddles',
    codename: 'PADDLE',
    tagline: 'The one that started it all.',
    blurb:
      'First to eleven. The opponent reads the ball a little better every time you win a rally, and a moving paddle puts spin on the return — so the safe shot is rarely the good one.',
    year: 1972,
    genre: 'Sport',
    accent: '#a3ff5c',
    accent2: '#ffffff',
    glyph: 'M4 7v10M20 7v10M12 4v2m0 4v2m0 4v2m0 4v0M9 12h6',
    controls: ['↑ ↓ or W / S to move', 'Mouse to track', 'Space to serve'],
    scoreLabel: 'Score',
    scoreCeiling: 100_000,
    is3d: false,
  },
  {
    id: 'twenty48',
    title: '2048',
    codename: '2048',
    tagline: 'Just one more swipe.',
    blurb:
      'Slide everything one way, merge what matches, and try to keep your biggest tile in a corner. Simple enough to explain in a sentence, stubborn enough to eat an afternoon. One undo, use it wisely.',
    year: 2014,
    genre: 'Puzzle',
    accent: '#ff9f43',
    accent2: '#ffd23f',
    glyph: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16',
    controls: ['Arrows / WASD to slide', 'Swipe on touch', 'U to undo'],
    scoreLabel: 'Score',
    scoreCeiling: 5_000_000,
    is3d: false,
  },
];

/** @type {Record<string, GameDef>} */
export const GAMES_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

export const GAME_IDS = GAMES.map((g) => g.id);

export function getGame(id) {
  return GAMES_BY_ID[id] ?? null;
}
