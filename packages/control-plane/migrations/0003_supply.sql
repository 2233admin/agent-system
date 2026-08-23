-- Story 3.1 (AD-21): configuration-revision write path schema support.
-- Forward-only, applied inside a transaction (see
-- `adapters/sqlite/migrations.ts`'s `runConfigRevisionMigrations`, the single
-- place every connection -- read repository and write port alike -- goes
-- through to reach this state).
--
-- The `supersedes_revision_id` column itself is added programmatically (via
-- an `ALTER TABLE ... ADD COLUMN`, guarded by a `PRAGMA table_info` check)
-- rather than in this file, because SQLite's `ALTER TABLE ADD COLUMN` has no
-- `IF NOT EXISTS` form and this file must stay safely re-runnable across
-- every independent connection that opens this same database file.
--
-- These two indexes are what Story 3.2's `supersedes` conflict handling
-- builds on: the composite unique index lets a future write validate "does
-- this supersedes target belong to the same config_name" via a `(config_name,
-- revision_id)` lookup; the second index enforces "at most one child per
-- parent" at the database level. This Story only adds the schema -- neither
-- index's conflict behavior is exercised or tested until 3.2.

CREATE UNIQUE INDEX IF NOT EXISTS idx_stable_config_revision_config_name_revision_id
  ON stable_config_revision (config_name, revision_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stable_config_revision_supersedes_revision_id
  ON stable_config_revision (supersedes_revision_id);
