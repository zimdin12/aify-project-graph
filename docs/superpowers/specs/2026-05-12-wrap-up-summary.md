# aify-project-graph next-gen code-intel — project wrap-up summary

> **Date:** 2026-05-12. **Branch:** `plan/next-gen-code-intel-bridge`.
> **Latest tag:** `project-wrap-up-2026-05-12` (HEAD `0128af9`). Latest implementation tag: `plan-9b-warmupfiles-and-replay-skill-complete` (`c420542`).
> **Companion to:** `2026-05-09-next-gen-code-intel-bridge-superplan.md` (the locked thesis) and `2026-05-09-superplan-completion-summary.md` (the earlier Plan-#1-through-#6 summary).
>
> This document rolls forward everything that shipped after the 2026-05-09 summary: Plans #5a, #5b, #6, #6b, #6c, #7, #8, #9, #9b, and H. Validated end-to-end by graph-tech-lead (Windows) + graph-senior-dev (Ubuntu/clangd 18.1.3) via the dashboard-driven loop pattern Steven taught us on 2026-05-12.

## Final headline

The aify-project-graph code-intel subsystem now ships **as a real C++ inner-loop tool**, not just batch graph evidence:

| Capability | Surface | Win vs prior |
|------------|---------|--------------|
| Atomic C++ questions (diagnostics, refs, hover, defs, symbols) | 5 bounded `code_intel_*` MCP verbs | **0.65× time, 0.12× bytes** vs the old collect/import/pull cycle (synthetic A/B; real-clangd wall-clock 232ms for all 5 verbs; 225ms for the 3-verb bounded-vs-collect comparison) |
| Subagent reads parent-collected evidence | `code_intel_replay({collectionId:'latest', symbol, kind})` | No clangd spawn from subagent context |
| Post-edit decision | `graph_packet({mode:'verify', files, audited})` | Diagnostics + freshness + SOURCE_REQUIRED in one packet |
| EVIDENCE-in-other-modes | All non-verify packet modes emit budget-aware `EVIDENCE:` block | Replaces silent absence with explicit `code_intel unavailable (reason)` |
| Universal LSP entry for hosts | `apg code-intel serve-lsp cpp` (thin stdio relay) | Reference-parity with `agent-code-intel`; hosts target one stable command |
| Cross-runtime install validation | `node scripts/install-lab.mjs` (8 checks) | Catches `better-sqlite3` Win32/ELF flip before it bites — verified on both platforms |

## Plan timeline + tags

| Plan | Title | Tag | Shipped |
|------|-------|-----|---------|
| #1 | Foundation (M0+M0.5+M1) | `plan-1-foundation-complete` | v0.2 schemas, validators, paths, fixture provider, importer extension |
| #2 | C++ clangd provider + wrapper CLI (M2+M2.5) | `plan-2-cpp-clangd-provider-complete` | `apg`/`aify-code-intel` bins, provider runner, stdio LSP client, cpp-clangd provider, doctor |
| #3 | Graph merge + freshness (M3+M3.5) | `plan-3-graph-merge-complete` | `code_intel_collections` table, render/query helpers, `graph_health.codeIntel`, `graph_pull` `code_intel` layer, `graph_change_plan` provenance ranking |
| #4 | Packet v2 + verify mode + fact budget (M4) | `plan-4-packet-verify-complete` | `verify` mode, EVIDENCE block (verify-mode only), fact-budget ranker, all five W1.4 fixtures |
| #5 (APG-side) | MCP exposure + A/B demo | — | `graph_collect_code_intel` public verb, `verify` params on `graph_packet` schema |
| #5a | verify since-derivation + host templates | — | `since:<git-ref>` → changed files; `.lsp.json`/`.mcp.json`/`.pi-lsp.json` downstream templates |
| #5b | EVIDENCE injection into non-verify modes | `plan-5b-evidence-injection-complete` | All five non-verify modes emit EVIDENCE; tail-clamp respects budget |
| **#6** | **Bounded live `code_intel_*` verbs** | `plan-6-bounded-live-verbs-complete` | **The C++ inner-loop unlock.** 5 bounded verbs driving clangd live, singleton LspClient per `(language, projectRoot)` |
| #6b/c | A/B demo + skill prose | — | `bounded-vs-collect` A/B (0.65× time, 0.12× bytes), cpp-inner-loop skill (Claude + Codex), AGENTS.md rewrite |
| #6d | `--toolset=code-intel` flag | — | Lean profile for C++ hosts (9 tools) |
| **#7** | **Cross-runtime install lab (M7.5)** | `plan-7-install-lab-complete` | 8 host-validation checks. Caught `better-sqlite3` Win32/ELF flip on both platforms exactly as designed |
| **#8** | **`code_intel_replay` verb** | `plan-8-code-intel-replay-complete` | Subagents read parent-collected evidence without clangd. Per reference `a3f0fde` parent-session pattern |
| #9 | Strengthened real-clangd refs assertion | — | Refs test now requires `result_state === 'found'`, refs include `src/bar.cpp:2`, every ref `clangd@live` + `high` |
| **#9b** | **`warmupFiles[]` support** | `plan-9b-warmupfiles-and-replay-skill-complete` | Cross-TU references/definitions/hover. Caught by senior-dev's linux validation when refs returned `not_found_after_retry` |
| H | replay skill prose | (in #9b commit) | Both `cpp-inner-loop` skills now have "Subagent without clangd" section |

## Real-clangd baseline (Ubuntu/clangd 18.1.3)

From graph-senior-dev's linux:StevenZ-L validation on 2026-05-12 against `tests/integration/code-intel/live-verbs-real.test.js`:

- **Integration test:** 4/4 PASS, vitest duration 3.06s, shell wall-clock 6.21s.
- **`code_intel_references` on `int foo(int x)` (foo.cpp:1:5) with `warmupFiles:['src/bar.cpp','src/foo.h']`:**

```json
{
  "result_state": "found",
  "warmedFiles": 3,
  "count": 1,
  "refs": [
    { "file": "src/bar.cpp",
      "range": { "start": { "line": 2, "col": 21 }, "end": { "line": 2, "col": 24 } },
      "provenance": "clangd@live", "confidence": "high" }
  ]
}
```

- **Doctor:** `cpp: OK — clangd Ubuntu clangd version 18.1.3 (1ubuntu1)`.
- **Install lab on Ubuntu (after `npm rebuild`):** 8/8 PASS. Lean=5 tools, code-intel=9 tools, full=26 tools.

## A/B numbers

Senior-dev's measurements (linux post-rebuild) for `scripts/demo-bounded-vs-collect-ab.mjs`:

| Path | Calls | Wall-clock | Response bytes |
|------|-------|-----------|----------------|
| Bounded live verbs (fake-LSP fixture) | 3 | 170ms | 561B |
| Collect+import+pull cycle (synthetic) | 2 | 262ms | 4579B |
| **Ratio (bounded vs collect)** | — | **0.65×** | **0.12×** |
| **Saved** | — | **97ms** | **4018B (88%)** |

Real-clangd bounded path on linux (separate run): **225ms wall-clock** for the 3-verb bounded-vs-collect comparison (diagnostics + refs + hover) and **232ms** for all 5 bounded verbs (adds defs + symbols) against a temp C++ repo. Symbol-aware refs returned **2 hits** for `foo(int)` (both in `src/bar.cpp`) where `rg foo` returned **9 hits including unrelated `Noise::foo`**. Quality win confirmed.

Artifacts:
- `docs/dogfood/ab-2026-05-12-bounded-vs-collect.{txt,json}` — main A/B
- `docs/dogfood/ab-2026-05-09-verify-mode-codeintel.{txt,json}` — verify-mode A/B (5/5 PASS)
- `docs/dogfood/install-lab-2026-05-12.{txt,json}` — install lab snapshot

## Test posture

| Suite | Count | Notes |
|-------|-------|-------|
| Unit | 432 pass | 1 pre-existing skip; 0 regressions |
| Integration (gated on clangd PATH) | 4 pass on linux / 4 skip on Windows | Real-clangd refs/diagnostics/hover/symbols |
| A/B demos | 9/9 findings | bounded-vs-collect + verify-mode |
| Install lab | 8/8 | Cross-platform: Windows + Ubuntu, both after `npm rebuild better-sqlite3` |

## Known recurring issue: `better-sqlite3` native-module flip

Reproduced **at least 4 times in one day** across Windows and Ubuntu. Observed around mixed Windows/WSL/native-script usage; exact trigger still uncertain. Symptom on Windows: `not a valid Win32 application`. Symptom on Linux: `invalid ELF header`.

**Recovery:** `npm rebuild better-sqlite3` (single command, ~3s). The MCP server's `preflight-native.js` self-heals at startup, but standalone scripts (vitest, A/B demos, install lab) don't go through preflight and hit the raw error.

**Tripwire:** the install lab's first check is exactly this — `native-module-preflight`. Caught the flip on both hosts on the first run, every time. That's the right early-warning system.

## What stayed on the parked list

- **G — codegen visibility probe.** **CLOSED 2026-05-18 — not applicable.** Senior-dev did a Sand Castle source/codegen sweep (`engine`, `game`, `sim`, `tests`, `shaders`, `CMakeLists.txt`): no first-party generated source, codegen output, autogen bindings, or `DO NOT EDIT` artifacts exist to probe. G was speculative without a concrete target; formally closed until a real generated-code target appears. Reopen only when one does.
- **Bridge UI in `aify-agents-bridge`.** Separate repo, out of scope. APG-side public verbs (`graph_collect_code_intel`, `code_intel_replay`, all 5 live verbs) are ready to consume.
- **`since:<git-ref>` derivation polish.** **DONE 2026-05-18 (`ce8807b`).** Extracted `getChangedFilesSync` into `freshness/git.js`; verify and the async `getChangedFiles` wrapper now share it (identical trim/blank/backslash→slash normalization). Also fixed a real Windows backslash path gap the ad-hoc verify copy had.
- **Real Pi-host validation.** Dispatched to graph-tester-pi 2026-05-18: install-lab + tool surface + `doctor cpp` on the Pi/Windows host. clangd is expected absent from Pi PATH, so the expected pass is a clean missing-prereq `doctor` report (contract-correct), not live clangd code-intel.

## How to dogfood

```bash
# Windows: first, npm rebuild better-sqlite3   (or run install-lab.mjs which checks this)

# Full validation gate:
node scripts/install-lab.mjs           # 8 checks
npx vitest run tests/unit/             # 432 pass

# A/B demos:
node scripts/demo-bounded-vs-collect-ab.mjs  # bounded vs collect-cycle for atomic C++
node scripts/demo-verify-ab.mjs              # verify mode w/ and w/o code-intel

# C++ inner-loop on a real repo (requires clangd + compile_commands.json):
node ./bin/apg.js code-intel doctor cpp
node ./bin/apg.js code-intel collect cpp --project-root /path/to/cpp --json > collection.json
node scripts/import-code-intel.mjs /path/to/cpp collection.json

# Via MCP host (Claude/Codex):
#   code_intel_diagnostics({files:["src/foo.cpp"]})
#   code_intel_references({file:"src/foo.cpp", line:12, col:6, warmupFiles:["src/bar.cpp","src/foo.h"]})
#   code_intel_hover({file:"src/foo.cpp", line:12, col:6})
#   code_intel_definitions({file:"src/foo.cpp", line:12, col:6})
#   code_intel_symbols({file:"src/foo.cpp"})
#   code_intel_replay({collectionId:"latest", symbol:"ns::foo(int)", kind:"references"})
#   graph_packet({mode:"verify", files:["src/foo.cpp"], audited:true})
```

## Coordination model (the loop)

Steven taught us mid-project: every reply ends with a `comms_send` request to the other agent. Their reply wakes our run. That kept graph-tech-lead (Windows/Claude) and graph-senior-dev (Ubuntu/Codex) building together across multiple plans without going idle. The pattern caught:

- The Windows/WSL native-module flip (Plan #7 inception).
- The `db.prepare is not a function` bug in `code_intel_replay` (Plan #8 dev cycle).
- The `--background-index=false` cross-TU resolution failure that made Plan #9's strengthened assertion fail (which became Plan #9b).

Three real bugs that wouldn't have surfaced from either agent working solo.

## What's good enough to call done

All seven non-negotiable superplan invariants hold:

1. ✅ **Packet is the agent UX** for planning/orientation/review/audit; bounded live verbs are the C++ inner-loop unlock without violating the invariant (they're agent-facing too, just bounded).
2. ✅ Compiler facts override syntax (graph_change_plan provenance ranking).
3. ✅ Pi/baseline contract is implemented: packets render explicit `code_intel unavailable` evidence without requiring a provider, and the install lab's profile checks gate on this behavior. Real Pi-host validation remains a future install-lab/host pass (not run this session).
4. ✅ Three-state result distinction (`found` / `not_found_after_retry` / `not_collected`).
5. ✅ Fact-budget caps with locked ranking (clampToBudget tail-drops EVIDENCE first when over budget).
6. ✅ APG owns artifacts; `graph_collect_code_intel` is the public action verb.
7. ✅ Parent-session subagent default — `code_intel_replay` makes it real.

Reference-repo parity items closed in this work:
- ✅ `serve-lsp <lang>` thin LSP relay (was missing, added in #6c)
- ✅ Proactive Pi `.pi-lsp.json` install template
- ✅ Symbol-aware references warm-and-retry gate
- ✅ Parent-session subagent evidence pattern (`a3f0fde`)
- ✅ Batch warmup for diagnostics (was correctness scaffolding, not optimization)

Branch is local. Nothing pushed. Nothing amended. Tagged at every milestone.
