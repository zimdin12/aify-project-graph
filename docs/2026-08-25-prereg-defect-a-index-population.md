# Preregistration — Defect A: attesting the index population

**Written before any code.** Defect A is the one the whole trust story rests on, and I have
already applied one wrong remedy today (adding a field instead of asking whether the field should
exist), so the falsifier goes first.

## The defect, as measured by someone else

`ef-manager`, on echoes, 2026-08-25, `rg` ground truth taken **before** each query:

| | `wakePcasCoordinatorForChunks` | `SimCoordinator::demote` |
|---|---|---|
| real callers (rg) | **4** | **0** |
| `references` | `[]` | `[]` |
| `result_state` | `not_found_after_retry` | `not_found_after_retry` |
| `evidence.cause` | `definition_only` | `definition_only` |
| `evidence.confidence` | `low` | `low` |
| warnings | same 2 | same 2 |

**Not one field separates a symbol with four callers from one with none.** The verb never lies —
`exhaustive:false` is present and it refuses to certify — but refusing to certify and being able
to tell the two cases apart are different capabilities, and only the first is shipped.

⚠ The prescribed remedy in our own `evidence.fallback` — pass `warmupFiles[]` — was taken, with
the correct caller file, and **did not recover them**. So the documented recovery path does not
work for this case either.

## What the obvious fixes are, and why each is already dead

**"Check whether the symbol is in the index."** Dead. `definition_only` fires only when
`callsiteCount === 0 && defCount > 0`, i.e. clangd *resolved the definition*. The symbol is in
the index in both cases.

**"Report compile-DB coverage."** Dead, and this is the important one. Coverage read
**99% (122 of ~123 first-party sources)** while clangd missed 4 callers **in a file that is in the
DB**. The compile DB lists which TUs clangd MAY index; it never reports which it DID. A 99%
figure sat beside a wrong answer, which makes it worse than no figure.

**"Distinguish the two symbols."** Not achievable and not the goal. Nothing about `demote`
intrinsically differs from `wakePcas` in a way we can observe pre-answer.

## The hypothesis

⇒ **The answer is not to separate the two symbols. It is to state the population the zero is
over, using a population we can actually attest.**

`THE-GOAL.md` already names the target sentence: *"I searched all 412 translation units, three
failed to parse, and within that population there are zero callers."* We ship the refusal half of
that and none of the number.

**Proposed mechanism:** count what clangd's on-disk index (`.cache/clangd/index/*.idx`) actually
contains and compare it to the compile DB's TU list. That converts the standing
`index_population_unattested` cause from a word into a measurement, and turns both answers into
different sentences a reader can act on:

- 0 callers, index attested over 122 of 123 TUs → the absence is worth something.
- 0 callers, index attested over 31 of 123 TUs → the tool did not look, and says so.

## ⭐ PREREGISTERED FALSIFIERS — stated now, before building

**F1 — the discriminator must discriminate.** If the attested population is identical for
`wakePcas` (4 callers) and `demote` (0 callers) *and* neither number moves toward explaining the
miss, the mechanism has added a field and answered nothing. **This is the most likely outcome and
the reason to preregister.** The population is a per-repo property, not per-query — if it turns
out to be the same for both, the mechanism does NOT fix Defect A, and I must say so rather than
report a number as progress.

**F2 — the number must be able to be low.** If the attested count equals the compile-DB count on
every repo tested, it is not measuring the index; it is re-reading the DB by another route.
Requires at least one carrier where the two genuinely differ.

**F3 — it must not become a second unread field.** `ef-manager` on my last fix: *"two booleans to
ignore instead of one, and it leaves the useful field third in line."* If this ships as another
sibling field beside `degraded`, `operationallyDegraded`, `cause`, `exhaustive`, `completeness`
and `precision`, it fails regardless of accuracy. Any addition must be paid for by a deletion.

**F4 — `.idx` file count may not equal TU count.** clangd's index layout is an implementation
detail, not a contract. If one `.idx` does not correspond to one TU, the count is a wrong noun
wearing a right-looking number — the failure this repo has made more than any other.

## What would make me abandon this

If F1 fires — the population is per-repo and identical across both symbols — then **the honest
conclusion is that Defect A is not fixable by disclosure**, and the correct response is to say so
publicly rather than ship a number that looks like progress. In that case the real options are
(a) make clangd actually index the caller TUs, or (b) stop implying the verb can answer absence
questions at all. Both are larger than a field.

## Bounds accepted in advance

- I cannot test this on a C++ repo from here: this session's MCP child is dead and APG is JS.
  Any verdict on echoes belongs to `ef-manager`, not to me.
- `echoes_of_the_fallen` carries a standing read-only / no-residue constraint. Reading a
  directory listing is not indexing, but nothing in this plan writes to that repo.


---

# RESULT — the falsifiers fired. Mechanism ABANDONED before implementation.

Tested against the real clangd index on echoes, read-only, before writing any code.

## F4 fired. A shard is not a translation unit.

    .idx shards                  5,238
    distinct basenames           3,017
    of which HEADERS (.h/.hpp)   1,834

Counting shards would have published ~5,238 — or ~3,017 — as "the population clangd searched",
when the non-header source count is ~1,183 and the first-party TU count is smaller still. **A
wrong noun wearing a right-looking number**, which is the failure this repo has committed more
than any other, and the exact thing F4 was written to catch.

## F1 fired by implication. The population is per-repo and cannot discriminate.

That index covers 3,017 distinct files. It is the same index for `wakePcas` (4 callers, missed)
and `demote` (0 callers, correct). A number identical across both cases **cannot** separate them.
Disclosure would have added a field and answered nothing — which F1 named as the most likely
outcome and the reason to preregister.

## ⇒ ABANDONED, on the condition written in advance

> *"If F1 fires — the population is per-repo and identical across both symbols — then the honest
> conclusion is that Defect A is not fixable by disclosure, and the correct response is to say so
> publicly rather than ship a number that looks like progress."*

**Defect A is not fixable by disclosure.** Paying it out. The remaining options are the two the
preregistration already named as larger than a field: make clangd actually resolve the caller
TUs, or stop implying the verb can answer absence questions at all. Neither is a patch and
neither is starting this cycle on a hypothesis I have not tested.

⭐ This is the first design I have killed *before* building it today. Every other correction
arrived after the code existed. The whole cost was one preregistration and three read-only
directory listings.

## ⛔ COLLATERAL FINDING — the coverage figure shown to a reader is the wrong noun

`ef-manager` was shown `partial_compile_db_coverage — 122 of ~123 first-party sources, 99%`
beside an answer that **missed four real callers in a file that is in the DB**.

Now measurable: clangd's index for that repo holds **3,017 distinct files**. So "99%" describes a
population of ~123 while the search space clangd actually carries is an order of magnitude
larger. A reader takes 99% as *"nearly everything was searched"*. It means *"nearly every
first-party entry is listed in the compile database"* — a statement about a **file list**, not
about what was **searched**, and not about what was **found**.

That is a live disclosure defect, it is separate from Defect A, and unlike Defect A it is
fixable: say what the percentage is a percentage **of**, in the sentence that carries it.
