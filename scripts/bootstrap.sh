#!/usr/bin/env bash
# One-command developer setup (POSIX shells, WSL, macOS).
# Windows PowerShell users: scripts/bootstrap.ps1 -- same steps, same order.
#
#   scripts/bootstrap.sh            check toolchain, wire deps, verify the model
#   scripts/bootstrap.sh --hooks    additionally install scripts/git-hooks
#   scripts/bootstrap.sh --build    additionally cargo check the TUI + desktop
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
. "$root/scripts/lib/wth_common.sh"

hooks=0
build=0
for arg in "$@"; do
  case "$arg" in
    --hooks) hooks=1 ;;
    --build) build=1 ;;
    *) echo "unknown flag: $arg (want --hooks and/or --build)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$1"; }
fail() { printf '\033[31m[fail]\033[0m %s\n' "$1" >&2; exit 1; }

step "1/6 toolchain"
command -v git >/dev/null || fail "git missing"
command -v cargo >/dev/null || fail "cargo missing -- install rustup first"

wth_find_python || fail "no working Python 3.11+ found (tried python3, python, py) -- scripts/ need tomllib"
echo "python: $WTH_PYTHON ($("$WTH_PYTHON" -c 'import sys;print(sys.version.split()[0])'))"
rustup show toolchain >/dev/null 2>&1 || warn "rustup could not resolve a toolchain"

step "2/6 protoc"
if [ -n "${PROTOC:-}" ] && [ -x "${PROTOC:-}" ]; then
  echo "PROTOC=$PROTOC"
elif [ -x "bin/protoc-win64/bin/protoc.exe" ]; then
  export PROTOC="$PWD/bin/protoc-win64/bin/protoc.exe"
  echo "using vendored $PROTOC"
elif command -v protoc >/dev/null; then
  echo "using $(command -v protoc)"
else
  warn "no protoc found -- proto crates will fail. Set \$PROTOC or install protoc."
fi

step "3/6 desktop UI deps"
if [ -f crates/desktop/wth-desktop/ui/package.json ]; then
  if command -v npm >/dev/null; then
    (cd crates/desktop/wth-desktop/ui && [ -d node_modules ] || npm ci)
  else
    warn "npm missing -- desktop builds will fail"
  fi
fi

step "4/6 git hooks"
if [ "$hooks" = 1 ]; then
  git config core.hooksPath scripts/git-hooks
  chmod +x scripts/git-hooks/pre-push 2>/dev/null || true
  echo "core.hooksPath -> scripts/git-hooks"
else
  echo "skipped (pass --hooks to install the pre-push gate)"
fi

step "5/6 governance gates"
wth_python scripts/check_workflow_pkg_names.py
wth_python scripts/check_version_sync.py
wth_python scripts/arch/check_arch.py

step "6/6 compile"
if [ "$build" = 1 ]; then
  cargo check -p wth-pager-bin
  cargo check -p wth-desktop
else
  echo "skipped (pass --build; first run takes a while)"
fi

printf '\nready. dev loop: scripts/dev.sh (TUI) or scripts/dev.sh --desktop\n'
