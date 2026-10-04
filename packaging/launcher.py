"""Portable browser launcher: bundled backend and static frontend, no Node."""
import argparse
import asyncio
import json
import logging
import multiprocessing
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

HOST, API_PORT, WEB_PORT = "127.0.0.1", 8000, 5173
WEB_URL = f"http://{HOST}:{WEB_PORT}"


def resource_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))


def application_root() -> Path:
    return Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else resource_root()


def prepare_runtime(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in ("data", "demos", "logs"):
        (folder / name).mkdir(exist_ok=True)
    os.chdir(folder)
    from dotenv import load_dotenv
    load_dotenv(folder / ".env", override=False)
    os.environ.setdefault("CATALOG_AUTOPULL", "false")
    os.environ["COUNTERSCOUT_EXTENSION_DIR"] = str(application_root() / "browser-extension")
    tools = application_root() / "tools"
    if tools.is_dir():
        os.environ["PATH"] = str(tools) + os.pathsep + os.environ.get("PATH", "")


def reserve_ports() -> list[socket.socket]:
    """Reserve before imports, then pass sockets to uvicorn: no bind race."""
    sockets = []
    try:
        for port in (API_PORT, WEB_PORT):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sockets.append(sock)
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sock.bind((HOST, port))
            sock.listen(128)
            sock.setblocking(False)
    except OSError as exc:
        for sock in sockets:
            sock.close()
        raise RuntimeError(f"Cannot use port {port}: {exc}. Stop an existing CounterScout/dev server "
                           "with Ctrl+C and retry. No existing process was terminated. "
                           "If Windows reserves this port, check excluded TCP port ranges.") from exc
    return sockets


def running_copy(folder: Path) -> bool:
    try:
        with urllib.request.urlopen(WEB_URL + "/__portable/status", timeout=1) as response:
            data = json.load(response)
        return data.get("application") == "CounterScout-portable" and data.get("data_dir") == str(folder.resolve())
    except (OSError, ValueError):
        return False


def create_web_app(dist: Path, folder: Path, version: str):
    import httpx
    from contextlib import asynccontextmanager
    from fastapi import FastAPI, Request
    from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
    from starlette.background import BackgroundTask
    from starlette.staticfiles import StaticFiles

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(base_url=f"http://{HOST}:{API_PORT}", timeout=None, trust_env=False) as client:
            app.state.client = client
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/__portable/status")
    def status():
        return {"application": "CounterScout-portable", "version": version, "data_dir": str(folder.resolve())}

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
    async def proxy(request: Request, path: str):
        # Stream both directions: multi-GB uploads must not buffer in RAM.
        blocked = {"host", "connection", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"}
        headers = [(key, value) for key, value in request.headers.items() if key.lower() not in blocked]
        url = "/api/" + path + ("?" + request.url.query if request.url.query else "")
        upstream = request.app.state.client.build_request(request.method, url, headers=headers, content=request.stream())
        try:
            response = await request.app.state.client.send(upstream, stream=True)
        except httpx.RequestError:
            return JSONResponse({"detail": "Backend unavailable; check the launcher log."}, status_code=503)
        return StreamingResponse(response.aiter_raw(), status_code=response.status_code,
                                 headers={key: value for key, value in response.headers.items() if key.lower() not in blocked},
                                 background=BackgroundTask(response.aclose))

    class SPAFiles(StaticFiles):
        async def get_response(self, path, scope):
            from starlette.exceptions import HTTPException
            try:
                return await super().get_response(path, scope)
            except HTTPException as exc:
                route = path.replace("\\", "/").split("/", 1)[0]
                # Demo filenames contain dots: /replay/match.dem must still
                # return the SPA on direct navigation and browser refresh.
                client_routes = {"import", "ingest", "matches", "lineups", "replay", "anti-strat", "players"}
                if exc.status_code == 404 and route in client_routes:
                    return FileResponse(dist / "index.html")
                raise

    app.mount("/", SPAFiles(directory=dist, html=True), name="frontend")
    return app


async def serve(sockets, folder: Path, open_browser: bool, stop_after: float | None):
    import uvicorn
    from backend.main import app
    from backend.version import VERSION
    handler = logging.FileHandler(folder / "logs" / "CounterScout.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.getLogger().addHandler(handler)
    configs = [uvicorn.Config(app, host=HOST, port=API_PORT, loop="asyncio", http="h11", log_config=None),
               uvicorn.Config(create_web_app(resource_root() / "frontend/dist", folder, VERSION),
                              host=HOST, port=WEB_PORT, loop="asyncio", http="h11", log_config=None)]

    class ManagedServer(uvicorn.Server):
        def capture_signals(self):
            from contextlib import nullcontext
            return nullcontext()

    servers = [ManagedServer(config) for config in configs]
    tasks = [asyncio.create_task(server.serve(sockets=[sock])) for server, sock in zip(servers, sockets)]
    try:
        deadline = time.monotonic() + 90
        while not all(server.started for server in servers):
            if any(task.done() for task in tasks) or time.monotonic() > deadline:
                raise RuntimeError("CounterScout did not start. See user-data/logs/CounterScout.log.")
            await asyncio.sleep(0.1)
        print(f"\nCounterScout {VERSION} ready: {WEB_URL}\nData: {folder}\nKeep this window open. Ctrl+C stops CounterScout.\n", flush=True)
        if open_browser:
            threading.Thread(target=webbrowser.open, args=(WEB_URL,), daemon=True).start()
        if stop_after is not None:
            await asyncio.sleep(stop_after)
        else:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for server in servers:
            server.should_exit = True
        await asyncio.gather(*tasks, return_exceptions=True)
        logging.getLogger().removeHandler(handler)
        handler.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Start portable CounterScout in your browser.")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", type=Path, help="Override the default user-data directory")
    parser.add_argument("--stop-after", type=float, help="Stop after N seconds (automated tests)")
    args = parser.parse_args(argv)
    folder = (args.data_dir or application_root() / "user-data").resolve()
    if running_copy(folder):
        print("CounterScout is already running; opening its browser interface.")
        if not args.no_browser:
            webbrowser.open(WEB_URL)
        return 0
    sockets = []
    try:
        if not (resource_root() / "frontend/dist/index.html").is_file():
            raise RuntimeError("Frontend missing. Build the portable release first.")
        sockets = reserve_ports()
        prepare_runtime(folder)
        asyncio.run(serve(sockets, folder, not args.no_browser, args.stop_after))
        return 0
    except KeyboardInterrupt:
        print("\nCounterScout stopped.")
        return 0
    except Exception as exc:
        print(f"\nCounterScout startup failed: {exc}", file=sys.stderr, flush=True)
        if sys.stdin.isatty() and args.stop_after is None:
            input("Press Enter to close this window...")
        return 1
    finally:
        for sock in sockets:
            sock.close()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
