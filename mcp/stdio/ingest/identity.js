// Graph node identity: the one definition (#19). Every extractor, the sweep and every framework plugin import this.
// It was copied into four files; one copy drifting would give the same node two ids. Changing it moves every node id
// in every graph, so it is a migration, never a refactor (tests/unit/ingest/identity-helpers-have-one-owner.test.js).
import { createHash } from 'node:crypto';

export function stableId(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}
