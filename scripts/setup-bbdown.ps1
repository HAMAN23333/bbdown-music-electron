param(
    [string]$Version = "",
    [switch]$AllowMissingDigest
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "scripts/setup-bbdown.ps1 supports Windows only."
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "scripts/setup-bbdown.ps1 supports Windows x64 only."
}

$Root = Split-Path -Parent $PSScriptRoot
$TargetDir = Join-Path $Root "tools\bbdown"
$ExtractDir = Join-Path $TargetDir "_extract"
$ExePath = Join-Path $TargetDir "BBDown.exe"

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
    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256) {
        throw "SHA256 mismatch. expected=$ExpectedSha256, actual=$actual, file=$FilePath"
    }
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Version)) {
    $ReleaseApi = "https://api.github.com/repos/nilaoda/BBDown/releases/latest"
}
else {
    $ReleaseApi = "https://api.github.com/repos/nilaoda/BBDown/releases/tags/$Version"
}

$release = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ "User-Agent" = "bbdown-ui-setup" }
$resolvedVersion = "$($release.tag_name)"
if ([string]::IsNullOrWhiteSpace($resolvedVersion)) {
    throw "Unable to resolve BBDown release version."
}
$asset = $release.assets | Where-Object { $_.name -match "win-x64\.zip$" } | Select-Object -First 1
if (-not $asset) {
    throw "Unable to find win-x64 asset in release $resolvedVersion."
}
$expectedSha256 = Convert-AssetDigestToSha256 "$($asset.digest)"
if ([string]::IsNullOrWhiteSpace($expectedSha256)) {
    if ($AllowMissingDigest) {
        Write-Warning "[setup-bbdown] release asset digest missing, skip SHA256 verification."
    }
    else {
        throw "Release asset digest missing. Re-run with -AllowMissingDigest to bypass (not recommended)."
    }
}

$ZipPath = Join-Path $TargetDir "BBDown_${resolvedVersion}.zip"
Write-Host "[setup-bbdown] download: $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $ZipPath
if (-not [string]::IsNullOrWhiteSpace($expectedSha256)) {
    Assert-FileSha256 -FilePath $ZipPath -ExpectedSha256 $expectedSha256
    Write-Host "[setup-bbdown] sha256 verified: $expectedSha256"
}

if (Test-Path $ExtractDir) {
    Remove-Item -Recurse -Force $ExtractDir
}
Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force

$FoundExe = Get-ChildItem -Recurse -File $ExtractDir | Where-Object { $_.Name -eq "BBDown.exe" } | Select-Object -First 1
if (-not $FoundExe) {
    throw "BBDown.exe not found after extraction."
}

Copy-Item -Path $FoundExe.FullName -Destination $ExePath -Force
Remove-Item -Recurse -Force $ExtractDir
Remove-Item -Force $ZipPath

Write-Host "[setup-bbdown] done: $ExePath ($resolvedVersion)"
