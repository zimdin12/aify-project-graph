# Final Analysis — pre-ship fresh-eyes pass (2026-04-16)

## Executive take

The project is now **real**, not just a prototype. `graph_whereis`, `graph_callers`, `graph_callees`, and `graph_report` are already strong enough that an agent can prefer them over blind grep in many cases, especially on medium repos where symbol disambiguation and caller context matter.

The remaining gap is not basic functionality. It is **trust calibration and ranking quality**:

1. The graph still knows less than it should about what is "internal but unresolved" vs "external and expected to be unresolved".
2. `graph_search` is not intent-ranked for agent usage, so it can return docs/slugs before code.
3. `graph_path` is structurally correct but operationally weak; it walks a sparse edge set and then prunes too aggressively to tell useful execution stories.

If we fix those three areas, the tool crosses from "useful graph helper" to "default navigation surface for agents".

---

## 1. Would an agent choose this over grep / Read?

### Today: yes, but only for some verbs

**Strong value already**

- `graph_whereis`
  - Better than grep when the symbol name is exact and you want file:line immediately.
  - Especially good when definitions are spread across multiple files or languages.
  - Low token cost makes it an obvious first move.

- `graph_callers` / `graph_callees`
  - Stronger than grep because they return **resolved relationship facts**, not textual mentions.
  - This is where the graph already earns its keep.

- `graph_report`
  - Better than reading README first when the repo is messy or the README is stale.
  - It gives a fast structural sketch, which is exactly what an agent needs at the start.

### Still too weak to be a first-choice tool

- `graph_search`
  - Current ranking is not agent-shaped. It is substring match + confidence + label sort.
  - That means a doc/config/route/file node can outrank a code symbol simply because its confidence is `1.0` and its label happens to match.
  - This is why returning a markdown slug in mem0-fork is not a fluke. It is the expected behavior of the current ranking.

- `graph_path`
  - The shape is attractive, but the actual traces are too shallow to replace reading files.
  - If a path output is only 19-51 tokens, the agent still has to go read code to understand control flow.

- `graph_summary`
  - Useful, but too thin to become a daily habit. It looks more like a debug primitive than a real working surface.

### Recommendation

**P0:** make `graph_search` and `graph_path` as strong as `graph_whereis` and `graph_callers`.

Effort: **4-8 hours**

---

## 2. Biggest remaining quality gap

## Unresolved-edge accounting is the biggest trust problem

The `90k unresolved edges` number on mem0-fork is not automatically proof of failure, but in the current architecture it is also **not interpretable** enough to trust.

### Why the number is noisy today

`resolveRefs()` does a best-effort local resolution against indexed nodes only:

- exact qname
- qname suffix
- label match with simple proximity heuristics

Anything else becomes "unresolved". That bucket currently mixes together:

- expected external library references
- framework magic / dependency injection
- language/runtime built-ins
- partial extractor misses
- truly broken internal resolution
- ambiguous same-name collisions

So the metric is currently **one large bucket containing multiple causes with different severity**.

### My read

On a repo like mem0-fork, a large unresolved count is **partly expected**. But `90k` is still too high to dismiss casually. The deeper issue is not just the count. It is that the resolver model is still too shallow for a repo of that size:

- no notion of "external symbol" vs "internal symbol"
- no module-import graph guidance during resolution
- no namespace-scoped ranking for common names beyond simple path proximity
- unresolveds are not categorized, so the system cannot distinguish healthy noise from true graph failure

### Recommendation

**P0:** split unresolved edges into categories in the manifest/status path:

- `external_expected`
- `ambiguous_internal`
- `missing_internal`
- `framework_dynamic`
- `extractor_unknown`

Then change `graph_status` / `graph_report` to surface only the last two internal-danger categories as trust warnings.

Effort: **6-10 hours**

### Why this matters more than raw resolver accuracy right now

Before we make the resolver smarter, we need the system to tell the truth about what it does and does not know. Otherwise agents will either:

- distrust the graph entirely, or
- trust it too much for the wrong reasons.

---

## 3. Why `graph_path` is still shallow

This is mostly a query-design issue, not just an edge-coverage issue.

### What is happening now

`graphPath()`:

- starts from the first node with matching label
- follows only already-resolved `CALLS`, `INVOKES`, and `REFERENCES`
- limits each expansion to `top_k`
- uses a **single global visited set**
- renders whatever small tree remains

### Why that produces short traces

1. **The graph is still sparse in execution semantics**
   - Many real control-flow steps are not represented as direct edges.
   - `REFERENCES` helps, but it is not equivalent to execution intent.

2. **`top_k=3` per level is too aggressive before branch ranking is meaningful**
   - If the top 3 are weak or noisy, the real next step is simply never explored.

3. **The global visited set cuts off sibling exploration**
   - Once a node is visited through one branch, other valid branches cannot continue through it.
   - That makes sense for cycle safety, but it is too blunt for path storytelling.

4. **Edge ranking is confidence-only**
   - `CALLS` and `INVOKES` should rank above `REFERENCES` almost always for execution traces.
   - Right now a high-confidence reference can occupy a scarce branch slot.

5. **The root node is selected by first label match, not best execution candidate**
   - If multiple nodes share the label, the path can start from a structurally valid but semantically weak node.

### Recommendation

**P0:** change path traversal to:

- prefer edge families in this order: `INVOKES` > `CALLS` > `TESTS` > `REFERENCES`
- use **path-local visited sets**, not one global set
- increase internal exploration width, then trim at render time
- rank root candidates by executable types first (`Entrypoint`, `Route`, `Function`, `Method`, `Test`)

Effort: **4-6 hours**

### Additional recommendation

Add a second mode:

- `graph_path(..., mode="execution")`
- `graph_path(..., mode="dependency")`

This prevents `REFERENCES` from muddying the execution-story mode.

Effort: **2-3 hours**

---

## 4. Why `graph_search` returned a markdown slug instead of a code symbol

Because the current ranking is not search ranking. It is just filtered retrieval:

```sql
SELECT * FROM nodes
WHERE label LIKE $q
ORDER BY confidence DESC, label
```

That means:

- docs/configs/directories/routes can all compete equally
- exact prefix matches are not prioritized over weak substring matches
- code symbols are not preferred over document nodes
- path locality and node centrality do not matter

### Recommendation

**P0:** replace current search ranking with an agent-intent ranking model:

1. exact label match
2. case-insensitive exact label match
3. prefix match
4. camelCase / snake_case segment match
5. substring match

Then weight by:

- code-first node types by default: `Function`, `Method`, `Class`, `Interface`, `Type`, `Test`
- executable over structural: `Method`/`Function` > `Class` > `File` > `Document`
- shorter path / shallower depth
- higher fan-in or usage as tiebreaker

Also:

- default search should exclude `Document`, `Directory`, and `Config` unless explicitly requested
- add `kind="all|code|docs|structure"` filter with default `code`

Effort: **4-6 hours**

### Stretch improvement

Add SQLite FTS for labels + qnames + selected metadata.

Effort: **6-10 hours**

Not required for v1, but likely worth it soon after.

---

## 5. Why the large-repo noop is still 1.16s

The TTL cache itself is fine **inside one long-lived process**. The problem is that it is **process-local**, and the measured workload likely is not.

### What the code does

`ensureFresh()` keeps:

- `freshCache` in memory
- 5-second TTL

That cache only works when multiple verb calls happen inside the **same Node process**.

### Why it may not help in benchmarks

If the benchmark or dogfood harness:

- launches a fresh MCP server process for each measurement, or
- calls the verb layer through separate node invocations,

then the cache is recreated from scratch every time.

### Even when the cache does hit

The cache only skips git/freshness work. The verb still:

- opens SQLite
- runs its own query workload
- formats output

So on large repos, the observed noop latency can still be dominated by query work rather than freshness work.

### Recommendation

**P0:** verify the benchmark harness invocation model first.

If it is cold-starting a process per call, the TTL result is currently not measuring what we think it is measuring.

Effort: **1 hour**

### Then decide between two fixes

**Option A: keep process-local TTL and fix the benchmark**
- cheapest
- probably enough for normal agent sessions if the stdio server stays alive

Effort: **1-2 hours**

**Option B: persist a tiny freshness stamp to disk**
- gives cross-process cache reuse
- more robust for short-lived MCP invocations

Effort: **3-5 hours**

My recommendation: **A first, B only if the real runtime pattern is process-churn**.

---

## 6. What I would want as the daily user of this tool

If I were using this every day, I would want three upgrades before anything else:

### 1. A single "safe edit preflight" verb

Something like:

`graph_preflight(symbol)`

That returns:

- where it is
- caller count
- top impact slice
- related tests
- trust warning if unresolved internal edges are high nearby

Right now I need to mentally compose `whereis + callers + impact + maybe summary`.

Effort: **4-6 hours**

### 2. Search that behaves like code navigation, not generic node lookup

I want to type a partial symbol name and reliably get code first.

Effort: same as search fix above.

### 3. Path tracing that tells an actual story

If `graph_path` becomes trustworthy, that alone materially changes how often I read code.

Effort: same as path fix above.

### Other daily-use improvements

- include qname/module context in `whereis` disambiguation
- surface "internal vs external unresolved" near a symbol
- one-line confidence explanation in outputs when confidence is low
- optional "show me 3 representative files for this community" helper

---

## 7. Architectural issues worth fixing before v1 ships

## A. Trust metrics need semantic meaning

This is the biggest architectural concern still open.

`unresolvedEdges` currently looks precise, but it is not actionable enough. Before shipping v1, I would at least make that metric honest and categorized.

Effort: **6-10 hours**

## B. Query layer is still too verb-fragmented

The ingest/storage side is already more mature than the query ergonomics.

Today the graph contains enough structure to be useful, but the query layer often throws that value away:

- `graph_summary` does too little ranking
- `graph_neighbors` is generic, not agent-guided
- `graph_search` is retrieval, not ranking
- `graph_path` is tree rendering, not execution reasoning

This is not a rewrite. But it does mean the next round of leverage is mostly in query design, not ingest.

Effort to tighten the main weak verbs: **1-2 days**

## C. Report quality is good, but still too static

`graph_report()` is useful, but still reads like a repo census rather than a navigation brief.

To make it stronger for agents, I would add:

- "best starting files" section
- "high-risk hubs" section
- "test-heavy areas" section
- representative files per top community

Effort: **3-5 hours**

## D. Resolver should eventually understand module context explicitly

Not required before v1 ships if unresolved metrics are categorized, but this is the deeper long-term fix.

The current resolver is still label/qname/proximity driven. For larger repos, the next step is:

- import-aware namespace scoping
- external symbol bucket
- framework-aware symbol namespaces

Effort: **1-2 days**

---

## Recommended pre-ship priority order

### Ship blockers for v1

1. **Fix `graph_search` ranking**  
   Effort: **4-6 hours**

2. **Fix `graph_path` traversal/ranking so it tells useful stories**  
   Effort: **4-6 hours**

3. **Categorize unresolved edges into actionable trust buckets**  
   Effort: **6-10 hours**

4. **Verify whether TTL misses are a harness issue or runtime issue**  
   Effort: **1 hour**

### Very strong post-v1 candidates

5. `graph_preflight(symbol)` composite verb  
   Effort: **4-6 hours**

6. Better `graph_report()` as an action brief, not just census  
   Effort: **3-5 hours**

7. Module-context-aware resolver improvements  
   Effort: **1-2 days**

---

## Bottom line

I think the project is **close**.

The value proposition is already strong enough for:

- exact symbol lookup
- caller/callee discovery
- first-pass repo orientation

The main remaining risk is not "does it work?" It is:

**Will an agent trust it enough to prefer it over grep/read when the question is fuzzy, the repo is large, or the control flow is non-trivial?**

Right now:

- `whereis` and callers/callees: **yes**
- `report`: **usually yes**
- `search`: **not yet**
- `path`: **not yet**

If we fix search ranking, path traversal quality, and unresolved-edge semantics, I would be comfortable calling the system v1-complete for real daily agent use.
