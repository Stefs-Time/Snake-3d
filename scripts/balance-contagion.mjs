#!/usr/bin/env node
/**
 * Contagion balance probe.
 *
 * Plays the real cabinet headlessly — the actual epidemiology, gene tree, cure
 * and detection code, driven by a competent scripted player — and reports how
 * each run ended. A strategy game's design is entirely in its numbers, and the
 * only way to find out whether those numbers make a game is to let something
 * play it a few hundred times.
 *
 *   node scripts/balance-contagion.mjs [baseUrl] [runsPerCell]
 *
 * The player is deliberately good but not optimal, and plays the line a person
 * works out in their second or third run: start somewhere poor and crowded,
 * buy transmission and the two cheap symptoms, unlock the climates before the
 * world notices, harden against the cure, and only then evolve anything that
 * kills. It does not devolve, and it does not time the news.
 *
 * A healthy cabinet loses on Brutal more often than it wins, wins on Casual
 * more often than it loses, and is close to even on Normal — and no cell is
 * ever unanimous, because a strategy game whose outcome is decided before the
 * first click is not one.
 */

import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8080';
const RUNS = Number(process.argv[3] || 12);
const MAX_DAYS = 900;

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
 * Runs inside the page. Steps the real `update` by hand with the host loop
 * paused, so a four-minute run takes a fraction of a second and every rule
 * that fires is the one the player would have hit.
 */
function playCell(args) {
  const { strain, world, runs, maxDays } = args;
  const cab = window.__cabinet;
  const game = cab.game;
  const tree = cab.GameClass.tree;

  cab.loop.setPaused(true);

  const byId = {};
  for (const track of Object.values(tree)) for (const g of track) byId[g.id] = g;

  // The shopping list, in the order a person learns to buy it. Everything with
  // a `when` waits for a condition; everything else is bought on sight.
  const PLAN = [
    'cough', 'nausea', 'air1', 'water1', 'heat',
    'cold', 'drug', 'air2', 'water2', 'livestock',
    'camouflage', 'insomnia', 'hardening', 'insect', 'reshuffle',
    // Nothing lethal until the world is nearly all infected — the whole point
    // of the trap this game is built around. But a player who waits for a
    // hundred percent that a resistant region will never give them waits for
    // ever, so impatience and a cure past halfway both force the issue.
    { id: 'pneumonia', when: (v) => v.ready || v.infectedFraction > 0.80 },
    { id: 'haemorrhage', when: (v) => v.ready || v.infectedFraction > 0.86 },
    { id: 'necrosis', when: (v) => v.ready || v.infectedFraction > 0.90 },
  ];

  const view = () => {
    let infected = 0;
    let pop = 0;
    for (const r of game.regions) { infected += r.infected; pop += r.pop0; }
    return {
      infectedFraction: infected / pop,
      ready: game.day > 300 || game.cure > 45,
    };
  };

  const results = [];

  for (let run = 0; run < runs; run++) {
    // Options the way the play bar would set them, then a real `setup()` —
    // which the contract says is a full reset — plus the two fields that live
    // on the base class rather than in the game's own state.
    game.option = (id) => (id === 'strain' ? strain : world);
    game.over = false;
    game.score = 0;
    cab.finished = false;
    cab.overlayHost.replaceChildren();
    game.setup();

    // Opening: the country that multiplies susceptibility by the people in it.
    // That is the read a good player makes and the map is drawn to reward.
    let best = null;
    let bestScore = -1;
    for (const r of game.regions) {
      const score = r.pop * (0.55 + r.density * 0.85)
        * (r.climate === 'humid' ? 1.15 : r.climate === 'temperate' ? 1 : 0.6)
        * (1 - r.wealth * 0.48);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    game.begin(best);

    let steps = 0;
    const STEP = 1 / 60;
    while (game.state === 'playing' && game.day < maxDays && steps < maxDays * 40) {
      steps++;
      game.update(STEP);

      // Collect every bubble the moment it surfaces. A real player misses some;
      // this one does not, which makes the probe an upper bound on income and
      // so a lower bound on difficulty.
      while (game.bubbles.length) game.collect(game.bubbles[0]);

      if (game.state !== 'playing') break;

      const v = view();

      // A virus mutates symptoms on its own, and the answer a player works out
      // fast is to devolve anything lethal before it burns the disease out.
      // Without this the strain loses every run, which says more about the
      // probe than about the strain.
      if (!v.ready && v.infectedFraction < 0.8) {
        for (const id of ['necrosis', 'haemorrhage', 'pneumonia']) {
          if (game.owned.has(id) && game.dna >= game.devolveCost(byId[id])) {
            game.devolve(byId[id]);
            break;
          }
        }
      }

      for (const entry of PLAN) {
        const id = typeof entry === 'string' ? entry : entry.id;
        if (game.owned.has(id)) continue;
        if (typeof entry !== 'string' && !entry.when(v)) continue;
        const gene = byId[id];
        if (game.blockedBy(gene)) break; // in order: never skip ahead to something cheap
        game.evolve(gene);
        break;
      }
    }

    const dead = game.regions.reduce((n, r) => n + r.dead, 0);
    results.push({
      outcome: game.outcome ?? 'timeout',
      day: game.day,
      cure: Math.round(game.cure),
      dead: Math.round(dead),
      infected: Math.round(view().infectedFraction * 100),
      genes: game.owned.size,
      score: game.score,
    });
  }

  return results;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const strains = ['bacteria', 'virus', 'prion'];
  const worlds = ['casual', 'normal', 'brutal'];
  let stuck = 0;

  console.log(`  ${RUNS} runs per cell, a competent player, every bubble caught.\n`);

  for (const world of worlds) {
    for (const strain of strains) {
      await page.goto(`${BASE}/play/contagion?debug`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__cabinet?.game, null, { timeout: 15000 });
      await page.evaluate(() => window.__cabinet.dismissBriefing?.());

      const results = await page.evaluate(playCell, {
        strain, world, runs: RUNS, maxDays: MAX_DAYS,
      });

      const wins = results.filter((r) => r.outcome === 'extinct').length;
      const cured = results.filter((r) => r.outcome === 'cured').length;
      const burnt = results.filter((r) => r.outcome === 'burnout').length;
      const other = results.filter((r) => r.outcome === 'timeout').length;
      const avg = (k) => Math.round(results.reduce((n, r) => n + r[k], 0) / results.length);

      console.log(
        `  ${world.padEnd(7)} ${strain.padEnd(9)}` +
        ` extinct ${String(wins).padStart(2)}/${results.length}` +
        `  cured ${String(cured).padStart(2)}  burnout ${burnt}  stalled ${other}` +
        `  ~day ${String(avg('day')).padStart(4)}` +
        `  ~cure ${String(avg('cure')).padStart(3)}%` +
        `  ~infected ${String(avg('infected')).padStart(3)}%` +
        `  ~genes ${avg('genes')}` +
        `  ~score ${avg('score').toLocaleString()}`,
      );
        if (other) stuck += other;
    }
  }

  await browser.close();
  if (stuck) {
    console.log(`\n  ${stuck} run(s) neither won nor were cured — a stall, and worth reading.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
