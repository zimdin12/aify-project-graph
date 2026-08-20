// ONE FIRST-PARTY WALK FOR EVERY LSP PROVIDER.
//
// ⛔ WHY THIS FILE EXISTS: A SECOND ENUMERATOR IS A SECOND OPINION ABOUT WHAT THE REPO IS.
//
// `reference/` is `.gitignore:12` on this project. The sweep excludes it. The code-intel
// collectors did not, because each carried its own hardcoded name list:
//
//   ts-langserver  node_modules dist build out coverage .git .next .cache vendor
//   pyright        .venv venv env site-packages __pycache__ .git node_modules build dist
//                  .tox .mypy_cache .pytest_cache
//
// Neither mentions `reference/`, and the two do not even agree with each other — `vendor` is
// excluded from TypeScript collection and included in Python collection, which is a decision
// nobody made. Measured consequence on this repo at 67bfffe:
//
//     1,196 nodes under reference/     1,172 Symbol + 24 File, ALL language "typescript"
//     1,370 of 4,487 LSP edges (30.5%) point into reference/
//       205 of 4,487 (4.6%) point into node_modules/
//     → 35.1% of the trust spine was compiler-verified evidence about files the corpus EXCLUDES
//
// It also regressed a92a66a, which had taken `reference/` to zero nodes two hours earlier — the
// sweep stopped creating them and the collector put them back. Fifth surfacing of `reference/`,
// and the first that undid a fix rather than showing a new face of the same gap.
//
// ★ THE RULE THIS ENCODES: MEMBERSHIP IN THE CORPUS IS ONE QUESTION WITH ONE ANSWER, derived from
// the repository's own configuration (.gitignore / .aifyignore / .aifyinclude) rather than
// re-listed per consumer. A list you must remember to update in four places is a defect with a
// delay on it, and this is the fourth walker to prove it.
//
// Language-specific exclusions remain possible — `site-packages` is a real Python concern — but
// they ADD to the derived set and can never replace it.
import fs from 'node:fs';
import path from 'node:path';
import { loadEffectiveIgnoredDirs, isIgnoredDirName } from '../ingest/ignored-dirs.js';

/**
 * Walk `projectRoot` for first-party source files of the given extensions.
 *
 * @param {string} projectRoot
 * @param {object}   o
 * @param {Set<string>} o.exts            file extensions to collect, lowercase, dot-prefixed
 * @param {number}   [o.maxFiles]         hard cap; reported as `truncated` when hit
 * @param {string[]} [o.extraSkipDirs]    language-specific additions to the derived exclusions
 * @param {(name:string)=>boolean} [o.skipFile]  optional per-file rejection (e.g. `.d.ts`)
 * @returns {{files: string[], stats: object}}
 */
export function enumerateFirstPartyFiles(projectRoot, {
  exts,
  maxFiles = 200,
  extraSkipDirs = [],
  skipFile = null,
} = {}) {
  // Derived from the repo, not declared here. `.gitignore` entries, `.aifyignore` additions and
  // `.aifyinclude` re-inclusions all land in this set, so the collector and the sweep answer
  // "is this file part of the corpus" the same way.
  const ignoredDirs = loadEffectiveIgnoredDirs(projectRoot);
  for (const extra of extraSkipDirs) ignoredDirs.add(extra);

  const files = [];
  const excludedDirs = new Set();
  let scanned = 0;
  let truncated = false;

  const walk = (dir) => {
    if (files.length >= maxFiles) { truncated = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (files.length >= maxFiles) { truncated = true; return; }
      if (ent.isDirectory()) {
        // ⚠ Recorded, not merely skipped. A collection that silently walks past a third of the
        // repo reports the same shape as one that had nothing to walk past, and this project has
        // already shipped that confusion at the sweep layer.
        if (isIgnoredDirName(ent.name, ignoredDirs) || ent.name.startsWith('.')) {
          excludedDirs.add(path.relative(projectRoot, path.join(dir, ent.name)).replace(/\\/g, '/'));
          continue;
        }
        walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!exts.has(ext)) continue;
        if (skipFile && skipFile(ent.name)) continue;
        scanned += 1;
        files.push(path.relative(projectRoot, path.join(dir, ent.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(projectRoot);

  return {
    files,
    stats: {
      total: scanned,
      after_filter: files.length,
      truncated,
      max_files: maxFiles,
      excluded_dirs: excludedDirs.size,
      excluded_dir_sample: [...excludedDirs].sort().slice(0, 10),
    },
  };
}
