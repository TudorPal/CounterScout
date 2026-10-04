# Windows launchers

These scripts resolve the repository root relative to their own location, so
double-clicking them or invoking them from another directory is supported.

From the repository root:

```powershell
.\scripts\windows\install.bat        # First-time developer setup
.\run_dev.bat                        # Start both development services
.\scripts\windows\run_backend.bat    # Backend only
.\scripts\windows\run_frontend.bat   # Frontend only
.\scripts\windows\build_portable.bat # Build the versioned portable ZIP
```

Recipients use `CounterScout.exe` from the ZIP, not these developer scripts.
Portable build tools: `.venv\Scripts\python.exe -m pip install -r packaging\requirements-build.txt`.
