import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uriToRepoRelativeSafe } from '../../../mcp/stdio/ingest/code-intel/paths.js';

// FIELD REPORT, ef-manager, 2026-08-25 (v0.7.0 build 82172be): every definitionLocations[0].file
// came back as `.../VC/Tools/MSVC/14.43.34604/include` — a DIRECTORY holding 277 headers, and
// exactly `toolset.includeDir` from msvc-env.js. It appeared with ebba7de, so it is mine.
//
// It also duplicated same-file references, so telemetry.references OVERCOUNTED by the number of
// same-file refs — a number a reader will quote.
//
// ⚠ THE ORIGIN OF THAT URI IS NOT ESTABLISHED and these tests do not claim it. They pin the two
// things that ARE established: `uriToRepoRelativeSafe` can distinguish an out-of-repo path, and a
// DIRECTORY IS NOT A SOURCE LOCATION under any origin story.

describe('uriToRepoRelativeSafe — the signal that was being discarded', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-oor-'));

  it('marks a path inside the repo ok:true and returns it repo-relative', () => {
    const f = path.join(repo, 'src', 'a.cpp');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '');
    const r = uriToRepoRelativeSafe(pathToFileURL(f).toString(), repo);
    expect(r.ok).toBe(true);
    expect(r.path).toBe('src/a.cpp');
  });

  it('⭐ marks a path OUTSIDE the repo ok:false with a reason — the discarded signal', () => {
    // uriToRel returned `.path` alone, so this arrived looking exactly like a repo file.
    const outside = path.join(os.tmpdir(), 'definitely-not-in-the-repo.h');
    const r = uriToRepoRelativeSafe(pathToFileURL(outside).toString(), repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outside_project_root');
    expect(r.path).toContain('definitely-not-in-the-repo.h');
  });

  it('⛔ a DIRECTORY is detectable as one — it has no line to point at', () => {
    // The observed corruption was an include DIRECTORY in a `file` field. Whatever emits it, a
    // consumer can tell: this is the check that makes the drop possible.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-incdir-'));
    const r = uriToRepoRelativeSafe(pathToFileURL(dir).toString(), repo);
    expect(r.ok).toBe(false);
    expect(fs.statSync(r.path).isDirectory()).toBe(true);
  });

  it('a real FILE outside the repo is NOT a directory — the guard must not drop it', () => {
    // The discrimination that matters: a system header is a legitimate answer and must survive.
    // A guard that dropped every out-of-repo location would delete real definitions.
    const f = path.join(os.tmpdir(), `apg-real-header-${process.pid}.h`);
    fs.writeFileSync(f, '#pragma once\n');
    const r = uriToRepoRelativeSafe(pathToFileURL(f).toString(), repo);
    expect(r.ok).toBe(false);
    expect(fs.statSync(r.path).isDirectory()).toBe(false);
    fs.rmSync(f, { force: true });
  });

  it('a non-file URI is reported as such rather than silently passed through', () => {
    const r = uriToRepoRelativeSafe('not-a-uri-at-all', repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_a_file_uri');
  });
});
