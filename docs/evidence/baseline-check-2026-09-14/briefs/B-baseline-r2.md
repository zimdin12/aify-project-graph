# Brief: what a managed worker may inherit (aify-comms @ 7678acf3)

The main point first: **the `KNOWN_ISSUES.md` entry describes a code path that is no longer in production.** It names `terminalChildEnv` as the composer (KNOWN_ISSUES.md:129). That function lost its only production caller in commit 779099d7 on 2026-09-04. The worker environment is now built in two halves. The service builds a small overlay, and aify-env, a separate repo, merges it over its own environment. The stripping the entry asks you to extend runs only in tests today.

## 1. Where a managed worker's environment is built

**Live path:**
1. **Service route `GET /terminals/{id}/launch`** (service/routers/terminals.py:211-302). It reads the `terminal_sessions` row, five fields of the `agents` row (243-267), and the spawn spec's `env_vars` (272-275). It returns `launch.env = managed_launch_env(...)` (293-300).
2. **`managed_launch_env`** (service/api_core/launch_env.py:101-177). It is pure, dict in and dict out. It assigns the 12 `ALWAYS_SET` names, some of them to `""` (47-60, 139-162). It adds `AIFY_MANAGED_MODEL` and `AIFY_MANAGED_EFFORT` only when set (165-168). Session variables come from the runtime adapter (170-171, 180-194). The spawn's variables go down first, and any name the launch writes is dropped from them regardless of case (172-177).
   - Helpers: `launches_via_wrapper` (63-94) and `spawn_env_overlay` / `spawn_env_problems` (service/api_core/spawn_env.py:51-85). The latter refuses any `AIFY_*` name (63-64).
3. **aify-env, in another repo.** Its aify-comms plugin (`lib/plugins/aify-comms/terminal-controls.mjs`: `runOneControl`, `buildStartSpec`) merges the overlay over its own `baseEnv`. The host also adds `CODEX_HOME` and the four `*_SESSION_ID` passthroughs (launch_env.py:17-25; terminals.py:221-229).
   - The overlay winning over `baseEnv`, and `PATH` from `baseEnv` surviving, are pinned from this side at service/tests/test_the_env_plugin_can_run_what_the_launch_answers.py:130-134 and 322-343. That test skips when no aify-env checkout is present (147-150).
   - **UNVERIFIED:** what `baseEnv` actually is, and whether aify-env strips anything. Its code is not in this repo.
4. **The launched program is an aify-wrapper launcher.** The argv is `["claude-aify", "--aify-agent", ...]` (service/tests/test_a_process_host_can_ask_what_to_run.py:105). The package is external, pinned at mcp/stdio/package.json:28, and not installed in the corpus.
   - Recorded behaviour: wrappers overwrite or unset inherited session-id variables (DECISIONS.md:1086), and the hermes wrapper unsets a stale `HERMES_TUI_GATEWAY_URL` (KNOWN_ISSUES.md:529). Code UNVERIFIED.
5. **Downstream, inside the worker:**
   - Hermes passes only its own safe-key list to MCP children, so scripts/hermes-mcp-config.mjs:29-53 forwards names explicitly.
   - Several in-repo modules spread `process.env` into further children: hermes-gateway.mjs:233, hermes-session.js:180, hermes-daemon.js:231, hermes-active-session.mjs:151, runtimes-process.js:317, codex-session.js:183. Whether each one runs inside a managed worker is UNVERIFIED.

**Orphaned:**
- mcp/stdio/terminal-env.js and child-env-hygiene.mjs have no production importer. An rg for `terminal-env` across non-test, non-md files matched only comments. As a positive control, the import pattern did find the two test importers.
- The production import and the `wrapperEnv = terminalChildEnv(...)` call were removed in 779099d7. I did not check which file that hunk was in.
- ac6d6e82 removed a second "STRIPPED AGAIN AT THE BOUNDARY" site.

## 2. What stops an inherited variable today

- **On the live path, only assignment.** The overlay overwrites the `ALWAYS_SET` names, and that works only because aify-env merges the overlay last (plugin test 322-332). It runs in the service on each launch request.
  - The overlay cannot remove a name. It is `dict[str, str]` (launch_env.py:109, 177).
- **Two gaps, each an inference from code I read, not observed on a live system:**
  - **`CLAUDE_CODE_CHILD_SESSION`.** It is not mentioned anywhere under `service/` except a captured TUI string in test data. On the live path this repo does nothing about the variable from the original incident.
  - **`AIFY_COMMS_AGENT_ROLE`.** The overlay never writes it (launch_env.py:139-162). It blanks `AIFY_AGENT_ROLE` to `""`, and the hygiene module records that `""` falls through to the alias. It measured a worker resolving "manager" this way (child-env-hygiene.mjs:25-31).
  - Whether aify-env closes either gap is UNVERIFIED.
- **Why the port lost the strip silently.** The agreement test only compares `AIFY_*` names assigned in terminal-env.js (test_the_launch_environment_has_one_owner.py:141, 149-153). `...withoutInheritedMarkers(baseEnv)` (terminal-env.js:32) is not an assignment, so the scan cannot see it. `NEVER_INHERITED` has no Python counterpart.
- **Test-only mechanism.** `withoutInheritedMarkers` deletes the five `NEVER_INHERITED` names (child-env-hygiene.mjs:44-61, 72-76). That is five names, not the "two" KNOWN_ISSUES.md:129 still claims.
- **Spawn-supplied variables** (not inherited ones) are covered: `AIFY_*` is refused (spawn_env.py:63-64), and case-variant shadows are dropped (launch_env.py:172-177).

## 3. Recorded constraints

- **Direct conflict with the request.** child-env-hygiene.mjs:17-21 says: "A DENYLIST, DELIBERATELY, not an allowlist". It gives the reason that an allowlist fails as "a worker that mysteriously cannot reach something".
  - That module was committed at 08:31 on 2026-08-25 (ff0ac8f5), 41 minutes after the entry was written (05753886, 07:50). It calls itself "the inverse" the entry asked for (13-15).
  - `git blame` shows every line of the entry (119-131) still from 05753886. The entry and the code disagree about what was decided. **Settle that with the owner before building an allowlist.**
- **Strip, never blank to `""`** (child-env-hygiene.mjs:23-38). The current overlay can only blank, not strip.
- **No base environment on the wire:** launch_env.py:17-25, terminals.py:227-229. It is pinned by tests requiring no `PATH` and fewer than 40 keys.
- **The team prefers derived rules to hand-kept lists.** spawn_env.py:10-17 and 22-27 say explicitly "NOT A DENYLIST" and that a second list goes stale.
- **Cross-repo duplication.** The project answers it with an agreement test (credential-ref.mjs:13-18), and rejected porting the composer into aify-env (launch_env.py:9-15).
- **Only a service plugin may know its service**, not aify-env's host tier (docs/AIFY_ENV_BOUNDARY.md:20, 34). So aify-comms-specific rules belong in the plugin, not the daemon.
- **An allowlist must admit what workers currently inherit:**
  - PATH, HOME, proxies and credentials (hygiene 17-19).
  - The endpoint (`ENDPOINT_ENV_NAMES`, aify-service-endpoint.mjs:94) and the API key (51, 62). Neither is in the overlay.
  - docs/MULTI_SERVICE_STACK_TRACE.md:104-107 says the endpoint arrives "by INHERITANCE". That doc predates bridge removal (last commit 5e87a4c1, 2026-09-04), so the current delivery route is UNVERIFIED.
- **The cost of an allowlist has already been paid once:** Hermes's safe-key list left dispatch "queued for ever" until names were forwarded (hermes-mcp-config.mjs:32-37).
- **Windows merges variable names case-insensitively** (launch_env.py:172-174).
- **Stale text to fix alongside the change:**
  - KNOWN_ISSUES.md:129.
  - test_the_launch_environment_has_one_owner.py:132-135, which says terminal-env.js "still runs in the bridge".
  - README.md:372 and DECISIONS.md:718, which name terminal-env.js as the spawn env builder.

## 4. Tests that pin current behaviour

- **mcp/stdio/tests/terminal-env.test.js:186-224.** A hostile environment built from `NEVER_INHERITED` is stripped. `PATH` and `HOME` pass through untouched (208-209), which pins inherit-by-default. The marker is removed, not blanked.
- **mcp/stdio/tests/child-env-hygiene.test.js:21-91.** The list must contain both incident markers, every entry must carry a reason, and it tests the strip and detect helpers.
- **mcp/stdio/tests/every-identity-source-is-neutralised.test.js:1-60 onward.** It derives identity names from launch-identity.mjs and accepts either stripping or a definitive value.
- **service/tests/test_the_launch_environment_has_one_owner.py.**
  - `test_it_composes_NOTHING_only_the_host_can_know` (106-114).
  - The JS agreement test (131-153), which reads terminal-env.js and breaks if that file is deleted or reshaped.
- **service/tests/test_a_process_host_can_ask_what_to_run.py:125-132**, `test_NO_BASE_ENVIRONMENT_TRAVELS`.
- **service/tests/test_the_env_plugin_can_run_what_the_launch_answers.py:322-343.** Collision precedence, plus host `PATH` preserved. It skips without an aify-env checkout.
- **service/tests/test_a_spawns_env_vars_reach_its_worker.py:104-137**, if the list is meant to constrain spawn `envVars`.

## 5. Can this repository alone close the class?

**No.**
- The base environment is merged by aify-env, and this repo deliberately does not compose it (launch_env.py:17-25; terminals.py:221-229).
- The overlay contract can only assign values, and assigning does not neutralise `||`-chain consumers (child-env-hygiene.mjs:25-33).
- The only strip code here is unreachable in production (see section 1).
- Two more external layers sit in between: the aify-wrapper launcher (package.json:28) and runtime-specific filters.

This repo can do three things: state the list, add the missing overlay names, and extend the launch answer with names to remove. Enforcement still needs a change in aify-env's aify-comms plugin, and I could not read that code.

OPS: 24