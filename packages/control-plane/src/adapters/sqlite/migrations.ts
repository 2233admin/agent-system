import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', '..', 'migrations');
}

function readMigration(filename: string): string {
  return readFileSync(path.join(migrationsDir(), filename), 'utf8');
}

/**
 * Ensures `stable_config`/`stable_config_revision` (0001) exist, then
 * ensures the Story 3.1 (AD-21) `supersedes_revision_id` column and its two
 * unique indexes (0003) exist. Idempotent and transactional -- every
 * connection that touches `stable_config_revision`, read-only repository or
 * write port alike, must run this independently rather than assume another
 * connection already brought the schema up to date (AD-21: a new
 * connection must never assume another connection's schema/pragma state).
 *
 * The column add is done programmatically (guarded by `PRAGMA table_info`)
 * rather than via a plain `ALTER TABLE` in the `.sql` file, because SQLite's
 * `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` form -- re-running the raw
 * DDL a second time (e.g. from a second connection opened against the same
 * file) would otherwise fail with "duplicate column name".
 */
export function runConfigRevisionMigrations(db: Database): void {
  const initSql = readMigration('0001_init.sql');
  const supplySql = readMigration('0003_supply.sql');

  db.transaction(() => {
    db.exec(initSql);

    const columns = db.query<{ name: string }, []>('PRAGMA table_info(stable_config_revision)').all();
    const hasSupersedesColumn = columns.some((column) => column.name === 'supersedes_revision_id');
    if (!hasSupersedesColumn) {
      db.exec('ALTER TABLE stable_config_revision ADD COLUMN supersedes_revision_id TEXT');
    }

    db.exec(supplySql);
  })();
}
