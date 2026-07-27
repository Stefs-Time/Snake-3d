# NEON CABINET

An installable arcade. Fifteen games behind one front end, built to be added
to a home screen rather than bookmarked — it launches full screen, plays with
no connection, and keeps a global leaderboard when it has one.

Deploys to Railway from a clean clone with no manual steps.

```bash
npm install
npm run dev          # vite on :5173, api on :8080
npm run preview      # production build, served by the real server on :8080
```

---

## The lineup

| Game | What it is | Worth knowing |
| --- | --- | --- |
| **Snake 3D** | The headliner. A neon serpent on a floating arena. | Chase camera that banks into turns and pulls back as you grow. Steering is camera-relative, so "left" always means left on screen. The body is one `InstancedMesh` — a 200-segment snake is a single draw call. |
| **Chomp** | Maze chase. | The real 28×31 maze (244 dots, verified) and the original ghost AI: Blinky targets you, Pinky aims four tiles ahead, Inky doubles the vector from Blinky through a point in front of you, Clyde bolts for his corner inside eight tiles. Pinky's up-direction targeting bug is reproduced on purpose. |
| **Blockfall** | Stacker. | Seven-bag randomiser, full SRS wall-kick tables, hold slot, ghost piece, lock delay with a 15-move reset cap, back-to-back and combo scoring. |
| **Invaders** | Shoot the descending grid. | The formation speeds up as you thin it out — the 1978 hardware limitation, reproduced deliberately. Destructible shields erode in clusters; only the front alien in a column can fire. |
| **Bricks** | One ball against a wall. | Contact point on the paddle sets the exit angle, so aiming beats reacting. Multi-ball, laser, wide and slow drops. |
| **Vector** | Splitting rock field. | Momentum with no brakes, screen wrap, a saucer that leads its shots, and hyperspace with the classic one-in-eight chance of a bad jump. |
| **Paddles** | First to eleven. | The opponent's reaction delay and aim error shrink as the rally grows, so the rally *is* the difficulty curve. Paddle motion adds spin. |
| **2048** | Merge to 2048. | Slide resolved as compact-merge-compact, with movement recorded so tiles animate into place. One undo. |

And a quieter corner, all click-driven:

| Game | What it is | Worth knowing |
| --- | --- | --- |
| **Solitaire** | Klondike, draw three. | Click-to-move rather than drag: a click lifts a card *and* the run below it, a second click places it, a double-click sends it home. Full undo stack. |
| **Lexicon** | Five letters, six guesses. | Duplicate letters are marked with the proper two-pass rule — exact positions claimed first, "present" marks handed out only from what is left over. Solve one and another arrives, so a run is a streak. |
| **Word Search** | Ten words, eight directions. | Words cross wherever their letters agree, so the grid is genuinely tangled. The drag selection snaps to the nearest of the eight lines, so a sloppy diagonal still counts. |
| **Bingo** | Two cards, one caller. | Nothing daubs itself. The caller quickens as the bag empties, and a fresh number is worth four times one you nearly let slip. |
| **Minefield** | Minesweeper. | The first click is always safe — mines are laid *after* it, around the opening tile. Iterative flood fill, and chording on a satisfied number. |
| **Memory** | Pairs. | Twelve symbols drawn from paths rather than a font. Consecutive matches build a combo; clearing a board with no wasted flip pays a large bonus. |
| **Simon** | Watch, then repeat. | The original four tones, so past about six steps you stop memorising lights and start memorising a melody. Playback quickens as the sequence grows. |

---

## How it is put together

**No UI framework.** The whole interface is a ~120 line hyperscript helper
(`src/core/dom.js`) and five stylesheets. The entry bundle is about 22 kB
gzipped.

**Code splitting that matters.** Three.js is 120 kB gzipped and only Snake 3D
needs it, so it lives in its own chunk that is fetched when you walk up to that
cabinet. The hub and the other fourteen games never download it.

**No dictionary, no CDN.** The word games ship their own list — a curated 483
common five-letter words for Lexicon and seven themed sets for the word search
— because the arcade has to work with no network. Both games import one shared
module, so the bundle holds a single copy.

**No binary assets, at all.**

- Every sound effect is synthesised at runtime from oscillators and a noise
  buffer (`src/core/audio.js`). There is not one audio file in the repository.
- The app icons are generated during `npm run build` by `scripts/gen-icons.mjs`,
  which rasterises signed distance fields into an RGBA buffer and encodes PNGs
  with a hand-written encoder on top of Node's `zlib`. No image library, and
  nothing committed.

**A fixed-timestep loop.** The simulation runs in exact 1/60 s steps and
rendering interpolates between them, so a 144 Hz monitor plays identically to a
60 Hz laptop, and a slow frame never changes the physics.

**One input surface over four.** Keyboard, gamepad, an on-screen d-pad, and raw
touch all feed the same `held` / `pressed` interface, with edge-triggered
presses cleared once per tick so a single keypress can never fire twice.

**Offline is real.** A Vite plugin walks the actual build output and writes the
service worker with a precache manifest covering every hashed chunk — including
each game's lazily loaded module. After one visit the whole arcade works on a
plane, not just the pages you happened to open.

```
shared/catalog.js     the game catalog, imported by both client and server
server/               express: leaderboard api + static hosting
  store.js            json file store, upgrades itself to postgres
src/
  core/               loop, input, audio, fx, router, dom, settings
  ui/                 shell, hub, play host, leaderboard, settings, previews
  games/              one file per cabinet, lazily imported
    words.js          embedded word lists, shared by the two word games
scripts/
  gen-icons.mjs       dependency-free png icon generator
  sw-template.js      service worker, filled in at build time
  smoke.mjs           headless browser test over every route and game
```

---

## Leaderboard

```
GET  /api/health              { ok, uptime, store, games }
GET  /api/catalog             the game catalog
GET  /api/scores/:game?limit= top scores
POST /api/scores/:game        { initials, score, duration, meta } -> { rank, top }
POST /api/plays/:game         play counter
GET  /api/stats               totals and per-game rollup
```

Submissions are validated server-side — a per-game score ceiling, a minimum
duration for anything substantial, and initials forced to `[A-Z0-9]{1,3}` — and
rate limited per IP. Nothing else is stored or collected: preferences and
personal bests live in `localStorage`, and the only thing that ever reaches the
server is a score you deliberately submit.

**Storage.** With no configuration it writes a JSON file under `DATA_DIR`, which
survives restarts when that path is a mounted volume. Set `DATABASE_URL` and the
same API is served from Postgres instead — no code change, the store picks the
backend at boot and logs which one it chose.

---

## Deploying to Railway

1. Create a project from this repository. `railway.json` and `nixpacks.toml`
   already declare the build and start commands and a `/api/health` check.
2. Nothing else is required — it will boot and serve on Railway's `$PORT`.

Two optional extras:

- **Persistent scores without a database:** add a Volume, mount it at
  `/data`, and set `DATA_DIR=/data`.
- **Postgres:** add the Postgres plugin. It provides `DATABASE_URL`, and the
  store switches over on the next deploy.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Injected by Railway |
| `DATA_DIR` | `./data` | Where the JSON leaderboard lives |
| `DATABASE_URL` | unset | Switches the leaderboard to Postgres |

---

## Testing

```bash
npm run build
npm start &
npm run smoke
```

`smoke.mjs` drives a real headless Chromium: it loads every route and every
cabinet, waits for each game's chunk to boot, plays it with synthetic input,
checks the HUD is live, round-trips a score through the API, and renders the hub
at phone size. It fails on any console error, page error, or failed request, and
drops a screenshot of everything into `screenshots/`.

---

## Controls

Arrows or WASD to move, Space to fire or confirm, P or Esc to pause, R to
restart, M to mute. A connected gamepad is picked up automatically. On a
touchscreen you get an on-screen pad, and the puzzle games take swipes.

The card, word and board games are click-driven and show no overlay controls at
all — you tap the board itself, which works identically with a mouse or a
thumb.

---

## Credit

These are re-implementations written from the published rules and documented
behaviour of games that shaped the medium. All original trademarks belong to
their respective owners; no original assets or code are used here.
