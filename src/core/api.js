/**
 * Leaderboard client. Every call fails soft: if the server is unreachable —
 * which it will be when the PWA is running offline — the arcade keeps working
 * on local high scores alone and simply says the board is unavailable.
 */

const TIMEOUT = 6000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`/api${path}`, {
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `Request failed (${res.status})`);
    }
    return res.status === 204 ? null : await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  online: true,

  async health() {
    return request('/health');
  },

  async top(gameId, limit = 10) {
    return request(`/scores/${gameId}?limit=${limit}`);
  },

  async submit(gameId, { initials, score, duration, meta }) {
    return request(`/scores/${gameId}`, {
      method: 'POST',
      body: { initials, score, duration, meta },
    });
  },

  /** Fire-and-forget play counter. Never throws, never blocks. */
  recordPlay(gameId) {
    fetch(`/api/plays/${gameId}`, { method: 'POST', keepalive: true }).catch(() => {});
  },

  async stats() {
    return request('/stats');
  },
};

window.addEventListener('online', () => (api.online = true));
window.addEventListener('offline', () => (api.online = false));
api.online = navigator.onLine;
