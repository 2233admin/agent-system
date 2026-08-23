/**
 * `[Story 3.1]` Insert-only write adapter for `stable_config_revision`.
 * Deliberately its own class/file rather than a method bolted onto
 * `SqliteConfigRevisionRepository` -- that class implements the read-only
 * `ConfigRevisionRepository` port; this one implements the separate
 * `ConfigRevisionWriter` port and exposes only `create` (Boundaries &
 * Constraints: "写端口只暴露 create，无 update/delete；不复用
 * seed()/insertRawRow()").
 *
 * `create` validates the whole candidate (via `parseCandidateRevision`)
 * *before* ever touching the database -- a type mismatch anywhere in the
 * candidate throws `InvalidCandidateError` with zero writes, never a
 * partial insert.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { parseCandidateRevision, parseEvidenceRef, parseTriggerCategory } from '../../application/establish';
import type { EstablishConfigRevisionParams, ConfigRevisionWriter } from '../../application/ports';
import type { StableConfigRevision } from '../../domain/config';
import { factColumns, runConfigRevisionMigrations } from './repository';

/** The only `stable_config_revision.schema_version` this writer ever produces. */
const SUPPORTED_SCHEMA_VERSION = 1;

export class SqliteConfigRevisionWriter implements ConfigRevisionWriter {
  private readonly db: Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    // `[Review fix]` Root-cause mitigation for concurrent migrations (see
    // `repository.ts`'s `runConfigRevisionMigrations` docstring): make
    // SQLite itself wait out short-lived lock contention instead of
    // failing immediately with `SQLITE_BUSY`/`"database is locked"`.
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    runConfigRevisionMigrations(this.db);
  }

  async create(params: EstablishConfigRevisionParams): Promise<StableConfigRevision> {
    // `[Review fix]` `EstablishConfigRevisionParams.triggerCategory`/
    // `.evidenceRef` are typed, but TypeScript types are erased at runtime
    // -- a caller that reaches this port directly (bypassing
    // `cli/index.ts`'s `parseTriggerCategory`/`parseEvidenceRef` calls)
    // could still pass an out-of-enum category or empty evidence. Reuse
    // the exact same validators the CLI already uses, before the
    // transaction below (or the candidate parse) ever runs, so an invalid
    // value here fails with zero writes just like an invalid candidate.
    parseTriggerCategory(params.triggerCategory);
    parseEvidenceRef(params.evidenceRef);

    // Validate the whole candidate before touching the database at all --
    // a type mismatch anywhere throws `InvalidCandidateError` here, before
    // any `INSERT` is even prepared, so a rejected candidate can never
    // produce a partial write.
    const candidate = parseCandidateRevision(params.candidate);

    const revision: StableConfigRevision = {
      configName: candidate.configName,
      revisionId: crypto.randomUUID(),
      defaultMarker: candidate.defaultMarker,
      scopeBoundary: candidate.scopeBoundary,
      availability: candidate.availability,
      instructions: candidate.instructions,
      skills: candidate.skills,
      mcp: candidate.mcp,
      hooks: candidate.hooks,
      plugins: candidate.plugins,
      triggerCategory: params.triggerCategory,
      evidenceRef: params.evidenceRef,
      // Fixed for this Story -- Story 3.2 is the only one that ever writes
      // a non-null value here (Boundaries & Constraints: "固定传
      // supersedes=null").
      supersedesRevisionId: null,
    };

    const defaultMarker = factColumns(revision.defaultMarker);
    const scopeBoundary = factColumns(revision.scopeBoundary);
    const availability = factColumns(revision.availability);

    this.db.transaction(() => {
      this.db.query<unknown, [string]>('INSERT OR IGNORE INTO stable_config (config_name) VALUES (?)').run(revision.configName);

      this.db
        .query<
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
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string | null,
          ]
        >(
          `INSERT INTO stable_config_revision (
             revision_id, config_name, schema_version,
             default_marker_status, default_marker_value, default_marker_reason, default_marker_observed_at,
             scope_boundary_status, scope_boundary_value, scope_boundary_reason, scope_boundary_observed_at,
             availability_status, availability_value, availability_reason, availability_observed_at,
             instructions_json, skills_json, mcp_json, hooks_json, plugins_json,
             created_at, trigger_category, evidence_ref, supersedes_revision_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          revision.revisionId,
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
          JSON.stringify(revision.instructions),
          JSON.stringify(revision.skills),
          JSON.stringify(revision.mcp),
          JSON.stringify(revision.hooks),
          JSON.stringify(revision.plugins),
          new Date().toISOString(),
          revision.triggerCategory,
          revision.evidenceRef,
          revision.supersedesRevisionId,
        );
    })();

    return revision;
  }

  close(): void {
    this.db.close();
  }
}
