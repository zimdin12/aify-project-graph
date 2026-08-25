# Preregistration — A/B on the task classes we have never measured

**Written BEFORE any arm ran.** Steven asked for the proof, with two arms: one told to use the
aify-project-graph tools where they help, one forbidden.

## Why this is not the 2026-08-19 pilot again

That pilot measured **LOCATE** and found nothing, because grep is at 100% there — we spent it on
the one class where we cannot help. Its other four deviations are addressed here:

| pilot deviation | here |
|---|---|
| ran against an open NO-RUN gate | this doc is the gate, written first |
| one session per arm across all tasks | one fresh subagent per task per arm — 10 runs |
| **isolation SELF-REPORTED** | **verified mechanically**: `measure-verb-adoption.mjs` counts `tool_use` blocks in each arm's transcript. A baseline run with any `mcp__aify-project-graph__*` call is DISCARDED, not excused |
| no token instrument | still none. Tool CALLS are reported as a weak proxy and nothing is claimed about tokens |
| post-hoc interpretation | grading rule and predictions fixed below |

## Carrier, and why not a C++ repo

**`C:/Docker/aify-project-graph` @ `0d1fd1d`.** JS. Indexed; doc layer reachable since 2026-08-22.

⛔ **A C++ repo is disqualified today.** 2026-08-25 established that a clangd without the MSVC
environment returns empty caller sets for any TU including a standard header. On such a carrier a
null result cannot distinguish *"the tool does not help"* from *"the tool is broken here"*, and
that confound would invalidate the whole run.

⚠ **Carrier weakness, stated up front:** this repo **names documents after their incidents**
(`2026-08-25-adoption-is-an-install-problem.md`). `ls | grep` therefore answers many discovery
questions outright. sc-manager reported exactly this from the field. To make the discovery tasks
test discovery rather than lookup, **every prompt is phrased in a user's words, never the repo's
vocabulary** — the agent must not be handed the search term. Where a prompt unavoidably contains
repo vocabulary (DS1, D2) that is noted per task.

## Tasks and ground truth — established independently, before the prompts were written

**D1 — DISCOVERY.** *"I'm about to change how this tool decides its stored data is out of date
compared to the working tree. Has that been worked on before? What was decided, and what should I
not redo?"*
GT: the `mcp/stdio/freshness/` module (`worktree-state.js`, `orchestrator.js`, `manifest.js`);
decisions include an unresolvable indexed commit forcing a rebuild rather than advancing
(`9c94586`) and one worktree observation per read so disagreement is unconstructible (`53718b9`).
Repo vocabulary withheld: "freshness", "staleness", "manifest".

**D2 — DISCOVERY/SYNTHESIS.** *"A teammate says this tool can tell you when it's safe to delete a
function. Can it, today? Where is that written down?"*
GT: **No.** `evidence.exhaustive` is withheld on every verb (`index_population_unattested`);
withdrawn for references 2026-08-19 and for hierarchy 2026-08-25. Recorded in
`integrations/*/skills/cpp-inner-loop/SKILL.md`, README, `docs/known-limitations.md`.
⚠ Contains repo vocabulary ("safe to delete") — this tests whether the honesty machinery is
REACHABLE, not discovery. A wrong answer here is the dangerous kind.

**D3 — DISCOVERY.** *"We link documentation to code somehow. I heard one of the linking approaches
was thrown out. Which one, why, and what number decided it?"*
GT: doc-ref **rule 3** deleted at **0.9311** held-out precision against a 0.95 floor (`c8dcb2e`);
prereg `docs/2026-08-22-prereg-heldout-doc-ref-precision.md`. The legacy `mentions` extractor was
also deleted (`d0eb188`, 2533 edges → 1). Either, correctly numbered, counts.

**I1 — IMPACT.** *"If I change the signature of the function that picks which compile database to
use, what else has to change?"*
GT: `prepareCompileDb` is consumed in **5 files** — `code-intel/backends.js:21`,
`code-intel/cli/doctor.js:81`, `code-intel/providers/cpp-clangd.js:162`,
`query/lsp-evidence.js:262`, `query/verbs/code_intel_analyze.js`.

**DS1 — DELETE-SAFETY.** *"Is `parseUnityIncludes` dead code? Can I remove it?"*
GT: **No.** Called at `compile-db.js:556` inside `expandUnityEntries`, plus 4 assertions in
`tests/unit/code-intel/compile-db-unity.test.js`. ⚠ Contains the symbol name, so this is the
LOCATE-adjacent class; included because "safe to delete" is the product's central claim and a
wrong answer is destructive.

## Grading, fixed now

Per task: **CORRECT** (matches GT on the load-bearing fact), **INCOMPLETE** (partial, nothing
false), **WRONG** (asserts something false — for D2/DS1, any claim that deletion is safe).
A **WRONG** on D2 or DS1 outweighs any number of correct answers elsewhere: those are the ones
that delete code.

## ⭐ PREDICTIONS — stated before the run, and I expect to be embarrassed by them

1. **No correctness advantage for the augmented arm on any of the five.** This repo is small, JS,
   and names its docs after their topics; grep should reach every answer.
2. **The augmented arm makes MORE tool calls**, replicating 2026-08-19 (9 vs 15/21).
3. **Both arms answer D2 correctly** — the honesty text is in the README and the skills.

**What would falsify prediction 1:** the augmented arm CORRECT where the baseline is WRONG or
INCOMPLETE on ≥1 task. That is the only outcome that supports the product thesis, and I am
predicting against it.

**What a null means:** on these five tasks, on this carrier, the tools did not change the answer.
It would NOT mean the thesis is dead — it would mean this carrier cannot test it, because a repo
whose filenames encode its topics has no discovery problem to solve. That reading is fixed now so
it cannot be invented afterwards.
