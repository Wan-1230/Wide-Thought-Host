#!/usr/bin/env python3
"""CI workflow hygiene gate: every package/path a workflow names must exist.

Why this exists: the `xai-grok-* -> wth-*` package rename updated 62 crate
manifests but not `.github/workflows/ci.yml`, which still invoked
`cargo test -p xai-grok-update`. Cargo fails on an unknown package, so the
privacy/clippy jobs went red silently. The same class of drift will recur on
every future rename, so the check is mechanized instead of documented.

Two surfaces are validated:
  1. `-p <pkg>` / `--package <pkg>` tokens in every workflow -> must be a
     workspace member.
  2. Repo-relative paths (crates/..., third_party/..., prod/..., scripts/...)
     embedded in run steps -> must exist on disk.

Usage: python scripts/check_workflow_pkg_names.py [--verbose]
Exit 0 = clean, 1 = violations.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

WORKFLOWS = ROOT / ".github" / "workflows"

# `-p foo` / `--package foo`. Requires a shell-ish separator before, so we do
# not match `-p` inside longer words or paths.
PKG_RE = re.compile(r"(?:-p|--package)[= ]+([A-Za-z0-9_][A-Za-z0-9_.-]*)")

# Paths that must resolve against the repo. Only look at tokens that start with
# a known top-level dir, which keeps `-p` values and flags out of the way.
PATH_RE = re.compile(
    r"(?<![\w./-])((?:crates|third_party|prod|scripts|docs|bin)/[A-Za-z0-9_./-]+)"
)

TRAILING = ".,;:\\'\"`)"


def workspace_packages() -> tuple[set[str], set[str]]:
    """Return (package names, member directory paths) from the root workspace."""
    root_toml = ROOT / "Cargo.toml"
    with root_toml.open("rb") as fh:
        data = tomllib.load(fh)
    members = data.get("workspace", {}).get("members", []) or []

    names: set[str] = set()
    dirs: set[str] = set()
    for member in members:
        member_dir = (ROOT / member).resolve()
        if not member_dir.is_dir():
            continue
        manifest = member_dir / "Cargo.toml"
        if not manifest.is_file():
            continue
        with manifest.open("rb") as fh:
            pkg = tomllib.load(fh).get("package", {}) or {}
        name = pkg.get("name")
        if name:
            names.add(name)
        rel = member_dir.relative_to(ROOT).as_posix()
        dirs.add(rel)
    return names, dirs


def comment_only(line: str) -> bool:
    return line.lstrip().startswith("#")


def workflow_files() -> list[Path]:
    if not WORKFLOWS.is_dir():
        return []
    return sorted(
        p for p in WORKFLOWS.iterdir() if p.suffix in {".yml", ".yaml"} and p.is_file()
    )


def logical_lines(text: str):
    """Yield (lineno, command) with backslash continuations joined.

    Scanning physical lines produced two classes of error. A `-p` on a
    continuation line (`cargo clippy --no-deps \\` then `-p wth-version \\`) was
    invisible as a cargo argument, and unrelated `-p` flags (`mkdir -p dir`)
    were scanned as if they named a package. Joining first and requiring the
    command to mention cargo fixes both.
    """
    buffer: list[str] = []
    start = 0
    for lineno, line in enumerate(text.splitlines(), 1):
        stripped = line.rstrip()
        if not buffer:
            if not stripped.strip():
                continue
            start = lineno
            buffer.append(stripped.strip())
        else:
            buffer.append(stripped.strip())
        if stripped.endswith("\\"):
            buffer[-1] = buffer[-1][:-1].rstrip()
            continue
        yield start, " ".join(buffer)
        buffer = []
    if buffer:
        yield start, " ".join(buffer)


def check(
    packages: set[str], allowed_dirs: set[str], verbose: bool
) -> list[str]:
    violations: list[str] = []
    checked_pkgs = 0
    checked_paths = 0

    for wf in workflow_files():
        rel_wf = wf.relative_to(ROOT).as_posix()
        text = wf.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()

        for lineno, line in enumerate(lines, 1):
            # Path references appear in YAML keys and shell alike, so they are
            # still judged per physical line.
            if comment_only(line):
                continue
            for raw in PATH_RE.findall(line):
                path = raw.rstrip(TRAILING)
                if "$" in path or "*" in path:
                    continue
                checked_paths += 1
                top = path.split("/", 1)[0]
                if top in allowed_dirs and not (ROOT / path).exists():
                    violations.append(f"{rel_wf}:{lineno}: missing path `{path}`")

        for lineno, command in logical_lines(text):
            if comment_only(command):
                continue
            if "cargo" not in command:
                continue
            for pkg in PKG_RE.findall(command):
                checked_pkgs += 1
                if pkg not in packages:
                    violations.append(
                        f"{rel_wf}:{lineno}: unknown package `-p {pkg}` in "
                        f"`{command[:72]}{'…' if len(command) > 72 else ''}` "
                        "(not a workspace member; did a rename miss this file?)"
                    )

        if verbose:
            print(f"  scanned {rel_wf}")

    if verbose:
        print(f"  checked {checked_pkgs} package refs, {checked_paths} path refs")
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    packages, members = workspace_packages()
    if not packages:
        print("error: no workspace members parsed from Cargo.toml", file=sys.stderr)
        return 2

    # A referenced path may legitimately live inside a member dir or be one of
    # the top-level dirs listed in PATH_RE; `members` is used only for the
    # top-level allowlist.
    allowed_dirs = {m.split("/", 1)[0] for m in members} | {
        "crates",
        "third_party",
        "prod",
        "scripts",
        "docs",
        "bin",
    }

    violations = check(packages, allowed_dirs, args.verbose)
    if violations:
        print("workflow hygiene violations:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        print(
            "\nFix the workflow, or if a package was renamed, update every "
            "`.github/workflows/*.yml` reference in the same commit.",
            file=sys.stderr,
        )
        return 1

    print(f"workflow hygiene ok ({len(packages)} packages known to workspace)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
