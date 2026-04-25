---
name: aify-project-graph
description: Codex runtime card. Compact agent map for repos with .aify-graph/. Use brief.agent.md first; graph_packet for one-shot context; live verbs only when precision is required. Full reference at references/SKILL-full.md.
---

# aify-project-graph (Codex runtime card)

The graph is a **map**, not the source of truth. Compose it with file reads.

## First action in any session

If `.aify-graph/brief.agent.md` exists, read it. ~300-1100 tokens of dense orientation. Cheaper than exploring with shell. If missing, run the Codex `graph-build-all` skill or `node <plugin>/scripts/graph-brief.mjs <repo>`.

## Use this verb order

1. **`graph_packet(target)`** — one-shot agent prompt packet. Cheap + coarse. Reads overlay+brief JSON directly. Returns 500-900 tokens: STATUS / FEATURES / SNAPSHOT / READ FIRST / CONTRACTS / TESTS / RISKS / LIVE. Pass `feature:<id>`, `task:<id>`, or a bare symbol (auto-resolves via consequences). **Use for ORIENTATION** ("what's the shape of this feature/task?").
2. **`graph_pull(node)`** — cross-layer pull when packet's static data isn't enough.
3. **`graph_consequences(target)`** — "what breaks if I touch X?" Function-granular fan-out. **Use for CROSS-CUTTING PLANNING** when packet's coarse view loses precision.
4. **`graph_change_plan(symbol)`** — risk gate before editing high-fan-in symbols. SIGNALS line + ranked READ ORDER. **Use for RISK ASSESSMENT** when packet says "this looks load-bearing."
5. **Read source.** Always. Graph tells you *what connects*, source tells you *what the code does*.

**Tradeoff:** packet is cheaper than change_plan/consequences (no SQL, no per-symbol query), but coarser. If packet's MATCHED VIA shows a symbol→feature mapping you want to drill into, escalate to change_plan or consequences. Default-routing everything to packet trades quality for cost — use it for orient, escalate for depth.

Other verbs (`graph_path`, `graph_impact`, `graph_callers`, `graph_find`, `graph_whereis`, `graph_health`, `graph_status`, etc.) remain callable by name via `tools/call`. They're hidden from `tools/list` to reduce manifest token tax. Use them only on explicit precision questions.

## Trust gates verb worth

Brief and `graph_health` print a `TRUST` line. **Read it first.**

- `trust=ok` (or `strong`) → live verbs earn their keep
- `trust=weak` → prefer briefs + `graph_packet` + source reads. Live verbs may return wrong/empty edges.

The packet's `SNAPSHOT:` line includes `STALE` if indexed commit ≠ HEAD. `LIVE:` line tells you whether enrichment ran or was skipped under budget.

## Edge provenance

When verbs print `prov=...` on edges:
- `EXTRACTED` — direct AST edge, highest trust
- `INFERRED` — heuristic/framework synthesis, verify in source
- `AMBIGUOUS` — fallback resolution, lowest trust

## Hard rules

- Don't rely on the graph without reading the target files
- Don't prefetch verbs "just in case"
- Don't call verbs in parallel
- `graph_callers` is function-granular not line-granular — use Grep when you need a specific line
- Compound `graph_find("A B C")` queries return empty — tokenize to one strong keyword

## When the graph is wrong for the question

- Single-file debugging → Grep + Read
- Per-line audits → Grep wins by schema
- Symbol appears in >10 files → Grep beats `graph_whereis`
- You're about to read code anyway → just read it

## Reference

Full skill (workflows, anti-patterns, pre-action consultation table, examples): `integrations/codex/skill/references/SKILL-full.md`. Don't load it every session; consult only on a specific question.
