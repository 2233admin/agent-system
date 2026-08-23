import type { Fact } from '../domain/facts';
import type { StableConfigRevision, TriggerCategory } from '../domain/config';
import type { ClientId } from '../domain/client';
import type { LaunchPlan } from '../domain/activation';

/**
 * Read-only persistence port. Adapters implement this against whatever
 * storage backs it (SQLite in production); they must not make product
 * decisions -- e.g. "not found" is represented as `null`, and the
 * application layer is the one that turns that into a typed error.
 */
export interface ConfigRevisionRepository {
  listAll(): Promise<readonly StableConfigRevision[]>;
  findById(revisionId: string): Promise<StableConfigRevision | null>;
}

/**
 * `[Story 3.1]` Everything `create` needs besides the candidate itself.
 * `candidate` is intentionally `unknown` -- it is raw, untrusted JSON
 * (from `--from <path>` or stdin) that the adapter must validate field by
 * field (see `application/establish.ts`'s `parseCandidateRevision`)
 * before ever writing anything; a type mismatch anywhere must fail the
 * whole call with zero writes, never partially insert or silently coerce.
 *
 * `[Story 3.2]` `supersedesRevisionId` is required (not optional) so every
 * call site must make an explicit choice: `configs establish` always
 * passes `null` (it never replaces an existing revision); `configs revise`
 * passes the already-validated target revision id it is superseding.
 */
export interface EstablishConfigRevisionParams {
  readonly triggerCategory: TriggerCategory;
  readonly evidenceRef: string;
  readonly candidate: unknown;
  readonly supersedesRevisionId: string | null;
}

/**
 * `[Story 3.1]` Insert-only write port for `stable_config_revision` --
 * deliberately has no `update`/`delete` (Boundaries & Constraints: a
 * `StableConfigRevision` is immutable once established; a "new decision"
 * is always a new revision, never a mutation of an existing one).
 * `[Story 3.2]` `create` now accepts a non-null `supersedesRevisionId` too
 * (via `configs revise`); the port still only ever inserts a brand-new row
 * -- superseding never mutates the row it supersedes.
 */
export interface ConfigRevisionWriter {
  create(params: EstablishConfigRevisionParams): Promise<StableConfigRevision>;
}

/**
 * `[Story 3.1]` `--trigger-category` was omitted, or its value is not one
 * of the three known categories (AD-16/AD-21). Declared alongside the
 * other write-path ports/errors (same convention as `queries.ts`'s
 * `ConfigNotFoundError`) so `cli/render.ts`'s `renderQueryFailure` can fold
 * every `configs establish` rejection into the same closed
 * failure-rendering path used by `show`/`compare`.
 */
export class InvalidTriggerCategoryError extends Error {
  readonly kind = 'invalid-trigger-category' as const;

  constructor(readonly received: string | undefined) {
    super(
      `trigger category is missing or invalid (received: ${received ?? '(none)'}; expected one of new-scenario, known-insufficiency, bad-case)`,
    );
    this.name = 'InvalidTriggerCategoryError';
  }
}

/** `[Story 3.1]` `--evidence` was omitted or empty. */
export class MissingEvidenceError extends Error {
  readonly kind = 'missing-evidence' as const;

  constructor() {
    super('evidence reference is required and must be non-empty');
    this.name = 'MissingEvidenceError';
  }
}

/**
 * `[Story 3.1]` Neither `--from <path>` nor a non-TTY stdin was available
 * to read a candidate from -- rejected immediately rather than blocking on
 * an interactive stdin read (UX-DR2: non-interactive is a first-class
 * citizen).
 */
export class NoCandidateSourceError extends Error {
  readonly kind = 'no-candidate-source' as const;

  constructor() {
    super('no candidate source was provided: pass --from <path>, or pipe candidate JSON via stdin (stdin is a TTY)');
    this.name = 'NoCandidateSourceError';
  }
}

/**
 * `[Story 3.1]` The candidate (file/stdin content) could not be read,
 * parsed as JSON, or matched its declared field types.
 */
export class InvalidCandidateError extends Error {
  readonly kind = 'invalid-candidate' as const;

  constructor(readonly reason: string) {
    super(`candidate is invalid: ${reason}`);
    this.name = 'InvalidCandidateError';
  }
}

/** `[Story 3.2]` `configs revise`'s `--supersedes <revisionId>` was omitted or empty. */
export class MissingSupersedesError extends Error {
  readonly kind = 'missing-supersedes' as const;

  constructor() {
    super('supersedes target revision id is required and must be non-empty');
    this.name = 'MissingSupersedesError';
  }
}

/**
 * `[Story 3.2]` `--supersedes <revisionId>` does not identify any existing
 * revision (checked via a read-only `ConfigRevisionRepository.findById`
 * before the write port's transaction ever starts -- zero writes).
 */
export class SupersedesNotFoundError extends Error {
  readonly kind = 'supersedes-not-found' as const;

  constructor(readonly revisionId: string) {
    super(`supersedes target revision "${revisionId}" was not found`);
    this.name = 'SupersedesNotFoundError';
  }
}

/**
 * `[Story 3.2]` `--supersedes <revisionId>` identifies a revision that
 * exists but belongs to a different `configName` than the candidate being
 * revised -- checked before the write port's transaction ever starts (zero
 * writes).
 */
export class SupersedesConfigMismatchError extends Error {
  readonly kind = 'supersedes-config-mismatch' as const;

  constructor(
    readonly revisionId: string,
    readonly expectedConfigName: string,
    readonly actualConfigName: string,
  ) {
    super(
      `supersedes target revision "${revisionId}" belongs to configName "${actualConfigName}", but the candidate's configName is "${expectedConfigName}"`,
    );
    this.name = 'SupersedesConfigMismatchError';
  }
}

/**
 * `[Story 3.2]` The `--supersedes <revisionId>` target has already been
 * superseded by another revision -- surfaced as a typed error translated
 * from the `idx_stable_config_revision_supersedes_revision_id` unique
 * index conflict inside `SqliteConfigRevisionWriter.create()`'s insert
 * transaction (this closes the TOCTOU window a prior `findById` check
 * alone cannot close -- see Design Notes). The raw SQLite
 * `UNIQUE constraint failed` error must never escape past this
 * translation.
 */
export class SupersedesConflictError extends Error {
  readonly kind = 'supersedes-conflict' as const;

  constructor(readonly revisionId: string) {
    super(`supersedes target revision "${revisionId}" has already been superseded by another revision`);
    this.name = 'SupersedesConflictError';
  }
}

/**
 * Persistence port for `LaunchPlan`s. Like `ConfigRevisionRepository`,
 * adapters must not make product decisions -- "not found" is `null`; the
 * application layer turns that into a typed error.
 */
export interface LaunchPlanRepository {
  save(plan: LaunchPlan): Promise<void>;
  findById(planId: string): Promise<LaunchPlan | null>;
  /**
   * The most recently created plan for `client`, regardless of phase.
   * Used both to detect "is there something to switch away from" and to
   * resolve `configs status` when no explicit plan id is given.
   */
  findActiveForClient(client: ClientId): Promise<LaunchPlan | null>;
}

export interface OmpSpawnParams {
  readonly revision: StableConfigRevision;
  /** Path to the version-1 launch context JSON file (delivered to OMP via env, not argv). */
  readonly launchContextPath: string;
  /** Path to the thin status/switch extension file, or `null` to not load one. */
  readonly extensionPath: string | null;
  /** Opaque user-provided argv tail, passed through unparsed. */
  readonly forwardedArgs: readonly string[];
  readonly cwd: string;
}

export interface OmpSpawnResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

/**
 * The only way this package ever starts or inspects the OMP binary.
 * Adapters must spawn it directly via an argv array (never a shell) --
 * see Boundaries & Constraints.
 */
export interface OmpProcessPort {
  detectVersion(): Promise<Fact<string>>;
  spawn(params: OmpSpawnParams): Promise<OmpSpawnResult>;
}

export type CapabilityProbeLevel = 'supported' | 'degraded' | 'unsupported' | 'unknown';

export interface CapabilityProbeResult {
  readonly level: CapabilityProbeLevel;
  readonly reason: string;
}

/**
 * A real, one-time detection of whether OMP's *native* interface already
 * satisfies the current-configuration/launch-status viewing contract.
 * Must never be hardcoded to skip straight to "install the extension" nor
 * to claim native support without actually probing -- see Boundaries &
 * Constraints.
 */
export interface OmpCapabilityProbePort {
  probeStatusViewingCapability(): Promise<CapabilityProbeResult>;
}

/**
 * The one-time, versioned file the thin OMP extension reads on
 * `session_start` (delivered via `AGENT_SYSTEM_LAUNCH_CONTEXT`). Never a
 * vehicle for task content -- see Design Notes.
 */
export interface LaunchContext {
  readonly version: 1;
  readonly planId: string;
  readonly configName: string;
  readonly revisionId: string;
  readonly client: ClientId;
  readonly launchedAt: string;
  readonly applyResult: 'applied' | 'degraded';
  readonly knownDifferences: readonly string[];
  readonly switchEntryPointHint: string;
}

export interface LaunchContextWriter {
  /** Writes the context and returns the path it was written to. */
  write(context: LaunchContext): Promise<string>;
}

/**
 * Startup, best-effort self-update for the compiled `configs` binary
 * (Story 2.2 / AD-15's narrow self-update exception). Like every other
 * port in this file, the interface makes no product decisions -- in
 * particular `checkAndApply` must never throw: the whole
 * check/download/verify/replace chain is the adapter's responsibility to
 * fail closed on, silently, so a broken network or a corrupted download
 * never blocks or delays the command the user actually invoked.
 *
 * Returns the new version string (bare, e.g. `"1.1.0"`, no `configs-v`/`v`
 * prefix) when -- and only when -- the binary was actually replaced;
 * every other outcome (dev mode, no release, not newer, unsupported
 * platform, missing asset, checksum mismatch, or any thrown error) returns
 * `null`. The port itself makes no display decision from this value -- it
 * only reports whether/what happened; the caller (`cli/index.ts`) decides
 * whether and how to surface it.
 */
export interface SelfUpdatePort {
  checkAndApply(currentVersion: string): Promise<string | null>;
}
