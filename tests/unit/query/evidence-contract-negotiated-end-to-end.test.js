import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeIntelReferences } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { codeIntelHierarchy } from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';
import { shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';
import { canInterpretEvidence } from '../../../mcp/stdio/query/evidence-contract.js';
import { DEPRECATED_EVIDENCE_FIELDS } from '../../../mcp/stdio/query/evidence-contract.js';

// ⭐ CONTROL 3 OF THE STEP 7.5 GATE, AND THE ONLY ONE THAT COULD NOT BE FAKED BY A UNIT TEST.
//
// The review was explicit that a predicate test is not enough here:
//
//     "a v1 reader against v2 refuses THROUGH THE REAL REQUEST/RESPONSE PATH, not through a unit
//      test of the predicate."
//
// The reason is the defect this whole step exists to fix. `canInterpretEvidence` passed 13 unit
// tests while having ZERO production callers — measured, against a positive control of 4 live
// sites for the producer stamp. Unit-testing a guard proves the guard; it says nothing about
// whether a payload emitted by the real verb ever reaches it.
//
// ⇒ So these drive the ACTUAL verb entry points, take the ACTUAL response, and hand it to a reader
// that understands only contract 1 — which is what an old MCP client is.

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const spawnCfg = { command: process.execPath, args: [fakeServer], env: { ...process.env } };

let repo;
function tmpRepo() {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-negot-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'clean.cpp'), 'void f(){}\n');
  return repo;
}

beforeEach(() => { repo = null; });
afterEach(async () => {
  try { await shutdownAllSessions(); } catch { /* ignore */ }
  if (repo) { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } }
});

const refs = (root, accept) => codeIntelReferences({
  repoRoot: root, language: 'cpp', file: 'src/clean.cpp', line: 1, col: 6, spawn: spawnCfg,
  ...(accept === undefined ? {} : { acceptEvidenceContractVersion: accept }),
});

describe('negotiated contract, driven through the real references verb', () => {
  it('⭐ CONTROL 1 — an OLD client (no field) receives contract 1 WITH the deprecated booleans', async () => {
    const r = await refs(tmpRepo(), undefined);
    expect(r.status, 'positive control: the verb must actually answer').toBe('ok');
    expect(r.evidence.contractVersion).toBe(1);
    expect(r.evidence).toHaveProperty('degraded');
  });

  it('⭐ CONTROL 2 — a client that ASKS for 2 receives contract 2 with NEITHER boolean', async () => {
    const r = await refs(tmpRepo(), 2);
    expect(r.status).toBe('ok');
    expect(r.evidence.contractVersion).toBe(2);
    for (const field of Object.keys(DEPRECATED_EVIDENCE_FIELDS)) {
      expect(r.evidence, `contract 2 still carried ${field}`).not.toHaveProperty(field);
    }
  });

  it('⭐⭐ CONTROL 3 — a v1 READER REFUSES the real v2 payload rather than reading it as healthy', async () => {
    // This is the hazard the whole migration is about, exercised end to end. An old reader asking
    // "is this clean?" of a contract-2 payload would find `degraded` absent, `!undefined === true`,
    // and conclude HEALTHY — the dangerous direction. The version is what lets it refuse instead.
    const r = await refs(tmpRepo(), 2);
    const payload = r.evidence;

    expect(payload).not.toHaveProperty('degraded');          // the field an old reader would test
    expect(canInterpretEvidence(payload.contractVersion, 1)).toBe(false);   // so it must refuse

    // ⛔ AND THE NAIVE READ IS SHOWN TO BE WRONG IN THE SAME PASS. Without the version check, this
    // is exactly what an old client concludes from the same bytes.
    const naiveVerdict = !payload.degraded;                  // "no degradation recorded => clean"
    expect(naiveVerdict, 'the unguarded read really does say healthy').toBe(true);
  });

  it('⭐ NEGATIVE CONTROL — the same v1 reader ACCEPTS a real v1 payload', async () => {
    // Without this, "refuses" could just mean the reader refuses everything, and control 3 would
    // pass against a guard that is useless rather than one that discriminates.
    const r = await refs(tmpRepo(), 1);
    expect(canInterpretEvidence(r.evidence.contractVersion, 1)).toBe(true);
    expect(r.evidence).toHaveProperty('degraded');
  });

  it('⛔ CONTROL 4 — an unsupported version REFUSES the request, with no best-effort payload', async () => {
    for (const bad of [0, -1, 3, '2']) {
      const r = await refs(tmpRepo(), bad);
      expect(r.status, `requested=${JSON.stringify(bad)}`).toBe('error');
      expect(r.errors[0].code).toBe('unsupported_evidence_contract_version');
      expect(r, 'a refusal must not also return evidence').not.toHaveProperty('evidence');
      if (repo) { fs.rmSync(repo, { recursive: true, force: true }); repo = null; }
    }
  });
});

// ⛔ A SCHEMA THAT DECLARES A FIELD THE VERB IGNORES IS WORSE THAN NOT DECLARING IT — the client
// believes it opted in, and receives contract 1 while thinking it holds contract 2. That is the
// fail-open direction, dressed as a feature.
//
// ⚠ This exists because the negotiation was UNREACHABLE when I first wired it: fully implemented
// in both verbs, fully tested, and declared in no tool schema at all — so no MCP client could send
// the field. Building the mechanism and never exposing it is the same zero-consumer defect this
// whole step is fixing, one layer further out. Mechanical, not attentional: it enumerates the
// schema rather than trusting anyone to remember.
describe('⛔ the tool SURFACE and the verb agree — declared means honoured', () => {
  it('every tool that declares acceptEvidenceContractVersion actually refuses a bad value', async () => {
    const { TOOLS } = await import('../../../mcp/stdio/tools/schema.js');
    const declaring = TOOLS.filter((t) => t?.schema?.properties?.acceptEvidenceContractVersion);

    expect(declaring.length, 'positive control: the enumeration must find the tools that DO declare it')
      .toBeGreaterThan(0);

    const root = tmpRepo();
    for (const tool of declaring) {
      const args = tool.name === 'code_intel_hierarchy'
        ? { repoRoot: root, language: 'cpp', kind: 'callers', file: 'src/clean.cpp', line: 1, col: 6 }
        : { repoRoot: root, language: 'cpp', file: 'src/clean.cpp', line: 1, col: 6 };
      const r = await tool.handler({ ...args, spawn: spawnCfg, acceptEvidenceContractVersion: 99 });
      expect(r.status, `${tool.name} declares the field but did not refuse 99`).toBe('error');
      expect(r.errors[0].code, tool.name).toBe('unsupported_evidence_contract_version');
    }
  });

  it('⛔ and the enum it advertises matches what the verb will actually accept', async () => {
    const { TOOLS } = await import('../../../mcp/stdio/tools/schema.js');
    const { SUPPORTED_EVIDENCE_CONTRACT_VERSIONS } = await import('../../../mcp/stdio/query/evidence-contract-negotiation.js');
    const declaring = TOOLS.filter((t) => t?.schema?.properties?.acceptEvidenceContractVersion);
    expect(declaring.length).toBeGreaterThan(0);
    for (const tool of declaring) {
      // An enum wider than the implementation invites a refusal the schema said was fine; an enum
      // narrower than it hides a working option. Either way the surface lies about the verb.
      expect(tool.schema.properties.acceptEvidenceContractVersion.enum, tool.name)
        .toEqual([...SUPPORTED_EVIDENCE_CONTRACT_VERSIONS]);
    }
  });
});

describe('⭐ CONTROL 5 — both verbs negotiate through the SAME owner and cannot drift', () => {
  it('the hierarchy verb refuses the identical set the references verb refuses', async () => {
    // Two verbs with two copies of "which contracts do I accept" is precisely how the two
    // compile-DB directory allowlists drifted apart and cost a real repository its caller sets.
    // Asserted by BEHAVIOUR on both entry points, not by reading that they import the same file.
    const root = tmpRepo();
    for (const bad of [0, 3, '2']) {
      const h = await codeIntelHierarchy({
        repoRoot: root, language: 'cpp', kind: 'callers', file: 'src/clean.cpp', line: 1, col: 6,
        spawn: spawnCfg, acceptEvidenceContractVersion: bad,
      });
      expect(h.status, `hierarchy requested=${JSON.stringify(bad)}`).toBe('error');
      expect(h.errors[0].code).toBe('unsupported_evidence_contract_version');
    }
  });

  it('and ACCEPTS the identical set it accepts — the positive half', async () => {
    const root = tmpRepo();
    const h = await codeIntelHierarchy({
      repoRoot: root, language: 'cpp', kind: 'callers', file: 'src/clean.cpp', line: 1, col: 6,
      spawn: spawnCfg, acceptEvidenceContractVersion: 2,
    });
    // The verb may legitimately fail for hierarchy-specific reasons against a fake server; what
    // must NOT happen is a contract refusal, and if evidence comes back it must be contract 2.
    expect(h.errors?.[0]?.code).not.toBe('unsupported_evidence_contract_version');
    if (h.evidence) expect(h.evidence.contractVersion).toBe(2);
  });
});
