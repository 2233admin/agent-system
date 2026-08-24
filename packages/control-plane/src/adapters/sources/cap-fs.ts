/**
 * Read-only adapter over a CAP-shaped directory: `manifest.toml` +
 * `profiles/*.toml` + `lock.json` (the same shape the real repo `.cap/`
 * directory used before Story 4.7 retired it). This is NOT a product CLI
 * capability -- per epics.md AR16, "configuration supply" is out of this
 * Story's scope. `configs list/show/compare` never import from this
 * module; `configs establish`/`configs revise` (Story 3.1/3.2) are the
 * supported non-interactive supply path.
 *
 * `[Story 4.7]` The real repo `.cap/` directory this loader originally read
 * has been retired (see spec-4-7-退役-cap-本体.md) -- it no longer exists on
 * disk in this repo. This module is kept because it is a generic,
 * parameterized loader over the CAP-shaped directory layout, not something
 * hardcoded to the (now-deleted) real `.cap/` path; it continues to be
 * exercised against `tests/fixtures/cap-sample/`, an equivalently-shaped
 * fixture directory, by `tests/adapters/cap-fs.test.ts` and other test
 * files in this package. `scripts/seed-from-cap.ts`, the developer-run
 * script that fed this loader with the real `.cap/` path, was deleted in
 * the same Story for the same reason.
 *
 * It never reads prompt file *contents* -- only the path string declared
 * in the profile TOML -- and it never reads credentials.
 */

import path from 'node:path';

import { type Known, known, unknown } from '../../domain/facts';
import type { CapabilityKind, CapabilityReference, SourceCategory, StableConfigRevision } from '../../domain/config';

/**
 * `[Story 3.1]` `.cap/`-materialized revisions predate the
 * `trigger_category`/`evidence_ref`/`sourceRef`/`contentFingerprint`
 * fields this Story adds -- this loader never captured (and, per AD-20,
 * is not allowed to start capturing) any real Agent-session trigger or a
 * stronger provenance pointer than `sourceCategory` already carries. These
 * are honest `Unknown` Facts, not fabricated values, for the two new
 * per-capability fields; `evidenceRef`/`triggerCategory` on the
 * revision itself are plain (non-`Fact`) NOT NULL columns, so this uses
 * the declared manifest path as real (if approximate) evidence rather
 * than inventing a value that claims more than this loader actually knows.
 *
 * `[Story 4.5b]` `contentFingerprint` remains this honest `Unknown` for
 * every capability kind -- this loader still never hashes referenced
 * content. `sourceRef` is no longer unconditionally this value: for
 * instructions and skills, this loader already knows their real on-disk
 * path (it just used to discard that knowledge -- see AD-21's blocking
 * prerequisite) and now records it as `Known`. `mcp`/`hooks`/`plugins`
 * still have no real directory convention under `.cap/capabilities/`
 * (only `skills/` exists today), so their `sourceRef` stays this same
 * honest `Unknown` -- inventing a path for them would be fabrication, not
 * a fix (Story 4.5b's `Never` boundary).
 */
const CAP_FS_FIELD_NOT_CAPTURED = unknown('not-captured-by-cap-fs-adapter', new Date(0).toISOString());

interface CapManifest {
  version: number;
  defaults?: string;
  profiles: Record<string, string>;
}

interface CapAllowDenyOverride {
  allow?: string[];
  deny?: string[];
  override?: string[];
}

interface CapProfileToml {
  version: number;
  prompt: string;
  skills?: CapAllowDenyOverride;
  mcps?: CapAllowDenyOverride;
  hooks?: CapAllowDenyOverride;
  plugins?: CapAllowDenyOverride;
}

interface CapLockProfileInventory {
  skills: string[];
  mcps: string[];
  hooks: string[];
  plugins: string[];
}

interface CapLockProfile {
  layer_digest: string;
  inventory: CapLockProfileInventory;
}

interface CapLock {
  profiles: Record<string, CapLockProfile>;
  project_skill_imports?: Array<{ name: string; source: string }>;
}

/**
 * Declared paths inside `manifest.toml` are repo-root-relative and
 * conventionally carry a leading `.cap/` (e.g. `.cap/profiles/general.toml`)
 * even though the manifest itself lives inside `.cap/`. Resolve them
 * against `capRoot` regardless of whether that prefix is present, so this
 * works unchanged against the real repo's `.cap/` and against a
 * self-contained fixture directory that omits the prefix.
 */
function resolveCapRelativePath(capRoot: string, declaredPath: string): string {
  const normalized = declaredPath.startsWith('.cap/') ? declaredPath.slice('.cap/'.length) : declaredPath;
  return path.join(capRoot, normalized);
}

async function readToml<T>(absPath: string): Promise<T> {
  const text = await Bun.file(absPath).text();
  return Bun.TOML.parse(text) as T;
}

async function readJson<T>(absPath: string): Promise<T> {
  const text = await Bun.file(absPath).text();
  return JSON.parse(text) as T;
}

/**
 * `[Story 4.5b]` The one already-known, never-invented real path for a
 * `skill` reference: an imported skill's real location is whatever
 * `.cap/lock.json`'s own `project_skill_imports[].source` already declares
 * (repo-root-relative, e.g. `plugins/grilling/skills/grilling`) -- resolved
 * against `repoRoot` (the directory `capRoot` lives in), not `capRoot`
 * itself, since imports live outside `.cap/`. A plain project skill (not an
 * import) lives at the one real, already-verified convention
 * `.cap/capabilities/skills/<name>/` (Story 4.5's parity evidence; also see
 * this repo's own `.cap/capabilities/skills/*` directories). Never a
 * speculative third path shape.
 */
function resolveSkillSourceRef(
  name: string,
  capRoot: string,
  repoRoot: string,
  importSourceByName: ReadonlyMap<string, string>,
): Known<string> {
  const importSource = importSourceByName.get(name);
  if (importSource !== undefined) {
    return known(path.join(repoRoot, importSource));
  }
  return known(resolveCapRelativePath(capRoot, `capabilities/skills/${name}`));
}

/**
 * Only ever called with a non-empty `names` array when the profile actually
 * resolved in `lock.json` (see call sites: `inventory?.skills ?? []` is `[]`
 * whenever the profile is unresolved). There is therefore no "unresolved
 * capability name" case to represent here -- an unresolved profile's
 * unavailability is already carried by its `availability: Unknown(...)`.
 *
 * `[Story 4.5b]` `sourceRef` is only ever resolved to a `Known` real path for
 * `kind === 'skill'` (see `resolveSkillSourceRef`'s Design Notes on why).
 * `mcp`/`hook`/`plugin` keep the honest `CAP_FS_FIELD_NOT_CAPTURED` --
 * `.cap/capabilities/` has no `mcp/`/`hooks/`/`plugins/` directory
 * convention today (only `skills/` is real), and inventing one would be
 * fabrication, not a fix (AD-21's `Never` boundary).
 */
function mapCapabilityNames(
  names: readonly string[],
  kind: CapabilityKind,
  importNames: ReadonlySet<string>,
  importSourceByName: ReadonlyMap<string, string>,
  capRoot: string,
  repoRoot: string,
): CapabilityReference[] {
  return names.map((name) => {
    const sourceCategory: SourceCategory = importNames.has(name) ? 'project-skill-import' : 'project-capability';
    return {
      kind,
      name,
      sourceCategory: known(sourceCategory),
      summary: known(`${kind} reference: ${name}`),
      sourceRef: kind === 'skill' ? resolveSkillSourceRef(name, capRoot, repoRoot, importSourceByName) : CAP_FS_FIELD_NOT_CAPTURED,
      contentFingerprint: CAP_FS_FIELD_NOT_CAPTURED,
    };
  });
}

function buildScopeBoundary(role: string, profile: CapProfileToml): string {
  const allow = profile.skills?.allow?.length ?? 0;
  const deny = profile.skills?.deny?.length ?? 0;
  const override = profile.skills?.override?.length ?? 0;
  return `Role \`${role}\`; prompt: ${profile.prompt}; skills allow=${allow} deny=${deny} override=${override}.`;
}

/**
 * Maps `.cap/` (or an equivalently-shaped fixture directory) into
 * immutable `StableConfigRevision[]`, one per declared profile role. Field
 * mapping is fixed by the Story's frozen Design Notes and must not diverge
 * without a human renegotiating the spec.
 */
export async function loadCapConfigRevisions(capRoot: string): Promise<StableConfigRevision[]> {
  const manifest = await readToml<CapManifest>(resolveCapRelativePath(capRoot, 'manifest.toml'));
  const lock = await readJson<CapLock>(resolveCapRelativePath(capRoot, 'lock.json'));
  const importNames = new Set((lock.project_skill_imports ?? []).map((entry) => entry.name));
  // `[Story 4.5b]` `lock.json`'s own already-declared import source paths --
  // see `resolveSkillSourceRef`'s Design Notes for why this is "already
  // known, never invented" rather than a new mapping convention.
  const importSourceByName = new Map((lock.project_skill_imports ?? []).map((entry) => [entry.name, entry.source]));
  const repoRoot = path.dirname(capRoot);
  const observedAt = new Date().toISOString();

  const revisions: StableConfigRevision[] = [];

  for (const role of Object.keys(manifest.profiles)) {
    const profilePath = manifest.profiles[role];
    if (profilePath === undefined) {
      continue;
    }
    const profile = await readToml<CapProfileToml>(resolveCapRelativePath(capRoot, profilePath));
    const lockProfile = lock.profiles[role];
    const inventory = lockProfile?.inventory;
    const resolved = inventory !== undefined;

    revisions.push({
      configName: role,
      revisionId: resolved ? lockProfile!.layer_digest : `unresolved:${role}`,
      // `manifest.defaults` (e.g. ".cap/project-defaults.toml") is a path to
      // a project-level capability-policy overlay, NOT a per-profile "this
      // role is the default/generic one" marker -- there is no such role
      // identifier anywhere in declared `.cap/` data today. Per AD-8,
      // uncertain values must never be represented as `Known(false)`; this
      // must be `Unknown` for every profile until a real signal exists.
      defaultMarker: unknown('cap-manifest-defaults-field-is-not-a-per-profile-role-marker', observedAt),
      scopeBoundary: known(buildScopeBoundary(role, profile)),
      availability: resolved ? known('resolved') : unknown('not-resolved', observedAt),
      instructions: [
        {
          kind: 'instruction',
          name: profile.prompt,
          sourceCategory: known<SourceCategory>('project-prompt'),
          summary: known(`prompt file reference: ${profile.prompt}`),
          // `[Story 4.5b]` Real, already-known path -- the same one
          // `buildScopeBoundary` above already reads to build the prompt's
          // human-readable summary text; this loader was simply discarding
          // it as a provenance pointer before now (AD-21's blocking
          // prerequisite).
          sourceRef: known(resolveCapRelativePath(capRoot, profile.prompt)),
          contentFingerprint: CAP_FS_FIELD_NOT_CAPTURED,
        },
      ],
      skills: mapCapabilityNames(inventory?.skills ?? [], 'skill', importNames, importSourceByName, capRoot, repoRoot),
      mcp: mapCapabilityNames(inventory?.mcps ?? [], 'mcp', importNames, importSourceByName, capRoot, repoRoot),
      hooks: mapCapabilityNames(inventory?.hooks ?? [], 'hook', importNames, importSourceByName, capRoot, repoRoot),
      plugins: mapCapabilityNames(inventory?.plugins ?? [], 'plugin', importNames, importSourceByName, capRoot, repoRoot),
      // `[Story 3.1]` This loader represents "the configuration as
      // currently declared in .cap/", not an Agent-session decision to
      // establish a new revision -- none of the three trigger categories
      // genuinely fit. `new-scenario` is used as the closest available
      // placeholder (never persisted through the real write path, which
      // is `configs establish`, not this dev-only loader) and the
      // declared profile path is used as the (real, if approximate)
      // evidence reference.
      triggerCategory: 'new-scenario',
      evidenceRef: profilePath,
      supersedesRevisionId: null,
    });
  }

  return revisions;
}
