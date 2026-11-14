// The host's JSON-lines worker. Env owns credentials, grants, claims, results and timeouts; this module owns none.
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { isAbsolute } from 'node:path';
import { answerRequest, PROVIDER_FORMAT_VERSION } from './provider-requests.mjs';
import { providerReaders, readProviderRepository } from './provider-readers.mjs';
import { retainLiveSessions, shutdownAllSessions } from '../../mcp/stdio/code-intel/live.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function refusal(problem, reasonCode, head = 'unknown') {
  return { ok: false, problem, value: { formatVersion: PROVIDER_FORMAT_VERSION, reasonCode },
    provenance: { providerCommit: head, exhaustive: false, provenance: 'apg provider request refused before a usable answer' } };
}

function wireProblem(request) {
  if (!object(request)) return 'a request must be an object';
  if (typeof request.id !== 'string' || request.id === '') return 'a request needs a non-empty id';
  if (typeof request.call !== 'string' || request.call === '') return 'a request needs a call name';
  if (!object(request.args)) return 'request args must be an object';
  if (typeof request.repoRoot !== 'string' || !isAbsolute(request.repoRoot)) return 'repoRoot must be an absolute granted repository path';
  const extra = Object.keys(request).find((key) => !['id', 'call', 'args', 'repoRoot'].includes(key));
  return extra ? `unsupported request field: ${extra}` : null;
}

/** Use the explicit repository on every request, never cwd or a repository cached from an earlier line. */
export async function answerProviderRequest(request, { invoke } = {}) {
  const problem = wireProblem(request);
  if (problem) return refusal(problem, 'invalid_request');
  const repository = readProviderRepository(request.repoRoot);
  if (!repository.ok) return refusal(repository.problem, repository.reasonCode);
  const { repoRoot, head } = repository;
  return answerRequest({ request, head, ...providerReaders({ repoRoot, head, invoke }) });
}

async function answerLine(line, answer) {
  let request;
  try { request = JSON.parse(line); }
  catch { return { id: null, ...refusal('each input line must contain one JSON request', 'invalid_request') }; }
  const id = typeof request?.id === 'string' ? request.id : null;
  const problem = wireProblem(request);
  if (problem) return { id, ...refusal(problem, 'invalid_request') };
  try { return { ...await answer(request), id }; }
  catch { return { id, ...refusal('the provider could not complete this request', 'provider_failed') }; }
}

async function writeAnswer(output, answer) {
  if (!output.write(`${JSON.stringify(answer)}\n`)) await once(output, 'drain');
}

/** Importable entry. One awaited line at a time; closing stdin drains that request and closes owned LSP sessions. */
export async function runProvide(argv = [], {
  input = process.stdin, output = process.stdout, errorOutput = process.stderr,
  answer = answerProviderRequest, close = shutdownAllSessions,
} = {}) {
  if (argv.length > 0) {
    errorOutput.write('Usage: apg provide\nReads {id, call, args, repoRoot} as one JSON request per stdin line.\n');
    return argv.length === 1 && ['--help', '-h'].includes(argv[0]) ? 0 : 2;
  }
  const release = retainLiveSessions();
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  try {
    for await (const line of lines) await writeAnswer(output, await answerLine(line, answer));
    return 0;
  } catch {
    errorOutput.write('apg provide: worker input/output failed\n');
    return 1;
  } finally {
    lines.close();
    try { await close(); } finally { release(); }
  }
}
