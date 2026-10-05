#!/usr/bin/env bash
# T1's arm roots: the 310df61f tree minus the CHANGELOG entry that described the fix (lines 27-35, found in the
# rehearsal). Fails unless both arms end at 5ca73d5..., the tree every earlier T1 run started from.
set -euo pipefail
HERE=$(dirname "$0")
bash "$HERE/build-roots.sh" 310df61f
for a in A B; do
  d=/c/Docker/aify-trial-arms/$a/aify-project-graph
  test "$(sed -n 27p "$d/CHANGELOG.md")" = "### Fixed"
  test "$(sed -n 36p "$d/CHANGELOG.md" | cut -c1-11)" = "## [0.9.0] "
  sed -i '27,35d' "$d/CHANGELOG.md"
  git -C "$d" add CHANGELOG.md
  git -C "$d" -c user.name=rehearsal -c user.email=rehearsal@localhost commit -q --amend -m base
  GOT=$(git -C "$d" rev-parse HEAD^{tree})
  echo "$a: T1 tree $GOT"
  test "$GOT" = "5ca73d59839d916adc9c4e817f45d1379d2dd5a2"
done
