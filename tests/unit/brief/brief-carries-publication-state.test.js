// ⛔ COMPUTED AND DISCARDED IS NOT "TRAVELS WITH THE NUMBER".
//
// repoSnapshot computed generationState and returned it, and a comment in the source claimed it
// travelled with the count it qualifies. No renderer referenced it: renderJson omitted it from
// repo.trust and both markdown surfaces printed ordinary trust. So a brief built over a legacy or
// torn graph looked exactly like one built over a verified graph — the claim was in a comment
// rather than in the output, which is the same shape as a test that agrees with the code about
// something the code does not do.
//
// These assert on PUBLIC OUTPUT, because that is where the defect lived.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { generateBrief } from '../../../mcp/stdio/brief/generator.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-briefpub-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  await ensureFresh({ repoRoot: repo });
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const makeLegacy = () => {
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try { db.exec('DROP TABLE graph_generation'); } finally { db.close(); }
  const p = join(repo, '.aify-graph', 'manifest.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  delete m.generation;
  writeFileSync(p, JSON.stringify(m));
};

// ⚠ generateBrief WRITES ARTIFACTS AND RETURNS BYTE COUNTS. My first version of this file asserted
// against its return value and every case failed with `expected '' to match` — the return is
// {md_bytes, agent_bytes, ...}, not content. The public output is the files on disk, which is also
// exactly what a reader consumes, so that is what these assert on.
const brief = () => {
  generateBrief({ repoRoot: repo });
  const g = join(repo, '.aify-graph');
  return {
    json: JSON.parse(readFileSync(join(g, 'brief.json'), 'utf8')),
    md: readFileSync(join(g, 'brief.md'), 'utf8'),
    agent: readFileSync(join(g, 'brief.agent.md'), 'utf8'),
  };
};

describe('a brief says whether the graph behind its trust figure was verified', () => {
  it('POSITIVE CONTROL: an attested graph reports publication attested and adds no issue', () => {
    // ⛔ Without this, every assertion below is satisfied by a brief that always warns — which
    // would be worse than silence, because a permanent warning is one nobody reads.
    const out = brief();
    expect(out.json.repo.trust.publication).toBe('attested');
    expectAbsentWithLiveMatcher(
      /publication \w+ — this graph/,
      {
        forbidden: "publication legacy_unattested — this graph's contents could not be verified",
        allowed: 'no entrypoints detected',
      },
      JSON.stringify(out.json.repo.trust.issues),
      'an attested graph must not carry a publication warning — a warning that always fires is one nobody reads',
    );
  });

  it('⛔ a LEGACY graph carries the state in the JSON trust object', () => {
    makeLegacy();
    const out = brief();
    expect(out.json.repo.trust.publication).toBe('legacy_unattested');
  });

  it('⛔ a LEGACY graph names it as a trust ISSUE, not merely a field', () => {
    // A field a consumer must know to consult is not a warning. The issues array is what the
    // markdown TRUST line renders, so this is what a human actually sees.
    makeLegacy();
    const issues = JSON.stringify(brief().json.repo.trust.issues);
    expect(issues).toMatch(/publication legacy_unattested/);
    expect(issues).toMatch(/could not be verified against the manifest/);
  });

  it('⛔ the trust LEVEL is not falsified — only qualified', () => {
    // The level measures how completely extraction resolved its references, which is a real
    // property of this graph and is unchanged by whether the publication can be checked.
    // Downgrading it would be inventing a second, different claim.
    const before = brief().json.repo.trust.level;
    makeLegacy();
    expect(brief().json.repo.trust.level).toBe(before);
  });

  it('⛔ the markdown surface shows it too — the JSON is not the only reader', () => {
    makeLegacy();
    const b = brief();
    expect(b.md, 'the full brief').toMatch(/publication=legacy_unattested/);
    expect(b.agent, 'and the agent brief, which is the one most readers actually load')
      .toMatch(/publication=legacy_unattested/);
  });
});
