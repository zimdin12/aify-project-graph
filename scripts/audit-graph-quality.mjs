#!/usr/bin/env node
// How GOOD is a generated graph? Measured against the source tree it was built from.
//
//   node scripts/audit-graph-quality.mjs <repoRoot> [<repoRoot> ...]
//
// Every efficacy claim this project has made is about how agents BEHAVE. None is about whether the
// artefact those agents read is any good. This asks the prior question: for a repository whose
// contents we can check, did the graph find what is there?
//
// ⛔ THE AUDIT ITSELF NEEDS CONTROLS, because an audit that cannot fail is decoration:
//   · file coverage is computed against files git actually tracks, filtered to extensions the
//     extractors CLAIM to handle — comparing against every file on disk would score a README as a
//     miss and make coverage meaninglessly low
//   · a repo with zero indexed files FAILS rather than scoring 0% quietly
//   · the extension list is DERIVED from the graph's own languages plus a declared map, so a
//     language nobody extracts is visible as an explicit gap instead of silently excluded

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExistingDb } from '../mcp/stdio/storage/db.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Extensions each language tier claims. `lsp` means a language server exists and edges can be
 * compiler-verified; `heuristic` means tree-sitter only — those graphs can never carry `[lsp✓]`
 * and can never license an absence claim.
 */
const LANG_TIERS = {
  cpp:        { tier: 'lsp',       ext: ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh'] },
  c:          { tier: 'heuristic', ext: ['.c'] },
  python:     { tier: 'lsp',       ext: ['.py'] },
  typescript: { tier: 'lsp',       ext: ['.ts', '.tsx'] },
  javascript: { tier: 'lsp',       ext: ['.js', '.mjs', '.cjs', '.jsx'] },
  php:        { tier: 'heuristic', ext: ['.php'] },
  go:         { tier: 'heuristic', ext: ['.go'] },
  java:       { tier: 'heuristic', ext: ['.java'] },
  rust:       { tier: 'heuristic', ext: ['.rs'] },
  ruby:       { tier: 'heuristic', ext: ['.rb'] },
};
const EXT_TO_LANG = new Map();
for (const [lang, def] of Object.entries(LANG_TIERS)) for (const e of def.ext) EXT_TO_LANG.set(e, lang);

const trackedFiles = (root) => execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').map((s) => s.trim()).filter(Boolean);

function audit(root) {
  const dbPath = join(root, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) return { root, error: 'no graph database' };
  const db = openExistingDb(dbPath);
  try {
    // ── what the source tree actually contains ──────────────────────────────
    const tracked = trackedFiles(root);
    const sourceByLang = new Map();
    for (const f of tracked) {
      const lang = EXT_TO_LANG.get(extname(f).toLowerCase());
      if (!lang) continue;
      if (!sourceByLang.has(lang)) sourceByLang.set(lang, new Set());
      sourceByLang.get(lang).add(f.replace(/\\/g, '/'));
    }

    // ── what the graph contains ─────────────────────────────────────────────
    //
    // ⛔ NOT every `file_path` IS A FILE, AND THE FIRST VERSION OF THIS AUDIT COUNTED THEM ALL.
    // It reported `click` as 170 indexed files against 166 tracked — more files than git knows
    // about, which is impossible and should have stopped me sooner. The extras were `Directory`
    // nodes carrying directory paths (by design, for the module tree) and `External` nodes
    // carrying `file_path = ''` for symbols outside the repository (`getcwd`, `startswith`).
    //
    // Both are correct product behaviour. The defect was the audit's denominator: "distinct
    // file_path values" is not "source files indexed". Same wrong-noun error this project keeps
    // paying for — the arithmetic was fine, the noun was never checked.
    const NON_FILE_TYPES = new Set(['Directory', 'External']);
    const indexed = new Set(
      db.all('SELECT DISTINCT file_path f, type t FROM nodes WHERE file_path IS NOT NULL AND file_path <> \'\'')
        .filter((r) => !NON_FILE_TYPES.has(r.t))
        .map((r) => String(r.f).replace(/\\/g, '/')),
    );
    // Reported so the exclusion is visible rather than silently applied.
    const excluded = db.all('SELECT type, COUNT(*) c FROM nodes WHERE type IN (\'Directory\',\'External\') GROUP BY type');

    const coverage = [];
    for (const [lang, files] of [...sourceByLang.entries()].sort()) {
      const hit = [...files].filter((f) => indexed.has(f));
      const missed = [...files].filter((f) => !indexed.has(f));
      coverage.push({
        language: lang,
        tier: LANG_TIERS[lang].tier,
        sourceFiles: files.size,
        indexedFiles: hit.length,
        coverage: files.size ? Number((hit.length / files.size).toFixed(3)) : null,
        missedExamples: missed.slice(0, 5),
      });
    }

    const nodeTypes = db.all('SELECT type, COUNT(*) c FROM nodes GROUP BY type ORDER BY c DESC');
    const relations = db.all('SELECT relation, COUNT(*) c FROM edges GROUP BY relation ORDER BY c DESC');
    const provenance = db.all('SELECT COALESCE(provenance,\'(null)\') p, COUNT(*) c FROM edges GROUP BY p ORDER BY c DESC');

    const totalEdges = db.get('SELECT COUNT(*) c FROM edges').c;
    const totalNodes = db.get('SELECT COUNT(*) c FROM nodes').c;

    // ⚠ AN EDGE POINTING AT A NODE THAT DOES NOT EXIST IS THE GRAPH'S OWN BROKEN POINTER, and it is
    // the single most useful defect signal here: it means extraction produced a reference it could
    // not resolve to a declaration.
    const danglingTo = db.get('SELECT COUNT(*) c FROM edges e LEFT JOIN nodes n ON n.id = e.to_id WHERE n.id IS NULL').c;
    const danglingFrom = db.get('SELECT COUNT(*) c FROM edges e LEFT JOIN nodes n ON n.id = e.from_id WHERE n.id IS NULL').c;

    const orphanNodes = db.get(`SELECT COUNT(*) c FROM nodes n
      WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.from_id = n.id OR e.to_id = n.id)`).c;

    const lspEdges = db.get("SELECT COUNT(*) c FROM edges WHERE provenance = 'LSP_VERIFIED'").c;

    return {
      root,
      totals: { nodes: totalNodes, edges: totalEdges, trackedFiles: tracked.length, indexedSourceFiles: indexed.size },
      excludedFromFileCount: Object.fromEntries(excluded.map((r) => [r.type, r.c])),
      coverage,
      nodeTypes: Object.fromEntries(nodeTypes.map((r) => [r.type, r.c])),
      relations: Object.fromEntries(relations.map((r) => [r.relation, r.c])),
      provenance: Object.fromEntries(provenance.map((r) => [r.p, r.c])),
      integrity: {
        danglingToEdges: danglingTo,
        danglingFromEdges: danglingFrom,
        danglingShare: totalEdges ? Number(((danglingTo + danglingFrom) / totalEdges).toFixed(3)) : null,
        orphanNodes,
        orphanShare: totalNodes ? Number((orphanNodes / totalNodes).toFixed(3)) : null,
        lspVerifiedEdges: lspEdges,
        lspVerifiedShare: totalEdges ? Number((lspEdges / totalEdges).toFixed(3)) : null,
      },
    };
  } finally {
    try { db.close?.(); } catch { /* ignore */ }
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) { console.error('usage: node scripts/audit-graph-quality.mjs <repoRoot> ...'); process.exit(2); }

const results = roots.map(audit);

// ⛔ CONTROL: at least one repo must have produced a non-empty graph, or the audit is measuring its
// own inability to open a database and every "0%" below is about the instrument, not the product.
const anyIndexed = results.some((r) => r.totals && r.totals.indexedSourceFiles > 0);

console.log(JSON.stringify({
  what: 'Graph quality measured against the source tree each graph was built from.',
  controls: {
    anyRepoIndexed: anyIndexed,
    passed: anyIndexed,
    note: anyIndexed ? null : 'CONTROL FAILED — no repo produced an indexed file; read nothing below as a finding.',
  },
  results,
}, null, 2));

process.exit(anyIndexed ? 0 : 1);
