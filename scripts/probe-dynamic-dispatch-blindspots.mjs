// ARE THE BLIND SPOTS I WANT TO DECLARE ACTUALLY BLIND?
//
// `constructCoverageClause` states what the analysis cannot see, and it exists for C/C++ only —
// measured: 2 of 12 configured languages. Extending it to JS/TS and Python means asserting that
// specific constructs are invisible to our extractor.
//
// ⛔ THAT IS A SEMANTIC CLAIM AND MUST NOT BE WRITTEN FROM INTUITION. This repo's standing rule is
// never to slide from a textual claim to a semantic one; declaring "dynamic dispatch is invisible"
// without executing the extractor over it would be exactly that. So each construct gets a fixture.
//
// PREREGISTERED, before the run:
//   POPULATION    one file per construct, per language, indexed by the real pipeline.
//   IDENTITY RULE a construct is BLIND when the graph holds NO edge from the calling function to the
//                 called one, while the CONTROL — an ordinary direct call in the same file — DOES
//                 produce one.
//   CLAIM CEILING each result licenses ONE sentence about ONE construct in ONE language on this
//                 extractor version. It says nothing about clangd/pyright-verified tiers.
//   CONTROLS      per language, in the same pass: a direct call MUST produce an edge (else the
//                 extractor is not working and every "blind" below is an artifact).
//
// ABANDON RULE: if a language's direct-call control produces no edge, report that language as
// UNMEASURED and write no clause for it.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const say = (...a) => console.log(...a);
const repo = mkdtempSync(join(tmpdir(), 'apg-blindspot-'));

const CASES = {
  javascript: {
    file: 'src/dyn.js',
    text: `export function sink() { return 1; }
export function controlCaller() { return sink(); }
const table = { sink };
export function dynamicCaller(name) { return table[name](); }
export function computedCaller(o, k) { return o[k](); }
`,
    control: ['controlCaller', 'sink'],
    blind: [['dynamicCaller', 'sink'], ['computedCaller', 'sink']],
  },
  python: {
    file: 'src/dyn.py',
    text: `def sink():
    return 1

def control_caller():
    return sink()

def dynamic_caller(obj, name):
    return getattr(obj, name)()
`,
    control: ['control_caller', 'sink'],
    blind: [['dynamic_caller', 'sink']],
  },
  php: {
    file: 'src/dyn.php',
    text: `<?php
function sink() { return 1; }
function controlCaller() { return sink(); }
function dynamicCaller($name) { return $name(); }
function userFuncCaller() { return call_user_func('sink'); }
`,
    control: ['controlCaller', 'sink'],
    blind: [['dynamicCaller', 'sink'], ['userFuncCaller', 'sink']],
  },
  go: {
    file: 'src/dyn.go',
    text: `package main

func sink() int { return 1 }

func controlCaller() int { return sink() }

func valueCaller() int {
	f := sink
	return f()
}

func indirectCaller(f func() int) int { return f() }

func wire() int { return indirectCaller(sink) }
`,
    control: ['controlCaller', 'sink'],
    // ⛔ TWO SHAPES, AND THE SECOND IS THE HONEST ONE. `valueCaller` MENTIONS `sink` textually, so a
    // mention-based extractor can produce that edge without understanding the indirection at all —
    // an edge that exists for the wrong reason is not coverage. `indirectCaller` never names `sink`
    // in its body, so only real indirection tracking could connect them.
    blind: [['valueCaller', 'sink'], ['indirectCaller', 'sink']],
  },
  rust: {
    file: 'src/dyn.rs',
    text: `pub fn sink() -> i32 { 1 }

pub fn control_caller() -> i32 { sink() }

pub fn pointer_caller() -> i32 {
    let f: fn() -> i32 = sink;
    f()
}

pub fn indirect_caller(f: fn() -> i32) -> i32 { f() }

pub fn wire() -> i32 { indirect_caller(sink) }
`,
    control: ['control_caller', 'sink'],
    // Same split as go: pointer_caller NAMES sink; indirect_caller does not.
    blind: [['pointer_caller', 'sink'], ['indirect_caller', 'sink']],
  },
  ruby: {
    file: 'src/dyn.rb',
    text: `def sink
  1
end

def control_caller
  sink
end

def send_caller(name)
  send(name)
end
`,
    control: ['control_caller', 'sink'],
    blind: [['send_caller', 'sink']],
  },
  java: {
    file: 'src/Dyn.java',
    text: `public class Dyn {
    static int sink() { return 1; }

    static int controlCaller() { return sink(); }

    static int reflectCaller() throws Exception {
        return (int) Dyn.class.getMethod("sink").invoke(null);
    }
}
`,
    control: ['controlCaller', 'sink'],
    blind: [['reflectCaller', 'sink']],
  },
  // ⚠ THE LAST TWO OF THE TWELVE, measured rather than left as "uninvestigated" forever. The
  // expected outcome differs from the others and that is the point: if a language has no call
  // construct at all, its silence is a CORRECTNESS ARGUMENT, not an unfilled gap.
  glsl: {
    file: 'src/dyn.frag',
    text: `float sink() { return 1.0; }
float controlCaller() { return sink(); }
`,
    control: ['controlCaller', 'sink'],
    // Core GLSL has no function pointers, no reflection, no dynamic dispatch to test.
    blind: [],
  },
  css: {
    file: 'src/dyn.css',
    text: `.sink { color: red; }
.controlCaller { color: blue; }
`,
    control: ['controlCaller', 'sink'],
    blind: [],
  },
};

// ⛔ SCOPED TO THE LANGUAGE'S OWN FILE. Every fixture lives in ONE repo and they deliberately share
// the names `controlCaller` and `sink`, so matching on LABEL ALONE let one language's edge satisfy
// another language's check. Measured: the CSS control "passed" — and CSS has no function calls at
// all, so it was finding the JavaScript fixture's edge.
//
// ⚠ THE DIRECTION OF THAT ERROR MATTERS. Extra cross-language edges can only manufacture a FALSE
// CONTROL PASS or a FALSE SEEN; they cannot manufacture a false BLIND. So the BLIND findings survive,
// but a control pass was no longer evidence the language is parsed at all — which is precisely the
// ABANDON condition this probe declares and would then have skipped.
function edgeExists(db, fromLabel, toLabel, file) {
  const row = db.get(`
    SELECT COUNT(*) AS c FROM edges e
    JOIN nodes f ON f.id = e.from_id
    JOIN nodes t ON t.id = e.to_id
    WHERE f.label = $f AND t.label = $t
      AND f.file_path = $file AND t.file_path = $file
  `, { f: fromLabel, t: toLabel, file });
  return (row?.c ?? 0) > 0;
}

try {
  mkdirSync(join(repo, 'src'), { recursive: true });
  for (const c of Object.values(CASES)) writeFileSync(join(repo, c.file), c.text);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'fixtures');

  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  await graphIndex({ repoRoot: repo, force: true });
  const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));

  const verdicts = {};
  try {
    for (const [lang, c] of Object.entries(CASES)) {
      const controlOk = edgeExists(db, c.control[0], c.control[1], c.file);
      say(`--- ${lang}`);
      say(`  [${controlOk ? 'PASS' : 'FAIL'}] CONTROL: direct call ${c.control[0]} -> ${c.control[1]} produces an edge`);
      if (!controlOk) {
        say('  ⛔ ABANDON for this language: the extractor produced no edge for an ordinary call.');
        say('     Report UNMEASURED and write no clause.');
        verdicts[lang] = 'UNMEASURED';
        continue;
      }
      const blindResults = c.blind.map(([f, t]) => ({ f, t, seen: edgeExists(db, f, t, c.file) }));
      for (const b of blindResults) {
        say(`  ${b.seen ? '[SEEN ]' : '[BLIND]'} ${b.f} -> ${b.t}`);
      }
      // ⛔ AN EMPTY LIST IS NOT A FINDING. `[].every(...)` is vacuously TRUE, so a language with no
      // construct to test reported "BLIND (clause justified)" — a justification for a clause when
      // NOTHING was measured. That is the `[].every()` trap this repo has already been bitten by,
      // reproduced here in the instrument built to avoid inventing claims.
      if (blindResults.length === 0) {
        say('  [none ] no dynamic-dispatch construct was tested for this language');
        verdicts[lang] = 'NO CONSTRUCT TESTED (no clause)';
        continue;
      }
      verdicts[lang] = blindResults.every((b) => !b.seen) ? 'BLIND (clause justified)'
        : blindResults.some((b) => !b.seen) ? 'PARTIAL' : 'SEEN (no clause)';
      say(`  => ${verdicts[lang]}`);
    }
  } finally { db.close?.(); }

  say('');
  say('VERDICTS: ' + JSON.stringify(verdicts));
  process.exitCode = 0;
} finally {
  rmSync(repo, { recursive: true, force: true });
}
