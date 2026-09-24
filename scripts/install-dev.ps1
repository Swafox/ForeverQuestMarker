# Copies the addon into a WoW AddOns folder for testing (Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1 "C:\Program Files (x86)\World of Warcraft\_forever_\Interface\AddOns"
#
# The Forever client's folder name may differ; it is the folder next to _retail_ or
# _classic_era_ that contains the Forever executable.
param(
    [Parameter(Mandatory = $true)][string]$AddOnsDir
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path $AddOnsDir -PathType Container)) {
    throw "AddOns folder not found: $AddOnsDir"
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $AddOnsDir "ForeverQuestMarker"

if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target | Out-Null

Get-Content (Join-Path $repoRoot "scripts\addon-files.txt") |
    Where-Object { $_ -and -not $_.StartsWith("#") } |
    ForEach-Object { Copy-Item (Join-Path $repoRoot $_) -Destination $target -Recurse }

Write-Host "Installed into $target. In game: /reload, then /fqm status"
