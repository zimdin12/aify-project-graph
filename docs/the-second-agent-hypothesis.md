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

**★ And the strongest objection is circularity.** One author observed that the
record's honesty is *downstream of the auditing* — neither party could have written
a one-directional account, because the other was checking. That sentence reads as
support for the hypothesis, and it is actually the sharpest argument against using
this record as evidence for it:

> **If the record's honesty is itself a product of mutual auditing, the record
> cannot serve as independent evidence that auditing produces honesty. It is inside
> its own claim.**

Which is why the experiment below has to be prospective and out-of-sample. Nothing
in the originating session can settle this, including the parts that look most like
confirmation.

## How to falsify it

### ⛔ What will NOT falsify it — do not run this and report confirmation

An earlier draft of this file proposed: *score every verb on auditability, compare
the ranking against measured usefulness, and treat correlation as support.*

**That is not a weak test. It is a guaranteed pass.** The "measured usefulness" data
is the *same two experiments the hypothesis was pattern-matched out of* — n=2, one
question chosen by each participant, and the claim was derived from those results
after the fact. Ranking against them succeeds whether or not the hypothesis is true.

This is the base-rate failure from the same session in a new costume: *a metric that
cannot discriminate the hypotheses, presented as a check.* Recorded here as
**non-evidence**, not as supporting evidence of lower weight — because the failure
mode is someone running it, seeing correlation, and reporting confirmation. **A
document that produces a false confirmation is worse than one with no test at all.**

### ✅ The actual experiment

Take one low-auditability verb, add **only** auditability — no accuracy
improvements — and re-run the protocol. If usefulness does not move, the hypothesis
is wrong. Out-of-sample, prospective, and it can fail.

`graph_consequences` is the obvious subject: 3-for-3 the weak verb, and every fix
that helped it in the originating session made it more *auditable* rather than more
*accurate*. That is the observation the hypothesis rests on, so pushing further
along the same axis is the cleanest available test.

**Two conditions, binding, set before the change lands:**

1. **The question is chosen by the party whose tool is being tested** — as in
   experiment 2. In experiment 1 the checking agent chose the question and grep won;
   that is the only reason that result carries weight. Write the question down
   before the change is made.
2. **Pre-register numerically what "usefulness moved" means, including a both-wrong
   band.** The originating session already demonstrated what happens when two
   parties register ranges that cannot discriminate — on a metric that turned out to
   be measuring a degraded population.

## What would make this a finding rather than a hypothesis

A second repo, a second pair of agents, and at least one verb improved *only* on
auditability with measured before/after. None of that exists yet. Until it does,
this is one session's pattern with a falsifier attached — which is the honest
status, and the reason it lives in its own file rather than in the findings.
