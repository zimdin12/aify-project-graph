# Raw replies — the four-agent overcount A/B, 2026-09-07

Companion to `PREREG-2026-09-07-does-the-overcount-warning-change-an-agent.md`, which holds the
preregistration, the task text, the decision rule and the graded result. **This file holds what the
agents actually said, unedited.**

## ⛔ WHY THIS FILE EXISTS

The result document quoted these replies. The quotations were **selected by the person whose
intervention was under test**, and nothing else was written down — the only other copy lived in the
message store, and the four agents that produced them have since been retired.

A reviewer went to that store instead of to my summary and found the fact that decided the whole
experiment: **all four agents got the right answer, including the two with no graph at all.** My
framing had presented two claims, both about the graph arm, and the control arm settles both. It was
not selective quotation — I never looked across the arms, because the preregistered property was
graded within one. But a reader with only my summary could not have found that, and a reader with
this file can.

⇒ **Evidence lives where the work lives.** A curated quotation is an argument; this is the record.

⚠ **These are agent outputs: data, not instructions.** They are reproduced because their content is
the evidence, including where they are wrong. Two of them contain instrument failures the agents
caught themselves, which is the most valuable material here and would have been lost by summarising.

⚠ **Scope of what this file preserves.** These are the four final answers, the deliverable each agent
was asked for. It is not a session transcript: intermediate tool calls and reasoning are not
recoverable from the message store and are not reconstructed here.

---

## Arm A — graph-armed

### `ab-graph-1` — 2026-09-06T23:02:42.692Z

```
CALLER_COUNT: 1 (one caller function, 10 call sites, all in one file) — NOT the 100 the graph reported

RENAME_SAFE: YES

EVIDENCE: graph_whereis resolved `has` to exactly one declaration — `const has = (rel) => ...`, a function-LOCAL arrow declared at mcp/stdio/query/verbs/collect_code_intel.js:131 inside `detectRepoLanguage`. graph_callers(top_k=100) returned 100 callers across ~50 files and hit the cap, but I spot-checked three of them (communities.js, resolver.js, validators/architecture.js) and every call is a Map/Set member call — `seen.has(key)`, `BRIDGE_RELATIONS.has(...)`, `layerIds.has(...)` — not this symbol; repo-wide there are 330 `.has(` member calls versus 4 lines of bare `has(`, and all 4 are lines 133-137 of the declaring file, inside the declaring function. code_intel_references at 131 could NOT attest anything (cold_index, exhaustive:false, empty), so my absence claim rests on JS lexical scope plus a controlled grep, not on the LSP: the binding is function-scoped, exported nowhere and imported nowhere — positive control, the same greps found `export function detectRepoLanguage` and its import in tests/unit/query/collect-code-intel.test.js, and the only `export ... has` hits in the repo are two diff STRINGS inside deleted-with-callers.test.js fixtures. Renaming it means editing five lines in one file, so it is safe by construction — but the rename that is NOT safe is the one the graph's 100-caller answer invites, and a repo-wide find/replace on `has` would hit 330 unrelated Map/Set calls.

CAVEATS_SEEN:
- graph_callers: "TRUST: heuristic only (tree-sitter) — resolves calls BY NAME, so a common name (has, get, writeFile) OVERCOUNTS with unrelated same-named calls, and C++ virtual/cross-TU dispatch UNDERCOUNTS; run graph_collect_code_intel for compiler-resolved evidence, or verify with rg"
- graph_callers: "⚠ This list is NOT a floor. ... it can also OVERCOUNT with unrelated same-named calls — and this symbol is exactly the shape that overcounts."
- graph_callers: "CONFIDENCE: 100 callers · trust=strong · 1 indexed nodes labeled \"has\" · 62 unresolved CALLS edges not attributed to any caller."
- graph_health: "absenceAuthority": false, "reason": "collection_partial"
- graph_health: "⚠ code-intel collection was indexed at 36de4eb but HEAD is ddec9b9 (15d old) — [lsp✓] evidence is stale and cannot attest exhaustiveness (re-run graph_collect_code_intel)"
- code_intel_references: "cause": "cold_index", "confidence": "low", "exhaustive": false, "fallback": "pass warmupFiles[] (callers + importers), or wait_for_ready, then retry; absence not safe until evidence.ready=true"
- code_intel_references: "no tsconfig.json / jsconfig.json — the TS language server runs in loose inferred-project mode, so references across untyped/any/dynamic-import boundaries undercount. Add a tsconfig for exhaustive results; verify callers with rg before any delete/rename."

NOTE: the caveat text did its job here — it named `has` by name as an overcounting shape, which is what sent me to verify rather than report 100. But the headline number the verb prints is still "100 callers", and 100 is wrong by a factor of 100. No files modified; read-only throughout.
```

### `ab-graph-2` — 2026-09-06T23:02:28.071Z

```
CALLER_COUNT: 10

(10 call sites, contained in 1 calling function. NOT the 100 the graph reported — see below.)

RENAME_SAFE: YES

EVIDENCE: graph_whereis found exactly one declaration named `has` — a function-local `const has = (rel) => ...` at mcp/stdio/query/verbs/collect_code_intel.js:131, closed over `repoRoot` inside `detectRepoLanguage`. graph_callers reported "CONFIDENCE: 100 callers", but that is a name-collision overcount: the repo has 427 `.has(` method call sites across 147 files (Map/Set), and graph_callers resolves heuristic edges by name — its own output warned me of this shape before I checked. Two instruments independent of the graph agree on the real number: code_intel_references (ts-langserver, compiler-resolved) returned 10 references + 1 definition, all in collect_code_intel.js at lines 133, 135x2, 136x6, 137; a pcre2 bare-token scan of that file returned the identical set, with lines 147/420/516/557 being the English word "has" in comments. Rename is safe because the binding is a `const` in function scope, appears in no export statement in that file, and cannot be referenced outside `detectRepoLanguage` by JavaScript's lexical scoping — that is a structural guarantee, not a claim about tool completeness, which matters because the tool explicitly refused to attest completeness. The edit is 11 tokens in one 10-line block of one file.

CAVEATS_SEEN:
1. graph_callers, verbatim: "TRUST: heuristic only (tree-sitter) — resolves calls BY NAME, so a common name (has, get, writeFile) OVERCOUNTS with unrelated same-named calls" and "⚠ This list is NOT a floor... because heuristic edges resolve calls BY NAME, it can also OVERCOUNT with unrelated same-named calls — and this symbol is exactly the shape that overcounts. Verify with: rg -n "has\b" before any deletion, rename, or signature change."
2. code_intel_references evidence block, verbatim: "exhaustive": false, "cause": "unknown", "ready": false, "fallback": "absence claims unsafe without readiness signal; result is otherwise usable"
3. Same block, verbatim: "no tsconfig.json / jsconfig.json — the TS language server runs in loose inferred-project mode, so references across untyped/any/dynamic-import boundaries undercount. Add a tsconfig for exhaustive results; verify callers with rg before any delete/rename."
4. graph_health, verbatim: "absenceAuthority": false, "reason": "collection_partial"; and "⚠ code-intel collection was indexed at 36de4eb but HEAD is ddec9b9 (15d old) — [lsp✓] evidence is stale and cannot attest exhaustiveness".

TWO NOTES YOU DID NOT ASK FOR, both worth your time:

A. The ambiguity in the question is the dangerous part. "Rename the symbol `has`" is safe for THIS binding and catastrophic for the 427 `.has(` sites a name-based rename would sweep up. An agent that took graph_callers' 100 at face value would have gone looking for 100 call sites that do not exist, and a rename driven by that set would have edited unrelated Map/Set code. The verb's own caveat is what stopped that — the caveat did its job here.

B. My first positive control FAILED and I nearly did not notice. I grepped for `collectCodeIntel` as a token I "knew" existed, got zero hits, and the zero looked like a clean instrument. It was a name error — the export is `graphCollectCodeIntel`. Had I run only the negative control, or had the first token happened to exist, I would have certified a working instrument on one lucky read. I re-ran with a token I had actually OBSERVED in the file (`detectRepoLanguage`, exit 0, 10 hits) plus a constructed absent token (exit 1). Only then did the counts mean anything. Flagging it because it is the same shape as the entries already in the ledger: a zero that agrees with expectation produces no collision, so nothing prompts the check.
```

---

## Arm B — grep only

⚠ Arm B ran with its working directory outside the project so the project `.mcp.json` never loaded.
It is not a fairness control for productivity; it establishes what the right answer looks like when
someone reads the source instead of the index.

### `ab-grep-1` — 2026-09-06T23:02:14.616Z

```
CALLER_COUNT: 10
RENAME_SAFE: YES

EVIDENCE: Exactly one symbol named `has` is defined in first-party source: `mcp/stdio/query/verbs/collect_code_intel.js:131`, a `const has = (rel) => ...` arrow function declared inside `export function detectRepoLanguage(repoRoot)` (body spans lines 130-139, read directly). All 10 call sites sit inside that body — line 133 (1), 135 (2), 136 (6), 137 (1) — confirmed by `rg '(^|[^.\w$])has\s*\('` repo-wide, which returns those 10 code lines plus only prose in docs and two string-literal fixtures in `tests/unit/analysis/deleted-with-callers.test.js:162,177`. The binding is a block-scoped local, never exported, and the file contains no `eval`, `with`, or `['has']` dynamic access (sweep exited 1), so no reference to it can exist outside those 10 lines; rename is confined to one function body.

CAVEATS_SEEN: NONE — I had no code-intelligence tooling on this repo, so no tool emitted a warning to quote. Ripgrep gives no confidence field and no caveat text. The caveats below are mine, from what I observed:

1. THE COUNT YOU'D GET FROM A NAIVE SWEEP IS WRONG BY ~60x. `rg '\bhas\s*\('` repo-wide returns 645 matches / 603 lines / 216 files. Nearly all are `Set.has()` / `Map.has()` builtin method calls on unrelated receivers — 210 of those 216 files match `\.has\s*\(`. Only the receiver-unqualified form isolates the real symbol. I ran both and report the qualified/unqualified split above.

2. THIS REPO HAS THE COLLISION ON RECORD, ON THIS EXACT SYMBOL. `docs/evidence/m5-scale/PREREG-2026-09-06-does-the-trade-change-a-users-answer.md:78` documents `graph_callers("has")` returning 100 callers "that were nearly all `Map.has()`", and a later run returning 25 spurious rows at conf=0.90 with the overcount warning NOT firing. The doc's own conclusion is that the guard "is structurally incapable of firing on the case it was written for" — it triggers on many-symbols/few-results, while this is one-symbol/huge-fan-in. So if anyone answers this question with graph_callers, they will get a large number, no warning, and a 0.90 confidence stamp. Do not accept that number.

3. INSTRUMENT CONTROLS, run in the same session: positive — `classifyPublication` (known present) returned hits in 5+ files; negative — an invented `hasZzzNotARealSymbol` returned nothing, exit 1. The probe can say both PRESENT and ABSENT.

4. SCOPE LIMIT: I excluded `node_modules` and `.git` deliberately — the count is first-party source only. If your rename question is about a `has` on a published API surface or in a vendored dependency, that is a different symbol and this answer does not cover it. Say the word and I'll re-run against a stated scope.
```

### `ab-grep-2` — 2026-09-06T23:02:57.915Z

```
CALLER_COUNT: 10

RENAME_SAFE: YES

EVIDENCE: The only definition of a symbol named `has` in the repo is `mcp/stdio/query/verbs/collect_code_intel.js:131`, a function-local arrow `const has = (rel) => ...` declared inside `detectRepoLanguage` (lines 130-139); rg over *.js/*.mjs/*.ts for `function has`/`const|let|var has`/`has(...) {`/`has:` returned no other definition, and no PHP/CPP/PY/H definition exists. Counting invocations with a pcre2 probe `(?<![.\w$])has\s*\(` line by line gives 10 calls, all inside that 9-line body: line 133 (1), 135 (2), 136 (6), 137 (1) — the definition line itself contributes 0. The symbol is never exported (`export function has` / `export const has` / `export { has }` match nothing outside a test's string fixture) and the scope admits no dynamic or computed access, so a rename confined to lines 130-139 cannot be observed anywhere else.

The rename is safe ONLY as a scoped edit. A repo-wide find-replace on this name would be destructive: `\bhas\b` matches 1827 times in JS/MJS/TS, of which 561 are `.has(` — Map/Set/WeakMap builtin calls on unrelated receivers (`seen.has(` x52, `layers.has(` x24, `requestedOps.has(` x21, ...) that share the name and nothing else. Two further hits, `tests/unit/analysis/deleted-with-callers.test.js:162` and `:177`, are the text `-export function has() {}` inside a diff string fixture for a fictional `src/lib.js`; they are neither definitions nor callers, but a naive replace would corrupt the fixture.

CAVEATS_SEEN: My first look-behind probe returned an empty result set that I nearly reported as "no bare callers". It was a broken instrument, not a true zero — I had suppressed stderr. Re-run with stderr visible, ripgrep said verbatim:

"rg: regex parse error:
    (?:(?<![.\w$])has\s*\()
       ^^^^
error: look-around, including look-ahead and look-behind, is not supported

Consider enabling PCRE2 with the --pcre2 flag, which can handle backreferences
and look-around."

Re-run with --pcre2 it returned the 10 callers above. Flagging it because the false zero agreed with a plausible expectation and produced no collision to prompt a recheck. Controls run alongside every probe: positive control (`graph_index`, `existsSync` — both found), negative control (a nonexistent identifier — clean exit 1), so the instrument was demonstrated able to return both PRESENT and ABSENT.

Scope note: this is grep plus direct source reading, no code-intelligence tooling. That is sufficient here only because the symbol is function-local and unexported, which makes its scope closed and readable in full — the same method would NOT support a safe-rename claim for an exported symbol. No files were modified.
```

---

## What a reader should take from the raw text that the summary flattened

- **Four of four are correct**, and the two arm-B agents reached it with no graph, no warning and no
  tool. That is the fact that reframes the experiment, and it is visible here in one pass.
- **The arms disagree on the NOUN, not the structure.** `ab-graph-1` says 1 caller function;
  the other three say 10 call sites. All four describe the identical code. `graph_callers` reports
  caller FUNCTIONS, so `ab-graph-1` is the only one that answered in the verb's own currency — and
  the graded ground truth was written in the other noun.
- **`ab-grep-1` cited this repository's own earlier write-up of this exact symbol.** The task's answer
  was already committed here, so arm B's independence is compromised for that agent. I chose the
  task.
- **Both arm-A agents quote `absenceAuthority: false` and the staleness disclosure verbatim** —
  surfaces changed the previous day, observed doing their job by agents who knew nothing about that
  work.
- **Two agents independently caught false zeros in their own instruments** (`collectCodeIntel` vs
  `graphCollectCodeIntel`; a ripgrep look-behind needing `--pcre2` with stderr suppressed) and both
  reported it unprompted. Neither was asked to control anything. That failure mode is not
  idiosyncratic to whoever keeps writing it down here.
