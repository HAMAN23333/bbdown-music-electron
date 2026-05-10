param(
    [string]$AssetName = "ffmpeg-master-latest-win64-gpl.zip",
    [string]$Tag = "",
    [switch]$AllowMissingDigest
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "scripts/setup-ffmpeg.ps1 supports Windows only."
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "scripts/setup-ffmpeg.ps1 supports Windows x64 only."
}

$Root = Split-Path -Parent $PSScriptRoot
$TargetDir = Join-Path $Root "tools\ffmpeg"
$ExtractDir = Join-Path $TargetDir "_extract"
$ExePath = Join-Path $TargetDir "ffmpeg.exe"

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

function Assert-FileSha256([string]$FilePath, [string]$ExpectedSha256) {
    if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
        return
    }
    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256) {
        throw "SHA256 mismatch. expected=$ExpectedSha256, actual=$actual, file=$FilePath"
    }
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Tag)) {
    $ReleaseApi = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
}
else {
    $ReleaseApi = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/$Tag"
}

$release = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ "User-Agent" = "bbdown-ui-setup-ffmpeg" }
$asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $asset) {
    $names = ($release.assets | Select-Object -ExpandProperty name) -join ", "
    throw "Unable to find release asset: $AssetName. Available assets: $names"
}

$expectedSha256 = Convert-AssetDigestToSha256 "$($asset.digest)"
if ([string]::IsNullOrWhiteSpace($expectedSha256)) {
    if ($AllowMissingDigest) {
        Write-Warning "[setup-ffmpeg] release asset digest missing, skip SHA256 verification."
    }
    else {
        throw "Release asset digest missing. Re-run with -AllowMissingDigest to bypass (not recommended)."
    }
}

$ZipPath = Join-Path $TargetDir $AssetName
Write-Host "[setup-ffmpeg] download: $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $ZipPath
Assert-FileSha256 -FilePath $ZipPath -ExpectedSha256 $expectedSha256
if (-not [string]::IsNullOrWhiteSpace($expectedSha256)) {
    Write-Host "[setup-ffmpeg] sha256 verified: $expectedSha256"
}

if (Test-Path $ExtractDir) {
    Remove-Item -Recurse -Force $ExtractDir
}
Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force

$BinDir = Get-ChildItem -Path $ExtractDir -Recurse -Directory | Where-Object { $_.Name -eq "bin" } | Select-Object -First 1
if (-not $BinDir) {
    throw "FFmpeg bin directory was not found after extraction."
}

$KeepNames = @("_extract", (Split-Path -Leaf $ZipPath))
Get-ChildItem -Path $TargetDir -Force | Where-Object { $KeepNames -notcontains $_.Name } | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $BinDir.FullName "*") -Destination $TargetDir -Recurse -Force

if (-not (Test-Path $ExePath)) {
    throw "ffmpeg.exe was not found: $ExePath"
}

Remove-Item -Recurse -Force $ExtractDir
Remove-Item -Force $ZipPath

Write-Host "[setup-ffmpeg] done: $ExePath"
