// One terminal for both development servers, on Windows, macOS and Linux.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {checkPort, parseArgs, portError} from "./dev-support.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const python = join(root, ".venv", windows ? "Scripts/python.exe" : "bin/python");
const vite = join(root, "frontend/node_modules/vite/bin/vite.js");
let options;
try { options = parseArgs(process.argv.slice(2)); } catch (error) { fail(error.message); }
if (options.help) {
  console.log("Usage: node scripts/dev.mjs [--backend | --frontend] [--check]\nDefault: start both servers. --check validates only the selected services without starting them.");
  process.exit(0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (options.backend && !existsSync(python)) {
  fail("Missing .venv. Create it with: python -m venv .venv\nThen install requirements.txt using that environment's Python.");
}
if (options.frontend && !existsSync(vite)) {
  fail("Missing frontend dependencies. Run: npm --prefix frontend install");
}
if (options.backend) {
  const probe = spawnSync(python, ["-c", "import uvicorn"], { cwd: root, encoding: "utf8", timeout: 15000, windowsHide: true });
  if (probe.error || probe.status !== 0) {
    fail(`Cannot run uvicorn from ${python}.\n${probe.error?.message || probe.stderr}\nInstall requirements.txt using this Python.`);
  }
}

function listenerPids(port) {
  if (!windows) return [];
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {encoding: "utf8", timeout: 5000, windowsHide: true});
  return [...new Set((result.stdout || "").split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    return fields[0] === "TCP" && fields[1]?.endsWith(`:${port}`) && fields[3] === "LISTENING" ? [fields[4]] : [];
  }))];
}
const services = [...(options.backend ? [[8000, "Backend"]] : []), ...(options.frontend ? [[5173, "Frontend"]] : [])];
const problems = [];
for (const [port, label] of services) {
  try {
    await checkPort(port);
    // localhost may resolve to IPv6. Don't accidentally start beside a second
    // server there, sending browser requests to a different dev session.
    try { await checkPort(port, "::1"); }
    catch (error) { if (!["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error.code)) throw error; }
  } catch (error) { problems.push(portError(error, port, label, listenerPids(port))); }
}
if (problems.length) fail(problems.join("\n\n"));
if (options.checkOnly) {
  console.log(`Ready: ${options.backend ? ".venv Python / uvicorn" : ""}${options.backend && options.frontend ? ", " : ""}${options.frontend ? "Vite" : ""}; ports ${services.map(([port]) => port).join("/")} are available.`);
  process.exit(0);
}

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Stop only the process trees launched here, including uvicorn's reloader.
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    if (windows) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
    }
  }
  process.exit(code);
}
function launch(label, executable, args, cwd) {
  const child = spawn(executable, args, {
    cwd, stdio: "inherit", detached: !windows,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`${label} could not start: ${error.message}`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${label} stopped unexpectedly (${signal || code}). Stopping services launched here.`);
    stop(code || 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(`Starting ${options.backend && options.frontend ? "both services" : options.backend ? "backend" : "frontend"} from ${root}`);
if (options.frontend) console.log("Frontend: http://localhost:5173 (Vite hot reload)");
if (options.backend) console.log(`Backend:  http://localhost:8000/docs (source reload)\nPython:   ${python}`);
console.log("Press Ctrl+C to stop only the services launched in this terminal.\n");
if (options.backend) launch("Backend", python, ["-m", "uvicorn", "backend.main:app", "--reload", "--reload-dir", "backend", "--host", "127.0.0.1", "--port", "8000"], root);
if (options.frontend) launch("Frontend", process.execPath, [vite, "--host", "127.0.0.1", "--port", "5173", "--strictPort"], join(root, "frontend"));
