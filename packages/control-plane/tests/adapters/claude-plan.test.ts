import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { compileClaudeAdapterPlan } from '../../src/adapters/clients/claude/plan';
import type { ClaudeAdapterPlan } from '../../src/adapters/clients/claude/plan';
import { loadCapConfigRevisions } from '../../src/adapters/sources/cap-fs';
import type { ClaudeCapabilityProbeResult } from '../../src/application/ports';
import type { CapabilityReference, StableConfigRevision } from '../../src/domain/config';
import { known } from '../../src/domain/facts';

function ref(
  kind: CapabilityReference['kind'],
  name: string,
  source: CapabilityReference['sourceCategory'] = known('project-capability'),
): CapabilityReference {
  return {
    kind,
    name,
    sourceCategory: source,
    summary: known(`${kind} reference: ${name}`),
    sourceRef: known(`ref/${name}`),
    contentFingerprint: known(`fingerprint/${name}`),
  };
}

function revision(overrides: Partial<StableConfigRevision> & { configName: string; revisionId: string }): StableConfigRevision {
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

function probeResult(
  overrides: Partial<ClaudeCapabilityProbeResult> & { capabilityId: string },
): ClaudeCapabilityProbeResult {
  return {
    capabilityId: overrides.capabilityId,
    subject: overrides.subject ?? `subject for ${overrides.capabilityId}`,
    required: overrides.required ?? true,
    status: overrides.status ?? 'supported',
    validationMethod: overrides.validationMethod ?? 'mechanical',
    evidenceRef: overrides.evidenceRef ?? `evidence for ${overrides.capabilityId}`,
    observedAt: overrides.observedAt ?? '2026-01-01T00:00:00Z',
  };
}

/** All four Story 4.1 capabilities, all fully `supported`/honestly `unknown`, matching a healthy real environment. */
function allSupportedProbeResults(overrides: Partial<Record<string, Partial<ClaudeCapabilityProbeResult>>> = {}): ClaudeCapabilityProbeResult[] {
  const base: ClaudeCapabilityProbeResult[] = [
    probeResult({ capabilityId: 'claude.permission-mode-control', required: true, status: 'supported' }),
    probeResult({ capabilityId: 'claude.mcp-project-scope-control', required: true, status: 'supported' }),
    probeResult({ capabilityId: 'claude.setting-sources-control', required: true, status: 'supported' }),
    probeResult({ capabilityId: 'claude.hook-deny-return-value', required: false, status: 'unknown' }),
  ];
  return base.map((result) => ({ ...result, ...(overrides[result.capabilityId] ?? {}) }));
}

function expectCompiled(result: ReturnType<typeof compileClaudeAdapterPlan>): ClaudeAdapterPlan {
  if (result.kind !== 'compiled') {
    throw new Error(`expected a compiled plan, got blocked: ${JSON.stringify(result)}`);
  }
  return result.plan;
}

describe('compileClaudeAdapterPlan', () => {
  test('零引用（无 skills/mcp/hooks）: only permission-mode is relevant; supported -> planStatus ready', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-empty' });
    const result = compileClaudeAdapterPlan(rev, allSupportedProbeResults());
    const plan = expectCompiled(result);

    expect(plan.capabilityPolicy.map((n) => n.capabilityId)).toEqual(['claude.permission-mode-control']);
    expect(plan.planStatus).toBe('ready');
    expect(plan.degradedCapabilities).toEqual([]);
    expect(plan.client).toBe('claude-code');
    expect(plan.revisionId).toBe('rev-empty');
    expect(plan.configName).toBe('general');
  });

  test('引用 MCP 且 mcp-project-scope-control unsupported/unknown（required: true）-> 整体 blocked，missingRequiredCapabilities 含该项，不产出 planHash', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-mcp', mcp: [ref('mcp', 'some-mcp')] });
    const results = allSupportedProbeResults({
      'claude.mcp-project-scope-control': { status: 'unsupported', required: true },
    });
    const result = compileClaudeAdapterPlan(rev, results);

    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.missingRequiredCapabilities).toEqual(['claude.mcp-project-scope-control']);
      expect(result.revisionId).toBe('rev-mcp');
      expect(result.configName).toBe('general');
      expect('planHash' in result).toBe(false);
    }
  });

  test('引用 skills 且 setting-sources-control degraded -> planStatus degraded，degradedCapabilities 含该项，仍产出 plan', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-skills', skills: [ref('skill', 'some-skill')] });
    const results = allSupportedProbeResults({
      'claude.setting-sources-control': { status: 'degraded', required: true },
    });
    const result = compileClaudeAdapterPlan(rev, results);
    const plan = expectCompiled(result);

    expect(plan.planStatus).toBe('degraded');
    expect(plan.degradedCapabilities).toEqual(['claude.setting-sources-control']);
    expect(plan.planHash.length).toBeGreaterThan(0);
  });

  test('引用 hooks（hook-deny-return-value 恒为 unknown, required: false）-> planStatus degraded（可选项缺失，不 blocked）', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-hooks', hooks: [ref('hook', 'some-hook')] });
    const result = compileClaudeAdapterPlan(rev, allSupportedProbeResults());
    const plan = expectCompiled(result);

    expect(plan.capabilityPolicy.map((n) => n.capabilityId).sort()).toEqual([
      'claude.hook-deny-return-value',
      'claude.permission-mode-control',
    ]);
    expect(plan.planStatus).toBe('degraded');
    expect(plan.degradedCapabilities).toEqual(['claude.hook-deny-return-value']);
  });

  test('相同 revision + 两次探测结果（capabilityId/required/status 相同，evidenceRef/observedAt 不同）-> 两次 planHash 完全相同', () => {
    const rev = revision({
      configName: 'general',
      revisionId: 'rev-stable',
      skills: [ref('skill', 'some-skill')],
      hooks: [ref('hook', 'some-hook')],
    });
    const firstProbe = allSupportedProbeResults();
    const secondProbe = firstProbe.map((result) => ({
      ...result,
      evidenceRef: `${result.evidenceRef} (second run)`,
      observedAt: '2026-02-02T00:00:00Z',
    }));

    const firstPlan = expectCompiled(compileClaudeAdapterPlan(rev, firstProbe));
    const secondPlan = expectCompiled(compileClaudeAdapterPlan(rev, secondProbe));

    expect(secondPlan.planHash).toBe(firstPlan.planHash);
    // Sanity: this isn't trivially true because the inputs were identical --
    // evidenceRef genuinely differs between the two probe runs.
    expect(firstPlan.capabilityPolicy.find((n) => n.capabilityId === 'claude.setting-sources-control')?.evidenceRef).not.toBe(
      secondPlan.capabilityPolicy.find((n) => n.capabilityId === 'claude.setting-sources-control')?.evidenceRef,
    );
  });

  test('probe 结果不含某个相关 capabilityId（防御性构造）-> 视为 required:true,status:unknown，触发 blocked，不静默判为 supported', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-missing-probe', skills: [ref('skill', 'some-skill')] });
    const resultsMissingSettingSources = allSupportedProbeResults().filter(
      (result) => result.capabilityId !== 'claude.setting-sources-control',
    );

    const result = compileClaudeAdapterPlan(rev, resultsMissingSettingSources);

    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.missingRequiredCapabilities).toEqual(['claude.setting-sources-control']);
    }
  });

  test('planHash 变化时 planStatus 不同步影响：一个 blocked 结果永不携带 planHash/capabilityPolicy/degradedCapabilities 字段', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-blocked-shape', mcp: [ref('mcp', 'm')] });
    const results = allSupportedProbeResults({ 'claude.mcp-project-scope-control': { status: 'unknown', required: true } });
    const result = compileClaudeAdapterPlan(rev, results);

    expect(result.kind).toBe('blocked');
    const serialized = Object.keys(result);
    expect(serialized).not.toContain('planHash');
    expect(serialized).not.toContain('capabilityPolicy');
    expect(serialized).not.toContain('degradedCapabilities');
  });

  test('plan 不复制引用内容原文：instructions/skills/mcp 与 revision 上的对象引用值相等（同一份数组/对象），不新增内容字段', () => {
    const skillRefs = [ref('skill', 'skill-a')];
    const mcpRefs = [ref('mcp', 'mcp-a')];
    const instructionRefs = [ref('instruction', 'prompt-a')];
    const rev = revision({
      configName: 'general',
      revisionId: 'rev-refs',
      instructions: instructionRefs,
      skills: skillRefs,
      mcp: mcpRefs,
    });
    const plan = expectCompiled(compileClaudeAdapterPlan(rev, allSupportedProbeResults()));

    expect(plan.instructions).toBe(instructionRefs);
    expect(plan.skills).toBe(skillRefs);
    expect(plan.mcp).toBe(mcpRefs);
    // No content field beyond what CapabilityReference already declares.
    for (const group of [plan.instructions, plan.skills, plan.mcp]) {
      for (const capability of group) {
        expect(Object.keys(capability).sort()).toEqual(
          ['contentFingerprint', 'kind', 'name', 'sourceCategory', 'sourceRef', 'summary'].sort(),
        );
      }
    }
    // Never any hooks/plugins typed-reference field on the plan itself.
    expect('hooks' in plan).toBe(false);
    expect('plugins' in plan).toBe(false);
  });

  test('never produces a candidate/score/recommendation field (SPEC.md CAP-1)', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-cap1', skills: [ref('skill', 's')] });
    const result = compileClaudeAdapterPlan(rev, allSupportedProbeResults());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/candidate|score|recommend/i);
  });

  test('planHash is content-sensitive: changing a relevant capability\'s status (same revisionId) changes the hash', () => {
    const rev = revision({ configName: 'general', revisionId: 'rev-hash-content', skills: [ref('skill', 'some-skill')] });
    const supportedPlan = expectCompiled(compileClaudeAdapterPlan(rev, allSupportedProbeResults()));
    const degradedPlan = expectCompiled(
      compileClaudeAdapterPlan(
        rev,
        allSupportedProbeResults({ 'claude.setting-sources-control': { status: 'degraded', required: true } }),
      ),
    );

    expect(degradedPlan.planHash).not.toBe(supportedPlan.planHash);
  });

  test('planHash is content-sensitive: changing the referenced skill/mcp set (same revisionId) changes the hash', () => {
    const revA = revision({ configName: 'general', revisionId: 'rev-hash-refs', skills: [ref('skill', 'skill-a')] });
    const revB = revision({ configName: 'general', revisionId: 'rev-hash-refs', skills: [ref('skill', 'skill-b')] });

    const planA = expectCompiled(compileClaudeAdapterPlan(revA, allSupportedProbeResults()));
    const planB = expectCompiled(compileClaudeAdapterPlan(revB, allSupportedProbeResults()));

    expect(planB.planHash).not.toBe(planA.planHash);
  });

  test('planHash is order-independent over the reference arrays: the same skill set in a different array order hashes the same', () => {
    const forward = revision({
      configName: 'general',
      revisionId: 'rev-hash-order',
      skills: [ref('skill', 'skill-a'), ref('skill', 'skill-b')],
    });
    const reversed = revision({
      configName: 'general',
      revisionId: 'rev-hash-order',
      skills: [ref('skill', 'skill-b'), ref('skill', 'skill-a')],
    });

    const forwardPlan = expectCompiled(compileClaudeAdapterPlan(forward, allSupportedProbeResults()));
    const reversedPlan = expectCompiled(compileClaudeAdapterPlan(reversed, allSupportedProbeResults()));

    expect(reversedPlan.planHash).toBe(forwardPlan.planHash);
  });

  test('multiple simultaneously-blocked required capabilities are all listed in missingRequiredCapabilities', () => {
    const rev = revision({
      configName: 'general',
      revisionId: 'rev-multi-blocked',
      mcp: [ref('mcp', 'some-mcp')],
      skills: [ref('skill', 'some-skill')],
    });
    const results = allSupportedProbeResults({
      'claude.mcp-project-scope-control': { status: 'unsupported', required: true },
      'claude.setting-sources-control': { status: 'unknown', required: true },
    });

    const result = compileClaudeAdapterPlan(rev, results);

    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect([...result.missingRequiredCapabilities].sort()).toEqual(
        ['claude.mcp-project-scope-control', 'claude.setting-sources-control'].sort(),
      );
    }
  });
});

describe('compileClaudeAdapterPlan against the real .cap/ (general, agent-assembler)', () => {
  const CAP_ROOT = path.join(import.meta.dir, '..', '..', '..', '..', '.cap');

  test('both real profiles compile to a ready plan and produce a stable hash across two probe runs', async () => {
    const revisions = await loadCapConfigRevisions(CAP_ROOT);
    expect(revisions.map((r) => r.configName).sort()).toEqual(['agent-assembler', 'general']);

    for (const rev of revisions) {
      // Per Design Notes: both real profiles have empty mcp/hooks and
      // non-empty skills, so only permission-mode-control and
      // setting-sources-control are relevant, and both are supported in a
      // healthy real environment -- planStatus is expected to be 'ready'.
      expect(rev.mcp).toEqual([]);
      expect(rev.hooks).toEqual([]);
      expect(rev.skills.length).toBeGreaterThan(0);

      const firstProbe = allSupportedProbeResults();
      const secondProbe = firstProbe.map((result) => ({
        ...result,
        evidenceRef: `${result.evidenceRef} / real .cap run 2`,
        observedAt: '2099-01-01T00:00:00Z',
      }));

      const firstPlan = expectCompiled(compileClaudeAdapterPlan(rev, firstProbe));
      const secondPlan = expectCompiled(compileClaudeAdapterPlan(rev, secondProbe));

      expect(firstPlan.planStatus).toBe('ready');
      expect(firstPlan.capabilityPolicy.map((n) => n.capabilityId).sort()).toEqual([
        'claude.permission-mode-control',
        'claude.setting-sources-control',
      ]);
      expect(secondPlan.planHash).toBe(firstPlan.planHash);
    }
  });
});
