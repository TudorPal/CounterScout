import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import config from '../frontend/tailwind.config.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compiled = ts.transpileModule(read('frontend/src/utils/brandStorage.ts'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;
const mod = {exports: {}};
new Function('module', 'exports', compiled)(mod, mod.exports);
class MemoryStorage {
  items = new Map();
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, value); }
}
const storage = new MemoryStorage();
for (const [key, value] of Object.entries({
  'cs2meta:catalog': 'old cache', 'cs2-notes-demo': 'notes',
  'cs2-faceit-team-url': 'team URL', 'counterscout:catalog': 'new cache',
  unrelated: 'keep',
})) storage.setItem(key, value);
mod.exports.migrateBrandStorage(storage);
assert.equal(storage.getItem('counterscout:catalog'), 'new cache');
assert.equal(storage.getItem('counterscout-notes-demo'), 'notes');
assert.equal(storage.getItem('counterscout-faceit-team-url'), 'team URL');
assert.equal(storage.getItem('cs2-notes-demo'), 'notes');
assert.equal(storage.getItem('unrelated'), 'keep');
assert.doesNotThrow(() => mod.exports.migrateBrandStorage({get length() {throw Error('denied');}}));
const luminance = hex => {
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
};
const colors = config.theme.extend.colors.scout;
for (const fg of ['text', 'muted', 'accent']) for (const bg of ['bg', 'panel', 'card', 'cardHi']) {
  const values = [luminance(colors[fg]), luminance(colors[bg])].sort((a,b) => b-a);
  const ratio = (values[0] + .05) / (values[1] + .05);
  assert.ok(ratio >= 4.5, `${fg}/${bg} contrast ${ratio.toFixed(2)}`);
}
assert.equal(JSON.parse(read('frontend/package.json')).name, 'counterscout');
assert.equal(JSON.parse(read('browser-extension/manifest.json')).name, 'CounterScout — FACEIT Bridge');
assert.ok(read('frontend/src/App.tsx').includes('path="/ingest"'));
assert.ok(read('frontend/src/App.tsx').includes('path="/import"'));
assert.ok(read('frontend/index.html').includes('<title>CounterScout</title>'));
console.log('Branding, storage migration, route compatibility, and 12 text/surface contrast checks passed.');
