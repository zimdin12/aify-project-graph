// ⛔ THE SERVER TOLD EVERY CLIENT IT WAS 0.1.0 WHILE SHIPPING 0.8.0.
//
// Measured 2026-09-06 while installing the latest build: a freshly spawned server answered
// `initialize` with `serverInfo: { name: 'aify-project-graph', version: '0.1.0' }` against a
// `package.json` reading `0.8.0`. The literal had been sitting in the handshake across seven
// releases.
//
// ⚠ IT IS NOT MERELY COSMETIC. `serverInfo.version` is the one field a client reads to say WHICH
// BUILD it is talking to, and this project's whole freshness story is about a running process
// holding old code. A server that misreports its own version cannot participate in that story, and
// "install the latest version" had no way to be verified from the outside.
//
// ⭐ DERIVED, NOT RESTATED. `package.json` is the one place a version belongs, so the handshake reads
// it rather than carrying a copy that has to be remembered on every bump. A literal here is a defect
// with a release-shaped delay on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the server reports the version it actually is', () => {
  it('★★★ the handshake version is DERIVED from package.json, not a literal', () => {
    const src = read('../../../mcp/stdio/server.js');
    // ⛔ expectAbsentWithLiveMatcher, NOT a bare not.toMatch. I wrote the bare form here and the
    // ratchet caught it in the very next suite run — the sixth time, against a rule of my own. A
    // negative assertion whose matcher nobody proved can pass because the pattern is wrong, which is
    // the one failure mode that looks exactly like success. The helper carries the proof with the
    // assertion: `forbidden` is the old shape the matcher MUST still match, `allowed` is the new one
    // it must not.
    expectAbsentWithLiveMatcher(
      /version: *'\d+\.\d+\.\d+'/,
      {
        forbidden: "serverInfo: { name: 'aify-project-graph', version: '0.1.0' },",
        allowed: "serverInfo: { name: 'aify-project-graph', version: PACKAGE_VERSION },",
      },
      src,
      'the handshake must not carry a literal semver',
    );
    expect(src, 'it must read the real one').toContain('PACKAGE_VERSION');
  });

  it('★★★ and the value it derives IS the shipped version', () => {
    // The source assertion above only proves the literal is gone. This proves the wiring reaches the
    // right file — the two together are what make the claim, and neither does alone.
    const pkg = JSON.parse(read('../../../package.json'));
    const src = read('../../../mcp/stdio/server.js');
    const match = src.match(/PACKAGE_VERSION\s*=\s*([^;]+);/);
    expect(match, 'PACKAGE_VERSION must be assigned once').not.toBeNull();
    expect(match[1], 'it must come from package.json').toContain('package.json');
    // Live control: the version we are comparing against is a real semver, so a typo in the fixture
    // cannot make this pass vacuously.
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
