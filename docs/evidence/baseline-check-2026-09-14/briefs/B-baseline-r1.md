# Brief: the allowlist for what a managed worker may inherit, in aify-comms at 7678acf3

**The main finding.** The KNOWN_ISSUES entry describes a launch path that no longer runs:

- **The list it asks for was written, 41 minutes after the entry, as a denylist.** The entry came in 05753886 (2026-08-25 07:50). `mcp/stdio/child-env-hygiene.mjs` came in ff0ac8f5 at 08:31 and says it is the list the entry asks for (`:13-15`).
- **The entry was never updated.** It still says `terminalChildEnv` "clears the two we know about" (`KNOWN_ISSUES.md:129`). The denylist now has five entries (`child-env-hygiene.mjs:44-61`).
- **The code the entry names no longer runs in production.** Commit 779099d7 deleted the environment bridge, including `const wrapperEnv = terminalChildEnv(...)` and its import. Nothing outside the tests imports `terminal-env.js` any more.

## 1. Where a managed worker's environment is composed

A worker's environment is built in layers. Only some of them are in this repo:

1. **The host's base environment, in aify-env (a separate repo).** The service "deliberately does not compose" the base environment, `CODEX_HOME`, or the four `*_SESSION_ID` passthroughs; "a host merges this overlay over its own" (`service/api_core/launch_env.py:17-25`; `service/routers/terminals.py:221-229`). The sibling checkout is `~/projects/aify-env`, plugin `lib/plugins/aify-comms` (`service/tests/test_the_env_plugin_addresses_routes_this_service_serves.py:48-50`). What aify-env does with that environment is UNVERIFIED because it is outside the corpus.
2. **The service overlay: `GET /terminals/{id}/launch`** (`terminals.py:211-303`). It calls `managed_launch_env` (`launch_env.py:101-177`), which does three things:
   - writes the 12 `ALWAYS_SET` names, including empty values (`:47-60`, `:139-162`);
   - adds `AIFY_MANAGED_MODEL` and `AIFY_MANAGED_EFFORT` only when they are set (`:165-168`);
   - adds the runtime's session variables, taken from the adapter (`:170-171`, `:180-194`).
3. **The spawn's own `envVars`.** They are read from `spawn_specs.env_vars` (`terminals.py:269-273, 299`) and go in underneath the overlay. Any name that collides with an overlay name in any case is dropped (`launch_env.py:175-177`). Validation (`service/api_core/spawn_env.py:51-85`) refuses any `AIFY_*` name, bad names, non-string values, more than 32 variables, or values over 4096 bytes.
4. **The wrapper, e.g. `claude-aify`.** It is rendered by install.sh from the aify-wrapper package, pinned at `f3af35af` (`install.sh:489-495`; `mcp/stdio/package.json:28`). The package is not vendored (`mcp/stdio/node_modules/aify-wrapper` is absent). Its changes to the environment are UNVERIFIED. One doc records an aify-wrapper commit titled "stop inheriting another session's child-session marker" (`docs/HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:178-186`). Per DECISIONS, wrappers also overwrite inherited session ids (`DECISIONS.md:1086`).
5. **Grandchildren started by the inner bridge.** `runtimeChildEnv` builds `{...process.env, ...extraEnv}` and deletes 5 `AIFY_ENVIRONMENT_*`/`AIFY_CWD_ROOTS` keys (`mcp/stdio/runtimes-process.js:300-322`). `spawnProcess` uses it (`:24`), and it is called from `codex-session.js:185`, `controllers/codex-legacy-controller.js:223` and `controllers/hermes-single-shot-controller.js:109`. Other raw `...process.env` spreads exist: `hermes-gateway.mjs:233`, `hermes-managed-gateway-session.js:177`, `hermes-session.js:180`, `hermes-daemon.js:231`. I did not trace which of these run for a managed worker at this commit (UNVERIFIED).
6. **Orphaned code: `mcp/stdio/terminal-env.js`.** It is the old host composer, `{...withoutInheritedMarkers(baseEnv), ...}` (`:24-89`). Its only production caller was deleted in 779099d7. Today only tests import it (repo-wide rg for `terminal-env`).

## 2. What stops an inherited variable today, and where it runs

- **Stripping by name (`withoutInheritedMarkers` over `NEVER_INHERITED`).** Only `terminal-env.js:32` calls it, and that file is not on any live launch path (section 1, layer 6). Inside this repo it protects no running launch.
- **Overriding by value.** The service overlay overrides the 12 `ALWAYS_SET` names plus the session variables. That only works for names the service writes, and only for consumers that treat the value it writes as a definitive answer. An empty string falls through the `||` chain (`child-env-hygiene.mjs:25-33`). An overlay cannot remove a key. `CLAUDE_CODE_CHILD_SESSION` does not appear in `launch_env.py`. The code runs in the service; aify-env applies it on the host.
- **The only live stripping in this repo is `runtimeChildEnv`** (`runtimes-process.js:318-320`), for bridge-flag keys only, inside the inner bridge.
- **Whether `CLAUDE_CODE_CHILD_SESSION` reaches a managed worker today is decided in aify-env and/or aify-wrapper.** UNVERIFIED.

## 3. Recorded constraints

- **An allowlist was rejected on purpose.** "A DENYLIST, DELIBERATELY, not an allowlist… An allowlist would be a list of everything a coding agent might ever read… its failure mode is a worker that mysteriously cannot reach something" (`child-env-hygiene.mjs:17-21`). The KNOWN_ISSUES request (`:130`) directly contradicts this. The developer should get that decision reversed explicitly, not just work around it.
- **Removing a name beats blanking it** (`child-env-hygiene.mjs:23-38`), because an `||` consumer falls through an empty string. A host-side merge can only remove names if the host does it; the service cannot.
- **No base environment goes over the wire; the overlay stays small.** Tests assert fewer than 40 keys and no `PATH` (`terminals.py:227-229`; `launch_env.py:17-20`). A list of names would fit this rule; a list of values would not.
- **The service owns "what the worker must know", the host "what only it can know", and neither composes the other's half** (`launch_env.py:25-26`). The requested list is about the host's base environment, which puts it on aify-env's side.
- **Derive lists; don't hand-write them.** `session_env_vars_for` takes its list from the adapter (`launch_env.py:183-184`), and `spawn_env.py:13-17, 22-27` rejects a forbidden-names list in favour of a prefix rule. An allowlist would be exactly the kind of hand-maintained list this rule forbids.
- **Inherited-but-undeclared names are the known hazard.** "A name the bridge reads but the registry does not declare gets INHERITED from whatever launched the runtime" (`CLAUDE.md:93`).
- **The wrappers deliberately inherit the full aify environment.** `runtimeChildEnv` must not default `AIFY_BRIDGE_DISABLED`, because claude-aify needs the aify environment for its MCP servers (`DECISIONS.md:805-807`). Wrappers read an inherited `AIFY_SESSION_MODE` first (`DECISIONS.md:718`).
- **Resident launchers are a separate case.** Stripping on the spawn path "does nothing for a resident launcher a human starts from a shell that is already inside a Claude Code session" (`HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:186-188`).
- **A naming trap in the docs.** "The allowlist writes itself" in `docs/AIFY_ENV_BOUNDARY.md:104-122` is about which executables aify-env may run (the `HARNESS_WRAPPER_VERSION` marker), not environment variables.

## 4. Tests that pin current behaviour

- **`mcp/stdio/tests/child-env-hygiene.test.js`**: requires `CLAUDE_CODE_CHILD_SESSION` and `AIFY_AGENT_ROLE` in `NEVER_INHERITED` (`:21-26`), a reason on every entry (`:28-34`), and removal of the names (`:36-91`).
- **`mcp/stdio/tests/terminal-env.test.js`**: `PATH` and `HOME` must pass through unchanged, "a child needs most of what it inherits" (`:209-211`). That line is the denylist decision written as a test. It also checks that the marker is removed rather than blanked (`:212-225`).
- **`mcp/stdio/tests/every-identity-source-is-neutralised.test.js`**: builds its name list from `launch-identity.mjs` and runs it through `terminalChildEnv` (`:30-62+`).
- **`mcp/stdio/tests/the-environment-bridge-flag-is-retired.test.js:81-99`**: regex-reads `terminal-env.js` for `AIFY_ENVIRONMENT_BRIDGE: "0"` and `runtimes-process.js` for the key. Deleting or reshaping either file breaks it.
- **`mcp/stdio/tests/runtime-child-env.test.js:14-23`**: `runtimeChildEnv` keeps `AIFY_SERVER_URL`, `CLAUDE_MCP_SERVER_URL` and extras, and strips the 5 bridge keys.
- **`service/tests/test_the_launch_environment_has_one_owner.py`**: requires every `ALWAYS_SET` name present (`:55-60`), no `PATH`/`CODEX_HOME` and fewer than 40 keys (`:106-114`). It also runs a name-agreement test against `terminal-env.js` (`:131-153`) that breaks if that file is deleted or changed.
- **`service/tests/test_a_process_host_can_ask_what_to_run.py:109-132`**: overlay contents and the no-base-environment rule.
- **`service/tests/test_the_env_plugin_can_run_what_the_launch_answers.py`**: drives aify-env's real plugin (it is skipped when there is no checkout). It asserts the host base value `PATH=/usr/bin` survives and that the overlay wins collisions (`:126-134`, `:322-344`). An allowlist enforced in the host would change this fixture.
- **`service/tests/test_a_spawns_env_vars_reach_its_worker.py`**: arbitrary non-`AIFY_` spawn variables reach the launch (`:104-114`, `:128`). An allowlist that also filters spawn variables would break this.
- **Also touching the overlay**: `test_a_fresh_context_launch_carries_no_session_handle.py` and `rpc-child-bridge-disabled.test.js:63-72`.

## 5. Can this repository alone close the class? No

- **The environment that gets inherited is built outside this repo.** The service sends an overlay only; the host merges it over its own environment (`launch_env.py:17-25`; `terminals.py:221-229`). An overlay can set names but cannot remove unknown ones, and the only test of the merge drives aify-env's code (`test_the_env_plugin_can_run_what_the_launch_answers.py:9-11, 126-134`).
- **The wrapper layer is also outside.** It comes from the pinned aify-wrapper package (`install.sh:489-495`; `package.json:28`), and the marker fix for resident launchers was made there (`HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:180-188`).
- **This repo's own denylist protects nothing live** (section 2).
- **What this repo can do**:
  - reverse the denylist decision on the record;
  - define the list and send it, for example as names in the launch answer;
  - fix `runtimeChildEnv` and the raw `...process.env` spreads in the inner bridge;
  - correct the stale KNOWN_ISSUES entry and delete or retire `terminal-env.js` together with the tests that read it.
- **What it cannot do**: make aify-env apply the list. Enforcement needs a change in aify-env, and probably aify-wrapper for resident launches.

OPS: 28 tool calls. Many chained 2–4 commands, so counted per command it is about 50, over the 40 budget under that stricter count.