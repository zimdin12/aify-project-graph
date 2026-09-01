// An absence claim must name the EVIDENCE-DEPTH scope, not only the relation scope.
//
// `absence-names-its-population.test.js` covers the other half: which RELATIONS were never
// consulted. This covers which SPINE covered the question — because "no callers in indexed scope"
// and "no callers" are different facts and an agent cannot act on the difference unless it is said.
//
// ⛔ THE FACTS WERE ALREADY IN SCOPE AND WERE DISCARDED. All four call sites pass
// `{ noun, db, repoRoot }`; the signature destructured only `noun`, so the line was a constant.
// It told the reader to DOUBT without naming why — and "doubt this result" is exactly what an
// agent gets free from grep, so it bought nothing.
//
// ⛔ WHY THIS IS WORTH TOKENS ON A BILLED SURFACE. "The heuristic graph is not exhaustive" supports
// no next action. "No compile_commands.json, so clangd resolved no call — generate one with
// -DCMAKE_EXPORT_COMPILE_COMMANDS=ON" supports exactly one, and it is the correct one.
import { describe, it, expect } from 'vitest';
import { buildAbsenceTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// A db stub whose ONLY job is to answer getLatestCollection's two queries. Driving the real verb
// would exercise indexing, not the branch under test.
const dbWith = (rows) => ({
  get(sql, params) {
    const wantsLang = /language=\$lang/.test(sql);
    if (wantsLang) return rows.byLanguage?.[params?.lang] ?? null;
    return rows.latest ?? null;
  },
  all() { return []; },
});

const CPP_NO_DB = { collection_id: 'c1', language: 'cpp', compile_db_hash: null, operations_json: '{}' };
const CPP_WITH_DB = { collection_id: 'c2', language: 'cpp', compile_db_hash: 'abc123', operations_json: '{}' };
const TS_COLL = { collection_id: 'c3', language: 'typescript', compile_db_hash: null, operations_json: '{}' };

describe('an absence claim names the spine that covered it', () => {
  it('POSITIVE CONTROL: the base trust caveat is still present in every branch', async () => {
    // Without this, a scope clause could silently REPLACE the caveat it was meant to extend.
    for (const db of [null, dbWith({ latest: null }), dbWith({ latest: CPP_NO_DB, byLanguage: { cpp: CPP_NO_DB } })]) {
      const line = await buildAbsenceTrustLine({ noun: 'callers', db });
      expect(line, 'the non-exhaustive caveat must survive').toMatch(/NOT exhaustive/);
    }
  });

  it('★ no collection at all — says so, and names the verb that fixes it', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers', db: dbWith({ latest: null }) });
    expect(line).toMatch(/no code-intel collection exists/);
    expect(line, 'must name the remedy, not just the problem').toMatch(/graph_collect_code_intel/);
  });

  it('★ a C++ collection with NO compile db — names the standing limit and the exact fix', async () => {
    const line = await buildAbsenceTrustLine({
      noun: 'callers', db: dbWith({ latest: CPP_NO_DB, byLanguage: { cpp: CPP_NO_DB } }),
    });
    expect(line).toMatch(/no compile_commands\.json/);
    expect(line).toMatch(/CMAKE_EXPORT_COMPILE_COMMANDS/);
    expect(line, 'the set is a floor, and must be called one').toMatch(/FLOOR/);
  });

  it('a C++ collection WITH a compile db does not claim the compile db is missing', async () => {
    const line = await buildAbsenceTrustLine({
      noun: 'callers', db: dbWith({ latest: CPP_WITH_DB, byLanguage: { cpp: CPP_WITH_DB } }),
    });
    // ⛔ A bare not.toMatch would pass just as happily if the matcher were dead.
    expectAbsentWithLiveMatcher(
      /no compile_commands\.json/,
      { forbidden: 'ran with no compile_commands.json, so clangd', allowed: 'the newest code-intel collection is cpp' },
      line,
      'must not report a missing compile db when one was recorded',
    );
  });

  it('a non-C++ collection names the language it covered', async () => {
    const line = await buildAbsenceTrustLine({
      noun: 'callers', db: dbWith({ latest: TS_COLL, byLanguage: {} }),
    });
    expect(line).toMatch(/newest code-intel collection is typescript/);
  });

  it('a throwing db degrades to the base caveat rather than losing the warning', async () => {
    // Fail-safe: the trust line is the last thing that may disappear on an error path.
    const line = await buildAbsenceTrustLine({
      noun: 'callers', db: { get() { throw new Error('db closed'); }, all() { return []; } },
    });
    expect(line).toMatch(/NOT exhaustive/);
    // ⚠ SECOND TIME IN ONE SESSION. I wrote a bare `not.toMatch` here after using the live matcher
    // four tests above, and the ratchet caught it — again. A bare negative passes identically when
    // the output is clean and when the matcher is dead.
    expectAbsentWithLiveMatcher(
      /SCOPE:/,
      { forbidden: ' SCOPE: no code-intel collection exists', allowed: 'TRUST: absence is from the heuristic graph' },
      line,
      'a db error must not emit a scope clause it could not read',
    );
  });
});
