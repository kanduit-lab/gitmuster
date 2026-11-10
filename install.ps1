<#
.SYNOPSIS
    Install gitmuster from a GitHub release without cloning the repository and without npm.

.DESCRIPTION
    Resolves a published release tag, downloads its attached source archive, unpacks it
    under the user's local programs folder, writes a gitmuster.cmd launcher beside it,
    and adds that folder to the user PATH. Only Node.js 18+ and git are required afterwards.

    'latest' means the most recent stable release. While gitmuster is in beta the stable
    channel is empty, so the newest pre-release is offered instead and the reason is printed.

.PARAMETER Version
    An exact release tag such as v0.1.0-beta.1, or 'latest'.

.EXAMPLE
    irm https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.ps1 | iex

.EXAMPLE
    & .\install.ps1 -Version v0.1.0-beta.1

.EXAMPLE
    & .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\gitmuster'),
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = 'kanduit-lab/gitmuster'
$launcher = Join-Path $InstallDirectory 'gitmuster.cmd'

function Assert-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name not found. $Hint"
    }
}

function Remove-FromUserPath([string]$Directory) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $current) { return }
    $kept = $current.Split(';') | Where-Object { $_ -and ($_.TrimEnd('\') -ne $Directory.TrimEnd('\')) }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
}

function Get-Releases {
    try {
        return Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases?per_page=30" `
            -Headers @{ 'User-Agent' = 'gitmuster-installer' } -UseBasicParsing
    } catch {
        throw "Could not reach the GitHub releases API. Check the network and try again. ($($_.Exception.Message))"
    }
}

function Resolve-Release([string]$Requested) {
    # The inner parentheses are required: inside @(...) a call piped straight into
    # Where-Object swallows the function's return value and yields an empty array.
    $releases = @((Get-Releases) | Where-Object { -not $_.draft })
    if ($releases.Count -eq 0) { throw "No published release found for $repo." }

    if ($Requested -ne 'latest') {
        $exact = $releases | Where-Object { $_.tag_name -eq $Requested } | Select-Object -First 1
        if (-not $exact) {
            $known = ($releases | ForEach-Object { $_.tag_name }) -join ', '
            throw "Release '$Requested' not found. Published releases: $known"
        }
        return $exact
    }

    $stable = $releases | Where-Object { -not $_.prerelease } | Select-Object -First 1
    if ($stable) { return $stable }

    $beta = $releases | Where-Object { $_.prerelease } | Select-Object -First 1
    if (-not $beta) { throw "No published release found for $repo." }
    Write-Host "No stable release yet; using the newest pre-release $($beta.tag_name)." -ForegroundColor Yellow
    return $beta
}

function Get-ReleaseAsset($Release, [string]$Name) {
    $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $asset) {
        throw "Release $($Release.tag_name) has no $Name asset. Re-publish the release or pass -Version for an older one."
    }
    return $asset.browser_download_url
}

if ($Uninstall) {
    if (Test-Path $InstallDirectory) { Remove-Item -Recurse -Force $InstallDirectory }
    Remove-FromUserPath $InstallDirectory
    Write-Host "gitmuster removed from $InstallDirectory."
    Write-Host 'Open a new terminal to pick up the PATH change.'
    return
}

Assert-Command 'node' 'Install Node.js 18 or newer from https://nodejs.org.'
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 18) {
    throw "Node.js 18 or newer is required; this machine has $(& node --version)."
}
Assert-Command 'git' 'Install Git first.'

$release = Resolve-Release $Version
$source = Get-ReleaseAsset $release 'gitmuster.tar.gz'

$staging = Join-Path ([IO.Path]::GetTempPath()) ("gitmuster-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    $archive = Join-Path $staging 'gitmuster.tar.gz'
    Write-Host "Downloading gitmuster $($release.tag_name)"
    Invoke-WebRequest -Uri $source -OutFile $archive -UseBasicParsing

    tar -xzf $archive -C $staging
    if ($LASTEXITCODE -ne 0) { throw 'tar failed to unpack the archive.' }

    $unpacked = Get-ChildItem -Path $staging -Directory -Filter 'gitmuster-*' | Select-Object -First 1
    if (-not $unpacked) { throw 'Downloaded archive did not contain the gitmuster sources.' }

    if (Test-Path $InstallDirectory) { Remove-Item -Recurse -Force $InstallDirectory }
    New-Item -ItemType Directory -Path (Split-Path $InstallDirectory) -Force | Out-Null
    Move-Item -Path $unpacked.FullName -Destination $InstallDirectory

    # The release archive is already trimmed to runtime files; this keeps the installed
    # tree inspectable even if an older release carried extra material.
    $keep = @('cli.mjs', 'picker.mjs', 'repositories.mjs', 'package.json', 'README.md', 'README.ko.md', 'LICENSE')
    Get-ChildItem -Force -Path $InstallDirectory | Where-Object { $keep -notcontains $_.Name } |
        Remove-Item -Recurse -Force
} finally {
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
}

$entry = Join-Path $InstallDirectory 'cli.mjs'
@"
@echo off
node "$entry" %*
"@ | Set-Content -Path $launcher -Encoding ASCII

Set-Content -Path (Join-Path $InstallDirectory '.gitmuster-version') -Value $release.tag_name -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @(($userPath -as [string]) -split ';' | Where-Object { $_ })
if ($entries -notcontains $InstallDirectory) {
    [Environment]::SetEnvironmentVariable('Path', (($entries + $InstallDirectory) -join ';'), 'User')
    $env:Path = "$env:Path;$InstallDirectory"
}

Write-Host "Installed $($release.tag_name): $launcher"
Write-Host "Run 'gitmuster help' in any folder that holds repositories."
if (($env:Path -split ';') -notcontains $InstallDirectory) {
    Write-Host "Open a new terminal so PATH picks up $InstallDirectory."
}
