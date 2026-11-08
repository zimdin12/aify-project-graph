// #23 probe: the real instruments resolve the live dashboard's whole-file Svelte anchor. Read-only on the target.
// Usage: node docs/evidence/issue-23-content-watch/probe.mjs <dashboard-repo>
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveAnchor } from '../../../scripts/lib/anchor-resolver.mjs';
import { makeInstruments } from '../../../scripts/lib/provider-runtime.mjs';

const repo = process.argv[2];
const path = 'ui/src/lib/StateCard.svelte';
const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const item = (stamp, kind = 'file', p = path) => ({ watchId: 'w', anchor: { path: p, name: 'StateCard', kind }, stamp });
const run = (root, it, at) => resolveAnchor({ repoRoot: root, item: it, deps: makeInstruments(root, { at }) });
const show = (label, out) => console.log(label.padEnd(34), out.kind, out.row.status ?? out.row.reasonCode,
  out.row.stamp ? `${out.row.stamp.stampVersion} ${out.row.stamp.hash.slice(0, 12)}` : '');

console.log(`dashboard HEAD ${head}`);
const first = run(repo, item(null), head);
show('commit, no baseline', first);
const stored = { ...first.row.stamp, commit: head };
show('working tree, same baseline', run(repo, item(stored)));
show('commit, same baseline', run(repo, item(stored), head));

const scratch = mkdtempSync(join(tmpdir(), 'apg-23-'));
try {
  mkdirSync(join(scratch, 'ui/src/lib'), { recursive: true });
  const text = readFileSync(join(repo, path), 'utf8');
  writeFileSync(join(scratch, path), text.replaceAll('\n', '\r\n'));
  show('scratch copy as CRLF', run(scratch, item(stored)));
  writeFileSync(join(scratch, path), `${text}<!-- edited -->\n`);
  show('scratch copy, one line added', run(scratch, item(stored)));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
show('symbol anchor, same file', run(repo, item(null, 'symbol'), head));
show('control: README.md as file', run(repo, item(null, 'file', 'README.md'), head));
