// A CAVEAT THAT DOES NOT SURVIVE THE WRITE IS NOT A CAVEAT.
//
// The provider emits positionGuessSkipped / refsTruncatedSymbols — how many symbols
// were NOT ASKED, because their identifier position was unlocatable or their
// reference set hit the per-symbol cap. Those symbols sit in the coverage
// denominator and can never reach the numerator, so without them a percentage reads
// as a rate when it is a FLOOR.
//
// They were dropped at TWO layers and the drop was invisible at both:
//   1. the collect verb's summary never forwarded them, so a caller saw
//      `positionGuesses: 55` with no skip count and could not distinguish
//      "nothing was skipped" from "we don't report skips";
//   2. the importer never persisted them into operations._session, so graph_health
//      read null forever — meaning the health wiring added for this was itself
//      half-done: a reader with no writer.
//
// sc-manager found (1) by reporting the field as ABSENT rather than as zero. That
// distinction is the whole diagnosis: absent means unwired, zero means measured.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '../../../mcp/stdio', p), 'utf8');
const provider = read('code-intel/providers/cpp-clangd.js');
const verb = read('query/verbs/collect_code_intel.js');
const importer = read('ingest/code-intel/importer.js');
const query = read('code-intel/query.js');
const health = read('query/verbs/health.js');

const COUNTERS = ['positionGuessSkipped', 'refsTruncatedSymbols'];

describe('skip counters survive every layer', () => {
  it.each(COUNTERS)('%s is emitted by the provider session', (field) => {
    expect(provider).toMatch(new RegExp(`^\\s+${field},$`, 'm'));
  });

  it.each(COUNTERS)('%s is forwarded by the collect verb summary', (field) => {
    // `?? null` matters: always emitted, null when unknown, NEVER omitted — so a
    // reader can tell unmeasured from zero.
    expect(verb).toMatch(new RegExp(`${field}: sess\\.${field} \\?\\? null`));
  });

  it.each(COUNTERS)('%s is PERSISTED by the importer into _session', (field) => {
    // Without this graph_health reads null forever, however well-wired its reader.
    expect(importer).toMatch(new RegExp(`${field}: sess\\.${field} \\?\\? null`));
  });

  it.each(COUNTERS)('%s is read back by getLatestCollection', (field) => {
    expect(query).toMatch(new RegExp(`${field}: sess\\.${field} \\?\\? null`));
  });

  it.each(COUNTERS)('%s reaches the graph_health codeIntel block', (field) => {
    expect(health).toMatch(new RegExp(`${field}: latest\\.${field}`));
  });

  it('graph_health marks the coverage percentage as a FLOOR when anything was skipped', () => {
    expect(health).toMatch(/is a FLOOR, not a rate/);
    expect(health).toMatch(/NOT ASKED/);
    // And must not fire when nothing was skipped — a permanent caveat is noise,
    // and noise on the trust surface is what makes real banners ignorable.
    expect(health).toMatch(/if \(skipped > 0 \|\| capped > 0\)/);
  });
});
