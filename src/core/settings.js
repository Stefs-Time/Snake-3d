/**
 * Local player state: preferences, personal bests, and the three letters you
 * type when you beat someone. All of it lives in localStorage — the server
 * only ever sees a score you deliberately submit.
 */

const KEY = 'neon-cabinet:v1';

const DEFAULTS = {
  initials: 'AAA',
  sound: true,
  music: false,
  volume: 0.6,
  crt: true,
  shake: true,
  credits: 0,
  /** @type {Record<string, { score: number, at: number }>} */
  best: {},
  /** @type {Record<string, number>} */
  plays: {},
  /** Per-cabinet option choices: gameId -> { optionId: value }. */
  options: {},
  /** Cabinets whose how-to-play card has been shown: gameId -> true. */
  briefed: {},
};

/**
 * A fresh state object with its own maps. Spreading DEFAULTS alone would hand
 * out the *same* `best` / `options` objects every time, so writing a score
 * would quietly mutate the defaults.
 */
function freshState() {
  return { ...DEFAULTS, best: {}, plays: {}, options: {}, briefed: {} };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    return { ...freshState(), ...JSON.parse(raw) };
  } catch {
    return freshState();
  }
}

let state = read();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private browsing, quota, whatever — the arcade still works */
  }
}

export const settings = {
  get all() {
    return state;
  },

  get(key) {
    return state[key];
  },

  set(key, value) {
    if (state[key] === value) return value;
    state[key] = value;
    persist();
    emit(key, value);
    return value;
  },

  /** Record a finished run. Returns true when it beat the local best. */
  recordRun(gameId, score) {
    state.plays[gameId] = (state.plays[gameId] ?? 0) + 1;
    state.credits += 1;
    const prev = state.best[gameId]?.score ?? -1;
    const isBest = score > prev;
    if (isBest) state.best[gameId] = { score, at: Date.now() };
    persist();
    emit('best', state.best);
    emit('credits', state.credits);
    return isBest;
  },

  bestFor(gameId) {
    return state.best[gameId]?.score ?? 0;
  },

  /* --- per-cabinet options, e.g. Snake 3D's camera --- */

  getOption(gameId, optionId, fallback) {
    return state.options?.[gameId]?.[optionId] ?? fallback;
  },

  setOption(gameId, optionId, value) {
    state.options ??= {};
    (state.options[gameId] ??= {})[optionId] = value;
    persist();
    emit('options', state.options);
    return value;
  },

  /* --- the how-to-play card, shown once per cabinet --- */

  hasBriefed(gameId) {
    return Boolean(state.briefed?.[gameId]);
  },

  markBriefed(gameId) {
    if (state.briefed?.[gameId]) return;
    state.briefed ??= {};
    state.briefed[gameId] = true;
    persist();
  },

  totalPlays() {
    return Object.values(state.plays).reduce((a, b) => a + b, 0);
  },

  reset() {
    state = freshState();
    persist();
    emit('*', state);
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function emit(key, value) {
  for (const fn of listeners) fn(key, value);
}
