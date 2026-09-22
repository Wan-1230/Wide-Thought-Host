#!/usr/bin/env python3
"""Crate dependency graph for the WTH workspace (ZCode's `dep:graph`/`dep:refs`).

Ports two small but disproportionately useful scripts from the ZCode repo: a
whole-repo graph renderer and a per-module "who imports me / what do I import"
lookup. Both read the same parsed model as check_arch.py, so there is exactly
one source of truth for the edges.

Usage
  python scripts/arch/dep_graph.py                    # DOT of all crates on stdout
  python scripts/arch/dep_graph.py --mermaid          # Mermaid flowchart
  python scripts/arch/dep_graph.py --crate wth-shell  # in/out edges for one crate
  python scripts/arch/dep_graph.py --layered          # DOT grouped by policy layer

The graph is the artifact that makes a split decision arguable instead of
intuitive: `--crate X` answers "what breaks if I delete this", and `--layered`
shows whether a crate is drawn as a leaf but wired as a hub.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_arch as ca  # noqa: E402


def build(policy, crates):
    edges = []
    for name, crate in crates.items():
        for target in ca.edge_targets(crate, crates):
            edges.append((name, target))
    return sorted(set(edges))


def dot(policy, crates, edges, layered: bool) -> str:
    lines = ["digraph wth {", "  rankdir=LR;", '  node [shape=box, fontsize=10];']
    if layered:
        for index, layer in enumerate(policy.layers):
            members = sorted(n for n, c in crates.items() if policy.layer_of(n) == index)
            if not members:
                continue
            lines.append(f"  subgraph cluster_l{index} {{")
            lines.append(f'    label="L{index} {layer.get("name", "")}";')
            for member in members:
                lines.append(f'    "{member}";')
            lines.append("  }")
    for src, dst in edges:
        src_layer = policy.layer_of(src)
        dst_layer = policy.layer_of(dst)
        bad = src_layer is not None and dst_layer is not None and dst_layer > src_layer
        lines.append(f'  "{src}" -> "{dst}"{" [color=red]" if bad else ""};')
    lines.append("}")
    return "\n".join(lines)


def mermaid(policy, crates, edges) -> str:
    lines = ["flowchart LR"]
    for index, layer in enumerate(policy.layers):
        members = sorted(n for n, c in crates.items() if policy.layer_of(n) == index)
        if not members:
            continue
        safe = layer.get("name", f"L{index}").replace(" ", "_")
        lines.append(f"  subgraph L{index}_{safe}")
        lines.extend(f"    {m}" for m in members)
        lines.append("  end")
    for src, dst in edges:
        lines.append(f"  {src} --> {dst}")
    return "\n".join(lines)


def crate_report(policy, crates, name: str) -> str:
    if name not in crates:
        suggestions = [c for c in sorted(crates) if name in c][:10]
        raise SystemExit(f"unknown crate {name!r}; try: {', '.join(suggestions) or 'none'}")
    out = [f"# {name}", ""]
    out.append(f"- dir: `{crates[name].rel_dir}`  layer: "
               f"{policy.layer_of(name) if policy.layer_of(name) is not None else 'unassigned'}")
    up = sorted(src for src, dst in build(policy, crates) if dst == name)
    down = sorted(dst for src, dst in build(policy, crates) if src == name)
    out.append(f"\n## Imports ({len(down)})\n")
    out.extend(f"- {dep}" for dep in down)
    if not down:
        out.append("- none")
    out.append(f"\n## Imported by ({len(up)})\n")
    for dep in up:
        out.append(f"- {dep}")
    if not up:
        out.append("- none (nothing links it: a leaf, or dead weight)")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--crate")
    parser.add_argument("--mermaid", action="store_true")
    parser.add_argument("--layered", action="store_true")
    args = parser.parse_args()

    policy = ca.load_policy()
    crates, _ = ca.load_crates()
    ca.bind_prefixes(policy, crates)
    edges = build(policy, crates)

    if args.crate:
        print(crate_report(policy, crates, args.crate))
        return 0
    if args.mermaid:
        print(mermaid(policy, crates, edges))
        return 0
    print(dot(policy, crates, edges, args.layered))
    return 0


if __name__ == "__main__":
    sys.exit(main())
