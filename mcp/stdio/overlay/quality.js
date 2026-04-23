import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { featuresForFile } from './loader.js';

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

export function summarizeOverlayQuality(features = [], tasks = []) {
  const featureCount = features.length;
  const featuresWithTests = features.filter((f) => (f.tests ?? []).length > 0).length;
  const featuresWithDocs = features.filter((f) => (f.anchors?.docs ?? []).length > 0).length;
  const featuresWithDependsOn = features.filter((f) => (f.depends_on ?? []).length > 0).length;
  const featuresWithRelatedTo = features.filter((f) => (f.related_to ?? []).length > 0).length;
  const tasksTotal = tasks.length;
  const linkedTasks = tasks.filter((t) => taskFeatureRefs(t).length > 0).length;
  return {
    featureCount,
    featuresWithTests,
    featuresWithDocs,
    featuresWithDependsOn,
    featuresWithRelatedTo,
    tasksTotal,
    linkedTasks,
    unlinkedTasks: Math.max(0, tasksTotal - linkedTasks),
  };
}

export function summarizeDirtySeams(features = [], dirtyFiles = []) {
  const uniqueDirtyFiles = [...new Set((dirtyFiles || []).filter(Boolean))];
  const byFeature = new Map();
  const orphanFiles = [];

  for (const file of uniqueDirtyFiles) {
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
    features: featureSeams,
    orphanFilesSample: orphanFiles.slice(0, 5),
  };
}
