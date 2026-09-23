#!/usr/bin/env python3
"""Rebuild THIRD-PARTY-NOTICES from Cargo.lock and the local cargo cache.

Why this exists: the checked-in notices file is legal text that nobody can
regenerate. It has no generator and no CI job, so every dependency added since
it was written is either missing or was hand-appended. This script makes the
mechanically derivable part reproducible -- package list, versions, SPDX ids,
repository URLs, copyright lines, license texts -- so drift becomes a failing
check instead of a mystery.

What it deliberately does NOT do: invent judgement. The current file contains
hand-researched entries (which palette a TUI theme was derived from, which
upstream a ported tool file came from, which leg of an "MIT OR Apache-2.0"
expression this distribution satisfies under). None of that is in Cargo.lock.
Those entries belong in `docs/third-party-notices-addenda.md`, which this
script splices in verbatim -- editable by hand, still one command to assemble.

Zero third-party dependencies (stdlib only, `tomllib` included), matching
`docs/adr/architecture-governance.md`. Runs fully offline against the crates.io
sources already unpacked in `$CARGO_HOME/registry/src`; if a package is missing
there it is reported as a gap rather than silently dropped, so the output of
this script on a machine that has never built the tree is a hard error, not a
shorter file.

    python scripts/gen_third_party_notices.py --stdout | less
    python scripts/gen_third_party_notices.py --verify
    python scripts/gen_third_party_notices.py --write THIRD-PARTY-NOTICES

`--write` is explicit and takes a path. There is no default output target: this
overwrites a legal document and should not be one careless keystroke away.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import os
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RULE = "=" * 80
SUBRULE = "-" * 80

CRITERIA_RE = re.compile(r"copyright|©|\(c\)\s", re.IGNORECASE)
# LICENSE, LICENCE, LICENSE-APACHE, COPYING.txt, NOTICE.md ...
LICENSE_GLOB = re.compile(r"^(license|licence|copying|copyright|notice)([.-].*)?$", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# inputs
# --------------------------------------------------------------------------- #


def die(msg: str, code: int = 2) -> None:
    print(f"gen_third_party_notices: {msg}", file=sys.stderr)
    raise SystemExit(code)


def cargo_home() -> Path:
    env = os.environ.get("CARGO_HOME")
    if env:
        return Path(env)
    return Path.home() / ".cargo"


def cargo_registry_src(cache: Path | None = None) -> list[Path]:
    """Directories holding unpacked crates.io sources: $CARGO_HOME/registry/src/<index>/.

    More than one index dir is possible (sparse vs. git index, or a renamed
    registry) -- search them all, first hit wins.
    """
    base = (cache or cargo_home()) / "registry" / "src"
    if not base.is_dir():
        return []
    return sorted(p for p in base.iterdir() if p.is_dir())


def load_lock(path: Path) -> list[dict]:
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        die(f"cannot read {path}: {exc}")
    except tomllib.TOMLDecodeError as exc:
        die(f"cannot parse {path}: {exc}")
    pkgs = data.get("package", [])
    if not pkgs:
        die(f"{path} lists no [[package]] entries -- wrong file?")
    return pkgs


def workspace_members(root: Path) -> dict[str, dict]:
    """package name -> {name, version, license, rel_dir} for in-tree members."""
    manifest = root / "Cargo.toml"
    try:
        table = tomllib.loads(manifest.read_text(encoding="utf-8"))
    except OSError:
        return {}
    out: dict[str, dict] = {}

    def add(member_dir: str) -> None:
        cm = root / member_dir / "Cargo.toml"
        if not cm.is_file():
            return
        try:
            t = tomllib.loads(cm.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            print(f"warning: cannot parse {member_dir}/Cargo.toml: {exc}", file=sys.stderr)
            return
        pkg = t.get("package") or {}
        name = pkg.get("name")
        if not name:  # virtual manifest
            return
        out[name] = {
            "name": name,
            "version": pkg.get("version", "unknown"),
            "license": pkg.get("license") or "",
            "license_file": pkg.get("license-file") or "",
            "rel_dir": member_dir.replace("\\", "/"),
            "dir": (root / member_dir),
        }

    ws = table.get("workspace") or {}
    for m in ws.get("members", []):
        add(m)
    return out


# --------------------------------------------------------------------------- #
# per-package metadata from the unpacked registry source
# --------------------------------------------------------------------------- #


def find_registry_dir(index_dirs: list[Path], name: str, version: str) -> Path | None:
    cand = f"{name}-{version}"
    for idx in index_dirs:
        d = idx / cand
        if d.is_dir():
            return d
    return None


def read_manifest(pkg_dir: Path) -> dict:
    cm = pkg_dir / "Cargo.toml"
    if not cm.is_file():
        return {}
    try:
        # Registry Cargo.toml can carry `[patch]`-style duplicate tables that
        # tomllib rejects; on any parse failure treat metadata as unknown.
        t = tomllib.loads(cm.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}
    pkg = t.get("package") or {}
    return {
        "license": (pkg.get("license") or "").strip(),
        "license_file": (pkg.get("license-file") or "").strip(),
        "repository": (pkg.get("repository") or "").strip(),
        "homepage": (pkg.get("homepage") or "").strip(),
    }


def copyright_lines(pkg_dir: Path, license_file: str = "") -> tuple[list[str], list[Path]]:
    """Copyright lines from the package's license text(s), plus the files read."""
    files: list[Path] = []
    if license_file:
        p = pkg_dir / license_file
        if p.is_file():
            files.append(p)
    if not files:
        files = sorted(
            p for p in pkg_dir.iterdir() if p.is_file() and LICENSE_GLOB.match(p.name)
        )[:4]
    lines: list[str] = []
    seen: set[str] = set()
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for raw in text.splitlines():
            s = raw.strip()
            if not s or len(s) > 160 or not CRITERIA_RE.search(s):
                continue
            # Drop section headings and URLs that merely mention "copyright".
            if s.startswith("#") or s.startswith("//") or s.startswith("http"):
                continue
            if s.lower() in {"copyright", "copyright notice", "copyright notice:"}:
                continue
            if s in seen:
                continue
            seen.add(s)
            lines.append(s)
            if len(lines) >= 6:
                return lines, files
    return lines, files


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #


def block(title: str) -> str:
    return f"{RULE}\n{title}\n{RULE}\n\n"


def entry(name: str, version: str, fields: dict, notes: list[str]) -> str:
    out = [SUBRULE, f"{name} {version}", SUBRULE]
    src = fields.get("repository") or fields.get("homepage")
    out.append(f"Source:  {src or 'unknown (no repository/homepage in packaged manifest)'}")
    lic = fields.get("license") or ""
    if fields.get("license_file"):
        lic = (lic + " " if lic else "") + f"(text in {fields['license_file']})"
    out.append(f"License: {lic or 'UNRESOLVED'}")
    if fields.get("copyright"):
        out.append("")
        out.append("Copyright notice:")
        out.extend(f"  {c}" for c in fields["copyright"])
    if fields.get("license_text_ref"):
        out.append("")
        out.append(f"License text: {fields['license_text_ref']}")
    if notes:
        out.append("")
        out.append("Additional requirements / notices:")
        out.extend(f"  {n}" for n in notes)
    return "\n".join(out) + "\n\n"


def build(
    root: Path,
    lock: list[dict],
    members: dict[str, dict],
    index_dirs: list[Path],
    addenda: str | None,
) -> tuple[str, dict]:
    stats = {"registry": 0, "git": 0, "member": 0, "vendored": 0, "gaps": 0}
    missing: list[str] = []
    unresolved: list[str] = []
    missing_text: list[str] = []
    # content sha256 -> {body, files, ids, sample}. Keyed by what the text *says*,
    # not by the expression that pointed at it: `MIT OR Apache-2.0` and
    # `Apache-2.0 OR MIT` and `(MIT OR Apache-2.0) AND ...` all resolve to the
    # same two bodies, and repeating them per expression is how a notices file
    # turns into 5 MB of the same paragraph.
    license_texts: dict[str, dict] = {}

    registry_entries: list[str] = []
    git_entries: list[str] = []
    member_rows: list[str] = []

    for pkg in sorted(lock, key=lambda p: (p["name"].lower(), p.get("version", ""))):
        name = pkg["name"]
        version = pkg.get("version", "unknown")
        source = pkg.get("source", "")

        if name in members and not source:
            m = members[name]
            if m["rel_dir"].startswith("third_party/"):
                # Not first-party and not a registry download. PART IV owns it.
                stats["vendored"] += 1
                continue
            member_rows.append(
                f"  {m['name']} {m['version']}  license: "
                f"{m['license'] or m['license_file'] or 'UNRESOLVED'}  ({m['rel_dir']})"
            )
            stats["member"] += 1
            continue

        if source.startswith("registry+"):
            stats["registry"] += 1
            pkg_dir = find_registry_dir(index_dirs, name, version)
            if pkg_dir is None:
                missing.append(f"{name} {version}")
                fields = {"license": "UNRESOLVED (not in the local cargo cache)"}
                unresolved.append(f"{name} {version} (source not unpacked)")
            else:
                meta = read_manifest(pkg_dir)
                cr, files = copyright_lines(pkg_dir, meta.get("license_file", ""))
                fields = dict(meta)
                fields["copyright"] = cr
                if not fields["license"] and not fields["license_file"]:
                    fields["license"] = "UNRESOLVED"
                    unresolved.append(f"{name} {version} (no license metadata)")
                expr = fields["license"] or "(no license declared in the manifest)"
                refs: list[tuple[str, str]] = []
                for f in files:
                    body = normalise(f)
                    if not body:
                        continue
                    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
                    rec = license_texts.setdefault(
                        digest,
                        {
                            "body": body,
                            "files": set(),
                            "ids": set(),
                            "sample": f"{name} {version}",
                        },
                    )
                    rec["files"].add(f.name)
                    rec["ids"].update(license_atoms(expr))
                    refs.append((f.name, digest))
                if refs:
                    fields["license_text_ref"] = (
                        "see Part VII -- "
                        + ", ".join(f"{n} [{d[:10]}]" for n, d in sorted(refs))
                    )
                else:
                    fields["license_text_ref"] = (
                        "not embedded -- no license text was found in the packaged source"
                    )
                    missing_text.append(f"{name} {version}")
            registry_entries.append(entry(name, version, fields, []))
            continue

        if source.startswith("git+") or source.startswith("path+"):
            stats["git"] += 1
            url, _, rev = source.partition("?")
            fields = {
                "repository": url[4:] if url.startswith("git+") else url,
                "license": "see the source tree at the pinned revision",
            }
            note = rev or f"checksum {pkg.get('checksum', 'n/a')}"
            git_entries.append(entry(name, version, fields, [f"pinned by: {note}"]))
            continue

        # Path dependency that is not a workspace member: in-tree, first-party.
        member_rows.append(f"  {name} {version}  (in-tree path dependency)")
        stats["member"] += 1

    parts: list[str] = []
    parts.append(
        block("THIRD-PARTY NOTICES")
        + "GENERATED FILE -- do not edit by hand.\n"
        "  Regenerate: python scripts/gen_third_party_notices.py --write THIRD-PARTY-NOTICES\n"
        "  Check:      python scripts/gen_third_party_notices.py --verify\n"
        "  Inputs:     Cargo.lock, the packaged manifests under $CARGO_HOME/registry/src,\n"
        "              third_party/*/Cargo.toml, bin/, bundled-skills/.\n"
        "  There is no timestamp in here on purpose: the same inputs must produce byte-\n"
        "  identical output on every machine, or --verify is noise.\n\n"
        + RULE
        + "\n\n"
    )

    parts.append(
        block("PART I -- FIRST-PARTY WORKSPACE MEMBERS")
        + f"{stats['member']} crates WTH ships and also maintains. Apache-2.0 unless\n"
        "noted; full text at repository LICENSE, upstream attribution at NOTICE.\n\n"
        + "\n".join(member_rows)
        + "\n\n"
    )

    parts.append(
        block("PART II -- CRATES.IO PACKAGES")
        + f"{stats['registry']} packages resolved from Cargo.lock. Source URLs and\n"
        "copyright lines are read from the packaged manifest and license text that\n"
        "cargo unpacked under $CARGO_HOME/registry/src -- nothing here is typed by hand.\n"
        "\n"
        "Where `License:` shows an expression (`MIT OR Apache-2.0`), choosing which leg\n"
        "this distribution satisfies under is a legal judgement, not a lookup. The\n"
        "expressions are reproduced verbatim; resolutions live in the curated part.\n\n"
        + "".join(registry_entries)
    )

    parts.append(
        block("PART III -- PACKAGES FROM GIT OR OTHER REGISTRIES")
        + (
            "".join(git_entries)
            if git_entries
            else "None. Every non-workspace dependency resolves through crates.io.\n\n"
        )
    )

    # ---------------- vendored trees ---------------- #
    vend: list[str] = []
    tp = root / "third_party"
    if tp.is_dir():
        for d in sorted(p for p in tp.iterdir() if p.is_dir()):
            cm = d / "Cargo.toml"
            if not cm.is_file():
                continue
            raw = cm.read_text(encoding="utf-8", errors="replace")
            try:
                t = tomllib.loads(raw)
            except tomllib.TOMLDecodeError:
                t = {}
            pkg = t.get("package") or {}
            license_files = sorted(
                p for p in d.iterdir() if p.is_file() and LICENSE_GLOB.match(p.name)
            )
            cr, _ = copyright_lines(d)
            # The `# Upstream: <url> (<license>) — ... rev <sha>` header line is
            # the vendoring convention in this tree; read it instead of guessing.
            m = re.search(r"^#\s*Upstream:\s*(\S+)", raw, re.MULTILINE)
            rev = re.search(r"rev[ision]*\s+([0-9a-f]{7,40})", raw)
            notes = [
                "Vendored, so it is in Cargo.lock as an in-tree path dependency and no\n"
                "  crates.io checksum pins it. The authoritative list of local\n"
                f"  modifications to re-apply on an upgrade is the VENDORING NOTES header\n"
                f"  of third_party/{d.name}/Cargo.toml."
            ]
            if rev:
                notes.append(f"Pinned upstream revision: {rev.group(1)}")
            if license_files:
                notes.append(
                    "License text shipped in-tree: " + ", ".join(p.name for p in license_files)
                )
            fields = {
                "repository": m.group(1) if m else "",
                "license": (pkg.get("license") or "").strip() or "UNRESOLVED",
                "copyright": cr,
            }
            vend.append(
                entry(
                    pkg.get("name", d.name),
                    pkg.get("version", "unknown"),
                    fields,
                    notes,
                )
            )
    tp_notice = tp / "NOTICE"
    if tp_notice.is_file():
        vend.append(
            SUBRULE
            + "\nthird_party/NOTICE\n"
            + SUBRULE
            + "\nThe tree-level vendoring notice is maintained separately and is\n"
            "reproduced verbatim below.\n\n"
            + indent(tp_notice.read_text(encoding="utf-8", errors="replace"))
            + "\n"
        )
    parts.append(
        block("PART IV -- VENDORED TREES UNDER third_party/")
        + "Mirrors of upstream sources kept in-tree because they render untrusted\n"
        "model output or must survive an upstream yank. They are exempt from the\n"
        "workspace layering rules (see scripts/arch/architecture-policy.toml).\n\n"
        + ("".join(vend) if vend else "No third_party/ directory found.\n\n")
    )

    # ---------------- bundled non-Cargo artifacts ---------------- #
    bundled: list[str] = []
    protoc = root / "bin" / "protoc-win64"
    if protoc.is_dir():
        readme = protoc / "readme.txt"
        head = ""
        if readme.is_file():
            head = "\n".join(
                readme.read_text(encoding="utf-8", errors="replace").splitlines()[:4]
            )
        has_license = any(
            LICENSE_GLOB.match(p.name) for p in protoc.iterdir() if p.is_file()
        )
        notes = [head] if head else []
        if not has_license:
            notes.append(
                "GAP: no license text is shipped next to the binary. protoc is\n"
                "  distributed under the BSD-3-Clause license of\n"
                "  protocolbuffers/protobuf; the license text must be added to\n"
                "  bin/protoc-win64/ (or this entry must carry it inline) before\n"
                "  this file can be considered complete."
            )
        bundled.append(
            entry(
                "protoc (precompiled binary, win64)",
                read_protoc_version(protoc),
                {
                    "repository": "https://github.com/protocolbuffers/protobuf",
                    "license": "BSD-3-Clause",
                    "copyright": ["Copyright 2008 Google Inc."],
                },
                notes,
            )
        )
    skills = root / "bundled-skills"
    if skills.is_dir():
        names = sorted(p.name for p in skills.iterdir() if p.is_dir())
        bundled.append(
            entry(
                "bundled-skills/",
                "n/a",
                {
                    "repository": "",
                    "license": "Apache-2.0 (first-party)",
                    "copyright": ["Copyright 2026 The Wide Thought Host contributors"],
                },
                [
                    f"{len(names)} first-party skill templates seeded into the user's\n"
                    "  config dir on first run: " + ", ".join(names) + "."
                ],
            )
        )
    parts.append(
        block("PART V -- BUNDLED NON-CARGO ARTIFACTS")
        + "Things that ship in the repository but never appear in Cargo.lock, and\n"
        "would therefore be invisible to a lockfile-driven generator. This is the\n"
        "section most likely to be wrong after an upgrade -- check it by hand.\n\n"
        + ("".join(bundled) if bundled else "None found.\n\n")
    )

    # ---------------- curated addenda (always present: fixed part numbering) -- #
    parts.append(
        block("PART VI -- CURATED ATTRIBUTION (hand-maintained)")
        + "Machine inputs cannot tell which palette a TUI theme was derived from, which\n"
        "upstream a ported tool file came from, or which leg of an `MIT OR Apache-2.0`\n"
        "expression this distribution satisfies under. Those calls live in\n"
        "docs/third-party-notices-addenda.md and are spliced in verbatim below; the\n"
        "generator never rewrites them.\n\n"
        + (
            addenda.rstrip() + "\n\n"
            if addenda
            else "docs/third-party-notices-addenda.md does not exist yet, so nothing is\n"
            "spliced in. Until it is written, this generated file is NOT a complete\n"
            "substitute for the hand-curated notices it would replace.\n\n"
        )
    )

    # ---------------- license texts ---------------- #
    text_parts = [
        block("PART VII -- LICENSE TEXTS")
        + f"{len(license_texts)} distinct texts, one per unique set of bytes found in the\n"
        "inputs, ordered by the first license expression that points at them. A\n"
        "duplicate upstream -- the same 200 lines shipped twice -- is listed once and\n"
        "both packages reference its hash.\n\n"
    ]
    for digest, rec in sorted(
        license_texts.items(), key=lambda kv: (min(kv[1]["ids"], key=str.lower), kv[0])
    ):
        ids = sorted(rec["ids"], key=str.lower)
        label = ", ".join(ids[:12]) + (f", … (+{len(ids) - 12} more)" if len(ids) > 12 else "")
        text_parts.append(
            SUBRULE
            + f"\n[{digest[:10]}]\n"
            + SUBRULE
            + f"\ncovers license id(s): {label}\n"
            + f"file name(s): {', '.join(sorted(rec['files']))}\n"
            + f"read from: {rec['sample']}\n\n"
            + indent(rec["body"].rstrip())
            + "\n\n"
        )
    if not license_texts:
        text_parts.append("No license texts were readable from the local cargo cache.\n")
    parts.append("".join(text_parts))

    parts.append(
        block("END OF THIRD-PARTY NOTICES")
        + f"packages: {len(lock)} total / {stats['member']} first-party / "
        + f"{stats['registry']} crates.io / {stats['git']} git or other / "
        + f"{stats['vendored']} vendored in third_party/\n"
        + f"distinct license texts embedded: {len(license_texts)}\n"
        + f"packages with no embeddable license text: {len(missing_text)}\n"
    )

    gaps = {
        "missing_from_cache": missing,
        "unresolved_license": unresolved,
        "stats": stats,
        "license_texts": len(license_texts),
        "packages_without_license_text": missing_text,
    }
    return "".join(parts), gaps


def read_protoc_version(protoc: Path) -> str:
    readme = protoc / "readme.txt"
    if readme.is_file():
        m = re.search(r"libprotoc\s+(\S+)", readme.read_text(encoding="utf-8", errors="replace"))
        if m:
            return m.group(1).strip()
    return "unknown"


def indent(text: str, prefix: str = "  ") -> str:
    return "\n".join(prefix + line if line.strip() else line for line in text.splitlines())


def normalise(path: Path) -> str:
    """UTF-8, LF endings, no trailing blank lines -- so two crates that ship the
    same license text with different line endings hash to the same bucket."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text.replace("\r\n", "\n").rstrip() + "\n"


ATOM_SPLIT_RE = re.compile(r"\s+(?:or|and)\s+|\s+OR\s+|\s+AND\s+|[()]", re.IGNORECASE)
NOTICE_SUFFIX_RE = re.compile(r"\s+WITH\s+\S+", re.IGNORECASE)


def license_atoms(expr: str) -> set[str]:
    """`MIT OR Apache-2.0` -> {MIT, Apache-2.0}.

    Used only for labelling the embedded texts. A notices file that listed the
    full expression for every text ended up repeating `Apache-2.0`'s body under
    several hundred near-identical long expressions; the atoms are what a reader
    actually wants next to a license paragraph.
    """
    out: set[str] = set()
    for part in ATOM_SPLIT_RE.split(expr.strip()):
        a = NOTICE_SUFFIX_RE.sub("", part).strip(" ,;")
        if a:
            out.add(a)
    return out or {expr.strip()}


# --------------------------------------------------------------------------- #
# modes
# --------------------------------------------------------------------------- #


def generate(args: argparse.Namespace) -> tuple[str, dict]:
    lock_path = ROOT / "Cargo.lock"
    lock = load_lock(lock_path)
    members = workspace_members(ROOT)
    index_dirs = cargo_registry_src(Path(args.cache_dir) if args.cache_dir else None)
    addenda_path = ROOT / "docs" / "third-party-notices-addenda.md"
    addenda = None
    if args.addenda == "auto" and addenda_path.is_file():
        addenda = addenda_path.read_text(encoding="utf-8")
    elif args.addenda not in (None, "auto"):
        p = Path(args.addenda)
        if not p.is_absolute():
            p = ROOT / p
        if not p.is_file():
            die(f"--addenda {p} does not exist")
        addenda = p.read_text(encoding="utf-8")
    if not index_dirs and not args.allow_empty_cache:
        die(
            "no unpacked crates.io sources under "
            f"{cargo_home() / 'registry' / 'src'}.\n"
            "  Run `cargo fetch` (offline is fine) so the license metadata is on disk,\n"
            "  or pass --allow-empty-cache to generate a file that says so."
        )
    return build(ROOT, lock, members, index_dirs, addenda)


def report_gaps(gaps: dict, quiet: bool) -> None:
    if quiet:
        return
    s = gaps["stats"]
    print(
        f"inputs: {s['member']} first-party, {s['registry']} crates.io, "
        f"{s['git']} git/other; {gaps['license_texts']} license texts embedded",
        file=sys.stderr,
    )
    for label, items in (
        ("not unpacked in the cargo cache", gaps["missing_from_cache"]),
        ("license could not be resolved", gaps["unresolved_license"]),
        ("no license text shipped in the package", gaps["packages_without_license_text"]),
    ):
        if items:
            print(f"gaps -- {label}: {len(items)}", file=sys.stderr)
            for i in items[:15]:
                print(f"    {i}", file=sys.stderr)
            if len(items) > 15:
                print(f"    ... {len(items) - 15} more", file=sys.stderr)


def write_text(path: Path, text: str) -> None:
    path.write_bytes(text.replace("\r\n", "\n").encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--verify",
        action="store_true",
        help="regenerate and compare against the checked-in file; exit 1 on drift",
    )
    mode.add_argument("--write", metavar="PATH", help="write the generated file to PATH")
    mode.add_argument("--stdout", action="store_true", help="print the generated file")
    ap.add_argument("--target", default="THIRD-PARTY-NOTICES", help="file --verify compares against")
    ap.add_argument(
        "--report-only",
        action="store_true",
        help="with --verify: print the drift but exit 0, so CI can adopt the check "
        "before the checked-in file is replaced by generated output",
    )
    ap.add_argument("--cache-dir", help="override $CARGO_HOME when looking for unpacked sources")
    ap.add_argument("--addenda", default="auto", help="'auto' (docs/...-addenda.md if present) or a path")
    ap.add_argument("--allow-empty-cache", action="store_true", help="generate even with no local cache")
    ap.add_argument("--quiet", action="store_true", help="suppress the gap summary on stderr")
    args = ap.parse_args(argv)

    text, gaps = generate(args)
    report_gaps(gaps, args.quiet)

    if args.stdout:
        sys.stdout.write(text)
        return 0

    if args.write:
        out = Path(args.write)
        if not out.is_absolute():
            out = ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        write_text(out, text)
        print(f"wrote {out} ({len(text.encode('utf-8'))} bytes)", file=sys.stderr)
        return 0

    # --verify
    target = Path(args.target)
    if not target.is_absolute():
        target = ROOT / target
    if not target.is_file():
        die(f"{target} does not exist", 1)
    checked = target.read_bytes().replace(b"\r\n", b"\n").decode("utf-8", "replace")
    produced = text.replace("\r\n", "\n")
    if checked == produced:
        print(f"OK: {target.name} is reproducible from Cargo.lock + cargo cache")
        return 0
    a = checked.splitlines()
    b = produced.splitlines()
    # One pass to size the drift, one truncated pass to show a little of it.
    # `unified_diff` three times over a 100k-line file is minutes of difflib.
    only_a = only_b = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag in ("delete", "replace"):
            only_a += i2 - i1
        if tag in ("insert", "replace"):
            only_b += j2 - j1
    print(
        f"FAIL: {target.name} does not match the generated output\n"
        f"  checked-in : {len(a)} lines / {target.stat().st_size} bytes\n"
        f"  generated  : {len(b)} lines / {len(produced.encode('utf-8'))} bytes\n"
        f"  lines only in checked-in : {only_a}\n"
        f"  lines only in generated  : {only_b}",
        file=sys.stderr,
    )
    print("  first 40 differing lines:", file=sys.stderr)
    shown = 0
    for line in difflib.unified_diff(a, b, "checked-in", "generated", lineterm="", n=1):
        if shown >= 40:
            break
        print("  " + line, file=sys.stderr)
        shown += 1
    if args.report_only:
        print(
            "REPORT ONLY (--report-only): drift recorded, exit status forced to 0. "
            "Drop this flag once the checked-in file is generated.",
            file=sys.stderr,
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
