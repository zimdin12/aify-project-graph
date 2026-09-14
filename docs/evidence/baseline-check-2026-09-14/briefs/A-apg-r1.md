# Change-impact brief: adding `"undefined"` to `HANDLE_PLACEHOLDERS`

The one-line change is not enough on its own. It has to land identically in two files, it breaks one Python test, and it does not stop `"undefined"` being registered as a session handle. The worst gap is Claude: `CLAUDE_SESSION_ID`, one of the three variables the issue names, still gets through.

I ran no tests. Every pass or fail below comes from reading the assertions, so treat them as expected results, not observed ones.

## 1. What must change together

- **The two copies of the set.** `service/runtimes/base.py:27` and `mcp/stdio/adapters/base.js:8` both hold exactly `unknown, default, none, null`. Both must change the same way.
  - A frozen-twin test enforces this: `service/tests/test_js_status_set_twins_are_frozen.py:114` pairs the two, and `:265-279` asserts they are equal.
  - That test compares against the imported Python value (`:83`, `:101`), so it will not match a different spelling or casing on the JS side.
- **The one test that pins the old set.** `service/tests/runtimes/test_base.py:127-129` asserts `HANDLE_PLACEHOLDERS == {"unknown","default","none","null"}`. It has to be edited.
- **`MODEL_PLACEHOLDERS` stays as it is.** `test_runtime_adapter_contract.py:154-161` says the two sets are deliberately different. Adding `undefined` to the handle set alone does not affect those assertions.
- **The notes that describe the gap.**
  - `KNOWN_ISSUES.md:155-171`
  - `docs/FINDINGS_LEDGER_2026-08.md:117-118` (item 4)
  - The docstring at `service/tests/runtimes/test_hermes_session_discovery.py:197-202`, which says "NOT COVERED, and deliberately not asserted either way".
- **Deployment.** The ledger calls this "bridge-side (deploy-coupled)" (`FINDINGS_LEDGER:117-118`). Next to it, item 2 says a bridge fix needs `install.sh` **and** a wrapper relaunch (`:108-109`). How the bridge copy actually gets deployed is UNVERIFIED.
- **Anything beyond the set.** If the goal is to close the symptom, the paths in section 3 need edits too.

## 2. Tests

**Will fail after the change**

| Test | Why |
|---|---|
| `service/tests/runtimes/test_base.py:127-129` `test_placeholder_sets` | Exact equality against the four literals. |
| `test_js_status_set_twins_are_frozen.py` `test_each_bound_twin_still_equals_its_python_owner` (`:265-279`) | Only if the two files do not change identically. |
| Same file, `test_no_new_javascript_file_starts_spelling_a_python_set_out` (`:298-307`) | Only if one side changes: the census matches JS sets to Python sets by exact value (`:199-208`), so a mismatched JS set drops out and the comparison differs. |

If both sides change identically, both twin tests should pass. That assumes no other Python constant holds the same five values, which would make the match ambiguous (UNVERIFIED, unlikely).

**Keep passing, but should be updated** (each hardcodes the four values or describes the gap)

- `test_base.py:52-56` and `:59-65` use the literal list of four.
- `mcp/stdio/tests/adapters/contract.test.js:34-62` checks the four spellings. Its `normalizeSessionHandle(undefined)` at `:61` tests the JS value `undefined`, not the string `"undefined"`. This is the only JS placeholder test, and nothing in it is derived from the set, so it needs a new `"undefined"` case.
- `test_hermes_session_discovery.py:193-205`: the docstring says the gap is deliberately unasserted. Update it and add the assertion.
- `test_runtime_adapter_contract.py:14-17` (docstring) and `mcp/stdio/tests/codex-rollout-path.test.js:173` (comment) both list the four.

**Picks up the new value with no edit**

- `test_runtime_adapter_contract.py:121-127` loops over `sorted(HANDLE_PLACEHOLDERS)`, so it will start asserting `"undefined"` for every Python runtime.

**Unaffected, as far as I found**

- I searched the tests for any that treat `"undefined"` as a valid handle and found none. The search covered session env vars assigned `undefined` or `"undefined"`, `sessionHandle` near `"undefined"`, and `setenv(... "undefined")`. I checked the same pattern with a known hit (`contract.test.js:41`), so it can find matches.
- It was a pattern search, not exhaustive. A test that builds the string some other way would not show up.

## 3. Does it close the symptom?

**No.** The set is only used by `normalizeSessionHandle` / `normalize_session_handle`, which are called from `getCurrentSessionId`, `resumeArgs` (`base.js:21-28, 71-80`) and the Hermes env loop (`adapters/hermes.js:104-107`). These paths bypass it:

1. **Claude, the `CLAUDE_SESSION_ID` named in the issue.**
   - At registration, `register-helpers.js:15-16` calls `getCurrentSessionId()`, which will now return null for `"undefined"`. It then falls back to `adapter.discoverSessionId` (`:37-44`).
   - Claude's discovery reads the variable raw: `claude.js:63-64` does `String(env.CLAUDE_SESSION_ID || "").trim()`, with no normalisation. It is skipped only if a captured-store id exists (`:59-60`).
   - The heartbeat goes to discovery first (`session-handle-heartbeat.js:24-30`), then PATCHes the value.
   - Auto-registration also tries discovery first (`auto-registration.mjs:64-71`).
   - `DECISIONS.md:1086` says the Claude wrapper unsets `CLAUDE_SESSION_ID` when no transcript exists. Whether that still holds, and for launches that don't go through the wrapper, is UNVERIFIED.
2. **Hermes explicit resume.** `hermes.js:98-101` returns `AIFY_SESSION_HANDLE` raw when `AIFY_EXPLICIT_SESSION_HANDLE` is true.
3. **Hermes active-session file.** `hermes.js:127-158` returns the file's id or raw text without normalising it. `getCurrentSessionId` puts it ahead of the normalised env read (`:37-38`).
4. **Hermes session-id marker.**
   - `isUsableSessionId` (`hermes-endpoint.js:280-283`) accepts anything matching `^[A-Za-z0-9_-]+$`, which includes `undefined`. It guards both the marker write (`:288`) and the read (`:305`).
   - `hermes.js:108-112` returns the marker, so a marker already written as `undefined` survives the fix.
5. **`AIFY_SESSION_HANDLE` at auto-registration.** `auto-registration.mjs:101-103` strips only `${...}`, and that value is used whenever discovery comes back empty (`:64-71`).
6. **An explicit `comms_register(sessionHandle=...)`.**
   - `registration-tool.mjs:150-151` and `:177-178` pass the argument through untouched.
   - The server's `_sanitize_session_handle` (`service/routers/agents/shared.py:235-249`) only drops handles that match `^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\Z` (`service/api_core/tuning.py:41`). That pattern needs a `$`, so `undefined` is accepted.
   - The PATCH endpoint uses the same sanitiser (`routers/agents/session_handle.py:67`).
   - `registration.py:166` stores the sanitised value.
7. **Handles already stored stay stored.** Registration writes `session_handle = CASE WHEN ? != '' THEN ? ELSE session_handle END` (`agent_registration_writes.py:116`, `:148`; `agent_sessions.py:175`, `:192`). After the fix a normalised empty handle keeps the existing `undefined` rather than clearing it. A data cleanup would be a separate decision.
8. **The Python change does less than it appears.** Outside `service/runtimes/` I found no non-test code calling `discover_session_id`, and I found no `.resume_args(` caller in non-test service code. `get_current_session_id` is called only from `hermes.py:70`. Service-side registration does not use `HANDLE_PLACEHOLDERS` at all (see 6). Whether anything reaches these runtime methods some other way is UNVERIFIED.

**What it does close:** the plain env read in `getCurrentSessionId` for every adapter. That includes Codex's app-server path (`codex.js:61-64`) and the Hermes env loop (`hermes.js:104-107`). The Codex filesystem walk returns ids taken from filenames, so it is not exposed.

## 4. Recorded constraints

- **`KNOWN_ISSUES.md:167-171`:** "Widening the set changes handle normalisation for every runtime on both sides of the mirror, which is a reviewer's call rather than a test-slice fix." The entry is marked "Measured, not ruled on" (`:157`) and was recorded with commit `6d8a00ac`. Update or close it with the change.
- **`docs/FINDINGS_LEDGER_2026-08.md:117-118`:** item 4, "Small, self-contained, bridge-side (deploy-coupled)". Section 3 shows it is not self-contained if the goal is the symptom.
- **`KNOWN_ISSUES.md:494`, commit `122ec05`:** the earlier `${...}` poisoning fix guarded several layers (marker write, marker read, resolve-session, `server.js` register), not one set. `undefined` goes through the same layers.
- **`DECISIONS.md:960`:** records that the adapter owns `normalizeSessionHandle` and fills `sessionHandle` for `comms_register` and the 60s PATCH. **`DECISIONS.md:974`:** records that the Python `service/runtimes/` package mirrors the JS adapters.
- **The twin-test docstring and failure message** (`test_js_status_set_twins_are_frozen.py:257-261`) say to update the ledger along with the change, not to delete entries to get back to green.
- The planning docs under `docs/superpowers/` quote the old four-value set (for example `plans/2026-05-25-plan2-...md:188`, `:297`). They are historical plans. Whether they are meant to be kept current is UNVERIFIED.

OPS: 18