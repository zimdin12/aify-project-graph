# apg-pilot-09 — interview (NO-GRAPH arm, reverse question)

## The rule, in one line
> "Reach for the index when I need **leads**. Never when I need a **zero**."

## 1. Would an index have helped? No — and a sharper no
> "The two things that make this repo tricky are the two things a C++ index is most likely to
> get wrong, and there are no build files here at all, so an index would have had no compile
> database to key on. It would have fallen back to guessing include paths and macros
> **without telling me**. ... The tool disclaims the exact question I was asked."

At scale it would give "the list of files worth reading. **That is narrowing work, not
certifying work.**"

## 2. Where it flips
Past a few dozen files / few thousand lines in the plausible blast radius — or when the name
is common: "computeWeight returned 3 hits. A symbol called `get` would return 3000, and at
that point **grep stops being an instrument and becomes a pile**."

Also flips on question shape at any size: "is there any caller" is readable; "what
transitively breaks if I change this signature" is not.

## 3. What was pointless — third independent report of the same cost
> "The largest single cost of this task was not the repo. It was a failed tool lookup. I
> searched for `comms_send` and got 'No matching deferred tools found', because the real name
> is `mcp__aify-comms__comms_send`. That miss dumped roughly **600 tool names** plus every
> agent type plus every skill description into my context."

⭐ **An honest admission it volunteered:** its own controls were NOT load-bearing here,
because the answer rested on a positive finding rather than a zero. "I would run them again
... but I am not going to claim they decided anything here."

## 4. Two CHEAP fixes that would catch both traps in this corpus
Both "grep-level work rather than parsing work":
1. **Flag an `extern` declaration in a .cpp that pairs with a definition elsewhere and has no
   header** — "a caller edge invisible to every include-graph query, and it is a five-line
   regex to detect."
2. **Flag `#include "*.cpp"`** — "a unity build means per-file compile checks lie, and the
   file boundary is not the translation unit boundary."

And: "for anything answering a deletion question, **refuse to return a bare count**."

## ⭐ 5. What a ZERO would have to show to be distrusted correctly — four, all about the instrument
1. **The denominator, listed by name.** *"'0 callers' and '0 callers, indexed 6 of 8 files,
   skipped pipeline.cpp, no compile command' are different claims, and only one of them can
   be evaluated. A zero without a denominator is unreadable."*
2. **Whether it had a compile database** — "any C++ index that resolved symbols here was
   guessing, and the guess is the whole answer."
3. **Construct coverage stated as what it does NOT model** — e.g. "Not modelled:
   extern-declared symbols with no header, symbols reached through an included .cpp."
   *"This is the one that would have actually saved me."*
4. **A POSITIVE CONTROL IN THE SAME OUTPUT.** *"Report a known-called symbol next to the
   target. If it tells me computeWeight has 0 callers and normalizeInput also has 0 callers,
   the index is broken, not the codebase clean. Without that, a broken index and a genuinely
   dead symbol produce identical output, and the failure is silent in the direction I already
   want to believe."*

## ⛔ The defect statement, in its own words
> "'No callers found' and 'I could not see the caller' currently render as the same string.
> Any tool that answers deletion questions has to make those two different, or it is not
> answering the question."

## And the ceiling on any fix
> "Even a perfect zero from a perfect index would not have gotten me to yes on this one. No
> build files means I cannot see which units compile ... The best an index could have done is
> move me from 'no' to 'no evidence of a caller in this checkout'. **That is not safe, it is
> just quieter.**"

## Numbers
Declined to invent wall clock: "I did not measure wall clock, so I am not going to invent a
figure for it." 8 tool calls / 6 rounds, 4 of them the actual investigation. ~59k tokens from
session start, "the repo was a rounding error inside that, maybe 500 tokens for all eight
files ... If you want a number for the investigation itself, it is nearer 2k than 59k."
