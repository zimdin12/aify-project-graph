// Machine-facing dependencies shared by the one-shot queue client and the JSON-lines worker.
import { guardRepositoryFile } from './provider-paths.mjs';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveAnchor } from './anchor-resolver.mjs';
import { makeInstruments, headOf } from './provider-runtime.mjs';
import { readSubgraph } from './provider-subgraph.mjs';
import { readLookup } from './provider-lookups.mjs';
import { readLive } from './provider-live.mjs';

/** Git's object paths are top-level-relative even under git -C subfolder. Never expand a folder grant upwards. */
export function readProviderRepository(requestedRoot) {
  if (typeof requestedRoot !== 'string' || !isAbsolute(requestedRoot)) {
    return { ok: false, problem: 'repoRoot must be an absolute repository path', reasonCode: 'invalid_request' };
  }
  try {
    const repoRoot = realpathSync(requestedRoot);
    if (!statSync(repoRoot).isDirectory()) throw new Error('not a directory');
    const gitRoot = realpathSync(execFileSync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    if (gitRoot !== repoRoot) return { ok: false, problem: 'the granted folder must be the git top level; the provider will not expand the grant to its parent', reasonCode: 'repository_root_required' };
    return { ok: true, repoRoot, head: headOf(repoRoot) };
  } catch {
    return { ok: false, problem: 'the granted repository or its HEAD could not be read', reasonCode: 'repository_unavailable' };
  }
}

async function invokeLive({ call, ...request }) {
  const { codeIntelReferences, codeIntelDefinitions } = await import('../../mcp/stdio/query/verbs/code_intel_live.js');
  // Supplying the already-guarded query file disables automatic file prewarming. The server may still resolve
  // project dependencies, but the provider never opens an unguarded source file selected from the graph or disk.
  const guardedRequest = { ...request, warmupFiles: [request.file] };
  if (call === 'references') return codeIntelReferences({ ...guardedRequest, acceptEvidenceContractVersion: 2 });
  if (call === 'definitions') return codeIntelDefinitions(guardedRequest);
  throw new Error('unknown live call');
}

/** Nothing is cached across repositories or commits. LSP session reuse stays with its existing owner. */
export function providerReaders({ repoRoot, head, invoke = invokeLive }) {
  const instruments = makeInstruments(repoRoot, { at: head });
  return {
    resolveItem: (item) => resolveAnchor({ repoRoot, item, deps: instruments }),
    readSubgraph: (request) => readSubgraph({ repoRoot, request, head }),
    readLookup: (call, request) => readLookup({ call, repoRoot, request, head }),
    readLive: (call, args) => readLive({ call, args, repoRoot, guardPath: guardRepositoryFile, invoke }),
  };
}
