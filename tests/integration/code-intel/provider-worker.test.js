import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import Ajv2020 from 'ajv/dist/2020.js';

const driver = fileURLToPath(new URL('../../fixtures/code-intel/lsp/provider-worker-driver.mjs', import.meta.url));
const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(new URL('../../../docs/schemas/provider-answer.v1.schema.json', import.meta.url), 'utf8')));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, ms = 15000, problem = 'provider fixture condition did not occur') {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(problem);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

it('the real stream worker reuses two owned LSP sessions past the idle window and closes both on stdin EOF', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'apg-worker-lsp-'));
  const receipts = join(temp, 'sessions.jsonl');
  const roots = ['one', 'two'].map((name) => join(temp, name));
  let child;
  let stderr = '';
  let primaryError;
  let cleanupError;
  let owned = [];
  try {
    for (const root of roots) {
      mkdirSync(root);
      writeFileSync(join(root, 'foo.cpp'), 'namespace ns { void foo(int x) {} }\n');
      writeFileSync(join(root, 'bar.cpp'), 'namespace ns { void foo(int); }\nvoid main_call() { ns::foo(7); }\n');
      writeFileSync(join(root, '.gitignore'), '.aify-graph/\n');
      writeFileSync(join(root, 'compile_commands.json'), JSON.stringify([{ directory: root, file: join(root, 'foo.cpp'), arguments: ['clang++', '-c', 'foo.cpp'] }]));
      const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
    }
    child = spawn(process.execPath, [driver], { cwd: roots[1], stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, APG_LSP_IDLE_MS: '40', APG_PROVIDER_TEST_RECEIPTS: receipts },
    });
    const exited = once(child, 'exit');
    const lines = [];
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part) => {
      buffer += part;
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) { lines.push(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1); }
    });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (s) => { stderr += s; });
    const ask = async (id, root, call) => {
      child.stdin.write(`${JSON.stringify({ id, call, args: { file: 'foo.cpp', line: 1, col: 21 }, repoRoot: root })}\n`);
      const text = await until(() => lines.length > 0 ? lines.shift() : null);
      const answer = JSON.parse(text);
      expect(answer.id).toBe(id);
      expect(validate(answer), JSON.stringify(validate.errors)).toBe(true);
      expect(answer.ok, `${answer.problem ?? ''}\n${stderr}`).toBe(true);
      expect(answer.value.observed).toBe('working_tree');
      return answer;
    };
    const first = await ask('one-def', roots[0], 'definitions');
    expect(first.value.definitions).toHaveLength(1);
    const refs = await ask('two-refs', roots[1], 'references');
    expect(refs.value.references.map((r) => r.path)).toContain('bar.cpp');
    const before = readFileSync(receipts, 'utf8').trim().split('\n').map(JSON.parse);
    owned = [...new Set(before.map((r) => r.pid))];
    expect(owned.length).toBe(2);
    for (const r of before) expect(alive(r.pid), 'CONTROL: every recorded child is alive before EOF').toBe(true);
    // This wait is the subject: sessions must survive beyond the configured 40 ms standalone idle window.
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const r of before) expect(alive(r.pid), 'host-owned sessions must stay warm while stdin remains open').toBe(true);
    await ask('one-again', roots[0], 'references');
    const after = readFileSync(receipts, 'utf8').trim().split('\n').map(JSON.parse);
    expect(after[2].pid).toBe(before[0].pid);
    expect(after.map((r) => r.idleMs)).toEqual(['40', '40', '600000']);
    child.stdin.end();
    await until(() => child.exitCode !== null || child.signalCode !== null, 15000, 'closing stdin must end the worker and its owned LSP children');
    const [code, signal] = await exited;
    expect({ code, signal }, stderr).toEqual({ code: 0, signal: null });
    await until(() => after.every((r) => !alive(r.pid)));
    expect(buffer).toBe('');
    expect(lines).toEqual([]);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.stdin.end(); child.kill();
        await until(() => child.exitCode !== null || child.signalCode !== null);
      }
      // Only PIDs recorded by this fixture, while observed alive in this test, are eligible for cleanup.
      for (const pid of owned) if (alive(pid)) process.kill(pid);
      await until(() => owned.every((pid) => !alive(pid)));
      rmSync(temp, { recursive: true, force: true });
    } catch (error) { cleanupError = error; }
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}, 60000);
