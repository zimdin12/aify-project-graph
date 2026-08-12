// THE NAME A CALLER ASKS FOR MUST REACH THE VERB THAT NAME MEANS.
//
// graph-senior-dev-hermes misbound `graph_collect_code_intel` to `graphHealth` in the
// server's tool table and the boundary + server-toolset suites stayed 19/19 GREEN. Every
// test that exercises a verb imports it DIRECTLY — which proves the verb works and says
// nothing about whether the RPC registry hands that name to that function.
//
// ⇒ A caller does not import anything. It sends a name over stdio, and the mapping from
// name to handler is a separate fact from the handler being correct. Nothing in the suite
// was asserting it, so a swapped row in a 42-entry table was invisible.
//
// ★ Same shape as the shutdown that was written and never wired: the PART was right and
// the CONNECTION was untested. Only an end-to-end call can see it.
//
// This spawns the real server and calls verbs by NAME over the actual protocol, then
// requires each response to be recognisably that verb's own output.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { expectRouteAuthority } from '../../helpers/route-authority.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/server.js');

let repoRoot;
let child;

afterEach(async () => {
  if (child && child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  child = undefined;
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-routing-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('n', 'Class', 'RoutingProbe', 'src/probe.cpp', 1, 9, 'cpp', 1, '{}')`,
  );
  db.close();
  return repo;
}

function rpc(proc, id, method, params) {
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}

function waitForReply(proc, id, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`no reply to id=${id} within ${timeoutMs}ms`)), timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.off('data', onData);
            resolve(msg);
            return;
          }
        } catch { /* not a complete json line */ }
      }
    };
    proc.stdout.on('data', onData);
  });
}

// Each verb is identified by something ONLY IT emits. A marker another verb also produces
// would let a misbinding pass, which is the entire defect.
const ROUTES = [
  { tool: 'graph_health', args: {}, mustMatch: /trustLevel|trust_level|codeIntel/, mustNotMatch: /collectionId/ },
  { tool: 'graph_collect_code_intel', args: { operations: ['references'] }, mustMatch: /collectionId|schema_version/, mustNotMatch: /trustLevel/ },
  { tool: 'graph_search', args: { query: 'RoutingProbe' }, mustMatch: /RoutingProbe/, mustNotMatch: /collectionId/ },
];

describe('the MCP registry routes each tool NAME to its own verb', () => {
  it('★★ every probed name returns that verb\'s own output, not another\'s', async () => {
    repoRoot = await makeRepo();
    child = spawn(process.execPath, [serverPath], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, APG_TELEMETRY_DIR: join(repoRoot, '.telemetry') },
    });

    rpc(child, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    await waitForReply(child, 1);

    const collected = new Map();
    let id = 10;
    for (const route of ROUTES) {
      id += 1;
      rpc(child, id, 'tools/call', { name: route.tool, arguments: { repo: repoRoot, ...route.args } });
      const reply = await waitForReply(child, id);
      const text = JSON.stringify(reply);
      collected.set(route.tool, text);

      // ★★ ROUTE AUTHORITY, the four properties separately discriminated. An error reply
      // satisfies most negative checks trivially, so "did not return the wrong verb's
      // output" is worthless until invocation and success are established independently.
      expectRouteAuthority({
        route: route.tool,
        response: reply,
        invoked: (r) => r?.result != null || r?.error != null,
        // ⚠ WAS `() => route.mustMatch.test(text)` — a closure over `text`, reading nothing
        // from its argument. dev's finding, and my own helper now rejects it: a predicate
        // that ignores the response cannot be evidence about the response.
        identity: (r) => route.mustMatch.test(JSON.stringify(r ?? {})),
        // ⚠ WAS an ABSENCE test (`r.error == null && !isError`), which is true of anything
        // lacking an error field — including a sentinel sharing none of this response's
        // values. The binding check caught it. Success now needs POSITIVE evidence: a
        // result payload actually came back.
        //
        // ⚠ Deliberately NOT requiring inner `status:'ok'`: on this fixture there is no
        // compile DB, so graph_collect_code_intel legitimately returns an inner error.
        // dev measured that requiring inner success reds 1/15 against correct production
        // code. Handler IDENTITY for that route is carried by the repo-path discriminator
        // below instead, which an inner failure does not weaken.
        succeeded: (r) => r?.result != null && r?.error == null
          && !/"isError":\s*true/.test(JSON.stringify(r.result)),
      });

      expect(text, `${route.tool}: must not return a different verb's output`)
        .not.toMatch(route.mustNotMatch);
    }

    // ⛔ SHAPE IS NOT IDENTITY. dev replaced the registered handler with
    // `async () => ({schema_version:'0.2', collectionId:'withheld-wrong-handler'})` and
    // this test stayed 1/1 GREEN — because it identified the verb by a RESPONSE PATTERN,
    // and any lookalike can emit a pattern. That proves name→some-same-shaped-response,
    // not name→graphCollectCodeIntel.
    //
    // ⇒ A SIDE EFFECT is what a lookalike cannot forge. The real collect verb PERSISTS a
    // collection; a literal returned from a stub does not touch the database. So the
    // route is identified by what it CHANGED, not by what it said.
    child.stdin.end();

    // ⚠ My first attempt asserted a PERSISTED collection. Wrong instrument for this
    // fixture: with no clangd present the real verb legitimately fails with
    // `compile_db_missing`, so nothing is persisted and the check failed against correct
    // production code. A discriminator that the honest path cannot satisfy is not a
    // discriminator — it is a second defect.
    //
    // ⇒ What the real verb DOES emit that a literal cannot: the FIXTURE REPO PATH it was
    // asked about, and the provider it actually selected. A stub knows neither, because
    // both are derived from the request and the registry rather than written into a
    // constant.
    const collectReply = collected.get('graph_collect_code_intel') ?? '';
    // The fixture's unique directory NAME, which survives JSON's double-escaping of
    // Windows separators — asserting the full path made this fail on escaping rather than
    // on identity, which would have been a third instrument bug rather than a check.
    const fixtureName = repoRoot.split(/[\\/]/).pop();
    expect(collectReply, 'the response must reference the repo it was ASKED about — a '
      + 'lookalike returning a constant cannot know this directory')
      .toContain(fixtureName);
    expect(collectReply, 'and must name the provider the registry actually selected')
      .toMatch(/cpp-clangd/);

    // ⛔ ABSENT-for-capability. THIS BLOCK PROVES TRANSPORT/OUTPUT CONFORMANCE ONLY.
    //
    // It used to read: "a lookalike receives the same request and can echo anything in it.
    // What it CANNOT do is BEHAVE like the runner across calls." That was false, and
    // graph-senior-dev-hermes refuted it by execution on ccb1093/8d2e184: in an isolated
    // detached worktree they replaced only the `graph_collect_code_intel` registry handler
    // with an inline function that never called graphCollectCodeIntel, never called
    // runCollection, never obtained a provider, and never imported or persisted anything —
    // deriving projectRoot from the normalized request and minting two fresh format-shaped
    // IDs from clock + random hex. The mutant parsed, the public RPC route was exercised,
    // and this test stayed 1/1 GREEN.
    //
    // ★ WHAT IS ACTUALLY PROVED HERE: the public MCP name reaches SOME registered handler,
    // normalized request data is available to it, and two responses can carry distinct
    // format-shaped IDs.
    // ⛔ WHAT IS NOT PROVED — none of it, despite what the assertion messages used to imply:
    // registered-handler identity · graphCollectCodeIntel invocation · runCollection
    // invocation · selected-provider invocation · provider-ORIGIN collection ID · successful
    // collect/import · durable collection identity.
    //
    // A route that returns status:'error' on a no-compile-DB fixture cannot establish the
    // successful collection route. Mint uniqueness is not a route authority; it is a
    // forgeable response-shape property, and this row is excluded from coverage numerators.
    //
    // ⚠ AND THE OLD JUSTIFICATION WAS FACTUALLY WRONG. It closed with "which needs a working
    // clangd, which CI does not have." A cause cannot refer to a carrier that does not exist.
    //
    // ⇒ TWO SEPARATELY TYPED ABSENCES, measured 2026-08-12, neither generalisable to an
    // environment nobody has inspected (dev's correction — I had collapsed them into one):
    //
    //   (1) NO APPLICABLE LOCAL LANGUAGE-SERVER CAPABILITY OBSERVED. clangd,
    //       typescript-language-server, pyright, pyright-langserver and tsserver all probe
    //       ABSENT on this machine. This says nothing about any other machine.
    //   (2) NO TRACKED CI EXECUTION ROUTE EXISTS AT ALL. No .github/workflows, gitlab-ci,
    //       circle, azure, travis or drone config is tracked anywhere in the repository.
    //       So there is no CI carrier for a statement about CI to be true or false of.
    //
    // Neither absence implies the other, and neither is a property of the code under test.
    // ★ A gap excused by a constraint that does not exist is an unexamined gap wearing a
    // reason — and I only looked because dev said to probe before finalising ABSENT rather
    // than assume. The probe falsified my own stated cause.
    //
    // NAMED CLOSER (per dev, and capability admission must be MEASURED, not inferred — a
    // binary merely existing is not closure): run a successful public graph_collect_code_intel
    // call in a carrier with a real supported language server AND real project configuration;
    // then read the imported collection back BY ID through an independent production consumer
    // (code_intel_replay or the DB-facing path), binding collection ID, provider slot, project
    // root, operation/record payload and request discriminator; require nonempty request-bound
    // evidence and a nonzero record population; and mutate registry-handler binding, runner
    // invocation, provider slot/object/envelope identity, import, and replay linkage
    // INDEPENDENTLY. Record executable identity/version, compile-DB identity, and exact
    // commit/tree with the result.
    child = spawn(process.execPath, [serverPath], {
      cwd: repoRoot, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, APG_TELEMETRY_DIR: join(repoRoot, '.telemetry') },
    });
    rpc(child, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    await waitForReply(child, 1);

    const ids = [];
    for (const callId of [21, 22]) {
      rpc(child, callId, 'tools/call', { name: 'graph_collect_code_intel', arguments: { repo: repoRoot, operations: ['references'] } });
      const r = await waitForReply(child, callId);
      const m = JSON.stringify(r).match(/ci-\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}/);
      // Message narrowed to the bounded property. It must NOT say "the runner's" — an inline
      // lookalike produces this exact shape, so attributing it to the runner is the claim
      // that was refuted.
      expect(m, `response must carry an id of the documented FORMAT (transport conformance `
        + `only — this does not identify the producer), got: ${JSON.stringify(r).slice(0, 160)}`)
        .toBeTruthy();
      ids.push(m[0]);
    }
    expect(ids[0], 'the two responses carry DIFFERENT ids — per-process non-equality, which is '
      + 'a response-shape property and not evidence of a real collection').not.toBe(ids[1]);
    child.stdin.end();

    // ⇒ The limit above is no longer "residual". It was EXECUTED, and it is the whole
    // verdict on this block. I had written it as a caveat under an assertion whose message
    // still claimed the opposite — and a conceded limit in a trailing comment does not bound
    // what an assertion's framing asserts. That framing was mine, and it is now deleted
    // rather than annotated.
  }, 120_000);
});
