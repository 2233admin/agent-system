import { describe, expect, test } from 'bun:test';

import { SqliteConfigRevisionRepository } from '../../src/adapters/sqlite/repository';
import type { RevisionRow } from '../../src/adapters/sqlite/repository';
import { ConfigUnsupportedError } from '../../src/application/queries';
import { isKnown, isUnknown, known, unknown } from '../../src/domain/facts';
import type { StableConfigRevision } from '../../src/domain/config';

function sampleRevision(overrides: Partial<StableConfigRevision> & { configName: string; revisionId: string }): StableConfigRevision {
  return {
    configName: overrides.configName,
    revisionId: overrides.revisionId,
    defaultMarker: overrides.defaultMarker ?? known(false),
    scopeBoundary: overrides.scopeBoundary ?? known('a scope boundary'),
    availability: overrides.availability ?? known('resolved'),
    instructions: overrides.instructions ?? [],
    skills: overrides.skills ?? [],
    mcp: overrides.mcp ?? [],
    hooks: overrides.hooks ?? [],
    plugins: overrides.plugins ?? [],
    triggerCategory: overrides.triggerCategory ?? 'new-scenario',
    evidenceRef: overrides.evidenceRef ?? 'test-evidence',
    supersedesRevisionId: overrides.supersedesRevisionId ?? null,
  };
}

function revisionRowFixture(overrides: Partial<RevisionRow> & Pick<RevisionRow, 'revision_id' | 'config_name'>): RevisionRow {
  return {
    schema_version: 1,
    default_marker_status: 'known',
    default_marker_value: 'false',
    default_marker_reason: null,
    default_marker_observed_at: null,
    scope_boundary_status: 'known',
    scope_boundary_value: 'boundary',
    scope_boundary_reason: null,
    scope_boundary_observed_at: null,
    availability_status: 'known',
    availability_value: 'resolved',
    availability_reason: null,
    availability_observed_at: null,
    instructions_json: '[]',
    skills_json: '[]',
    mcp_json: '[]',
    hooks_json: '[]',
    plugins_json: '[]',
    trigger_category: 'new-scenario',
    evidence_ref: 'test-evidence',
    supersedes_revision_id: null,
    ...overrides,
  };
}

describe('SqliteConfigRevisionRepository (:memory:, STRICT)', () => {
  test('creates STRICT tables via a transactional migration and starts empty', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      const revisions = await repo.listAll();
      expect(revisions).toEqual([]);
    } finally {
      repo.close();
    }
  });

  test('findById on an empty store returns null (not an exception)', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      const result = await repo.findById('does-not-exist');
      expect(result).toBeNull();
    } finally {
      repo.close();
    }
  });

  test('seed() + listAll() round-trips known and unknown facts faithfully', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      const revision = sampleRevision({
        configName: 'general',
        revisionId: 'rev-1',
        defaultMarker: known(true),
        scopeBoundary: known('Role `general`; prompt: .cap/prompts/general.md'),
        availability: unknown('not-resolved', '2026-08-22T00:00:00.000Z'),
        skills: [
          {
            kind: 'skill',
            name: 'openspec-explore',
            sourceCategory: known('project-capability'),
            summary: known('skill reference: openspec-explore'),
            sourceRef: known('ref/openspec-explore'),
            contentFingerprint: known('fingerprint/openspec-explore'),
          },
        ],
      });
      repo.seed([revision]);

      const all = await repo.listAll();
      expect(all).toHaveLength(1);
      const [got] = all;
      expect(got!.configName).toBe('general');
      expect(got!.revisionId).toBe('rev-1');
      expect(isKnown(got!.defaultMarker) && got!.defaultMarker.value).toBe(true);
      expect(isKnown(got!.scopeBoundary)).toBe(true);
      expect(isUnknown(got!.availability)).toBe(true);
      if (isUnknown(got!.availability)) {
        expect(got!.availability.reason).toBe('not-resolved');
      }
      expect(got!.skills).toHaveLength(1);
      expect(got!.skills[0]!.name).toBe('openspec-explore');
    } finally {
      repo.close();
    }
  });

  test('findById round-trips a seeded revision', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      repo.seed([sampleRevision({ configName: 'general', revisionId: 'rev-1' })]);
      const found = await repo.findById('rev-1');
      expect(found?.revisionId).toBe('rev-1');
      const notFound = await repo.findById('missing');
      expect(notFound).toBeNull();
    } finally {
      repo.close();
    }
  });

  test('findById throws ConfigUnsupportedError for a row with an unsupported schema_version', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      const row: RevisionRow = revisionRowFixture({
        revision_id: 'rev-bad-version',
        config_name: 'general',
        schema_version: 99,
      });
      repo.insertRawRow(row);

      await expect(repo.findById('rev-bad-version')).rejects.toBeInstanceOf(ConfigUnsupportedError);
    } finally {
      repo.close();
    }
  });

  test('listAll degrades an unsupported-version row to Unknown instead of hiding or crashing the whole list', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      repo.seed([sampleRevision({ configName: 'general', revisionId: 'rev-good' })]);
      const row: RevisionRow = revisionRowFixture({
        revision_id: 'rev-bad-version',
        config_name: 'general',
        schema_version: 99,
      });
      repo.insertRawRow(row);

      const all = await repo.listAll();
      expect(all).toHaveLength(2);
      const bad = all.find((r) => r.revisionId === 'rev-bad-version')!;
      expect(isUnknown(bad.availability)).toBe(true);
      const good = all.find((r) => r.revisionId === 'rev-good')!;
      expect(isKnown(good.availability)).toBe(true);
    } finally {
      repo.close();
    }
  });

  test('findById throws ConfigUnsupportedError when stored capability JSON cannot be parsed', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      const row: RevisionRow = revisionRowFixture({
        revision_id: 'rev-corrupt-json',
        config_name: 'general',
        schema_version: 1,
        instructions_json: 'not-json',
      });
      repo.insertRawRow(row);

      await expect(repo.findById('rev-corrupt-json')).rejects.toBeInstanceOf(ConfigUnsupportedError);
    } finally {
      repo.close();
    }
  });

  test('a pre-Story-3.1-style stored capability entry (kind/name/sourceCategory/summary, but no sourceRef/contentFingerprint keys) degrades those two fields to Unknown (not undefined) on both findById and listAll', async () => {
    const repo = new SqliteConfigRevisionRepository(':memory:');
    try {
      const preStory31Skill = {
        kind: 'skill',
        name: 'legacy-skill',
        sourceCategory: { kind: 'known', value: 'project-capability' },
        summary: { kind: 'known', value: 'skill reference: legacy-skill' },
        // Deliberately no `sourceRef`/`contentFingerprint` keys at all --
        // this is the exact shape rows written before Story 3.1 have.
      };
      const row: RevisionRow = revisionRowFixture({
        revision_id: 'rev-pre-3-1',
        config_name: 'general',
        skills_json: JSON.stringify([preStory31Skill]),
      });
      repo.insertRawRow(row);

      const found = await repo.findById('rev-pre-3-1');
      expect(found).not.toBeNull();
      const skillFromFindById = found!.skills[0]!;
      expect(skillFromFindById.sourceRef).not.toBeUndefined();
      expect(isUnknown(skillFromFindById.sourceRef)).toBe(true);
      expect(isUnknown(skillFromFindById.contentFingerprint)).toBe(true);
      if (isUnknown(skillFromFindById.sourceRef)) {
        expect(typeof skillFromFindById.sourceRef.reason).toBe('string');
        expect(skillFromFindById.sourceRef.reason.length).toBeGreaterThan(0);
      }
      if (isUnknown(skillFromFindById.contentFingerprint)) {
        expect(typeof skillFromFindById.contentFingerprint.reason).toBe('string');
        expect(skillFromFindById.contentFingerprint.reason.length).toBeGreaterThan(0);
      }
      // sourceCategory/summary, which *were* present, must still round-trip as Known.
      expect(isKnown(skillFromFindById.sourceCategory)).toBe(true);
      expect(isKnown(skillFromFindById.summary)).toBe(true);

      const all = await repo.listAll();
      const skillFromListAll = all.find((r) => r.revisionId === 'rev-pre-3-1')!.skills[0]!;
      expect(skillFromListAll.sourceRef).not.toBeUndefined();
      expect(isUnknown(skillFromListAll.sourceRef)).toBe(true);
      expect(isUnknown(skillFromListAll.contentFingerprint)).toBe(true);
    } finally {
      repo.close();
    }
  });
});
