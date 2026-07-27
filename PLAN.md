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


---

## Wave two — the quiet corner

Added after the first eight shipped, on request: card, word and board games to
sit alongside the arcade cabinets. All seven are pointer-driven, which needed
one piece of engine work first.

| # | Game | Codename | Core loop |
| --- | --- | --- | --- |
| 9 | **Solitaire** | `solitaire` | Klondike draw-three, click-to-move, full undo |
| 10 | **Lexicon** | `lexicon` | Five-letter word guessing, streak-based scoring |
| 11 | **Word Search** | `wordsearch` | Themed 12x12 grids, drag to claim, against a clock |
| 12 | **Bingo** | `bingo` | Two cards, an accelerating caller, manual daubing |
| 13 | **Minefield** | `minefield` | Minesweeper with a safe first click and chording |
| 14 | **Memory** | `memory` | Pairs with combo scoring and a per-round clock |
| 15 | **Simon** | `simon` | Growing tone sequence, three strikes |

**Engine additions**

- A `point` touch scheme that hides the overlay d-pad and fires an action on
  pointer-down, since these games are played by tapping the board itself.
- Pointer press/release edges on `Input`, cleared per tick like key presses, so
  a click is handled exactly once however many simulation steps a frame runs.
- `BaseGame.mouse`, giving pointer coordinates already translated into game
  space with the HUD band subtracted, plus `hits()` and `roundRect()`.

**Also fixed in this pass**

- Chomp: an actor whose x drifted negative in the tunnel desynchronised from
  the tile it stood on, and would then glide across the whole maze without a
  single wall check. Positions are now normalised before any tile maths.
- Chomp: an instant reversal could flip direction mid-loop with no wall check
  and advance a full tile into it. Reversals are validated, and `#move` now
  refuses to advance off a tile centre into anything it cannot enter.
- Chomp: blank padding outside the maze was walkable; it is now solid.


---

## Wave three — cabinet options

Requested after wave two: Snake 3D's camera pivoted with the snake, which made
"left" mean a different direction from one moment to the next. Rather than
removing the chase camera, it became a choice — and that needed a general
mechanism, since Solitaire wanted one too.

**Engine**

- `BaseGame.options`: a game declares its choices, the host renders a segmented
  control in the play bar and remembers each choice per game in `localStorage`.
- A game implementing `onOptionChange(id, value)` and returning true applies a
  change live; anything else restarts the run.

**Snake 3D**

- **Fixed** (now the default) — one vantage point over the whole arena, and the
  yaw settles to zero so input is read against the world axes. Left is west.
- **Chase** — the original banking follow-cam with relative steering. Worth
  1.3x, since the handicap is real.
- Fixed frames the arena by narrowing the lens to 40 degrees rather than
  dollying in, which would have steepened the angle and flattened the 3D read.
  The two focal lengths are lerped, so switching modes reads as a zoom.

**Solitaire**

- **Draw one** — every card in the stock is reachable.
- **Draw three** (default) — the traditional game, 1.25x on every award.

Both games record the chosen mode in the score's metadata, so the leaderboard
shows what a run was played under instead of silently mixing two difficulties.


---

## Wave five — pen and paper

Requested: more quick-to-learn old-school games, sudoku and tic tac toe named.
The biggest gap in the arcade was head-to-head play — twenty-two cabinets and
not one opponent — so three of the seven are board games with a real search
behind them.

| # | Game | Codename | Core loop |
| --- | --- | --- | --- |
| 16 | **Tic Tac Toe** | `tictactoe` | Minimax that errs on purpose, less each match |
| 17 | **Connect Four** | `connectfour` | Alpha-beta, depth three to seven |
| 18 | **Reversi** | `reversi` | Positional search: corners, mobility, then material |
| 19 | **Sudoku** | `sudoku` | Generated with a uniqueness check on every dug hole |
| 20 | **Lights Out** | `lightsout` | Generated from solved, so always solvable, with a par |
| 21 | **Fifteen** | `fifteen` | Shuffled by legal moves, never an impossible board |
| 22 | **Hangman** | `hangman` | Categorised words, allowance shrinks with the streak |

**Hub**

Twenty-two cabinets is too many to scan, so the wall gained genre filters
driven by the catalog. The genres were also consolidated from twelve to six —
half of them had been singletons, which is a filter that filters nothing.
Switching genre disposes the old previews and attaches new ones rather than
hiding cards, so off-screen animations stop costing anything.
