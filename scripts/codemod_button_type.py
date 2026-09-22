#!/usr/bin/env python3
"""Add the missing `type` attribute to JSX <button> elements.

Biome's `a11y/useButtonType` reports 153 sites in the desktop UI and ships no
auto-fix, so this is the codemod. It is deliberately narrow:

  * it only edits the opening tag of `<button` (never `</button>` or `<buttonbar`)
  * it skips any tag that already carries `type=` or a `{...spread}` (a spread may
    supply type, and an explicit attribute would silently change precedence)
  * it tracks JSX expression containers and quoted strings so a `>` inside
    `{"a > b"}` or `{index > 0}` cannot terminate the scan early

Why it is safe here: the UI contains zero `<form>` and zero `onSubmit`, so an
implicit `type="submit"` has nothing to submit -- the attribute is behavior
neutral. Re-verify before reusing on another tree.

Usage: python scripts/codemod_button_type.py [--dry-run]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

UI_SRC = Path(__file__).resolve().parent.parent / "crates" / "desktop" / "wth-desktop" / "ui" / "src"

TAG_RE = re.compile(r"<button(?=[\s/>])")


def find_tag_end(text: str, start: int) -> int | None:
    """Index of the `>` closing this opening tag, or None if unparseable."""
    depth = 0  # brace nesting inside JSX expression containers
    quote = ""
    i = start
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = ""
        elif ch in "\"'`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return None
        elif ch == ">" and depth == 0:
            return i
        elif ch == "/" and depth == 0 and text[i + 1 : i + 2] == ">":
            return i + 1
        i += 1
    return None


ATTR_NAME_RE = re.compile(r"(?<![\w:-])type\s*=")


def process(text: str) -> tuple[str, int, int]:
    out: list[str] = []
    pos = 0
    patched = 0
    skipped = 0
    while True:
        match = TAG_RE.search(text, pos)
        if not match:
            out.append(text[pos:])
            break
        tag_start = match.start()
        attr_start = match.end()
        tag_end = find_tag_end(text, attr_start)
        if tag_end is None:
            out.append(text[pos:attr_start])
            pos = attr_start
            skipped += 1
            continue
        attrs = text[attr_start:tag_end]
        if ATTR_NAME_RE.search(attrs) or "{..." in attrs or "type={" in attrs:
            out.append(text[pos:tag_end])
            pos = tag_end
            skipped += 1
            continue
        # Keep a lone `<button>` on one line tidy; otherwise lead with a space.
        insertion = ' type="button"'
        out.append(text[pos:attr_start])
        out.append(insertion)
        pos = attr_start
        patched += 1
    return "".join(out), patched, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not UI_SRC.is_dir():
        print(f"error: {UI_SRC} not found", file=sys.stderr)
        return 2

    total_patched = 0
    total_skipped = 0
    for path in sorted(UI_SRC.rglob("*.tsx")):
        original = path.read_text(encoding="utf-8")
        if "<button" not in original:
            continue
        patched_text, patched, skipped = process(original)
        total_patched += patched
        total_skipped += skipped
        if patched and not args.dry_run:
            path.write_text(patched_text, encoding="utf-8", newline="\n")
        marker = "would patch" if args.dry_run else "patched"
        if patched:
            print(f"  {marker} {patched:>3}  skip {skipped:>2}  {path.relative_to(UI_SRC.parent).as_posix()}")

    verb = "would be added" if args.dry_run else "added"
    print(f"\n{total_patched} `type=\"button\"` {verb}; {total_skipped} tags skipped (typed or spread)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
