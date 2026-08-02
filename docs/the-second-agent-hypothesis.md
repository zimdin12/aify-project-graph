# The second-agent hypothesis

**Session of 2026-07-31 → 08-02 · graph-tech-lead + ef-manager · HYPOTHESIS, not a finding**

Recorded as a testable claim with its falsifier attached. One session, two agents,
one repo, and both authors were wrong about mechanisms multiple times inside it. It
is the most testable idea left standing, aimed at the question that started the
work: *are these tools useful for agentic development, including with teams?*

## The observation

Nineteen instances of a defect were documented in that session
([a-stand-in-where-the-real-thing-was-available.md](./a-stand-in-where-the-real-thing-was-available.md)).

**Not one of them was caught by its author alone.**

- Instances 8 and 9 were committed by the two people *writing the diagnosis*, while
  hunting for it, with the disconfirming number three lines away.
- Instance 14 was committed one hour after its author wrote the rule it violated.
- Instance 18 was committed *inside the lint built from these lessons*.

The document's header already concludes that a rule is not a remedy, because a rule
is a thing you read. The unexamined corollary:

> **There is no evidence in that record that any of these practices work solo.**

What was demonstrated is narrower and different: **a second agent with permission to
check, plus a norm of publishing in falsifiable form, catches what neither party
catches alone.** That is a claim about *team structure*, not individual discipline.

Both authors' good habits were visibly trained by the other:

| practice | why it appeared |
|---|---|
| publishing criteria alongside counts | scope was being checked |
| running controls instead of asserting mechanisms | mechanisms had been caught unmeasured |
| leaving reasoning as a comment on a revert | a non-action leaves no artifact to review |

## The hypothesis

> **The tool's value concentrates in the meta layer *because that is the layer a
> second agent can audit*.**

`graph_health`, evidence envelopes, receipts, provenance labels, published rules and
stated floors are all machinery for making **one agent's work checkable by another** —
the same property the two authors were manually supplying to each other by publishing
criteria instead of conclusions.

If that is right, it has a design consequence:

> **Judge a verb by whether it lets a second agent falsify the first agent's claim —
> not by whether it answers the first agent's question well.**

## Evidence for and against

**Consistent with it.** `graph_health` and the receipt primitive both do exactly
this, and both were rated highly by the checking agent. The receipt exists *only*
to make a claim portable and refutable — it refuses to validate on pin drift and
names its own cheapest disconfirming test.

**The suggestive case.** `graph_consequences` was the weak verb in three separate
measured experiments. It answers the asking agent's question well and gives a second
agent almost nothing to check: its strongest fields are inferred from a curated
overlay, and until this session they carried no provenance, no age, and no
truncation state. Every fix that improved it — `field_provenance`,
`overlay_age_days`, `documents_mentioning`, the `{items,total,truncated}` envelope —
made it *more auditable* rather than more accurate.

**Against it, honestly.** Post-hoc pattern-matching on one session. The verbs were
not designed against this criterion, so the correlation may be reversed: perhaps
auditable verbs got audited, and therefore got fixed, and therefore got rated well.
Two agents, one repo, one problem domain.

## How to falsify it

1. Score every verb on a single axis: *can a second agent contradict this output
   using only what the output contains?* Do it blind to experiment results.
2. Compare that ranking against measured usefulness in adversarial experiments.
3. **If the rankings do not correlate, the hypothesis is wrong** — the meta layer's
   value is something else, and the `graph_consequences` result is a coincidence.
4. The sharper test: take one low-auditability verb, add *only* auditability — no
   accuracy improvements — and re-run the experiment. If usefulness does not move,
   the hypothesis is wrong.

Step 4 is the one worth doing, because it is the only one where the prediction could
fail cleanly.

## What would make this a finding rather than a hypothesis

A second repo, a second pair of agents, and at least one verb improved *only* on
auditability with measured before/after. None of that exists yet. Until it does,
this is one session's pattern with a falsifier attached — which is the honest
status, and the reason it lives in its own file rather than in the findings.
