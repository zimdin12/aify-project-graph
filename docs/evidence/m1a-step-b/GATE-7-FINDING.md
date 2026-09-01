# M1a step B — gates 7 and 1: what step B did NOT move

Preregistration: `docs/evidence/m1a-step-b/PREREGISTRATION.md`
Carrier: `scripts/step-b-identity-differential.mjs`
Tests: `tests/unit/ingest/site-identity-unmoved-by-scope.test.js`,
`tests/unit/ingest/written-qualifier-carrier.test.js`
Suite receipt: `docs/evidence/m1a-step-b/receipts/suite-95464c9.txt` (`VITEST_EXIT=0`, 419 files,
3522 passed + 4 skipped, 952s)

Gates 7 and 1 are the two "nothing else moved" predicates. Both are **differentials between two
checkouts**, not assertions the code under test makes about itself.

| | pre-B | post-B |
|---|---|---|
| commit | `8c1bdc35155521934df2da5a53e02cb255ade374` | this branch |
| checkout | detached worktree at `../apg-preb` | this working tree |

The checkout supplies only the **code**. The fixture, the tracked-file list, the source bytes and
the population definition all come from this working tree, so the two runs differ in exactly one
variable.

## Gate 7 — symbol site identity is unmoved

Site identity is a byte-span address, deliberately blind to what a symbol is called. Had scope
leaked into it, every C++ symbol inside a namespace would have been re-keyed on this commit,
silently orphaning containment edges, ledger rows and every stored reference to them.

**Result: 18 sites, zero differences.**

The 18 ids are pinned in the test as a **measurement taken from the pre-B worktree**. Pinning ids
produced by the code under test would have proven only that it agrees with itself. The test carries
a second, independent substrate: each id is recomputed from `site_start_byte`/`site_end_byte` via
`codeSymbolSiteId` and compared to what the extractor emitted. The pin says *unchanged since
pre-B*; the recomputation says *derived from nothing but the span*, and survives someone re-pinning
the literals to match contaminated output.

**Controls.** Positive: the fixture still yields 18 symbols with 40-hex ids and integer spans — an
emptied fixture would otherwise compare equal to an empty pin. Relevance: the fixture is asserted
to contain scoped symbols (`alpha`, `beta`), without which scope could not leak because there is
none. Mutants, both killed: site id contaminated with `lexicalScope` unconditionally, and — the
discriminating one — only when scope is non-empty.

## Gate 1 — the opted-out population is unmoved

**Result: 778 candidates, all disposition `ok`, 4,397 nodes, 65,999 refs, 71,174 rows, zero
differences.**

Compared per node: `id`, `type`, `label`, `qname`, `parent_class`, `lexical_scope`,
`written_qualifier`. Per ref: `relation`, `from_id`, `target`. Per file: `language` and a typed
disposition. This is membership, count and field content — not examples.

**Negative controls, per surface** (rows that differ when that surface is mutated): node type
5,384 · refs 131,998 · file disposition 1,556 · `lexical_scope` 8,794 · `written_qualifier` 8,794 ·
per-file language classification 1,494.

**Positive control.** Both carrier keys are present on all 4,397 node rows, and non-null on zero of
them. Zero is the asserted state here, not a gap — which is why the negative control above matters
more than occupancy: it shows the column *would* register a change.

## The written-qualifier carrier, and one thing it cannot yet prove

`namespace alpha { void Widget::render(){} }` and `void alpha::Widget::render(){}` converge on
`alpha.Widget.render`. Before this commit the only separator was that `lexical_scope` was *absent*
on the second — a distinction inferred by the reader, which any other cause of an absent lexical
scope would have defeated. Both sources are now recorded and differ in content:

| form | `lexical_scope` | `written_qualifier` |
|---|---|---|
| `namespace alpha { void Widget::render(){} }` | `[alpha]` | `[Widget]` |
| `void alpha::Widget::render(){}` | absent | `[alpha, Widget]` |

**Claim ceiling: AST-derived canonical segments, not verbatim spelling.**
`extractQualifiedScopeSegments` recurses through `template_type` into its `name` field, so
`Widget<T>::render` records `Widget`. Asserted in the test so it cannot drift into a
byte-preservation claim.

### ⛔ The fallback authority is unreachable, so one required control cannot be paid

`cpp.js` has a second producer — a regex over declarator text — stamped
`cpp_declarator_regex_fallback` rather than the AST authority, because segments split out of text
are not segments walked out of a tree.

**No input reaches it.** 28 shapes were probed: plain, templated, destructor, operator, conversion
operator, ctor-with-init-list, const/ref-qualified, trailing return, function-pointer and array
returns, nested classes, anonymous namespaces, macro-prefixed declarators, and several deliberately
malformed. Every qualified shape took the AST branch; every macro-mangled shape produced no
qualified symbol at all.

The consequence is stated rather than papered over: the review asked for a mutant that stamps the
fallback with the AST authority and fails. **That mutant was run and SURVIVED** — predicted inert
before the run, and inert. A branch no input reaches cannot be tested by mutating it. The carrier
is kept (omitting it would collapse "a text-derived qualifier was observed" into "no written
qualifier evidence exists") with a tripwire test whose ceiling is *"no input among the probed
shapes reaches it"*, not *"unreachable"*.

**Mutants killed:** flattening the two carriers into one array (2 tests) · authority stored once
per field instead of per segment (5) · empty array instead of absent (2) · verbatim spelling
instead of canonical segments (2).

## ⚠ Three ways the instrument passed while proving nothing

Recorded because each produced a confident green result, and two were caught only by a control.

1. **A column that compared nothing.** The first carrier emitted `ref.from_target`, which does not
   exist on a ref: 0 of 65,813 rows non-empty. Five ref fields claimed, three real. Caught by
   per-column occupancy before the number reached a finding.
2. **"Identical" from two crashed runs.** `getLanguageConfig` *throws* for an unsupported path
   rather than returning falsy. The population filter tested `Boolean(config)`, both sides died on
   the first JSON file, and `diff` compared two empty outputs and reported success. Fixed with
   `configFor` plus `refuseEmpty`, which exits 3 rather than emit a population that cannot certify
   anything — verified firing (exit 3, zero bytes).
3. **A hand-maintained denylist that was also wrong.** Selecting non-C++ by file extension missed
   four files: the derived population — "language config does not declare `lexicalScope`", i.e.
   exactly "did not opt in" — is 778 against the list's 774.

A fourth is process, not instrument: the carrier was mutated while **uncommitted** to control the
emptiness guard, and `git checkout --` restored it to the previous committed version, discarding
the rewrite. The measurements survived; the file did not, and had to be reconstructed and re-run
before anything here could be cited. The rule it broke is the project's own COMMIT BEFORE MUTATING.

## Claim ceiling

Site identity and the opted-out population are unmoved **by step B, on this fixture and this
repository's tracked files, between these two commits**. Not a claim that either is *correct* —
only that step B did not change them. Gate 7's fixture is 18 symbols in 3 files.

Neither `lexical_scope` nor `written_qualifier` has a production consumer today. Step C is the
intended one. Until it lands they are recorded and unread — a real cost, stated rather than hidden.
The carrier is itself a tracked file and therefore inside its own population, so the canonical
digest moves whenever the carrier does; the comparison is unaffected because both sides read the
same working-tree bytes.
