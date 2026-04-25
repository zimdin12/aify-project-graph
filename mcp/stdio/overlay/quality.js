import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { featuresForFile } from './loader.js';

const TASK_LINK_STRENGTHS = new Set(['strong', 'mixed', 'broad']);
const STRONG_TASK_EVIDENCE = /\b(tag|custom[_ -]?field|component|commit|branch|path|file|files?_hint|symbol|anchor|code|diff):/i;
const BROAD_TASK_EVIDENCE = /\b(title|description|fuzzy|spec|future|roadmap|manual|broad):/i;
const STRONG_TASK_EVIDENCE_PHRASES = /\b(explicit task tags?|custom fields?|commit[- ]message|branch[- ]name|file paths? mentioned|files?_hint|code[- ]anchored)\b/i;
const BROAD_TASK_EVIDENCE_PHRASES = /\b(fuzzy title|fuzzy description|future work|broad mapping|manual mapping|spec work|roadmap)\b/i;

export function loadTasksArtifact(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'tasks.json');
  if (!existsSync(path)) return { tasks: [], source: null, fetched_at: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      source: raw.source || 'unknown',
      fetched_at: raw.fetched_at ?? null,
    };
  } catch {
    return { tasks: [], source: null, fetched_at: null };
  }
}

export function taskFeatureRefs(task) {
  if (Array.isArray(task.features) && task.features.length) return task.features.filter(Boolean);
  if (Array.isArray(task.related_features) && task.related_features.length) return task.related_features.filter(Boolean);
  return [];
}

export function taskLinkStrength(task) {
  if (taskFeatureRefs(task).length === 0) return 'unlinked';

  const declared = typeof task?.link_strength === 'string' ? task.link_strength.trim().toLowerCase() : '';
  if (TASK_LINK_STRENGTHS.has(declared)) return declared;

  const evidence = typeof task?.evidence === 'string' ? task.evidence.trim() : '';
  const filesHint = Array.isArray(task?.files_hint) ? task.files_hint.filter(Boolean) : [];
  const haystack = `${evidence} ${filesHint.join(' ')}`;
  const hasStrong = filesHint.length > 0 || STRONG_TASK_EVIDENCE.test(haystack) || STRONG_TASK_EVIDENCE_PHRASES.test(haystack);
  const hasBroad = BROAD_TASK_EVIDENCE.test(haystack) || BROAD_TASK_EVIDENCE_PHRASES.test(haystack);

  if (hasStrong && hasBroad) return 'mixed';
  if (hasStrong) return 'strong';
  if (hasBroad) return 'broad';
  if (evidence) return 'mixed';
  return 'mixed';
}

export function taskLinkStrengthCounts(tasks = []) {
  const counts = { strong: 0, mixed: 0, broad: 0 };
  for (const task of tasks) {
    const strength = taskLinkStrength(task);
    if (strength === 'strong' || strength === 'mixed' || strength === 'broad') counts[strength] += 1;
  }
  return counts;
}

export function summarizeOverlayQuality(features = [], tasks = []) {
  const featureCount = features.length;
  const featuresWithTests = features.filter((f) => (f.tests ?? []).length > 0).length;
  const featuresWithDocs = features.filter((f) => (f.anchors?.docs ?? []).length > 0).length;
  const featuresWithDependsOn = features.filter((f) => (f.depends_on ?? []).length > 0).length;
  const featuresWithRelatedTo = features.filter((f) => (f.related_to ?? []).length > 0).length;
  const tasksTotal = tasks.length;
  const linkedTasksList = tasks.filter((t) => taskFeatureRefs(t).length > 0);
  const linkedTasks = linkedTasksList.length;
  const taskLinkCounts = taskLinkStrengthCounts(linkedTasksList);
  return {
    featureCount,
    featuresWithTests,
    featuresWithDocs,
    featuresWithDependsOn,
    featuresWithRelatedTo,
    tasksTotal,
    linkedTasks,
    strongTaskLinks: taskLinkCounts.strong,
    mixedTaskLinks: taskLinkCounts.mixed,
    broadTaskLinks: taskLinkCounts.broad,
    unlinkedTasks: Math.max(0, tasksTotal - linkedTasks),
  };
}

// Files that look like scratch / build / cache output rather than real
// source/docs the agent should care about. M4a refinement: lets the
// brief's DIRTY line distinguish "20 files in src/" from "20 files in
// build-linux/scratch/" so noise doesn't drown signal.
const SCRATCH_DIR_PATTERNS = [
  /^build[-_]/, /^build\//, /^dist\//, /^out\//, /^target\//,
  /^node_modules\//, /^__pycache__\//, /^\.next\//, /^\.cache\//,
  /^\.codex/, /^\.claude/, /^backup\//, /^saves\//, /^screenshots\//,
  /^test_screenshots\//, /^video\//, /^generated\//, /\.tmp\./,
];

function isScratchPath(file) {
  if (typeof file !== 'string') return false;
  return SCRATCH_DIR_PATTERNS.some((re) => re.test(file));
}

export function summarizeDirtySeams(features = [], dirtyFiles = []) {
  const uniqueDirtyFiles = [...new Set((dirtyFiles || []).filter(Boolean))];
  const byFeature = new Map();
  const orphanFiles = [];
  const scratchFiles = [];

  for (const file of uniqueDirtyFiles) {
    if (isScratchPath(file)) {
      scratchFiles.push(file);
      continue;
    }
    const featureIds = featuresForFile(features, file);
    if (featureIds.length === 0) {
      orphanFiles.push(file);
      continue;
    }
    for (const id of featureIds) {
      if (!byFeature.has(id)) byFeature.set(id, new Set());
      byFeature.get(id).add(file);
    }
  }

  const featureLookup = new Map(features.map((f) => [f.id, f]));
  const featureSeams = [...byFeature.entries()]
    .map(([id, files]) => ({
      id,
      label: featureLookup.get(id)?.label || id,
      file_count: files.size,
      files: [...files].sort(),
    }))
    .sort((a, b) => {
      if (b.file_count !== a.file_count) return b.file_count - a.file_count;
      return a.id.localeCompare(b.id);
    });

  return {
    totalDirtyFiles: uniqueDirtyFiles.length,
    mappedDirtyFiles: featureSeams.reduce((sum, feature) => sum + feature.file_count, 0),
    orphanDirtyFiles: orphanFiles.length,
    scratchDirtyFiles: scratchFiles.length,
    features: featureSeams,
    orphanFilesSample: orphanFiles.slice(0, 5),
  };
}
