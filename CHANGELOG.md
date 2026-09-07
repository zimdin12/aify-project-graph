# Changelog

All notable changes to aify-project-graph.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Dates are ISO 8601 (YYYY-MM-DD).

## [Unreleased]

## [0.9.0] — 2026-09-07

**41 commits** (`v0.8.0..v0.9.0`). The graph gains a memory of its own past, and the dashboard gains a way to ask what
changed. A minor bump because nothing was removed, but two shipped claims were withdrawn and one
guard was found unable to fire on the case it was written for.

### Added — the structural delta

The database keeps exactly one snapshot: `structural_fingerprints` is keyed by `file_path` and
re-extracting replaces the row, `graph_generation` is `CHECK (id = 1)`. So "how did the shape change
between these commits" was unanswerable, and that is what this release makes answerable.

- **A digest per indexed commit** (`structural_digest`), written inside the rebuild transaction so it
  is published by the same commit as the graph it describes. Retention is bounded at 50
  (`APG_DIGEST_RETENTION`), a policy choice made deliberately after measuring **961 KB** for the first live
  digest — roughly a gigabyte per thousand commits, which no test would have caught.
- **`computeDelta`**, pure: symbols added and removed, edges added and removed, fan-in movement with
  its **direction**, and new cross-layer edges. A snapshot cannot say whether fan-in 200 is a problem;
  "12 to 200" is the thing nothing else holds.
- ⛔ **A delta across an extractor-version boundary REFUSES and returns no numbers.** Change the
  extractor and every structural number moves at once; reporting that as the code changing is the
  coupling that already made one shipped feature inert on every existing graph.
- **`/api/delta` and a `Shape` button** in the dashboard, deliberately distinct from `Changes`.
  Changes shows files git calls dirty now; Shape shows how the shape moved between two indexed
  commits. A refusal renders as a refusal: "no history" is stated with its reason rather than drawn
  as "nothing changed", because on a page those look identical and only one means the code held still.
- **`/api/explain-diff`**, so the dashboard can produce the `diff-overlay.json` it was taught to read.

### Fixed

- ⛔ **A cap was still being printed as a total, on the line that always prints.** 0.8.1 put the
  floor language into the CONFIDENCE footer, and in `graph_impact` that footer sits behind a
  suspicion check — so for an ordinary symbol it never appeared, while the truncation marker said
  `TRUNCATED 70 more` on a set that had already saturated at the fetch cap. Thirty rows plus seventy
  more implies exactly one hundred, and the query never established that. **0.8.1 fixed the line
  that sometimes prints; this fixes the line that always does.**
- ⛔ **And it reached two verbs out of seven.** `renderCompact` has seven call sites; five of them
  report a remainder — `graph_callers`, `graph_impact`, `graph_callees`, `graph_neighbors` and
  `graph_search` — and the other two never do. `graph_callees` — the direct mirror of `graph_callers` — capped three queries with
  no way to detect that it had, so asking who calls X named a floor while asking what X calls capped
  in silence. `graph_neighbors` had one such query. `graph_search` had the same shape at a cap of
  200: its saturation test could not tell a complete set of exactly 200 from a truncated one, so it
  announced a floor on complete results, and a false caveat costs a reader as much as a missing one.
  All of them now fetch one row more than they keep, and say so only when that row arrives.
- **The renderer refuses to guess.** Reporting a remainder without stating whether the set it was
  subtracted from was complete now throws rather than defaulting. The first version of this fix
  defaulted to "complete", which made the repair opt-in per verb — a list somebody has to maintain,
  which is how the previous three items happened. The check is scoped to answers that actually
  report a remainder, so verbs that report none are never asked.
- ⛔ **The overcount guard could not fire on the case it was written for.** `graph_callers("has")`
  returned 25 caller rows at `conf=0.90`, all collisions (`groups.has(rawId)` on a Map), with no
  warning at all. The trigger tested for AMBIGUITY — many same-named symbols, few results — while the
  real failure is the mirror image: one symbol absorbing spurious inbound edges from a builtin method
  name. Exactly **one** node in the graph is labelled `has`, so the clause was dead.
  Population measured before the threshold was chosen: leaf name ≤ 4 characters and fan-in ≥ 10 is
  **42 of 2,578 symbols (1.6%)**, and that set reads `join:755 trim:259 has:253 Set:182 all:159
  Map:119` — every one a JavaScript builtin. The predicate also lived byte-identically in two verbs,
  so the hole existed twice; it now has one owner.
- **A suite verdict is void unless the tree held still for the whole run.** `run-suite` refused to
  start on a dirty tree and then never looked again, so a run could begin at one commit and finish
  against a tree three commits later while still printing a verdict for the old one. It now reads
  HEAD and the tracked-dirty set at both ends and exits 3 rather than printing a verdict.
- **The server reported version `0.1.0` while shipping `0.8.0`**, a literal that survived nine
  tagged releases. It is the one field a client reads to know which build it is talking to, on a project
  whose whole freshness story is about processes holding old code. Now derived from `package.json`.
- **Skills told agents to wait for a gate that can never open.** `cpp-inner-loop` carried withdrawal
  notes near the top and still instructed gating on `evidence.exhaustive === true` further down;
  `graph-guide` framed it as *the* delete gate. Both corrected, and the short-name overcount is now
  documented where an agent will meet it.

### ⛔ What is still not true

- **The delta only has data when the graph is REINDEXED.** "What changed while you were dispatching"
  therefore depends on reindex cadence, which is a live decision about whether the post-commit hook
  should cycle the MCP children. This is a dependency, not a shipped guarantee.
- **A bigger graph is not a better one.** A forced rebuild holds ~1,411 symbol-to-symbol edges an
  inherited graph lacks. Hand-graded on the distinctive-name subpopulation: **25 REAL, 4 COLLISION,
  1 UNDECIDABLE of 30**, so about 271 of those are genuine recoveries — while roughly 712 target a
  name of three characters or fewer and are presumed collisions. **A rebuild trades precision for
  recall, and both halves reach the user.** Two earlier readings of this gap were published and
  retracted in place; neither should be cited.
- **The scale A/B has still never been run.** Unchanged from 0.8.0.
- **`evidence.exhaustive` can never become true on this architecture**, and `absenceAuthority` is no
  longer grantable for the same reason. Absence claims need `rg`.
- **Two tests fail without a defect behind them**, now recorded in `docs/FLAKY-TESTS.md` with what
  would actually close each rather than a tally.

## [0.8.1] — 2026-09-07

A patch release for six defects found after v0.8.0 was tagged. Five of them were measured, and one
of the five was measured by four agents rather than by a test. Nothing here changes an interface;
every fix narrows a claim the previous release made too strongly.

### Fixed

- **A cap is not a count.** `graph_callers` reported `CONFIDENCE: 100 callers` for a symbol with ten
  real call sites. 100 was never a count. `EDGE_FETCH_CAP` is 100 and the query saturated there,
  and the verb already knew: `edgesTruncated` is computed from a deliberate `LIMIT CAP + 1` and it
  reached the trust banner while never reaching the line that printed the number. A saturated
  result now reads *at least N (the fetch cap was reached, so this is a floor, not a total)*, and an
  untruncated one still reads as a plain number, because a qualifier on every answer is decoration.
- **`graph_impact` could not detect its own cap.** It used `LIMIT 100` with no `+ 1`, so a full page
  and a truncated page were indistinguishable to it. It now fetches one more than it keeps.
- **The overcount warning could not fire on the case it was built from.** Asked for the callers of a
  four-character name that is also a builtin method, the verb returned 25 heuristic rows with no
  warning at all: the old trigger wanted *fewer* than ten results, and the collision shape produces
  many. The predicate now models both shapes, has one owner instead of two byte-identical copies,
  and exempts compiler-resolved results, which were resolved by a compiler rather than by a name.
- **The server did not report its own version.** `serverInfo` carried a hardcoded string, so a
  client could not tell which build answered it. It now derives from `package.json`.
- **A suite guarded its entry and not its duration.** `run-suite` refused to start on a dirty tree
  and then never looked again, so a run could begin at one commit and print a verdict for it while
  finishing against a tree three commits later. That happened, and four of the five failures in the
  resulting log were artifacts of files moving underneath the run. Head and dirty state are now read
  at both ends, and a run that measured a moving target exits 3 as VOID instead of returning a
  number that looks like a result.
- **Two skill files documented parameters that do not exist**, and `graph-guide` said nothing about
  reading a caller count that might be a cap. Corrected and synced across the four runtime trees.

## [0.8.0] — 2026-09-06

**692 commits, 937 files, 2026-08-25 to 2026-09-06.** A minor bump rather than a major one because
no public interface was removed, but read the second and third sections before upgrading: this
release withdraws more claims than it adds features, and that is the point of it.

⚠ **Read the commit composition honestly.** 204 `evidence`, 157 `fix`, 76 `test`, 75 `docs`, 42
`feat`, 21 `preregister`, 21 `finding`. A large share of the `fix` commits repair *measuring
instruments*, not the product. That work was necessary — each one caught a wrong claim before it
shipped — but a commit count is not progress, and reporting it as such would be the exact error this
project keeps recording.

### Added

- **The rebuild is one transaction.** A graph is never observed half-built: the whole rebuild commits
  or none of it does, with savepoints for chunks. Torn reads that previously returned counts like
  `[8306, 0, 30, 1594]` mid-rebuild are gone.
- **Publication attestation.** The database carries a generation row written inside the rebuild
  transaction; a reader that finds the manifest disagreeing with it is looking at a half-published
  state and refuses instead of answering. An unattested graph cannot support the claim that deletes
  code.
- **A rebuild serves the previous snapshot** rather than refusing outright, so an in-flight index no
  longer blocks every read.
- **Symbol identity repair.** A declaration and its definition no longer fork into two symbols, and
  overloads split by normalized parameter list. Caller sets for same-named symbols in different
  namespaces no longer merge. ⚠ Blast radius measured at 3 of 6,272 groups (0.048%) **on a JavaScript
  repository** — the evidence says explicitly that this is not a prediction for C++, where overload
  sets are the norm rather than the exception
  (`docs/evidence/m1b-overloads/FINDING-param-list-key.md`).
- **Absence answers name their own scope.** An empty result states what was searched — the spine that
  covered it, its measured file coverage, and what the analysis structurally cannot see for that
  language — instead of a bare "no callers".
- **Discovery reaches the document layer.** The founding question of this project returned no results
  with 230 documents indexed, because `kind` defaulted to code. Fixed; 3-4 of 10 to 6 of 10 correct
  documents on the pinned corpus.
- **A negotiated evidence contract (v2).** Consumers prove they understand the new shape before
  receiving it; an unsupported version is refused, never quietly downgraded.
- **One admission door for every External-bound edge**, replacing scattered per-call-site rules.
- **A deletion-guard hook** with a re-derivable fire rate, so enabling it is an informed choice.

### Changed, and these are withdrawals

- ⛔ **`capabilities.absenceAuthority` is no longer grantable.** It could return `true`, and
  `graph_health` presents it as the field that answers the question that deletes code — while every
  answer path says "NOT exhaustive" unconditionally. It was a licence nothing in the product could
  cash. The gate now also requires that the language server attested *which files it indexed*, which
  the compile DB never reports. Named as a clause rather than hardcoded, so a future workspace-symbol
  round-trip can satisfy it.
- ⛔ **"Safe to delete" is out of the pitch.** The README sold the trust spine as knowing when an
  agent *can* make a confident absence claim, while the top of the same file said absence claims are
  not available. The claim is withdrawn rather than fixed: it is our weakest surface, it is where
  `rg` is strongest, and it is where being wrong is most expensive.
- ⛔ **The four integration skills no longer say "branch on `exhaustive === true`."** That flag is
  withheld on every verb, so the instruction asked agents to branch on something that can never be
  true.
- ⛔ **`graph_explain_diff`'s overlay no longer claims a consumer.** It wrote a file "for the
  dashboard blast-radius highlight"; nothing read it.
- **Doc-reference rule 3 was deleted** at 0.9311 held-out precision (98 edges to 35). The surviving
  rules all anchor their evidence adjacent to the token.
- **An earlier edge-creation guard was reverted** — it deleted real edges, because `.catch()` is a
  member call. Refusing to create a node is recoverable; refusing an edge destroys evidence.

### ⛔ What is still not true, stated because a release note that omits this is marketing

- **The scale A/B has never been run.** Every file under `docs/evidence/m5-scale/runs/` is a mock.
  The harness is built and preflighted; the runs are unspent.
- **`evidence.exhaustive` can never become true on this architecture.** The compile DB selects which
  translation units clangd *may* index and never reports which it *did*. Absence claims need `rg`.
  This is a structural limit, not a pending fix.
- **Organic adoption is 0 of 973.** No subagent on the development machine has ever reached for these
  tools without being told they exist. A re-measurement is running under a preregistration and is
  gated until n = 100; it currently reads 5.
- **Recall is unmeasurable here.** Refusals outnumber admissions 138:1, so a 0.7% miss rate halves
  recall and no feasible sample excludes it.
- **There is no structural delta.** The database holds exactly one snapshot, so "how did the shape
  change between these commits" cannot be answered today. `graph_explain_diff` answers what a diff
  *touches* by mapping changed files onto current symbols; it never sees the previous graph.
- **Whether a Hermes `delegate_task` child inherits MCP tools is unverified.**

### Fixed

Selected from 157, chosen because each was a wrong claim rather than a crash:

- `graph_health` counted code-intel records across nine collections and offered the total as the
  extent of verified evidence, which lives on 31 files.
- A second clangd argument list bypassed the preamble bound and left 41 GB of preambles on a 1.9 TB
  volume that reached 0 bytes free
  (`docs/evidence/ops/FINDING-41GB-of-clangd-preambles-and-a-full-volume.md`).
- The gitignore evaluator ignored negations, so a tracked modified file rendered `dirty=0` — a dirty
  count reading low is the fail-open direction.
- `absenceAuthority` was granted on a spine that had decayed 46% since collection.
- A shipped feature was inert on every graph built before it, because it was coupled to the extractor
  version — the failure mode the delta work is designed against up front.

## [0.7.0] — 2026-08-25

**A minor bump, not a patch, because BEHAVIOUR CHANGED for anyone reading the evidence
contract: `evidence.exhaustive` is now withheld on every verb, `code_intel_hierarchy` no
longer certifies an absence, and `operationallyDegraded` is a new field. Capability did not
grow. Nine ways of returning a confident wrong "nothing calls this" were removed.**

### 2026-08-25 — six ways to return a confident empty caller set, and an adoption number

**The shape all of these share** (the field fleet, field-probing sand_castle): *"an empty caller
set from a TU that never compiled is byte-identical to a TU with no callers."* That is the
most expensive output this product can produce, on the one question grep cannot answer.

**Compile-DB selection was decided by directory NAME, not contents.** `PROBE_DIRS` was a
hardcoded list of eleven names; `build-clangd-native/` was not on it, so the only
toolchain-matching DB in that repo could never be selected. The list ranked
`build-win-clangd` first *because our own fix text tells users to create it with clang-cl* —
and the DB sitting there held 679/679 MSVC `cl.exe`, rooted in a per-session temp
scratchpad. `doctor` reported `=> READY`, because the entire readiness test was
`firstPartyCount > 0`.

- Candidates are now **derived from disk** — any directory holding a `compile_commands.json`
  is found, and the name means nothing.
- New `toolchain_mismatch` detection: MSVC `cl` flagged, `clang-cl` explicitly not (it is
  clang in an MSVC driver), unknown compilers not accused. Names the better DB when one is
  on disk.
- New `compile_db_external_root` detection for a DB rooted outside the repository.
- Ranking is now **toolchain match > repo-rooted > native > coverage**. Entry count is last:
  a bigger DB clangd cannot compile still truncates caller sets, and coverage-first is
  exactly how the MSVC database won.
- `dbReady` fails closed on either condition.

**`code_intel_analyze` carried a SECOND hardcoded list** (four entries) that had drifted from
the first, ignored `APG_COMPILE_DB`, and ignored the normalized DB `doctor` itself writes. It
reported `compile_db_missing` with two databases in the repo — and returned **byte-identical
output for a real source and a fabricated one**, so it could not distinguish PRESENT from
ABSENT. Deleted, not extended; `prepareCompileDb` is now the single discovery path.

**An empty caller set from a translation unit that never compiled now says so.** A clangd
with no MSVC environment returns **0 references for any TU including a standard header** and
reports `status: ok` — measured, 2 refs vs 0 on identical TUs differing only by
`#include <cstddef>`. `--query-driver=*` does not cover it; that is GCC-style driver
interrogation, and clang-cl finds the MSVC STL through `INCLUDE`. The diagnostics were on the
LSP client the whole time and this verb never read them. Empty results whose TU failed now
carry `evidence.translationUnitFailed`, the unresolved header names, and the remedy.

⚠ **Guidance corrected on every surface it appeared.** Our own advice named
`build-win-clangd/` and said APG auto-discovers it. Both halves are now wrong: the name is
not special, and telling people to create a *directory* without telling them to verify its
*contents* is what produced the MSVC database in the first place. The skills, the
`foreign_toolchain` fix text, and the server instructions now say the name does not matter,
that entries must name `clang-cl` rather than `cl.exe`, and that the clangd process itself
needs the MSVC environment on Windows.

**Adoption, measured from 2.8 GB of transcripts rather than from recall.** 80% of sessions
invoked a graph verb where the server is installed (8 of 10, across three repos); 0% where it
is not (0 of 12, six repos). The published finding that agents self-route away from query
tools does not replicate here — adoption is an **install** problem. Subagents are the real
gap at 0.7% (7 of 1049). ⚠ One machine, 22 sessions; install and task class are confounded;
and a call is not a benefit — `graph_health` is the top verb and that is maintenance.


## [0.6.1] — 2026-08-11

**A patch on the release that shipped hours earlier, found by the first person to
verify it.** `server.version` was read from `package.json` on disk at query time, so it
reported the CHECKOUT's version and never the running process's.

Observed twice on one process: `"0.5.0"` before the release commit, `"0.6.0"` after,
with `startedAt` **identical**. The number moved without a restart.

`commit`, `staleProcess` and `staleWarning` were all honest — and `version` contradicted
all three inside the same object, in the one block whose job is telling a reader whether
to trust the build. An agent asked to verify the shipping build reads `version`, sees the
new number, and proceeds on a stale process. That is v0.6.0's own through-line landing on
v0.6.0.

### Fixed
- `server.version` is captured at module load beside `server.commit`, so it describes the
  running process rather than the filesystem.

The prior comment on that line read *"version alone is not load-bearing."* It became
load-bearing the moment release notes were keyed to a version number — **a field's blast
radius is not fixed at the time it is written.**

## [0.6.0] — 2026-08-11

**Every verb that could be confidently wrong now either is right, or says it cannot
tell.** v0.5.0 made freshness somebody's job. This release is about the answers
themselves: eight defects where the tool stated something false with no hedge, found
by two agents testing on a real 339-file C++ repo rather than on fixtures the author
wrote.

The through-line: *an output that degrades toward silence is survivable; one that
degrades toward a plausible lie is not.*

### Fixed — outputs that were confidently wrong

- **`graph_explore` served the wrong function's body.** Line offsets came from the
  index, bytes from the current file, and nothing reconciled them — so inserting lines
  above a symbol slid the window onto different code, under the right symbol's header,
  beneath a banner reading *"do NOT re-Read the files shown below."* That promise was
  what made it serious: it told the reader to stop checking. Now two independent
  checks — a symbol absent from its own body is proven drift; a file modified after
  indexing is unverified regardless — and the Read-equivalence promise is withdrawn for
  exactly the blocks that failed.
- **`graph_trace` cried wolf on every correct trace.** Its no-path branch passed
  `"FROM: label"` as the identifier to verify, a string that cannot occur in source, so
  it emitted a guaranteed false *WRONG BODY*. It also never passed the index timestamp,
  leaving its staleness check dead. The verb that inlines the most source was verifying
  the least.
- **`tests_adjacent` reported coverage that did not exist**, and the false positive
  *suppressed* `no_test_coverage` — so the safety axis reported SAFE on an untested
  symbol. A `CALLS` edge to a shared math type counted as evidence about an unrelated
  function.
- **`import_linked` was claimed where no import existed**, and cleared the
  "unverified for this symbol" caveat on file-level evidence. A caveat may now only be
  cleared by evidence at the same granularity as the claim it qualifies.
- **`graph_index` named files it had dropped as `processed`.** A 4.1 MB header was
  deleted from the graph, reported as indexed, and its symbols were unfindable — with
  no disclosure in the response the reindexing agent actually reads.
- **A chunk rollback left the graph structurally inconsistent.** `ROLLBACK` unwinds SQL
  and leaves JavaScript untouched, so refs from rolled-back files could resolve into
  edges whose source node no longer existed, and the skip count reported one file when
  a whole chunk was gone.
- **42 of 101 tracker tasks were silently dropped** from the brief every agent is told
  to read first, because one status string was unrecognised.

### Added — the tool now attests what it did

- **`INCOMPLETE CORPUS`** in `graph_health`, plus `skippedFileCount` / `skippedFiles`
  in the manifest and the index response. Four skip paths are counted and named,
  including the >1 MB cap that had been dropping files silently by design. *Success
  must attest corpus and scope* — an index that cannot say what it failed to read is
  reporting that it finished, not that it succeeded.
- **`symbol_direct`** tests_adjacent tier — the only tier that verifies the symbol
  rather than the file it lives in.
- **`npm run smoke`** — boots the server and exercises the three calls every client
  makes, in 1.3 seconds.

### Removed

- ⚠ **`symbol_referenced` tests_adjacent tier.** After the identity fix its only
  reachable case was an escape hatch in an unrelated cap. Consumers reading
  `tests_adjacent_provenance` will no longer see this value; `symbol_direct` and
  `import_linked` carry the real claims.

### Changed

- `rebuild-incomplete` → `previous-run-did-not-finish`. It never detected corpus
  completeness — it read a process-completion flag — and stayed silent on a genuinely
  incomplete corpus.

### Internal

- Suite composition is measured and ratcheted: 202 behavioural / 10 mixed / 15
  source-contract files. Tests that assert implementation *text* cannot fail when the
  behaviour breaks, and three of them fired on fixes this cycle rather than on
  regressions, so they are now counted separately and cannot grow silently.


## [0.5.0] — 2026-08-09

**Freshness becomes somebody's job.** Two repos measured at v0.4.0: `sand_castle`
20 commits stale — its manager made zero graph calls in a full session and
concluded the tool did not help — and `aify-project-graph` itself **130 commits**
stale. Neither was an indexing bug. The refresh mechanism existed, had never been
installed, and nothing reported its absence.

Tracing that turned up worse. There were **two** post-commit hook installers with
mutually-unrecognised markers, and the one documented in the README guarded on
`[ -f "$REPO_ROOT/scripts/graph-reindex-hook.mjs" ]` — a file present only in
APG's own tree. Installed into any user repo it exited immediately and did
nothing, silently, forever. Every file-content check would have passed.

- **Refresh runs on every git event that moves HEAD** — `post-commit`,
  `post-merge`, `post-checkout`, `post-rewrite` — not just local commits.
  `post-checkout` inspects git's third argument so file checkouts do not trigger
  a reindex.
- **One installer, one payload.** The surviving payload refreshes the graph
  **and briefs and the unresolved categorization**. The narrow version would have
  produced a fresh graph behind a stale brief while reporting healthy — and since
  the session-start skill tells every agent to read `brief.agent.md` first, that
  is a freshness mechanism certifying stale data.
- **Outcomes are recorded, not discarded.** Hooks run backgrounded with
  `>/dev/null 2>&1` and cannot report through an exit code, so each writes
  `.aify-graph/last-refresh.json` plus an appended `hook.log`.
- **`graph_health.refreshMechanism` reports a dead mechanism as `degraded`** —
  including installed-but-never-observed. An un-hooked repo reads
  `unconfigured`, not degraded: fail-closed applies to a mechanism that is
  supposed to be running, not one that was never enabled. Hooks are counted by
  MARKER, not by path, so a foreign or superseded hook is not mistaken for ours.
- **Installation is documented setup**, in the README and every `install.*.md`,
  stated as per-clone because `git clone` does not carry hooks.
- **Auto-reindex is documented as the fallback** it always was — it refreshes on
  the read path, which means blocking.

Rejected during design, recorded so they are not re-proposed: a shared language
server (measured — clangd instances already share the on-disk background index),
cross-process watcher election (an owner that dies reintroduces silent staleness
as a distributed-systems problem), and one service per directory (its benefit
addresses a measured non-problem — 429 MB across 6 processes, 0.45% of RAM —
while making a long-lived stale-code-serving process the default architecture).

Verified on this repo, which was the 130-commit case: the hooks fired on
`post-commit` and `post-rewrite`, regenerated briefs, chained `from`→`to` across
commits, and moved `refreshMechanism` from `unconfigured` through `degraded` to
`ok`.

## [0.4.0] — 2026-08-07

**The release where the tool stops trusting silence.** v0.3.0 shipped with a
fail-open coverage default that could return `exhaustive:true` on an incomplete
caller set — a field test on a real C++ repo got **3 of 8 real call sites** with
no signal that anything was missing. That class is closed: all six v0.3 hardening
P0s are done, and an absence claim now requires proof of coverage rather than
absence of evidence.

The organizing lesson across 137 commits: **a stand-in was used where the real
thing was available.** Twenty documented instances — a hand-written verb count
standing in for the profile set, a text regex standing in for the AST answer, a
default standing in for a measurement, a test asserting the buggy invariant it
was meant to catch. The remedy is never a rule; it is a fail-closed default or a
forced door.

### Trust and evidence
- `evidence.exhaustive` requires `coverage.complete === true`; every `false`
  carries a named cause from a published vocabulary.
- Receipts: content-addressed, pin-checked, with a named disconfirming test, so a
  second agent can refute a claim without re-deriving it.
- `graph_consequences` labels every field `observed` vs `inferred`, and
  `overlay_coverage` now distinguishes **unmapped** from **unaffected** — an empty
  curated field says which it is instead of reading as "nothing here".
- `graph_health` reports staleness *consequences*, a named coverage denominator,
  and the rule that filtered its unresolved-edge count.

### Correctness
- C++ `.cpp` targets inherit their paired header's test adjacency
  (`companion_header_linked`) — nothing ever `#include`s a `.cpp`, so the honest
  structural answer was zero.
- Destructors and operators extract under their real names (AST answer preferred
  over the text regex).
- The stale-process guard no longer caches its own "I am not stale" verdict — it
  had disabled itself precisely on long-lived processes, the population it exists
  for.
- Dashboard `repoRoot` is passed through; it had been serving another repo's
  overlay over your code.

### Cost
- `tools/list` cut from 8010 to 5637 tokens — paid by every session, including
  those that never touch the graph. 80% of it was schema, not prose; the single
  largest item was one shared parameter inlined into ten verbs.
- Doubt clauses deliberately stayed in the always-loaded surface: a caveat that
  only lives in a skill is one the agent may never load.

### Known limits at this tag
- The `.cpp`/header pairing is unit-tested against a fixture reproducing the
  reported shape, but has not yet run against a large real C++ codebase.
- Graph freshness is still nobody's job by default — the `post-commit` reindex
  hook exists but is not installed as part of setup, and covers only `post-commit`.
  That is the subject of the next release.

### 2026-07-26 — the trust contract stops trusting silence (BEHAVIOR CHANGE)

A scored field test on a real C++ repo returned **3 of 8 real call sites** while
reporting `exhaustive:true, degraded:false, confidence:"high", warnings:[]`.
Since our instructions tell agents that `evidence.exhaustive` licenses "no
callers / dead code / safe to delete", the flag was actively wrong — worse than
no tool, because grep gets it right in one second.

**If you consume `evidence.exhaustive`, expect more `false`.** That is the point:
it is now granted only on POSITIVE proof of coverage.

- **Compile-DB coverage must prove it covers YOUR code.** It only ever asked "is
  the DB foreign or a unity build?". Measured on the reporting repo: all five
  compile databases held 441–512 entries and **zero first-party** ones (every
  entry `_deps/` third-party), so clangd had no compile command for any project
  source — and that read as complete coverage. Coverage is now a **ratio** of
  first-party DB entries to first-party sources on disk, the C++ path is
  file-aware (a queried source with no compile command is not covered), and the
  header exemption is withdrawn when overall coverage is poor.
- **Unknown coverage no longer counts as proven.** `exhaustive:true` requires
  `coverage.complete === true`; undefined / null / undecided now yields
  `exhaustive:false, cause:'coverage_unknown'`. Applied to references,
  definitions (which previously took no coverage input at all) and
  `code_intel_hierarchy` (the transitive "who calls X", which licenses dead-code
  claims just as strongly).
- **A stale collection can no longer emit the exhaustive banner.** Staleness used
  to be appended AFTER the "index-ready, N callers" wording was chosen; it is now
  decided first. Same for a collection that left ≥10% of symbols unresolved, and
  for one with no resolution telemetry at all (absent measurement ≠ good
  measurement).
- **`graph_callers` says what its locations ARE** — caller *declarations*, not
  call sites (edges are function-granular). It scored 0/8 on a call-site census
  purely because the format read as a call site.
- **`graph_search` no longer truncates silently.** It capped candidates in SQL and
  again on display while rendering no marker at all; it now reports
  `SHOWING n of m` and warns when the hard candidate cap makes results a FLOOR.
- **`graph_callees` names the dispatch site** where a callee set provably ends,
  instead of only warning that it might be incomplete.
- **Every `cause` the server can emit is now documented** in the MCP instructions
  — 6 of 9 were missing while the list read as complete.

### 2026-07-26 — C++ extraction: export macros in the class head

`class MYLIB_API Widget { … }` extracted **NOTHING** — the class and every member
vanished, silently, contained to that class. Fixed with one offset-preserving
pre-parse pass (measured: only this shape breaks; `FORCEINLINE`, reflection-macro
bodies and leading attribute macros were all fine). Guarded against the shapes
that are lexically identical: `struct RECT r;`, brace-init `struct POINT_T p{1,2};`,
forward declarations, `enum class`, and macros inside strings/comments.

### 2026-07-26 — fixed: a relative `repoRoot` silently produced an empty graph

`normalizeRelativePath` derives repo-relative paths with
`absPath.slice(repoRoot.length + 1)`, so `repoRoot:'.'` chopped two characters off
every path, nothing matched a language config, every file was skipped — and the
rebuild reported **success**. Measured 562 nodes / 0 files versus 3603 / 398.
`ensureFresh` now resolves `repoRoot` once at the entry point.

### 2026-07-26 — other

- `graph_health` reports a compile DB covering zero first-party sources, and flags
  a code-intel collection whose indexed commit no longer matches HEAD.
- `readOnlyHint` annotations on `tools/list` (Cursor's Ask mode refuses tools
  without them). Verbs that materialize the normalized compile DB are correctly
  NOT annotated read-only.
- New `scripts/dump-graph.mjs`: deterministic natural-key graph dump so
  behaviour-preserving changes can be gated on a byte-identical diff.
- `scripts/compact-graph.mjs` reports leftover collection envelopes (452 MB found
  on the reporting repo); `--delete-envelopes` removes them.
- Installer: config reads tolerate a UTF-8 BOM (Windows editors write them
  constantly) instead of aborting, and back up any file before modifying it.
- Docs: `.aify-graph/` is per-working-directory, not per-agent; Hermes install now
  gives an evidence-based decision procedure instead of an unresolvable conditional.

## [0.3.0] — 2026-07-26

Stability release: everything the Sand Castle team hit in real daily use, closed. This is the version to run — the trust contract, the freshness signals, and the install paths all had honesty or accuracy gaps that only showed up under real multi-agent usage on a high-velocity C++ repo, and they're fixed here. Highlights: the compile-DB probe now prefers a native Windows DB (so C++ caller sets stop silently truncating), staleness warnings finally say how far behind and what to run, Windows backslash paths work across every path-taking verb, the CMake build graph landed, and the Hermes install docs were wrong in two ways that made the graph unreachable from that runtime.

### 2026-07-26 — shipped skills: fixed silent cross-runtime drift (incl. missing trust guidance)

We ship the same 14 skills to four runtimes as four physical copies, and nothing verified they stayed in sync. They hadn't. Four distinct defects, found by adding the guard first:

- **codex and cursor were missing the compile-DB coverage gate entirely.** The main `skill/SKILL.md` for those two runtimes never received the Windows-first trust guidance that landed in claude-code and hermes — the paragraph explaining that a foreign/unity `compile_commands.json` makes the clangd index silently PARTIAL, that this returns `exhaustive:false` with `cause:"partial_compile_db_coverage"`, and that such a result must NOT be read as "no callers / safe to delete". Agents on those two runtimes were reading a skill that omitted the core absence-claim safety rule. Also missing: the cold-clangd retry guidance ("index/AST not confirmed ready" is a retry signal, not "no hierarchy"). Both propagated.
- **`''` corruption in shipped prose.** The codex/cursor/hermes copies of `cpp-inner-loop` and `graph-dashboard` each carried 6 doubled-apostrophe artifacts (`type''s`, `there''s`, `can''t`, `repo''s`, `it''s`) — a quoting escape that leaked into rendered markdown body text. 18 spots fixed.
- **Mixed line endings.** 6 files (the codex/cursor/hermes main skill + `graph-guide`) were CRLF while the whole rest of the repo is LF. Beyond inconsistency in trees copied verbatim into Linux/WSL runtimes, it made every drift check report whole-file differences on identical content — which is precisely what hid the missing-trust-guidance defect above. Added a minimal `.gitattributes` (`* text=auto eol=lf`).
- **A dropped blank line before a heading** in three copies of `cpp-inner-loop`.

Guards so this can't silently recur: **`tests/unit/integrations/skill-parity.test.js`** asserts the four trees ship the same skill set, that skill BODIES are byte-identical across runtimes (frontmatter may differ), no `''` corruption, LF endings, and non-empty `name`/`description` frontmatter. **`scripts/sync-skills.mjs`** makes that test actionable — it propagates the canonical claude-code bodies while preserving each runtime's frontmatter (`--check` for a CI-friendly report, idempotent).

### 2026-07-10 — Hermes MCP wiring corrected (wrong config file + the toolset filter)

Sand Castle reported their Hermes managed agents couldn't see graph verbs at all while their Claude agents could. Two real defects in our own install path:

- **`install.hermes.md` documented the wrong config entirely.** The JSON-patch fallback wrote `~/.config/hermes/hermes.json` → `mcpServers`. Hermes actually reads **`$HERMES_HOME/config.yaml`** (default `~/.hermes/config.yaml`) under a top-level **`mcp_servers`** key — YAML, not JSON. Anyone following the fallback produced a file Hermes never reads. Corrected in `install.hermes.md`, `README.md`, and the marketplace `runtime_configs` metadata.
- **Documented the `platform_toolsets` filter.** Hermes exposes each MCP server as a dynamic toolset `mcp-<server>`; if a profile enables an explicit allowlist, the server connects fine but its tools are filtered out of the session. This gotcha was already recorded in our own plan doc (P0-6, marked DONE) but had never actually shipped into the install steps.
- **Made that step conditional after a live counter-example.** the field fleet's config dump showed the server registered with **no** `platform_toolsets` section at all — so the allowlist wasn't the cause there, and blind-creating `cli: [hermes-cli, mcp-aify-project-graph]` would have RESTRICTED their session to those two toolsets and dropped whatever else loaded by default. Step 2b now appends only when an allowlist already exists, and explicitly says not to create one otherwise. (Root cause for that specific fleet is still open — likely the managed wrapper profile, not config.)

### 2026-07-10 — Sand Castle field report: staleness CTA, fixable pointer, path-arg parity

From a heavy 10-commit / 5-agent session where the index sat 166 commits behind and the load-bearing graph work fell back to grep:

- **Staleness warnings now carry the count AND the fix.** `commitsBehindHead` was already computed and then dropped on the floor — the warning only said "indexed abc123, HEAD def456". Every read verb now prints `graph snapshot is stale (N commits behind HEAD): … — run graph_index() (or set APG_AUTO_REINDEX=1 for auto-refresh on read)`, via the one `prefixReadWarnings` path every verb shares. Names the existing opt-in env var for discoverability without changing its default.
- **The unresolved-edge report's "fixable" count is now an action.** It reported e.g. "149 fixable of 4676" with no next step. It now explains that fixable means tree-sitter saw a plain call/reference it couldn't bind, and to run `graph_collect_code_intel` so the LSP resolves them — with residue named as genuinely cross-TU/dynamic. Suppressed when the count is zero.
- **Windows backslash paths work everywhere now.** `normalizePathArg` existed and was wired into `graph_callers`/`graph_file`/`graph_find`, but `graph_callees`, `graph_search`, and `graph_module_tree` took path/file filters without it — so on our own primary OS a `src\foo` filter silently matched nothing and returned an empty result. All three fixed.
- **Documented a high-velocity freshness recipe** in `known-limitations.md`: three tiers (auto-refresh env var / the supported `install-graph-hook.mjs` backgrounded post-commit reindex / manual), plus the reminder that a full rebuild drops `[lsp✓]` edges and needs a re-collect.

### 2026-06-19 — compile-DB probe: prefer native over foreign + pin env (Sand Castle follow-up)

Standing up the recommended `build-win-clangd` Windows DB didn't help — APG kept using the WSL `build/`. Root cause (the field fleet's diagnosis): the probe picked the candidate with the most first-party entries, so a foreign (Linux/WSL) DB with more entries beat the native one — and `build-win-clangd` wasn't even in the probe list. Three fixes:

- **`build-win-clangd` / `build-clangd` / `build-win` are now probed** (and listed first). The dir our own foreign-DB guidance tells users to create was never discovered — now it is.
- **On win32, a NATIVE (non-foreign) compile DB beats a foreign (Linux/WSL) one regardless of entry count.** Host clangd can only compile the native DB, so a foreign DB with more entries still truncates — preferring it was backwards. Now `build-win-clangd/` wins over a WSL `build/` without touching the latter. Verified on the real sand_castle (now selects `build-win-clangd`, 441 entries, foreign=false).
- **New `APG_COMPILE_DB` env pins a specific compile DB** (a `compile_commands.json` file or its dir), overriding the probe entirely — a deterministic escape hatch.

Note: the live clangd session binds to the chosen DB at start, so an APG server/session restart is still needed to re-bind after the DB changes (a warm session won't re-probe). Win32-gated prefer-native test + a cross-platform pin test.
### 2026-06-19 — Sand Castle live finding 1: foreign-DB caller truncation honesty

A live test (code_intel_references on a file-local C++ function) returned 2 of 5 in-file callsites on a Windows host whose compile DB was built under WSL — and crucially, our own `foreign_toolchain` diagnostic claimed *"References and call/type hierarchy stay usable"*, which the 2/5 (same-file!) result disproves.

- **Diagnostic honesty fix.** The `foreign_toolchain` message no longer claims references are safe on a foreign DB. It now states plainly that on a Windows host with a Linux/WSL compile DB, clangd can't compile the TUs → the index is silently PARTIAL → `code_intel_references`/`code_intel_hierarchy` caller sets are TRUNCATED (even same-file), so it is NOT a completeness oracle there; verify with rg, and fix with `APG_CLANGD_WSL=1` (clangd under WSL) or a native Windows compile DB.
- **Proactive `graph_health` warning.** `graph_health` now detects a foreign compile DB on win32 and surfaces it UP FRONT (`codeIntel.compileDbForeign`, `callerCompletenessTrustworthy:false`, + a loud summary verdict) — so an agent sees the truncation risk before a query returns a partial set, not only in the degraded result after. Verified on sand_castle (the real scenario).
- Confirmed the trust contract itself held perfectly in the report (it refused to claim completeness — `exhaustive:false` + the exact cause + the fix).
- **Windows-first realignment.** After Steven set a Windows-first policy (the WSL build that produced the foreign DB is being retired), the foreign-DB guidance now LEADS with the root-cause fix — generate a NATIVE Windows compile DB so host clangd matches it — with the exact recipe, since MSBuild's generator doesn't emit `compile_commands.json`: `cmake -B build-win-clangd -G Ninja -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` (APG auto-discovers it). `APG_CLANGD_WSL=1` is demoted to the fallback for anyone still on a Linux DB. Applied to the `foreign_toolchain` diagnostic, the `graph_health` verdict, the always-on server instructions, and the main skill. (`APG_CLANGD_WSL` auto-default-on is therefore NOT recommended — it would perpetuate the retiring WSL build.)
### 2026-06-19 — install script wires the discoverability hook by default

- **`init-project-mcp.mjs` now recommends + wires the SessionStart discoverability hook.** Following up the Sand Castle P0 #1 fix: the project-local installer (which already writes `.mcp.json` to close the managed-session MCP gap) now ALSO merges the SessionStart hint into that project's `.claude/settings.json` for claude-code — so managed/spawned agents are nudged to `ToolSearch "graph"` and orient with graph_packet/graph_pull without anyone hand-editing settings. Idempotent (won't duplicate), preserves existing hooks, claude-code only (Cursor has no equivalent surface), and opt-out via `--no-hint-hook`. install.claude.md promotes the hook from "Optional" to "Recommended" and documents the auto-wiring. New `mergeSessionStartHook` export + tests (wiring, idempotency, opt-out, cursor-skip).
### 2026-06-19 — Sand Castle report P1/P2: CMake build graph + impact reframe

- **CMake build graph (P1 #3).** A new framework plugin (`ingest/frameworks/cmake.js`) parses `CMakeLists.txt` / `*.cmake` and emits a build graph the structural extractor never had: `BuildTarget` nodes (`add_executable`/`add_library`, with kind + captured sources), `BuildTest` nodes (`add_test`), `LINKS` edges (`target_link_libraries` between known targets), and `RUNS` edges (`add_test … COMMAND <target>`). So "what links X / what test runs Y / what does target Z depend on" finally resolves on a C++ repo. Wired into the framework-plugin pass; `BuildTarget`/`BuildTest` joined `SPECIAL_TYPES` and the edges carry `source_file=''` so the per-file extraction loop (which processes the non-source CMakeLists.txt) can't reap them. Validated end-to-end on echoes (6 targets, 1 test, real link graph `EchoesOfTheFallen→TesseractEngine→{imgui_lib,lua_static}`). NOT gated on an EXTRACTOR_VERSION bump — existing graphs pick it up on their next full/forced reindex, so an actively-used graph isn't force-rebuilt out from under its trust spine.
- **Impact/consequences reframe (P2 #5).** The server instructions now pitch `graph_consequences`/`graph_impact` as high-value EVEN on familiar code ("blast radius across subsystems is the thing memory can't hold — reach for these before a rename/signature/behavior change"), plus a one-liner routing build-graph questions to the new BuildTarget/BuildTest nodes.
### 2026-06-19 — Sand Castle usage-report fixes (P0: discoverability + loud overlay failure)

From the Sand Castle team's first real-usage report on v0.2.0:

- **Fail LOUD on a degraded functionality.json (P0 #2).** A legacy/invalid overlay (top-level `paths`, underscore ids, or an unrecognized `version`) silently resolved to 0 anchors, so the feature map read empty and looked like the *graph* broke rather than the *overlay* being stale-format. The linter existed but only surfaced in `graph_health` (rarely opened mid-flow). Now: (a) `brief.agent.md` — the orient entry point — carries a loud `⚠ OVERLAY DEGRADED: N/M features resolve no anchors … migrate functionality.json` line, and (b) `loadFunctionality` warns on an unrecognized `schema_version` (known: 0.1, 0.2) instead of resolving against the wrong rules.
- **Discoverability nudge for managed sessions (P0 #1).** Managed Claude/Codex sessions defer MCP tools behind a search step, so an agent that doesn't already know APG exists never loads its verbs. The server `instructions` now carry an explicit `DISCOVERABILITY` line ("if you don't see graph_*/code_intel_* tools, run ToolSearch 'graph', then orient with graph_packet/graph_pull") — always-on, reaches every host. Plus a new optional `scripts/hooks/session-start-hint.mjs` SessionStart hook that fires the same hint at session start in any repo with a `.aify-graph/` directory (silent elsewhere; install instructions in install.claude.md).
- Confirmed (no code needed): `graph_pull` (threads the stale-snapshot warning block) and `graph_packet` (renders a `STALE` marker in its SNAPSHOT line) already signal staleness — closing the team's forward-looking #4 concern about the orient front-door.
## [0.2.0] — 2026-06-19

First tagged release — early but usable for daily work on real projects. Highlights since the 0.1.0 dev baseline: the multi-language LSP trust spine (clangd C++ / typescript-language-server / pyright → `[lsp✓]` LSP_VERIFIED edges), the rebuilt multi-layer dashboard (Map/Tree/Flow/Force/Shader, grouping, Tour, file-tree, git-diff overlay, trust lens), the 8-agent-audit correctness/honesty fixes, and the reference borrows. The dated entries below are the detail.

### 2026-06-19 — dashboard: trust lens + project-named title

- **Trust lens** (all / ✓ verified / ~ heuristic): a new control that isolates the clangd-verified call spine on the graph. "verified" renders only `LSP_VERIFIED` (`[lsp✓]`) call edges, "heuristic" only the unverified ones that still need checking; structural edges (CONTAINS/IMPORTS) always stay so the skeleton holds. The header shows the verified-% of call edges. Makes the project's trust differentiator visible — "which of these call relationships can I actually trust" — now that real LSP data exists. Browser-verified on sand_castle (32% verified; "verified" view is visibly sparser than "all").
- **Dashboard titles itself after the project** instead of the hardcoded tool name: `/api/stats` returns the repo directory name, and the `<title>`, header, and PNG-export filename use it. Matters once you point the dashboard at several repos (e.g. it now reads "sand_castle", not "aify-project-graph").
### 2026-06-19 — C++ trust-spine robustness: dedup huge collects + LSP survives tooling rebuilds

- **Duplicate collection records are now collapsed (fixes a crash + GB-scale bloat).** clangd re-reports each reference once per translation unit that includes the defining header, so a whole-repo `references` collect exploded — sand_castle produced **5.07M records**, which overflowed `JSON.stringify`'s max string length (the collect verb writes the envelope to a temp file → `RangeError: Invalid string length`) and would have bloated the DB to multiple GB. New `dedupCollectionRecords` (wired into `runCollection`, with a defensive pass in the importer) collapses byte-identical records by identity (kind + symbol + location); on sand_castle that's **5.07M → 1.04M (−80%)**, losslessly (every duplicate resolves to the same edge). `importV02Collection` is now exported for in-memory import without the temp-file round-trip.
- **LSP-verified edges now survive a tooling rebuild (A).** A full reindex does `DELETE FROM edges` and wipes the LSP_VERIFIED trust spine, but the clangd records persist in `code_intel_records`. When a rebuild is triggered by tooling (extractor-version bump, schema change, forced reindex) and **not** a code change, the orchestrator now re-synthesizes the identical edges from the persisted records via `resynthesizeLspEdgesFromCollection` — gated on the collection's `indexedCommit` equaling the current HEAD, so stale evidence is **never** re-stamped LSP_VERIFIED (commit-mismatch → no restore; the honest path is a fresh collect). End-to-end tests cover both the same-commit restore and the different-commit refusal.
- **Validated on sand_castle:** fresh reindex + complete clangd collect (511 TUs, indexReady) → **4,889 LSP-verified edges (32% of CALLS)**, `graph_callers` shows `[lsp✓]` verified caller sets; DB 853 MB after VACUUM. Suite 1219 green.
### 2026-06-18 — fix: code_intel_records grew unbounded across collection runs

- **`graph_collect_code_intel` no longer leaks the entire side-table on every run.** Each collect appended a full set of `code_intel_records` and prior collections were never pruned, so the table grew without bound — sand_castle hit **1.03M rows / 13 collections / 900 MB** for a 6.3k-node graph. Worse, `getCodeIntelEvidenceForSymbol`/`getCodeIntelDiagnosticsForFiles` query across ALL collections, so stale evidence/diagnostics from superseded runs resurfaced. A COMPLETE collect now prunes prior same-provider collections (partial collects don't; other backends untouched). Also hardened: records are stamped with the **envelope's** collectionId (authoritative) so the side-table can't drift from `code_intel_collections`.
- **New `scripts/compact-graph.mjs <repo>`** + exported `compactCodeIntelRecords(db)`: one-shot maintenance that keeps the latest collection per provider, prunes the rest, and VACUUMs to reclaim disk on graphs that bloated before the auto-prune. Pruning is answer-preserving (only the latest collection is ever read). Ran it on sand_castle: 900 MB → 661 MB, 13 collections → 1, integrity ok, graph (nodes/edges) untouched. Regression tests cover auto-prune (complete vs partial vs cross-provider) and the compaction helper. Suite 1215 green.
### 2026-06-18 — fix: overstated blast radius on qualified ambiguous symbols (C6)

- **`graph_impact` (and `graph_callers`/`graph_neighbors`/`graph_path`/`graph_consequences`/`graph_callees`/`graph_change_plan`) no longer silently union the blast radii of distinct same-named definitions.** Root cause: `buildAmbiguousMatchMessage` blanket-skipped any symbol containing `::`/`.`, assuming the qualifier disambiguated — but a class-qualified name can still resolve to multiple definitions (the same class name in two namespaces; qname-suffix matches), and the skip let those verbs treat ALL of them as the target and union their callers. The result overstated impact **and** fed an inflated set to the trust banner — directly contradicting the trust contract. Now the guard groups by canonical definition identity (overloads + the C++ decl/def split share a key → not flagged) and surfaces `AMBIGUOUS MATCH` whenever >1 distinct definition survives, qualified or not, with a qualifier-aware hint (narrow by namespace/file). A more-qualified retry (`alpha::ChunkManager::setVoxel`) still resolves cleanly. Regression tests cover the union-prevention, the sibling verbs, and the recovery path. Suite 1211 green.
### 2026-06-18 — file-tree explorer + git-diff overlay (dashboard borrows)

- **File-tree explorer panel** (understand-anything FileExplorer): a 📁 Files button opens a collapsible folder→file tree built client-side from the `file_path`s already on graph nodes (no new endpoint — the graph is the allowlist). Top level expanded, deeper folders collapse on click; clicking a file focuses its node, reusing `focusNode()` + the inline source viewer. Browser-verified on this repo (189 dirs / 778 files, toggle + click-to-focus, no console errors). Tour and Files panels are mutually exclusive.
- **Git-diff change overlay** (understand-anything change-overlay): a ◆ Changes button calls a new `/api/diff` endpoint (`git diff --name-only <base>` + untracked, filtered through the graph allowlist) and paints nodes in changed files as "changed", their 1-hop neighbors as "affected", fading the rest — a blast-radius seed from a real `git diff` instead of a hand-picked node. Reuses the existing blast paint classes; cytoscape-only so it's hidden in 3D, like blast radius. `/api/diff` tolerates non-git repos / missing git (empty + reason, no throw). Browser-verified on this repo's own uncommitted changes (3 indexed of 4 changed; the un-indexed file correctly filtered).
- **Betweenness-ranked community bridges** (graphify report.py): the `graph_digest` COMMUNITY BRIDGES block now ranks inter-cluster connections by edge-betweenness on the cluster meta-graph (Brandes) — true structural cut-points — instead of the naive "heaviest single edge per cluster", and excludes god-object hub edges first so a god-node touching everything doesn't make every cluster look coupled (`computeBridges`). Measured on this repo: a single-edge bridge (betweenness 44.7k) now correctly outranks a 3-edge coupling (10.9k) the old logic would have put first. Cheap — the meta-graph is just the cluster count.

### 2026-06-12 — dashboard UX/perf + launch surfacing + more borrows

- **3D performance:** the 3D default view rendered every node mesh; every 3D view now caps to the top ~3000 nodes by degree (3D has no light group-box view), plus cheaper geometry (nodeResolution 8→5, linkResolution 3) and adaptive physics ticks. Browser-verified on an 8.8k-node graph.
- **Heavy-view guard (2D + 3D):** per-node views cap node count with a "showing top N of M" note so a heavy pick can't freeze the controls.
- **Mode-aware controls:** Blast radius + Pathfinder (cytoscape-only) and the zoom buttons are hidden in 3D where they were no-ops.
- **`graph_dashboard` in the default tool surface:** "open the dashboard" is now one verb call instead of a hand-rolled launcher.
- **Borrows:** navigation-history "← back" breadcrumb + hover tooltip with in/out/total degree (understand-anything); GAPS (isolated-nodes) and SUGGESTED QUESTIONS blocks in `graph_digest` (graphify) — the QUESTIONS block pairs structure (hubs/bridges/cycles/gaps) with our trust data (heuristic vs LSP-verified edges).
- **2D Force-view crash fixed:** fcose runs synchronously; on a big raw node set the iteration count blocked the main thread long enough that the browser killed the tab. fcose quality + iterations now scale down as the set grows (draft/350 on big sets).
- **Docs:** archived stale Apr-era Horizon planning docs + banners on the superseded v2 status/backlog; documented that LSP-verified edges don't survive a re-index (re-run `graph_collect_code_intel`); install/launch-scope design notes.

### 2026-06-12 — reference-borrow round 2 (verbs + dashboard)

A second borrow sweep over codegraph / agent-understand-anything / agent-code-intel.

- **Windows backslash path args** (codegraph 0171785): `graph_file`/`graph_callers`/`graph_find` no longer return empty on `src\foo.cpp` (shared `normalizePathArg`).
- **Dynamic-dispatch boundary surfacing** (codegraph #687): when `graph_trace` finds no static path, it names the exact dispatch site (computed call / dynamic import / getattr / member-pointer / typed bus) over comment/string-blanked bodies, instead of guessing an edge.
- **Multi-language `code_intel_analyze`**: was C++-only; TS/JS/Python now route through the language server's own diagnostics (mode `lsp`, provenance `TS_LANGSERVER`/`PYRIGHT`).
- **TS/JS class arrow-fields** (codegraph 38eb4e6): `handleSubmit = () => {}` class fields extract as methods (classify by value; data fields stay out). `EXTRACTOR_VERSION → 0.2.3`.
- **Dashboard** (understand-anything LearnPanel/CodeViewer/ExportMenu): Guided Tour stepper (`/api/tour`, reuses the already-computed `graph_tour` steps), inline source viewer (`/api/source`, graph-as-allowlist security gate), and PNG export.
- **Mode-aware dashboard controls** (browser-verified): Blast radius + Pathfinder (cytoscape-only) and the discrete zoom buttons are hidden in 3D, where they were no-ops; everything that works in 3D (Focus, grouping, filters, Fit, Tour) stays.
- **Hardening** (latest ref pull): `uncaughtException`/`unhandledRejection` → clean exit with LSP teardown (codegraph #855); dashboard node labels/types/relations escaped before innerHTML (graphify #1357 — fixes `vector<int>`-style breakage + latent XSS).

### 2026-06-12 — reference pull + audit fixes (3 waves + real-repo measurement)

Pulled all 4 `reference/` repos and ran an 8-agent audit (`docs/reference-pull-and-audit-2026-06-12.md`), then fixed in waves.

- **Wave 1 (safety/honesty):** server shutdown path (tears down leaked clangd/tsserver/pyright children on host exit); LSP client robustness — Windows file-URI canonicalization (TS/pyright diagnostics on win32), JSON-RPC server-request id-collision guard + MethodNotFound, reject-pending + mark-dead on crash, dead-pipe `_send` guard; live-session start dedup + dead-session eviction; extractor/parser-version cache invalidation (shipped extractor fixes now reach unchanged files); unresolved-scoreboard honesty — a shared `denylisted-by-design` bucket (COMMON_NAMES + JS globals) excluded from `fixable` and trust-relevant counts.
- **Wave 2 (false-exhaustive trust holes):** file-aware TS coverage (nearest tsconfig + include/exclude scope, not mere presence); coverage guard fails **closed**; call-hierarchy truncation / overload sets downgrade to `truncated_to_caps` (not exhaustive); collection enumeration cap → `partial`; long-lived sessions re-sync edited files (`didChange`); `graph_callers` exhaustive banner requires an **all-verified** edge set; per-language `cause` (`partial_tsconfig_scope` / `python_dynamic_dispatch`, no "compile DB" for TS/Python); verified-edge banner attributed to its own backend (#11).
- **Wave 3 (resolution quality):** NodeNext `.js→.ts` import rewrite; arrow/function-expression const symbols + TS enum/abstract-class; import-evidence consulted before the repo-wide label guess; `new Foo()` instantiation edges; renamed default-export resolution. `EXTRACTOR_VERSION 0.1.0 → 0.2.2`.
- **Real-repo measurement (echoes_of_the_fallen):** redirected the work onto a 1069-edge bug — out-of-line C++ methods (`Class::method`) failed to link to their class. Skip body-less (forward-declaration) class specifiers; owner resolution prefers a type/namespace over a same-named constructor; classify C++ STL + path includes as external. Total unresolved 5927→4853 (−18%), `contains-missing-target` 1072→3.

### 2026-04-26 — upgrade plan v2 executed (M0.5 → M4b)

Co-designed and locked plan at `docs/superpowers/plans/2026-04-25-upgrade-plan.md`,
executed across 12 commits. Goal: flip Codex effective-token regression
into an improvement while preserving Claude Code wins. Theory: cut the
steady token tax (full SKILL.md + verbose live-verb output + repeated
overlay scans) that prompt-cache flattens on Codex but not on Claude.

**Headline measurement** (apg verified-fresh self-bench, 8-task fixture):

| | Pre-upgrade | Post-upgrade |
|---|---|---|
| Win count | 6-2 graph | 6-2 graph |
| Net tokens vs no-graph | −17.3% | **−23.1%** |
| Quality delta | −0.25 | −0.50 (caveat below) |
| Trust gate | ok | ok |
| Tests | 327 | **337** |

Quality delta widened because `graph_packet` is intentionally coarser
than `graph_change_plan`/`graph_consequences`. Skill text now explicitly
tells agents to escalate to depth-verbs when load-bearing — recoverable
through correct usage, not a defect.

**Added**

- **`graph_packet(target, budget=800, live=false)`** — new flagship
  one-shot agent prompt packet. Reads overlay+brief JSON directly
  (no SQL, no `ensureFresh`). Returns fixed-schema markdown:
  `TASK/FEATURE → STATUS → FEATURES → SNAPSHOT → READ FIRST →
  CONTRACTS → TESTS → RISKS → LIVE`. Section caps + token-estimate
  budget. Accepts `feature:<id>`, `task:<id>`, bare ids, or bare
  symbols (auto-resolves via `graph_consequences` with explicit
  `MATCHED VIA:` line). Optional `live=true` enrichment with strict
  2s budget; partial result still useful (`LIVE: timeout` /
  `LIVE: unavailable` markers explicit).
- **Compact Codex SKILL.md** — trimmed from 15330 chars (~3800
  tokens) to ~3100 chars (~780 tokens). Long-form material moved to
  `integrations/codex/skill/references/SKILL-full.md`. Verb order
  + tradeoff guidance + edge provenance + hard rules only.
- **Brief honesty signals**: `SNAPSHOT:` line in `brief.agent.md`
  shows `indexed=<sha> head=<sha>` + `STALE` marker on drift;
  `FEATURES (showing N/M)` indicator when truncated; `DIRTY:` line
  groups source/docs vs scratch/build counts.
- **`brief.plan.md` task counts** — open/in-progress + completed
  count per feature.
- **PATHS pollution filter** — vendor includes (`/vendor/`,
  `/third_party/`, `vk_mem_alloc`, `/glm/`, `/imgui`, etc.) and GLSL
  type-name "calls" (`vec[2-4]`, `mat[2-4]`, samplers) filtered from
  `brief.agent.md` PATHS section.
- **Feature `load:` metric** extended to count INVOKES +
  PASSES_THROUGH edges and file-anchored callers (incoming edges to
  `feature.anchors.files` globs from outside the feature) — fixes
  `load: 0 callers` on C++ class anchors.
- **`graph_consequences` test-adjacency fallback** to curated
  `feature.tests[]` when TESTS-edge / file-adjacency / IMPORTS-edge
  / mention-detection all return zero.
- **`featuresWithInferredTests` overlay-quality metric** — counts
  features that lack curated `tests[]` but have IMPORTS-edge
  evidence from test files.
- **`scripts/verb-latency-profile.mjs`** + artifact at
  `docs/dogfood/latency-profile-2026-04-25.json`.

**Changed**

- **Lean profile grew 3 → 5 visible verbs**: adds `graph_packet`
  (new) and `graph_health` (skill heavily recommends; was hidden).
  Other lean verbs unchanged.
- **Packet trust calculation reuses `computeTrustLevel`** from
  `health.js` so SNAPSHOT trust never disagrees with `graph_health`
  on the same snapshot.
- README + AGENTS bench paragraphs updated with the −23.1% headline.

**Final-bench bugs fixed in close-out**

1. Packet rejected bare symbol/file targets — now auto-resolves via
   `graph_consequences` → matched feature with `MATCHED VIA:` line.
2. Packet trust calc disagreed with `graph_health` (different
   threshold + raw vs trust-relevant count) — now both use
   `getUnresolvedCounts()` + `computeTrustLevel()`.
3. Empty packet sections silently omitted — now render `LABEL: none`
   so agents can distinguish broken-packet from no-data.
4. Packet `enrichLive` crashed on non-JSON `graph_consequences`
   output (NO MATCH plain text) — now degrades gracefully.
5. Symbol-fallback path didn't enrich LIVE because it called
   `graph_consequences` with the resolved feature id (not a symbol)
   — now passes the original symbol when present.

**Documented as known limitation** (not in scope for this round):

- Codex `exec` MCP cancellation — Codex-side behavior, not server.
  Brief-first workflow remains the safe path.



### 2026-04-25 — dogfood + 7 fixes + clean re-bench

Round driven by hands-on dogfood evaluation of the toolset on apg's
own graph. Five user-visible findings → seven fixes (one root cause
revealed two more layers underneath). Final clean bench shows graph
moving from net token overhead to net savings.

**Fixed**

- **Ignore-path basename bug** (`27f4d86`). `pathContainsIgnoredDir()`
  was applying build-dir prefix heuristics (`target_`, `build_`) to
  the FINAL FILENAME segment, dropping legitimate source files like
  `mcp/stdio/query/verbs/target_rollup.js` from indexing. Single
  cause behind 4-of-5 phantom verb-layer failures we initially
  reported as separate bugs. Built-in ignored-dir rules now apply to
  directory segments only; `.aifyignore` glob still matches full
  paths.

- **Planner caller-scope** (`1c32046`). `graph_change_plan` produced
  false `RISK SAFE` on cross-cutting symbols whose cross-file
  imports hadn't fully resolved into call edges. Reproduced cleanly:
  `change_plan("ensureFresh")` returned `0 callers / RISK SAFE`
  despite 31 grep occurrences. Fix: source-occurrence fallback over
  indexed-or-tracked repo files. Now correctly upgrades to `RISK
  CONFIRM`.

- **graph_consequences test-adjacency** (`d918cbc`). Symbols with
  IMPORTS-edge-only test coverage were flagged `no_test_coverage`.
  Root cause traced through three layers: heuristic gap in
  consequences (fixed `430b9bb`) → IMPORTS edge resolver gap (didn't
  help on real repo) → JS/TS extractor flattening relative paths
  instead of resolving against importer directory. Final fix in
  ingest now uses `path.posix` resolution against `filePath`. Real
  repo test files (146 IMPORTS edges from `tests/unit/*`) now emit
  cross-file IMPORTS edges to their imported symbols.

- **graph_report `top_k` not wired** (`1c32046`). Verb output was
  constant ~3kb regardless of `top_k`. Now clamps dirs/hubs/entries/
  docs/community lines: `top_k=5` → 1685 B, default → 5042 B.

- **Broad-query bloat** (`1c32046`). `graph_module_tree(.)` returned
  7043 B; `graph_find(query="graph")` returned 7776 B. Both now
  emit truncation guidance instead of dumping full match sets.
  Module tree dropped to 655 B (-91%); find dropped to 3792 B
  (-51%).

- **SIGNALS honesty caveat** (`430b9bb`). `graph_change_plan` SIGNALS
  line under weak trust now annotates: `(raw indexed edges; weak
  trust may understate caller scope — see source-occurrence count)`
  whenever caller-count is suspiciously low for source-occurrence
  spread.

**Added**

- **Eval artifacts** (`91fc54c`, `c71b9fc`). Three subagent layers
  shipped:
  - `tests/unit/eval/regression-invariants.test.js` — 12 invariants
    locking the 5 findings as semantic regression tests.
  - `scripts/verb-correctness-probe.mjs` — exercises 21 verbs × 3
    inputs each (63 invariant checks, all pass), writes JSON
    snapshot for size-regression tracking.
  - 8-task token-cost benchmark with-graph vs no-graph (graph,
    no_graph, mixed arms across ORIENT / TRACE / CALLERS / IMPACT /
    PLAN / CROSS_LAYER / HEALTH / DEBUG categories).
  - Iterative measurements: `*-postfix.json`, `*-postfix2.json`,
    `*-postfix3.json`, `*-postfix4.json` (final clean-state).

- **graph_impact self-introspection limitation** documented in
  `docs/known-limitations.md` (`9878304`). The verb cannot query its
  own handler symbol because the MCP tool dispatcher reaches it from
  outside the indexed call graph. Accounts for the residual −0.25
  quality delta in postfix4. Architectural; not a fix-blocker.

**Measured (postfix4, verified-fresh state)**

8-task token-cost benchmark on apg's own graph, dogfood-only scope.
Final clean numbers vs pre-fix baseline:

| Metric | Pre-fix | Post-fix |
|---|---|---|
| Win count | 4-4 tie | **6-2 graph** |
| Net token delta vs no-graph | +12.6% (overhead) | **−17.3% (savings)** |
| Quality delta | −0.625 | **−0.25** |
| Trust gate (apg dogfood case) | weak | **ok** |
| Tests | 305 | **327** (326 pass + 1 documented skip) |
| Unresolved edges | 9401 (peak) / 4537 (pre-fix) | **2473** (~2.9× improvement) |
| IMPACT task quality | 3/5 | 5/5 |
| PLAN task quality | 2/5 | 5/5 |

Cross-runtime + scale validation pending separately (Echoes C++
cross-repo + 30k-node scale probe).

**Process learning**

Stale-snapshot reads fooled the postfix3 bench. The bench script
opened a DB connection that hadn't picked up the rebuild. Added
explicit pre-bench verification gates (force rebuild → IMPORTS-count
sanity check → tests_adjacent assertion BEFORE running tasks) that
caught the issue cleanly in postfix4. Recommend the same gates on
any future bench rerun.

### 2026-04-22 — Leiden + class-qualified lookup + 6 new framework plugins

**Added**

- **Leiden community detection** (`ngraph.leiden`, MIT) replaces Louvain,
  matching graphify's design inspiration. Seeded mulberry32 PRNG (seed=42)
  keeps community_ids stable across identical reindexes — an improvement
  over the previous Louvain setup, which was not explicitly seeded.
  Honest bench (`docs/dogfood/communities-bench-2026-04-22.json`) on
  apg's own graph: Louvain 0.72 modularity / 89 communities vs Leiden
  default 0.52 / 310 communities. Raw modularity favors Louvain on
  small graphs; Leiden wins on guaranteed-connected communities and
  graphify parity. Net neutral-to-slightly-negative on modularity,
  structural-guarantee + determinism positive, so we ship Leiden.
  `scripts/communities-bench.mjs` kept for future re-measurement.

- **Class-qualified symbol lookup** (shared `resolveSymbol` helper)
  fixes NO-MATCH on `Class::method`, `A::B::method`, `Module.Class.method`
  that failed the echoes CC lean-half 2×2. Disambiguates by
  `extra.qname` when multiple bare matches exist. Wired into
  `graph_change_plan`, `graph_impact`, `graph_path`,
  `expandClassRollupTargets`. Tests: `class-qualified-lookup.test.js`.

- **6 framework plugins added** (previously only Laravel):
  - `python_web` — FastAPI + Flask, including FastAPI `Depends(fn)` as
    PASSES_THROUGH so DI chains are traceable.
  - `node_web` — Express / Koa / Fastify / Hono, with middleware
    chains emitted as PASSES_THROUGH between handler args.
  - `nestjs` — `@Controller` class prefix + `@Get/@Post/@UseGuards`
    decorator stacks.
  - `rails` — `config/routes.rb` with full `resources :x` expansion,
    `only:`/`except:` filters, `namespace`/`scope` nesting.
  - `spring` — `@RestController` + `@RequestMapping` + `@GetMapping`
    etc. on Java and Kotlin sources.
  - `cpp_frameworks` — Qt4/5 signal/slot connects + `emit sig()` +
    Google Test (TEST/TEST_F/TEST_P) + Catch2 (TEST_CASE/SCENARIO).
  Each plugin auto-detects via the repo's dependency manifest; no-op
  on repos that don't use the framework. Tests: `frameworks.test.js`
  (8) and `cpp-frameworks.test.js` (6).

**Deps**

- Added: `ngraph.graph`, `ngraph.leiden`.
- Removed: `graphology`, `graphology-communities-louvain`.

### 2026-04-21 — provenance consumption + P0 state-loss fix

**Added**

- **Per-edge `provenance` surfaced across read verbs.** Schema v4 producer
  side tagged edges EXTRACTED (AST), INFERRED (heuristic/framework), or
  AMBIGUOUS (external fallback) in `92af81a`. Consumer side completed
  this round: `graph_impact`, `graph_callers`, `graph_callees`,
  `graph_neighbors`, `graph_pull` (relations layer), and `graph_path`
  now carry the field. Rendered edge lines show `prov=INFERRED|AMBIGUOUS`;
  EXTRACTED stays silent to keep output terse.
- New regression tests: `tests/unit/query/provenance-surface.test.js`
  (4) and `provenance-surface-pull-path.test.js` (2).

**Fixed**

- **P0: 500-cap `manifest.dirtyEdges` state loss across incremental runs.**
  Diagnosed 2026-04-21 via `scripts/diagnose-convergence.mjs` — not a
  convergence algorithm drift, a state truncation. Each run dropped any
  unresolved edges past row 500 when carrying them forward. Fix shape
  (dev-approved): new `.aify-graph/dirty-edges.full.json` sidecar holds
  the authoritative complete list; the 500-row `manifest.dirtyEdges`
  stays as a breakdown-query sample for `graph_status`/`graph_health`.
  Orchestrator reads sidecar first, falls back to manifest sample for
  older graphs. Unblocks the git post-commit hook (task #100) — force
  rebuilds are no longer the only path to convergence.
  Tests: 4 new sidecar unit tests. Full suite 230 green.

**Added**

- **Git `post-commit` hook** (`scripts/install-hooks.mjs` + `scripts/hooks/post-commit`
  + `scripts/graph-reindex-hook.mjs`). Installs a background-executing
  hook so commits keep the graph and briefs synced with HEAD without
  blocking. Refuses to overwrite foreign hooks without `--force`;
  `--remove` cleanly uninstalls ours. 6 new integration tests.
- `graph_status.unresolvedBy` now exposes both `total` (authoritative,
  from `dirtyEdgeCount`) and `sample_size` (rows in the 500-row
  breakdown slice). Percentages derived from byRelation/byLanguage sum
  to `sample_size`; `total` tells you the true scale even when sampled.

**Fixed**

- `tests/integration/mcp-resources.test.js` Windows EBUSY flake:
  teardown now waits for child exit and retries rmdir, so repeated
  runs don't fail with transient file-lock errors.



## 2026-04-22 (post-bench) — post-mortem fixes

Echoes manager's 39-agent post-mortem surfaced several items I missed on
first read. Shipping the gap closures here:

### Added

- **`graph_health.briefStaleVsManifest`** — boolean + summary-string signal
  when `brief.json.graph_indexed_at` diverges from `manifest.indexedAt`.
  Fixes the "brief says weak, health says strong" same-moment disagreement
  that the 39-agent bench flagged (different inputs, same thresholds —
  not a threshold bug, a cache-vs-live drift). Verdicts now include
  `brief-stale: regenerate with graph-brief.mjs` when detected.
- `docs/known-limitations.md` entry on the brief-vs-live drift with the
  new workaround.

### Fixed

- Clean-clone regression from `1fa037a`: 12 untracked fixture files under
  `tests/fixtures/ingest/tiny-laravel-middleware{,-conflict}/` now tracked
  in git. Previously 7 tests passed on dirty checkouts + failed on clean.
- AGENTS.md + README.md stale claim that "Codex/OpenCode don't load skill
  files" — Codex has shipped skills since commit `7a09dcb`. Corrected to
  "Claude Code + Codex both load skills; OpenCode skips."
- AGENTS.md verb count `19 → 21` (graph_consequences + graph_health added
  earlier this session).

### Still open from manager's post-mortem (NOT fixed this round)

- **Incremental-indexing convergence regression** (manager's P0). Same
  commit produces different `dirtyEdgeCount` on incremental vs force-rebuild
  (500 vs 5424 on echoes). Documented in known-limitations; fix pending
  root-cause investigation.
- **15 never-invoked verbs** across 39 agents — manager's cognitive-surface
  argument for deprecation. Separate design pass.
- **Cross-repo bench** to validate mixed-mode findings outside Echoes.
  Manager's methodology caveat; needs their cycles, not a code fix.

## 2026-04-22 (late) — graph_consequences correctness + Claude-Code-scoped bench

Echoes manager ran three deep-test rounds + one 2×2 (totaling 39 agents) this
day. Two correctness bugs in `graph_consequences` shipped as fixes; the
behavioral bench findings are Claude-Code-scoped (Codex re-bench pending).

### Added

- **`graph_consequences` — task→file reverse lookup.** New third anchor_match
  path: `anchor_match: 'task'`. Features now get surfaced via tasks that
  reference the target file (`task.files_hint[]` exact/suffix match — high
  confidence; `task.title` substring match on basename ≥8 chars or CamelCase
  — low confidence). Each task hit carries `{id, match}` so consumers can
  filter by confidence tier. Previously: feature was only reached via direct
  anchor; tasks that mapped a file to a feature via task.features[] were
  invisible.
- **`graph_consequences.co_consumer_files[]`.** When the target file's
  features anchor other files too, they're surfaced as peers with
  `{file, via_feature}`. Echoes manager's bench flagged
  `graph_consequences("sharc_update.comp.glsl")` missing `sharc_resolve.comp.glsl`
  — this surfaces the peer set explicitly for refactor planning.

### Fixed

- Race between `graph_consequences` and task-based feature links was
  undefined for files not anchored in `functionality.json`. Affected files
  returned empty `features_touching` / `contracts_potentially_affected` /
  `open_tasks_on_those_features`. Now resolves through the task layer.

### Benchmark scope (important caveat)

Two behavioral findings this round are **Claude Code–scoped**, not universal:
- "Full manifest is cheaper than lean" — measured only on Claude Code + Opus
- "Full SKILL.md prose drives 3.3× more graph use" — same scope

The lean profile remains as-is for Codex/OpenCode until we have a Codex-side
2×2 re-run. Do not act on these findings for other runtimes without
confirmation.

## 2026-04-22 — graph-as-map evolution

The graph moved from "searchable database" to **map-for-agents**. Three
new verbs, one stronger discipline (mixed-mode), and the first round of
correctness fixes the static-brief + live-verb surfaces were silently
contradicting each other on.

### Added

- **`graph_consequences(target)`** — flagship traversal verb answering
  *"what breaks if I touch X?"* across code + feature + contract + task
  + test + git-history layers in one call. Accepts a symbol name, a
  repo-relative file path, OR a tracker task id. Output carries
  `contracts_potentially_affected`, `features_touching`,
  `open_tasks_on_those_features` + `top_related_tasks[3]`,
  `tests_adjacent`, `last_touched` (with `days_ago`), `spec_docs`,
  `risk_flags` (keyed: `orphan_anchor`, `no_test_coverage`,
  `cross_feature_boundary`, `task_overhang`, `high_fan_in`,
  `contract_binding`).
- **`graph_health()`** — single-call synthesis of "is the graph usable
  right now?" Returns one-line summary + structured fields (trust
  level, unresolved-edge count, staleness vs HEAD, overlay validity).
  Replaces the 3-call `graph_status` + `graph_index` + brief TRUST
  parse workflow that was disagreeing with itself.
- **Feature coverage gradient** in `brief.json.features[].valid[].coverage`
  — composite health tier (🟢 healthy / 🟡 watch / 🔴 risk) synthesized
  from anchor_health × task_count × contract_count.
- **Per-feature tasks in brief.json** — `task_count` + up to 10
  `tasks[]` per feature so programmatic consumers (`/graph-walk-bugs`,
  future graph-lint) don't have to re-parse `tasks.json`.
- **`graph_indexed_at` + `graph_commit` at brief.json top level** —
  reads from `manifest.indexedAt` so agents can detect "brief is fresh
  but graph is N commits behind" without forcing cache churn.
- **Overlay JSON schemas** — `docs/schemas/functionality.schema.json`
  and `docs/schemas/tasks.schema.json` (draft-07). Loader stays
  permissively-normalized; schemas are for external validators.
- **Native-module preflight self-heal** (`mcp/stdio/preflight-native.js`).
  Platform-mismatched `better-sqlite3` binaries (Windows / WSL flip)
  auto-rebuild on server startup.
- **Multi-agent team docs** in AGENTS.md (concurrent reads safe,
  writes serialized two-tier, 3-minute cross-process lock retry).
- **`graph-build-all` auto-offers `/graph-build-tasks`** when a tracker
  MCP is detected.
- **Laravel middleware extraction** — `$middleware` + `$middlewareGroups`
  from Kernel.php, emits `PASSES_THROUGH` edges through the route →
  middleware → controller chain so `graph_path` + `graph_consequences`
  trace request flow end-to-end.
- **`PASSES_THROUGH` relation** supported across every traversal verb
  (`graph_callees`, `graph_callers`, `graph_file`, `graph_neighbors`,
  `graph_path`).

### Changed

- **Brief TRUST count reads `manifest.dirtyEdgeCount`** instead of
  `edges WHERE confidence < 1.0` (different thing — heuristic edges).
  Brief now agrees with `graph_status` and `graph_health` on the same
  state; `computeTrustLevel()` is the shared helper so they cannot drift.
- **`graph_find` tokenizes compound queries** server-side. Previously
  `"pressure vacuum gas"` returned empty because the full string was
  one literal match; now it's split on whitespace, each term run, and
  results unioned. Full phrase still preferred when it matches.
- **IMPORTS extractor** (JavaScript + TypeScript) — named imports now
  emit both the source AND source.member as targets. Previously only
  compound targets were emitted and none resolved, so 99% of JS files
  produced zero IMPORTS edges.
- **Resolver — file-path suffix match for IMPORTS** — C++
  `#include "core/Engine.h"` now resolves to the File node with
  `file_path` ending `/core/Engine.h`. Biggest lever for C++ repos
  (63% of unresolved refs on the echoes repo were this shape).
- **Resolver — local-scope REFERENCES silently dropped** when the
  bare lowercase target doesn't match any node label. Previously
  inflated unresolved count by 85% on PHP repos; now unresolved is
  honest.
- **Dashboard large-graph guard** — graphs >3000 nodes switch to
  instant `grid` layout with a banner, instead of pegging the browser
  main thread with `cose`.
- **Dashboard CDN removed** — Cytoscape + 3d-force-graph now served
  from `node_modules` via `/vendor/*` routes; no more Edge cold-load
  hangs on unpkg.
- **Codex skills: `trigger:` frontmatter removed** from all 11 files.
  It's not a documented OpenAI Codex skill field; was dead metadata.
- **In-process write-lock queue** (`mcp/stdio/freshness/lock.js`) +
  cross-process retry budget bumped from ~9s to ~3min. Fixes
  "Lock file is already being held" on concurrent verb calls.
- **Skill prompts**: codified **MIXED-mode** as the winning pattern
  (graph for orientation, Read/Grep for details, skip graph entirely
  for line-level audits). Added hard rules for mining overlay links
  (contracts, tasks, depends_on) before planning, reaching for
  `graph_impact` on cross-cutting tasks, and verifying line-number
  citations in-session before using them.

### Fixed

- `graph_status.unresolvedEdges` now reports `manifest.dirtyEdgeCount`
  (true count) rather than the 500-capped sample array length.
- `graph_status` nodes/edges counts read live from SQLite so they
  agree with `graph_report`.
- `graph_consequences` on class names de-duplicates forward
  declarations — definition files are primary, forward decls surface
  under `matched.referenced_in[]`.
- Overlay loader preserves `contracts[]` (was silently dropped in
  `normalizeFeature`).
- `.codex_tmp/` and `worktrees/` now in `IGNORED_DIRS` — sandbox
  scratch no longer pollutes the graph.
- Verb response envelope surfaces a `_warnings: [...]` entry when the
  graph is stale (indexed commit != HEAD).
- `graph_index` response now carries `unresolvedAnchors: {checkedFeatures, brokenFeatures, sample}`
  so the validation pass is visible on success too.
- `graph-brief.mjs` prints a loud ⚠ block for broken anchors and a ✓
  line for clean overlays.

### Known limitations (documented; not regressions)

See `docs/known-limitations.md`:
- `graph_callers` is function-granular. For per-line callsite audits
  Grep wins by schema.
- Incremental indexing does not fully converge to `graph_index(force=true)`
  on unresolved-edge count. Force-rebuild is recommended after large
  refactors.
- Multi-repo live verbs require one MCP registration per repo
  (the server is cwd-bound at launch). Static briefs work cross-repo.
- Non-interactive `codex exec` may cancel live MCP calls. Use
  interactive Codex or rely on static briefs there.

### Tests

212 unit + integration tests green, stable across multiple runs.
