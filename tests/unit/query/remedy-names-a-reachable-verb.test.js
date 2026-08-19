// A REMEDY MUST NAME A DOOR THE READER CAN OPEN.
//
// ⛔ FIELD REPORT (ef-manager, 2026-08-19). `graph_health`'s no-collection remedy — which I had
// written the day before, to fix a remedy that pointed at the wrong question — told the reader
// to call `code_intel_definitions`. That verb is not in the 17-name default `tools/list`
// profile. In a managed session, where MCP tools are deferred behind a search step, it is not
// merely unlisted, it is NOT CALLABLE:
//
//     ToolSearch("select:mcp__aify-project-graph__code_intel_definitions")
//       -> "No matching deferred tools found."
//
// ★ AND THE COMMENT TWENTY LINES ABOVE `DEFAULT_TOOL_NAMES` ALREADY RECORDS THIS EXACT BUG.
// `graph_index` was ADDED to the default profile because the 2026-06-01 Sand Castle A/B found
// workers "couldn't act on the 'run graph_index' staleness warning because it wasn't in their
// surface." I re-created that defect in a file that documents it.
//
// ⇒ So this is not a fix to one string. Enumerating the class found SIX, in five files, five of
// which nobody had reported. A rule in a comment did not prevent the sixth; a test that runs
// can.
//
// THE INVARIANT, stated precisely: a verb that IS in the default profile must not name a verb
// that is NOT. The converse is fine and deliberately allowed — an unlisted verb may name other
// unlisted verbs, because the only way to have reached it is with the full toolset, where they
// are all callable.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERB_DIR = resolve('mcp/stdio/query/verbs');
const TOOL_TOKEN = /\b(?:graph|code_intel)_[a-z_]+\b/g;

// The listing is taken from the REAL server over stdio rather than from a copy of the name set.
// A test that imports the same constant the code imports proves only that a constant equals
// itself; this proves what a client is actually offered.
function listedToolNames() {
  const child = spawnSync(process.execPath, [resolve('mcp/stdio/server.js')], {
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
    encoding: 'utf8', timeout: 20_000,
  });
  const lines = (child.stdout || '').split(/\r?\n/u).filter(Boolean);
  const tools = JSON.parse(lines[lines.length - 1] || '{}')?.result?.tools || [];
  return new Set(tools.map((t) => t.name));
}

// `graph_health` lives in health.js, `graph_collect_code_intel` in collect_code_intel.js, and
// the code_intel_* verbs are named for their files. Comparing the basename against each tool
// name with its family prefix removed covers all three without a hand-maintained map that can
// fall out of date the way the type list in whereis did.
function toolsDefinedBy(basename, allTools) {
  const stem = basename.replace(/\.js$/u, '');
  return [...allTools].filter((t) => t.replace(/^graph_/u, '').replace(/^code_intel_/u, 'code_intel_') === stem
    || t === `graph_${stem}` || t === stem);
}

// Content filters, not a name allowlist: these matches are not references to a TOOL at all.
// A name allowlist would need editing every time a table or module is added, which is the
// failure mode this whole test exists to catch.
function isNotAToolReference(line, index, name) {
  const before = line.slice(0, index);
  const after = line.slice(index + name.length);
  if (after.startsWith('.js')) return true;                       // a module specifier
  if (/\b(?:FROM|JOIN|INTO|UPDATE|TABLE|EXISTS)\s+$/iu.test(before)) return true; // a SQL table
  if (/verbName:\s*$/u.test(before)) return true;                 // telemetry, not advice
  return false;
}

describe('a remedy names a verb the reader can actually call', () => {
  it('★★★ no default-profile verb points the reader at an unlisted verb', () => {
    const listed = listedToolNames();
    expect(listed.size, 'sanity: the server must have answered tools/list').toBeGreaterThan(5);

    const allTools = new Set(
      (readFileSync(resolve('mcp/stdio/tools/schema.js'), 'utf8').match(/name: '((?:graph|code_intel)_[a-z_]+)'/gu) || [])
        .map((m) => m.slice(7, -1)),
    );
    expect(allTools.size, 'sanity: the schema must define tools').toBeGreaterThan(20);

    const violations = [];
    for (const file of readdirSync(VERB_DIR).filter((n) => n.endsWith('.js'))) {
      const own = toolsDefinedBy(file, allTools);
      // Only verbs the default profile actually exposes are bound by this rule.
      if (!own.some((t) => listed.has(t))) continue;
      const ownNames = new Set(own);

      readFileSync(join(VERB_DIR, file), 'utf8').split(/\r?\n/u).forEach((raw, i) => {
        const line = raw.trim();
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
        for (const literal of line.match(/'[^']*'|"[^"]*"|`[^`]*`/gu) || []) {
          for (const name of literal.match(TOOL_TOKEN) || []) {
            if (ownNames.has(name) || listed.has(name)) continue;
            if (isNotAToolReference(line, line.indexOf(name), name)) continue;
            // A LABELLED exit, not a hidden one. Naming an unlisted verb is fine when the text
            // says so on the same line, because then the reader is not sent at a door they
            // cannot open — they are told the door needs a different key. The phrase is fixed
            // and checked so the exemption cannot be taken by hand-waving; scoping the claim is
            // the same discipline every other disclosure in this codebase is held to.
            if (line.includes('where the full toolset is enabled')) continue;
            violations.push(`${file}:${i + 1} names ${name}, which the default profile does not list`);
          }
        }
      });
    }

    expect(violations, 'a remedy that names an uncallable verb costs a round trip to discover it was not for you')
      .toEqual([]);
  }, 40_000);
});
