import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../frontend/src/utils/replayNavigation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const mod = {exports: {}};
new Function('module', 'exports', js)(mod, mod.exports);
const {roundClock, seekTick} = mod.exports;
const timeline = {tick_rate: 64, tick_max: 30000, rounds: [
  {num: 1, start_tick: 6400, freeze_end_tick: 7680, end_tick: 14080},
  {num: 25, start_tick: 20000, freeze_end_tick: 21920, end_tick: 28000},
]};
assert.equal(roundClock(timeline, 100), null);
assert.deepEqual(roundClock(timeline, 7040), {round: 1, phase: 'Freeze', time: '0:10'});
assert.deepEqual(roundClock(timeline, 7680), {round: 1, phase: 'Elapsed', time: '0:00'});
assert.deepEqual(roundClock(timeline, 8320), {round: 1, phase: 'Elapsed', time: '0:10'});
assert.deepEqual(roundClock(timeline, 15000), {round: 1, phase: 'Round ended', time: '1:40'});
assert.deepEqual(roundClock(timeline, 21920), {round: 25, phase: 'Elapsed', time: '0:00'});
assert.deepEqual(roundClock(timeline, 22560), {round: 25, phase: 'Elapsed', time: '0:10'});
assert.equal(roundClock({...timeline, tick_rate: 128}, 8960).time, '0:10');
assert.equal(roundClock({...timeline, rounds: [{num: 1, start_tick: 6400, freeze_end_tick: null, end_tick: 14080}]}, 7040).time, '0:10');
console.log('Replay clock: freeze/live phases, round resets, OT, end clamping, legacy data and tick rates passed.');
assert.equal(seekTick(timeline, 8320, -15), 7360);
assert.equal(seekTick(timeline, 8320, 15), 9280);
assert.equal(seekTick(timeline, 100, -15), 0);
assert.equal(seekTick(timeline, 29999, 15), timeline.tick_max);
assert.equal(seekTick({...timeline, tick_rate: 128}, 8320, 15), 10240);
assert.equal(seekTick({...timeline, tick_rate: 0}, 8320, 15), 9280);
console.log('Replay seek: ±15 seconds, cross-round seeking, endpoint clamping and tick rates passed.');
