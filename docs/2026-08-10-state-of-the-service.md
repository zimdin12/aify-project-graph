# State of the service — findings register, 2026-08-10

**Purpose:** a register of what is measured, what is believed, and what is
unknown — to be reasoned through, not acted on wholesale. Each finding carries
its evidence and its scope so a later reader can discount it correctly.

**Status of this document:** present-state analysis complete; reference-repo
analysis delegated to `graph-senior-dev-hermes` and pending; over-engineering
audit (`/ponytail-audit`) not yet run.

---

## A. Are the graphs good?

### A1 ★ Graph quality varies by LANGUAGE by two orders of magnitude — measured

`graph_health`, all four repos, same day, same build:

| repo | nodes | edges | unresolved | trust-relevant | ratio |
|---|---:|---:|---:|---:|---:|
| echoes (C++) | 9,034 | 28,003 | 4,853 | 402 | **1.4%** |
| sand_castle (C++) | 12,108 | 48,714 | 8,303 | 1,855 | **3.8%** |
| APG (JS) | 3,991 | 13,137 | 7,787 | 1,923 | **14.6%** |
| lc-api (PHP) | 15,628 | 50,527 | 53,197 | 53,197 | **105.3%** |

⛔ **CORRECTED — these ratios are NOT comparable across languages.** See A1b. The
JS figure is dominated by a class of edge C++ never emits, so "JS is 10× worse
than C++" is an artifact of extractor configuration, not a quality measurement.
The PHP figure remains real and remains the outlier.

### A1b ⛔ CORRECTION — the cross-language comparison was invalid (graph-senior-dev)

Verified independently, then re-verified by me at source:

| | |
|---|---|
| `languages/cpp.js:545` | `references: []` — C++ emits **no** generic references |
| `languages/javascript.js` | **no override** → inherits the generic default |
| `extractors/generic.js:350` | `{ nodeTypes: ['identifier','type_identifier','name'] }` — **every identifier** |

So JS emits a REFERENCE edge for every lexical identifier, including locals and
parameters, which the graph does not model as nodes and **cannot resolve by
construction**.

Measured on the current APG sidecar (7,788 uncapped rows):
- `1,910_JS_trust-relevant_rows / 1,923_all-trust-relevant_rows` = **99.3%**
- `1,879_JS_reference-short-name_rows / 1,910_JS_trust-relevant_rows` = **98.4%**
- only **56 unique targets**: `db` 379, `node` 340, `a` 204, `b` 168, `freshness` 152
- spot-verified at source: `a`/`b` are the parameters of
  `cosineSimilarity(a, b)` in `intelligence/embeddings.js:10`

**Two mechanisms in sequence, both confirmed:**
1. *Generator* — the JS extractor emits unresolvable-by-construction edges.
2. *Metric* — the categorizer then labels that population `fixable:reference-short-name`,
   promoting known-unresolvable rows **into** trust-relevance.

The classifier is **not** C++-only, contrary to my earlier guess: it correctly
excludes 2,524 JS common-name CALLS and 3,072 node/npm IMPORTS. Its blind spot is
specifically JS *lexical* identifiers.

**The genuinely comparable JS tail is `31_JS-qualified-IMPORT_rows / 1,910` = 1.6%** —
which is the number that should have been compared against C++'s 1.4% all along.

⚠ **Fix shape, and the anti-fix:** suppress generic REFERENCES for JS/TS as C++
does, or narrow them to semantically representable references — **and separately**
classify JS locals as not-applicable rather than fixable. Do **not** merely add
`db`/`a`/`b` to a word denylist: the lexical vocabulary is open, so recurrence is
guaranteed.

★ This is the third time this week a cross-population comparison has been the
defect rather than the data. It is the same shape as measuring a JS repo to plan a
C++ release — **and I made both.**

### A2 ⛔ The PHP number is not (only) a bad graph — the trust metric silently stops working

`trustBasis.excluded` is **`undefined`** on lc-api. On the other three it returns a
breakdown (`external-by-design`, `denylisted-by-design`, `shape-issue`). So on PHP
every unresolved edge counts as trust-relevant, which is why the ratio exceeds 100%.

Root cause: the categorization artifact is on an **old schema**.

```
lc-api  (Apr 21)  keys: repoRoot,total,capped,summary,buckets,samples
echoes  (May 31)  keys: + graph_commit, graph_indexed_at, source, writtenAt
```

An artifact too old to validate produces **no exclusions** rather than *"these
could not be classified"*. The trust verdict then reads `weak` for a reason that
is not about the code at all.

★ This is the defect class the entire project exists to remove — **an absence of
classification presented as an absence of exclusions** — sitting inside the
metric we use to decide whether to trust everything else. It is arguably the most
serious finding in this document.

**Also note:** lc-api's `total` is 500 (capped) against 53,197 real unresolved
edges. Even when it worked it sampled ~1%.

### A3 The overlay layer is stale everywhere and consulted by nobody

`artifactAges.functionality`: APG **112 days** · echoes **112** · sand_castle **67**.

Both managers report not consulting it. sc-manager's reason is **granularity, not
staleness** — every load-bearing question resolved at line-, blob-, or
table-membership level, which a feature name cannot answer. They confirmed a
*fresh* overlay would not change their decisions.

⚠ Bounded: both respondents are managers on deep C++ arcs. The cold-orientation
consumer is unmeasured (see D1).

---

## B. Are the tools good? Is the service useful?

### B1 ★★ The measured answer: contradiction changes behaviour, data does not

ef-manager, answering with counterfactuals against errors he had **published**:

> Every single behaviour change came from a field that CONTRADICTED MY
> CONFIDENCE. Not one came from a field that gave me more information.

Confirmed instances: `evidence.exhaustive` (reversed a published deletion-safety
verdict — cold and warm returned identical data, only the attestation differed);
`staleProcess` (turned a report into a retest); `coverageIsFloor` (sc-coder
excluded code-intel from a proof unprompted); timeout≠not-found (escalation
instead of a false "unmapped").

**Build rule: more data surface buys cheaper-same. More contradiction surface
buys behaviour change.**

### B2 ⛔ The headline usage number is still ZERO, and it is not explained by reach

sc-manager, asked to name one time a graph verb changed what they did: **none**.
They then retracted their own excuse after testing — the graph was reachable and
trusted all day and they did not reach for it, on the flagship-shaped question of
their day.

> I could reach it and did not reach for it.

That is a harder signal than any capability gap and it is unresolved. **No fix in
this register addresses it.**

### B3 Cost and value are anti-correlated

| field | cost | value |
|---|---:|---|
| `co_consumer_files` | 13 tok | found 4 files with ZERO textual occurrences of the target — unreachable by grep at any skill level |
| `matched` | 31 tok | the only guard against "I asked about X, it answered about Y" |
| `tests_adjacent` | 293 tok | the only field that has ever actively misled a user |

★ Consequence for method: **a cost-ranked cut list is the wrong instrument.**

### B4 ★ A false positive in a coverage field DELETES a warning

Fixed today. `tests_adjacent` falsely claimed coverage via a `CALLS` edge whose
`via_symbol` was `vec3`, which **suppressed `no_test_coverage`** on exactly the
symbols that had no tests.

> A false positive in a coverage field does not add noise, it deletes a warning —
> and deletes it precisely on the targets that most need it.

This nearly caused a worse error: the field was proposed for deletion *because it
was broken*, when it is the only mechanism that surfaces uncovered code and the
fix was one predicate.

### B5 ★ Multi-tracker support was broken in a way nobody could see

Fixed today. The open-task filter was an inline regex duplicated at **four** call
sites; `/todo/` does not match ClickUp's `"to do"`. **42 of 101 tasks silently
classified closed.** `graph_consequences` reported zero open tasks against a
feature that had four; now returns 16.

Two of the four sites were in `brief/generator.js` — the artifact every agent is
told to read **first**.

Also: `tasks.json` stores the tracker `url`, `graph_pull` surfaced it,
`graph_consequences` dropped it. An id like `CU-869cm99z3` is only decodable by
someone who already knows that tracker's URL scheme — which a source-agnostic
layer cannot assume.

**Implication for the multi-tracker goal (Asana / Plane / ClickUp / project
files):** the schema was never the problem. Consumption was. Any new tracker will
hit the same class of failure unless its vocabulary is added to
`overlay/task-status.js`, which now defines openness as **not-terminal** so an
unseen state fails toward *visible*.

---

## C. Method failures worth keeping

These cost more time this week than any product defect.

### C1 The recurring shape: right method, wrong referent

Nine instances in three days, mine and others':

- a contract test grepped `server.js` instead of the **served bytes** — it could
  not have caught the bug described in its own header
- an install check read the **documented** Hermes path, not the used one, and
  reported "nothing to update" while 14 stale skills sat on disk
- `server.commit` was recommended as the restart check when only `startedAt` can
  distinguish "restart failed" from "restarted onto the same commit"
- a cost audit measured a **JS** repo to plan a **C++** release
- a `&&` chain broke on `grep -c` returning 0, so a commit never ran and
  `git push` reported "up-to-date"
- a background process check errored and printed `APG servers: 0`, which reads
  as a measurement

**Every one passed honestly against the wrong thing.**

### C2 "I fixed the axis I was looking at and did not enumerate the axes I moved"

ef-manager, correcting his own experiment design. Also describes: the receipt
tiering (broke its own guard test), the `dirtyFiles` suppression (broke
`dirtyFilesOmitted` an hour later), and the task-status fix (two more call sites
found only by repo-wide grep, **after** the suite was green).

### C3 Tests that assert the buggy invariant

Three this week, two of them mine: a guard asserting `graph_health` was
"NOT short-formed" (a stand-in for "carries its scope caveat"); a test pinning
four literal sentences of `FRESH_PARAM`; and one of mine that passed identically
with and without the change it claimed to guard.

**Rule adopted:** every test is run against the reverted change. Not ceremonial.

---

## D. Open, unmeasured, or blocked

| # | item | state |
|---|---|---|
| D1 | Cold-orientation consumer — does a fresh reader want different fields? | Protocol pre-registered with falsifier; **blocked on Steven's word in ef-manager's session** |
| D2 | `.cpp` header-pairing verification against real C++ | Blocked; Steven has gated Sand Castle behind D1 |
| D3 | Reference-repo borrow analysis | Delegated to `graph-senior-dev-hermes` |
| D4 | `/ponytail-audit` — whole-repo over-engineering pass | **Not run.** Should be, on a fresh session |
| D5 | Deletion audit re-measured on C++ | Required by Part 0 of the v0.6.0 spec; ef-manager has offered to run it |
| D6 | Does any of this make agents better or cheaper? | **Unanswered since the goal was set.** B2 is the only datapoint and it is a zero |

---

## E. Candidate work, to be reasoned through — NOT a plan

Ranked by evidence behind them, not by appeal.

1. **Fix the trust-metric silent failure (A2).** A stale-schema artifact must
   report "unclassified" rather than "no exclusions". Strongest evidence, worst
   failure class, and it currently misreports one of four repos.
2. **PHP/Laravel graph quality (A1).** 105% unresolved, and a documented measured
   loss: *"lc-api trace task loses to grep by +12.5% because `Kernel.php`'s
   middleware groups are declarative arrays the extractor doesn't model."*
3. **Positive controls on absence claims.** sc-manager's practice; per-call decided
   by measurement (six failures, none of them index failures).
4. **Invariant-prose externalisation.** ~20% of every response is byte-identical
   documentation re-transmitted per call. Uncontroversial, largest single cost win.
5. **Truncation markers everywhere a list is capped.** The idiom exists and is
   applied inconsistently; inconsistency is the bug.
6. **The deletion audit**, re-measured on C++.

⛔ **Explicitly not on this list:** new tools, configurability/opt-in for fields,
overlay investment, and any ranking heuristic where a truncation marker or a
better resolution path does the job. Each was considered and rejected on evidence
recorded in `docs/superpowers/specs/2026-08-10-contradiction-surface-design.md`.

---

## F. The uncomfortable summary

The C++ path is in good shape and got materially better this week. The tooling
around trust — attestation, truncation, staleness — is the part with measured
value, and it is the part users cite unprompted.

But **B2 is still zero**, and every fix in this register is a fix to something an
agent encountered *after deciding to use the tool*. Nothing here addresses the
case where a competent agent with a working, trusted graph does not reach for it
at all.

That is the finding to sit with before choosing the next release.
