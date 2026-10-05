#!/usr/bin/env bash
# Rebuild both arm roots at one base commit: the base's exact tracked tree, a fresh one-commit git, node_modules kept.
# Usage: build-roots.sh <base-commit>. Fails unless each arm's tree hash equals the base commit's.
set -euo pipefail
BASE="$1"
SRC=/c/Docker/aify-project-graph
WANT=$(git -C "$SRC" rev-parse "$BASE^{tree}")
for a in A B; do
  d=/c/Docker/aify-trial-arms/$a/aify-project-graph
  # Everything except node_modules goes, including .git, so no history from the previous base survives.
  find "$d" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  git -C "$SRC" archive "$BASE" | tar -x -C "$d"
  git -C "$d" init -q -b main
  git -C "$d" add -A
  # Files tracked in the source that the base's own .gitignore would hide from `add -A`.
  git -C "$SRC" ls-tree -r --name-only "$BASE" | sort > /tmp/src-$a.txt
  git -C "$d" ls-files | sort > /tmp/arm-$a.txt
  comm -23 /tmp/src-$a.txt /tmp/arm-$a.txt | (cd "$d" && tr '\n' '\0' | xargs -0 -r git add -f --)
  git -C "$d" -c user.name=rehearsal -c user.email=rehearsal@localhost commit -q -m base
  GOT=$(git -C "$d" rev-parse HEAD^{tree})
  echo "$a: tree $GOT (want $WANT) node_modules=$(test -d "$d/node_modules" && echo kept || echo MISSING)"
  test "$GOT" = "$WANT"
done
