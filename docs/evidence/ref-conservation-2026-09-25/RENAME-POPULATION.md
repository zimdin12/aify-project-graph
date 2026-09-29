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

`coverageIn` — population from `git ls-files`, each tracked, indexable, still-on-disk file required to
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

⚠ `skippedFiles` is truncated to 50 entries (`orchestrator.js:1028`), so past 50 skips a declared gap
can read as unexplained. That is **fail-closed** — it over-reports rather than going quiet.

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
