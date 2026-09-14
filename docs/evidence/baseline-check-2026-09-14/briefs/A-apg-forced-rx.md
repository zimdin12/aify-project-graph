# Change-impact brief: adding `"undefined"` to `HANDLE_PLACEHOLDERS` (aify-comms @ 7678acf3)

**Bottom line:** the change is small and needs edits on both sides of the mirror. It does **not** close the symptom. Several registration paths never pass through `HANDLE_PLACEHOLDERS`. That includes the service's own register and PATCH routes, which use a separate regex that lets `undefined` through.

**Tool state:** APG `graph_health` reported the graph at commit 7678acf3 (current), trust `weak`, and no code-intel collection, so its caller sets are heuristic. APG's MCP server was running an older build, but the tool said the difference is 2 non-code files and does not change its answers. No tests were run. Every pass/fail prediction below comes from reading the code.

---

## 1. What must change together

**Code (both mirrors, same value):**
- `service/runtimes/base.py:27`: `HANDLE_PLACEHOLDERS = {"unknown", "default", "none", "null"}`. Read by `normalize_session_handle` at `:53-59`.
- `mcp/stdio/adapters/base.js:8`: the same set. Read by `normalizeSessionHandle` at `:71-76`.
- These two must stay identical. `service/tests/test_js_status_set_twins_are_frozen.py` binds the JS copy to the Python owner: `EXACT_TWINS` entry at `:114`, and the Python owner is imported at `:83` and `:101`. Changing one side alone turns that test red (section 2).
- No subclass overrides either method. The only definitions `rg` found are in the two base files. [APG] The live language server found JS callers only at `base.js:24`, `base.js:79` and `hermes.js:105`. It marked that set as not exhaustive, and it matches `rg`.

**Tests and prose that record the current value:**
- `service/tests/runtimes/test_base.py:128`: asserts the exact four-member set.
- `service/tests/runtimes/test_hermes_session_discovery.py:193-205`: the docstring says `undefined` is "NOT COVERED, and deliberately not asserted". It should gain an `undefined` case.
- `mcp/stdio/tests/codex-rollout-path.test.js:173`: a comment lists the four rejected values.
- `KNOWN_ISSUES.md:155-171`: the entry itself.
- `docs/FINDINGS_LEDGER_2026-08.md:117-118`: item 4.

**No edit needed:** the `EXACT_TWINS` ledger is keyed by constant name. The JS parser's string pattern (`[A-Za-z0-9_.:-]+`) reads `undefined` like any other value.

**Historical plans that quote the four-member set** (edit or leave as history, your call):
- `docs/superpowers/specs/2026-05-25-runtime-adapter-design.md:207`
- `docs/superpowers/plans/2026-05-25-plan1-runtime-adapter-session-handle.md:208`
- `docs/superpowers/plans/2026-05-25-plan2-runtime-capabilities-and-pi-flip.md:297`

## 2. Tests

**Will FAIL after a correct two-sided change:**
- `service/tests/runtimes/test_base.py:127-129`, `test_placeholder_sets`. It uses `assertEqual` against a literal four-member set.

**Will FAIL only if one side changes** (and pass if both change identically):
- `test_js_status_set_twins_are_frozen.py`, `test_each_bound_twin_still_equals_its_python_owner`. It compares the parsed JS set with `OWNERS["HANDLE_PLACEHOLDERS"]`.
- `test_js_status_set_twins_are_frozen.py`, `test_no_new_javascript_file_starts_spelling_a_python_set_out`. `_census` (`:200-210`) matches sets by value, so a JS set with no Python equal drops out of the census.
- There is no ambiguous-owner risk. My scan of quoted `"undefined"` literals under `service/` found no Python constant containing it.

**Keep passing but should be updated:**
- `service/tests/test_runtime_adapter_contract.py:121-127` [APG] loops over `sorted(HANDLE_PLACEHOLDERS)`. It will pick up `undefined` automatically, so its coverage widens with no edit.
- `test_hermes_session_discovery.py:193-205`: it stays green because its loop at `:203` is literal, but the docstring becomes false.
- `codex-rollout-path.test.js:171-183`: green, comment stale.
- `test_base.py:52-56` and `:59-65`: literal lists. Green, but they don't cover the new value.
- `mcp/stdio/tests/adapters/contract.test.js:34-61`: literal cases, green. Warning: `:61` passes the JavaScript *value* `undefined`, not the string. It already normalises to `""` because of `base.js:72`, so it is not a test of this change.

**Unaffected:**
- `service/tests/test_api_v2_regressions.py:14169-14195` [APG]. These go through `_sanitize_session_handle` (the regex), not the set.
- `mcp/stdio/tests/hermes-endpoint.test.js:173-180`. `isUsableSessionId` is separate code.
- `mcp/stdio/tests/runtimes-pi.test.js:211-216`. Pi extraction.
- `service/tests/test_runtime_adapter_consistency.py`. `rg` for placeholder or normaliz in it (and in `dump-capabilities.mjs`) returned no matches (rc=1), so it doesn't check the sets.

**How I know no test depends on `undefined` surviving:** a scan for quoted `undefined` literals across `mcp`, `service` and `scripts` found no test that passes it as a handle. The scan did find the known docstring at `test_hermes_session_discovery.py:197`, so it was working. It cannot see handles built at runtime.

**UNVERIFIED:** `service/tests/runtimes/test_discover_session_id.py` [APG listed it as an adjacent test]. I did not read it.

## 3. Does it close the symptom? No

The change closes only the env-var path through `getCurrentSessionId` (`base.js:21-28`) and the hermes env loop (`hermes.js:104-107`). The literal string `undefined` can still be registered or used by these paths:

1. **Claude discovery, `CLAUDE_SESSION_ID`.** `adapters/claude.js:66` does `String(env.CLAUDE_SESSION_ID || "").trim()` and returns it with no normalisation. Consumers:
   - Auto-registration runs discovery first (`auto-registration.mjs:65-68`).
   - The registration fallback uses the discovered value with only a trim (`register-helpers.js:38-44`).
   - The heartbeat also runs discovery first (`session-handle-heartbeat.js:26`) and PATCHes the result at `:33`. It is wired at `server.js:171-177`.
   - `claude.js:147` builds a transcript path from the same raw value.

   This names one of the three env vars in the KNOWN_ISSUES entry, so the fix misses part of its own stated symptom.
   UNVERIFIED: whether `CLAUDE_SESSION_ID` is also in claude's `sessionEnvVars`.
2. **Hermes explicit resume.** `hermes.js:98-101` returns `AIFY_SESSION_HANDLE` with only a trim.
3. **Hermes active-session file.** `hermes.js:123-149` returns the file's JSON id or raw contents without normalising.
4. **Hermes marker file.** `isUsableSessionId` (`hermes-endpoint.js:280-283`) accepts `undefined`, because it matches `^[A-Za-z0-9_-]+$`.
   - It gets written by `writeSessionIdMarker` (`:284-288`), called from `registration-tool.mjs:184-186` and from `auto-registration.mjs:118-120`.
   - It is read back by `readSessionIdMarker` (`:296-305`) and returned by hermes discovery. A marker poisoned before the fix stays poisoned.
5. **Auto-register env fallback.** `auto-registration.mjs:100-103` strips only `${...}` from `AIFY_SESSION_HANDLE`, then uses it when discovery returns nothing.
6. **Explicit `comms_register` argument.**
   - `register-helpers.js:13-14` returns the args unchanged when `sessionHandle` is non-empty.
   - `registration-tool.mjs:150-151` and `:173-174` use it verbatim, and `:201` sends it.
7. **The service accepts it from any client.**
   - Register (`routers/agents/registration.py:166`) and PATCH (`routers/agents/session_handle.py:67`) both call `_sanitize_session_handle` (`routers/agents/shared.py:235-249`).
   - That function only rejects the regex `^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\Z` (`api_core/tuning.py:41`).
   - The Python set has no production caller on this path: `normalize_session_handle`, `resume_args` and `discover_session_id` have no callers outside `service/runtimes` and the tests (`rg`).
   - So the Python half of the change does not affect what the service stores. A bridge not yet relaunched, a direct API call or an operator "Set handle" can still store `undefined`.
8. **Rows already stored.** There is no cleanup step. `service/runtimes/claude.py:31-32` puts the handle straight into the command, giving `claude-aify --resume undefined`.
9. **Deploy coupling.** The ledger calls this "bridge-side (deploy-coupled)" (`FINDINGS_LEDGER_2026-08.md:117-118`). Running bridges keep the old `base.js` until relaunched. UNVERIFIED: how `install.sh` delivers `adapters/`.

If the goal is to close the symptom, the one point every client passes through is the server's `_sanitize_session_handle`. The discovery paths (1-3) and `isUsableSessionId` (4) would also need to reject `undefined`. Where the fix goes is a design decision; the evidence above only shows that fixing the set alone is not enough.

## 4. Recorded constraints

- **The entry is explicitly a reviewer's call.** `KNOWN_ISSUES.md:168-171` says "Left unfixed and deliberately unasserted", and that widening the set "changes handle normalisation for every runtime on both sides of the mirror". `:158-160` says both mirrors must move together. The entry should be resolved or rewritten with the change.
- **The ledger's description is wrong.** `docs/FINDINGS_LEDGER_2026-08.md:117-118` calls it "Small, self-contained". Section 3 shows it isn't; update that item.
- **The copies can only be frozen, not imported.** `test_js_status_set_twins_are_frozen.py:1-60` records that neither the dashboard nor the bridge can import Python. Keeping the two copies identical by hand is the design.
- **Handle and model placeholders are deliberately different sets.** `test_runtime_adapter_contract.py:154-161` asserts this. Add `undefined` to `HANDLE_PLACEHOLDERS` only; `MODEL_PLACEHOLDERS` has its own JS copies, including `runtimes-pi.js` `PI_MODEL_PLACEHOLDER_VALUES` (ledger at `twins:120`).
- **The adapter decision.** `DECISIONS.md:958-970` [APG listed DECISIONS.md] records `normalizeSessionHandle` feeding `comms_register` and the 60-second PATCH. `DECISIONS.md:974` says cross-language consistency is enforced by `test_runtime_adapter_consistency.py`, which does not check the placeholder sets (section 2).
- **Precedent.** `KNOWN_ISSUES.md:494` (resolved 2026-06-04, `122ec05`) fixed `${...}` placeholder handles at the marker write, the marker read, `resolve-session` and `server.js` register. That fix spanned several layers; a set-only change for `undefined` would be single-layer by comparison.
- **Also mentioning the method** [APG `documents_mentioning`], not read by me: the 2026-05-25 plan1, plan2 and plan3 plans, the plan4 and plan6 plans, and `docs/V063_ACCEPTANCE_LEDGER.md`.

**What APG missed:** `graph_consequences` did not surface the service's `_sanitize_session_handle` path, the JS tests, the discovery paths that skip normalisation, or `test_hermes_session_discovery.py` as adjacent. All of those came from `rg` and reading the source.

OPS: 29