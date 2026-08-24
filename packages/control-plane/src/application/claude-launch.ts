/**
 * `[Story 4.3]` Fresh-target launch/observe for the Claude Code adapter
 * (AD-20's `fresh` branch). Deliberately isomorphic to `application/
 * launch.ts`'s OMP flow (`prepareLaunchPlan`/`launchOmp`) -- same shared
 * `domain/activation.ts` state machine (`createLaunchPlan`/
 * `transitionLaunchPlan`), same `prepared -> awaiting-confirmation ->
 * applying -> observing -> succeeded|degraded|failed|incomplete` lifecycle
 * -- but never routed through `resolveClientSupport`/`prepareLaunchPlan`/
 * `launchOmp` themselves. Two reasons:
 *
 *  1. `resolveClientSupport('claude-code')` is pinned by an existing OMP
 *     Story test (`tests/application/launch.test.ts`'s "不支持的客户端"
 *     case) as always returning `supported: false` for `claude-code` --
 *     that is OMP/the CLI's own existing product boundary (Story 4.1's
 *     `Never` boundary explicitly left `domain/client.ts` untouched for the
 *     same reason). Flipping it would regress that pinned test. This
 *     Story's own launch entrypoints are Claude-specific already (calling
 *     `prepareClaudeFreshLaunchPlan` at all *is* the "this client is
 *     supported here" signal), so they never need that generic gate.
 *  2. `launchOmp` is hardcoded to OMP's own ports/argv-building/skills-only
 *     assembly story; forking a small, explicit set of Claude-specific
 *     functions here (mirroring its structure, not its OMP-specific
 *     content) is safer than trying to generalize `launch.ts` into a
 *     multi-client function and risking the ~344 existing OMP tests that
 *     already pin its exact behavior.
 *
 * `confirmLaunchPlan`/`rejectLaunchPlan` (from `application/launch.ts`) are
 * reused as-is (not duplicated) -- both operate purely on `LaunchPlan` via
 * `LaunchDeps` (`configRepository`/`launchPlanRepository`) and never touch
 * `resolveClientSupport` or any OMP-specific port, so they are already
 * client-agnostic.
 *
 * `[Story 4.4]` This file also carries AD-20's other launch target,
 * `prepareClaudeAlreadyRunningLaunchPlan` (the `already-running` branch):
 * unlike `launchClaudeFresh`, it never reaches `awaiting-confirmation`/
 * `applying`/`observing` at all -- it resolves a plan straight from
 * `prepared` to the existing `requires-restart` terminal phase via
 * `domain/activation.ts`'s `target-requires-restart` event, needs none of
 * `LaunchClaudeFreshDeps`' probe/spawn/context/invocation-dir ports, and
 * takes only the plain `LaunchDeps` this file already imports for
 * `prepareClaudeFreshLaunchPlan`.
 */
import {
  type LaunchPhase,
  type LaunchPlan,
  type ObservationStage,
  computePlanHash,
  createLaunchPlan,
  transitionLaunchPlan,
} from '../domain/activation';
import type { StableConfigRevision } from '../domain/config';
import { argvContributingCapabilityIds, compileClaudeAdapterPlan, determineClaudeLaunchTarget } from '../adapters/clients/claude/adapter-plan';
import type { ClaudeAdapterPlan } from '../adapters/clients/claude/adapter-plan';
import { compileClaudeAssemblyManifest } from '../adapters/clients/claude/assembly-manifest';
import type { ClaudeAssemblyManifest } from '../adapters/clients/claude/assembly-manifest';
import { InvalidTransitionError, LaunchPlanNotFoundError, type LaunchDeps } from './launch';
import { ConfigNotFoundError, ConfigUnsupportedError, getConfigRevisionDetail } from './queries';
import type {
  ClaudeCapabilityProbePort,
  ClaudeInvocationDirPort,
  ClaudeLaunchContextWriter,
  ClaudeProcessPort,
  ClaudeSpawnResult,
  ConfigRevisionRepository,
  LaunchPlanRepository,
} from './ports';

export type { LaunchDeps };

export interface LaunchClaudeFreshDeps extends LaunchDeps {
  readonly claudeProcessPort: ClaudeProcessPort;
  readonly claudeCapabilityProbe: ClaudeCapabilityProbePort;
  readonly claudeLaunchContextWriter: ClaudeLaunchContextWriter;
  readonly claudeInvocationDirPort: ClaudeInvocationDirPort;
}

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * `[Story 4.3]` Honest content-materialization gaps for a fresh Claude Code
 * launch, mirroring `application/launch.ts`'s `computeKnownDifferences` for
 * OMP -- but broader: unlike OMP (which really does assemble Skills, by
 * name, via its own native discovery flag), this Story's fresh launch never
 * materializes *any* of Instructions/Skills/MCP content -- only the hard-
 * control capability flags themselves (`adapter-plan.ts`'s
 * `buildClaudeAdapterPlanArgv`) are actually applied. No verified Claude
 * Code flag exists (Story 4.1's probe) to select skills/instructions/MCP by
 * name the way OMP's `--skills <names>` does, so claiming any of these
 * groups as "assembled" here would misrepresent what actually happened.
 * `hooks`/`plugins` are read from `revision` directly (never from
 * `ClaudeAssemblyManifest`, which deliberately excludes them as typed
 * reference fields -- Story 4.2's `Never` boundary) purely for this
 * honesty check, exactly as OMP's own version does.
 */
export function computeClaudeKnownDifferences(revision: StableConfigRevision, manifest: ClaudeAssemblyManifest): string[] {
  const differences: string[] = [];
  if (revision.instructions.length > 0) {
    differences.push('instructions-content-not-materialized-in-fresh-launch');
  }
  if (revision.skills.length > 0) {
    differences.push('skills-content-not-materialized-in-fresh-launch');
  }
  if (revision.mcp.length > 0) {
    differences.push('mcp-content-not-materialized-in-fresh-launch');
  }
  if (revision.hooks.length > 0) {
    differences.push('hooks-content-not-materialized-in-fresh-launch');
  }
  if (revision.plugins.length > 0) {
    differences.push('plugins-content-not-materialized-in-fresh-launch');
  }
  if (manifest.degradedCapabilities.length > 0) {
    differences.push(`degraded-capabilities: ${[...manifest.degradedCapabilities].sort().join(', ')}`);
  }
  return differences;
}

/**
 * `[Story 4.3]` Mirrors `application/launch.ts`'s `prepareLaunchPlan`, minus
 * the `resolveClientSupport` gate (see this file's top-of-file Design
 * Note). Capability probing and manifest/plan compilation are deliberately
 * deferred to `launchClaudeFresh` (matching OMP's own structure exactly:
 * `prepareLaunchPlan` never probes OMP's capability either) -- `prepare`
 * only resolves whether the chosen revision exists at all.
 */
export async function prepareClaudeFreshLaunchPlan(
  deps: LaunchDeps,
  params: { readonly revisionId: string },
): Promise<LaunchPlan> {
  const createdAt = new Date().toISOString();
  const planHash = computePlanHash(params.revisionId, 'claude-code', createdAt);

  let configName = params.revisionId;
  let prepareFailureReason: string | null = null;
  try {
    const revision = await getConfigRevisionDetail(deps.configRepository, params.revisionId);
    configName = revision.configName;
  } catch (error) {
    if (error instanceof ConfigNotFoundError || error instanceof ConfigUnsupportedError) {
      prepareFailureReason = error.message;
    } else {
      throw error;
    }
  }

  let plan = createLaunchPlan({
    planId: generateId('plan'),
    operationId: generateId('op'),
    revisionId: params.revisionId,
    configName,
    client: 'claude-code',
    planHash,
    createdAt,
  });

  const event =
    prepareFailureReason !== null
      ? ({ type: 'prepared-failed', reason: prepareFailureReason } as const)
      : ({ type: 'prepared-ok' } as const);
  const result = transitionLaunchPlan(plan, event);
  if (!result.ok) {
    throw new InvalidTransitionError(plan.planId, plan.phase, event.type, result.reason);
  }
  plan = result.plan;

  await deps.launchPlanRepository.save(plan);
  return plan;
}

/**
 * `[Story 4.3]` AC2's display-support projection: everything a caller needs
 * to show "which stage failed, which capabilities were affected, the known
 * reason and a recovery action" without persisting anything new or
 * changing `domain/activation.ts`'s canonical `LaunchPlan` shape.
 * `manifest`/`adapterPlan` are `null` only when the flow never reached
 * (or could not reach) that compilation stage.
 */
export interface ClaudeLaunchOutcome {
  readonly plan: LaunchPlan;
  readonly observationStage: ObservationStage;
  readonly manifest: ClaudeAssemblyManifest | null;
  readonly adapterPlan: ClaudeAdapterPlan | null;
  /** `capabilityId`s implicated in a failure/degradation; empty when none are. */
  readonly affectedCapabilities: readonly string[];
  /** Human-readable next step; `null` only when the outcome was not a failure. */
  readonly recoveryAction: string | null;
}

function applyFailure(plan: LaunchPlan, reason: string): LaunchPlan {
  const result = transitionLaunchPlan(plan, { type: 'apply-failed', reason });
  if (!result.ok) {
    throw new InvalidTransitionError(plan.planId, plan.phase, 'apply-failed', result.reason);
  }
  return result.plan;
}

function outcomeFor(
  plan: LaunchPlan,
  observationStage: ObservationStage,
  manifest: ClaudeAssemblyManifest | null,
  adapterPlan: ClaudeAdapterPlan | null,
  affectedCapabilities: readonly string[],
  recoveryAction: string | null,
): ClaudeLaunchOutcome {
  return { plan, observationStage, manifest, adapterPlan, affectedCapabilities, recoveryAction };
}

/**
 * `[Story 4.4]` AD-20's already-running-session launch target: this product
 * does not own that process, so `apply` can only ever resolve to the
 * existing `requires-restart` terminal phase (AD-18) -- never `awaiting-
 * confirmation`/`applying`/`observing`. Deliberately calls
 * `deps.launchPlanRepository.save` exactly once (after the plan already
 * landed on its terminal phase) and never calls `claudeCapabilityProbe`,
 * `compileClaudeAssemblyManifest`/`compileClaudeAdapterPlan`, or
 * `claudeProcessPort.spawn` -- any of those would compute something that
 * looks like progress toward "applying" a plan this function can never
 * really apply, which is exactly the kind of half-true intermediate result
 * AD-10 forbids. `configName` resolution mirrors
 * `prepareClaudeFreshLaunchPlan`'s best-effort revision lookup, but --
 * unlike that function -- a lookup failure never blocks the terminal
 * outcome: whether or not the revision exists, the only possible terminal
 * phase for an already-running target is `requires-restart` (there is
 * nothing to have "not found" against, since nothing was ever going to be
 * applied).
 */
export async function prepareClaudeAlreadyRunningLaunchPlan(
  deps: LaunchDeps,
  params: { readonly revisionId: string },
): Promise<ClaudeLaunchOutcome> {
  const createdAt = new Date().toISOString();
  const planHash = computePlanHash(params.revisionId, 'claude-code', createdAt);

  let configName = params.revisionId;
  try {
    const revision = await getConfigRevisionDetail(deps.configRepository, params.revisionId);
    configName = revision.configName;
  } catch (error) {
    if (!(error instanceof ConfigNotFoundError || error instanceof ConfigUnsupportedError)) {
      throw error;
    }
    // Best-effort only (mirrors `prepareClaudeFreshLaunchPlan`): whether the
    // revision resolves or not, the already-running target's only possible
    // terminal phase is `requires-restart` -- a lookup failure here never
    // blocks or changes that outcome.
  }

  let plan = createLaunchPlan({
    planId: generateId('plan'),
    operationId: generateId('op'),
    revisionId: params.revisionId,
    configName,
    client: 'claude-code',
    planHash,
    createdAt,
  });

  // AD-10/AD-20 fail-closed target determination: this Story never has real
  // "this is the fresh spawn itself" evidence to offer (that is Story 4.5's
  // self-introspection scope), so it always passes `ownsFreshSpawn: false`.
  // The exhaustive `switch` below is the "forces every call site to revisit
  // its judgment" enforcement Story 4.3's `ClaudeLaunchTarget` doc comment
  // predicted -- it is not dead code: it fails loudly (rather than silently
  // mis-handling a `'fresh'` target as already-running) if this determinism
  // is ever violated.
  const target = determineClaudeLaunchTarget({ ownsFreshSpawn: false });
  switch (target) {
    case 'already-running':
      break;
    case 'fresh':
      throw new Error(
        `prepareClaudeAlreadyRunningLaunchPlan requires determineClaudeLaunchTarget to resolve to "already-running", got "${target}"`,
      );
    default: {
      const exhaustive: never = target;
      throw new Error(`prepareClaudeAlreadyRunningLaunchPlan encountered an unrecognized ClaudeLaunchTarget: "${exhaustive}"`);
    }
  }

  const transitioned = transitionLaunchPlan(plan, { type: 'target-requires-restart' });
  if (!transitioned.ok) {
    throw new InvalidTransitionError(plan.planId, plan.phase, 'target-requires-restart', transitioned.reason);
  }
  plan = transitioned.plan;

  await deps.launchPlanRepository.save(plan);

  return outcomeFor(
    plan,
    'planned',
    null,
    null,
    [],
    '需要重启当前 Claude Code 会话后重新应用：本产品无法对一个已经在运行的、非本产品拥有的会话热更新装配边界。',
  );
}

/** Mirrors `application/launch.ts`'s private `deriveOutcome` (same logic, over the Claude-specific `ClaudeSpawnResult` shape). */
function deriveClaudeObservedOutcome(
  spawnResult: ClaudeSpawnResult,
  applyResult: 'applied' | 'degraded',
): { readonly outcome: 'succeeded' | 'degraded' | 'failed' | 'incomplete'; readonly reason?: string } {
  if (spawnResult.exitCode === 0) {
    return { outcome: applyResult === 'applied' ? 'succeeded' : 'degraded' };
  }
  if (spawnResult.exitCode !== null) {
    return { outcome: 'failed', reason: `claude exited with code ${spawnResult.exitCode}` };
  }
  return {
    outcome: 'incomplete',
    reason: `claude process ended without a determinable exit code (signal: ${spawnResult.signal ?? 'unknown'})`,
  };
}

/**
 * `[Story 4.3]` AC1/AC2: generate the isolated invocation directory, probe
 * fresh hard-control capability evidence, compile the assembly manifest and
 * the real launch-facing `ClaudeAdapterPlan`, spawn a brand-new `claude`
 * process (never this repo's own running session, never touching `.cap/`)
 * and observe its outcome. `plan` must already be `applying` (i.e. already
 * confirmed via `confirmLaunchPlan`).
 *
 * Every failure path returns (never throws) a `ClaudeLaunchOutcome` whose
 * `plan.phase` is a valid AD-18 terminal-or-well-defined phase -- there is
 * no half-updated `LaunchPlan`: `deps.launchPlanRepository.save` is only
 * ever called with a complete, newly-transitioned plan, so an exception
 * partway through this function can never leave a stored plan in an
 * inconsistent phase (AC1's "不产生部分应用状态").
 */
export async function launchClaudeFresh(
  deps: LaunchClaudeFreshDeps,
  params: { readonly planId: string; readonly onSpawning?: () => void },
): Promise<ClaudeLaunchOutcome> {
  let plan = await deps.launchPlanRepository.findById(params.planId);
  if (plan === null) {
    throw new LaunchPlanNotFoundError(params.planId);
  }
  // Defensive: this plan repository is shared across clients (`LaunchPlan.client`
  // is a plain `ClientId` field, not a type-level guarantee) -- a plan created
  // for a different client (e.g. `omp`) must never be treated as a Claude
  // fresh launch just because its `planId` was passed here. `launchOmp` has
  // the same latent gap on the OMP side (this codebase's only other launch
  // entrypoint); this Story does not fix that OMP-side gap (out of scope,
  // would touch `application/launch.ts`), but does not repeat it here.
  if (plan.client !== 'claude-code') {
    throw new InvalidTransitionError(
      params.planId,
      plan.phase,
      'spawn-process',
      `launchClaudeFresh requires a plan whose client is "claude-code", got "${plan.client}"`,
    );
  }
  if (plan.phase !== 'applying') {
    throw new InvalidTransitionError(
      params.planId,
      plan.phase,
      'spawn-process',
      'launchClaudeFresh requires a plan already in the "applying" phase (confirm it first)',
    );
  }

  let revision: StableConfigRevision;
  try {
    revision = await getConfigRevisionDetail(deps.configRepository, plan.revisionId);
  } catch (error) {
    if (error instanceof ConfigNotFoundError || error instanceof ConfigUnsupportedError) {
      plan = applyFailure(plan, `revision-lookup: ${error.message}`);
      await deps.launchPlanRepository.save(plan);
      return outcomeFor(plan, 'planned', null, null, [], '重新选择一个当前存在且受支持的配置修订后重试');
    }
    throw error;
  }

  const probeResults = await deps.claudeCapabilityProbe.probeHardControlCapabilities();
  const manifestResult = compileClaudeAssemblyManifest(revision, probeResults);

  if (manifestResult.kind === 'blocked') {
    plan = applyFailure(plan, `capability-blocked: ${manifestResult.missingRequiredCapabilities.join(', ')}`);
    await deps.launchPlanRepository.save(plan);
    return outcomeFor(
      plan,
      'planned',
      null,
      null,
      manifestResult.missingRequiredCapabilities,
      '确认 Claude Code 版本/环境支持上述必需能力（重新执行 probe 验证），或改用受支持能力覆盖的配置修订后重试',
    );
  }

  const manifest = manifestResult.manifest;
  const knownDifferences = computeClaudeKnownDifferences(revision, manifest);
  const applyResult: 'applied' | 'degraded' = knownDifferences.length === 0 && manifest.manifestStatus === 'ready' ? 'applied' : 'degraded';
  const adapterPlan = compileClaudeAdapterPlan(manifest);

  let invocationDir: string;
  try {
    invocationDir = await deps.claudeInvocationDirPort.prepare(plan.operationId);
  } catch (error) {
    plan = applyFailure(plan, `invocation-dir: ${(error as Error).message}`);
    await deps.launchPlanRepository.save(plan);
    return outcomeFor(plan, 'planned', manifest, adapterPlan, [], '确认本机磁盘可写且 Agent System 状态目录权限正常后重试');
  }

  await deps.claudeLaunchContextWriter.write({
    version: 1,
    planId: plan.planId,
    operationId: plan.operationId,
    revisionId: plan.revisionId,
    configName: plan.configName,
    client: 'claude-code',
    launchTarget: 'fresh',
    launchedAt: new Date().toISOString(),
    applyResult,
    knownDifferences,
    adapterPlanHash: adapterPlan.planHash,
  });

  let spawnResult: ClaudeSpawnResult;
  try {
    params.onSpawning?.();
    spawnResult = await deps.claudeProcessPort.spawn({
      argv: adapterPlan.argv,
      env: { CLAUDE_CONFIG_DIR: invocationDir },
      cwd: invocationDir,
    });
  } catch (error) {
    plan = applyFailure(plan, `spawn-process: ${(error as Error).message}`);
    await deps.launchPlanRepository.save(plan);
    return outcomeFor(
      plan,
      'planned',
      manifest,
      adapterPlan,
      argvContributingCapabilityIds(manifest.capabilityPolicy),
      '确认 claude 二进制已安装并可从 PATH 直接执行后重试',
    );
  }

  const started = transitionLaunchPlan(plan, { type: 'process-started' });
  if (!started.ok) {
    throw new InvalidTransitionError(plan.planId, plan.phase, 'process-started', started.reason);
  }
  plan = started.plan;
  await deps.launchPlanRepository.save(plan);

  const outcome = deriveClaudeObservedOutcome(spawnResult, applyResult);
  const observed = transitionLaunchPlan(plan, { type: 'observed', outcome: outcome.outcome, reason: outcome.reason });
  if (!observed.ok) {
    throw new InvalidTransitionError(plan.planId, plan.phase, 'observed', observed.reason);
  }
  plan = observed.plan;
  await deps.launchPlanRepository.save(plan);

  const isFailureOutcome = outcome.outcome === 'failed' || outcome.outcome === 'incomplete';
  const affectedCapabilities = isFailureOutcome
    ? argvContributingCapabilityIds(manifest.capabilityPolicy)
    : manifest.degradedCapabilities;
  const recoveryAction =
    outcome.outcome === 'failed'
      ? '查看 claude 进程退出码与输出，确认宿主是否拒绝了本次装配的硬控制边界后再重试'
      : outcome.outcome === 'incomplete'
        ? '确认 claude 进程未被信号意外终止（如手动结束进程或系统重启）后重试'
        : null;

  // The process genuinely spawned and its exit was captured (the
  // `process-started` transition above only succeeds once `spawn()` has
  // already resolved) -- this is unambiguously `observed`, regardless of
  // which terminal outcome it landed on.
  return outcomeFor(plan, 'observed', manifest, adapterPlan, affectedCapabilities, recoveryAction);
}

/** Re-exported for callers that only need to reason about `LaunchPhase` alongside this file's outcome type. */
export type { LaunchPhase };
