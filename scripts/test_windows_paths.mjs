// Check moved batch launchers from outside the project, without starting services.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkPort} from './dev-support.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') {
  console.log('Windows batch path checks skipped on this OS.');
  process.exit(0);
}
for (const [file, expected] of [
  ['scripts/windows/run_backend.bat', /--backend/],
  ['scripts/windows/build_portable.bat', /--skip-frontend/],
  ['run_dev.bat', /--backend/],
]) {
  const batch = resolve(root, file);
  const result = spawnSync(`"${batch}" --help`,
    {shell: process.env.ComSpec || 'cmd.exe', cwd: process.env.TEMP, encoding: 'utf8',
     input: '\r\n', windowsHide: true, timeout: 15000});
  assert.equal(result.status, 0, `${file}: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, expected);
}
console.log('Moved Windows batch launchers resolve the project correctly from an unrelated working directory.');

if (process.argv.includes('--smoke-frontend')) {
  await checkPort(5173);
  await checkPort(5173, '::1');
  const batch = resolve(root, 'scripts/windows/run_frontend.bat');
  const child = spawn(`"${batch}"`, {shell: process.env.ComSpec || 'cmd.exe', cwd: process.env.TEMP,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  let output = '';
  child.stdout.on('data', chunk => {output += chunk;});
  child.stderr.on('data', chunk => {output += chunk;});
  try {
    const until = Date.now() + 25000;
    let ready = false;
    while (Date.now() < until) {
      if (child.exitCode !== null) throw Error(`Frontend launcher exited: ${output}`);
      try {
        // This existing standalone launcher uses Vite's localhost default,
        // which can bind IPv6. Moving it must not change its behavior.
        const response = await fetch('http://localhost:5173', {signal: AbortSignal.timeout(1000)});
        ready = response.ok && (await response.text()).includes('<title>CounterScout</title>');
        if (ready) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, `Frontend did not start: ${output}`);
    assert.match(output, /vite/);
    console.log('Moved frontend batch launcher starts Vite from an unrelated working directory.');
  } finally {
    if (child.exitCode === null) {
      const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true});
      assert.equal(stopped.status, 0, 'Only the frontend test process tree is stopped.');
      await new Promise(resolve => child.once('exit', resolve));
    }
  }
  await checkPort(5173);
  await checkPort(5173, '::1');
  console.log('Frontend smoke cleanup: test-owned server stopped; port 5173 released.');
}
