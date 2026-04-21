// graph_consequences — the flagship traversal verb.
//
// Answers "what breaks if I touch X?" by walking across every layer the
// graph stores: code → feature → contract → task → test → recent activity.
// Per echoes PM 2026-04-21: "none of the 8 test agents asked for this
// because the verb doesn't exist; they all reached for find/whereis
// instead. graph_consequences is what a planning or debugging agent
// actually needs."
//
// Input: symbol name OR file path.
// Output: ranked list — contracts potentially affected, features touching
// this symbol, open tasks on those features, adjacent tests, last touched.
//
// Synthesis-only. No new data. Pulls from existing code graph + overlays
// + git log.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { loadFunctionality, hasOverlay } from '../../overlay/loader.js';

export async function graphConsequences({ repoRoot, target, symbol }) {
  const input = target ?? symbol;
  if (!input) return 'ERROR: target (symbol or file path) is required';

  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // 1. Resolve input to concrete code nodes (symbol match OR file match)
    const symbolNodes = db.all(
      `SELECT id, label, type, file_path, start_line FROM nodes
       WHERE label = $t AND type IN ('Function','Method','Class','Interface','Type')
       LIMIT 10`, { t: input });
    const fileNodes = db.all(
      `SELECT id, label, type, file_path FROM nodes
       WHERE type IN ('File','Directory') AND (file_path = $t OR file_path LIKE $p)
       LIMIT 10`, { t: input, p: `%/${input}` });
    const matches = [...symbolNodes, ...fileNodes];
    if (matches.length === 0) {
      return `NO MATCH for "${input}". Try graph_search(query="${input}") to find similar names, or pass a repo-relative file path.`;
    }

    const matchedFiles = new Set(matches.map((n) => n.file_path).filter(Boolean));
    const matchedSymbols = new Set(symbolNodes.map((n) => n.label));

    // 2. Features touching this symbol/file
    const features = [];
    const affectedFeatureIds = new Set();
    if (hasOverlay(repoRoot)) {
      const overlay = loadFunctionality(repoRoot);
      for (const f of overlay.features ?? []) {
        const symbolHit = (f.anchors?.symbols ?? []).some((s) => matchedSymbols.has(s));
        const fileHit = (f.anchors?.files ?? []).some((pattern) => {
          // Cheap glob: `foo/*` → matches any file under foo/
          if (pattern.endsWith('/*')) return [...matchedFiles].some((p) => p.startsWith(pattern.slice(0, -1)));
          return matchedFiles.has(pattern);
        });
        if (symbolHit || fileHit) {
          features.push({
            id: f.id,
            label: f.label,
            anchor_match: symbolHit ? 'symbol' : 'file',
            contracts: f.contracts ?? [],
            depends_on: f.depends_on ?? [],
            related_to: f.related_to ?? [],
          });
          affectedFeatureIds.add(f.id);
        }
      }
    }

    // 3. Contracts union across features
    const contracts = [...new Set(features.flatMap((f) => f.contracts))].filter(Boolean);

    // 4. Open tasks bound to affected features
    const tasks = [];
    const tasksPath = join(repoRoot, '.aify-graph', 'tasks.json');
    if (existsSync(tasksPath)) {
      try {
        const raw = JSON.parse(readFileSync(tasksPath, 'utf8'));
        for (const t of raw.tasks ?? []) {
          if (t.status && !/open|progress|active|todo|in_progress/i.test(t.status)) continue;
          const featureRefs = t.features ?? t.related_features ?? [];
          if (!featureRefs.some((f) => affectedFeatureIds.has(f))) continue;
          tasks.push({ id: t.id, title: t.title ?? '', status: t.status ?? null, features: featureRefs.filter((f) => affectedFeatureIds.has(f)) });
        }
      } catch {
        // ignore parse errors — tasks optional
      }
    }

    // 5. Adjacent tests — test files that reference the matched symbols/files
    const tests = [];
    if (symbolNodes.length > 0) {
      const testRows = db.all(
        `SELECT DISTINCT n.file_path
         FROM edges e
         JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id IN (SELECT value FROM json_each($ids))
           AND (n.file_path LIKE '%/test/%' OR n.file_path LIKE '%/tests/%' OR n.file_path LIKE '%.test.%' OR n.file_path LIKE '%.spec.%')
         LIMIT 10`,
        { ids: JSON.stringify(symbolNodes.map((n) => n.id)) });
      tests.push(...testRows.map((r) => r.file_path));
    }

    // 6. Last-touched: git log for the matched files
    let lastTouched = [];
    if (matchedFiles.size > 0) {
      try {
        const fileArgs = [...matchedFiles].slice(0, 5);
        const raw = execFileSync('git',
          ['-C', repoRoot, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', '3', '--', ...fileArgs],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        lastTouched = raw.split('\n').filter(Boolean).map((line) => {
          const [sha, author, date, subject] = line.split('|');
          return { sha, author, date, subject };
        });
      } catch {
        // non-git or no history — skip
      }
    }

    return {
      target: input,
      matched: {
        symbols: symbolNodes.map((n) => ({ label: n.label, type: n.type, file: n.file_path, line: n.start_line })),
        files: fileNodes.map((n) => n.file_path).filter(Boolean),
      },
      contracts_potentially_affected: contracts,
      features_touching: features,
      open_tasks_on_those_features: tasks,
      tests_adjacent: tests,
      last_touched: lastTouched,
      risk_flags: [
        tests.length === 0 ? 'no adjacent tests — regression risk' : null,
        features.length === 0 ? 'no feature anchors this symbol — orphan code' : null,
        contracts.length > 0 ? `${contracts.length} contract(s) may be affected — read each before editing` : null,
      ].filter(Boolean),
    };
  } finally {
    db.close();
  }
}
