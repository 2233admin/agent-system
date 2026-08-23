import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteConfigRevisionWriter } from '../../src/adapters/sqlite/revision-writer';
import { SqliteConfigRevisionRepository } from '../../src/adapters/sqlite/repository';
import { InvalidTriggerCategoryError, MissingEvidenceError } from '../../src/application/ports';
import type { ConfigRevisionWriter, NewConfigRevisionInput } from '../../src/application/ports';
import { known, unknown } from '../../src/domain/facts';

// Compile-time only: fails to typecheck if `ConfigRevisionWriter` ever grows
// an update/delete method -- AD-21's "interface shape, not just a runtime
// check" guarantee, and this Story's third acceptance criterion.
type OnlyCreateMethodExists = Exclude<keyof ConfigRevisionWriter, 'create'> extends never ? true : false;
const _onlyCreateMethodExists: OnlyCreateMethodExists = true;
void _onlyCreateMethodExists;

function candidate(overrides: Partial<NewConfigRevisionInput> & { configName: string }): NewConfigRevisionInput {
  return {
    configName: overrides.configName,
    defaultMarker: overrides.defaultMarker ?? known(false),
    scopeBoundary: overrides.scopeBoundary ?? known('a scope boundary'),
    availability: overrides.availability ?? known('resolved'),
    instructions: overrides.instructions ?? [],
    skills: overrides.skills ?? [],
    mcp: overrides.mcp ?? [],
    hooks: overrides.hooks ?? [],
    plugins: overrides.plugins ?? [],
  };
}

describe('SqliteConfigRevisionWriter.create (:memory:, AD-21)', () => {
  test('valid trigger/evidence: generates a revisionId and writes supersedes=null', async () => {
    const writer = new SqliteConfigRevisionWriter(':memory:');
    try {
      const result = await writer.create(
        candidate({
          configName: 'general',
          skills: [
            {
              kind: 'skill',
              name: 'openspec-explore',
              sourceCategory: known('project-capability'),
              summary: known('skill reference: openspec-explore'),
              sourceRef: unknown('not-provided', 'now'),
              contentFingerprint: unknown('not-provided', 'now'),
            },
          ],
        }),
        { category: 'new-scenario', evidenceRef: 'issue #123' },
        null,
      );

      expect(result.configName).toBe('general');
      expect(result.revisionId.length).toBeGreaterThan(0);
      expect(result.supersedesRevisionId).toBeNull();
      expect(result.skills).toHaveLength(1);
    } finally {
      writer.close();
    }
  });

  test('two calls with the same configName produce two distinct, independently generated revisionIds -- never caller-trusted', async () => {
    const writer = new SqliteConfigRevisionWriter(':memory:');
    try {
      const a = await writer.create(candidate({ configName: 'general' }), { category: 'bad-case', evidenceRef: 'evidence-a' }, null);
      const b = await writer.create(candidate({ configName: 'general' }), { category: 'bad-case', evidenceRef: 'evidence-b' }, null);
      expect(a.revisionId).not.toBe(b.revisionId);
    } finally {
      writer.close();
    }
  });

  test('an invalid/missing trigger category rejects the whole write', async () => {
    const writer = new SqliteConfigRevisionWriter(':memory:');
    try {
      await expect(
        writer.create(candidate({ configName: 'general' }), { category: '', evidenceRef: 'evidence' }, null),
      ).rejects.toBeInstanceOf(InvalidTriggerCategoryError);

      await expect(
        writer.create(candidate({ configName: 'general' }), { category: 'not-a-real-category', evidenceRef: 'evidence' }, null),
      ).rejects.toBeInstanceOf(InvalidTriggerCategoryError);
    } finally {
      writer.close();
    }
  });

  test('missing/empty evidence rejects the whole write', async () => {
    const writer = new SqliteConfigRevisionWriter(':memory:');
    try {
      await expect(
        writer.create(candidate({ configName: 'general' }), { category: 'new-scenario', evidenceRef: '' }, null),
      ).rejects.toBeInstanceOf(MissingEvidenceError);
      await expect(
        writer.create(candidate({ configName: 'general' }), { category: 'new-scenario', evidenceRef: '   ' }, null),
      ).rejects.toBeInstanceOf(MissingEvidenceError);
    } finally {
      writer.close();
    }
  });
});

describe('SqliteConfigRevisionWriter <-> SqliteConfigRevisionRepository (file-backed, independent connections)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'control-plane-writer-'));
    dbPath = path.join(tmpDir, 'db.sqlite3');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a rejected create() leaves zero rows behind, verified through the read-only repository', async () => {
    const writer = new SqliteConfigRevisionWriter(dbPath);
    try {
      await expect(
        writer.create(candidate({ configName: 'general' }), { category: 'bad-case', evidenceRef: '' }, null),
      ).rejects.toBeInstanceOf(MissingEvidenceError);
    } finally {
      writer.close();
    }

    const repo = new SqliteConfigRevisionRepository(dbPath);
    try {
      const all = await repo.listAll();
      expect(all).toEqual([]);
    } finally {
      repo.close();
    }
  });

  test('a revision written via the writer is discoverable and correct through the independent read-only repository connection', async () => {
    const writer = new SqliteConfigRevisionWriter(dbPath);
    let written;
    try {
      written = await writer.create(candidate({ configName: 'general' }), { category: 'known-insufficiency', evidenceRef: 'evidence' }, null);
    } finally {
      writer.close();
    }

    const repo = new SqliteConfigRevisionRepository(dbPath);
    try {
      const found = await repo.findById(written.revisionId);
      expect(found).not.toBeNull();
      expect(found!.configName).toBe('general');
      expect(found!.supersedesRevisionId).toBeNull();
    } finally {
      repo.close();
    }
  });

  test('the repository (opened first, only running 0001) and the writer (opened second) both work against the same file -- schema is brought up to date independently by each connection', async () => {
    const repoFirst = new SqliteConfigRevisionRepository(dbPath);
    repoFirst.close();

    const writer = new SqliteConfigRevisionWriter(dbPath);
    let written;
    try {
      written = await writer.create(candidate({ configName: 'general' }), { category: 'new-scenario', evidenceRef: 'evidence' }, null);
    } finally {
      writer.close();
    }

    const repoAgain = new SqliteConfigRevisionRepository(dbPath);
    try {
      const found = await repoAgain.findById(written.revisionId);
      expect(found).not.toBeNull();
    } finally {
      repoAgain.close();
    }
  });
});
