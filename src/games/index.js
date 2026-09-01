/**
 * Cabinet registry.
 *
 * Each entry is a lazy import so a game's code — and, for Snake 3D, the whole
 * Three.js runtime — is only fetched when someone actually walks up to that
 * machine. The hub itself stays a few kilobytes.
 */

const LOADERS = {
  snake3d: () => import('./snake3d.js'),
  chomp: () => import('./chomp.js'),
  blockfall: () => import('./blockfall.js'),
  invaders: () => import('./invaders.js'),
  bricks: () => import('./bricks.js'),
  vector: () => import('./vector.js'),
  paddles: () => import('./paddles.js'),
  twenty48: () => import('./twenty48.js'),
  solitaire: () => import('./solitaire.js'),
  lexicon: () => import('./lexicon.js'),
  wordsearch: () => import('./wordsearch.js'),
  bingo: () => import('./bingo.js'),
  minefield: () => import('./minefield.js'),
  memory: () => import('./memory.js'),
  simon: () => import('./simon.js'),
  tictactoe: () => import('./tictactoe.js'),
  connectfour: () => import('./connectfour.js'),
  reversi: () => import('./reversi.js'),
  sudoku: () => import('./sudoku.js'),
  lightsout: () => import('./lightsout.js'),
  fifteen: () => import('./fifteen.js'),
  hangman: () => import('./hangman.js'),
  bulwark: () => import('./bulwark.js'),
  bastion: () => import('./bastion.js'),
  cascade: () => import('./cascade.js'),
  blackjack: () => import('./blackjack.js'),
  ginrummy: () => import('./ginrummy.js'),
  freecell: () => import('./freecell.js'),
  checkers: () => import('./checkers.js'),
  backgammon: () => import('./backgammon.js'),
  battleship: () => import('./battleship.js'),
  wordladder: () => import('./wordladder.js'),
  contagion: () => import('./contagion.js'),
};

/**
 * @param {string} id
 * @returns {Promise<typeof import('../core/game.js').BaseGame>}
 */
export async function loadGame(id) {
  const loader = LOADERS[id];
  if (!loader) throw new Error(`No cabinet registered for "${id}"`);
  const module = await loader();
  const GameClass = module.default;
  if (!GameClass) throw new Error(`Cabinet "${id}" has no default export`);
  return GameClass;
}

export const REGISTERED = Object.keys(LOADERS);
