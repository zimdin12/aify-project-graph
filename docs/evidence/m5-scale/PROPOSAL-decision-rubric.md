# PROPOSAL — a decision-shaped rubric for M5, derived from measurement rather than invented

⚠ **STATUS: PROPOSAL, NOT RUN, NOT APPROVED.** The A/B spends real budget and is Steven's call.
This costs nothing. It exists so that when the answer comes, the run measures the right thing.

## Why this is not the invention the preregistration refused

`PREREGISTRATION.md` says: *"The rubric for 'better decision' is not settled, and I am not inventing
one to look complete."* That was right at the time. What is new is that
`docs/evidence/m2-construct-coverage/FINDING-what-is-actually-unmodelled.md` **measured** where each
tier sees a call and where it does not. That table makes it possible to construct cases whose
correct answer is known in advance, instead of guessing at what "better decision" means.

## The problem with the existing rubric

Both implemented types — `ordered_contains` and `groups` — score whether expected FILE PATHS appear
in the answer. That is **retrieval**. An agent can retrieve every right file and still conclude the
wrong thing, and an agent can reach the right conclusion having named a file the rubric did not
expect. The preregistration already names the failure: *"If the graph arm 'wins' that, the rubric is
measuring the wrong thing."*

## The proposed task shape: "is it safe to delete X?"

Each task asks for a verdict and requires it in a STRUCTURED form:

> Answer with a line `VERDICT: SAFE` or `VERDICT: UNSAFE`, then one line naming the evidence.

⛔ **The structured line is not decoration — it is the only defensible way to score this.** Reading a
verdict out of free prose is a classifier over text, and a classifier over text is what got fooled
twice in one session this week: a probe of mine read `NO_CALLERS` off a TRUST caveat containing the
phrase `before any "no callers"`. Asking for the answer beats inferring it.

## Ground truth by SEEDING, because scale and certainty otherwise conflict

M5 exists because fixture-scale results are not trustworthy. But in a real repo, "is it safe to
delete X" has no certain answer without expensive manual verification.

⇒ **Seed a known-answer symbol into a scratch clone of a real repo.** Scale stays real (the agent
still faces a repo where reading fails); ground truth is certain because we planted it. The seeded
construct is chosen from the measured table.

## The three cases, and the third is the one that makes this honest

| # | seeded construct | grep-armed agent | graph-armed agent | ground truth |
|---|---|---|---|---|
| **A** | `victim()` called ONLY inside an inactive `#ifdef` | finds the call text → says UNSAFE | `code_intel_references` omits it → can say SAFE | **SAFE** |
| **B** | two same-name symbols in different namespaces, one uncalled | cannot separate the caller sets | M1 identity separates them | **SAFE for the uncalled one** |
| **C** | `victim()` called ONLY through a macro | misses it → says SAFE | **also misses it** → says SAFE | **UNSAFE** |

**Case C is a case we KNOW we lose**, and it is in the set deliberately. A rubric containing only
cases the tool is built to win measures the task selection, not the tool. If the graph arm somehow
"wins" C, the run is void and something is wrong with the harness or the rubric — that is a
preregistered void condition, not a happy surprise.

⚠ Case A is also a test of ADOPTION, not only of the index: the heuristic tier reports the
inactive-branch call too (overcount), so the graph arm gets A right **only if the agent reaches for
`code_intel_references`**. That is the purpose statement's second half — the skills that teach an
agent when to reach for which — and it will be visible in the transcript either way.

## Scoring

`{ verdict, evidence }` per run. A run is CORRECT only when the verdict matches ground truth.
Naming the evidence is recorded but does NOT gate correctness — an agent that is right for the wrong
reason is still recorded as right, and the reason is there to be read.

## What this proposal does NOT settle

- **Cost.** Unchanged: 4 repos × 3 tasks × 2 arms × 3 repeats = 72 runs. Steven's call.
- **Whether seeding is representative.** A planted construct is certain but not typical; nothing
  here measures how often these shapes occur in real C++. Stated as a limit, not designed around.
- **Case B's C++ arm** needs a compile DB in the scratch clone, which the seeding step must create.
- The three cases are C/C++-shaped. A JS/Python arm would need its own constructs, and the measured
  table does not cover those languages.
