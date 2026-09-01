// ⛔ A TYPED REFUSAL WHOSE TYPE DIES AT THE BOUNDARY IS NOT A TYPED CONTRACT.
//
// `extractFile` throws `APG_DUPLICATE_SYMBOL_SITE` when an undeclared duplicate symbol site would
// otherwise be merged. I wrote a test asserting that code AT THE THROW SITE and reported the
// contract as end-to-end. Review read the consumer: the orchestrator caught every extraction error
// and persisted only `{phase:'parse', reason: err.message}`, dropping `err.code`. The claim was
// true where I measured it and false where it mattered — an extractor DEFECT and an ordinary
// syntax error in a vendored file reached the reader as the same line.
//
// ⚠ WHAT THIS FILE COVERS, EXACTLY: the rendering RULE that makes a refusal distinguishable, and
// the shape the orchestrator now persists.
//
// ⚠ WHAT IT DOES NOT COVER, STATED RATHER THAN FAKED: the shipped call path. The verdict is built
// inline inside `graph_health`'s body, which needs a real manifest and DB to reach, and the
// renderer is not exported. My first draft of this file "covered" it with a branch that asserted
// `undefined` and returned — a test that could not fail. An admitted gap is worth more than a
// green line that means nothing, so the gap is written here instead.
import { describe, it, expect } from 'vitest';

// The rule as it exists in mcp/stdio/query/verbs/health.js. ⚠ THIS IS A COPY, and a copy can
// drift; `renderer-parity` below reads the real source so drift fails loudly rather than leaving
// this file describing a renderer nobody ships.
const renderSample = (entries) => entries.slice(0, 3)
  .map((s) => `${s.file} (${s.phase}${s.code ? `: ${s.code}` : ''})`).join(', ');

describe('an extraction refusal keeps its type as far as the rendering rule', () => {
  it('⛔ a refusal is distinguishable from an ordinary extraction failure', () => {
    // Both are phase 'extract'. Only the code separates our defect from a vendored syntax error.
    const refusal = renderSample([{ file: 'a.js', phase: 'extract', code: 'APG_DUPLICATE_SYMBOL_SITE' }]);
    const failure = renderSample([{ file: 'b.js', phase: 'extract', code: 'EXTRACTION_FAILED' }]);
    expect(refusal).toContain('APG_DUPLICATE_SYMBOL_SITE');
    expect(refusal).not.toBe(failure);
  });

  it('POSITIVE CONTROL: a record with no code still renders, and never prints "undefined"', () => {
    // Manifests written before this change carry no `code`. A migration that breaks reading old
    // state is its own outage, and `(too_large: undefined)` would be a new lie in the output.
    const legacy = renderSample([{ file: 'c.js', phase: 'too_large' }]);
    expect(legacy).toBe('c.js (too_large)');
    expect(legacy).not.toContain('undefined');
  });

  it('⛔ renderer parity: the shipped source really uses this rule', async () => {
    // Not a substitute for calling it — a source read cannot prove behaviour, and this file says
    // so above. What it CAN do is fail when the copy above stops matching what ships, which is the
    // failure mode of every hand-copied rule.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../../mcp/stdio/query/verbs/health.js', import.meta.url)), 'utf8',
    );
    expect(src).toContain('${s.phase}${s.code ? `: ${s.code}` : \'\'}');
  });

  it('⛔ the orchestrator persists a code on every extraction skip', async () => {
    // Same limitation, same honesty: this reads the source rather than running a rebuild. It
    // exists because the ORIGINAL defect was a field silently absent from this exact record, and
    // nothing in the suite noticed.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../../mcp/stdio/freshness/orchestrator.js', import.meta.url)), 'utf8',
    );
    expect(src).toContain("code: err?.code ?? 'EXTRACTION_FAILED'");
    expect(src, 'the old untyped shape must be gone, not merely joined by a typed one')
      .not.toContain("skipped.push({ file: relPath, phase: 'parse', reason:");
  });
});
