---
title: 'configs CLI 的 Claude 入口'
type: 'feature'
created: '2026-08-24'
status: 'done'
baseline_revision: '482843af5ce28b2422c9767fecec0036b2f47389'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-fresh-target-的启动与观察.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-4-already-running-session-target-的-requires-restart-路径.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5b-claude-adapter-内容物化能力.md'
warnings: []
deferred:
  - summary: >-
      prepareLaunchPlan/launchOmp 从未校验 plan.client === 'omp'——resolveClientSupport('claude-code')
      翻转为 true 后，失去了一层间接防护（此前完全依赖它恒为 false）；任何未来直接调用
      prepareLaunchPlan(deps, {client:'claude-code'}) 的路径都可能构造出一个被 launchOmp
      静默当成 OMP 处理的、标签错误的 plan。
    evidence: |-
      application/claude-launch.ts 顶部注释已承认 launchOmp"has the same latent gap"（Story 4.3
      就已记录）；本 Story 只是移除了一层从未被真正强制过的间接假设，修复需要改动 OMP 侧代码
      （launchOmp 本身），超出本 Story 的 Never 边界。CLI 层面本身是安全的：dispatch 现在按
      client === 'claude-code' 严格分派到 runClaudeLaunchFlow，OMP 路径不会被真实调用触发。
    location: 'packages/control-plane/src/application/launch.ts'
    severity: medium
  - summary: >-
      runClaudeLaunchFlow 内多处 IO 调用（detectVersion、readYesNo、rejectLaunchPlan、
      confirmLaunchPlan、launchClaudeFresh、确认前预览用的 probe+compile）没有包 try/catch。
    evidence: |-
      核实后这与 runLaunchFlow 对等位置的既有写法完全一致（OMP 侧同样不包这几处），是本仓已确立的
      既有约定，不是本 Story 引入的新回归。
    location: 'packages/control-plane/src/cli/index.ts'
    severity: low
  - summary: >-
      缺少"已有 active plan（succeeded/degraded）+ 目标 revision id 不存在"这一组合场景的测试覆盖。
    evidence: |-
      prepareClaudeAlreadyRunningLaunchPlan 对 revision 查找失败是 best-effort、不阻塞终态
      （已在 Story 4.4/4.5b 验证过），本 Story 复用该行为，只是从未专门为这个组合写过集成测试。
    location: 'packages/control-plane/tests/integration/cli-claude-launch.test.ts'
    severity: low
  - summary: >-
      确认前预览（probe+compile）已经判定 blocked 时，CLI 仍然照常展示确认提示，不会提前告知用户
      "这次大概率会失败"，要等确认后 launchClaudeFresh 真正跑一遍才会失败。
    evidence: |-
      设计上就不信任预览快照（Design Notes 已说明 launchClaudeFresh 会重新 probe/compile 一次），
      这是有意的取舍而非缺陷，但用户体验上仍有优化空间，记录以备将来考虑短路确认步骤。
    location: 'packages/control-plane/src/cli/index.ts'
    severity: low
  - summary: >-
      usageLine()/CLI 帮助文案没有标注哪些 --client 值当前真实可用（omp、claude-code）、哪些仍不
      支持（codex-cli）——用户只能靠实际尝试或读文档知道。
    evidence: |-
      USAGE_SYNTAX 仍是本 Story 之前就有的通用 [--client <id>] 占位写法，未随本 Story 更新为
      枚举可用值；不在本 Story 的 Code Map 范围内，帮助文案改进留给后续需要时处理。
    location: 'packages/control-plane/src/cli/index.ts'
    severity: low
---

<intent-contract>

## Intent

**Problem：** `resolveClientSupport('claude-code')` 硬编码返回 `unsupported`；`configs` CLI 没有任何入口能调用 Story 4.1～4.5b 交付的 Claude adapter，这些代码目前只被测试直接调用。

**Approach：** 把 `resolveClientSupport('claude-code')` 改为 `supported: true`（域层保持纯函数、不做真实探测——真实的 fail-closed 探测已经在 `compileClaudeAssemblyManifest` 阶段发生，域层这里只是打开产品级"这个客户端存在受支持路径"的开关，与 `'omp'` 的既有处理方式完全对称）；在 `cli/index.ts` 新增 `runClaudeLaunchFlow`，结构上镜像既有 `runLaunchFlow`，但调用 Story 4.3～4.5b 交付的 Claude 专用函数；`use`/`switch` 按既有 `client` 参数分派到 OMP 或 Claude 分支，不改变 OMP 侧任何行为。

## Boundaries & Constraints

**Always：**
- `resolveClientSupport('claude-code')` 改为 `{ supported: true }`，不带 `reason` 字段（与 `'omp'` 完全对称）；`'codex-cli'` 保持原样不支持。
- `configs use --client claude-code`/`configs switch --client claude-code`：先查 `deps.launchPlanRepository.findActiveForClient('claude-code')`——若已有 active plan，视为"目标是已在运行、非本次调用拥有的会话"，走 `prepareClaudeAlreadyRunningLaunchPlan`（Story 4.4），不经过确认步骤，直接渲染 `requires-restart` 结果；若没有 active plan，走 fresh 路径：`prepareClaudeFreshLaunchPlan` → 一次性确认 → `confirmLaunchPlan` → `launchClaudeFresh`（Story 4.3/4.5b）。
- fresh 路径确认前的预览：调用一次 `deps.claudeCapabilityProbe.probeHardControlCapabilities()` + `compileClaudeAssemblyManifest(revision, probeResults)` 产出预览用的 `capabilityPolicy`/`degradedCapabilities`（只读、不做内容物化），转成字符串数组传给既有 `renderConfirmationSummary`（该函数已是客户端中立签名，直接复用，不新增 Claude 专属 render 函数）；确认后 `launchClaudeFresh` 会再次探测并编译（与 prepare 阶段重复一次 probe，可接受——`launchClaudeFresh` 设计上从不信任外部传入的探测快照）。
- 最终状态展示复用既有 `getLaunchStatus`/`renderLaunchStatus`（两者已是 `LaunchDeps`/`Fact<string>` 级别的客户端中立签名，只需传入 `deps.claudeProcessPort.detectVersion()` 作为 `clientVersion`），不新增 Claude 专属状态渲染。
- `FullDeps`/`openDeps()` 扩展出 `claudeProcessPort`/`claudeCapabilityProbe`/`claudeLaunchContextWriter`/`claudeInvocationDirPort` 四个字段，复用 Story 4.1～4.3 已有的具体适配器类（`BunClaudeProcessPort`、`BunClaudeCapabilityProbe`、`FsClaudeLaunchContextWriter`、`FsClaudeInvocationDirPort`），与既有 `ompPort`/`capabilityProbe`/`contextWriter` 同级并列构造（构造这些对象本身无副作用，不是打开 DB 连接）。

**Block If：** 无。

**Never：**
- 不改变 OMP 侧 `use`/`switch`/`runLaunchFlow` 既有行为、既有渲染文案或既有测试断言的结果。
- 不修改 `prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`/`prepareClaudeAlreadyRunningLaunchPlan`/`compileClaudeAssemblyManifest`/`compileClaudeAdapterPlan`/`materializeClaudeContent` 的既有签名或行为（Story 4.1～4.5b 已锁定）。
- 不追求跨客户端配置或 Session 等价；不为 Claude 新建一套平行的 render/status 函数——凡是既有函数签名已经客户端中立的，直接复用。
- 不涉及 `codex-cli`。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 无 active Claude plan，真实 `.cap/` 修订 | `configs use <id> --client claude-code --yes` | fresh 路径完整走通：预览、确认、`launchClaudeFresh` 真正 spawn，成功后展示状态 | 探测/物化失败时按既有 fail-closed 展示，退出码 1 |
| 已有 active Claude plan | `configs switch <id> --client claude-code --yes` | 直接展示 `requires-restart`，不经过确认、不 spawn | 无（这本身就是预期结果，不是错误） |
| 配置修订不存在/不受支持 | `configs use <bad-id> --client claude-code` | 复用既有 `renderQueryFailure`/`renderLaunchFailure`，退出码 1 | 与 OMP 侧一致 |
| 用户拒绝确认 | fresh 路径，未传 `--yes` 且交互式拒绝 | `rejectLaunchPlan`，展示失败，退出码 1 | 与 OMP 侧一致 |
| `configs use <id> --client omp` | 既有 OMP 路径 | 行为与本 Story 落地前完全一致 | 回归测试覆盖 |

</intent-contract>

## Code Map

- `packages/control-plane/src/domain/client.ts:26-34` -- `resolveClientSupport`：`'claude-code'` 分支改为 `return { supported: true }`，`'codex-cli'` 保持不变。
- `packages/control-plane/src/cli/index.ts:399-460` -- `FullDeps`/`openDeps()`：新增四个 Claude 端口字段，构造方式对齐既有 OMP 字段。
- `packages/control-plane/src/cli/index.ts:467-563` -- `runLaunchFlow`（既有，OMP-only，不修改）旁新增 `runClaudeLaunchFlow`，镜像其结构：`findActiveForClient` 判断 target → already-running 分支直接调用+渲染 `prepareClaudeAlreadyRunningLaunchPlan` 的结果 → fresh 分支 `prepareClaudeFreshLaunchPlan` → probe+编译预览 → `renderConfirmationSummary` → 确认 → `confirmLaunchPlan` → `launchClaudeFresh` → `getLaunchStatus`/`renderLaunchStatus`。
- `packages/control-plane/src/cli/index.ts` 中 `use`/`switch` 命令的 dispatch 处（`case 'use':`/`case 'switch':` 附近）-- 按 `parsed.client === 'claude-code'` 分派到 `runClaudeLaunchFlow`，否则走既有 `runLaunchFlow`。
- `packages/control-plane/src/application/claude-launch.ts` -- `prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`/`prepareClaudeAlreadyRunningLaunchPlan`（Story 4.3/4.4/4.5b 已交付，直接复用，不修改）。
- `packages/control-plane/src/adapters/clients/claude/assembly-manifest.ts` -- `compileClaudeAssemblyManifest`（复用于确认前预览）。
- `packages/control-plane/src/application/launch.ts:89,366` -- `LaunchStatusDeps`/`getLaunchStatus`：确认已是客户端中立签名，直接复用。
- `packages/control-plane/src/cli/render.ts:359-385` -- `renderConfirmationSummary`：确认已是客户端中立签名（`plan`/`revision`/`Fact<string>`/`string[]`/`string[]`），直接复用。
- `packages/control-plane/tests/integration/cli.test.ts`（或既有等价集成测试文件）-- 扩展覆盖 I/O 矩阵全部行。
- `packages/control-plane/tests/application/launch.test.ts` -- 回归断言：OMP 侧行为不受影响。

## Tasks & Acceptance

**Execution：**
- `src/domain/client.ts` -- 翻转 `resolveClientSupport('claude-code')` -- 打开产品级开关。
- `src/cli/index.ts` -- 扩展 `FullDeps`/`openDeps()`，新增 `runClaudeLaunchFlow`，接入 `use`/`switch` dispatch -- CLI 真实入口。
- 对应测试 -- 覆盖 I/O 矩阵 + OMP 回归。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 标记 `4-6-configs-cli-的-claude-入口: done`。

**Acceptance Criteria：**
- Given 用户在 `configs` CLI 执行 `use <id> --client claude-code` 或 `switch <id> --client claude-code`，when `resolveClientSupport('claude-code')` 返回真实支持状态而非硬编码 unsupported，then 命令真实触发新 adapter 的 fresh/already-running 判定与对应生命周期（复用 Story 4.3/4.4/4.5b 已实现的逻辑），成功路径经 Story 4.5b 的内容物化真实交付 Instructions/Skills/MCP。
- Given Story 4.1 的探测结果对某个必需硬控制能力返回 `unsupported`/`unknown`，或 Story 4.5b 的内容物化对某个必需引用 fail-closed，when 用户执行 `configs use/switch --client claude-code`，then CLI 显示失败发生阶段、受影响能力、已知原因与恢复动作，不伪造成功。
- Given `bun test`、`bun run typecheck` 在 `packages/control-plane` 下执行，then 既有全部测试保持通过（不回归 Story 4.1～4.5b 交付的 ~441 项，含 OMP 侧既有 `use`/`switch` 测试逐字不变），新增测试全部通过，`tsc --noEmit` 零错误。

## Review Triage Log

### 2026-08-24 — Review pass（四视角并行：blind-hunter、edge-case-hunter、verification-gap、intent-alignment）

- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 2, medium 2, low 0)
- defer: 5 (medium 1, low 4)
- reject: 4 (low 4)
- addressed_findings:
  - `[high]` `[patch]`（verification-gap）`findActiveForClient` 按其自身文档"返回最近一条 plan，不论 phase"——`runClaudeLaunchFlow` 从未校验 `active.phase`，任何一次失败/被拒绝的 launch 都会在其之后的每一次调用里被永久误判为"已在运行"，永远走不到真正的 fresh 启动。OMP 侧的等价分支（`requestConfigSwitch`）内部通过 `transitionLaunchPlan` 的 `switch-requested` 事件校验 phase 必须是 `succeeded`/`degraded`，非法 phase 时 `InvalidTransitionError` 触发回退到普通 `prepareLaunchPlan`——`runClaudeLaunchFlow` 完全没有这一层校验。已修复：只有 `active.phase` 为 `succeeded`/`degraded` 时才短路进 already-running 分支，否则落入 fresh 路径（与 OMP 分支同一判断依据，本 spec 的 Design Notes 措辞不够精确是根因，已一并修订）。
  - `[high]` `[patch]`（blind-hunter）`runClaudeLaunchFlow` 的失败渲染只调用 `renderLaunchFailure(outcome.plan)`，丢弃了 `ClaudeLaunchOutcome` 自带的、按失败类型定制的 `recoveryAction`/`affectedCapabilities`——直接违反本 spec 自己的 AC2（"CLI 显示失败发生阶段、受影响能力、已知原因与恢复动作"）。已修复：失败路径改为展示 `outcome.recoveryAction`/`affectedCapabilities`，不再只用通用静态文案。
  - `[medium]` `[patch]`（blind-hunter + edge-case-hunter + verification-gap，三方独立重复发现）`--client claude-code` 与 `-- <forwardedArgs>` 组合时，denylist 校验照常通过、`ParsedCommand.forwardedArgs` 正常解析，但 `runClaudeLaunchFlow` 从未接收也从未使用这个字段——用户传入的转发参数被静默丢弃，没有任何提示。`ClaudeSpawnParams`/`launchClaudeFresh` 目前也没有转发参数的交付通道，不能像 OMP 一样直接透传。已修复：`parseUseOrSwitch`/dispatch 层在 `client === 'claude-code'` 且 `forwardedArgs` 非空时返回类型化 usage 错误，明确告知转发参数目前不支持，而不是静默丢弃。
  - `[medium]` `[patch]`（blind-hunter）OMP 回归测试（`describe('configs use --client omp (regression)')`）只断言退出码为 1，不断言失败原因文本——如果未来 dispatch 逻辑出 bug 把 `--client omp` 误路由到 Claude 分支，这条测试仍可能"碰巧"以退出码 1 通过，起不到回归防护作用。已修复：补充对失败文本的具体断言。
  - `defer`（5，均为与本 Story 现有既定模式一致的既有缺口，非本轮新增回归）：`prepareLaunchPlan`/`launchOmp` 从未校验 `plan.client === 'omp'`，`resolveClientSupport('claude-code')` 翻转后失去了一层间接防护——`launchOmp` 自身这个 latent gap 是 Story 4.3 注释里已经承认的既有问题，修复需要改动 OMP 侧代码，超出本 Story 的 Never 边界（medium，值得作为独立 epic 级 action item 跟踪）；`runClaudeLaunchFlow` 内多处 IO 调用（`detectVersion`/`readYesNo`/`rejectLaunchPlan`/`confirmLaunchPlan`/`launchClaudeFresh`/预览用的 probe+compile）未包 try/catch——核实后这与 `runLaunchFlow` 自己对等位置的既有写法完全一致（OMP 侧同样不包这几处），不是本 Story 引入的新回归；缺少"已有 active plan + 不存在的 revision id"组合的测试覆盖；确认前预览已经判定 blocked 时仍然照常展示确认提示，不提前告知用户"这次大概率会失败"（设计上就不信任预览快照，属已知取舍非缺陷，仍记录为可优化项）；`usageLine()`/CLI 帮助文案未标注哪些 `--client` 值当前真实可用。
  - `reject`（4，均记录理由未改代码）：`domain/client.ts` 新注释措辞与 epics.md AC1"改为真实探测结果"字面不完全一致——spec 自己的 Design Notes 已经明确论证这是有意为之（域层保持纯函数，真实探测在 `compileClaudeAssemblyManifest` 阶段发生），不是缺陷；本轮改动的文档注释偏长、带故事编号引用——与本仓 Epic 1～4 全程已确立的注释风格一致，非本 Story 独有问题；`findActiveForClient` 是否会混淆 active OMP plan 与 active Claude plan——该函数按 `client: ClientId` 参数过滤查询，结构上已经隔离，不存在混淆风险，纯属虚惊；"确认前预览没有单独测试断言其具体文案"——`intent-alignment` 发现的描述性观察，非缺陷，预览的存在性与最终结果已被现有测试间接覆盖。

## Design Notes

- **为什么 already-running 判断依据是 `findActiveForClient` 而不是新的自省机制：** Story 4.4/4.5 已经确立"本产品无法证明拥有一个已在运行的会话，只能保守地判定 already-running"这一原则；`configs` 自身是否已经为该客户端启动过一个仍处于活跃状态的 plan，是本产品唯一诚实掌握的信号，复用 OMP `switch` 分支已有的同一查询。**2026-08-24 review 修订：** `findActiveForClient` 按其自身文档返回"最近一条 plan，不论 phase"，不能望文生义地当作"真的还在跑"；必须像 OMP 分支一样，只有 `phase` 为 `succeeded`/`degraded` 才视为真的 already-running，其余 phase（`failed`/`cancelled`/`incomplete` 等）落入 fresh 路径——否则一次失败或被拒绝的尝试会把该客户端永久锁死在"需要重启"的误判里，永远走不到真正的重试。
- **为什么确认前预览不调用 `launchClaudeFresh` 内部逻辑，而是单独 probe+compile 一次：** `launchClaudeFresh` 要求 plan 已经处于 `applying` 阶段（确认之后），在确认前调用会破坏其前置条件；`compileClaudeAssemblyManifest` 是纯函数、只需要 probe 结果，可以在确认前安全地单独跑一次做预览，付出的代价只是确认后 `launchClaudeFresh` 会重新 probe 一次——这与 OMP 侧 `runLaunchFlow` 在确认前调用 `detectVersion()`、确认后 `launchOmp` 内部可能再次涉及客户端交互是同一类"prepare 阶段的探测只是预览，真正生效以 apply 阶段为准"的既有模式。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 既有全部测试 + 新增测试全部通过，0 fail

## Auto Run Result

**实现摘要：** `resolveClientSupport('claude-code')` 翻转为 `{ supported: true }`（与 `'omp'` 对称，`'codex-cli'` 不变）；`FullDeps`/`openDeps()` 新增四个 Claude 端口字段（`BunClaudeProcessPort`/`BunClaudeCapabilityProbe`/`FsClaudeLaunchContextWriter`/`FsClaudeInvocationDirPort`）；`cli/index.ts` 新增 `runClaudeLaunchFlow`，结构镜像既有 `runLaunchFlow`：`findActiveForClient('claude-code')` 判断 target（已在 review 补丁中修正为只信任 `succeeded`/`degraded` phase）→ already-running 分支直接渲染 `requires-restart`；fresh 分支 `prepareClaudeFreshLaunchPlan` → 一次只读 probe+`compileClaudeAssemblyManifest` 预览 → 复用既有客户端中立的 `renderConfirmationSummary` → 确认 → `confirmLaunchPlan` → `launchClaudeFresh` → 复用既有客户端中立的 `getLaunchStatus`/`renderLaunchStatus`；`use`/`switch` dispatch 按 `client === 'claude-code'` 分派，OMP 路径逐字不变。全程未新增 Claude 专属 render 函数。

**改动文件：**
- `packages/control-plane/src/domain/client.ts` -- `resolveClientSupport('claude-code')` 翻转。
- `packages/control-plane/src/cli/index.ts` -- `FullDeps`/`openDeps()` 扩展、新增 `runClaudeLaunchFlow`、dispatch 接入、失败路径补充 `recoveryAction`/`affectedCapabilities` 渲染、forwarded-args 对 `claude-code` 的拒绝。
- `packages/control-plane/src/cli/i18n.ts` -- 新增 `claudeFailure.recoveryAction`/`claudeFailure.affectedCapabilities`/`parseError.forwardedArgsUnsupportedForClaude` 中英文键。
- 测试：`tests/domain/client.test.ts`、`tests/application/launch.test.ts`（`codex-cli`-only 收窄）、`tests/cli/tui.test.tsx`（补 Claude fake 端口满足类型）、`tests/integration/cli-launch.test.ts`（同上收窄）、新增 `tests/integration/cli-claude-launch.test.ts`（覆盖全部 I/O 矩阵行 + review 补丁新增用例）。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 标记 `4-6-configs-cli-的-claude-入口: done`。

**审查发现（2026-08-24 review pass，详见上方 Review Triage Log）：** 4 个 patch（2 高、2 中），全部已修复并重新验证；0 个 intent_gap，0 个 bad_spec；5 个 defer（记入 frontmatter `deferred`）；4 个 reject（记录理由，未改代码）。最高严重级发现：`findActiveForClient` 按文档"返回最近一条 plan，不论 phase"，`runClaudeLaunchFlow` 原先从未校验 `active.phase`——一次失败或被拒绝的尝试就会把该客户端永久锁死在"需要重启"的误判里，永远走不到真正重试；已修复为只信任 `succeeded`/`degraded` phase，其余落入 fresh 路径（与 OMP 侧 `requestConfigSwitch` 的既有 phase 校验对齐）。第二高：失败渲染原先丢弃了 `ClaudeLaunchOutcome` 自带的 `recoveryAction`/`affectedCapabilities`，违反本 spec 自己的 AC2；已修复为展示具体恢复指引。

**Follow-up review recommendation：** `true`（本轮 patch 计数含 2 项 high severity，触发规则"任一 patch 为 high 则 true"）。

**验证执行（review 补丁后，最终状态）：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误（协调者独立复核）。
- `cd packages/control-plane && bun test` -- 453 pass / 0 fail / 1684 expect() calls（基线 450 + 本 Story 实现与审查补丁新增 3 项），无回归；协调者独立跑两次，第一次命中已知的 Windows SQLite 并发计时抖动（`cli-establish.test.ts`），重跑后 0 fail，与之前几个 Story 记录的同一抖动一致。

**残留风险：** 见 frontmatter `deferred`（5 项：`prepareLaunchPlan`/`launchOmp` 从未校验 `plan.client === 'omp'`，本 Story 移除了间接防护但 CLI 层面本身安全，修复需要改动 OMP 侧代码，超出本 Story 授权范围，建议作为独立 epic 级 action item 跟踪；其余 4 项均为既有约定的延续或已知设计取舍，非阻塞）。
