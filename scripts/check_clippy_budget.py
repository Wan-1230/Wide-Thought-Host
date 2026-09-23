#!/usr/bin/env python3
"""Clippy warning budget -- a per-crate ratchet, same shape as check_arch.py.

Why a budget instead of `-D warnings`: `-D warnings` is correct only for a tree
that is already clean. `wth-desktop` alone carries ~100 clippy warnings (inherited
from the upstream snapshot plus fork-era code), so the honest options were
"no gate" or "red CI forever". A frozen count makes the gate live today and makes
regression impossible, and it shrinks one PR at a time.

Usage:
  python scripts/check_clippy_budget.py                      # compare vs baseline
  python scripts/check_clippy_budget.py --update             # rewrite baseline
  python scripts/check_clippy_budget.py --crate wth-desktop   # one crate only

The baseline may only shrink from a feature branch; `--update` belongs on main in
its own commit, so a growing budget shows up as a reviewable diff.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = Path(__file__).resolve().parent / ".clippy-budget.json"


def run_clippy(crates: list[str] | None) -> Counter[str]:
    cmd = ["cargo", "clippy", "--no-deps", "--message-format=json", "--all-targets", "--quiet"]
    for crate in crates or []:
        cmd += ["-p", crate]
    if not crates:
        cmd.append("--workspace")

    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, errors="replace")
    counts: Counter[str] = Counter()
    for line in proc.stdout.splitlines():
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        inner = msg.get("reason") == "compiler-message" and msg.get("message") or {}
        if inner.get("level") != "warning":
            continue
        pkg = (msg.get("target") or {}).get("name")
        if not pkg:
            continue
        counts[pkg] += 1

    if proc.returncode not in (0,):
        # clippy itself failed to build: surface stderr rather than report "clean"
        detail = (proc.stderr or "").strip().splitlines()
        if detail:
            print("\n".join(detail[-15:]), file=sys.stderr)
        print(f"error: clippy exited {proc.returncode}", file=sys.stderr)
        raise SystemExit(2)
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--crate", action="append", default=[])
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args()

    counts = run_clippy(args.crate or None)
    baseline: dict[str, int] = {}
    if BASELINE.is_file():
        baseline = json.loads(BASELINE.read_text(encoding="utf-8")).get("budget", {})

    if args.update:
        payload = {
            "note": (
                "Frozen clippy warning counts per crate. check_clippy_budget.py fails "
                "when a crate exceeds its number. Shrink it; regenerate on main only."
            ),
            "budget": dict(sorted(counts.items())),
        }
        BASELINE.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
        )
        print(f"baseline written: {sum(counts.values())} warnings across {len(counts)} crates")
        return 0

    if not baseline:
        print(
            f"error: no baseline at {BASELINE.relative_to(ROOT)}\n"
            "create it with: python scripts/check_clippy_budget.py --update",
            file=sys.stderr,
        )
        return 2

    worse = [
        (pkg, count, baseline.get(pkg, 0))
        for pkg, count in sorted(counts.items())
        if count > baseline.get(pkg, 0)
    ]
    better = [
        (pkg, count, baseline.get(pkg, 0))
        for pkg, count in sorted(counts.items())
        if count < baseline.get(pkg, 0)
    ]

    total = sum(counts.values())
    print(f"clippy budget: {total} warnings across {len(counts)} crates")
    if better:
        print("\nfixed since the baseline -- lock it in:")
        for pkg, count, allowed in better:
            print(f"  {pkg}: {allowed} -> {count}")
        print("  python scripts/check_clippy_budget.py --update")
    if worse:
        print("\nOVER BUDGET:", file=sys.stderr)
        for pkg, count, allowed in worse:
            print(f"  {pkg}: {count} warnings, budget {allowed} (+{count - allowed})", file=sys.stderr)
        print(
            "\nFix the new warnings. Do not raise the budget from a branch -- it is\n"
            "regenerated on main so an inflated number is visible in review.",
            file=sys.stderr,
        )
        return 1

    print("within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
