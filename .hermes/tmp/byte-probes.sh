#!/bin/sh
set -eu
ROOT=$(mktemp -d /tmp/apg-a137782-wsl-XXXXXX)
cd /mnt/c/Docker/aify-project-graph
git archive a1377828c37057369114034a57816d7eec133eee | tar -x -C "$ROOT"
cd "$ROOT"
git init -q
git config user.email probe@example.invalid
git config user.name probe
git add -A
git commit -qm baseline
ln -s /mnt/c/Docker/aify-project-graph/node_modules node_modules
run_probe() {
  name="$1"
  set +e
  out=$(npx vitest run tests/unit/no-raw-nul-bytes.test.js --reporter=dot 2>&1)
  rc=$?
  set -e
  printf '\n=== %s rc=%s ===\n' "$name" "$rc"
  printf '%s\n' "$out" | grep -E 'Test Files|Tests |AssertionError|expected|every tracked file|0x[0-9a-f]{2}x|ENOENT' | tail -12 || true
  git reset -q --hard HEAD
  git clean -q -fd -e node_modules
}
printf 'export default 1;\n' > ' leading.js'
git add -- ' leading.js'
run_probe leading_space_path
printf 'export default 1;\n' > 'trailing.js '
git add -- 'trailing.js '
run_probe trailing_space_path
printf 'export default 1;\n' > 'line
break.js'
git add -- 'line
break.js'
run_probe newline_path
ln -s missing-target unreadable.js
git add -- unreadable.js
run_probe read_failure_broken_symlink
printf 'WSL_ARCHIVE=%s\n' "$ROOT"
