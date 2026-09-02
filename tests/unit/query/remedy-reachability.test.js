// ⛔ A REMEDY MUST NOT SEND AN AGENT TO A VERB IT CANNOT CALL.
//
// Preregistered: docs/evidence/process/PREREGISTRATION-remedy-reachability.md.
//
// The repo names this invariant in three places — "a LISTED verb must not name an UNLISTED one"
// (`callees.js:117`, `callers.js:102`, `absence-names-its-population.test.js:147`) — and until now it
// was held ATTENTIONALLY: each call site picks a reachable verb by hand and explains the choice in a
// comment. `callers.js` names `graph_impact` "NOT graph_preflight" for exactly this reason.
//
// A rule maintained by remembering is not a remedy. This is the mechanical form.
//
// WHY IT MATTERS BEYOND TIDINESS. The measured adoption bottleneck is MID-TASK reach: agents do not
// invoke skills mid-task, and the surface they reliably read is verb OUTPUT. A remedy there naming a
// verb the agent cannot call is a DEAD END — the same defect class M1 exists to kill, in the routing
// half of the product.
//
// ⚠ CEILING: this checks remedy LITERALS in the query layer. It does not prove an agent follows a
// remedy, that the advice is good, or that prose elsewhere in an output never names an unlisted verb.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../../../mcp/stdio/tools/schema.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const QUERY = join(REPO, 'mcp/stdio/query');
const REGISTERED = new Set(TOOLS.map((t) => t.name));

// ⚠ SCRAPED, following the pattern and the declared weakness already documented in
// tests/unit/integrations/verb-count-parity.test.js: a real import of server.js would start a stdio
// server inside the test process, so the profile sets are read from its source text.
function defaultToolNames() {
  const src = readFileSync(join(REPO, 'mcp/stdio/server.js'), 'utf8');
  const start = src.indexOf('const DEFAULT_TOOL_NAMES');
  if (start < 0) throw new Error('DEFAULT_TOOL_NAMES not found in server.js');
  const open = src.indexOf('[', start);
  const close = src.indexOf(']', open);
  return new Set([...src.slice(open, close).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));
}

// Every `remedy: '...'` literal under the query layer, with the verb that produces it. A file's own
// tool name comes from the `verbName:` it hands to inspectReadFreshness; a shared module (no
// verbName) is treated as reachable from a LISTED verb, which is the conservative direction.
function remedyLiterals() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = readFileSync(path, 'utf8');
      const owner = /verbName:\s*'([a-z_]+)'/.exec(text)?.[1] ?? null;
      // ⛔ ALL THREE STRUCTURED "WHAT TO DO NEXT" FIELDS, not just `remedy`. They share one semantic —
      // the action the agent should take — so a pointer in any of them is a dead end on the same
      // terms. Widened 2026-09-02 after a reconnaissance found `fallback:` and `suggestion:` carrying
      // verb names and ungated.
      //
      // ⚠ AND NO WIDER. A scan of ALL string literals in this layer finds 37 distinct verbs across
      // 5,061 literals — SQL, cause codes, log text and prose ABOUT a verb, most of it not a pointer
      // at all. There is no identity rule separating "pointer" from "prose" that does not fire on
      // legitimate text, so the population stops at fields whose NAME states the semantic.
      for (const field of ['remedy', 'fallback', 'suggestion']) {
        for (const m of text.matchAll(new RegExp(`${field}:\\s*'([^']*)'`, 'g'))) {
          out.push({ file: entry.name, owner, field, remedy: m[1] });
        }
      }
    }
  };
  walk(QUERY);
  return out;
}

const namedVerbsIn = (text) => [...new Set(
  [...text.matchAll(/\b((?:graph|code_intel)_[a-z_]+)\b/g)].map((m) => m[1]),
)].filter((n) => REGISTERED.has(n)); // registry membership stops the regex inventing verbs

describe('a remedy never sends an agent to a verb it cannot call', () => {
  it('POSITIVE CONTROL: there are remedies to check, and some name a verb', () => {
    // "No unreachable remedies" is trivially true of an empty scan, and that clean zero is exactly
    // the answer I would be pleased to see.
    const all = remedyLiterals();
    expect(all.length, 'no remedy literals parsed — the scan is blind, not satisfied').toBeGreaterThan(4);
    expect(all.filter((r) => namedVerbsIn(r.remedy).length > 0).length,
      'no remedy names any verb — the reachability check would be vacuous').toBeGreaterThan(2);
  });

  it('POSITIVE CONTROL: the listed set is real and smaller than the registry', () => {
    // If the scrape returned everything (or nothing) the distinction below would be meaningless.
    const listed = defaultToolNames();
    expect(listed.size).toBeGreaterThan(5);
    expect(listed.size).toBeLessThan(REGISTERED.size);
    expect(listed.has('graph_callers')).toBe(true);
  });

  it('NEGATIVE CONTROL: the matcher rejects a token that is not a registered verb', () => {
    expect(namedVerbsIn('try graph_not_a_real_verb for this')).toEqual([]);
    // ...and a slash command is not a verb: consequences.js names /graph-build-functionality.
    expect(namedVerbsIn('run /graph-build-functionality to create the feature map.')).toEqual([]);
  });

  it('★★★ every remedy reachable from a LISTED verb names only LISTED verbs', () => {
    const listed = defaultToolNames();
    const violations = [];
    for (const { file, owner, field, remedy } of remedyLiterals()) {
      // A verb that is ITSELF unlisted may name another unlisted verb: anyone who reached it already
      // has the full toolset. That exception is the documented one in callees.js:116-119.
      const producerIsListed = owner === null || listed.has(owner);
      if (!producerIsListed) continue;
      for (const named of namedVerbsIn(remedy)) {
        if (!listed.has(named)) violations.push(`${file}:${field} (${owner ?? 'shared'}) -> ${named}`);
      }
    }
    expect(violations, 'a remedy naming an unlisted verb is a mid-task DEAD END')
      .toEqual([]);
  });
});
