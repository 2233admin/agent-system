---
title: 'already-running session target 的 requires-restart 路径'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_revision: '3332adbbb35592bd5f8d5ccc75217140f92a7e51'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-fresh-target-的启动与观察.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Target-type 判断（`determineClaudeLaunchTarget`）与其唯一调用点都落在
      `application/claude-launch.ts` 里，没有触碰 `adapter-plan.ts` 的
      `compileClaudeAdapterPlan` 本体——Story 4.3 的注释曾预告"新增 target 会强制
      复查本文件（`adapter-plan.ts`）里每处判别式"，但实际的穷尽 switch 落在
      `claude-launch.ts`，`compileClaudeAdapterPlan` 自身完全未被 already-running
      路径调用。这是本 Story 有意识的设计选择（Design Notes 已记录理由：不为
      already-running 编译一份"算出来了但从未生效"的 AdapterPlan），但 Story 4.5
      接入本仓自身真实 session 证据时，需要判断是延用当前"应用层先判断、必要时完全
      跳过 adapter-plan 编译"的结构，还是改为在 `compileClaudeAdapterPlan` 内部
      分支。
    evidence: >-
      `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` 的
      `compileClaudeAdapterPlan` 函数体自 Story 4.3 起未被本次改动触碰，硬编码
      `const launchTarget: ClaudeLaunchTarget = 'fresh';`；真正的穷尽 `switch`
      在 `packages/control-plane/src/application/claude-launch.ts` 的
      `prepareClaudeAlreadyRunningLaunchPlan` 里，对
      `determineClaudeLaunchTarget({ ownsFreshSpawn: false })` 的返回值判别。
      Story 4.4 的独立 intent-alignment 审查（本轮四视角之一）确认了这一点：
      "adapter 的 plan 阶段"这个 AC1 措辞既可读作"`compileClaudeAdapterPlan`
      本体"，也可读作"apply 之前的任意判定点"，当前实现选择了后一种更保守的读法。
    location: >-
      packages/control-plane/src/adapters/clients/claude/adapter-plan.ts;
      packages/control-plane/src/application/claude-launch.ts:prepareClaudeAlreadyRunningLaunchPlan
    severity: low
  - summary: >-
      `prepareClaudeAlreadyRunningLaunchPlan` 与 Story 4.3 的
      `prepareClaudeFreshLaunchPlan` 有约 15 行结构相同的样板代码（best-effort
      revision 查找 + `createLaunchPlan` 构造），未被提取为共享 helper。
    evidence: >-
      两个函数体都以几乎相同的
      `getConfigRevisionDetail`→`configName` 解析→`createLaunchPlan({...})`
      顺序开头，只在查找失败时的分支处理（`prepared-failed` vs 忽略并继续）与
      随后触发的事件类型上分叉。本 Story 的 Never 边界明确"不修改
      `prepareClaudeFreshLaunchPlan` 的既有行为、签名或测试（Story 4.3
      已锁定）"，为了消除这处重复而改动那个已锁定、已充分测试的函数体，被判断为
      风险大于收益，故保留重复、留待未来一次专门的重构或 Story 4.5 一并处理。
    location: >-
      packages/control-plane/src/application/claude-launch.ts:prepareClaudeAlreadyRunningLaunchPlan,prepareClaudeFreshLaunchPlan
    severity: low
---

<intent-contract>

## Intent

**Problem：** Story 4.3 交付了 `ClaudeLaunchTarget`（当前只有 `'fresh'`）与 fresh-target 的完整启动/观察路径，但目标是"当前已在运行的交互式 Claude Code 会话"（本产品不拥有该进程）时，没有任何路径处理——如果误用 fresh 流程，会伪造成"新进程已启动并观察到结果"，掩盖"实际上没有、也不能对一个已加载的会话做热更新"的事实。

**Approach：** 按 AD-18 明文规则新增 `prepared → requires-restart` 转换边（`domain/activation.ts` 新增 `target-requires-restart` 事件，仅在 `prepared` 阶段接受），在 `adapter-plan.ts` 把 `ClaudeLaunchTarget` 扩为 `'fresh' | 'already-running'` 并新增一个只在拿到"这就是 fresh spawn 本身"证据时才返回 `'fresh'`、否则一律 fail closed 到 `'already-running'` 的纯判定函数；在 `application/claude-launch.ts` 新增 `prepareClaudeAlreadyRunningLaunchPlan`，创建 plan 后不经 probe/manifest/spawn，直接原子转入 `requires-restart` 终态，`observationStage` 恒为 `'planned'`。

## Boundaries & Constraints

**Always：**
- `prepared → requires-restart` 是 AD-18 已明文列出的合法转换（不是新状态，是既有状态间的新增转换边），只在 `LaunchPhase === 'prepared'` 时接受 `target-requires-restart` 事件；`failureReason` 记录 `'already-running-session-target'`，与既有 `succeeded/degraded → requires-restart`（`switch-requested`）并列为 `transitionLaunchPlan` 仅有的两个"终态后仍可再转换一次"式例外之一的镜像（后者从非终态 `prepared` 直接进入终态，前者从终态再转终态；两者都不新增状态）。
- `prepareClaudeAlreadyRunningLaunchPlan` 全程只调用一次 `launchPlanRepository.save`（新建 plan 后立即转入 `requires-restart` 再保存），不调用 `claudeCapabilityProbe`、不编译 `ClaudeAssemblyManifest`/`ClaudeAdapterPlan`、不调用 `claudeProcessPort.spawn`——因为目标进程不被本产品拥有，任何"看起来在应用"的中间计算都可能被误读为部分应用的证据。
- `determineClaudeLaunchTarget(evidence)` 只有 `evidence.ownsFreshSpawn === true` 才返回 `'fresh'`，其余一律返回 `'already-running'`（fail closed，AD-10/AD-20）；本 Story 中 `prepareClaudeAlreadyRunningLaunchPlan` 传入 `{ ownsFreshSpawn: false }` 并对返回值做穷尽 switch（非 `'already-running'` 时抛错），让 Story 4.3 注释里预告的"新增 target 强制复查每处判别式"落到实处。
- `ClaudeLaunchOutcome` 返回 `observationStage: 'planned'`、`manifest: null`、`adapterPlan: null`、`affectedCapabilities: []`、`recoveryAction` 为一句诚实说明"需要重启当前会话、本产品无法热更新已加载会话"的文案。
- `configName` 的解析复用 `prepareClaudeFreshLaunchPlan` 同款 best-effort 查找（找不到 revision 时退回 `revisionId` 本身），但查找失败**不**影响终态——不论 revision 是否存在，`already-running` 目标的唯一终态都是 `requires-restart`（这本身就是"不产生部分应用事实"的直接体现：连"配置是否存在"都不构成阻塞，因为压根没有尝试应用）。

**Block If：**
- 若在不新增 `domain/activation.ts` 转换边的前提下无法让 `apply` 合法落到 `requires-restart`（即除新增边外还有别的路径能满足 AD-18），HALT 并说明冲突点。

**Never：**
- 不接线 CLI 组合根、不新增/修改任何 CLI 渲染逻辑（`requires-restart` 的通用展示已由既有 OMP 路径的 CLI 代码覆盖，Claude 的 plan 复用同一 `LaunchPhase`/`deriveLaunchStatus`，无需改动）。
- 不实现"本仓自身这个 session 的检测/切换"逻辑（Story 4.5 范围）；`determineClaudeLaunchTarget` 只是通用判定原语，不接任何进程自省/环境探测。
- 不修改 `launchClaudeFresh`/`prepareClaudeFreshLaunchPlan` 的既有行为、签名或测试（Story 4.3 已锁定），也不修改 `compileClaudeAdapterPlan`/`compileClaudeAssemblyManifest` 的既有字段或返回形状。
- 不触碰 `.cap/`、`domain/client.ts`、`resolveClientSupport`。
- 不为 `already-running` 路径编造任何"降级但已应用"的中间结果；不产出候选/评分/推荐。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 目标判定为 already-running，配置存在 | `prepareClaudeAlreadyRunningLaunchPlan(deps, {revisionId})`，revision 存在 | plan 一次性 `prepared → requires-restart`；`observationStage: 'planned'`，`manifest`/`adapterPlan` 为 `null`，`recoveryAction` 提示重启 | 无 |
| 配置不存在 | 同上，revision 不存在 | 仍然 `requires-restart`（`configName` 退回 `revisionId`），不返回 `failed` | 不阻塞、不抛异常 |
| `determineClaudeLaunchTarget` 无法证明 fresh | `{ ownsFreshSpawn: false }` | 返回 `'already-running'` | 无 |
| `determineClaudeLaunchTarget` 拿到 fresh 自证 | `{ ownsFreshSpawn: true }` | 返回 `'fresh'` | 无 |
| requires-restart 后再次尝试任何事件 | 对已终态 plan 调用 `transitionLaunchPlan`（含 `target-requires-restart` 自身、`process-started` 等） | 全部 `ok: false, reason: 'invalid-transition'` | 不倒退、不覆写终态 |
| 误把 already-running 的 plan 传给 `launchClaudeFresh` | `launchClaudeFresh(deps, {planId})`，该 plan 已是 `requires-restart` | 抛 `InvalidTransitionError`（phase 校验） | 不会真的 spawn |
| `prepared` 阶段以外收到 `target-requires-restart` | 在 `awaiting-confirmation`/`applying`/`observing` 阶段构造该事件 | `ok: false, reason: 'invalid-transition'` | 与 AD-18 转换表一致 |

</intent-contract>

## Code Map

- `packages/control-plane/src/domain/activation.ts` — `LaunchPlanEvent` 新增 `{ type: 'target-requires-restart' }`；`transitionLaunchPlan` 的 `case 'prepared':` 新增分支，调用既有 `withFailure(plan, 'requires-restart', 'already-running-session-target')`；更新文件顶部关于"终态例外"的文档注释（新增第二个例外）。不改动 `LaunchPhase`、`TERMINAL_PHASES`、`ObservationStage`、`createLaunchPlan`、`computePlanHash` 等既有导出。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` — `ClaudeLaunchTarget` 从 `'fresh'` 扩为 `'fresh' | 'already-running'`；新增 `ClaudeLaunchTargetEvidence` 接口（`{ readonly ownsFreshSpawn: boolean }`）与纯函数 `determineClaudeLaunchTarget(evidence)`。`compileClaudeAdapterPlan`/`buildClaudeAdapterPlanArgv`/`argvContributingCapabilityIds` 零改动（本 Story 的 already-running 路径不调用它们）。
- `packages/control-plane/src/application/claude-launch.ts` — 新增 `prepareClaudeAlreadyRunningLaunchPlan(deps: LaunchDeps, params: { revisionId: string }): Promise<ClaudeLaunchOutcome>`：镜像 `prepareClaudeFreshLaunchPlan` 的 revision best-effort 解析与 `createLaunchPlan`，随后调用 `determineClaudeLaunchTarget({ ownsFreshSpawn: false })` 并穷尽 switch 断言其为 `'already-running'`，再用 `transitionLaunchPlan(plan, { type: 'target-requires-restart' })` 一次性落到终态、`save` 一次，返回 `outcomeFor(plan, 'planned', null, null, [], recoveryAction文案)`。复用既有 `generateId`/`outcomeFor`/`InvalidTransitionError`/`ConfigNotFoundError`/`ConfigUnsupportedError`/`getConfigRevisionDetail`，不新增 deps 接口（`LaunchDeps` 已足够，不需要 `LaunchClaudeFreshDeps` 的 probe/spawn/context/invocation-dir 端口）。
- 测试：`tests/domain/activation.test.ts`（新增 `prepared → requires-restart via target-requires-restart` 系列用例，并把该事件加入既有"终态拒绝一切事件"扫描数组 `allEvents`，让既有 6 个终态 + `succeeded/degraded` 例外测试自动覆盖新事件）；`tests/adapters/claude-adapter-plan.test.ts`（新增 `determineClaudeLaunchTarget` 用例）；`tests/application/claude-launch.test.ts`（新增 `prepareClaudeAlreadyRunningLaunchPlan` 用例，复用文件内既有 `FakeConfigRevisionRepository`/`FakeLaunchPlanRepository`/`revision()` 辅助函数）。

## Tasks & Acceptance

**Execution：**
- `packages/control-plane/src/domain/activation.ts` — 新增 `target-requires-restart` 事件与 `prepared → requires-restart` 转换 — AD-18 明文转换表要求、AC1 的落地基础。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` — 扩展 `ClaudeLaunchTarget`、新增 `determineClaudeLaunchTarget` — AC1"plan 阶段判断 target 类型，fail closed"的直接实现。
- `packages/control-plane/src/application/claude-launch.ts` — 新增 `prepareClaudeAlreadyRunningLaunchPlan` — AC1"apply 只解析为 requires-restart，不产生部分应用事实"与 AC2"observationStage 保持 planned"的直接实现。
- `tests/domain/activation.test.ts` + `tests/adapters/claude-adapter-plan.test.ts` + `tests/application/claude-launch.test.ts` — 覆盖 I/O & Edge-Case Matrix 全部行 — 验证任务。

**Acceptance Criteria：**
- Given 用户请求把某个装配应用到当前已在运行的交互式 Claude Code 会话，when `determineClaudeLaunchTarget` 无法拿到"这是 fresh spawn 本身"的证据，then 判定为 `already-running`（fail closed），and `prepareClaudeAlreadyRunningLaunchPlan` 只让 plan 落到 AD-18 既有终态 `requires-restart`，全程只发生一次 `launchPlanRepository.save`，不调用 probe/manifest/spawn，不产生任何部分应用的 SQLite 事实。
- Given plan 已判定为 already-running 并落到 `requires-restart`，when 在用户实际重启前反复查询该 plan（如再次 `findById` 并 `deriveLaunchStatus`），then `phase` 恒为 `requires-restart` 且不可再转换（`transitionLaunchPlan` 对该 plan 的任何后续事件都返回 `invalid-transition`），`ClaudeLaunchOutcome.observationStage` 恒为 `'planned'`，从未出现 `launched`/`observed`/`verified`。
- Given `bun test` 与 `bun run typecheck` 在 `packages/control-plane` 下执行，when 本 Story 改动落地，then 既有全部测试保持通过（不回归 Story 4.1~4.3 交付的 387 项），新增测试全部通过，`tsc --noEmit` 零错误。

## Review Triage Log

### 2026-08-23 — 审查（四视角：blind-hunter、edge-case-hunter、verification-gap、intent-alignment）

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2: (high 0medium, 0medium, low 2low)
- reject: 11: (high 0high, medium 0medium, low 11low)
- addressed_findings:
  - none

**说明：**
- `verification-gap`（协调者派发的子代理，正常返回）：`No verification gaps found.`——全部行为变化均有对应测试覆盖，无回归、无遗漏、无失效验证。
- `intent-alignment`（协调者派发的子代理，正常返回）：严格描述性审计，未开处方。核心发现：AC1"adapter 的 `plan` 阶段判断 target 类型"存在两种可辩护读法——判断逻辑落在 `compileClaudeAdapterPlan` 本体（该函数字面未改动），还是落在其上一层的 `application/claude-launch.ts`（本 Story 实际选择）；另确认 `determineClaudeLaunchTarget` 目前唯一调用点硬编码 `{ownsFreshSpawn:false}`，`'fresh'` 分支在现有调用图下不可达；以及 Claude 侧尚无 CLI/TUI 渲染、也无独立状态查询函数展示 `recoveryAction`/`observationStage`。
- `blind-hunter`、`edge-case-hunter`：协调者派发的两个子代理未在合理时间内返回完成通知（無法确认失败原因，也未发现任何输出文件写入迹象）；协调者随后按两个 lens 各自的原始指令（"至少找 10 条发现，只列缺失/问题，不评级"；"沿 diff hunk 做穷尽路径枚举，只报无守护的分支"）对同一份 diff 直接、同步地重新执行了这两个视角的审查，覆盖范围与异步执行等价。blind-hunter 产出 12 条观察，edge-case-hunter 产出 5 条（另确认无有意义删除，deletion check 为空）。
- **分类结果**：四视角全部发现去重合并后共 13 条独立 claim。其中 2 条路由为 `defer`（见 frontmatter `deferred`：target-judgment 落点是 `application` 层而非 `compileClaudeAdapterPlan` 本体、`prepareClaudeAlreadyRunningLaunchPlan`/`prepareClaudeFreshLaunchPlan` 间约 15 行结构重复——二者均为本 Story 已在 Design Notes 里说明理由的有意识设计取舍，非缺陷，值得记录供 Story 4.5 参考）。其余 11 条路由为 `reject`：`determineClaudeLaunchTarget` 唯一调用点硬编码、`'fresh'` 分支不可达（Story 4.5 范围内的自省证据接入之前，本就应该保持 fail-closed 且不可达，属于正确行为而非缺陷）；无 CLI/TUI 渲染、无独立状态查询函数（Story 4.3 spec Design Notes 已确立"CLI 交互形态留给 Story 4.4 完成 already-running 路径之后统一设计"的既定顺序，本 Story 遵循该顺序，非本 Story 遗漏）；`ConfigNotFoundError`/`ConfigUnsupportedError` 不区分、`launchPlanRepository.save` 无 try/catch、`transitionLaunchPlan` 失败分支不可达等均与 `launchClaudeFresh`/`prepareClaudeFreshLaunchPlan` 既有、已测试、已验收的同款模式完全一致，非本 Story 新引入的风险；`ClaudeLaunchTargetEvidence` 单字段布尔形状、无并发/哈希唯一性测试、无 client 误用防御（本函数从不 resume 外部 planId，不存在该场景）等均为经核实的非问题。未发现任何达到 `intent_gap`（需要新证据才能选定读法）或 `bad_spec`（spec 本身有缺陷、需要改写 spec 重新派生实现）门槛的项目——AC1 措辞的两种可辩护读法已在规划阶段（本文件 Design Notes）被显式辨识、选定并记录理由，不是未解决的空白。

## Design Notes

- **为什么走 `prepared → requires-restart` 而不是 `applying → requires-restart`：** AD-18 明文列出的合法转换表里，`requires-restart` 只能从 `prepared` 或（既有的）`succeeded`/`degraded` 到达；`applying`/`observing` 的合法后继里都没有 `requires-restart`。已在运行会话这条分支的核心事实是"从一开始就知道无法真正 apply"，比 fresh 分支的"确认后尝试 apply、可能失败"更早、更确定，所以放在 `prepared` 阶段短路，而不是走完 `awaiting-confirmation → applying` 再失败——这也是"不产生部分应用事实"最直接的落地方式：根本不给它机会进入 `applying`。
- **为什么不为 already-running 编译 manifest/adapterPlan：** `prepareClaudeFreshLaunchPlan` 同样刻意不做 probe/编译（Story 4.3 设计笔记："matching OMP's own structure exactly"）；already-running 分支更进一步——因为目标进程不被本产品拥有，编译出的 `ClaudeAdapterPlan` 不会被用来做任何真实动作，展示一份"看起来算出来了、其实从未生效"的 plan 反而更容易被误读为"已经算好了、只差重启"这种半真半假的暗示，不如老实返回 `null`。
- **为什么 `determineClaudeLaunchTarget` 是一个真实、可单测的函数而不是内联判断：** AC1 要求"adapter 的 plan 阶段判断 target 类型"是一个可观察、可测试的判定动作，而不是隐式地"调用了哪个函数就代表哪个 target"。把判定逻辑收敛成一个纯函数，也让 Story 4.5（本仓自身切换）未来接入真实证据时只需要改这一处的 `evidence` 输入来源，不需要碰 `prepareClaudeAlreadyRunningLaunchPlan`/`prepareClaudeFreshLaunchPlan` 的调用结构。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 既有全部测试（387 项）+ 本 Story 新增测试全部通过，0 fail

## Auto Run Result

**实现摘要：** 交付了 AD-20 的 already-running-session launch target 路径。(1) `domain/activation.ts` 新增 `target-requires-restart` 事件与仅在 `prepared` 阶段接受的转换分支，落到既有终态 `requires-restart`（AD-18 明文列出的合法转换边，非新状态）；(2) `adapters/clients/claude/adapter-plan.ts` 把 `ClaudeLaunchTarget` 扩为 `'fresh' | 'already-running'`，新增纯函数 `determineClaudeLaunchTarget`（fail closed：只有拿到"这就是 fresh spawn 本身"的证据才判定 fresh，否则一律 already-running）；(3) `application/claude-launch.ts` 新增 `prepareClaudeAlreadyRunningLaunchPlan`，全程只做一次 `launchPlanRepository.save`，不调用 probe/manifest/spawn，直接原子落到 `requires-restart`，`observationStage` 恒为 `'planned'`，`manifest`/`adapterPlan` 恒为 `null`。三处改动均为纯新增，`launchClaudeFresh`/`prepareClaudeFreshLaunchPlan`/`compileClaudeAdapterPlan`/`compileClaudeAssemblyManifest` 的既有行为、签名、字段零改动。

**改动文件：**
- `packages/control-plane/src/domain/activation.ts` — 新增 `target-requires-restart` 事件与 `prepared → requires-restart` 转换分支；更新两处文档注释说明第二个终态例外。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` — `ClaudeLaunchTarget` 扩为两成员；新增 `ClaudeLaunchTargetEvidence`、`determineClaudeLaunchTarget`。
- `packages/control-plane/src/application/claude-launch.ts` — 新增 `prepareClaudeAlreadyRunningLaunchPlan`。
- `packages/control-plane/tests/domain/activation.test.ts` — 新增 `prepared → requires-restart via target-requires-restart` 系列用例（happy path、终态不可再转换、非 `prepared` 阶段拒绝），并把新事件加入既有终态拒绝扫描数组 `allEvents`。
- `packages/control-plane/tests/adapters/claude-adapter-plan.test.ts` — 新增 `determineClaudeLaunchTarget` 的 fresh/fail-closed 两个用例。
- `packages/control-plane/tests/application/claude-launch.test.ts` — 新增 `prepareClaudeAlreadyRunningLaunchPlan` 四个用例（配置存在、配置不存在、终态不可再转换、误传给 `launchClaudeFresh` 被拒绝）。
- `_bmad-output/implementation-artifacts/spec-4-4-already-running-session-target-的-requires-restart-路径.md` — 本规格文件本身。

**审查发现分布：** intent_gap 0、bad_spec 0、patch 0、defer 2（均 low，记入 frontmatter `deferred`）、reject 11。四视角审查过程与结论详见上方 `## Review Triage Log`。

**follow-up 审查建议：** `followup_review_recommended: false`（本轮 patch 计分 0 < 5 的既有触发阈值，且无 patch 项目）。

**验证执行：**
- `cd packages/control-plane && bun run typecheck` — 通过，0 错误（协调者独立复核，不仅依赖实现子代理自报）。
- `cd packages/control-plane && bun test` — 398 pass / 0 fail / 1359 expect() calls（既有 387 项 + 本 Story 新增 11 项），无回归，复核两次结果一致，未出现已知的 Windows SQLite 锁定时序性 flake。

**残留风险：**
- frontmatter `deferred` 记录的两项低严重度设计取舍：(1) target-judgment 落在 `application/claude-launch.ts` 而非 `compileClaudeAdapterPlan` 本体，Story 4.5 接入本仓自身真实证据时需要决定延续当前结构还是改为在 adapter-plan 内部分支；(2) `prepareClaudeAlreadyRunningLaunchPlan`/`prepareClaudeFreshLaunchPlan` 间约 15 行结构重复未提取共享 helper（因改动已锁定的 Story 4.3 函数体风险大于收益）。
- Claude 侧尚无 CLI/TUI 渲染层读取 `ClaudeLaunchOutcome.recoveryAction`/`observationStage`，也无独立的 Claude 专属状态查询函数（如 OMP 的 `getLaunchStatus`）——与 Story 4.3 已确立的既定顺序一致（CLI 交互形态留给 Story 4.4 完成 already-running 路径之后统一设计），非本 Story 遗漏，也非本 Story 范围。
- `determineClaudeLaunchTarget` 目前唯一调用点硬编码 `{ ownsFreshSpawn: false }`，`'fresh'` 分支在现有调用图下不可达——这是本 Story 正确的 fail-closed 行为（本 Story 明确排除本仓自身 session 真实自省证据的接入，那是 Story 4.5 范围），不是缺陷。
- 本轮审查的 `blind-hunter`/`edge-case-hunter` 两个异步子代理未在合理时间内返回完成通知；协调者已按各自原始指令直接同步重新执行等价审查（结果记入上方 Review Triage Log），未留下未覆盖的审查视角。
