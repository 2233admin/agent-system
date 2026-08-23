import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { isKnown } from '../../domain/facts';
import type { Fact } from '../../domain/facts';
import type { StableConfigRevision } from '../../domain/config';
import {
  InvalidTriggerCategoryError,
  MissingEvidenceError,
  TRIGGER_CATEGORIES,
} from '../../application/ports';
import type { ConfigRevisionWriter, NewConfigRevisionInput, RevisionTriggerInput, TriggerCategory } from '../../application/ports';
import { REVISION_COLUMNS, SUPPORTED_SCHEMA_VERSION } from './repository';
import { runConfigRevisionMigrations } from './migrations';

function isValidTriggerCategory(value: string): value is TriggerCategory {
  return (TRIGGER_CATEGORIES as readonly string[]).includes(value);
}

function factColumns(fact: Fact<unknown>): {
  status: 'known' | 'unknown';
  value: string | null;
  reason: string | null;
  observedAt: string | null;
} {
  if (isKnown(fact)) {
    const value = typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value);
    return { status: 'known', value, reason: null, observedAt: null };
  }
  return { status: 'unknown', value: null, reason: fact.reason, observedAt: fact.observedAt };
}

/**
 * `bun:sqlite` insert-only write port (AD-21). Deliberately its own class
 * with its own connection, separate from `SqliteConfigRevisionRepository` --
 * a structurally distinct write path is what makes revision immutability an
 * interface-shape guarantee rather than a convention two callers have to
 * remember. Never reuses `SqliteConfigRevisionRepository.seed()`/
 * `insertRawRow()`: those are `DELETE`+rebuild and `INSERT OR REPLACE`
 * respectively, exactly the silent-overwrite pattern insert-only is meant
 * to rule out.
 */
export class SqliteConfigRevisionWriter implements ConfigRevisionWriter {
  private readonly db: Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    // Independent connection -- AD-21: must not assume another connection's
    // pragma state carries over.
    this.db.exec('PRAGMA foreign_keys = ON;');
    runConfigRevisionMigrations(this.db);
  }

  /**
   * Validates trigger category/evidence first (before any transaction is
   * opened, so a rejection is trivially zero-write), then generates
   * `revisionId` and inserts the new immutable row in a single transaction.
   * `supersedes` is written verbatim as `supersedes_revision_id` --
   * validating that a non-null target exists and belongs to the same
   * `configName` is Story 3.2's concern; this Story's only caller
   * (`configs establish`) always passes `null`.
   */
  async create(
    revision: NewConfigRevisionInput,
    trigger: RevisionTriggerInput,
    supersedes: string | null,
  ): Promise<StableConfigRevision> {
    if (!isValidTriggerCategory(trigger.category)) {
      throw new InvalidTriggerCategoryError(trigger.category);
    }
    if (trigger.evidenceRef.trim().length === 0) {
      throw new MissingEvidenceError();
    }

    const revisionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const defaultMarker = factColumns(revision.defaultMarker);
    const scopeBoundary = factColumns(revision.scopeBoundary);
    const availability = factColumns(revision.availability);

    const insertConfig = this.db.query<unknown, [string]>(
      'INSERT OR IGNORE INTO stable_config (config_name) VALUES (?)',
    );
    const insertRevision = this.db.query<
      unknown,
      [
        string,
        string,
        number,
        string,
        string | null,
        string | null,
        string | null,
        string,
        string | null,
        string | null,
        string | null,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    >(
      `INSERT INTO stable_config_revision (${REVISION_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      insertConfig.run(revision.configName);
      insertRevision.run(
        revisionId,
        revision.configName,
        SUPPORTED_SCHEMA_VERSION,
        defaultMarker.status,
        defaultMarker.value,
        defaultMarker.reason,
        defaultMarker.observedAt,
        scopeBoundary.status,
        scopeBoundary.value,
        scopeBoundary.reason,
        scopeBoundary.observedAt,
        availability.status,
        availability.value,
        availability.reason,
        availability.observedAt,
        supersedes,
        JSON.stringify(revision.instructions),
        JSON.stringify(revision.skills),
        JSON.stringify(revision.mcp),
        JSON.stringify(revision.hooks),
        JSON.stringify(revision.plugins),
        createdAt,
      );
    })();

    return {
      ...revision,
      revisionId,
      supersedesRevisionId: supersedes,
    };
  }

  close(): void {
    this.db.close();
  }
}
