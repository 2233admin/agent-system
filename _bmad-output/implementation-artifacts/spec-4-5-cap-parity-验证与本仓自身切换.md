---
title: '.cap/ parity 验证与本仓自身切换'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_revision: 'e413c7f263802d1b0ff08213b2bc2f3058555c19'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-建立-claude-code-adapter-骨架与硬控制能力探测.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-装配-claude-code-的确定性-adapterplan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-fresh-target-的启动与观察.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-4-already-running-session-target-的-requires-restart-路径.md'
warnings: ['oversized']
deferred:
  - summary: >-
      已知差异 (a)（真实 claude --version 与 .cap/runtime/claude.toml 声明版本之间的漂移）目前只在
      测试运行时通过 console.warn 记录，没有任何非测试、可持久查阅的产物承载这一差异，与 Story 4.1
      frontmatter 已记录的同类残留风险完全一致。
    evidence: >-
      claude-cap-parity-verification.test.ts 与 Story 4.1 的
      claude-capability-probe-cap-parity.test.ts 都只用 console.warn 记录版本漂移；本仓当前没有
      CLI/报告面可承载持久化的差异记录。这是 Story 4.1 已确立、本 Story 沿用而非新引入的既有限制。
    location: 'packages/control-plane/tests/adapters/claude-cap-parity-verification.test.ts'
    severity: medium
---

<intent-contract>

## Intent

**Problem：** Story 4.1～4.4 交付了 Claude Code adapter 的 probe/manifest/plan/launch 全链路，但从未把它与 `.cap/` 现有 lock/render 产物做过一次正式、可复现的逐项对照，也从未判断本仓自身这个正在运行的 Claude Code session 能否安全切换装配来源。

**Approach：** (1) 新增一个只读、可复现的 parity 验证测试，跑真实探测 + 真实 `.cap/`（`general`、`agent-assembler`）全链路（`loadCapConfigRevisions` → `compileClaudeAssemblyManifest` → `compileClaudeAdapterPlan`），逐项比对 `.cap/lock.json` 的 `profiles.<role>.inventory` 与 `.cap/runtime/claude.toml` 的 `policy.*`，记录一致项，任何未被预先识别为"已知差异"的差异都判为测试失败；(2) 用真实调用 `prepareClaudeAlreadyRunningLaunchPlan`（Story 4.4）证明本仓自身这个已在运行、非本产品拥有的 session 在当前 adapter 能力下只能解析为 `requires-restart`，据此把 AC2（本仓自身切换）正式记录为阻塞项而不强行执行，`.cap/` 保持完全不变。

## Boundaries & Constraints

**Always：**
- 新增测试必须使用真实 `BunClaudeCapabilityProbe`+`BunClaudeProcessPort`（不是假证据），对真实 `.cap/`（仓库根 `.cap/`，非 fixture）跑完整链路。
- 逐项比对目标固定为：`.cap/lock.json` 的 `profiles.general.inventory`/`profiles.agent-assembler.inventory`（skills/mcps/hooks/plugins 名称集合）与 `.cap/runtime/claude.toml` 的 `policy.permission_mode`/`policy.enable_project_mcp`/`policy.enable_user_assets`。
- 唯二预先识别、允许判为"已知/可接受差异"（不阻塞）的项：(a) 真实 `claude --version` 与 `.cap/runtime/claude.toml` 声明的已核实版本之间的漂移（Story 4.1 已发现）；(b) 新 adapter 的 fresh 启动从不物化 Instructions/Skills/MCP 内容到任何项目级 `.claude/` 目录（只应用三个硬控制 argv 标志），而 `.cap/` 的渲染器会把内容真正写入项目本地 `.claude/skills/`（`.gitignore` 的 `.cap-rendered/`、`.claude/skills/openspec-*/` 条目为证）。除这两项外的任何差异必须让测试失败，不得被静默接受。
- 必须真实调用一次 `prepareClaudeAlreadyRunningLaunchPlan`（用从真实 `.cap/` 派生的 revisionId），把其返回的 `requires-restart`/`observationStage:'planned'`/`manifest:null`/`adapterPlan:null` 作为 AC2 阻塞决定的可执行证据，而不仅是叙述性论证。
- 本 Story 的 spec 文件本身必须包含"`.cap/` 实际发生了什么改动、为什么安全或为什么 AC2 被推迟"的明确小节，写给未参与本轮对话的人独立判断安全性。

**Block If：**
- 若真实运行发现任何不属于上述两项已知差异的其它差异，HALT 并把差异内容和证据列为阻塞条件（不得自行归类为"可接受"）。

**Never：**
- 不修改、删除、重命名 `.cap/` 目录下任何文件；只读访问。
- 不新增任何把 manifest/plan 内容写入项目 `.claude/` 目录或任何 native 配置面的能力（那等价于实现 AC2 的执行路径，超出本 Story 已认定的安全边界）。
- 不修改 `compileClaudeAssemblyManifest`/`compileClaudeAdapterPlan`/`launchClaudeFresh`/`prepareClaudeFreshLaunchPlan`/`prepareClaudeAlreadyRunningLaunchPlan`/`determineClaudeLaunchTarget` 的既有字段、签名或行为（Story 4.1～4.4 已锁定并测试）。
- 不触碰 `domain/client.ts`、`resolveClientSupport`。
- 不推进或解锁 Story 4.6（退役 `.cap/` 本体）；本 Story 完成后 Story 4.6 仍然被 AC2 未稳定切换这一事实阻塞。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 二进制可达，两个真实 profile 全链路比对 | `.cap/`（`general`/`agent-assembler`）+ 本机真实 `claude` | 相关 capability 状态均为 supported/degraded（非 unsupported/unknown）；manifest 的 skills/mcp 引用集合与 `lock.json` inventory 完全一致 | 任一相关能力 unsupported/unknown 或引用集合不一致即测试失败 |
| 二进制不可达 | `Bun.which('claude')` 为 `null` | 探测全 `unknown`；测试诚实记录，跳过 supported/degraded 断言，仍断言引用集合的结构一致性 | 不伪造 supported |
| 版本漂移 | 真实 `claude --version` ≠ `.cap` 声明版本 | 记为已知差异（`console.warn`），不阻塞 | 不静默丢弃 |
| 已在运行 session 自检 | `prepareClaudeAlreadyRunningLaunchPlan(deps, {revisionId: 真实 general revisionId})` | `requires-restart`/`observationStage:'planned'`/`manifest:null`/`adapterPlan:null` | 该结果本身就是 AC2 阻塞的证据，不是失败 |
| 出现未预期的第三类差异 | 例如某相关能力真实为 `unsupported` | 测试失败，暴露真实回归而非静默通过 | 不归类为"已知差异" |

</intent-contract>

## Code Map

- `packages/control-plane/src/adapters/sources/cap-fs.ts` -- `loadCapConfigRevisions(capRoot)`：既有只读加载器，直接复用，不修改。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts` -- `BunClaudeCapabilityProbe`（Story 4.1）：本 Story 用真实实例产出真实探测证据，不修改。
- `packages/control-plane/src/adapters/clients/claude/process-port.ts` -- `BunClaudeProcessPort`（Story 4.1/4.3）：真实进程调用，不修改。
- `packages/control-plane/src/adapters/clients/claude/assembly-manifest.ts` -- `compileClaudeAssemblyManifest`（Story 4.2）：直接调用，不修改。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` -- `compileClaudeAdapterPlan`（Story 4.3）：直接调用，不修改。
- `packages/control-plane/src/application/claude-launch.ts` -- `prepareClaudeAlreadyRunningLaunchPlan`（Story 4.4）：本 Story 用真实 `.cap` 派生 revisionId 发起一次真实调用作为 AC2 阻塞的直接证据；不修改此文件。
- `.cap/lock.json` -- 只读比对目标：`profiles.general.inventory`、`profiles.agent-assembler.inventory`（skills/mcps/hooks/plugins 名称集合）。
- `.cap/runtime/claude.toml` -- 只读比对目标：`policy.permission_mode`/`policy.enable_project_mcp`/`policy.enable_user_assets`。
- `packages/control-plane/tests/adapters/claude-capability-probe-cap-parity.test.ts` -- Story 4.1 先例（裸探测结果 vs `.cap/runtime/claude.toml`）：并列存在，不修改，不重复其断言。
- `packages/control-plane/tests/adapters/claude-assembly-manifest.test.ts:283-317` -- 既有"真实 `.cap/` 两 profile 编译"测试，但用全 supported 假探测结果；本 Story 新测试改用真实探测，是同一场景的真实环境补强，不修改此文件。
- `packages/control-plane/tests/application/claude-launch.test.ts` -- Story 4.4 先例：`FakeConfigRevisionRepository`/`revision()` 辅助写法，本 Story 新测试复用同款构造。
- `.gitignore` -- 只读证据：`.cap-rendered/`、`.claude/skills/openspec-*/` 条目证明 `.cap` 真实渲染目标是项目本地 `.claude/skills/`；不修改。

## Tasks & Acceptance

**Execution：**
- `packages/control-plane/tests/adapters/claude-cap-parity-verification.test.ts` -- 新增：真实探测 + 真实 `.cap/` 全链路逐项比对 `lock.json` inventory 与 `runtime/claude.toml` policy，记录已知差异，其余差异导致失败 -- AC1 的可执行证据。
- 同一新文件内追加：真实调用 `prepareClaudeAlreadyRunningLaunchPlan` 并断言其终态 -- AC2 阻塞决定的可执行证据。
- `_bmad-output/implementation-artifacts/spec-4-5-cap-parity-验证与本仓自身切换.md`（本文件）-- 记录实际运行得到的逐项比对结果与 AC2 阻塞的完整理由、`.cap/` 现状声明。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 把 `4-5-cap-parity-验证与本仓自身切换` 标记 `done`，追加 action item 明确 AC2 阻塞、Story 4.6 仍不可执行。

**Acceptance Criteria：**
- Given 新 adapter 已能对 `.cap/profiles/general.toml`、`.cap/profiles/agent-assembler.toml` 产出 `AdapterPlan`，when 运行本 Story 新增的一次性 parity 验证测试，then 逐项记录一致项与差异项，且任何未被识别为已知差异的差异导致测试失败（不得静默通过）。
- Given parity 验证通过（全部差异均为一致项或已记录的可接受已知差异），when 评估本仓自身切换，then 由于当前 adapter 能力下不存在可以不重启就重配置本仓真实、已在运行 session 装配来源的代码路径（由 `prepareClaudeAlreadyRunningLaunchPlan` 的真实调用结果证实：只能落到 `requires-restart`），AC2 不被强行执行，而是正式记录为阻塞项，`.cap/` 保持完全不变（不删除、不重命名、不禁用、不部分改写任何文件）。
- Given `bun test`、`bun run typecheck` 在 `packages/control-plane` 下执行，then 既有全部测试保持通过（不回归 Story 4.1～4.4 交付的 399 项），新增测试全部通过，`tsc --noEmit` 零错误。

## Review Triage Log

### 2026-08-23 — Review pass（四视角：blind-hunter、edge-case-hunter、verification-gap、intent-alignment；blind-hunter 的异步子代理未在合理时间内返回，由协调者本人直接对同一份 diff 重新执行等价审查）

- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 2, low 5)
- defer: 1 (medium 1)
- reject: 15 (low 15)
- addressed_findings:
  - `[low]` `[patch]`（blind-hunter+edge-case-hunter 重复发现）`readCapLock`/`readCapRuntimeClaudeToml` 原先在 `.cap/lock.json`/`.cap/runtime/claude.toml` 缺失或格式错误时会抛出原始 `SyntaxError`/`ENOENT` -- 改为 try/catch 包裹，抛出点名文件路径与"这是本 Story AC1 证据依赖"的描述性错误（镜像 `claude-capability-probe-cap-parity.test.ts` 既有写法）。
  - `[medium]` `[patch]`（blind-hunter）".cap/ 现状声明" 这一本 Story 最安全关键的断言此前只靠人工跑一次 `git status --porcelain` 支撑 -- 新增 `snapshotFileTree`（递归 SHA-256 逐文件哈希）+ `beforeAll` 起始快照 + 套件末尾专属命名 test 断言前后快照完全一致，把该声明从叙述性升级为自动化、CI 可核验的断言。
  - `[low]` `[patch]`（blind-hunter）AC2 阻塞证据此前只验证了 `general` 一个 profile -- 扩展为遍历真实 `.cap/` 的两个 profile（`general`、`agent-assembler`），对每个都断言 `requires-restart`/`planned`/`null`/`null`。
  - `[low]` `[patch]`（edge-case-hunter）`claude.mcp-project-scope-control` 分支只校验 capability 状态，未像 permission-mode/setting-sources 两项那样校验对应 argv 标志 -- 补充 `adapterPlan.argv.includes('--strict-mcp-config')` 断言（当前两个真实 profile 均无 mcp 引用，此分支尚不可达，但补上后与另两项对称，为未来真实 mcp 场景兜底）。
  - `[medium]` `[patch]`（verification-gap，独立核实 `.github/workflows/control-plane-checks.yml` 确认 CI 未安装 `claude` 二进制）CI 环境下 `binaryPresent` 恒为 `false`，本 Story 相对 Story 4.1 的真正增量断言（manifest/argv/policy 对齐）从未在 CI 实际执行过，且此前没有任何标记区分"CI 命中的浅层分支"与"深度比对已验证" -- 在 `!binaryPresent` 分支补充明确 `console.warn`，并在 spec 残留风险中记录这一点。
  - `[low]` `[patch]`（intent-alignment，描述性发现）spec frontmatter `context:` 列表遗漏 spec-4-2、spec-4-3，而新测试直接调用它们交付的 `compileClaudeAssemblyManifest`/`compileClaudeAdapterPlan` -- 补齐两项引用。
  - `[low]` `[patch]`（intent-alignment，描述性发现）Design Notes 未显式解释"为什么 AC1 的 lock/render 比对不对照实际渲染内容"与"为什么 AC2 证据是通用函数契约而非直接操作真实 session" -- 补充两段落理由（详见下方 Design Notes 新增两条）。
  - `defer`（1，medium，见 frontmatter `deferred`）：已知差异 (a)（版本漂移）仅在测试运行时 `console.warn` 可见，无持久化产物 -- 与 Story 4.1 已确立的同类残留风险一致，非本 Story 新引入，不在本 Story 范围内解决。
  - `reject`（15，均 low，记录理由未改代码）：`CAP_VERIFIED_CLAUDE_VERSION` 常量在本文件与 Story 4.1 锁定的 `claude-capability-probe-cap-parity.test.ts` 间重复（去重需要改动已锁定文件，违反本 Story 自身 Never 边界）；`claude.mcp-project-scope-control` 非空-mcp 分支在真实数据下不可达（结构性限制，已在残留风险中记录，非可修复缺陷）；单个 `test()` 块塞入多个断言维度（bun:test 的逐 `expect()` 失败信息已提供足够的itemization，拆分纯属风格偏好）；AC1"记录一致项与差异项"未做机器可读表格（AC 原文未要求此形式，测试 pass/fail + spec 文档 prose 已构成合理的"记录"）；`argvHasFlagValue` 假设 flag/value 相邻（与 `CAPABILITY_ARGV_MAP` 当前真实形状完全一致，形状变化会导致断言失败而非静默通过）；同一 flag 出现两次的边界情形（`CAPABILITY_ARGV_MAP` 设计上每个 capability 贡献互不相同的 flag，当前不可达）；硬编码 `['agent-assembler','general']` 断言在新增 profile 时会以不相关原因失败（与 Story 4.2 既有测试的既定先例完全一致）；`sprint-status.yaml` 的 action item 是纯 prose、非工具强制阻塞 Story 4.6（与本文件全部其它 action_items 的既定治理约定一致，构建强制机制是独立于本 Story 的工具项目）；`isKnown(outcome.plan.failureReason)` 的"未知态"分支（已读取 `domain/activation.ts` 确认 `withFailure` 对这条转换路径恒定写入 `known(reason)`，该分支在当前实现下不可达）；`Promise.all` 探测调用缺少显式超时处理（`BunClaudeProcessPort` 的 `detectVersion`/`captureHelpText` 已在 Story 4.1 内建超时保护，非本 Story 新增风险）；`Bun.which` 与后续探测调用之间的 TOCTOU 竞态（测试环境下概率可忽略，且后果仅限于一次可重跑的测试失败）；`FakeConfigRevisionRepository.add` 重复 revisionId 静默覆盖、`FakeLaunchPlanRepository.findActiveForClient` 的 tie-break 歧义（均为当前测试用法下不可达的防御性场景，且后者在本文件从未被调用）；intent-alignment 发现的"spec 状态 in-review 与 sprint-status 状态 done 短暂不一致"（审计发生时 review 尚未完成，属于工作流阶段性状态、非缺陷，本轮结束后两者已同步为 `done`）；intent-alignment 提出的"是否应把发现的结构性缺口上报到 Architecture Spine 层面"（任务书已明确授权"Story 级 action item"是本 Story 的正确升级层级，改写 Architecture Spine 属于超出本 Story 授权的范围扩张）。

## Design Notes

- **为什么不做真正的 AC2 切换而是记录阻塞：** `.cap/` 装配本仓自身 session 的真实机制是把内容渲染进项目本地 `.claude/skills/`（`.gitignore` 的 `.cap-rendered/`、`.claude/skills/openspec-*/` 条目为证），而 Story 4.1～4.4 交付的新 adapter 完全没有写入项目 `.claude/` 的能力——`launchClaudeFresh` 只 spawn 一个指向临时隔离目录（`CLAUDE_CONFIG_DIR`）的全新子进程，从不物化 Instructions/Skills/MCP 内容（Story 4.3 Design Notes 已记录：没有已核实的"按名选择 skills"标志）；`prepareClaudeAlreadyRunningLaunchPlan`（Story 4.4）对一个本产品不拥有的会话更保守，直接不做任何计算，只落到 `requires-restart`。本仓自身这个正在维护的 session 正是"本产品不拥有的已在运行会话"——没有第三条路径。唯一能让它切换到新 adapter 的方式是重启，而重启本身就是 AC2 明确禁止的"skill/profile 装配能力中断的时间窗口"。因此按 Architecture Spine 与本 Story 任务书的 CRITICAL SAFETY REQUIREMENT，正确结论是阻塞 AC2、不强行切换，这是本 Story 范围内的完整、有效结果，不是失败。
- **为什么 parity 验证锚定在编译后的 manifest/plan 而不只是裸探测结果：** Story 4.1 已经做过"裸探测结果 vs `.cap/runtime/claude.toml`"的比对（`claude-capability-probe-cap-parity.test.ts`）；本 Story 的增量价值是把比对推进到"新 adapter 对两个真实 profile 实际编译出的 manifest/plan 是否覆盖 `.cap/lock.json` 记录的完整装配意图"，这是 epics.md AC1 字面要求的"产出的能力覆盖范围与 `.cap/` 现有 lock/render 产物逐项比对"，而不是重复 Story 4.1 已做过的检查。

- **为什么 AC1 的"lock/render 产物"比对只对照 `lock.json` 声明的清单，而不对照 `.cap` 实际渲染出的文件内容：** epics.md AC1 原文同时点名"lock"与"render"两类产物。`.cap` 的 render 是独立于 lock.json 的真实概念——把内容真正物化进项目本地 `.claude/skills/`（`.gitignore` 的 `.cap-rendered/`、`.claude/skills/openspec-*/` 条目为证）。但 Story 4.1～4.4 交付的新 adapter 结构上完全没有把内容写入项目 `.claude/` 目录的能力——`launchClaudeFresh` 只 spawn 一个指向临时隔离目录的全新子进程，从不按名物化 Instructions/Skills/MCP 内容（Story 4.3 Design Notes：没有已核实的"按名选择 skills"标志）。要对照实际渲染出的字节内容，唯一方式是让新 adapter 先获得"把内容写进项目 `.claude/`"这一全新能力——这正是本 Story 自己的 `Never` 边界明确禁止臆造的东西（"不新增任何把 manifest/plan 内容写入项目 `.claude/` 目录...的能力"）。因此"对照 `.cap` 已声明的装配清单（lock.json inventory + runtime policy）"是本 Story 唯一可达、不违反自身边界的读法；渲染内容层面的差距本身被诚实记录为已知差异 (b)，而不是被悄悄跳过未提及。
- **为什么 AC2 的阻塞证据是一个通用函数契约测试，而不是直接操作"当前维护本仓的这个 session"本身：** 用户故事原文点名"包括当前维护本仓的这个 session"这一具体、正在运行的进程。但 CRITICAL SAFETY REQUIREMENT 明确禁止对这个真实、正在运行的会话做任何有风险的尝试——任何直接"戳一下"这个真实 session 的验证手段本身就可能是它要防范的中断。因此，唯一安全的证据收集方式是证明一个更通用、已被穷尽测试覆盖的代码契约：`prepareClaudeAlreadyRunningLaunchPlan` 对**任何**"已在运行、非本产品拥有"的目标（`determineClaudeLaunchTarget` 的 fail-closed 语义）都只会解析到 `requires-restart`，而本仓自身这个 session 无可争议地属于这一类目标（它是一个本产品从未 spawn、不拥有生命周期的正在运行的交互式 Claude Code 进程）。用一般性的、已验证的函数契约推导出这个具体 session 的处境，是在不触碰真实 session 本身的前提下能拿到的最强安全证据。
- **`.cap/` 现状声明（写给未参与本轮对话的人）：** 本 Story 落地期间 `.cap/` 目录下**没有任何文件被创建、修改、删除或重命名**——新增的验证测试（`claude-cap-parity-verification.test.ts`）只以 `Bun.file(...).text()`/`loadCapConfigRevisions` 只读方式读取 `.cap/manifest.toml`、`.cap/profiles/*.toml`、`.cap/lock.json`、`.cap/runtime/claude.toml`，从未打开任何写句柄。`git status --porcelain` 在改动落地后只显示两个新增（`??`）文件——本 spec 文件本身与新测试文件——没有任何 `.cap/` 路径出现在改动列表里，可作为独立可核验证据。AC2 之所以被推迟而不是被"修复"：本仓当前这个正在维护自身的 Claude Code session 是一个本产品不拥有的"already-running"进程，新 adapter（Story 4.1～4.4）在这种 target 下唯一合法的 `apply` 结果是既有终态 `requires-restart`（`prepareClaudeAlreadyRunningLaunchPlan` 的真实调用已证实，见下方 Auto Run Result）——没有第三条路径能在不重启的前提下把这个真实会话的装配来源切到新 adapter，而重启本身就是 AD-20/本 Story 任务书明确禁止的"装配能力中断窗口"。因此，`.cap/` 继续原样承担本仓自身这个 session 的实际装配职责，是本 Story 范围内唯一安全、完整的结果，而不是遗留缺陷。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 既有全部测试（399 项）+ 本 Story 新增测试全部通过，0 fail

## Auto Run Result

**实现摘要：** 新增 `packages/control-plane/tests/adapters/claude-cap-parity-verification.test.ts`，交付本 Story 的两项可执行证据：(1) 对真实 `.cap/`（`general`、`agent-assembler` 两个 profile）跑完整 `loadCapConfigRevisions` → `compileClaudeAssemblyManifest` → `compileClaudeAdapterPlan` 链路，逐项比对 `lock.json` 的 `profiles.<role>.inventory`（skills/mcps/hooks/plugins 名称集合）与（a）`loadCapConfigRevisions` 自身产出的引用集合、（b）编译后 manifest 的 `skills`/`mcp` 引用集合，并把编译出的 `ClaudeAdapterPlan.argv` 与 `.cap/runtime/claude.toml` 的 `policy.permission_mode`/`policy.enable_project_mcp`/`policy.enable_user_assets` 三个已核实字段的语义对齐；(2) 用从真实 `.cap/` 派生的 `general` revisionId 真实调用一次 `prepareClaudeAlreadyRunningLaunchPlan`，把其 `requires-restart`/`observationStage:'planned'`/`manifest:null`/`adapterPlan:null` 的返回值作为 AC2 阻塞决定的直接证据。全程未修改 `.cap/`、未修改 Story 4.1～4.4 交付的任一文件（probe/manifest/plan/launch 均按 Never 边界零改动，仅新增测试文件）。

**逐项比对的实际结果：**
- `general`、`agent-assembler` 两个真实 profile：`revision.skills`/`revision.mcp`/`revision.hooks`/`revision.plugins` 名称集合与 `lock.json` 对应 `inventory.skills`/`inventory.mcps`/`inventory.hooks`/`inventory.plugins` 逐项一致（两个 profile 的 `mcps`/`hooks`/`plugins` 均为空集合，`skills` 非空且完全匹配）。
- 真实 `claude` 二进制在本机可达：两个 profile 编译出的 manifest 均为 `manifestStatus: 'ready'`，`capabilityPolicy` 恰好覆盖 `claude.permission-mode-control`（恒相关）与 `claude.setting-sources-control`（因两个 profile 都引用了 skills 而相关），两者状态均为 `supported`；`claude.mcp-project-scope-control` 因两个 profile 的 `mcps` 均为空而判定为不相关（未出现在 `capabilityPolicy` 里），这与 `.cap` 的 `enable_project_mcp: false` 语义天然一致（双方都表达"没有项目级 MCP"），不是被忽略的差异。
- `manifest.skills`/`manifest.mcp` 引用集合与 `lock.json` inventory 完全一致；编译出的 `ClaudeAdapterPlan.argv` 含 `--permission-mode manual`（与 `.cap` 的 `permission_mode: "manual"` 一致）与 `--setting-sources project`（排除 `user`，与 `.cap` 的 `enable_user_assets: false` 一致），且 argv 中不含任何按名选择技能的标志，`envKeys` 恒为 `['CLAUDE_CONFIG_DIR']`——机械验证了已知差异 (b)（新 adapter 从不物化内容到项目级 `.claude/`）。
- 已知差异 (a) 实际观测：真实 `claude --version` 为 `2.1.241`，`.cap/runtime/claude.toml` 声明已核实 `2.1.236`；测试通过 `console.warn` 记录，不阻塞（bun test 输出：`[Story 4.5 已知差异 (a)] 真实 claude --version 为 2.1.241，.cap/runtime/claude.toml 声明已核实 2.1.236。已记录，不阻塞本 Story。`）。
- 未发现任何不属于上述两项已知差异的其它差异——本轮运行未触发 Boundaries & Constraints 的 `Block If` 条款。

**AC2 阻塞证据（真实调用结果）：** 用从真实 `.cap/` 派生的 `general` revisionId（`sha256:283b08df33794931b6e9c5065787aa587d80496ec6bb052e4d583bfaf64b7ea6`）调用 `prepareClaudeAlreadyRunningLaunchPlan`，返回 `plan.phase: 'requires-restart'`、`failureReason: 'already-running-session-target'`、`observationStage: 'planned'`、`manifest: null`、`adapterPlan: null`、`affectedCapabilities: []`，且全程只发生一次 `launchPlanRepository.save`。据此 AC2（本仓自身切换）正式记录为阻塞项，理由见上方"`.cap/` 现状声明"小节。

**改动文件：**
- `packages/control-plane/tests/adapters/claude-cap-parity-verification.test.ts` -- 新增：本 Story 的全部可执行证据（AC1 逐项比对 + AC2 阻塞证据）。
- `_bmad-output/implementation-artifacts/spec-4-5-cap-parity-验证与本仓自身切换.md` -- 本文件：补充"`.cap/` 现状声明"设计笔记与本 Auto Run Result。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 标记本 Story `done`，追加 action item 明确 AC2 阻塞、Story 4.6 仍不可执行。
- `.cap/` -- **零改动**（只读访问，见上方"`.cap/` 现状声明"）。

**验证执行（首轮实现）：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误。
- `cd packages/control-plane && bun test` -- 401 pass / 0 fail / 1409 expect() calls（既有 399 项 + 本 Story 新增 2 项），无回归。

**验证执行（review 补丁后，最终状态）：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误（协调者独立复核，非仅依赖实现子代理自报）。
- `cd packages/control-plane && bun test` -- 402 pass / 0 fail / 1421 expect() calls（既有 399 项 + 本 Story 新增 3 项，新增第 3 项为 review 补丁引入的 `.cap/` 现状声明自动核验 test），无回归；协调者独立重跑一次结果一致。

**残留风险：**
- AC2 阻塞是本 Story 的正式结论，不是待办：在新 adapter 获得"对已在运行、非本产品拥有的会话做安全热更新"的真实、已核实机制之前，本仓自身的装配来源必须继续由 `.cap/` 承担；Story 4.6（退役 `.cap/` 本体）继续被本条阻塞，禁止在 AC2 解除前执行。
- 版本漂移（`.cap` 声明 2.1.236，本机实测 2.1.241）目前仍只在测试级别可见（`console.warn`），与 Story 4.1 frontmatter `deferred` 记录的残留风险一致，尚无 CLI/报告面持久化；本 Story 未扩大范围去解决这一点。
- 若未来某个 profile 首次引入非空 `mcps`，本 Story 新增的测试会在 `claude.mcp-project-scope-control` 变为相关时自动校验其状态与 argv 是否含 `--strict-mcp-config`（已写入 `else` 分支），但目前两个真实 profile 均未覆盖到这条路径，只能算结构性防护，不能算已验证。
- `.github/workflows/control-plane-checks.yml` 的 CI job 未安装 `claude` 二进制，因此本 Story 相对 Story 4.1 裸探测比对的真正增量价值（manifest.skills/mcp 与 lock.json 逐项一致、capabilityPolicy 状态、adapterPlan.argv 与 policy.* 字段语义对齐）目前只在安装了 `claude` 的本机环境下真实执行过（本轮验证即是如此）；CI 上 `bun test` 命中的是 `!binaryPresent` 分支（现已补充 `console.warn` 明确标注这一点，不再是不可分辨的"静默浅层通过"），但这仍是一项需要跟踪的残留风险，而非已解决项。
