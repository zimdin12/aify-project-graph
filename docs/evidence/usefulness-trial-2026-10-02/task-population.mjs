// The usefulness trial's task population: which commits are eligible tasks today.
//
//   node docs/evidence/usefulness-trial-2026-10-02/task-population.mjs [<end ref>]   (default HEAD)
//
// Protocol: aify-dashboard docs/PREREGISTRATION-v0.8.md, amended at ee8d3c5 ("When the trial runs: not yet"). A task is
// a non-merge commit after the feature map existed (59cbae3a) that changes a file the import anchors: a confirmed
// symbol's file, or an anchored file or document of the map the import read (550643ef). The trial starts at 8 or more
// eligible tasks with no feature carrying more than 3. Re-checked from 2026-10-16, then every two weeks.
//
// ⚠ The grader flag is a POINTER, not the exclusion. The rule excludes any commit the grader wrote or reviewed; a commit
// whose message names them is flagged here and must be read, and one that does not name them is not thereby cleared.
//
// Controls printed every run: the range's commit count (the population the filter worked on), and d8c946ad, which
// changes the anchored packet-live.js and must be found whenever it is inside the range.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAP_CREATED = '59cbae3a';
const MAP_IMPORTED = '550643ef';
const CONTROL = 'd8c946ad';
const MIN_TASKS = 8;
const MAX_PER_FEATURE = 3;

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const end = process.argv[2] ?? 'HEAD';
const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const map = JSON.parse(git(['show', `${MAP_IMPORTED}:.aify-graph/functionality.json`]));
const featuresOf = new Map();
const anchor = (path, id) => featuresOf.set(path, new Set([...(featuresOf.get(path) ?? []), id]));
for (const f of map.features) {
  for (const key of Object.keys(f.confirmed?.symbols ?? {})) anchor(key.slice(0, key.indexOf('#')), f.id);
  for (const path of [...(f.anchors?.files ?? []), ...(f.anchors?.docs ?? [])]) anchor(path, f.id);
}

const range = `${MAP_CREATED}..${end}`;
const total = Number(git(['rev-list', '--count', '--no-merges', range]).trim());
const rows = [];
for (const sha of git(['rev-list', '--no-merges', range]).split('\n').filter(Boolean)) {
  const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]).split('\n').filter(Boolean);
  const anchored = files.filter((p) => featuresOf.has(p));
  if (anchored.length === 0) continue;
  const message = git(['log', '-1', '--format=%ad %s%n%b', '--date=short', sha]);
  rows.push({
    sha: sha.slice(0, 8),
    line: message.split('\n')[0].slice(0, 110),
    features: [...new Set(anchored.flatMap((p) => [...featuresOf.get(p)]))].sort(),
    namesGrader: /senior-dev|senior dev/iu.test(message),
  });
}

console.log(`range ${range} (${git(['rev-parse', '--short=8', end]).trim()}): ${total} non-merge commits, ${featuresOf.size} anchored files`);
const controlInRange = git(['rev-list', range]).includes(git(['rev-parse', CONTROL]).trim());
console.log(`control ${CONTROL}: ${controlInRange ? (rows.some((r) => r.sha === CONTROL) ? 'in range, FOUND' : 'in range, MISSED - the filter is broken') : 'not in range'}`);
for (const r of rows) console.log(`  ${r.sha} ${r.namesGrader ? 'NAMES-GRADER' : '            '} [${r.features.join(',')}] ${r.line}`);
const perFeature = {};
for (const r of rows.filter((x) => !x.namesGrader)) for (const f of r.features) perFeature[f] = (perFeature[f] ?? 0) + 1;
console.log(`candidates ${rows.length}; not naming the grader ${rows.filter((r) => !r.namesGrader).length}; per feature ${JSON.stringify(perFeature)}`);
console.log(`gate: at least ${MIN_TASKS} eligible tasks, no feature carrying more than ${MAX_PER_FEATURE}, after the grader exclusion is READ, not inferred from the flag above`);
