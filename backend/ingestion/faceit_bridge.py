"""Keyless FACEIT bridge. Browser authentication stays in Chrome, never here.

Imports are restricted to a paired extension, loopback clients, and a user-
selected Downloads directory. No arbitrary URLs or filesystem roots are read.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import secrets
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlsplit
import re
from contextlib import contextmanager

import zstandard
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from backend.config import settings
from backend.utils.maps import canonical_map_name

ID = r"(?:1-)?[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
UUID = re.compile(r"^" + ID + r"$")
LOCAL_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"}
BRIDGE_VERSION = "0.2.2"


def supports_automation(version: str | None) -> bool:
    return bool(version and re.fullmatch(r"\d+\.\d+\.\d+", version)
                and tuple(map(int, version.split("."))) >= (0, 2, 2))


def team_url(value: str) -> tuple[str, str]:
    parsed = urlsplit(value.strip())
    match = re.search(r"/teams/(" + ID + r")(?=/|$)", parsed.path)
    if parsed.scheme != "https" or parsed.hostname not in {"www.faceit.com", "faceit.com"} or not match:
        raise ValueError("Paste a FACEIT team profile URL containing its team ID.")
    identifier = match.group(1)
    return identifier, f"https://www.faceit.com/en/teams/{identifier}/stats"


def normalize_match(raw: dict) -> dict:
    payload = raw.get("payload") or raw
    identifier = str(payload.get("id") or payload.get("match_id") or "")
    if not UUID.fullmatch(identifier):
        raise ValueError("Invalid FACEIT match ID")
    teams = payload.get("teams") or {}
    if payload.get("game") not in (None, "cs2", "csgo"):
        raise ValueError("Only CS2 matches are supported")
    results = payload.get("results") or {}
    if not isinstance(results, dict):
        results = {}
    score = results.get("score") or {}
    def team(key):
        source = teams.get(key) or {}
        members = source.get("roster") or source.get("players") or []
        return {"id": str(source.get("id") or source.get("faction_id") or "")[:80],
                "name": str(source.get("name") or source.get("nickname") or key)[:80],
                "players": list(dict.fromkeys(str(p.get(field) or "")[:80] for p in members if isinstance(p, dict)
                                              for field in ("nickname", "name", "game_player_name") if p.get(field))),
                "steamids": [str(p.get("game_player_id")) for p in members if isinstance(p, dict)
                             and re.fullmatch(r"\d{17}", str(p.get("game_player_id") or ""))],
                "score": score.get(key, source.get("score"))}
    pick = ((payload.get("voting") or {}).get("map") or {}).get("pick") or []
    return {"match_id": identifier, "team1": team("faction1"), "team2": team("faction2"),
            "map_name": canonical_map_name(str(pick[0])) if len(pick) == 1 else None,
            "maps": list(dict.fromkeys(canonical_map_name(str(m)) for m in pick)),
            "finished_at": payload.get("finished_at") or payload.get("finishedAt"),
            "status": str(payload.get("status") or "unknown")[:40],
            "faceit_url": f"https://www.faceit.com/en/cs2/room/{identifier}"}


class BridgeStore:
    def __init__(self, path=Path("data/faceit_bridge.db")):
        self.path = Path(path)

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        try:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
              CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, data TEXT, state TEXT, error TEXT, created REAL);
              CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, team_id TEXT, data TEXT, updated REAL);
              CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, match_id TEXT, state TEXT, error TEXT, demo_file TEXT, created REAL, source_key TEXT);
            """)
            if "source_key" not in {r["name"] for r in db.execute("PRAGMA table_info(imports)")}:
                db.execute("ALTER TABLE imports ADD COLUMN source_key TEXT")
            command_columns = {r["name"] for r in db.execute("PRAGMA table_info(commands)")}
            for column, kind in (("updated", "REAL"), ("stage", "TEXT")):
                if column not in command_columns:
                    db.execute(f"ALTER TABLE commands ADD COLUMN {column} {kind}")
            with db:
                yield db
        finally:
            db.close()

    def recover(self):
        with self.connect() as db:
            db.execute("UPDATE imports SET state='error',error='Backend restarted during import. Download again to retry; your original file was preserved.' WHERE state IN ('queued','importing')")
            db.execute("UPDATE commands SET state='error',error='Backend restarted. Retry the request in Import.' WHERE state='running'")

    def config(self):
        with self.connect() as db:
            config = {r["key"]: r["value"] for r in db.execute("SELECT * FROM config")}
            if "token" not in config:
                config["token"] = secrets.token_urlsafe(32)
                db.execute("INSERT OR IGNORE INTO config VALUES ('token',?)", (config["token"],))
                config["token"] = db.execute("SELECT value FROM config WHERE key='token'").fetchone()[0]
            config.setdefault("downloads_dir", str(Path.home() / "Downloads"))
            return config

    def queue(self, data):
        identifier = secrets.token_hex(12)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            encoded = json.dumps(data)
            identity = lambda value: {key: value[key] for key in ("kind", "url", "team_id", "match_id", "query") if key in value}
            for existing in db.execute("SELECT id,data FROM commands WHERE state IN ('queued','running') ORDER BY created DESC"):
                if identity(json.loads(existing["data"])) == identity(data):
                    return existing["id"]
            now = time.time()
            db.execute("INSERT INTO commands (id,data,state,error,created,updated) VALUES (?,?, 'queued', NULL, ?,?)", (identifier, encoded, now, now))
        return identifier

    def expire(self, db):
        for row in db.execute("SELECT * FROM commands WHERE state='running'").fetchall():
            kind = json.loads(row["data"]).get("kind", "team")
            timeout = 60 if kind == "download" else 300
            if (row["updated"] or row["created"]) < time.time() - timeout:
                error = ("The extension did not finish starting the download. Reload the extension in chrome://extensions, refresh Import, then retry."
                         if kind == "download" else "The extension stopped responding. Reload it and retry the request in Import.")
                db.execute("UPDATE commands SET state='error',error=? WHERE id=?", (error, row["id"]))

    def reconcile_imports(self, db):
        """A successful later manual/resumed import resolves an earlier attempt.

        Keep the original error in the audit data. Don't declare a BO3 request
        recovered while an expected map is still missing, or heal a later retry
        with a file imported before that retry.
        """
        for row in db.execute("SELECT * FROM commands WHERE state IN ('running','error')").fetchall():
            data = json.loads(row["data"])
            if data.get("kind") != "download":
                continue
            count = db.execute("SELECT COUNT(DISTINCT demo_file) FROM imports WHERE match_id=? AND state='done' AND demo_file IS NOT NULL AND created>=?",
                               (data.get("match_id"), row["created"])).fetchone()[0]
            if count < max(1, data.get("expected_count") or data.get("download_count") or 0):
                continue
            data.update(resolved_by_import=True, download_count=count, previous_error=row["error"])
            db.execute("UPDATE commands SET data=?,state='done',error=NULL,updated=? WHERE id=?", (json.dumps(data), time.time(), row["id"]))

    def claim(self, kinds=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.reconcile_imports(db)
            self.expire(db)
            row = next((row for row in db.execute("SELECT * FROM commands WHERE state='queued' ORDER BY created")
                        if kinds is None or json.loads(row["data"]).get("kind", "team") in kinds), None)
            if not row:
                return None
            db.execute("UPDATE commands SET state='running',updated=? WHERE id=?", (time.time(), row["id"]))
            return {"id": row["id"], **json.loads(row["data"])}


class TeamQuery(BaseModel):
    team_url: str = Field(max_length=500)


class TeamSearchResults(BaseModel):
    command_id: str
    teams: list[dict] = Field(max_length=30)
    error: str | None = Field(default=None, max_length=500)


class MatchDownload(BaseModel):
    match_id: str = Field(pattern=r"^" + ID + r"$")


class CommandResult(BaseModel):
    command_id: str
    download_count: int = Field(default=0, ge=0, le=5)
    expected_count: int | None = Field(default=None, ge=0, le=5)
    error: str | None = Field(default=None, max_length=500)


class CommandProgress(BaseModel):
    command_id: str
    stage: str = Field(pattern=r"^(opening_room|reading_demo_links|starting_downloads|reading_history|searching_teams)$")
    expected_count: int | None = Field(default=None, ge=0, le=5)


class BridgeConfig(BaseModel):
    downloads_dir: str = Field(max_length=500)


class SyncMatches(BaseModel):
    team_id: str = Field(max_length=80)
    command_id: str | None = None
    matches: list[dict] = Field(max_length=100)
    error: str | None = Field(default=None, max_length=500)


class ImportDownload(BaseModel):
    match_id: str = Field(pattern=r"^" + ID + r"$")
    path: str = Field(max_length=1024)
    metadata: dict


def download_path(root: Path, value: str) -> Path:
    root = root.resolve()
    original = Path(value)
    path = original.resolve()
    if not path.is_relative_to(root) or not path.is_file() or original.is_symlink():
        raise ValueError("The demo must be inside the monitored Downloads folder. Change that folder in Import if needed.")
    if not path.name.lower().endswith((".dem", ".dem.gz", ".dem.zst")):
        raise ValueError("Only .dem, .dem.gz and .dem.zst downloads can be imported.")
    return path


def unpack_demo(source: Path, target: Path, max_bytes: int):
    """Bound compressed *and* expanded size; original download is preserved."""
    if source.stat().st_size > max_bytes:
        raise ValueError("Downloaded demo exceeds the configured size limit.")
    with source.open("rb") as raw:
        if source.name.lower().endswith(".zst"):
            reader = zstandard.ZstdDecompressor().stream_reader(raw)
        elif source.name.lower().endswith(".gz"):
            reader = gzip.GzipFile(fileobj=raw)
        else:
            reader = raw
        try:
            written = 0
            digest = hashlib.sha256()
            with target.open("wb") as output:
                while chunk := reader.read(1024*1024):
                    written += len(chunk)
                    if written > max_bytes:
                        raise ValueError("Expanded demo exceeds the configured size limit.")
                    output.write(chunk)
                    digest.update(chunk)
            with target.open("rb") as demo:
                if demo.read(8) != b"PBDEMS2\x00":
                    raise ValueError("This file is not a valid CS2 demo.")
            return digest.hexdigest()
        finally:
            if reader is not raw:
                reader.close()


def install_faceit_bridge(app, upload_demo, store=None):
    store = store or BridgeStore()
    router = APIRouter(prefix="/api/ingest/faceit/bridge", tags=["FACEIT browser bridge"])
    import_lock = asyncio.Lock()
    router.add_event_handler("startup", store.recover)

    def local(request: Request):
        if request.url.hostname not in {"localhost", "127.0.0.1", "::1"} or not request.client or request.client.host not in {"127.0.0.1", "::1"}:
            raise HTTPException(403, "The browser bridge is only available on this computer.")

    def app_only(request: Request):
        local(request)
        origin = request.headers.get("origin")
        if origin and origin not in LOCAL_ORIGINS:
            raise HTTPException(403, "Open Import in the local app to configure the bridge.")

    def paired(request: Request):
        local(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not secrets.compare_digest(token, store.config()["token"]):
            raise HTTPException(401, "Pair the extension using the code in Import.")
        version = request.headers.get("x-cs2-bridge-version", "")[:30]
        # A legacy worker has no version header. Don't retain a capability
        # claim from a newer worker if the loaded one is subsequently replaced.
        version = version if re.fullmatch(r"\d+\.\d+\.\d+", version) else ""
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO config VALUES ('extension_version',?)", (version,))

    def require_automation():
        if not supports_automation(store.config().get("extension_version")):
            raise HTTPException(409, f"Reload CounterScout — FACEIT Bridge in chrome://extensions until it shows version {BRIDGE_VERSION}, then refresh Import. The loaded extension has not confirmed automatic-download support.")

    @router.get("/setup", dependencies=[Depends(app_only)])
    def setup():
        config = store.config()
        return {**config, "extension_path": str(Path("browser-extension").resolve()), "last_seen": config.get("last_seen"),
                "required_version": BRIDGE_VERSION, "automation_ready": supports_automation(config.get("extension_version"))}

    @router.put("/setup", dependencies=[Depends(app_only)])
    def configure(req: BridgeConfig):
        folder = Path(req.downloads_dir).resolve()
        if not folder.is_dir() or folder == Path(folder.anchor) or folder == Path.home().resolve():
            raise HTTPException(400, "Choose a specific existing Downloads folder, not a drive or home directory.")
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO config VALUES ('downloads_dir',?)", (str(folder),))
        return {"downloads_dir": str(folder)}

    @router.post("/teams", dependencies=[Depends(app_only)])
    def fetch_team(req: TeamQuery):
        query = req.team_url.strip()
        if "://" not in query and not query.lower().startswith(("www.", "faceit.com")):
            if len(query) < 2 or len(query) > 80:
                raise HTTPException(400, "Enter a team name (2–80 characters) or its FACEIT URL.")
            # Reuse an unambiguous team already verified through FACEIT.
            known = {}
            with store.connect() as db:
                for row in db.execute("SELECT data FROM matches"):
                    match = json.loads(row["data"])
                    for key in ("team1", "team2"):
                        team = match.get(key) or {}
                        if team.get("name", "").casefold() == query.casefold() and UUID.fullmatch(team.get("id", "")):
                            known[team["id"]] = team
            if len(known) == 1:
                identifier = next(iter(known))
                url = f"https://www.faceit.com/en/teams/{identifier}/stats"
                return {"team_id": identifier, "command_id": store.queue({"team_id": identifier, "url": url, "kind": "team"})}
            require_automation()
            return {"team_id": None, "command_id": store.queue({"query": query, "url": "https://www.faceit.com/en", "kind": "search"})}
        try:
            identifier, url = team_url(query)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"team_id": identifier, "command_id": store.queue({"team_id": identifier, "url": url, "kind": "team"})}

    @router.post("/search-results", dependencies=[Depends(paired)])
    def search_results(req: TeamSearchResults):
        with store.connect() as db:
            row = db.execute("SELECT data FROM commands WHERE id=?", (req.command_id,)).fetchone()
            data = json.loads(row["data"]) if row else {}
            if data.get("kind") != "search":
                raise HTTPException(400, "Unknown team search")
            found = {}
            for raw in req.teams:
                identifier, name = str(raw.get("id") or ""), str(raw.get("name") or "").strip()[:80]
                if not UUID.fullmatch(identifier) or identifier.startswith("1-") or not name:
                    continue
                found[identifier] = {"id": identifier, "name": name, "game": str(raw.get("game") or "")[:30],
                                     "nickname": str(raw.get("nickname") or "")[:80], "members": str(raw.get("members") or "")[:30],
                                     "url": f"https://www.faceit.com/en/teams/{identifier}/stats"}
            data["results"] = list(found.values())
            error = req.error or ("No teams found. Try another name or paste the team URL." if not found else None)
            db.execute("UPDATE commands SET data=?,state=?,error=? WHERE id=?", (json.dumps(data), "error" if error else "done", error, req.command_id))
        return {"saved": len(found)}

    @router.post("/downloads", dependencies=[Depends(app_only)])
    def download_match(req: MatchDownload):
        with store.connect() as db:
            row = db.execute("SELECT data FROM matches WHERE id=?", (req.match_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Sync this match into the library before downloading it.")
        require_automation()
        return {"command_id": store.queue({"kind": "download", "match_id": req.match_id,
                                          "url": f"https://www.faceit.com/en/cs2/room/{req.match_id}"})}

    @router.post("/command-result", dependencies=[Depends(paired)])
    def command_result(req: CommandResult):
        with store.connect() as db:
            row = db.execute("SELECT data FROM commands WHERE id=?", (req.command_id,)).fetchone()
            data = json.loads(row["data"]) if row else {}
            if data.get("kind") != "download":
                raise HTTPException(400, "Unknown download request")
            if data.get("resolved_by_import"):
                return {"ok": True, "resolved_by_import": True}
            data["download_count"] = req.download_count
            if req.expected_count is not None:
                data["expected_count"] = req.expected_count
            error = req.error or ("No downloadable demos were found. Open the match room and download normally." if not req.download_count else None)
            db.execute("UPDATE commands SET data=?,state=?,error=? WHERE id=?", (json.dumps(data), "error" if error else "done", error, req.command_id))
            store.reconcile_imports(db)
        return {"ok": True}

    @router.post("/progress", dependencies=[Depends(paired)])
    def progress(req: CommandProgress):
        with store.connect() as db:
            row = db.execute("SELECT data,state FROM commands WHERE id=?", (req.command_id,)).fetchone()
            if not row:
                raise HTTPException(400, "Unknown extension request")
            if row["state"] != "running":
                return {"ok": False}
            data = json.loads(row["data"])
            if req.expected_count is not None:
                data["expected_count"] = req.expected_count
            db.execute("UPDATE commands SET data=?,stage=?,updated=? WHERE id=?", (json.dumps(data), req.stage, time.time(), req.command_id))
        return {"ok": True}

    @router.get("/commands", dependencies=[Depends(paired)])
    def commands(request: Request):
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO config VALUES ('last_seen',?)", (str(time.time()),))
        # Old workers only understand team history. Never let one claim a new
        # command and silently abandon it after a schema/unsupported-URL error.
        kinds = None if supports_automation(request.headers.get("x-cs2-bridge-version")) else {"team"}
        return {"command": store.claim(kinds)}

    @router.get("/ping", dependencies=[Depends(paired)])
    def ping():
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO config VALUES ('last_seen',?)", (str(time.time()),))
        return {"connected": True}

    @router.post("/matches", dependencies=[Depends(paired)])
    def sync(req: SyncMatches):
        if req.team_id and not UUID.fullmatch(req.team_id):
            raise HTTPException(400, "Invalid FACEIT team ID")
        count = 0
        with store.connect() as db:
            for raw in req.matches:
                try:
                    match = normalize_match(raw)
                except (ValueError, TypeError, AttributeError):
                    continue
                if req.team_id and req.team_id not in (match["team1"]["id"], match["team2"]["id"]):
                    continue
                db.execute("INSERT OR REPLACE INTO matches VALUES (?,?,?,?)", (match["match_id"], req.team_id, json.dumps(match), time.time()))
                count += 1
            if req.command_id:
                error = req.error or ("No matching CS2 match metadata was found for this team." if not count else None)
                db.execute("UPDATE commands SET state=?,error=? WHERE id=?", ("error" if error else "done", error, req.command_id))
        return {"saved": count}

    @router.get("/library", dependencies=[Depends(app_only)])
    def library():
        with store.connect() as db:
            store.reconcile_imports(db)
            store.expire(db)
            return {"matches": [{**json.loads(r["data"]), "team_id": r["team_id"]} for r in db.execute("SELECT * FROM matches ORDER BY updated DESC LIMIT 200")],
                    "commands": [{"id": r["id"], "state": r["state"], "error": r["error"], "created": r["created"], "stage": r["stage"],
                                  **json.loads(r["data"])} for r in db.execute("SELECT * FROM commands ORDER BY created DESC LIMIT 30")],
                    "imports": [dict(r) for r in db.execute("SELECT * FROM imports ORDER BY created DESC LIMIT 30")]}

    async def import_file(identifier, req, source):
        async with import_lock:
            target = Path("data/faceit-imports") / f"{identifier}.dem"
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                with store.connect() as db:
                    db.execute("UPDATE imports SET state='importing' WHERE id=?", (identifier,))
                digest = await asyncio.to_thread(unpack_demo, source, target, settings.max_demo_size_mb*1024*1024)
                # BO3/BO5 downloads share a room ID. Hash the decompressed demo,
                # not the match ID or download filename, to retain every map.
                name = f"faceit_{req.match_id}_{digest[:20]}.dem"
                metadata = normalize_match(req.metadata)
                if (settings.demo_dir / name).exists():
                    with store.connect() as db:
                        completed = db.execute("SELECT id FROM imports WHERE demo_file=? AND state='done' LIMIT 1", (name,)).fetchone()
                    if not completed:
                        raise ValueError("An incomplete import already exists. Remove that demo in Replay and download again to retry; the original download was preserved.")
                else:
                    with target.open("rb") as handle:
                        result = await upload_demo(file=UploadFile(filename=name, file=handle), team1_name=None, team2_name=None,
                                                   faceit_metadata=json.dumps(metadata))
                    name = result.demo_file
                with store.connect() as db:
                    db.execute("UPDATE imports SET state='done',demo_file=? WHERE id=?", (name, identifier))
                    store.reconcile_imports(db)
            except Exception as exc:
                message = str(getattr(exc, "detail", None) or exc)[:500]
                with store.connect() as db:
                    db.execute("UPDATE imports SET state='error',error=? WHERE id=?", (message, identifier))
            finally:
                target.unlink(missing_ok=True)

    @router.post("/imports", dependencies=[Depends(paired)], status_code=202)
    async def import_download(req: ImportDownload, background: BackgroundTasks):
        try:
            source = download_path(Path(store.config()["downloads_dir"]), req.path)
            metadata = normalize_match(req.metadata)
            if metadata["match_id"] != req.match_id:
                raise ValueError("The match metadata does not match this download.")
            if any(not (metadata[key]["players"] or metadata[key]["steamids"]) for key in ("team1", "team2")):
                raise ValueError("FACEIT did not provide both player rosters. Open the match room and retry, or upload the demo manually.")
        except (ValueError, OSError, TypeError, AttributeError) as exc:
            raise HTTPException(400, str(exc))
        with store.connect() as db:
            stat = source.stat()
            source_key = hashlib.sha256(f"{source}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()
            previous = db.execute("SELECT id,state,demo_file FROM imports WHERE match_id=? AND source_key=? AND state IN ('queued','importing','done')", (req.match_id, source_key)).fetchone()
            if previous and previous["state"] == "done" and not (settings.demo_dir / str(previous["demo_file"])).exists():
                previous = None  # Allow reimport after the user deletes a demo.
            if previous:
                return dict(previous)
            identifier = secrets.token_hex(12)
            db.execute("INSERT INTO imports (id,match_id,state,created,source_key) VALUES (?,?,'queued',?,?)", (identifier, req.match_id, time.time(), source_key))
        background.add_task(import_file, identifier, req, source)
        return {"id": identifier, "state": "queued"}

    app.include_router(router)
    return store
