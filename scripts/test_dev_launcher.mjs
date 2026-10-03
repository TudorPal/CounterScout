// Run: node scripts/test_dev_launcher.mjs [--smoke-backend]
// Smoke starts/stops only its own backend process tree; existing servers are untouched.
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createServer} from "node:net";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {checkPort, parseArgs, portError} from "./dev-support.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert.deepEqual(parseArgs([]), {backend:true, frontend:true, checkOnly:false, help:false});
assert.deepEqual(parseArgs(["--backend", "--check"]), {backend:true, frontend:false, checkOnly:true, help:false});
assert.equal(parseArgs(["--frontend"]).backend, false);
assert.equal(parseArgs(["--help"]).help, true);
assert.throws(() => parseArgs(["--backend", "--frontend"]), /Choose/);
assert.throws(() => parseArgs(["--typo"]), /Unknown option/);
assert.match(portError({code:"EADDRINUSE"}, 8000, "Backend", ["1234"]), /occupied.*\[EADDRINUSE\][\s\S]*1234/);
assert.match(portError({code:"EACCES"}, 8000, "Backend"), /refused access[\s\S]*excludedportrange/);
assert.match(portError({code:"EACCES"}, 8000, "Backend", ["1234"]), /occupied/);
assert.match(portError({code:"ENOTFOUND", message:"Invalid bind host"}, 8000, "Backend"), /Invalid bind host/);
const occupied = createServer();
await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
const port = occupied.address().port;
await assert.rejects(checkPort(port), error => ["EADDRINUSE", "EACCES"].includes(error.code));
await new Promise(resolve => occupied.close(resolve));
await checkPort(port);
const help = spawnSync(process.execPath, ["scripts/dev.mjs", "--help"], {cwd:root, encoding:"utf8"});
assert.equal(help.status, 0);
assert.match(help.stdout, /--backend/);
const invalid = spawnSync(process.execPath, ["scripts/dev.mjs", "--typo"], {cwd:root, encoding:"utf8"});
assert.equal(invalid.status, 1);
assert.match(invalid.stderr, /Unknown option/);
if (process.platform === "win32") {
  const batch = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "run_dev.bat --typo"],
    {cwd:root, encoding:"utf8", input:"\r\n", timeout:10000, windowsHide:true});
  assert.equal(batch.status, 1, "The batch wrapper must preserve the failed startup exit code");
  assert.match(batch.stdout + batch.stderr, /Unknown option/);
  assert.match(batch.stdout, /Press any key to close this window/, "A double-clicked failure stays visible until acknowledged");
}
console.log("Dev launcher: service selection, usage, occupied ports, permission errors and socket cleanup passed.");

if (process.argv.includes("--smoke-backend")) {
  await checkPort(8000); // Fail safely rather than stop anyone else's server.
  const child = spawn(process.execPath, ["scripts/dev.mjs", "--backend"], {cwd:root, detached:process.platform !== "win32", stdio:["ignore","pipe","pipe"]});
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const childError = new Promise((_, reject) => child.once("error", reject));
  try {
    const ready = async () => {
      const until = Date.now() + 25000;
      while (Date.now() < until) {
        if (child.exitCode !== null) throw new Error(`Backend launcher exited: ${output}`);
        try {
          const response = await fetch("http://127.0.0.1:8000/api/health", {signal:AbortSignal.timeout(1000)});
          if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error(`Backend did not become ready: ${output}`);
    };
    await Promise.race([ready(), childError]);
    assert.match(output, /\.venv/);
    assert.match(output, /source reload/);
    assert.match(output, /Started reloader process/);
    assert.ok(!output.includes("Frontend:"), "Backend-only mode must not start or inspect Vite");
    console.log("Backend smoke: launcher uses .venv, source reload is active, and /api/health responds.");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") {
        const killed = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {encoding:"utf8", windowsHide:true});
        if (killed.status !== 0) throw new Error(`Cannot clean up test-owned process ${child.pid}: ${killed.stderr}`);
      } else process.kill(-child.pid, "SIGTERM");
      await new Promise(resolve => child.once("exit", resolve));
    }
  }
  await checkPort(8000);
  console.log("Backend smoke cleanup: its process tree stopped and port 8000 released.");
}
