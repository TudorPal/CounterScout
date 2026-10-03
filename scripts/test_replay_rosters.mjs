import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../frontend/src/utils/replayRoster.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const mod = {exports: {}};
new Function('module', 'exports', js)(mod, mod.exports);
const {replayRosterGroups} = mod.exports;
const identity = {team1: 3, members: {a: 3, b: 2, c: 3}, labels: {3: 'Transpiratii', 2: 'Young Proletaires'}};
const players = [{steamid: 'c', name: 'Zulu', team: 3}, {steamid: 'b', name: 'Bravo', team: 2}, {steamid: 'a', name: 'Alpha', team: 3}];
const before = structuredClone(players);
for (const swapped of [false, true, false, true]) {
  const states = players.map(p => ({...p, team: swapped ? (p.team === 2 ? 3 : 2) : p.team}));
  const groups = replayRosterGroups(states, identity);
  assert.deepEqual(groups.map(g => g.label), ['Transpiratii', 'Young Proletaires']);
  assert.deepEqual(groups.map(g => g.players.map(p => p.steamid)), [['a', 'c'], ['b']]);
  assert.deepEqual(groups.map(g => g.side), swapped ? [2, 3] : [3, 2]);
}
assert.deepEqual(players, before, 'Rendering never sorts/mutates the live input roster');
const empty = replayRosterGroups([], identity);
assert.deepEqual(empty.map(g => g.label), ['Transpiratii', 'Young Proletaires']);
assert.deepEqual(empty.map(g => g.players), [[], []]);
console.log('Replay rosters: scoreboard ordering, stable membership, halftime/OT sides, empty groups and immutable inputs passed.');
