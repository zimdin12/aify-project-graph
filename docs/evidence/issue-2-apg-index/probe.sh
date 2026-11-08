#!/bin/sh
# #2 probe: the real `apg index` CLI on a scratch clone of a real repository, from a subdirectory, plus a non-git
# directory. Writes only inside a temp directory it removes.
# Usage: sh docs/evidence/issue-2-apg-index/probe.sh <source-repo>
APG="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$(mktemp -d)"
git clone -q --no-hardlinks "$1" "$T/clone"
cp "$T/clone/.gitignore" "$T/gitignore.before" 2>/dev/null
SUB="$(cd "$T/clone" && git ls-files | grep / | head -1 | xargs dirname)"
echo "already ignored by the clone's own rules: $(git -C "$T/clone" check-ignore -q .aify-graph/ && echo yes || echo no)"
echo "clone HEAD $(git -C "$T/clone" rev-parse --short HEAD), running from subdirectory '$SUB'"
node "$APG/bin/apg.js" index "$T/clone/$SUB"; echo "apg index exit=$?"
echo "graph.sqlite at top level: $(test -f "$T/clone/.aify-graph/graph.sqlite" && echo yes || echo no)"
echo "nested .aify-graph under $SUB: $(test -e "$T/clone/$SUB/.aify-graph" && echo yes || echo no)"
echo ".gitignore byte-identical: $(cmp -s "$T/clone/.gitignore" "$T/gitignore.before" && echo yes || echo no)"
echo "git status mentions .aify-graph: $(git -C "$T/clone" status --porcelain | grep -c aify-graph)"
mkdir "$T/plain"
node "$APG/bin/apg.js" index "$T/plain"; echo "non-git exit=$?"
echo "non-git dir entries after: $(ls -A "$T/plain" | wc -l)"
rm -rf "$T"
