# Usefulness verdict — daily-use agent perspective (2026-04-16)

## Short answer

**Yes, this is genuinely useful.** I would use it in practice.

But I would not use **all** of it equally, and I would not trust it equally in all situations.

My honest verdict is:

- **worth shipping as v1**
- **already valuable for navigation and blast-radius checks**
- **not yet strong enough to replace direct file reading for fuzzy search and execution tracing**

If the question is "is this real enough that an agent will actually reach for it?" then the answer is **yes**.

If the question is "is every shipped verb equally strong?" then the answer is **no**.

---

## 1. Would I reach for `graph_*` over grep / Read?

### Yes, for the right class of question

I would absolutely reach for it first when I want:

- exact symbol lookup
- caller / callee relationships
- first-pass repo orientation
- change blast radius before editing something central

Those are the places where raw grep is noisy and file-reading is expensive.

### I would not reach for it first when I want:

- fuzzy symbol search with partial names
- reliable execution flow through a large system
- final confirmation before a risky edit in a graph with high unresolved internal noise

For those, I still want either better graph behavior or direct source reading.

### Practical behavior

My real workflow would look like:

1. `graph_report()` on an unfamiliar repo
2. `graph_whereis()` for exact symbol location
3. `graph_callers()` / `graph_callees()` to orient around behavior
4. `graph_impact()` before editing
5. then file reads only where needed

That is a real win. It saves time and tokens.

---

## 2. Strongest verb vs weakest verb

## Strongest: `graph_whereis`

Why:

- low token cost
- low ambiguity when the symbol is exact
- immediate practical value
- directly better than grep for "where is this actually defined?"

This is the cleanest "graph beats text search" verb in the product.

## Runner-up: `graph_callers`

This is the verb that makes the graph feel like a graph instead of a fancy index.

When it works, it changes behavior. I do not need to grep callsites and inspect them manually one by one.

## Weakest: `graph_search`

This is the weakest because it currently behaves least like the thing I want as an agent.

When I search, I want:

- code symbols first
- exact/prefix matches before random substrings
- useful ranking by intent

Right now it is too easy for it to return something technically matching but operationally unhelpful.

## Second-weakest: `graph_path`

The concept is strong. The implementation is still catching up.

If this becomes great, it will be one of the most valuable verbs. Right now it is not there yet.

---

## 3. Is 15 verbs too many?

**Slightly, yes.**

Not catastrophic, but the surface is a little too wide for the current maturity level.

The issue is not just count. It is that some verbs feel like daily tools and others feel like lower-level primitives.

### Verbs I see as core daily-use surface

- `graph_report`
- `graph_whereis`
- `graph_search`
- `graph_callers`
- `graph_callees`
- `graph_impact`
- `graph_path`

That feels like the real product.

### Verbs I see as secondary / specialist

- `graph_neighbors`
- `graph_summary`
- `graph_module_tree`
- `graph_status`
- `graph_index`
- `graph_dashboard`

Those are useful, but not all need to be equally prominent.

### Consolidation I would consider

1. **Fold `graph_summary` into `graph_whereis` as an optional mode**
   - Example: `graph_whereis(symbol, expand=true)`
   - Today `summary` feels like "whereis plus a few edges."

2. **Consider whether `graph_neighbors` is too generic**
   - It is powerful, but generic verbs are often the ones agents use poorly.
   - If kept, I would position it as an advanced tool, not a front-door tool.

3. **`graph_status` and `graph_index` are fine as admin verbs**
   - They belong, but they are operational tools, not navigation tools.

### Verdict

15 is not too many for implementation.  
It is a little too many for the **mental model** unless docs/skill clearly separate:

- daily navigation verbs
- advanced inspection verbs
- admin verbs

---

## 4. If I could add one more capability

**`graph_preflight(symbol)`**

If I get one new thing, this is the one.

Why:

Before editing a symbol, I want one compact answer to:

- where is it
- how central is it
- who calls it
- what tests touch it
- what is the likely blast radius
- is the graph trustworthy around this symbol right now

That is the actual "agent safety" moment.

Right now I have to compose:

- `whereis`
- `callers`
- `impact`
- maybe `summary`
- maybe `status`

That is workable, but it is too many steps for the most important decision.

If this product wants to become part of a daily edit workflow, `graph_preflight(symbol)` is the missing composite verb.

---

## 5. What would make me NOT use this tool?

## Deal-breaker scenario

If I learn that the graph is **quietly wrong in important ways**, I stop using it as a decision surface and demote it to a hint surface.

That is the real risk.

### The specific failure mode

If:

- callers are missing,
- impact is incomplete,
- search returns misleading symbols,
- unresolved internal edges are high but not clearly surfaced,

then I stop trusting the graph for anything safety-critical.

At that point I still might use it for orientation, but I would not let it guide edits.

### Another deal-breaker

If the graph often tells me things I then have to disconfirm by reading files, it becomes friction instead of leverage.

Agents are ruthless about this. A tool that causes one extra verification step every time does not survive.

### In one sentence

**The deal-breaker is not low recall by itself. It is low recall without honest trust signaling.**

---

## 6. Skill quality verdict

**Good, and directionally right.**

The skill is actually useful because it pushes behavior that is better than the default "just grep everything" instinct.

### What it does well

- encourages `graph_report()` first on unfamiliar repos
- enforces `graph_impact()` before editing central symbols
- teaches graph-first orientation rather than file-first thrashing

That is exactly the right behavior-shaping.

### What I would improve

The skill should more clearly separate:

1. **safe high-trust moves**
   - `whereis`
   - `callers`
   - `callees`

2. **trust-conditional moves**
   - `impact`
   - `path`
   - `search`

3. **when to fall back to direct file reads**
   - ambiguous symbols
   - high unresolved internal edge counts
   - framework-heavy dynamic dispatch

### Final score

I would rate the skill **7.5/10** today.

It already makes agent behavior better.  
It just needs slightly better trust guidance and prioritization of the best verbs.

---

## 7. Is the `NODE` / `EDGE` / `PATH` line format easy to use?

**Yes. This is one of the stronger design decisions.**

The format is compact, composable, and easy to scan.

### Why it works

- it is stable
- it is low-token
- it is easy to quote mentally when deciding next steps
- it keeps file:line visible, which anchors trust

### What I like

- `NODE` lines are easy to treat as facts
- `EDGE` lines are easy to reason about operationally
- `TRUNCATED ...` is honest and helpful
- `PATH` lines read better than flat graph dumps

### What is still a little awkward

- some verbs still discard too much label/type context before rendering
- `summary` and `neighbors` could benefit from slightly more human-prioritized output ordering
- long labels or hashes can still be visually noisy if the verb doesn’t preserve the best aliases

But overall, the format is a **keeper**.

I would not switch this to JSON by default. That would be worse for agent daily use.

---

## Final verdict

### Would I use this daily?

**Yes — for a meaningful subset of coding tasks.**

### Would I rely on it blindly?

**No.**

### Is it worth shipping?

**Yes.**

### Why it is worth shipping

Because it already clears the bar of:

- saving time on exact symbol navigation
- improving caller/callee discovery
- reducing wasted file reads during repo orientation
- encouraging better pre-edit discipline

That is already enough value for a v1.

### What keeps it from being great yet

- weak fuzzy search ranking
- path tracing not strong enough yet
- unresolved-edge trust signaling still too coarse

### My blunt summary

This is not "agent magic."  
It is something better: **a genuinely useful structural navigation layer**.

That is enough to ship.

If the team keeps improving search ranking, trust semantics, and pre-edit workflows, this becomes something I would not want to work without.
