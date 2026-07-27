/**
 * A very small hyperscript. Enough to build the whole interface without
 * shipping a framework, and small enough to read in one sitting.
 *
 *   h('div.card', { onclick: fn }, h('h3', 'Title'), 'text')
 *
 * The tag string supports `tag.class.class#id` shorthand.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline', 'polygon',
  'defs', 'linearGradient', 'stop', 'ellipse', 'text',
]);

export function h(spec, props, ...children) {
  const [tagPart, ...classParts] = String(spec).split('.');
  let tag = tagPart || 'div';
  let id = null;
  if (tag.includes('#')) [tag, id] = tag.split('#');

  const isSvg = SVG_TAGS.has(tag);
  const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  if (id) node.id = id;
  for (const cls of classParts) {
    if (cls) node.classList.add(...cls.split(' ').filter(Boolean));
  }

  // Allow h('div', child, child) — a non-plain-object second argument is a child.
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;

      if (key === 'class' || key === 'className') {
        node.classList.add(...String(value).split(' ').filter(Boolean));
      } else if (key === 'style' && typeof value === 'object') {
        for (const [prop, css] of Object.entries(value)) {
          // Custom properties are invisible to `style.foo = ...`; they only
          // exist through setProperty.
          if (prop.startsWith('--')) node.style.setProperty(prop, css);
          else node.style[prop] = css;
        }
      } else if (key === 'dataset') {
        Object.assign(node.dataset, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'html') {
        node.innerHTML = value;
      } else if (key === 'ref' && typeof value === 'function') {
        value(node);
      } else if (!isSvg && key in node && key !== 'list' && key !== 'form') {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }

  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace everything inside `node` with `children`. */
export function fill(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format 1234567 as "1,234,567". */
export function fmt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

/** Relative time, in the terse style a leaderboard wants. */
export function ago(ts) {
  const secs = Math.max(0, (Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
