# One-command developer setup on Windows. Mirrors scripts/bootstrap.sh step for
# step so the two cannot drift.
#
#   powershell -File scripts/bootstrap.ps1
#   powershell -File scripts/bootstrap.ps1 -Hooks
#   powershell -File scripts/bootstrap.ps1 -Build

param(
    [switch]$Hooks,
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[warn] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[fail] $m" -ForegroundColor Red; exit 1 }

Step "1/6 toolchain"
foreach ($tool in "git", "cargo") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool missing" }
}
$py = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
if (-not $py) { Fail "python missing -- scripts/ need 3.11+ (tomllib)" }
& $py.Source -c "import sys; sys.exit('python too old: need 3.11+' if sys.version_info < (3,11) else 0)"
if ($LASTEXITCODE) { Fail "python version check failed" }
Write-Host "python: $($py.Source)"

Step "2/6 protoc"
# The GNU toolchain is what actually links here; MSVC needs the VS C++ workload.
if (-not $env:RUSTUP_TOOLCHAIN) {
    $env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
    Write-Host "RUSTUP_TOOLCHAIN -> $env:RUSTUP_TOOLCHAIN"
}
$vendored = Join-Path $root "bin\protoc-win64\bin\protoc.exe"
if ($env:PROTOC -and (Test-Path $env:PROTOC)) {
    Write-Host "PROTOC=$env:PROTOC"
} elseif (Test-Path $vendored) {
    $env:PROTOC = $vendored
    Write-Host "PROTOC=$env:PROTOC (vendored)"
} elseif (Get-Command protoc -ErrorAction SilentlyContinue) {
    Write-Host "PROTOC=$(Get-Command protoc).Source"
} else {
    Warn "no protoc found -- proto crates will fail. Set `$env:PROTOC."
}

Step "3/6 desktop UI deps"
$ui = Join-Path $root "crates\desktop\wth-desktop\ui"
if (Test-Path (Join-Path $ui "package.json")) {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Push-Location $ui
        if (-not (Test-Path node_modules)) { npm ci }
        Pop-Location
    } else {
        Warn "npm missing -- desktop builds will fail"
    }
}

Step "4/6 git hooks"
if ($Hooks) {
    git config core.hooksPath scripts/git-hooks
    Write-Host "core.hooksPath -> scripts/git-hooks"
    Warn "pre-push is a POSIX sh script; install Git for Windows' sh, or rely on CI"
} else {
    Write-Host "skipped (pass -Hooks to install the pre-push gate)"
}

Step "5/6 governance gates"
foreach ($script in "check_workflow_pkg_names.py", "check_version_sync.py", "arch\check_arch.py") {
    & $py.Source (Join-Path $root "scripts\$script")
    if ($LASTEXITCODE) { Fail "$script reported violations" }
}

Step "6/6 compile"
if ($Build) {
    cargo check -p wth-pager-bin
    if ($LASTEXITCODE) { Fail "cargo check wth-pager-bin failed" }
    cargo check -p wth-desktop
    if ($LASTEXITCODE) { Fail "cargo check wth-desktop failed" }
} else {
    Write-Host "skipped (pass -Build; first run takes a while)"
}

Write-Host "`nready. dev loop: powershell -File scripts\dev.ps1 (desktop)" -ForegroundColor Green
