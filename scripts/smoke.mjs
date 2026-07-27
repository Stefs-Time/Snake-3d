#!/usr/bin/env node
/**
 * Headless smoke test.
 *
 * Loads every route and every cabinet in a real browser, plays each game for a
 * couple of seconds with synthetic input, and fails on any console error,
 * page error, or failed request. Screenshots land in screenshots/ so the whole
 * arcade can be eyeballed at a glance.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES } from '../shared/catalog.js';

const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = 'screenshots';

/** Find a usable Chromium: the env override, then whatever is pre-installed. */
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
  return undefined; // let Playwright resolve its own download
}

const EXECUTABLE = findChromium();

mkdirSync(OUT, { recursive: true });

const problems = [];

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // A missing favicon or a blocked font is not a broken arcade.
    if (/favicon|net::ERR_INTERNET_DISCONNECTED/.test(text)) return;
    problems.push(`[${label}] console: ${text}`);
  });
  page.on('pageerror', (err) =>
    problems.push(`[${label}] pageerror on ${page.url().replace(BASE, '')}: ${err.message}`));
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? '';
    if (/ERR_ABORTED/.test(failure)) return;
    problems.push(`[${label}] request failed: ${req.url()} (${failure})`);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });

  const page = await context.newPage();
  watch(page, 'app');

  /* --- the static routes --- */
  const routes = [
    ['/', 'hub'],
    ['/scores', 'scores'],
    ['/settings', 'settings'],
    ['/about', 'about'],
    ['/nowhere', '404'],
  ];

  for (const [path, name] of routes) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await sleep(1200); // let the attract loops get going
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`  ✓ ${path.padEnd(12)} -> ${name}.png`);
  }

  /* --- every cabinet --- */
  for (const game of GAMES) {
    await page.goto(`${BASE}/play/${game.id}`, { waitUntil: 'networkidle' });

    // Wait for the loading overlay to clear, i.e. the chunk booted.
    await page
      .waitForFunction(() => !document.querySelector('.overlay__eyebrow')?.textContent?.includes('Loading'), null, { timeout: 15000 })
      .catch(() => problems.push(`[${game.id}] cabinet never finished loading`));

    await sleep(700);

    // Poke it: a few directions, a few actions.
    for (const key of ['ArrowRight', 'Space', 'ArrowUp', 'ArrowLeft', 'Space', 'ArrowDown']) {
      await page.keyboard.press(key);
      await sleep(180);
    }
    await page.keyboard.down('ArrowRight');
    await sleep(700);
    await page.keyboard.up('ArrowRight');

    // Half the cabinets are click-driven, so click around the board too —
    // including a drag, which is how the word search is played.
    const frame = await page.$('.cabinet__frame');
    const box = await frame.boundingBox();
    for (const [fx, fy] of [[0.3, 0.4], [0.5, 0.55], [0.7, 0.45], [0.4, 0.7], [0.62, 0.68]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await sleep(170);
    }
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.35, { steps: 8 });
    await page.mouse.up();

    // Letters, for the word game.
    // Avoid KeyR and KeyP here: they are the global restart and pause bindings.
    for (const key of ['KeyS', 'KeyL', 'KeyA', 'KeyT', 'KeyE', 'Enter']) {
      await page.keyboard.press(key);
      await sleep(90);
    }
    await sleep(900);

    // The score readout should exist and be a number.
    const score = await page.textContent('.hud__value').catch(() => null);
    if (score == null) problems.push(`[${game.id}] no HUD score element`);

    await page.screenshot({ path: `${OUT}/game-${game.id}.png` });
    console.log(`  ✓ /play/${game.id.padEnd(10)} -> game-${game.id}.png  (score ${score})`);
  }

  /* --- the leaderboard round trip --- */
  const initials = 'SMK';
  const submitted = await page.evaluate(async (init) => {
    const res = await fetch('/api/scores/paddles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initials: init, score: 4242, duration: 30, meta: { rally: 9 } }),
    });
    return { status: res.status, body: await res.json() };
  }, initials);

  if (submitted.status !== 201) {
    problems.push(`leaderboard submit returned ${submitted.status}`);
  } else {
    console.log(`  ✓ leaderboard submit -> rank #${submitted.body.rank}`);
  }

  await page.goto(`${BASE}/scores/paddles`, { waitUntil: 'networkidle' });
  await sleep(800);
  const row = await page.textContent('.row__initials').catch(() => null);
  if (row !== initials) problems.push(`leaderboard did not show the submitted score (saw "${row}")`);
  else console.log('  ✓ leaderboard read back the score');
  await page.screenshot({ path: `${OUT}/scores-populated.png` });

  /* --- a mobile viewport, to prove the touch layout holds up --- */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const phone = await mobile.newPage();
  watch(phone, 'mobile');
  await phone.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await sleep(1000);
  await phone.screenshot({ path: `${OUT}/mobile-hub.png` });
  await phone.goto(`${BASE}/play/chomp`, { waitUntil: 'networkidle' });
  await sleep(2200);
  await phone.screenshot({ path: `${OUT}/mobile-chomp.png` });
  console.log('  ✓ mobile viewport');

  await browser.close();

  console.log('');
  if (problems.length) {
    console.error(`  ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`   - ${problem}`);
    process.exit(1);
  }
  console.log('  All clear.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
