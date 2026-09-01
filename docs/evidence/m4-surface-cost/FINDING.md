# M4, first half — what `tools/list` actually costs, measured from the shipped server

M4's stop condition has two halves: **the per-session cost** and **the reached-verb distribution
over ≥6 task shapes**. This is the first half. The second is not measured here and is not claimed.

## Method

Spawned the shipped `mcp/stdio/server.js` once per profile, sent a real `initialize` +
`tools/list`, and weighed the bytes of the response. **Not reconstructed** — `selectListedTools` is
not exported, and reimplementing it here would have measured my copy of the rule rather than the
rule.

Carrier: `scripts/m4-tools-list-cost.mjs`.

## Result

| profile | tools listed | bytes | ~tokens (est.) | schema share | description share |
|---|---|---|---|---|---|
| **default** | 16 | **25,539** | ~6,385 | **70%** | 24% |
| full | 32 | 45,754 | ~11,439 | 71% | 23% |
| lean | 6 | 11,771 | ~2,943 | 58% | 37% |
| code-intel | 11 | 22,158 | ~5,540 | 61% | 34% |

Controls, same pass:
- **POSITIVE** — every profile returned a non-empty list. A failed spawn would report 0 bytes and
  read as "free".
- **NEGATIVE** — an unrecognised profile name falls back to `default` (16 tools, identical bytes),
  not to an empty or full list.

## Claim ceiling

**Bytes are exact.** They are the measured length of the actual `tools/list` result.

**Tokens are an ESTIMATE** at 4 bytes/token. No tokenizer was run. Every token figure here is
approximate and must not be quoted as a measurement.

This says nothing about how often a session pays it (once per session, but sessions per task is
unmeasured), and nothing about which verbs get reached.

## ⚠ THE DENOMINATOR IN "3 OF 43" IS THE WRONG NOUN

The milestone is framed as *"agents reached 3 of 43 verbs"*. The registry holds 43, but that is not
what an agent is shown:

- the **default** profile lists **16**
- **full** lists **32** — eleven are hidden even from it
- the rest stay callable by name but are never listed

So the denominator for "reached" should be what was **listed**, not what exists. **3 of 16** is a
materially different statement from 3 of 43, and the more alarming version is the one with the wrong
noun. Any narrowing argument built on 43 is arguing against a surface no agent was offered.

## What this does NOT license

M4 says explicitly: **do not narrow on this pilot's data — two tasks cannot license retiring 40
verbs.** This measurement does not change that. It establishes the price, not whether the price is
too high, and the reached-verb distribution over ≥6 task shapes remains unmeasured.

One observation for whenever that decision is taken: **70% of the default payload is schema, not
description.** If narrowing is ever justified, schema is where the bytes are — trimming descriptions
would move a quarter of the payload at most.
