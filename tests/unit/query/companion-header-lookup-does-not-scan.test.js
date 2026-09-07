// ⛔ A CAP WITH NO `ORDER BY` DECIDED WHETHER A SYMBOL "HAS NO TESTS".
//
// `findCompanionHeaders` used to select EVERY header in the graph under `LIMIT 5000` — with no
// ORDER BY — and then filter in JS for the one it wanted. On a repository with more than 5000
// headers, WHICH 5000 came back was arbitrary, so the companion header could simply not be among
// them.
//
// ⛔ AND THAT IS A FALSE-CLAIM DEFECT, NOT A RECALL ONE. The headers feed `companionHeaderTests` ->
// `directUniqueTests` -> `uniqueTests`, and an empty `uniqueTests` pushes the `no_test_coverage`
// risk flag. A missed header produces a confident claim that a symbol has no adjacent tests — and
// consequences.js already carried the sentence "ignoring it produced false `no_test_coverage`
// flags" about a different route to the same wrong answer.
//
// ⭐ IT WAS DEFERRED ONCE, WITH A WRONG REASON. "Feeds a filtered Set, reported with no count ⇒
// recall question, not a false-claim one." Checking that REASON rather than the fix is what found
// it — the second deferral in one session whose severity was inverted. ⇒ A DEFERRAL IS THE ONE
// ARTIFACT WHERE THE AUTHOR OF THE REASON IS ALSO ITS ONLY READER, AND NOTHING DOWNSTREAM EVER
// EXECUTES IT.
//
// ⚠ AND IT IS UNREACHABLE ON THIS REPOSITORY. Our own graph holds SIX header paths, so the cap
// never bound and never would. The fixture below therefore carries 6001 — the defect only exists on
// the C++ repositories this project targets, which is exactly the population our tests do not
// resemble. Discrimination was measured before this file existed: on a 6001-header fixture the old
// scan-and-filter returned [], this lookup returns the header.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCompanionHeaders } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// ⛔ WRITTEN DOWN, NOT IMPORTED. The old cap was 5000 and the subject no longer has that constant;
// importing anything from the subject would make this fixture agree with whatever it says.
const OLD_CAP = 5000;

let dir;
let db;
afterEach(async () => {
  if (db) { try { db.close(); } catch { /* already closed */ } db = undefined; }
  if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch { /* win lock */ } }
  dir = undefined;
});

async function graphWithNoiseHeaders(noiseCount) {
  dir = await mkdtemp(join(tmpdir(), 'apg-hdr-'));
  const handle = openDb(join(dir, 'g.sqlite'));
  const add = (id, file) => handle.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','File','${id}','${file}',1,2,'cpp',1,'{}')`);
  // One transaction: 6001 individual inserts take seconds, one batch takes milliseconds.
  handle.transaction(() => {
    for (let i = 0; i < noiseCount; i += 1) add(`n${i}`, `src/noise${i}.h`);
    // The wanted header is inserted LAST, so an unordered page of the first 5000 does not hold it.
    add('want', 'src/widget.h');
    add('impl', 'src/widget.cpp');
  })();
  return handle;
}

describe('the companion-header lookup asks for what it wants', () => {
  it('★★★ THE REAL CASE: the paired header is found with 6001 headers in the graph', async () => {
    db = await graphWithNoiseHeaders(OLD_CAP + 1000);
    expect(
      findCompanionHeaders(db, ['src/widget.cpp']),
      'a scan-and-filter under an unordered cap could not see this header',
    ).toEqual(['src/widget.h']);
  }, 120_000);

  it('★★ THE CONTROL THE OLD QUERY WOULD ALSO HAVE PASSED, and it is labelled as such', async () => {
    // ⛔ THIS PROVES NOTHING ON ITS OWN. A small fixture passes with the broken query and the fixed
    // one identically. It is here only so a failure above can be attributed to the CAP rather than
    // to the lookup being broken outright — a control that separates two causes, not two outcomes.
    db = await graphWithNoiseHeaders(3);
    expect(findCompanionHeaders(db, ['src/widget.cpp'])).toEqual(['src/widget.h']);
  }, 60_000);

  it('★★ absence stays absence: no implementation file, and no header on disk', async () => {
    db = await graphWithNoiseHeaders(3);
    // Not a C/C++ implementation file: the function must not query, and must not invent a header.
    expect(findCompanionHeaders(db, ['src/only.js'])).toEqual([]);
    expect(findCompanionHeaders(db, [])).toEqual([]);
    // A .cpp whose header genuinely is not in the graph is an honest empty, not a miss.
    expect(findCompanionHeaders(db, ['src/absent.cpp'])).toEqual([]);
  }, 60_000);
});
