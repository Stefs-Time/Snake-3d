# NEON CABINET — Build Plan

A Railway-hosted, install-anywhere **PWA arcade**. One cabinet, many classics.
Offline-first, gamepad-aware, touch-friendly, with a server-backed global
leaderboard using real 3-letter arcade initials.

---

## 1. Product shape

| Layer | Choice | Why |
| --- | --- | --- |
| Client | Vanilla ES modules + Vite | No framework tax, tiny bundle, instant boot |
| 3D | Three.js | Only used by Snake 3D; code-split so 2D games never download it |
| Server | Node + Express | Railway's happy path, serves the built PWA + JSON API |
| Storage | JSON file, auto-upgrades to Postgres when `DATABASE_URL` exists | Works with zero config, scales when you add a DB |
| PWA | Hand-written service worker | Precache the shell, stale-while-revalidate assets, offline arcade |
| Audio | WebAudio synthesis, zero audio files | Chiptune SFX generated at runtime — nothing to download |
| Art | Procedural — CSS, canvas, generated PNG icons | No binary assets in the repo |

**Design language:** dark arcade room. Deep near-black background, neon cyan /
magenta / amber accents, chromatic CRT bloom, scanlines, subtle screen curvature,
and a monospace + condensed display type pairing. Everything animates on a
120ms/240ms curve. Reduced-motion and CRT-off switches respected.

---

## 2. The launch lineup (8 games)

Ordered by build priority. Each is a *simple* classic — one screen, one idea,
instantly readable, hard to master.

| # | Game | Codename | Core loop | Notable tech |
| --- | --- | --- | --- | --- |
| 1 | **Snake 3D** | `snake3d` | Grow the snake on a 3D arena floor without eating yourself | Three.js, instanced segments, smooth chase cam, bloom-ish emissive palette |
| 2 | **Pac-Man** | `chomp` | Clear the maze, dodge four ghosts, power up and hunt them back | Authentic scatter/chase waves + per-ghost target AI (Blinky/Pinky/Inky/Clyde) |
| 3 | **Tetris** | `blockfall` | Stack, clear lines, survive the ramp | 7-bag randomiser, SRS kicks, hold, ghost piece, lock delay |
| 4 | **Space Invaders** | `invaders` | Shoot the descending grid before it lands | Marching-speed-by-population, destructible shields, bonus UFO |
| 5 | **Breakout** | `bricks` | Break every brick with one ball | Angle-by-paddle-contact, multi-ball + laser + wide power-ups |
| 6 | **Asteroids** | `vector` | Survive a splitting rock field | Vector rendering, thrust/inertia, screen wrap, hyperspace |
| 7 | **Pong** | `paddles` | First to 11 against an AI that learns your pace | Difficulty ramps by rally length, spin from paddle motion |
| 8 | **2048** | `twenty48` | Merge tiles to 2048 | Slide/merge solver, undo, tile-spawn animation |

**Shared engine** (`src/core/`) gives every game: fixed-timestep loop with
interpolation, pause/resume, input abstraction (keyboard + gamepad + touch
d-pad + swipe), particle system, screen shake, scoring/combo, high-score
submission, and a consistent game-over flow.

---

## 3. Build order

1. **Scaffold** — package.json, Vite, Express, Railway config.
2. **UI first** (as requested) — boot sequence, cabinet shell, hub grid, game
   detail panel, HUD, pause/game-over overlays, leaderboard, settings. Fully
   clickable with stub games so the whole experience is real before any
   gameplay exists.
3. **Engine core** — loop, input, audio, particles, storage, API client.
4. **Games** — in the priority order above.
5. **PWA** — manifest, generated icons, service worker, install prompt,
   offline fallback.
6. **Server** — leaderboard API, rate limiting, score validation, health check.
7. **Polish + verify** — production build, headless smoke test with screenshots
   of every route, Lighthouse-grade PWA checks.

---

## 4. Leaderboard API

```
GET  /api/health                  -> { ok, uptime, games }
GET  /api/scores/:game?limit=10   -> [ { initials, score, at, meta } ]
POST /api/scores/:game            -> { rank, top }   body: { initials, score, meta }
GET  /api/stats                   -> { plays, totalScore, perGame }
```

Scores are sanity-checked server-side (per-game ceiling, monotonic-time floor,
initials `^[A-Z0-9]{1,3}$`) and rate-limited per IP. Nothing sensitive is
stored — three characters and a number.

---

## 5. Definition of done

- [ ] `npm run build && npm start` serves the whole arcade on `$PORT`
- [ ] Installable PWA (manifest + SW + maskable icons), passes offline reload
- [ ] All 8 games playable with keyboard, gamepad, and touch
- [ ] Global leaderboard writes and reads through the API
- [ ] Zero binary assets committed; icons generated at build time
- [ ] Deploys to Railway from a clean clone with no manual steps
