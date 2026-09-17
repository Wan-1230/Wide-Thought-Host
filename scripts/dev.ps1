# WTH 一键开发环境（Windows）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/dev.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. protoc
if (-not (Get-Command protoc -ErrorAction SilentlyContinue)) {
  if (Test-Path "$root\bin\protoc.exe") {
    $env:PATH = "$root\bin;$env:PATH"
  } else {
    Write-Host "[warn] protoc not found; put protoc.exe in bin\" -ForegroundColor Yellow
  }
}

# 2. GNU toolchain（本机无 MSVC link.exe 时）
if (-not $env:RUSTUP_TOOLCHAIN) {
  $env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
}

Write-Host "[1/3] cargo check -p wth-desktop" -ForegroundColor Cyan
cargo check -p wth-desktop

Write-Host "[2/3] UI deps" -ForegroundColor Cyan
Push-Location crates/desktop/wth-desktop/ui
if (-not (Test-Path node_modules)) { npm install }
npm run build
Pop-Location

Write-Host "[3/3] tauri dev" -ForegroundColor Cyan
Push-Location crates/desktop/wth-desktop
if (-not (Test-Path ui/node_modules/.bin/tauri.cmd)) {
  # tauri cli may live under ui
  Write-Host "using ui tauri cli"
}
& ".\ui\node_modules\.bin\tauri.cmd" dev
Pop-Location
