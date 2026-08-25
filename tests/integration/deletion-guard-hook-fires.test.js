import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../mcp/stdio/storage/db.js';

// ⭐⭐ THE POSITIVE CONTROL FOR A FAIL-SILENT FEATURE, AND IT IS NOT OPTIONAL.
//
// This hook's contract is that it never throws, never blocks, and stays quiet on every path it
// cannot serve. That contract makes a BROKEN hook and a CORRECTLY-QUIET hook the same observation:
// both print nothing and exit 0. Every check you can run against it looks identical either way.
//
// ⛔ AND IT ALREADY HAPPENED, IN THE FIRST DRAFT. `openExistingDb` takes a PATH and THROWS when it
// is missing; I passed it a repo ROOT. The throw was caught by the hook's own silence contract, so
// the feature would have shipped permanently inert while every manual check said "quiet, as
// designed" — the fifth instance in this project of a built, tested thing with no live path.
//
// ⇒ So the test that matters is not "is it quiet when it should be". It is THIS: drive the real
// script, as a real process, over a real git repo and a real graph database, with a real deletion,
// and prove it SPEAKS. The negative cases guard the fire rate; this one guards the existence of the
// feature at all.

let dir;

function sh(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-hookfire-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, '.aify-graph'), { recursive: true });

  sh(['init', '-q'], dir);
  sh(['config', 'user.email', 't@t'], dir);
  sh(['config', 'user.name', 't'], dir);

  // A file that EXPORTS the symbol, committed — so deleting it produces a real unstaged diff.
  writeFileSync(join(dir, 'src', 'lib.js'), 'export function target() {\n  return 1;\n}\n');
  writeFileSync(join(dir, 'src', 'other.js'), 'export function callerOne() { return 2; }\n');
  sh(['add', '-A'], dir);
  sh(['commit', '-qm', 'base'], dir);

  // A graph asserting a COMPILER-VERIFIED call edge into that symbol.
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
  const node = (id, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','${label}','${file}',1,1,'javascript',1,'{}')`);
  node('t', 'target', 'src/lib.js');
  node('c1', 'callerOne', 'src/other.js');
  db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
          VALUES ('c1','t','CALLS',1,'LSP_VERIFIED','test')`);
  db.close();
});

afterEach(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ } });

/** Run the hook exactly as a host would: a child process, JSON on stdin, cwd set to the repo. */
function runHook(payload) {
  const script = join(process.cwd(), 'scripts', 'hooks', 'post-edit-deletion-guard.mjs');
  return execFileSync(process.execPath, [script], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    timeout: 30000,
  });
}

const editPayload = () => ({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'lib.js') } });

describe('the deletion guard hook, driven as a real process', () => {
  it('⭐⭐ SPEAKS when an exported symbol with callers is deleted', () => {
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    const out = runHook(editPayload());

    expect(out.trim(), 'the hook produced NO output on a real firing case — it is inert').not.toBe('');
    const parsed = JSON.parse(out);
    const text = parsed.hookSpecificOutput.additionalContext;
    expect(text).toMatch(/deleted a symbol that still has callers/i);
    expect(text).toContain('target');
    expect(text).toContain('src/other.js');
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
  });

  it('⛔ SILENT when the deleted symbol has no callers — the ordinary cleanup case', () => {
    // The single most important negative. Deleting dead code is the common case; firing here would
    // make the hook noise on every cleanup and it would be switched off.
    writeFileSync(join(dir, 'src', 'other.js'), '// callerOne removed\n');
    const out = runHook({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'other.js') } });
    expect(out.trim()).toBe('');
  });

  it('⛔ SILENT when the edit deleted nothing at all', () => {
    writeFileSync(join(dir, 'src', 'lib.js'), 'export function target() {\n  return 99;\n}\n');
    expect(runHook(editPayload()).trim()).toBe('');
  });

  it('⛔ SILENT for a non-edit tool even when the deletion is present on disk', () => {
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    const out = runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(out.trim()).toBe('');
  });

  it('⛔ SILENT outside an APG repo, so it is safe to install globally', () => {
    rmSync(join(dir, '.aify-graph'), { recursive: true, force: true });
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    expect(runHook(editPayload()).trim()).toBe('');
  });

  it('⛔ EXITS 0 and stays quiet when the graph database is missing', () => {
    // A repo marked as APG-indexed whose database has been deleted must not crash an agent's edit.
    rmSync(join(dir, '.aify-graph', 'graph.sqlite'), { force: true });
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    expect(() => runHook(editPayload())).not.toThrow();
  });

  it('⛔ EXITS 0 on a malformed payload rather than failing the edit', () => {
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    const script = join(process.cwd(), 'scripts', 'hooks', 'post-edit-deletion-guard.mjs');
    expect(() => execFileSync(process.execPath, [script], {
      cwd: dir, input: 'not json at all', encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 30000,
    })).not.toThrow();
  });
});
