// ⛔ REFUSE, DO NOT WARN. A WARNING THAT IS RELIABLY IGNORED IS NOT A LIGHTER GUARD.
//
// ef-manager, roadmap 6b: "Three of my last four rounds opened blocked on a stale MCP process…
// Right now the only actor who can fix it is the one who cannot see it."
//
// The warning has been on the shared read channel for weeks and did not stop those three rounds.
// It also costs the reader attention on every healthy read to buy nothing on the unhealthy ones.
// A rule is not a remedy; only a closed door is.
//
// ⚠ ONE PROCESS SERVES EVERY REPOSITORY, so the stale bytes are the SERVER'S and switching repos
// does not escape them. The refusal is process-scoped for the same reason the defect is.
import { describe, it, expect } from 'vitest';
import { decideStaleRefusal } from '../../../mcp/stdio/server-build.js';

// The three states of `staleDelta.behaviourally_current`, which is what decides this.
const stale = (extra = {}) => ({
  staleProcess: true,
  buildId: 'cad4569',
  workingTreeCommit: 'c526849',
  staleSignals: { commitMoved: true, sourceEdited: false },
  ...extra,
});

describe('what refuses, and what deliberately does not', () => {
  it('★★★ a healthy process does not refuse', () => {
    // ⛔ THE BASELINE. Without it, every refusal below is satisfied by a function that always
    // refuses — which would block every read in the product.
    expect(decideStaleRefusal({ staleProcess: false }, {})).toBeNull();
    expect(decideStaleRefusal({}, {}), 'and a build info with no verdict at all').toBeNull();
    expect(decideStaleRefusal(null, {}), 'and a missing one').toBeNull();
  });

  it('★★★⛔ EXECUTABLE FILES CHANGED — refuses, and says what and how to recover', () => {
    const b = decideStaleRefusal(stale({
      staleDelta: { behaviourally_current: false, executable_files_changed: 3, sample: ['a.js', 'b.js'] },
    }), {});
    expect(b).toMatch(/STALE SERVER PROCESS/);
    expect(b, 'the count is named, not just the fact').toMatch(/3 executable file/);
    expect(b, 'and a sample so the reader can judge').toMatch(/a\.js/);
    expect(b, 'graph_health must stay reachable or the refusal is a dead end')
      .toMatch(/graph_health\(\) still answers/);
    expect(b, 'and the door out is named').toMatch(/APG_ALLOW_STALE_PROCESS=1/);
    expect(b, 'and that switching repos does not help').toMatch(/One process serves EVERY repository/);
  });

  it('★★★⛔ THE OVER-CORRECTION GUARD: a DOCS-ONLY delta must NOT refuse', () => {
    // ⛔ THE CASE ef-manager ACTUALLY HIT AND OBJECTED TO: loaded cad4569 vs tree c526849,
    // staleProcess true, and the entire delta was ONE DOC. They had to run `git diff --name-only`
    // themselves to learn the running server was behaviourally current.
    //
    // ⇒ Hard-blocking there would be worse than the defect: it teaches people to set the override
    // permanently, and then the guard is gone for the case that matters. The warning still fires;
    // only the door stays open.
    expect(decideStaleRefusal(stale({
      staleDelta: { behaviourally_current: true, executable_files_changed: 0, files_changed: 1 },
    }), {}), 'a process that is behaviourally current still answers').toBeNull();
  });

  it('★★★⛔ UNKNOWN REFUSES — fail closed, because unknown is not "fine"', () => {
    // `behaviourally_current: null` means this process loaded uncommitted changes, so it
    // corresponds to no commit and a commit-to-commit diff cannot describe what it is running.
    // That is precisely when a confident answer is most dangerous.
    const b = decideStaleRefusal(stale({
      staleDelta: { behaviourally_current: null, executable_files_changed: 0 },
    }), {});
    expect(b, 'unknown must not read as safe').not.toBeNull();
    expect(b).toMatch(/cannot be classified/);
  });

  it('★★★ no staleDelta at all also refuses', () => {
    // A stale process whose delta could not be computed is the same unknown as above, arriving by
    // a different route — `staleDelta` is only populated when a commit moved.
    expect(decideStaleRefusal(stale({ staleSignals: { sourceEdited: true } }), {})).not.toBeNull();
  });

  it('★★★ EDITED SOURCE is named as its own cause, distinct from a moved commit', () => {
    // The two signals mean different things to a reader: "someone committed" versus "the files I
    // am executing have been rewritten under me". Collapsing them would send the wrong remedy.
    const edited = decideStaleRefusal(stale({ staleSignals: { commitMoved: false, sourceEdited: true } }), {});
    expect(edited).toMatch(/EDITED since this process loaded them/);
    const moved = decideStaleRefusal(stale({
      staleDelta: { behaviourally_current: false, executable_files_changed: 1, sample: [] },
    }), {});
    expect(moved).toMatch(/running cad4569, the checkout is now c526849/);
  });
});

describe('the forced door', () => {
  it('★★★ the override opens it, and only the exact value does', () => {
    const b = stale({ staleDelta: { behaviourally_current: false, executable_files_changed: 1, sample: [] } });
    expect(decideStaleRefusal(b, { APG_ALLOW_STALE_PROCESS: '1' }), 'explicit opt-out is honoured').toBeNull();
    // ⛔ FAIL CLOSED ON ANYTHING ELSE. A truthy-but-not-'1' value is how a config typo silently
    // disables a guard — the same shape as `writable: 'yes'` granting writes.
    for (const v of ['0', 'true', 'yes', '', undefined]) {
      expect(decideStaleRefusal(b, { APG_ALLOW_STALE_PROCESS: v }),
        `APG_ALLOW_STALE_PROCESS=${JSON.stringify(v)} must not disable the guard`).not.toBeNull();
    }
  });
});
