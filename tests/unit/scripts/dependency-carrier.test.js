// ⛔ THE AMBIENT POPULATION, ENUMERATED RATHER THAN PRETENDED AWAY.
//
// A materialized candidate tree fixes SOURCE attribution and nothing else. `node_modules` is
// ignored by git, so it cannot come from the tree object T — the run still depends on ambient state
// by construction. I asked the referee whether that made materialization pointless. It does not:
//
//   > The honest endpoint is not "no ambient dependencies"; it is: source/test filesystem
//   > materialized exactly from T, plus a small explicitly enumerated dependency/environment
//   > carrier whose immutability limits are stated.
//
// ⇒ This does not make dependencies immutable. It makes them NAMED.
import { describe, it, expect } from 'vitest';
import { dependencyCarrier, unexpectedIgnored, environmentAllowlist, ENV_ALLOWLIST }
  from '../../../scripts/lib/dependency-carrier.mjs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

describe('the dependency carrier names what it cannot make immutable', () => {
  it('★★★ it states its own limit IN THE DATA, not only in prose', () => {
    // ⛔ Two lockfile hashes are not an inventory of the node_modules closure. If that limit lived
    // only in a comment, a reader of the receipt would never see it.
    const d = dependencyCarrier(REPO, `${REPO}node_modules`);
    expect(d.closureInventoried, 'never claim a closure we did not inventory').toBe(false);
    expect(d.transport).toMatch(/NOT immutable/);
  });

  it('★★★ it captures the things that actually decide what the tests do', () => {
    const d = dependencyCarrier(REPO, `${REPO}node_modules`);
    expect(d.node.version).toBe(process.version);
    expect(d.node.sha256, 'the interpreter is hashed, not just versioned').toMatch(/^[0-9a-f]{64}$/);
    expect(d.lockfiles.length, 'both lockfiles').toBe(2);
    expect(d.runner.sha256, 'the resolved runner entry').toMatch(/^[0-9a-f]{64}$/);
    expect(d.platform).toBe(`${process.platform}/${process.arch}`);
  });

  it('★★★ an ABSENT dependency is recorded as absent, never skipped', () => {
    // A carrier that silently omits what it could not find would claim a route it never checked.
    const d = dependencyCarrier(`${REPO}no-such-dir/`, `${REPO}no-such-dir/node_modules`);
    expect(d.runner.present).toBe(false);
    expect(d.lockfiles.every((l) => l.present === false)).toBe(true);
  });

  it('★★★ the environment is an ALLOWLIST, not a dump', () => {
    // ⛔ Dumping the whole environment would leak secrets into a committed receipt; capturing none
    // would hide the switches that change behaviour. APG_AUTO_REINDEX has already moved a graph
    // mid-run in this repo.
    expect(ENV_ALLOWLIST).toContain('APG_AUTO_REINDEX');
    const env = environmentAllowlist({ APG_AUTO_REINDEX: '1', SECRET_TOKEN: 'do-not-capture' });
    expect(env).toEqual({ APG_AUTO_REINDEX: '1' });
    expect(Object.keys(env), 'a secret outside the allowlist never travels').not.toContain('SECRET_TOKEN');
  });
});

describe('unexpectedIgnored — the unnamed population, bounded', () => {
  it('★★★ the declared dependency transport is allowed', () => {
    expect(unexpectedIgnored(['node_modules/'])).toEqual([]);
  });

  it('★★★ anything undeclared is REPORTED — caches, generated configs, unknowns', () => {
    // ⛔ POSITIVE CONTROL for the whole predicate: if it allowed everything, every assertion here
    // would pass while the class certified runs that read state nobody named.
    expect(unexpectedIgnored(['some/cache/'])).toEqual(['some/cache/']);
    expect(unexpectedIgnored(['.aify-graph/']), 'undeclared by default').toEqual(['.aify-graph/']);
  });

  it('★★★ a DECLARED gate output is allowed at any depth — the nesting bug', () => {
    // ⛔ My first version compared only the LEADING segment, so a declared output nested inside a
    // fixture read as undeclared and the class refused its own gate's legitimate product.
    // Measured: the suite creates graph databases inside fixture repos as part of testing.
    const allowed = ['node_modules', '.aify-graph'];
    expect(unexpectedIgnored(['.aify-graph/'], allowed)).toEqual([]);
    expect(unexpectedIgnored(['tests/fixtures/code-intel/cpp-fixture-repo/.aify-graph/'], allowed)).toEqual([]);
    // ⚠ AND THE BOUND THIS ACCEPTS: a declared name is allowed at ANY depth. Something merely
    // NEAR it is still refused, so the allowance is by name rather than by neighbourhood.
    expect(unexpectedIgnored(['tests/fixtures/.aify-graph-backup/'], allowed))
      .toEqual(['tests/fixtures/.aify-graph-backup/']);
  });

  it('★★★ CONTROL: an empty or missing list yields nothing to refuse', () => {
    expect(unexpectedIgnored([])).toEqual([]);
    expect(unexpectedIgnored(undefined)).toEqual([]);
  });
});
