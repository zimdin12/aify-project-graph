import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

// ⭐ THE DECISION LOG IS WHAT MAKES A FIELD TEST POSSIBLE AT ALL.
//
// This hook's contract is silence on almost every path, so "we enabled it and nothing bad happened"
// is indistinguishable from "it never ran once". The exit criterion for the whole feature is a
// measured FIRE RATE, and a rate needs a denominator.
//
// ⛔ THE FIRST VERSION LOGGED ONLY AFTER THE PRE-FILTER, so it would have recorded fires per
// DELETION rather than fires per EDIT — a different and much larger number wearing the same name.
// That is the wrong-noun error this project has paid for repeatedly: sound arithmetic, unearned
// noun. These tests pin the denominator, not just the numerator.
describe('the decision log — the denominator, not only the firings', () => {
  const logPath = () => join(dir, '.aify-graph', 'hook-decisions.jsonl');
  const readLog = () => readFileSync(logPath(), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it('⭐ records a FIRING decision', () => {
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    runHook(editPayload());
    const rows = readLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].fired).toBe(true);
    expect(rows[0].reason).toBe('deleted_symbol_has_callers');
    expect(rows[0].findings).toBe(1);
  });

  it('⭐⭐ RECORDS THE SILENT DECISIONS TOO — without these there is no rate', () => {
    // An edit that deletes nothing is the overwhelmingly common case and IS the denominator.
    writeFileSync(join(dir, 'src', 'lib.js'), 'export function target() {\n  return 99;\n}\n');
    runHook(editPayload());
    const rows = readLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].fired).toBe(false);
    expect(rows[0].reason).toBe('nothing_deleted');
  });

  it('⭐ a fire rate can actually be computed from a mixed run', () => {
    // Three edits, one of which deletes a called symbol. If the silent ones were unlogged this
    // would read as 1/1 = 100% instead of 1/3 — the same figure, the wrong population.
    writeFileSync(join(dir, 'src', 'lib.js'), 'export function target() {\n  return 2;\n}\n');
    runHook(editPayload());
    writeFileSync(join(dir, 'src', 'lib.js'), 'export function target() {\n  return 3;\n}\n');
    runHook(editPayload());
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    runHook(editPayload());

    const rows = readLog();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.fired)).toHaveLength(1);
    const rate = rows.filter((r) => r.fired).length / rows.length;
    expect(rate).toBeCloseTo(1 / 3, 5);
  });

  it('⛔ a non-edit tool is logged too — it is part of what the hook was asked about', () => {
    runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    const rows = readLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('not_an_edit_tool');
  });

  it('⛔ the log records NO source text — only the decision', () => {
    writeFileSync(join(dir, 'src', 'lib.js'), '// target removed\n');
    runHook(editPayload());
    const raw = readFileSync(logPath(), 'utf8');
    expect(raw).not.toContain('export function');
    expect(Object.keys(readLog()[0]).sort()).toEqual(['findings', 'fired', 'reason', 'ts']);
  });
});
