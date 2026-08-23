import { isKnown } from '../../../domain/facts';
import type { CapabilityReference, StableConfigRevision } from '../../../domain/config';
import type { ClaudeCapabilityProbeResult } from '../../../application/ports';

/**
 * `[Story 4.2]` A relevant hard-control capability's judgment as it appears
 * on a compiled plan -- carried through unclipped from Story 4.1's
 * `ClaudeCapabilityProbeResult` (same shape, same fields, including
 * `evidenceRef`/`observedAt`). Aliased under its own name here rather than
 * reused bare so a reader of `ClaudeAdapterPlan` sees this is a plan-facing
 * concept, without implying a second, independently-evolving type.
 */
export type ClaudeAdapterPlanCapabilityNote = ClaudeCapabilityProbeResult;

/**
 * `[Story 4.2]` A confirmed AC1/AC2 outcome: this assembly intent could be
 * compiled against the probed hard-control surface. Only the fields the
 * Boundaries & Constraints allow: `client`/`revisionId`/`configName`, the
 * *relevant* capabilities' policy notes, the three typed reference groups
 * (`instructions`/`skills`/`mcp` -- direct, uncopied references from the
 * source `StableConfigRevision`), the overall `planStatus`, which
 * capabilities caused that degradation, and a deterministic `planHash`.
 * Deliberately no `hooks`/`plugins` reference fields, no argv/env/secret
 * fields (that is Story 4.3/4.4's `launch` territory) and no
 * candidate/score/recommendation field (SPEC.md CAP-1).
 */
export interface ClaudeAdapterPlan {
  readonly client: 'claude-code';
  readonly revisionId: string;
  readonly configName: string;
  readonly capabilityPolicy: readonly ClaudeAdapterPlanCapabilityNote[];
  readonly instructions: readonly CapabilityReference[];
  readonly skills: readonly CapabilityReference[];
  readonly mcp: readonly CapabilityReference[];
  readonly planStatus: 'ready' | 'degraded';
  /** `capabilityId`s of every relevant capability that pushed `planStatus` to `'degraded'`. */
  readonly degradedCapabilities: readonly string[];
  readonly planHash: string;
}

/**
 * `[Story 4.2]` AD-10 fail-closed outcome: a relevant, `required` capability
 * was not `supported`/`degraded` -- no plan, no hash, nothing usable is
 * produced. `missingRequiredCapabilities` names every relevant capability
 * that caused the block (there can be more than one).
 */
export interface ClaudeAdapterPlanBlocked {
  readonly kind: 'blocked';
  readonly client: 'claude-code';
  readonly revisionId: string;
  readonly configName: string;
  readonly missingRequiredCapabilities: readonly string[];
}

export type ClaudeAdapterPlanResult =
  | { readonly kind: 'compiled'; readonly plan: ClaudeAdapterPlan }
  | ClaudeAdapterPlanBlocked;

interface CapabilityRelevanceRule {
  readonly capabilityId: string;
  /** Whether this capability is relevant to `revision` at all -- see Boundaries & Constraints. */
  readonly isRelevant: (revision: StableConfigRevision) => boolean;
}

/**
 * `claude.permission-mode-control` is always relevant (baseline -- every
 * assembly is bound by a permission mode); the other three are only
 * relevant when the assembly intent actually references the corresponding
 * asset kind. `claude.hook-deny-return-value` is `required: false` on every
 * probe result (Story 4.1) but is still only *evaluated* when hooks are
 * referenced at all -- an assembly with no hooks must never be penalized
 * for an unrelated capability's status.
 */
const CAPABILITY_RELEVANCE_RULES: readonly CapabilityRelevanceRule[] = [
  { capabilityId: 'claude.permission-mode-control', isRelevant: () => true },
  { capabilityId: 'claude.mcp-project-scope-control', isRelevant: (revision) => revision.mcp.length > 0 },
  { capabilityId: 'claude.setting-sources-control', isRelevant: (revision) => revision.skills.length > 0 },
  { capabilityId: 'claude.hook-deny-return-value', isRelevant: (revision) => revision.hooks.length > 0 },
];

/**
 * Defensive-only branch (Boundaries & Constraints): a relevant capability
 * absent from `probeResults` should never happen under
 * `BunClaudeCapabilityProbe`'s real output (it always returns all four),
 * but if it does, this must resolve to the most conservative judgment
 * (`required: true, status: 'unknown'`) rather than silently defaulting to
 * `supported`.
 */
function resolveCapabilityNote(
  probeResults: readonly ClaudeCapabilityProbeResult[],
  capabilityId: string,
): ClaudeAdapterPlanCapabilityNote {
  const found = probeResults.find((result) => result.capabilityId === capabilityId);
  if (found !== undefined) {
    return found;
  }
  return {
    capabilityId,
    subject: `(缺失) probe 结果未包含此相关 capability：${capabilityId}`,
    required: true,
    status: 'unknown',
    validationMethod: 'mechanical',
    evidenceRef: `probe 结果里找不到相关 capabilityId "${capabilityId}"，按最保守方式处理为 required:true, status:'unknown'，绝不默认为 supported`,
    observedAt: new Date().toISOString(),
  };
}

/** `(kind, name, sourceCategory 已知值或 unknown 原因)` -- never the reference's content-bearing fields. */
function referenceSignature(reference: CapabilityReference): string {
  const category = isKnown(reference.sourceCategory)
    ? reference.sourceCategory.value
    : `unknown:${reference.sourceCategory.reason}`;
  return `${reference.kind}:${reference.name}:${category}`;
}

/**
 * A local, deterministic, non-cryptographic hash in the same style as
 * `domain/activation.ts`'s `computePlanHash` (`Math.imul(31, hash) +
 * charCode`), but over a different input shape -- see that file's Design
 * Notes precedent and this Story's Code Map for why this is a separate
 * function rather than a shared signature. Deliberately excludes
 * `evidenceRef`/`observedAt` (volatile, per-probe-run evidence text/
 * timestamps) so two compilations of the same assembly intent against two
 * different real probe runs -- same capability states, different evidence
 * text -- produce the same hash.
 */
function computeClaudeAdapterPlanHash(
  revision: StableConfigRevision,
  capabilityPolicy: readonly ClaudeAdapterPlanCapabilityNote[],
): string {
  const capabilitySignature = capabilityPolicy
    .map((note) => `${note.capabilityId}=${note.required}=${note.status}`)
    .sort()
    .join(';');
  // Sorted (not insertion-order) for the same reason `capabilitySignature`
  // is sorted: two loads of the same assembly intent that happen to
  // enumerate the same reference set in a different order (e.g. a
  // regenerated `lock.json` with different key/array order) must still
  // hash identically -- AC1's "same input -> same hash" is about the
  // *set* of references an assembly intent expresses, not their incidental
  // array order.
  const instructionsSignature = revision.instructions.map(referenceSignature).sort().join(',');
  const skillsSignature = revision.skills.map(referenceSignature).sort().join(',');
  const mcpSignature = revision.mcp.map(referenceSignature).sort().join(',');

  const input = [
    revision.revisionId,
    'claude-code',
    capabilitySignature,
    instructionsSignature,
    skillsSignature,
    mcpSignature,
  ].join('||');

  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return `caph_${(hash >>> 0).toString(16)}`;
}

/**
 * `[Story 4.2]` Pure compilation of an already-loaded assembly intent
 * (`revision`, e.g. from `loadCapConfigRevisions`) plus Story 4.1's probe
 * evidence (`probeResults`) into a `ClaudeAdapterPlan`. Zero IO: does not
 * itself probe, read `.cap/`, or touch Bun/the filesystem/the process
 * environment -- both inputs must already be loaded by the caller.
 *
 * Relevance is decided first (does this assembly intent actually reference
 * the asset kind this capability governs), then fail-closed classification
 * runs only over the relevant subset (AD-10): `supported` has no effect;
 * `degraded` always lands in `degradedCapabilities`; `unsupported`/`unknown`
 * blocks the whole plan when `required`, otherwise also lands in
 * `degradedCapabilities`. Any relevant required capability blocking is
 * sufficient to block the entire plan -- no hash or plan is produced in
 * that case.
 */
export function compileClaudeAdapterPlan(
  revision: StableConfigRevision,
  probeResults: readonly ClaudeCapabilityProbeResult[],
): ClaudeAdapterPlanResult {
  const relevantRules = CAPABILITY_RELEVANCE_RULES.filter((rule) => rule.isRelevant(revision));
  const capabilityPolicy = relevantRules.map((rule) => resolveCapabilityNote(probeResults, rule.capabilityId));

  const missingRequiredCapabilities: string[] = [];
  const degradedCapabilities: string[] = [];

  for (const note of capabilityPolicy) {
    if (note.status === 'supported') {
      continue;
    }
    if (note.status === 'degraded') {
      degradedCapabilities.push(note.capabilityId);
      continue;
    }
    // note.status is 'unsupported' | 'unknown' here.
    if (note.required) {
      missingRequiredCapabilities.push(note.capabilityId);
    } else {
      degradedCapabilities.push(note.capabilityId);
    }
  }

  if (missingRequiredCapabilities.length > 0) {
    return {
      kind: 'blocked',
      client: 'claude-code',
      revisionId: revision.revisionId,
      configName: revision.configName,
      missingRequiredCapabilities,
    };
  }

  const plan: ClaudeAdapterPlan = {
    client: 'claude-code',
    revisionId: revision.revisionId,
    configName: revision.configName,
    capabilityPolicy,
    instructions: revision.instructions,
    skills: revision.skills,
    mcp: revision.mcp,
    planStatus: degradedCapabilities.length > 0 ? 'degraded' : 'ready',
    degradedCapabilities,
    planHash: computeClaudeAdapterPlanHash(revision, capabilityPolicy),
  };

  return { kind: 'compiled', plan };
}
