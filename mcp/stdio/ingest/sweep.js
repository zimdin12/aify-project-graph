import { readdir, readFile, stat as fsStat } from 'node:fs/promises';
import { basename, dirname, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyFingerprint, structuralFingerprint } from './fingerprint.js';

import { IGNORED_DIRS, isIgnoredDirName, pathContainsIgnoredDir } from './ignored-dirs.js';
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

export async function sweepFilesystem({ repoRoot, ignoredDirs = IGNORED_DIRS }) {
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
        continue;
      }

      if (entry.isDirectory()) {
        await ensureDirectory(entryRelPath);
        await visit(entryAbsPath, entryRelPath);
        continue;
      }

      const parentNode = await ensureDirectory(dirname(entryRelPath) === '.' ? '.' : dirname(entryRelPath));

      // Guard: skip binary/non-UTF8/unreadable files + cap at 500KB for sweep files
      let content;
      try {
        const fileStat = await fsStat(entryAbsPath);
        if (fileStat.size > 500_000) continue;
        content = await readFile(entryAbsPath, 'utf8');
      } catch {
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
      }
    }
  }

  await visit(toPosixPath(repoRoot));
  return { nodes, edges };
}
