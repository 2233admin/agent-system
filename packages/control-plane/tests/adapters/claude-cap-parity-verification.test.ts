import { beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { loadCapConfigRevisions } from '../../src/adapters/sources/cap-fs';
import { BunClaudeCapabilityProbe } from '../../src/adapters/clients/claude/capability-probe';
import { BunClaudeProcessPort } from '../../src/adapters/clients/claude/process-port';
import { compileClaudeAssemblyManifest } from '../../src/adapters/clients/claude/assembly-manifest';
import type { ClaudeAssemblyManifest, ClaudeAssemblyManifestResult } from '../../src/adapters/clients/claude/assembly-manifest';
import { compileClaudeAdapterPlan } from '../../src/adapters/clients/claude/adapter-plan';
import { prepareClaudeAlreadyRunningLaunchPlan, type LaunchDeps } from '../../src/application/claude-launch';
import { isKnown } from '../../src/domain/facts';
import type { CapabilityReference, StableConfigRevision } from '../../src/domain/config';
import type { LaunchPlan } from '../../src/domain/activation';
import type { ClientId } from '../../src/domain/client';
import type { ConfigRevisionRepository, LaunchPlanRepository } from '../../src/application/ports';

/**
 * `[Story 4.5]` This test's whole point is to run the *real* chain
 * (`loadCapConfigRevisions` -> `compileClaudeAssemblyManifest` ->
 * `compileClaudeAdapterPlan`) against the *real* `.cap/` at the repo root --
 * never a fixture -- and against a real `BunClaudeCapabilityProbe` +
 * `BunClaudeProcessPort` (never fake evidence). It is read-only: nothing here
 * ever writes to `.cap/` or to any project `.claude/` directory.
 */
const CAP_ROOT = path.join(import.meta.dir, '..', '..', '..', '..', '.cap');

/** The version `.cap/runtime/claude.toml`'s header comment says was verified (Story 4.1's known difference (a)). */
const CAP_VERIFIED_CLAUDE_VERSION = '2.1.236';

interface CapLockProfileInventory {
  readonly skills: readonly string[];
  readonly mcps: readonly string[];
  readonly hooks: readonly string[];
  readonly plugins: readonly string[];
}

interface CapLockShape {
  readonly profiles: Record<string, { readonly inventory: CapLockProfileInventory }>;
}

async function readCapLock(): Promise<CapLockShape> {
  const lockPath = path.join(CAP_ROOT, 'lock.json');
  try {
    const text = await Bun.file(lockPath).text();
    return JSON.parse(text) as CapLockShape;
  } catch (error) {
    throw new Error(
      `Story 4.5 的 AC1 逐项比对证据需要 .cap/lock.json 可读且是合法 JSON，但读取/解析 ${lockPath} 失败：` +
        `${(error as Error).message}。这是本仓自身已有的证据文件（只读），不是本 Story 制造的 fixture -- 如果它被有意` +
        '移动/改写，需要更新本测试的期望，而不是静默跳过。',
    );
  }
}

interface CapRuntimeClaudeToml {
  readonly client: string;
  readonly policy: {
    readonly permission_mode: string;
    readonly enable_project_mcp: boolean;
    readonly enable_user_assets: boolean;
  };
}

async function readCapRuntimeClaudeToml(): Promise<CapRuntimeClaudeToml> {
  const tomlPath = path.join(CAP_ROOT, 'runtime', 'claude.toml');
  try {
    const text = await Bun.file(tomlPath).text();
    return Bun.TOML.parse(text) as CapRuntimeClaudeToml;
  } catch (error) {
    throw new Error(
      `Story 4.5 的 AC1 policy.* 比对证据需要 .cap/runtime/claude.toml 可读且是合法 TOML，但读取/解析 ${tomlPath} 失败：` +
        `${(error as Error).message}。这是本仓自身已有的证据文件（只读），不是本 Story 制造的 fixture -- 如果它被有意` +
        '移动/改写，需要更新本测试的期望，而不是静默跳过。',
    );
  }
}

/**
 * `[Story 4.5]` Recursively hashes every regular file under `root` with
 * SHA-256, keyed by path relative to `root`. Used only to make the ".cap/
 * 现状声明" claim in the spec ("no file under `.cap/` was created/modified/
 * deleted/renamed by this Story's work") automated and CI-checkable, rather
 * than resting solely on a manually-run `git status --porcelain`. Read-only:
 * never writes anything.
 */
async function snapshotFileTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const bytes = await Bun.file(fullPath).arrayBuffer();
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(new Uint8Array(bytes));
        snapshot.set(path.relative(root, fullPath).split(path.sep).join('/'), hasher.digest('hex'));
      }
    }
  }

  await walk(root);
  return snapshot;
}

/** Deterministic, sorted `[path, hash]` pairs so two snapshots compare equal regardless of directory-listing order. */
function sortedSnapshotEntries(snapshot: Map<string, string>): Array<[string, string]> {
  return [...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function sortedNames(refs: readonly CapabilityReference[]): string[] {
  return refs.map((r) => r.name).sort();
}

/** Whether `argv` contains `flag` immediately followed by `value` (the exact shape `CAPABILITY_ARGV_MAP` produces). */
function argvHasFlagValue(argv: readonly string[], flag: string, value: string): boolean {
  return argv.some((token, index) => token === flag && argv[index + 1] === value);
}

class FakeConfigRevisionRepository implements ConfigRevisionRepository {
  private readonly revisions = new Map<string, StableConfigRevision>();

  add(revision: StableConfigRevision): void {
    this.revisions.set(revision.revisionId, revision);
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

describe('.cap/ parity verification (Story 4.5 AC1) + already-running self-check (AC2)', () => {
  /**
   * `[Story 4.5]` Automates the ".cap/ 现状声明" claim in the spec (no file
   * under `.cap/` is created/modified/deleted/renamed by this Story's own
   * read-only work) instead of leaving it to a manually-run
   * `git status --porcelain`. Snapshotted once before every test in this
   * `describe` block runs and compared once after all of them finish --
   * bracketing every real-`.cap/`-touching call this file makes
   * (`loadCapConfigRevisions`, `readCapLock`, `readCapRuntimeClaudeToml`,
   * the probe, and `prepareClaudeAlreadyRunningLaunchPlan`'s revision
   * lookup), not just the first test.
   */
  let capSnapshotBeforeSuite: Map<string, string>;

  beforeAll(async () => {
    capSnapshotBeforeSuite = await snapshotFileTree(CAP_ROOT);
    expect(capSnapshotBeforeSuite.size).toBeGreaterThan(0);
  });

  test('real .cap/ (general, agent-assembler) full chain matches lock.json inventory item-by-item; only pre-identified known differences are tolerated', async () => {
    const [revisions, lock, runtimeToml] = await Promise.all([
      loadCapConfigRevisions(CAP_ROOT),
      readCapLock(),
      readCapRuntimeClaudeToml(),
    ]);

    expect(revisions.map((r) => r.configName).sort()).toEqual(['agent-assembler', 'general']);

    const processPort = new BunClaudeProcessPort();
    const probe = new BunClaudeCapabilityProbe(processPort);
    const [probeResults, versionFact] = await Promise.all([
      probe.probeHardControlCapabilities(),
      processPort.detectVersion(),
    ]);

    const binaryPresent = Bun.which('claude') !== null;

    for (const revision of revisions) {
      const lockProfile = lock.profiles[revision.configName];
      if (lockProfile === undefined) {
        throw new Error(`lock.json 缺少 profile "${revision.configName}" 的 inventory -- 无法完成逐项比对`);
      }
      const inventory = lockProfile.inventory;

      // --- Item-by-item: loadCapConfigRevisions' own reference sets vs lock.json's declared inventory ---
      expect(sortedNames(revision.skills)).toEqual([...inventory.skills].sort());
      expect(sortedNames(revision.mcp)).toEqual([...inventory.mcps].sort());
      expect(sortedNames(revision.hooks)).toEqual([...inventory.hooks].sort());
      expect(sortedNames(revision.plugins)).toEqual([...inventory.plugins].sort());

      // --- Full chain: compile against real probe evidence ---
      const manifestResult: ClaudeAssemblyManifestResult = compileClaudeAssemblyManifest(revision, probeResults);

      if (!binaryPresent) {
        // Edge-case matrix row 2: honest all-`unknown` probe, never fabricate `supported`.
        // `claude.permission-mode-control` is `required: true` and always relevant, so an
        // all-`unknown` probe result must block manifest compilation entirely.
        expect(manifestResult.kind).toBe('blocked');
        console.warn(
          `[Story 4.5] claude 二进制在本环境不可达（Bun.which('claude') 为 null），profile "${revision.configName}" ` +
            '的深度比对（manifest.skills/mcp 与 lock.json 逐项一致、capabilityPolicy 状态、adapterPlan.argv 与 ' +
            '.cap/runtime/claude.toml policy.* 字段语义一致——本 Story 相对 Story 4.1 裸探测比对的真正增量价值）本轮' +
            '未执行；本次"通过"只证明了 lock.json inventory 与 loadCapConfigRevisions 输出的浅层结构一致性，不能' +
            '当作深度比对已被验证的证据（.github/workflows/control-plane-checks.yml 的 CI job 不安装 claude 二进制，' +
            '这正是 CI 今天实际命中的分支）。',
        );
        continue;
      }

      if (manifestResult.kind === 'blocked') {
        throw new Error(
          `未预期的差异（AC1 阻塞条件）：真实 claude 二进制可达，但 profile "${revision.configName}" 的编译结果为 blocked -- ` +
            `missingRequiredCapabilities=${manifestResult.missingRequiredCapabilities.join(', ')}。这不属于本 Story 预先识别的任一` +
            '已知差异，需人工核实是否为真实回归。',
        );
      }
      const manifest: ClaudeAssemblyManifest = manifestResult.manifest;

      // manifest 的 skills/mcp 引用集合与 lock.json inventory 完全一致（I/O matrix 第一行）。
      expect(sortedNames(manifest.skills)).toEqual([...inventory.skills].sort());
      expect(sortedNames(manifest.mcp)).toEqual([...inventory.mcps].sort());

      const byId = new Map(manifest.capabilityPolicy.map((note) => [note.capabilityId, note]));
      const permissionMode = byId.get('claude.permission-mode-control');
      const settingSources = byId.get('claude.setting-sources-control');
      const mcpScope = byId.get('claude.mcp-project-scope-control');

      // claude.permission-mode-control 恒相关（baseline）；真实两个 profile 都引用了 skills，
      // 所以 claude.setting-sources-control 也相关。任一缺失都是未预期的差异。
      if (permissionMode === undefined) {
        throw new Error(`未预期的差异：profile "${revision.configName}" 的 manifest 缺少恒相关的 claude.permission-mode-control`);
      }
      expect(['supported', 'degraded']).toContain(permissionMode.status);

      expect(revision.skills.length).toBeGreaterThan(0);
      if (settingSources === undefined) {
        throw new Error(`未预期的差异：profile "${revision.configName}" 引用了 skills，但 manifest 缺少 claude.setting-sources-control`);
      }
      expect(['supported', 'degraded']).toContain(settingSources.status);

      // 两个真实 profile 的 mcp inventory 均为空 -- claude.mcp-project-scope-control 因此不相关，
      // 这与 `.cap` 的 enable_project_mcp=false 语义天然一致（双方都表达"没有项目级 MCP"）。若未来
      // lock.json 出现非空 mcps 而 manifest 未把该 capability 判为相关，则是未预期的差异。
      if (inventory.mcps.length === 0) {
        expect(mcpScope).toBeUndefined();
      } else if (mcpScope === undefined) {
        throw new Error(
          `未预期的差异：profile "${revision.configName}" 的 lock.json inventory.mcps 非空，但 manifest 未把 claude.mcp-project-scope-control 判为相关`,
        );
      } else {
        expect(['supported', 'degraded']).toContain(mcpScope.status);
      }

      // --- policy.* 比对：编译出的 ClaudeAdapterPlan 的 argv 与 .cap/runtime/claude.toml 已核实字段语义一致 ---
      const adapterPlan = compileClaudeAdapterPlan(manifest);

      expect(runtimeToml.policy.permission_mode).toBe('manual');
      const permissionModeArgvContributes = permissionMode.status === 'supported' || permissionMode.status === 'degraded';
      if (permissionModeArgvContributes) {
        expect(argvHasFlagValue(adapterPlan.argv, '--permission-mode', 'manual')).toBe(true);
      }

      expect(runtimeToml.policy.enable_user_assets).toBe(false);
      const settingSourcesArgvContributes = settingSources.status === 'supported' || settingSources.status === 'degraded';
      if (settingSourcesArgvContributes) {
        // `.cap`'s enable_user_assets:false excludes the `user` source; the new adapter's
        // `--setting-sources project` argv does the same (user is absent from the value).
        expect(argvHasFlagValue(adapterPlan.argv, '--setting-sources', 'project')).toBe(true);
      }

      expect(runtimeToml.policy.enable_project_mcp).toBe(false);
      // `claude.mcp-project-scope-control` -> `adapter-plan.ts`'s `CAPABILITY_ARGV_MAP`
      // contributes a single, valueless flag (`--strict-mcp-config`), not a flag+value
      // pair -- unreachable with today's real `.cap/` data (both profiles' `mcps` are
      // empty, so `mcpScope` is `undefined` above), but kept symmetric with the other
      // two argv checks for whenever a real profile first references an MCP.
      if (mcpScope !== undefined) {
        const mcpScopeArgvContributes = mcpScope.status === 'supported' || mcpScope.status === 'degraded';
        if (mcpScopeArgvContributes) {
          expect(adapterPlan.argv.includes('--strict-mcp-config')).toBe(true);
        }
      }

      // 已知差异 (b)：新 adapter 从不物化技能/说明内容到任何项目级 .claude/ 目录 -- argv 里不应出现
      // 任何按名选择技能的标志（也确实没有这样的已核实标志，见 Story 4.1 Design Notes）。
      expect(adapterPlan.argv.some((token) => token.toLowerCase().includes('skill'))).toBe(false);
      expect(adapterPlan.envKeys).toEqual(['CLAUDE_CONFIG_DIR']);
    }

    // 已知差异 (a)：真实 claude --version 与 .cap 已核实版本之间的漂移，记录但不阻塞。
    if (versionFact.kind === 'known' && versionFact.value !== CAP_VERIFIED_CLAUDE_VERSION) {
      console.warn(
        `[Story 4.5 已知差异 (a)] 真实 claude --version 为 ${versionFact.value}，.cap/runtime/claude.toml 声明已核实 ${CAP_VERIFIED_CLAUDE_VERSION}。已记录，不阻塞本 Story。`,
      );
    } else if (versionFact.kind === 'unknown' && binaryPresent) {
      console.warn(
        `[Story 4.5 已知差异 (a)] 真实 claude --version 无法解析（${versionFact.reason}），无法与 .cap 已核实版本比对。已记录，不阻塞本 Story。`,
      );
    }
  });

  test('AC2 阻塞证据: prepareClaudeAlreadyRunningLaunchPlan 对本仓自身真实的两个 profile（general、agent-assembler）都只能落到 requires-restart', async () => {
    const revisions = await loadCapConfigRevisions(CAP_ROOT);
    expect(revisions.map((r) => r.configName).sort()).toEqual(['agent-assembler', 'general']);

    // 覆盖真实 .cap/ 的全部两个 profile，而不是只验证 general 一个样本 -- "AC2 无论选哪个配置都会
    // 被阻塞" 这个结论必须对本仓当前存在的每一个真实 profile 都成立，而不是从单一样本外推。
    for (const revision of revisions) {
      const configRepository = new FakeConfigRevisionRepository();
      configRepository.add(revision);
      const launchPlanRepository = new FakeLaunchPlanRepository();
      const deps: LaunchDeps = { configRepository, launchPlanRepository };

      const outcome = await prepareClaudeAlreadyRunningLaunchPlan(deps, { revisionId: revision.revisionId });

      expect(outcome.plan.phase).toBe('requires-restart');
      expect(outcome.plan.client).toBe('claude-code');
      expect(outcome.plan.configName).toBe(revision.configName);
      expect(isKnown(outcome.plan.failureReason) && outcome.plan.failureReason.value).toBe('already-running-session-target');
      expect(outcome.observationStage).toBe('planned');
      expect(outcome.manifest).toBeNull();
      expect(outcome.adapterPlan).toBeNull();
      expect(outcome.affectedCapabilities).toEqual([]);
      expect(outcome.recoveryAction).not.toBeNull();

      const savesForPlan = launchPlanRepository.saveLog.filter((p) => p.planId === outcome.plan.planId);
      expect(savesForPlan).toHaveLength(1);
    }
  });

  test('.cap/ 现状声明自动核验: 本测试文件运行期间 .cap/ 目录下逐文件 SHA-256 哈希完全不变（未被创建/修改/删除/重命名）', async () => {
    // 上面两个测试都只通过 loadCapConfigRevisions/Bun.file(...).text() 等只读方式访问 `.cap/`。
    // 本测试把 ".cap/ 现状声明" 从"人工跑一次 git status --porcelain 并写进 spec 文档"升级为自动化、
    // CI 可核验的断言：套件启动时（beforeAll）拍一次快照，本测试（套件内最后一个 test，在前两个测试
    // 都已执行完毕后运行）再拍一次，逐文件、逐哈希比对，任何差异都会让本测试真实失败，而不是仅停留在
    // spec 文档里的叙述性声明。
    const capSnapshotAfterSuite = await snapshotFileTree(CAP_ROOT);
    expect(sortedSnapshotEntries(capSnapshotAfterSuite)).toEqual(sortedSnapshotEntries(capSnapshotBeforeSuite));
  });
});
