# Refactor proposal — two files, verified seams

> ## ⚠ READ THIS FIRST — this document went stale in under a day, and it predicted that
>
> **Measurements below are pinned to the commit at which they were taken.** They were not,
> and by the time I audited this document its own numbers had drifted: `server.js` had grown
> 12 lines, the `TOOLS` array ended 7 lines earlier than stated, and `consequences.js` had
> gained 57. Re-measured at **`40c7e91`**: `server.js` 1394 total, `TOOLS` spans **62–675**,
> `generator.js` 1965, `consequences.js` 1323, `packet.js` 1154.
>
> ★ **The document contains a section warning that "a line number in a comment is a reference
> that no tool checks and every move invalidates" — and that section had itself gone stale,
> describing a hazard I had already closed.** It made the argument and then demonstrated it,
> on itself, within a day. Prefer citations that survive a move: `TOOLS` from its declaration
> to its closing bracket, clusters by first/last FUNCTION NAME. Any line number here carries
> the commit it was measured at, or it is a guess.
>
> **Two ambiguous referents, both corrected below:** `server.js` is `mcp/stdio/server.js` —
> `mcp/stdio/dashboard/server.js` also exists. `computeCoverage` is
> `brief/generator.js:69` — `code-intel/coverage.js` and `query/coverage-denominator.js` each
> export a *different* function of that name, with different signatures.
>
> **Comment percentages use `comments / total lines`.** Stated because the denominator was
> never named; under `comments/(code+comments)` each figure shifts 1–2 points. The one number
> driving a do-not-touch decision is robust either way: `health.js` is 48% / 49%.
>
> ⛔ **Both target sections' central SAFETY claims were false when audited** — see the
> corrections inline. The structural measurements survived; the completeness claims did not.

Steven asked how many files are oversized and whether a refactor is due. Measured rather
than estimated, and the answer is **narrower than the raw counts suggest**.

⚠ **Not started.** Steven's sequencing is: close the review blockers → get
graph-senior-dev-hermes's verification → *then* refactor. This document is the seam
analysis only. No code has moved.

---

## The measurement

202 production files, 44,254 lines, **mean 219**. The mean is healthy; the tail is not.

| | count |
|---|---|
| over 1000 lines | 8 |
| over 700 | 17 |
| over 400 | 25 |

★ **But line count is the wrong instrument here, and following it would have produced two
wrong refactors.** This codebase carries unusually dense commentary — defect histories,
field reports, and the reasoning behind non-obvious choices:

**Re-measured at `40c7e91`** (comments ÷ total lines; the previous table was taken days earlier
and had drifted on every row):

| file | total | comments | **code** | exported |
|---|---|---|---|---|
| `mcp/stdio/brief/generator.js` | 1966 | 19% | **1487** | — |
| `mcp/stdio/server.js` | 1395 | 20% | **1064** | — |
| `query/verbs/consequences.js` | 1324 | 43% | **713** | 1 |
| `query/verbs/packet.js` | 1155 | 32% | **695** | 3 |
| `query/verbs/health.js` | 1182 | **48%** | **582** | 3 |

⇒ `health.js` is not a 1,182-line file. It is a 582-line file carrying ~570 lines of recorded
defect history, and that history is the most expensive thing in it. **Leave it alone.**

⚠ **The leave-alone decision is right; its stated reason was not right for every file.**
Audited:

- `consequences.js` — exactly as described: **one export, one job.** Reason holds.
- `health.js` — 3 exports, so "one verb doing one job" is imprecise; but the reason actually
  relied on (48% recorded defect history) is measured and holds under either denominator
  (48% / 49%). Decision safe.
- `packet.js` — the shared reason was *"the bulk is explanation rather than logic."* At **32%
  comments, 68% is logic** — the lowest of the three, grouped with files at 43% and 48% on a
  justification that does not measure the same way for it.

★ This is **not** a recommendation to split `packet.js`: 39 top-level functions over 695 code
lines averages ~18 lines each, which is well-factored rather than tangled. **The decision is
right for a reason this document did not give** — and a conclusion whose stated basis is false
for a third of its cases will mislead the next reader even while reaching the correct answer.

**Two files are genuine targets. Six are not.**

---

## Target 1 — `brief/generator.js` (1487 code lines, 42 functions)

### The seam, verified

Every function was sized and every boundary crossing checked. Four clusters, and they do
not interleave:

| lines | cluster | size | inputs |
|---|---|---|---|
| 48–502 | **filesystem/source extraction** | 455 | `repoRoot`, sometimes `db` |
| 503–1212 | **graph analysis** | 710 | `db`, `repoRoot` |
| 1213–1790 | **rendering** | 578 | one plain `data` object |
| 1791–EOF | **orchestration** (`generateBrief`) | 175 | `{ repoRoot }` |

**What makes the render seam clean, checked not assumed:** all five renderers
(`renderMarkdown`, `renderAgentMarkdown`, `renderOnboardAgentMarkdown`,
`renderPlanAgentMarkdown`, `renderJson`) take a single `data` object, destructure it, and
return a string. ⛔ **"No shared mutable state, no back-references into analysis" was HALF
false.** Module-level mutable state: none — that half holds, measured. But **six** functions
declared outside the render block are called from inside it: `computeCoverage` (declared line
69, in the *extraction* range), `testSectionHeader`, `openTasksByFeature`,
`completedTaskCountsByFeature`, `openTasksWithoutFeatures`, `formatTaskLinkSummary`.

★ **The consequence this document missed: the proposed split creates a CIRCULAR IMPORT.** It
puts `computeCoverage` in `generator.js` and the renderers in `render.js` — but `generator.js`
must import `render.js` to call them, and `render.js` would import `computeCoverage` back. In
the slice nominated *second-safest*. `computeCoverage` and the three task-artifact readers must
land where both sides can import; `testSectionHeader` and `formatTaskLinkSummary` are pure
formatting helpers misfiled in the analysis range and should move with render.

⚠ Four other apparent back-references were FALSE POSITIVES and are not defects: `subsystems:`,
`hubs:` and `risks:` are object-literal keys, and every `trust` hit is either the key `trust:`
or the text `trust=` inside a template string — **`trust()` is never called from render**, so
this document's note that it belongs with orchestration stands. Each of the ten hits was read
individually, because a matcher that cannot tell a call from a property read is the `...HEAD`
artefact recorded two sections down. `renderJson`
additionally takes `repoRoot`.

**What makes the analysis seam clean:** those functions take `(db, ...)` and return plain
values. `trust()` is the one that takes many arguments — it is a pure combinator over
already-computed results, so it sits with orchestration or analysis equally well.

★ **The finding that changes the split:** the orchestrator is *not* at the top. It sits at
line 1791, *below* the renderers, and it is the only place each analysis function is called
— exactly once each. So the current file reads bottom-up, which is why it is hard to follow
despite each function being individually reasonable.

### Proposed

```
brief/generator.js   orchestration + computeCoverage      ~250
brief/extract.js     tooling / exports / paths, from fs   ~455
brief/structure.js   entryPoints, subsystems, hubs,       ~710
                     readFirst, enrichFeatures, trust
brief/render.js      the five renderers                   ~578
```

⇒ No file over ~710, each with a one-sentence job.

### `structure.js` sub-seam — now verified (2026-08-12)

The first version of this document declined to split the 710-line analysis block because
the seam was unverified. It has since been measured, and the axis is **not topic — it is
DATA SOURCE**:

| takes | functions | ~lines |
|---|---|---|
| `db` | `entryPoints`, `subsystems`, `classifyRole`, `hubs`, `readFirst`, `testInventory`, `testAnchors`, `risks` | 470 |
| `repoRoot` / artifacts | `recentActivity` (git), `openTasksByFeature` (tasks.json), `summarizeUnresolvedFromManifest` (manifest) | 200 |

⇒ Split on that axis, not on the topical grouping I would have guessed at:

```
brief/graph-shape.js   everything derived from the graph db      ~470
brief/artifacts.js     git / tasks.json / manifest               ~200
```

⛔ **"THE ONE FUNCTION THAT CROSSES IT" IS UNDER-COUNTED — there are two.** Measured over the
24 analysis functions: 11 db-only (454 lines), 7 artifact-only (131), **1 crossing the
db/filesystem axis** (40), 5 pure helpers taking no data source at all (85).

- The crosser this document names: `enrichFeaturesForPlanning(db, validFeatures)` — db + overlay.
- The crosser it misses: **`entryPoints(db, repoRoot, limit)`** — db + filesystem; it calls
  `detectFromPackageJson(repoRoot)` and genuinely reads outside the graph. The table above
  files it under db-only, as its **first** entry.

⇒ Under this document's own stated axis — *"the axis is DATA SOURCE"* — **both cross**, so
`graph-shape.js` as proposed still needs `repoRoot` and a filesystem read, and the ~470/~200
split is not clean.

✓ Two claims here were independently corroborated by that same measurement, which is worth
recording since most of this audit was falsification: `trust` really does take no data source
(classified *neither*, exactly as written below), and `testSectionHeader` / `formatTaskLinkSummary`
classify as *neither* too — confirming by a second method that they are misfiled render helpers.

★ **The one function this document names as crossing:** `enrichFeaturesForPlanning(db, validFeatures)` takes
the graph AND the overlay. It is the real boundary and should live with `graph-shape` while
taking the overlay slice as a parameter — the existing signature already does this, which
is evidence the boundary is real rather than imposed.

⚠ `trust(snapshot, entries, subs, hubsArr, overlayHealth, …)` takes no data source at all —
it is a pure combinator over already-computed results, so it belongs with orchestration.

---

## Target 2 — `mcp/stdio/server.js` (1064 code lines at `40c7e91`)

### The seam, verified

| lines | cluster | size |
|---|---|---|
| 62–682 | **`TOOLS` — 42 tool schema declarations** | 620 |
| 683–996 | toolset resolution, allowlists, projection | 313 |
| 997–EOF | dispatch + MCP protocol | ~385 |

★ **620 of the 1382 lines are one declarative array.** That is not logic and it does not
belong beside the dispatcher. Extracting `tools/schema.js` alone takes `server.js` from
1382 → ~760 and does not change a single code path.

#### Verified 2026-08-12, not assumed

- **Zero forward references.** Nothing in lines 62–682 calls `withFreshParam`,
  `resolveToolset`, `selectListedTools`, `applyAllowlist`, `parseToolsAllowlist`,
  `projectToShortDescription` or `defaultOutputMode`. (An initial grep flagged `...HEAD` —
  those are `main...HEAD` inside description *strings*, a grep artefact, not a reference.)
- **Zero runtime dependencies.** No `process.*`, no `readFileSync`, no `await`, no
  closures. The single match was a *comment* mentioning `process.cwd()`. `TOOLS` is a pure
  literal.
- **Dependency direction is strictly one-way:** `TOOLS` → toolset resolution (5 reads) →
  dispatch. Dispatch reads `ACTIVE_TOOLSET` (3), `ACTIVE_TOOLS` (2), `TOOLS_ALLOWLIST` (2),
  `MUTATING_TOOLS` (1). Its single direct `TOOLS` reference is the alias
  `const ACTIVE_TOOLS = TOOLS` on line 998 — in the boundary zone, and it becomes an import.

⛔ **THE SENTENCE THAT USED TO BE HERE WAS FALSE.** It read: *"the safest slice available in
the repo: a pure data literal with no inbound or outbound coupling."* Measured at `40c7e91`:

- `TOOLS` carries **42 `handler:` references to 42 distinct imported functions**, resolved by
  **33 of the 46 import statements** above it. Those 33 imports must move WITH the literal.
- So the slice is not data movement. It relocates the module that knows every verb
  implementation, and `server.js` then imports it back. That is arguably the better
  architecture — but "no outbound coupling" was wrong, and `1382 → ~760` inherited the error.

✓ **Cycle risk is genuinely nil, and this one was verified rather than asserted:** no module
reachable from those 33 handler imports imports `mcp/stdio/server.js`. 152 modules traversed
transitively, and the offender predicate was separately proven capable of firing before the
null result was accepted. (Its first version tested `endsWith('/server.js')` and flagged
`mcp/stdio/dashboard/server.js` — the ambiguous-basename hazard this document warns about,
walked into by the instrument checking it.)

#### ✅ CLOSED — one hazard found while verifying, fixed before the slice

`mcp/stdio/server.js` contained `// … Handler at line 536 already routes it`. **A line number
in a comment is a reference that no tool checks and every move invalidates** — and that one was
already wrong. Same class as the byte-offset test assertions converted earlier this week: an
address that looks like a citation and silently stops pointing at anything.

**Closed:** replaced with the handler's name, which survives a move. Re-measured at `40c7e91`:
zero `line N` citations remain in `mcp/stdio/server.js`, and `generator.js` never had any.

⇒ ★ **And this section was itself the hazard for most of a day.** It went on describing an
open defect after I had closed it, while the seam tables above it cited line ranges that had
drifted. The document made the argument against stale citations and then became an instance of
it — which is why the header now pins every measurement to a commit.

⇒ And it has a second payoff: `tools/list` bills **every session**, ~80% of it schema. A
dedicated module makes that cost visible and measurable instead of buried mid-file.

### Proposed

```
server.js            protocol + dispatch                  ~385
tools/schema.js      the TOOLS array                      ~620
tools/toolset.js     resolution, allowlist, projection    ~313
```

---

## Sequencing and risk

1. **`tools/schema.js` first.** Pure data movement, no behaviour, trivially reviewable —
   the safest possible first slice and the biggest single reduction.
2. **`brief/render.js` second.** The verified-cleanest seam in `generator.js`: one input
   type, no back-references.
3. Then `extract.js` / `structure.js`.
4. `server.js` dispatch/toolset split last — highest coupling to the protocol layer.

⚠ **Why the order matters.** `generator.js` output is asserted by brief tests that are
themselves part of the source-contract conversion under review. Moving that code while its
guarantees are still being verified would mean refactoring against tests I do not yet
trust — which is the reason the whole refactor waits on dev's verdict.

**Behaviour must not change.** Every slice is a move, not a rewrite.

### ⚠ The verification section as first written was WRONG, and the correction is the point

It said the check is "the full suite plus `npm run smoke` before and after each slice, and
a byte-identical brief output". That is insufficient for the very first slice, and I only
found it by asking *what would catch me HERE* instead of *does a check exist*:

⇒ **Extracting `TOOLS` from `server.js` changes no brief artefact at all.** The brief oracle
would have reported byte-identical output across a slice it cannot observe, and the suite
does not compare the emitted tool surface either. **The safest, highest-value slice had no
safety net** — and a green result would have read as confirmation.

★ A general check plus a specific check is not coverage; it is a general check plus one
specific check that happens to exist. Each slice needs an oracle that can see THAT slice.

| slice | what changes | oracle that can SEE it |
|---|---|---|
| 1. `tools/schema.js` | the emitted tool surface | `scripts/toolsurface-oracle.mjs` — full `tools/list` over the real protocol: names, descriptions, every schema byte |
| 2. `brief/render.js` | brief artefacts | `scripts/refactor-oracle.mjs` — all four artefacts, subject held fixed |
| 3. `extract.js` / `graph-shape.js` / `artifacts.js` | brief artefacts | `scripts/refactor-oracle.mjs` |
| 4. `server.js` dispatch/toolset | routing and tool surface | `toolsurface-oracle` **plus** `tests/unit/server/tool-routing-identity.test.js` (name → handler, proven against a forged lookalike) |

Both oracles are proven bidirectionally — unchanged code exits 0, a real change exits 1 —
because an oracle that cannot detect a change is worse than none: it manufactures
confidence. The tool-surface one reds on a tool rename and on an input-schema type change;
the brief one reds on `hubs(5 → 4)`.

⇒ **Run capture BEFORE the slice.** Both refuse a compare with no capture rather than
treating absence as agreement.
