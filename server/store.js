import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Leaderboard persistence.
 *
 * Two backends, one interface. With no configuration at all we keep scores in
 * a JSON file under DATA_DIR, which is enough for a single Railway service and
 * survives restarts when that path is a mounted volume. Set DATABASE_URL and
 * the same API is served from Postgres instead, no code changes needed.
 */

const MAX_PER_GAME = 100;

/* ------------------------------------------------------------------ file -- */

class FileStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'scores.json');
    this.dataDir = dataDir;
    /** @type {Record<string, Array<object>>} */
    this.tables = {};
    this.plays = {};
    this.writeTimer = null;
    this.writing = Promise.resolve();
  }

  get kind() {
    return 'file';
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.tables = parsed.tables ?? {};
      this.plays = parsed.plays ?? {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[store] could not read ${this.file}, starting empty:`, err.message);
      }
      this.tables = {};
      this.plays = {};
    }
  }

  /** Coalesce bursts of writes into one flush per tick-ish. */
  schedule() {
    if (this.writeTimer) return this.writing;
    this.writing = new Promise((resolve) => {
      this.writeTimer = setTimeout(async () => {
        this.writeTimer = null;
        const payload = JSON.stringify({ tables: this.tables, plays: this.plays });
        const tmp = `${this.file}.tmp`;
        try {
          await fs.writeFile(tmp, payload, 'utf8');
          await fs.rename(tmp, this.file);
        } catch (err) {
          console.error('[store] write failed:', err.message);
        }
        resolve();
      }, 250);
    });
    return this.writing;
  }

  async top(game, limit) {
    return (this.tables[game] ?? []).slice(0, limit);
  }

  async submit(game, entry) {
    const table = (this.tables[game] ??= []);
    table.push(entry);
    table.sort((a, b) => b.score - a.score || a.at - b.at);
    const rank = table.indexOf(entry) + 1;
    this.tables[game] = table.slice(0, MAX_PER_GAME);
    this.schedule();
    return { rank, ranked: rank <= MAX_PER_GAME };
  }

  async recordPlay(game) {
    this.plays[game] = (this.plays[game] ?? 0) + 1;
    this.schedule();
  }

  async stats() {
    const perGame = {};
    for (const [game, rows] of Object.entries(this.tables)) {
      perGame[game] = {
        entries: rows.length,
        best: rows[0]?.score ?? 0,
        bestBy: rows[0]?.initials ?? null,
        plays: this.plays[game] ?? 0,
      };
    }
    for (const [game, plays] of Object.entries(this.plays)) {
      perGame[game] ??= { entries: 0, best: 0, bestBy: null, plays };
    }
    return perGame;
  }

  async close() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      const payload = JSON.stringify({ tables: this.tables, plays: this.plays });
      await fs.writeFile(this.file, payload, 'utf8').catch(() => {});
    }
  }
}

/* -------------------------------------------------------------- postgres -- */

class PgStore {
  constructor(pool) {
    this.pool = pool;
  }

  get kind() {
    return 'postgres';
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id         BIGSERIAL PRIMARY KEY,
        game       TEXT        NOT NULL,
        initials   TEXT        NOT NULL,
        score      BIGINT      NOT NULL,
        meta       JSONB       NOT NULL DEFAULT '{}'::jsonb,
        at         BIGINT      NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS scores_game_score_idx ON scores (game, score DESC, at ASC);`,
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS plays (
        game  TEXT PRIMARY KEY,
        count BIGINT NOT NULL DEFAULT 0
      );
    `);
  }

  async top(game, limit) {
    const { rows } = await this.pool.query(
      `SELECT initials, score, meta, at FROM scores
        WHERE game = $1 ORDER BY score DESC, at ASC LIMIT $2`,
      [game, limit],
    );
    return rows.map((r) => ({
      initials: r.initials,
      score: Number(r.score),
      meta: r.meta,
      at: Number(r.at),
    }));
  }

  async submit(game, entry) {
    await this.pool.query(
      `INSERT INTO scores (game, initials, score, meta, at) VALUES ($1, $2, $3, $4, $5)`,
      [game, entry.initials, entry.score, JSON.stringify(entry.meta ?? {}), entry.at],
    );
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS ahead FROM scores
        WHERE game = $1 AND (score > $2 OR (score = $2 AND at < $3))`,
      [game, entry.score, entry.at],
    );
    // Keep the table from growing without bound.
    await this.pool.query(
      `DELETE FROM scores WHERE game = $1 AND id NOT IN (
         SELECT id FROM scores WHERE game = $1 ORDER BY score DESC, at ASC LIMIT $2
       )`,
      [game, MAX_PER_GAME],
    );
    const rank = rows[0].ahead + 1;
    return { rank, ranked: rank <= MAX_PER_GAME };
  }

  async recordPlay(game) {
    await this.pool.query(
      `INSERT INTO plays (game, count) VALUES ($1, 1)
        ON CONFLICT (game) DO UPDATE SET count = plays.count + 1`,
      [game],
    );
  }

  async stats() {
    const { rows } = await this.pool.query(`
      SELECT s.game,
             count(*)::int          AS entries,
             max(s.score)           AS best,
             coalesce(p.count, 0)   AS plays
        FROM scores s
        LEFT JOIN plays p ON p.game = s.game
       GROUP BY s.game, p.count
    `);
    const perGame = {};
    for (const r of rows) {
      perGame[r.game] = {
        entries: r.entries,
        best: Number(r.best ?? 0),
        bestBy: null,
        plays: Number(r.plays ?? 0),
      };
    }
    return perGame;
  }

  async close() {
    await this.pool.end();
  }
}

/* ---------------------------------------------------------------- factory -- */

export async function createStore(env = process.env) {
  if (env.DATABASE_URL) {
    try {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({
        connectionString: env.DATABASE_URL,
        ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        max: 4,
      });
      const store = new PgStore(pool);
      await store.init();
      console.log('[store] using postgres');
      return store;
    } catch (err) {
      console.error('[store] postgres unavailable, falling back to file:', err.message);
    }
  }
  const store = new FileStore(path.resolve(env.DATA_DIR || './data'));
  await store.init();
  console.log(`[store] using json file at ${store.file}`);
  return store;
}
