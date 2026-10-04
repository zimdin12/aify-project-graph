# Idle language servers are shut down: before and after, 2026-10-04

Steven asked whether several projects open at once could overload CPU and memory. An APG MCP server kept every live
language server until its session ended. dashboard-manager approved the fallback, an idle teardown, before any shared
per-project service, and fixed the predictions below with me before the after-run.

## Setup

- **Subject:** fmt 11.1.4 (`git clone --depth 1 --branch 11.1.4`). Configured in WSL with g++ 13 and
  `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DFMT_TEST=ON`, giving 50 compile units.
- **Language server:** clangd 18 running under WSL (`APG_CLANGD_WSL=1`). The Windows clang has no MSVC headers or
  libraries on this host, so a Windows-side compile DB would have measured a clangd missing its standard library.
- **Sessions:** `session-worker.mjs` runs APG's own code-intel verbs in-process. That is 5 references, 3 definitions
  and 2 hovers, at positions derived from the subject's text. No model is involved.
- **Driver:** `drive.mjs` samples the OS process tables about every 2.7 s:
  - WSL `ps` for clangd count, RSS and %CPU;
  - `tasklist` for Windows `clangd.exe` and `vmmemWSL`;
  - `os.freemem()` for the host's free memory.
  It counts only clangd processes that did not exist before the run. Before sampling, it checks that it can see
  processes at all.

## Results

| Run | Code | clangds at peak | Peak RSS | After the calls |
|---|---|---|---|---|
| `before-n1` | 79963ed6 | 1 | 1.03 GB | still 1 after 90 idle s |
| `before-n3` | 79963ed6 | 3 | 3.01 GB | still 3 after 120 idle s |
| `after-n3` | ab1f0887, `APG_LSP_IDLE_MS=60000` | 3 | 3.07 GB | **0 at 61.9 s** after the last call |

All 70 calls answered `ok`. No clangd was left behind after a run.

**Host:**
- The machine has 95.1 GB of RAM.
- WSL's VM (`vmmemWSL`) was already 16.9-17.7 GB before any run, from Docker Desktop and other WSL work.
- During `after-n3` it rose to 19.2 GB and fell back to 17.1 GB once the clangds exited. That release comes from
  `autoMemoryReclaim=gradual` in `.wslconfig`.
- Free memory dropped about 2.5 GB at the active peak and recovered.

## Against the predictions fixed before the after-run

- **Idle:** the count must reach 0 within the window plus 30 s, so 90 s; anything else is RED. **Met, at 61.9 s.**
- **Active:** still 3 clangds at about 3x one clangd. **Met.** 3.07 GB against a unit of 1.03 GB. The fallback does
  not share servers, and this run was not expected to show that it does.

## What this does not show

- **No sharing:** three sessions active at once on one C++ project still cost about 3 GB here. Whether that justifies a
  shared per-project server is a separate decision.
- **Repo size:** fmt is a medium library. A large engine's clangd is bigger; the unit scales with the code, and this
  measured one subject.
- **Short window:** the after-run used a 60 s window to keep it short. The shipped default is 10 minutes, so a real
  idle clangd lives up to 10 minutes after its last use.
- **CPU:** the figure is Linux `ps` %CPU, an average over each process's lifetime, not an instantaneous reading.
- **Unexplained first run:** in a discarded first attempt, free memory briefly fell to 2.7 GB. That attempt's sampler
  could not see the clangd it was meant to count, so it was fixed and rerun. The cause of that dip was not found.
