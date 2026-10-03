/** Local browser regression: node scripts/test_insights_workspace.mjs <playwright-package-path> <cached-demo.dem> */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.argv[2] || 'playwright');
const demo = process.argv[3];
if (!demo) throw new Error('Supply a cached demo containing mixed utility and at least 13 rounds.');
const origin = process.env.COUNTERSCOUT_TEST_ORIGIN || 'http://127.0.0.1:5173';
const response = await fetch(`${origin}/api/match-replay/${encodeURIComponent(demo)}/timeline`);
assert.equal(response.status, 200);
const timeline = await response.json();
const roundNades = round => timeline.grenades.filter(g => g.points[0]?.[0] >= round.start_tick && g.points[0]?.[0] <= round.end_tick);
const mixedRound = timeline.rounds.find(r => {
  const nades = roundNades(r);
  return nades.some(g => g.type === 'smokegrenade') && nades.some(g => g.type !== 'smokegrenade');
});
assert.ok(mixedRound, 'Fixture needs a round containing smoke and other utility');
const browser = await chromium.launch({headless: true, channel: process.env.COUNTERSCOUT_TEST_BROWSER || 'chrome'});
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/replay/${encodeURIComponent(demo)}/insights`);
  const workspace = page.getByLabel('Insights radar workspace', {exact: true});
  await workspace.waitFor({timeout: 120000});
  const events = page.getByLabel('Round events', {exact: true});
  assert.equal(await events.count(), 1);
  assert.equal(await page.getByLabel('Select insights round', {exact: true}).count(), 0);
  const roundView = page.getByRole('button', {name: 'Round Utility', exact: true});
  assert.equal(await roundView.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', {name: `Round ${mixedRound.num}`, exact: true}).click();
  const types = page.getByRole('group', {name: 'Round utility types', exact: true});
  const smokeCount = roundNades(mixedRound).filter(g => g.type === 'smokegrenade').length;
  await types.getByRole('button', {name: 'Smoke', exact: true}).click();
  await page.waitForFunction(count => document.querySelectorAll('[data-utility-type]').length === count, smokeCount);
  assert.deepEqual(await events.locator('[data-utility-type]').evaluateAll(rows => [...new Set(rows.map(row => row.dataset.utilityType))]), ['smokegrenade']);
  assert.equal(await workspace.locator('[data-round-utility-type]').count(), smokeCount);
  await events.locator('[data-utility-type]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-round-utility-type]').length === 1);
  await types.getByRole('button', {name: 'Fire', exact: true}).click();
  const fireCount = roundNades(mixedRound).filter(g => ['molotov', 'incgrenade', 'incendiary'].includes(g.type)).length;
  await page.waitForFunction(count => document.querySelectorAll('[data-round-utility-type]').length === count, fireCount);
  assert.equal(await events.locator('[data-utility-type]').count(), fireCount, 'Changing type clears stale pin and updates radar/list together');
  if (!fireCount) assert.equal(await events.getByText('No throws match this utility filter.', {exact: true}).count(), 1);
  await types.getByRole('button', {name: 'All utility', exact: true}).click();
  await page.waitForFunction(count => document.querySelectorAll('[data-round-utility-type]').length === count, roundNades(mixedRound).length);
  const filters = page.getByLabel('Insights team and player filters', {exact: true});
  const teamNames = await filters.locator('h2').allTextContents();
  const scoreNames = await page.getByRole('banner', {name: 'Match score'}).locator('span.font-semibold').allTextContents();
  assert.deepEqual(teamNames, scoreNames);
  await page.getByRole('button', {name: 'Round 13', exact: true}).click();
  assert.deepEqual(await filters.locator('h2').allTextContents(), teamNames, 'Team docks retain scoreboard order at half-time');
  const save = async name => {
    const directory = process.env.COUNTERSCOUT_TEST_SCREENSHOTS;
    if (directory) { mkdirSync(directory, {recursive: true}); await page.screenshot({path: join(directory, name)}); }
  };
  for (const viewport of [{width: 1920, height: 1080}, {width: 1600, height: 900}, {width: 1280, height: 900}]) {
    await page.setViewportSize(viewport);
    const boxes = await filters.locator('section').evaluateAll(cards => cards.map(card => {
      const rect = card.getBoundingClientRect();
      return {x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight};
    }));
    const square = workspace.locator('.insights-radar-viewport > div[style*="transform"]');
    const radar = await square.boundingBox();
    assert.ok(boxes[0].right <= boxes[1].x, 'Player cards never overlap');
    for (const box of boxes) {
      assert.ok(box.y >= 0 && box.bottom <= viewport.height, 'Entire player filter is visible');
      assert.ok(box.scrollHeight <= box.clientHeight, 'No card scrollbar');
      assert.ok(box.right <= radar.x || box.x >= radar.x + radar.width || box.y >= radar.y + radar.height, 'Cards never cover unzoomed radar');
    }
    const transform = await square.getAttribute('style');
    await filters.locator('section').first().hover();
    await page.mouse.wheel(0, -300);
    assert.equal(await square.getAttribute('style'), transform, 'Wheel over player cards never zooms radar');
    await save(`insights-round-${viewport.width}.png`);
  }
  assert.equal(await events.isVisible(), false, 'Narrow windows keep round events collapsed to preserve radar space');
  await page.getByRole('button', {name: 'Events', exact: true}).click();
  await events.waitFor({state: 'visible'});
  const roundWidth = (await workspace.boundingBox()).width;
  for (const mode of ['Heatmap', 'Patterns']) {
    await page.getByRole('button', {name: mode, exact: true}).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Round events"]'));
    assert.ok((await workspace.boundingBox()).width > roundWidth + 200, 'Aggregate modes reclaim event sidebar width');
    assert.equal(await types.count(), 0);
    assert.equal(await filters.getByRole('checkbox').count(), timeline.players.length + 2);
    await save(`insights-${mode.toLowerCase()}-1280.png`);
  }
  await roundView.click();
  await events.waitFor();
  const player = filters.locator('[data-player-id]').first();
  const playerId = await player.getAttribute('data-player-id');
  await player.getByRole('checkbox').uncheck();
  assert.equal(await player.getByRole('checkbox').isChecked(), false);
  await page.getByRole('button', {name: 'Heatmap', exact: true}).click();
  assert.equal(await filters.locator(`[data-player-id="${playerId}"]`).getByRole('checkbox').isChecked(), false, 'Player choices persist across views');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`Insights workspace: ${demo}, docked player filters, stable team order, round selection, smoke/fire isolation, pin reset, adaptive layouts and contextual sidebar passed.`);
} finally { await browser.close(); }
