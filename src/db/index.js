import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NEW_CHECK_COLUMNS = [
  { name: 'webhook_url', ddl: 'TEXT' },
  { name: 'webhook_last_outcome', ddl: 'TEXT' },
  { name: 'webhook_last_attempted_at', ddl: 'TEXT' },
];

function addMissingColumns(db, table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const { name, ddl } of columns) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    }
  }
}

export function openDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  // Idempotent upgrade path: a `checks` table created by a schema.sql that predates
  // webhook alerting won't gain these columns from CREATE TABLE IF NOT EXISTS alone.
  addMissingColumns(db, 'checks', NEW_CHECK_COLUMNS);
  return db;
}
