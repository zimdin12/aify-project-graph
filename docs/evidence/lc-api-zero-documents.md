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

## Follow-up: does CURRENT code produce Document nodes for this repo? YES

Run without writing anything. `sweepFilesystem({ repoRoot })` is the producer of Document nodes
and returns them; it does not open or modify a graph. lc-api's existing `.aify-graph` was left
exactly as found — no re-index, no overwrite.

    aify-project-graph  POSITIVE CONTROL   Document=159   root: AGENTS.md, README.md, CHANGELOG.md, …
    lc-api              THE QUESTION       Document=10    root: AGENTS.md, CLAUDE.md, README.md

    lc-api counts: seen 2166 · admitted {Config:197, Document:10, Entrypoint:4, Schema:381, Route:6}
                   declined {ignore_rule:0, git_excluded:0, over_size_cap:2, unreadable:0,
                             not_a_special_kind:1566} · prunedDirs 5

⇒ All three root documents are admitted by today's sweep. **The live surface is clean and the
artifact is merely old.** The defect existed on 2026-04-20 and has since been closed by something
other than `ec45281`, which this evidence already showed would have admitted them anyway.

⚠ Scope, stated rather than implied: this exercises the SWEEP STAGE, which is where Document
nodes are created — not a full index end to end, and no graph was written. It establishes that
current code admits these documents. It does not establish that every later stage persists them.

⛔ What closed it between April and now is NOT identified and is not guessed. The mechanism that
dropped root markdown in the April vintage remains unnamed; this only shows it is no longer
reproducible on current code for this repo.

Cost note: the lc-api sweep took 32.7s against 0.6s for aify-project-graph.
