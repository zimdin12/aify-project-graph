// #19: no instruction an agent reads may give the legacy v0.1 C++ collector as THE way to import code intel.
//
// `tools/code-intel/cpp-clangd/extract.mjs` is the source-scan v0.1 path. The compiler-backed path is v0.2:
// `apg code-intel collect cpp` (or the MCP verb graph_collect_code_intel) and then scripts/import-code-intel.mjs, which
// routes a v0.2 envelope to the validated importer since #19's step 2. AGENTS.md and install.pi.md already named v0.2
// first, but /graph-build-all's C++ step ran only extract.mjs, so the one skill that sets a repo up taught the legacy path.
//
// The unit is the section (heading to heading): wherever extract.mjs appears, its section must call it legacy AND name
// the v0.2 command, so a reader who copies the block has been shown the other one first.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SURFACES, repoPath } from '../../helpers/instruction-surfaces.js';

const LEGACY_COLLECTOR = /cpp-clangd\/extract\.mjs/u;
const CALLS_IT_LEGACY = /legacy/iu;
const NAMES_V02 = /code-intel collect|graph_collect_code_intel/u;

// A `# comment` inside a ```bash block is not a heading, so sections are cut only outside fences.
function sections(text) {
  const out = [[]];
  let fenced = false;
  for (const line of text.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    if (!fenced && /^#{1,6} /u.test(line)) out.push([]);
    out.at(-1).push(line);
  }
  return out.map((lines) => lines.join('\n'));
}

function sectionsTeachingOnlyLegacy(text) {
  return sections(text).filter((s) => LEGACY_COLLECTOR.test(s) && !(CALLS_IT_LEGACY.test(s) && NAMES_V02.test(s)));
}

describe('the legacy C++ collector is never the recommended import', () => {
  it('★★★ the detector flags a section that gives only extract.mjs and passes one that names v0.2 first (control)', () => {
    const shipped = '### 6. Optional C++ code-intel import\n\n```bash\nnode x/tools/code-intel/cpp-clangd/extract.mjs repo\n```\n';
    expect(sectionsTeachingOnlyLegacy(shipped)).toHaveLength(1);
    const labelledOnly = '## C++\nLegacy path:\nnode x/tools/code-intel/cpp-clangd/extract.mjs repo\n';
    expect(sectionsTeachingOnlyLegacy(labelledOnly), 'calling it legacy without naming v0.2 is not enough').toHaveLength(1);
    const corrected = '## C++\n```bash\nnode bin/apg.js code-intel collect cpp\n# Legacy v0.1:\nnode x/tools/code-intel/cpp-clangd/extract.mjs repo\n```\n';
    expect(sectionsTeachingOnlyLegacy(corrected)).toHaveLength(0);
    expect(sectionsTeachingOnlyLegacy('## A\ncode-intel collect\n## B\nlegacy: cpp-clangd/extract.mjs\n'),
      'v0.2 named in ANOTHER section does not count').toHaveLength(1);
  });

  it('★★★ no surface teaches it alone', () => {
    const offenders = SURFACES.flatMap((f) => sectionsTeachingOnlyLegacy(readFileSync(f, 'utf8'))
      .map((s) => `${repoPath(f)}: ${s.split(/\r?\n/u)[0]}`));
    expect(offenders).toEqual([]);
  });
});
