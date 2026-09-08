# Plan — two tags: stabilise what is true, then build the delta

> # ⛔ SUPERSEDED 2026-09-08 — DO NOT FOLLOW THE ORDERING IN THIS DOCUMENT.
>
> **The active plan is `docs/PLAN-2026-09-08-simplify-and-reach.md`.**
>
> This document's FINDINGS stand and it remains the history of the delta arc. Its **sequence does
> not**, and the failure is not cosmetic: section 5 still ends
> `S1 -> S2 -> S3 -> S4 -> S5(tag) -> D1 -> D2 -> D3 -> D4 -> tag`, and section D1 still orders the
> `structural_digest` table — work that `./CHANGELOG.md` has since WITHDRAWN, because a stored digest
> cannot be attributed to the source its named commit contained. An agent following the order below
> would rebuild rejected work.
>
> The two tags are past events, not upcoming milestones. D1 to D4 are not unfinished repairs. The
> human-use trial is UNMEASURABLE, not failed, and its window does not restart.
>
> ⚠ What survives intact is the distinction at lines 71-80: a Git-diff view of what the diff
> touches is not a claim about historical structural movement. The active plan keeps it.

**Written 2026-09-06.** Supersedes the ORDERING in `ROADMAP-2026-09-03.md`; that document's findings
all stand and are cited below. Driven by Steven's instruction: reach a measured, polished, tagged
stable point on the work already done, then a second tag for the new surface.

⚠ **Every ⛔ in any plan older than a week is suspect until re-derived.** Three were re-derived while
writing this. One had expired. That rule is why this document names the check, not just the claim.

---

## 0. What changed in the framing, and it is not cosmetic

The product is for AGENTS. That does not change. What changed is that a second output surface got
named, and it is for one human:

> A doc is compression without truth. Code is truth without compression. A graph derived from the
> code is the only thing that is both.

The engine is shared. The output surfaces are not. An agent wants JSON it can act on mid-task; Steven
wants to know what moved structurally while he was dispatching. **One computation, two renderers** is
the whole architecture of the second tag.

### Why the delta specifically, and not more map

Agents are strong at "is this correct?" and weak at "is this the right shape?". The reason is
mechanical, and worth stating because it decides what to build:

**A correctness question has a local error signal — the test goes red now. A shape question has no
signal at all at the moment it is made.** It fails months later, inside someone else's task, and
nobody attributes it back. Handing an agent a map does not create the missing signal.

⇒ **The intervention that touches the actual cause is making the consequence visible at the moment of
the change,** while it is still cheap to undo. That is the delta, and it is the only thing in this
project that acts on the cause rather than the symptom.

⚠ **And it more plausibly works on a human than on an agent.** An agent shown "this change spans four
layers" still has no stake in a cost landing after its context is gone. Steven does. That asymmetry is
an argument for the human surface, and it is honest to say the agent-facing half of the delta is the
weaker bet of the two.

### What the graph can and cannot see about shape

Four categories. Three are mechanisable; the fourth must stay out of the pitch permanently.

| | Category | Verdict |
|---|---|---|
| ✅ | **Observable structure** — cycles, layer violations, fan-in of 200, one concept under three names, an abstraction with one implementer | Detectable today. Not "is this good design", but "this has the shape that precedes pain". |
| ✅ | **Drift** — fan-in went 12 → 200 in three weeks | ⭐ THE STRONG ONE. A snapshot cannot tell you whether fan-in 200 is bad; it might be a logger. **Direction and rate, not level.** Beats grep AND a human reviewer, who also only sees the snapshot inside the diff. |
| ⚠ | **Stated intent violated** — "this was never supposed to depend on that" | Needs a declared architecture. We have that layer and it is the weakest-evidenced in the stack. |
| ⛔ | **Taste** — "this should have been a state machine" | NOT MECHANISABLE. Not by us, not by anyone. Keep it out of the pitch. |

---

## 1. ⭐⭐⭐ THE LOAD-BEARING CONSTRAINT: THERE IS NO BEFORE

Verified in the schema today, not assumed:

```
structural_fingerprints (file_path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)
      -- "a file has exactly one structural shape and re-extracting it REPLACES that shape"
graph_generation        (id INTEGER PRIMARY KEY CHECK (id = 1), generation, committed_at, ...)
      -- one row, by construction
```

**The database holds exactly one snapshot. Nothing retains history.** So:

⇒ **You cannot diff two commits from the current database.** The delta arc's first dependency is a
before that does not exist yet, and any plan that skips this is planning on a fiction.

### And this explains `graph_explain_diff`'s real limit

`graph_explain_diff` ships today and works without history — because it takes a **git** diff (which
git provides for free) and maps the changed FILES onto CURRENT symbols. That is why it needs no
snapshot.

⇒ It answers **"what does this diff touch, and what is one hop downstream of it."** It structurally
**cannot** answer **"how did the shape change"**, because it never sees the previous shape. The two
questions look adjacent and are not the same, and conflating them would be this project's own
wrong-noun error for the twelfth time.

**Both are worth having. Only the second is new.**

### Storage options, decided

| | Option | Verdict |
|---|---|---|
| a | Full snapshot per indexed commit | ⛔ Unbounded growth for a query that only needs aggregates. |
| b | **Compact structural digest per commit** — per-symbol fan-in/fan-out, edges keyed `src→dst`, layer assignment, file→symbol map | ✅ **CHOSEN.** Append-only, one row per commit, small. Holds exactly what a delta reads and nothing else. |
| c | Re-index the old commit into a temp DB on demand | ⛔ Correct but needs a worktree checkout per query. Keep as the FALLBACK for a commit with no digest. |

⚠ **(b) has a failure mode to design against up front:** a digest is only comparable to another digest
produced by the SAME extractor. An extractor change moves every number, and a delta would report that
as the code changing. ⇒ **Every digest row carries the extractor version, and a delta across a version
boundary REFUSES rather than reporting a movement it cannot attribute.** This is the
`inert-on-every-deployment` lesson (extractor-version coupling) applied before it bites, not after.

---

## 2. TAG ONE — `v0.8.0`, "the honest surface"

**689 commits since `v0.7.1`. None of it is released.** That alone justifies the stop-and-stabilise
Steven asked for.

**The bar for this tag:** everything it claims is true, and nothing it ships claims something we have
already proven false. This tag adds no features. It is a correctness and honesty pass over work that
already exists.

### S1 — Wire the coverage gate into the answer path ⭐ HIGHEST VALUE

**Re-derived today, STILL REAL:** `mcp/stdio/query/verbs/callers.js` does not read `absenceAuthority`.
Positive control: four other files do (`graph-capabilities.mjs`, `health.js`, `preflight.js`,
`read_freshness.js`). So the gate is computed, fails closed on every clause, is tested — and the verb
that answers "who calls this" never consults it.

The gate sits on `graph_health`, which an agent calls **once at session start**, not on the verb it
calls **mid-task**. That is `quality-of-the-unreachable`, instance five.

⇒ Per-symbol, following `evidence.exhaustive`; reserve outright refusal for a zero spine. A repo-wide
floor would punish every symbol for the coverage of unrelated files.

⛔ **SHIP IT AS A BUG FIX, NEVER AS THE PRODUCT BET.** Wiring this does not restore the absence claim.
It only makes the refusal honest. `exhaustive` can never become true on this architecture: the compile
DB selects which files the language server MAY index and never reports which it DID
(`cause-classification.js:24`, `index_population_unattested` is true of every call).

### S2 — Drop "safe to delete" from the pitch

Steven's open decision #3, delegated to me, and now independently confirmed by his outside agent
naming calibrated absence as our sharpest asset when it is the one thing we have proven we cannot
ship.

**The README currently contradicts itself.** Line 7 says absence claims are `NOT AVAILABLE from this
tool`. Line 386 says the point of the trust spine is to know when an agent `can make a confident
absence claim ("no callers", "dead code", "safe to delete")`. Both shipped. Also present in the four
integration `SKILL.md` sets.

⇒ Replace with what survives review and does **not** depend on exhaustiveness at all:
**transitivity** (what breaks across N hops; grep does one hop and makes the agent drive the
recursion, paying context per hop) and **virtual dispatch / overrides** (grep cannot resolve
`base*->virt()`). Plus orientation and discovery, which is the founding problem in `THE-GOAL.md`.

### S3 — Correct the false `diff-overlay` claim

`graph_explain_diff` writes `.aify-graph/diff-overlay.json` "for the dashboard blast-radius highlight
(P2-2)". **Nothing reads it.** Verified with a positive control: the dashboard's `loadOverlayJson` is
called eight times, always `functionality.json` or `tasks.json`, never the diff overlay.
`tests/unit/query/explain-diff.test.js` asserts only that the file is WRITTEN.

Producer proven, consumer absent, claim shipped anyway — `derived-claims-shipped-as-observed`, fourth
instance.

⇒ For `v0.8.0` the schema text says only what is true. **It becomes true in `v0.9.0` (D3), and the
text changes back then.** Fixing it twice is correct; shipping a false claim inside a tag is not.

### S4 — A release note for 689 commits

`CHANGELOG.md` `[Unreleased]` is empty and the last entry is `0.7.0` while `package.json` says
`0.7.1`. Not a commit dump. Three sections, and the third is the one that makes it worth reading:
what changed, **what was retracted**, and **what is still not true**.

### S5 — Version bump, tag, push

⛔ **A git tag only.** No npm publish, no GitHub Release, no announcement anywhere public. Those leave
the machine to other people and stay Steven's, and he authorised a tag, not a launch.

### GATE for `v0.8.0` — all four, or it does not tag

1. Full suite GREEN at the tag commit via `node scripts/run-suite.mjs`, log committed.
2. **Release-claims audit:** every claim in `README.md` and the new `CHANGELOG` entry has a pointer
   that RESOLVES. A pointer that cannot be resolved is not a pointer.
3. `graph_callers` refuses on a zero spine, PROVEN by driving the real server over JSON-RPC — not the
   module. ⛔ DRIVE THE REAL OBJECT.
4. Both reviewers (ef-manager, sc-critic) have seen the release note and the pitch change. Review
   traffic is free. ⚠ CHECK every claim they make rather than adopting it.

---

## 3. TAG TWO — `v0.9.0`, "the delta"

**One computation, two renderers.** Borrowed from `archify` (tt-a1i/archify), which compiles a typed
JSON IR deterministically into self-contained HTML and offers a **Before / Delta / After** review
view. It is a renderer with no extractor; we are an extractor whose renderer is a static map. The
halves are complementary, and the IR boundary is the seam.

This also satisfies the architecture bar: a context object in, a result object out, calculation as
pure functions, the entry point reading like a specification.

### D1 — `structural_digest`: the before that does not exist

Append-only table, one row per indexed commit, carrying **only** what a delta reads: per-symbol
fan-in/fan-out, edges keyed `src→dst`, layer assignment, file→symbol map, plus `extractor_version`
and the commit SHA.

⛔ A delta across an `extractor_version` boundary **REFUSES**. It does not report a movement it cannot
attribute to the code.

### D2 — `computeDelta(before, after)`: pure, and the only place shape movement is decided

A pure function over two digests. No I/O, no database, fully unit-testable, and it returns a typed
delta object:

- nodes added / removed / changed
- edges added / removed
- **fan-in/fan-out movement per symbol** — the drift signal, direction and rate
- layers spanned by the change
- **new cross-layer edges** — the shape signal that has no local error signal today

### D3 — The human surface: Before / Delta / After

The dashboard consumes the delta IR and `diff-overlay.json`, closing S3's finding by making the claim
true rather than by deleting it. The dashboard has **no time dimension today** — verified with a
positive control; its only "history" is a navigation back-stack.

**The view that has to earn the tag** is the one Steven asked for: *what changed structurally while I
was dispatching.* Not a browsable map. The map is table stakes; the delta is the reason to open it.

### D4 — Make `graph_explain_diff` reachable

Delisted in Phase 3c on real evidence (agents called 5 of 17 verbs; a listed verb nobody picks is
schema billed every session). ⚠ **That evidence is about AGENT salience and does not transfer to a
human surface reached from the dashboard.** Relisting needs its own evidence, by the same standard
that dropped it. Reachable from the dashboard costs no `tools/list` bytes at all, so that route is
free and comes first.

### ⛔ PREREGISTERED ABANDON RULE — written before the thing exists

> **If Steven opens the delta view fewer than three times in the fourteen days after it ships, it
> gets no further investment.**

Fixed now, while the outcome cannot be seen. The failure mode this guards is `correct but wrong`: a
beautiful, proven surface that gets opened twice.

#### ⛔ EVALUATION STATUS: UNMEASURABLE FROM RETAINED INSTRUMENTATION

**The rule above stands exactly as written, with its original dates.** What does not stand is the
sentence that used to follow it — "instrumented by the dashboard's own access log". It is not.

`dashboard/server.js` appends one line to `.aify-graph/delta-views.log` on every `/api/delta`
request, and that line is a bare timestamp. It carries no actor, no session, and it is written
BEFORE the endpoint checks whether a delta is even available. So the log can establish that a
request arrived; it cannot distinguish Steven opening the view from a poll, a probe, a test run, a
response that turned out to be unavailable, or the agent that built it.

⇒ **The criterion cannot be decided from what was retained.** Not "the threshold was missed" —
undecidable. An absent entry is equally not proof of no open.

⛔ **What must NOT happen to this rule.** Do not substitute request counts for opens. Do not read a
low number as a failed trial. Do not quietly restart or re-date the window so it can be answered.
Each of those replaces an honest "cannot tell" with a fabricated verdict, which is the exact failure
this preregistration existed to prevent — and it would be worse coming from the instrument's author.

⇒ **What would make it measurable, stated but deliberately not built:** an actor and an event agreed
PROSPECTIVELY, before the next trial, with an observation method fixed at the same time. A browser
click, or an `isTrusted` flag, still would not establish that the person clicking is Steven. Building
identity or analytics infrastructure to rescue a threshold would cost more than the question is
worth; directly witnessed or self-reported use can inform a later decision if it is LABELLED as
such, but it cannot retroactively satisfy an instrumented trial that was never instrumented.

⇒ Until then, further investment in the delta surface is **on hold as an explicit product decision
under missing evidence** — not as a measured failure of this rule.

---

## 4. What stays open, and stays Steven's

1. **The 12 A/B runs.** Conditionally approved; both reviewers said DO NOT; VOID anyway while
   0 of ~21 running servers carry HEAD. **HOLD THE SPEND.** ⚠ Note `v0.8.0` changes this: after the
   tag there is a version worth measuring, which is the first time that has been true.
2. **Should the post-commit hook cycle the MCP children.**
3. **Adoption re-measurement** — gated at `n = 100`, **currently 14** (2026-09-07T00:29Z, controls
   753 / 0, same instrument SHA).

   ⛔ **THERE WAS NO OBSERVED RATE WHEN THIS LINE FIRST CLAIMED ONE.** It said "roughly 30 days out at
   the observed rate", and `N-LEDGER.tsv` held exactly ONE row. One reading cannot produce a rate.
   My own working notes meanwhile carried "~8 days", which had no source at all and disagreed with
   this file fourfold, in the direction that made the gate look nearly over. ⭐ A FIGURE IN A
   CARRIED-FORWARD PROMPT IS NOT EVIDENCE; IT IS A COPY WITH NO PROVENANCE.

   ⇒ **A second reading now exists, so a rate is computable for the first time:** 5 → 14 over 1.66
   days is **5.44/day**, which puts the remaining 86 events **~16 days** out.

   ⚠ **AND THAT INTERVAL IS NOT REPRESENTATIVE, MEASURED RATHER THAN SUSPECTED.** The positive
   control — every Bash/Read/Grep in the measured population — went **255 → 753** across the same
   window. Roughly three times the usual activity, because that window contains a four-agent A/B, two
   reviewers, and a release. The count of qualifying events rose in a window where *everything* rose.
   ⇒ Treat 5.44/day as an **upper bound on the rate** and ~16 days as a **lower bound on the wait**,
   and do not write either as a date. A third reading taken after a quiet interval is what would
   settle it, and it costs one command.

   ## ⛔⛔ THE THIRD READING SETTLED IT, AND IT KILLS THE ESTIMATE RATHER THAN REFINING IT

   Taken 2026-09-07T10:25Z, after 9.9 hours in which this session did nothing:

   | interval | elapsed | Δn | rate | positive control |
   |---|---|---|---|---|
   | 1 | 1.66 d | 9 | 5.44 / day | 255 → 753 (**+498**) |
   | 2 | 0.41 d | **0** | **0.00 / day** | 753 → **753** (**+0**) |

   **Nothing moved at all.** Not `n`, not the population, not the control. So the quiet interval did
   not produce a smaller rate — it produced *no events and no activity*, and the two facts arrive
   together.

   ⇒ ⭐ **`n` IS NOT A CLOCK. IT IS A USAGE COUNTER.** It advanced exactly when the positive control
   advanced, and the control counts every Bash/Read/Grep in the measured population. The 5.44/day
   figure was measuring *a session*, not a trend — and the session it measured was largely my own.

   ⇒ **THEREFORE NO "N DAYS" ESTIMATE IS SUPPORTABLE IN EITHER DIRECTION**, and the earlier ~8 / ~30
   / ~16 figures were all answering a question the data cannot address. The gate is reached when the
   machine does enough qualifying work. Nothing observed so far predicts when that happens, and a
   fourth reading over another idle stretch would only reproduce this row.

   ⚠ **AND THE LEDGER COULD NOT HAVE SHOWN THIS UNTIL TODAY.** `shouldAppendRow` skipped unchanged
   readings — for a sound operational reason, since it runs every loop cycle and a modified tracked
   file makes `run-suite.mjs` refuse — so **only increases were ever recorded, and every rate derived
   from the file was systematically an overestimate.** The zero-growth intervals were invisible.
   ⭐ The instrument could not separate *we have not looked* from *we looked and nothing moved*, which
   is the silence-versus-dead-instrument shape inside the instrument built to keep this gate honest.
   Fixed: `n-ledger.mjs --deliberate` records either way, and only a deliberate reading may be used to
   compute a rate. The per-cycle poll is unchanged and still leaves the tree clean.

⚠ Do NOT re-raise "should `graph_health` report code age" — it already ships.
⚠ Decision material for the above exists twice already. Do not write a third copy.

---

## 5. Order, and why this order

`S1 → S2 → S3 → S4 → S5(tag) → D1 → D2 → D3 → D4 → tag`

Each step makes the NEXT measurement meaningful rather than improving something no measurement can
see — the same rule that reordered the 2026-09-03 roadmap.

S1 first because measuring or tagging a build whose safety gate is not attached to its answer path
measures the wrong build. D1 before D2 because a pure delta function with no before is a test fixture,
not a feature. D3 before D4 because the free reachability route (the dashboard) must be shown to work
before spending always-paid `tools/list` bytes on the expensive one.
