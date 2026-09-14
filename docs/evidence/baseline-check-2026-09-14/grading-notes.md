# Grading notes (working file; RESULTS.md is written from this)

## Task A, run 1

| | A-baseline r1 (30 ops, all shell/Read) | A-apg r1 (18 ops, all shell, 0 APG) |
|---|---|---|
| R1 mirrors | yes base.py:27, base.js:8 | yes |
| R2 test_base.py:127-129 fails | yes (:127-129) | yes |
| R3 twin test, one-side fails | yes :265-279, census :300-308 | yes :114, :265-279, :298-307 |
| R4 still leaks | yes: shared.py:235-249 server sanitizer; claude.js:66-68; hermes.js:98-101; auto-registration :95-98 | yes: claude.js:63-64 (actual :66, off by 2); hermes.js:98-101; auto-registration :101-103; shared.py:235-249 |
| C1 iterating test | yes :120-127 | yes :121-127 |
| C2 hard-coded four | yes | yes |
| C3 hermes docstring | yes | yes |
| C4 consumers | yes (register-helpers, heartbeat, codex, server.js:381, resumeArgs) | yes (minus server.js) |
| C5 docs | yes | yes |
| C6 sets differ deliberately | yes | yes |
| C7 none already leaks | yes (defaultSessionHandleForRuntime "already lets none and null through") | no |
| F1-F5 | none | none |

Extras checked against source (both correct unless noted):
- `mcp/stdio/runtimes.js:386-391` `defaultSessionHandleForRuntime` reads the session env vars raw, used as
  `initialSessionHandle` at `registration-tool.mjs:150-153`: a comms_register bypass. BASELINE ONLY.
  CORRECT, and MISSING FROM MY ORACLE.
- `hermes-endpoint.js:280-283` `isUsableSessionId` accepts `undefined`; marker write/read guarded only by
  it. BOTH. CORRECT, missing from oracle.
- `CASE WHEN ? != '' THEN ? ELSE session_handle END` (agent_registration_writes.py:116,148;
  agent_sessions.py:175): an empty normalised handle keeps an existing stored `undefined`. APG-route
  cites it; baseline says "handles already stored stay stored" citing resume_command.py. CORRECT.
- `auto-registration.mjs:64-71` discovery first. BOTH. CORRECT.
- `registration-tool.mjs:345` "tells agents to pass sessionHandle=$CODEX_THREAD_ID": it is a hint in a
  codex-specific message, not general instruction. Baseline, slightly overstated, not wrong.
- A-apg: contract.test.js:61 tests the JS value undefined, not the string. CORRECT.

## Task A, run 2

A-baseline r2 (30 tool calls, all shell/Read; self-reported 32): R1 yes, R2 yes (:128), R3 yes (:114, :269-282), R4 yes
(runtimes.js:386-392 defaultSessionHandleForRuntime, claude.js:66-67, hermes.js:98-102, shared.py sanitizer, isUsableSessionId).
C1 yes, C2 yes, C3 yes, C4 yes, C5 yes, C6 yes, C7 yes ("so does none"). F none.
Extra, verified CORRECT: KNOWN_ISSUES.md is gated against line-number pointers
(service/tests/test_docs_name_symbols_not_line_numbers.py, gated set includes KNOWN_ISSUES.md) - relevant to rewriting the entry.

A-apg r2 (24 calls, all shell, 0 APG): R1 yes, R2 yes (:127), R3 yes (twin lines cited :258-271, actual :265-282, near),
R4 yes (claude.js:66-67, hermes.js:98-101, auto-registration :99-101, shared.py:235-249, isUsableSessionId).
C1 yes, C2 yes, C3 yes, C4 yes, C5 yes, C6 yes, C7 no. F none. Misses defaultSessionHandleForRuntime.
Extra: "Python edit has near-nil runtime effect: no service caller of the runtime methods outside service/runtimes" - rg confirms
(only base.py, claude/codex/hermes.py definitions and hermes.py:70). CORRECT as far as rg sees.

## Task B, runs 1 and 2 (all four hit R1-R5; no forbidden claims)

| | B-base r1 (28) | B-apg r1 (28; 1 LSP) | B-base r2 (24) | B-apg r2 (21; 1 APG) |
|---|---|---|---|---|
| R1 service overlay + aify-env merge | yes | yes | yes | yes |
| R2 terminalChildEnv orphaned, 779099d7 | yes | yes (+LSP refs) | yes (+ac6d6e82) | yes |
| R3 overlay can't remove; CLAUDE_CODE_CHILD_SESSION absent | yes (generic "" falls through) | yes, + AIFY_COMMS_AGENT_ROLE alias | yes, + alias | yes, + alias |
| R4 repo alone cannot close | yes | yes | yes | yes |
| R5 DENYLIST DELIBERATELY | yes | yes | yes | yes |
| C1 tests | yes (+plugin test, spawn test) | yes | yes, + agreement test only compares AIFY_ names so strip was invisible to it | yes |
| C2 b809fcc8/spawn_env | yes | yes | yes | yes |
| C3 raw spreads | yes | yes | yes | yes |
| C5 PHASE8/HARNESS docs | HARNESS | HARNESS | - | HARNESS |

Extras checked (all CORRECT):
- HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:178-188: aify-wrapper fix for the child-session marker; spawn-path strip does nothing for resident launchers. (base r1, apg r1, apg r2)
- A spawn can set CLAUDE_CODE_CHILD_SESSION via envVars: spawn_env.py refuses only the AIFY_ prefix. (apg r1)
- DECISIONS.md:718 / README.md:372 still call terminal-env.js the env builder. (apg r1, base r2)
- test_the_env_plugin_can_run_what_the_launch_answers.py drives aify-env's real plugin with colliding baseEnv; skips without checkout. (all four)
- entry 05753886 07:50 vs child-env-hygiene ff0ac8f5 08:31, 41 min later (base r1, base r2) - git facts, not re-run by me: UNVERIFIED by grader.
- B-apg r2's one APG call: graph_callers terminalChildEnv -> "NO CALLERS in 1646 indexed files", with a not-exhaustive caveat,
  while terminal-env.test.js and every-identity-source-is-neutralised.test.js call it (module-level). WRONG ZERO, caveated; runner
  ignored it and used rg. Not a forbidden claim; not a gain. Output also carried ~2.3KB of stale-server warning (twice) before the answer,
  caused by my docs-only commits, which it itself labels behaviourally current.

## Operations (registered measure = tool calls)
A: baseline 30, 30 (mean 30); APG 18, 24 (mean 21) -> 30% fewer, literally meets criterion 2.
B: baseline 28, 24 (26); APG 28, 21 (24.5) -> 6% fewer.
Program invocations inside those calls (commands.mjs, heuristic): A baseline 53, 59 (56) vs APG 52, 57 (54.5) -> 3%.
B baseline 69, 57 (63) vs APG 60, 49 (54.5) -> 13%. The call-count gap on A is chaining, and neither A-APG run called APG.
