# M1a step B — gates 7 and 1: what step B did NOT move

Preregistration: `docs/evidence/m1a-step-b/PREREGISTRATION.md`
Carrier: `scripts/step-b-identity-differential.mjs` (modes `sites`, `canonical`, `cpp`)
Tests: `tests/unit/ingest/site-identity-unmoved-by-scope.test.js`,
`tests/unit/ingest/written-qualifier-carrier.test.js`
Suite receipts: `receipts/suite-95464c9.txt`, `receipts/suite-be9b0aa.txt`
(latter: `VITEST_EXIT=0`, 420 files, 3530 passed + 4 skipped, 716s)

Gates 7 and 1 are the two "nothing else moved" predicates. Both are **differentials between two
checkouts**, not assertions the code under test makes about itself. The checkout supplies only the
**code**; fixture, tracked-file list, source bytes and the population definition all come from this
working tree, so the two runs differ in exactly one variable.

| | pre-B | pre-deletion |
|---|---|---|
| commit | `8c1bdc35155521934df2da5a53e02cb255ade374` | `be9b0aa` |
| worktree | `../apg-preb` | `../apg-predel` |

## Gate 7 — symbol site identity is unmoved

Site identity is a byte-span address, deliberately blind to what a symbol is called. Had scope
leaked into it, every C++ symbol inside a namespace would have been re-keyed, silently orphaning
containment edges, ledger rows and every stored reference to them.

**Result: 18 sites, zero differences.** The pinned ids are a measurement taken *from the pre-B
worktree* — pinning ids produced by the code under test would prove only self-agreement. A second
substrate recomputes each id from `site_start_byte`/`site_end_byte`, which survives someone
re-pinning the literals to match contaminated output.

**Controls.** Positive: 18 symbols, 40-hex ids, integer spans. Relevance: the fixture is asserted to
contain scoped symbols. Mutants killed: scope contamination unconditional, and — the discriminating
one — only when scope is non-empty.

## Gate 1 — the opted-out population is unmoved

**Result: 778 candidates, all `ok`, 4,400 nodes, 66,060 refs, 71,238 rows, zero differences.**

Population **derived**, not listed: a file is in scope iff its language config does not declare
`lexicalScope` — exactly "did not opt in". The derived set is larger than the extension denylist it
replaced (778 vs 774), so that list was wrong as well as unmaintainable.

Compared per node: `id`, `type`, `label`, `qname`, `parent_class`, `lexical_scope`,
`written_qualifier`. Per ref: `relation`, `from_id`, `target`. Per file: `language` and a typed
disposition.

⚠ **What gate 1 can and cannot say about the carriers.** Both carriers are `null` on all 4,400
non-C++ node rows — that *is* the asserted state, so gate 1 establishes **absence parity**. It
cannot establish content parity there, because there is no content. Carrier **content** binding is
proven on the `cpp` differential below, where the carriers actually have values.

## The deleted qualified regex fallback

`extractCppFunctionSymbol` had a second producer of qualifier segments: a regex splitting
declarator text on `::`. **Deleted**, not kept behind a tripwire.

No input reached it across 28 probed shapes — plain, templated, destructor, operator, conversion
operator, ctor-with-init-list, const/ref-qualified, trailing return, function-pointer and array
returns, nested classes, anonymous namespaces, macro-prefixed, several malformed. A producer no
input reaches cannot be killed by mutating it: the mutant stamping its segments with the AST
authority was pre-registered as expected-inert, run, and **survived**.

It now **fails closed** — declarator text that still looks qualified yields no symbol rather than
falling through to the unqualified matcher, where `Widget::render` would have become a free function
named `render`, inventing a symbol and hiding the extraction gap.

**Evidence the deletion is inert:** whole-corpus C++ differential `be9b0aa` → post-deletion, 16
files, 75 nodes, 29 refs, **byte identical**. And the mutant that *re-enables* regex qualification
leaves that differential identical too — pre-registered as expected-survive, and it survived, which
is the evidence rather than a failure.

⚠ **Ceiling.** The C++ corpus is 16 fixture files. And the refusal sits on the same unreachable path
as the branch it replaces, so no extraction-level test can exercise it and a mutant deleting the
refusal would survive. The predicate is exported and asserted directly, labelled as the weaker
evidence it is.

## Mutants

| Mutant | Verdict |
|---|---|
| site id contaminated with scope (unconditional / scope-only) | killed, killed |
| carriers flattened into one array | killed (2 tests) |
| authority stored once per field, not per segment | killed (5 tests) |
| `written_qualifier` empty array instead of absent | killed |
| verbatim spelling instead of canonical segments | killed |
| segment value changed, authority fixed | killed (`cpp` differs) |
| authority value changed, segment fixed | killed (`cpp` differs) |
| lexical scope order reversed | killed (`cpp` differs) — *see below* |
| absent becomes empty array | killed (`cpp` differs) |
| regex qualification re-enabled | **survived, as pre-registered** |

### A mutant that survived for a population reason, not a correctness one

"Lexical scope order reversed" first **survived**. The cause was not the serializer: the entire C++
fixture corpus had **zero** carriers with more than one segment — 14 nodes with a `lexical_scope`, 5
with a `written_qualifier`, none multi-segment — so reversing the order was a no-op on every row.
Order is load-bearing (`outer::inner::Widget` and `inner::outer::Widget` are different symbols), so
`tests/fixtures/identity-nested/` was added: 4 two-segment lexical scopes and a three-segment
written qualifier. The mutant then **killed**. The flip is the evidence that the gap was the corpus.

## ⚠ Four ways the instrument passed while proving nothing

Recorded because each produced a confident green result.

1. **A column that compared nothing.** `ref.from_target` does not exist on a ref: 0 of 65,813 rows
   non-empty. Five ref fields claimed, three real. Caught by per-column occupancy.
2. **"Identical" from two crashed runs.** `getLanguageConfig` *throws* for an unsupported path. The
   filter tested `Boolean(config)`, both sides died on the first JSON file, and `diff` compared two
   empty outputs and reported success. Fixed with `configFor` plus `refuseEmpty`, which exits 3
   rather than emit a population that cannot certify anything — verified firing.
3. **A hand-maintained denylist that was also wrong** — missed four files.
4. **A serializer that destroyed the content it compared.**
   `JSON.stringify(row, Object.keys(row).sort())` applies the replacer array at *every* level, so a
   nested `{segment, authority}` lost both keys and serialized as `{}`. Two carriers with entirely
   different content compared **equal**. The gate reported content parity while comparing presence.
   **The negative control could not have caught it** — it mutated the serialized *text*, downstream
   of the fault. A control below the fault cannot see the fault. Replaced with a recursive
   canonicalizer that sorts object keys, preserves array order, and refuses `undefined`, non-finite
   numbers, functions and cycles instead of coercing them. Found by review, not by me.

A fifth is process: the carrier was mutated while **uncommitted**, and `git checkout --` restored it
to the previous committed version, discarding the rewrite. The rule it broke is this project's own
COMMIT BEFORE MUTATING.

A sixth is mutant design: the first content-mutant set mutated the **carrier**, which both arms
share by construction, so all three survived meaninglessly. Content binding can only be tested by
mutating the **extractor**, the asymmetric variable.

## Claim ceiling

Site identity and the opted-out population are unmoved **by step B, on this fixture and this
repository's tracked files, between these commits**. Not a claim that either is *correct*. Gate 7's
fixture is 18 symbols in 3 files; the C++ corpus is 16 fixture files.

`lexical_scope` and `written_qualifier` have no production consumer today; step C is the intended
one. The **qname** change does have one — `canonicalSymbolKey` — measured separately.

The carrier is itself a tracked file and therefore inside its own population, so the canonical
digest moves whenever the carrier does; the comparison is unaffected because both arms read the
same working-tree bytes.
