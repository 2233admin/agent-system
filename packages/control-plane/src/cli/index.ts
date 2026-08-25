#!/usr/bin/env bun
/**
 * `configs` CLI entry point. Dispatches the read-only subcommands from
 * Story 1.1 (`list`, `show <id>`, `compare <id...>`), Story 1.2's
 * activation subcommands (`use <id>`, `status [<planId>]`, `switch <id>`),
 * Story 3.1's non-interactive write subcommand
 * (`establish --trigger-category <cat> --evidence <ref> [--from <path>]`),
 * and Story 3.2's non-interactive supersede subcommand
 * (`revise --trigger-category <cat> --evidence <ref> --supersedes
 * <revisionId> [--from <path>]`). No other subcommand exists -- in
 * particular there is no `configs sync`/`configs import` (see
 * `src/adapters/sources/cap-fs.ts` for why).
 */

import { spawn } from 'node:child_process';

import type { ClientId } from '../domain/client';
import { resolveClientSupport } from '../domain/client';
import type { LaunchPlan } from '../domain/activation';
import { SqliteConfigRevisionRepository } from '../adapters/sqlite/repository';
import { SqliteConfigRevisionWriter } from '../adapters/sqlite/config-revision-writer';
import { SqliteLaunchPlanRepository } from '../adapters/sqlite/launch-repository';
import { BunOmpProcessPort, defaultExtensionPath, findDenylistedForwardedArg } from '../adapters/omp/process-port';
import { BunOmpCapabilityProbe } from '../adapters/omp/capability-probe';
import { FsLaunchContextWriter } from '../adapters/launch-context/fs-launch-context-writer';
import { FsClaudeLaunchContextWriter } from '../adapters/launch-context/fs-claude-launch-context-writer';
import { GithubReleaseUpdater } from '../adapters/self-update/github-release-updater';
import { isCheckDue, readSelfUpdateState, writeSelfUpdateState } from '../adapters/self-update/check-state';
import { BunClaudeProcessPort } from '../adapters/clients/claude/process-port';
import { BunClaudeCapabilityProbe } from '../adapters/clients/claude/capability-probe';
import { compileClaudeAssemblyManifest } from '../adapters/clients/claude/assembly-manifest';
import { FsClaudeInvocationDirPort } from '../adapters/system/claude-invocation-dir';
import { FsClaudeContentMaterializer } from '../adapters/clients/claude/content-materializer';
import type {
  ConfigRevisionRepository,
  LaunchPlanRepository,
  OmpCapabilityProbePort,
  OmpProcessPort,
  LaunchContextWriter,
  ClaudeCapabilityProbePort,
  ClaudeContentMaterializerPort,
  ClaudeInvocationDirPort,
  ClaudeLaunchContextWriter,
  ClaudeProcessPort,
  SelfUpdatePort,
} from '../application/ports';
import {
  ConfigNotFoundError,
  ConfigUnsupportedError,
  compareConfigRevisions,
  getConfigRevisionDetail,
  getSupersedesChain,
  listConfigRevisions,
  type ConfigQueryError,
} from '../application/queries';
import {
  InvalidCandidateError,
  InvalidTriggerCategoryError,
  MissingEvidenceError,
  MissingSupersedesError,
  NoCandidateSourceError,
  SupersedesConfigMismatchError,
  SupersedesConflictError,
  SupersedesNotFoundError,
  parseCandidateRevision,
  parseEvidenceRef,
  parseSupersedesRevisionId,
  parseTriggerCategory,
} from '../application/establish';
import { isStdinTTY, readCandidateFile, readStdinText } from './candidate-source';
import {
  InvalidTransitionError,
  LaunchPlanNotFoundError,
  StaleConfirmationError,
  UnsupportedClientError,
  computeKnownDifferences,
  confirmLaunchPlan,
  getLaunchStatus,
  launchOmp,
  prepareLaunchPlan,
  rejectLaunchPlan,
  requestConfigSwitch,
  type LaunchDeps,
} from '../application/launch';
import {
  launchClaudeFresh,
  prepareClaudeAlreadyRunningLaunchPlan,
  prepareClaudeFreshLaunchPlan,
  type ClaudeLaunchOutcome,
  type LaunchClaudeFreshDeps,
} from '../application/claude-launch';
import { readYesNo } from './confirm-prompt';
import { defaultDbPath } from './db-path';
import { defaultSelfUpdateStatePath } from './self-update-state-path';
import { t } from './i18n';
import { CONFIGS_VERSION } from './version';
import {
  renderCompareResult,
  renderConfirmationSummary,
  renderDetail,
  renderEstablishSuccess,
  renderHandoffLine,
  renderLaunchFailure,
  renderLaunchStatus,
  renderList,
  renderQueryFailure,
  renderReviseSuccess,
  renderSupersedesChainSection,
  renderSwitchAccepted,
  renderUnsupportedClient,
} from './render';
import { runTui } from './tui';

// The syntax portion never translates (command/subcommand/flag names are
// stable, `grep`-matched identifiers -- same convention as everywhere
// else in this file); only the leading "usage:"/"用法：" word is
// language-dependent, so this is composed via `usageLine()` rather than
// being a static constant.
const USAGE_SYNTAX =
  'configs <list|show <id>|compare <id> <id> [...ids]|use <id> [--client <id>] [--yes] [-- ...args]|status [<planId>]|switch <id> [--client <id>] [--yes] [-- ...args]|establish --trigger-category <cat> --evidence <ref> [--from <path>]|revise --trigger-category <cat> --evidence <ref> --supersedes <revisionId> [--from <path>]>';

function usageLine(): string {
  return `${t('usage.prefix')} ${USAGE_SYNTAX}`;
}

const KNOWN_CLIENT_IDS: readonly ClientId[] = ['omp', 'claude-code', 'codex-cli'];

function isConfigQueryError(error: unknown): error is ConfigQueryError {
  return error instanceof ConfigNotFoundError || error instanceof ConfigUnsupportedError;
}

/**
 * Validated ahead of opening the SQLite repositories so a usage error, or
 * an unsupported-client selection, never has the side effect of creating/
 * touching the database file (Boundaries & Constraints: unsupported
 * clients must return before any plan is created).
 */
type ParsedCommand =
  | { readonly kind: 'usage-error'; readonly message: string }
  | { readonly kind: 'unsupported-client'; readonly clientId: string; readonly reason: string }
  | { readonly kind: 'list' }
  | { readonly kind: 'show'; readonly id: string }
  | { readonly kind: 'compare'; readonly ids: readonly string[] }
  | { readonly kind: 'use' | 'switch'; readonly id: string; readonly client: ClientId; readonly yes: boolean; readonly forwardedArgs: readonly string[] }
  | { readonly kind: 'status'; readonly planId: string | null }
  | {
      readonly kind: 'establish';
      readonly triggerCategoryRaw: string | undefined;
      readonly evidenceRaw: string | undefined;
      readonly fromPath: string | null;
    }
  | {
      readonly kind: 'revise';
      readonly triggerCategoryRaw: string | undefined;
      readonly evidenceRaw: string | undefined;
      readonly supersedesRaw: string | undefined;
      readonly fromPath: string | null;
    };

function parseUseOrSwitch(kind: 'use' | 'switch', rest: readonly string[]): ParsedCommand {
  const ddIndex = rest.indexOf('--');
  const head = ddIndex === -1 ? rest : rest.slice(0, ddIndex);
  const forwardedArgs = ddIndex === -1 ? [] : rest.slice(ddIndex + 1);

  const id = head[0];
  if (id === undefined || id.startsWith('--')) {
    return { kind: 'usage-error', message: `${t('parseError.missingId', { command: kind })}\n${usageLine()}` };
  }

  let clientRaw = 'omp';
  let yes = false;
  for (let i = 1; i < head.length; i += 1) {
    const token = head[i];
    if (token === '--yes') {
      yes = true;
      continue;
    }
    if (token === '--client') {
      const value = head[i + 1];
      if (value === undefined) {
        return { kind: 'usage-error', message: `${t('parseError.clientRequiresValue')}\n${usageLine()}` };
      }
      clientRaw = value;
      i += 1;
      continue;
    }
    // `token` is defined here -- the loop bound (`i < head.length`)
    // guarantees it; only `noUncheckedIndexedAccess` widens its static
    // type to include `undefined`.
    return { kind: 'usage-error', message: `${t('parseError.unknownFlag', { flag: token! })}\n${usageLine()}` };
  }

  if (clientRaw !== 'omp') {
    if (!KNOWN_CLIENT_IDS.includes(clientRaw as ClientId)) {
      return { kind: 'usage-error', message: `${t('parseError.unknownClient', { client: clientRaw })}\n${usageLine()}` };
    }
    const support = resolveClientSupport(clientRaw as ClientId);
    if (!support.supported) {
      return { kind: 'unsupported-client', clientId: clientRaw, reason: support.reason ?? 'unsupported client' };
    }
  }

  // `[Story 4.6 review fix]` `claude-code` has no forwarded-args delivery
  // mechanism at all (`launchClaudeFresh`/`ClaudeSpawnParams` never accept
  // one) -- rejected here, before any repository is opened, with a typed
  // usage error, rather than being silently dropped by `runClaudeLaunchFlow`
  // (which never reads `forwardedArgs`).
  if (clientRaw === 'claude-code' && forwardedArgs.length > 0) {
    return {
      kind: 'usage-error',
      message: `${t('parseError.forwardedArgsUnsupportedForClaude', { command: kind })}\n${usageLine()}`,
    };
  }

  // Rejected here -- before any repository is opened, any plan is created
  // or `omp` is spawned -- because a forwarded `-e`/`--extension`,
  // `--profile`, `-c`/`--continue`, `-r`/`--resume` or `--session-dir`
  // would defeat this Story's single-extension-source/default-profile/
  // no-auto-resume guarantees if let through opaquely (see
  // `findDenylistedForwardedArg`'s docstring in `adapters/omp/process-port.ts`).
  const denylisted = findDenylistedForwardedArg(forwardedArgs);
  if (denylisted !== null) {
    return {
      kind: 'usage-error',
      message: `${t('parseError.denylistedForwardedArg', { command: kind, arg: denylisted })}\n${usageLine()}`,
    };
  }

  return { kind, id, client: clientRaw as ClientId, yes, forwardedArgs };
}

/**
 * Pure syntactic parsing only -- extracts the raw `--trigger-category`/
 * `--evidence`/`--from` flag values without validating them (no enum
 * check, no non-empty check, no stdin/file read). Semantic validation, in
 * the exact order Boundaries & Constraints requires (trigger/evidence
 * before any candidate is read, then the TTY guard, then the candidate
 * itself), happens in `runEstablish` -- keeping it out of this function
 * matches every other subcommand here (`parseUseOrSwitch` also only
 * extracts/shape-checks flags, never opens anything).
 */
function parseEstablish(rest: readonly string[]): ParsedCommand {
  let triggerCategoryRaw: string | undefined;
  let evidenceRaw: string | undefined;
  let fromPath: string | null = null;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--trigger-category') {
      if (triggerCategoryRaw !== undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--trigger-category' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--trigger-category' })}\n${usageLine()}`,
        };
      }
      triggerCategoryRaw = value;
      i += 1;
      continue;
    }
    if (token === '--evidence') {
      if (evidenceRaw !== undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--evidence' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--evidence' })}\n${usageLine()}`,
        };
      }
      evidenceRaw = value;
      i += 1;
      continue;
    }
    if (token === '--from') {
      if (fromPath !== null) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--from' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--from' })}\n${usageLine()}`,
        };
      }
      fromPath = value;
      i += 1;
      continue;
    }
    return { kind: 'usage-error', message: `${t('parseError.unknownFlag', { flag: token! })}\n${usageLine()}` };
  }

  return { kind: 'establish', triggerCategoryRaw, evidenceRaw, fromPath };
}

/**
 * `[Story 3.2]` Same pure-syntactic-only shape as `parseEstablish` (no
 * enum/non-empty/stdin checks here -- see that function's doc comment for
 * why), plus one more flag: `--supersedes <revisionId>`. Semantic
 * validation (in the Boundaries & Constraints order: trigger -> evidence
 * -> supersedes non-empty -> TTY guard -> candidate) happens in
 * `runRevise`.
 */
function parseRevise(rest: readonly string[]): ParsedCommand {
  let triggerCategoryRaw: string | undefined;
  let evidenceRaw: string | undefined;
  let supersedesRaw: string | undefined;
  let fromPath: string | null = null;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--trigger-category') {
      if (triggerCategoryRaw !== undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--trigger-category' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--trigger-category' })}\n${usageLine()}`,
        };
      }
      triggerCategoryRaw = value;
      i += 1;
      continue;
    }
    if (token === '--evidence') {
      if (evidenceRaw !== undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--evidence' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--evidence' })}\n${usageLine()}`,
        };
      }
      evidenceRaw = value;
      i += 1;
      continue;
    }
    if (token === '--supersedes') {
      if (supersedesRaw !== undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--supersedes' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--supersedes' })}\n${usageLine()}`,
        };
      }
      supersedesRaw = value;
      i += 1;
      continue;
    }
    if (token === '--from') {
      if (fromPath !== null) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRepeated', { flag: '--from' })}\n${usageLine()}`,
        };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return {
          kind: 'usage-error',
          message: `${t('parseError.establishFlagRequiresValue', { flag: '--from' })}\n${usageLine()}`,
        };
      }
      fromPath = value;
      i += 1;
      continue;
    }
    return { kind: 'usage-error', message: `${t('parseError.unknownFlag', { flag: token! })}\n${usageLine()}` };
  }

  return { kind: 'revise', triggerCategoryRaw, evidenceRaw, supersedesRaw, fromPath };
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case 'list':
      return { kind: 'list' };
    case 'show': {
      const id = rest[0];
      if (id === undefined) {
        return { kind: 'usage-error', message: `${t('parseError.missingId', { command: 'show' })}\n${usageLine()}` };
      }
      return { kind: 'show', id };
    }
    case 'compare':
      if (rest.length < 2) {
        return { kind: 'usage-error', message: `${t('parseError.compareMinIds')}\n${usageLine()}` };
      }
      return { kind: 'compare', ids: rest };
    case 'use':
      return parseUseOrSwitch('use', rest);
    case 'switch':
      return parseUseOrSwitch('switch', rest);
    case 'status':
      return { kind: 'status', planId: rest[0] ?? null };
    case 'establish':
      return parseEstablish(rest);
    case 'revise':
      return parseRevise(rest);
    default:
      // `command` is always defined here: `main()` intercepts `argv.length
      // === 0` before `parseCommand` is ever called, so this `default`
      // branch is only reached for an actual unrecognized subcommand
      // string. (`command!` -- TypeScript can't see that caller guarantee
      // through the `switch`, but it holds for every reachable call site.)
      return { kind: 'usage-error', message: `${t('parseError.unknownCommand', { command: command! })}\n${usageLine()}` };
  }
}

export interface CliOverrides {
  readonly ompPort?: OmpProcessPort;
  readonly capabilityProbe?: OmpCapabilityProbePort;
  readonly contextWriter?: LaunchContextWriter;
  /** `[Story 4.6]` Claude-side port overrides, same purpose as the three above. */
  readonly claudeProcessPort?: ClaudeProcessPort;
  readonly claudeCapabilityProbe?: ClaudeCapabilityProbePort;
  readonly claudeLaunchContextWriter?: ClaudeLaunchContextWriter;
  readonly claudeInvocationDirPort?: ClaudeInvocationDirPort;
  readonly claudeContentMaterializer?: ClaudeContentMaterializerPort;
}

/**
 * `configRepository`/`launchPlanRepository` only need to be *closable*
 * versions of the read-only application-layer repository ports -- not
 * literally the concrete SQLite classes. Narrowing it to a structural
 * interface (rather than `SqliteConfigRevisionRepository`/
 * `SqliteLaunchPlanRepository`) is what lets `runTuiWithDeps()`'s tests
 * (`tests/cli/tui.test.tsx`) construct a `FullDeps` out of in-memory
 * fakes instead of a real SQLite file.
 */
export interface ClosableConfigRevisionRepository extends ConfigRevisionRepository {
  close(): void;
}
export interface ClosableLaunchPlanRepository extends LaunchPlanRepository {
  close(): void;
}

export interface FullDeps extends LaunchDeps, LaunchClaudeFreshDeps {
  readonly configRepository: ClosableConfigRevisionRepository;
  readonly launchPlanRepository: ClosableLaunchPlanRepository;
  readonly ompPort: OmpProcessPort;
  readonly capabilityProbe: OmpCapabilityProbePort;
  readonly contextWriter: LaunchContextWriter;
  /** `[Story 4.6]` Constructed the same way as the three OMP ports above -- no I/O in the constructor itself. */
  readonly claudeProcessPort: ClaudeProcessPort;
  readonly claudeCapabilityProbe: ClaudeCapabilityProbePort;
  readonly claudeLaunchContextWriter: ClaudeLaunchContextWriter;
  readonly claudeInvocationDirPort: ClaudeInvocationDirPort;
  readonly claudeContentMaterializer: ClaudeContentMaterializerPort;
}

/**
 * Opens the SQLite-backed repositories and assembles the full dependency
 * bag shared by `main()`'s subcommand dispatch and `runTui()`. Extracted
 * verbatim from `main()`'s prior inline construction (Design Notes: "只是
 * 把 main() 现有...行原样搬到一个可复用函数,不改变其错误处理/close顺序") --
 * on failure it prints the same typed error and returns `null` rather than
 * throwing, so callers just check for `null` and exit 1.
 */
export async function openDeps(overrides: CliOverrides): Promise<FullDeps | null> {
  let configRepository: SqliteConfigRevisionRepository | undefined;
  let launchPlanRepository: SqliteLaunchPlanRepository;
  try {
    const dbPath = defaultDbPath();
    configRepository = new SqliteConfigRevisionRepository(dbPath);
    launchPlanRepository = new SqliteLaunchPlanRepository(dbPath);
  } catch (error) {
    // `configRepository` may have already opened successfully before
    // `launchPlanRepository`'s construction threw -- never leak that
    // handle.
    configRepository?.close();
    console.error(t('openDeps.failed', { message: (error as Error).message }));
    return null;
  }

  // `[Story 4.6]` Constructed once so `claudeCapabilityProbe`'s default can
  // reuse the exact same port instance rather than spinning up a second,
  // independent `BunClaudeProcessPort` -- both, like every construction in
  // this function, are side-effect-free (no process spawned, no file
  // touched) until a method is actually called on them.
  const claudeProcessPort = overrides.claudeProcessPort ?? new BunClaudeProcessPort();

  return {
    configRepository,
    launchPlanRepository,
    ompPort: overrides.ompPort ?? new BunOmpProcessPort(),
    capabilityProbe: overrides.capabilityProbe ?? new BunOmpCapabilityProbe(),
    contextWriter: overrides.contextWriter ?? new FsLaunchContextWriter(),
    claudeProcessPort,
    claudeCapabilityProbe: overrides.claudeCapabilityProbe ?? new BunClaudeCapabilityProbe(claudeProcessPort),
    claudeLaunchContextWriter: overrides.claudeLaunchContextWriter ?? new FsClaudeLaunchContextWriter(),
    claudeInvocationDirPort: overrides.claudeInvocationDirPort ?? new FsClaudeInvocationDirPort(),
    claudeContentMaterializer: overrides.claudeContentMaterializer ?? new FsClaudeContentMaterializer(),
  };
}

/**
 * Shared `use`/`switch` flow: prepare (or switch-then-prepare) a plan,
 * show the one-time confirmation, honor `--yes` or prompt interactively,
 * then either reject or confirm+launch. Returns the process exit code.
 */
async function runLaunchFlow(
  deps: FullDeps,
  params: { readonly id: string; readonly client: ClientId; readonly yes: boolean; readonly forwardedArgs: readonly string[]; readonly mode: 'use' | 'switch' },
): Promise<number> {
  let plan: LaunchPlan;
  try {
    if (params.mode === 'switch') {
      const active = await deps.launchPlanRepository.findActiveForClient(params.client);
      if (active !== null) {
        // Whether an active plan is actually eligible to switch
        // (currently `succeeded`/`degraded`) is the domain's own call --
        // `transitionLaunchPlan`'s `switch-requested` guard inside
        // `requestConfigSwitch` -- not re-derived here, so this call site
        // can never silently diverge from that guard. A plan that is not
        // eligible surfaces as `InvalidTransitionError`, in which case we
        // fall back to preparing a plain new plan exactly as if there had
        // been no active plan at all.
        try {
          const result = await requestConfigSwitch(deps, {
            currentPlanId: active.planId,
            newRevisionId: params.id,
            client: params.client,
          });
          console.log(renderSwitchAccepted(result.previousPlan, result.newPlan));
          plan = result.newPlan;
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            plan = await prepareLaunchPlan(deps, { revisionId: params.id, client: params.client });
          } else {
            throw error;
          }
        }
      } else {
        plan = await prepareLaunchPlan(deps, { revisionId: params.id, client: params.client });
      }
    } else {
      plan = await prepareLaunchPlan(deps, { revisionId: params.id, client: params.client });
    }
  } catch (error) {
    if (error instanceof UnsupportedClientError) {
      console.log(renderUnsupportedClient(error.clientId, error.reason));
      return 1;
    }
    throw error;
  }

  if (plan.phase !== 'awaiting-confirmation') {
    // Config not found/unsupported: prepareLaunchPlan already carried the
    // plan straight to `failed` instead of throwing.
    console.log(renderLaunchFailure(plan));
    return 1;
  }

  let revision;
  try {
    revision = await getConfigRevisionDetail(deps.configRepository, plan.revisionId);
  } catch (error) {
    if (isConfigQueryError(error)) {
      console.log(renderQueryFailure(plan.revisionId, error));
      return 1;
    }
    throw error;
  }

  const knownDifferences = computeKnownDifferences(revision);
  const clientVersion = await deps.ompPort.detectVersion();
  console.log(renderConfirmationSummary(plan, revision, clientVersion, knownDifferences, params.forwardedArgs));

  const confirmed = params.yes || (await readYesNo(t('confirmation.prompt')));
  if (!confirmed) {
    const rejectedPlan = await rejectLaunchPlan(deps, plan.planId);
    console.log(renderLaunchFailure(rejectedPlan));
    return 1;
  }

  await confirmLaunchPlan(deps, plan.planId);
  // `[DELTA]` The handoff line prints from `onSpawning` -- i.e. only once
  // `launchOmp` is actually about to spawn `omp` -- not unconditionally
  // here, so a launch that fails before ever spawning (revision-lookup,
  // capability-probe) never claims a handoff that didn't happen.
  const finalPlan = await launchOmp(deps, {
    planId: plan.planId,
    extensionPath: defaultExtensionPath(),
    forwardedArgs: params.forwardedArgs,
    cwd: process.cwd(),
    onSpawning: () => console.log(renderHandoffLine()),
  });

  if (finalPlan.phase === 'succeeded' || finalPlan.phase === 'degraded') {
    const status = await getLaunchStatus(deps, finalPlan.planId, clientVersion);
    console.log(renderLaunchStatus(status));
    return 0;
  }

  console.log(renderLaunchFailure(finalPlan));
  return 1;
}

/**
 * `[Story 4.6 review fix]` Appends `ClaudeLaunchOutcome`'s failure-kind-
 * specific `recoveryAction`/`affectedCapabilities` after `renderLaunchFailure`'s
 * generic, static message -- `renderLaunchFailure(plan)` alone only ever
 * shows the fixed `failure.recovery` text (the same one OMP failures show),
 * dropping the specific guidance `launchClaudeFresh` computed for *this*
 * failure (e.g. which capability blocked it, or that a content source path
 * could not be read). Never replaces `renderLaunchFailure`'s output --
 * purely additive, and a no-op when the outcome carries neither (e.g. the
 * already-running branch's non-failure `requires-restart` outcome never
 * reaches this function at all).
 */
function renderClaudeLaunchOutcomeDetails(outcome: ClaudeLaunchOutcome): string | null {
  const lines: string[] = [];
  if (outcome.affectedCapabilities.length > 0) {
    lines.push(t('claudeFailure.affectedCapabilities', { capabilities: outcome.affectedCapabilities.join(', ') }));
  }
  if (outcome.recoveryAction !== null) {
    lines.push(t('claudeFailure.recoveryAction', { recoveryAction: outcome.recoveryAction }));
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * `[Story 4.6]` `use`/`switch --client claude-code` entrypoint. Structurally
 * mirrors `runLaunchFlow` above (prepare -> one-time confirmation ->
 * confirm+launch -> final status), but calls the Claude-specific functions
 * Story 4.3/4.4/4.5b delivered instead of `prepareLaunchPlan`/`launchOmp`,
 * and -- unlike `runLaunchFlow` -- checks `findActiveForClient` for *both*
 * `use` and `switch` (not only `switch`): a `configs use --client claude-code`
 * against an already-running Claude Code session must be recognized as
 * already-running too, not just a `switch`. This is why `params` carries no
 * `mode` -- the routing is identical for both subcommands.
 *
 * The already-running branch never asks for confirmation (Story 4.4:
 * `prepareClaudeAlreadyRunningLaunchPlan` resolves straight to the existing
 * `requires-restart` terminal phase) and is not itself a failure -- its
 * final status is shown the same way a successful fresh launch's is
 * (`getLaunchStatus`/`renderLaunchStatus`), exit code 0.
 *
 * `[Story 4.6 review fix]` `findActiveForClient` returns the most recently
 * created plan for this client *regardless of phase* (its own doc comment)
 * -- only a plan that actually reached `succeeded`/`degraded` represents a
 * real, still-running Claude Code process; a `failed`/`cancelled`/
 * `requires-restart` plan proves nothing is actually running, and must fall
 * through to a genuine fresh attempt instead of being permanently
 * misreported as already-running. Mirrors the phase check
 * `requestConfigSwitch`'s `switch-requested` transition guard already
 * enforces on the OMP side.
 */
async function runClaudeLaunchFlow(deps: FullDeps, params: { readonly id: string; readonly yes: boolean }): Promise<number> {
  const active = await deps.launchPlanRepository.findActiveForClient('claude-code');
  if (active !== null && (active.phase === 'succeeded' || active.phase === 'degraded')) {
    const outcome = await prepareClaudeAlreadyRunningLaunchPlan(deps, { revisionId: params.id });
    const clientVersion = await deps.claudeProcessPort.detectVersion();
    const status = await getLaunchStatus(deps, outcome.plan.planId, clientVersion);
    console.log(renderLaunchStatus(status));
    return 0;
  }

  const plan = await prepareClaudeFreshLaunchPlan(deps, { revisionId: params.id });
  if (plan.phase !== 'awaiting-confirmation') {
    // Config not found/unsupported: prepareClaudeFreshLaunchPlan already
    // carried the plan straight to `failed` instead of throwing.
    console.log(renderLaunchFailure(plan));
    return 1;
  }

  let revision;
  try {
    revision = await getConfigRevisionDetail(deps.configRepository, plan.revisionId);
  } catch (error) {
    if (isConfigQueryError(error)) {
      console.log(renderQueryFailure(plan.revisionId, error));
      return 1;
    }
    throw error;
  }

  // Pre-confirmation preview only: a single read-only probe+compile pass
  // (never `materializeClaudeContent` -- that only ever runs inside
  // `launchClaudeFresh`, after confirmation, bound to the real invocation
  // directory). `launchClaudeFresh` never trusts this snapshot -- it probes
  // and compiles again for real once confirmed (Design Notes).
  const probeResults = await deps.claudeCapabilityProbe.probeHardControlCapabilities();
  const previewManifestResult = compileClaudeAssemblyManifest(revision, probeResults);
  const previewDifferences =
    previewManifestResult.kind === 'blocked'
      ? previewManifestResult.missingRequiredCapabilities.map((capabilityId) => `capability-blocked: ${capabilityId}`)
      : [...previewManifestResult.manifest.degradedCapabilities];

  const clientVersion = await deps.claudeProcessPort.detectVersion();
  console.log(renderConfirmationSummary(plan, revision, clientVersion, previewDifferences, []));

  const confirmed = params.yes || (await readYesNo(t('confirmation.prompt')));
  if (!confirmed) {
    const rejectedPlan = await rejectLaunchPlan(deps, plan.planId);
    console.log(renderLaunchFailure(rejectedPlan));
    return 1;
  }

  await confirmLaunchPlan(deps, plan.planId);
  // `[DELTA]` Same handoff-line convention as `runLaunchFlow`: printed from
  // `onSpawning`, i.e. only once `launchClaudeFresh` is actually about to
  // spawn `claude`, never unconditionally here.
  const outcome = await launchClaudeFresh(deps, {
    planId: plan.planId,
    onSpawning: () => console.log(renderHandoffLine()),
  });

  if (outcome.plan.phase === 'succeeded' || outcome.plan.phase === 'degraded') {
    const status = await getLaunchStatus(deps, outcome.plan.planId, clientVersion);
    console.log(renderLaunchStatus(status));
    return 0;
  }

  const details = renderClaudeLaunchOutcomeDetails(outcome);
  console.log(details !== null ? [renderLaunchFailure(outcome.plan), details].join('\n') : renderLaunchFailure(outcome.plan));
  return 1;
}

/**
 * Non-interactive `configs establish`. Boundaries & Constraints: must
 * validate `--trigger-category`/`--evidence` (both, before reading any
 * candidate), then the stdin-TTY guard, then parse+validate the candidate
 * itself -- in exactly that order, so a missing flag on a non-interactive
 * invocation never blocks on a stdin read. Never calls `openDeps()` -- it
 * opens its own `SqliteConfigRevisionWriter` instead, since it needs
 * neither `launchPlanRepository` nor any of the OMP-launch ports that
 * `FullDeps` otherwise bundles together.
 *
 * `[Review fix]` The candidate is fully parsed+validated (`parseCandidateRevision`)
 * *before* `SqliteConfigRevisionWriter` is ever constructed -- constructing
 * it runs a migration against the real on-disk db file, so a rejected
 * candidate must never reach that point. `writer.create()` re-validates
 * the same candidate internally (cheap, and keeps the port self-sufficient
 * for any other caller), but that redundant check is never the *first*
 * time validation happens.
 */
async function runEstablish(parsed: Extract<ParsedCommand, { kind: 'establish' }>): Promise<number> {
  let writer: SqliteConfigRevisionWriter | undefined;
  try {
    const triggerCategory = parseTriggerCategory(parsed.triggerCategoryRaw);
    const evidenceRef = parseEvidenceRef(parsed.evidenceRaw);

    if (parsed.fromPath === null && isStdinTTY()) {
      throw new NoCandidateSourceError();
    }

    let rawText: string;
    try {
      rawText = parsed.fromPath !== null ? await readCandidateFile(parsed.fromPath) : await readStdinText();
    } catch (error) {
      throw new InvalidCandidateError(`candidate could not be read: ${(error as Error).message}`);
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(rawText);
    } catch (error) {
      throw new InvalidCandidateError(`candidate JSON could not be parsed: ${(error as Error).message}`);
    }

    // Validate the whole candidate before the db file is ever touched --
    // `parseCandidateRevision` throws `InvalidCandidateError` on the first
    // mismatch, and only once it returns successfully do we construct the
    // writer (which runs a migration against the real file).
    parseCandidateRevision(candidate);

    writer = new SqliteConfigRevisionWriter(defaultDbPath());
    // `[Story 3.2]` `establish` explicitly passes `null` rather than
    // relying on a default -- `EstablishConfigRevisionParams.supersedesRevisionId`
    // is a required field precisely so every call site must make this
    // choice visibly.
    const revision = await writer.create({ triggerCategory, evidenceRef, candidate, supersedesRevisionId: null });

    console.log(renderEstablishSuccess(revision));
    return 0;
  } catch (error) {
    if (
      error instanceof InvalidTriggerCategoryError ||
      error instanceof MissingEvidenceError ||
      error instanceof NoCandidateSourceError ||
      error instanceof InvalidCandidateError
    ) {
      // No parsed candidate (and therefore no `configName`) is available at
      // every failure point -- e.g. a missing trigger category fails
      // before the candidate is ever read -- so `renderQueryFailure`'s
      // label falls back to the fixed string `'establish'` rather than
      // trying to recover a `configName` that may not exist yet.
      console.log(renderQueryFailure('establish', error));
      return 1;
    }
    throw error;
  } finally {
    writer?.close();
  }
}

/**
 * `[Story 3.2]` Non-interactive `configs revise`. Same shape as
 * `runEstablish` (never calls `openDeps()`; validates before ever opening
 * any SQLite file), extended with one more validation stage: Boundaries &
 * Constraints requires trigger -> evidence -> `--supersedes` non-empty ->
 * TTY guard -> candidate read/parse, in exactly that order, so a missing
 * flag never blocks on a stdin read regardless of which flag is missing.
 *
 * The `--supersedes` target is checked twice (see the spec's Design
 * Notes): first via a read-only `SqliteConfigRevisionRepository.findById`
 * (existence + `configName` match) *before* the writer/db-file-migrating
 * `SqliteConfigRevisionWriter` is ever constructed; then again, for real,
 * inside `SqliteConfigRevisionWriter.create()`'s insert transaction, which
 * is the only check that actually closes the TOCTOU window between the
 * two (surfaced here as `SupersedesConflictError`).
 */
async function runRevise(parsed: Extract<ParsedCommand, { kind: 'revise' }>): Promise<number> {
  let repository: SqliteConfigRevisionRepository | undefined;
  let writer: SqliteConfigRevisionWriter | undefined;
  // `[Review fix]` Set once `parseCandidateRevision` has succeeded, so the
  // three post-parse errors below (`SupersedesNotFoundError`/
  // `SupersedesConfigMismatchError`/`SupersedesConflictError`) can use the
  // real `configName` as `renderQueryFailure`'s label, same as `establish`
  // would if it had a comparable post-parse failure; the five earlier
  // failures (no candidate parsed yet) keep the fixed `'revise'` fallback.
  let parsedConfigName: string | undefined;
  try {
    const triggerCategory = parseTriggerCategory(parsed.triggerCategoryRaw);
    const evidenceRef = parseEvidenceRef(parsed.evidenceRaw);
    const supersedesRevisionId = parseSupersedesRevisionId(parsed.supersedesRaw);

    if (parsed.fromPath === null && isStdinTTY()) {
      throw new NoCandidateSourceError();
    }

    let rawText: string;
    try {
      rawText = parsed.fromPath !== null ? await readCandidateFile(parsed.fromPath) : await readStdinText();
    } catch (error) {
      throw new InvalidCandidateError(`candidate could not be read: ${(error as Error).message}`);
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(rawText);
    } catch (error) {
      throw new InvalidCandidateError(`candidate JSON could not be parsed: ${(error as Error).message}`);
    }

    // Validate the whole candidate before either database file is ever
    // touched -- same reasoning as `runEstablish`.
    const parsedCandidate = parseCandidateRevision(candidate);
    parsedConfigName = parsedCandidate.configName;

    // Read-only existence/configName check -- before `SqliteConfigRevisionWriter`
    // (and therefore its migration against the real db file) is ever
    // constructed. This alone cannot close the concurrent-supersede TOCTOU
    // window -- see the doc comment above -- but it gives a precise error
    // for the common, non-concurrent case with zero writes.
    repository = new SqliteConfigRevisionRepository(defaultDbPath());
    const target = await repository.findById(supersedesRevisionId);
    if (target === null) {
      throw new SupersedesNotFoundError(supersedesRevisionId);
    }
    if (target.configName !== parsedCandidate.configName) {
      throw new SupersedesConfigMismatchError(supersedesRevisionId, parsedCandidate.configName, target.configName);
    }

    // `[Review fix]` The existence/configName check above is the only
    // reason this connection was opened -- close it immediately once that
    // check has passed, rather than holding it open (overlapping,
    // pointlessly, with `writer`'s separate connection to the same db
    // file) for the rest of this function. Nulled out so `finally` below
    // doesn't try to close it a second time.
    repository.close();
    repository = undefined;

    writer = new SqliteConfigRevisionWriter(defaultDbPath());
    const revision = await writer.create({ triggerCategory, evidenceRef, candidate, supersedesRevisionId });

    console.log(renderReviseSuccess(revision));
    return 0;
  } catch (error) {
    // `[Review fix]` `findById` (`SqliteConfigRevisionRepository.findById`'s
    // `mapRowStrict`) can throw `ConfigUnsupportedError` if the
    // `--supersedes` target row itself has an unsupported schema version
    // or corrupt capability JSON -- the same typed rejection `show`/
    // `compare` already handle via `isConfigQueryError`. Without this
    // branch that error would fall through to the unhandled `throw error`
    // below and crash the process instead of a clean exit-1 failure block.
    if (isConfigQueryError(error)) {
      console.log(renderQueryFailure(parsedConfigName ?? 'revise', error));
      return 1;
    }
    if (
      error instanceof InvalidTriggerCategoryError ||
      error instanceof MissingEvidenceError ||
      error instanceof MissingSupersedesError ||
      error instanceof NoCandidateSourceError ||
      error instanceof InvalidCandidateError
    ) {
      // No parsed candidate (and therefore no `configName`) is available at
      // any of these failure points -- e.g. a missing trigger category
      // fails before the candidate is ever read -- so the label falls back
      // to the fixed string `'revise'`, same as `establish`.
      console.log(renderQueryFailure('revise', error));
      return 1;
    }
    if (
      error instanceof SupersedesNotFoundError ||
      error instanceof SupersedesConfigMismatchError ||
      error instanceof SupersedesConflictError
    ) {
      // These three only ever occur after `parseCandidateRevision` has
      // already succeeded, so `parsedConfigName` is always set here --
      // reusing it as the label matches the spec's Design Notes (mirroring
      // `establish`'s label-fallback reasoning).
      console.log(renderQueryFailure(parsedConfigName ?? 'revise', error));
      return 1;
    }
    throw error;
  } finally {
    // `[Review fix]` Each close is best-effort and independent -- a thrown
    // `repository.close()` must never prevent `writer.close()` from also
    // running (and vice versa), or a database file handle could leak.
    try {
      repository?.close();
    } catch {
      // Best-effort only.
    }
    try {
      writer?.close();
    } catch {
      // Best-effort only.
    }
  }
}

export async function main(argv: readonly string[], overrides: CliOverrides = {}): Promise<number> {
  // `[DELTA]` IA first layer: `configs` with no subcommand at all is no
  // longer a usage error -- it prints the same usage text as a normal,
  // successful help request (exit 0). Only reached for genuinely
  // non-interactive/non-TTY zero-arg invocations -- the interactive-TTY
  // zero-arg case is intercepted before `main()` is ever called (see the
  // `import.meta.main` dispatch below), and this path never touches the
  // database.
  if (argv.length === 0) {
    console.log(usageLine());
    return 0;
  }

  // `--version` is intercepted here, before `parseCommand`/`openDeps`, so
  // it never opens the SQLite repositories or touches the database file --
  // same convention as the zero-arg/usage-error paths above and below.
  if (argv[0] === '--version') {
    console.log(CONFIGS_VERSION);
    return 0;
  }

  const parsed = parseCommand(argv);
  if (parsed.kind === 'usage-error') {
    console.error(parsed.message);
    return 2;
  }
  if (parsed.kind === 'unsupported-client') {
    console.log(renderUnsupportedClient(parsed.clientId, parsed.reason));
    return 1;
  }
  // `[DELTA]` Story 3.1: `establish` never calls `openDeps()` -- it neither
  // needs `launchPlanRepository` nor any OMP-launch port, and it must be
  // able to fail (missing trigger/evidence, TTY guard) without ever
  // opening the SQLite files those depend on.
  if (parsed.kind === 'establish') {
    return await runEstablish(parsed);
  }
  // `[Story 3.2]` `revise` also bypasses `openDeps()` for the same reason
  // -- it needs neither `launchPlanRepository` nor any OMP-launch port,
  // and must be able to fail (missing trigger/evidence/supersedes, TTY
  // guard) without opening any SQLite file at all. Unlike a pure
  // read-only command, though, `revise` *does* open its own
  // `SqliteConfigRevisionRepository`/`SqliteConfigRevisionWriter` once it
  // passes those early guards (to run `findById` and `create`) -- see
  // `runRevise`'s doc comment.
  if (parsed.kind === 'revise') {
    return await runRevise(parsed);
  }

  const deps = await openDeps(overrides);
  if (deps === null) {
    return 1;
  }

  try {
    switch (parsed.kind) {
      case 'list': {
        const revisions = await listConfigRevisions(deps.configRepository);
        console.log(renderList(revisions));
        return 0;
      }

      case 'show': {
        try {
          const revision = await getConfigRevisionDetail(deps.configRepository, parsed.id);
          // `[Story 3.3]` Appended after `renderDetail`'s existing detail
          // block, via the independent `renderSupersedesChainSection` --
          // never merged into `renderDetail` itself (Boundaries &
          // Constraints).
          const chain = await getSupersedesChain(deps.configRepository, parsed.id);
          console.log([renderDetail(revision), renderSupersedesChainSection(chain)].join('\n\n'));
          return 0;
        } catch (error) {
          if (isConfigQueryError(error)) {
            console.log(renderQueryFailure(parsed.id, error));
            return 1;
          }
          throw error;
        }
      }

      case 'compare': {
        const result = await compareConfigRevisions(deps.configRepository, parsed.ids);
        console.log(renderCompareResult(result));
        return result.resolved.length > 0 ? 0 : 1;
      }

      case 'use':
      case 'switch':
        // `[Story 4.6]` `claude-code` dispatches to its own flow -- OMP's
        // `runLaunchFlow` (and its `mode`-dependent switch-vs-use branching,
        // forwarded-args passthrough) is untouched and never reached for
        // `claude-code`.
        return parsed.client === 'claude-code'
          ? await runClaudeLaunchFlow(deps, { id: parsed.id, yes: parsed.yes })
          : await runLaunchFlow(deps, {
              id: parsed.id,
              client: parsed.client,
              yes: parsed.yes,
              forwardedArgs: parsed.forwardedArgs,
              mode: parsed.kind,
            });

      case 'status': {
        try {
          const status = await getLaunchStatus(deps, parsed.planId);
          console.log(renderLaunchStatus(status));
          return 0;
        } catch (error) {
          if (error instanceof LaunchPlanNotFoundError) {
            const target =
              parsed.planId !== null ? t('launchPlan.notFoundTargetForId', { planId: parsed.planId }) : t('launchPlan.notFoundTargetNoActive');
            console.log(t('launchPlan.notFound', { target }));
            return 1;
          }
          throw error;
        }
      }
    }
  } finally {
    deps.configRepository.close();
    deps.launchPlanRepository.close();
  }
}

// Re-exported so tests/other modules can recognize these typed errors
// without reaching into `application/launch.ts` directly.
export { InvalidTransitionError, LaunchPlanNotFoundError, StaleConfirmationError, UnsupportedClientError };

/**
 * Prints the "an update already landed" notice, if one is pending -- the
 * visible half of the background self-update flow (Issue #153). Pulled out
 * of the `import.meta.main` block below (which never runs under `bun test`,
 * see `tests/cli/version.test.ts`) so this decision has its own direct test
 * coverage instead of relying on the process entry point.
 *
 * Only prints when the pending version is the version *this* process is
 * running: the background checker replaces the binary on disk, so the
 * notice is truthful ("已更新到 vX，当前已生效") exactly once the user has
 * actually launched the replacement. A pending version that does not match
 * (the replacement happened while this older process was already running)
 * stays pending for the next launch rather than being announced early.
 *
 * Two things must still not print:
 * - `argv[0] === '--version'`: `main()` intercepts `--version` into a
 *   single bare version-number line, byte-for-byte compared by
 *   `release-configs.yml`'s smoke test (`actual="$(./dist/... --version)"`).
 *   The notice is left pending, not dropped, so the next ordinary
 *   subcommand still shows it.
 * - Printing itself can fail (e.g. `EPIPE` if stdout was already closed by
 *   the time this runs) -- caught and silently discarded right here, not
 *   left to the outer `import.meta.main` try/catch, so a failed print can
 *   never get misreported as `unexpectedFailure` and abort the command the
 *   user actually invoked. The notice is cleared regardless: a notice that
 *   could not be printed is not worth re-attempting forever.
 */
export function reportPendingSelfUpdateNotice(params: {
  readonly statePath: string;
  readonly currentVersion: string;
  readonly argv: readonly string[];
}): void {
  if (params.argv[0] === '--version') {
    return;
  }
  const state = readSelfUpdateState(params.statePath);
  if (state.pendingNoticeVersion === null || state.pendingNoticeVersion !== params.currentVersion) {
    return;
  }
  writeSelfUpdateState(params.statePath, { ...state, pendingNoticeVersion: null });
  try {
    console.log(t('selfUpdate.updated', { version: params.currentVersion }));
  } catch {
    // Best-effort only -- see doc comment above.
  }
}

/**
 * Internal argv marker for the detached background checker (Issue #153).
 * Not a user-facing subcommand: it is intercepted in the `import.meta.main`
 * block before `main()`/`runTui()` ever see it, and the only thing that
 * ever passes it is `spawnSelfUpdateWorker` below.
 */
export const SELF_UPDATE_WORKER_ARG = '--self-update-worker';

/**
 * Starts the checker as a *detached* child with all three stdio streams
 * discarded, then `unref()`s it: the foreground command neither waits for
 * it nor lets it write into its own output, and the child outlives this
 * process (verified on Windows/Bun; a plain attached child would also
 * catch the terminal's Ctrl+C).
 */
function spawnSelfUpdateWorker(): void {
  const child = spawn(process.execPath, [SELF_UPDATE_WORKER_ARG], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

/**
 * Decides whether this invocation starts a background self-update check,
 * and starts it if so. Returns whether a checker was started (for tests --
 * nothing on the foreground path cares).
 *
 * Synchronous and non-blocking by construction: it reads/writes one small
 * local file and hands the network work to a separate process. That is the
 * whole point of Issue #153 -- before, every single invocation (including
 * `configs --version`) paid for a synchronous GitHub API request, ~1s
 * typically and up to the boundary timeouts (5s metadata + 2x30s assets)
 * on a bad network, before the user's actual command started running.
 *
 * `lastCheckedAtMs` is stamped *before* spawning, so two invocations
 * racing at the cooldown boundary do not both spawn a checker; a failed
 * stamp write means the throttle would not hold, so no checker is started
 * this time (the next invocation retries).
 */
export function scheduleSelfUpdateCheck(params: {
  readonly statePath: string;
  readonly nowMs: number;
  readonly cooldownMs?: number;
  readonly spawnWorker?: () => void;
}): boolean {
  try {
    const state = readSelfUpdateState(params.statePath);
    if (!isCheckDue(state, params.nowMs, params.cooldownMs)) {
      return false;
    }
    if (!writeSelfUpdateState(params.statePath, { ...state, lastCheckedAtMs: params.nowMs })) {
      return false;
    }
    (params.spawnWorker ?? spawnSelfUpdateWorker)();
    return true;
  } catch {
    // Self-update scheduling must never affect the command the user
    // actually invoked -- same fail-closed-and-silent contract as
    // `GithubReleaseUpdater.checkAndApply` itself.
    return false;
  }
}

/**
 * The detached child's whole job: run the one check-download-verify-replace
 * pass, then record the outcome for the *next* foreground invocation to act
 * on. Prints nothing (its stdio is discarded anyway) and never throws.
 *
 * `lastCheckedAtMs` is refreshed on completion so the cooldown is measured
 * from when the check finished, not from when a possibly long download
 * started.
 */
export async function runSelfUpdateWorker(params: {
  readonly statePath: string;
  readonly currentVersion: string;
  readonly nowMs?: number;
  readonly updater?: SelfUpdatePort;
}): Promise<void> {
  try {
    const updater = params.updater ?? new GithubReleaseUpdater();
    const updatedVersion = await updater.checkAndApply(params.currentVersion);
    const state = readSelfUpdateState(params.statePath);
    writeSelfUpdateState(params.statePath, {
      lastCheckedAtMs: params.nowMs ?? Date.now(),
      pendingNoticeVersion: updatedVersion ?? state.pendingNoticeVersion,
    });
  } catch {
    // Never throws -- see doc comment above.
  }
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);

    // Story 2.2, revised by Issue #153: the self-update check no longer
    // runs inline on the foreground path. This process either *is* the
    // detached background checker (first branch), or it starts one at most
    // once per cooldown window and immediately goes on to run the user's
    // command (second branch) -- whatever the checker finds only takes
    // effect on a later launch, which was already the case before (the
    // running process keeps its already-loaded code either way).
    if (argv[0] === SELF_UPDATE_WORKER_ARG) {
      await runSelfUpdateWorker({ statePath: defaultSelfUpdateStatePath(), currentVersion: CONFIGS_VERSION });
      process.exit(0);
    }

    // Only ever against a compiled release binary -- a source/test run
    // always reports `CONFIGS_VERSION === 'dev'` and neither checks nor
    // spawns anything. `main()`/`runTui()` themselves stay unaware of
    // self-update entirely.
    if (CONFIGS_VERSION !== 'dev') {
      const statePath = defaultSelfUpdateStatePath();
      reportPendingSelfUpdateNotice({ statePath, currentVersion: CONFIGS_VERSION, argv });
      scheduleSelfUpdateCheck({ statePath, nowMs: Date.now() });
    }

    // `[DELTA]` IA first layer: zero-arg + interactive TTY (both stdin and
    // stdout) enters the TUI and never touches the pure-text dispatch
    // logic below; any explicit subcommand, or a non-interactive/non-TTY
    // zero-arg invocation, goes through `main()` exactly as before.
    const enterTui = argv.length === 0 && process.stdin.isTTY === true && process.stdout.isTTY === true;
    const exitCode = enterTui ? await runTui({}) : await main(argv);
    process.exit(exitCode);
  } catch (error) {
    console.error(t('unexpectedFailure', { message: (error as Error).message }));
    process.exit(1);
  }
}
