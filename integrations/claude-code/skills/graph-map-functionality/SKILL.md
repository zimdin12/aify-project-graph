---
name: graph-map-functionality
description: Use when the user asks to "map out", "extract", "generate", or "propose" a functionality map / feature layer for the repo. Produces or updates `.aify-graph/functionality.json` based on the code graph, directory structure, docs, and recent commits. Never overwrites user edits silently — always diffs and confirms.
---

# graph-map-functionality

You are helping the user create or refresh the L2 functionality overlay at `.aify-graph/functionality.json`. This is the human-curatable feature map that links code to the user's mental model.

## What you are producing

A JSON file that conforms to this shape:

```json
{
  "version": "0.1",
  "features": [
    {
      "id": "short-kebab-id",
      "label": "Human Readable Name",
      "description": "One sentence: what this feature does for the user.",
      "anchors": {
        "symbols": ["functionName", "ClassName", "Class.method"],
        "files": ["path/to/glob/*", "specific/file.py"],
        "routes": ["POST /api/endpoint"],
        "docs": ["docs/feature.md"]
      },
      "source": "llm",
      "tags": ["domain-tag", "layer-tag"]
    }
  ]
}
```

## Source precedence (what signals to use, in order)

1. **Existing `.aify-graph/functionality.json`** — if one exists, this is user-curated truth. You are refining it, not replacing it. Preserve feature ids, labels, and descriptions verbatim unless the user explicitly asks to regenerate.

2. **`.aify-graph/brief.json`** — machine-readable graph summary. Read it first. Use `subsystems`, `hubs`, and `entrypoints` sections to propose feature boundaries.

3. **Directory structure** — subsystem paths (e.g. `mcp/stdio/ingest/`, `app/Http/Controllers/`) often map 1:1 to features on well-organized codebases.

4. **README / ARCHITECTURE docs** — if they mention features or domains explicitly, honor those names in your `id`/`label` choices.

5. **Recent commit messages** — `git log --pretty=format:%s -n 50` gives you the vocabulary the team actually uses for features (e.g. if commits say "auth:", use `auth` as the feature id, not `authentication`).

## Steps

1. **Read the graph context:**
   ```
   cat .aify-graph/brief.json
   ```
   If missing, tell the user to run graph indexing first (`graph_index` MCP tool or `node scripts/graph-brief.mjs <repoRoot>`).

2. **Check for existing overlay:**
   ```
   cat .aify-graph/functionality.json 2>/dev/null
   ```
   If it exists: you're refining. If not: you're creating from scratch.

3. **Sample the vocabulary:** read the top-5 subsystems' README/top files to understand domain language. Read `git log --oneline -30` for commit vocabulary.

4. **Draft features:**
   - One feature per well-defined subsystem. Don't split features finer than the user's code organization unless they ask.
   - `id` should be kebab-case, short, and match commit/PR terminology where possible.
   - `label` is human-friendly.
   - `description` is ONE sentence; if you can't explain it in one, the feature is probably too broad or too vague.
   - `anchors.symbols`: pick 2-4 hub symbols or canonical entry points from brief.json hubs
   - `anchors.files`: prefer globs like `src/auth/*` over listing every file
   - `anchors.routes`: only include if routes are a real concept in this repo
   - `anchors.docs`: only include if feature-specific docs exist
   - `source: "llm"` on newly-drafted features

5. **Preserve user edits:** for any feature that already exists in `.aify-graph/functionality.json`:
   - Keep its `id`, `label`, `description`, `tags` as-is
   - You may propose anchor additions or removals, but present them as DIFFS, not replacements
   - Preserve `source: "user"` on features the user has edited

6. **Validate before writing:**
   - Each anchor symbol should appear in `brief.json`'s hubs or be a known top-level function name
   - Each file glob should match at least one file in the repo (`ls` or `find` to check)
   - Each route anchor should plausibly exist — if you don't see routes in brief.json, drop the field

7. **Show the user a diff** before writing:
   - If the file exists: show added / removed / modified features
   - If creating: show the full proposed file

8. **Write only on user confirmation.** Then tell them to regen briefs:
   ```
   node scripts/graph-brief.mjs <repoRoot>
   ```
   Watch the brief's TRUST line for stale-anchor warnings after regeneration.

## What NOT to do

- **Don't make up features** that don't correspond to real code. Anchor everything to something the graph can verify.
- **Don't overwrite user-curated features** silently. `source: "user"` features stay untouched unless the user explicitly asks for refresh.
- **Don't produce more than ~10 features** unless the repo genuinely has that many. A map with 25 features nobody can remember is worse than one with 5 clear ones.
- **Don't invent routes/docs anchors** when the repo has none. Empty arrays are fine.
- **Don't guess symbol names.** If you're not sure a symbol exists, leave it out and add a file anchor instead.

## Example output

For a Laravel API repo, a reasonable first draft might look like:

```json
{
  "version": "0.1",
  "features": [
    {
      "id": "auth",
      "label": "Authentication & tokens",
      "description": "User login, API token validation, and session handling.",
      "anchors": {
        "symbols": ["RequireToken.handle", "authenticate"],
        "files": ["app/Http/Middleware/RequireToken.php", "app/Http/Controllers/Api/Auth/*"]
      },
      "source": "llm",
      "tags": ["http", "security"]
    }
  ]
}
```

Short, precise, anchored. That's the target.
