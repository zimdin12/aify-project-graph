# Change-impact brief: adding `"undefined"` to `HANDLE_PLACEHOLDERS`

The proposed change is necessary but does not close the symptom. The set is only consulted by `normalizeSessionHandle`. At least six paths register or persist a handle without calling it, including the Claude path that KNOWN_ISSUES names. The one server-side choke point, `_sanitize_session_handle`, strips only `$VAR` / `${VAR}` shapes, so it lets `"undefined"` through as well.

I did not run any tests. Every pass/fail prediction below comes from reading the code.

## 1. What must change together

**Required, or the suite goes red:**
- `service/runtimes/base.py:27`, the Python set.
- `mcp/stdio/adapters/base.js:8`, the JS set. `service/tests/test_js_status_set_twins_are_frozen.py:113-114` binds the JS set to the Python owner by exact value equality (`:258-271`). Editing only one side fails that gate (see §2).
- `service/tests/runtimes/test_base.py:127-129` pins the old four-member set literally.

**Should change with it (prose that will become false):**
- `KNOWN_ISSUES.md:155-171`, the entry itself.
- `service/tests/runtimes/test_hermes_session_discovery.py:194-202`: the docstring says `undefined` is "NOT COVERED".
- `service/tests/test_runtime_adapter_contract.py:14-17`: the docstring lists four placeholders.
- `mcp/stdio/tests/codex-rollout-path.test.js:173`: a comment lists none/null/unknown/default.
- `docs/FINDINGS_LEDGER_2026-08.md:117-118`, item 4.

**Behaviour note:** matching is case-insensitive after trimming (`base.py:55-57`, `base.js:72-74`). `Undefined` and `UNDEFINED` will be dropped too.

**Python effect is close to nil at runtime.** No service code outside `service/runtimes/` or the tests calls `get_current_session_id` or `discover_session_id` (rg, including the no-parenthesis form). `normalize_session_handle` and `resume_args` show no callers outside `base.py` and tests. The Python edit is required by the twin gate rather than by behaviour. That rests on rg, not a resolver, so dynamic dispatch under other names is not ruled out.

## 2. Tests

**Will fail:**
- `service/tests/runtimes/test_base.py:127` `test_placeholder_sets` asserts `== {"unknown","default","none","null"}`.

**Fail only if one side is edited without the other:**
- `test_js_status_set_twins_are_frozen.py` `test_each_bound_twin_still_equals_its_python_owner` (`:258-271`).
- The same file's `test_no_new_javascript_file_starts_spelling_a_python_set_out` (`:289-298`). The census matches JS sets to Python sets by value (`:200-209`), so a mismatched JS set drops out of the census.
- If both sides get the same five values, both tests should pass. A search for sets holding both `"none"` and `"null"` found only the two definitions and test literals, so no other constant collides with the new set.

**Keep passing, but worth updating:**
- `test_base.py:52-56` iterates a literal four-member list; add `undefined`.
- `test_hermes_session_discovery.py:193-205`: literal list plus the gap docstring.
- `test_runtime_adapter_contract.py:121-127` iterates the set itself, so it will cover `undefined` automatically. No edit needed.
- `mcp/stdio/tests/adapters/contract.test.js:55-62` tests `"unknown"`, `"Default"`, `null` and the value `undefined`, never the string. After the change no JS behavioural test would cover the string `"undefined"`; only the Python twin gate reads the JS source.

**Unaffected (they test other functions or sets):**
- `mcp/stdio/tests/hermes-endpoint.test.js:173-181` (`isUsableSessionId`).
- `test_validators_anchor_at_the_real_end.py:147-148` (`_SHELL_PLACEHOLDER_HANDLE_RE`).
- `mcp/stdio/tests/runtimes-pi.test.js:212-217`.
- `test_runtime_adapter_contract.py:156-162` (the two sets must differ; they still will).

No test asserts that the string `"undefined"` survives normalisation. I searched the tests, runtimes and adapters directories for the quoted string. The same search did find unrelated `"undefined"` literals, so it was able to return results.

## 3. Does it close the symptom?

No. After the change, a literal `"undefined"` can still be registered through these paths:

1. **Claude discovery reads `CLAUDE_SESSION_ID` without normalising it.** `mcp/stdio/adapters/claude.js:66-67` does `String(env.CLAUDE_SESSION_ID || "").trim()` and returns it. That result reaches the server three ways:
   - The heartbeat calls discovery first (`session-handle-heartbeat.js:25-29`) and PATCHes the result (`:32`).
   - Auto-registration's `computeInitialSessionHandle` (`auto-registration.mjs:64-70`) takes it directly.
   - The `comms_register` discovery fallback (`register-helpers.js:36-42`) takes it when `getCurrentSessionId` returns nothing, which is exactly what the fix makes it return.

   Result: for Claude, the fix moves `"undefined"` from the env path onto the discovery path. It does not stop it. (KNOWN_ISSUES says the value "passes normalisation"; on this path there is no normalisation to pass.)
2. **Hermes explicit resume.** `adapters/hermes.js:98-101` returns `AIFY_SESSION_HANDLE` trimmed, not normalised.
3. **Hermes active-session file.** Its contents are read raw (`hermes.js:123-137`) and win first, both in `getCurrentSessionId` (`:37-39`) and in discovery (`:87-88`). I did not read how the JSON field value is checked beyond `:137`.
4. **Hermes marker.** `isUsableSessionId` (`hermes-endpoint.js:280-283`) accepts anything matching `^[A-Za-z0-9_-]+$`, which includes `undefined`. `writeSessionIdMarker` (`:288`) will persist it and `readSessionIdMarker` (`:305`) will return it. Auto-registration writes the marker for hermes (`auto-registration.mjs:116-117`).
5. **Auto-registration env fallback.** `AIFY_SESSION_HANDLE` is stripped only if it contains `${...}` (`auto-registration.mjs:99-101`). When discovery returns nothing, `"undefined"` becomes the registered handle (`:70`, `:112`).
6. **An explicit `comms_register` `sessionHandle`.** `register-helpers.js:13-14` returns early when an argument is present (wired at `registration-tool.mjs:99`).
7. **Server side.** Every path above ends at `_sanitize_session_handle` (`service/routers/agents/shared.py:235-249`), called from `registration.py:166` and `session_handle.py:67`. It drops only handles matching `^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\Z` (`service/api_core/tuning.py:41`).

**Paths the fix does close:**
- The base `getCurrentSessionId` for any runtime (`base.js:21-28`).
- The hermes discovery env loop (`hermes.js:104-107`).
- Codex `_resolveRolloutPath` and the codex app-server discovery branch, both of which go through `getCurrentSessionId` (`codex.js:62-64`, `:154-156`).

**Better single point:** extending `_sanitize_session_handle` would cover every bridge-to-server path in 1-7. It would not cover the local hermes marker (path 4). I did not check whether anything else writes `agents.session_handle`; UNVERIFIED.

**Wrapper scripts:** I did not find or read the shell wrappers, so whether they already unset `CLAUDE_SESSION_ID=undefined` is UNVERIFIED. `DECISIONS.md:1086` says the Claude wrapper unsets `$CLAUDE_SESSION_ID` when no matching transcript exists, which would catch `undefined`, but that is the doc's claim, not code I read.

## 4. Recorded constraints

- **`KNOWN_ISSUES.md:169-171`:** widening the set "changes handle normalisation for every runtime on both sides of the mirror, which is a reviewer's call". It was deliberately left unasserted.
- **`docs/FINDINGS_LEDGER_2026-08.md:117-118`:** classes the fix as "bridge-side (deploy-coupled)". Item 2 (`:109-111`) says a bridge fix needs `install.sh` plus a wrapper relaunch. Plan the rollout accordingly.
- **`test_js_status_set_twins_are_frozen.py:25-29, 113-117`:** the JS file is a direct port, and both copies must move together.
- **`KNOWN_ISSUES.md:494`:** records the precedent: the `${...}` placeholder poison guard (`122ec05`) was applied at several boundaries (marker write/read, resolve-session, server register), not at one set. Treat `undefined` as the same class and cover the same boundaries.
- **`DECISIONS.md`:** no entry on handle placeholders; a case-insensitive search for "placeholder" returned nothing. `:960` records that the bridge fills `sessionHandle` and PATCHes it on a heartbeat. `:1086` is the wrapper claim above.
- **Old design docs:** `docs/superpowers/specs|plans/2026-05-25-*` hold historical copies of the four-member set. They are dated design records; I would not edit them.

OPS: 24 tool calls. Several chained more than one read, 54 individual commands in total, which is over the 40 budget if each command counts separately.