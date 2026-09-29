# Is the rename audit's population git-derived, or built from what the pass emitted?

**Asked by dashboard-manager, 2026-09-29.** Their framing, which is the one worth keeping:

> "If it is the former, a rename the pass fails to emit is not a failure, it is an absence from the
> population, and the check cannot fail on it. Every fixture after it inherits the hole."

**Answer: the input is git-derived. One of the three verdict limbs was not, and it was the one with
their hole.** Now closed, with the limb's own control. Measured, not recalled.

## Q1 — there are three populations here, and conflating them is how I nearly answered "git-derived"

| population | derived from | evidence |
|---|---|---|
| what the pass **reprocesses** | **git** — `git diff --no-renames --name-only fromRef..toRef` | `mcp/stdio/freshness/git.js:159` |
| what the fixture **does** | the **filesystem** — a real `git mv` per arm | `audit-rename-handling.mjs` arms A–G |
| what the verdict is **built from** | **three limbs, and they differ** | below |

`--no-renames` is load-bearing and already documented at `git.js:135`: without it a rename collapses
into one path and the old file's nodes survive.

The three verdict limbs:

| limb | direction | can it see a rename the pass never emitted? |
|---|---|---|
| `expectImports: 4` / `expectUnresolved` | authored absolute literal | **partly** — a dropped file shows as a count below 4. But a total cannot distinguish a swap |
| rebuild differential (`missing` / `extra`) | incremental vs forced rebuild | **no** — two code paths agreeing, already recorded as not ground truth |
| `phantomsIn` | **graph → filesystem** | ⛔ **NO, STRUCTURALLY** |

⛔ **`phantomsIn` walks `SELECT DISTINCT file_path FROM nodes` and asks the filesystem about each
row.** That catches a node whose file is gone. It cannot catch a file whose node is gone, because a
file the pass never indexed **leaves nothing to enumerate** — and an enumeration going green over zero
rows is indistinguishable from one going green over correct rows. Their diagnosis lands exactly here.

⭐ And the inverse direction did not exist anywhere: the rename audit never walked the filesystem at
all. Only the conservation audit does (`audit-ref-conservation-across-run.mjs:79`).

## The fix, and the measurement that shows it was worth adding

`coverageOfTrackedFiles` — population from `git ls-files`, each tracked, indexable, still-on-disk file required to
have ≥ 1 node. `getLanguageConfig` is **imported from the module the pass itself uses**
(`orchestrator.js:1243` wraps the same function), so the limb cannot disagree with the pass about
which files ought to be covered.

**ARM H is the limb's own control, and it answers the question that decides whether the limb is
redundant:** one plant, read by both instruments, and they must disagree.

    PLANT     deleted 3 node(s) for src/outerA.js, file left on disk and tracked: done
    COVERAGE  names the uncovered file: YES — src/outerA.js
    PHANTOM   walk over the same graph: SILENT — confirms the direction it structurally cannot see

⇒ **The blindness is PROVEN on the real instrument, not argued from reading.** Full output:
`rename-coverage-limb-output.txt`.

### Watched red, twice, for the stated reason

| mutation | result | what it proves |
|---|---|---|
| `gaps = []` (limb blinded) | exit 1, **ARM H alone FAILS** on the COVERAGE line | the limb's assertions bite — and **arms A–F stayed PASS**, which is the whole argument for ARM H existing |
| `tracked = []` (population emptied) | exit 1, **A, B, C, D, F, G all FAIL** as `VACUOUS` | the population assertion is half the limb; without it an empty population reports "NONE unexplained" and passes forever |

Outputs: `rename-coverage-limb-red-blinded.txt`, `rename-coverage-limb-red-vacuous.txt`. ARM E (the
phantom detector's own control) stayed PASS under both, confirming each mutation hit only the limb it
was aimed at.

⚠ The second mutation was first attempted with `sed` and **silently did not apply** — backslashes in
the regex died in the shell. The run went green over an unmutated file and would have been recorded as
a passing red-watch. Caught only because the anchor count was asserted before the run, which is the
standing rule and the second time it has paid.

### A gap is not automatically a defect

The pass has branches that deliberately leave a file with no nodes and **say so** — the >1 MB cap at
`orchestrator.js:643` is the clearest. So the limb separates gaps the pass **declared** via
`skippedFiles` from ones it did not, and only the undeclared ones fail. ARM H exercises both
categories over the same plant.

### ⛔ A claim I made here and dashboard-manager refuted: "fail-closed in direction is good enough"

The first version of this note said the truncation at `orchestrator.js:1028` meant "past 50 skips a
declared gap can read as unexplained; that is fail-closed — it over-reports rather than going quiet",
and treated that as acceptable. **That was wrong, and it is corrected rather than appended to.**

Their walk-forward: the first person to hit 51 skips sees a red that is **a lie about a file the cap
deliberately left alone**, and the repair they reach for is widening the allowance — which loses the
real direction permanently and quietly. Being wrong in the safe direction still hands someone a false
finding, and a false finding gets repaired.

⇒ **A check that cannot tell which of two worlds it is in must not report either.** The limb now
**refuses** and names the precondition instead of classifying.

⭐ And the detection reads the **artifact**, not a producer flag — their second warning, which would
otherwise have landed on exactly this line. Completeness is established by comparing two views of one
array: `skippedFileCount` against `skippedFiles.length`. Nothing asks the producer "did you truncate?",
and nothing hardcodes 50, which would be a number to remember to update when the cap moves. It fails
closed on its own precondition: a missing or non-numeric count refuses, because `undefined > n` is false
and a naive comparison would have read absence as nothing-was-truncated.

Both refusal shapes are watched firing in ARM H:

    REFUSAL   count(51) > list(1), i.e. a truncated report: REFUSED to classify, and returned no verdict to misread
    REFUSAL   no numeric count at all: REFUSED — absence is not treated as completeness

### ⭐⭐ The assertion that was inert, found by a falsified prediction

dashboard-manager pre-registered, without having opened this repo: mutate the limb so it returns **all**
tracked files rather than the uncovered ones; prediction **"STILL GREEN on ARM H, and green on A–G"**.

**The prediction was falsified** — seven arms went red (`rename-coverage-limb-red-saturated.txt`). But
the assertion under test, `after.unexplained.includes('src/outerA.js')`, **stayed green**, because
membership is satisfied by a limb that names everything. What took the arm red was the baseline control
and the declared-gap limb — **neither of which is the assertion under test**.

⇒ So the arm had two rescuers a differently-shaped fixture would not have had, and the green was luck
about which controls happened to exist. That is this file's own header defect for the third time: the
arm was rescued by something other than the thing being tested. Fixed by asserting **equality against
exactly the planted set**, so the assertion stops being *carried* rather than merely getting stronger.

⚠ The failure message now prints what it actually got, because the two directions need different
repairs and one fixed string named only one of them:

    saturated:  ⛔ NO — got ["src/inner.js",…5 files]; reports more than the planted set, so the limb is SATURATED
    empty:      ⛔ NO — got []; reports nothing, so its NONE means nothing

### The limit is in the name now, not in this note

`coverageIn` → **`coverageOfTrackedFiles`**. The limit below held for one commit as prose, and prose is
read by whoever wrote it; `coverageIn` is what somebody greps for when they want to know whether the
graph is complete, and they would find it, call it, and never open this file. The name states the
fail-open direction at every call site, so a misuse is visible in the diff.

## Q2 — does the same producer asymmetry exist for renames?

Their question: "several code paths that can move a node's `file_path`, one of them used to build the
expectation?"

**No, and the literal answer is stronger than a hedge: `UPDATE nodes SET file_path` has ZERO
occurrences tree-wide.** Nothing moves a node. A rename is delete-then-reinsert, so there is no
"mover" to be asymmetric about.

The four `deleteNodesForFile` call sites (`orchestrator.js:620, 626, 643, 652`) are **four reasons
inside one loop over one git-derived population** (`for (const relPath of filesToProcess)`), not four
independent movers.

⚠ **But three other node-deleting paths exist outside that loop, and no arm exercises any of them:**

| path | deletes by | exercised by an arm? |
|---|---|---|
| `orchestrator.js:1231` `deleteSpecialNodes` | node **type** | no |
| `orchestrator.js:1403` `cleanupOrphanExternalNodes` | `External` with no edges | no |
| `importer.js:778` | `ci:lsp:%` orphans with no edges | no |

⇒ Recorded as **unexercised, not as a defect** — none of the three deletes by path, so none can drop a
renamed file's nodes. The shape is the same as the conservation population being narrower than the
graph (`9fa2bd05`); the difference is that there the narrow population produced a permanent green over
real refs, and here the paths are outside what a rename can reach. Stated so that whoever widens the
arms knows these three were considered and why they were left.

## Stated limits

⛔ **`git ls-files` UNDER-COUNTS what the pass covers, and this is measured, not assumed.** An
untracked indexable file **does** get a node — `untracked-file-coverage-probe.mjs`, with its positive
control and a different-cwd control:

    POSITIVE CONTROL  the TRACKED file has a node: YES
    ANSWER            the UNTRACKED file has a node: YES

So the limb is blind to a coverage gap in an untracked file, which is the **fail-open** direction.
Deliberate: a rename this audit tests is always `git mv` on a tracked file, and git cannot rename what
it does not track, so the population is correct **for the rename question**. ⇒ **This limb must not be
reused as a general "is the graph complete" check**, where that blind direction would matter.

⛔ The limb asserts a file has **at least one node**, never that it has the *right* nodes. A file
reindexed down to a single `File` node passes. That is the count-versus-identity gap ARM G exists for,
and it is not fixed here.

⛔ `expectPopulation` has **no default**, on purpose: a default would apply silently to the next arm
somebody adds. Omitting it leaves `undefined`, fails the strict equality, and takes the arm red.

## Their other question: does anything decide "indexed" by the presence of a named artifact?

**Yes. Three sites, and one of them is a guard on an A/B measurement.** Found by going to look because
they asked, not by noticing.

| site | what it decides | how it decided |
|---|---|---|
| `scripts/linkage-scope-runner.mjs:74` | **a guard** against a mislabelled A/B arm | `existsSync(graph.sqlite)` |
| `scripts/lib/linkage-scratch-repo.mjs:89` | `isIndexed()`, docstring: "did indexing actually produce a graph" | `existsSync(graph.sqlite)` |
| `scripts/testbed.mjs:253` | `indexed:` in the status report | `existsSync(graph.sqlite)` |

⛔ The guard is the expensive one, and its own neighbouring comment states the stakes: if an index ever
leaked into the control arm "every cell would compare graph against graph and report *same*, and 'the
graph made no difference' is the most damaging false result available here, because it is
indistinguishable from a genuine null." An index that exits 0 having written only Directory/Config nodes
— the shape an interrupted run leaves — satisfied that guard. **A guard that passes on an empty database
is decoration.** The same comment recorded the existence check as *cheapness* ("`isIndexed()` is one
existsSync; there is no reason not to measure both") rather than as a weakness.

⭐ **The correct predicate already existed in the tree**, at `testbed.mjs:365`, with a fifteen-line
comment explaining precisely why existence is not success for a mutable artifact that survives a failed
run. Fixed there; never propagated to the other two — including `testbed.mjs:253`, 110 lines above it in
the same file, where the counts needed for the honest answer were already being computed two lines below.
All three now use `total > 0 && codeNodes > 0`.

Proven on the **real method**, not a copy of its body — `indexed-predicate-probe.mjs`:

    ok  no .aify-graph directory at all                isIndexed() = false (want false)
    ok  EMPTY graph.sqlite on disk                     isIndexed() = false (want false)  <- existsSync says true, so the OLD implementation returned TRUE here
    ok  a REAL graph copied in                         isIndexed() = true  (want true)

⚠ The first version of that probe reimplemented the query in a child-process shim. It would have proved
the *predicate* works while saying nothing about whether the *method* uses it. `materialise()` takes one
real fixture file, so the real object can be driven through all three states instead.

⇒ **The generalisation, which is theirs and is the second half of the population rule:** the population
must come from the thing being described, **and the predicate must come from the artifact, never from a
convention about its name.** A correctly-enumerated population tested with `existsSync(a name the
producer stopped writing)` under-counts exactly like a register does, and it is harder to see, because
the enumeration is visibly right and the bug is in a string.

### ⛔⛔ Propagating the predicate was the wrong fix, and my propagation made it worse

Their follow-up, and it is the sharper move: **the fix for "the knowledge did not travel one screen" is
not propagation, it is making the wrong spelling unspellable.** Propagation fixes three call sites and
leaves the fourth to whoever writes it next month. A correct implementation sitting beside an incorrect
one is not documentation, it is **two options** — and the cheap one wins whenever somebody is in a hurry,
which is precisely what `linkage-scope-runner.mjs`'s own comment recorded happening ("`isIndexed()` is one
existsSync; there is no reason not to measure both").

⛔ **And I had just demonstrated it against myself.** `query/verbs/health.js:126` declared the seven
code-node types **module-private**, under the comment:

> "ONE OWNER. This list decides both the primary language and whether the graph still holds any code at
> all; two copies would drift and the integrity check would quietly stop firing."

The claim was **false when written** — `testbed.mjs:209` already spelled the same seven by hand. And in
`6992154d`, the commit where I agreed with the principle, **I added a third copy** at
`linkage-scratch-repo.mjs:116`. My repairs inherit the shape of the defect they repair, for the fifth
time in this arc.

Fixed properly: `CODE_NODE_TYPES` is exported from **`mcp/stdio/storage/taxonomy.js`**, which already owns
`NODE_TYPES` and `FILE_LEVEL_TYPES`, and all three consumers import it — including `testbed.mjs`'s
child-process query string, which now imports taxonomy in the child rather than carrying a literal.

⚠ **Narrow on purpose.** The seven-type sequence is one of **44** places in the tree that spell some
`'Function','Method',...` list, in at least six genuinely different variants (search types, callable
types, symbol types, preflight types). Those answer different questions and unifying them would collapse
distinct concepts. Only the exact seven-type "does the graph hold code" predicate has one owner.

⚠ **Still a list, not derived.** "Which types count as code" is a curated judgement; deriving it as
`NODE_TYPES` minus `FILE_LEVEL_TYPES` would silently absorb every future node type into "code" and change
every consumer's meaning at once. A list is right; three copies of a list was the defect.

**Enforced mechanically**, because a prohibition living in a comment is the thing that just failed:
`tests/unit/storage/code-node-types-has-one-owner.test.js`. Watched red twice —

| mutation | result |
|---|---|
| a duplicate planted in `scripts/identity-grade.mjs` | RED, naming that exact file; the other 3 arms passed |
| the matcher itself broken | RED on "the matcher can FIND a copy" **and** on "the owner declares it exactly once" — while the *"no file outside the owner"* arm went **GREEN**, which is exactly the vacuous pass those controls exist to intercept |

⚠ **The instrument's own weakness, named rather than discovered later:** it is a **source scan**, and
`type-lists-are-subsets-of-the-taxonomy.test.js` already records the ruling that a source parse is weaker
than structural ownership — a rename or reformat makes the pattern vacuous. It cannot be an import check,
because the property is about **text**: a duplicated literal is invisible to a runtime object. Hence the
matcher is controlled three ways, the load-bearing one being that it is proven able to **find** a copy.

⚠ Their third shape — an **expectation** matched by name substring, where a renamed test means the row
names nothing and "RED, but a different test" reads as a finding about the code — **does not have an
analogue here that I can check.** The nearest thing is `measure-verb-adoption.mjs:72`'s
`POSITIVE_CONTROLS = ['Bash','Read','Grep']`, and those are **host-owned tool names with no local corpus
to compare against**, so the set-comparison guard they are building is not constructible in this repo.
Recorded as absent-and-why rather than left unanswered. Worth noting that file already survived this exact
failure once for a different reason: it published "positive control: 0, FAILS" over a nested population
holding 255 `Bash`/`Read`/`Grep` calls, and the fix was to the population, not the names.
