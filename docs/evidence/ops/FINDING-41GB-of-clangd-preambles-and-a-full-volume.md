# The volume hit 0 bytes free, and 41 GB of it is clangd preambles

Found 2026-09-04 because a `run-suite.mjs` invocation died mid-run with `ENOSPC: no space left on
device`. **The suite could not be measured**, and the harness reported the crashed run as
*completed (exit code 0)* — the thirteenth time that notification has been wrong in the reassuring
direction.

⛔ My first diagnosis was wrong and is recorded here rather than quietly replaced: I attributed the
crash to my own `| tail -4` closing the pipe. It was the disk. A plausible cause I had authored
myself was easier to believe than one I had to go and measure.

## What is on the volume

```
C:  1.9 TB  100% used  0 bytes free at first read (5.2 GB by the time the scan finished)
  Users/Administrator/AppData/Local/Docker    979 GB
  Users/Administrator/AppData/Local/Temp      180 GB
  Program Files + Program Files (x86)         135 GB
  Windows                                      56 GB
```

**Docker is the volume.** Nothing below changes that, and reclaiming it is not mine to do.

## The 41 GB that IS ours to explain

```
files matching *preamble* in %TEMP%   2,181
total                                 41.28 GB
oldest                                2026-09-02 04:36
newest                                2026-09-04 04:20
written in the hour before the scan     352
largest single file                   22.6 MB
```

A `.pch` preamble is what clangd writes per translation unit when `--pch-storage` is left at its
default of `disk`. This is the same defect as the 84.2 GB incident of 2026-09-02, whose fix
(`9580e082`, `--pch-storage=memory` on the `serve-lsp` spawn path) landed at **08:11 that morning**.
The oldest surviving preamble predates that fix by three and a half hours.

## Whose translation units

Read out of the newest 22.6 MB preamble, by opening it and extracting embedded paths:

```
C:\Users\ADMINI~1\AppData\Local\Temp\m7-tree-opkjs5d6\engine\gpu\GPU.h
C:\Users\ADMINI~1\AppData\Local\Temp\m7-tree-opkjs5d6\sim\fields\UnifiedFluid.h
C:\Users\ADMINI~1\AppData\Local\Temp\m7-tree-opkjs5d6\sim\terrain\Pixel.h
                                       ... 12 distinct headers, one tree
```

⇒ A **disposable temp worktree** belonging to the sand_castle engine, not this repository.

## What is established, and what is not

**ESTABLISHED**
- Our code has the fix on every spawn path today: `--pch-storage=memory` in `resolve-clangd.js:162`,
  with `tests/unit/code-intel/every-clangd-spawn-bounds-pch.test.js` guarding all of them.
- One `aify-project-graph` server process (pid 87516, `--toolset=lean`, parent `codex.exe`) has been
  running since **2026-08-31 19:44** — before the fix — and is therefore executing pre-fix code that
  spawns clangd with default disk storage. The other 14 all started 2026-09-03, after it.
- The preambles belong to a sand_castle temp worktree.

**NOT ESTABLISHED — and I watched for it rather than asserting it**
- That pid 87516 produced these files. I watched for 150 s for any `clangd` process: **none
  appeared, and the count held at 2,181.** So the producer is not running now, and I could not catch
  it in the act.
- ⛔ Which corrects my own words from an hour earlier. On reading a 04:20 timestamp I called the leak
  "live". It produced as recently as 04:20 and produced nothing in the 150 s I watched. Those are
  different claims and only the second one is measured.

## Recommendation, for Steven

1. **The 41 GB of `%TEMP%\preamble-*.pch` is regenerable compiler cache and is safe to reclaim** —
   but the files belong to sand_castle's tooling, and deleting data is his call, so nothing has been
   deleted. Every number above was taken first, because this project's own record is that the
   evidence gets destroyed before it is analysed.
2. **Restart the pre-fix server (pid 87516).** A server started before a fix holds the old code for
   as long as it lives — already recorded here as *pull ≠ restart* — and this is the only live
   process that can still spawn a disk-PCH clangd from our source.
3. **Docker's 979 GB is the actual problem** and is outside this project entirely.
