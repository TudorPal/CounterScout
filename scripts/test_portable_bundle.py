"""Exercise the actual frozen EXE with isolated data and no Python/Node on PATH."""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import tempfile
import time
import urllib.request

ORIGIN = "http://127.0.0.1:5173"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(path, headers=None, timeout=180):
    with OPENER.open(urllib.request.Request(ORIGIN + path, headers=headers or {}), timeout=timeout) as response:
        return response.status, response.headers, response.read()


def payload(path, headers=None):
    def reject_constant(value):
        raise ValueError(f"Browser-invalid JSON constant {value} in {path}")
    return json.loads(get(path, headers)[2], parse_constant=reject_constant)


def upload(demo: Path):
    boundary = "CounterScoutPortableSmokeTest"
    prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="portable-smoke.dem"\r\n'
              'Content-Type: application/octet-stream\r\n\r\n').encode()
    suffix = f"\r\n--{boundary}--\r\n".encode()
    connection = http.client.HTTPConnection("127.0.0.1", 5173, timeout=300)
    try:
        connection.putrequest("POST", "/api/match-replay/upload")
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(len(prefix) + demo.stat().st_size + len(suffix)))
        connection.endheaders()
        connection.send(prefix)
        with demo.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                connection.send(chunk)
        connection.send(suffix)
        response = connection.getresponse()
        body = response.read()
        assert response.status == 200, (response.status, body[:1000])
        return json.loads(body)
    finally:
        connection.close()


def wait_ready(process):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"EXE exited before startup: {process.returncode}")
        try:
            return payload("/api/health")
        except OSError:
            time.sleep(0.25)
    raise RuntimeError("EXE startup timed out")


def check_ports():
    for port in (8000, 5173):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError as exc:
                raise RuntimeError(f"Stop the existing server on port {port} before testing") from exc


def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--demo", type=Path)
    parser.add_argument("--playwright-package", type=Path, help="Optional existing Playwright package for replay UI regression")
    args = parser.parse_args()
    bundle = args.bundle.resolve()
    executable = bundle / "CounterScout.exe"
    demo = args.demo.resolve() if args.demo else None
    expected = (bundle / "VERSION").read_text().strip()
    assert executable.is_file()
    check_ports()
    env = os.environ.copy()
    for key in list(env):
        if key.upper().startswith(("PYTHON", "CONDA", "VIRTUAL_ENV")) or key in {
            "DATABASE_URL", "DEMO_DIR", "DB_PATH", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "FACEIT_API_KEY"}:
            env.pop(key, None)
    env["PATH"] = str(Path(env.get("SystemRoot", "C:/Windows")) / "System32")
    with tempfile.TemporaryDirectory(prefix="CounterScout-portable-test-") as tmp:
        folder = Path(tmp)
        data = folder / "user-data"
        command = [str(executable), "--no-browser", "--data-dir", str(data), "--stop-after", "3"]
        log = folder / "smoke.log"
        process = None
        try:
            with log.open("wb") as output:
                process = subprocess.Popen(command[:-1] + ["180"], cwd=folder, env=env, stdout=output, stderr=subprocess.STDOUT)
                started = time.monotonic()
                health = wait_ready(process)
                assert health["version"] == expected, health
                print(f"PASS frozen startup/API ({time.monotonic() - started:.1f}s), version {expected}", flush=True)
                for route in ("/", "/replay", "/ingest", "/lineups", "/replay/filename.dem", "/replay/filename.dem/insights"):
                    assert b"CounterScout" in get(route)[2], route
                page = get("/")[2].decode()
                import re
                asset = re.search(r'src="([^"]+\.js)"', page).group(1)
                assert get(asset)[0] == 200
                assert payload("/api/demos")["total_demos"] == 0
                assert payload("/api/radars/de_nuke")["scale"] > 0
                assert get("/api/radars/de_nuke.png")[2].startswith(b"\x89PNG")
                assert isinstance(payload("/api/callouts/de_inferno")["callouts"], list)
                if (bundle / "tools/7z.exe").is_file():
                    import zipfile
                    archive = folder / "archiver-test.zip"
                    with zipfile.ZipFile(archive, "w") as zipped:
                        zipped.writestr("test.txt", "portable archiver works")
                    extracted = subprocess.run([str(bundle / "tools/7z.exe"), "e", "-so", str(archive), "test.txt"],
                                               cwd=folder, env=env, capture_output=True, timeout=15)
                    assert extracted.returncode == 0 and extracted.stdout == b"portable archiver works"
                    print("PASS bundled archive extraction with no installed archiver on PATH", flush=True)
                setup = payload("/api/ingest/faceit/bridge/setup", {"Origin": ORIGIN})
                assert Path(setup["extension_path"]) == bundle / "browser-extension", setup
                assert (Path(setup["extension_path"]) / "manifest.json").is_file()
                with OPENER.open(urllib.request.Request("http://127.0.0.1:8000/api/ingest/faceit/bridge/commands",
                                 headers={"Authorization": "Bearer " + setup["token"], "X-CS2-Bridge-Version": "0.2.2"}), timeout=10) as response:
                    assert response.status == 200
                print("PASS frontend/deep links/static assets/radars/callouts/extension path and paired polling", flush=True)
                duplicate = subprocess.run(command, cwd=folder, env=env, capture_output=True, timeout=30)
                assert duplicate.returncode == 0 and b"already running" in duplicate.stdout, duplicate.stderr
                if demo:
                    result = upload(demo)
                    print("PASS streamed real-demo upload", result.get("demo_file"), flush=True)
                    info = payload("/api/match-info/portable-smoke.dem")
                    timeline = payload("/api/match-replay/portable-smoke.dem/timeline")
                    assert info["map_name"].startswith("de_"), info
                    assert timeline["rounds"], timeline.keys()
                    print(f"PASS native parser/replay: {info['map_name']}, {len(timeline['rounds'])} rounds", flush=True)
                    if args.playwright_package:
                        ui = subprocess.run([shutil.which("node"), str(Path(__file__).parent / "test_replay_workspace.mjs"),
                                             str(args.playwright_package.resolve()), "portable-smoke.dem"], capture_output=True, timeout=60)
                        if ui.returncode:
                            raise RuntimeError("Browser UI regression failed: " + ui.stderr[-4000:].decode("utf-8", errors="replace"))
                        print(ui.stdout.decode("utf-8", errors="replace"), flush=True)
                        print("PASS browser replay UI against the frozen backend/static frontend", flush=True)
                # Do not wait for the timer after tests. Only stop our EXE.
                process.terminate()
                process.wait(timeout=15)
                check_ports()
                process = subprocess.Popen(command, cwd=folder, env=env, stdout=output, stderr=subprocess.STDOUT)
                wait_ready(process)
                assert payload("/api/ingest/faceit/bridge/setup", {"Origin": ORIGIN})["token"] == setup["token"]
                if demo:
                    assert payload("/api/demos")["total_demos"] == 1
                assert process.wait(timeout=30) == 0
                check_ports()
                print("PASS restart/data persistence/graceful timed shutdown/port release", flush=True)
                with socket.socket() as occupied:
                    occupied.bind(("127.0.0.1", 8000))
                    occupied.listen()
                    failed = subprocess.run(command, cwd=folder, env=env, capture_output=True, timeout=30)
                    assert failed.returncode == 1 and b"No existing process was terminated" in failed.stderr
                print("PASS occupied-port diagnostics; all portable checks passed", flush=True)
        except Exception:
            print(log.read_text(encoding="utf-8", errors="replace")[-12000:])
            raise
        finally:
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=15)


if __name__ == "__main__":
    main()
