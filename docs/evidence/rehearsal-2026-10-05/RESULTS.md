# Usefulness-trial rehearsal: results (2026-10-05)

The rehearsal of the v0.8 usefulness trial (aify-dashboard docs/PREREGISTRATION-v0.8.md), agreed with
dashboard-manager. Protocol: [PROTOCOL.md](PROTOCOL.md). It touched none of the trial's frozen material.

## Headline: the treatment was never delivered
In arm A, the dashboard held APG's feature map (94 nodes; for T1 the callers-and-callees description states the
answer). **The layer reached the agent in 0 of 8 arm-A runs, across all three carriers:**

| carrier | runs | dashboard calls | layer / seen |
|---|---|---|---|
| natural (task prompt only) | 4 (T1, T2 × Claude, Hermes) | 0 | 0 / 0 |
| one-line nudge in the prompt (fixed before the runs, cfb83c20) | 2 (T1) | Claude 0; Hermes 5 (whoami, state 404, empty events/documents/tasks; never listed graphs) | 0 / 0 |
| bridge server instructions (dashboard c26fd99 on 9782; no nudge) | 2 (T1) | 0 | 0 / 0 |

- **Both runtimes defer MCP tools behind a search step.** Claude showed the dashboard tools' names only, in a
  system-reminder. Hermes showed only `hermes_tool_search`.
- **Instructions:** Claude received the bridge instructions. Its session holds the text twice, and the 9781 control run
  holds it 0 times. It still made 0 ToolSearch calls and 0 dashboard calls. In the probe, Hermes did NOT receive them:
  it answered NONE while connected to the bridge (27 tools), and its v0.21.5 source shows no code path that reads a
  stdio server's `instructions`.
- **Both preregistered predictions were refuted:** the nudge (both runs reach the layer) and the instructions (at least
  one run does). So a nudge-based trial design is off, as worded and on this project shape. The project shape is
  itself a confound: the scratch project holds only the graph; its State, documents and tasks are empty.
- **Grading (graph-senior-dev, three locked steps, [grading/HANDINS.md](grading/HANDINS.md)):** "No difference I would
  call a condition effect … This is a failed treatment-delivery rehearsal, not evidence that a consumed layer is useful
  OR useless."

## Every run
All 12 runs are valid. None is VOID: 0 APG calls, 0 credential reads, 0 writes outside the arm root. The tokens
cross-check (Claude: transcript vs cost-state; Hermes: usage file vs state.db). Each root was reset to its base tree
after its run.

| run | task | wall s | tool calls | dashboard calls | layer/seen | cache read | output |
|---|---|---|---|---|---|---|---|
| rh-claude-a-t1 | T1 | 1104 | 14 | 0 | 0/0 | 607701 | 4675 |
| rh-claude-a-t1i | T1, instructions | 468 | 12 | 0 | 0/0 | 478105 | 4262 |
| rh-claude-a-t1p | T1, nudge | 1427 | 25 | 0 | 0/0 | 1329724 | 7629 |
| rh-claude-a-t2 | T2 | 801 | 27 | 0 | 0/0 | 1430936 | 8308 |
| rh-claude-b-t1 | T1 | 709 | 18 | 0 | 0/0 | 837381 | 6482 |
| rh-claude-b-t2 | T2 | 265 | 18 | 0 | 0/0 | 644975 | 6464 |
| rh-hermes-a-t1 | T1 | 1258 | 26 | 0 | 0/0 | 764288 | 5269 |
| rh-hermes-a-t1i | T1, instructions (not delivered) | 1136 | 23 | 0 | 0/0 | 455424 | 4658 |
| rh-hermes-a-t1p | T1, nudge | 882 | 37 | 5 | 0/0 | 674560 | 5652 |
| rh-hermes-a-t2 | T2 | 1319 | 26 | 0 | 0/0 | 456576 | 5446 |
| rh-hermes-b-t1 | T1 | 824 | 23 | 0 | 0/0 | 513792 | 3816 |
| rh-hermes-b-t2 | T2 | 1601 | 27 | 0 | 0/0 | 560000 | 5867 |

Hermes' `input_tokens` excludes cache reads, as Claude's does: in hermes-b-t1, input was 55,312 against 513,792 cache
reads. So the fields compare by name.

## Natural-setup probe (the spawned apgtest agents)
- apgtest-cc-1..3 (Claude): each answered **NONE**, from ToolSearch "graph"/"code_intel" and its full deferred list.
  APG reaches Claude Code only through a repository's `.mcp.json`, and their folder had none.
- Hermes agents spawned before 07:35 local had APG dead (Node ABI, [hermes-probes/](hermes-probes/README.md)).
- hm-1..4 and cc-4 were not probed: no live worker, keyless loops, or never started.
- All seven apgtest agents were then removed.

## Found in the rehearsal (for the trial's apparatus)
1. **T1 leaked through CHANGELOG.md** at its base commit. The fix's entry was committed 27 s before the fix. A content
   check of the base's CHANGELOG/release notes is now an arm-build rule.
2. **Hermes ran MCP servers and its terminal on its own Node 26**, a confound for any repo with native modules. Fixed per
   profile (`terminal.shell_init_files`) and, for APG, in Hermes' config.
3. **The layer readers refused prose replies** (dashboard_whoami). Fixed in cfdbc9e7: prose counts as returning no
   node.
4. **Masking leak:** a run's process listing showed a CONCURRENT run's launcher command, which names its arm. Strip
   process metadata from grading carriers, or do not run arms concurrently.
5. **Rubric:** T2-D6 needs separate categories for "kept invariants" and "changed the expired premise".
6. **Grader ordering** (choices, then correctness, then allocation) worked as designed. Step-1 condition guesses were
   all "?".

## Files
- `runs/<id>/`: raw records (`stream.jsonl` or `rows.json` + `usage.json` + `state-usage-rows.json`), `patch.diff`,
  `clock.json`, `meta.json`, `measure.json`.
- `instruments/`: the driver, the measurement, the arm configs (no keys: they read service.env), the root builders,
  the grading-bundle maker.
- `probes/`: the bridges' initialize answers (9781: 0 chars of instructions; 9782: 747) and the four instruction-
  delivery probes.
- `grading/`: STEP1.md, STEP2.md, the masked bundles R1-R8, grading-key.json, and HANDINS.md. Four transcripts
  held raw control bytes (ANSI escapes and 3 NULs from tool output), which the repo's no-raw-nul-bytes guard refuses.
  They are written here as visible `\u00XX` text. ORIGINAL-SHA256.txt has each file's hash as the grader read it,
  taken before escaping, when every copy was byte-identical to the grader's.
- `hermes-probes/`: Hermes token/tool-reach probes and the Node ABI finding.
