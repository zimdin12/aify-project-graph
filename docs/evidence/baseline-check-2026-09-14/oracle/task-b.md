# Oracle, task B: "Managed spawns inherit whatever launched the bridge"

Corpus: aify-comms @ 7678acf35964b8149e686f0d06431da074785303. Built before any route ran, by rg over
every child-env spread and spawn site (oracle-work/b-spreads.txt, b-spawns.txt), reading, git history,
and two probes (oracle-work/b-probe-overlay.txt).

## Required facts (R). Stated AND cited.

R1. At this commit a managed worker's aify variables are composed by the SERVICE:
    `service/api_core/launch_env.py:101` `managed_launch_env`, returned as `launch.env` by
    `service/routers/terminals.py:293`. The process host is aify-env, a separate repo
    (`DECISIONS.md:5-27`; launch_env.py docstring :1-26), which merges that overlay over its own
    environment.

R2. `mcp/stdio/terminal-env.js` `terminalChildEnv`, the ONLY production user of
    `withoutInheritedMarkers` / `NEVER_INHERITED`, has no production importer: every reference to
    `terminal-env` outside comments and docs is a test. The environment-bridge cluster that called it
    was deleted in 779099d7 (2026-09-04) and ac6d6e82 (2026-09-05). So the KNOWN_ISSUES entry
    (:119-132) describes a launch path that no longer runs.

R3. The service overlay can only SET values; it cannot remove a host variable. `CLAUDE_CODE_CHILD_SESSION`
    and `AIFY_COMMS_AGENT_ROLE` are not in it (`ALWAYS_SET`, launch_env.py:47-60). PROBE:
    overlay lacks both, and `AIFY_AGENT_ROLE` is `""` for an unknown role, so with a host holding
    `AIFY_COMMS_AGENT_ROLE=manager` the documented resolution (`mcp/stdio/launch-identity.mjs:32`)
    yields `manager`, which is the alias bug that `child-env-hygiene.mjs:25-33` records.
    (The merge order is the docstring's claim, read in this repo; the host's code is outside it.)

R4. This repo alone cannot close the class on the live launch path: stripping must happen in the
    host, or the launch contract must gain a way to carry removals. A brief that says so, citing R1/R3
    evidence, scores R4.

R5. A recorded design choice conflicts with the entry's request: `mcp/stdio/child-env-hygiene.mjs:17-22`,
    "A DENYLIST, DELIBERATELY, not an allowlist", with the reason (a worker needs PATH, HOME, proxies,
    credentials; an allowlist's failure is a worker that cannot reach something).

## Credit facts (C)

C1. Tests pinning current behaviour: `service/tests/test_the_launch_environment_has_one_owner.py`
    (ALWAYS_SET :55-60; the agreement test :131-153 compares only `AIFY_` NAMES the JS writes, so
    stripping was never carried across); `mcp/stdio/tests/terminal-env.test.js:177-210`;
    `mcp/stdio/tests/child-env-hygiene.test.js`; `mcp/stdio/tests/every-identity-source-is-neutralised.test.js`.
C2. b809fcc8 (2026-09-14), `service/api_core/spawn_env.py`: a spawn's own `envVars` cannot set `AIFY_`
    names. A different channel (spawn-supplied, not inherited). launch_env.py:172-177 drops spawn
    names the launch writes, case-insensitively.
C3. Bridge code that still starts children spreads `process.env` without the hygiene list:
    `mcp/stdio/hermes-gateway.mjs:233`, `hermes-managed-gateway-session.js:177`,
    `codex-session.js:183`, `hermes-daemon.js:231`, `hermes-session.js:180` (blanks `AIFY_AGENT_ID` to ""
    instead of removing it); `runtimes-process.js:308-321` `runtimeChildEnv` removes only the five
    `ENVIRONMENT_BRIDGE_ENV_KEYS`.
C4. launch_env.py:23 leaves the four `*_SESSION_ID` passthroughs and CODEX_HOME to the host.
C5. `docs/PHASE8_STATUS.md:383` (a long-lived bridge kept leaking `CLAUDE_CODE_CHILD_SESSION`);
    `child-env-hygiene.mjs:3-5` "Seven places" count.
C6. PROBE, old path: `terminalChildEnv` DOES strip both markers and keeps PATH, so the regression is
    the move, not that function.

## Forbidden claims (F)

F1. `terminalChildEnv` / `withoutInheritedMarkers` builds a managed worker's environment in
    production at this commit.
F2. `CLAUDE_CODE_CHILD_SESSION` is stripped from managed workers today, or the class is closed,
    asserted without evidence (nothing in this repo supports it).
F3. The service's launch overlay removes or strips inherited variables.
F4. The recorded design chose an allowlist, or nothing recorded conflicts with one.

## Outside the corpus, for context only (NOT graded; routes are told to stay inside the corpus)

aify-env at C:/Users/Administrator/projects/aify-env @ 634e5e4 (local checkout, 2026-09-14 17:30):
`lib/plugins/aify-comms/terminal-controls.mjs:366` builds `{ ...baseEnv, ...launch.env }` with
`baseEnv = process.env`, and rg finds no `CLAUDE_CODE_CHILD_SESSION`, `NEVER_INHERITED` or
`AIFY_COMMS_AGENT_ROLE` anywhere in it (rg exit 1; the same rg run matched `AIFY_ENV_ENDPOINT`).
Read, not run: no live worker was inspected.
