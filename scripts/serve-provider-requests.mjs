#!/usr/bin/env node
// Serve the dashboard's provider request queue ONCE: claim queued calls for this project, answer each, post each
// answer, and exit.
//
//   node scripts/serve-provider-requests.mjs              # claim up to 10, answer, post
//   node scripts/serve-provider-requests.mjs --limit 3
//
// One-shot, not a daemon: the design has no standing apg service. The aify-env dashboard plugin runs this every 60s
// per repository. One process serves ONE repository, the working directory, and claims only for the configured
// project. Configuration is environment variables, read by scripts/lib/provider-runtime.mjs: APG_DASHBOARD_URL,
// APG_DASHBOARD_KEY or APG_DASHBOARD_ENV, APG_DASHBOARD_PROJECT, APG_DASHBOARD_HOST, APG_DASHBOARD_REPORTER.
//
// stamp and resolve read committed contents with git show. Graph-backed calls read the attested index without
// refreshing it and disclose its commit and staleness. references and definitions ask the language server about
// the WORKING TREE and say so in their answers. A dirty working tree is therefore not a blanket refusal.
//
// ⛔ A CLAIMED REQUEST IS ALWAYS ANSWERED, `ok: false` with the reason when it cannot be served, never left to
// expire. An expired claim goes back to the queue for somebody else, who would get the same non-answer later.
//
// EXIT CODES ARE THE SCHEDULER'S WHOLE INTERFACE (scripts/lib/serve-exit.mjs, agreed with dashboard-manager):
//   0 fine, including nothing claimed · 2 stop until the configuration is fixed · 3 try again next tick ·
//   1 unexpected, a bug. Several outcomes in one run: the most severe wins.
import { DashboardSignalsClient, SignalsRefused, resultBody, isNoAnswer } from './lib/dashboard-signals-client.mjs';
import { readProviderConfig } from './lib/provider-runtime.mjs';
import { answerRequest } from './lib/provider-requests.mjs';
import { providerReaders, readProviderRepository } from './lib/provider-readers.mjs';
import { shutdownAllSessions } from '../mcp/stdio/code-intel/live.js';
import { exitForRun } from './lib/serve-exit.mjs';

const repoRoot = process.cwd();

/** `--limit N`, a positive integer, default 10. Anything else is refused rather than guessed at. */
function parseArgs(argv) {
  let limit = 10;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit') {
      const n = Number(argv[i + 1]);
      if (!Number.isSafeInteger(n) || n < 1) throw new Error('--limit needs a positive integer after it');
      limit = n;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { limit };
}

/** A failure as serve-exit.mjs classifies it: the service's refusal, no HTTP answer at all, or anything else. */
function failureOf(error, kind) {
  if (error instanceof SignalsRefused) return { kind, status: error.status, code: error.code };
  if (isNoAnswer(error)) return { kind: 'network' };
  return { kind: 'unexpected' };
}

async function main() {
  // 1. Configuration: any failure here is the operator's to fix, so it is a stop.
  let limit;
  let client;
  let head;
  let repository;
  try {
    ({ limit } = parseArgs(process.argv.slice(2)));
    client = new DashboardSignalsClient(readProviderConfig());
    repository = readProviderRepository(repoRoot);
    if (!repository.ok) throw new Error(repository.problem);
    head = repository.head;
  } catch (error) {
    console.error(`serve-provider-requests: ${error.message}`);
    return exitForRun([{ kind: 'config' }]);
  }
  const readers = providerReaders({ repoRoot: repository.repoRoot, head });
  console.log(`endpoint      ${client.describe()}`);
  console.log(`host          ${client.hostKey}`);
  console.log(`head          ${head}`);

  // 2. Claim.
  let claimed;
  try {
    claimed = await client.claimRequests({ limit });
  } catch (error) {
    console.error(`\nCLAIM FAILED  ${error instanceof SignalsRefused ? `${error.status} ${error.code}: ${error.detail ?? ''}` : error.message}`);
    return exitForRun([failureOf(error, 'claim')]);
  }
  console.log(`claimed       ${claimed.length} request(s)`);

  // 3. Answer and post each. One refused post does not stop the others: each claim has its own lease.
  const failures = [];
  for (const request of claimed) {
    const answer = request.projectId === client.projectId
      ? await answerRequest({ request, ...readers, head })
      // The claim is scoped to this project, so this needs a misbehaving service. Answered, not dropped.
      : { ok: false, problem: `this host serves project ${client.projectId}, not ${request.projectId}`, provenance: null };
    // Logged from the body as sent: an answer over the service's size cap goes out as a refusal, not as itself.
    const sent = resultBody(client.hostKey, answer);
    const summary = sent.ok ? `ok ${JSON.stringify(sent.value).slice(0, 160)}` : `NOT OK: ${sent.problem}`;
    try {
      await client.postResult(request.requestId, answer);
      console.log(`  STORED      ${request.requestId}  ${request.call}  ${summary}`);
    } catch (error) {
      failures.push(failureOf(error, 'result'));
      const why = error instanceof SignalsRefused ? `${error.status} ${error.code}: ${error.detail ?? ''}` : error.message;
      console.error(`  REFUSED     ${request.requestId}  ${request.call}  ${why}`);
    }
  }
  if (failures.length > 0) console.error(`\n${failures.length} of ${claimed.length} result(s) not stored.`);
  return exitForRun(failures);
}

let code;
try {
  code = await main();
} catch (error) {
  console.error(`serve-provider-requests: unexpected: ${error.stack ?? error.message}`);
  code = exitForRun([{ kind: 'unexpected' }]);
} finally {
  await shutdownAllSessions();
}
process.exit(code);
