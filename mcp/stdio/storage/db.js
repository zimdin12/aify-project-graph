import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSchema } from './schema.js';

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema(db);

  return {
    raw: db,
    all: (sql, params) => db.prepare(sql).all(params ?? {}),
    get: (sql, params) => db.prepare(sql).get(params ?? {}),
    run: (sql, params) => db.prepare(sql).run(params ?? {}),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}
