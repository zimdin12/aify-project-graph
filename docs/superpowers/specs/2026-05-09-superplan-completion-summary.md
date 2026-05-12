# Next-gen code-intel bridge — completion summary

> **Date:** 2026-05-09. **Branch:** `plan/next-gen-code-intel-bridge`.
> Companion to: `docs/superpowers/specs/2026-05-09-next-gen-code-intel-bridge-superplan.md`.

## What shipped

Four implementation plans executed end-to-end with TDD discipline, plus a fifth wave of MCP exposure + A/B demo:

| Plan | Title | Tag | Outcome |
|------|-------|-----|---------|
| #1 | Foundation (M0+M0.5+M1) | `plan-1-foundation-complete` | v0.2 schemas, validators, repo-relative paths, fixture provider, importer extension |
| #2 | C++ clangd provider + wrapper (M2+M2.5) | `plan-2-cpp-clangd-provider-complete` | `apg`/`aify-code-intel` CLI, provider runner, stdio LSP client, cpp-clangd provider, doctor |
| #3 | Graph merge + freshness (M3+M3.5) | `plan-3-graph-merge-complete` | `code_intel_collections` table, render helpers, query helpers, `graph_health.codeIntel`, `graph_pull` opt-in `code_intel` layer, `graph_change_plan` provenance ranking |
| #4 | Packet v2 + verify mode + fact budget (M4) | `plan-4-packet-verify-complete` | `verify` mode in `graph_packet`, EVIDENCE block, fact-budget ranker, all five W1.4 fixtures |
| #5 (APG-side) | MCP exposure + A/B demo | — | `graph_collect_code_intel` public verb, `verify` params on `graph_packet` schema, A/B demo script |
| #5a | verify since-derivation + host templates | — | `since:<git-ref>` → changed files via git-diff; `.lsp.json` / `.mcp.json` / `.pi-lsp.json` downstream-project templates |
| #5b | EVIDENCE injection into non-verify modes | `plan-5b-evidence-injection-complete` | All five non-verify modes (orient/plan/debug/review/audit) emit the EVIDENCE block via the existing renderer; tail-clamp respects token budget |
| **#6** | **Bounded live code-intel verbs (the C++ inner-loop win)** | **`plan-6-bounded-live-verbs-complete`** | **`code_intel_diagnostics/references/definitions/hover/symbols` drive clangd live — no collect/import round-trip. A/B vs collect-cycle: 0.65× time, 0.12× bytes (88% byte reduction).** Singleton LspClient per (language, projectRoot). |

(Plans #5 bridge UI and #6 cross-runtime install lab live in the separate `aify-agents-bridge` repo and `tests/integration/` lab respectively. The APG-side surface and contract are complete; bridge integration is straightforward consumption of the public verbs.)

## A/B confirmation

`scripts/demo-verify-ab.mjs` runs `graph_packet({mode:'verify'})` against two side-by-side temp repos: one with no code-intel collection imported, one with a v0.2 collection containing a diagnostic on `src/bar.cpp`. Findings:

| Test | Result |
|------|--------|
| baseline reports explicit unavailable (W3.4 Pi-graceful contract) | PASS |
| code-intel run shows provider name (W1.1 inline provenance) | PASS |
| diagnostics surface in verify mode when present (W2.4) | PASS |
| audited flag promotes SOURCE_REQUIRED warning (W1.4 case d) | PASS |
| baseline does NOT silently emit diagnostics block (no false signal) | PASS |

Full artifacts:
- `docs/dogfood/ab-2026-05-09-verify-mode-codeintel.txt` (human-readable comparison with full packet output)
- `docs/dogfood/ab-2026-05-09-verify-mode-codeintel.json` (machine-readable counts and findings)

## How to dogfood

**1. Sanity-check the wrapper CLI:**

```bash
node ./bin/apg.js code-intel doctor cpp
# expected: cpp: MISSING — clangd ... (since clangd is not installed here)
```

**2. Run the A/B demo:**

```bash
node scripts/demo-verify-ab.mjs           # human-readable
node scripts/demo-verify-ab.mjs --json    # machine-readable
```

**3. Build a verify packet against any repo with a v0.2 collection imported:**

```js
import { graphPacket } from './mcp/stdio/query/verbs/packet.js';
const out = await graphPacket({ repoRoot: '<your-repo>', mode: 'verify', files: ['<changed/file>'] });
console.log(out);
```

**4. Run a real collection (requires clangd + a `compile_commands.json`):**

```bash
node ./bin/apg.js code-intel collect cpp --project-root <your-repo> --json > collection.json
# Then import into your APG graph:
node ./scripts/import-code-intel.mjs collection.json
```

**5. Use the new MCP verb from a host (Claude Code / Codex):**

```jsonc
{ "tool": "graph_collect_code_intel", "args": { "language": "cpp", "scope": "all" } }
{ "tool": "graph_packet", "args": { "mode": "verify", "files": ["src/bar.cpp"] } }
```

## What changed at the agent surface

- **One front door:** `graph_packet` is the LSP-for-agents per the superplan thesis. Code-intel evidence rides inside packet output (provenance tags, three-state results, fact-budget caps), not as a separate verb buffet.
- **New verify mode:** post-edit decision packet. Inputs: `files[]` and/or `since:<git-ref>`, optional `audited`. Outputs: changed files, post-edit diagnostics, freshness verdict, `SOURCE_REQUIRED` warning when audited code is touched, partial-state distinction (`CODE_INTEL partial: ...`), explicit unavailable line when no code-intel.
- **`graph_health.codeIntel`** reports availability, provider, status, freshness basis, last collection — separate from graph trust.
- **`graph_pull` opt-in `code_intel` layer** returns defs/refs/hovers for a queried symbol with provenance.
- **`graph_change_plan`** prepends compiler-backed affected files with `provenance: 'CODE_INTEL'`; tree-sitter fallback tagged `EXTRACTED`. Top-level `code_intel_used` boolean.
- **`graph_collect_code_intel`** public action verb — agents and bridge UI both call it. Never auto-runs; explicit only.
- **CLI:** `apg code-intel collect <language>` and `apg code-intel doctor [<language>]`. `aify-code-intel` is a thin PATH shim.

## Invariants enforced (from the superplan)

1. ✅ Packet is the agent UX (raw LSP MCP exists but is back-door only — not exposed yet, deferred per scope).
2. ✅ Compiler facts override syntax guesses (provenance precedence in `change_plan`).
3. ✅ Pi/baseline keeps working without a provider (explicit `code_intel unavailable` evidence line in packet).
4. ✅ Three-state result distinction (`found` / `not_found_after_retry` / `not_collected`) representable in records and surfaced by `formatThreeStateRefs`.
5. ✅ Fact-budget caps with locked ranking order (`changed_files → task_anchors → code_intel_confidence → recency`) in `packet-budget.js`.
6. ✅ APG owns artifacts; `graph_collect_code_intel` is the public verb both agents and bridge call.
7. ⚠️ Parent-session subagent default — no subagent-specific MCP path yet. The packet output IS the parent-session evidence; bridge/host integrations will route accordingly.

## Test posture

- **Unit:** 386 passing, 1 skipped (pre-existing), 0 regressions across 71 files.
- **Integration:** real-clangd test gated on PATH; skips cleanly when clangd is absent (the case here).
- **A/B demo:** 5/5 findings pass.

## Known follow-ups (intentionally deferred)

- EVIDENCE block injection into existing modes (`orient | plan | debug | review | audit`) — `verify` mode covers it; injecting into other modes risks regressing the 100+ stable packet tests.
- Raw code-intel MCP (back door for subagents) — secondary surface; not yet exposed via the MCP server. Direct provider access is available through Node imports.
- `since:<git-ref>` to changed-files derivation — currently `verify` accepts `files[]` directly; deriving from `since` requires a git diff helper and is straightforward follow-up.
- Bridge UI integration (`aify-agents-bridge` repo) — out of this repo's scope; the APG-side public verbs and project-card data are ready to consume.
- Cross-runtime install lab (M7.5) — install paths exist (`bin/apg.js`, `bin/aify-code-intel.js`, `package.json` `bin` entries); scripted lab tests are a follow-up.

## Final commit log (this session)

22 commits on `plan/next-gen-code-intel-bridge` since the superplan landed:

```
plan + spec + senior-dev draft (c14cce1)
Plan #1: 9 commits → tag plan-1-foundation-complete
Plan #2: 7 commits → tag plan-2-cpp-clangd-provider-complete
Plan #3: 7 commits → tag plan-3-graph-merge-complete
Plan #4: 4 commits → tag plan-4-packet-verify-complete
Plan #5 (APG-side): MCP verb + A/B demo + completion summary
```

All commits respect hooks; nothing pushed; nothing amended.
