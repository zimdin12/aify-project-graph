# M1a step B — gates 7 and 1: what step B did NOT move

Preregistration: `docs/evidence/m1a-step-b/PREREGISTRATION.md`
Carrier: `scripts/step-b-identity-differential.mjs`
Test: `tests/unit/ingest/site-identity-unmoved-by-scope.test.js`

Step B taught the C++ extractor to carry lexical scope into the qname. Gates 7 and 1 are the two
"nothing else moved" predicates. Both are **differentials between two checkouts**, not assertions
made by the code under test about itself.

| | pre-B | post-B |
|---|---|---|
| commit | `8c1bdc35155521934df2da5a53e02cb255ade374` | `51ef3caff506a0d4e3410d39c61f1e589c6a369e` |
| checkout | detached worktree at `../apg-preb` | this working tree |

The checkout supplies only the **code**. The fixture, the tracked-file list and the source bytes
come from this working tree in both runs, so the two runs differ in exactly one variable.

## Gate 7 — symbol site identity is unmoved

Site identity is a byte-span address, deliberately blind to what a symbol is called. Had scope
leaked into it, every C++ symbol inside a namespace would have been re-keyed on this commit,
silently orphaning containment edges, ledger rows and every stored reference to them.

**Result: 18 sites, zero differences.** Both sides digest to
`0f3ac162ce21957fa2861bd77256c9a65e80144b3d0eb7598d5efc7ab2ad4d46`.

The 18 ids are pinned in the test as a **measurement taken from the pre-B worktree**. Pinning ids
produced by the code under test would have proven only that it agrees with itself.

The test carries a second, independent substrate for the same claim: each id is recomputed from
`site_start_byte`/`site_end_byte` via `codeSymbolSiteId` and compared to what the extractor
emitted. The pin says *unchanged since pre-B*; the recomputation says *derived from nothing but
the span*. The recomputation survives someone re-pinning the literals to match contaminated output.

### Controls

- **Positive** — the fixture still yields 18 symbols, each with a 40-hex id and integer byte span.
  Without it, a renamed or emptied fixture would produce an empty population that compares equal
  to an empty pin, and the file would certify nothing.
- **Population is relevant** — the fixture is asserted to actually contain scoped symbols
  (`alpha`, `beta`). The other three assertions would otherwise pass on a fixture with no
  namespaces, where scope could not leak because there was none to leak.
- **Mutants, both killed (2 of 4 tests each)** — site id contaminated with `lexicalScope`:
  1. *unconditional* (`path#scope` always): all 18 ids moved.
  2. *narrow* (`path#scope` only when scope is non-empty): also killed both id-binding tests.
     This is the discriminating one — mutant 1 also moves unscoped sites, so on its own it does
     not show the test is sensitive to a contamination that touches only scoped symbols.

  Mutants ran in a throwaway copy of the tracked tree, which was deleted afterwards.

## Gate 1 — the non-C++ canonical population is unmoved

`lexicalScope` is opt-in and only `cpp.js` declares it, so no non-C++ output should change.

**Result: 774 files, 70,190 canonical rows, zero differences.** Both sides digest to
`eac34fbb0fd77fb619c760f2e1e6a8e234818bbc054b81af663bdb3b699d0c39`.

Compared per node: `id`, `type`, `label`, `qname`, `parent_class`. Per ref: `relation`, `from_id`,
`target`. This is membership, count and field content — not examples.

### Controls

- **Negative, per half** — mutating node rows makes 5,360 rows differ; mutating ref rows makes
  131,626 differ; corrupting one site id makes 2 rows differ. The differential can say DIFFER.
- **Positive, per column** — every compared column is occupied, so every column can carry a
  difference: node `id`/`type`/`label`/`qname` 4,377/4,377, `parent_class` 109/4,377 (sparse but
  real — this codebase is mostly free functions); ref `relation`/`from_id`/`target` 65,813/65,813.

### ⚠ A column that compared nothing, and what it cost

The first version of this differential also emitted `ref.from_target`. That field **does not exist
on a ref**: 0 of 65,813 rows were non-empty. It compared nothing while making the surface look
wider than it was — five ref fields claimed, three real. Caught by the per-column occupancy
control, before the number reached a finding. The dead column is removed from the carrier, which
is why the canonical digest above differs from the one produced during the first run; the
identical-populations result is unchanged, and both sides were re-run with the committed carrier.

## Claim ceiling

Site identity and the non-C++ population are unmoved **by step B, on this fixture and this
repository's tracked files, between these two commits**. Not a claim that either is *correct* —
only that step B did not change them. Gate 7's fixture is 18 symbols in 3 files; it is not a claim
about every C++ file in the world.
