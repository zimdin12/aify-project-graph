import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Docs that state a verb count kept drifting from the profile sets in
// server.js: the always-loaded session-start skill claimed a "default 16-verb
// tools/list" and a "30 verbs" full profile while the real numbers were 17 and
// 31, and server-instructions.js said "~15". Three surfaces, three different
// wrong answers to one question an agent uses to decide whether a verb it
// cannot see is missing or merely unlisted.
//
// A hand-written count is a stand-in for a set that is right here in the repo.
// This test removes the option of it drifting: any prose that names a verb
// count must agree with the code that produces the listing.

const REPO = join(import.meta.dirname, '..', '..', '..');
const SERVER = readFileSync(join(REPO, 'mcp', 'stdio', 'server.js'), 'utf8');

function nameSet(constName) {
  const start = SERVER.indexOf(`const ${constName}`);
  if (start < 0) throw new Error(`${constName} not found in server.js`);
  const open = SERVER.indexOf('[', start);
  const close = SERVER.indexOf(']', open);
  return [...SERVER.slice(open, close).matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]);
}

function actualCounts() {
  const hidden = new Set(nameSet('HIDDEN_FULL_TOOL_NAMES'));
  const all = [...new Set(
    [...SERVER.matchAll(/^\s*name:\s*'([a-z_0-9]+)'/gm)].map(m => m[1]),
  )];
  return {
    total: all.length,
    full: all.filter(n => !hidden.has(n)).length,
    default: nameSet('DEFAULT_TOOL_NAMES').length,
    lean: nameSet('LEAN_TOOL_NAMES').length,
  };
}

// Each entry: a file, and the counts its prose asserts. Add a row when a doc
// starts naming a number — do NOT add a number to a doc without a row here.
const CLAIMS = [
  { file: 'README.md', profile: 'full', re: /lists \*\*(\d+) verbs\*\*/ },
  { file: 'README.md', profile: 'lean', re: /the (\d+)-verb planning core/ },
  // The install section states the same two counts in different words, and both
  // were wrong while the rows above were right — a count is only as safe as the
  // number of phrasings this list knows about.
  { file: 'README.md', profile: 'lean', re: /exposes (\d+) visible verbs/ },
  { file: 'README.md', profile: 'default', re: /focused `default` profile\*\* \((\d+) verbs\)/ },
  // The per-runtime install docs are what a NEW user follows, so a wrong count
  // here is the first thing they learn. All four carried the pre-gating numbers.
  { file: 'install.codex.md', profile: 'lean', re: /\((\d+) visible verbs:/ },
  { file: 'install.codex.md', profile: 'full', re: /full surface \((\d+) verbs listed/ },
  { file: 'install.cursor.md', profile: 'lean', re: /\((\d+) visible verbs\)/ },
  { file: 'install.cursor.md', profile: 'full', re: /full surface \((\d+) verbs listed/ },
  { file: 'install.hermes.md', profile: 'lean', re: /\((\d+) visible verbs:/ },
  { file: 'install.opencode.md', profile: 'lean', re: /\((\d+) visible verbs:/ },
  { file: 'mcp/stdio/server-instructions.js', profile: 'default', re: /FOCUSED default \((\d+) verbs\)/ },
  {
    file: 'integrations/claude-code/skills/graph-guide/SKILL.md',
    profile: 'default',
    re: /used \d+ verbs out of (\d+)/,
  },
];

describe('documented verb counts match the server profiles', () => {
  const actual = actualCounts();

  it('parses the profile sets out of server.js', () => {
    // Guards the parser itself: if server.js is restructured so these come back
    // zero, every assertion below would trivially "pass" against a doc that
    // also said zero.
    expect(actual.total).toBeGreaterThan(30);
    expect(actual.full).toBeGreaterThan(actual.default);
    expect(actual.default).toBeGreaterThan(actual.lean);
    expect(actual.lean).toBeGreaterThan(0);
  });

  for (const { file, profile, re } of CLAIMS) {
    it(`${file} states the real ${profile} count`, () => {
      const text = readFileSync(join(REPO, file), 'utf8');
      const m = text.match(re);
      expect(m, `no ${profile} count matched ${re} in ${file}`).toBeTruthy();
      expect(Number(m[1])).toBe(actual[profile]);
    });
  }

  it('install.hermes.md resolves HERMES_HOME to one directory throughout', () => {
    // The doc set the SAME variable to two different defaults: the MCP-config
    // step used $HOME/.hermes, the skills step used $HOME/.config/hermes. Both
    // halves "worked", so following it end-to-end left the MCP server running
    // and every skill installed where Hermes never looks — a silent no-op that
    // reads as success. Found only because a stale skill survived an update
    // that reported itself complete.
    const text = readFileSync(join(REPO, 'install.hermes.md'), 'utf8');
    const defaults = new Set(
      [...text.matchAll(/HERMES_HOME:-([^}"']+)/g)].map((m) => m[1].trim()),
    );
    expect([...defaults], 'HERMES_HOME must have one default').toHaveLength(1);
    // And it must be the home that actually holds config.yaml.
    expect([...defaults][0]).toBe('$HOME/.hermes');
  });

  it('the always-loaded session-start skill names no verb count at all', () => {
    // This one is stricter than the rows above on purpose. The root SKILL.md is
    // read at the start of every session, so a stale number there is both the
    // most expensive to be wrong and the least likely to be re-read carefully.
    // It now says "whatever your tools/list shows" instead — keep it that way.
    const skill = readFileSync(
      join(REPO, 'integrations', 'claude-code', 'skill', 'SKILL.md'),
      'utf8',
    );
    const offenders = [...skill.matchAll(/\b(\d+)[- ]verbs?\b/g)].map(m => m[0]);
    expect(offenders).toEqual([]);
  });
});
