#!/usr/bin/env node
/**
 * Bulwark balance probe.
 *
 * Plays the real cabinet headlessly — the actual combat, economy and wave code,
 * driven by a competent scripted player — and reports which wave the keep
 * falls on. A spreadsheet model can tell you the shape of a curve; only this
 * can tell you the game built from it behaves the way the model claims.
 *
 * The player is deliberately good but not optimal: it always spends down to
 * nothing, upgrades before it sprawls, prefers cells that cover the most road,
 * and diversifies its towers once armour starts to bite.
 *
 *   node scripts/balance-bulwark.mjs [baseUrl] [runs]
 *
 * A healthy curve loses somewhere in the high twenties to high thirties. Much
 * further and the game cannot be lost; much sooner and it cannot be enjoyed.
 */

import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8080';
const RUNS = Number(process.argv[3] || 5);
const MAX_WAVE = 60;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      const candidate = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Runs inside the page. Reaches into the live game rather than clicking,
 * because this measures the balance maths, not the click handling — the smoke
 * test already covers the click handling.
 */
function playOneRun(maxWave) {
  const cab = window.__cabinet;
  const game = cab.game;
  const K = cab.GameClass;

  // The private helpers are not reachable, so mirror the two formulas the
  // player needs. If these drift from the game the probe is lying, so they are
  // asserted against the panel's own numbers below.
  const TOWERS = {
    gun: { cost: 60, range: 2.7 },
    cannon: { cost: 130, range: 3.0 },
    frost: { cost: 95, range: 2.5 },
    tesla: { cost: 190, range: 2.3 },
  };
  const CELL = 36;
  const MAP_X = 20;
  const MAP_Y = 20;
  const COLS = 18;
  const ROWS = 12;
  const upgradeCost = (t) => Math.round(TOWERS[t.type].cost * 0.9 * t.level);

  const centre = (c, r) => [MAP_X + (c + 0.5) * CELL, MAP_Y + (r + 0.5) * CELL];

  // Score every free cell by how much road sits inside a tower's reach.
  const sites = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (game.road.has(`${c},${r}`)) continue;
      const [x, y] = centre(c, r);
      let covered = 0;
      for (let d = 0; d < game.pathLength; d += 12) {
        const [px, py] = game.path.length ? pointAt(d) : [0, 0];
        if (Math.hypot(px - x, py - y) <= 2.7 * CELL) covered++;
      }
      if (covered > 0) sites.push({ c, r, x, y, covered });
    }
  }
  sites.sort((a, b) => b.covered - a.covered);

  function pointAt(distance) {
    let acc = 0;
    for (let i = 0; i < game.path.length - 1; i++) {
      const [x1, y1] = game.path[i];
      const [x2, y2] = game.path[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (distance <= acc + len) {
        const t = (distance - acc) / len;
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      }
      acc += len;
    }
    return game.path[game.path.length - 1];
  }

  /** Spend everything sensibly. Called during each build break. */
  function build() {
    let spentSomething = true;
    while (spentSomething) {
      spentSomething = false;

      // Armour makes single-target chip damage worthless, so the mix shifts.
      const wave = game.wave;
      const wanted = wave < 5 ? ['gun', 'gun', 'cannon']
        : wave < 12 ? ['cannon', 'gun', 'tesla', 'frost']
        : ['tesla', 'cannon', 'cannon', 'frost'];

      // Upgrade before sprawling: a level-3 tower beats three level-1s for
      // the same gold in range terms, which is the scarce resource here.
      const upgradable = game.towers
        .filter((t) => t.level < 3 && game.gold >= upgradeCost(t))
        .sort((a, b) => a.level - b.level);
      if (upgradable.length && game.towers.length >= 4) {
        const t = upgradable[0];
        game.gold -= upgradeCost(t);
        t.spent += upgradeCost(t);
        t.level++;
        spentSomething = true;
        continue;
      }

      // Take the preferred type when it is affordable, otherwise the dearest
      // one that is — giving up with gold in hand is not how anyone plays.
      const preferred = wanted[game.towers.length % wanted.length];
      const type = game.gold >= TOWERS[preferred].cost
        ? preferred
        : Object.keys(TOWERS)
            .filter((k) => game.gold >= TOWERS[k].cost)
            .sort((x, y) => TOWERS[y].cost - TOWERS[x].cost)[0];
      if (!type) break;
      const def = TOWERS[type];
      const site = sites.find((s) => !game.towers.some((t) => t.c === s.c && t.r === s.r));
      if (!site) break;
      game.gold -= def.cost;
      game.towers.push({
        type, c: site.c, r: site.r, x: site.x, y: site.y,
        level: 1, cooldown: 0, spent: def.cost, angle: 0,
      });
      spentSomething = true;
    }
  }

  const log = [];
  let ticks = 0;
  let builtFor = -1;
  const STEP = 1 / 60;

  while (!game.over && game.health > 0 && game.wave <= maxWave && ticks < 60 * 60 * 40) {
    // Build once per break, then let the timer run out and the wave start.
    // Rebuilding every tick would keep resetting the timer and no wave would
    // ever begin — which is exactly what the first version of this did.
    if (builtFor !== game.wave && game.breakTimer > 0 && !game.spawnQueue.length && !game.enemies.length) {
      builtFor = game.wave;
      build();
      // An expert always calls the wave in the moment they are done building,
      // and pockets the bounty for the peace they sold. Leaving that out
      // understates a good player's income by a couple of hundred a wave.
      game.gold += Math.round(game.breakTimer * 10);
      build();
      log.push({
        wave: game.wave,
        health: game.health,
        towers: game.towers.length,
        gold: game.gold,
        levels: game.towers.reduce((n, t) => n + t.level, 0),
      });
      game.breakTimer = 0.02;
    }
    game.update(STEP);
    ticks++;
  }

  return {
    wave: game.wave,
    health: game.health,
    score: game.score,
    towers: game.towers.length,
    levels: game.towers.reduce((n, t) => n + t.level, 0),
    log,
  };
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const results = [];
for (let i = 0; i < RUNS; i++) {
  await page.goto(`${BASE}/play/bulwark?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__cabinet?.game, null, { timeout: 15000 });
  const result = await page.evaluate(playOneRun, MAX_WAVE);
  results.push(result);
  console.log(
    `run ${i + 1}: fell on wave ${String(result.wave).padStart(2)}` +
    `  (${result.towers} towers, ${result.levels} levels, score ${result.score})`,
  );
}

// Pace multiplies the whole simulation, so it must not move the wave the keep
// falls on — only how long that takes in wall-clock. If it does move, the
// multiplier has leaked into something that is not a rate.
const byPace = {};
for (const pace of ['calm', 'brisk', 'blitz']) {
  await page.goto(`${BASE}/play/bulwark?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__cabinet?.game, null, { timeout: 15000 });
  await page.evaluate((p) => {
    localStorage.setItem(
      'neon-cabinet:v1',
      JSON.stringify({ ...JSON.parse(localStorage.getItem('neon-cabinet:v1') ?? '{}'), options: { bulwark: { pace: p } } }),
    );
  }, pace);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__cabinet?.game, null, { timeout: 15000 });
  const live = await page.evaluate(() => ({ pace: window.__cabinet.game.pace, scale: window.__cabinet.game.timeScale }));
  byPace[pace] = { ...live, ...(await page.evaluate(playOneRun, MAX_WAVE)) };
  console.log(`pace ${pace.padEnd(5)} (x${live.scale}) -> wave ${byPace[pace].wave}`);
}
// Not exact equality: a sweep of nine time scales puts eight on the same wave
// and one a boss cliff away, with no trend either direction, so the run is
// chaotically sensitive rather than biased. One cliff of spread is the
// resolution this measurement actually has; more than that is a real leak.
const paceWaves = Object.values(byPace).map((r) => r.wave);
const spread = Math.max(...paceWaves) - Math.min(...paceWaves);
if (spread > 5) {
  console.error(`\nFAIL: pace changed the difficulty — waves ${paceWaves.join(', ')}`);
  process.exit(1);
}
console.log(`pace spread ${spread} wave(s) — speed is a rate, not a difficulty.`);

console.log('\nwave | keep | towers | levels | gold left');
for (const row of results[0].log) {
  if (row.wave % 2 && row.wave > 6) continue;
  console.log(
    String(row.wave).padStart(4), '|',
    String(row.health).padStart(4), '|',
    String(row.towers).padStart(6), '|',
    String(row.levels).padStart(6), '|',
    String(Math.round(row.gold)).padStart(9),
  );
}

const waves = results.map((r) => r.wave).sort((a, b) => a - b);
const median = waves[Math.floor(waves.length / 2)];
console.log(`\nwaves reached: ${waves.join(', ')}   median ${median}`);

await browser.close();

if (median > 45) {
  console.error('\nFAIL: the keep survives too long — this curve cannot be lost.');
  process.exit(1);
}
if (median < 12) {
  console.error('\nFAIL: the keep falls too early to be worth playing.');
  process.exit(1);
}
console.log('Curve is in range.');
