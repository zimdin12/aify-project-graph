# Re-prove every red watch for the anchor resolver, in one reproducible run.
#
#   python3 docs/evidence/dashboard-seam-2026-09-30/red-watch.py
#
# ⛔ EVERY MUTATION ASSERTS ITS ANCHOR COUNT BEFORE IT IS APPLIED. A scripted replace that matches nothing
# leaves the source pristine and the suite GREEN, and a green over unmutated source reads exactly like a
# guard that is inert. That happened three times in one day here, so the assert is not optional decoration:
# it is the only thing separating "the guard is load-bearing" from "the edit never landed".
#
# ⛔ AND THE FILE IS RESTORED BYTE-FOR-BYTE AND RE-VERIFIED GREEN AT THE END, so a crash mid-run cannot leave
# a mutant in the tree for a later suite to find.
#
# ⚠ NO_COLOR is set because the captured output is committed as evidence, and vitest's ANSI escapes are raw
# control bytes that `tests/unit/no-raw-nul-bytes.test.js` correctly refuses. That guard caught this.
import io
import os
import subprocess
import sys

# ⚠ This console defaults to cp1257 and cannot encode the arm names' ★ / ⛔ / → characters. Without this the
# script crashes while printing a CORRECT result, and that crash reads like a failed red watch.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

RESOLVER = 'scripts/lib/anchor-resolver.mjs'
RESOLVER_TEST = 'tests/unit/scripts/anchor-resolver.test.js'
CLIENT = 'scripts/lib/dashboard-signals-client.mjs'
CLIENT_TEST = 'tests/unit/scripts/dashboard-signals-client.test.js'
EVIDENCE = 'docs/evidence/dashboard-seam-2026-09-30'

# Each mutation is the change an ORDINARY REFACTOR would produce, never a contrived break. M2 in particular
# REMOVES a guard rather than respelling it: a row asking whether a guard is load-bearing must remove it,
# because an equivalent spelling measures nothing in the most convincing way available.
MUTATIONS = [
    (
        RESOLVER, RESOLVER_TEST,
        'M1-null-baseline-reports-changed',
        "    return result(watchId, 'restamp', { ...base, evidence: `first baseline for this anchor — ${evidence}` });",
        "    return result(watchId, 'changed', { ...base, evidence: `MUTANT M1 ${evidence}` });",
        'a first sweep claims every anchor CHANGED',
    ),
    (
        RESOLVER, RESOLVER_TEST,
        'M2-zero-symbols-reports-gone',
        "  if (symbols.length === 0) return unwatched(watchId, 'symbol_kind_not_modelled');",
        '  // MUTANT M2: population guard removed',
        'a symbol the extractor never models is reported GONE',
    ),
    (
        RESOLVER, RESOLVER_TEST,
        'M3-doc-path-never-asked',
        "    if (!deps.isDocument(relPath)) return unwatched(watchId, 'unhandled_language');",
        "    return unwatched(watchId, 'unhandled_language'); // MUTANT M3",
        'coverage routed on ONE predicate, so a covered document reads as an absence',
    ),
    (
        RESOLVER, RESOLVER_TEST,
        'M4-existssync-is-case-insensitive',
        '  if (segments.length === 0) return false;',
        '  if (segments.length >= 0) return existsSync(join(repoRoot, relPath)); // MUTANT M4',
        'the case-insensitive filesystem answers the exact-case question',
    ),
    (
        RESOLVER, RESOLVER_TEST,
        'M5-kind-file-unsupported',
        "const WHOLE_FILE_KINDS = Object.freeze(['module', 'file']);",
        "const WHOLE_FILE_KINDS = Object.freeze(['module']); // MUTANT M5",
        'a real anchor kind from the live set is refused as unknown',
    ),
    (
        CLIENT, CLIENT_TEST,
        'M6-reporterid-missing-from-the-body',
        '      reporterId: this.reporterId, head, watchRevision, results, unwatched,',
        '      head, watchRevision, results, unwatched, // MUTANT M6',
        'the batch omits reporterId — the bug that shipped, and a 400 from the live route',
    ),
    (
        CLIENT, CLIENT_TEST,
        'M7-key-in-the-url',
        '    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {',
        '    const response = await this.fetchImpl(`${this.baseUrl}${path}?k=${this.#apiKey}`, { // MUTANT M7',
        'the api key is put in the URL, where every access log keeps it',
    ),
]

IMPORT_OLD = "import { readdirSync } from 'node:fs';"
IMPORT_NEW = "import { readdirSync, existsSync } from 'node:fs';"


def read(path):
    return io.open(path, encoding='utf-8', newline='').read()


def write(path, text):
    io.open(path, 'w', encoding='utf-8', newline='').write(text)


def run_tests(test_file, log_path, header):
    env = dict(os.environ, NO_COLOR='1', FORCE_COLOR='0')
    proc = subprocess.run(
        ['npx', 'vitest', 'run', test_file],
        capture_output=True, text=True, env=env, shell=(os.name == 'nt'),
        encoding='utf-8', errors='replace',
    )
    body = f'{header}\n\n{proc.stdout}\n{proc.stderr}'
    write(log_path, body)
    return proc.returncode, body


def main():
    pristine = {path: read(path) for path in {m[0] for m in MUTATIONS}}

    # ⛔ THE POSITIVE CONTROL COMES FIRST. If the suite is not green before any mutation, every red below is
    # about something else, and a red for the wrong reason is worse than no red at all.
    code, _ = run_tests(RESOLVER_TEST, f'{EVIDENCE}/green-before-mutations.txt',
                        'BASELINE: unmutated source must be GREEN')
    code_client, _ = run_tests(CLIENT_TEST, f'{EVIDENCE}/green-before-mutations-client.txt',
                               'BASELINE: unmutated client must be GREEN')
    code = code or code_client
    if code != 0:
        print('REFUSING: the suite is not green before any mutation. Nothing below would mean anything.')
        return 1
    print('baseline GREEN')

    failures = []
    try:
        for target, test_file, name, old, new, what in MUTATIONS:
            source = pristine[target]
            if 'existsSync' in new and target == RESOLVER:
                assert source.count(IMPORT_OLD) == 1, (name, 'import anchor', source.count(IMPORT_OLD))
                source = source.replace(IMPORT_OLD, IMPORT_NEW)
            # ⛔ THE ASSERT THAT MAKES THIS TRUSTWORTHY.
            count = source.count(old)
            assert count == 1, (name, 'anchor count', count)
            write(target, source.replace(old, new))
            assert new in read(target), (name, 'mutation did not reach the file')

            code, body = run_tests(
                test_file,
                f'{EVIDENCE}/red-{name}.txt',
                f'MUTATION {name} — {what}\nWhat was replaced:\n  {old}\nWith:\n  {new}',
            )
            reds = [l.strip() for l in body.splitlines() if l.lstrip().startswith(('×', 'x ')) or ' × ' in l]
            reasons = [l.strip() for l in body.splitlines() if l.strip().startswith('→')]
            if code == 0:
                failures.append(f'{name}: STAYED GREEN — the guard is inert, or the arm cannot see it')
                print(f'{name}: ⛔ STAYED GREEN')
            else:
                if not reds:
                    failures.append(f'{name}: exit was non-zero but NO ARM WAS NAMED — that is a broken run, '
                                    'not a red watch')
                print(f'{name}: red ({len(reds)} arm(s))')
                for line in reds + reasons:
                    print(f'    {line}')
    finally:
        for path, text in pristine.items():
            write(path, text)
            assert read(path) == text, f'restore failed for {path} — a mutant may still be in the tree'
        print('restored byte-identical')

    code, _ = run_tests(RESOLVER_TEST, f'{EVIDENCE}/green-after-restore.txt',
                        'AFTER RESTORE: the suite must be GREEN again')
    code_client, _ = run_tests(CLIENT_TEST, f'{EVIDENCE}/green-after-restore-client.txt',
                               'AFTER RESTORE: the client suite must be GREEN again')
    code = code or code_client
    if code != 0:
        failures.append('the suite is NOT green after the restore')
    else:
        print('after restore GREEN')

    for line in failures:
        print(f'FAILURE: {line}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
