/** Integration check against a running local frontend/backend and a cached demo.
 * node scripts/test_replay_workspace.mjs <playwright-package-path> <demo.dem>
 * Never invokes the real AI API: recap response is intercepted for UI testing.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.argv[2] || 'playwright');
const origin = process.env.COUNTERSCOUT_TEST_ORIGIN || 'http://127.0.0.1:5173';
const demo = process.argv[3];
if (!demo) throw new Error('Supply the filename of a cached demo with at least 13 rounds.');
const path = `/replay/${encodeURIComponent(demo)}`;
const browser = await chromium.launch({headless: true, channel: process.env.COUNTERSCOUT_TEST_BROWSER || 'chrome'});
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let recapCalls = 0;
  await page.route('**/api/match-replay/*/insights', route => {
    recapCalls++;
    return route.fulfill({json: {demo_file: demo, summary: 'Test recap retained across workspace tabs.', model: 'test'}});
  });
  // Large position timelines exceed Chrome's inspector response-body cache.
  // Read the same real API via Node; leave the page's network flow untouched.
  const timelineResponse = await fetch(`${origin}/api/match-replay/${encodeURIComponent(demo)}/timeline`);
  assert.equal(timelineResponse.status, 200);
  const timeline = await timelineResponse.json();
  await page.goto(`${origin}${path}`);
  const slider = page.locator('input[type="range"]');
  await slider.waitFor({timeout: 120000});
  const seek = async tick => {
    // Use the public range input, not internal React state.
    await slider.evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }, tick);
    await page.waitForFunction(value => Number(document.querySelector('input[type="range"]').value) === value, tick);
  };
  await page.getByLabel('Round clock', {exact: true}).waitFor();
  const firstTick = Number(await slider.inputValue());
  const rate = timeline.tick_rate || 64;
  const fullLoadoutPlayers = timeline.players.filter(p => timeline.positions[p.steamid]?.some(s => s.alive && s.ar > 0 && s.inv?.length === 8 && s.inv.includes('C4 Explosive')));
  const fullLoadoutPlayer = fullLoadoutPlayers.find(p => p.name === 'DodelBetivu') ?? fullLoadoutPlayers[0];
  if (fullLoadoutPlayer) {
    const sample = timeline.positions[fullLoadoutPlayer.steamid].find(s => s.alive && s.ar > 0 && s.inv?.length === 8 && s.inv.includes('C4 Explosive'));
    await seek(sample.t);
    const row = page.locator(`[data-player-id="${fullLoadoutPlayer.steamid}"]`);
    await row.getByAltText('Bomb carrier', {exact: true}).waitFor();
    const bar = await row.locator('.replay-player-health').boundingBox();
    const bomb = await row.getByAltText('Bomb carrier', {exact: true}).boundingBox();
    assert.ok(Math.abs(bar.x + bar.width - bomb.x - bomb.width) < 1, 'Full health ends at the maximum loadout bomb slot');
    const widths = await page.locator('.replay-player-health').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    assert.ok(Math.max(...widths) - Math.min(...widths) < 1, 'Health tracks stay equal across different player cash/name widths');
    const cash = await page.locator('.replay-player-cash').allTextContents();
    assert.ok(new Set(cash).size > 1, 'Health sizing checked against real differing cash amounts');
    const icons = await row.locator('.replay-player-loadout img').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
    assert.ok(icons.every(height => height >= 16), 'Loadout icons are enlarged');
    const directory = process.env.COUNTERSCOUT_TEST_SCREENSHOTS;
    if (directory) {
      mkdirSync(directory, {recursive: true});
      await row.locator('xpath=ancestor::section').screenshot({path: join(directory, 'full-loadout.png')});
    }
    await seek(firstTick);
  }
  await page.getByRole('button', {name: 'Forward 15 seconds', exact: true}).click();
  assert.equal(Number(await slider.inputValue()), firstTick + 15 * rate);
  await page.getByRole('button', {name: 'Back 15 seconds', exact: true}).click();
  assert.equal(Number(await slider.inputValue()), firstTick);
  const round2 = timeline.rounds[1];
  await seek((round2.freeze_end_tick ?? round2.start_tick) + 10 * rate);
  await page.getByLabel('Round clock', {exact: true}).getByText('0:10', {exact: true}).waitFor();
  assert.match(await page.getByLabel('Round clock', {exact: true}).innerText(), /Round 2/i);
  const orderedLabels = async () => page.locator('.replay-team-panel h2').allTextContents();
  const sideBadges = async () => page.locator('.replay-team-panel > div:first-child > span').allTextContents();
  const names = await orderedLabels();
  const sidesBefore = await sideBadges();
  const scoreNames = await page.getByRole('banner', {name: 'Match score'}).locator('span.font-semibold').allTextContents();
  assert.deepEqual(names, scoreNames);
  const playersBefore = await page.locator('.replay-team-panel').evaluateAll(panels => panels.map(panel => [...panel.querySelectorAll('[data-player-id]')].map(p => p.dataset.playerId)));
  const round13 = timeline.rounds.find(r => r.num === 13);
  await seek(round13.freeze_end_tick ?? round13.start_tick);
  assert.deepEqual(await orderedLabels(), names, 'Half-time cannot exchange left/right team panels');
  assert.deepEqual(await sideBadges(), [...sidesBefore].reverse(), 'Side badges, not team identities, change at half-time');
  assert.deepEqual(await page.locator('.replay-team-panel').evaluateAll(panels => panels.map(panel => [...panel.querySelectorAll('[data-player-id]')].map(p => p.dataset.playerId))), playersBefore);
  const otRound = timeline.rounds.find(r => r.num === 28);
  if (otRound) {
    await seek(otRound.freeze_end_tick ?? otRound.start_tick);
    assert.deepEqual(await orderedLabels(), names, 'OT cannot exchange team panels');
  }
  for (const viewport of [{width: 1920, height: 1080}, {width: 1600, height: 900}, {width: 1280, height: 1024}, {width: 1280, height: 900}]) {
    await page.setViewportSize(viewport);
    const boxes = await page.locator('.replay-team-panel').evaluateAll(panels => panels.map(panel => {
      const b = panel.getBoundingClientRect();
      return {x: b.x, y: b.y, right: b.right, bottom: b.bottom, height: b.height, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight};
    }));
    assert.equal(boxes.length, 2);
    assert.ok(boxes[0].right <= boxes[1].x, 'Teams do not overlap');
    const square = page.locator('.replay-radar-viewport > div[style*="transform"]');
    const radarBox = await square.boundingBox();
    for (const b of boxes) {
      assert.ok(b.bottom <= viewport.height && b.y >= 0, 'Entire roster stays in viewport');
      assert.ok(b.scrollHeight <= b.clientHeight, 'No roster scrollbar');
      assert.ok(b.right - b.x <= 308, 'Roster panels remain narrow in both dock and footer layouts');
      assert.ok(b.right <= radarBox.x || b.x >= radarBox.x + radarBox.width || b.y >= radarBox.y + radarBox.height, 'Unzoomed radar and team panels never overlap');
    }
    const transformBefore = await page.locator('.replay-radar-viewport > div[style*="transform"]').getAttribute('style');
    await page.locator('.replay-team-panel').first().hover();
    await page.mouse.wheel(0, -300);
    assert.equal(await page.locator('.replay-radar-viewport > div[style*="transform"]').getAttribute('style'), transformBefore, 'Wheel on roster does not zoom radar');
    const panelBeforeZoom = await page.locator('.replay-team-panel').first().boundingBox();
    await page.getByRole('button', {name: '+', exact: true}).click();
    await page.getByRole('button', {name: '+', exact: true}).click();
    assert.deepEqual(await page.locator('.replay-team-panel').first().boundingBox(), panelBeforeZoom, 'Map zoom never scales or moves player information');
    await page.getByRole('button', {name: '⟳', exact: true}).click();
    const directory = process.env.COUNTERSCOUT_TEST_SCREENSHOTS;
    if (directory) {
      mkdirSync(directory, {recursive: true});
      await page.screenshot({path: join(directory, `replay-${viewport.width}x${viewport.height}.png`)});
    }
  }
  assert.equal(recapCalls, 0, 'Browsing replay makes no AI request');
  await page.getByRole('link', {name: 'AI Recap', exact: true}).click();
  await page.getByRole('heading', {name: 'AI Recap', exact: true}).waitFor();
  assert.equal(recapCalls, 0, 'Opening recap makes no AI request');
  await page.getByRole('button', {name: 'Generate recap', exact: true}).click();
  await page.getByText('Test recap retained across workspace tabs.', {exact: true}).waitFor();
  await page.getByRole('link', {name: 'Replay', exact: true}).click();
  await page.getByLabel('Round clock', {exact: true}).waitFor();
  await page.getByRole('link', {name: 'AI Recap', exact: true}).click();
  await page.getByText('Test recap retained across workspace tabs.', {exact: true}).waitFor();
  assert.equal(recapCalls, 1, 'Recap survives navigation without another AI request');
  await page.getByRole('link', {name: 'Insights', exact: true}).click();
  const teamPane = page.getByLabel('Insights team and player filters', {exact: true});
  await teamPane.waitFor();
  const cards = await teamPane.locator(':scope > section').evaluateAll(elements => elements.map(el => {
    const b = el.getBoundingClientRect();
    return {left: b.left, right: b.right};
  }));
  assert.equal(cards.length, 2);
  assert.ok(cards[0].right <= cards[1].left, 'Insights team cards never overlap');
  const directory = process.env.COUNTERSCOUT_TEST_SCREENSHOTS;
  if (directory) await page.screenshot({path: join(directory, 'insights-1280.png')});
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`Replay workspace: ${demo}, round clock, ±15s, stable teams/sides, four viewport layouts, isolated zoom, recap navigation and Insights cards passed.`);
} finally {
  await browser.close();
}
