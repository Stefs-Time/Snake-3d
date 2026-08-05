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

---

## Wave ten — cards, board games against the dice and the unseen, a ladder

Requested: more card games, more games against an opponent, crossword and
Scrabble named specifically. Neither of those two translates — a legal-move
Scrabble opponent needs a real dictionary of tens of thousands of words to
validate against, and a genuine crossword needs either a hard constraint-solve
to generate or a hand-authored puzzle set closer to "twelve puzzles" than "a
crossword game" — both against the house rule of shipping no dictionary and no
CDN. Word Ladder took the word-game slot instead: it wants the same "change a
letter, make a word" instinct without needing to validate an arbitrary guess,
because each ladder carries its own small, verified chain rather than a
dictionary.

| # | Game | Codename | Core loop |
| --- | --- | --- | --- |
| 26 | **Blackjack** | `blackjack` | Six-deck shoe, dealer stands on all 17s, hit/stand/double/split |
| 27 | **Gin Rummy** | `ginrummy` | Exact deadwood search drives both the knock button and the machine |
| 28 | **FreeCell** | `freecell` | Every card face up; supermove capacity computed, not assumed |
| 29 | **Checkers** | `checkers` | Forced capture, mandatory chains, alpha-beta against them |
| 30 | **Backgammon** | `backgammon` | Full rules including bear-off's oversized-die clause; no doubling cube |
| 31 | **Battleship** | `battleship` | Checkerboard-parity hunt, then target — 58 shots average to sink a fleet |
| 32 | **Word Ladder** | `wordladder` | Seventeen hand-verified chains, no dictionary behind any of them |

**What "verified before it shipped" meant this wave**

Every AI and every generator was checked against hand-built positions or
simulated games *before* being wired into a cabinet, the same discipline
`balance-bulwark.mjs` established two waves ago — a probe that lies is worse
than no probe, so the checks ran against pure extracted logic first, in
isolation, where a wrong answer could not be blamed on a rendering bug.

- **Checkers'** capture-chain generator was checked against eight hand-built
  board positions — a double-jump, a branch between two separate captures, a
  promotion that correctly stops a chain mid-jump even though the position
  otherwise allows continuing (a man does not gain king mobility until the
  turn after it earns it), and the standard opening's well-known fact of
  exactly seven legal first moves. Depth-9 alpha-beta measured 600ms–1.4s on a
  midgame position — long enough to freeze the tab, since this runs
  synchronously inside the frame loop the way Reversi's search does not need
  to. Hard mode is capped at depth 7, measured under 200ms.
- **Backgammon's** rules were checked against a fact anyone can verify without
  this codebase at all: the standard opening position is exactly 167 pips per
  side. Eight further positions confirmed bar re-entry exclusivity, blocked
  points, and both bear-off cases — including one built specifically to catch
  the single most common bug in an amateur implementation, an oversized die
  allowed to bear off while a farther checker still sits in the home board.
  The AI cannot search future dice rolls the way the board games here search
  future positions, so for whatever it actually rolls it tries every legal
  way to spend the dice and keeps whichever the position likes best —
  benchmarked at 10ms on a worst-case double-6 midgame position.
- **Battleship's** hunt-and-target AI was simulated against 200 random fleets
  before it ever faced a person: 58 shots on average to sink a full
  17-cell fleet, against roughly 100 for firing at random. Ship placement is
  shuffle-and-ready rather than click-to-place — the hunt algorithm never
  looks at where a human tends to put ships, only at hits and misses as they
  land, so hand-placing them would add a ritual without a real strategic
  choice against this particular opponent.
- **Gin Rummy's** deadwood search — every non-overlapping combination of melds
  a hand contains, not a heuristic guess — was checked against a run+set hand,
  a full 10-card gin hand, an 11-card worst-case single-suit run (200 search
  calls, 2ms), and a no-meld hand, before it became both the knock button's
  eligibility check and the machine's discard logic. Gin blocks both layoffs
  and undercuts, which a first pass got wrong for the rare case where the
  defender's own hand also happens to be a zero-deadwood hand.
- **FreeCell's** supermove capacity — `(free cells + 1) × 2^(empty columns,
  excluding the destination)` — is computed exactly rather than assumed
  unlimited, the mistake that makes a casual implementation feel wrong to
  anyone who already knows the game.
- **Word Ladder's** seventeen chains were checked structurally before any of
  them were written into the game file: every consecutive pair is the same
  length and differs in exactly one letter, never zero, never two. That is a
  fact about the strings, checkable with no dictionary at all. Whether the
  individual words are real rests on picking common, unambiguous ones by
  hand — the same trust boundary Hangman already draws around its categories.

**Also fixed**

- FreeCell's "FREE" label sat close enough to the top of its own canvas that
  it visually overlapped the DOM HUD's score readout on some layouts — the
  HUD's label-plus-value stack actually reaches about 47px, past the 34px
  band `hudPad.top` reserved for it. FreeCell's band is 46px now.

Catalog genres: the three card games joined Table (with Solitaire and Bingo),
the three new board games joined Board (with Tic Tac Toe, Connect Four and
Reversi), Word Ladder joined Word — no new genre filter needed. The hub's
number-word list was extended past thirty, and the game count on the hub, the
About page and the manifest description no longer hardcode a number that would
just go stale again next wave.

---

## Wave eleven — Bulwark's siege starts over

Requested: on every level increase, sell everything on the board, change the
board, let the player build again on the new map. Bulwark already had "level"
boundaries that meant something — the seven stage thresholds (Swarm, Armour,
Siege, Shades, Wardens, Onslaught) that already interrupt the game to
announce a genuinely new threat. Those are what trigger it, not every wave:
a reset every wave would turn a tower-defense game into "place towers, fight
one wave, repeat," which is a different and worse game.

On each stage boundary, every tower is refunded in full — not the normal 60%
sell rate, because the player is not choosing to give the board up, the road
is being pulled out from under them, and losing gold on top of losing the
whole layout would punish a decision they never made — and a freshly
generated road replaces the one that was there. The reset lands during the
break before the new stage's wave, not when the wave itself starts; doing it
at wave-start would spend the entire rebuild window on nothing.

The road generator only ever steps rightward in x as it turns, which is what
makes self-intersection structurally impossible rather than something to
detect and reject afterward: a vertical turn claims an x no earlier segment
used and none after it will revisit, while the row at each turn and the gap
between turns still vary enough that it reads as a real new layout, not a
cosmetic shuffle. 5,000 seeded runs produced zero degenerate paths — no
zero-length segments, nothing out of bounds — and left a buildable area that
never dropped below roughly 150 of the grid's 216 cells.

Verified by driving the actual game loop, not a recreation of its rules, past
several stage boundaries: a tower placed before wave 3 is sold back in full
the moment the Swarm-stage break begins, the road changes shape and length
under it, and the following wave starts clean on the new layout with no
console errors, confirmed both by inspecting state directly through the
cabinet's debug hook and by screenshot.

---

## Wave twelve — one map, drawn fresh

Correction to wave eleven, requested after playing it: the map change should be
an improvement, not a demolition — don't drop everything mid-run. So the reset
is gone entirely, and the randomness moved to where it costs nothing: the road
is now generated once at setup and stands for the whole siege. A new map every
game, never a new map mid-game.

That is the better trade in both directions. A board you keep is the point of
the genre — every tower is a bet on ground that has to still be worth holding
twenty waves later, and the bet only means anything if the ground stays; a
reset at each stage boundary turned all seven of them into a rebuild from
scratch on top of an already-new threat, which is the moment a player has the
least attention to spare. Meanwhile the thing the reset was actually good for
— never fighting the same layout twice — is fully delivered by generating at
setup, because a run is what a player replays.

The generator itself is unchanged and now does more work than it did: it draws
the map that decides the whole run rather than a mid-run shuffle. Its rightward
rule still makes self-intersection impossible by construction, and across
twelve fresh runs the roads measured 1044–1728px long and left 169–188 of the
grid's 216 cells buildable, so no run starts on a map that is degenerate in
either direction.

- `src/games/bulwark.js`: `setup()` builds from `#randomWaypoints()`; the
  hand-authored `WAYPOINTS` constant and `#resetBoard()` are deleted, along
  with the stage-boundary call that fired it

Verified by driving the real game loop past every stage threshold — Swarm,
Armour, Siege, Shades, Wardens, Onslaught — out to wave 27, twelve times: the
road's cell set and length are byte-identical from setup to the last wave in
every run, and all twelve runs drew a different map. The balance probe was then
run against both the old build and the new one, eight runs each, to confirm the
change is not a difficulty change hiding in a layout change: the keep falls on
a median wave 20 either way (old spread 15–25, new 20–25), so a generated road
is neither easier nor harder than the hand-drawn one it replaces.

---

## Wave thirteen — the wall at twenty-five, and a fifth tower

Reported: wave 25 is unbeatable — it gets harder than the board allows for.
That turned out to be exactly the right description, and literally true.

**Measuring it.** A second probe answers the question the balance probe cannot:
it fills every buildable cell with a level-3 tower, hands the player infinite
gold, and plays. That is the best board the rules permit, so the wave it dies
on is a hard ceiling — no skill or income beats it. The ceiling was wave 30,
and the board went from an untouched keep to dead inside that single wave. Wave
25 sat just under it, reachable only by a board no real economy could pay for.

**Why.** Two things grew without limit against a board that cannot.

Armour scaled linearly and forever, while tower damage stops at level three —
so the biggest hit in the game was fixed at 85 and armour eventually passed it.
By wave 25 a cannon landed 17 of its 85 on a boss; by wave 30 every tower in
the game was at the same 12% floor, which is both unwinnable and uninteresting,
since owning more than one kind of tower stops meaning anything. Armour now
stops at 3.25x base, holding a boss at 45.5 against that 85.

Boss health scaled like a wave's, and it should not: a wave of thirty is fought
by the whole board at once, but a single boss is only ever fought by the towers
covering the ground it stands on — and that number stops growing once the
roadside is built out. Total damage compounds with the economy; focused damage
does not. Bosses now take a gentler curve (`scaleExp`) and arrive one at a time
to begin with, rather than three abreast at wave 20 when the board is smallest.

The instrumentation is what found this rather than the reading: every loss the
probe recorded, at every wave, on every map, was a boss walking into the keep.
Not one grunt, tank, shade or warden ever took the keep down at any point in
any run. The late game was a boss check wearing a tower defense's clothes.

**The fifth tower.** The Lance: 250g, one enormous hit every 2.2s, and by far
the longest reach on the board — the only tower that can cover two legs of a
serpentine road at once. It is the answer to armour, and it adds no mechanic to
be one: armour is flat reduction, so a single huge hit is worth far more
against it than the same damage split up, which was already the rule. Its cost
is rate — it kills at most half an enemy a second, making it the worst tower in
the game against a swarm and the best against what walks in behind one.

**Where the curve landed.** A competent run now falls on a median wave 35,
spread 30–40, against a median of 20 before — and it clears wave 25 in fifteen
of sixteen runs, where half of them used to die at or before it. The ceiling
moved from 30 to 45. The failure also changed shape: tanks, shades and wardens
now get through too, so losing is the wave beating you rather than one enemy.

**Two bugs in the measuring instrument**, both of which had been quietly
lying — and both found only because the numbers stopped making sense:

- The balance probe stopped every run at forty game-minutes, which at about a
  minute a wave is about wave 40, and reported the wave it had reached as the
  wave it died on. Runs still at full health read exactly like losses, and its
  own "survives past wave 45" check could never have fired even once. Runs that
  hit the budget are now flagged and fail the probe rather than being reported.
- The pace comparison played one run per pace, which was sound while every game
  used the same hand-authored road. Against maps generated per game it was
  comparing three different maps: it reported spreads of ten and fifteen waves
  between paces that were identical. It now seeds `Math.random` before the page
  loads so all three paces play the same road, and fails if they did not.

Also: the road generator's length is now held to a 37–41 cell band. Road length
decides how many seconds every tower gets to shoot, which makes it the biggest
single lever on a run's difficulty — and once the map stands for the whole run
(wave twelve), an unlucky draw is not a different map but a worse game. It ran
29 to 48 cells, and a competent player fell anywhere from wave 20 to wave 40 on
the strength of that one number. Shape still varies freely; only the difficulty
it implies is pinned.
