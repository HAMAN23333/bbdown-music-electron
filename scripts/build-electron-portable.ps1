param(
    [string]$AppName = "BBDownMusicApp",
    [string]$ElectronVersion = "42.0.0",
    [switch]$AllowMissingDigest
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "scripts/build-electron-portable.ps1 supports Windows only."
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "scripts/build-electron-portable.ps1 supports Windows x64 only."
}

$Root = Split-Path -Parent $PSScriptRoot
$DistBase = Join-Path $Root "dist"
$WorkDir = Join-Path $DistBase "$AppName-electron"
$ZipPath = Join-Path $DistBase "$AppName-electron-win64-portable.zip"
$TmpDir = Join-Path $Root "tmp"

$ElectronAssetName = "electron-v$ElectronVersion-win32-x64.zip"
$ElectronZip = Join-Path $TmpDir $ElectronAssetName
$ElectronUrl = "https://github.com/electron/electron/releases/download/v$ElectronVersion/$ElectronAssetName"
$ElectronReleaseApi = "https://api.github.com/repos/electron/electron/releases/tags/v$ElectronVersion"
$ProbeDir = Join-Path $TmpDir "_electron-zip-probe"

function Convert-AssetDigestToSha256([string]$Digest) {
    $text = [string]$Digest
    if ([string]::IsNullOrWhiteSpace($text)) {
        return ""
    }
    $text = $text.Trim()
    if ($text -match "^sha256:([0-9a-fA-F]{64})$") {
        return $Matches[1].ToLowerInvariant()
    }
    if ($text -match "^[0-9a-fA-F]{64}$") {
        return $text.ToLowerInvariant()
    }
    return ""
}

function Get-ReleaseAssetSha256([string]$ReleaseApi, [string]$AssetName, [switch]$AllowMissingDigestFlag) {
    $release = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ "User-Agent" = "bbdown-ui-electron-build" }
    $asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $asset) {
        throw "Unable to find asset $AssetName in release api $ReleaseApi"
    }
    $sha = Convert-AssetDigestToSha256 "$($asset.digest)"
    if ([string]::IsNullOrWhiteSpace($sha)) {
        if ($AllowMissingDigestFlag) {
            Write-Warning "[electron] release asset digest missing, skip SHA256 verification."
            return ""
        }
        throw "Release asset digest missing for $AssetName. Re-run with -AllowMissingDigest to bypass (not recommended)."
    }
    return $sha
}

function Assert-FileSha256([string]$FilePath, [string]$ExpectedSha256) {
    if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
        return
    }
    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256) {
        throw "SHA256 mismatch. expected=$ExpectedSha256, actual=$actual, file=$FilePath"
    }
}

function Test-ElectronArchive([string]$ZipPath, [string]$ProbePath) {
    if (Test-Path $ProbePath) {
        Remove-Item -Recurse -Force $ProbePath
    }
    New-Item -ItemType Directory -Force -Path $ProbePath | Out-Null
    try {
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $ProbePath -Force
        return (Test-Path (Join-Path $ProbePath "electron.exe"))
    }
    catch {
        return $false
    }
    finally {
        if (Test-Path $ProbePath) {
            Remove-Item -Recurse -Force $ProbePath
        }
    }
}

function Download-ElectronArchive([string]$Url, [string]$ZipPath) {
    if (Test-Path $ZipPath) {
        Remove-Item -Force $ZipPath
    }
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath
}

$expectedElectronSha256 = Get-ReleaseAssetSha256 -ReleaseApi $ElectronReleaseApi -AssetName $ElectronAssetName -AllowMissingDigestFlag:$AllowMissingDigest
if (-not [string]::IsNullOrWhiteSpace($expectedElectronSha256)) {
    Write-Host "[electron] expected sha256: $expectedElectronSha256"
}

if (Test-Path $WorkDir) {
    Remove-Item -Recurse -Force $WorkDir
}
New-Item -ItemType Directory -Force -Path $DistBase, $TmpDir | Out-Null

Write-Host "[electron] download $ElectronUrl"
if (-not (Test-Path $ElectronZip)) {
    Download-ElectronArchive -Url $ElectronUrl -ZipPath $ElectronZip
    Assert-FileSha256 -FilePath $ElectronZip -ExpectedSha256 $expectedElectronSha256
}
else {
    Write-Host "[electron] use cached zip: $ElectronZip"
    $cachedArchiveValid = Test-ElectronArchive -ZipPath $ElectronZip -ProbePath $ProbeDir
    $cachedHashValid = $true
    if (-not [string]::IsNullOrWhiteSpace($expectedElectronSha256)) {
        try {
            Assert-FileSha256 -FilePath $ElectronZip -ExpectedSha256 $expectedElectronSha256
        }
        catch {
            $cachedHashValid = $false
            Write-Warning "[electron] cached zip sha256 mismatch, redownload"
        }
    }
    if ((-not $cachedArchiveValid) -or (-not $cachedHashValid)) {
        if (-not $cachedArchiveValid) {
            Write-Host "[electron] cached zip invalid, redownload"
        }
        Download-ElectronArchive -Url $ElectronUrl -ZipPath $ElectronZip
        Assert-FileSha256 -FilePath $ElectronZip -ExpectedSha256 $expectedElectronSha256
    }
}

Write-Host "[electron] extract"
try {
    Expand-Archive -LiteralPath $ElectronZip -DestinationPath $WorkDir -Force
}
catch {
    Write-Host "[electron] extract failed, redownload and retry"
    Download-ElectronArchive -Url $ElectronUrl -ZipPath $ElectronZip
    Assert-FileSha256 -FilePath $ElectronZip -ExpectedSha256 $expectedElectronSha256
    Expand-Archive -LiteralPath $ElectronZip -DestinationPath $WorkDir -Force
}

$ResourcesApp = Join-Path $WorkDir "resources\app"
New-Item -ItemType Directory -Force -Path $ResourcesApp | Out-Null

Copy-Item -Force (Join-Path $Root "packaging\electron\package.json") (Join-Path $ResourcesApp "package.json")
Copy-Item -Force (Join-Path $Root "packaging\electron\main.js") (Join-Path $ResourcesApp "main.js")
Copy-Item -Force (Join-Path $Root "packaging\electron\preload.js") (Join-Path $ResourcesApp "preload.js")

Copy-Item -Force (Join-Path $Root "server.js") (Join-Path $ResourcesApp "server.js")
Copy-Item -Recurse -Force (Join-Path $Root "public") (Join-Path $ResourcesApp "public")
Copy-Item -Recurse -Force (Join-Path $Root "tools") (Join-Path $ResourcesApp "tools")
New-Item -ItemType Directory -Force -Path (Join-Path $ResourcesApp "downloads") | Out-Null

$ExeSrc = Join-Path $WorkDir "electron.exe"
$ExeDst = Join-Path $WorkDir "$AppName.exe"
if (Test-Path $ExeSrc) {
    Move-Item -Force $ExeSrc $ExeDst
}
if (-not (Test-Path $ExeDst)) {
    throw "Portable exe missing: $ExeDst"
}

$Readme = @"
$AppName Electron Portable

1. Extract this folder.
2. Double-click $AppName.exe
3. The app uses built-in Electron Chromium window (no local browser).

Do not move files out of this folder structure.
"@
$Readme | Set-Content -Encoding UTF8 (Join-Path $WorkDir "README-ELECTRON-PORTABLE.txt")

if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}
Compress-Archive -Path (Join-Path $WorkDir "*") -DestinationPath $ZipPath -Force

Write-Host "[electron] done"
Write-Host "[electron] folder: $WorkDir"
Write-Host "[electron] zip: $ZipPath"
