# The selection receipt — spec, DESIGNED not built

**Status 2026-08-19: codec + population selector IMPLEMENTED and independently replayed; the
receipt body is NOT WIRED to any verb.** `mcp/stdio/code-intel/selection-digest.js`. No agent can obtain one yet, so this is still not a capability to cite.

Verified: all six golden vectors from `graph-senior-dev`'s independent Python/Node pair, plus body-only replay with the producer's source files **deleted** — the property their first Python replay could not actually establish, because it was re-reading those files.

Context: `evidence.exhaustive` was falsified three times in one day and is now **withheld**
(`bd9034f`, `cfe0538`). This document specifies a **SELECTION / FLOOR receipt**: a smaller,
separate, TRUE claim about which population APG selected and which locations it exposed.

⛔ **It does NOT make a future positive claim auditable, and must not be described as a step
toward one.** I wrote that and retracted it; `graph-senior-dev` caught it standing in the
opening after the body already said otherwise. The positive claim needs the ATTESTATION
receipt — a separate remedy, a separate `receipt_kind`, and a population independent of its own
observed successes.

---

## The governing distinction

**Ship a SELECTION receipt now. It is not an index receipt and must never be readable as a
partial positive attestation.**

We can prove **which population APG selected** and **which locations it exposed**. We cannot
prove **which TUs the language server indexed**. A receipt that blurs those is the same defect
as the flag it replaces.

⛔ **A compact digest-only head is NOT auditable.** There are only two ways to preserve
membership across separate filesystems: carry members in the self-contained body, or
persist/transport an artifact. A head lets a second agent see that two opaque values differ; it
does not let them recover *what* differs. So ship the **body first**.

⛔ **If the population exceeds the body budget, REFUSE** with a typed
`population_transport_unavailable`. Never truncate and call it complete — that is
falsifier 16 below.

Reuse `query/receipt.js`, which already has the right architecture (self-contained,
content-addressed body; local artifact is only a cache). **Do not create a second persistent
receipt lifecycle.** Add a distinct `receipt_kind` so a selection receipt cannot be handed to a
future index-attestation consumer: `floor.exhaustive:false` is necessary but not sufficient —
**the kind itself must be non-promotable**.

⚠ **The current receipt ID is content addressing, not a signature.** Anyone can alter a body
and recompute the ID; there is no key or custody. Its job is integrity/misrouting detection plus
replay, never producer authentication. Consider full SHA-256 rather than the current 64-bit
prefix for safety receipts — but a full hash still does not authenticate the issuer.

## Shape

```
receipt_kind: 'code_intel_selection_v1'
replay:        { verb, exact args }
pinned_inputs: { server_commit, normalized_compile_db_hash,
                 selected_tu_set_digest, query_file_content_hash }
population:    { predicate: 'normalized compile-DB entries selected for this project',
                 complete: true,          // ONLY means the listed selection was not truncated
                 members: [ selection rows … ] }   // BODY, not merely a digest
query:         { file, line, col }
result:        { locations: [ canonical exposed locations … ],
                 complete: true,          // list transport not truncated; NOT semantic completeness
                 membership_digest, transformation }
authority:     { completeWithinAttestedIndexGeneration: false,
                 repositoryExhaustive: false,
                 cause: 'index_population_unattested' }
```

---

## The digest, exactly

⚠ **Do NOT create an authoritative `repoCodeTreeDigest` by guessing C++ extensions.** Headers
have arbitrary names, generated headers live under build roots, response files and `.clangd`
alter commands, and external headers/toolchains affect parse identity. **A guessed repo file set
is remedy 3 repeated at the byte-population layer.** Two digests, two authorities:

### Now — `selected_tu_set_digest` (selection only, claims no dependency coverage)

```
F(x)  = U64BE(byte_length(x)) || x        // 8-byte length framing
U64BE = unsigned 8-byte big-endian
UTF8  = Unicode NFC
H     = SHA-256
```

**Path canonicalization**
1. Resolve `file` against the entry's `directory`, lexically.
2. Require it inside the canonical project root for repository scope.
3. Project-relative, `/` separators, no leading `/`, no `.` or `..`, NFC, **preserve case**.
4. ⛔ **RETIRED — this rule said "reject duplicate normalized paths that case-fold equal … never
   silently merge aliases", and it contradicts the accepted implementation two sections down.**
   `graph-senior-dev` caught it surviving the falsifier-4 correction: *"exactly the kind of second
   authority from which the retired proxy will be reintroduced."* The population is a
   compile-entry **multiset** — preserve the original spelling and every row, never merge or
   dedupe. Physical-file identity belongs to a separate future population derived from resolved
   identity. Case is never normalized; `x/../y.cpp` and NFC still are.
5. Sort rows lexicographically **by their complete encoded row bytes**; retain duplicates
   (multiset semantics), so row count preserves multiplicity.

**One row**
```
row = F('apg.compile-entry.v1')
   || F(canonical_relative_path_utf8)
   || F(canonical_directory_utf8)
   || U64BE(argc) || each argv item as F(exact_utf8_item)
   || U64BE(main_file_byte_length)
   || F(SHA256(raw_main_file_bytes))
```
Use `arguments` **after** APG normalization. If the carrier has `command`, parse it with the
same platform parser clangd's input preparation uses — **never hash a whitespace-split
surrogate**. An unreadable or missing main file makes the digest **unavailable**, not a skipped
row.

**Aggregate**
```
selected_tu_set_digest = H( F('apg.selected-tu-set.v1') || U64BE(row_count) || each F(row) )
```
Raw file bytes only: no newline, BOM, Unicode or text normalization.

Separately hash **the exact normalized `compile_commands.json` bytes clangd is given** as
`normalized_compile_db_hash`. The set digest gives semantic membership for inspection; the
carrier hash proves exact bytes.

### Later — `index_input_digest` (attestation authority)

The positive receipt **replaces, never promotes**, the selection digest. Union of the inputs the
clean generation actually consumed: every expected TU's exact compile entry, plus every
source/header/module/config dependency and content digest **from that generation's shard or
include graph** (or an exact compiler dependency scan), plus clangd executable hash/version,
effective args, relevant environment/config, and external/toolchain inputs. Same framing, domain
`apg.index-input-set.v1`.

If an input class cannot be enumerated, name it in `unpinned_inputs` and `repositoryExhaustive`
stays false. **Hashing "all .h/.cpp under repo" must never substitute for observed
dependencies.**

---

## Generation identity — APG must own it

⛔ **There is no suitable clangd generation counter exposed through LSP, and the shard
directory's changing state is output, not identity. Do not infer one.**

In audit mode only:
```
run_id                  = random UUID created BEFORE spawn
process_identity        = { run_id, clangd executable hash/version, effective args }
index_cache_identity    = a unique directory created EMPTY for this run
input_fingerprint_before= H(normalized DB + selected population/input carriers)
input_fingerprint_after = the same computation after the result
outcome_digest          = sorted per-TU terminal ledger after queue idle
attested_generation_id  = H(domain || run_id || input_before || outcome_digest)
```

The invariant, stated precisely (my earlier shorthand "generationBefore === generationAfter" was
too weak) — **all four**:
- the same APG-owned process/run/cache identity handled the query; **and**
- `input_fingerprint_before === input_fingerprint_after`; **and**
- no new background-index progress began between ledger finalization and the response; **and**
- every expected TU has a terminal **clean** outcome in that run.

⚠ **A random run ID is custody, not content identity. The input fingerprint is content identity,
not custody. Do not collapse them.** Persistent warm sessions cannot be retroactively attested —
start a clean audit process.

For the shippable selection receipt: `attested_generation_id: null`, typed
`generation_unavailable`, authority false. **Inventing a generation from readiness or shard
mtimes would be worse than leaving it absent.**

---

## Receipt-availability causes — the closed vocabulary

The receipt is emitted or it is REFUSED; it is never partial. Each refusal names one cause, and
every one of them exists because the alternative was to silently shrink the population and keep
calling it complete. Two tests bind this list to reality: `cause-vocabulary.test.js` fails if a cause here is
undocumented, and `selection-selector.test.js` fails if any refusal passes a string LITERAL
rather than an enum member — so the vocabulary governs the emitters instead of describing them.

- `no_entries` — the selection was not an array; nothing to describe.
- `malformed_entry` — an entry carried no `file`.
- `no_argument_vector` — the entry has only a `command` string. A whitespace split is **not** an
  argument vector (quoting, embedded spaces, response files), so hashing one would describe a
  command nobody ran. ⚠ `compile-db.js:200` performs exactly that split for an unrelated
  toolchain heuristic, which is fine there and disqualifying here.
- `entry_outside_project_root` — the resolved main file escapes the project root.
- `compile_directory_outside_project_root` — the compile `directory` is outside the root. The
  spec's answer is a normalized absolute URI plus `portable:false`; **slice 1 refuses instead**,
  rather than inventing a representation the independent verifier does not share.
- `main_file_unreadable` — a selected main file could not be read. Unavailable, **never a
  skipped row**: dropping it removes the member from numerator and denominator at once.
- `no_project_root` — the population root is missing. A selection with no subject is not a
  claim about anything.
- ⛔ **RETIRED: `path_alias_collision`.** It refused two entries whose paths case-fold together.
  `graph-senior-dev`'s ruling removes it: this population is a compile-entry **multiset**, two
  entries spelling one physical file differently are still two selected entries, and the selector
  never merges anything — so the check protected nothing and only cost availability. The
  `process.platform === 'win32'` predicate behind it was a **stand-in** for a filesystem property
  it does not track (macOS commonly folds while `darwin` says false; Windows supports
  per-directory case-sensitive trees). If a future attestation needs a unique *physical-TU*
  population, derive that as its own population from resolved identity — do not retrofit
  uniqueness into compile-entry selection.
- `population_transport_unavailable` — the member body exceeds the transport budget. ⛔ Refuses
  **the receipt only**, never the primary reference/definition answer, and never returns a
  partial body with `population.complete:true` (falsifier 16). *(Reserved; the transport budget
  is not wired in slice 1.)*

## Preregistered falsifiers — write these before the code

**The central forgery is self-satisfying population selection:** define `expected` as the TUs
that emitted a success log. Then `expected == clean` by construction, the failed TU disappears
from numerator *and* denominator, and the receipt positively certifies its own observation
boundary. **The expected set must come independently from the declared scope / compile DB
BEFORE indexing.**

⚠ Recorded from prior experience on this project: *positive credit is the forgeable direction* —
six forgeries of `self-review.mjs`, every one forging a CAUGHT, none ever manufacturing a
SURVIVED. This receipt **is** positive credit.

1. **Denominator laundering** — remove the failed TU from outcome rows but not from the compile
   DB. Must be non-authoritative with `notObserved`, never recompute `expected` from outcomes.
2. **Equal-count substitution** — swap one selected/failed path for another, counts unchanged.
   Membership digest/body comparison must fail.
3. **Concatenation collision** — rows whose unframed concatenations match (`ab|c` vs `a|bc`).
   Framed digest must differ.
4. **Path alias** — `A.cpp`/`a.cpp`, `x/../y.cpp`, slash variants, Unicode composed/decomposed.
   **Preserve distinct compile-entry rows; never merge or dedupe.** ⚠ This falsifier originally
   read *"reject collisions"*, and that instruction is RETIRED along with the check it produced
   (see the receipt-cause vocabulary above): rejecting was guarding an invariant the selector
   cannot violate, since it never merges anything. Physical-file identity belongs to a separate
   future population derived from resolved identity — **do not reintroduce an alias check from
   this list.** `x/../y.cpp` and NFC convergence still normalize; case never does.
5. **Mid-call restore** — query a dirty source containing a caller, restore bytes before receipt
   hashing. Before/after fingerprints must differ, or the active read carrier must be pinned.
6. **Stale shard laundering** — preseed a clean old shard, make the current TU fail, observe
   shard existence. A unique empty cache / current-run ledger must refuse the old shard.
7. **Success-then-error ordering** — clangd logs `Indexed TU` then `Failed to compile TU`. A
   parser that grants on the first line must be killed; finalize only at idle, and downgrade.
8. **Progress laundering** — a failed task still increments `Completed`. Queue idle must never
   itself create clean outcomes.
9. **Unknown grammar laundering** — mutate clangd log wording/version. Unknown or unparsed
   terminal state ⇒ `notObserved`, no grant.
10. **Duplicate compile entries** — same path with clean and failing config variants, reordered.
    Bind the exact chosen command/selection policy; do not cherry-pick the clean row.
11. **Dependency omission** — change a header or `.clangd` while TU bytes and DB paths stay
    fixed. Selection receipt stays authority=false; a future index-input fingerprint must drift.
12. **Transform laundering** — hash raw LSP refs, then filter/dedupe/clamp the exposed locations
    while keeping authority. Must bind the EXPOSED set and prove `truncated:false` + named
    transforms.
13. **Artifact/body substitution** — change one member after ID creation: integrity must fail.
    Recompute the ID: integrity passes, so replay/member comparison must expose the changed
    claim. **Again: a hash is not authentication.**
14. **Shared-bug self-review** — producer and validator call the same canonicalizer/population
    selector and agree on the same omission. Needs an independent verifier implementation or
    fixture-generated known vectors.
15. **Scope promotion** — a complete Windows Debug receipt read as repository-wide across
    Linux/Release/generated configs. `completeWithinAttestedIndexGeneration` may be true;
    `repositoryExhaustive` must stay false unless a declared repo scope/union is satisfied.
16. **Truncation-by-transport** — drop member rows to fit a message limit while retaining
    count/digest/exhaustive. The full receipt must **refuse**, not silently become a head.
17. **Untracked/generated input** — a generated header outside guessed extensions/build root.
    Future attestation must pin it via observed dependencies or stay false.
18. **Definition fallback** — the executed fixture: the real definition's TU fails and the
    header declaration is returned. Any receipt calling `definitionLocations` complete, or
    semantically a definition, must fail.

**Positive credit is never "a receipt exists".** It is only: *independent expected population* +
*current-run clean outcomes* + *unchanged inputs* + *untransformed complete result*. **Every
missing component must structurally force false.**
