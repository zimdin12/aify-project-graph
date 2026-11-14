// Read-only structural checks. This does not establish review independence or live-service coverage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function readAnchors(map) {
  const anchors = new Map();
  const add = (path, feature, kind) => {
    const rows = anchors.get(path) ?? [];
    rows.push({ feature, kind });
    anchors.set(path, rows);
  };
  for (const feature of map.features) {
    for (const symbol of Object.keys(feature.confirmed?.symbols ?? {})) {
      const separator = symbol.indexOf('#');
      assert.ok(separator > 0, 'symbol anchors must identify their file');
      add(symbol.slice(0, separator), feature.id, 'symbol-file');
    }
    for (const path of feature.anchors?.files ?? []) add(path, feature.id, 'file');
    for (const path of feature.anchors?.docs ?? []) add(path, feature.id, 'document');
  }
  return anchors;
}

function changedAnchors(commit, anchors) {
  return git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n')
    .filter((path) => anchors.has(path)).map((path) => ({ path, anchors: anchors.get(path) }));
}

function countFeatures(tasks) {
  const counts = {};
  for (const task of tasks) {
    for (const feature of task.featureIds) counts[feature] = (counts[feature] ?? 0) + 1;
  }
  return counts;
}

function verifyTask(task, manifest, anchors) {
  assert.match(task.commit, /^[a-f0-9]{40}$/u);
  assert.match(task.base, /^[a-f0-9]{40}$/u);
  assert.equal(git('show', '-s', '--format=%P', task.commit), task.base, 'exact single parent required');
  git('merge-base', '--is-ancestor', manifest.map.created, task.base);
  git('merge-base', '--is-ancestor', task.commit, manifest.populationHead);
  const changes = changedAnchors(task.commit, anchors);
  const features = [...new Set(changes.flatMap((row) => row.anchors.map((a) => a.feature)))].sort();
  assert.deepEqual(task.featureIds, features, `${task.id} feature membership must be derived`);
  const fileAnchor = changes.find((row) => row.path === task.fileAnchor
    && row.anchors.some((anchor) => anchor.kind === 'file'));
  assert.ok(fileAnchor, `${task.id} must change an explicit imported file anchor`);
  assert.equal(git('cat-file', '-t', `${task.base}:${task.fileAnchor}`), 'blob');
  assert.ok(task.authoringEvidence?.trim(), 'authorship evidence required');
  assert.ok(task.reviewRecordsRead?.length > 0 && task.reviewFinding?.trim(), 'review evidence required');
  assert.ok(Object.hasOwn(manifest.audit.verdictDefinitions, task.verdict), 'defined verdict required');
  assert.equal(manifest.excluded.some((row) => row.commit === task.commit), false, 'review conflict selected');
  return { id: task.id, featureIds: features, verdict: task.verdict };
}

function verifySelection() {
  const manifest = JSON.parse(readFileSync(process.argv[2] ?? new URL('./selection-2026-11-14.v1.json', import.meta.url), 'utf8'));
  assert.equal(manifest.protocol.taskCount, 8, 'protocol requires eight tasks');
  assert.equal(manifest.protocol.maximumPerFeature, 3, 'protocol feature cap is three');
  assert.equal(manifest.tasks.length, manifest.protocol.taskCount);
  assert.equal(new Set(manifest.tasks.map((task) => task.commit)).size, manifest.tasks.length);
  assert.equal(new Set(manifest.tasks.map((task) => task.id)).size, manifest.tasks.length);
  for (const revision of [manifest.map.created, manifest.map.imported]) {
    assert.equal(git('rev-parse', `${revision}:${manifest.map.path}`), manifest.map.blob, 'same pre-existing map');
  }
  const map = JSON.parse(git('show', `${manifest.map.imported}:${manifest.map.path}`));
  const anchors = readAnchors(map);
  const tasks = manifest.tasks.map((task) => verifyTask(task, manifest, anchors));
  const featureCounts = countFeatures(tasks);
  const maximum = Math.max(...Object.values(featureCounts));
  assert.ok(maximum <= manifest.protocol.maximumPerFeature, 'selected feature cap exceeded');
  assert.ok(changedAnchors('d8c946ad', anchors).length > 0, 'known anchored positive must be found');
  assert.equal(changedAnchors(manifest.populationHead, anchors).length, 0, 'evidence-only negative must be absent');
  assert.ok(manifest.tasks.some((task) => task.commit.startsWith('d8c946ad')), 'positive belongs to selected eight');
  for (const prefix of ['72996bce', '27c5c422']) {
    assert.ok(manifest.excluded.some((row) => row.commit.startsWith(prefix) && row.verdict === 'EXCLUDE'));
  }
  const clearCount = tasks.filter((task) => task.verdict === 'CLEAR').length;
  if (clearCount !== tasks.length) assert.equal(manifest.audit.eligibilityCertified, false, 'unknown cannot certify eligibility');
  return { selectedCount: tasks.length, clearCount, featureCounts, maximum,
    eligibilityCertified: manifest.audit.eligibilityCertified,
    controls: { knownAnchoredTask: 'FOUND', evidenceOnlyTask: 'ABSENT', knownConflicts: 'EXCLUDED' } };
}

console.log(JSON.stringify(verifySelection(), null, 2));
console.log('SELECTION_STRUCTURE_PASS');
