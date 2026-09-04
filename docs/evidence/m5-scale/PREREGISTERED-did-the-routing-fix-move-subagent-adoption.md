# Preregistered: did the auto-memory routing fix move subagent adoption?

**Written 2026-09-04, when the answer is not yet knowable.** Independent post-fix transcripts: **0**.
That is the point — every rule below was fixed while the outcome could not be seen.

## What was fixed, and what is unproven about it

On 2026-09-03 20:04:28Z a routing instruction was written into the auto-memory
(`memory/graph-tools-are-deferred.md`), which is the one channel probing showed reaches subagents:
`AGENTS.md` and `CLAUDE.md` do not, and the graph verbs are deferred rather than absent.

It was verified end to end, once, on one fresh subagent that was never told what the instruction
said. **That is a mechanism proven, not an outcome measured.** A green badge is not a job that ran,
and treating the probe as evidence the fix worked in the field is the error this document exists to
prevent.

## The baseline is NOT the 0.8% I have been quoting

`9 / 1116 = 0.806%` includes `C--Docker-aify-project-graph`, the project directory where this tool
is built and where I spawn the probes that verify it. **Six of those nine calls are mine.** Measured
2026-09-04 with `--exclude-project=C--Docker-aify-project-graph`, both controls passing in the same
pass:

| Population, my own project directory EXCLUDED | Count | Rate |
|---|---|---|
| Subagent sidechains with ≥1 graph call | **3 / 973** | **0.308%** |
| Top-level sessions with ≥1 graph call | 13 / 32 | 40.6% |

⇒ **The field baseline is 0.308%, and every future comparison uses it.** The higher figure measured
my own instrumentation and flattered the tool.

## The decision rule, fixed before the data exists

**Population.** Subagent sidechain transcripts (nested `.jsonl`), whose OWN first-line timestamp is
at or after `2026-09-03T20:04:28.335Z`, in every project directory EXCEPT
`C--Docker-aify-project-graph`.

⚠ The timestamp is the transcript's own, never the file's mtime: a session already open when the fix
landed keeps being appended to, so mtime would admit exactly the transcripts the cutoff exists to
exclude.

**Test.** One-sided exact binomial against `p0 = 3/973`, α = 0.05.

**Stopping point and critical value — do not read the outcome before n reaches this.**

| n | reject when k ≥ | power at 1% | at 3% | at 5% | at 10% |
|---|---|---|---|---|---|
| 50 | 2 | 0.089 | 0.445 | 0.721 | 0.966 |
| **100** | **2** | 0.264 | **0.805** | 0.963 | 1.000 |
| 200 | 3 | 0.323 | 0.941 | 0.998 | 1.000 |

⇒ **n = 100, reject at k ≥ 2.** That buys 80% power against a 10× improvement (0.31% → 3%) and
essentially none against a doubling, which is stated here rather than discovered afterwards.

**Verdict gate.** The verdict is not rendered unless the positive control (`Bash`/`Read`/`Grep`
tool_use blocks non-zero) PASSES IN THE SAME RUN. On today's window it FAILS — an empty population
records no tool calls at all, so the instrument cannot demonstrate it works, and "0 of 0" is not a
result. A control that fires and is overridden is worse than no control.

**What each outcome means, written now:**

- **k ≥ 2 at n ≥ 100** — the instruction-level fix moved the number. Report the interval, not a point.
- **k < 2 at n ≥ 100** — the instruction-level fix is **refuted at 10× effect size**. A separate
  agent definition with the graph tools preloaded comes back on the table. That is the option Steven
  asked me to avoid if instruction-level worked, so the refutation has to be paid, not explained.
- **n < 100** — no verdict. Say so and wait.

## Today's reading, and why it is not a result

```
window since 2026-09-03T20:04:28.335Z, own project dir NOT excluded
  subagent transcripts in window : 1
  with >= 1 graph call           : 1
  [POSITIVE CONTROL] Bash/Read/Grep tool_use blocks : 0   <- FAILS, correctly
  classifier cross-check (depth rule vs the transcripts' own isSidechain field) : 0 disagreements
```

That one transcript began **12 seconds** after the memory file was written, and its first prompt
reads *"You are a measurement probe... I am testing whether a piece of routing knowledge reaches
subagents through the channel I put it in."* It is the verification of the fix. Counting it would be
measuring my own prompt.

⇒ **Independent post-fix transcripts: 0. Elapsed: 5 hours.** Nothing here is a rate.

## Claim ceiling

⛔ One machine, one person's agents. It is a biased sample of the use that matters, and it is not
evidence about anyone else's fleet.

⛔ It measures Claude Code only. Whether a Hermes `delegate_task` child inherits MCP tools is still
UNVERIFIED — the OpenAI pool has been at 0% throughout.

⛔ Adoption is not usefulness. A subagent calling the verb says the routing reached it, not that the
answer helped. That question is the A/B's, and the A/B has its own preregistered bound.
