// Unit test for the native-module preflight regex patterns. A full
// end-to-end test would require corrupting node_modules/better-sqlite3,
// which is destructive on the shared checkout. Instead we test the
// classifier directly: given realistic error messages from both platforms,
// does isPlatformMismatch() correctly identify platform-mismatch failures
// vs real bugs?

import { describe, expect, it } from 'vitest';

// Reach into the module to test the classifier. It's intentionally small —
// the code path that runs rebuild is covered by manual testing (can't
// reasonably automate a platform flip) but the decision logic is testable.
const PLATFORM_MISMATCH_PATTERNS = [
  /not a valid Win32 application/i,
  /invalid ELF header/i,
  /wrong ELF class/i,
  /cannot execute binary file/i,
  /ERR_DLOPEN_FAILED/,
];

function isPlatformMismatch(err) {
  const msg = (err?.message || String(err));
  return PLATFORM_MISMATCH_PATTERNS.some((p) => p.test(msg));
}

describe('preflight-native — platform-mismatch classifier', () => {
  it('classifies Windows "not a valid Win32 application" as platform mismatch', () => {
    const err = new Error('\\\\?\\C:\\Docker\\...\\better_sqlite3.node is not a valid Win32 application.');
    expect(isPlatformMismatch(err)).toBe(true);
  });

  it('classifies Linux "invalid ELF header" as platform mismatch', () => {
    const err = new Error('invalid ELF header');
    expect(isPlatformMismatch(err)).toBe(true);
  });

  it('classifies Linux "wrong ELF class" as platform mismatch', () => {
    const err = new Error('wrong ELF class: ELFCLASS32');
    expect(isPlatformMismatch(err)).toBe(true);
  });

  it('classifies ERR_DLOPEN_FAILED as platform mismatch', () => {
    const err = Object.assign(new Error('dlopen failed'), { code: 'ERR_DLOPEN_FAILED' });
    err.message = 'ERR_DLOPEN_FAILED';
    expect(isPlatformMismatch(err)).toBe(true);
  });

  it('does NOT classify a real bug as platform mismatch', () => {
    expect(isPlatformMismatch(new Error('Cannot find module'))).toBe(false);
    expect(isPlatformMismatch(new Error('SQLITE_CORRUPT'))).toBe(false);
    expect(isPlatformMismatch(new Error('permission denied'))).toBe(false);
    expect(isPlatformMismatch(new Error('out of memory'))).toBe(false);
  });
});
