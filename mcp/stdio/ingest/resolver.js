import { createHash } from 'node:crypto';
import { resolveImportSpecifier, probeWithExtensions } from './import-resolution.js';
import { COMMON_NAMES } from './denylist.js';

function parseExtra(node) {
  if (!node?.extra) return {};
  if (typeof node.extra === 'string') {
    try {
      return JSON.parse(node.extra);
    } catch {
      return {};
    }
  }
  return node.extra;
}

function normalizeNode(row) {
  if (!row) return null;
  return {
    ...row,
    extra: parseExtra(row),
  };
}

function normalizeRows(rows = []) {
  return rows.map(normalizeNode);
}

// Language-family groupings. Candidates in the same family are preferred over
// candidates in another family when resolving code-like relations (CALLS,
// EXTENDS, etc.). Keeps PHP `DB::table()` from resolving to a CSS `.table`
// selector, C++ method calls from resolving to a Python function of the same
// name, and so on.
const LANGUAGE_FAMILY = new Map([
  ['php', 'php'],
  ['laravel', 'php'],  // Laravel plugin emits routes as PHP
  ['javascript', 'js_ts'],
  ['typescript', 'js_ts'],
  ['c', 'c_cpp'],
  ['cpp', 'c_cpp'],
  ['glsl', 'glsl'],    // GLSL borrows from C but runs in a different address space
  ['css', 'css'],
  ['python', 'python'],
  ['rust', 'rust'],
  ['go', 'go'],
  ['ruby', 'ruby'],
  ['java', 'java'],
]);

function languageFamily(lang) {
  if (!lang) return 'unknown';
  return LANGUAGE_FAMILY.get(lang) ?? lang;
}

// Relations that must stay inside the same language family. A PHP CALLS
// ref should never resolve to a CSS node. Import-style relations (and the
// synthetic CONTAINS ownership emitted for out-of-class methods, where the
// owner is guaranteed same-language) are allowed to fall through to cross-
// family matches — that's how `#include "Engine.h"` can point at a File
// node whose language bucket doesn't match.
// ⚠ EXPORTED so the framework-plugin guard tests against the resolver's OWN set rather than a
// copy that can drift. A relation added here is covered by that test the same day.
export const HARD_GATED_RELATIONS = new Set([
  'CALLS', 'INVOKES', 'PASSES_THROUGH', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE', 'TESTS', 'REFERENCES',
]);

// P5-2: Cross-language-family phantom-edge drop.
//
// An INFERRED/AMBIGUOUS CALLS or REFERENCES whose two endpoints sit in
// DIFFERENT language families (e.g. a C++ method "calling" a Python function
// that merely shares a name) is almost always a coincidental name collision,
// not a real edge. HARD_GATED_RELATIONS lists the relations that must stay
// in-family: when same-family candidates exist they win; when none exist the
// cross-family candidates are DROPPED (the ref goes unresolved / materializes
// as an External terminal) rather than crossing the family boundary.
//
// The single allowed cross-family BRIDGE is the L5 shader binding
// (C++ ↔ GLSL via LOADS_SHADER). LOADS_SHADER is resolved by file-path suffix
// at the top of resolveTarget and never flows through this gate, so it is
// exempt by construction. BRIDGE_RELATIONS documents that contract and keeps
// the gate honest if a future relation is added that should also cross.
// EXTRACTED edges (those that arrive with ref.to_id already set) skip
// resolution entirely and are likewise unaffected — only INFERRED/AMBIGUOUS
// name-based resolution is gated.
const BRIDGE_RELATIONS = new Set(['LOADS_SHADER']);

// ⛔ AN EXTRACTOR TAG IS NOT A LANGUAGE. `languageFamily` returns its input unchanged for anything
// it does not recognise, so a FRAMEWORK tag ('node-web', 'nestjs', 'django', 'rails', 'spring',
// 'qt', 'cmake', 'shader-bindings') became its own private "family" that matches no real node. With
// INVOKES and PASSES_THROUGH hard-gated, the filter returned [] and every routed target was
// materialised as an External stub beside the real function it should have bound to.
//
// Enumerated across every framework tag in this repo, `laravel` was the ONLY one that resolved —
// there is a lone `['laravel', 'php']` entry in the map with the comment "Laravel plugin emits
// routes as PHP". One framework was fixed by name and nine were left.
//
// ⇒ Prefer a LANGUAGE the ref carries explicitly. Plugins already compute it per file; the fallback
// to `extractor` keeps every existing ref behaving exactly as before.
function refLanguageFamily(ref) {
  return languageFamily(ref.language || ref.extractor);
}

function filterByLanguageFamily(matches, ref) {
  if (!matches || matches.length === 0) return matches;
  // Known cross-family bridges are exempt — don't gate them.
  if (BRIDGE_RELATIONS.has(ref.relation)) return matches;
  const refFamily = refLanguageFamily(ref);
  if (refFamily === 'unknown') return matches;
  const sameFamily = matches.filter((m) => languageFamily(m.language) === refFamily);
  if (sameFamily.length > 0) return sameFamily;
  // No same-family candidates. If the relation is hard-gated, treat as
  // unresolved rather than crossing families.
  if (HARD_GATED_RELATIONS.has(ref.relation)) return [];
  return matches;
}

// Common names that should NOT match globally — too ambiguous
// COMMON_NAMES moved to ./denylist.js (shared with the unresolved-categorization
// scoreboard so the two can't drift). Imported above.

// ⛔ WHICH RELATIONS MAY NAME THEIR SOURCE INSTEAD OF POINTING AT IT.
//
// A ref with `from_target` (a NAME) and no `from_id` is rejected outright unless its relation is
// listed here — before any resolution is attempted. That silently discarded every Qt signal edge:
// `cpp_frameworks` emits `emit progressChanged()` as CALLS from the ENCLOSING FUNCTION'S NAME, which
// is exactly this shape. Its refs reached the dirty-edge sidecar carrying a correct
// `language: 'cpp'` and were never looked at, so the language fix that unblocked five other
// frameworks could not help this one — a SECOND gate behind the first.
//
// ⭐ BLAST RADIUS MEASURED BEFORE CHANGING IT, with the probe positive-controlled in the same pass:
//
//     fmt 1,894 dirty edges · click 3,298 · fast-route 163 · p-queue 86 · this repo 18,194
//       -> symbolic-source refs of ANY relation: 0
//     qt fixture (CONTROL)  -> 2, both CALLS, both from extractor 'qt'
//
// ⇒ Adding CALLS changes nothing on any repository measured; it affects only repos using Qt. The
// zeros are real rather than a dead probe, because the control found the two it was meant to.
//
// ⚠ AND THE BINDING IT ENABLES IS THE CORRECT ONE: `emit progressChanged(50)` inside `runTask()`
// resolves to Method:runTask -> Method:progressChanged, which is what that code does. A source that
// fails to resolve still mints an External node, exactly as CALLS targets already do.
const SYMBOLIC_CHAIN_RELATIONS = new Set(['PASSES_THROUGH', 'INVOKES', 'CALLS']);
const INHERITED_MEMBER_RELATIONS = new Set(['CALLS', 'INVOKES', 'PASSES_THROUGH']);
const CLASSLIKE_TYPES = new Set(['Class', 'Interface', 'Type']);
// Node types that can OWN an out-of-line member (for reverse-CONTAINS resolution).
// A namespace (Module) can too; a Method/Function never can.
const OWNER_TYPES = new Set(['Class', 'Interface', 'Type', 'Module']);

// Node rows come straight from SQLite, so `extra` is a JSON STRING here, not an
// object (in-memory extractor nodes carry the object form). Accept both.
export function mergesOverloads(node) {
  const raw = node?.extra;
  if (!raw) return false;
  let extra = raw;
  if (typeof raw === 'string') {
    try { extra = JSON.parse(raw); } catch { return false; }
  }
  return (extra?.overloads ?? 1) > 1;
}

function preferProximate(matches, sourceFile) {
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const sameFile = matches.filter((m) => m.file_path === sourceFile);
  if (sameFile.length === 1) return sameFile[0];

  const sourceDir = sourceFile.includes('/') ? sourceFile.slice(0, sourceFile.lastIndexOf('/')) : '';
  if (sourceDir) {
    const sameDir = matches.filter((m) => m.file_path.startsWith(`${sourceDir}/`));
    if (sameDir.length === 1) return sameDir[0];
  }

  return null;
}

function lookupCandidates(target, { dropExtension = true } = {}) {
  const stripped = target.replace(/^["'<]+|[>"']+$/g, '').trim();
  const candidates = new Set([target, stripped]);

  const dotted = stripped
    .replace(/\\/g, '.')
    .replace(/\//g, '.')
    .replace(/^\.+/u, '')
    .replace(/\.{2,}/g, '.');
  if (dotted) candidates.add(dotted);

  const basename = stripped.includes('/') ? stripped.split('/').pop() : null;
  if (basename) candidates.add(basename);

  if (dropExtension) {
    const noExt = stripped.replace(/\.[^.]+$/, '');
    if (noExt && noExt !== stripped) candidates.add(noExt);
  }

  return [...candidates].filter(Boolean);
}

function pickSingleProximate(matches, sourceFile) {
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return preferProximate(matches, sourceFile);
}

function buildResolvers(db) {
  const findByExactQname = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE json_extract(extra, '$.qname') = ?
  `);

  const findByQnameSuffix = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE json_extract(extra, '$.qname') = ?
       OR json_extract(extra, '$.qname') LIKE ?
  `);

  const findByLabel = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE label = ?
  `);

  // Match by file_path suffix. For C++ `#include "core/Engine.h"` and
  // similar relative-include patterns, the raw target is a repo-relative
  // path fragment. The resolver needs to match that against nodes whose
  // file_path ends with the target — e.g. `core/Engine.h` should match
  // a File node at `engine/core/Engine.h`. Exact and LIKE '%/target' so
  // it won't match `engine/notcore/Engine.h` (would need a `/` boundary).
  const findByFilePathSuffix = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE type IN ('File', 'Directory')
      AND (file_path = ? OR file_path LIKE ?)
  `);

  // Audit 2026-06-12 W3 (graphify 6dc23db): the symbol a file `export default`s,
  // so a renamed default import binds to it regardless of the local alias.
  const findDefaultExportInFile = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE file_path = ?
      AND json_extract(extra, '$.isDefaultExport') IN (1, 'true')
      AND type IN ('Class', 'Function', 'Type', 'Method')
  `);

  const findContainedMember = db.raw.prepare(`
    SELECT n.*
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.relation = 'CONTAINS'
      AND n.label = ?
      AND n.type IN ('Method', 'Function')
  `);

  // Includes IMPLEMENTS so PHP trait method calls resolve. The PHP plugin
  // emits `use SomeTrait;` inside a class body as an IMPLEMENTS edge
  // (intentional approximation — see comment at php.js:268). For Java/C#
  // IMPLEMENTS points at interfaces whose methods have no body, so
  // findContainedMember returns nothing and the walk continues — no harm.
  // For PHP traits with method bodies, this is the path that finally lets
  // `$this->log()` from a HasLogger trait resolve to the trait's method.
  const findExtendedParents = db.raw.prepare(`
    SELECT n.*
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.relation IN ('EXTENDS', 'IMPLEMENTS')
      AND n.type IN ('Class', 'Interface', 'Type')
  `);

  const pendingNodes = [];
  const pendingByQname = new Map();
  const pendingByLabel = new Map();

  function registerPending(node) {
    const normalized = normalizeNode(node);
    pendingNodes.push(normalized);

    const qname = normalized.extra?.qname ?? '';
    if (qname) {
      const existing = pendingByQname.get(qname) ?? [];
      existing.push(normalized);
      pendingByQname.set(qname, existing);
    }

    const label = normalized.label ?? '';
    if (label) {
      const existing = pendingByLabel.get(label) ?? [];
      existing.push(normalized);
      pendingByLabel.set(label, existing);
    }
  }

  function mergeRows(dbRows = [], extraRows = []) {
    const out = [];
    const seen = new Set();
    for (const row of [...dbRows, ...extraRows]) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    return out;
  }

  return {
    findByExactQname(candidate) {
      return mergeRows(
        normalizeRows(findByExactQname.all(candidate)),
        pendingByQname.get(candidate) ?? [],
      );
    },
    findByQnameSuffix(candidate) {
      const pending = pendingNodes.filter((node) => {
        const qname = node.extra?.qname ?? '';
        return qname === candidate || qname.endsWith(`.${candidate}`);
      });
      return mergeRows(
        normalizeRows(findByQnameSuffix.all(candidate, `%.${candidate}`)),
        pending,
      );
    },
    findByLabel(label) {
      return mergeRows(
        normalizeRows(findByLabel.all(label)),
        pendingByLabel.get(label) ?? [],
      );
    },
    findByFilePathSuffix(target) {
      // Mirror the pending-node case: nodes the ingest just added that
      // haven't been committed to SQLite yet.
      const pending = pendingNodes.filter((node) => {
        const fp = node.file_path ?? '';
        if (!fp) return false;
        if (node.type !== 'File' && node.type !== 'Directory') return false;
        return fp === target || fp.endsWith(`/${target}`);
      });
      return mergeRows(
        normalizeRows(findByFilePathSuffix.all(target, `%/${target}`)),
        pending,
      );
    },
    findDefaultExportInFile(filePath) {
      const pending = pendingNodes.filter((node) =>
        node.file_path === filePath
        && node.extra?.isDefaultExport === true
        && ['Class', 'Function', 'Type', 'Method'].includes(node.type));
      return mergeRows(
        normalizeRows(findDefaultExportInFile.all(filePath)),
        pending,
      );
    },
    findContainedMember(ownerId, label) {
      return normalizeRows(findContainedMember.all(ownerId, label));
    },
    findExtendedParents(ownerId) {
      return normalizeRows(findExtendedParents.all(ownerId));
    },
    addNode(node) {
      registerPending(node);
    },
  };
}

function splitMemberTarget(target) {
  const normalized = normalizeExternalTarget(target);
  if (normalized.includes('/')) return null;
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === normalized.length - 1) return null;
  return {
    owner: normalized.slice(0, lastDot),
    member: normalized.slice(lastDot + 1),
  };
}

function resolveViaInheritance(ref, resolvers) {
  if (!INHERITED_MEMBER_RELATIONS.has(ref.relation)) return null;
  const memberTarget = splitMemberTarget(ref.target);
  if (!memberTarget) return null;

  const ownerCandidates = lookupCandidates(memberTarget.owner, { dropExtension: false }).flatMap((candidate) => [
    ...resolvers.findByExactQname(candidate),
    ...resolvers.findByQnameSuffix(candidate),
  ]);
  const ownerMatches = filterByLanguageFamily(
    ownerCandidates.filter((node) => CLASSLIKE_TYPES.has(node.type)),
    ref,
  );
  const owner = pickSingleProximate(ownerMatches, ref.source_file);
  if (!owner) return null;

  const visited = new Set();
  const queue = [owner];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current?.id || visited.has(current.id)) continue;
    visited.add(current.id);

    const inheritedMembers = filterByLanguageFamily(
      resolvers.findContainedMember(current.id, memberTarget.member),
      ref,
    );
    const member = pickSingleProximate(inheritedMembers, ref.source_file);
    if (member) return { node: member, provenance: 'INFERRED' };

    queue.push(...filterByLanguageFamily(resolvers.findExtendedParents(current.id), ref));
  }

  return null;
}

function pickProvenance(matches, fallback = 'EXTRACTED') {
  if (!matches || matches.length <= 1) return fallback;
  return 'AMBIGUOUS';
}

// P3-2: import-evidence resolution for short-name CALLS/REFERENCES.
//
// graphify Tier-A: resolve a short-name call ONLY when the callee matches one
// of the importing file's import aliases AND that resolves to exactly ONE node.
// Guardrails (both codegraph #314 and graphify insist):
//   - unique candidate only (>1 → leave to the generic passes / INFERRED);
//   - never let a Document node satisfy a code CALLS/REFERENCES;
//   - respect COMMON_NAMES denylist and the language-family gate;
//   - only applies to bare short names (no `.`/`/`) — qualified targets already
//     have a resolution path.
function resolveViaImportEvidence(ref, resolvers, importContext) {
  if (ref.relation !== 'CALLS' && ref.relation !== 'REFERENCES') return null;
  const target = ref.target;
  if (!target || /[.\\/]/u.test(target)) return null;
  if (COMMON_NAMES.has(target)) return null;

  // The per-file import map is attached at extract time (js-import-evidence.js)
  // as ref.importMap = { localName: { source, exportedName } }. Without it we
  // have no evidence — bail (no guess).
  const importMap = ref.importMap;
  if (!importMap || typeof importMap !== 'object') return null;
  const entry = importMap[target];
  if (!entry) return null;

  // Resolve the import source to a real repo-relative file (extension-probe +
  // tsconfig alias). If the source isn't an intra-repo file (bare npm), there
  // is no local node to point at — leave unresolved.
  const resolvedFile = importContext
    ? resolveImportSpecifier({ specifier: entry.source, importerFile: ref.source_file, ctx: importContext })
    : null;

  // Default import → default export: `import Bar from './foo'` binds whatever
  // './foo' default-exports, regardless of the local name `Bar`. Match by the
  // file's marked default export (unique-or-drop) instead of the local name, which
  // would otherwise never find a renamed default export (audit W3, graphify 6dc23db).
  if (entry.exportedName === 'default' && resolvedFile && typeof resolvers.findDefaultExportInFile === 'function') {
    const defs = filterByLanguageFamily(resolvers.findDefaultExportInFile(resolvedFile), ref);
    if (defs.length === 1) return { node: defs[0], provenance: 'INFERRED' };
  }

  // Candidate symbols for this short name. Prefer the exported name when the
  // alias was `import { exportedName as target }`.
  const exportedName = entry.exportedName && entry.exportedName !== 'default' && entry.exportedName !== '*'
    ? entry.exportedName
    : target;
  const rawCandidates = [
    ...resolvers.findByLabel(target),
    ...(exportedName !== target ? resolvers.findByLabel(exportedName) : []),
  ];
  // Never let a doc/non-code node satisfy a code call.
  const codeCandidates = rawCandidates.filter((n) => n.type !== 'Document' && n.type !== 'Directory' && n.type !== 'External');
  const familyFiltered = filterByLanguageFamily(codeCandidates, ref);
  if (familyFiltered.length === 0) return null;

  // If we resolved the import to a concrete file, narrow candidates to that
  // file — this is the strongest evidence and disambiguates duplicate simple
  // names across the repo (codegraph #314 alias-narrowing).
  if (resolvedFile) {
    const inFile = familyFiltered.filter((n) => n.file_path === resolvedFile);
    if (inFile.length === 1) return { node: inFile[0], provenance: 'INFERRED' };
    if (inFile.length > 1) return null; // ambiguous within the imported file
    // Import source resolved to a file but no symbol there matched the name:
    // the symbol is likely re-exported / not extracted. Do NOT fall through to
    // a repo-wide label match (that's the wrong-edge risk). Bail.
    return null;
  }

  // No concrete file (e.g. tsconfig unavailable). Accept ONLY a globally unique
  // candidate — the unique-match guarantee is what keeps this from inflating
  // wrong edges.
  const seen = new Map();
  for (const n of familyFiltered) seen.set(n.id, n);
  const unique = [...seen.values()];
  if (unique.length === 1) return { node: unique[0], provenance: 'INFERRED' };
  return null;
}

function resolveTarget(ref, resolvers, importContext = null) {
  // L5 shader bridge: LOADS_SHADER refs target a shader filename (usually a
  // bare basename like "cas.comp.glsl" loaded via ShaderCompiler::loadFile).
  // Resolve against the shader File node by file-path suffix FIRST — before
  // the generic qname/label passes, which would otherwise mis-resolve the
  // basename to the shader's Module node (whose qname ends `.cas.comp`).
  if (ref.relation === 'LOADS_SHADER') {
    const target = normalizeExternalTarget(ref.target);
    const filePathMatches = resolvers.findByFilePathSuffix(target);
    const filePathMatch = filePathMatches.length === 1
      ? filePathMatches[0]
      : (preferProximate(filePathMatches, ref.source_file) ?? filePathMatches[0] ?? null);
    if (filePathMatch) return { node: filePathMatch, provenance: pickProvenance(filePathMatches, 'INFERRED') };
    return null;
  }

  const memberTarget = splitMemberTarget(ref.target);
  const targetCandidates = lookupCandidates(ref.target, {
    dropExtension: !(memberTarget && INHERITED_MEMBER_RELATIONS.has(ref.relation)),
  });

  for (const candidate of targetCandidates) {
    const exactRaw = resolvers.findByExactQname(candidate);
    const exactMatches = filterByLanguageFamily(exactRaw, ref);
    const exactMatch = preferProximate(exactMatches, ref.source_file);
    if (exactMatch) {
      return { node: exactMatch, provenance: pickProvenance(exactMatches, 'EXTRACTED') };
    }
  }

  if (/[.\\/]/u.test(ref.target)) {
    for (const candidate of targetCandidates) {
      const suffixRaw = resolvers.findByQnameSuffix(candidate);
      const suffixMatches = filterByLanguageFamily(suffixRaw, ref);
      const suffixMatch = preferProximate(suffixMatches, ref.source_file);
      if (suffixMatch) return { node: suffixMatch, provenance: pickProvenance(suffixMatches, 'INFERRED') };
    }
  }

  // File-path suffix matching for import-like refs whose target is a
  // path fragment (e.g. C++ `#include "core/Engine.h"`, Python relative
  // imports). The qname-suffix pass above doesn't match File nodes
  // because File qnames are normalized differently. Covers the biggest
  // unresolved bucket on echoes (63% of sampled refs).
  if (ref.relation === 'IMPORTS' && /[\\/]/u.test(ref.target)) {
    const filePathMatches = resolvers.findByFilePathSuffix(ref.target);
    const filePathMatch = preferProximate(filePathMatches, ref.source_file);
    if (filePathMatch) return { node: filePathMatch, provenance: pickProvenance(filePathMatches, 'INFERRED') };
  }

  // P3-1: JS/TS IMPORTS extension-probe + tsconfig path-alias resolution.
  // The extractor emits relative imports as extensionless `dir/foo` and leaves
  // alias specifiers (`@/foo`, `~/foo`) raw. Neither matches a File node whose
  // path is `dir/foo.js`. Probe the candidate fileset (TS/JS/index ladder) and
  // tsconfig aliases to recover the real file, then attach to its File node.
  // Additive: only fires for currently-unresolved IMPORTS and only ever yields
  // a path that EXISTS in the candidate set, so it cannot create a wrong edge.
  if (ref.relation === 'IMPORTS' && importContext
    && (ref.extractor === 'javascript' || ref.extractor === 'typescript')) {
    // Two shapes reach here: a normalized relative path (`dir/foo`, no leading
    // dot) and a raw alias/bare specifier (`@/foo`). probeWithExtensions covers
    // the former directly; resolveImportSpecifier covers aliases (and re-probes
    // the former harmlessly).
    let repoRelFile = probeWithExtensions(ref.target, importContext.fileSet);
    if (!repoRelFile) {
      repoRelFile = resolveImportSpecifier({
        specifier: ref.target,
        importerFile: ref.source_file,
        ctx: importContext,
      });
    }
    if (repoRelFile) {
      const fileMatches = resolvers.findByFilePathSuffix(repoRelFile);
      const exact = fileMatches.find((m) => m.file_path === repoRelFile);
      if (exact) return { node: exact, provenance: 'INFERRED' };
      const fileMatch = preferProximate(fileMatches, ref.source_file);
      if (fileMatch) return { node: fileMatch, provenance: pickProvenance(fileMatches, 'INFERRED') };
    }
  }

  const labelRaw = resolvers.findByLabel(ref.target);
  const labelMatches = filterByLanguageFamily(labelRaw, ref);
  if (COMMON_NAMES.has(ref.target)) {
    const sameFile = labelMatches.filter((m) => m.file_path === ref.source_file);
    if (sameFile.length === 1) return { node: sameFile[0], provenance: 'INFERRED' };
    return null;
  }

  // Audit 2026-06-12 W3 (#6): consult the file's IMPORTS before a repo-wide
  // label/proximity guess. If the importer imports `foo` from `./b`, the call is
  // to b's `foo` — even when a same-named (or merely closer) `foo` sits in the
  // importer's own directory. Running preferProximate first attached the edge to
  // the wrong node with EXTRACTED provenance. resolveViaImportEvidence is strict
  // (unique within the resolved imported file, or globally unique) and returns
  // null when unsure, so moving it ahead never ADDS a wrong edge — it only
  // redirects a guess to the import-backed truth.
  const viaImport = resolveViaImportEvidence(ref, resolvers, importContext);
  if (viaImport) return viaImport;

  const labelMatch = preferProximate(labelMatches, ref.source_file);
  if (labelMatch) return { node: labelMatch, provenance: pickProvenance(labelMatches, 'EXTRACTED') };

  return resolveViaInheritance(ref, resolvers);
}

function normalizeExternalTarget(target) {
  return String(target ?? '')
    .trim()
    .replace(/^["'<]+|[>"']+$/g, '');
}

// ⛔ A NAME, OR NOTHING. Nothing checked that a materialised External LOOKED like a symbol, so when
// a parser handed back a fragment the graph grew a node labelled `entries()]`, `replace(/\\/g,` or
// `join(dirOf(docPath),`. Measured on this repository: 329 of 1,104 External nodes — 29.8% — were
// fragments of that shape, about 5% of every labelled node in the graph.
//
// Those nodes are pure noise. Nothing can ever resolve to them, no edge to one is a real call, they
// appear in searches and censuses, and they were the bulk of the AMBIGUOUS tier's damage: 23.3% of
// sampled AMBIGUOUS CALLS edges pointed at one.
//
// ⚠ THE RULE IS DERIVED FROM THE OBSERVED POPULATION, not invented. Applied to the 1,104 existing
// External labels it accepts 775 — `slice`, `readFileSync`, `Map`, `createGraph` — and rejects 329,
// every one a fragment. Separators that appear in real names are allowed: `.` and `::` for members,
// `\` for PHP namespaces, `-` for CSS-ish identifiers, `@` for scoped packages.
//
// ⚠ REFUSING IS NOT LOSING. The ref stays in the unresolved list, which is the honest record. A node
// labelled `entries()]` is not more information than an unresolved ref; it is less, because it looks
// like a finding.
const PLAUSIBLE_EXTERNAL = /^[A-Za-z_$@\\][A-Za-z0-9_$@\\.:-]*$/;

export function isPlausibleExternalName(label) {
  return PLAUSIBLE_EXTERNAL.test(String(label ?? ''));
}

// ⛔ A KEYWORD IS NOT A CALLEE — BUT ONLY IN THE LANGUAGE THAT RESERVES IT.
//
// Measured on this repository with a control (`readFileSync` returns 119, so the query can find
// real callees): 100 of 11,350 CALLS edges — 0.88% — target an External node labelled `new` (94) or
// `catch` (6). Every one is JavaScript-source. Nothing calls `new`; the extractor read `new Foo()`
// and `catch (e)` as call sites. `graph_callers("new")` would confidently return 94 callers.
//
// They survive the shape check above because `new` IS a valid identifier shape, and they are not in
// COMMON_NAMES (verified: `new`=false, `catch`=false).
//
// ⛔⛔ WITHDRAWN 2026-08-26 AFTER REVIEW: THE RESERVED-CALLEE RULE WAS FALSE, AND IT DELETED REAL EDGES.
//
// A guard here refused a language's reserved words as callees ("nothing calls `new`"). An outside
// review falsified it, and the counter-evidence is in this repository:
//
//   `promise.catch(() => null)` is an ordinary member call, and the extractor emits target `catch`
//   for it. Five of the six `catch` CALLS edges were real .catch() calls, at lsp-client.js:207,
//   cpp-clangd.js:148, lsp-collect.js:192, lock.js:22 and lsp-evidence.js:299. `o.delete()`,
//   `o.new()` and PHP member calls named `print`/`include` are legal for the same reason.
//
// ⛔ THE ROOT ERROR WAS AN ASSERTED CAUSE. I wrote "the extractor read `new Foo()` and `catch (e)`
// as call sites" from inspection of the LABELS alone. It was true for `new` (every site is
// `new Date()` / `new RegExp()`) and FALSE for `catch`, and I never checked the second half before
// building a rule on it.
//
// ⛒ AND IT IS NOT FIXABLE HERE. After member-target normalization the resolver sees the bare
// string `catch`; `catch (e)` and `promise.catch()` are indistinguishable at this point. The
// distinction exists only where the syntax does, in the extractor. Any future attempt belongs there,
// never in a predicate over a stripped label.

// Decide whether an unresolved ref should be materialized as an External
// terminal node or left in dirtyEdges. Dev's rule (from design discussion):
//  - CALLS: always materialize. Terminal hop in trace output.
//  - PASSES_THROUGH: always materialize. Middleware / framework hops are part
//    of the execution story even when the implementation lives outside repo.
//  - USES_TYPE: always materialize. High-signal; DI targets, facade classes,
//    etc. are real dependencies even if the framework source is excluded.
//  - REFERENCES: materialize only when target is clearly type-like to avoid
//    flooding with bare-name noise. "Type-like" = has a namespace/class
//    separator (\, ., ::) or starts with an uppercase segment.
//  - Other relations: leave dirty.
// Also skips COMMON_NAMES (close/open/get/etc.) to prevent hundreds of
// External nodes all labeled "get".
function shouldMaterializeExternal(ref) {
  if (!ref.from_id || !ref.target) return false;
  const label = normalizeExternalTarget(ref.target);
  if (!label) return false;
  // ⛔ A SHAPE POLICY FOR CREATION, NOT A TRUTH ABOUT THE LABEL — and the difference is why the
  // reserved-word half of this was withdrawn. See PLAUSIBLE_EXTERNAL: it is an ASCII pattern derived
  // from THIS repository's observed fragments, and review showed it also rejects `operator()`,
  // `save!`, `empty?`, `café`, `#private` and `@scope/pkg`. Declining to MINT a stub for those is a
  // tolerable cost, because the ref survives in `unresolved`; refusing an EDGE on the same pattern is
  // not, because that deletes evidence. So it stays here at creation and nowhere else.
  if (!isPlausibleExternalName(label)) return false;
  if (COMMON_NAMES.has(label)) return false;
  if (ref.relation === 'CALLS') return true;
  if (ref.relation === 'PASSES_THROUGH') return true;
  if (ref.relation === 'USES_TYPE') return true;
  if (ref.relation === 'REFERENCES') {
    if (/[\\.]|::/.test(label)) return true;
    const firstSeg = label.split(/[\\.::]/)[0] ?? '';
    if (firstSeg && firstSeg[0] >= 'A' && firstSeg[0] <= 'Z') return true;
    return false;
  }
  return false;
}

function createExternalNode(ref, rawTarget = ref.target) {
  const label = normalizeExternalTarget(rawTarget);
  // Same preference as the gate above, so a materialised External carries the language the
  // ref actually claimed rather than a framework name.
  const family = refLanguageFamily(ref);
  const id = `external:${createHash('sha1').update(`${family}:${label}`).digest('hex').slice(0, 16)}`;
  return {
    id,
    type: 'External',
    label,
    file_path: '',
    start_line: 0,
    end_line: 0,
    language: family === 'unknown' ? '' : family,
    confidence: ref.confidence ?? 0.5,
    structural_fp: '',
    dependency_fp: '',
    extra: {
      external: true,
      sourceExtractor: ref.extractor ?? '',
      sourceRelation: ref.relation ?? '',
    },
  };
}

export function resolveRefs({ db, refs, importContext = null }) {
  const resolvers = buildResolvers(db);
  const nodes = [];
  const seenNodeIds = new Set();
  const edges = [];
  const unresolved = [];

  function resolveOwner(ref) {
    if (!ref.from_target) return null;
    // An out-of-line member's owner is a TYPE or namespace, never a Method/Function.
    // Audit 2026-06-12 (echoes): a class with a same-named constructor (Method
    // `Engine` alongside class `Engine`) made findByLabel ambiguous, so hundreds
    // of out-of-line method CONTAINS owners failed to resolve (the bulk of the
    // `CONTAINS "undefined"` bucket). Prefer an owner-capable node first.
    const ownerCandidates = filterByLanguageFamily(resolvers.findByLabel(ref.from_target), ref)
      .filter((n) => OWNER_TYPES.has(n.type));
    if (ownerCandidates.length) {
      const pick = preferProximate(ownerCandidates, ref.source_file) ?? ownerCandidates[0];
      if (pick) return { node: pick, provenance: 'EXTRACTED' };
    }
    return resolveTarget({
      target: ref.from_target,
      source_file: ref.source_file,
      relation: ref.relation,
      extractor: ref.extractor,
      // ⛔ CARRIED, BECAUSE THIS RE-WRAP SILENTLY DROPPED IT. Rebuilding a ref here without
      // `language` sent the synthetic one back through the family gate with only the framework tag
      // to go on — so the FIRST and INTERMEDIATE links of a middleware chain kept materialising as
      // External while the last one bound correctly. Executing the real indexer is what showed the
      // split; reading the fix looked complete.
      language: ref.language,
    }, resolvers, importContext);
  }

  function registerNode(node) {
    if (seenNodeIds.has(node.id)) return;
    seenNodeIds.add(node.id);
    nodes.push(node);
    resolvers.addNode(node);
  }

  for (const ref of refs) {
    const symbolicChain = Boolean(ref.from_target) && !ref.to_id;
    if (symbolicChain && !SYMBOLIC_CHAIN_RELATIONS.has(ref.relation)) {
      unresolved.push(ref);
      continue;
    }

    let fromId = ref.from_id;
    if (ref.from_target) {
      const ownerNode = resolveOwner(ref);
      if (!ownerNode) {
        if (!symbolicChain) {
          unresolved.push(ref);
          continue;
        }
        // ⚠ THE THIRD WAY TO CREATE AN External, AND IT CONSULTS NO GATE — checked 2026-08-26 while
        // closing the re-binding hole, and deliberately left alone. This line takes ref.from_target
        // straight to createExternalNode with no plausibility check, and the target side below
        // short-circuits the gate the same way (`symbolicChain || shouldMaterializeExternal`).
        //
        // ⭐ MEASURED before deciding: ZERO External nodes in this repository's graph appear as the
        // from_id of any edge at all, so this line has produced nothing here. The control that makes
        // that zero readable is in the same measurement — the symbolic-chain relations do reach
        // External nodes 5,976 times on the TARGET side, so the relation set is very much in use.
        //
        // ⇒ No evidence, so no speculative guard — the same call already made for the importer's
        // upsertExternalNode. Recorded rather than fixed so the next reader neither overlooks it nor
        // hardens a path with no product. A repo whose framework refs fail to resolve their owner
        // would exercise it, and this note is what to check first if fragments ever appear as
        // sources.
        const sourceExternal = createExternalNode(ref, ref.from_target);
        registerNode(sourceExternal);
        fromId = sourceExternal.id;
      } else {
        fromId = ownerNode.node.id;
      }
    }

    if (ref.to_id) {
      edges.push({
        from_id: fromId,
        to_id: ref.to_id,
        relation: ref.relation,
        source_file: ref.source_file,
        source_line: ref.source_line,
        confidence: ref.confidence,
        provenance: ref.provenance ?? 'EXTRACTED',
        extractor: ref.extractor,
      });
      continue;
    }

    // ⛔⛔ THE RE-BINDING GATE THAT STOOD HERE WAS REVERTED 2026-08-26 AFTER REVIEW.
    //
    // The defect it addressed is real and still open: shouldMaterializeExternal governs CREATION,
    // but buildResolvers queries `nodes` with no type restriction, so a ref can bind to an External
    // that already exists and no admission rule runs at all. Demonstrated two ways —
    //   · a parse fragment (`execFileSync('git',`) survives re-index by re-binding, which made the
    //     residue self-perpetuating and stickier than a legitimate node;
    //   · a REFERENCES ref to a bare lowercase name gets 0 edges with no pre-existing External and
    //     1 edge when the stub is already there, so pre-existence ELEVATES a ref that policy refuses.
    //
    // ⛒ THE FIX WAS WRONG EVEN THOUGH THE DEFECT IS REAL. It refused edges using a label pattern
    // presented as a universal truth, and that pattern rejects `operator()`, `save!`, `#private` and
    // `@scope/pkg`. On this path a wrong rejection DELETES A REAL EDGE — the exact failure mode
    // preregistered as worse than the one being fixed. Reverting restores the known defect in place
    // of an unbounded one.
    //
    // ⇒ The successor must define ONE admission policy for External-bound edges covering creation and
    // binding together, and must not decide it from a stripped label. Recorded in
    // docs/2026-08-26-a-gate-on-creation-is-not-a-gate-on-the-edge.md.
    const targetNode = resolveTarget(ref, resolvers, importContext);
    if (!targetNode) {
      if (symbolicChain || shouldMaterializeExternal(ref)) {
        const externalNode = createExternalNode(ref);
        registerNode(externalNode);
        edges.push({
          from_id: fromId,
          to_id: externalNode.id,
          relation: ref.relation,
          source_file: ref.source_file,
          source_line: ref.source_line,
          confidence: ref.confidence,
          provenance: 'AMBIGUOUS',
          extractor: ref.extractor,
        });
        continue;
      }
      // Local-scope REFERENCES filter: bare lowercase single-token targets
      // whose label doesn't exist anywhere in the graph are almost certainly
      // local variables / parameters, not cross-scope references. They'd be
      // dropped from edges by the materialization guard above anyway — we
      // just also skip adding them to unresolved so they don't inflate the
      // trust=weak / unresolved-edges count with noise that will never be
      // fixable. Measured on lc-api: 425/500 unresolved refs were this
      // shape; on apg: 60/500. Dropping them honestly reports what's
      // actually actionable.
      if (
        ref.relation === 'REFERENCES'
        && /^[a-z][a-zA-Z0-9_]*$/.test(ref.target ?? '')
        && resolvers.findByLabel(ref.target).length === 0
      ) {
        continue;
      }
      unresolved.push(ref);
      continue;
    }

    // A SELF-EDGE ON AN OVERLOAD-MERGED NODE IS NOT PROVEN RECURSION.
    //
    // Node identity carries no signature, so all overloads of a name in a file
    // collapse to one node (see generic.js). A call from `render(int)` to
    // `render(Widget&)` therefore lands on the caller itself and reads as
    // recursion — a fabricated fact, and one an agent acts on (recursion changes
    // how you reason about a function).
    //
    // Real recursion is indistinguishable from this at the structural layer, so
    // the edge is kept and its provenance is downgraded to AMBIGUOUS rather than
    // asserted as EXTRACTED. A node that merges no overloads keeps full trust, so
    // genuine `factorial → factorial` is unaffected.
    const isSelfEdge = fromId === targetNode.node.id;
    const provenance = (isSelfEdge && mergesOverloads(targetNode.node))
      ? 'AMBIGUOUS'
      : (ref.provenance ?? targetNode.provenance ?? 'EXTRACTED');

    edges.push({
      from_id: fromId,
      to_id: targetNode.node.id,
      relation: ref.relation,
      source_file: ref.source_file,
      source_line: ref.source_line,
      confidence: ref.confidence,
      provenance,
      extractor: ref.extractor,
    });
  }

  return { nodes, edges, unresolved };
}
