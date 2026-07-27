import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createStore } from './store.js';
import { GAMES, GAME_IDS, getGame } from '../shared/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8080);

const store = await createStore();
const app = express();
const startedAt = Date.now();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '8kb' }));

/* ----------------------------------------------------------- rate limit -- */

/**
 * Small in-memory token bucket. This is a leaderboard for a browser arcade,
 * not a bank — the goal is to stop a bored someone from hammering the endpoint,
 * not to survive a determined attack.
 */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'Slow down a moment.' });
    }
    times.push(now);
    hits.set(key, times);
    next();
  };
}

/* ------------------------------------------------------------------ api -- */

const api = express.Router();

api.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'neon-cabinet',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    store: store.kind,
    games: GAME_IDS.length,
  });
});

api.get('/catalog', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ games: GAMES });
});

api.get('/scores/:game', async (req, res) => {
  const game = getGame(req.params.game);
  if (!game) return res.status(404).json({ error: 'No such game.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  try {
    res.json({ game: game.id, scores: await store.top(game.id, limit) });
  } catch (err) {
    console.error('[api] top failed:', err);
    res.status(500).json({ error: 'Leaderboard unavailable.' });
  }
});

api.post('/scores/:game', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const game = getGame(req.params.game);
  if (!game) return res.status(404).json({ error: 'No such game.' });

  const initials = String(req.body?.initials ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
  const score = Number(req.body?.score);
  const duration = Number(req.body?.duration ?? 0);

  if (!initials) return res.status(400).json({ error: 'Initials must be 1-3 letters or digits.' });
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
    return res.status(400).json({ error: 'Score must be a non-negative integer.' });
  }
  if (score > game.scoreCeiling) {
    return res.status(400).json({ error: 'That score is beyond what this game can produce.' });
  }
  // A run that scored well has to have lasted at least a few seconds.
  if (score > 1000 && duration < 3) {
    return res.status(400).json({ error: 'That run was too short to be real.' });
  }

  const meta = {};
  if (typeof req.body?.meta === 'object' && req.body.meta) {
    for (const [k, v] of Object.entries(req.body.meta).slice(0, 8)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        meta[String(k).slice(0, 24)] = typeof v === 'string' ? v.slice(0, 48) : v;
      }
    }
  }

  const entry = { initials, score, meta, at: Date.now() };
  try {
    const { rank, ranked } = await store.submit(game.id, entry);
    const top = await store.top(game.id, 10);
    res.status(201).json({ rank, ranked, top });
  } catch (err) {
    console.error('[api] submit failed:', err);
    res.status(500).json({ error: 'Could not save that score.' });
  }
});

api.post('/plays/:game', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  const game = getGame(req.params.game);
  if (!game) return res.status(404).json({ error: 'No such game.' });
  try {
    await store.recordPlay(game.id);
  } catch {
    /* a missed play counter is not worth a 500 */
  }
  res.status(204).end();
});

api.get('/stats', async (req, res) => {
  try {
    const perGame = await store.stats();
    const totals = Object.values(perGame).reduce(
      (acc, g) => ({ plays: acc.plays + (g.plays ?? 0), entries: acc.entries + (g.entries ?? 0) }),
      { plays: 0, entries: 0 },
    );
    res.json({ totals, perGame });
  } catch (err) {
    console.error('[api] stats failed:', err);
    res.status(500).json({ error: 'Stats unavailable.' });
  }
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

/* ------------------------------------------------------------- static -- */

if (fs.existsSync(DIST)) {
  // Hashed assets are immutable; the shell and worker must always revalidate.
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (/\/assets\/.+\.[0-9a-f]{8,}\./.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );

  // Client-side routing: every non-API path returns the shell.
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('*', (req, res) =>
    res
      .status(503)
      .type('text/plain')
      .send('The client has not been built yet. Run `npm run build`, then restart.'),
  );
}

const server = app.listen(PORT, () => {
  console.log(`\n  NEON CABINET listening on :${PORT}`);
  console.log(`  ${GAMES.length} games loaded — ${GAME_IDS.join(', ')}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n[server] ${signal} received, shutting down`);
    server.close();
    await store.close?.();
    process.exit(0);
  });
}
