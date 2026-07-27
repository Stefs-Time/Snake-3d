import { h } from '../core/dom.js';

/** Stroked line icons, 24x24, currentColor. */
const PATHS = {
  play: 'M8 5v14l11-7z',
  back: 'M15 18l-6-6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  pause: 'M9 5v14M15 5v14',
  restart: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  sound: 'M11 5 6 9H3v6h3l5 4V5zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  mute: 'M11 5 6 9H3v6h3l5 4V5zM17 9l4 6M21 9l-4 6',
  install: 'M12 3v12M8 11l4 4 4-4M4 19h16',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  info: 'M12 16v-4M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  expand: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
  gamepad:
    'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7A4.7 4.7 0 0 0 2 9.7L2 15a3 3 0 0 0 5.1 2.1L8.6 15h6.8l1.5 2.1A3 3 0 0 0 22 15V9.7A4.7 4.7 0 0 0 17.3 5z',
  wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 3.5-2.3M1.4 9.3a15 15 0 0 1 4.2-2.8M22.6 9.3a15 15 0 0 0-6.6-3.6M19 12.9a10 10 0 0 0-2-1.4M12 20h.01',
};

/** @param {keyof typeof PATHS} name */
export function icon(name, { size = 24, fill = false } = {}) {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: fill ? 'currentColor' : 'none',
      stroke: fill ? 'none' : 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: PATHS[name] ?? PATHS.info }),
  );
}

/** The per-game cabinet glyph, from the catalog's `glyph` path data. */
export function gameGlyph(game, { size = 24 } = {}) {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: game.glyph }),
  );
}

/** The arcade's own mark: a stylised cabinet screen. */
export function brandMark(size = 26) {
  return h(
    'svg',
    { viewBox: '0 0 32 32', width: size, height: size, 'aria-hidden': 'true' },
    h('defs', null,
      h('linearGradient', { id: 'nc-mark', x1: '0', y1: '0', x2: '1', y2: '1' },
        h('stop', { offset: '0', 'stop-color': '#00e5ff' }),
        h('stop', { offset: '1', 'stop-color': '#ff2e88' }),
      ),
    ),
    h('rect', {
      x: '3', y: '4', width: '26', height: '20', rx: '4',
      fill: 'none', stroke: 'url(#nc-mark)', 'stroke-width': '2',
    }),
    h('path', {
      d: 'M9 18v-4h4v-3h5v3h4v4',
      fill: 'none', stroke: 'url(#nc-mark)', 'stroke-width': '2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }),
    h('path', { d: 'M11 28h10', stroke: 'url(#nc-mark)', 'stroke-width': '2', 'stroke-linecap': 'round' }),
  );
}
