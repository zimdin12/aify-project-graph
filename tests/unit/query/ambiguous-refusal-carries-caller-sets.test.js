// ★ M1's STOP CONDITION, the half that was recorded as shipped without being built.
//
// The milestone says: *"graph_callers already refuses a bare ambiguous name, but the refusal is a
// DEAD END; make it return the qualified candidates WITH their caller sets."* The plan carried a ✅
// against it — earned by fixtures proving the sets were DISJOINT when queried one at a time, which
// is a different claim. The refusal itself listed names and locations, so an agent still had to
// spend one call per candidate to learn which one it meant.
//
// ⛔ ENRICHMENT IS OPT-IN AND THE OPT-OUT IS TESTED. Six verbs share this refusal; a caller set is
// the answer for graph_callers and noise (plus a query per candidate) for graph_trace.
import { describe, it, expect } from 'vitest';
import { buildAmbiguousMatchMessage } from '../../../mcp/stdio/query/verbs/symbol_lookup.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// Two same-named methods in different namespaces — the M1 shape.
const ROWS = [
  { id: 'a', type: 'Method', label: 'render', file_path: 'src/alpha.js', start_line: 2, confidence: 1, extra: JSON.stringify({ qname: 'alpha.Widget.render' }) },
  { id: 'b', type: 'Method', label: 'render', file_path: 'src/beta.js', start_line: 2, confidence: 1, extra: JSON.stringify({ qname: 'beta.Widget.render' }) },
];

// A stub graph: `counts` per node id, `callers` per node id. Deliberately NOT an indexed fixture —
// this unit is about how the refusal is RENDERED, and indexing would make the assertions depend on
// extractor behaviour that has its own tests.
const dbWith = (counts, callers = {}) => ({
  get: (sql, params) => {
    if (!/count\(\*\)/i.test(sql)) throw new Error(`unexpected get: ${sql}`);
    return { c: counts[params.id] ?? 0 };
  },
  all: (sql, params) => {
    if (!/FROM edges/i.test(sql)) throw new Error(`unexpected all: ${sql}`);
    return (callers[params.id] ?? []).map((label) => ({ label }));
  },
});

describe('the ambiguous refusal carries each candidate\'s caller set', () => {
  it('★ each candidate is followed by its OWN caller set', () => {
    const out = buildAmbiguousMatchMessage('render', ROWS, 5, null, {
      callerSetsFrom: dbWith({ a: 1, b: 2 }, { a: ['alphaCaller'], b: ['betaCaller', 'betaOther'] }),
    });
    expect(out).toMatch(/alpha::Widget::render[\s\S]*?-> 1 caller: alphaCaller/);
    expect(out).toMatch(/beta::Widget::render[\s\S]*?-> 2 callers: betaCaller, betaOther/);
  });

  it('⛔ OPT-OUT CONTROL: without a db handle the refusal is unchanged — no caller sets, no queries', () => {
    // If this ever starts enriching, five other verbs silently began paying a query per candidate.
    const out = buildAmbiguousMatchMessage('render', ROWS);
    expectAbsentWithLiveMatcher(
      /-> \d+ caller/,
      { forbidden: '- alpha::Widget::render src/alpha.js:2\n    -> 1 caller: alphaCaller',
        allowed: '- alpha::Widget::render src/alpha.js:2' },
      out,
      'only graph_callers opts in; the shared refusal must not enrich by default',
    );
  });

  it('★ an empty set is SCOPED, never a bare "no callers"', () => {
    const out = buildAmbiguousMatchMessage('render', ROWS, 5, null, { callerSetsFrom: dbWith({ a: 0, b: 0 }) });
    expect(out).toMatch(/-> 0 callers in the indexed graph/);
    // The absence claim must carry its caveat, or it is a refusal a consumer reads as data.
    expect(out).toMatch(/FLOOR, not an exhaustive set/);
    expect(out).toMatch(/statement about THIS INDEX, not about the repository/);
  });

  it('⛔ the zero clause appears ONLY when a zero is actually shown', () => {
    // Quoting a phrase the listing does not contain trains a reader to skim the caveat.
    const out = buildAmbiguousMatchMessage('render', ROWS, 5, null, {
      callerSetsFrom: dbWith({ a: 1, b: 2 }, { a: ['x'], b: ['y', 'z'] }),
    });
    expectAbsentWithLiveMatcher(
      /statement about THIS INDEX/,
      { forbidden: '⚠ Caller counts come from the heuristic graph and are a FLOOR, not an exhaustive set. "0 callers in the indexed graph" is a statement about THIS INDEX, not about the repository.',
        allowed: '⚠ Caller counts come from the heuristic graph and are a FLOOR, not an exhaustive set.' },
      out,
      'the zero clause is conditional on a zero being present',
    );
    expect(out, 'the FLOOR caveat is unconditional').toMatch(/FLOOR, not an exhaustive set/);
  });

  it('⛔ the COUNT is the population, not the number of names shown', () => {
    // The cap-as-total defect, now fixed in three places in this repo. `+N more` is what stops a
    // list that stops from reading as a list that ended.
    const out = buildAmbiguousMatchMessage('render', ROWS, 5, null, {
      callerSetsFrom: dbWith({ a: 9, b: 1 }, { a: ['c1', 'c2', 'c3', 'c4', 'c5'], b: ['solo'] }),
    });
    expect(out).toMatch(/-> 9 callers: c1, c2, c3 \(\+6 more\)/);
    expect(out).toMatch(/-> 1 caller: solo/);
  });

  it('a failing caller lookup degrades to the plain listing rather than losing the refusal', () => {
    // A refusal that cannot be rendered is worse than one without caller sets.
    const exploding = { get() { throw new Error('db closed'); }, all() { return []; } };
    const out = buildAmbiguousMatchMessage('render', ROWS, 5, null, { callerSetsFrom: exploding });
    expect(out).toMatch(/AMBIGUOUS MATCH for "render"/);
    expect(out).toMatch(/alpha::Widget::render/);
    expect(out).toMatch(/beta::Widget::render/);
  });
});
