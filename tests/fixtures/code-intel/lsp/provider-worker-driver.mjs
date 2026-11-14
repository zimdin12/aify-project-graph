// Process-test driver: real worker/readers/handlers, scripted LSP transport only. No public request accepts spawn.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runProvide, answerProviderRequest } from '../../../../scripts/lib/provider-worker.mjs';
import { codeIntelDefinitions, codeIntelReferences } from '../../../../mcp/stdio/query/verbs/code_intel_live.js';
import { getLiveSession } from '../../../../mcp/stdio/code-intel/live.js';

const spawn = { command: process.execPath, args: [fileURLToPath(new URL('./fake-lsp-server.mjs', import.meta.url))] };
let calls = 0;
async function invoke({ call, ...request }) {
  const options = { ...request, spawn, warmupFiles: [request.file], warmupMs: 50 };
  const result = call === 'references'
    ? await codeIntelReferences({ ...options, acceptEvidenceContractVersion: 2 })
    : await codeIntelDefinitions(options);
  const session = await getLiveSession({ language: 'cpp', projectRoot: request.repoRoot, spawn });
  calls += 1;
  // Retention is checked after calls 1/2 with a short window. Before EOF, restore a long standalone window so
  // releasing retention cannot accidentally substitute for the worker's explicit shutdown.
  if (calls === 3) process.env.APG_LSP_IDLE_MS = '600000';
  appendFileSync(process.env.APG_PROVIDER_TEST_RECEIPTS, `${JSON.stringify({ repoRoot: request.repoRoot, pid: session.client.proc.pid, idleMs: process.env.APG_LSP_IDLE_MS })}\n`);
  return result;
}
process.exitCode = await runProvide([], { answer: (request) => answerProviderRequest(request, { invoke }) });
