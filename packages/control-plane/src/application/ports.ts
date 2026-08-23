import type { Fact } from '../domain/facts';
import type { StableConfigRevision } from '../domain/config';
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
 * The three allowed reasons a low-frequency configuration establish/revise
 * command may write a new revision (AD-16/AD-21). Merely discovering an
 * asset, its historical existence, or technical feasibility is never a
 * valid trigger on its own.
 */
export type TriggerCategory = 'new-scenario' | 'known-insufficiency' | 'bad-case';

export const TRIGGER_CATEGORIES: readonly TriggerCategory[] = ['new-scenario', 'known-insufficiency', 'bad-case'];

/**
 * The compound value `create` takes as its `trigger` argument (AD-21's
 * `SUPPLY_TRIGGER`) -- category and evidence reference are packed together,
 * never passed as two independent parameters. Typed as raw strings (not
 * `TriggerCategory`) because this is unvalidated input arriving from the
 * CLI/an Agent; `create` is what validates and rejects it.
 */
export interface RevisionTriggerInput {
  readonly category: string;
  readonly evidenceRef: string;
}

/**
 * Everything `create` needs to persist a new revision except the id (which
 * the port generates) and `supersedesRevisionId` (which is supplied
 * separately as `create`'s own `supersedes` argument -- AD-21: the caller
 * declares it explicitly, the port never infers "latest revision").
 */
export type NewConfigRevisionInput = Omit<StableConfigRevision, 'revisionId' | 'supersedesRevisionId'>;

/**
 * The declared trigger category was missing or was not one of
 * `TRIGGER_CATEGORIES`. AD-16/AD-21: `create` must reject the entire write
 * rather than persist a partial/guessed record.
 */
export class InvalidTriggerCategoryError extends Error {
  readonly kind = 'invalid-trigger-category' as const;

  constructor(readonly received: string) {
    super(`invalid or missing trigger category: "${received}" (must be one of: ${TRIGGER_CATEGORIES.join(', ')})`);
    this.name = 'InvalidTriggerCategoryError';
  }
}

/** The evidence reference was missing or empty. AD-16/AD-21. */
export class MissingEvidenceError extends Error {
  readonly kind = 'missing-evidence' as const;

  constructor() {
    super('evidence reference is required and must not be empty');
    this.name = 'MissingEvidenceError';
  }
}

/**
 * The candidate JSON supplied to `configs establish` (via `--from`/stdin)
 * did not match the shape `create` requires. Thrown by the CLI's own
 * parsing step -- not by the write port itself -- but declared alongside
 * the port's other typed rejections so `cli/render.ts` can fold all three
 * into the same closed failure-rendering path.
 */
export class InvalidCandidateError extends Error {
  readonly kind = 'invalid-candidate' as const;

  constructor(readonly reason: string) {
    super(`invalid candidate content: ${reason}`);
    this.name = 'InvalidCandidateError';
  }
}

/**
 * Insert-only write port for `StableConfigRevision`s (AD-21), deliberately
 * separate from the read-only `ConfigRevisionRepository`. Only `create`
 * exists -- no update/delete method -- so revision immutability is
 * guaranteed by the interface shape, not just by a runtime check. `create`
 * validates trigger/evidence and generates `revisionId` itself (never
 * trusting a caller-supplied id) atomically with the insert; `supersedes`
 * is the caller's own explicit declaration (`null` for a new configuration).
 */
export interface ConfigRevisionWriter {
  create(
    revision: NewConfigRevisionInput,
    trigger: RevisionTriggerInput,
    supersedes: string | null,
  ): Promise<StableConfigRevision>;
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
 */
export interface SelfUpdatePort {
  checkAndApply(currentVersion: string): Promise<void>;
}
