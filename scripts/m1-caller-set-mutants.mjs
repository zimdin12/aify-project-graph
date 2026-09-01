// Mutants for the M1 stop-condition test. Each is a distinct way that test could be worthless.
// Tree committed at 9860bdd before any mutation; each verified applied, then restored.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = 'C:/Docker/aify-project-graph';
const LSP = `${REPO}/mcp/stdio/code-intel/providers/lsp-collect.js`;
const TEST = 'tests/integration/m1-caller-sets-do-not-merge.test.js';

function runTest() {
  let out = '';
  try {
    out = execFileSync('npx', ['vitest', 'run', TEST, '--reporter=dot'],
      { cwd: REPO, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) { out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
  const clean = out.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const failed = clean.match(/Tests\s+(\d+) failed/);
  return failed ? `KILLED (${failed[1]} failed)` : 'SURVIVED';
}

// ── M-B: symbol identity becomes NAME-KEYED instead of site-keyed ────────────────────────────
// If two same-named methods share a symbolId, their reference sets collapse into one and the
// caller sets MUST merge. This is the property M1 actually claims.
{
  const original = fs.readFileSync(LSP, 'utf8');
  // ⚠ SINGLE-LINE ANCHOR. The first version spanned lines with \n and matched 0 times: this file
  // has CRLF terminators. A 0-match mutant is an INSTRUMENT failure and says nothing about the
  // product — it must never be read as SURVIVED.
  const from = 'return `${file}:${line}:${col}`;';
  const to = 'return `NAME_KEYED`;';
  const n = original.split(from).length - 1;
  if (n !== 1) {
    console.log(`[NOT APPLIED ${n} matches] M-B symbolId becomes name-keyed`);
  } else {
    fs.writeFileSync(LSP, original.replace(from, to), 'utf8');
    const applied = fs.readFileSync(LSP, 'utf8').includes('NAME_KEYED');
    const verdict = runTest();
    fs.writeFileSync(LSP, original, 'utf8');
    console.log(`${verdict}  applied=${applied}  M-B symbol identity is NAME-KEYED, not site-keyed`);
  }
}

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim();
console.log(`\nrestored clean: ${dirty === '' ? 'YES' : `NO -> ${dirty}`}`);
