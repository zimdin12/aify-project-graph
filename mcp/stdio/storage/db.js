import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSchema } from './schema.js';

function wrapDb(db) {
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

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');  // OFF during bulk ingest — edges may reference not-yet-inserted nodes
  createSchema(db);

  return wrapDb(db);
}

export function openExistingDb(dbPath, { readonly = true } = {}) {
  if (!existsSync(dbPath)) {
    throw new Error(`graph DB does not exist: ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly, fileMustExist: true });
  return wrapDb(db);
}
