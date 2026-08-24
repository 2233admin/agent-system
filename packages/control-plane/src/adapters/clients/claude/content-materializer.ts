/**
 * `[Story 4.5b]` AD-21's read-only content materialization for a fresh
 * Claude Code launch: turns already-resolved `CapabilityReference.sourceRef`
 * Facts (Story 4.5b's `cap-fs.ts` fix) into real bytes written under
 * `<invocationDir>/materialized/` -- the one place this Story is allowed to
 * write inside the isolated invocation directory (never its root, which
 * doubles as `cwd`/`CLAUDE_CONFIG_DIR`).
 *
 * This module only *attempts* materialization and *reports* what happened
 * per reference -- it never decides required/optional or fail-closed vs.
 * degraded (that decision needs `ClaudeAssemblyManifest.capabilityPolicy`,
 * which this module deliberately does not import, staying a narrow,
 * independently-testable read/write primitive). `application/claude-launch.ts`
 * is the sole place that turns this result into a launch decision.
 *
 * Content never enters SQLite, a projection, a receipt or this package's
 * persisted `ClaudeAdapterPlan` (AD-6/AD-19 unchanged) -- it only ever lives
 * inside this invocation-scoped directory, which is cleaned up alongside the
 * rest of the invocation directory once the launch reaches a terminal state
 * (AD-21; see that invocation-dir cleanup's own, still-open gap noted there).
 */
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isKnown } from '../../../domain/facts';
import type { CapabilityReference, StableConfigRevision } from '../../../domain/config';

const MATERIALIZED_DIR_NAME = 'materialized';

/** One reference (by name) that could not be materialized, and why. Never a placeholder -- always a real, described gap. */
export interface ClaudeMaterializationFailure {
  readonly name: string;
  readonly reason: string;
}

export interface ClaudeMaterializedInstructions {
  /** Concatenation (in reference order) of every successfully-read instruction text; `null` when the group is empty or nothing succeeded. */
  readonly appendSystemPromptText: string | null;
  readonly failures: readonly ClaudeMaterializationFailure[];
}

export interface ClaudeMaterializedSkills {
  /** Absolute path to `materialized/plugin` once at least one skill copied successfully; `null` when the group is empty or nothing succeeded. */
  readonly pluginDirPath: string | null;
  readonly failures: readonly ClaudeMaterializationFailure[];
}

export interface ClaudeMaterializedMcp {
  /** Absolute path to `materialized/mcp.json` once at least one server resolved successfully; `null` when the group is empty or nothing succeeded. */
  readonly mcpConfigPath: string | null;
  readonly failures: readonly ClaudeMaterializationFailure[];
}

export interface ClaudeContentMaterializationResult {
  readonly instructions: ClaudeMaterializedInstructions;
  readonly skills: ClaudeMaterializedSkills;
  readonly mcp: ClaudeMaterializedMcp;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Never a path separator or a leading-dot traversal segment -- every skill gets its own real, collision-safe subdirectory name. */
function sanitizePathSegment(name: string): string {
  const cleaned = name.replace(/[\\/]+/g, '_').replace(/^\.+/, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

/** `sourceRef` resolved to a real path, or the reason it could not be (Unknown Fact -- honest, never a placeholder). */
function resolveSourcePath(reference: CapabilityReference): { readonly path: string } | { readonly reason: string } {
  if (!isKnown(reference.sourceRef)) {
    return { reason: `sourceRef 未知：${reference.sourceRef.reason}` };
  }
  return { path: reference.sourceRef.value };
}

/** AD-9's same-directory temp-file-then-rename discipline (mirrors `adapters/self-update/github-release-updater.ts`'s `replaceBinary`): no reader ever observes a half-written file. */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, filePath);
}

async function materializeInstructions(references: readonly CapabilityReference[]): Promise<ClaudeMaterializedInstructions> {
  if (references.length === 0) {
    return { appendSystemPromptText: null, failures: [] };
  }

  const failures: ClaudeMaterializationFailure[] = [];
  const texts: string[] = [];

  for (const reference of references) {
    const resolved = resolveSourcePath(reference);
    if ('reason' in resolved) {
      failures.push({ name: reference.name, reason: resolved.reason });
      continue;
    }
    try {
      texts.push(await readFile(resolved.path, 'utf8'));
    } catch (error) {
      failures.push({ name: reference.name, reason: `无法读取指令文件：${errorMessage(error)}` });
    }
  }

  return { appendSystemPromptText: texts.length > 0 ? texts.join('\n\n') : null, failures };
}

/**
 * Rebuilds `.cap`'s real, `--plugin-dir`-verified Claude plugin layout
 * (`openspec/changes/archive/2026-08-20-add-claude-cap-adapter/design-spec.md`'s
 * `native/plugin/` -- Claude's own plugin format, not a `.cap`-private
 * convention): `.claude-plugin/plugin.json` (`{name, version:"1.0.0",
 * description, skills:"./skills/"}`) plus one full directory copy per
 * successfully-resolved skill under `skills/<name>/` (the whole source
 * directory -- SKILL.md and any attachments, not just SKILL.md itself).
 */
async function materializeSkills(references: readonly CapabilityReference[], invocationDir: string): Promise<ClaudeMaterializedSkills> {
  if (references.length === 0) {
    return { pluginDirPath: null, failures: [] };
  }

  const pluginDir = path.join(invocationDir, MATERIALIZED_DIR_NAME, 'plugin');
  const skillsDir = path.join(pluginDir, 'skills');
  const failures: ClaudeMaterializationFailure[] = [];
  let anySucceeded = false;

  for (const reference of references) {
    const resolved = resolveSourcePath(reference);
    if ('reason' in resolved) {
      failures.push({ name: reference.name, reason: resolved.reason });
      continue;
    }
    const targetDir = path.join(skillsDir, sanitizePathSegment(reference.name));
    try {
      await cp(resolved.path, targetDir, { recursive: true });
      anySucceeded = true;
    } catch (error) {
      failures.push({ name: reference.name, reason: `无法复制 Skill 目录：${errorMessage(error)}` });
    }
  }

  if (!anySucceeded) {
    return { pluginDirPath: null, failures };
  }

  const pluginManifest = {
    name: 'agent-system-materialized-skills',
    version: '1.0.0',
    description: 'Agent System 本次 fresh 启动物化的 Skills（AD-21）',
    skills: './skills/',
  };
  try {
    await writeFileAtomic(path.join(pluginDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginManifest, null, 2)}\n`);
  } catch (error) {
    // The plugin manifest itself failed to write (e.g. disk full/permission
    // denied) -- the whole plugin package is unusable even though individual
    // skill directories may have copied successfully above. Report this as a
    // failure rather than letting it propagate as an uncaught exception
    // (this function must never throw -- `launchClaudeFresh` relies on that).
    failures.push({ name: '.claude-plugin/plugin.json', reason: `无法写入 plugin.json：${errorMessage(error)}` });
    return { pluginDirPath: null, failures };
  }

  return { pluginDirPath: pluginDir, failures };
}

/** Each successfully-resolved MCP reference's file content is parsed as JSON and keyed by its reference `name` under the native `mcpServers` object. */
async function materializeMcp(references: readonly CapabilityReference[], invocationDir: string): Promise<ClaudeMaterializedMcp> {
  if (references.length === 0) {
    return { mcpConfigPath: null, failures: [] };
  }

  const failures: ClaudeMaterializationFailure[] = [];
  const mcpServers: Record<string, unknown> = {};

  for (const reference of references) {
    const resolved = resolveSourcePath(reference);
    if ('reason' in resolved) {
      failures.push({ name: reference.name, reason: resolved.reason });
      continue;
    }
    try {
      const text = await readFile(resolved.path, 'utf8');
      mcpServers[reference.name] = JSON.parse(text);
    } catch (error) {
      failures.push({ name: reference.name, reason: `无法读取/解析 MCP 服务器定义：${errorMessage(error)}` });
    }
  }

  if (Object.keys(mcpServers).length === 0) {
    return { mcpConfigPath: null, failures };
  }

  const mcpConfigPath = path.join(invocationDir, MATERIALIZED_DIR_NAME, 'mcp.json');
  try {
    await writeFileAtomic(mcpConfigPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
  } catch (error) {
    // Same reasoning as `materializeSkills`'s `plugin.json` write above: never
    // let a write failure escape as an uncaught exception, even though every
    // individual MCP reference resolved/parsed successfully.
    failures.push({ name: 'mcp.json', reason: `无法写入 mcp.json：${errorMessage(error)}` });
    return { mcpConfigPath: null, failures };
  }
  return { mcpConfigPath, failures };
}

/**
 * Read-only over `revision`'s references, write-only under
 * `<invocationDir>/materialized/`. Never called before `invocationDir`
 * exists; never touches anything outside that one subdirectory.
 */
export async function materializeClaudeContent(
  revision: StableConfigRevision,
  invocationDir: string,
): Promise<ClaudeContentMaterializationResult> {
  const [instructions, skills, mcp] = await Promise.all([
    materializeInstructions(revision.instructions),
    materializeSkills(revision.skills, invocationDir),
    materializeMcp(revision.mcp, invocationDir),
  ]);
  return { instructions, skills, mcp };
}
