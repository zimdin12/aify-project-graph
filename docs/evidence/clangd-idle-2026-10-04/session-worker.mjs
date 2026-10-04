// One "session": the APG code-intel verbs, run in-process the way an MCP server runs them, against one C++ repo.
// Makes 10 calls (references, definitions, hover) at positions DERIVED from the repo's own text, prints one JSON line
// per call, prints DONE, then stays alive like an idle MCP server until its parent kills it.
//
//   node session-worker.mjs <apgRepo> <subjectRepo> <label>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [apg, subject, label] = process.argv.slice(2);
const verbs = await import(pathToFileURL(join(apg, 'mcp/stdio/query/verbs/code_intel_live.js')).href);

// Positions: the first occurrence of each name in the file, as 1-based line/col. Derived, so a different fmt version
// still gets real identifiers; a name not found is reported, not replaced.
const TARGETS = [
  ['include/fmt/format.h', 'format_error'], ['include/fmt/format.h', 'vformat'], ['include/fmt/base.h', 'report_error'],
  ['include/fmt/base.h', 'vprint'], ['src/os.cc', 'buffered_file'],
];
const position = (file, name) => {
  const lines = readFileSync(join(subject, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = new RegExp(`\\b${name}\\b`, 'u').exec(lines[i]);
    if (m) return { file, line: i + 1, col: m.index + 1, name };
  }
  return { file, line: null, col: null, name };
};
// A subject may carry its own targets.json (written by prepare-copy.mjs from its own code); fmt uses the list above.
const targetsFile = join(subject, 'targets.json');
const positions = existsSync(targetsFile)
  ? JSON.parse(readFileSync(targetsFile, 'utf8'))
  : TARGETS.map(([f, n]) => position(f, n));
const calls = [
  ...positions.map((p) => ['references', p]),
  ...positions.slice(0, 3).map((p) => ['definitions', p]),
  ...positions.slice(0, 2).map((p) => ['hover', p]),
];
const fn = { references: verbs.codeIntelReferences, definitions: verbs.codeIntelDefinitions, hover: verbs.codeIntelHover };

for (const [kind, p] of calls) {
  const t0 = Date.now();
  let out;
  try {
    out = p.line === null ? { status: 'skipped_name_not_found' }
      : await fn[kind]({ repoRoot: subject, language: 'cpp', file: p.file, line: p.line, col: p.col, waitForReadyMs: 20000 });
  } catch (error) {
    out = { status: 'threw', error: String(error?.message ?? error).slice(0, 200) };
  }
  const count = Array.isArray(out?.references) ? out.references.length : Array.isArray(out?.definitions) ? out.definitions.length : null;
  console.log(JSON.stringify({ label, kind, name: p.name, file: p.file, line: p.line, ms: Date.now() - t0, status: out?.status ?? null, count, error: out?.error ?? out?.message ?? null }));
}
console.log(JSON.stringify({ label, done: Date.now() }));
setInterval(() => {}, 60_000);
