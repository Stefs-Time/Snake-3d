# Adding a cabinet

A game is one file in `src/games/`, one entry in `shared/catalog.js`, one line
in the loader, and one preview. Nothing else in the arcade needs to know it
exists — the hub, the leaderboard, the how-to-play card, the touch controls and
the service worker all read it from those two places.

This walks the whole thing end to end.

---

## 1. The game file

```js
// src/games/lightsout.js
import { BaseGame } from '../core/game.js';

export default class LightsOut extends BaseGame {
  static id = 'lightsout';       // must match the catalog id
  static width = 520;            // logical units — never pixels
  static height = 520;
  static touch = 'point';

  setup() { /* build the first board */ }
  update(dt) { /* dt is always exactly 1/60 */ }
  draw(ctx, alpha) { /* alpha is the fraction into the next step */ }
}
```

`setup` runs on every start *and* every restart, so it must fully reset state —
treat the constructor as "allocate" and `setup` as "begin".

### Declarations

| Static | Default | What it does |
| --- | --- | --- |
| `id` | — | Leaderboard key. Must match `shared/catalog.js`. |
| `width` / `height` | `640` / `480` | The playfield in logical units. The host scales the canvas and hands you a context already in these units, so you never look at pixels or `devicePixelRatio`. |
| `renderer` | `'2d'` | `'webgl'` means you own the canvas — `draw` gets `null` and you implement `resize(w, h, dpr)`. Only Snake 3D does this. |
| `touch` | `'dpad'` | Which on-screen controls appear: `dpad`, `move`, `swipe`, `aim`, `point`, `none`. |
| `touchButtons` | `{}` | `{ action, secondary }` — the label on each on-screen button. A key you omit hides that button. |
| `smooth` | `false` | `true` lets the browser interpolate the upscale; `false` keeps hard pixels. |
| `hudPad` | `{ top: 0, bottom: 0 }` | Letterbox bands for the HUD. See below. |
| `hudLabels` | `{ score, secondary }` | The words under the two HUD numbers. |
| `options` | `[]` | Player-facing choices. See below. |

### hudPad

The HUD floats over the canvas. If your playfield uses the full height, the
score sits on top of it. `hudPad` reserves bands the game does not draw into:

```js
static hudPad = { top: 34, bottom: 0 };
```

The host grows the canvas by that much, clears the whole thing, then shifts the
origin down by `top`. **Your coordinates do not change** — `(0, 0)` is still the
top-left of the playfield, and `this.height` is still the playfield height.
`GameClass.pixelHeight` is the full canvas including the bands, and only the
host uses it.

---

## 2. Input

`this.input` is one interface over keyboard, gamepad, the on-screen d-pad and
raw touch. Actions are `up`, `down`, `left`, `right`, `action`, `secondary`,
`pause`, `restart`.

```js
this.input.held('left')        // true while down
this.input.pressed('action')   // true once per press — edge triggered
this.input.keyPressed('KeyC')  // a specific physical key, same edge rule
this.input.axisX()             // -1 / 0 / 1, or the analogue stick
this.input.takeSwipe()         // consumes a swipe: 'up' | 'down' | ... | null
this.mouse                     // { x, y, down, pressed, released } in game space
```

Edges are cleared once per simulation tick, so a single press can never be
handled twice however many steps a frame runs.

`this.mouse` is already translated into your coordinates with the HUD band
subtracted, so `hits(m.x, m.y, ...)` works against the same numbers you drew
with.

### Making it work on a phone

Two rules, and the arcade breaks visibly if you skip either.

**Declare every button you read.** `pressed('secondary')` does nothing on a
touchscreen unless `touchButtons.secondary` exists, because the button is not
rendered. Label it with the verb, not a letter:

```js
static touchButtons = { action: 'DROP', secondary: 'HOLD' };
```

**Never name a key in text a phone will read.** Both the catalog entry and
`setHint` take a touch variant:

```js
this.host.setHint(
  '← → to move · Space to fire',   // keyboard
  'Pad to move · FIRE to shoot',   // touch
);
```

If a mechanic has no touch equivalent at all, draw the control on the canvas —
Sudoku's number pad, Minefield's flag chip and Lexicon's keyboard are all done
that way, and they work identically with a mouse.

The host puts the controls in their own deck below the cabinet (or flanking it
in landscape), never on the playfield, and collapses the deck entirely for a
game that declares no buttons and no d-pad. You do not position anything —
declaring `touch` and `touchButtons` is the whole job.

---

## 3. Options

A game declares its choices; the host renders a segmented control in the play
bar, remembers the value per game in `localStorage`, and shows the `hint` under
the control and on the how-to-play card.

```js
static options = [
  {
    id: 'size',
    label: 'Board',
    default: '5',
    choices: [
      { value: '4', label: '4x4', hint: 'Sixteen lights. A warm-up.' },
      { value: '5', label: '5x5', hint: 'The original puzzle.' },
    ],
  },
];

setup() {
  this.size = Number(this.option('size'));
}
```

By default changing an option restarts the run. Implement `onOptionChange(id,
value)` and return `true` to apply it live instead:

```js
onOptionChange(id, value) {
  if (id !== 'camera') return false;
  this.mode = value;
  return true;   // no restart
}
```

Write the `hint` as a sentence about consequence, not a restatement of the
label — it is the only explanation the player gets before choosing.

**If an option changes the difficulty**, multiply the award and record the mode
in `this.meta`, so the leaderboard never silently mixes two different games:

```js
this.addScore(base * (this.drawCount === 3 ? 1.25 : 1));
this.meta.draw = this.drawCount;
```

---

## 4. What you get for free

```js
this.addScore(100, { x, y })   // scores and floats a popup at that point
this.setLives(3)               // HUD pips
this.setLevel(4)               // HUD secondary number
this.banner('LEVEL 4')         // big centred callout
this.play('coin')              // synthesised sfx — no audio files exist
this.end()                     // game over, overlay, score submission
this.particles / this.popups / this.shake
this.random                    // seeded rng, so a run is reproducible
this.meta                      // anything here rides along with the score
```

Call `this.updateEffects(dt)` in `update` and `this.drawEffects(ctx)` in `draw`
or the particles and popups never move.

Drawing helpers: `clear`, `text`, `glowRect`, `glowCircle`, `glowLine`,
`roundRect`, `drawGrid`, `hits`.

---

## 5. Register it

**`src/games/index.js`** — one line, and it must stay a literal `import()` so
Vite can split the chunk:

```js
lightsout: () => import('./lightsout.js'),
```

**`shared/catalog.js`** — the entry both the client and the server read:

```js
{
  id: 'lightsout',
  title: 'Lights Out',
  codename: 'LGHTS',
  tagline: 'Press one, five change.',
  blurb: 'Two or three sentences of actual rules...',
  year: 1995,
  genre: 'Puzzle',                    // an existing genre, or the hub gains a filter
  accent: '#f5d90a',
  accent2: '#ff7ac6',
  glyph: 'M12 3v2M...',               // a 24x24 SVG path
  controls: ['Click a light to toggle it', 'Its neighbours toggle too', 'Beat par for a bonus'],
  controlsTouch: ['Tap a light to toggle it', 'Its neighbours toggle too', 'Beat par for a bonus'],
  scoreLabel: 'Score',
  scoreCeiling: 500_000,              // the server rejects anything above this
  is3d: false,
}
```

`blurb` and both control arrays are what the how-to-play card is built from, so
this is where a player actually learns the game. Exactly three control lines —
the HUD cycles through them.

**`src/ui/previews.js`** — a small attract-mode animation for the hub card,
keyed by id. They all share one `requestAnimationFrame` and pause when
scrolled out of view; write it as a pure function of a time value.

---

## 6. Verify it

```bash
npm run build && npm start &
npm run smoke
```

The smoke test loads every cabinet, asserts the how-to-play card appears with
every control line and dismisses, plays the game with synthetic input, checks
the loop is genuinely still running afterwards, and fails on any console error,
page error or failed request. Screenshots land in `screenshots/`.

**Look at the screenshot.** The test cannot tell you the board is off-centre or
that a panel overflows its box.

If random input cannot reach your mechanic — a match-three needs two adjacent
gems that actually swap — add `?debug` to the URL and drive `window.__cabinet`
directly:

```js
const c = window.__cabinet;              // the live PlayHost
c.game.grid[3][4] = 2;                   // reach into real state
const { width, height } = c.GameClass;   // read geometry, never hardcode it
```

Read the geometry from the class. A probe that hardcodes the canvas size clicks
in the wrong place, reports total failure, and is worse than no probe at all.
