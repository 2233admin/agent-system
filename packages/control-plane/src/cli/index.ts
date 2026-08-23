#!/usr/bin/env bun
/**
 * `configs` CLI entry point. Dispatches the read-only subcommands from
 * Story 1.1 (`list`, `show <id>`, `compare <id...>`), Story 1.2's
 * activation subcommands (`use <id>`, `status [<planId>]`, `switch <id>`),
 * and Story 3.1's non-interactive write subcommand
 * (`establish --trigger-category <cat> --evidence <ref> [--from <path>]`).
 * No other subcommand exists -- in particular there is no `configs sync`/
 * `configs import` (see `src/adapters/sources/cap-fs.ts` for why).
 */

import type { ClientId } from '../domain/client';
import { resolveClientSupport } from '../domain/client';
import type { LaunchPlan } from '../domain/activation';
import { SqliteConfigRevisionRepository } from '../adapters/sqlite/repository';
import { SqliteConfigRevisionWriter } from '../adapters/sqlite/config-revision-writer';
import { SqliteLaunchPlanRepository } from '../adapters/sqlite/launch-repository';
import { BunOmpProcessPort, defaultExtensionPath, findDenylistedForwardedArg } from '../adapters/omp/process-port';
import { BunOmpCapabilityProbe } from '../adapters/omp/capability-probe';
import { FsLaunchContextWriter } from '../adapters/launch-context/fs-launch-context-writer';
import { GithubReleaseUpdater } from '../adapters/self-update/github-release-updater';
import type { ConfigRevisionRepository, LaunchPlanRepository, OmpCapabilityProbePort, OmpProcessPort, LaunchContextWriter } from '../application/ports';
import {
  ConfigNotFoundError,
  ConfigUnsupportedError,
  compareConfigRevisions,
  getConfigRevisionDetail,
  listConfigRevisions,
  type ConfigQueryError,
} from '../application/queries';
import {
  InvalidCandidateError,
  InvalidTriggerCategoryError,
  MissingEvidenceError,
  NoCandidateSourceError,
  parseCandidateRevision,
  parseEvidenceRef,
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
import { readYesNo } from './confirm-prompt';
import { defaultDbPath } from './db-path';
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
  'configs <list|show <id>|compare <id> <id> [...ids]|use <id> [--client <id>] [--yes] [-- ...args]|status [<planId>]|switch <id> [--client <id>] [--yes] [-- ...args]|establish --trigger-category <cat> --evidence <ref> [--from <path>]>';

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

  // Rejected here -- before any repository is opened, any plan is created
  // or `omp` is spawned -- because a forwarded `-e`/`--extension`,
  // `--profile`, `-c`/`--continue`, `-r`/`--resume` or `--session-dir`
  // would defeat this Story's single-extension-source/isolated-profile/
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

export interface FullDeps extends LaunchDeps {
  readonly configRepository: ClosableConfigRevisionRepository;
  readonly launchPlanRepository: ClosableLaunchPlanRepository;
  readonly ompPort: OmpProcessPort;
  readonly capabilityProbe: OmpCapabilityProbePort;
  readonly contextWriter: LaunchContextWriter;
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

  return {
    configRepository,
    launchPlanRepository,
    ompPort: overrides.ompPort ?? new BunOmpProcessPort(),
    capabilityProbe: overrides.capabilityProbe ?? new BunOmpCapabilityProbe(),
    contextWriter: overrides.contextWriter ?? new FsLaunchContextWriter(),
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
    const status = await getLaunchStatus(deps, finalPlan.planId);
    console.log(renderLaunchStatus(status));
    return 0;
  }

  console.log(renderLaunchFailure(finalPlan));
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
    const revision = await writer.create({ triggerCategory, evidenceRef, candidate });

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
          console.log(renderDetail(revision));
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
        return await runLaunchFlow(deps, {
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

if (import.meta.main) {
  try {
    // Story 2.2: a one-time, inline, best-effort self-update check --
    // only ever runs against a compiled release binary (never a source/
    // test run, which always reports `CONFIGS_VERSION === 'dev'`), and
    // never throws or produces output (`GithubReleaseUpdater.
    // checkAndApply`'s own top-level try/catch). `main()`/`runTui()`
    // themselves stay unaware of self-update entirely.
    if (CONFIGS_VERSION !== 'dev') {
      await new GithubReleaseUpdater().checkAndApply(CONFIGS_VERSION);
    }

    const argv = process.argv.slice(2);
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
