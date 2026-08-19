# Efficacy evaluation — design (pre-registered)

**Status:** design, not run. Written before any measurement, so the result cannot be chosen
after seeing it.

## The question Steven asked

Not "did the fixes work" — that is defect testing and it is done. The question is:

> Is this still good for agents? Is it a good map and knowledge system? Does it improve
> quality, and does it decrease token usage?

Three separable claims, and they can come apart: a tool can improve quality while costing more
tokens, or save tokens while being wrong, and "good map" is a third thing again.

## Why this needs a pre-registered design

⛔ This project has already shipped one efficacy claim that could not survive contact with
measurement: *"symbols appearing in >10 files — graph_whereis loses to Grep"*, retired
2026-08-18 (`docs/whereis-threshold-retirement.md`) because its stated cause was backwards and
its threshold measured the wrong quantity. It came from an A/B bench whose basis was never
written down.

★ The failure mode is not a wrong number. It is a number whose **basis** is not recorded, so
nobody can later tell what it measured. Everything below exists to make the basis recoverable.

## Pre-registered outcomes

Written before running. Each is a result I will publish whichever way it lands.

| If we observe | Conclusion I will publish |
|---|---|
| Graph arm answers ≥ control correctness AND fewer tokens | The tool helps on these tasks; cost claim supported |
| Graph arm ≥ correctness, MORE tokens | It buys quality at a cost; the cost claim is retired, not softened |
| Graph arm < correctness | It does not help on these tasks, whatever it costs |
| **Any FALSE claim in the graph arm** | ⛔ Overrides every other result. A confident wrong answer is worse than an expensive one, because the reader acts on it |

⚠ That last row is the one that matters most for this product. Our stated promise is honesty
about completeness, not completeness — so a *disclosed* gap is a pass and an *undisclosed* one
is a failure regardless of token counts.

## Design

**Arms.** Same tasks, same repo, same agent runtime, one variable:
- **GRAPH** — graph_* / code_intel_* verbs allowed, plus Read.
- **CONTROL** — Grep + Read + Glob only. No graph verbs.

**Carrier, recorded for every run** (a number without its carrier is the retired claim again):
repo + commit, MCP `server.buildId` and `startedAt`, agent runtime and model, date, and whether
the working tree was clean.

⚠ `server.buildId` MUST be verified before the first task. A stale process answers from old
code and the whole run measures nothing. This is not hypothetical: on 2026-08-18 the server ran
`9626b30` for 19 hours against a checkout that had moved 18 executable files.

**Tasks** — chosen so ground truth is independently establishable, and covering the four things
the tool claims to do:

1. **LOCATE** — "Where is `<symbol>` defined, and how many definitions exist in this repo?"
   Ground truth: exhaustive `git grep` for the declaration form, counted by hand.
2. **IMPACT** — "If I change the signature of `<symbol>`, what must change with it?"
   Ground truth: exhaustive grep for call sites, read to confirm each is a real call.
3. **ORIENT** — "I am new to this repo. What do I read first to work on `<feature>`?"
   Ground truth: the files a maintainer names, recorded BEFORE the run.
4. **DELETE-SAFETY** — "Is `<symbol>` safe to delete?" — the highest-stakes claim the tool makes.
   Ground truth: exhaustive grep + read.

At least 6 tasks, at least 2 repos: one JS (this repo) and one large C++ (echoes), because the
tool behaves differently where clangd data exists and the C++ case is where the field defects
have consistently come from.

**Measures, per task per arm:**
- `correct` — matches ground truth (yes / partial / no)
- `false_claim` — did the arm state something untrue? (the overriding measure)
- `disclosed` — where incomplete, did the output SAY it was incomplete?
- `chars_in` — total characters of tool output consumed. Reported as characters, with an
  estimated token count at 4 chars/token, and the divisor stated. Estimated, not counted.
- `calls` — number of tool invocations
- `wall_ms` — elapsed

**Ground truth is established FIRST**, written down, and not revised after seeing either arm.

## What this design cannot establish

⚠ Stated now, so it cannot be quietly omitted later:
- 6–12 tasks on 2 repos is not "the tool is good". It is evidence about these tasks on these
  repos at this commit.
- The arms are not blind. The same agent knows which arm it is in and may try harder in one.
- Token estimates are `chars/4`, the same heuristic the product uses for budgeting. It is an
  estimate and will be labelled as one.
- One tester's judgement of "correct" on ORIENT is a judgement, not a measurement. Ground truth
  recorded in advance reduces but does not remove that.
- Results do not transfer to other runtimes, other repos, or other commits.

## Roles

- **graph-senior-dev** reviews this DESIGN before anything is run, specifically for ways the
  measurement could produce a confident wrong number.
- **ef-manager** runs it, from the user's seat, after verifying `server.buildId`.
- I do not run it. I wrote the thing being measured, and every efficacy claim I have made about
  my own work this session has needed a reviewer to falsify it.
