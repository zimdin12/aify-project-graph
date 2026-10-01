#!/usr/bin/env node
// Serve the dashboard's provider request queue ONCE: claim queued calls for this project, answer each, post each
// answer, and exit.
//
//   node scripts/serve-provider-requests.mjs              # claim up to 10, answer, post
//   node scripts/serve-provider-requests.mjs --limit 3
//
// One-shot, not a daemon: the design has no standing apg service, so whatever runs this on a schedule (the host
// plugin, cron, a hook) decides when. One process serves ONE repository, the working directory, and claims only for
// the configured project. Configuration is the sweep's (scripts/lib/provider-runtime.mjs).
//
// ⛔ EVERYTHING IS READ AT THE COMMIT, NOT THE WORKING TREE (`git show <head>:<path>`, DESIGN-GRAPHS amendment 2), so
// a developer's uncommitted edits neither change an answer nor make it fail. That is why, unlike the sweep, this
// does not refuse a dirty tree.
//
// ⛔ A CLAIMED REQUEST IS ALWAYS ANSWERED, `ok: false` with the reason when it cannot be served, never left to
// expire. An expired claim goes back to the queue for somebody else, who would get the same non-answer later.
//
// Exit codes: 0 every claimed request answered and stored (including none claimed); 1 an error, or a bad argument;
// 2 the service refused a claim or at least one result (each is printed).
import { resolveAnchor } from './lib/anchor-resolver.mjs';
import { DashboardSignalsClient, SignalsRefused } from './lib/dashboard-signals-client.mjs';
import { makeInstruments, readProviderConfig, headOf } from './lib/provider-runtime.mjs';
import { answerRequest } from './lib/provider-requests.mjs';

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

async function main() {
  const { limit } = parseArgs(process.argv.slice(2));
  const client = new DashboardSignalsClient(readProviderConfig());
  console.log(`endpoint      ${client.describe()}`);
  console.log(`host          ${client.hostKey}`);

  // 1. The commit every answer in this run is read at.
  const head = headOf(repoRoot);
  const instruments = makeInstruments(repoRoot, { at: head });
  console.log(`head          ${head}`);

  // 2. Claim.
  let claimed;
  try {
    claimed = await client.claimRequests({ limit });
  } catch (error) {
    if (!(error instanceof SignalsRefused)) throw error;
    console.error(`\nREFUSED claim ${error.status} ${error.code}\n  ${error.detail ?? ''}`);
    process.exit(2);
  }
  console.log(`claimed       ${claimed.length} request(s)`);

  // 3. Answer and post each. One refused post does not stop the others: each claim has its own lease.
  let refused = 0;
  for (const request of claimed) {
    const answer = request.projectId === client.projectId
      ? answerRequest({ request, resolveItem: (item) => resolveAnchor({ repoRoot, item, deps: instruments }), head })
      // The claim is scoped to this project, so this needs a misbehaving service. Answered, not dropped.
      : { ok: false, problem: `this host serves project ${client.projectId}, not ${request.projectId}`, provenance: null };
    const summary = answer.ok ? `ok ${JSON.stringify(answer.value).slice(0, 160)}` : `NOT OK: ${answer.problem}`;
    try {
      await client.postResult(request.requestId, answer);
      console.log(`  STORED      ${request.requestId}  ${request.call}  ${summary}`);
    } catch (error) {
      if (!(error instanceof SignalsRefused)) throw error;
      refused += 1;
      console.error(`  REFUSED     ${request.requestId}  ${request.call}  ${error.status} ${error.code}: ${error.detail ?? ''}`);
    }
  }
  if (refused > 0) {
    console.error(`\n${refused} of ${claimed.length} result(s) refused by the service.`);
    process.exit(2);
  }
}

try {
  await main();
} catch (error) {
  console.error(`serve-provider-requests: ${error.message}`);
  process.exit(1);
}
