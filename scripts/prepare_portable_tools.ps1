# Download + extract the official archiver into build/, without installing it.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$vendorDir = Join-Path $projectRoot 'build/vendor/7zip'
New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
$assets = @(
    @{Name='7z2603-x64.msi'; Hash='C0680064D698A62DD4A5A47F403DB356A6531A5473E4C4B1D090EA2590513926'},
    @{Name='7z2603-src.tar.xz'; Hash='9CBDE5099C6DEB73691B0579063DA5827522CCBBCBA3F0020FD04E8C8C16C0D4'}
)
foreach ($asset in $assets) {
    $target = Join-Path $vendorDir $asset.Name
    if (-not (Test-Path -LiteralPath $target)) {
        Invoke-WebRequest -UseBasicParsing -Uri ('https://github.com/ip7z/7zip/releases/download/26.03/' + $asset.Name) -OutFile $target
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $actualHash = [System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($target))).Replace('-', '') }
    finally { $sha.Dispose() }
    if ($actualHash -ne $asset.Hash) {
        throw ('Checksum mismatch: ' + $target)
    }
}
$extracted = Join-Path $vendorDir 'extracted'
$msi = Join-Path $vendorDir '7z2603-x64.msi'
if (-not (Test-Path -LiteralPath (Join-Path $extracted 'Files/7-Zip/7z.exe'))) {
    $arguments = @('/a', ('"' + $msi + '"'), '/qn', ('TARGETDIR="' + $extracted + '"'), '/norestart')
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw ('7-Zip archive extraction failed: ' + $process.ExitCode) }
}
Write-Output ('Portable archiver ready: ' + (Join-Path $extracted 'Files/7-Zip'))
