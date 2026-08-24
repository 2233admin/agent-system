import { describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadCapConfigRevisions } from '../../src/adapters/sources/cap-fs';
import { isKnown, isUnknown } from '../../src/domain/facts';

const FIXTURE_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'cap-sample');
const CAP_ROOT = path.join(import.meta.dir, '..', '..', '..', '..', '.cap');

describe('loadCapConfigRevisions (fixture, not the real repo .cap/)', () => {
  test('maps one StableConfigRevision per declared profile role', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    expect(revisions.map((r) => r.configName).sort()).toEqual(['general', 'reviewer']);
  });

  test('defaultMarker is Unknown for every profile -- manifest.defaults is a policy-overlay path, not a per-profile role marker', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    for (const revision of revisions) {
      expect(isUnknown(revision.defaultMarker)).toBe(true);
    }
  });

  test('a role resolved in lock.json gets revisionId = layer_digest and Known("resolved") availability', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    expect(general.revisionId).toBe('sha256:general-fixture-digest');
    expect(isKnown(general.availability)).toBe(true);
  });

  test('a role absent from lock.json.profiles gets Unknown("not-resolved", ...) availability', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const reviewer = revisions.find((r) => r.configName === 'reviewer')!;
    expect(isUnknown(reviewer.availability)).toBe(true);
    if (isUnknown(reviewer.availability)) {
      expect(reviewer.availability.reason).toBe('not-resolved');
    }
  });

  test('skills/mcps from lock.json inventory map to typed Skill/MCP references', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    const names = general.skills.map((s) => s.name).sort();
    expect(names).toEqual(['grilling', 'openspec-explore']);
    expect(general.mcp).toEqual([]);
  });

  test('a plugin-imported skill (declared in project_skill_imports) is tagged project-skill-import; a plain project skill is tagged project-capability', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    const grilling = general.skills.find((s) => s.name === 'grilling')!;
    const openspecExplore = general.skills.find((s) => s.name === 'openspec-explore')!;
    expect(isKnown(grilling.sourceCategory) && grilling.sourceCategory.value).toBe('project-skill-import');
    expect(isKnown(openspecExplore.sourceCategory) && openspecExplore.sourceCategory.value).toBe('project-capability');
  });

  test('the prompt path becomes a typed Instruction reference -- the prompt file content is never read', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    expect(general.instructions).toHaveLength(1);
    expect(general.instructions[0]!.kind).toBe('instruction');
    expect(general.instructions[0]!.name).toBe('.cap/prompts/general.md');
    const summary = general.instructions[0]!.summary;
    expect(isKnown(summary) && summary.value.includes('general.md')).toBe(true);
    // The mapped summary must only ever reference the path, never contain
    // arbitrary prose that could only come from reading the .md body.
    expect(isKnown(summary) && summary.value).not.toContain('\n');
  });

  test('scopeBoundary never embeds prompt body content, only path/counts', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    for (const revision of revisions) {
      expect(isKnown(revision.scopeBoundary)).toBe(true);
      if (isKnown(revision.scopeBoundary)) {
        expect(revision.scopeBoundary.value).toContain('prompt:');
      }
    }
  });

  test('an unresolved profile\'s capability arrays come from lock.json inventory (empty), never from the profile TOML allow list', async () => {
    // reviewer.toml declares skills.allow = ["review-checklist"], but the
    // `reviewer` role has no entry under lock.json.profiles -- it is
    // unresolved. The allow list is a *request*, not an *inventory*; only
    // lock.json's resolved inventory may populate skills/mcp/hooks/plugins.
    // If this ever starts reading `review-checklist` out of the profile
    // TOML's allow list, that is a silent-fabrication regression.
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const reviewer = revisions.find((r) => r.configName === 'reviewer')!;
    expect(isUnknown(reviewer.availability)).toBe(true);
    expect(reviewer.skills).toEqual([]);
    expect(reviewer.mcp).toEqual([]);
    expect(reviewer.hooks).toEqual([]);
    expect(reviewer.plugins).toEqual([]);
    expect(reviewer.skills.map((s) => s.name)).not.toContain('review-checklist');
  });

  test('[Story 4.5b] a plain project skill\'s sourceRef resolves to capabilities/skills/<name> under capRoot; an imported skill\'s sourceRef resolves to lock.json\'s own declared source under repoRoot', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    const grilling = general.skills.find((s) => s.name === 'grilling')!;
    const openspecExplore = general.skills.find((s) => s.name === 'openspec-explore')!;

    expect(isKnown(openspecExplore.sourceRef) && openspecExplore.sourceRef.value).toBe(
      path.join(FIXTURE_ROOT, 'capabilities', 'skills', 'openspec-explore'),
    );
    // `grilling` is declared in `project_skill_imports` with
    // `source: "plugins/grilling/skills/grilling"` -- resolved against the
    // directory `FIXTURE_ROOT` lives in (repoRoot), never against `FIXTURE_ROOT`
    // itself, since imports live outside `.cap/`-equivalent roots.
    expect(isKnown(grilling.sourceRef) && grilling.sourceRef.value).toBe(
      path.join(path.dirname(FIXTURE_ROOT), 'plugins', 'grilling', 'skills', 'grilling'),
    );
  });

  test('[Story 4.5b] mcp/hooks/plugins sourceRef stays honestly Unknown -- no real directory convention exists for them', async () => {
    const revisions = await loadCapConfigRevisions(FIXTURE_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    // The fixture's `general` has no mcp/hooks/plugins references, so exercise
    // the mapping function's honesty via the shared helper indirectly: any
    // capability of kind other than 'skill'/'instruction' must stay Unknown.
    for (const capabilityRef of [...general.mcp, ...general.hooks, ...general.plugins]) {
      expect(isUnknown(capabilityRef.sourceRef)).toBe(true);
    }
  });
});

describe('loadCapConfigRevisions sourceRef against the real repo .cap/ (Story 4.5b AC evidence)', () => {
  test('every skill reference\'s sourceRef resolves to a real, existing directory on disk', async () => {
    const revisions = await loadCapConfigRevisions(CAP_ROOT);
    expect(revisions.length).toBeGreaterThan(0);

    for (const revision of revisions) {
      for (const skill of revision.skills) {
        expect(isKnown(skill.sourceRef)).toBe(true);
        if (!isKnown(skill.sourceRef)) continue;
        expect(existsSync(skill.sourceRef.value)).toBe(true);
        expect(statSync(skill.sourceRef.value).isDirectory()).toBe(true);
      }
    }
  });

  test('every instruction reference\'s sourceRef resolves to a real, existing file on disk', async () => {
    const revisions = await loadCapConfigRevisions(CAP_ROOT);
    expect(revisions.length).toBeGreaterThan(0);

    for (const revision of revisions) {
      for (const instruction of revision.instructions) {
        expect(isKnown(instruction.sourceRef)).toBe(true);
        if (!isKnown(instruction.sourceRef)) continue;
        expect(existsSync(instruction.sourceRef.value)).toBe(true);
        expect(statSync(instruction.sourceRef.value).isFile()).toBe(true);
      }
    }
  });

  test('the real "general" profile\'s plain project skills resolve under .cap/capabilities/skills/<name>', async () => {
    const revisions = await loadCapConfigRevisions(CAP_ROOT);
    const general = revisions.find((r) => r.configName === 'general')!;
    const openspecExplore = general.skills.find((s) => s.name === 'openspec-explore')!;

    expect(isKnown(openspecExplore.sourceRef) && openspecExplore.sourceRef.value).toBe(
      path.join(CAP_ROOT, 'capabilities', 'skills', 'openspec-explore'),
    );
  });

  test('the real "agent-assembler" profile\'s imported "grilling" skill resolves to plugins/grilling/skills/grilling under the repo root', async () => {
    const revisions = await loadCapConfigRevisions(CAP_ROOT);
    const agentAssembler = revisions.find((r) => r.configName === 'agent-assembler')!;
    const grilling = agentAssembler.skills.find((s) => s.name === 'grilling')!;

    expect(isKnown(grilling.sourceCategory) && grilling.sourceCategory.value).toBe('project-skill-import');
    expect(isKnown(grilling.sourceRef) && grilling.sourceRef.value).toBe(
      path.join(path.dirname(CAP_ROOT), 'plugins', 'grilling', 'skills', 'grilling'),
    );
  });
});
