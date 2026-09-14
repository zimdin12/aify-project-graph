# Change-impact brief: adding `"undefined"` to `HANDLE_PLACEHOLDERS` (aify-comms @ 7678acf3)

I ran nothing in this repo. Everything below comes from reading code. When I say a test "fails" or "passes", I predicted it from its source; I did not watch it happen.

**Bottom line:** the proposed change is small and cheap. It is not the fix for the symptom, though. Most of the paths that write a session handle never check this set, and that includes the server's own registration check.

## 1. What must change together

**The set itself (both copies must hold identical values):**
- `service/runtimes/base.py:27` holds `HANDLE_PLACEHOLDERS = {"unknown", "default", "none", "null"}`.
- `mcp/stdio/adapters/base.js:8` holds the same four in a `new Set([...])`.
- Add the value in lower case. Both sides lower-case the input before checking it (`base.py:57`, `base.js:74`), so `UNDEFINED` and `Undefined` will also be filtered.
- A test enforces that the two copies match (`service/tests/test_js_status_set_twins_are_frozen.py`, see §2). Changing only one side turns it red.

**A test that must be edited:**
- `service/tests/runtimes/test_base.py:128` asserts the exact four-member set.

**Comments, loops and records that go stale:**
- `service/tests/runtimes/test_hermes_session_discovery.py:193-205`. Its docstring says `undefined` is "NOT COVERED, and deliberately not asserted", and its loop checks only the four. Update both and add the new value.
- `service/tests/runtimes/test_base.py:54`: the placeholder loop lists four.
- `service/tests/test_runtime_adapter_contract.py:14-18`: the module docstring lists four.
- `mcp/stdio/tests/codex-rollout-path.test.js:173`: a comment says the check rejects "none/null/unknown/default".
- `KNOWN_ISSUES.md:155-171`: the entry itself (added in 6d8a00ac).
- `docs/FINDINGS_LEDGER_2026-08.md:117-118`: item 4.
- Older design documents still print the old set: `docs/superpowers/specs/2026-05-25-runtime-adapter-design.md:207`, `docs/superpowers/plans/2026-05-25-plan1-runtime-adapter-session-handle.md:208`, and `docs/superpowers/plans/2026-05-25-plan2-runtime-capabilities-and-pi-flip.md:188,297`. These are dated plans, so updating them is optional.

**Leave alone:**
- The model-name sets: `MODEL_PLACEHOLDERS` (`base.py:28`, `base.js:9`) and `PI_MODEL_PLACEHOLDER_VALUES` (`runtimes-pi.js:55`).
- A test keeps them deliberately different from the handle set (`test_runtime_adapter_contract.py:156-162`), and `undefined` goes in neither.

**Other copies:** I searched for further copies of the four values in `mcp/`, `service/`, `install.sh`, `scripts/` and `bin/`. It found exactly the five known lines (the two sets plus three test lines). A copy spelled some other way would be missed.

## 2. Tests

**Will FAIL:**
- `test_base.py::test_placeholder_sets` (lines 127-129) compares against the hard-coded four-member set.

**Will fail only if the two copies disagree** (they pass if both change identically):
- `test_js_status_set_twins_are_frozen.py::test_each_bound_twin_still_equals_its_python_owner` (lines 265-279) compares the JS set with the imported Python set.
- `::test_no_new_javascript_file_starts_spelling_a_python_set_out` (lines 300-308) matches JS sets to Python sets by exact value. A one-sided change drops the JS set from the match and it fails.
- No other Python constant holds the new five values, so the match stays unambiguous. That rests on the placeholder search above.
- No edit to the test file is needed: its expected-copies table is keyed by constant name (line 114).

**Keep passing, but should be updated:**
- `test_hermes_session_discovery.py:193-205`: its prose becomes false.
- `test_base.py:52-56` and `:59-65`: fixed lists, so they never exercise the new value.
- `test_runtime_adapter_contract.py:120-127` loops over `sorted(HANDLE_PLACEHOLDERS)`, so it picks up `undefined`, `UNDEFINED` and a padded spelling on its own. Only its docstring is stale.
- `mcp/stdio/tests/adapters/contract.test.js:55-62` and `codex-rollout-path.test.js:172-184` pass, with a stale comment in the second.

**Gap:** no JS test checks what the JS function actually does with `undefined`. The JS side is guarded only by the value-equality test above. Adding one assertion to `contract.test.js` would close that.

**Unaffected:**
- `mcp/stdio/tests/hermes-endpoint.test.js:173-180`. `isUsableSessionId` never reads the set.
- `test_validators_anchor_at_the_real_end.py:147-148` tests a different pattern, the `${...}` check.

**How far to trust this:** I searched test files for a quoted `"undefined"`. Many hits came back, none of them used as a session handle. The only nearby case, `runtimes-pi.test.js:212-217`, is about pi's session-state parser. A test that builds `undefined` at runtime through string interpolation would not show up in that search, so "nothing else fails" is **unverified** until the suite runs.

## 3. Does it close the symptom? No.

**What the change does close.** Only the paths that go through `normalizeSessionHandle`:
- JS `getCurrentSessionId` (`base.js:21-27`), used by:
  - `register-helpers.js:15` when no handle was passed in;
  - the heartbeat fallback (`session-handle-heartbeat.js:29`);
  - codex's app-server branch (`codex.js:62-64`);
  - the startup banner (`server.js:381`).
- The hermes env-variable loop (`hermes.js:104-107`).
- `resumeArgs` (`base.js:78-80`).

**Paths that still register or use a literal `undefined` after the change:**

1. **The server's own check ignores the set.**
   - Both `registration.py:166` and `PATCH /agents/{id}/session-handle` (`session_handle.py:62-67`) go through `_sanitize_session_handle` (`shared.py:235-249`).
   - That function only strips a `${VAR}` pattern (`tuning.py:41`), so the server stores `"undefined"` from any caller.
   - My search found `normalize_session_handle` called only inside `base.py` (lines 48 and 62), never in the registration path.
2. **An explicit `comms_register` handle** passes straight through: `registration-tool.mjs:150-152` and `173-178`, sent at `:201`. If the helper sees a non-empty value it returns early (`register-helpers.js:13-14`). The tool itself tells agents to pass `sessionHandle="$CODEX_THREAD_ID"` (`registration-tool.mjs:345`).
3. **`defaultSessionHandleForRuntime` reads the same session env variables with no filtering** (`runtimes.js:386-391`). It feeds `registration-tool.mjs:152` and `auto-registration.mjs:98`. This path already lets `none` and `null` through today.
   - I have not read the `RUNTIME_SESSION_ENV_VARS` table (`runtimes.js:115`), so it is **unverified** that it names exactly the variables the adapters use.
4. **`AIFY_SESSION_HANDLE` at auto-registration** only has `${...}` stripped (`auto-registration.mjs:95-98`).
5. **Adapter discovery returns values unchecked**, and its callers only trim them (`auto-registration.mjs:64-70`, `register-helpers.js:43-44`, heartbeat `:25-33`):
   - claude's `CLAUDE_SESSION_ID` (`claude.js:66-68`);
   - hermes's explicit `AIFY_SESSION_HANDLE` (`hermes.js:98-101`);
   - hermes's active-session file contents (`hermes.js:130-149`).
6. **Hermes marker file:** `isUsableSessionId` (`hermes-endpoint.js:280-282`) accepts `undefined`, because it matches `^[A-Za-z0-9_-]+$`. So `writeSessionIdMarker` saves it and `readSessionIdMarker` hands it back (`:284-307`). Both registration paths write it (`auto-registration.mjs:114-116`, `registration-tool.mjs:184-186`).
7. **Handles already stored stay stored.** The resume command uses the stored handle unfiltered (`resume_command.py:40-52`), as does `session_lease.py:157`.
8. **Deployment:** the bridge change does nothing until `install.sh` is re-run and every wrapper relaunches (`auto-registration.mjs:24`; the ledger calls it "deploy-coupled" at `FINDINGS_LEDGER_2026-08.md:118`).

**To actually close it** you would also need to change `_sanitize_session_handle` (server side), `defaultSessionHandleForRuntime`, `isUsableSessionId`, and the unchecked discovery returns. That is a wider change than the proposal.

## 4. Recorded constraints

- **`KNOWN_ISSUES.md:157-171`** marks the issue "Measured, not ruled on".
  - It says the two copies are identical, so this is "not a divergence to fix on one side".
  - It warns that widening the set "changes handle normalisation for every runtime on both sides of the mirror, which is a reviewer's call rather than a test-slice fix". Treat that as a sign-off question before landing.
  - It says the hermes test was written so that adding `undefined` would not fail it. That holds for that test, but `test_base.py:128` does fail.
- **`docs/FINDINGS_LEDGER_2026-08.md:117-118`** calls it "Small, self-contained, bridge-side (deploy-coupled)". Per §3, "self-contained" overstates it if the goal is the symptom.
- **`test_js_status_set_twins_are_frozen.py`** (docstring and lines 110-114) records the rule that the JS copy is frozen to the Python owner and must never go stale.
- **`DECISIONS.md:960`** (2026-05-25, RuntimeAdapter) records that the bridge fills `sessionHandle` from the adapter and sends it every 60s. It has no entry on the placeholder set: a case-insensitive search for "placeholder" or "undefined" found nothing, while a search for `normalizeSessionHandle` found this line, so the search works.
- **Is `undefined` ever a real id?** Two comments say real handles are UUIDs or timestamp-hash ids (`shared.py:243-244`, `hermes-endpoint.js:270-271`). I did not check any runtime's actual id format.
- **Precedent:** the June `${...}` fix (`KNOWN_ISSUES.md:494`, commit 122ec05) guarded the marker file, `resolve-session` and `server.js` registration, not just one set. A same-class fix for `undefined` would touch the same places.

OPS: 30