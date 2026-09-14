# Change-impact brief: adding `"undefined"` to `HANDLE_PLACEHOLDERS`

Adding the string only closes the one path that goes through `normalizeSessionHandle`. Most paths that register or store a session handle skip that function. On those paths the literal `undefined` still gets through after the change, and so does `none`, which is already in the set. The only step every stored handle passes through is on the server, and it does not use this set at all.

I did not run any test. Every test prediction below comes from reading the assertion, not from watching it fail or pass.

## 1. What must change together

- **JS set:** `mcp/stdio/adapters/base.js:8`.
- **Python set:** `service/runtimes/base.py:27`.
  - The two must hold identical values. `service/tests/test_js_status_set_twins_are_frozen.py:114` ties the JS set to the Python constant, and the check at `:269-282` compares them value for value.
- **The pinned Python test** that spells out the four values (see section 2).
- **Stale prose that names the gap or the four values:**
  - `KNOWN_ISSUES.md:155-171`
  - `docs/FINDINGS_LEDGER_2026-08.md:117-118`
  - the docstring at `service/tests/runtimes/test_hermes_session_discovery.py:194-202`
  - the comment at `mcp/stdio/tests/codex-rollout-path.test.js:173`
- **Not required, but you have to decide:** the server-side filter `_sanitize_session_handle` (`service/routers/agents/shared.py:235-249`). It uses its own regex, `^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\Z` (`service/api_core/tuning.py:41`), not the set. It is what cleans handles on registration (`service/routers/agents/registration.py:166`) and on the session-handle PATCH (`service/routers/agents/session_handle.py:67`). See section 3 for why this matters.
- Historical plan and spec docs also contain the old four-value set, for example `docs/superpowers/plans/2026-05-25-plan2-runtime-capabilities-and-pi-flip.md:188,297`. They are historical records, so updating them is optional.

## 2. Tests

**Will fail:**
- `service/tests/runtimes/test_base.py:128` asserts `HANDLE_PLACEHOLDERS == {"unknown","default","none","null"}` exactly. This is the only existing test that goes red if both sides change together.
- `test_each_bound_twin_still_equals_its_python_owner` (`test_js_status_set_twins_are_frozen.py:269-282`) fails only if you change one side and not the other. If both sides get the same five values, it passes.
  - The census test (`:299-307`) should also stay green. Its matching (`:201-210`) is by exact values, and the grep showed `HANDLE_PLACEHOLDERS` declared only in `base.py` under `service/`. That is one grep, not an exhaustive check.

**Keep passing, but should be updated:**
- `test_hermes_session_discovery.py:193-205`. Its docstring says `undefined` is "NOT COVERED… deliberately not asserted", and its loop lists only the four current values. It keeps passing, but the prose becomes false. Add `undefined` to the loop.
- `mcp/stdio/tests/adapters/contract.test.js:55-62` checks literal values only. Line 61 passes the JS value `undefined`, which the `raw == null` branch at `base.js:72` already handles; it never passes the string `"undefined"`. Without a new assertion, **no JS test covers the JS half.** The only thing that would catch a reverted JS edit is the Python twin test.
- `codex-rollout-path.test.js:172-183`: only its comment is stale.

**Unaffected:**
- `service/tests/test_runtime_adapter_contract.py:121-127` loops over `sorted(HANDLE_PLACEHOLDERS)`, so it picks up `undefined` automatically.
- `:155-161` checks that `auto` is not a handle placeholder and `null` is not a model placeholder. The new value touches neither.
- `test_base.py:52-56` uses a literal loop over the four values.
- I searched test files for a quoted `"undefined"`. The `"none"` search in the same run did find `contract.test.js` and `test_base.py`, so the search works. No hit uses `undefined` as a session handle; the nearest is `runtimes-pi.test.js:212-213`, which tests a different function.

## 3. Does it close the symptom? No

These paths still carry the literal `undefined` into a registered or stored handle. I traced each by reading the code; none was run.

1. **Env vars read raw on registration (all runtimes).**
   - `defaultSessionHandleForRuntime` (`mcp/stdio/runtimes.js:386-392`) reads `CLAUDE_SESSION_ID`, `CODEX_THREAD_ID`, `HERMES_SESSION_ID` and the other session env vars (`:106-112`) with only `trim()`.
   - It feeds `comms_register` (`registration-tool.mjs:150-153`, `:174-177`, `:201`) and auto-registration (`auto-registration.mjs:103`, fallback at `:71`).
   - The same path lets `none` and `null` through today.
2. **Claude discovery.** `discoverSessionId` step (b) returns raw `CLAUDE_SESSION_ID` (`adapters/claude.js:66-67`). It is reached from:
   - the heartbeat, which discovers first and PATCHes every tick (`session-handle-heartbeat.js:25-34`);
   - auto-registration (`auto-registration.mjs:65-68`);
   - the `comms_register` fallback (`register-helpers.js:15-16`, `:37-43`). After the fix, the env read returns empty for `undefined`, and discovery then hands the raw value back.
3. **`AIFY_SESSION_HANDLE`.**
   - Auto-registration strips only `${...}` (`auto-registration.mjs:101-102`).
   - The Hermes explicit-resume path returns it untouched (`adapters/hermes.js:98-102`).
4. **The `sessionHandle` argument an agent passes to `comms_register`** is used as given (`registration-tool.mjs:94`, `:151`, `:174`). The server's regex only matches `$VAR` and `${VAR}` shapes (`tuning.py:41`). So every client, including the heartbeat PATCH, can store `undefined`.
5. **Hermes files.**
   - The active-session file is returned raw (`adapters/hermes.js:124-149`); the Python mirror does the same (`service/runtimes/hermes.py:67-69`).
   - `isUsableSessionId` (`hermes-endpoint.js:280-283`) accepts `undefined`, because it only requires letters, digits, `_` and `-`.
   - Registration writes the marker (`auto-registration.mjs:119-120`, `registration-tool.mjs:186-187`), and the next launch reads it back (`adapters/hermes.js:108-111`). So a poisoned value persists across launches.

**Closed by the change:** only env reads that go through `getCurrentSessionId` or `normalizeSessionHandle`. That is `register-helpers.js:15`, the heartbeat fallback, codex discovery when an app server is set (`codex.js:63-64`), the Hermes env step (`hermes.js:104-106`) and Python `hermes.py:70`.

**Where a complete fix would go:** `_sanitize_session_handle` covers both places a handle gets stored, and `isUsableSessionId` covers the Hermes marker. Neither uses the set. Whether to put the fix there is a design call for you.

## 4. Recorded constraints

- **`KNOWN_ISSUES.md:157-171`:** "Widening the set changes handle normalisation for every runtime on both sides of the mirror, which is a reviewer's call." A reviewer's sign-off is recorded as required, and the entry should be updated or resolved as part of the change.
- **`KNOWN_ISSUES.md` rejects line-number pointers.** It is gated by `service/tests/test_docs_name_symbols_not_line_numbers.py:109-122`, which fails on `file.py:NN`-style pointers. Name symbols, not lines, when you rewrite the entry.
- **`docs/FINDINGS_LEDGER_2026-08.md:117-118`** calls this "bridge-side (deploy-coupled)".
  - `CLAUDE.md:57` and `CLAUDE.md:106`: editing `mcp/stdio/` needs `install.sh` re-run and the client wrapper restarted; editing `service/` needs a container rebuild.
  - `CLAUDE.md:180`: doctor's `bridge-installed` check flags a bridge edit that was never reinstalled.
- **`DECISIONS.md:1073`** and **`register-helpers.js:24-29`** record the deliberate order: discover first in the heartbeat, env first at registration. The comment says "a test pins this". That order is why discovery values, which the set never filters, reach storage.
- **`test_runtime_adapter_contract.py:155-161`:** the handle and model placeholder sets are deliberately different. Do not copy `undefined` into `MODEL_PLACEHOLDERS`, or its pi twin `PI_MODEL_PLACEHOLDER_VALUES`, without deciding that separately.

Coverage gaps: I did not read callers of `_readActiveSessionFile` beyond the two in `hermes.js`, the dashboard's session-handle writers, or `service/runtimes/hermes.py` past line 80. No list of paths here should be read as complete.

OPS: 32