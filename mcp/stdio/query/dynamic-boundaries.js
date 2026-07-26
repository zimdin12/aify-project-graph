// Dynamic-dispatch boundary detection (borrowed concept: codegraph #687
// dynamic-boundaries + agent-code-intel comment/string masking, MIT — see
// ATTRIBUTION.md).
//
// When a static trace can't connect two symbols, the break is almost always a
// dynamic-dispatch site: a computed member call, a dynamic import, getattr /
// reflection, a typed message bus, a member-function pointer. Guessing the
// missing edge is rejected (silent beats wrong — a wrong edge poisons the map).
// Instead we ANNOUNCE the boundary honestly: the exact site where the static
// path ends, the dispatch form, and a statically-visible key when one exists.
//
// Detection is deterministic regex over the comment/string-BLANKED body of the
// symbols involved, at QUERY TIME only — the graph is never mutated, and an
// unbroken flow never triggers a scan. Matching runs on blanked text (so
// commented-out / string-embedded code can't fire) while snippets + keys are
// sliced from the ORIGINAL at the same offsets (the blanker preserves offsets).

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Scan budget. Declared here (above its first use) rather than beside the
// scanner, because readSymbolBody caps its slice to the same value.
const MAX_BODY_CHARS = 60000;

// Read a graph node's source body (its start_line..end_line slice). Shared by
// every verb that scans for boundaries so the slicing rule stays in one place.
// Returns '' on any failure — a boundary scan is always best-effort.
//
// This runs on a QUERY path, so it is bounded twice: a generated/vendored file
// far larger than any real symbol body is skipped outright, and the returned
// slice is capped at the scanner's own budget (a bigger slice would be truncated
// by scanDynamicBoundaries anyway, so reading more buys nothing).
const MAX_SOURCE_FILE_BYTES = 4_000_000;
export function readSymbolBody(repoRoot, node) {
  if (!node?.file_path) return '';
  try {
    const path = join(repoRoot, node.file_path);
    if (statSync(path).size > MAX_SOURCE_FILE_BYTES) return '';
    const all = readFileSync(path, 'utf8').split('\n');
    const from = Math.max(0, (node.start_line || 1) - 1);
    const to = Math.min(all.length, node.end_line || all.length);
    return all.slice(from, to).join('\n').slice(0, MAX_BODY_CHARS);
  } catch { return ''; }
}

// Blank the CONTENTS of comments and string literals (quotes preserved, every
// other char/newline preserved so offsets line up with the original). C-family
// uses // and /* */ + ' " ` strings; Python uses # + ' " strings.
export function blankCommentsAndStrings(src, language) {
  const py = language === 'python' || language === 'py';
  if (typeof src !== 'string' || !src) return src || '';
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (!py && c === '/' && c2 === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
    if (py && c === '#') { let j = i + 1; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
    if (!py && c === '/' && c2 === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j = Math.min(n, j + 2); blank(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) break;
        if (q !== '`' && src[j] === '\n') break; // ' and " don't span lines
        j++;
      }
      blank(i + 1, j); // keep the quote chars, blank the contents
      i = (src[j] === q ? j + 1 : j);
      continue;
    }
    i++;
  }
  return out.join('');
}

const JS_FAMILY = new Set(['typescript', 'javascript', 'ts', 'js', 'tsx', 'jsx']);
const PY = new Set(['python', 'py']);
const CPP = new Set(['cpp', 'c', 'c++']);

// Exactly one quoted literal and nothing else interesting → that literal is the key.
function singleStringLiteral(text) {
  const m = String(text).match(/(['"`])([\w.:/-]{1,64})\1/);
  return m ? m[2] : undefined;
}

const FORMS = [
  {
    form: 'computed-call', label: 'computed member call', langs: JS_FAMILY,
    re: /[\w$)\]]\s*\[([^[\]\n]{1,80})\]\s*\(/g,
    keyFrom: (m) => { const k = singleStringLiteral(m[1]); return k ? { key: k } : null; },
  },
  {
    form: 'dynamic-import', label: 'dynamic import', langs: JS_FAMILY,
    re: /\b(?:import|require)\s*\(\s*(?!['"`)\s])/g,
  },
  {
    form: 'proxy-reflect', label: 'Proxy/Reflect dispatch', langs: JS_FAMILY,
    re: /\bnew\s+Proxy\s*\(|\bReflect\.(?:get|apply|construct)\s*\(/g,
  },
  {
    form: 'dynamic-import', label: 'dynamic import', langs: PY,
    re: /\bimportlib\.import_module\s*\(|\b__import__\s*\(/g,
  },
  {
    form: 'getattr-dispatch', label: 'getattr / setattr dispatch', langs: PY,
    re: /\b(?:getattr|setattr)\s*\(\s*\w/g,
    keyFrom: (m) => { const k = singleStringLiteral(m[0]); return k ? { key: k } : null; },
  },
  {
    form: 'member-pointer', label: 'member-function pointer call', langs: CPP,
    // (obj->*ptr)(args) / (obj.*ptr)(args) — the call wraps the member-ptr expr
    // in parens, so allow an optional `)` between the name and the call `(`.
    re: /(?:->\*|\.\*)\s*\w+\s*\)?\s*\(|\bstd::invoke\s*\(/g,
  },
  {
    // Typed message bus (MediatR / CQRS / event bus): the request TYPE is the
    // key; the conventional handler is `<Type>Handler`. Language-agnostic.
    form: 'typed-bus', label: 'typed message dispatch',
    re: /\.(?:[Ss]end|[Pp]ublish|[Dd]ispatch|[Ee]xecute|[Ee]mit)(?:Async)?\s*(?:<[^<>\n]{0,80}>)?\s*\(\s*new\s+([A-Z]\w*)/g,
    keyFrom: (m) => (m[1] ? { key: m[1], keyIsType: true } : null),
  },
];

const MAX_MATCHES = 4;

function normLang(language) {
  const l = String(language || '').toLowerCase();
  if (l === 'c++') return 'cpp';
  return l;
}

/**
 * Scan one symbol body for dynamic-dispatch boundaries.
 *   source     — the raw body text (original, un-blanked).
 *   language   — node language.
 *   baseLine   — 1-based file line of the body's first line (so reported lines
 *                are absolute/file-relative).
 * Returns up to MAX_MATCHES { form, label, snippet, line, key, keyIsType }.
 */
export function scanDynamicBoundaries({ source, language, baseLine = 1 }) {
  if (typeof source !== 'string' || !source) return [];
  const lang = normLang(language);
  const text = source.length > MAX_BODY_CHARS ? source.slice(0, MAX_BODY_CHARS) : source;
  const blanked = blankCommentsAndStrings(text, lang);
  const results = [];
  const seen = new Set();
  for (const spec of FORMS) {
    if (spec.langs && !spec.langs.has(lang)) continue;
    const re = new RegExp(spec.re.source, spec.re.flags);
    let m;
    while ((m = re.exec(blanked)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      const start = m.index;
      // Slice snippet + key material from the ORIGINAL at the same offsets.
      const origMatch = text.slice(start, start + m[0].length);
      const lineStart = text.lastIndexOf('\n', start) + 1;
      let lineEnd = text.indexOf('\n', start);
      if (lineEnd === -1) lineEnd = text.length;
      const snippet = text.slice(lineStart, lineEnd).trim().slice(0, 160);
      const line = baseLine + (text.slice(0, start).match(/\n/g)?.length ?? 0);
      let keyInfo = null;
      if (spec.keyFrom) {
        // Re-run the regex's capture groups on the ORIGINAL slice for the key.
        const om = new RegExp(spec.re.source).exec(origMatch + text.slice(start + m[0].length, start + m[0].length + 80));
        keyInfo = spec.keyFrom(om || m);
      }
      const dedupe = `${spec.form}:${keyInfo?.key ?? ''}:${line}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      results.push({ form: spec.form, label: spec.label, snippet, line, key: keyInfo?.key, keyIsType: keyInfo?.keyIsType });
      if (results.length >= MAX_MATCHES) return results;
    }
  }
  return results.sort((a, b) => a.line - b.line);
}

// Render the detected boundaries as a compact text block for a verb to append.
export function renderDynamicBoundaries(matches, { symbolLabel } = {}) {
  if (!matches || matches.length === 0) return '';
  const lines = [`DYNAMIC-DISPATCH BOUNDARY${symbolLabel ? ` in ${symbolLabel}` : ''} — the static path most likely ends here (not a wrong edge, an honest boundary):`];
  for (const m of matches) {
    const keyBit = m.key
      ? ` → key ${m.keyIsType ? `type "${m.key}" (handler ~ ${m.key}Handler)` : `"${m.key}"`}`
      : ' → runtime key (no static target)';
    lines.push(`  L${m.line} ${m.label}${keyBit}:  ${m.snippet}`);
  }
  lines.push('  Shortlist candidate targets by that key, or read the site — a static edge here would be a guess.');
  return lines.join('\n');
}
