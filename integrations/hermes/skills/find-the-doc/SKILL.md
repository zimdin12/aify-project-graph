---
name: find-the-doc
description: "Use for 'where is the design doc', 'did we write this down', 'what explains this file', 'what do I know that I have forgotten I know', or when you half-remember a document and cannot name it. Leads with the direction that is precise, states the direction that is not, and tells you when to stop and grep."
---

# Find the doc

<!-- APG-SAFETY-CONTRACT: 2026-08-22-doc-recall-floor -->

This exists for one measured problem:

> *"my agents constantly forget where what files where. my agent asked me today where the game
> design doc is. he has worked on the project for 2 months already. he has read it multiple times,
> but compactions and stuff make him forget that it even existed."*

⭐ **That is a DISCOVERY problem, not a lookup problem.** Grep cannot find what you do not know to
search for. Your context is erased on every compaction; the repository's map is not.

⛔ **And this toolset is much better at one direction than the other.** Read the next section before
you trust either.

## The two directions, and they are not equally good

**① FROM CODE TO DOCUMENTS — precise. Start here whenever you can.**

You have a file or a symbol, and you want the documents that discuss it. Every doc→code edge in the
graph was admitted by a rule that requires evidence *adjacent to the reference*: a `Class.method`
qualifier, or a file path in the same line. Graded blind by an outside party on three corpora that
had never been indexed:

    doc_ref:path-scoped    89 / 89     lower bound ~0.959
    doc_ref:qualified      35 / 35     n=36, lower bound ~0.90

⚠ Those are *evidence* the rules clear a 0.95 floor, not proof, and the qualified sample is too
small to establish it. But an edge you get back is one you can open and check in a second, and it
carries the real line it came from.

⇒ A third rule was **deleted** at 0.9311 for admitting a Go `init()`, an author's declared
`trace(a,b)` notation, and another repository's `forward()`. If you remember the tool returning
noise here, that is why, and it is gone.

**② FROM A TOPIC TO DOCUMENTS — low recall, and the floor is real.**

You half-remember a subject and cannot name the file. The searchable surface for a document is
**its filename, its title, and its headings**. Bodies are not indexed anywhere in this system.

    measured on one repo:   name|title reached 3 documents over 10 topics; headings reach 52
    measured on another:    1 of 4 topics that were genuinely present

⛔ **The second number is the one to plan around.** That corpus was audits and session logs whose
headings are dates and role names rather than subjects. **A topic nobody wrote into a heading is
unreachable here** — not ranked low, unreachable. `git grep` finds all of it.

## How to run it

**If you have a file or symbol** — direction ①:

```
graph_pull({ node: "path/to/file.js" })      # the `docs` layer lists documents that reference it,
                                             # each with the LINE the reference appears on
graph_search({ query: "SomeClass.method", kind: "all" })
```

⚠ **If `layers.docs` is missing from the response, your server predates 2026-08-22.** It used to be
opt-in behind an explicit `layers: ["docs"]`, which is the single best explanation for why this
layer had no users: nobody passes a parameter for a layer they do not know exists. On an older
build, pass it by hand.

**If you only have a topic** — direction ②:

```
graph_search({ query: "conservation", kind: "all" })
```

⚠ `kind: "all"` is required. The default is `kind: "code"`, which excludes documents entirely — you
will get a clean, confident, wrong nothing without it.

## ⛔ When it returns nothing, read what it says and then STOP USING IT

A zero from direction ② now names its own scope:

> *Scope searched for documents: FILENAME, TITLE and HEADINGS only — document bodies are not
> indexed. A topic discussed inside a document but never written into a heading is not reachable
> here, so this zero is NOT evidence the topic is absent from the repo.*

⇒ **Believe that sentence.** It was added because the tool answered *"NO RESULTS for 'denoiser'.
Ruled out: the index is fresh."* on a corpus containing **eleven** documents about denoisers. The
zero was a three-state instrument reporting two: PRESENT and ABSENT, with NOT-SIGNPOSTED collapsed
into ABSENT. Ruling out staleness — a cause nobody suspected — made the wrong answer *more*
confident.

⇒ **On a zero, go to `git grep` and say you did.** Noise is visibly noise; a confident zero is not.
The one failure mode this skill exists to prevent is you asking "what do I know that I have
forgotten I know", getting an authoritative-sounding nothing, and stopping.

## What to report back

Name the direction you used and what it does not cover. "graph_pull found two documents referencing
this file" is a strong claim. "graph_search found nothing" is **not** a claim that nothing exists —
it is a claim about filenames, titles and headings, and it should be written that way or followed by
a grep.
