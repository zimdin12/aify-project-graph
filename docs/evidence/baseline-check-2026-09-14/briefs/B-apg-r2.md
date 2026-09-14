# Brief: what a managed worker may inherit (aify-comms @ 7678acf3)

**The main point:** the KNOWN_ISSUES entry is out of date. The code it names, `terminalChildEnv`, no longer runs in production. The environment a managed worker gets is now built in three places, and the process that owns the inherited base environment is aify-env, which is a different repository. An allowlist also directly contradicts a design decision already written into the code.

## 1. Where a managed worker's environment is composed

- **Service overlay (this repo, live).** `GET /terminals/{terminal_id}/launch` (`service/routers/terminals.py:211`) returns `launch.env = managed_launch_env(...)` (terminals.py:290-297). That function builds a flat `dict[str,str]`:
  - It puts the spawn's validated `envVars` down first, then the aify-owned keys on top, and drops any spawn key that clashes with one of those in any letter case (`service/api_core/launch_env.py:139-177`).
  - `ALWAYS_SET` lists the 12 keys it always writes (launch_env.py:47-60).
  - Session-handle variables come from the runtime adapter (launch_env.py:180-194).
  - The spawn's variables are checked in `service/api_core/spawn_env.py:51-85`. Any `AIFY_*` name is refused; `spawn_env_overlay` passes the stored `envVars` through when the whole value is valid and returns nothing otherwise.
- **What the service deliberately does not compose.** The base environment, `CODEX_HOME`, and the four `*_SESSION_ID` passthroughs. The design says "A host merges this overlay over its own, and never receives one" (launch_env.py:17-26; terminals.py docstring, lines 213-232).
- **Host merge (aify-env, outside this repo).** aify-env's plugin `lib/plugins/aify-comms/terminal-controls.mjs` merges `launch.env` over its own `baseEnv` (docs/V063_ACCEPTANCE_LEDGER.md:320). A test here drives it with `baseEnv: {PATH, AIFY_AGENT_ID, AIFY_ENVIRONMENT_BRIDGE}` and asserts that the service's values win and `PATH` survives (`service/tests/test_the_env_plugin_can_run_what_the_launch_answers.py:130-134, 322-344`). That test only runs when `AIFY_ENV_REPO` points at a checkout; otherwise it skips (lines 146-150; `test_the_env_plugin_addresses_routes_this_service_serves.py:122-133`). I did not read the plugin's code, so how it builds `baseEnv` is UNVERIFIED.
- **Wrapper (aify-wrapper package, outside this repo).** The launched program is a `*-aify` wrapper rendered from the pinned aify-wrapper package (`install.sh:489-495`). aify-wrapper has its own fix for the child-session marker (docs/HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:180-187). What that wrapper strips is UNVERIFIED here.
- **The bridge path is gone.** `mcp/stdio/terminal-env.js` (`terminalChildEnv`, lines 4-90) is no longer used in production:
  - Commit 779099d7 (2026-09-04, an ancestor of HEAD) deleted the environment-bridge cluster, including the terminal-control loop that called it. Its message says aify-env owns the processes and PTYs.
  - At this commit, `rg "terminal-env"` and `rg terminalChildEnv` find only tests, docs and comments. The test importers turning up shows the search was working.
  - APG's `graph_callers` returned "NO CALLERS" even for those test callers, so it could not answer this question.

## 2. What currently stops an inherited variable

- **In this repo, only assignment.** The service overlay can set values but cannot remove one.
  - The identity and wiring keys in `ALWAYS_SET` are always written, including as `""`, so an inherited copy is overwritten (launch_env.py:36-60, 139-162).
  - `AIFY_ENVIRONMENT_BRIDGE` and `AIFY_MANAGED_DISPATCH` are set to `"0"` (launch_env.py:152-153).
  - This runs in the service, at `GET /terminals/{id}/launch`, and takes effect only if aify-env lets the overlay win.
- **The denylist is not on the live path.** `NEVER_INHERITED` with `withoutInheritedMarkers` (`mcp/stdio/child-env-hygiene.mjs:44-76`) removes five names: `CLAUDE_CODE_CHILD_SESSION`, `AIFY_AGENT_ROLE`, `AIFY_AGENT_ID`, `AIFY_COMMS_AGENT_ROLE`, `AIFY_COMMS_AGENT_ID`. Its only importer is terminal-env.js:2/32, which has no production caller.
- **Two gaps on the live path, found by reading code, not by running anything:**
  - **`CLAUDE_CODE_CHILD_SESSION`** is not in the overlay, and an overlay cannot delete it. If aify-env's base environment carries it, the transcript-loss bug is back. Whether aify-env strips it is UNVERIFIED.
  - **`AIFY_COMMS_AGENT_ROLE`** is not in `ALWAYS_SET`. When a worker has no known role, the overlay sets `AIFY_AGENT_ROLE=""` (launch_env.py:147). `mcp/stdio/launch-identity.mjs:32` reads `AIFY_AGENT_ROLE || AIFY_COMMS_AGENT_ROLE || "coder"`, so an inherited alias would win. child-env-hygiene.mjs:23-33 records exactly this failure, as measured. It is live if the host's environment carries the alias (UNVERIFIED).
- **Other spreads of the parent environment exist:**
  - `runtimes-process.js:317`, `hermes-gateway.mjs:233`, `hermes-daemon.js:231`, `hermes-active-session.mjs:151` and `codex-session.js:183` spread `process.env` in child spawns.
  - These appear to be children the worker's own bridge starts, not the worker launch itself. Their callers are UNVERIFIED.
  - child-env-hygiene.mjs:3 says "Seven places in this bridge" spread the parent environment; only terminal-env.js used the helper.

## 3. Recorded constraints

- **Denylist chosen on purpose.** child-env-hygiene.mjs:17-21: "A DENYLIST, DELIBERATELY, not an allowlist". The reasons given: a child needs PATH, HOME, proxy settings, runtime credentials and operator exports; an allowlist fails as "a worker that mysteriously cannot reach something"; a denylist's failure is bounded. **The list KNOWN_ISSUES asks for (KNOWN_ISSUES.md:130) contradicts this decision.** Someone has to decide between the two explicitly.
- **KNOWN_ISSUES.md:119-131 is stale.** It says `terminalChildEnv` "clears the two we know about". The list now holds five names, and the bridge that ran it was deleted in 779099d7.
- **Remove, don't blank.** Setting a value only neutralises a variable if the consumer treats that value as definitive; removing the name works for every consumer (child-env-hygiene.mjs:23-38). The service overlay cannot express removal, since it returns `{**spawn, **env}` (launch_env.py:177).
- **No base environment over the wire.** Sending one would leak the sender's secrets (launch_env.py:17-20; terminals.py:227-229). So the service cannot enforce any list by sending the complete environment. The host has to apply it.
- **Spawn variables are the caller's to set.** spawn_env.py:10-27 explicitly rejects a denylist for spawn `envVars` and reserves the `AIFY_` prefix. An allowlist on the base environment must not end up dropping these.
- **One owner for launch knowledge.** Don't copy this logic into a second repo; that is the "wrapper-template mistake" (`service/tests/test_the_launch_environment_has_one_owner.py:3-7`; launch_env.py:9-15). This pulls against putting the list in aify-env.
- **The resident launcher is a separate cause.** Stripping on the spawn path does nothing for a wrapper a human starts from inside a Claude Code session (docs/HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:186-187).
- **Related decision.** The wrapper, not the bridge, rediscovers session ids and overwrites the inherited `*_SESSION_ID` values (DECISIONS.md:1084-1086).

## 4. Tests that pin current behaviour

**On the service path (live):**
- `service/tests/test_the_launch_environment_has_one_owner.py`
  - :55-67: every `ALWAYS_SET` key is present, and an unknown role is written as `""`.
  - :106-114: no `PATH` or `CODEX_HOME`, and the overlay stays under 40 keys.
  - :131-153: the agreement test reads `terminal-env.js` and fails if it is deleted.
- `service/tests/test_the_env_plugin_can_run_what_the_launch_answers.py:322-344`: inherited `AIFY_AGENT_ID` and bridge flag lose, and base `PATH` survives. Skips without `AIFY_ENV_REPO`.
- `service/tests/test_a_spawns_env_vars_reach_its_worker.py:104,130,149` and `test_a_process_host_can_ask_what_to_run.py:98-137`. I read only the test names, so what they assert in detail is UNVERIFIED.

**On the dead JS path:**
- `mcp/stdio/tests/child-env-hygiene.test.js:22-92`: the list's contents, and that an ordinary environment passes through unchanged (around :72).
- `mcp/stdio/tests/terminal-env.test.js:185-222`: `PATH` and `HOME` pass through untouched (:207-208), and the marker is removed rather than blanked.
- `mcp/stdio/tests/every-identity-source-is-neutralised.test.js:63-139`.
- `mcp/stdio/tests/the-environment-bridge-flag-is-retired.test.js:84`, which reads terminal-env.js.

An allowlist would break every "ordinary variable passes through" assertion listed above.

## 5. Can this repository alone close the class?

**No.**
- The worker's base environment, and the merge that lets inherited variables through, live in aify-env (docs/V063_ACCEPTANCE_LEDGER.md:320; launch_env.py:17-26).
- This repo's only live contribution is an overlay that can assign but never remove (launch_env.py:177). Its own recorded analysis says assigning does not neutralise presence-checked markers or `||` fallbacks (child-env-hygiene.mjs:23-38).
- The launched wrapper comes from the separate aify-wrapper package (install.sh:489-495).
- This repo could extend the launch contract, for example with a list of names to remove or to allow. aify-env would still have to apply it, and the only test that drives aify-env's code skips without that checkout.

OPS: 22