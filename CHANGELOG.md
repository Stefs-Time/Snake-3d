# Changelog

What was built after the original eight, in the order it was asked for. The
plan those eight came from is in [PLAN.md](PLAN.md); the contract a cabinet
implements is in [docs/adding-a-game.md](docs/adding-a-game.md).

---

## Wave one — the arcade

Snake 3D, Chomp, Blockfall, Invaders, Bricks, Vector, Paddles, 2048, behind an
installable PWA shell with a leaderboard. Built to `PLAN.md`.

**Fixed before it shipped** — all four found by driving a real browser rather
than by reading the code, and two of them made the app entirely non-functional:

- `Loop` bound a private method in its constructor. A private method is not
  writable, so the constructor threw and *no game ever rendered*.
- A wrapper element broke the height chain, so every cabinet sized itself
  off-screen.
- `Object.assign(node.style, …)` silently ignores CSS custom properties, so no
  per-game accent colour was ever applied.
- The service worker's build-time placeholders were substituted into its own
  doc comment first — `.replace` takes the first occurrence — so the worker
  threw on parse, registration failed silently, and offline never worked. The
  build now asserts the substitution landed.


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

## Wave four — pen and paper

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


---

## Wave five — hold the line, and swap tiles

Two requests, one batch: tower-defense-like games, and tile-swap games.

| # | Game | Codename | Core loop |
| --- | --- | --- | --- |
| 23 | **Bulwark** | `bulwark` | Grid tower defense: build, upgrade, sell wave bounties |
| 24 | **Bastion** | `bastion` | Missile Command: per-battery ammunition is the constraint |
| 25 | **Cascade** | `cascade` | Match three with cascading chains and two specials |

**Notes**

- Bulwark tracks enemies by distance along the road rather than by position.
  That one choice makes the only correct targeting rule — furthest along —
  a `max()` rather than a pathfinding problem, and it makes the road's shape
  free to change without touching the combat code.
- Bastion's design pressure is entirely in ammunition being per battery
  rather than pooled. Defending one flank drains it, and the next shot has to
  come the long way.
- Cascade rejects a swap that makes nothing, so the board has to be searched
  for a match before the move is committed. A deadlocked board reshuffles.
- The catalog gained a Defense genre; the hub filter picks it up for free.


---

## Wave six — say what the game is

Twenty-five cabinets, and every one of them opened straight into play with no
rules anywhere near it. The catalog already held a `blurb` and three control
lines per game — the blurb only ever appeared on the About page, and only the
*first* control line was ever rendered. Fifty of the seventy-five lines had
never been shown to anyone.

**How to play**

- A card on the first visit to each cabinet, built from the blurb, every
  control line, the live option choices with their hints, and the score label
  with your personal best. The run stays paused behind it.
- Recallable from `?` or the info button. Seen state is per cabinet.
- The HUD hint cycles through all three control lines instead of pinning the
  first. A hint the game sets itself takes the leading slot rather than
  cancelling the cycle.
- Option hints moved out of a `title` attribute — which a touchscreen can never
  show — and out of a toast fired *after* the change was committed. They now
  sit under the segmented control, describing the live choice.

**Touch**

Asked for after the card landed: replacements for controls a phone does not
have. The audit found the problem was worse than wording.

- Which on-screen buttons appeared was a property of the touch *scheme*, so
  Blockfall's hold slot, Vector's hyperspace and Solitaire's undo could not be
  reached on a phone at all. A game now names the buttons it reads and only
  those appear — labelled with the verb, not "A" and "B".
- Every cabinet carries a second set of control lines for touch, used by both
  the card and the HUD. `setHint` takes a touch variant for the same reason.
- The HUD hint clears the d-pad instead of being read through it.

**Fixed**

- `Input.reset()` drops latched edges whenever the loop stops. A key pressed
  while the loop was paused was never consumed by a tick, so closing an overlay
  with Esc immediately re-paused the game it had just resumed. Every cabinet
  had been sitting behind the pause overlay scoring zero — and the smoke test
  passed anyway, because it only checked that a HUD score *element* existed.
  It now checks the loop is genuinely running.
- `settings` state aliased the `DEFAULTS` maps, so recording a score mutated
  the defaults.

**Documentation**

- `docs/adding-a-game.md` — the `BaseGame` contract end to end: declarations,
  `hudPad`, the input surface, the two rules that make a game work on a phone,
  options, and the `?debug` hook.
- The wave log moved out of `PLAN.md`, which had become a changelog while
  still opening as a forward-looking plan for eight games, into this file.


---

## Wave seven — Bulwark could not be lost

Reported: enough level-three towers and nothing gets through. Measured before
changing anything, and the report was right — worse, the game got *easier*
every wave past about six.

The cause was a mismatch of growth rates, not a number that was too small.
Gold income per wave grew linearly, so cumulative gold — and the damage a
defence can field — grew quadratically. Enemy health grew linearly and waves
grew proportionally longer, so the damage a wave *demanded per second* grew
only linearly. Quadratic supply against linear demand: a normalised model of
the old curve sat at 1.0 on wave six and 6.2 on wave thirty-eight, climbing
the whole way.

**The curve**

- Health scales geometrically rather than linearly, so demand can outrun a
  compounding economy instead of trailing it forever.
- Waves compress: the same enemies arrive in less time as the siege tightens.
  This raises demand without adding bodies to kill — and every extra body was
  extra income, which was part of the problem.
- Armour scales too, and the damage floor is a percentage rather than a flat
  point, so a wall of the cheapest fast-firing tower stops being a universal
  answer and the big-hit towers earn their cost.
- Counts grow more slowly, the wave-clear bonus is trimmed, and upgrades cost
  a little more.

**The staging**

Seven named stages, each announced on the wave it begins, because every one of
them changes what a working defence looks like: Skirmish, Swarm, Armour, Siege
(bosses every fifth wave from ten), Shades, Wardens, Onslaught.

- **Shades** are fast and cannot be chilled, so Frost stops being a universal
  answer.
- **Wardens** absorb 35% of damage dealt to anything near them, drawn as a
  shield bubble — the correct play is to break the support, not out-damage it.
- Waves are interleaved rather than marched out in blocks, and a boss is
  placed in traffic rather than alone at either end.
- The panel shows the next wave's roster during the build break, in the space
  the selected-tower readout leaves empty. Calling a wave early was a gamble
  without it, and a new kind of enemy used to arrive with no warning at all.

**Verified**

`npm run balance` plays the real cabinet headlessly with a scripted player and
reports the wave the keep falls on. A competent run now ends on wave 15; a
perfect one that always claims the early-wave bounty ends on 25. It fails the
build if either drifts past 45.

Also fixed: the sell button overlapped the call-wave bar by 18 pixels whenever
a tower was selected.


---

## Wave eight — the controls come off the playfield

Reported: Chomp is unusable on a phone. Driving it with real touch events
showed the plumbing was fine — presses registered, holds registered, swipes
queued, the games reacted. The controls were simply in the wrong place and the
wrong size.

- The d-pad was an overlay *inside* the cabinet frame, painted across the
  bottom-left of the maze — you could not see the thing you were steering. It
  is now a deck below the screen in portrait, and two columns flanking the
  cabinet in landscape. On most cabinets this costs no playfield at all: a
  phone in portrait sizes the frame by its width, so the deck fills space the
  letterbox was wasting.
- Keys were 42px, under both Apple's 44pt minimum and Material's 48dp. They
  are 56px in portrait, 48px in landscape.
- Because the controls sat inside the frame, every press also reached the
  frame's own pointer handler, so a thumb sliding off a key registered as a
  swipe. Moving them out removed the cross-talk.
- A cabinet that declares no d-pad and no buttons — the pointer games — now
  collapses the deck instead of showing an empty band.
- The HUD is DOM text over a canvas that scales, so on a short frame it stayed
  full size and ran into the game's own labels. It now scales from the frame's
  real width, and the hint stays on one line rather than wrapping over the
  bottom of Blockfall's well.
- All four nav destinations now fit a 360px phone. "About" used to sit off the
  edge in a horizontal scroll nobody would find.

**A grid trap worth writing down.** Giving the deck `grid-row: 2` in landscape
squashed the cabinet to a third of its height. CSS Grid places items with a
definite position *before* auto-placed ones, so the deck claimed row 2 and the
auto-placed screen was pushed into row 3. All three rows are explicit now.

The smoke test asserts, on a phone and again turned sideways, that no control
overlaps the playfield, none is under 44px, none is off screen, the page never
scrolls sideways, the cabinet keeps its height, and every nav item is on the
bar.


---

## Wave nine — the card you could not dismiss, and a faster siege

Two reports: the first-visit card could not be closed on a phone, and Bulwark's
enemies walk too slowly.

**The card, and every other overlay**

The Start button was unreachable on every phone size and both orientations —
the panel ran to 1209px inside a 585px overlay. `max-height: 100%` was
clamping nothing: the overlay's grid row was implicitly `auto`, so it grew to
fit the panel, and the panel's percentage resolved against a row that had
already stretched to the panel's own height. The row is `minmax(0, 1fr)` now.

That was the start of it rather than the whole of it.

- Overlays no longer live inside the cabinet frame. A wide game letterboxes the
  frame to a fraction of the window — Bulwark on a 768px tablet gets 480px —
  and a game-over panel with initials entry does not fit that. They cover the
  screen area, or on a touchscreen the whole play view, since there the control
  deck would take a third of the height as well.
- Every panel is now a scrolling middle with pinned actions, so "Start", "Play
  again" and "Submit score" are always where they appear to be. Entering
  initials is the point of the game-over screen, so it is pinned with the
  actions rather than left below a fold.
- A phone held sideways gets a two-column panel: score and breakdown on the
  left, initials and buttons on the right. Stacked it could not fit 340px
  however tightly it was packed.
- Overlay hints all name a key, so they are hidden on a touchscreen.

Verified across twelve viewports from 320x568 to 1920x1080, in both
orientations, tapping for real rather than with a forced click. The smoke test
now checks the card, the pause screen, the game-over screen and the score
submission at three phone sizes.

**Bulwark tempo**

Pace became three steps — Calm, Brisk (1.6x), Blitz (2.4x) — where the
multiplier scales the entire simulation rather than just the build clock.

Two leaks had to be closed for that to be a tempo and not a difficulty:

- The build break used to shorten with the pace. Calling a wave early pays ten
  gold a second, so a shorter break quietly halved the player's income and the
  fast paces fell ten waves sooner. The break is twenty game-seconds at every
  pace — and since speed scales it, that is still only eight real seconds on
  Blitz. The clock is a rule; only rates may scale.
- Tower cooldowns and spawn gaps were assigned rather than accumulated, so each
  fire discarded its overshoot. That made every rate slightly slower than
  nominal, and more so the larger `dt` was, costing the fast paces a few
  percent of their damage. They carry the remainder now, which makes the rates
  independent of the step size at any speed.

`npm run balance` asserts that pace does not move the wave the keep falls on. A
sweep of nine time scales puts eight on wave 25 and one a boss cliff away with
no trend, so the check allows one cliff of spread — that is the resolution the
measurement actually has.
