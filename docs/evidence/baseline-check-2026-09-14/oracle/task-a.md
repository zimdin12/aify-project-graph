# Oracle, task A: add `undefined` to the handle placeholder set

Corpus: aify-comms @ 7678acf35964b8149e686f0d06431da074785303. Built before any route ran, by
exhaustive rg over the tree plus reading, then checked by MUTATION in a scratch clone
(oracle-work/mut-a) and by two probes. Raw outputs: oracle-work/a-*.txt.

## Required facts (R). A brief scores a fact only if it states it AND cites a location that supports it.

R1. Two mirrors must change together: `service/runtimes/base.py:27` (`HANDLE_PLACEHOLDERS`) and
    `mcp/stdio/adapters/base.js:8`. Each is used by its `normalize_session_handle` /
    `normalizeSessionHandle` (base.py:53-59, base.js:71-76).

R2. Exactly one existing test FAILS when both mirrors gain `undefined`:
    `service/tests/runtimes/test_base.py:127-129` `test_placeholder_sets` (exact-equality assert).
    Mutation evidence: oracle-work/a-mut-both.txt, `1 failed, 124 passed`.

R3. `service/tests/test_js_status_set_twins_are_frozen.py` binds the JS set to the Python set by
    equality (EXACT_TWINS entry at :114, assertion :265-282). Changing ONE side only fails it (plus
    the census test `test_no_new_javascript_file_starts_spelling_a_python_set_out`); changing both passes. Mutation evidence: a-mutpy-only.txt (3 failed) vs
    a-mut-both.txt (only R2 fails).

R4. The widened set does NOT close the symptom: some paths read a session handle without the shared
    normaliser, so the literal `undefined` still gets through. Any ONE of these, cited, scores R4:
    - `mcp/stdio/adapters/claude.js:66` `discoverSessionId` reads `CLAUDE_SESSION_ID` with trim only.
      PROBE (a-probe-claude.txt, mutated copy): `discoverSessionId` with env `undefined` returns
      `"undefined"` while `getCurrentSessionId` returns null. The session-handle heartbeat calls
      `discoverSessionId` FIRST (`mcp/stdio/session-handle-heartbeat.js:25-30`).
    - `mcp/stdio/adapters/claude.js:147` `_resolveTranscriptPath`, same raw read.
    - `mcp/stdio/adapters/hermes.js:99-101` explicit `AIFY_SESSION_HANDLE`, trim only.
    - `mcp/stdio/auto-registration.mjs:101-103` `AIFY_SESSION_HANDLE`, strips only `${...}`.
    - Server side `_sanitize_session_handle` (`service/routers/agents/shared.py:235-249`), used by
      `registration.py:166` and `session_handle.py:67`, strips only the `${VAR}` shape. PROBE
      (a-probe-server.txt): `'undefined' -> 'undefined'`, `'none' -> 'none'`.

## Credit facts (C). Count, but not required.

C1. Tests that iterate the constant and so extend automatically, not fail:
    `service/tests/test_runtime_adapter_contract.py:121-127`.
C2. Tests that hard-code the four and keep passing (no `undefined` case added):
    `service/tests/runtimes/test_base.py:52-56`, `mcp/stdio/tests/adapters/contract.test.js:37-47,55-62`.
C3. `service/tests/runtimes/test_hermes_session_discovery.py:193-206` states the gap in prose and is
    deliberately unasserted, so it keeps passing; its docstring goes stale with the change.
C4. Consumers whose behaviour changes: `mcp/stdio/register-helpers.js:15` (falls through to discovery
    instead of registering `undefined`), `session-handle-heartbeat.js:29`, `server.js:381`,
    `adapters/codex.js:64,155`, `adapters/hermes.js:38,105`, `service/runtimes/hermes.py:70`,
    `resumeArgs`/`resume_args`.
C5. Docs to update: `KNOWN_ISSUES.md:155-174` (the entry, "a reviewer's call"),
    `docs/FINDINGS_LEDGER_2026-08.md:117`; comment `mcp/stdio/tests/codex-rollout-path.test.js:173`.
C6. `test_runtime_adapter_contract.py:154-161`: the handle and model sets are deliberately different,
    so `undefined` added to HANDLE only does not break that test.
C7. The existing placeholder `none` already leaks through the same raw paths (probe: claude
    discover with `none` returns `"none"`; server sanitizer keeps `none`), so R4's gap predates this
    change.

## Forbidden claims (F). Any one, stated as fact, is a violation.

F1. The two mirrors currently differ, or only one side needs changing.
F2. Adding `undefined` fully closes the issue / every handle path goes through the normaliser.
F3. `test_hermes_session_discovery.py` will fail after the change.
F4. The service's register or PATCH path filters `HANDLE_PLACEHOLDERS`.
F5. No existing test fails after the change.
