// ⛔ A PROMPT THAT NAMES THE MECHANISM MEASURES NOTHING.
//
// This whole benchmark is a mid-task ROUTING test: what the agent reaches for is the measurement.
// The moment a prompt says "header", "extern" or "check the graph", the agent is following an
// instruction instead of choosing a route, and every number downstream is about the prompt.
//
// ⭐ IT HAS ALREADY GONE WRONG ONCE HERE, WHICH IS WHY THIS IS A TEST AND NOT A REVIEW. The first
// corpus was committed with files named caller-via-extern.cpp, unity-build.cpp and
// header-exposed.cpp, symbols named trulyFileLocal and headerExposedHelper, and a comment in every
// file explaining the case it tested. It looked fine to me on read-through. A mechanical check does
// not get to be persuaded.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'tests', 'fixtures', 'linkage-scope');
const CORPUS = join(DIR, 'corpus');
const prompts = JSON.parse(readFileSync(join(DIR, 'prompts.json'), 'utf8'));
const groundTruth = JSON.parse(readFileSync(join(DIR, 'ground-truth.json'), 'utf8'));

// ⛔ DERIVED FROM THE PROMPT FILE'S OWN DECLARATION, never a second list retyped here. A parallel
// list is a second chance to disagree, and the file that declares the rule should own it.
const FORBIDDEN = prompts.forbiddenInPrompts;

describe('the prompts an agent sees do not give away the answer', () => {
  it('the forbidden list is non-trivial and owned by the prompt file', () => {
    // ⛔ Every assertion below is "this word is absent". If the list were empty they would all pass
    // while checking nothing at all.
    expect(Array.isArray(FORBIDDEN)).toBe(true);
    expect(FORBIDDEN.length).toBeGreaterThan(10);
    expect(FORBIDDEN).toContain('extern');
    expect(FORBIDDEN).toContain('graph');
  });

  it('⛔ no prompt contains a forbidden word', () => {
    const offences = [];
    for (const p of prompts.prompts) {
      for (const w of FORBIDDEN) {
        if (new RegExp(`\\b${w}\\b`, 'i').test(p.text)) offences.push(`${p.class}: "${w}"`);
      }
    }
    expect(offences, 'a prompt names the mechanism, so the agent is following it rather than routing')
      .toEqual([]);
  });

  it('POSITIVE CONTROL: the detector catches a word that IS present', () => {
    // ⛔ The assertion above is an emptiness check over a regex loop. If the regex were malformed —
    // a bad escape, a wrong flag — it would find nothing and pass over a prompt that says "check
    // the graph". This proves the same matcher fires on text that really does contain a term.
    const planted = 'Please check the graph and tell me if it is exhaustive.';
    const caught = FORBIDDEN.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(planted));
    expect(caught, 'the leak detector cannot see a leak it was built to catch').toContain('graph');
    expect(caught).toContain('exhaustive');
  });

  it('⛔ no CORPUS filename names the mechanism', () => {
    // The agent lists the directory. A filename is part of the prompt surface whether or not
    // anyone intended it to be.
    const names = readdirSync(CORPUS).join(' ').toLowerCase();
    const offences = FORBIDDEN.filter((w) => names.includes(w.toLowerCase()));
    expect(offences, 'a corpus filename announces its own case').toEqual([]);
  });

  it('⛔ the corpus carries no comments — a comment explaining the case gives it away', () => {
    const withComments = readdirSync(CORPUS)
      .filter((f) => /\.(cpp|h)$/.test(f))
      .filter((f) => /\/\/|\/\*/.test(readFileSync(join(CORPUS, f), 'utf8')));
    expect(withComments, 'a corpus file explains itself to the agent reading it').toEqual([]);
  });

  it('⛔ the answer key is NOT inside the directory that gets copied into an arm', () => {
    const inCorpus = readdirSync(CORPUS);
    expect(inCorpus).not.toContain('ground-truth.json');
    expect(inCorpus).not.toContain('prompts.json');
    expect(inCorpus).not.toContain('README.md');
  });

  it('every task class has exactly one prompt, and every prompt a class', () => {
    // A class with no prompt silently drops out of the run; a prompt with no class scores against
    // nothing. Both failures look like a smaller experiment rather than a broken one.
    const classIds = groundTruth.classes.map((c) => c.id).sort();
    const promptIds = prompts.prompts.map((p) => p.class).sort();
    expect(promptIds).toEqual(classIds);
  });

  it('C6 is byte-identical to C4 — the graph state is the only difference', () => {
    // ⛔ If these ever diverge, C6 stops being a routing measurement and becomes a different
    // question asked of a different graph, which confounds the one comparison it exists for.
    const c4 = prompts.prompts.find((p) => p.class === 'C4-header-exposed').text;
    const c6 = prompts.prompts.find((p) => p.class === 'C6-torn-graph-safety').text;
    expect(c6).toBe(c4);
  });

  it('no prompt instructs the agent to verify, or to use a tool', () => {
    // Telling it to verify would manufacture the behaviour the rubric scores. The rubric asks
    // whether it chose to; a prompt that asks for it makes every arm look identical.
    for (const p of prompts.prompts) {
      expectAbsentWithLiveMatcher(
        /\bverify\b/i,
        {
          forbidden: 'Does anything call normalizeInput? Verify against the source before answering.',
          allowed: 'Does anything call normalizeInput? List what you find and say what you checked.',
        },
        p.text,
        `${p.class} instructs the agent to verify, manufacturing the behaviour the rubric scores`,
      );
      expectAbsentWithLiveMatcher(
        /\bgrep\b|\brg\b|\btool\b/i,
        {
          forbidden: 'Is applyGain dead code? Use grep to check.',
          allowed: 'Is applyGain dead code? Give me a yes or no and say what you checked.',
        },
        p.text,
        `${p.class} names a tool, so the route stops being the agent's choice`,
      );
    }
  });
});
