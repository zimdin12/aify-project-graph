import { join } from 'node:path';
import { helper } from './helper.js';
import defaultImport from './default.js';

export function run() {
  const p = join('a', 'b');
  helper(p);
  defaultImport();
}
