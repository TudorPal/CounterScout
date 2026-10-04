# Checked-in PyInstaller specification: assets only, never developer data.
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules
from PyInstaller.utils.win32.versioninfo import VSVersionInfo, FixedFileInfo, StringFileInfo, StringTable, StringStruct, VarFileInfo, VarStruct

root = Path(SPECPATH).parent
version = (root / "VERSION").read_text(encoding="utf-8").strip()
numeric_version = tuple(map(int, version.split("-")[0].split("."))) + (0,)
version_info = VSVersionInfo(ffi=FixedFileInfo(filevers=numeric_version, prodvers=numeric_version), kids=[
    StringFileInfo([StringTable("040904B0", [StringStruct("FileDescription", "CounterScout browser launcher"),
                    StringStruct("ProductName", "CounterScout"), StringStruct("FileVersion", version),
                    StringStruct("ProductVersion", version), StringStruct("OriginalFilename", "CounterScout.exe")])]),
    VarFileInfo([VarStruct("Translation", [1033, 1200])])])
datas = [(str(root / "VERSION"), "."),
         (str(root / "frontend/dist"), "frontend/dist"),
         (str(root / "backend/data/radars"), "backend/data/radars"),
         (str(root / "backend/data/callouts"), "backend/data/callouts")]
binaries = []
hiddenimports = collect_submodules("backend") + collect_submodules("uvicorn")
for package in ("demoparser2", "curl_cffi", "sklearn", "zstandard"):
    package_data, package_binaries, package_imports = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_imports

a = Analysis([str(root / "packaging/launcher.py")], pathex=[str(root)],
             datas=datas, binaries=binaries, hiddenimports=hiddenimports,
             excludes=["pytest", "IPython", "jupyter", "notebook", "tkinter"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="CounterScout", version=version_info, console=True, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name="CounterScout", upx=False)
