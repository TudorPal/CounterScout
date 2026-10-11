"""Local-only, write-only API-key configuration for the browser/portable app."""
import asyncio
import os
from pathlib import Path
import tempfile

from dotenv import set_key
from fastapi import APIRouter, HTTPException, Request
from backend.config import settings
from backend.analysis.tactical_ai import configuration

router = APIRouter()
_LOCK = asyncio.Lock()
ENV_PATH = Path('.env')  # Project cwd, or portable launcher-owned user-data cwd.
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
LOCAL_ORIGINS = {f'http://{host}:{port}' for host in ('localhost', '127.0.0.1', '[::1]') for port in (5173, 3000, 8000)}


def local_app(request):
    if request.url.hostname not in LOCAL_HOSTS or not request.client or request.client.host not in {'127.0.0.1', '::1'}:
        raise HTTPException(403, 'AI keys can only be configured on this computer.')
    origin = request.headers.get('origin')
    if origin and origin not in LOCAL_ORIGINS or request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Open Settings in the local CounterScout browser page.')


def persist(provider, key, remove):
    env_name = 'GROQ_API_KEY' if provider == 'groq' else 'OPENROUTER_API_KEY'
    updates = {'TEAM_AI_PROVIDER': provider}
    if key or remove:
        updates[env_name] = '' if remove else key
    # Copy/update/replace atomically so unrelated .env settings survive failures.
    temporary = None
    try:
        target = ENV_PATH.resolve()
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            if target.exists():
                stream.write(target.read_text(encoding='utf-8'))
        for name, value in updates.items():
            set_key(temporary, name, value, quote_mode='always')
        os.chmod(temporary, 0o600)
        temporary.replace(target)
        temporary = None
    except OSError:
        raise HTTPException(500, 'Could not save AI settings. Check that the local data folder is writable.') from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    # Apply without restart; overwrite launcher-loaded env as well for consistency.
    for name, value in updates.items():
        os.environ[name] = value
        setattr(settings, name.lower(), value)


@router.put('/api/settings/ai', summary='Save a local AI key; the key is never returned')
async def save_ai_settings(request: Request):
    local_app(request)
    if request.headers.get('content-type', '').split(';')[0] != 'application/json':
        raise HTTPException(415, 'AI settings require an application/json request.')
    # Manual validation avoids FastAPI echoing a secret input in validation errors.
    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(400, 'Invalid AI settings JSON.') from None
    if not isinstance(data, dict) or set(data) - {'provider', 'api_key', 'remove_key'}:
        raise HTTPException(422, 'Invalid AI settings fields.')
    provider, key, remove = data.get('provider'), data.get('api_key', ''), data.get('remove_key', False)
    if provider not in ('groq', 'openrouter') or not isinstance(key, str) or not isinstance(remove, bool):
        raise HTTPException(422, 'Choose Groq or OpenRouter and supply a text key.')
    key = key.strip()
    if len(key) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in key) or key and remove:
        raise HTTPException(422, 'The key must be a single API-key token. Choose replacement or removal, not both.')
    if provider == 'openrouter' and settings.openrouter_model != 'openrouter/free' and not settings.openrouter_model.endswith(':free'):
        raise HTTPException(422, 'Set a free OpenRouter model before selecting this provider.')
    async with _LOCK:
        await asyncio.to_thread(persist, provider, key, remove)
    return configuration()  # Only provider/model/configured status; no key or suffix.
