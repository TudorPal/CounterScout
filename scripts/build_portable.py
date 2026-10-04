"""Build a versioned, clean Windows portable folder and ZIP."""
import argparse
import importlib.metadata
import platform
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def release_name(version: str) -> str:
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("VERSION must contain a release version such as 1.1.0 or 1.2.0-beta.1")
    return f"CounterScout-{version}-windows-x64"


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def copy_licenses(target: Path):
    target.mkdir(parents=True, exist_ok=True)
    for dist in importlib.metadata.distributions():
        name = re.sub(r"[^a-zA-Z0-9_.-]", "_", dist.metadata.get("Name", "dependency"))
        for file in dist.files or []:
            if not any(marker in file.name.lower() for marker in ("license", "licence", "copying", "notice")):
                continue
            source = Path(dist.locate_file(file))
            if source.is_file():
                destination = target / name / str(file).replace("/", "_").replace("\\", "_")
                destination.parent.mkdir(exist_ok=True)
                shutil.copy2(source, destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-frontend", action="store_true", help="Reuse an already built frontend")
    parser.add_argument("--no-zip", action="store_true")
    parser.add_argument("--without-archiver", action="store_true", help="Omit bundled 7-Zip (HLTV RAR support may need a separate tool)")
    args = parser.parse_args()
    if sys.platform != "win32" or platform.machine().lower() not in ("amd64", "x86_64"):
        raise RuntimeError("This first portable target must be built on 64-bit Windows.")
    name = release_name((ROOT / "VERSION").read_text(encoding="utf-8").strip())
    output = ROOT / "dist" / name
    archive = Path(str(output) + ".zip")
    if output.exists() or archive.exists():
        raise RuntimeError(f"Release already exists: {output}. Bump VERSION or move the old artifact; builds never overwrite a release.")
    if not args.without_archiver:
        run(shutil.which("pwsh.exe") or "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/prepare_portable_tools.ps1"))
    try:
        importlib.metadata.version("pyinstaller")
    except importlib.metadata.PackageNotFoundError:
        raise RuntimeError("Install developer build tools: .venv\\Scripts\\python.exe -m pip install -r packaging/requirements-build.txt")
    if not args.skip_frontend:
        npm = shutil.which("npm.cmd")
        if not npm:
            raise RuntimeError("Node/npm is needed on the build machine only.")
        run(npm, "--prefix", str(ROOT / "frontend"), "run", "build")
    stage = ROOT / "build" / name / "output"
    run(sys.executable, "-m", "PyInstaller", "--noconfirm", "--distpath", str(stage),
        "--workpath", str(ROOT / "build" / name / "pyinstaller"), str(ROOT / "packaging/portable.spec"))
    output.parent.mkdir(exist_ok=True)
    shutil.move(str(stage / "CounterScout"), str(output))
    shutil.copytree(ROOT / "browser-extension", output / "browser-extension",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(ROOT / "VERSION", output / "VERSION")
    shutil.copy2(ROOT / "packaging/PORTABLE-README.txt", output / "README.txt")
    shutil.copy2(ROOT / "packaging/portable.env.example", output / "portable.env.example")
    copy_licenses(output / "third-party-licenses")
    if not args.without_archiver:
        source = ROOT / "build/vendor/7zip/extracted/Files/7-Zip"
        for filename in ("7z.exe", "7z.dll", "License.txt"):
            if not (source / filename).is_file():
                raise RuntimeError(f"Archiver directory must include {filename}")
        tools = output / "tools"
        tools.mkdir()
        for filename in ("7z.exe", "7z.dll", "License.txt"):
            shutil.copy2(source / filename, tools / filename)
        shutil.copy2(ROOT / "build/vendor/7zip/7z2603-src.tar.xz", tools / "7z2603-src.tar.xz")
    # A clean release must never contain personal demos, databases or API keys.
    for path in output.rglob("*"):
        if path.name == ".env" or path.suffix.lower() in {".dem", ".db", ".sqlite"} or "user-data" in path.relative_to(output).parts:
            raise RuntimeError(f"Private runtime data found in build: {path}")
    if not args.no_zip:
        temporary_archive = stage / (name + ".zip")
        with zipfile.ZipFile(temporary_archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
            for path in output.rglob("*"):
                if path.is_file():
                    zipped.write(path, path.relative_to(output.parent))
        temporary_archive.replace(archive)
        print(f"\nShare this file: {archive}", flush=True)
    print(f"Portable folder: {output}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"Build failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
