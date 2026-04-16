import { mkdir } from 'node:fs/promises';
import lockfile from 'proper-lockfile';

export async function withWriteLock(repoRoot, fn) {
  const graphDir = `${repoRoot.replace(/\\/g, '/')}/.aify-graph`;
  const lockPath = `${graphDir}/.write.lock`;

  await mkdir(graphDir, { recursive: true });
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    retries: { retries: 5, factor: 1.5, minTimeout: 25, maxTimeout: 250 },
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}
