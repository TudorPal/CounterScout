import {createServer} from "node:net";

export function parseArgs(args) {
  const known = new Set(["--check", "--backend", "--frontend", "--help", "-h"]);
  const unknown = args.find(arg => !known.has(arg));
  if (unknown) throw new Error(`Unknown option: ${unknown}. Run with --help for usage.`);
  if (args.includes("--backend") && args.includes("--frontend")) {
    throw new Error("Choose --backend or --frontend, or omit both to start the entire project.");
  }
  return {backend: !args.includes("--frontend"), frontend: !args.includes("--backend"),
    checkOnly: args.includes("--check"), help: args.includes("--help") || args.includes("-h")};
}

export function portError(error, port, label, listeners = []) {
  const occupied = error.code === "EADDRINUSE" || listeners.length > 0;
  const intro = occupied ? `Port ${port} (${label}) is already occupied.` :
    error.code === "EACCES" || error.code === "EPERM" ? `Windows/the OS refused access to port ${port} (${label}).` :
    `Cannot check port ${port} (${label}): ${error.message}`;
  const advice = occupied ? "Stop the existing server in its terminal with Ctrl+C, then retry. This launcher will not terminate unrelated processes." :
    error.code === "EACCES" || error.code === "EPERM" ?
      "Check for an existing listener or a Windows reserved port:\n  netstat -ano | findstr :" + port +
      "\n  netsh interface ipv4 show excludedportrange protocol=tcp\nDo not disable your firewall or run as administrator just to hide this error." :
      "Resolve the reported socket error, then retry.";
  return `${intro} [${error.code || "socket error"}]\n${listeners.length ? `Listening process PID(s): ${listeners.join(", ")}\n` : ""}${advice}`;
}

export async function checkPort(port, host = "127.0.0.1") {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({port, host, exclusive: true}, () => server.close(error => error ? reject(error) : resolve()));
  });
}
