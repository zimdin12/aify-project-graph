# The second-agent hypothesis

**Session of 2026-07-31 → 08-02 · this project + the field test · HYPOTHESIS, not a finding**

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

## A refinement, from the tail of the same session

The obvious reading of the record is *a second agent catches what the first misses*.
The tail of the session suggests something stronger and more useful.

Across the final stretch, the correction rate went from **five consecutive
corrections to three consecutive clean passes** — and the turn happened right after
one author began writing the negative arm of a test *before being asked*, naming the
hops in a scope claim *before* stating it, and publishing criteria alongside counts
by default.

| version | mechanism | value |
|---|---|---|
| **weak** | the auditor catches what the author missed | per-check; scales with number of checks; **disappears with the auditor** |
| **strong** | auditing changes the author's **error rate** | the practice transfers; **persists between checks** |

The tail is consistent with the strong version. That is a materially better product
story: *tooling that makes work auditable would then pay off even on the runs nobody
audits.*

> ⚠ **The honest limit.** Three clean passes **with the auditor still present** is
> not evidence the practices survive the auditor's *absence*. All three were written
> knowing they would be checked. The solo question is exactly as untested as before —
> and the only datum either author has on the unaudited case is negative: instance 14,
> where one of them violated a rule sixty minutes after writing it, unchecked, in
> prose.

**Corrected claim:** *the observed effect is a drop in error rate under sustained
auditing — which is stronger than per-check catching, and still says nothing about
unaudited work.*

**★ And the catching was mechanical, not clever.** The auditor's own account of how
he found the miscount above: *he read three commits and had the numbers in front of
him.* The insight came free with the data. Every correction in the session followed
that pattern — a criterion published alongside a count, reasoning left as a comment
on a revert, a scope claim stated precisely enough to be wrong. **The value came
from the artifacts being checkable, not from the auditor being perceptive.**

That is the strongest form of the tooling claim, because it is the version that
does not require a talented second agent — only an output that can be contradicted.

## The one piece of unconstructed evidence

Every other observation supporting this file was **arranged**: seeded test arms,
inspected columns, controls written on purpose. This one was not.

An agent was one call away from reporting *"commit X verified"* against a server
that was not running commit X. The receipt's `server_commit` pin refused to
validate — pins drifted, claims moot — and the mistake surfaced at the last
possible moment, in the field, on a real error nobody had planted.

That is the difference between a test passing and a tool working. It is also the
narrowest possible version of the claim in this document: a machine-checkable
artifact caught a mistake that neither of two attentive agents caught by attention.

**And a limit, from the same session.** One agent produced a list of response fields
he never read; the other had it for two days and did nothing with it. It became a
41% token reduction only when a third party made token cost a goal. Neither agent
treated it as actionable — it was raised as a complaint, received as a note, and
sat.

⛔ **This was first written as a finding — "auditing improves correctness, not
prioritisation" — and that was not tested. It is retained here as the observation
plus the reason it is not yet a claim, because the overclaim is more instructive
than the tidy version.**

**What was actually observed (n=1):** the list sat for two days, then a third party
changed the goal, then it was done in an afternoon.

**Why that does not support the rule:** *the two agents never audited each other's
priorities.* Every exchange in the session audited **claims** — is this number
right, is this scope accurate, does this check fire on its own motivating bug. Not
once did either ask *"is this the right thing to be working on?"* So the conclusion
"auditing does not reprioritise" is inferred from the absence of an outcome nobody
attempted to produce.

At least three explanations fit the same datum, and nothing distinguishes them:

1. Auditing genuinely cannot reprioritise (the stated rule).
2. Auditing *of claims* cannot reprioritise, but auditing *of priorities* — never
   attempted — might.
3. Nothing was wrong with the prioritisation at all: the two days in question were
   spent on a live data-loss incident, which outranked a token cleanup on any
   sensible ordering.

Explanation 3 is the uncomfortable one, and it is at least as consistent with the
evidence as the rule that was written.

**The honest open question**, and it is cheap to test: *does a second agent asked
to audit the work queue — rather than the work — change what gets built?* One
session, one explicit "review my priorities, not my claims" prompt, and a record of
whether anything moved.

And a qualification on the pin-catch, from the agent it caught: it worked because
*both* parties also behaved correctly — one made a claim about his own repo without
asserting anything about the other's server, and the other checked instead of
assuming. **But the pin would have caught it even if neither had.** That is the
argument for the primitive: it is the only link in that chain that does not depend
on anyone behaving well.

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
