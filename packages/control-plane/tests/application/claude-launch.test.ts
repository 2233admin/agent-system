import { describe, expect, test } from 'bun:test';

import {
  computeClaudeKnownDifferences,
  launchClaudeFresh,
  prepareClaudeAlreadyRunningLaunchPlan,
  prepareClaudeFreshLaunchPlan,
  type LaunchClaudeFreshDeps,
} from '../../src/application/claude-launch';
import { InvalidTransitionError, LaunchPlanNotFoundError, confirmLaunchPlan, rejectLaunchPlan } from '../../src/application/launch';
import { transitionLaunchPlan } from '../../src/domain/activation';
import type { ClientId } from '../../src/domain/client';
import type { LaunchPlan } from '../../src/domain/activation';
import { isKnown, known, unknown } from '../../src/domain/facts';
import type { CapabilityReference, StableConfigRevision } from '../../src/domain/config';
import type {
  ClaudeCapabilityProbePort,
  ClaudeCapabilityProbeResult,
  ClaudeInvocationDirPort,
  ClaudeLaunchContext,
  ClaudeLaunchContextWriter,
  ClaudeProcessPort,
  ClaudeSpawnParams,
  ClaudeSpawnResult,
  ConfigRevisionRepository,
  LaunchPlanRepository,
} from '../../src/application/ports';

function ref(kind: CapabilityReference['kind'], name: string): CapabilityReference {
  return {
    kind,
    name,
    sourceCategory: known('project-capability'),
    summary: known(`${kind}: ${name}`),
    sourceRef: known(`ref/${name}`),
    contentFingerprint: known(`fingerprint/${name}`),
  };
}

function revision(overrides: Partial<StableConfigRevision> & { configName: string; revisionId: string }): StableConfigRevision {
  return {
    configName: overrides.configName,
    revisionId: overrides.revisionId,
    defaultMarker: known(false),
    scopeBoundary: known('a scope boundary'),
    availability: known('resolved'),
    instructions: overrides.instructions ?? [],
    skills: overrides.skills ?? [],
    mcp: overrides.mcp ?? [],
    hooks: overrides.hooks ?? [],
    plugins: overrides.plugins ?? [],
    triggerCategory: 'new-scenario',
    evidenceRef: 'test-evidence',
    supersedesRevisionId: null,
  };
}

function probeResult(overrides: Partial<ClaudeCapabilityProbeResult> & { capabilityId: string }): ClaudeCapabilityProbeResult {
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

function allSupportedProbeResults(overrides: Partial<Record<string, Partial<ClaudeCapabilityProbeResult>>> = {}): ClaudeCapabilityProbeResult[] {
  const base: ClaudeCapabilityProbeResult[] = [
    probeResult({ capabilityId: 'claude.permission-mode-control', required: true, status: 'supported' }),
    probeResult({ capabilityId: 'claude.mcp-project-scope-control', required: true, status: 'supported' }),
    probeResult({ capabilityId: 'claude.setting-sources-control', required: true, status: 'supported' }),
    probeResult({ capabilityId: 'claude.hook-deny-return-value', required: false, status: 'unknown' }),
  ];
  return base.map((result) => ({ ...result, ...(overrides[result.capabilityId] ?? {}) }));
}

class FakeConfigRevisionRepository implements ConfigRevisionRepository {
  private readonly revisions = new Map<string, StableConfigRevision>();

  add(revision: StableConfigRevision): void {
    this.revisions.set(revision.revisionId, revision);
  }

  remove(revisionId: string): void {
    this.revisions.delete(revisionId);
  }

  async listAll(): Promise<readonly StableConfigRevision[]> {
    return [...this.revisions.values()];
  }

  async findById(revisionId: string): Promise<StableConfigRevision | null> {
    return this.revisions.get(revisionId) ?? null;
  }
}

class FakeLaunchPlanRepository implements LaunchPlanRepository {
  readonly plans = new Map<string, LaunchPlan>();
  readonly saveLog: LaunchPlan[] = [];

  async save(plan: LaunchPlan): Promise<void> {
    this.plans.set(plan.planId, plan);
    this.saveLog.push(plan);
  }

  async findById(planId: string): Promise<LaunchPlan | null> {
    return this.plans.get(planId) ?? null;
  }

  async findActiveForClient(client: ClientId): Promise<LaunchPlan | null> {
    const forClient = [...this.plans.values()].filter((plan) => plan.client === client);
    if (forClient.length === 0) return null;
    return forClient.reduce((latest, plan) => (plan.createdAt > latest.createdAt ? plan : latest));
  }
}

class FakeClaudeCapabilityProbe implements ClaudeCapabilityProbePort {
  results: readonly ClaudeCapabilityProbeResult[] = allSupportedProbeResults();

  async probeHardControlCapabilities(): Promise<readonly ClaudeCapabilityProbeResult[]> {
    return this.results;
  }
}

class FakeClaudeProcessPort implements ClaudeProcessPort {
  spawnResult: ClaudeSpawnResult = { exitCode: 0, signal: null };
  spawnError: Error | null = null;
  lastSpawnParams: ClaudeSpawnParams | null = null;

  async detectVersion() {
    return known('9.9.9');
  }

  async captureHelpText() {
    return known('');
  }

  async spawn(params: ClaudeSpawnParams): Promise<ClaudeSpawnResult> {
    this.lastSpawnParams = params;
    if (this.spawnError !== null) {
      throw this.spawnError;
    }
    return this.spawnResult;
  }
}

class FakeClaudeLaunchContextWriter implements ClaudeLaunchContextWriter {
  readonly written: ClaudeLaunchContext[] = [];

  async write(context: ClaudeLaunchContext): Promise<string> {
    this.written.push(context);
    return `/fake/claude-launch-context/${context.planId}.json`;
  }
}

class FakeClaudeInvocationDirPort implements ClaudeInvocationDirPort {
  prepareError: Error | null = null;
  readonly requestedOperationIds: string[] = [];

  async prepare(operationId: string): Promise<string> {
    this.requestedOperationIds.push(operationId);
    if (this.prepareError !== null) {
      throw this.prepareError;
    }
    return `/fake/claude-invocations/${operationId}`;
  }
}

function buildDeps() {
  const configRepository = new FakeConfigRevisionRepository();
  const launchPlanRepository = new FakeLaunchPlanRepository();
  const claudeProcessPort = new FakeClaudeProcessPort();
  const claudeCapabilityProbe = new FakeClaudeCapabilityProbe();
  const claudeLaunchContextWriter = new FakeClaudeLaunchContextWriter();
  const claudeInvocationDirPort = new FakeClaudeInvocationDirPort();
  const deps: LaunchClaudeFreshDeps = {
    configRepository,
    launchPlanRepository,
    claudeProcessPort,
    claudeCapabilityProbe,
    claudeLaunchContextWriter,
    claudeInvocationDirPort,
  };
  return { deps, configRepository, launchPlanRepository, claudeProcessPort, claudeCapabilityProbe, claudeLaunchContextWriter, claudeInvocationDirPort };
}

describe('prepareClaudeFreshLaunchPlan', () => {
  test('valid revisionId prepares a plan through to awaiting-confirmation', async () => {
    const { deps, configRepository } = buildDeps();
    configRepository.add(revision({ configName: 'general', revisionId: 'rev-1' }));

    const plan = await prepareClaudeFreshLaunchPlan(deps, { revisionId: 'rev-1' });
    expect(plan.phase).toBe('awaiting-confirmation');
    expect(plan.client).toBe('claude-code');
    expect(plan.configName).toBe('general');
    expect(plan.revisionId).toBe('rev-1');
  });

  test('配置不存在: prepared -> failed, persisted, reusing ConfigNotFoundError message as the typed reason', async () => {
    const { deps } = buildDeps();
    const plan = await prepareClaudeFreshLaunchPlan(deps, { revisionId: 'does-not-exist' });
    expect(plan.phase).toBe('failed');
    expect(isKnown(plan.failureReason) && plan.failureReason.value).toContain('configuration revision not found');
  });
});

describe('launchClaudeFresh', () => {
  async function preparedAndConfirmed(deps: ReturnType<typeof buildDeps>['deps'], configRepository: FakeConfigRevisionRepository, rev: StableConfigRevision) {
    configRepository.add(rev);
    const plan = await prepareClaudeFreshLaunchPlan(deps, { revisionId: rev.revisionId });
    return confirmLaunchPlan(deps, plan.planId);
  }

  test('AC1 成功路径: prepared -> awaiting-confirmation -> applying -> observing -> succeeded, observationStage reaches launched then observed', async () => {
    const { deps, configRepository, claudeLaunchContextWriter, claudeProcessPort, claudeInvocationDirPort } = buildDeps();
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));
    expect(confirmed.phase).toBe('applying');

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('succeeded');
    expect(isKnown(outcome.plan.observedOutcome) && outcome.plan.observedOutcome.value).toBe('succeeded');
    expect(outcome.observationStage).toBe('observed');
    expect(outcome.recoveryAction).toBeNull();
    expect(outcome.affectedCapabilities).toEqual([]);
    expect(outcome.manifest?.manifestStatus).toBe('ready');
    expect(outcome.adapterPlan?.launchTarget).toBe('fresh');
    expect(claudeLaunchContextWriter.written).toHaveLength(1);
    expect(claudeLaunchContextWriter.written[0]!.applyResult).toBe('applied');
    expect(claudeInvocationDirPort.requestedOperationIds).toEqual([confirmed.operationId]);
    expect(claudeProcessPort.lastSpawnParams!.cwd).toBe(`/fake/claude-invocations/${confirmed.operationId}`);
    expect(claudeProcessPort.lastSpawnParams!.env.CLAUDE_CONFIG_DIR).toBe(`/fake/claude-invocations/${confirmed.operationId}`);
    expect(claudeProcessPort.lastSpawnParams!.argv).toEqual(['--permission-mode', 'manual']);
  });

  test('AC1 中间态断言: right after process-started, the persisted plan is already "observing" (launched) before exit is captured', async () => {
    const { deps, configRepository, launchPlanRepository } = buildDeps();
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));

    await launchClaudeFresh(deps, { planId: confirmed.planId });

    const phasesSaved = launchPlanRepository.saveLog.filter((p) => p.planId === confirmed.planId).map((p) => p.phase);
    expect(phasesSaved).toContain('observing');
    // observing always precedes the terminal outcome phase in the save order.
    expect(phasesSaved.indexOf('observing')).toBeLessThan(phasesSaved.indexOf('succeeded'));
  });

  test('AC1 内容未物化: non-empty instructions/skills/mcp/hooks/plugins -> degraded with typed knownDifferences', async () => {
    const { deps, configRepository, claudeLaunchContextWriter } = buildDeps();
    const rev = revision({
      configName: 'general',
      revisionId: 'rev-1',
      instructions: [ref('instruction', 'i1')],
      mcp: [ref('mcp', 'm1')],
      hooks: [ref('hook', 'h1')],
      plugins: [ref('plugin', 'p1')],
      skills: [ref('skill', 's1')],
    });
    const confirmed = await preparedAndConfirmed(deps, configRepository, rev);

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('degraded');
    const differences = claudeLaunchContextWriter.written[0]!.knownDifferences;
    expect(differences).toContain('instructions-content-not-materialized-in-fresh-launch');
    expect(differences).toContain('skills-content-not-materialized-in-fresh-launch');
    expect(differences).toContain('mcp-content-not-materialized-in-fresh-launch');
    expect(differences).toContain('hooks-content-not-materialized-in-fresh-launch');
    expect(differences).toContain('plugins-content-not-materialized-in-fresh-launch');
  });

  test('AC2 必需能力不可达: capability-blocked -> failed before any spawn, missing capabilities + recovery action surfaced, no partial state', async () => {
    const { deps, configRepository, claudeCapabilityProbe, claudeProcessPort } = buildDeps();
    claudeCapabilityProbe.results = allSupportedProbeResults({
      'claude.mcp-project-scope-control': { status: 'unsupported', required: true },
    });
    const confirmed = await preparedAndConfirmed(
      deps,
      configRepository,
      revision({ configName: 'general', revisionId: 'rev-1', mcp: [ref('mcp', 'm1')] }),
    );

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('failed');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('capability-blocked');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('claude.mcp-project-scope-control');
    expect(outcome.affectedCapabilities).toEqual(['claude.mcp-project-scope-control']);
    expect(outcome.recoveryAction).not.toBeNull();
    expect(outcome.manifest).toBeNull();
    expect(outcome.adapterPlan).toBeNull();
    // AC2: never fake success, never silently fall back -- and never spawn at all once blocked.
    expect(claudeProcessPort.lastSpawnParams).toBeNull();
  });

  test('AC2 宿主拒绝硬控制边界（非零退出码）: failed, affected capabilities + recovery action surfaced, not faked as success', async () => {
    const { deps, configRepository, claudeProcessPort } = buildDeps();
    claudeProcessPort.spawnResult = { exitCode: 13, signal: null };
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('failed');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('13');
    expect(outcome.affectedCapabilities).toEqual(['claude.permission-mode-control']);
    expect(outcome.recoveryAction).not.toBeNull();
    expect(outcome.observationStage).toBe('observed');
  });

  test('AC2 affectedCapabilities 不过度归咎: hooks referenced (never argv-contributing) is excluded from affectedCapabilities on a rejected launch', async () => {
    const { deps, configRepository, claudeProcessPort } = buildDeps();
    claudeProcessPort.spawnResult = { exitCode: 13, signal: null };
    const confirmed = await preparedAndConfirmed(
      deps,
      configRepository,
      revision({ configName: 'general', revisionId: 'rev-1', hooks: [ref('hook', 'h1')] }),
    );

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('failed');
    // `claude.hook-deny-return-value` is relevant (hooks referenced) and
    // shows up in `manifest.capabilityPolicy`, but it never contributes an
    // argv flag -- it must never be blamed for a rejected launch.
    expect(outcome.manifest?.capabilityPolicy.map((n) => n.capabilityId)).toContain('claude.hook-deny-return-value');
    expect(outcome.affectedCapabilities).not.toContain('claude.hook-deny-return-value');
    expect(outcome.affectedCapabilities).toEqual(['claude.permission-mode-control']);
  });

  test('signal-terminated exit -> incomplete, not faked as failed or succeeded', async () => {
    const { deps, configRepository, claudeProcessPort } = buildDeps();
    claudeProcessPort.spawnResult = { exitCode: null, signal: 'SIGTERM' };
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('incomplete');
    expect(outcome.observationStage).toBe('observed');
    expect(outcome.recoveryAction).not.toBeNull();
  });

  test('spawn 抛出（二进制不可达）: apply-failed with typed reason, plan lands in a valid terminal phase, no partial state', async () => {
    const { deps, configRepository, claudeProcessPort } = buildDeps();
    claudeProcessPort.spawnError = new Error('claude-binary-not-found');
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('failed');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('spawn-process');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('claude-binary-not-found');
    expect(outcome.observationStage).toBe('planned');
    expect(outcome.recoveryAction).not.toBeNull();
  });

  test('invocation 目录准备失败: apply-failed without ever spawning, no partial state', async () => {
    const { deps, configRepository, claudeInvocationDirPort, claudeProcessPort } = buildDeps();
    claudeInvocationDirPort.prepareError = new Error('disk-full');
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('failed');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('invocation-dir');
    expect(claudeProcessPort.lastSpawnParams).toBeNull();
    expect(outcome.observationStage).toBe('planned');
  });

  test('修订在确认后、启动前被删除: typed failure instead of unhandled throw', async () => {
    const { deps, configRepository } = buildDeps();
    const confirmed = await preparedAndConfirmed(deps, configRepository, revision({ configName: 'general', revisionId: 'rev-1' }));
    configRepository.remove('rev-1');

    const outcome = await launchClaudeFresh(deps, { planId: confirmed.planId });

    expect(outcome.plan.phase).toBe('failed');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toContain('revision-lookup');
    expect(outcome.observationStage).toBe('planned');
  });

  test('launchClaudeFresh requires the plan to already be in the "applying" phase', async () => {
    const { deps, configRepository } = buildDeps();
    configRepository.add(revision({ configName: 'general', revisionId: 'rev-1' }));
    const plan = await prepareClaudeFreshLaunchPlan(deps, { revisionId: 'rev-1' }); // still awaiting-confirmation

    await expect(launchClaudeFresh(deps, { planId: plan.planId })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  test('rejects a plan created for a different client (e.g. omp) even if its phase is "applying"', async () => {
    const { deps, launchPlanRepository } = buildDeps();
    const foreignPlan: LaunchPlan = {
      planId: 'plan-omp-1',
      operationId: 'op-omp-1',
      revisionId: 'rev-1',
      configName: 'general',
      client: 'omp',
      planHash: 'ph_fake',
      phase: 'applying',
      createdAt: '2026-01-01T00:00:00Z',
      confirmedAt: known('2026-01-01T00:00:00Z'),
      failureReason: unknown('no-failure-recorded', '2026-01-01T00:00:00Z'),
      observedOutcome: unknown('not-yet-observed', '2026-01-01T00:00:00Z'),
    };
    await launchPlanRepository.save(foreignPlan);

    await expect(launchClaudeFresh(deps, { planId: foreignPlan.planId })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  test('unknown planId throws LaunchPlanNotFoundError', async () => {
    const { deps } = buildDeps();
    await expect(launchClaudeFresh(deps, { planId: 'no-such-plan' })).rejects.toBeInstanceOf(LaunchPlanNotFoundError);
  });

  test('用户拒绝确认: awaiting-confirmation -> cancelled via the reused rejectLaunchPlan, claude never spawned', async () => {
    const { deps, configRepository, claudeProcessPort } = buildDeps();
    configRepository.add(revision({ configName: 'general', revisionId: 'rev-1' }));
    const plan = await prepareClaudeFreshLaunchPlan(deps, { revisionId: 'rev-1' });

    const rejected = await rejectLaunchPlan(deps, plan.planId);
    expect(rejected.phase).toBe('cancelled');
    expect(claudeProcessPort.lastSpawnParams).toBeNull();
  });
});

describe('prepareClaudeAlreadyRunningLaunchPlan', () => {
  test('目标判定为 already-running，配置存在: plan lands directly on requires-restart in one save, no probe/spawn', async () => {
    const { deps, configRepository, launchPlanRepository, claudeCapabilityProbe, claudeProcessPort } = buildDeps();
    configRepository.add(revision({ configName: 'general', revisionId: 'rev-1' }));
    const probeSpy = { called: false };
    claudeCapabilityProbe.probeHardControlCapabilities = async () => {
      probeSpy.called = true;
      return [];
    };

    const outcome = await prepareClaudeAlreadyRunningLaunchPlan(deps, { revisionId: 'rev-1' });

    expect(outcome.plan.phase).toBe('requires-restart');
    expect(outcome.plan.client).toBe('claude-code');
    expect(outcome.plan.configName).toBe('general');
    expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toBe('already-running-session-target');
    expect(outcome.observationStage).toBe('planned');
    expect(outcome.manifest).toBeNull();
    expect(outcome.adapterPlan).toBeNull();
    expect(outcome.affectedCapabilities).toEqual([]);
    expect(outcome.recoveryAction).not.toBeNull();
    expect(probeSpy.called).toBe(false);
    expect(claudeProcessPort.lastSpawnParams).toBeNull();
    const savesForPlan = launchPlanRepository.saveLog.filter((p) => p.planId === outcome.plan.planId);
    expect(savesForPlan).toHaveLength(1);
  });

  test('配置不存在: still resolves to requires-restart, configName falls back to revisionId, not blocked or thrown', async () => {
    const { deps, launchPlanRepository } = buildDeps();

    const outcome = await prepareClaudeAlreadyRunningLaunchPlan(deps, { revisionId: 'does-not-exist' });

    expect(outcome.plan.phase).toBe('requires-restart');
    expect(outcome.plan.configName).toBe('does-not-exist');
    expect(outcome.observationStage).toBe('planned');
    const savesForPlan = launchPlanRepository.saveLog.filter((p) => p.planId === outcome.plan.planId);
    expect(savesForPlan).toHaveLength(1);
  });

  test('requires-restart 后再次尝试任何事件: transitionLaunchPlan rejects all further events, including target-requires-restart itself', async () => {
    const { deps, configRepository } = buildDeps();
    configRepository.add(revision({ configName: 'general', revisionId: 'rev-1' }));

    const outcome = await prepareClaudeAlreadyRunningLaunchPlan(deps, { revisionId: 'rev-1' });

    const again = transitionLaunchPlan(outcome.plan, { type: 'target-requires-restart' });
    expect(again.ok).toBe(false);
    const processStarted = transitionLaunchPlan(outcome.plan, { type: 'process-started' });
    expect(processStarted.ok).toBe(false);
  });

  test('误把 already-running 的 plan 传给 launchClaudeFresh: rejected as an invalid transition, never spawns', async () => {
    const { deps, configRepository, claudeProcessPort } = buildDeps();
    configRepository.add(revision({ configName: 'general', revisionId: 'rev-1' }));
    const outcome = await prepareClaudeAlreadyRunningLaunchPlan(deps, { revisionId: 'rev-1' });

    await expect(launchClaudeFresh(deps, { planId: outcome.plan.planId })).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(claudeProcessPort.lastSpawnParams).toBeNull();
  });
});

describe('computeClaudeKnownDifferences', () => {
  test('empty revision + ready manifest -> no differences', async () => {
    const { deps, configRepository, claudeCapabilityProbe } = buildDeps();
    const rev = revision({ configName: 'general', revisionId: 'rev-1' });
    configRepository.add(rev);
    const { compileClaudeAssemblyManifest } = await import('../../src/adapters/clients/claude/assembly-manifest');
    const results = await claudeCapabilityProbe.probeHardControlCapabilities();
    const manifestResult = compileClaudeAssemblyManifest(rev, results);
    if (manifestResult.kind !== 'compiled') throw new Error('expected compiled');

    expect(computeClaudeKnownDifferences(rev, manifestResult.manifest)).toEqual([]);
  });
});
