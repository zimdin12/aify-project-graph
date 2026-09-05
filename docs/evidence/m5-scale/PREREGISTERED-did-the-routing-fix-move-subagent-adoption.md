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

## The baseline is not 0.8%, and it is not 0.31% either. It is ZERO.

`9 / 1116 = 0.806%` includes `C--Docker-aify-project-graph`, the project directory where this tool
is built and where I spawn the probes that verify it. Excluding that directory gave `3 / 973 =
0.308%`, and I was about to preregister against that.

⛔ **A reviewer then pointed out that the directory is a PROXY for the property that matters**, which
is *was this agent told to call the graph*. So I read the opening prompt of all **11** subagent
sidechains that have ever made a real graph `tool_use` call, and classified by content instead:

| When | Project directory | Opening prompt |
|---|---|---|
| 2026-06-02 ×4 | aify-project-graph | *"Design 3 HARD, GREP-HOSTILE tasks for an A/B eval"*, then *"CONDITION B (treatment). USE the aify-project-graph graph tools"* |
| 2026-07-26/27 ×3 | **sand-castle** | *"TOOL EVALUATION of aify-project-graph… you may ONLY use `mcp__aify-project-graph__*` tools"* |
| 2026-08-25 ×2 | aify-project-graph | *"★ THIS REPOSITORY HAS THE aify-project-graph MCP SERVER AVAILABLE… run ToolSearch"* |
| 2026-09-03 ×2 | aify-project-graph | *"You are a measurement probe…"* |

**Every one was instructed. None was organic.** And the proxy failed in exactly the direction the
reviewer warned about: three of them sit in *sand_castle's* directory, so a directory rule keeps my
own tool evaluations in the field population.

⇒ **The organic subagent adoption rate is `0 / 973`. No subagent on this machine has ever reached
for the graph without being told the tool exists.**

That is not a smaller version of "0.8% adoption". It is a different statement: the layer carrying 31×
the transcript volume has never spontaneously used this tool, and the auto-memory routing fix is the
first intervention that could change it.

⚠ **The mechanical filter (`--exclude-instructed`) reports `1 / 974`, not `0 / 973`, and the
difference is a known hole rather than a disagreement.** It matches the tool's name in the opening
prompt; the one survivor is my own June eval-design subagent, whose prompt says *"a
code-intelligence tool"* and *"symbol/call-graph tool"* without ever naming it. I am **not** widening
the marker list to catch it — tuning a filter until it produces the number I already believe is how
a screen ends up selecting its own answer. The filter is an approximation with one documented miss;
the content read is the finding.

## The decision rule, fixed before the data exists

**Population.** Subagent sidechain transcripts (nested `.jsonl`), whose OWN first-line timestamp is
at or after `2026-09-03T20:04:28.335Z`, with BOTH exclusions applied:

    --exclude-project=C--Docker-aify-project-graph   where my own instrumentation lives
    --exclude-instructed                             opening prompt names the tool

Both, not either. The directory rule alone kept three of my own tool evaluations that ran in
sand_castle's directory; the content rule alone has the one documented miss above. Together they are
strictly more conservative than either, and every transcript they drop is one that could only have
inflated the result.

⚠ The timestamp is the transcript's own, never the file's mtime: a session already open when the fix
landed keeps being appended to, so mtime would admit exactly the transcripts the cutoff exists to
exclude.

**Test.** One-sided exact binomial against `p0 = 3/973 = 0.31%`, α = 0.05.

⚠ **Where that `p0` comes from now that the observed baseline is zero.** An exact test against a
point null of 0 is degenerate — any single call rejects it, which would make one curious agent look
like a fixed product. So the null is the **95% upper confidence bound consistent with 0 of 973**,
which by the rule of three is `3/973`. It lands on the same number I had before for a different and
better reason, and it is the conservative choice: it is the highest organic rate the pre-fix data
cannot rule out.

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

## ⛔ CORRECTION 2026-09-05 — that control did not fail correctly. It was on the wrong population.

The line above reads *"[POSITIVE CONTROL] ... 0 <- FAILS, correctly"*, reasoning that an empty
population records no tool calls. **The population was not empty. The control was counting a
different one.**

`measure-verb-adoption.mjs` counts two populations and is emphatic that they must never be merged:
top-level SESSIONS, and nested subagent SIDECHAINS. Every `n` in this document comes from the nested
population. The published `controls.positive` was summed over the top-level tallies only. Measured
today, in this window:

| population | transcripts | Bash/Read/Grep tool_use blocks |
|---|---|---|
| top-level sessions | 0 | 0 — the number that was published as the control |
| **subagent sidechains (what `n` counts)** | **6** | **255** |

⇒ The instrument was demonstrably seeing tool calls in the population it was measuring, and said it
was blind. Same arithmetic, wrong noun.

**What it changes, and what it does not.** The verdict gate says no verdict is rendered unless the
positive control passes in the same run. Left alone that gate could never have opened, because the
control could not fire on the measured population however long the corpus grew. It does **not**
change the 2026-09-04 conclusion: `n` was 0 that day and the rule is "n < 100 — no verdict".

Fixed in `scripts/lib/population-controls.mjs`: each population is graded on its own counts, and an
empty population is **undecided** rather than passing — 0 of 0 demonstrates nothing in either
direction.

## ⛔ CORRECTION 2026-09-05 — and `n` itself was being carried in prose

`n` was tracked in a loop prompt across cycles, with no record of the command or the filters that
produced it. It read **16** for two cycles. Re-measured today it is **5**, and 16 is not reproducible
under any combination of the exclusion filters, the cutoff, or mtime-versus-first-timestamp:

| reading | nested in window |
|---|---|
| both preregistered exclusions | 5 |
| directory exclusion only | 5 |
| instructed exclusion only | 5 |
| no exclusions | 6 |
| by file mtime instead of first timestamp | 6 |
| independent filesystem walk, no shared code | 6 |

A count over a fixed cutoff cannot shrink — a transcript that was in the window stays in it — so
either the corpus lost files or 16 was never a reading of this noun. **I cannot tell which, and say
so rather than pick the flattering one.** The series restarts today from a recorded reading.

⇒ `docs/evidence/m5-scale/N-LEDGER.tsv`, appended by `node scripts/n-ledger.mjs`. Each row carries
`n`, the controls that ran in the same pass, the exclusion counts and the SHA of the instrument, and
the command exits non-zero if `n` ever drops. It prints only the population side, never the gated
outcome, so it is safe to run every cycle.

## Claim ceiling

⛔ One machine, one person's agents. It is a biased sample of the use that matters, and it is not
evidence about anyone else's fleet.

⛔ It measures Claude Code only. Whether a Hermes `delegate_task` child inherits MCP tools is still
UNVERIFIED — the OpenAI pool has been at 0% throughout.

⛔ Adoption is not usefulness. A subagent calling the verb says the routing reached it, not that the
answer helped. That question is the A/B's, and the A/B has its own preregistered bound.
