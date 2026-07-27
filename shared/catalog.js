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
      'A neon serpent loose on a floating arena. Same rules your calculator taught you — eat, grow, never bite yourself — and the walls are the only thing between you and the void. Play it with a fixed camera, where left is always west, or switch to the chase camera that banks into every turn and makes steering relative. That one is harder, and scores 1.3x.',
    year: 1976,
    genre: 'Arcade',
    accent: '#39ff88',
    accent2: '#00e5ff',
    glyph: 'M4 16h6a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h4M18 4l2 2-2 2',
    controls: ['Arrows / WASD to steer', 'Fixed or chase camera, your choice', 'P to pause'],
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

  /* ------------------------------------------------- the quiet corner -- */

  {
    id: 'solitaire',
    title: 'Solitaire',
    codename: 'KLNDKE',
    tagline: 'The one that ate the nineties.',
    blurb:
      'Klondike, your choice of draw one or draw three. Click a card to lift it — with everything stacked below it, because a run travels as one — then click where it belongs. Double-click sends a card home. Undo as far back as you like. Draw three is the traditional, harder game and scores 1.25x.',
    year: 1990,
    genre: 'Cards',
    accent: '#4ade80',
    accent2: '#ff5c7a',
    glyph: 'M6 3h8l4 4v14H6zM10 8h6M10 12h6M10 16h4',
    controls: ['Click a card, then its destination', 'Draw one or draw three, your choice', 'U to undo'],
    scoreLabel: 'Score',
    scoreCeiling: 200_000,
    is3d: false,
  },
  {
    id: 'lexicon',
    title: 'Lexicon',
    codename: 'LEXICN',
    tagline: 'Five letters. Six guesses. Again.',
    blurb:
      'Green for the right letter in the right place, amber for the right letter somewhere else. Duplicate letters are marked properly, which is the bit most versions get wrong. Solve one and another arrives, so a run is a streak.',
    year: 2021,
    genre: 'Word',
    accent: '#facc15',
    accent2: '#4ade80',
    glyph: 'M4 5h16v14H4zM8 9h8M8 13h5',
    controls: ['Type a five-letter word', 'Enter to submit', 'Backspace to fix a typo'],
    scoreLabel: 'Score',
    scoreCeiling: 500_000,
    is3d: false,
  },
  {
    id: 'wordsearch',
    title: 'Word Search',
    codename: 'SEARCH',
    tagline: 'Ten words, hiding in plain sight.',
    blurb:
      'Words run in all eight directions and cross wherever their letters agree, so the grid is genuinely tangled rather than a list laid diagonally. Drag across a run to claim it — the selection snaps, so close enough counts.',
    year: 1968,
    genre: 'Word',
    accent: '#c084fc',
    accent2: '#22d3ee',
    glyph: 'M4 4h16v16H4zM7 7h2M11 7h2M15 7h2M7 11h2M11 11h2M15 11h2M7 15h2M11 15h2M15 15h2',
    controls: ['Drag across the letters', 'Any of eight directions', 'Beat the clock'],
    scoreLabel: 'Score',
    scoreCeiling: 500_000,
    is3d: false,
  },
  {
    id: 'bingo',
    title: 'Bingo',
    codename: 'BINGO',
    tagline: 'Two cards. One caller. Keep up.',
    blurb:
      'Nothing daubs itself — you have to spot your own numbers across two cards while the caller quickens. A fresh number is worth four times one you nearly let slip, so this is a game of attention rather than luck.',
    year: 1929,
    genre: 'Luck',
    accent: '#fb7185',
    accent2: '#fbbf24',
    glyph: 'M4 5h16v14H4zM4 9h16M8 9v10M12 9v10M16 9v10',
    controls: ['Click a number once it is called', 'Two cards at once', 'Wrong daubs cost points'],
    scoreLabel: 'Score',
    scoreCeiling: 500_000,
    is3d: false,
  },
  {
    id: 'minefield',
    title: 'Minefield',
    codename: 'MINE',
    tagline: 'Logic, with consequences.',
    blurb:
      'The first click is always safe — the mines are laid around it — so no run ends on move one. Clear a board and the next one has more of them. Click a satisfied number to open everything around it.',
    year: 1990,
    genre: 'Puzzle',
    accent: '#f87171',
    accent2: '#38bdf8',
    glyph: 'M12 5v3M12 16v3M5 12h3M16 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    controls: ['Click to clear a square', 'F or right-click to flag', 'Click a number to chord'],
    scoreLabel: 'Score',
    scoreCeiling: 500_000,
    is3d: false,
  },
  {
    id: 'memory',
    title: 'Memory',
    codename: 'PAIRS',
    tagline: 'You saw that one. Where was it?',
    blurb:
      'Turn two cards, keep them if they match. Consecutive matches build a combo, and clearing a board without a single wasted flip pays a large bonus — so the good players are not the lucky ones.',
    year: 1959,
    genre: 'Memory',
    accent: '#38bdf8',
    accent2: '#f472b6',
    glyph: 'M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z',
    controls: ['Click a card to turn it', 'Two at a time', 'Clear the board before the clock'],
    scoreLabel: 'Score',
    scoreCeiling: 500_000,
    is3d: false,
  },
  {
    id: 'simon',
    title: 'Simon',
    codename: 'SIMON',
    tagline: 'It is a tune, not a colour.',
    blurb:
      'One step longer every round, played back a little faster. The four pads use the original tones, which is the trick: past about six steps you stop memorising the lights and start memorising the melody.',
    year: 1978,
    genre: 'Memory',
    accent: '#34d399',
    accent2: '#f87171',
    glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v6M12 15v6M3 12h6M15 12h6',
    controls: ['Click a pad, or press Q W A S', 'Watch, then repeat', 'Three strikes'],
    scoreLabel: 'Score',
    scoreCeiling: 200_000,
    is3d: false,
  },
];

/** @type {Record<string, GameDef>} */
export const GAMES_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

export const GAME_IDS = GAMES.map((g) => g.id);

export function getGame(id) {
  return GAMES_BY_ID[id] ?? null;
}
