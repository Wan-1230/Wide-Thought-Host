#!/usr/bin/env python3
"""WTH architecture fitness functions -- a ratchet, not a report.

Ported from the ZCode engineering model (`pnpm architecture:check` +
`architecture-policy.yaml` + `.architecture-baseline.json`). The one thing that
makes that system work is the ratchet: existing violations are frozen into a
baseline so they never block a pull request, but a NEW violation fails the
build. Debt stops growing without requiring anyone to pay it down first.

Design constraints (deliberate, do not relax without reason):
  * stdlib only. No PyYAML, so the policy file is TOML (`tomllib`).
  * offline. `cargo metadata` is NOT usable here -- it needs to download the
    registry (`aligned-vec` is not vendored), which breaks CI-adjacent local
    runs. All facts come from reading Cargo.toml and source text directly.
  * deterministic. Violation keys are sorted and carry no timestamps.

Commands
  check             default; exit 1 when violations are not in the baseline
  report            markdown (or --format json) inventory of every violation
  baseline:update   rewrite the baseline (run on main only, separate commit)
  context <crate>   what this crate may import, and who imports it

Flags
  --changed         only judge violations touching files changed vs the base
  --base <ref>      diff base for --changed (default origin/main...HEAD)
  --format md|json  with `report`
  --verbose         include rules that passed

Usage: python scripts/arch/check_arch.py [command] [flags]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
POLICY_PATH = Path(__file__).resolve().parent / "architecture-policy.toml"
DEFAULT_BASELINE = Path(__file__).resolve().parent / ".architecture-baseline.json"


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #


@dataclass
class Crate:
    name: str
    rel_dir: str
    lib_name: str | None
    path_deps: dict[str, str] = field(default_factory=dict)  # alias -> package
    features: set[str] = field(default_factory=set)
    sources: list[Path] = field(default_factory=list)
    line_count: int = 0
    has_lib_doc: bool = False
    has_lib_target: bool = False
    external_deps: set[str] = field(default_factory=set)


@dataclass
class Violation:
    rule: str
    key: str  # stable identity stored in the baseline
    message: str
    paths: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"{self.rule}|{self.key}"


def load_toml(path: Path) -> dict:
    with path.open("rb") as fh:
        return tomllib.load(fh)


def normalize_lib_name(package_name: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    return package_name.replace("-", "_")


DEP_TABLES = (
    "dependencies",
    "dev-dependencies",
    "build-dependencies",
)


def iter_dep_tables(data: dict):
    """Yield dependency tables, including `[target.'cfg(...)'.dependencies]`."""
    for table in DEP_TABLES:
        if isinstance(data.get(table), dict):
            yield data[table]
    targets = data.get("target")
    if isinstance(targets, dict):
        for cfg_block in targets.values():
            if not isinstance(cfg_block, dict):
                continue
            for table in DEP_TABLES:
                if isinstance(cfg_block.get(table), dict):
                    yield cfg_block[table]


def workspace_dep_paths(policy_root_toml: dict) -> dict[str, str]:
    """`[workspace.dependencies]` entries that point at path packages."""
    out: dict[str, str] = {}
    ws_deps = policy_root_toml.get("workspace", {}).get("dependencies", {}) or {}
    for name, spec in ws_deps.items():
        if isinstance(spec, dict) and isinstance(spec.get("path"), str):
            out[name] = spec["path"]
    return out


def load_crates() -> tuple[dict[str, Crate], dict[str, str]]:
    """Parse every workspace member manifest. Returns crates and name->layer hints."""
    root_toml = load_toml(ROOT / "Cargo.toml")
    members = root_toml.get("workspace", {}).get("members", []) or []
    ws_paths = workspace_dep_paths(root_toml)
    # path -> package name, so a workspace-inherited path dep can be resolved.
    path_to_name = {str(Path(p).as_posix()): n for n, p in ws_paths.items()}

    crates: dict[str, Crate] = {}
    for member in members:
        member_dir = ROOT / member
        manifest = member_dir / "Cargo.toml"
        if not manifest.is_file():
            continue
        data = load_toml(manifest)
        pkg = data.get("package", {}) or {}
        name = pkg.get("name")
        if not name:
            continue

        lib_name = normalize_lib_name(name, (data.get("lib") or {}).get("name"))
        crate = Crate(name=name, rel_dir=member_dir.relative_to(ROOT).as_posix(), lib_name=lib_name)

        for table in iter_dep_tables(data):
            for alias, spec in table.items():
                path = None
                renamed = None
                if isinstance(spec, dict):
                    path = spec.get("path")
                    renamed = spec.get("package")
                    if spec.get("workspace") is True and alias in ws_paths:
                        path = ws_paths[alias]
                elif isinstance(spec, str):
                    continue
                if not isinstance(path, str):
                    continue
                target_dir = (member_dir / path).resolve()
                target_name = path_to_name.get(str(Path(path).as_posix()))
                if target_name is None and target_dir.is_dir():
                    try:
                        tdata = load_toml(target_dir / "Cargo.toml")
                        target_name = (tdata.get("package") or {}).get("name")
                    except (OSError, tomllib.TOMLDecodeError):
                        target_name = None
                if target_name:
                    crate.path_deps[renamed or alias] = target_name
                    crate.external_deps.discard(renamed or alias)
                # else: external path (third_party not in workspace) -- ignore
            for alias, spec in table.items():
                if isinstance(spec, dict) and spec.get("workspace") is True and alias not in crate.path_deps:
                    crate.external_deps.add(alias)
                elif isinstance(spec, str):
                    crate.external_deps.add(alias)

        for feat, refs in ((data.get("features") or {}) or {}).items():
            crate.features.add(feat)
            if isinstance(refs, list):
                for ref in refs:
                    if isinstance(ref, str) and ref.startswith("dep:"):
                        crate.features.add(ref[4:])

        crate.sources = collect_sources(crate.rel_dir)
        crate.has_lib_target = bool(lib_candidates(member_dir, lib_name))
        crate.has_lib_doc = lib_has_doc(member_dir, lib_name)
        crates[name] = crate

    for crate in crates.values():
        crate.line_count = sum(count_lines(p) for p in crate.sources)
    return crates, path_to_name


def collect_sources(rel_dir: str) -> list[Path]:
    base = ROOT / rel_dir
    out: list[Path] = []
    for sub in ("src", "tests", "benches", "examples"):
        d = base / sub
        if d.is_dir():
            out.extend(p for p in d.rglob("*.rs") if p.is_file())
    build_rs = base / "build.rs"
    if build_rs.is_file():
        out.append(build_rs)
    return sorted(out)


def lib_candidates(member_dir: Path, lib_name: str) -> list[Path]:
    return [c for c in (member_dir / "src" / "lib.rs", member_dir / "src" / f"{lib_name}.rs")
            if c.is_file()]


def lib_has_doc(member_dir: Path, lib_name: str) -> bool:
    """A crate with no lib target has nowhere to put `//!` -- treat as documented.

    Bin-only packages (wth-desktop, wth-pager-bin) are documented in README and
    in main.rs; demanding src/lib.rs would be a false positive that gets frozen.
    """
    candidates = lib_candidates(member_dir, lib_name)
    if not candidates:
        return True
    return any(re.search(r"^//!", read_text(c), re.MULTILINE) for c in candidates)


_LINE_CACHE: dict[Path, int] = {}


def count_lines(path: Path) -> int:
    cached = _LINE_CACHE.get(path)
    if cached is not None:
        return cached
    try:
        with path.open("rb") as fh:
            total = sum(1 for _ in fh)
    except OSError:
        total = 0
    _LINE_CACHE[path] = total
    return total


# --------------------------------------------------------------------------- #
# Policy
# --------------------------------------------------------------------------- #


@dataclass
class Policy:
    raw: dict
    layers: list[dict]
    crate_layer: dict[str, int]
    max_fanout: dict[str, int]
    file_max_lines: int
    giant_no_mod_lines: int
    naming_prefix: str
    doc_min_lines: int
    allowed_cycles: set[str]
    exempt: set[str]
    vendored_prefixes: list[str] = field(default_factory=list)

    def is_vendored(self, crate: Crate) -> bool:
        return any(crate.rel_dir.startswith(p) for p in self.vendored_prefixes)

    def layer_of(self, crate: str) -> int | None:
        return self.crate_layer.get(crate)

    def layer_name(self, index: int) -> str:
        return self.layers[index]["name"]

    def is_exempt(self, violation_id: str) -> bool:
        return violation_id in self.exempt


def load_policy() -> Policy:
    data = load_toml(POLICY_PATH)
    layers = data.get("layers", []) or []
    crate_layer: dict[str, int] = {}
    for index, layer in enumerate(layers):
        for crate in layer.get("crates", []) or []:
            crate_layer[crate] = index
    naming = data.get("naming", {}) or {}
    files = data.get("files", {}) or {}
    deps = data.get("dependencies", {}) or {}
    return Policy(
        raw=data,
        layers=layers,
        crate_layer=crate_layer,
        max_fanout=deps.get("max_fanout", {}) or {},
        file_max_lines=int(files.get("max_lines", 2000)),
        giant_no_mod_lines=int(files.get("giant_no_mod_lines", 3000)),
        naming_prefix=str(naming.get("required_prefix_for_new", "wth-")),
        doc_min_lines=int(data.get("docs", {}).get("min_crate_lines", 5000)),
        allowed_cycles=set(data.get("cycles", {}).get("allow", []) or []),
        exempt=set(data.get("exempt", []) or []),
        vendored_prefixes=sorted({
            prefix
            for layer in layers if layer.get("vendored")
            for prefix in (layer.get("dir_prefixes") or [])
        }),
    )


def bind_prefixes(policy: Policy, crates: dict[str, Crate]) -> None:
    """Assign layers by directory prefix after crate names are known."""
    for index, layer in enumerate(policy.layers):
        prefixes = layer.get("dir_prefixes", []) or []
        if not prefixes:
            continue
        for name, crate in crates.items():
            if name in policy.crate_layer:
                continue
            rel = crate.rel_dir
            if any(rel == p.rstrip("/") or rel.startswith(p) for p in prefixes):
                policy.crate_layer[name] = index


# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #

MOD_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_]")


def edge_targets(crate: Crate, crates: dict[str, Crate]) -> list[str]:
    return sorted({t for t in crate.path_deps.values() if t in crates and t != crate.name})


def rule_layers(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    """A crate may only depend on its own layer or lower ones."""
    out: list[Violation] = []
    for name, crate in sorted(crates.items()):
        src_layer = policy.layer_of(name)
        if src_layer is None or policy.is_vendored(crate):
            continue
        for target in edge_targets(crate, crates):
            if policy.is_vendored(crates[target]):
                continue
            dst_layer = policy.layer_of(target)
            if dst_layer is None or dst_layer <= src_layer:
                continue
            out.append(
                Violation(
                    rule="layer_violation",
                    key=f"{name}->={target}",
                    message=(
                        f"{name} (L{src_layer} {policy.layer_name(src_layer)}) depends on "
                        f"{target} (L{dst_layer} {policy.layer_name(dst_layer)}); "
                        f"types/contracts must not import capability or host layers"
                    ),
                    paths=[f"{crate.rel_dir}/Cargo.toml"],
                )
            )
    return out


def rule_fanout(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    out: list[Violation] = []
    default = int(policy.raw.get("dependencies", {}).get("default_max_fanout", 60))
    for name, crate in sorted(crates.items()):
        limit = int(policy.max_fanout.get(name, default))
        total = len(crate.path_deps) + len(crate.external_deps)
        internal = len(edge_targets(crate, crates))
        if internal > limit:
            out.append(
                Violation(
                    rule="fanout",
                    key=name,
                    message=(
                        f"{name} pulls {internal} internal crates "
                        f"({total} direct deps total) over the limit {limit}; "
                        f"every addition re-compiles the union of their trees"
                    ),
                    paths=[f"{crate.rel_dir}/Cargo.toml"],
                )
            )
    return out


def rule_file_size(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    out: list[Violation] = []
    for name, crate in sorted(crates.items()):
        for path in crate.sources:
            lines = count_lines(path)
            if lines > policy.file_max_lines:
                rel = path.relative_to(ROOT).as_posix()
                out.append(
                    Violation(
                        rule="file_size",
                        key=rel,
                        message=f"{rel} is {lines} lines (limit {policy.file_max_lines})",
                        paths=[rel],
                    )
                )
    return out


def rule_giant_no_mod(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    """Huge files with zero submodules cannot be navigated or reviewed."""
    out: list[Violation] = []
    for name, crate in sorted(crates.items()):
        for path in crate.sources:
            lines = count_lines(path)
            if lines <= policy.giant_no_mod_lines:
                continue
            text = read_text(path)
            if MOD_RE.search(text):
                continue
            rel = path.relative_to(ROOT).as_posix()
            out.append(
                Violation(
                    rule="giant_no_mod",
                    key=rel,
                    message=(
                        f"{rel} is {lines} lines with no `mod` declaration; "
                        f"split it into a directory module with a re-exporting mod.rs"
                    ),
                    paths=[rel],
                )
            )
    return out


PATH_REF_RE = re.compile(r"\b([a-z][a-z0-9_]*)\s*::")
USE_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([a-z][a-z0-9_]*)\b", re.MULTILINE)


def referenced_idents(sources: list[Path]) -> set[str]:
    """One pass over a crate's sources collecting every `foo::` / `use foo` root.

    Runs one regex per file instead of one per declared dependency: the naive
    version made the full check take ~90s (wth-shell alone is 335k lines), which
    is too slow for a pre-push hook.
    """
    idents: set[str] = set()
    for path in sources:
        text = read_text(path)
        idents.update(PATH_REF_RE.findall(text))
        idents.update(USE_RE.findall(text))
    return idents


def rule_dead_path_dep(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    """A declared internal crate whose symbols never appear in the depending crate."""
    out: list[Violation] = []
    for name, crate in sorted(crates.items()):
        if not crate.path_deps:
            continue
        idents = referenced_idents(crate.sources)
        for alias, target in sorted(crate.path_deps.items()):
            if target not in crates:
                continue
            if alias in crate.features or target in crate.features:
                continue  # feature-gated on purpose
            target_lib = crates[target].lib_name or target.replace("-", "_")
            if {alias.replace("-", "_"), target_lib, alias, target} & idents:
                continue
            out.append(
                Violation(
                    rule="dead_path_dep",
                    key=f"{name}::{alias}",
                    message=(
                        f"{name} depends on `{alias}` ({target}) but no symbol from it "
                        f"appears in its sources; drop the declaration -- it still costs "
                        f"a full compile of {target}'s tree"
                    ),
                    paths=[f"{crate.rel_dir}/Cargo.toml"],
                )
            )
    return out


def rule_cycles(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    """Report import cycles (Tarjan SCC) over internal dependency edges."""
    graph = {name: edge_targets(crate, crates) for name, crate in crates.items()}
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    components: list[list[str]] = []
    counter = [0]

    def strongconnect(node: str) -> None:
        work = [(node, iter(graph.get(node, [])))]
        index[node] = low[node] = counter[0]
        counter[0] += 1
        stack.append(node)
        on_stack.add(node)
        while work:
            current, children = work[-1]
            advanced = False
            for child in children:
                if child not in index:
                    index[child] = low[child] = counter[0]
                    counter[0] += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(graph.get(child, []))))
                    advanced = True
                    break
                if child in on_stack:
                    low[current] = min(low[current], index[child])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[current])
            if low[current] == index[current]:
                members = []
                while True:
                    popped = stack.pop()
                    on_stack.discard(popped)
                    members.append(popped)
                    if popped == current:
                        break
                if len(members) > 1:
                    components.append(sorted(members))

    for node in sorted(graph):
        if node not in index:
            strongconnect(node)

    out: list[Violation] = []
    for members in sorted(components):
        key = "~".join(members)
        if key in policy.allowed_cycles:
            continue
        out.append(
            Violation(
                rule="cycle",
                key=key,
                message=(
                    f"dependency cycle among {', '.join(members)}; cargo accepts it only "
                    f"because the edges are split across lib/bin targets -- it defeats "
                    f"incremental rebuild and layer reasoning"
                ),
                paths=[f"{crates[m].rel_dir}/Cargo.toml" for m in members],
            )
        )
    return out


def rule_crate_doc(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    out: list[Violation] = []
    for name, crate in sorted(crates.items()):
        if crate.line_count < policy.doc_min_lines:
            continue
        if not crate.has_lib_target or crate.has_lib_doc:
            continue
        out.append(
            Violation(
                rule="crate_doc",
                key=name,
                message=(
                    f"{name} is {crate.line_count} lines with no `//!` module doc in "
                    f"src/lib.rs; state its role and its layer in one paragraph"
                ),
                paths=[f"{crate.rel_dir}/src/lib.rs"],
            )
        )
    return out


def rule_naming(policy: Policy, crates: dict[str, Crate], baseline: Baseline) -> list[Violation]:
    """Crates created after the rename freeze must use the product prefix.

    "New" means: not recorded in the baseline's `known_crates` set. Run
    `baseline:update` on main to extend the frozen list -- that is the only way
    a crate becomes grandfathered, and the diff is the audit trail.
    """
    out: list[Violation] = []
    known = set(baseline.data.get("known_crates", []))
    for name in sorted(crates):
        if name in known:
            continue
        if name.startswith(policy.naming_prefix):
            continue
        allowed = set(policy.raw.get("naming", {}).get("vendor_prefixes", []) or [])
        if any(name.startswith(p) for p in allowed):
            continue
        out.append(
            Violation(
                rule="naming",
                key=name,
                message=(
                    f"new crate `{name}` must start with `{policy.naming_prefix}` "
                    f"(vendor exceptions go in naming.vendor_prefixes; the xai-* "
                    f"legacy set is frozen in the baseline)"
                ),
                paths=[f"{crates[name].rel_dir}/Cargo.toml"],
            )
        )
    return out


_READ_CACHE: dict[Path, str] = {}


def rule_deny(policy: Policy, crates: dict[str, Crate]) -> list[Violation]:
    """Named same-layer edges that are wrong regardless of layer numbering."""
    out: list[Violation] = []
    for entry in policy.raw.get("deny", []) or []:
        src, dst = entry.get("from"), entry.get("to")
        if not src or not dst:
            continue
        crate = crates.get(src)
        if crate is None or dst not in edge_targets(crate, crates):
            continue
        out.append(
            Violation(
                rule="denied_edge",
                key=f"{src}->{dst}",
                message=f"{src} -> {dst} is denied by policy: {_one_line(entry.get('reason'))}",
                paths=[f"{crate.rel_dir}/Cargo.toml"],
            )
        )
    return out


def _one_line(text) -> str:
    return " ".join(str(text or "no reason given").split())


def read_text(path: Path) -> str:
    cached = _READ_CACHE.get(path)
    if cached is not None:
        return cached
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    _READ_CACHE[path] = text
    return text


# --------------------------------------------------------------------------- #
# Baseline
# --------------------------------------------------------------------------- #


class Baseline:
    def __init__(self, path: Path, data: dict | None):
        self.path = path
        self.data = data or {"violations": {}, "known_crates": []}

    @classmethod
    def load(cls, path: Path) -> "Baseline":
        if path.is_file():
            try:
                return cls(path, json.loads(path.read_text(encoding="utf-8")))
            except json.JSONDecodeError as exc:
                print(f"error: baseline {path} is not valid JSON: {exc}", file=sys.stderr)
                raise SystemExit(2)
        return cls(path, None)

    @property
    def violations(self) -> dict[str, str]:
        return self.data.get("violations", {}) or {}

    def is_frozen(self, violation: Violation) -> bool:
        return violation.id in self.violations

    def write(self, violations: list[Violation], crates: dict[str, Crate]) -> None:
        self.data["violations"] = {v.id: v.message for v in sorted(violations, key=lambda v: v.id)}
        self.data["known_crates"] = sorted(crates)
        self.data["note"] = (
            "Frozen architecture debt. check_arch.py fails on keys that are NOT "
            "listed here. Shrink this file over time; never add to it from a "
            "feature branch -- regenerate on main with "
            "`python scripts/arch/check_arch.py baseline:update`."
        )
        self.path.write_text(
            json.dumps(self.data, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
        )


# --------------------------------------------------------------------------- #
# Changed-file filter
# --------------------------------------------------------------------------- #


def changed_files(base: str) -> set[str] | None:
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", base],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        print(f"warning: --changed needs git ({detail.strip()}); judging all violations", file=sys.stderr)
        return None
    return {line.strip().replace("\\", "/") for line in out.stdout.splitlines() if line.strip()}


def touches_change(violation: Violation, changed: set[str]) -> bool:
    if not violation.paths:
        return True
    for path in violation.paths:
        if path in changed:
            return True
        # A Cargo.toml edit counts as touching the crate it declares.
        if path.endswith("/Cargo.toml") and any(p.startswith(path[: -len("Cargo.toml")]) for p in changed):
            return True
        if path.endswith(".rs") and path in changed:
            return True
    return False


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #


def collect_violations(
    policy: Policy, crates: dict[str, Crate], baseline: Baseline
) -> list[Violation]:
    rules = [
        lambda: rule_layers(policy, crates),
        lambda: rule_deny(policy, crates),
        lambda: rule_fanout(policy, crates),
        lambda: rule_file_size(policy, crates),
        lambda: rule_giant_no_mod(policy, crates),
        lambda: rule_dead_path_dep(policy, crates),
        lambda: rule_cycles(policy, crates),
        lambda: rule_crate_doc(policy, crates),
        lambda: rule_naming(policy, crates, baseline),
    ]
    out: list[Violation] = []
    for rule in rules:
        out.extend(rule())
    return sorted(out, key=lambda v: v.id)


def summarize(violations: list[Violation]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for violation in violations:
        counts[violation.rule] += 1
    return dict(sorted(counts.items()))


def cmd_check(args: argparse.Namespace, policy: Policy, crates: dict[str, Crate], baseline: Baseline) -> int:
    all_violations = collect_violations(policy, crates, baseline)
    frozen = [v for v in all_violations if baseline.is_frozen(v)]
    new = [v for v in all_violations if not baseline.is_frozen(v)]
    resolved = [vid for vid in baseline.violations if vid not in {v.id for v in all_violations}]

    changed: set[str] | None = changed_files(args.base) if args.changed else None
    gating = [v for v in new if changed is None or touches_change(v, changed)]
    deferred = [v for v in new if changed is not None and v not in gating]

    print(f"architecture: {len(all_violations)} violations "
          f"({len(frozen)} frozen, {len(new)} new), {len(crates)} crates")
    counts = summarize(all_violations)
    if args.verbose or counts:
        for rule, count in sorted(counts.items(), key=lambda kv: -kv[1]):
            frozen_count = sum(1 for v in frozen if v.rule == rule)
            print(f"  {rule:<16} {count:>4}  (frozen {frozen_count})")

    if gating:
        print(f"\nNEW violations -- these block the merge ({len(gating)}):", file=sys.stderr)
        for violation in gating:
            print(f"  [{violation.rule}] {violation.message}", file=sys.stderr)
            for path in violation.paths[:3]:
                print(f"      {path}", file=sys.stderr)
        print(
            "\nFix the code. Do not add to the baseline from a branch: the baseline is\n"
            "regenerated on main only, so an inflated baseline shows up in review.",
            file=sys.stderr,
        )
        return 1

    if deferred:
        print(f"note: {len(deferred)} new violation(s) outside the changed file set were not gated")
    if resolved:
        print(
            f"\ngood news: {len(resolved)} frozen violation(s) no longer reproduce.\n"
            f"Shrink the baseline: python scripts/arch/check_arch.py baseline:update",
        )
    return 0


def cmd_report(args: argparse.Namespace, policy: Policy, crates: dict[str, Crate], baseline: Baseline) -> int:
    violations = collect_violations(policy, crates, baseline)
    if args.format == "json":
        payload = {
            "crates": len(crates),
            "by_rule": summarize(violations),
            "violations": [
                {"id": v.id, "rule": v.rule, "message": v.message, "paths": v.paths,
                 "frozen": baseline.is_frozen(v)}
                for v in violations
            ],
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0

    print("# Architecture report\n")
    print(f"- crates parsed: {len(crates)}")
    print(f"- violations: {len(violations)} ({len(baseline.violations)} frozen in baseline)\n")
    print("| rule | count | new |\n|---|---|---|")
    counts = summarize(violations)
    for rule, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        new = sum(1 for v in violations if v.rule == rule and not baseline.is_frozen(v))
        print(f"| `{rule}` | {count} | {new} |")
    print()
    for rule in counts:
        print(f"\n## {rule}\n")
        for violation in [v for v in violations if v.rule == rule][:40]:
            flag = "" if baseline.is_frozen(violation) else " **(new)**"
            print(f"- `{violation.key}`{flag}: {violation.message}")
        remaining = sum(1 for v in violations if v.rule == rule) - 40
        if remaining > 0:
            print(f"- … {remaining} more")
    return 0


def cmd_baseline_update(args: argparse.Namespace, policy: Policy, crates: dict[str, Crate], baseline: Baseline) -> int:
    violations = collect_violations(policy, crates, baseline)
    before = len(baseline.violations)
    baseline.write(violations, crates)
    print(f"baseline rewritten: {before} -> {len(violations)} frozen violations, "
          f"{len(crates)} known crates")
    print(f"  {baseline.path.relative_to(ROOT).as_posix()}")
    if len(violations) > before:
        print("warning: baseline GREW -- only do this after intentionally landing debt", file=sys.stderr)
    return 0


def cmd_context(args: argparse.Namespace, policy: Policy, crates: dict[str, Crate], baseline: Baseline) -> int:
    name = args.crate
    crate = crates.get(name)
    if crate is None:
        suggestions = [c for c in crates if name in c][:8]
        print(f"error: unknown crate `{name}`. Did you mean: {', '.join(suggestions) or 'none'}?", file=sys.stderr)
        return 2
    layer = policy.layer_of(name)
    imports = edge_targets(crate, crates)
    imported_by = sorted(n for n, c in crates.items() if name in c.path_deps.values() and n != name)
    violations = [v for v in collect_violations(policy, crates, baseline)
                  if name in v.key or v.key.startswith(f"{name}::")]

    print(f"# {name}\n")
    print(f"- directory: `{crate.rel_dir}`")
    print(f"- lib name: `{crate.lib_name}`")
    if layer is None:
        print("- layer: **unassigned** (add it to architecture-policy.toml)")
    else:
        print(f"- layer: L{layer} `{policy.layer_name(layer)}` — may import L0..L{layer}")
    print(f"- size: {crate.line_count} lines across {len(crate.sources)} .rs files")
    print(f"- internal deps ({len(imports)}): {', '.join(imports) or 'none'}")
    print(f"- depended on by ({len(imported_by)}): {', '.join(imported_by[:25]) or 'none'}"
          + (f" … +{len(imported_by) - 25}" if len(imported_by) > 25 else ""))
    if violations:
        print(f"\n## Frozen debt on this crate ({len(violations)})\n")
        for violation in violations:
            flag = "frozen" if baseline.is_frozen(violation) else "NEW - would fail check"
            print(f"- [{violation.rule}/{flag}] {violation.message}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", nargs="?", default="check",
                        choices=["check", "report", "baseline:update", "context"])
    parser.add_argument("crate", nargs="?", help="crate name for `context`")
    parser.add_argument("--changed", action="store_true", help="gate only violations in changed files")
    parser.add_argument("--base", default="origin/main...HEAD")
    parser.add_argument("--format", default="md", choices=["md", "json"])
    parser.add_argument("--baseline", default=str(DEFAULT_BASELINE))
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not POLICY_PATH.is_file():
        print(f"error: policy missing at {POLICY_PATH}", file=sys.stderr)
        return 2

    policy = load_policy()
    crates, _ = load_crates()
    bind_prefixes(policy, crates)
    baseline = Baseline.load(Path(args.baseline))

    if args.command == "context":
        if not args.crate:
            print("error: context needs a crate name", file=sys.stderr)
            return 2
        return cmd_context(args, policy, crates, baseline)
    if args.command == "baseline:update":
        return cmd_baseline_update(args, policy, crates, baseline)
    if args.command == "report":
        return cmd_report(args, policy, crates, baseline)
    return cmd_check(args, policy, crates, baseline)


if __name__ == "__main__":
    sys.exit(main())
