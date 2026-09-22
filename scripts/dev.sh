#!/usr/bin/env bash
# Cross-platform dev loop: the POSIX counterpart of scripts/dev.ps1.
#
#   scripts/dev.sh              TUI (`wth`) against the current workspace
#   scripts/dev.sh --desktop    Tauri desktop app with hot reload
#   scripts/dev.sh --check      governance gates + cargo check, no run
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
. "$root/scripts/lib/wth_common.sh"

mode=${1:-tui}

# GNU toolchain on Windows/MSYS: MSVC needs the VS C++ workload and fails on
# build scripts without it (see CONTRIBUTING).
if [ -z "${RUSTUP_TOOLCHAIN:-}" ] && rustup toolchain list 2>/dev/null | grep -q windows-gnu; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu ;;
  esac
fi

if [ -z "${PROTOC:-}" ] && [ -x "bin/protoc-win64/bin/protoc.exe" ]; then
  export PROTOC="$PWD/bin/protoc-win64/bin/protoc.exe"
fi

case "$mode" in
  --check)
    wth_python scripts/check_workflow_pkg_names.py
    wth_python scripts/check_version_sync.py
    wth_python scripts/arch/check_arch.py
    cargo fmt --all -- --check
    cargo check -p wth-pager-bin
    ;;
  --desktop)
    cargo check -p wth-desktop
    (cd crates/desktop/wth-desktop && npm run tauri dev)
    ;;
  tui)
    cargo run -p wth-pager-bin
    ;;
  *)
    echo "usage: scripts/dev.sh [--check|--desktop|tui]" >&2
    exit 2
    ;;
esac
