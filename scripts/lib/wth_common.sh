# Shared shell helpers for scripts/*.sh and the git hooks.
#
# Sourced, never executed. POSIX sh compatible (the pre-push hook runs under
# Git for Windows' sh, not bash).

# Set WTH_PYTHON to an interpreter that actually works, or return 1.
#
# Why a probe instead of `command -v python3`: on Windows `python3` frequently
# resolves to the Microsoft Store stub, which exists on PATH, exits 0, and does
# nothing -- the calling script then "succeeds" while checking nothing.
wth_find_python() {
  [ -n "${WTH_PYTHON:-}" ] && return 0
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c "import sys;print(sys.version_info[:2]>=(3,11))" 2>/dev/null | grep -q True; then
      WTH_PYTHON=$candidate
      return 0
    fi
  done
  return 1
}

wth_python() {
  if ! wth_find_python; then
    echo "[fail] no working Python 3.11+ found (tried python3, python, py)" >&2
    return 1
  fi
  "$WTH_PYTHON" "$@"
}
