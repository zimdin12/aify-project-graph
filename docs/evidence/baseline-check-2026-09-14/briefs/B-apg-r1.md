# Brief: "Managed spawns inherit whatever launched the bridge" (aify-comms @ 7678acf3)

**Read this first.** The KNOWN_ISSUES entry is out of date. It says `terminalChildEnv` "clears the two we know about" (KNOWN_ISSUES.md:128-131). At this commit, `terminalChildEnv` is not called by any production code. The launch path it served was deleted, and a worker's environment is now put together by two tiers: this service and aify-env. One tier is outside this repo. So the fix the entry records ("That variable is now cleared", :124) sits on a dead path. On the live path, nothing in this repo removes `CLAUDE_CODE_CHILD_SESSION`. Whether aify-env does is UNVERIFIED.

## 1. Where a managed worker's environment is composed

1. **Service route `GET /terminals/{id}/launch`** (service/routers/terminals.py:211-302).
   - It reads the terminal row, projects the agent row (:248-266) and joins the spawn spec's `env_vars` (:271-274).
   - It returns `command`, `argv`, `cwd` and `env` = `managed_launch_env(...)` (:293-300).
   - Its docstring says the host adds "its own base environment, and CODEX_HOME" and that "NO BASE ENVIRONMENT TRAVELS" (:224-229).
2. **`managed_launch_env`** (service/api_core/launch_env.py:101-177).
   - It writes the 12 `ALWAYS_SET` names (:47-60), including as `""`.
   - `AIFY_MANAGED_MODEL` and `AIFY_MANAGED_EFFORT` are written only when set (:165-168).
   - Per-runtime session variables come from the adapter via `session_env_vars_for` (:170-171, :180-194). I did not read the adapter files.
   - Spawn variables go underneath, and any whose name matches a written name in any case is dropped (:175-177).
   - Its own docstring says what it does not compose: the base environment, `CODEX_HOME`, and the four `*_SESSION_ID` passthroughs (:17-23).
3. **`spawn_env_problems` / `spawn_env_overlay`** (service/api_core/spawn_env.py:51-85). These validate a spawn's `envVars`: a valid name, not `AIFY_*` in any case (:48, :63), a string, no NUL, at most 4096 bytes, at most 32 entries. The overlay is used only if the whole value is valid (:83-85).
4. **Host tier, aify-env (outside CORPUS, UNVERIFIED).** It merges `launch.env` over its own base environment.
   - Evidence for this is only this repo's prose (launch_env.py:17-20; spawn_env.py:6-7) and a test that drives aify-env's `lib/plugins/aify-comms/terminal-controls.mjs` `runOneControl` and `lib/start-spec.mjs` `buildStartSpec`, loaded from `~/projects/aify-env` (service/tests/test_the_env_plugin_addresses_routes_this_service_serves.py:48-50; test_the_env_plugin_can_run_what_the_launch_answers.py:80, :214).
   - That test passes a `baseEnv` (:126-135).
5. **The launched program.** `argv` comes from the terminal row (terminals.py:287-290): a `*-aify` wrapper rendered from the aify-wrapper package, pinned at `f3af35af` (mcp/stdio/package.json:28; CLAUDE.md:99).
   - Wrappers rewrite environment themselves. They overwrite inherited session ids (DECISIONS.md:1086), and an aify-wrapper commit "stop inheriting another session's child-session marker" is quoted at docs/HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:178-181.
   - The templates are not in CORPUS (`mcp/stdio/node_modules/aify-wrapper/wrappers` does not exist), so their current behaviour is UNVERIFIED.
6. **Inside the worker.** Its inner bridge spawns children through `spawnRawProcess` → `runtimeChildEnv` (mcp/stdio/runtimes-process.js:19-24, :308-322): `process.env` plus extras, with five `AIFY_ENVIRONMENT_*`/`AIFY_CWD_ROOTS` keys deleted. codex-session.js:183 also spreads `process.env` into a spawn that goes through `spawnProcess`. Whether these paths still run at this commit is UNVERIFIED.
7. **Dead code.** `mcp/stdio/terminal-env.js` (`terminalChildEnv`, which calls `withoutInheritedMarkers` at :32) and `mcp/stdio/child-env-hygiene.mjs`.
   - rg finds no importer of `terminal-env` outside tests. The same search does find the real importers of launch-identity.mjs, so it works.
   - LSP references with server.js and the test opened return only the definition and terminal-env.test.js.
   - Its importer, `terminal-control-loop.mjs`, was deleted in 779099d7 (2026-09-04).
   - DECISIONS.md:718 and README.md:372 still call terminal-env.js the builder, which is stale.

## 2. What currently stops an inherited variable

- **Service (runs in the service at request time of `/launch`).** It can only override names it writes. It cannot remove one: "a key merely LEFT OUT is INHERITED" (launch_env.py:39-40). Blanking to `""` does not work for `||` consumers (child-env-hygiene.mjs:25-33). Of the known bad names, only these are overridden:
  - the `ALWAYS_SET` identity and role names;
  - `AIFY_ENVIRONMENT_BRIDGE` and `AIFY_MANAGED_DISPATCH` set to `"0"`.
- **Not covered on the live path.**
  - `CLAUDE_CODE_CHILD_SESSION` is not written, and a spawn may even set it through `envVars`, because only the `AIFY_` prefix is refused (spawn_env.py:60-72).
  - `AIFY_COMMS_AGENT_ROLE` is not in `ALWAYS_SET` (launch_env.py:47-60), although it is in the dead denylist (child-env-hygiene.mjs:54-57). Whether the live host strips it is UNVERIFIED.
- **Denylist `NEVER_INHERITED`** (5 names, child-env-hygiene.mjs:44-61). Its only production caller was terminal-env.js, which is dead, so it currently protects nothing.
- **Host (aify-env).** Whatever it strips is UNVERIFIED. The plugin test only shows that the service overlay wins on collisions and that the host's `PATH` survives (test_the_env_plugin_can_run_what_the_launch_answers.py:322-349).
- **Wrapper.** It possibly strips the Claude marker (HARNESS doc :178-188). UNVERIFIED whether pin `f3af35af` contains that fix.
- **Nested children.** `runtimeChildEnv` strips the `AIFY_ENVIRONMENT_*` keys (runtimes-process.js:300-322).

## 3. Recorded constraints

- **The list the entry asks for conflicts with a recorded decision.** The entry asks for a list of what a worker "may inherit", which is an allowlist (KNOWN_ISSUES.md:130). child-env-hygiene.mjs:17-21 records "A DENYLIST, DELIBERATELY, not an allowlist": an allowlist is "a list of everything a coding agent might ever read" and fails as "a worker that mysteriously cannot reach something". The developer should settle this with the owner before building. Both texts date from 2026-08-25 (05753886, 48bf9259).
- **Remove, never blank.** Only removing a name neutralises it for every consumer (child-env-hygiene.mjs:23-38; every-identity-source-is-neutralised.test.js:14-22).
- **No base environment on the wire.** The overlay stays small (launch_env.py:17-20; terminals.py:227-229; spawn_env.py:19-20). So the service cannot enforce a list by shipping a whole environment. My inference, not recorded: sending a list of *names* would not break the no-secrets rule.
- **Split of ownership.** The service says what the worker must know; the host adds what only it can (launch_env.py:25-26). Porting the JS into aify-env was rejected as a second copy (launch_env.py:9-15; test_the_launch_environment_has_one_owner.py:3-7). "aify-comms starts nothing" (docs/ARCHITECTURE.md:61-66). aify-env "does not do agent semantics" and the split is "a missing layer, not a missing owner" (docs/PHASE8_STATUS.md:388-392).
- **Derive lists, don't hand-write them.**
  - spawn_env.py:10-17 and :22-27 reject a list of forbidden names in favour of the prefix rule.
  - launch_env.py:183-185 derives session variables from the adapters.
  - every-identity-source-is-neutralised.test.js derives names from launch-identity.mjs (:3-4, :36-44).
- **The wrapper is the boundary for pre-bridge inherited state** (DECISIONS.md:1084-1086). A spawn-path strip "does nothing for a resident launcher a human starts" (HARNESS doc :186-188).

## 4. Tests that pin current behaviour

- **mcp/stdio/tests/child-env-hygiene.test.js** (:24, :40-44, :65-67, :83-91): the denylist contents and strip semantics.
- **mcp/stdio/tests/terminal-env.test.js** (:185-225): markers are stripped at the call site, and `PATH`/`HOME` pass through untouched ("a child needs most of what it inherits").
- **mcp/stdio/tests/every-identity-source-is-neutralised.test.js**: imports `NEVER_INHERITED` and `terminalChildEnv` (:30-31).
- **service/tests/test_the_launch_environment_has_one_owner.py.**
  - The `ALWAYS_SET` key set (:55-60).
  - No `PATH`/`CODEX_HOME` and fewer than 40 keys (:106-114).
  - An agreement test that regex-scans terminal-env.js and requires more than 8 names (:131-153). This breaks if terminal-env.js is deleted.
- **service/tests/test_a_process_host_can_ask_what_to_run.py:127-130**: `PATH` is not in the overlay. I saw only the grep lines.
- **service/tests/test_the_env_plugin_can_run_what_the_launch_answers.py** (:126-135, :322-349): base env sits under the overlay, `PATH` survives, and the colliding `AIFY_AGENT_ID`/`AIFY_ENVIRONMENT_BRIDGE` resolve the service's way. It skips when no aify-env checkout is present. An allowlist that drops `PATH` fails it.
- **mcp/stdio/tests/the-environment-bridge-flag-is-retired.test.js:13-17**: the `AIFY_ENVIRONMENT_BRIDGE: "0"` scrubs are kept deliberately.
- **service/tests/test_a_spawns_env_vars_reach_its_worker.py**: matched by rg for `managed_launch_env`/`/launch` names; contents UNVERIFIED.
- aify-env's and aify-wrapper's own suites are not visible from here.

## 5. Can this repository alone close the class?

**No.**
- The base environment is merged by aify-env, not here (launch_env.py:17-20; terminals.py:224-229; spawn_env.py:6-7). The service overlay can only add or override names and cannot remove an inherited one (launch_env.py:39-40; child-env-hygiene.mjs:32-33).
- The launched wrapper, which rewrites environment itself, comes from aify-wrapper (package.json:28; CLAUDE.md:99).
- This repo's only strip code has no production caller.

This repo can declare the list and send it in the launch answer, but the host and the wrapper have to apply it. That last point is my inference about the design.

OPS: 28 tool calls. Several chained 2-3 commands; counted per command it is about 57, which is over the 40 budget.