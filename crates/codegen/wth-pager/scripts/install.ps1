#
# Wide Thought Host (WTH) installer for PowerShell
#
# Usage:
#   irm https://raw.githubusercontent.com/Wan-1230/Wide-Thought-Host/main/scripts/install.ps1 | iex
#   git clone https://github.com/Wan-1230/Wide-Thought-Host.git; cd Wide-Thought-Host; .\scripts\install.ps1

param(
    [string]$InstallDir = "$env:USERPROFILE\.wth"
)

$ErrorActionPreference = "Stop"
$Repo = "https://github.com/Wan-1230/Wide-Thought-Host.git"
$BinDir = "$InstallDir\bin"

Write-Host "Wide Thought Host (WTH) installer" -ForegroundColor Cyan
Write-Host "=================================="

# Check Rust
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Rust is required. Install from https://rustup.rs" -ForegroundColor Yellow
    Write-Host "Or run: winget install Rustlang.Rustup"
    exit 1
}

# Check protoc
if (-not (Get-Command protoc -ErrorAction SilentlyContinue)) {
    Write-Host "protoc is required." -ForegroundColor Yellow
    Write-Host "Install: winget install Google.Protobuf"
    exit 1
}

# Clone if not already in repo
if (-not (Test-Path "Cargo.toml")) {
    Write-Host "Cloning WTH..."
    git clone $Repo "$InstallDir\src"
    Set-Location "$InstallDir\src"
}
else {
    Write-Host "Building from current directory..."
}

Write-Host "Building wth (release)..."
cargo build -p wth-pager-bin --release

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Copy-Item "target\release\wth.exe" "$BinDir\wth.exe" -Force

# Add to PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$BinDir", "User")
    Write-Host "Added $BinDir to user PATH"
}

Write-Host ""
Write-Host "WTH installed to $BinDir\wth.exe" -ForegroundColor Green
Write-Host "Restart your terminal, then run 'wth' to start!"
