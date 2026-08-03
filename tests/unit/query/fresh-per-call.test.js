// FRESHNESS IS A PER-QUESTION DECISION, NOT A PER-INSTALL ONE.
//
// Auto-reindex was env-only (APG_AUTO_REINDEX), which forces one answer on every
// call in an install. Both settings are genuinely defensible, which is exactly why
// neither is right globally:
//
//   ON  — never acts on stale data, but turns an arbitrary read into a reindex
//         that can take minutes on a large repo, with no warning at the call site.
//   OFF — reads stay cheap and staleness stays visible, but an agent that ignores
//         the banner acts on a stale graph.
//
// The right answer depends on the QUESTION. "Orient me in this repo" is answered
// correctly by a snapshot; "is it safe to delete this symbol" is not. Only the
// caller knows which one a given call is, so `fresh` belongs on the call — with the
// env var kept as the default for environments where the caller CANNOT decide
// (managed workers that get read verbs but no graph_index).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoReindexEnabled } from '../../../mcp/stdio/freshness/auto-reindex.js';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/server.js'),
  'utf8',
);

describe('per-call freshness', () => {
  it('a call may opt in with fresh:true, independent of the env var', () => {
    expect(src).toMatch(/const perCall = normalized\.fresh === true;/);
    expect(src).toMatch(/if \(perCall \|\| autoReindexEnabled\(process\.env\.APG_AUTO_REINDEX\)\)/);
  });

  it('the env var still works as the default for callers that cannot decide', () => {
    // Managed workers get read verbs but no graph_index — they have no way to
    // refresh, so the install-level switch has to remain available to them.
    expect(autoReindexEnabled('1')).toBe(true);
    expect(autoReindexEnabled('true')).toBe(true);
    expect(autoReindexEnabled(undefined)).toBe(false);
    expect(autoReindexEnabled('0')).toBe(false);
  });

  it('fresh is advertised on read verbs, not on mutating ones', () => {
    // graph_index IS the refresh; offering it a "refresh first" flag is nonsense.
    expect(src).toMatch(/if \(MUTATING_TOOLS\.has\(tool\.name\)\) return tool\.schema;/);
    expect(src).toMatch(/inputSchema: withFreshParam\(t\)/);
  });

  it('does not clobber a verb that declares its own fresh', () => {
    // graph_search and graph_find already handle `fresh` themselves.
    expect(src).toMatch(/if \(schema\.properties\?\.fresh\) return schema;/);
  });

  it('the description tells an agent WHEN to use it and what it costs', () => {
    // A flag whose cost is invisible gets either ignored or set on everything.
    // Both failure modes come from a description that only says what it does.
    //
    // These assert the PROPERTIES the description must carry, not its exact
    // wording. The previous version pinned four literal sentences, which made
    // it fail on a rewrite that kept every one of those properties — and this
    // object is inlined into 10 verbs' schemas, so its length is billed ten
    // times per session and shortening it has to stay possible.
    expect(src, 'states its default').toMatch(/DEFAULT false/);
    expect(src, 'says when true is warranted').toMatch(/will justify an ACTION/);
    expect(src, 'names its cost').toMatch(/COST:.*(seconds|minutes)/);
    // Matched as two short contiguous fragments: `src` is the raw file, so a
    // longer phrase can straddle a string-concatenation break and fail on
    // reflow alone.
    expect(src, 'says staleness is surfaced, not silent').toMatch(/any staleness is/);
    expect(src, 'leaves the call to the agent').toMatch(/so you decide/);
  });
});
