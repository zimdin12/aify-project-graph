// ⛔ AN AGENT REACHED FOR THE TOOL BY NAME AND WAS TOLD IT DOES NOT EXIST.
//
// Measured 2026-09-05 from a 2026-08-25 transcript, then REPRODUCED live in the same session as this
// test was written:
//
//     ToolSearch select:code_intel_references,graph_callers,graph_whereis
//       -> "No matching deferred tools found"
//     ToolSearch select:mcp__aify-project-graph__graph_callers
//       -> loads
//     ToolSearch graph                      (the keyword form our instructions recommend)
//       -> loads
//
// The verbs are deferred rather than present in a subagent's toolset, so ToolSearch is the door.
// `select:` matches the FULLY QUALIFIED name. We hand agents 22 unprefixed verb names
// (`graph_callers`, `code_intel_references`, …) and, before this change, the prefixed form ZERO
// times — so the names we supply are exactly the names that fail.
//
// ⚠ AND THE MISTAKE IS THE REASONABLE ONE. ToolSearch's own documentation gives `select:Read,Edit,Grep`
// as its example, which are bare builtin names. An agent holding `graph_callers` and copying that
// pattern gets a refusal whose wording reads as "this repo has no such tool" — an ABSENCE CLAIM,
// which is the exact defect class this repo spends its time removing, arriving from the other side.
//
// ⇒ The agent that hit this had done everything right: it was told the tool existed, it wanted it,
// it asked for it by name, and it fell back to grep and never tried again. That is a REACHABILITY
// failure on the adoption path, and adoption is the binding constraint (organic subagent use: 0/973).
//
// This test pins the remedy in the always-paid tier, because a fix an agent never reads is not one.
import { describe, it, expect } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../../mcp/stdio/server-instructions.js';

const PREFIX = 'mcp__aify-project-graph__';

describe('the instructions name the ToolSearch form that actually works', () => {
  it('★★★ the fully-qualified prefix appears at least once', () => {
    // Before this, it appeared zero times while 22 unprefixed verb names did.
    expect(SERVER_INSTRUCTIONS).toContain(PREFIX);
  });

  it('★★★ the instructions warn that a bare select: FAILS', () => {
    // Naming the working form is not enough on its own: the failure is silent-looking, so the
    // wording has to tell the reader that the refusal is not an absence.
    expect(SERVER_INSTRUCTIONS).toMatch(/select:/);
    expect(SERVER_INSTRUCTIONS, 'the refusal wording must be quoted so it is recognisable')
      .toMatch(/No matching deferred tools found/);
  });

  it('★★★ POSITIVE CONTROL: the keyword form is still recommended', () => {
    // ⛔ The direction this fix could break. The keyword search WORKS and is the cheaper path; a
    // rewrite that replaced it with select: guidance would trade one trap for another.
    expect(SERVER_INSTRUCTIONS).toMatch(/ToolSearch with query "graph"/);
  });

  it('★★ the unprefixed verb names are still there — they are how an agent recognises the tool', () => {
    // The fix ADDS the qualified form; it does not strip the readable names. Removing those would
    // make the instructions unreadable to solve a problem in one clause.
    expect(SERVER_INSTRUCTIONS).toMatch(/graph_packet/);
    expect(SERVER_INSTRUCTIONS).toMatch(/code_intel_references/);
  });
});
