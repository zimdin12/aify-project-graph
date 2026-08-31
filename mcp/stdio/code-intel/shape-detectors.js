// SHAPE DETECTORS — syntactic candidates that make header/include routing incomplete.
//
// ⛔ THESE REPORT SPELLING COINCIDENCES, NEVER RESOLVED BINDINGS. I originally described detector
// 1 as "grep-level" while claiming a declaration PAIRS with a definition and that NO HEADER
// declares it. Pairing is semantic; a text match cannot establish it. Review caught the slide.
// Upgrading to a pairing claim needs parser/compiler identity and is a separate slice.
//
// ⛔ FORBIDDEN OUTPUT: "this defeats every include-graph query." That overclaims mechanism AND
// route — an include graph may model .cpp includes, and a repeated declaration may be harmless or
// outside the active build.
//
// Preregistered populations, identity rules, claim ceilings and controls:
// docs/evidence/shape-detectors/PREREGISTRATION.md
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const IMPL_EXTS = Object.freeze(['.c', '.cc', '.cpp', '.cxx', '.c++']);
export const HEADER_EXTS = Object.freeze(['.h', '.hh', '.hpp', '.hxx', '.h++', '.inc']);

const extOf = (p) => path.extname(String(p)).toLowerCase();
export const isImpl = (p) => IMPL_EXTS.includes(extOf(p));
export const isHeader = (p) => HEADER_EXTS.includes(extOf(p));

// An `extern`-prefixed declaration. Deliberately loose about the type and deliberately anchored on
// `extern`, because the alternative — inferring a declaration from shape — is the semantic step
// this detector does not take.
const EXTERN_DECL = /^\s*extern\s+[^;{]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

// A real preprocessor include directive. NOT a substring match: `.cpp` in prose or inside an
// ordinary string must not trigger detector 2.
const INCLUDE_DIRECTIVE = /^\s*#\s*include\s*(["<])([^">]+)[">]/;

const NON_CLAIMS = Object.freeze([
  'not a proven call edge',
  'not a proven build member',
  'not exhaustive',
  'not proof that the graph missed anything',
]);

/**
 * Detector 1 — a spelling declared `extern` in one implementation file, appearing in another,
 * and absent from every header in the enumerated population.
 *
 * ⚠ COMMENTS, STRING LITERALS AND INACTIVE `#if` BRANCHES ARE IN THE POPULATION. The scan cannot
 * distinguish them, so they are candidate sources and the finding SAYS SO rather than implying a
 * precision it does not have. Line continuations are not joined: a split declaration is a known
 * miss, disclosed.
 */
export function detectExternWithoutHeader({ files, readFile = (f) => fs.readFileSync(f, 'utf8') }) {
  const impls = files.filter(isImpl);
  const headers = files.filter(isHeader);
  const findings = [];

  const headerText = headers.map((h) => { try { return readFile(h); } catch { return ''; } }).join('\n');
  const implText = new Map();
  for (const f of impls) { try { implText.set(f, readFile(f)); } catch { implText.set(f, ''); } }

  for (const [file, text] of implText) {
    for (const line of String(text).split(/\r?\n/)) {
      const m = EXTERN_DECL.exec(line);
      if (!m) continue;
      const spelling = m[1];
      const spellingRe = new RegExp(`\\b${spelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`);
      if (spellingRe.test(headerText)) continue;                 // a header declares it: not this shape
      const alsoIn = [...implText.entries()]
        .filter(([f, t]) => f !== file && spellingRe.test(t)).map(([f]) => f);
      if (alsoIn.length === 0) continue;                          // no second implementation file
      findings.push({
        detector: 'candidate_extern_without_header',
        spelling,
        declaredIn: file,
        alsoIn,
        headersScanned: headers.length,
        observed: `the spelling "${spelling}" is declared with \`extern\` in ${file}, appears in `
          + `${alsoIn.length} other implementation file(s), and appears in none of the `
          + `${headers.length} header(s) scanned`,
        risk: 'this shape may make header/include-graph routing incomplete for this spelling',
        action: 'inspect compiler/TU/source evidence before an absence-dependent decision',
        nonClaims: [...NON_CLAIMS,
          'comments, string literals and inactive #if branches are INSIDE the scanned population, '
          + 'so any of these occurrences may be one of those',
          'overloads, namespaces, templates, operators, extern "C" and aliases are not resolved — '
          + 'two different symbols sharing this spelling produce one candidate'],
      });
    }
  }
  return dedupe(findings, (f) => `${f.detector}|${f.spelling}|${f.declaredIn}`);
}

/**
 * Detector 2 — a real `#include` directive whose target is an implementation file.
 *
 * ⚠ Commented and conditional directives DO trigger, and the finding discloses that the condition
 * was not evaluated. Macro-generated and line-continued includes are known misses.
 */
export function detectIncludedImplementationFile({ files, readFile = (f) => fs.readFileSync(f, 'utf8') }) {
  const findings = [];
  for (const file of files.filter((f) => isImpl(f) || isHeader(f))) {
    let text; try { text = readFile(file); } catch { continue; }
    const lines = String(text).split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = INCLUDE_DIRECTIVE.exec(line);
      if (!m || !isImpl(m[2])) return;
      findings.push({
        detector: 'implementation_file_textually_included',
        includedFile: m[2],
        includedFrom: file,
        line: i + 1,
        directiveForm: m[1] === '"' ? 'quoted' : 'angled',
        conditional: 'not evaluated — this scan does not track #if state',
        observed: `${file}:${i + 1} textually includes the implementation file "${m[2]}"`,
        risk: 'the build may use unity/jumbo translation units, so per-file compilation and '
          + 'include assumptions may not match the build',
        action: 'inspect the build\'s actual compile commands before an absence-dependent decision',
        nonClaims: [...NON_CLAIMS,
          'not proof this is a unity build — the build system was not consulted',
          'not a statement about which translation unit contains anything'],
      });
    });
  }
  return dedupe(findings, (f) => `${f.detector}|${f.includedFrom}|${f.includedFile}`);
}

/**
 * The C/C++ source population, from git.
 *
 * ⚠ GIT-TRACKED ONLY, and that is the preregistered population — not a filesystem walk. A walk
 * would pull in build outputs and vendored trees that the graph itself excludes, so the detector
 * would be scanning a different repo than every other instrument here.
 *
 * ⚠ BOUNDED. A repo with more sources than the cap returns [] rather than a truncated sample: a
 * partial scan would make "no candidate shapes found" mean "none in the first N files", which is
 * the silent-scope-narrowing failure an agent named as the more expensive one.
 */
export function listRepoSourceFiles(repoRoot, { cap = 2000, exec } = {}) {
  if (!repoRoot) return [];
  try {
    const run = exec ?? ((args) => execFileSync('git', args,
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const out = run(['ls-files']);
    const all = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .filter((f) => isImpl(f) || isHeader(f))
      .map((f) => path.join(repoRoot, f));
    return all.length > cap ? [] : all;
  } catch {
    return [];
  }
}

/**
 * Run both detectors and render them as warning lines for an EMPTY caller set.
 *
 * ⛔ EMPTY RESULTS ONLY, DELIBERATELY. A field agent's complaint was that the same caveat block
 * renders whether or not it bears on the decision — "which trains me to skim it in the one case
 * where it decides everything." A shape that might hide a caller is irrelevant to a result that
 * already FOUND one, and attaching it there would manufacture exactly that wallpaper.
 *
 * Another agent asked what a zero would have to show to be distrusted correctly. Its first answer
 * was "construct coverage stated as what it does NOT model". This is that, scoped to the two
 * shapes we can actually detect.
 *
 * ⚠ Returns [] on any failure. A detector that throws must not take down a caller set that is
 * otherwise valid — these are advisory, and advisory failures fail quiet.
 */
export function shapeWarningsForEmptyResult({ files, readFile } = {}) {
  if (!Array.isArray(files) || files.length === 0) return [];
  try {
    const lines = [];
    for (const f of detectExternWithoutHeader({ files, ...(readFile ? { readFile } : {}) })) {
      lines.push(`CANDIDATE SHAPE (not a proven caller): "${f.spelling}" is declared \`extern\` in `
        + `${f.declaredIn} and appears in ${f.alsoIn.join(', ')}, but in none of the ${f.headersScanned} `
        + 'header(s) scanned. A header/include-graph route would not connect them. This is a spelling '
        + 'match, not a resolved binding — comments, strings and inactive #if branches are in scope. '
        + 'Inspect the source before treating an empty caller set as an absence.');
    }
    for (const f of detectIncludedImplementationFile({ files, ...(readFile ? { readFile } : {}) })) {
      lines.push(`CANDIDATE SHAPE (not a proven build fact): ${f.includedFrom}:${f.line} textually `
        + `includes the implementation file "${f.includedFile}". The build may use unity/jumbo `
        + 'translation units, so per-file compile assumptions may not match it. The build system was '
        + 'NOT consulted. Inspect the actual compile commands before treating an empty caller set as '
        + 'an absence.');
    }
    return lines;
  } catch {
    return [];
  }
}

function dedupe(findings, keyOf) {
  const seen = new Set();
  return findings.filter((f) => { const k = keyOf(f); if (seen.has(k)) return false; seen.add(k); return true; });
}
