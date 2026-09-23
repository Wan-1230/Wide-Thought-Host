#!/bin/sh
# upstream-delta.sh -- what this fork changed relative to the upstream snapshot
# it carries, as computed facts rather than impressions.
#
# Written for `sh`, not bash: it has to run identically under Git Bash on
# Windows and on the Linux CI runners, so no arrays, no `[[ ]]`, no process
# substitution, and no GNU-only flags. Zero third-party dependencies, matching
# the rule the other governance scripts in scripts/ follow.
#
#   scripts/upstream-delta.sh                    full report
#   scripts/upstream-delta.sh --summary          counts only, one line per fact
#   scripts/upstream-delta.sh --section naming   one section (see --list)
#   scripts/upstream-delta.sh --list             section names
#
# Exit status: 0 on success, 1 if the repo, the import commit, or a requested
# section is missing. This script reports; it does not decide -- the criteria for
# acting on these numbers are in docs/adr/upstream-sync-policy.md.

set -u

cd "$(dirname "$0")/.." || exit 1

SECTION=all
MODE=report
while [ $# -gt 0 ]; do
	case "$1" in
	--section) SECTION="${2:-all}"; shift 2 ;;
	--summary) MODE=summary; shift ;;
	--list)
		echo "upstream sync-refs xai-prefix naming vendored drift churn"
		exit 0
		;;
	-h | --help)
		sed -n '2,17p' "$0"
		exit 0
		;;
	*)
		echo "upstream-delta: unknown argument: $1 (try --list)" >&2
		exit 1
		;;
	esac
done

case "$SECTION" in
all | sync-refs | xai-prefix | naming | vendored | drift | churn) ;;
*)
	echo "upstream-delta: no such section: $SECTION (try --list)" >&2
	exit 1
	;;
esac

RUN() { [ "$SECTION" = all ] || [ "$SECTION" = "$1" ]; }

TMP=$(mktemp -d 2>/dev/null || echo .upstream-delta.$$)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

RULE="--------------------------------------------------------------------------------"

# A section header in report mode; in summary mode the section prints one line.
title() {
	[ "$MODE" = report ] || return 0
	echo
	echo "$RULE"
	echo "$1"
	echo "$RULE"
}

count_lines() {
	[ -s "$1" ] || { echo 0; return; }
	grep -c . "$1"
}

# --- shared inputs -------------------------------------------------------------

# Workspace member dirs, read straight out of the root manifest. Not
# `cargo metadata`: that needs a populated registry cache, and this has to work
# on a bare clone in CI.
member_dirs() {
	awk '
		/^members[[:space:]]*=[[:space:]]*\[/ {
			inlist = 1
			sub(/^[^[]*\[/, "")
		}
		inlist {
			buf = $0
			if (buf ~ /\]/) sub(/\].*/, "", buf)
			n = split(buf, parts, ",")
			for (i = 1; i <= n; i++) {
				s = parts[i]
				gsub(/[[:space:]]/, "", s)
				gsub(/"/, "", s)
				if (s != "" && s !~ /^#/) print s
			}
			if ($0 ~ /\]/) inlist = 0
		}
	' Cargo.toml
}

# The `[package] name`, not the `[lib] name` two lines below it.
pkg_name() {
	awk '
		BEGIN { inpkg = 0 }
		/^[[:space:]]*\[/ { inpkg = ($0 ~ /^[[:space:]]*\[package\][[:space:]]*$/) }
		inpkg && /^[[:space:]]*name[[:space:]]*=/ {
			line = $0
			sub(/^[^=]*=[[:space:]]*"/, "", line)
			sub(/".*/, "", line)
			print line
			exit
		}
	' "$1" 2>/dev/null
}

basename_of() { printf '%s' "$1" | sed 's#.*/##'; }

member_dirs >"$TMP/members"
: >"$TMP/xai"
: >"$TMP/renamed"
TOTAL=0
while read -r m; do
	[ -n "$m" ] || continue
	[ -f "$m/Cargo.toml" ] || continue
	TOTAL=$((TOTAL + 1))
	n=$(pkg_name "$m/Cargo.toml")
	d=$(basename_of "$m")
	[ -n "$n" ] || continue
	case "$n" in xai-*) printf '%s\t%s\n' "$n" "$m" >>"$TMP/xai" ;; esac
	if [ "$n" != "$d" ]; then
		printf '%s\t%s\t%s\n' "$d" "$n" "$m" >>"$TMP/renamed"
	fi
done <"$TMP/members"

IMPORT=$(git rev-list --max-parents=0 HEAD 2>/dev/null | tail -1)

# --- 0. what "upstream" resolves to in this clone -----------------------------

sec_sync_refs() {
	title "0. what 'upstream' means in this clone"
	local_upstream=$(git remote -v 2>/dev/null | awk '{print $1}' | sort -u | grep -x -i upstream || true)
	if [ -n "$local_upstream" ]; then
		echo "remote 'upstream' : configured; a real diff is available:"
		echo "                  git diff --stat upstream/main...HEAD"
	else
		echo "remote 'upstream' : NOT CONFIGURED -- only 'origin'."
		echo "                  Everything below compares against the import commit,"
		echo "                  not against live upstream. To fix that:"
		echo "                    git remote add upstream https://github.com/xai-org/grok-build.git"
		echo "                    git fetch --tags upstream"
	fi

	sync_ref=$(git branch -a --format='%(refname:short)' 2>/dev/null | grep 'sync/upstream-' | sort | tail -1)
	if [ -n "$sync_ref" ]; then
		echo "last sync ref     : $sync_ref"
		git log -1 --format='last sync dated   : %ad  (%h)' --date=short "$sync_ref"
		git log -1 --format='%b' "$sync_ref" |
			awk '/^(Upstream|Version|SOURCE_REV|patch_tip|product_tip):/ {print "  recorded        : " $0}'
	else
		echo "last sync ref     : none (no sync/upstream-* branch in this clone)"
	fi

	if [ -n "$IMPORT" ]; then
		echo "import commit     : $(git log -1 --format='%h %ad %s' --date=short "$IMPORT")"
		echo "files at import   : $(git ls-tree -r --name-only "$IMPORT" | grep -c .)"
		echo "files tracked now : $(git ls-files | grep -c .)"
	else
		echo "import commit     : NOT FOUND -- drift and churn sections need history"
	fi

	on_head=$(git log --format='%(trailers:key=Gork-Patch-Id,valueonly)' HEAD 2>/dev/null | grep -c . || true)
	on_all=$(git log --all --format='%(trailers:key=Gork-Patch-Id,valueonly)' 2>/dev/null | grep -c . || true)
	echo "patch-queue ids   : $on_head commit(s) on HEAD carry Gork-Patch-Id,"
	echo "                    $on_all across all refs."
	if [ "$on_head" = 0 ] && [ "$on_all" != 0 ]; then
		echo "                    The convention exists and is applied on the sync"
		echo "                    branch only -- main has not used it since the import."
		printf '                    '
		git log --all --format='%(trailers:key=Gork-Patch-Id,valueonly)' |
			tr -d ' \r' | grep . | sort -u | paste -sd ' ' -
	fi

	[ "$MODE" = summary ] &&
		echo "sync-refs: upstream_remote=${local_upstream:-none} import=${IMPORT:-none} patch_ids_head=$on_head patch_ids_all=$on_all"
}

# --- 1. packages that kept the xai- prefix ------------------------------------

sec_xai_prefix() {
	title "1. members still shipping an xai- package name"
	n=$(count_lines "$TMP/xai")
	if [ "$MODE" = summary ]; then
		echo "xai-prefix: $n of $TOTAL members -- $(cut -f1 "$TMP/xai" | paste -sd ' ' -)"
		return 0
	fi
	echo "count: $n of $TOTAL workspace members."
	echo "Kept on purpose (docs/adr/naming-policy.md): where a package name still"
	echo "matches upstream, a future merge touches zero manifest lines."
	[ -s "$TMP/xai" ] || { echo "  none -- everything is renamed"; return 0; }
	awk -F'\t' 'BEGIN {printf "  %-34s %s\n", "PACKAGE", "DIRECTORY"} {printf "  %-34s %s\n", $1, $2}' "$TMP/xai"
}

# --- 2. directory name != package name ---------------------------------------

sec_naming() {
	title "2. members whose directory name differs from the package name"
	n=$(count_lines "$TMP/renamed")
	if [ "$MODE" = summary ]; then
		echo "naming: $n of $TOTAL members have dir != package"
		return 0
	fi
	echo "count: $n of $TOTAL members."
	echo "cargo only knows the middle column -- that is what \`cargo -p\` takes. The"
	echo "left column is what you type into a path. Both are frozen; the mismatch is"
	echo "the reason a new reader mistakes this for a botched migration."
	[ -s "$TMP/renamed" ] || { echo "  none"; return 0; }
	awk -F'\t' '
	BEGIN { printf "  %-30s %-28s %s\n", "DIRECTORY", "PACKAGE", "PATH" }
	{ printf "  %-30s %-28s %s\n", $1, $2, $3 }' "$TMP/renamed"
}

# --- 3. vendored and bundled inputs ------------------------------------------

sec_vendored() {
	title "3. third_party/ inventory"
	tp_n=0
	if [ -d third_party ]; then
		for d in third_party/*/; do
			[ -f "${d}Cargo.toml" ] || continue
			tp_n=$((tp_n + 1))
			name=$(pkg_name "${d}Cargo.toml")
			up=$(awk '/^#[[:space:]]*Upstream:/{sub(/^#[[:space:]]*Upstream:[[:space:]]*/, ""); print; exit}' "${d}Cargo.toml")
			rev=$(awk '{ if (match($0, /rev[[:space:]]+([0-9a-f]{7,40})/)) { s = substr($0, RSTART, RLENGTH); sub(/rev[[:space:]]+/, "", s); print s; exit } }' "${d}Cargo.toml")
			lic=$(ls "${d}" 2>/dev/null | grep -iE '^(licen[cs]e|copying|copyright)' | paste -sd ',' -)
			rs=$(find "${d}src" -name '*.rs' 2>/dev/null | xargs wc -l 2>/dev/null | awk 'END {print $1+0}')
			vn=$(grep -c 'VENDORING NOTES' "${d}Cargo.toml" || true)
			[ "$MODE" = report ] || continue
			printf '  %-18s pkg=%-18s rs=%-8s vendoring-notes=%-5s license=%s\n' \
				"$(basename_of "$d")" "${name:-?}" "${rs:-0}" "$vn" "${lic:-NONE}"
			[ -n "$up" ] && printf '  %18s upstream: %s\n' '' "$up"
			[ -n "$rev" ] && printf '  %18s pinned: %s\n' '' "$rev"
		done
	fi

	# Bundled inputs Cargo.lock never mentions. Only bin/ holds third-party
	# binaries; bundled-skills/ and editors/ are first-party, so a missing
	# license text there is correct rather than a gap.
	title "3b. bundled inputs that never appear in Cargo.lock"
	bin_n=0
	bin_gaps=""
	for p in "bin third-party" "bundled-skills first-party" "editors first-party"; do
		set -- $p
		dir=$1
		kind=$2
		[ -d "$dir" ] || continue
		bin_n=$((bin_n + 1))
		files=$(find "$dir" -type f 2>/dev/null | grep -c . || true)
		lic=$(find "$dir" -maxdepth 3 \( -iname 'licen[cs]e*' -o -iname 'copying*' \) -type f 2>/dev/null | head -3 | paste -sd ',' -)
		if [ "$kind" = third-party ] && [ -z "$lic" ]; then
			bin_gaps="$bin_gaps $dir"
		fi
		[ "$MODE" = report ] || continue
		printf '  %-22s %-14s files=%-7s license-file=%s\n' "$dir" "($kind)" "$files" "${lic:-NONE}"
	done

	if [ "$MODE" = summary ]; then
		echo "vendored: third_party_crates=$tp_n bundled_dirs=$bin_n third_party_without_license=${bin_gaps:-none}"
		return 0
	fi
	echo "totals: $tp_n vendored crate(s) under third_party/, $bin_n bundled input tree(s)."
	if [ -n "$bin_gaps" ]; then
		echo "COMPLIANCE GAP: third-party tree(s) shipping no license text:$bin_gaps"
		echo "  bin/protoc-win64 has only a readme.txt naming Google as the copyright"
		echo "  holder; the BSD-3-Clause text is not in the repository."
		echo "  scripts/gen_third_party_notices.py reports the same gap."
	fi
}

# --- 4. added / removed / modified against the import ------------------------

sec_drift() {
	title "4. what changed since the import commit"
	if [ -z "$IMPORT" ]; then
		echo "  no import commit found in this history -- cannot compute a delta"
		return 0
	fi
	git ls-tree -r --name-only "$IMPORT" | sort >"$TMP/at_import"
	git ls-files | sort >"$TMP/at_head"
	comm -13 "$TMP/at_import" "$TMP/at_head" >"$TMP/added"
	comm -23 "$TMP/at_import" "$TMP/at_head" >"$TMP/removed"
	comm -12 "$TMP/at_import" "$TMP/at_head" >"$TMP/shared"
	added=$(count_lines "$TMP/added")
	removed=$(count_lines "$TMP/removed")
	shared=$(count_lines "$TMP/shared")
	git diff --name-only "$IMPORT" HEAD >"$TMP/changed" 2>/dev/null
	changed=$(count_lines "$TMP/changed")

	if [ "$MODE" = summary ]; then
		echo "drift: added=$added removed=$removed shared=$shared files_changed_since_import=$changed"
		return 0
	fi
	echo "import commit: $(git log -1 --format='%h %ad' --date=short "$IMPORT")"
	echo "  files added since import        : $added"
	echo "  files removed since import      : $removed"
	echo "  files present in both           : $shared"
	echo "  files whose content differs     : $changed  (includes the added ones)"
	echo
	echo "added files, by area (top 15):"
	cut -d/ -f1-3 "$TMP/added" | awk -F'/' '{ if (NF>2) print $0; else if (NF==2) print $0 "/"; else print $0 }' |
		sort | uniq -c | sort -rn | head -15 | sed 's/^/  /'
	echo
	echo "removed files, by area (top 10):"
	cut -d/ -f1-3 "$TMP/removed" | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /'
	echo
	echo "areas with no counterpart at import (pure fork surface):"
	for d in crates/desktop docs bundled-skills scripts editors; do
		at=$(git ls-tree -r --name-only "$IMPORT" -- "$d" | grep -c . || true)
		now=$(git ls-files -- "$d" | grep -c . || true)
		if [ "$at" = 0 ]; then
			echo "  $d/  0 files at import, $now now -- fork-only"
		else
			echo "  $d/  $at at import, $now now"
		fi
	done
}

# --- 5. churn, which predicts merge pain -------------------------------------

sec_churn() {
	title "5. commit churn since the import, by area (highest = hardest to re-merge)"
	[ -n "$IMPORT" ] || { echo "  unavailable without history"; return 0; }
	git log --no-renames --name-only --format= "$IMPORT..HEAD" 2>/dev/null |
		grep . | awk -F'/' '{ if (NF>2) print $1 "/" $2 "/" $3; else if (NF==2) print $1 "/" $2; else print $1 }' |
		sort | uniq -c | sort -rn >"$TMP/churn"
	if [ "$MODE" = summary ]; then
		echo "churn: areas_touched=$(grep -c . "$TMP/churn") top=$(head -3 "$TMP/churn" | awk '{printf "%s ", $2}')"
		return 0
	fi
	head -20 "$TMP/churn" | sed 's/^/  /'
	echo
	echo "  Read this as: the top rows are where an upstream change will conflict."
	echo "  crates/desktop/ and docs/ at the top is fine -- upstream has neither."
	echo "  A crates/codegen/ row near the top means a merge there will not be clean."
}

# --- run -----------------------------------------------------------------------

if [ "$MODE" = report ]; then
	echo "upstream-delta -- $TOTAL workspace members, $(git rev-parse --short HEAD) $(git log -1 --format='%ad' --date=short)"
fi
RUN sync-refs && sec_sync_refs
RUN xai-prefix && sec_xai_prefix
RUN naming && sec_naming
RUN vendored && sec_vendored
RUN drift && sec_drift
RUN churn && sec_churn

[ "$MODE" = report ] && echo
exit 0
