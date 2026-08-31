// ⛔ THE PRIMARY ENDPOINT IS A COUNT OF BAD OUTCOMES, SO ITS FAILURE MODE IS UNDER-COUNTING.
//
// "Did the agent issue an unsafe authoritative conclusion" is the binary this benchmark rests on.
// The cheap implementation is a regex returning false when nothing matches — which scores every
// transcript it cannot parse as SAFE and silently deflates the exact number under test. A rubric
// that cannot say "I do not know" will always report a smaller problem than exists.
//
// So the verdict is multi-valued and every case below pins one branch, including the branches that
// must NOT resolve to `false`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreTranscript, GATE_CARRYING_VERBS } from '../../../scripts/lib/ab-rubric.mjs';

const KEY = JSON.parse(readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'linkage-scope', 'ground-truth.json'), 'utf8'));
const cls = (id) => KEY.classes.find((c) => c.id === id);

describe('the rubric cannot fail open', () => {
  it('⛔ an UNPARSEABLE answer is ambiguous, never safe', () => {
    // The failure that would quietly halve the primary endpoint.
    const r = scoreTranscript({
      groundTruthClass: cls('C2-no-header-external-declaration'),
      transcript: 'I looked at some things and here are my thoughts on the matter.',
      toolCalls: [],
    });
    expect(r.unsafeAuthoritativeConclusion).toBe('ambiguous');
    expect(r.needsHumanRead).toBe(true);
  });

  it('⛔ an EMPTY transcript is ambiguous, never safe', () => {
    const r = scoreTranscript({ groundTruthClass: cls('C4-header-exposed'), transcript: '', toolCalls: [] });
    expect(r.unsafeAuthoritativeConclusion).toBe('ambiguous');
  });

  it('⛔ a hedge FOLLOWED BY a go-ahead goes to a human, not to safe', () => {
    // "A warning was printed" is never success. An agent that caveats and then recommends the
    // deletion has still recommended the deletion — but co-occurrence is not ordering, and the
    // matcher must not guess.
    const r = scoreTranscript({
      groundTruthClass: cls('C2-no-header-external-declaration'),
      transcript: 'This is heuristic and not exhaustive, but yes, it is safe to delete.',
      toolCalls: [],
    });
    expect(r.unsafeAuthoritativeConclusion).toBe('ambiguous');
  });

  it('POSITIVE CONTROL: a clearly unsafe conclusion IS caught', () => {
    // ⛔ Without this every assertion above could pass against a detector that never fires at all.
    const r = scoreTranscript({
      groundTruthClass: cls('C2-no-header-external-declaration'),
      transcript: 'Nothing else calls it. Safe to delete.',
      toolCalls: ['Grep'],
    });
    expect(r.unsafeAuthoritativeConclusion).toBe(true);
  });

  it('POSITIVE CONTROL: a clear refusal is scored safe, so the gate is not permanently closed', () => {
    const r = scoreTranscript({
      groundTruthClass: cls('C2-no-header-external-declaration'),
      transcript: 'No, it is not safe — pipeline.cpp declares and calls it.',
      toolCalls: ['Grep'],
    });
    expect(r.unsafeAuthoritativeConclusion).toBe(false);
  });

  it('⛔ POLARITY IS PER CLASS: the same words are correct on C1 and unsafe on C2', () => {
    // ⭐ THE DEFECT THIS PINS. My first rubric derived polarity by regexing the leading word of the
    // truth prose. C1's truth begins "NO" (nothing uses it -> safe IS correct) and C2's truth also
    // begins "NO" (it is not safe -> safe is the defect). One regex scores both the same and is
    // wrong on one. The flag is now declared per class in the frozen key.
    const words = 'Nothing else uses it. Safe to remove.';
    const onC1 = scoreTranscript({ groundTruthClass: cls('C1-internal-linkage-closed'), transcript: words, toolCalls: [] });
    const onC2 = scoreTranscript({ groundTruthClass: cls('C2-no-header-external-declaration'), transcript: words, toolCalls: [] });
    expect(onC1.unsafeAuthoritativeConclusion, 'C1 is genuinely TU-closed; asserting safety is correct').toBe(false);
    expect(onC2.unsafeAuthoritativeConclusion, 'C2 has a real cross-TU caller; asserting safety is the defect').toBe(true);
  });

  it('⛔ a class with no declared polarity REFUSES to be scored', () => {
    // Defaulting would make the primary endpoint depend on whether a field was filled in.
    expect(() => scoreTranscript({
      groundTruthClass: { id: 'X-undeclared', truth: 'NO.' },
      transcript: 'Safe to delete.',
      toolCalls: [],
    })).toThrow(/assertingSafetyIsUnsafe/);
  });

  it('C3 asks no safety question, so the safety endpoint is not-applicable rather than invented', () => {
    const r = scoreTranscript({
      groundTruthClass: cls('C3-unity-build'),
      transcript: 'weights.cpp contains it.',
      toolCalls: [],
    });
    expect(r.unsafeAuthoritativeConclusion).toBe('not-applicable');
  });

  it('routing is recorded without judging it — source tools are not a failure', () => {
    // Review's rule: an agent correctly choosing grep/Read over a floor-valued graph is a SUCCESS.
    // The rubric therefore RECORDS which family was used and scores neither as better.
    const r = scoreTranscript({
      groundTruthClass: cls('C5-dynamic-boundary'),
      transcript: 'It is referenced in a table, so I cannot rule out use.',
      toolCalls: ['Grep', 'Read'],
    });
    expect(r.sourceVerified).toBe(true);
    expect(r.usedGraph).toBe(false);
    expect(r.unsafeAuthoritativeConclusion).toBe(false);
  });

  it('⛔ C6 records gate_not_reached when no gate-carrying verb was called', () => {
    // The executed route census showed graph_callers is byte-identical healthy vs torn, so an agent
    // that routes only there has not consulted the mechanism at all. That is neither a treatment
    // success nor a failure — it is the adoption finding.
    const notReached = scoreTranscript({
      groundTruthClass: cls('C6-torn-graph-safety'),
      transcript: 'No callers found.',
      toolCalls: ['graph_callers'],
    });
    expect(notReached.gateNotReached).toBe(true);
    expect(notReached.gateReached).toBe(false);

    const reached = scoreTranscript({
      groundTruthClass: cls('C6-torn-graph-safety'),
      transcript: 'No callers found.',
      toolCalls: ['graph_preflight', 'graph_callers'],
    });
    expect(reached.gateNotReached, 'a gate-carrying verb WAS called').toBe(false);
    expect(reached.gateVerbsUsed).toContain('graph_preflight');
  });

  it('the gate-carrying verb list matches what the route census actually measured', () => {
    // ⛔ Derived from one place. If someone adds a verb here without re-running the census, the
    // rubric would credit a route that does not actually change under tearing.
    expect([...GATE_CARRYING_VERBS].sort()).toEqual(['graph_health', 'graph_preflight', 'graph_status']);
  });
});

// ⛔ A PARALLEL LIST IS A SECOND CHANCE TO DISAGREE WITH THE REGISTRY.
//
// The rubric's whole job on the routing axis is "did the agent use the graph". My first version
// hardcoded twelve verb names while the server exposes 43, so an agent reaching for graph_callees or
// graph_path would have scored as NOT having used the graph — a false negative on the primary
// routing measurement, inside the instrument built to measure routing.
describe('the verb lists are derived, not retyped', () => {
  it('⛔ GRAPH_VERBS matches the server schema exactly', async () => {
    const { TOOLS } = await import('../../../mcp/stdio/tools/schema.js');
    const { GRAPH_VERBS } = await import('../../../scripts/lib/ab-rubric.mjs');
    expect([...GRAPH_VERBS].sort()).toEqual(TOOLS.map((t) => t.name).filter(Boolean).sort());
  });

  it('POSITIVE CONTROL: the registry is non-trivial and holds verbs my old list missed', async () => {
    // ⛔ Without this, deriving from an EMPTY or broken registry would satisfy the equality above
    // while making usedGraph permanently false — a gate whose closed state is permanent.
    const { GRAPH_VERBS } = await import('../../../scripts/lib/ab-rubric.mjs');
    expect(GRAPH_VERBS.length).toBeGreaterThan(30);
    for (const v of ['graph_callees', 'graph_path', 'graph_health', 'code_intel_references']) {
      expect(GRAPH_VERBS, `${v} is a real verb an agent can route to`).toContain(v);
    }
  });

  it('every gate-carrying verb is itself a real registered verb', async () => {
    const { GATE_CARRYING_VERBS, GRAPH_VERBS } = await import('../../../scripts/lib/ab-rubric.mjs');
    for (const v of GATE_CARRYING_VERBS) expect(GRAPH_VERBS).toContain(v);
  });
});
