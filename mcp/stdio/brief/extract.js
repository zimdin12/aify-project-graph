// BRIEF INPUTS READ FROM THE FILESYSTEM — package manifests, git history, and the extractor's
// own manifest. Nothing here touches the graph database.
//
// The axis is DATA SOURCE, which the refactor-proposal audit established is the real seam:
// classifying every function by what it reads (db / artifact / neither) splits this file where
// it actually divides, and NOT on the topical grouping the proposal first guessed at.
//
// ⚠ generateBrief deliberately did NOT move here even though it also takes `repoRoot`. It is
// the composition root — the only place each analysis function is called, exactly once each —
// and relocating it into a helper module would move the orchestration, not the seam.

import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadFunctionality, validateAnchors, hasOverlay, featuresForFile, validateFeatureEdges } from '../overlay/loader.js';

// Canonical "real entry" detection: combines filesystem evidence (package.json
// main/bin, shebang lines, well-known entry filenames) with graph-indexed
// Entrypoint/Route nodes. Filesystem findings rank above graph-heuristic
// entries because graph Entrypoint classification fires on any `index.*`,
// which frequently misses the actual program entry (e.g., server.js / app.py).
// Extract major libraries/runtimes from package manifests so the brief can
// emit a TOOLING line. Bench 2026-04-20 found that orient-style answers were
// downgraded when the brief never named the underlying tool (e.g. tree-sitter
// for an extraction subsystem). This is cheap deterministic signal pulled
// from manifests at brief-gen time.
export function extractTooling(repoRoot) {
  const tooling = [];
  const seen = new Set();
  const add = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    tooling.push(name);
  };

  const pkg = readJsonSafe(join(repoRoot, 'package.json'));
  if (pkg?.dependencies) {
    for (const name of Object.keys(pkg.dependencies)) {
      if (name.startsWith('@types/')) continue;
      add(name);
    }
  }

  const reqPath = join(repoRoot, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      const lines = readFileSync(reqPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
        const name = trimmed.split(/[<>=!~;\s]/)[0].trim();
        if (name) add(name);
      }
    } catch {}
  }

  const pyproj = join(repoRoot, 'pyproject.toml');
  if (existsSync(pyproj)) {
    try {
      const text = readFileSync(pyproj, 'utf8');
      // Poetry / uv table form: [tool.poetry.dependencies] qdrant-client = "^1.9"
      const tableBlock = text.match(/\[(?:tool\.poetry\.dependencies|tool\.uv\.dependencies)\][\s\S]*?(?=\n\[|$)/);
      if (tableBlock) {
        const matches = [...tableBlock[0].matchAll(/^\s*"?([a-zA-Z][a-zA-Z0-9_.-]+)"?\s*[=:]/gm)];
        for (const m of matches) {
          if (m[1].toLowerCase() !== 'python') add(m[1]);
        }
      }
      // PEP-621 array form: dependencies = [ "qdrant-client>=1.9", "openai>=1.0" ]
      const arrMatch = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
      if (arrMatch) {
        const items = [...arrMatch[1].matchAll(/"\s*([a-zA-Z][a-zA-Z0-9_.-]+)/g)];
        for (const m of items) add(m[1]);
      }
    } catch {}
  }

  const cargoPath = join(repoRoot, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const text = readFileSync(cargoPath, 'utf8');
      const depBlock = text.match(/\[dependencies\][\s\S]*?(?=\n\[|$)/);
      if (depBlock) {
        const matches = [...depBlock[0].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_-]+)\s*=/gm)];
        for (const m of matches) add(m[1]);
      }
    } catch {}
  }

  const goMod = join(repoRoot, 'go.mod');
  if (existsSync(goMod)) {
    try {
      const text = readFileSync(goMod, 'utf8');
      const requires = [...text.matchAll(/^\s*([a-z0-9.\-/]+)\s+v[\d.]+/gm)];
      for (const m of requires) {
        const path = m[1];
        const name = path.split('/').pop();
        add(name);
      }
    } catch {}
  }

  const composer = readJsonSafe(join(repoRoot, 'composer.json'));
  if (composer?.require) {
    for (const dep of Object.keys(composer.require)) {
      if (dep === 'php' || dep.startsWith('ext-')) continue;
      add(dep.split('/').pop());
    }
  }

  return tooling.slice(0, 6);
}
export function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
export function detectFromPackageJson(repoRoot) {
  const pkg = readJsonSafe(join(repoRoot, 'package.json'));
  if (!pkg) return [];
  const out = [];
  if (typeof pkg.main === 'string') out.push({ file: pkg.main, why: 'package.json main', source: 'pkg' });
  if (pkg.bin) {
    const bins = typeof pkg.bin === 'string' ? [['bin', pkg.bin]] : Object.entries(pkg.bin);
    for (const [name, file] of bins) out.push({ file, why: `bin: ${name}`, source: 'pkg' });
  }
  return out;
}
// ---------- document recency, for ranking LINKED DOCUMENT CANDIDATES ----------
//
// ⚠ THIS HEADING USED TO SAY "for ranking what to read first" AND THAT CLAIM IS WITHDRAWN. The
// ranking failed 0 of 2 ground-truth corpora and the output no longer asserts a read order (see
// 310fc64). Prose that still instructs the next maintainer to restore it is how a withdrawn claim
// comes back — graph-senior-dev flagged exactly this while approving the withdrawal.
//
// ⛔ ef-manager REFUTED THE SIGNAL I WOULD HAVE REACHED FOR FIRST, with data, before proposing this
// one. Their hypothesis was that a stale document's references fail to resolve, so resolution rate
// should separate current from stale using misses already recorded per document. Measured:
//
//     README.md                     47 edges · 122 misses ·  28%  · last commit 2026-08-20
//     plans/2026-04-16-...-v1.md    43 edges ·  67 misses ·  39%  · last commit 2026-04-16
//     plans/2026-05-09-code-intel   19 edges ·   3 misses ·  86%  · last commit 2026-05-09
//
// ⇒ IT ANTI-CORRELATES. Four-month-old plans resolve at 65-86%; documents updated this month at
// 28-29%. Resolution rate is a GENRE signal, not a currency one — a plan is nearly all code
// references so it resolves, while a README is prose about commands, config keys and external
// projects, spans that were never going to resolve. It measures "what fraction of this document is
// code references" and reads as "how much of this document is still true".
//
// ★ The signal that survives is the one thing about a document its own content cannot fake: when
// someone last touched it.
//
// ONE git call for every path, not one per document — 155 documents here.
// ⚠ Fixed output for a fixed HEAD, matching this file's cache discipline: dates come from history,
// not from the clock, so regenerating the brief without moving HEAD produces identical output.
export function documentRecency(repoRoot, paths = []) {
  const out = new Map();
  if (!Array.isArray(paths) || paths.length === 0) return out;
  // ⛔ BOUNDED BATCHES AND NUL-DELIMITED OUTPUT, both flagged by graph-senior-dev before this
  // shipped. Passing every path as argv exceeds the command-line limit on a doc-heavy repo, and
  // the failure mode is the worst available: ONE oversized call throws, the catch returns an empty
  // map, and EVERY document silently becomes UNKNOWN — the ranking loses a whole signal and says
  // nothing. Batching means a failure costs one batch, and the rest still carry dates.
  //
  // ⚠ Line-splitting was also unsafe: git quotes paths containing spaces, non-ASCII or newlines
  // unless told otherwise. `-z` makes every record NUL-terminated, so a path is whatever lies
  // between two NULs regardless of what characters it holds.
  //
  // ⚠ The `@` sentinel makes the record TYPE unambiguous rather than inferred from shape. Without
  // it a file named `2026-04-16` would parse as a date and silently re-date every path after it.
  // A path named exactly `@YYYY-MM-DD` would still collide; that is the residual and it is stated
  // rather than assumed away.
  // The requested population, so a decoded key that nobody asked for can be refused rather than
  // stored. git reports every path a matching commit touched; the pathspec narrows that, but a
  // parser bug does not respect a pathspec.
  const requested = new Set(paths);
  const BATCH = 150;
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    try {
      const raw = execFileSync('git',
        ['-C', repoRoot, 'log', '--format=@%cs', '--name-only', '-z', '--', ...batch],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      let date = null;
      // ⛔⛔ `.trim()` WAS HERE AND IT DESTROYED PATH BYTES. It removed git's structural newline and
      // also any leading or trailing whitespace belonging to the FILENAME. graph-senior-dev
      // committed a tracked file named exactly ` leading.md` and called this function with it:
      //
      //     asked   [" leading.md"]
      //     keys    ["leading.md"]        <- an unrequested key
      //     missing [" leading.md"]       <- the requested path, UNKNOWN
      //
      // The map filled with a wrong key while the real path went undated — the exact class the
      // "ONLY paths asked about" assertion claims to prevent, which my own test missed because it
      // used friendly names. A blunt fix for a structural problem destroys real data at the edges.
      //
      // ⇒ PARSE THE PROTOCOL, DO NOT SCRUB IT. Measured byte shape of `--format=@%cs --name-only -z`:
      //
      //     @2026-08-20 NUL \n  leading.md NUL a.md NUL d/c.md NUL @2026-08-19 NUL \n ...
      //
      // git emits EXACTLY ONE newline after the date record's NUL, prefixing the first path of that
      // commit. Nothing else is structural, so exactly that one byte is consumed and every other
      // byte belongs to the filename — including a leading space, tab or newline.
      let afterDate = false;
      for (const record of raw.split('\0')) {
        let rec = record;
        if (afterDate && rec.startsWith('\n')) rec = rec.slice(1);  // the one structural byte
        afterDate = false;
        if (!rec) continue;
        if (/^@\d{4}-\d{2}-\d{2}$/.test(rec)) { date = rec.slice(1); afterDate = true; continue; }
        // ⛔ AND THE POPULATION GUARD IS THE EXECUTABLE FORM OF "ONLY PATHS ASKED ABOUT". A decoded
        // key that nobody requested is a parse failure wearing a result, and it is how both
        // transport bugs presented — a filled map that looked like success.
        if (date && requested.has(rec) && !out.has(rec)) out.set(rec, date);
      }
    } catch {
      // One batch failing leaves its paths absent — UNKNOWN, never "old". The other batches stand.
    }
  }
  return out;
}

// ---------- L3 lite: recent-activity from git log (A1 item #9) ----------
//
// Cache-discipline: use fixed commit count (not --since=30.days) so the same
// repo HEAD produces the same output regardless of when the brief is
// regenerated. Prompt-cache survives as long as HEAD doesn't move.
export function recentActivity(repoRoot, limit = 5) {
  try {
    const out = execFileSync('git',
      ['-C', repoRoot, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(limit)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [sha, author, date, subject] = line.split('|');
      return { sha, author, date, subject };
    });
  } catch {
    return []; // Not a git repo — skip section
  }
}
// Recent commits with touched-files + feature attribution. Used by
// brief.plan.md to show "what's been changing where." Fixed commit count
// keeps prompt-cache stable.
export function recentActivityWithFiles(repoRoot, features, limit = 10) {
  try {
    const raw = execFileSync('git',
      ['-C', repoRoot, 'log', '--name-only', '--pretty=format:===%h|%an|%ad|%s', '--date=short', '-n', String(limit)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const commits = [];
    let current = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('===')) {
        if (current) commits.push(current);
        const [sha, author, date, subject] = line.slice(3).split('|');
        current = { sha, author, date, subject, files: [], features: new Set() };
      } else if (line.trim() && current) {
        current.files.push(line.trim());
        const featureIds = featuresForFile(features, line.trim());
        for (const id of featureIds) current.features.add(id);
      }
    }
    if (current) commits.push(current);
    return commits.map(c => ({
      sha: c.sha, author: c.author, date: c.date, subject: c.subject,
      files: c.files, features: [...c.features],
    }));
  } catch {
    return [];
  }
}
// Trust/health signal. Must be a ROUTING line, not comfort text — the agent
// should change strategy when trust is weak (e.g., prefer direct file reads
// over graph queries). Issues are phrased actionably.
// Read manifest.dirtyEdges and group by relation + extractor. Coarse, honest
// breakdown — no speculative cause labels. Returns null if the manifest isn't
// readable (e.g. before first index).
export function summarizeUnresolvedFromManifest(repoRoot) {
  try {
    const path = join(repoRoot, '.aify-graph', 'manifest.json');
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const refs = raw.dirtyEdges ?? [];
    if (refs.length === 0) return { total: 0, byRelation: {}, byLanguage: {} };
    const byRelation = {};
    const byLanguage = {};
    for (const ref of refs) {
      const rel = ref.relation || 'UNKNOWN';
      const lang = ref.extractor || 'unknown';
      byRelation[rel] = (byRelation[rel] ?? 0) + 1;
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    }
    return { total: refs.length, byRelation, byLanguage };
  } catch {
    return null;
  }
}
