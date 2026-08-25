// Deployment readback: is the thing agents READ the thing we WROTE?
//
// ⛔ SYNCING IS NOT DEPLOYING, and this exists because that distinction cost a measurement.
//
//     repo      integrations/claude-code/skill/SKILL.md   34,212 bytes
//     INSTALLED ~/.claude/skills/aify-project-graph/      26,963 bytes
//
// `sync-skills.mjs` mirrors WITHIN the repo across the four runtime trees, and its
// "deployment: all 16 shipped skills present" line is a PRESENCE check — it asks whether a file
// exists, never whether it says what the repo says. The installed skill an agent actually reads was
// ~7KB behind and did not contain the paragraph I had just written.
//
// ⛔⛔ THE EXPENSIVE PART WAS NOT THE STALE FILE. Earlier the same day I counted invocations of
// INSTALLED skills and reasoned about what our skills SAY — content that existed only in the repo.
// The invocation counts stood; every inference about content was unfounded. A stale installation
// does not announce itself; it silently re-bases any measurement that reads content.
//
// ⇒ Review ruling: deployment/readback is its own step — enumerate the declared population, update
// each target, then READ BACK exact bytes, and report missing/inaccessible/stale as TYPED
// NON-SUCCESS rather than collapsing them into zero or excluding them once results are visible.

import { createHash } from 'node:crypto';

/**
 * Every outcome a single installation can have. DECLARED so a consumer can switch exhaustively and
 * so a test can assert each one is reachable — a vocabulary entry no input can produce is the
 * dead-branch defect this repo shipped once already, in a `cause` value no input could emit.
 */
export const DEPLOYMENT_STATES = Object.freeze(['match', 'stale', 'diverged', 'missing', 'unreadable']);

const sha = (s) => createHash('sha256').update(s ?? '').digest('hex');

/**
 * Compare one source file against its installed counterpart.
 *
 * @param {{source: {path: string, bytes: string}, installed: {path: string, bytes?: string, error?: string} | null}} args
 * @returns {{state: string, ok: boolean, name?: string, sourceBytes: number, installedBytes: number|null, sourceSha: string, installedSha: string|null, detail: string}}
 */
export function classifyInstallation({ source, installed, name }) {
  const sourceBytes = source?.bytes?.length ?? 0;
  const sourceSha = sha(source?.bytes);
  const base = { name: name ?? source?.path, sourceBytes, sourceSha, installedBytes: null, installedSha: null };

  if (!installed) {
    return { ...base, state: 'missing', ok: false, detail: 'no installed copy found at the expected path' };
  }
  if (installed.error || typeof installed.bytes !== 'string') {
    // ⛔ ITS OWN STATE. Reading a permissions failure as "missing" invites a deploy that will fail
    // the same way; reading it as "match" is a fail-open lie. Neither is an honest answer.
    return { ...base, state: 'unreadable', ok: false, detail: `could not read installed copy: ${installed.error ?? 'no content'}` };
  }

  const installedBytes = installed.bytes.length;
  const installedSha = sha(installed.bytes);
  const withInstalled = { ...base, installedBytes, installedSha };

  if (installedSha === sourceSha) {
    return { ...withInstalled, state: 'match', ok: true, detail: 'installed bytes are identical to source' };
  }

  // ⚠ TWO DIFFERENT FAILURES, KEPT APART BECAUSE THEY HAVE DIFFERENT REMEDIES. "Source is ahead"
  // means deploy. "Installed is ahead" means somebody edited the installed copy by hand, or a newer
  // tree deployed here — overwriting would DESTROY that. Folding the second into the first sends
  // the reader to a fix that loses work.
  //
  // ⛔ THE FIRST VERSION OF THIS USED BYTE SIZE FOR THE DIRECTION, AND REALITY FALSIFIED IT ON THE
  // FIRST REAL RUN. `find-the-doc` came back `diverged` — installed 5,047 bytes against source
  // 5,042 — because I had just SHORTENED the source by replacing a ten-character word with a
  // five-character one. The source was ahead; it was simply smaller. SIZE IS NOT RECENCY, and the
  // wrong verdict was the confident-looking one: it told the reader to inspect for a hand-edit that
  // never happened, and refused a deploy that was correct.
  //
  // ⇒ Direction comes from mtime, which is what "source NEWER than installed" actually means.
  // Content decides EQUALITY; time decides DIRECTION. Neither can do the other's job.
  const sourceTime = Number(source?.mtimeMs);
  const installedTime = Number(installed?.mtimeMs);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(installedTime)) {
    // No usable clock — refuse to guess a direction rather than assert one from size.
    return { ...withInstalled, state: 'diverged', ok: false, detail: 'content differs and no comparable mtime is available — inspect before overwriting' };
  }
  if (sourceTime > installedTime) {
    return { ...withInstalled, state: 'stale', ok: false, detail: 'source is newer than the installed copy — deploy needed' };
  }
  return { ...withInstalled, state: 'diverged', ok: false, detail: 'installed copy is newer than source — inspect before overwriting' };
}

/**
 * Roll rows up into one verdict.
 *
 * ⛔ FAILS CLOSED IN BOTH DIRECTIONS. Any non-success state fails the whole deployment, and an
 * EMPTY population fails it too: `[].every()` is true, and this repo has already had a wired gate
 * certify its own failure that way with 61 of 61 rows inert and health asserted.
 *
 * ⚠ The counts are asserted to sum to the input, because a summary whose parts do not add up to its
 * total has dropped a row — which is exactly how an inconvenient failure disappears after the
 * results become visible.
 */
export function summariseDeployment(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byState = Object.fromEntries(DEPLOYMENT_STATES.map((s) => [s, 0]));
  for (const r of list) {
    if (Object.hasOwn(byState, r?.state)) byState[r.state] += 1;
    else byState.unreadable += 1;   // an unrecognised state is not a pass
  }
  const failures = list.filter((r) => !r?.ok);
  if (list.length === 0) {
    return { ok: false, total: 0, byState, failures: [], reason: 'no installations were enumerated — an empty population is a finding, not a pass' };
  }
  return {
    ok: failures.length === 0,
    total: list.length,
    byState,
    failures,
    reason: failures.length === 0 ? null : `${failures.length} of ${list.length} installations are not in sync with source`,
  };
}
