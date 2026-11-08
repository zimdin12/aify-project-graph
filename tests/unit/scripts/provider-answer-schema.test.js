// #1: the provider answer the dashboard reads has a published, versioned contract, and apg's output meets it.
//
// Two populations are validated: the committed examples, generated through the REAL provider path by
// scripts/provider-examples.mjs (real instruments, real index, a real commit), and fresh answers from this file's
// hermetic resolver, so a change to answerRequest is caught without regenerating anything. The negative controls
// prove the schema can fail: an answer with no version, a version it does not know, or an exhaustive claim.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { resolveAnchor } from '../../../scripts/lib/anchor-resolver.mjs';
import { answerRequest, PROVIDER_FORMAT_VERSION } from '../../../scripts/lib/provider-requests.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('docs/schemas/provider-answer.v1.schema.json'));
const EXAMPLES = read('docs/schemas/examples/provider-answers.v1.json');

const HEAD = 'c'.repeat(40);
const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });
const deps = {
  languageOf: (rel) => { if (rel.endsWith('.js')) return { name: 'javascript' }; throw new Error('none'); },
  isDocument: () => false,
  readSource: (rel) => `source of ${rel}`,
  extract: ({ relPath }) => ({ nodes: [{ type: 'File', label: relPath }, { type: 'Function', label: 'alpha', structural_fp: 'S', dependency_fp: 'D' }], coverage: COMPLETE }),
  fileFingerprint: () => 'FILE-FP',
  docReferences: () => [],
  isPresent: (rel) => rel === 'src/a.js',
  where: 'commit c',
};
const ask = (call, args) => answerRequest({
  request: { call, args }, resolveItem: (item) => resolveAnchor({ repoRoot: '/unused', item, deps }), head: HEAD,
});
const errorsOf = (answer) => (validate(answer) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`));

describe('the committed examples, generated through the real provider path, meet the schema', () => {
  it('★★★ there is one example per call the provider answers, plus a refusal, and each validates', () => {
    expect(Object.keys(EXAMPLES.answers).sort()).toEqual(['refusal', 'resolve', 'stamp', 'subgraph']);
    for (const [name, answer] of Object.entries(EXAMPLES.answers)) expect(errorsOf(answer), name).toEqual([]);
    expect(EXAMPLES.answers.subgraph.value.nodes.length, 'the subgraph example must carry real nodes').toBeGreaterThan(0);
  });
});

describe('fresh answers carry the format version and meet the schema', () => {
  it('★★★ stamp, resolve and a refusal from answerRequest validate, and ok values carry the version', () => {
    const anchors = [{ path: 'src/a.js', name: 'alpha', kind: 'symbol' }, { path: 'src/gone.js', kind: 'file' }];
    for (const answer of [ask('stamp', { anchors }), ask('resolve', { anchors }), ask('nonsense', {})]) {
      expect(errorsOf(answer)).toEqual([]);
      if (answer.ok) expect(answer.value.formatVersion).toBe(PROVIDER_FORMAT_VERSION);
    }
  });
});

describe('the schema can fail', () => {
  const good = () => structuredClone(EXAMPLES.answers.stamp);
  it('★★★ an answer with no version, an unknown version, or an exhaustive claim is refused', () => {
    expect(errorsOf(good()), 'control: the untouched example passes').toEqual([]);
    const noVersion = good(); delete noVersion.value.formatVersion;
    const nextVersion = good(); nextVersion.value.formatVersion = PROVIDER_FORMAT_VERSION + 1;
    const exhaustive = good(); exhaustive.provenance.exhaustive = true;
    for (const [label, bad] of [['no version', noVersion], ['unknown version', nextVersion], ['exhaustive', exhaustive]]) {
      expect(errorsOf(bad).length, label).toBeGreaterThan(0);
    }
  });
});
