// ★ THE ENUMERATION OF WHAT THIS SERVER INJECTS INTO EVERY AGENT'S PROMPT.
//
// Origin (2026-08-10). ef-manager found that the cold-orientation experiment was
// contaminated: our `instructions` block tells every session "graph_health — run ONCE
// at session start; nothing else answers 'can I trust what I am about to be told'".
// The subject was TOLD to call it first, so first-call-is-health measured compliance,
// not discovery.
//
// I audited that block, found it named verbs and no falsifier FIELDS, and reported the
// falsifier intact. ef-manager then caught that the TOOL SCHEMAS are also injected —
// and they name fields. `nextActions` is valorised in graph_health's description;
// `overlayQuality` is an exact parameter name on graph_pull. Of seven falsifier
// fields, only two were clean.
//
// ★ THE DEFECT WAS NOT THE MISS. It was that confessing a blind spot does not search
// for its other instances: I inspected the artifact I had been editing and did not ask
// "what ELSE does this server put in front of a model." The answer is FOUR surfaces,
// and I had audited one — and the first version of THIS FILE still only found three.
//
// ★ AND A DOC LISTING THE THREE WOULD ROT (ef-manager, applying his own ruling that a
// comment is a note to nobody — no owner, no trigger, no consequence; eleven of them
// accumulated in this repo). So the enumeration is a TEST. It fails the day a NEW
// surface is added, which is the only moment anyone needs to know.
//
// ⚠ AND IT RUNS THE SERVER RATHER THAN GREPPING IT. graph-senior-dev's audit found 68
// suite cases that assert source text and invoke no behaviour; a grep-based version of
// this test would be the 69th, and would miss exactly the case that matters — a new
// surface added somewhere the grep does not look.
//
// ★ FALSIFICATION PROOF, run before this file was committed, because on the day of the
// 68 nothing gets to claim it guards something without being seen to fail:
//
//   1. Added `title: 'Trust check — always read dirtySeams first'` to the TOOL
//      DEFINITION in server.js. All three cases still PASSED.
//      ⇒ Not a defect in the test. `tools/list` builds its payload from an explicit
//        whitelist — name, description, inputSchema, annotations — so a stray key on a
//        tool definition never reaches a model at all. That whitelist is a real safety
//        property worth knowing: THE INJECTED SURFACE CANNOT GROW BY ACCIDENT, only by
//        someone editing the wire mapping.
//   2. Added the same `title` to the WIRE MAPPING instead. Both tripwires fired, and
//      named the offender: `tools.[].title`, plus dirtySeams losing its clean status.
//
// So the first attempt at falsifying this test was aimed at the wrong layer, and had I
// stopped there I would have shipped a green test and called it a guard. That is the
// same mistake as verifying an install against documented paths instead of used ones.
//
// ⚠ WHAT THIS FILE DOES **NOT** ASSERT, stated so a reader does not infer the surface
// is smaller than it is:
//   · `tools[].name` is injected and steers a model on its own — `graph_health` names
//     a health concept before any description is read. It is an identifier, not prose,
//     so it is deliberately outside the asserted prose set.
//   · `inputSchema.properties.*.enum` literals also reach the model. Same reasoning.
// Both are real injected text. If a falsifier field ever appears as a tool NAME or an
// ENUM member, the prose walk will not catch it — the field-level tripwire below will,
// because it scans the whole payload as a string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = 'tests/fixtures/integration/sample-project';

let repo;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-injected-surface-'));
  await cp(FIXTURE, repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
});

afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

function runRpc(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/stdio/server.js'], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`server exited ${code}: ${stderr}`)); return; }
      resolve(stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    });
  });
}

// Walk anything the server hands back and record WHERE prose lives, by path shape.
// Keys are normalised so array indices and tool/property names collapse — we are
// enumerating KINDS of surface, not counting instances.
function proseSurfaces(value, path = [], found = new Set()) {
  if (typeof value === 'string') {
    // Only prose counts. Identifiers, enum members and version strings are not
    // instructions to a reader.
    const key = path[path.length - 1];
    if (typeof key === 'string' && /description|instructions|title|summary/i.test(key)) {
      found.add(path.map((p) => (typeof p === 'number' ? '[]' : p)).join('.'));
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => proseSurfaces(v, [...path, 0], found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      // Collapse per-tool and per-property names so the set stays a set of KINDS.
      const isNamedSlot = path[path.length - 1] === 'properties';
      proseSurfaces(v, [...path, isNamedSlot ? '*' : k], found);
    }
  }
  return found;
}

describe('the surfaces this server injects into every agent prompt', () => {
  let initResult;
  let tools;
  let resources;

  beforeAll(async () => {
    const lines = await runRpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} },
    ]);
    initResult = lines.find((l) => l.id === 1)?.result ?? {};
    tools = lines.find((l) => l.id === 2)?.result?.tools ?? [];
    resources = lines.find((l) => l.id === 3)?.result?.resources ?? [];
    expect(tools.length, 'harness sanity: the server must list tools').toBeGreaterThan(0);
    expect(resources.length, 'harness sanity: the server must list resources').toBeGreaterThan(0);
  });

  it('★ injects EXACTLY four kinds of prose surface — a fifth fails this test', () => {
    const surfaces = new Set([
      ...proseSurfaces(initResult, ['initialize']),
      ...proseSurfaces(tools, ['tools']),
      ...proseSurfaces(resources, ['resources']),
    ]);

    // ★ FOUR, not three. I wrote "three surfaces" in the plan and in this file's
    // header; ef-manager pointed out that the walk enumerated PATHS WITHIN KNOWN
    // PAYLOADS rather than THE SET OF PAYLOADS, and named resources/prompts as the
    // hypothetical gap. It was not hypothetical — this server has declared the
    // `resources` capability all along, and `resources/list` ships a prose
    // `description` per resource, several of which valorise the briefs ("Paste into
    // system/user prompt for orient-shaped sessions").
    //
    // So the audit that was written to close a blind spot had the same blind spot,
    // caught only because the capability assertion below forced the question. That is
    // the argument for anchoring on capabilities rather than on a remembered list.
    //
    //   1. the server `instructions` block  (initialize.instructions)
    //   2. the per-tool description         (tools[].description)
    //   3. every parameter description      (tools[].inputSchema…properties.*.description)
    //   4. every resource description       (resources[].description)
    const EXPECTED = [
      'initialize.instructions',
      'resources.[].description',
      'tools.[].description',
      'tools.[].inputSchema.properties.*.description',
    ];

    // Sorted diff rather than a bare equality, so a failure NAMES the new surface
    // instead of dumping two sets and leaving the reader to compare them.
    const actual = [...surfaces].sort();
    const unexpected = actual.filter((s) => !EXPECTED.includes(s));
    const missing = EXPECTED.filter((s) => !actual.includes(s));

    expect(unexpected, [
      'A FOURTH PROSE SURFACE IS NOW INJECTED INTO EVERY AGENT PROMPT.',
      'Every measurement of what agents "spontaneously" reach for is contaminated by',
      'anything named here. Before shipping it: audit it against any open',
      'pre-registered falsifier (docs/2026-08-10-one-plan.md §8), then add it below.',
    ].join(' ')).toEqual([]);

    // The other direction matters too: a surface DISAPPEARING silently would mean
    // guidance we think we ship is not reaching anyone.
    expect(missing, 'an injected surface vanished — guidance we believe we ship is not being sent').toEqual([]);
  });

  it('★★ declares EXACTLY the `tools` capability — a new one carries prose this test never requests', () => {
    // ef-manager, closing the blind spot this test inherited from the audit it was
    // built to fix. The walk above enumerates PATHS WITHIN KNOWN PAYLOADS; it asks for
    // `initialize` and `tools/list` and walks those. But MCP servers can also expose
    // RESOURCES and PROMPTS, each carrying descriptions that reach the model. If this
    // server ever declares one, that surface is invisible above — not because the walk
    // is wrong, but because it never asked for that payload.
    //
    // ★ THAT IS THE SAME DEFECT FOR THE THIRD TIME IN ONE DAY, ONE LEVEL UP EACH TIME:
    //     instructions block audited      → tool schemas missed
    //     tool schemas audited            → parameter descriptions nearly missed
    //     all three paths enumerated      → CAPABILITIES not enumerated
    // Each pass audited the surfaces it was thinking about. So the enumeration is
    // anchored on the SET OF PAYLOADS, which is what `capabilities` declares.
    //
    // This is what makes the chokepoint claim true of the SERVER rather than merely
    // true of tools/list.
    expect(Object.keys(initResult.capabilities ?? {}).sort()).toEqual(['resources', 'tools']);
  });

  it('★ the two falsifier fields audited CLEAN stay clean', () => {
    // dirtySeams and overlay_age_warning were the only 2 of 7 fields named nowhere in
    // injected text, so they are the only two whose citation by a cold reader can
    // falsify the role hypothesis. If a future tool description mentions either, the
    // experiment silently loses the last of its power — this is the tripwire.
    const allProse = JSON.stringify([initResult, tools, resources]);
    for (const field of ['dirtySeams', 'overlay_age_warning', 'dirty_seams']) {
      expect(allProse, `${field} is now named in injected text — it can no longer falsify anything (one-plan §8.3)`)
        .not.toMatch(new RegExp(field.replace(/_/g, '[_ ]?'), 'i'));
    }
  });

  it('records the fields already KNOWN contaminated, so the count cannot silently drift', () => {
    // Not a prohibition — these are already dead or degraded and the descriptions that
    // name them are useful. This pins the audit so §8.3's "two clean" claim has a
    // mechanical basis rather than resting on a search someone ran once.
    const allProse = JSON.stringify([initResult, tools, resources]);
    expect(allProse, 'nextActions was DEAD via "ranked next actions" prose').toMatch(/ranked next actions/i);
    expect(allProse, 'overlayQuality was DEAD via an exact parameter name').toMatch(/overlayQuality/);
  });
});
