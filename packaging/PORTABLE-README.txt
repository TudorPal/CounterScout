CounterScout - Portable Windows edition

1. Extract the ENTIRE ZIP into a writable local folder, not Program Files.
2. Double-click CounterScout.exe. No Python, Node or installation is needed.
3. CounterScout opens in your default browser at http://127.0.0.1:5173.
   For the FACEIT extension, open that address in Chrome.
4. Keep the launcher window open. Ctrl+C stops both local services.
   Closing the browser tab does not stop the application.

Personal demos, databases, caches and settings live in user-data beside the EXE.
To update, extract the newer release and copy your user-data folder into it.
Do not run this alongside development servers using ports 8000 / 5173.
Launching the same copy twice reopens its browser interface.
The first unsigned build may trigger Windows SmartScreen. Only run trusted files.

FACEIT automatic imports (optional):
- Open chrome://extensions and enable Developer mode.
- Choose Load unpacked and select this bundle's browser-extension folder.
- Open Settings > FACEIT extension for pairing and Downloads-folder setup.
- Stay signed in to FACEIT in Chrome. No FACEIT API key is required for the bridge.
- After an update, reload the extension if its files changed.

HLTV RAR archives:
The default build includes 7-Zip tools, license information and matching source
under tools/, so recipients do not need a separate archiver installation.
If tools/ was deliberately omitted, installed archivers/Windows tar are used;
some archives may require 7-Zip. Plain DEM and FACEIT uploads do not need it.

AI recaps are optional and need your own AI provider key.
For a free Groq key and team tactical reports, see docs/ai-team-analysis.md.
Open Settings > AI analysis in the browser, paste your own free Groq key and Save.
The key applies immediately. Replace/remove it there later; existing keys stay hidden.
Your key is stored in user-data/.env (plaintext). The shared ZIP contains no key.
Alternatively copy portable.env.example to user-data/.env and restart after editing.
Never send your configured .env or user-data folder to other people.

Troubleshooting:
- Startup errors stay visible in the launcher window.
- Logs: user-data/logs/CounterScout.log.
- Port conflict: stop the old CounterScout/dev terminal with Ctrl+C and retry.
- The app binds only to this computer's IPv4 loopback, not the public network.

Credits and licensing:
CounterScout started from Twoos123/cs2-meta-engine, including its initial
structure and HLTV import foundation. See docs/credits.md, LICENSE and NOTICE.md.
MIT covers original CounterScout contributions only, not inherited code/assets.
Upstream permission is unresolved: this build is for local verification, not
public redistribution or open-source signing until those rights are cleared.
