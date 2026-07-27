import { h } from '../core/dom.js';

let host = null;

function ensure() {
  if (!host) {
    host = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/**
 * @param {string} message
 * @param {{ kind?: 'info'|'warn'|'error', ms?: number }} [opts]
 */
export function toast(message, { kind = 'info', ms = 2800 } = {}) {
  const node = h(`div.toast.toast--${kind}`, h('i.toast__dot'), h('span', message));
  ensure().append(node);

  const remove = () => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };

  setTimeout(remove, ms);
  return remove;
}
