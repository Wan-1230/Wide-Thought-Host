#!/usr/bin/env python3
"""Version single-source check for the desktop product surfaces.

Two release trains exist in this repo and are deliberately separate:

  * Desktop GUI: `wth-desktop` Cargo package == `tauri.conf.json` ==
    `ui/package.json` == `ui/package-lock.json` root. These four must agree --
    they describe one shipped installer, and a mismatch silently ships a wrong
    "About" box / updater comparison baseline.
  * CLI/TUI: `wth-pager` version plus the `GROK_VERSION` stamp read by
    `xai-grok-version/build.rs`. This train is gated on version numbers inside
    `folder_trust.rs`, so it is NOT forced to match the desktop number. See
    docs/adr/version-policy.md.

This script enforces only the desktop group, and reports the CLI version for
observability.

Usage: python scripts/check_version_sync.py [--verbose]
Exit 0 = consistent, 1 = drift.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DESKTOP_DIR = ROOT / "crates" / "desktop" / "wth-desktop"

VERSION_RE = re.compile(r'^\s*version\s*=\s*"([^"]+)"', re.MULTILINE)


def cargo_version(manifest: Path) -> str | None:
    with manifest.open("rb") as fh:
        data = tomllib.load(fh)
    pkg = data.get("package", {}) or {}
    version = pkg.get("version")
    if isinstance(version, str):
        return version
    # `version.workspace = true` -> resolve from [workspace.package].
    if isinstance(version, dict) or version is None:
        root_toml = ROOT / "Cargo.toml"
        with root_toml.open("rb") as fh:
            ws = tomllib.load(fh).get("workspace", {}).get("package", {}) or {}
        value = ws.get("version")
        return value if isinstance(value, str) else None
    return None


def desktop_surfaces() -> dict[str, str | None]:
    found: dict[str, str | None] = {}

    manifest = DESKTOP_DIR / "Cargo.toml"
    found["crates/desktop/wth-desktop/Cargo.toml [package] version"] = (
        cargo_version(manifest) if manifest.is_file() else None
    )

    conf = DESKTOP_DIR / "tauri.conf.json"
    if conf.is_file():
        found["crates/desktop/wth-desktop/tauri.conf.json version"] = json.loads(
            conf.read_text(encoding="utf-8")
        ).get("version")
    else:
        found["crates/desktop/wth-desktop/tauri.conf.json"] = None

    ui_pkg = DESKTOP_DIR / "ui" / "package.json"
    if ui_pkg.is_file():
        found["crates/desktop/wth-desktop/ui/package.json version"] = json.loads(
            ui_pkg.read_text(encoding="utf-8")
        ).get("version")
    else:
        found["crates/desktop/wth-desktop/ui/package.json"] = None

    lock = DESKTOP_DIR / "ui" / "package-lock.json"
    if lock.is_file():
        data = json.loads(lock.read_text(encoding="utf-8"))
        # lockfileVersion 3 stores the root project under packages[""].
        root_pkg = (data.get("packages") or {}).get("") or {}
        found["crates/desktop/wth-desktop/ui/package-lock.json packages[\"\"].version"] = (
            root_pkg.get("version")
        )
    else:
        found["crates/desktop/wth-desktop/ui/package-lock.json"] = None

    return found


def cli_versions() -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    pager = ROOT / "crates" / "codegen" / "wth-pager" / "Cargo.toml"
    if pager.is_file():
        match = VERSION_RE.search(pager.read_text(encoding="utf-8"))
        out["crates/codegen/wth-pager (CLI train)"] = match.group(1) if match else None
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    surfaces = desktop_surfaces()
    missing = {k: v for k, v in surfaces.items() if not v}
    if missing:
        print("version surfaces could not be read:", file=sys.stderr)
        for k in missing:
            print(f"  - {k}", file=sys.stderr)
        return 1

    versions = sorted(set(surfaces.values()))
    if args.verbose:
        for name, value in surfaces.items():
            print(f"  {value:>10}  {name}")
        for name, value in cli_versions().items():
            print(f"  {value:>10}  {name} (informational)")

    if len(versions) > 1:
        print("desktop version drift -- these must all match:", file=sys.stderr)
        for name, value in surfaces.items():
            print(f"  {value:>10}  {name}", file=sys.stderr)
        print(
            "\nThe desktop installer version is the product version. Bump all "
            "four surfaces together (Cargo.toml, tauri.conf.json, "
            "ui/package.json, ui/package-lock.json), or let the release "
            "automation do it. See docs/adr/version-policy.md.",
            file=sys.stderr,
        )
        return 1

    print(f"desktop version consistent at {versions[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
