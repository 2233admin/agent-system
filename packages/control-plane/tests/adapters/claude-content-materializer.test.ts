import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { materializeClaudeContent } from '../../src/adapters/clients/claude/content-materializer';
import type { CapabilityReference } from '../../src/domain/config';
import { known, unknown } from '../../src/domain/facts';

let sourceDir: string;
let invocationDir: string;

beforeEach(() => {
  sourceDir = mkdtempSync(path.join(os.tmpdir(), 'control-plane-claude-materializer-src-'));
  invocationDir = mkdtempSync(path.join(os.tmpdir(), 'control-plane-claude-materializer-inv-'));
});

afterEach(() => {
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(invocationDir, { recursive: true, force: true });
});

function ref(kind: CapabilityReference['kind'], name: string, sourceRef: CapabilityReference['sourceRef']): CapabilityReference {
  return {
    kind,
    name,
    sourceCategory: known('project-capability'),
    summary: known(`${kind}: ${name}`),
    sourceRef,
    contentFingerprint: unknown('not-captured-by-cap-fs-adapter', new Date(0).toISOString()),
  };
}

function writeRealSkillDir(name: string, files: Record<string, string>): string {
  const dir = path.join(sourceDir, 'skills', name);
  mkdirSync(dir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(dir, fileName);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  return dir;
}

function writeRealFile(name: string, content: string): string {
  const filePath = path.join(sourceDir, name);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('materializeClaudeContent', () => {
  test('empty revision (no references at all): every group is null with zero failures, nothing written', async () => {
    const result = await materializeClaudeContent(
      {
        configName: 'general',
        revisionId: 'rev-empty',
        defaultMarker: known(false),
        scopeBoundary: known('scope'),
        availability: known('resolved'),
        instructions: [],
        skills: [],
        mcp: [],
        hooks: [],
        plugins: [],
        triggerCategory: 'new-scenario',
        evidenceRef: 'test',
        supersedesRevisionId: null,
      },
      invocationDir,
    );

    expect(result.instructions).toEqual({ appendSystemPromptText: null, failures: [] });
    expect(result.skills).toEqual({ pluginDirPath: null, failures: [] });
    expect(result.mcp).toEqual({ mcpConfigPath: null, failures: [] });
    expect(existsSync(path.join(invocationDir, 'materialized'))).toBe(false);
  });

  test('instructions: a real, readable sourceRef is read out verbatim and never written to disk', async () => {
    const promptPath = writeRealFile('general.md', '# General role prompt\n\nBe helpful.');
    const result = await materializeClaudeContent(
      revisionWith({ instructions: [ref('instruction', 'general.md', known(promptPath))] }),
      invocationDir,
    );

    expect(result.instructions.failures).toEqual([]);
    expect(result.instructions.appendSystemPromptText).toBe('# General role prompt\n\nBe helpful.');
    // Instructions text is handed back as a value, never written under materialized/.
    expect(existsSync(path.join(invocationDir, 'materialized'))).toBe(false);
  });

  test('instructions: multiple references concatenate in order, separated by a blank line', async () => {
    const p1 = writeRealFile('a.md', 'first');
    const p2 = writeRealFile('b.md', 'second');
    const result = await materializeClaudeContent(
      revisionWith({ instructions: [ref('instruction', 'a.md', known(p1)), ref('instruction', 'b.md', known(p2))] }),
      invocationDir,
    );

    expect(result.instructions.appendSystemPromptText).toBe('first\n\nsecond');
    expect(result.instructions.failures).toEqual([]);
  });

  test('instructions: Unknown sourceRef is reported as a failure, never a placeholder', async () => {
    const result = await materializeClaudeContent(
      revisionWith({ instructions: [ref('instruction', 'missing.md', unknown('not-captured-by-cap-fs-adapter', '2026-01-01T00:00:00Z'))] }),
      invocationDir,
    );

    expect(result.instructions.appendSystemPromptText).toBeNull();
    expect(result.instructions.failures).toHaveLength(1);
    expect(result.instructions.failures[0]!.name).toBe('missing.md');
    expect(result.instructions.failures[0]!.reason).toContain('sourceRef');
  });

  test('instructions: a Known sourceRef pointing at a file that does not exist on disk is reported as a failure', async () => {
    const result = await materializeClaudeContent(
      revisionWith({ instructions: [ref('instruction', 'ghost.md', known(path.join(sourceDir, 'does-not-exist.md')))] }),
      invocationDir,
    );

    expect(result.instructions.appendSystemPromptText).toBeNull();
    expect(result.instructions.failures).toHaveLength(1);
    expect(result.instructions.failures[0]!.name).toBe('ghost.md');
  });

  test('skills: a real, readable sourceRef directory is fully copied under materialized/plugin/skills/<name>/, and .claude-plugin/plugin.json is written', async () => {
    const skillDir = writeRealSkillDir('openspec-explore', { 'SKILL.md': '# openspec-explore\n\nDo the thing.' });
    const result = await materializeClaudeContent(revisionWith({ skills: [ref('skill', 'openspec-explore', known(skillDir))] }), invocationDir);

    expect(result.skills.failures).toEqual([]);
    expect(result.skills.pluginDirPath).toBe(path.join(invocationDir, 'materialized', 'plugin'));

    const copiedSkillMd = path.join(invocationDir, 'materialized', 'plugin', 'skills', 'openspec-explore', 'SKILL.md');
    expect(existsSync(copiedSkillMd)).toBe(true);
    expect(readFileSync(copiedSkillMd, 'utf8')).toBe('# openspec-explore\n\nDo the thing.');

    const pluginJsonPath = path.join(invocationDir, 'materialized', 'plugin', '.claude-plugin', 'plugin.json');
    expect(existsSync(pluginJsonPath)).toBe(true);
    const pluginManifest = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
    expect(pluginManifest).toEqual({
      name: 'agent-system-materialized-skills',
      version: '1.0.0',
      description: expect.any(String),
      skills: './skills/',
    });
  });

  test('skills: copies the whole source directory (attachments alongside SKILL.md), not just SKILL.md', async () => {
    const skillDir = writeRealSkillDir('grilling', {
      'SKILL.md': '# grilling',
      'agents/openai.yaml': 'name: grilling',
    });
    const result = await materializeClaudeContent(revisionWith({ skills: [ref('skill', 'grilling', known(skillDir))] }), invocationDir);

    expect(result.skills.failures).toEqual([]);
    const attachmentPath = path.join(invocationDir, 'materialized', 'plugin', 'skills', 'grilling', 'agents', 'openai.yaml');
    expect(existsSync(attachmentPath)).toBe(true);
    expect(readFileSync(attachmentPath, 'utf8')).toBe('name: grilling');
  });

  test('[patch] skills: plugin.json write failure (a colliding file blocks .claude-plugin/) is reported as a failure, never thrown', async () => {
    const skillDir = writeRealSkillDir('openspec-explore', { 'SKILL.md': 'real content' });
    // Pre-create `materialized/plugin/.claude-plugin` as a plain *file* --
    // the skill copy itself (a sibling `skills/<name>/` subtree) still
    // succeeds, but the subsequent `mkdir(.../.claude-plugin, {recursive})`
    // for `plugin.json` fails because that exact path already exists as a
    // non-directory.
    mkdirSync(path.join(invocationDir, 'materialized', 'plugin'), { recursive: true });
    writeFileSync(path.join(invocationDir, 'materialized', 'plugin', '.claude-plugin'), 'not a directory', 'utf8');

    const result = await materializeClaudeContent(
      revisionWith({ skills: [ref('skill', 'openspec-explore', known(skillDir))] }),
      invocationDir,
    );

    // The skill directory itself really did copy...
    expect(existsSync(path.join(invocationDir, 'materialized', 'plugin', 'skills', 'openspec-explore', 'SKILL.md'))).toBe(true);
    // ...but the whole plugin package is reported unusable (no plugin.json
    // manifest, no `--plugin-dir` delivery) rather than silently succeeding
    // with an incomplete package or throwing an uncaught exception.
    expect(result.skills.pluginDirPath).toBeNull();
    expect(result.skills.failures.some((f) => f.name === '.claude-plugin/plugin.json')).toBe(true);
  });

  test('skills: multiple references, one Unknown sourceRef -- the resolvable one still materializes, the failure is reported, no placeholder content is fabricated', async () => {
    const skillDir = writeRealSkillDir('openspec-explore', { 'SKILL.md': 'real content' });
    const result = await materializeClaudeContent(
      revisionWith({
        skills: [
          ref('skill', 'openspec-explore', known(skillDir)),
          ref('skill', 'ghost-skill', unknown('not-captured-by-cap-fs-adapter', '2026-01-01T00:00:00Z')),
        ],
      }),
      invocationDir,
    );

    expect(result.skills.pluginDirPath).toBe(path.join(invocationDir, 'materialized', 'plugin'));
    expect(result.skills.failures).toHaveLength(1);
    expect(result.skills.failures[0]!.name).toBe('ghost-skill');
    expect(existsSync(path.join(invocationDir, 'materialized', 'plugin', 'skills', 'openspec-explore', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(invocationDir, 'materialized', 'plugin', 'skills', 'ghost-skill'))).toBe(false);
  });

  test('skills: every reference unresolvable -- pluginDirPath stays null, nothing is written under materialized/', async () => {
    const result = await materializeClaudeContent(
      revisionWith({ skills: [ref('skill', 'ghost-skill', unknown('not-captured-by-cap-fs-adapter', '2026-01-01T00:00:00Z'))] }),
      invocationDir,
    );

    expect(result.skills.pluginDirPath).toBeNull();
    expect(result.skills.failures).toHaveLength(1);
    expect(existsSync(path.join(invocationDir, 'materialized', 'plugin', '.claude-plugin', 'plugin.json'))).toBe(false);
  });

  test('skills: a name containing path separators is sanitized into a single safe path segment, never escaping skills/', async () => {
    const skillDir = writeRealSkillDir('weird', { 'SKILL.md': 'x' });
    const result = await materializeClaudeContent(
      revisionWith({ skills: [ref('skill', '../../escape', known(skillDir))] }),
      invocationDir,
    );

    expect(result.skills.failures).toEqual([]);
    const skillsRoot = path.join(invocationDir, 'materialized', 'plugin', 'skills');
    const entries = readdirSync(skillsRoot);
    for (const entry of entries) {
      expect(path.resolve(skillsRoot, entry).startsWith(path.resolve(skillsRoot))).toBe(true);
    }
  });

  test('mcp: a real, readable sourceRef JSON file is parsed and keyed by reference name under mcpServers, written to materialized/mcp.json', async () => {
    const mcpDefPath = writeRealFile('some-mcp.json', JSON.stringify({ command: 'node', args: ['server.js'] }));
    const result = await materializeClaudeContent(revisionWith({ mcp: [ref('mcp', 'some-mcp', known(mcpDefPath))] }), invocationDir);

    expect(result.mcp.failures).toEqual([]);
    expect(result.mcp.mcpConfigPath).toBe(path.join(invocationDir, 'materialized', 'mcp.json'));
    const written = JSON.parse(readFileSync(result.mcp.mcpConfigPath!, 'utf8'));
    expect(written).toEqual({ mcpServers: { 'some-mcp': { command: 'node', args: ['server.js'] } } });
  });

  test('[patch] mcp: mcp.json write failure (a colliding file blocks materialized/) is reported as a failure, never thrown', async () => {
    const mcpDefPath = writeRealFile('some-mcp.json', JSON.stringify({ command: 'node', args: ['server.js'] }));
    // Pre-create `materialized` itself as a plain *file* -- every MCP
    // reference resolves/parses fine (no fs write happens until the final
    // `mcp.json` write), but that final write's own
    // `mkdir(materialized/, {recursive})` fails because `materialized`
    // already exists as a non-directory.
    writeFileSync(path.join(invocationDir, 'materialized'), 'not a directory', 'utf8');

    const result = await materializeClaudeContent(revisionWith({ mcp: [ref('mcp', 'some-mcp', known(mcpDefPath))] }), invocationDir);

    expect(result.mcp.mcpConfigPath).toBeNull();
    expect(result.mcp.failures.some((f) => f.name === 'mcp.json')).toBe(true);
  });

  test('mcp: Unknown sourceRef (today\'s real .cap/ state -- cap-fs.ts never resolves mcp sourceRef) is reported as a failure, mcpConfigPath stays null', async () => {
    const result = await materializeClaudeContent(
      revisionWith({ mcp: [ref('mcp', 'some-mcp', unknown('not-captured-by-cap-fs-adapter', '2026-01-01T00:00:00Z'))] }),
      invocationDir,
    );

    expect(result.mcp.mcpConfigPath).toBeNull();
    expect(result.mcp.failures).toHaveLength(1);
    expect(result.mcp.failures[0]!.name).toBe('some-mcp');
    expect(existsSync(path.join(invocationDir, 'materialized', 'mcp.json'))).toBe(false);
  });

  test('mcp: a real file that is not valid JSON is reported as a failure, not silently skipped', async () => {
    const badPath = writeRealFile('bad-mcp.json', 'not json{{{');
    const result = await materializeClaudeContent(revisionWith({ mcp: [ref('mcp', 'bad-mcp', known(badPath))] }), invocationDir);

    expect(result.mcp.mcpConfigPath).toBeNull();
    expect(result.mcp.failures).toHaveLength(1);
    expect(result.mcp.failures[0]!.name).toBe('bad-mcp');
  });

  test('never writes anything at the invocation directory root -- only ever under materialized/', async () => {
    const skillDir = writeRealSkillDir('openspec-explore', { 'SKILL.md': 'x' });
    const promptPath = writeRealFile('general.md', 'prompt text');
    await materializeClaudeContent(
      revisionWith({
        instructions: [ref('instruction', 'general.md', known(promptPath))],
        skills: [ref('skill', 'openspec-explore', known(skillDir))],
      }),
      invocationDir,
    );

    const rootEntries = readdirSync(invocationDir);
    expect(rootEntries).toEqual(['materialized']);
  });
});

function revisionWith(overrides: {
  instructions?: CapabilityReference[];
  skills?: CapabilityReference[];
  mcp?: CapabilityReference[];
}) {
  return {
    configName: 'general',
    revisionId: 'rev-1',
    defaultMarker: known(false),
    scopeBoundary: known('scope'),
    availability: known('resolved' as const),
    instructions: overrides.instructions ?? [],
    skills: overrides.skills ?? [],
    mcp: overrides.mcp ?? [],
    hooks: [],
    plugins: [],
    triggerCategory: 'new-scenario' as const,
    evidenceRef: 'test',
    supersedesRevisionId: null,
  };
}
