# lc-api: 0 Document nodes — the allowlist is NOT the cause

Answers the question asked ("does that graph predate ec45281") and refutes the hypothesis
attached to it. All probes read-only; controls run in the same pass.

## The graph does predate ec45281

    manifest.json indexedAt   2026-04-20T14:41:10.756Z      (the artifact's OWN record)
    manifest.json commit      53c6fd80
    ec45281 committed         2026-08-20 09:57:59 +0300

Four months earlier. ⚠ Filesystem mtimes are NOT the basis for this: `graph.sqlite-shm` and
`-wal` are stamped 2026-08-20 19:35, and those are MY read-only opens from this session. They
must not be read as a rebuild.

## ⛔ But the allowlist would have ADMITTED all three documents

`isDocument()` exactly as it stood at cb03566 — the repo state on 2026-04-20, when this graph
was built — executed against lc-api's root documents:

    README.md   -> true
    CLAUDE.md   -> true
    AGENTS.md   -> true
    negative control  notes.md   -> false     (expected false)
    positive control  docs/x.md  -> true      (expected true)

The 12-word allowlist contained `readme`, `claude` and `agents`. Those are exactly the three
files lc-api has. The allowlist cannot explain their absence, so `ec45281` would not have
fixed this repo and re-indexing on current code is not established as a remedy.

## What the exclusion actually is

    README.md / CLAUDE.md / AGENTS.md    no node of ANY type — not Document, not File
    .md file_paths in the whole graph    0
    positive control: File nodes         1,819        .php paths  10,494

So they never reached the classifier. `isDocument` was never asked about them.

Ruled out, each checked rather than assumed:

    existed at the indexed commit?   yes — git ls-tree 53c6fd80 lists all three
                                     (added 2019-12-12, 2025-12-21, 2025-12-21)
    over the 500KB sweep cap?        no — 3,562 / 41 / 4,975 bytes
    git-ignored?                     no — .gitignore excludes CLAUDE.local.md, not CLAUDE.md
    untracked?                       no — git ls-files returns all three
    repo root never walked?          no — root WAS walked: `.psysh.php` and
                                     `_ide_helper_models.php` are nodes, 107 true root-level
                                     file paths present

⇒ Markdown at the repo root was dropped by the April-vintage sweep despite passing every gate
that is visible in `sweep.js` at cb03566. **The mechanism is NOT identified here and is not
guessed.** Root `.php` beside them was ingested, so it is specific to markdown or to those
paths, and that is as far as this evidence reaches.

## Instrument note

The first probe grepped `manifest.json` for `.md` and returned 0 — but its positive control
(`.ts`) also returned 0, so it could not return PRESENT and was discarded. Parsing the file
properly showed why: the manifest is a dirty-tracking record (`dirtyFiles: 0`, 34 path-like
strings against 15,628 nodes), not a file inventory. It cannot testify about enumeration
coverage either way, and no claim here rests on it.
