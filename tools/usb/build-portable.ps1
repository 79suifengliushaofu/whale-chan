# Whale-chan portable build (USB stick / portable drive)
#
# Usage:
#   & tools\usb\build-portable.ps1 -Target E:\whale-chan-usb
#
# NOTE: this script is intentionally 100% ASCII.
#   Windows PowerShell reads a BOM-less .ps1 using the system ANSI codepage,
#   so any Chinese literal here turns into mojibake and breaks the parser
#   ("The string is missing the terminator"). Chinese user-facing text lives
#   in the adjacent .txt files instead, and they are copied by wildcard.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$NodeSource = 'C:\Program Files\nodejs',
  [string]$DshSource  = "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh",
  [string]$AppSource  = (Join-Path $PSScriptRoot '..\..\whale-chan')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Copy-Tree([string]$From, [string]$To) {
  if (-not (Test-Path $From)) { throw "source not found: $From" }
  New-Item -ItemType Directory -Path $To -Force | Out-Null
  # robocopy exit codes 0-7 mean success; >=8 is a real failure.
  $null = robocopy $From $To /E /NFL /NDL /NJH /NJS /NP /MT:16
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $From -> $To" }
  $global:LASTEXITCODE = 0
}

function Get-SizeMB([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  [math]::Round((Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum / 1MB, 1)
}

Write-Host ''
Write-Host '  whale-chan: building the portable bundle'
Write-Host "  target: $Target"
Write-Host ''

New-Item -ItemType Directory -Path $Target -Force | Out-Null

Write-Host '  [1/4] node runtime...'
Copy-Tree $NodeSource (Join-Path $Target 'node')
Write-Host ("        {0} MB" -f (Get-SizeMB (Join-Path $Target 'node')))

Write-Host '  [2/4] dsh core...'
Copy-Tree $DshSource (Join-Path $Target 'app\node_modules\@deepseek-ai\dsh')
Write-Host ("        {0} MB" -f (Get-SizeMB (Join-Path $Target 'app')))

Write-Host '  [3/4] whale-chan...'
$app = Join-Path $Target 'whale-chan'
New-Item -ItemType Directory -Path $app -Force | Out-Null
foreach ($item in 'bin', 'src', 'assets', 'ide', 'package.json', 'README.md', 'LICENSE', 'ASSETS-NOTICE.md') {
  $from = Join-Path $AppSource $item
  if (-not (Test-Path $from)) { continue }
  if ((Get-Item $from).PSIsContainer) {
    Copy-Tree $from (Join-Path $app $item)
  } else {
    Copy-Item $from (Join-Path $app $item) -Force
  }
}
# vendor\ is a runtime copy generated for the .vsix package; useless here.
Remove-Item (Join-Path $app 'ide\vscode\vendor') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ("        {0} MB" -f (Get-SizeMB $app))

Write-Host '  [4/4] launcher and docs...'
New-Item -ItemType Directory -Path (Join-Path $Target 'data') -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'whalechan.cmd') (Join-Path $Target 'whalechan.cmd') -Force
# Copied by wildcard on purpose: the .txt filename is Chinese, and a Chinese
# literal cannot appear in this ASCII-only file.
Get-ChildItem (Join-Path $PSScriptRoot '*.txt') -File | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $Target $_.Name) -Force
}

$total = Get-SizeMB $Target
Write-Host ''
Write-Host ("  done. total {0} MB" -f $total)
Write-Host ''
Write-Host '  next:'
Write-Host "    - copy the whole $Target folder onto the USB stick"
Write-Host '    - put a key.txt (one line, sk-...) into data\, then run whalechan.cmd'
Write-Host ''
