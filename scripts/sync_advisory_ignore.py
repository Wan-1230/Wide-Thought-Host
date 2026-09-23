#!/usr/bin/env python3
"""Keep cargo-deny's advisory ignore list identical to cargo-audit's.

Two supply-chain tools read two config formats. `.cargo/audit.toml` is the
source of truth because it is already wired to the hard CI gate, so this script
renders cargo-deny's `[advisories] ignore` array *from* it rather than letting a
second, independent exemption list drift into existence.

Rationale for each ignore lives in `.cargo/audit.toml` next to the ID. It is
deliberately not duplicated into `cargo-deny.toml` -- a copy of the "why" is a
second thing to keep in sync, and the one that goes stale.

Usage:
    python scripts/sync_advisory_ignore.py            # rewrite cargo-deny.toml
    python scripts/sync_advisory_ignore.py --check    # CI: exit 1 on drift

Exit 0 = in sync (or rewritten), 1 = drift / invalid input.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AUDIT_TOML = REPO_ROOT / ".cargo" / "audit.toml"
DENY_TOML = REPO_ROOT / "cargo-deny.toml"

# The generated region is delimited by two marker lines and located by *whole
# line* match (leading indentation ignored). Ignoring indentation lets the array
# stay 4-space aligned, while a prose mention of "the BEGIN marker" elsewhere in
# the file can never be mistaken for the marker itself.
BEGIN = "# BEGIN generated:advisory-ignore (source: .cargo/audit.toml) -- do not edit"
END = "# END generated:advisory-ignore"
INDENT = "    "

ID_RE = re.compile(r"^RUSTSEC-\d{4}-\d{4}$")


def read_audit_ignores() -> list[str]:
    """Return the advisory IDs cargo-audit is told to ignore, in file order."""
    if not AUDIT_TOML.is_file():
        sys.exit(f"missing source of truth: {AUDIT_TOML.relative_to(REPO_ROOT)}")

    data = tomllib.loads(AUDIT_TOML.read_text(encoding="utf-8"))
    ignores = data.get("advisories", {}).get("ignore", [])
    if not isinstance(ignores, list):
        sys.exit("[advisories] ignore in .cargo/audit.toml must be a list of strings")

    seen: set[str] = set()
    out: list[str] = []
    for entry in ignores:
        if not isinstance(entry, str):
            sys.exit(f"non-string advisory ignore entry: {entry!r}")
        adv = entry.strip()
        if not ID_RE.match(adv):
            sys.exit(
                f"malformed advisory ignore {entry!r}: expected RUSTSEC-YYYY-NNNN. "
                "cargo-deny keys exemptions off the same ID, so anything else here "
                "would silently mean something different in one of the two tools."
            )
        if adv in seen:
            sys.exit(f"duplicate advisory id {adv!r} in .cargo/audit.toml")
        seen.add(adv)
        out.append(adv)
    return out


def render_body(ignores: list[str]) -> list[str]:
    """Render the lines strictly *between* the two markers."""
    if not ignores:
        return [f"{INDENT}# (.cargo/audit.toml currently ignores nothing)"]
    return [f'{INDENT}"{adv}",' for adv in ignores]


def split_block(text: str) -> tuple[list[str], list[str], list[str]]:
    """Split cargo-deny.toml lines into (up-to-and-including BEGIN, body, END-onwards)."""
    lines = text.splitlines()
    starts = [i for i, l in enumerate(lines) if l.strip() == BEGIN]
    ends = [i for i, l in enumerate(lines) if l.strip() == END]
    if len(starts) != 1 or len(ends) != 1 or ends[0] < starts[0]:
        sys.exit(
            f"{DENY_TOML.relative_to(REPO_ROOT)} must contain exactly one "
            f"`{BEGIN}` line and one `{END}` line, in that order, inside the "
            "[advisories] ignore array."
        )
    return lines[: starts[0] + 1], lines[starts[0] + 1 : ends[0]], lines[ends[0] :]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify cargo-deny.toml matches .cargo/audit.toml without writing",
    )
    args = ap.parse_args()

    ignores = read_audit_ignores()
    if not DENY_TOML.is_file():
        sys.exit(f"missing {DENY_TOML.relative_to(REPO_ROOT)}")

    head, body, tail = split_block(DENY_TOML.read_text(encoding="utf-8"))
    want = render_body(ignores)

    if body == want:
        print(f"in sync: {len(ignores)} advisory ignore(s) mirrored into cargo-deny.toml")
        return 0

    if args.check:
        # Deliberately not ID_RE here: that pattern is anchored for validating a
        # bare ID, whereas the generated body holds indented, quoted entries.
        got = re.findall(r"RUSTSEC-\d{4}-\d{4}", "\n".join(body))
        report = (
            "cargo-deny.toml advisory-ignore block does not match .cargo/audit.toml\n"
            f"  audit.toml (source of truth): {', '.join(ignores) or '(none)'}\n"
            f"  cargo-deny.toml (generated) : {', '.join(got) or '(none)'}\n"
            "  fix: python scripts/sync_advisory_ignore.py   (commit both files)"
        )
        print(f"ERROR: {report}", file=sys.stderr)
        return 1

    out = head + want + tail
    DENY_TOML.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"rewrote cargo-deny.toml with {len(ignores)} advisory ignore(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
