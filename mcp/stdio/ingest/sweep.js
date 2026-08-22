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

// ⛔ THE TWELVE-WORD ALLOWLIST IS DELETED. A DOCUMENT IS A DOCUMENT BY EXTENSION.
//
// What was here: admit if the basename starts with "readme", OR the name-without-extension is one
// of twelve English words, OR the directory path contains the substring "doc". Everything else
// was silently not a Document, and therefore not a node, and therefore invisible to every doc
// query in the product.
//
// MEASURED, on tracked markdown that survives the ignore layer:
//
//     aify-project-graph   151 tracked · 71 admitted · 80 REFUSED   (53.0%)
//     echoes_of_the_fallen 122 tracked · 103 admitted · 19 REFUSED  (15.6%)
//
// ⚠ AND NOT ONE OF THE 80 IS WHAT THE RULE WAS BUILT TO EXCLUDE. The comment it replaces said
// "skip trivial command docs, sparc modes, etc." A scan of all 80 for command/sparc/mode/template
// directories returns ZERO. What it actually refuses is the product's own documentation:
//
//     ATTRIBUTION.md · install.{claude,codex,cursor,hermes,opencode,pi}.md
//     integrations/*/skill/SKILL.md and 70 more SKILL.md files
//
// The SKILL.md files are the prose that tells an agent how to use this product, excluded because
// "skill" is not one of twelve words and `integrations/claude-code/skill/` does not contain the
// substring "doc".
//
// ⛔ AND THE ALLOWLIST DOES NOT EVEN OBEY ITSELF. `nameNoExt` strips only the LAST extension:
//
//     install.claude.md      -> "install.claude"   REFUSED, while `claude` IS on the list
//     AGENTS.MANAGER.md      -> "agents.manager"   REFUSED, while `agents` IS on the list
//
// ef-manager found the second on echoes, which adopted `NAME.QUALIFIER.md` independently for its
// most role-specific documents. Two repos, two conventions, one parsing accident: ANY
// `NAME.QUALIFIER.md` defeats the list even when NAME is on it.
//
// ★ THE DECIDING ARGUMENT IS NOT THE RATE, IT IS THAT THIS IS A SECOND EXCLUSION POLICY.
// This codebase has ONE exclusion mechanism — .gitignore, .aifyignore and IGNORED_DIRS, resolved
// by `loadEffectiveIgnoredDirs` — and it runs BEFORE this function. A filename-shaped second
// policy layered on top is the same defect as framework plugins walking with their own ignore
// list, fixed hours ago in `_plugin_utils.js`, and the same membership-by-name mechanism inverted
// out of the packet governed set before that. Three instances, one shape: a gate whose population
// is defined by names is left silently by choosing a name.
//
// ⇒ Exclusion belongs to the ignore layer. This function answers only "is this a document", and
// the honest answer is the extension. If a repo genuinely wants its command templates out, that
// is `.aifyignore`, which is reviewable, per-repo, and already exists.
//
// ⚠ THE COST IS NODE COUNT, AND IT IS BOUNDED AND MEASURED: this repo 71 -> 151 documents, echoes
// 103 -> 122. Not a flood, because the ignore layer has already pruned the trees where markdown
// multiplies.
function isDocument(relPath) {
  return DOCUMENT_EXTENSIONS.has(extname(relPath).toLowerCase());
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

// ⛔ HEADINGS ARE THE AUTHOR'S OWN STRUCTURAL CLAIM ABOUT SUBJECT MATTER, which is why they are
// the searchable surface and the body is not.
//
// MEASURED on this repo's 179 documents, over ten topics it genuinely discusses. Before this, the
// only searchable text for a document was its FILENAME and its title:
//
//     reachable by name|title      3 documents
//     headings would ADD          49
//     the lede would add          10 more
//     body-word presence         359     ⛔ NOT A TARGET
//
// ⚠ THE 359 IS THE TRAP, NOT THE GOAL. Ninety-six documents contain the word "overlay" somewhere;
// returning all of them for the query "overlay" is catastrophic precision, and treating word
// containment as evidence of aboutness is exactly the mistake that produced the legacy `mentions`
// extractor and its 2,533 unverifiable edges. Headings admit 14% of that population — a
// seventeen-fold gain in reachability from a strictly structural signal.
//
// ⇒ ADJACENT, NOT AMBIENT. The same property that separated the doc→symbol rules that survived
// held-out grading from the one deleted at 0.9311: the evidence must sit in a structure the author
// built, not in the ambient text. A heading is a claim; a mention is a coincidence.
//
// ⚠ AND IT IS NOT UNIVERSAL. Three of the ten topics — mutation, heartbeat, tokenizer — gain
// NOTHING from headings, because nobody wrote a heading about them. This rule reaches what authors
// chose to signpost and nothing else, and its recall is a floor by construction.
// ⚠ UP TO THREE LEADING SPACES, AND THE FOURTH IS THE WHOLE POINT. CommonMark makes an ATX
// heading indentable by 0–3 spaces; at 4 the line becomes an indented CODE BLOCK. So `   # Title`
// is a heading an author wrote and `    # cleanup` is a shell comment inside a code sample. My
// first version anchored at column 0, which was safe but lost real headings inside list items for
// no precision gain — and the test I wrote asserted the spec while the code did not implement it.
// Following the spec is both more correct and no more permissive.
const HEADING_LINE = /^ {0,3}#{1,6}\s+(\S.*)$/u;
const FENCE_LINE = /^ {0,3}(?:```|~~~)/u;

// Bounded so one enormous document cannot dominate the index. A cap that truncates silently is the
// defect this repo has fixed four times, so the flag travels with the value.
const HEADINGS_MAX_CHARS = 4000;

export function extractHeadings(content) {
  const out = [];
  let fenced = false;
  let chars = 0;
  let truncated = false;
  for (const line of content.split(/\r?\n/u)) {
    // A `#` inside a fence is a shell comment or a Python comment, not a heading.
    if (FENCE_LINE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = HEADING_LINE.exec(line);
    if (!m) continue;
    const text = m[1].replace(/\s+#+\s*$/u, '').trim();   // closing-hash style: `## Title ##`
    if (!text) continue;
    if (chars + text.length > HEADINGS_MAX_CHARS) { truncated = true; break; }
    out.push(text);
    chars += text.length;
  }
  return { headings: out, truncated };
}

// Exported so a control can pin its OUTPUT SHAPE against EXTRACTOR_VERSION. Changing what this
// returns without bumping that constant ships a feature that is inert on every existing graph —
// which is exactly what happened when `headings` was added, measured at 0 of 363 documents on a
// repository that had already been indexed.
export function extractDocumentMeta(content, relPath) {
  const lines = readLines(content).filter(Boolean);
  const first = lines[0] ?? basename(relPath);
  const title = first.replace(/^#+\s*/u, '').trim();
  // ⚠ THIS IS LINE 2, WHOLE — IT IS NOT TRUNCATED, though it reads like it. Markdown here is
  // hard-wrapped at ~90 columns, so the second line of a paragraph ends mid-sentence and the value
  // looks cut. I asserted a "~100-char truncation" in two documents on the strength of that
  // appearance, without reading this function. There is no truncation anywhere; there is a
  // one-line summary of a wrapped paragraph, which is a different and smaller problem.
  const summary = lines[1] ?? '';
  const { headings, truncated } = extractHeadings(content);
  return {
    title,
    summary,
    ...(headings.length ? { headings } : {}),
    ...(truncated ? { headings_truncated: true } : {}),
  };
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
      // ⛔ `text_not_admitted_as_document` IS RETIRED, NOT SET TO ZERO. It counted .md/.rst/.txt
      // that reached `isDocument()` and were refused — the 52.7% hole. `isDocument` is now exactly
      // the extension test, so the branch that incremented it was provably unreachable.
      //
      // ⚠ A KEY THAT CAN NEVER BE NON-ZERO IS WORSE THAN A MISSING ONE. It reads as a check still
      // running and finding nothing, which is precisely the inference an always-present zero is
      // supposed to license — so leaving it would have inverted the reason it was published in the
      // first place. The positive statement replaces it: every DOCUMENT_EXTENSION file that
      // survives the ignore layer becomes a Document, asserted in sweep-counts.test.js.
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
  } else if (repoRoot) {
    // ⛔ WITHOUT GIT'S ANSWER, NOTHING ELSE WAS CONSULTING .gitignore AT ALL.
    //
    // The branch above skips the manual .gitignore parser deliberately and correctly — git's own
    // candidate list is stricter and handles `!pattern` re-includes the parser drops. But when
    // there are NO candidates (a non-git checkout, or git unavailable), `ignoredDirs` kept its
    // default of the bare `IGNORED_DIRS` constant, so `.gitignore` was consulted by NOBODY on that
    // path.
    //
    // Measured on this repo with candidates suppressed: 742 Document nodes, 580 of them under
    // `reference/`, which `.gitignore:12` excludes — while `declined.ignore_rule` reported 1.
    //
    // ⚠ THE TWELVE-WORD DOC ALLOWLIST WAS MASKING IT. Almost every one of those 580 failed the
    // name test, so they never became nodes and the leak never showed. Deleting the allowlist in
    // this same commit is what made it visible — a latent defect surfaced by removing the thing
    // that was accidentally suppressing it, which is the honest order to find it in and the worst
    // order to ship it in.
    //
    // ★ IDENTICAL DEFAULT, IDENTICAL DEFECT, SECOND FILE TONIGHT. `walkFiles` in
    // `frameworks/_plugin_utils.js` defaulted to the same bare constant and leaked 1,046 files
    // past the same `.gitignore`. Two walkers, one fail-open default, and in both cases the strict
    // resolver was already written and simply not the default.
    ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);
  }
  const nodes = [];
  const edges = [];
  const prunedDirs = [];
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
        // ⚠ A PRUNED SUBTREE LEFT NO TRACE AT ALL, WHICH IS THE ONE THING THIS FILE EXISTS TO
        // STOP. `seen` deliberately counts files, and folding a subtree into it would make the
        // denominator mean two things — so the number here is DIRECTORIES, kept in its own field
        // and never summed with the file outcomes. `reference/` on this repo is one prune hiding
        // 580 documents; without this the sweep reports a corpus with no hint that a whole tree
        // was never enumerated, and the only way to find out is to measure from outside, which is
        // exactly how the 52.7% was found in the first place.
        prunedDirs.push(relPath === '.' ? entry.name : `${relPath}/${entry.name}`);
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
        // ⛔ A DIRECTORY IS A NODE BECAUSE IT CONTAINS SOMETHING, NOT BECAUSE IT EXISTS ON DISK.
        //
        // This used to call `ensureDirectory(entryRelPath)` here — eagerly, before knowing whether
        // anything inside would be admitted. On the normal path `ignoredDirs` is resolved with
        // `skipGitignore: true` (correct: git's candidate list is authoritative for FILES and
        // handles `!pattern` re-includes the manual parser drops), so a `.gitignore`d directory is
        // NOT pruned from the walk. The walk descended, minted a node per directory, and then
        // declined every file inside as `git_excluded`.
        //
        // MEASURED on this repo: 568 Directory nodes of which 343 are under `reference/` — 60% of
        // the graph's directory structure describing a tree it extracts NOTHING from. Zero Files,
        // zero Functions, 343 directories.
        //
        // ⚠ AND IT SURFACED THREE TIMES FROM THREE DIRECTIONS before anyone traced it: ef-manager
        // counting node TYPES under reference/, a walker default exposing 1,046 files there, and
        // two doc links resolving INTO it. An excluded tree that still has nodes is a
        // HALF-EXCLUSION, and every layer that walks the graph rediscovers it.
        //
        // ⇒ Directories are created lazily by the file branch below, which walks the parent chain
        // when a file is ADMITTED. A directory containing nothing admissible gets no node.
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
  // ⚠ DIRECTORIES, NOT FILES, AND KEPT OUT OF THE FILE ARITHMETIC ON PURPOSE. `seen` counts
  // candidate files and the admitted/declined buckets must sum to it exactly; a pruned subtree was
  // never enumerated, so folding it in would make the denominator mean two things. It is published
  // beside them because a corpus that silently omits a whole tree is how the 52.7% stayed hidden.
  counts.prunedDirs = prunedDirs.length;
  counts.prunedDirSample = prunedDirs.slice(0, 25);
  return { nodes, edges, counts };
}
