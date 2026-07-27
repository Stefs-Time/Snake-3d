/**
 * A ~60 line history router. Routes are patterns like '/play/:id'; the first
 * match wins, and the handler receives the extracted params.
 */

const routes = [];
let notFound = null;
let current = null;
const listeners = new Set();

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^/${source}/?$`), keys };
}

export const router = {
  add(pattern, handler) {
    routes.push({ ...compile(pattern), handler, pattern });
    return router;
  },

  fallback(handler) {
    notFound = handler;
    return router;
  },

  /** Navigate, pushing history unless `replace` is set. */
  go(path, { replace = false } = {}) {
    if (path === location.pathname && !replace) return;
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
    router.resolve();
  },

  resolve() {
    const path = location.pathname || '/';
    for (const route of routes) {
      const match = route.regex.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(
        route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]),
      );
      current = { path, pattern: route.pattern, params };
      route.handler(params, path);
      emit();
      return;
    }
    current = { path, pattern: null, params: {} };
    notFound?.(path);
    emit();
  },

  get current() {
    return current;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  start() {
    window.addEventListener('popstate', () => router.resolve());

    // Intercept same-origin link clicks so navigation never reloads the app.
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = e.target.closest?.('a[href]');
      if (!anchor) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || anchor.target === '_blank') return;
      if (anchor.hasAttribute('download')) return;
      e.preventDefault();
      router.go(url.pathname + url.search);
    });

    router.resolve();
  },
};

function emit() {
  for (const fn of listeners) fn(current);
}
