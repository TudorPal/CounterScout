# Portable release

Recipients extract the ZIP and run `CounterScout.exe`. Both services start
automatically, and the built React UI opens in their browser. No Node, Python,
virtual environment or Docker is required on their computer.

## Build (developer only)

From the project root on 64-bit Windows, with existing project dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r packaging\requirements-build.txt
.\scripts\windows\build_portable.bat
```

Output: `dist/CounterScout-<VERSION>-windows-x64.zip` and the matching folder.
The build refuses to overwrite an existing release. Never ship development
`.env`, demos or databases; the build includes only compiled frontend, backend,
map assets, dependency runtimes/licenses and the FACEIT extension.

The frontend is static: it does not run Vite or require Node. A streaming proxy
on 127.0.0.1:5173 forwards API calls to the bundled backend on 127.0.0.1:8000,
preserving the extension's current origins and direct download bridge.

The default build downloads checksum-pinned official 7-Zip 26.03 into `build/`,
extracts its MSI without installing it, and bundles `7z.exe`, `7z.dll`, license
information and matching source for HLTV RAR extraction. Recipients install
nothing. `--without-archiver` skips this; RAR compatibility then depends on their
installed tools/Windows tar. Native 7-Zip files remain replaceable under `tools/`.

## Versioning

`VERSION` is the release source of truth. The API/OpenAPI, frontend brand tooltip,
launcher, Windows executable properties and ZIP/folder names all read it. Frontend npm and Chrome extension
manifest versions describe their own packages, not the app release.

Use `MAJOR.MINOR.PATCH`: patch for fixes, minor for features, major for breaking
changes. Bump it when preparing a new release, then rebuild; do not silently
replace an already shared ZIP with different code under the same version.

## Verify

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_portable.py
.\.venv\Scripts\python.exe scripts\test_portable_bundle.py --bundle dist\CounterScout-1.1.1-windows-x64
# Optional full upload/replay test with a real local demo (never shipped):
.\.venv\Scripts\python.exe scripts\test_portable_bundle.py --bundle dist\CounterScout-1.1.1-windows-x64 --demo demos\example.dem
```

Tests use an isolated temporary data directory, strip Python/Node and archivers
from PATH, and check static assets, deep links, API proxy, map resources, extension
pairing, duplicate launch, occupied-port errors, shutdown and data persistence.
An actual Chrome/faceit.com download and a clean Windows VM remain release checks.
The launcher intentionally keeps a console open for Ctrl+C and useful diagnostics.
This initial build is unsigned; public distribution should add code signing.
