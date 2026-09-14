# Brief: closing "Managed spawns inherit whatever launched the bridge" at aify-comms 7678acf3

**The main finding:** the issue entry describes a code path that is no longer the production path. The list it asks for already exists, but it runs only in bridge code that has no production caller at this commit. Workers are now started by aify-env, a separate repository. aify-env merges an overlay from the aify-comms service over its own base environment. Nothing in this repository removes anything from that base environment.

APG ran with trust "weak", no code-intel collection, and a server process on an older build (graph_health said the difference is behaviourally irrelevant). I checked every APG fact against source. Facts that came first from APG are marked [APG].

## 1. Where a managed worker's environment is composed

- **Service route (production).** `GET /terminals/{id}/launch` in `service/routers/terminals.py:211-302` returns `launch.env` = `managed_launch_env(...)` (`terminals.py:293-300`). APG found `get_terminal_launch` as its only non-test caller [APG]; rg of `service/` outside tests agrees. The route reads the spawn's `env_vars` from `agent_sessions JOIN spawn_specs` (`terminals.py:274-277`).
- **`managed_launch_env`** (`service/api_core/launch_env.py:101-177`) builds the environment:
  - It writes the 12 names in `ALWAYS_SET` (`launch_env.py:47-60, 139-162`).
  - It writes `AIFY_MANAGED_MODEL` and `AIFY_MANAGED_EFFORT` only when they have values (`:165-168`).
  - It writes each runtime's session variables, taken from the adapter's `session_env_vars` (`:170-171, 180-194`).
  - It then lays the spawn's variables underneath its own, dropping any whose name it writes, compared without case (`:175-177`).
- **`spawn_env_overlay` / `spawn_env_problems`** (`service/api_core/spawn_env.py:51-85`) [APG]. They validate the spawn's `envVars` and refuse any name starting `AIFY_` in any case (`:48, 63-64`). A partly invalid value contributes nothing (`:83-84`).
- **`launches_via_wrapper`** (`launch_env.py:63-94`) supplies `AIFY_MANAGED_VIA_WRAPPER`.
- **The host, aify-env (outside this repo, UNVERIFIED).** By this repo's own account, the host provides:
  - the base environment, which it merges the overlay over;
  - `CODEX_HOME`;
  - the four inherited `*_SESSION_ID` passthroughs.

  Sources: `launch_env.py:17-25`, `terminals.py:220-231`, `spawn_env.py:6-7`. The claim that aify-env keeps order when merging and node-pty does not de-duplicate comes only from a test docstring (`service/tests/test_a_spawns_env_vars_reach_its_worker.py:134-137`).
- **The worker's own bridge, which reads the result.** `mcp/stdio/launch-identity.mjs:32` resolves the role as `AIFY_AGENT_ROLE || AIFY_COMMS_AGENT_ROLE || "coder"`.
- **Code that is no longer in the production path.**
  - `mcp/stdio/terminal-env.js:4-90`, `terminalChildEnv` [APG]. It spreads `withoutInheritedMarkers(baseEnv)` (`:32`) and copies the `*_SESSION_ID` values from `baseEnv` (`:62-65`).
  - rg for `terminal-env` across the repo finds only tests, docs and comments importing or naming it. APG `graph_callers` also reported no callers.
  - Its production caller went with the bridge deletions: `779099d7` (2026-09-04, "delete the environment-bridge cluster") and `ac6d6e82` (2026-09-05, residue).
  - The file survives because tests read it as text (see section 4).
- **Grandchild paths inside a worker.** These spread `process.env` into runtime children:
  - `runtimes-process.js:317` strips only `ENVIRONMENT_BRIDGE_ENV_KEYS` (`:300-304`).
  - `codex-session.js:183`, `hermes-daemon.js:230-236`, `hermes-gateway.mjs:233` and `hermes-session.js:180` spread it as well.
  - `child-env-hygiene.mjs:3` says "Seven places" do this. I did not enumerate all seven.

## 2. What stops an inherited variable reaching a worker today

- **In the path that runs (service overlay, executed inside the aify-comms container):**
  - Only overwriting. The 12 `ALWAYS_SET` names are always written, including as `""` (`launch_env.py:36-60`). `AIFY_ENVIRONMENT_BRIDGE` and `AIFY_MANAGED_DISPATCH` are set to `"0"` (`:152-153`).
  - The `AIFY_` prefix refusal applies only to the spawn's own `envVars`, not to the host's base environment.
  - The overlay is a name-to-string dict, so it cannot remove a name.
- **The stated list:** `NEVER_INHERITED` in `mcp/stdio/child-env-hygiene.mjs:44-61` has five entries: `CLAUDE_CODE_CHILD_SESSION`, `AIFY_AGENT_ROLE`, `AIFY_AGENT_ID`, `AIFY_COMMS_AGENT_ROLE`, `AIFY_COMMS_AGENT_ID`. Its stripper is `withoutInheritedMarkers` (`:72-76`). Its only non-test caller is `terminal-env.js:2,32` [APG code_intel_references, not exhaustive; rg agrees]. So at this commit it does not run on any production launch.
- **Gaps in the overlay, by reading the code.** Whether they bite depends on what aify-env strips and holds, which is UNVERIFIED.
  - The overlay never writes `CLAUDE_CODE_CHILD_SESSION` or `AIFY_COMMS_AGENT_ROLE`.
  - For an agent with no role, the overlay sends `AIFY_AGENT_ROLE: ""` (`launch_env.py:147`). `launch-identity.mjs:32` then falls through to any `AIFY_COMMS_AGENT_ROLE` in the host's base environment.
  - That is the defect already measured and fixed in `48bf9259` on the JS side (`child-env-hygiene.mjs:23-30`). The Python port did not carry the removal half.
- **Why no test caught it.** The agreement test compares only names written as `AIFY_*:` keys (`service/tests/test_the_launch_environment_has_one_owner.py:131-153`). Stripping semantics are invisible to it.

## 3. Recorded constraints

- **The issue entry is stale.** Every line of `KNOWN_ISSUES.md:119-131` blames to `05753886` (2026-08-25 07:50). `ff0ac8f5`, at 08:31 the same day, added `child-env-hygiene.mjs` (per `git log --diff-filter=A`). That module describes itself as the inverse list, "stated once… so the third one is refused by construction" (`:13-15`). The entry was never updated, and the bridge it describes was deleted afterwards.
- **The requested list conflicts with a recorded decision.** "What a managed worker may inherit" is an allowlist. `child-env-hygiene.mjs:17-21` records "A DENYLIST, DELIBERATELY, not an allowlist": an allowlist would be maintained by people who cannot know what a coding agent reads, and it fails as a worker that silently cannot reach something. Steven needs to pick one form before any code is written.
- **Removing a name is not the same as blanking it.** `child-env-hygiene.mjs:23-38`: `""` neutralises a variable only if its consumer treats `""` as definitive. Removing the name works for every consumer.
- **No base environment travels over the wire.** `launch_env.py:17-26` and `terminals.py:224-226`: the service must not compose or receive the base environment. A test caps the overlay below 40 names and forbids `PATH` in it (`test_the_launch_environment_has_one_owner.py:106-113`). Any allow or deny rule on the base environment must therefore run on the host, or be sent as a new contract field.
- **Ownership ruling.** `docs/PHASE8_STATUS.md:386-420` (2026-08-27): aify-env is the only owner of physical processes and PTYs; the service owns agent semantics. `ac6d6e82` restates that aify-comms "starts nothing".
- **Spawn variables have their own policy.** `spawn_env.py:10-27` explicitly argues it is not a denylist: a spawn may set anything except the `AIFY_` namespace. Names are compared without case for Windows (`launch_env.py:172-176`).
- **Scrubs must stay.** `mcp/stdio/tests/the-environment-bridge-flag-is-retired.test.js:80-98` requires `terminal-env.js` and `runtimes-process.js` to keep neutralising `AIFY_ENVIRONMENT_BRIDGE`, because wrappers already running still read it.
- **A second route for the marker.** `docs/HARNESS_KNOWLEDGE_BELONGS_TO_AIFY_WRAPPER.md:178-188`: a resident launcher leaks `CLAUDE_CODE_CHILD_SESSION` by a different cause. That fix (`bb56df5`) is in the aify-wrapper templates, not here.
- **Wrappers already handle session IDs.** `DECISIONS.md:1084-1086`: each wrapper rediscovers and overwrites inherited `*_SESSION_ID` values at start.

## 4. Tests that pin current behaviour

- **`mcp/stdio/tests/child-env-hygiene.test.js`.**
  - It requires `CLAUDE_CODE_CHILD_SESSION` and `AIFY_AGENT_ROLE` to be in the list (`:24-25`).
  - It requires every entry to carry a reason (`:30`).
  - It requires removal rather than blanking (`:39-44`), no mutation of the input (`:65-67`), and correct empty-input handling (`:72-77`).
- **`mcp/stdio/tests/terminal-env.test.js`** [APG tests_adjacent].
  - `:175-209`: every `NEVER_INHERITED` name is stripped, and `PATH` and `HOME` pass through untouched.
  - `:211-225`: the marker is absent, not `""`.
  - `:133-172`: role handling.
  - An allowlist would break the `PATH` and `HOME` assertions.
- **`mcp/stdio/tests/every-identity-source-is-neutralised.test.js:36-131`** [APG tests_adjacent]. It derives identity names from `launch-identity.mjs` and asserts that `terminalChildEnv` neutralises each, including the resolved role and id. It also requires the two flags to be `"0"` rather than removed (`:107-124`).
- **`service/tests/test_the_launch_environment_has_one_owner.py`** [APG callers].
  - Always-set keys (`:55`), overlay size and no `PATH` (`:106-113`), bridge flag (`:116`).
  - The JS agreement test (`:131-153`), which will need a decision if `terminal-env.js` is removed or changed.
- **`service/tests/test_a_spawns_env_vars_reach_its_worker.py:104-180`** [APG]. It pins the `AIFY_` refusal, case shadowing, and the rule that a session with no spec gets no extra variables.
- **`service/tests/test_a_fresh_context_launch_carries_no_session_handle.py`** calls `managed_launch_env` [APG callers]. I did not read its assertions.
- **`mcp/stdio/tests/the-environment-bridge-flag-is-retired.test.js:80-98`** reads `terminal-env.js` and `runtimes-process.js` as text.

## 5. Can this repository alone close the class?

**No.**
- The environment a worker launches with is aify-env's base environment with the service overlay merged on top (`launch_env.py:17-25`, `terminals.py:224-231`, `spawn_env.py:6-7`).
- The overlay is a name-to-string dict and cannot remove a name. By recorded decision it never carries the base environment, so the service cannot see what the host holds.
- The repo code that removes names, `withoutInheritedMarkers`, has no production caller at 7678acf3.
- On its own, this repo can only add overwrites. That neutralises a name only where the consumer treats the written value as definitive (`child-env-hygiene.mjs:23-33`). One such change would be writing `AIFY_COMMS_AGENT_ROLE` in `managed_launch_env`.
- That trick does not work for `CLAUDE_CODE_CHILD_SESSION`: the module argues `""` would still read as set, though how Claude Code actually reads it is UNVERIFIED.
- Closing the class, in either list form, needs host-side enforcement in aify-env, or a new launch-contract field such as names to remove or an allowlist that aify-env honours.
- aify-env's current merge and strip behaviour is UNVERIFIED: its code is not in this corpus.

OPS: 23 (ToolSearch not counted)