import { readdir, readFile, stat as fsStat } from 'node:fs/promises';
import { basename, dirname, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyFingerprint, structuralFingerprint } from './fingerprint.js';

import { IGNORED_DIRS, isIgnoredDirName, pathContainsIgnoredDir, loadEffectiveIgnoredDirs } from './ignored-dirs.js';
import { getGitCandidateFiles, isGitCandidate } from './git-candidates.js';
const DOCUMENT_EXTENSIONS = new Set(['.md', '.rst', '.txt']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml']);
const ENTRYPOINT_BASENAMES = new Set(['artisan', 'manage.py']);

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

function stableId(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

function readLines(content) {
  return content.split(/\r?\n/u).map((line) => line.trim());
}

function buildFingerprints(node, imports = []) {
  return {
    structural_fp: structuralFingerprint({
      qname: node.extra.qname,
      signature: '',
      decorators: [],
      parentClass: '',
      nodeType: node.type,
    }),
    dependency_fp: dependencyFingerprint({
      calls: [],
      references: [],
      usesTypes: [],
      imports,
    }),
  };
}

function makeNode({ type, filePath, label, language = '', confidence = 1.0, extra = {} }) {
  const qname = extra.qname ?? filePath;
  const base = {
    id: stableId([type, filePath, qname]),
    type,
    label,
    file_path: filePath,
    start_line: 1,
    end_line: 1,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: { ...extra, qname },
  };
  const fps = buildFingerprints(base);
  return { ...base, ...fps };
}

function containsEdge(fromNode, toNode) {
  return {
    relation: 'CONTAINS',
    from_id: fromNode.id,
    to_id: toNode.id,
    from_label: fromNode.label,
    to_label: toNode.label,
    from_path: fromNode.file_path,
    to_path: toNode.file_path,
    source_file: toNode.file_path,
    source_line: 1,
    confidence: 1.0,
    extractor: 'filesystem',
  };
}

// Only capture meaningful docs — skip trivial command docs, sparc modes, etc.
const MEANINGFUL_DOC_NAMES = new Set([
  'readme', 'changelog', 'architecture', 'contributing', 'migration',
  'decisions', 'claude', 'agents', 'api', 'guide', 'overview', 'design',
]);

function isDocument(relPath) {
  const base = basename(relPath).toLowerCase();
  const nameNoExt = base.replace(/\.[^.]+$/, '');
  if (!DOCUMENT_EXTENSIONS.has(extname(relPath).toLowerCase())) return false;
  // Must be a meaningful doc name OR in a docs/ directory OR be a README
  if (base.startsWith('readme')) return true;
  if (MEANINGFUL_DOC_NAMES.has(nameNoExt)) return true;
  const dir = dirname(relPath).toLowerCase();
  if (dir.includes('docs') || dir.includes('doc')) return true;
  // Skip random .md files in deep command/config directories
  return false;
}

function isConfig(relPath) {
  const base = basename(relPath).toLowerCase();
  return base === '.env'
    || base === 'package.json'
    || base === 'composer.json'
    || CONFIG_EXTENSIONS.has(extname(relPath).toLowerCase());
}

function isEntrypoint(relPath) {
  const normalized = toPosixPath(relPath);
  const base = basename(normalized).toLowerCase();
  return base === 'artisan'
    || ENTRYPOINT_BASENAMES.has(base)
    || /^main\./u.test(base)
    || /^index\./u.test(base)
    || normalized.startsWith('bin/');
}

function isRoute(relPath) {
  const normalized = toPosixPath(relPath);
  const base = basename(normalized).toLowerCase();
  return /^routes\/.+\.php$/u.test(normalized)
    || base === 'urls.py'
    || base === 'routes.rb';
}

function isSchema(relPath) {
  const normalized = toPosixPath(relPath).toLowerCase();
  return normalized.includes('/migrations/')
    || normalized.startsWith('migrations/')
    || normalized.endsWith('.sql')
    || normalized.endsWith('schema.prisma');
}

function detectLanguage(relPath) {
  switch (extname(relPath).toLowerCase()) {
    case '.py': return 'python';
    case '.php': return 'php';
    case '.js': return 'javascript';
    case '.ts': return 'typescript';
    case '.rb': return 'ruby';
    case '.go': return 'go';
    case '.rs': return 'rust';
    case '.java': return 'java';
    case '.c': return 'c';
    case '.cpp':
    case '.cc':
    case '.cxx': return 'cpp';
    default: return '';
  }
}

function extractDocumentMeta(content, relPath) {
  const lines = readLines(content).filter(Boolean);
  const first = lines[0] ?? basename(relPath);
  const title = first.replace(/^#+\s*/u, '').trim();
  const summary = lines[1] ?? '';
  return { title, summary };
}

function extractConfigKeys(content, relPath) {
  const base = basename(relPath).toLowerCase();
  if (base === '.env') {
    return readLines(content)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=')[0].trim());
  }

  if (extname(relPath).toLowerCase() === '.json') {
    try {
      return Object.keys(JSON.parse(content)).sort();
    } catch {
      return [];
    }
  }

  return readLines(content)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*[:=]/u);
      return match?.[1] ?? null;
    })
    .filter(Boolean)
    .sort();
}

export async function sweepFilesystem({ repoRoot, ignoredDirs = IGNORED_DIRS, gitCandidates: providedCandidates }) {
  // Plan #17 F: when this is a git checkout, prefer git's gitignore-aware
  // candidate set. Falls back to the full filesystem walk when not a git
  // repo OR when git isn't available — preserves legacy behavior on those
  // hosts. Caller may pre-resolve and pass `gitCandidates` directly (e.g.
  // for tests or when caching). `.aifyignore`/`.aifyinclude` still apply
  // on top via ignoredDirs.
  // ⛔ EVERY CLASSIFICATION THIS SWEEP DECLINES WAS INVISIBLE. There was no counts object
  // anywhere in this function and the return carried two fields, so nothing downstream could ask
  // what had been dropped — not for Documents, and not for Route/Schema/Config/Entrypoint either.
  // ef-manager measured the Document hole from OUTSIDE with `git ls-files` (52.7% of this repo's
  // markdown is not a node, 1.4% on sand_castle) because there was no number inside to read.
  // If any other kind is under-admitting the same way, the first evidence would again arrive
  // from someone measuring us from the outside.
  //
  // ⚠ `seen` IS THE INPUT, and it is emitted because ef-manager asked for it by name: "publish
  // the input, and the outcomes sum to it or the sum is itself a finding." Without the
  // denominator a reader reconciling their own file count against ours finds a discrepancy and
  // has nowhere to attribute it — the candidate set here is git candidates, layered over the
  // ignore parser, minus binary and minus the size cap, and it is NOT the same set as
  // `git ls-files`.
  const counts = {
    seen: 0,
    admitted: {},
    declined: {
      ignore_rule: 0,
      git_excluded: 0,
      over_size_cap: 0,
      unreadable: 0,
      // ⚠ SPLIT BEFORE SHIPPING, because the single bucket had the defect it was built to expose.
      // Measured on this repo the first time it ran: 649 `not_a_known_kind` — and most of those
      // are `.js` files, which the sweep is SUPPOSED to decline because the main extractor owns
      // them. An expected outcome and a real hole reported under one name is exactly the
      // conflation that made `unresolved` unreadable in the doc layer this morning, and it would
      // have shipped a number nobody could act on.
      not_a_special_kind: 0,          // expected: source, images — another path owns these
      text_not_admitted_as_document: 0, // ⭐ THE GAP: .md/.rst/.txt that isDocument() refused
    },
  };

  const gitCandidates = providedCandidates !== undefined
    ? providedCandidates
    : getGitCandidateFiles(repoRoot);

  // Review-fix (dev P1#1): when gitCandidates is the authoritative source
  // of truth, we must NOT also apply the manually-parsed .gitignore
  // pre-filter (in `ignoredDirs`) — the manual parser drops `!pattern`
  // re-includes, so a file git would explicitly include via `!keep.log`
  // gets pruned by `*.log` in the parser's set before isGitCandidate()
  // can rescue it. Re-resolve the ignored set WITHOUT gitignore parsing
  // when we have git's answer. .aifyignore/.aifyinclude still apply.
  if (gitCandidates && repoRoot) {
    ignoredDirs = loadEffectiveIgnoredDirs(repoRoot, { skipGitignore: true });
  }
  const nodes = [];
  const edges = [];
  const directories = new Map();

  const rootNode = makeNode({
    type: 'Directory',
    filePath: '.',
    label: basename(repoRoot),
    extra: { qname: '.' },
  });
  directories.set('.', rootNode);
  nodes.push(rootNode);

  async function ensureDirectory(relPath) {
    const normalized = relPath === '' ? '.' : toPosixPath(relPath);
    if (directories.has(normalized)) {
      return directories.get(normalized);
    }

    const node = makeNode({
      type: 'Directory',
      filePath: normalized,
      label: basename(normalized),
      extra: { qname: normalized },
    });

    directories.set(normalized, node);
    nodes.push(node);

    const parentPath = dirname(normalized);
    const parentNode = await ensureDirectory(parentPath === '.' ? '.' : parentPath);
    edges.push(containsEdge(parentNode, node));
    return node;
  }

  async function visit(absPath, relPath = '.') {
    const entries = await readdir(absPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && isIgnoredDirName(entry.name, ignoredDirs)) {
        continue;
      }

      const entryAbsPath = `${absPath}/${entry.name}`.replace(/\\/g, '/');
      const entryRelPath = relPath === '.'
        ? entry.name
        : `${relPath}/${entry.name}`;

      if (pathContainsIgnoredDir(entryRelPath, ignoredDirs)) {
        // Only FILES are counted — a skipped directory is not a candidate, it is a whole subtree
        // that was never enumerated, and folding it in would make `seen` mean two things.
        if (!entry.isDirectory()) { counts.seen++; counts.declined.ignore_rule++; }
        continue;
      }

      if (entry.isDirectory()) {
        await ensureDirectory(entryRelPath);
        await visit(entryAbsPath, entryRelPath);
        continue;
      }

      // Plan #17 F: skip files git considers ignored (per .gitignore +
      // global excludes). The git candidate set is null for non-git
      // repos, in which case every file remains a candidate.
      counts.seen++;
      if (!isGitCandidate(entryRelPath, gitCandidates)) {
        counts.declined.git_excluded++;
        continue;
      }

      const parentNode = await ensureDirectory(dirname(entryRelPath) === '.' ? '.' : dirname(entryRelPath));

      // Guard: skip binary/non-UTF8/unreadable files + cap at 500KB for sweep files
      let content;
      try {
        const fileStat = await fsStat(entryAbsPath);
        // ⚠ ef-manager checked whether this cap is live: 0 files over 500KB across APG, echoes
        // and sand_castle, largest markdown 181,537 B. NOT firing anywhere today — and counted
        // anyway, because it sits UPSTREAM of every classifier, so a file dropped here is
        // invisible even to a fix that counts classifier rejections. sand_castle's largest doc is
        // within 3x of the cap and transcript-heavy corpora are exactly what we index next.
        if (fileStat.size > 500_000) { counts.declined.over_size_cap++; continue; }
        content = await readFile(entryAbsPath, 'utf8');
      } catch {
        counts.declined.unreadable++;
        continue; // Skip unreadable or non-UTF8 files
      }

      let node = null;
      if (isDocument(entryRelPath)) {
        const meta = extractDocumentMeta(content, entryRelPath);
        node = makeNode({
          type: 'Document',
          filePath: entryRelPath,
          label: basename(entryRelPath),
          extra: meta,
        });
      } else if (isRoute(entryRelPath)) {
        node = makeNode({
          type: 'Route',
          filePath: entryRelPath,
          label: basename(entryRelPath),
          language: detectLanguage(entryRelPath),
        });
      } else if (isSchema(entryRelPath)) {
        node = makeNode({
          type: 'Schema',
          filePath: entryRelPath,
          label: basename(entryRelPath),
          language: detectLanguage(entryRelPath),
        });
      } else if (isEntrypoint(entryRelPath)) {
        node = makeNode({
          type: 'Entrypoint',
          filePath: entryRelPath,
          label: basename(entryRelPath),
          language: detectLanguage(entryRelPath),
        });
      } else if (isConfig(entryRelPath)) {
        node = makeNode({
          type: 'Config',
          filePath: entryRelPath,
          label: basename(entryRelPath),
          extra: { keys: extractConfigKeys(content, entryRelPath) },
        });
      }

      if (node) {
        nodes.push(node);
        edges.push(containsEdge(parentNode, node));
        counts.admitted[node.type] = (counts.admitted[node.type] ?? 0) + 1;
      } else if (DOCUMENT_EXTENSIONS.has(extname(entryRelPath).toLowerCase())) {
        // ⭐ THE GAP. A text document that reached `isDocument()` and was refused — not a readme,
        // not one of the 12 allowlisted names, not under a directory whose name contains "doc".
        // 79 of this repo's 150 tracked markdown files land here. Nothing downstream will pick
        // them up: this was their only chance to become a node.
        counts.declined.text_not_admitted_as_document++;
      } else {
        // Expected. A `.js` file is declined here because the main extractor owns it, and
        // counting that as a loss would bury the line above in four times its own volume.
        counts.declined.not_a_special_kind++;
      }
    }
  }

  await visit(toPosixPath(repoRoot));
  // Published even when nothing was declined. A field that appears only when something is wrong
  // cannot be told apart from a build that never had the check — which is the inference a field
  // user correctly drew from a missing `staleProcess` key on 2026-08-07.
  return { nodes, edges, counts };
}
