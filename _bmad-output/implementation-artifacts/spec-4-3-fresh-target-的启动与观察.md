---
title: 'fresh target 的启动与观察'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_revision: '1129be9d41b0f6af10b43f247e6f6e4365f1e187'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-建立-claude-code-adapter-骨架与硬控制能力探测.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-装配-claude-code-的确定性-adapterplan.md'
warnings: ['oversized']
deferred:
  - summary: >-
      AD-8 的 `observationStage` 轴无法从一个已持久化的 `LaunchPlan.phase` 单值无损还原：
      `phase: 'failed'` 既可能来自 `applying --(apply-failed)--> failed`（从未真正 spawn），
      也可能来自 `observing --(observed,outcome:'failed')--> failed`（真正启动后进程非零退出）。
      本 Story 在 `launchClaudeFresh` 自身的控制流里显式跟踪 `observationStage`（而不是从
      `phase` 反推），解决了本 Story 自己返回值的准确性；但如果未来有任何调用方需要"仅凭一个
      已持久化的 `LaunchPlan` 查询它的 `observationStage`"（例如一个独立于 `launchClaudeFresh`
      调用者的 `configs status` 只读投影），当前没有一个通用、无损的 `derive(phase)` 函数可用
      ——因为这个函数在数学上不可能对 `'failed'` 无损。
    evidence: >-
      `domain/activation.ts` 的 `ObservationStage` 类型上方文档注释逐字记录了这个不可derive的
      原因（`'applying'`/`'observing'` 两条路径都能落到同一个 `phase:'failed'`）；本 Story 因此
      故意没有导出一个 `deriveObservationStage(phase)` 函数（曾经写过又移除，见本文件 Design
      Notes），只让 `launchClaudeFresh` 自己在流程里显式记账。
    location: 'packages/control-plane/src/domain/activation.ts'
    severity: low
  - summary: >-
      `adapter-plan.ts` 的硬控制取值（`--permission-mode manual`、`--setting-sources project`、
      `--strict-mcp-config`）是本 Story 硬编码的固定基线，不是从任何按装配可配置的领域字段读出的
      ——因为 `StableConfigRevision`/`ClaudeAssemblyManifest` 目前都不携带"这份装配想要哪个具体
      permission mode 取值"这种字段，只携带 capability 的支持状态。取值选择本身有证据支撑（复用
      Story 4.1 探测与 `.cap/runtime/claude.toml` 已核实的基线：`manual`/项目级 MCP 限定/排除
      user-level 来源），但如果未来需要"每份装配可以选择不同取值"，需要新的领域字段与新 Story，
      不是本 Story 能在不臆造字段的前提下解决的。
    evidence: >-
      `CAPABILITY_ARGV_MAP` 常量与其上方注释；`.cap/runtime/claude.toml` 的 `policy.permission_mode`
      当前唯一取值就是 `"manual"`。
    location: 'packages/control-plane/src/adapters/clients/claude/adapter-plan.ts'
    severity: low
---

<intent-contract>

## Intent

**Problem：** Story 4.1 交付了硬控制能力探测（`BunClaudeCapabilityProbe`），Story 4.2 交付了把已存在装配意图编译成确定性产物的能力，但那份产物的字段形状实际是 Architecture Spine AD-19 的 `AssemblyManifest` 概念（client、装配引用、capability policy），既不是 AD-19 另外定义的、真正用于启动的持久 `AdapterPlan`（argv 结构、环境键、secret/content 引用、hash、generated-file metadata、预期观察），也完全没有"新 spawn 一个 Claude Code 进程并观察其结果"的能力——装配意图与真实启动之间仍然断开。

**Approach：** 分两步解决：(1) 把 Story 4.2 的 `plan.ts` 重命名为 `assembly-manifest.ts`，导出类型 `ClaudeAdapterPlan`→`ClaudeAssemblyManifest`（及其配套类型、编译函数、字段 `planStatus`/`planHash`→`manifestStatus`/`manifestHash`），使名字与 AD-19 定义的概念对齐；(2) 新增 `adapter-plan.ts`，交付 AD-19 真正的、启动导向的 `ClaudeAdapterPlan`（`compileClaudeAdapterPlan(manifest)`：只含 argv 结构、环境键、generated-file 元数据、hash、预期观察），以及新增 `application/claude-launch.ts`（`prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`），复用 `domain/activation.ts` 既有的唯一转换表（`prepared → awaiting-confirmation → applying → observing → succeeded|degraded|failed|incomplete`，与 `confirmLaunchPlan`/`rejectLaunchPlan` 直接复用，不新建平行状态机——AD-18/AD-20），新 spawn 一个独立的 Claude Code 进程、应用该 plan 并观察其结果。

## Boundaries & Constraints

**Always：**
- `launchClaudeFresh` 的 fresh spawn 是一个全新、独立的 `claude` 子进程（走独立的、按 `operationId` 隔离的 invocation 目录作为 `cwd` 与 `CLAUDE_CONFIG_DIR`），绝不是本仓当前维护自身的这个运行中 Session，也绝不读写 `.cap/` 或用户真实的全局 Claude Code 配置目录（AD-9、Epic 4 Never 边界）。
- `plan` 阶段（`compileClaudeAdapterPlan`）显式声明 `launchTarget: 'fresh'`（AD-20 要求"`plan` 阶段必须显式声明当前 target 属于哪一种"）。
- `observationStage` 由 `launchClaudeFresh` 自身在控制流中显式跟踪并作为返回值的一部分给出（`planned`→ 真正 spawn 前的任何失败；`observed`→ 进程真正启动且其退出已被捕获），而不是从一个已持久化的 `LaunchPlan.phase` 反推（见本文件 Design Notes 与 frontmatter `deferred` 的第一条：`phase:'failed'` 本身不足以无损还原这一轴）。
- AC2 失败信息必须可从 `launchClaudeFresh` 的返回值（`ClaudeLaunchOutcome`）里读到：失败阶段（`plan.phase`）、受影响能力（`affectedCapabilities`，只列真正贡献了 argv 的 capability，绝不牵连未参与本次启动尝试的能力，如恒不贡献 argv 的 `claude.hook-deny-return-value`）、已知原因（`plan.failureReason`）、恢复动作（`recoveryAction`，仅失败时非 `null`）。
- 装配意图（Instructions/Skills/MCP/Hooks/Plugins）的实际内容一律不在本 Story 的 fresh 启动里物化（`computeClaudeKnownDifferences` 对全部五组都诚实记为"未物化"差异）——本 Story 唯一真正应用（写进 argv）的是硬控制能力标志本身（permission mode / MCP 项目级 scope / setting-sources 范围），这正是 Epic 4 的核心交付物，不是配置等价。
- `resolveClientSupport('claude-code')` 与 `domain/client.ts` 保持不变（继续返回 `supported:false`，是 OMP/CLI 现有产品边界，Story 4.1 已确立的 Never 边界）；本 Story 的 Claude 启动入口（`prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`）是独立于该网关的专用函数，调用它们本身就是"这个客户端在这里受支持"的信号，不需要也不经过那个通用门。
- 不接线 CLI 组合根（`cli/index.ts`）：epics.md AC1 的"Given 用户在外部 CLI 选择..."描述的是前置场景，不是本 Story 交付 CLI 命令的授权——Story 4.1/4.2 同样明确排除 CLI 接线；本 Story 是 adapter/application 层功能，CLI 命令（如 `configs use --client claude-code`）留给后续 Story（4.5 前后，届时本仓自身切换与 parity 验证也已就绪）决定具体交互形态，避免在还没有 already-running 路径（Story 4.4）之前仓促定型 CLI 面。

**Block If：**
- 若无法在不修改 `.cap/`、不修改 `domain/client.ts` 的 `resolveClientSupport`、不接线本仓自身运行 Session 的前提下完成 fresh 启动与观察，HALT 并说明冲突点。

**Never：**
- 不实现 already-running session target 的 `requires-restart` 路径（Story 4.4 范围）；`ClaudeLaunchTarget` 类型只有 `'fresh'` 一个成员，但保留为开放式 union（而非裸字符串字面量类型）作为显式扩展点——Story 4.4 加入 `'already-running'` 时，编译器会强制复查本文件里对 `ClaudeLaunchTarget`的每一处判别式使用。
- 不新增/修改 `domain/activation.ts` 既有的 `LaunchPlan`/`transitionLaunchPlan`/`LaunchPhase`/`createLaunchPlan`/`computePlanHash` 的既有字段或行为（唯一改动是新增导出 `ObservationStage` 类型，纯新增、不影响任何既有测试）。
- 不修改 `domain/client.ts`、不接线 `cli/index.ts`、不触碰 `.cap/` 本体（继续保持 Story 4.1/4.2 已确立的边界，只读方式都未使用——本 Story连读取都不需要）。
- 不产出候选、评分或推荐（SPEC.md CAP-1）。
- 不伪造成功：`launchClaudeFresh` 的每一条早退路径都产出一个 AD-18 合法的确定终态（`failed`），从不静默保留在中间态，也从不把 `degraded`/`incomplete` 包装成 `succeeded`。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 唯一一次确认后成功启动 | `prepareClaudeFreshLaunchPlan` → `confirmLaunchPlan` → `launchClaudeFresh`，capability 全 supported，revision 无引用 | `succeeded`，`observationStage: 'observed'`，`applyResult: 'applied'`，`argv` 只含 `--permission-mode manual` | 无 |
| 引用 instructions/skills/mcp/hooks/plugins | 同上，revision 五组引用全非空 | `degraded`（因内容未物化的已知差异），`knownDifferences` 列出全部五项 | 不静默隐藏差异 |
| 必需能力 blocked（如 mcp-project-scope-control unsupported） | probe 结果里该能力 `required:true` 且非 supported/degraded | `applying → failed`（从未 spawn），`observationStage: 'planned'`，`affectedCapabilities` 含该能力，`recoveryAction` 非空 | 不产出 manifest/adapterPlan，`claudeProcessPort.spawn` 从未被调用 |
| 宿主拒绝硬控制边界（非零退出码） | `claude` 进程真正启动，退出码非 0 | `observing → failed`，`observationStage: 'observed'`，`affectedCapabilities` 只含真正贡献了 argv 的能力（如 hooks 被引用但从不贡献 argv，绝不出现在该列表） | 不伪造成功，退出码原样出现在 failureReason |
| 进程被信号终止、无可判定退出码 | `exitCode: null, signal: 'SIGTERM'` | `observing → incomplete`，`observationStage: 'observed'` | 不误判为 failed 或 succeeded |
| `claude` 二进制不可达（spawn 抛出） | `claudeProcessPort.spawn` 抛出 | `applying → failed`，`observationStage: 'planned'`（进程从未真正启动） | 不静默回退到未装配状态 |
| invocation 目录准备失败（如磁盘写入失败） | `claudeInvocationDirPort.prepare` 抛出 | `applying → failed`，`observationStage: 'planned'`，从未调用 spawn | 无 |
| 确认后、启动前 revision 被删除 | `configRepository.remove` 发生在 confirm 与 launch 之间 | `applying → failed`（`revision-lookup` 前缀），不是未捕获异常 | 与 OMP `launchOmp` 同款处理 |
| 传入非 Claude 客户端的 plan（防御性） | `plan.client !== 'claude-code'` | 抛出 `InvalidTransitionError`，绝不当作 Claude 启动继续处理 | 防止跨客户端 planId 误用 |
| 用户拒绝确认 | `rejectLaunchPlan`（直接复用 `application/launch.ts`） | `awaiting-confirmation → cancelled`，`claude` 从未被 spawn | 无 |

</intent-contract>

## Spec Change Log

_（本轮无 bad_spec 回环，暂无条目）_

## Review Triage Log

### 2026-08-23 — 自查审查（协调者本人执行，等价四视角：adversarial/blind-hunter、edge-case-hunter、verification-gap、intent-alignment）

- intent_gap: 0
- bad_spec: 0
- patch: 2（均 medium，已修复并重新验证）
- defer: 2（均 low，记入 frontmatter `deferred`）
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]`（adversarial 自查）`launchClaudeFresh` 对传入一个属于其他客户端（如 `omp`）但恰好 `phase === 'applying'` 的 `planId` 没有任何防御——会被当作 Claude 启动继续处理，真的 spawn 一个 `claude` 进程去"应用"一个从未为 Claude 编译过的 plan。修复：在 phase 检查之前新增 `plan.client !== 'claude-code'` 防御性检查，抛出 `InvalidTransitionError`；新增回归测试（`tests/application/claude-launch.test.ts`"rejects a plan created for a different client"）。
  - `[medium]` `[patch]`（edge-case-hunter 自查）AC2 失败时 `affectedCapabilities` 原先直接列出 `manifest.capabilityPolicy` 的全部 capabilityId——包括恒不贡献 argv 的 `claude.hook-deny-return-value`（引用了 hooks 时会出现在 capabilityPolicy 里，但从未真正参与本次启动尝试），导致一次宿主拒绝的启动会错误地"牵连"一个完全没有被应用过的能力。修复：新增 `argvContributingCapabilityIds`（`adapter-plan.ts`），只返回真正贡献了 argv 的 capabilityId 子集；`launchClaudeFresh` 的两处失败分支（spawn 抛出、非零退出/信号终止）改用它；新增回归测试证明 hooks 被排除在外。
  - `defer`（2 项，均 low，详见 frontmatter `deferred`）：(1) `ObservationStage` 无法从单一 `phase` 值无损反推（`'failed'` 有两条不同来源路径），本 Story 通过在 `launchClaudeFresh` 内部显式跟踪解决了自身返回值的准确性，但没有导出一个通用 `derive(phase)` 函数——刻意选择，因为这样的函数在数学上必然对 `'failed'` 是有损/会说谎的；(2) 硬控制取值（`--permission-mode manual` 等）是硬编码基线，非按装配可配置，因为领域模型目前没有对应字段，引入该字段是一个新 Story 的范围。
- 其余检查过、未发现问题的方向（无需改动，记录以证明覆盖面）：`resolveClientSupport`/`domain/client.ts` 未被触碰（`grep` 确认零改动）；`.cap/` 未被读取或写入（本 Story 的任何代码路径都不 import `cap-fs.ts`）；`launchClaudeFresh` 的每条早退路径都在返回前完成了唯一一次 `launchPlanRepository.save`，不存在"保存了一半"的中间态；`compileClaudeAdapterPlan`/`buildClaudeAdapterPlanArgv` 均为零 IO 纯函数，两次编译同一 manifest 产出相同 `planHash`（有专项测试）；`ClaudeAdapterPlan` 序列化后不含 `candidate`/`score`/`recommend` 字样（有专项测试）；`BunClaudeProcessPort.spawn` 从不使用探测用的 `timeoutMs`（会杀死一个正常运行中的交互式会话），与 `detectVersion`/`captureHelpText` 的超时逻辑完全独立。

## Code Map

- `packages/control-plane/src/adapters/clients/claude/assembly-manifest.ts` — 重命名自 `plan.ts`（Story 4.2）：`ClaudeAdapterPlan`→`ClaudeAssemblyManifest`、`ClaudeAdapterPlanCapabilityNote`→`ClaudeAssemblyManifestCapabilityNote`、`ClaudeAdapterPlanBlocked`→`ClaudeAssemblyManifestBlocked`、`ClaudeAdapterPlanResult`→`ClaudeAssemblyManifestResult`、`compileClaudeAdapterPlan`→`compileClaudeAssemblyManifest`，字段 `planStatus`→`manifestStatus`、`planHash`→`manifestHash`；逻辑完全不变，纯改名。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` — 新增：AD-19 真正的、启动导向的 `ClaudeAdapterPlan`（`launchTarget`/`manifestHash`/`argv`/`envKeys`/`generatedFiles`/`expectedObservation`/`planHash`）、`ClaudeLaunchTarget`（当前只有 `'fresh'`，Story 4.4 的显式扩展点）、纯函数 `compileClaudeAdapterPlan(manifest)`、`buildClaudeAdapterPlanArgv(capabilityPolicy)`、`argvContributingCapabilityIds(capabilityPolicy)`。
- `packages/control-plane/src/application/ports.ts` — 追加：`ClaudeSpawnParams`/`ClaudeSpawnResult`；`ClaudeProcessPort` 新增 `spawn` 方法（原有 `detectVersion`/`captureHelpText` 不变）；`ClaudeLaunchContext`/`ClaudeLaunchContextWriter`（Claude 专属诊断产物，独立于 OMP 的 `LaunchContext`/`LaunchContextWriter`）；`ClaudeInvocationDirPort`（隔离 invocation 目录）。
- `packages/control-plane/src/adapters/clients/claude/process-port.ts` — `BunClaudeProcessPort` 新增 `spawn()` 实现（`ClaudeInteractiveSpawnFn` 可注入，镜像 `BunOmpProcessPort.spawn`：完整交出 stdio 控制权、等待真实退出，不受 `timeoutMs` 约束）。
- `packages/control-plane/src/domain/activation.ts` — 纯新增导出 `ObservationStage` 类型（`planned|launched|observed|verified`），不新增函数（详见 frontmatter `deferred` 与 Design Notes：`phase` 无法无损反推该轴，因此故意不提供通用 derive 函数），不改动任何既有导出。
- `packages/control-plane/src/application/claude-launch.ts` — 新增：`prepareClaudeFreshLaunchPlan`（镜像 `prepareLaunchPlan`，跳过 `resolveClientSupport` 门）、`launchClaudeFresh`（镜像 `launchOmp`：probe → 编译 manifest → 编译 adapter plan → 准备隔离目录 → 写诊断 context → spawn → 观察）、`computeClaudeKnownDifferences`、`ClaudeLaunchOutcome`（AC2 展示层投影：`observationStage`/`manifest`/`adapterPlan`/`affectedCapabilities`/`recoveryAction`）。直接复用（不复制）`application/launch.ts` 的 `confirmLaunchPlan`/`rejectLaunchPlan`/`InvalidTransitionError`/`LaunchPlanNotFoundError`。
- `packages/control-plane/src/adapters/launch-context/fs-claude-launch-context-writer.ts` — 新增：`FsClaudeLaunchContextWriter`，镜像既有 `fs-launch-context-writer.ts`，写入独立的 `claude-launch-context/` 子目录（不与 OMP 共用目录）。
- `packages/control-plane/src/adapters/system/claude-invocation-dir.ts` — 新增：`FsClaudeInvocationDirPort`，按 `operationId` 生成隔离目录（同时作为 spawn 的 `cwd` 与 `CLAUDE_CONFIG_DIR`），落在 Architecture Spine 结构种子已预留的 `adapters/system/` 下。
- 测试：`tests/adapters/claude-assembly-manifest.test.ts`（重命名自 `claude-plan.test.ts`，随改名同步更新）、`tests/adapters/claude-adapter-plan.test.ts`（新增）、`tests/adapters/claude-process-port.test.ts`（追加 `spawn` 覆盖）、`tests/adapters/claude-capability-probe.test.ts`（`FakeClaudeProcessPort` 补 `spawn` 桩以满足接口扩展）、`tests/adapters/fs-claude-launch-context-writer.test.ts`（新增）、`tests/adapters/claude-invocation-dir.test.ts`（新增）、`tests/application/claude-launch.test.ts`（新增，覆盖 I/O & Edge-Case Matrix 全部行）。

## Tasks & Acceptance

**Execution：**
- `packages/control-plane/src/adapters/clients/claude/assembly-manifest.ts` + 同名测试文件重命名 — 解决 Story 4.2 frontmatter `deferred` 记录的 AssemblyManifest/AdapterPlan 命名落差 — 是本 Story 明确要求解决的前置项。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` — AD-19 真正的启动导向 `ClaudeAdapterPlan` 与其编译函数 — 是 AC1"应用该 plan"的直接落地。
- `packages/control-plane/src/application/ports.ts`、`process-port.ts`、`fs-claude-launch-context-writer.ts`、`claude-invocation-dir.ts` — spawn/诊断/隔离目录三个新端口与其真实适配器实现 — 是 AC1 fresh spawn 的基础设施。
- `packages/control-plane/src/application/claude-launch.ts` — `prepareClaudeFreshLaunchPlan`/`launchClaudeFresh` — 是 AC1/AC2 的直接落地：完整生命周期转换、observationStage 跟踪、失败信息展示层投影。

**Acceptance Criteria：**
- Given 用户在外部 CLI 选择一个已存在的 Claude Code 装配，且目标是新建会话（fresh），when 用户完成唯一一次确认，then 系统按 `prepared → awaiting-confirmation → applying → observing → succeeded|degraded|failed|incomplete` 生命周期新 spawn 一个 Claude Code 进程并应用该 plan，and `observationStage` 可以推进到 `launched`/`observed`（与 OMP adapter 同构：共享同一 `domain/activation.ts` 转换表），不产生部分应用状态（每条早退路径都落到一个完整持久化的终态）。
- Given fresh 启动过程中必需能力不可达或宿主拒绝应用硬控制边界，when 启动流程失败，then `ClaudeLaunchOutcome` 显示失败阶段（`plan.phase`）、受影响能力（`affectedCapabilities`，不过度归咎未参与本次尝试的能力）、已知原因（`plan.failureReason`）与恢复动作（`recoveryAction`），不伪造成功，不静默回退到未装配状态。
- Given `bun test` 与 `bun run typecheck` 在 `packages/control-plane` 下执行，when 本 Story 改动落地，then 既有全部测试保持通过（不回归 Story 4.1/4.2 交付的 344 项），新增测试全部通过，`tsc --noEmit` 零错误。

## Design Notes

- **为什么 `assembly-manifest.ts`/`adapter-plan.ts` 是两个文件而不是一个：** 二者是 AD-19 明确定义的两个不同概念（`AssemblyManifest` 表达"装配意图 + capability 状态"，`AdapterPlan` 表达"如何真正启动"），字段集合完全不同、生命周期不同（manifest 在 prepare/probe 阶段就能编译，adapter plan 只在真正要 launch 时才需要），保持独立文件让"probe → plan(manifest) → plan(adapter plan) → launch/resume → interpret"这条 Architecture Spine 目录注释描述的链路在代码结构上可见，而不是把两个概念塞进同一个类型里靠字段子集区分。
- **为什么 `observationStage` 不做成 `deriveObservationStage(phase)` 通用函数：** 最初实现过一版这样的函数（`observing→launched`，`succeeded|degraded|failed|incomplete→observed`，其余→`planned`），但审查发现它对 `phase:'failed'` 必然说谎——`transitionLaunchPlan` 的 `'applying'` 分支上 `apply-failed` 事件直接产出 `phase:'failed'`（从未经过 `'observing'`），而 `'observing'` 分支上 `observed` 事件在 `outcome:'failed'` 时也产出同一个 `phase:'failed'`。两条路径在最终 `LaunchPlan` 上完全无法区分，一个纯粹基于 `phase` 的函数只能猜，猜错就是本 Story 反复强调"不伪造证据"的反例。改为让 `launchClaudeFresh` 在自己知道真实控制流的地方（有没有真的调用过 `claudeProcessPort.spawn` 并让它成功返回）显式给出这个值，代价是这不是一个可以脱离调用现场、单凭一个已持久化 `LaunchPlan` 重新计算的值（已记入 frontmatter `deferred`）。
- **为什么 fresh 启动只应用硬控制标志、不物化 Instructions/Skills/MCP 内容：** 与 OMP 现有实现（`computeKnownDifferences`）同款诚实原则的延伸，但覆盖面更保守——OMP 至少能通过原生 `--skills <names>` 标志按名装配 Skills；Story 4.1 对 `claude --help`/`claude mcp add --help` 的核实证据里不存在等价的"按名选择 Skills/Instructions/MCP"标志，编造一个不存在的装配机制比诚实地把这五组都记为"未物化差异"更违反 AD-6/AD-9 的证据纪律。本 Story 真正应用（写进 argv、可被宿主接受或拒绝）的只有 Story 4.1 探测到的三个硬控制能力本身，这正是 Epic 4"把装配边界改为宿主原生可强制执行的硬控制"的核心交付物。
- **为什么 `launchClaudeFresh` 不经过 `resolveClientSupport`：** 见 `application/claude-launch.ts` 顶部注释与本文件 Boundaries——`resolveClientSupport('claude-code')` 目前的 `supported:false` 由一个既有 OMP Story 测试（`tests/application/launch.test.ts` 的"不支持的客户端"用例）钉死为 pinned 行为；本 Story若翻转它会直接回归那条既有测试。由于 Claude 的启动入口本身就是专用函数（不是"传任意 `ClientId` 给同一个通用函数"的设计），调用 `prepareClaudeFreshLaunchPlan`/`launchClaudeFresh` 这件事本身就已经是"这个客户端在这里受支持"的信号，不需要再经过那个为 OMP/CLI 现有产品边界服务的通用门。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 全部既有测试（Story 4.1/4.2 交付的 344 项）+ 本 Story 新增测试全部通过，0 fail

## Auto Run Result

**实现摘要：** 完成两部分工作。(1) 把 Story 4.2 遗留的命名/形状落差解决：`plan.ts` 重命名为 `assembly-manifest.ts`，`ClaudeAdapterPlan` 系列类型改名为 `ClaudeAssemblyManifest` 系列（含字段 `manifestStatus`/`manifestHash`），逻辑零变化。(2) 新增 AD-19 真正的、启动导向的 `ClaudeAdapterPlan`（`adapter-plan.ts`）与完整的 fresh-target 启动/观察能力（`application/claude-launch.ts`：`prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`），复用 `domain/activation.ts` 既有唯一转换表（新增一个纯类型 `ObservationStage`，不新增函数、不改动任何既有导出），新 spawn 一个独立、隔离的 Claude Code 子进程（新增 `ClaudeInvocationDirPort`/`FsClaudeInvocationDirPort` 提供按 `operationId` 隔离的目录，新增 `ClaudeProcessPort.spawn`/`BunClaudeProcessPort.spawn` 实现真正的交互式子进程 spawn，新增 `ClaudeLaunchContextWriter`/`FsClaudeLaunchContextWriter` 写入诊断产物）并观察其退出结果。`observationStage` 由 `launchClaudeFresh` 显式跟踪（因为 `LaunchPlan.phase` 单值无法无损还原这一轴，详见 Design Notes）。AC2 的失败展示信息通过 `ClaudeLaunchOutcome`（`affectedCapabilities`/`recoveryAction`）暴露，且只归咎真正贡献了 argv 的能力（新增 `argvContributingCapabilityIds`，排除恒不贡献 argv 的 `claude.hook-deny-return-value`）。

**改动文件：**
- `packages/control-plane/src/adapters/clients/claude/plan.ts` → `assembly-manifest.ts`（重命名+改名，逻辑不变）；`tests/adapters/claude-plan.test.ts` → `claude-assembly-manifest.test.ts`（同步改名）。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` — 新增。
- `packages/control-plane/src/application/ports.ts` — 追加 `ClaudeSpawnParams`/`ClaudeSpawnResult`/`ClaudeLaunchContext`/`ClaudeLaunchContextWriter`/`ClaudeInvocationDirPort`，`ClaudeProcessPort` 追加 `spawn`。
- `packages/control-plane/src/adapters/clients/claude/process-port.ts` — 追加 `spawn()` 实现与可注入的 `ClaudeInteractiveSpawnFn`。
- `packages/control-plane/src/domain/activation.ts` — 纯新增导出 `ObservationStage` 类型。
- `packages/control-plane/src/application/claude-launch.ts` — 新增。
- `packages/control-plane/src/adapters/launch-context/fs-claude-launch-context-writer.ts` — 新增。
- `packages/control-plane/src/adapters/system/claude-invocation-dir.ts` — 新增（新目录）。
- `packages/control-plane/tests/adapters/claude-adapter-plan.test.ts`、`fs-claude-launch-context-writer.test.ts`、`claude-invocation-dir.test.ts`、`tests/application/claude-launch.test.ts` — 新增。
- `packages/control-plane/tests/adapters/claude-process-port.test.ts`、`claude-capability-probe.test.ts` — 追加 `spawn` 覆盖 / 补齐接口扩展所需的桩方法。
- `_bmad-output/implementation-artifacts/spec-4-3-fresh-target-的启动与观察.md` — 本规格文件本身。

**审查发现分布：** patch 2（均 medium，已修复并重新验证）、defer 2（均 low，记入 frontmatter `deferred`）、reject 0、intent_gap 0、bad_spec 0。审查由协调者本人直接执行（adversarial/blind-hunter、edge-case-hunter、verification-gap、intent-alignment 四个视角的等价检查），未使用异步子代理审查通道。

**follow-up 审查建议：** `followup_review_recommended: false`（本轮 patch 计分 2×2(medium) = 4 < 5 的既有触发阈值，且无 high severity patch）。

**验证执行：**
- `cd packages/control-plane && bun run typecheck` — 通过，0 错误。
- `cd packages/control-plane && bun test` — 387 pass / 0 fail / 1319 expect() calls（既有 344 项 + 本 Story 新增/追加 43 项），无回归。

**残留风险：**
- frontmatter `deferred` 记录的两项低严重度残留：(1) `ObservationStage` 没有通用的 `derive(phase)` 函数（数学上对 `'failed'` 必然有损，故意不提供，改由调用方显式跟踪）；(2) 硬控制标志取值（`--permission-mode manual` 等）是硬编码基线，不是按装配可配置的领域字段——未来如需要"每份装配可选择不同取值"，需要新的领域字段与新 Story。
- CLI 组合根未接线（`configs use --client claude-code` 尚不存在）；本 Story 明确只交付 adapter/application 层能力，CLI 交互形态留给后续 Story（Story 4.4 完成 already-running 路径之后再统一设计，避免只有一半 target 路径时仓促定型 CLI 面）。
- `claude.hook-deny-return-value` 仍如 Story 4.1/4.2 交付时那样恒为 `unknown`（`required:false`）——本 Story 的 fresh 启动不产生任何 hook 相关的真实集成验证（controlled-integration），任何引用 hooks 的装配意图目前都会落入 `degraded`；这是已知限制，非本 Story 引入也非本 Story 消解。
