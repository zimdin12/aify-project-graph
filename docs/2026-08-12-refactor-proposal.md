# Refactor proposal — two files, verified seams

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

| file | total | comments | **code** |
|---|---|---|---|
| `brief/generator.js` | 1965 | 18% | **1487** |
| `server.js` | 1382 | 19% | **1063** |
| `query/verbs/consequences.js` | 1266 | 41% | 704 |
| `query/verbs/packet.js` | 1104 | 30% | 682 |
| `query/verbs/health.js` | 1181 | **48%** | 582 |

⇒ `health.js` is not a 1,181-line file. It is a 582-line file carrying 569 lines of
recorded defect history, and that history is the most expensive thing in it. **Leave it
alone.** The same goes for `consequences.js` and `packet.js`: large, but each is one verb
doing one job, and the bulk is explanation rather than logic.

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
return a string. No shared mutable state, no back-references into analysis. `renderJson`
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

★ **The one function that crosses it:** `enrichFeaturesForPlanning(db, validFeatures)` takes
the graph AND the overlay. It is the real boundary and should live with `graph-shape` while
taking the overlay slice as a parameter — the existing signature already does this, which
is evidence the boundary is real rather than imposed.

⚠ `trust(snapshot, entries, subs, hubsArr, overlayHealth, …)` takes no data source at all —
it is a pure combinator over already-computed results, so it belongs with orchestration.

---

## Target 2 — `server.js` (1063 code lines)

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

⇒ This is the safest slice available in the repo: a pure data literal with no inbound or
outbound coupling. If any slice can be done without risk, it is this one.

#### ⚠ One hazard found while verifying

`server.js:678` contains `// … Handler at line 536 already routes it`. **A line number in a
comment is a reference that no tool checks and every move invalidates** — and this one is
already wrong. It is the same class as the byte-offset test assertions converted earlier
this week: an address that looks like a citation and silently stops pointing at anything.

Only one instance exists across both target files (`generator.js` has none), so this is a
one-line fix during the slice, not a workstream. **Replace it with the handler's name**,
which survives a move.

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
