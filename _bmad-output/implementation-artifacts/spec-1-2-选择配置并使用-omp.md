---
title: 'Story 1.2 选择配置并使用 OMP'
type: 'feature'
created: '2026-08-22'
status: 'done'
baseline_commit: '1af3b9c7dece28a087596d0c80e49c0c47b61bba'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.1 让用户能查看/比较已保存配置修订，但用户仍无法亲自选定一个修订并让 Agent System 用它启动 OMP；也看不到启动后配置是否生效、切换配置该怎么做、失败了发生了什么。

**Approach:** 在 `packages/control-plane` 既有六边形结构上新增“激活”能力：领域内新增不可变 `LaunchPlan` 状态机（一次确认、终态不可原位改写）；应用层新增 `prepareLaunchPlan/confirmLaunchPlan/launchOmp/getLaunchStatus/requestConfigSwitch/rejectLaunchPlan` 用例，复用 Story 1.1 的 `ConfigRevisionRepository`/typed errors；adapters 新增 SQLite `launch_plan` 表、真实 OMP 进程适配器（argv spawn，不经 shell）、OMP capability probe、以及一个通过 OMP 官方 `-e/--extension` 机制加载的薄扩展文件（只显示当前配置/启动状态、转发切换入口，不订阅 prompt/tool/turn 事件）；CLI 新增 `configs use/status/switch` 子命令。

## Boundaries & Constraints

**Always:**
- `domain/` 新文件不导入 Bun/SQLite/文件系统/进程环境；`LaunchPlan` 不可变，转换函数是纯函数，返回新值而非原位改写；终态（`cancelled`/`requires-restart`/`succeeded`/`degraded`/`failed`/`incomplete`）不可再次转换（`requires-restart`/`succeeded`/`degraded` 之间为切换事件允许的显式新转换，见 Design Notes 状态图，其余终态一律拒绝任何后续事件）。
- 确认（confirmation）严格绑定当前 `planId`+`revisionId`+`planHash`；离开 `awaiting-confirmation` 阶段后同一确认不可重放；计划变化必须产生新 plan 与新确认，不允许跨配置/跨计划/跨进程复用旧确认。
- OMP 进程必须用 argv 数组直接 `Bun.spawn`（不得经 shell/字符串拼接命令行）；不得清空、改写用户真实全局 OMP 配置目录；不得安装/升级依赖。
- 用户传入的 prompt/任务参数只作为不透明 argv 元素透传给 OMP；不得解析、分类、打印、记录日志或持久化其内容。
- `configs use`/`switch` 选择 `client=claude-code` 或 `client=codex-cli` 时必须在创建 plan 之前、且不展示任何确认的情况下，立即返回类型化“当前不支持 + 未来 adapter 边界”提示；不得提供占位实现、翻译层或 shim。
- 启动状态视图（`LaunchStatus`）只能包含：修订标识、client、client 版本（`Fact`）、启动阶段、配置应用结果（`Fact`）、已知差异/`Unknown` 列表；类型上禁止携带任务目标、对话、工具调用、任务进度或结果字段。
- resume 完全不拦截：代码中不得新增任何持久化 OMP 原生 session id/路径（opaque locator）的字段、表列或调用；不得调用/包裹 `omp --resume`/`--continue`。
- capability probe 必须是一次真实检测（探测本机 `omp` 二进制是否存在、能否取得版本），并据其结果分支；不得硬编码跳过探测直接安装扩展，也不得在探测“不支持”时仍假装原生已满足。
- 薄扩展文件只允许订阅 `session_start`（读取一次性启动上下文文件用于展示）与注册 `registerCommand`；不得订阅 `tool_call`/`tool_result`/`turn_start`/`turn_end`/`message_*`/`agent_start`/`agent_end`/`before_provider_request` 等观察任务执行的事件。

**Ask First:** 无（本 Story 范围内的技术选型已在 Design Notes 固定；若后续需要真正装配 Instructions/MCP 的实际内容而非仅 Skills 按名过滤，属于新的“配置装配深度”决策，需要人工重新确认，本 Story 不做）。

**Never:**
- 不实现候选/推荐、Agent 自动选择配置、配置创建/编辑（沿用 Story 1.1 边界）。
- 不实现 explicit resume 启动参数、opaque native Session locator 持久化、Session lease/fencing（epics.md AR15；resume 完全交给 OMP 原生界面）。
- 不观察、不解析、不记录任务 prompt、对话、工具调用、任务进度或结果。
- 不为 Claude Code/Codex CLI 提供占位实现、配置翻译或兼容 shim。
- 不在 MVP 内构造 Instructions/MCP 的真实装配内容（Story 1.1 只捕获类型化引用与允许公开摘要，没有捕获装配所需的真实 prompt 字节/MCP 连接定义）；这部分必须诚实标为 `degraded`/`Unknown`，不得伪造为已生效。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 选择+一次确认+启动成功 | 有效 revisionId，`client=omp`，`--yes` | plan 依次 `prepared→awaiting-confirmation→applying→observing→succeeded`；确认摘要只展示一次；之后打印启动状态 | N/A |
| 用户拒绝确认 | 交互式回答非 `y` | plan→`cancelled`；不启动 OMP 进程；退出码非 0 | 类型化“用户拒绝，未启动”消息 |
| 重放旧确认 | 对已离开 `awaiting-confirmation` 的 plan 再次调用 confirm | 被拒绝，plan 状态不变 | `StaleConfirmationError`，提示需要重新走一次确认 |
| 不支持的客户端 | `client=claude-code` 或 `client=codex-cli` | 不创建 plan、不展示确认，立即返回不支持 | 类型化 not-supported + 未来 adapter 边界文案 |
| 配置不存在/不受支持 | revisionId 不存在，或 schema 不受支持 | `prepared→failed`；展示失败阶段/原因/恢复入口 | 复用 `ConfigNotFoundError`/`ConfigUnsupportedError` |
| OMP 二进制不可达（bridge 不可用） | `Bun.which('omp')` 为 `null` | capability probe 返回 `unknown` + 原因；`launchOmp` 对应转入 `applying→failed`，阶段标 `spawn-process` | 类型化原因 + 安装/PATH 恢复提示 |
| OMP 进程非零退出 | 子进程以非零码退出 | `observing→failed`（或 `incomplete`，退出信号不可判定时）；展示 exitCode/signal，不伪造成功 | 类型化阶段+原因 |
| Instructions/MCP 无法在 MVP 内真实装配 | revision 含非空 `instructions`/`mcp` 引用 | `applyResult` 标 `degraded`；`knownDifferences` 列出对应类型化原因；Skills 正常装配不受影响 | N/A（仅 optional 项降级） |
| 运行中配置切换 | 已有 `succeeded`/`degraded` plan，用户选新 revisionId | 当前 plan→`requires-restart`；新建 plan 完整走 `prepared→awaiting-confirmation`，要求新的一次确认 | 不热改原进程、不自动 resume |
| 查看启动状态 | 已存在 plan | 展示 revisionId/client/版本/阶段/应用结果/已知差异，不含任务内容 | N/A |
| capability probe：OMP 二进制存在 | 本机已装 `omp` | probe 返回 `unsupported`（OMP 原生无 Agent System 配置概念的类型化原因）；产品据此安装薄扩展，而非跳过 | N/A |
| 非 ASCII / 含空格路径 | cwd 或 launch-context 路径含空格、非 ASCII 字符 | 全程通过 argv 数组与文件路径参数传递（非 shell 拼接），无损坏、无需转义 | N/A |
| 既有全局 OMP 配置 | `~/.omp` 下已有用户真实配置/凭据 | 启动 env 仅新增 `AGENT_SYSTEM_LAUNCH_CONTEXT`；argv 仅新增 `--profile`/`--skills`/`--no-extensions -e <thin-extension>`；不清空、不改写、不恢复该目录任何既有内容 | N/A |

</frozen-after-approval>

## Code Map

- `packages/control-plane/src/domain/facts.ts` -- 复用 `Fact`/`known`/`unknown`/`isKnown`/`isUnknown`（已存在，不改动）
- `packages/control-plane/src/domain/config.ts` -- 复用 `StableConfigRevision`/`CapabilityReference`（已存在，不改动）
- `packages/control-plane/src/domain/client.ts` -- 新增 `ClientId = 'omp' | 'claude-code' | 'codex-cli'`、`resolveClientSupport(clientId): {supported: boolean; reason?: string}`；`omp` 之外一律 `supported:false` + 类型化 reason（"当前不支持，未来 adapter 边界"字样）
- `packages/control-plane/src/domain/activation.ts` -- 新增 `LaunchPhase`、`TERMINAL_PHASES`、`LaunchPlan`、`LaunchPlanEvent`、纯函数 `transitionLaunchPlan(plan, event): {ok:true;plan}|{ok:false;reason:string}`、`ConfirmationToken`、`validateConfirmationToken`、`LaunchStatus`、纯函数 `deriveLaunchStatus(plan, clientVersion, knownDifferences)`、纯函数 `computePlanHash(revisionId, client, preparedAt)`（字符串拼接+简单 hash，不需要密码学强度，仅用于绑定确认）
- `packages/control-plane/src/application/ports.ts` -- 扩展：新增 `LaunchPlanRepository`（`save`/`findById`/`findActiveForClient`）、`OmpProcessPort`（`detectVersion`、`spawn`，spawn 参数含 `revision`/`launchContextPath`/`extensionPath`/`forwardedArgs`/`cwd`）、`OmpCapabilityProbePort`（`probeStatusViewingCapability(): Promise<{level:'supported'|'degraded'|'unsupported'|'unknown'; reason:string}>`）、`LaunchContextWriter`（`write(context): Promise<string>` 返回写入路径）
- `packages/control-plane/src/application/launch.ts` -- 新增用例文件：`prepareLaunchPlan`、`confirmLaunchPlan`、`launchOmp`、`getLaunchStatus`、`requestConfigSwitch`、`rejectLaunchPlan`；类型化错误 `UnsupportedClientError`、`StaleConfirmationError`、`InvalidTransitionError`、`LaunchPlanNotFoundError`；复用（不复制）`application/queries.ts` 的 `ConfigNotFoundError`/`ConfigUnsupportedError`/`getConfigRevisionDetail`
- `packages/control-plane/migrations/0002_launch.sql` -- 新表 `launch_plan`：`plan_id TEXT PRIMARY KEY`、`operation_id`、`revision_id`、`config_name`、`client`、`plan_hash`、`phase`、`created_at`，以及 `confirmed_at`/`failure_reason`/`observed_outcome` 各自的四列 Known/Unknown 模式（与 Story 1.1 `default_marker_*` 同构），`STRICT`，`CHECK (phase IN (...十种合法值...))`
- `packages/control-plane/src/adapters/sqlite/launch-repository.ts` -- 新增 `SqliteLaunchPlanRepository implements LaunchPlanRepository`（独立文件，不改动 Story 1.1 的 `sqlite/repository.ts`；两者共用同一 `.sqlite3` 文件即可，各自管理自己的迁移 SQL 文件与表）
- `packages/control-plane/src/adapters/omp/process-port.ts` -- 新增 `BunOmpProcessPort implements OmpProcessPort`；导出纯函数 `buildOmpArgv(revision, launchContextPath, extensionPath, forwardedArgs)` 供单测直接断言 argv 内容而不必真的 spawn；`detectVersion` 用 `Bun.spawn(['omp','--version'])` 解析 `omp/<version>` 格式（已在本机验证真实输出即此格式）
- `packages/control-plane/src/adapters/omp/capability-probe.ts` -- 新增 `BunOmpCapabilityProbe implements OmpCapabilityProbePort`：`Bun.which('omp')` 为 `null` 时返回 `unknown`+`'omp-binary-not-found'`；否则固定返回 `unsupported`+`'omp-native-interface-has-no-agent-system-config-concept'`（真实依据见 Design Notes——OMP 原生 `--help`/`config` 命令均无法表达“当前由哪个 Agent System 配置修订启动”这一本产品专有事实）
- `packages/control-plane/src/adapters/omp/extensions/agent-status-extension.ts` -- 新增薄扩展源文件（不是我们 CLI 的一部分，是启动 OMP 时用 `-e` 指向的独立文件）：`export default function(pi) { pi.on('session_start', ...读取 launch-context.json 用 ctx.ui.setStatus 展示...); pi.registerCommand('agent-config', {...ctx.ui.notify 展示 configName/revisionId/client/phase/applyResult/knownDifferences...}); pi.registerCommand('agent-switch-config', {...ctx.ui.notify 提示运行外部 CLI `configs switch <id>`...}); }`；内联最小结构类型（`interface MinimalExtensionAPI`），不依赖 `@oh-my-pi/pi-coding-agent` npm 包（见 Design Notes）
- `packages/control-plane/src/adapters/launch-context/fs-launch-context-writer.ts` -- 新增 `FsLaunchContextWriter implements LaunchContextWriter`：写入 `<CONTROL_PLANE_STATE_DIR>/launch-context/<planId>.json`（复用 `cli/db-path.ts` 同级目录约定，新增 `launchContextDir()` 辅助或就地拼接）
- `packages/control-plane/src/cli/render.ts` -- 扩展：新增 `renderConfirmationSummary`、`renderLaunchStatus`、`renderUnsupportedClient`、`renderLaunchFailure`、`renderSwitchAccepted`
- `packages/control-plane/src/cli/confirm-prompt.ts` -- 新增：`readYesNo(promptText): Promise<boolean>`，从 `process.stdin` 读一行，`y`/`yes`（大小写不敏感）为真
- `packages/control-plane/src/cli/index.ts` -- 扩展 `parseCommand`/`main`：新增 `use <id> [--client <id>] [--yes] [-- ...forwarded]`、`status [<planId>]`、`switch <id> [--client <id>] [--yes] [-- ...forwarded]`；`main` 签名扩展为 `main(argv, overrides？: {ompPort?, capabilityProbe?, contextWriter?})` 以便测试注入假 OMP 端口而不真实 spawn；`import.meta.main` 入口不传 overrides，使用真实 adapters
- `packages/control-plane/tests/domain/client.test.ts` -- 新增
- `packages/control-plane/tests/domain/activation.test.ts` -- 新增：状态机合法/非法转换、终态不可改写、确认 token 绑定与重放拒绝、`switch-requested` 从 `succeeded`/`degraded` 到 `requires-restart`
- `packages/control-plane/tests/application/launch.test.ts` -- 新增：用内存假 `LaunchPlanRepository`/假 `OmpProcessPort`/假 `OmpCapabilityProbePort`/假 `LaunchContextWriter` 覆盖 IO 矩阵除“真实 OMP 二进制”相关行以外的全部行
- `packages/control-plane/tests/contracts/launch-repository.test.ts` -- 新增：`:memory:` SQLite 合同测试
- `packages/control-plane/tests/adapters/process-port.test.ts` -- 新增：`buildOmpArgv` 纯函数断言（含非 ASCII/空格路径场景、`--skills` 只按名过滤、不出现任何清空/改写全局配置的参数）
- `packages/control-plane/tests/adapters/capability-probe.test.ts` -- 新增：`Bun.which` 不可用/可用两种分支（可通过依赖注入或 mock `Bun.which`）
- `packages/control-plane/tests/integration/cli-launch.test.ts` -- 新增：`main()` 端到端，注入假 OMP 端口，覆盖 use/status/switch 全流程与不支持客户端
- `packages/control-plane/tests/omp/real-omp-smoke.test.ts` -- 新增：`if (!Bun.which('omp')) return` 提前退出跳过；否则用真实 `omp` 二进制以 `buildOmpArgv` 生成的参数、把消息参数替换为 `--help`（不触发真实模型调用，不需要 API key）实际 spawn 一次，断言退出码 0，作为“目标 OMP smoke”的诚实最小实现（见 Design Notes 对为什么不能做完整真实对话 smoke 的说明）

## Tasks & Acceptance

**Execution:**
- [x] `packages/control-plane/src/domain/client.ts` -- 新增 `resolveClientSupport` -- MVP-FR10 承载点
- [x] `packages/control-plane/src/domain/activation.ts` -- 新增 `LaunchPlan` 状态机、`LaunchStatus` 投影 -- MVP-FR4/FR6/FR7/FR8 领域规则、AD-8 Known/Unknown
- [x] `packages/control-plane/src/application/ports.ts` -- 扩展四个新端口 -- 应用层依赖倒置，adapters 不做产品决定
- [x] `packages/control-plane/src/application/launch.ts` -- 六个用例 + 类型化错误 -- MVP-FR4/FR5/FR6/FR7/FR8/FR10 应用层
- [x] `packages/control-plane/migrations/0002_launch.sql`、`src/adapters/sqlite/launch-repository.ts` -- 新表与仓储 -- 持久化 plan
- [x] `packages/control-plane/src/adapters/omp/process-port.ts` -- `buildOmpArgv` + `BunOmpProcessPort` -- argv spawn，不经 shell
- [x] `packages/control-plane/src/adapters/omp/capability-probe.ts` -- native-first 探测 -- MVP-FR9
- [x] `packages/control-plane/src/adapters/omp/extensions/agent-status-extension.ts` -- 薄扩展 -- MVP-FR6/FR9/AR12
- [x] `packages/control-plane/src/adapters/launch-context/fs-launch-context-writer.ts` -- 版本化 launch context 落盘 -- 扩展消费的唯一输入
- [x] `packages/control-plane/src/cli/render.ts`、`confirm-prompt.ts`、`index.ts` -- `use`/`status`/`switch` 子命令 -- 面向用户入口
- [x] `packages/control-plane/tests/**`（如 Code Map 所列）-- 覆盖 I/O 矩阵全部行 + 状态机不变式 -- 验证收口

**Acceptance Criteria:**
- Given 用户在外部 CLI 看到保存配置列表, when 用户选择一个具体配置修订, then 系统绑定该修订并准备 fresh 启动 OMP, and 不由 Agent 自动选择、推荐或静默回退到默认配置
- Given 所选配置可以转换为当前 OMP 版本支持的启动配置, when CLI 展示启动确认, then 简洁显示配置名称/修订、将启用的 Instructions/Skills/MCP、OMP 版本、已知缺失或差异，并提供按需展开详情, and 用户只确认一次；配置选择本身和进入 OMP 后都不再重复确认
- Given 用户确认当前启动计划, when Agent System 启动 OMP, then 在独立 invocation 边界生成所需配置并直接启动 OMP 进程, and 不清空、改写或恢复用户全局 OMP 配置，不安装/升级依赖，不经 shell 启动
- Given 用户向 OMP 传入 prompt、任务参数或动态上下文, when CLI 启动 OMP, then 这些内容只作为不透明 invocation-scoped 输入透传给 OMP, and Agent System 不解析、不分类、不持久化、不记录日志，也不观察任务执行或结果
- Given OMP 已由 Agent System 启动, when 用户查看状态, then 外部 CLI 显示所选配置修订、OMP client/version、启动阶段、配置应用结果以及已知差异/Unknown, and 状态不包含任务目标、对话、工具调用、任务进度、任务结果或装配推荐
- Given capability probe 证明 OMP 原生界面已满足当前配置和启动状态查看合同, when 用户在 OMP 内查看, then 产品复用原生能力且不安装重复辅助命令, and 若原生能力不存在或不足，薄 OMP 扩展才提供最小当前配置、启动状态和外部 CLI 入口；两种路径不得同时形成不同事实源
- Given 用户进入 OMP 后需要恢复旧会话, when 用户调用 OMP 原生 resume, then Agent System 不拦截、不选择 Session、不保存 opaque locator，也不观察恢复后的任务内容, and resume 的成功或失败由 OMP 原生界面负责；Agent System 只继续声明本进程由哪个配置修订启动，不把原生 resume 失败改写为配置应用失败
- Given 用户希望切换到另一个配置, when 用户在外部 CLI 选择新配置, then 当前进程显示"需要重启"，新配置创建新的启动计划并要求一次确认, and Agent System 不在原进程内热改配置、不自动 resume；新 OMP 启动后用户可自行调用原生 resume
- Given 配置引用不可达、schema/OMP 版本不兼容、required 项无法应用、生成工件失败或 OMP 未成功启动, when 启动流程失败, then 外部 CLI 显示失败发生阶段、受影响配置项、已知原因、Unknown 和恢复动作, and 不伪造成功、不产生部分配置状态、不自动回退、不修改全局配置；仅 optional 项失败时才可明确标为 degraded
- Given 用户拒绝确认，或确认后配置修订/启动计划发生变化, when 系统尝试启动, then 拒绝使用旧确认；拒绝时不启动，计划变化时重新展示一次新确认, and 确认不能跨配置、跨启动计划或跨 OMP 进程复用
- Given 用户选择 Claude Code 或 Codex CLI, when MVP 解析客户端, then 明确返回当前不支持，并指出未来 adapter 边界, and 不提供占位实现、配置翻译、兼容 shim 或跨客户端 Session 恢复

## Spec Change Log

- **发现（review 三层并行）：** blind-hunter/edge-case-hunter/verification-gap 三个 context-free 审阅共提出约 20 项发现（含 1 项两个审阅层独立重复提出）。全部触发点都在 `<frozen-after-approval>` 之外的实现细节，无一要求重新协商 Intent/Boundaries/IO-matrix——不触发 `bad_spec`/`intent_gap` 回环。另外，在构造送审 diff 前发现并自行修正一处 pre-existing 缺陷：`computePlanHash` 的模板字符串中两处应为字面空格的字符实际是字面 NUL 字节（`\x00`），导致 `git diff --no-index` 把 `activation.ts` 判定为二进制文件——已用真实空格替换，行为不变（130/130 测试仍通过），随后重新生成送审 diff。
- **修正（patch，已应用并重新通过 `bunx tsc --noEmit` + `bun test`，133/133 通过，从 130 增至 133）：**
  1. `cli/index.ts` `parseUseOrSwitch` 最终 `return` 硬编码 `client: 'omp'`，丢弃已解析校验过的 `--client` 值——改为 `client: clientRaw as ClientId`。当前因 `resolveClientSupport` 只对 `'omp'` 返回 `supported:true` 而无可观察影响，但属于真实缺陷：未来若第二个 client 变为 supported 会被静默错配到 `'omp'`。
  2. `cli/index.ts` `parseUseOrSwitch` 未校验 id 位置误传 flag（如 `configs use --yes` 无 id）——新增 `id.startsWith('--')` 判断，与缺 id 同样返回 usage-error，而不是把 flag 字符串当字面 revision id 查找。
  3. `cli/index.ts` `main()` 中若 `SqliteLaunchPlanRepository` 构造在 `SqliteConfigRevisionRepository` 已成功之后抛错，原实现未关闭已打开的 `configRepository`——改为外层持有引用，catch 分支显式 `configRepository?.close()`。
  4. `adapters/omp/process-port.ts` `sanitizeProfileName` 只做字符替换，不同 `configName`（如 `"my config"` 与 `"my/config"`）可能坍缩到同一个 OMP `--profile` 值，而 `--profile` 隔离 auth/session/settings/cache——新增确定性 `shortHash` 后缀，任意不同输入的 profile 值不再可能碰撞；新增回归测试锁定该不变式。
  5. `application/launch.ts` `getLaunchStatus` 用裸 `catch {}` 把任意错误（含非预期基础设施故障）都吞成通用 `'revision-detail-unavailable-for-status-view'` 差异，与本文件/CLI 其余位置统一使用的 `ConfigNotFoundError`/`ConfigUnsupportedError` 判别模式不一致——改为只捕获这两个类型化错误，其余错误原样向上抛出。
  6. 新增测试：`tests/application/launch.test.ts` 补一条 `capabilityProbe.result.level === 'degraded'` 场景（此前只覆盖 `'unknown'`/`'unsupported'`/`'supported'`），验证 `launchOmp` 把 `'degraded'` 与 `'unsupported'` 同等对待、仍加载薄扩展。
  7. 新增测试：`tests/integration/cli-launch.test.ts` 的"不支持的客户端"用例补 `existsSync(dbPath)` 断言，实证代码注释所声明的"不支持客户端选择绝不触碰数据库文件"这一不变式，而不只是断言控制台输出与 `ompPort.lastSpawnParams`。
- **不采纳（defer，已记录到 `deferred-work.md`，未修正）：** `requestConfigSwitch` 跨两次 `save()` 非事务性（当前不可经 CLI 触达）；`status`/`use`/`switch` 未拒绝多余的尾随位置参数；launch-context JSON 文件无清理/保留策略；`runLaunchFlow` 中少数应用层错误（如罕见的 stale-confirmation 竞争）经顶层通用 catch-all 而非逐个 `renderLaunchFailure` 渲染——均为真实但非阻断项，已按上方四条各自记录证据与理由。
- **不采纳（reject，未修正）：** `configs status` 硬编码查询 `client='omp'`（MVP 唯一支持 client，语义上不可能有其他 client 的 active plan）；`requestConfigSwitch` 与 Session lease/fencing 相关的"重复 `use` 并发启动两个进程"（epics.md AR15 明确排除 lease/fencing，属故意留白而非缺陷）；OMP 扩展/迁移文件路径依赖 `import.meta.url`（本包当前无 build/bundle 步骤，与 Story 1.1 既有模式一致）；`computePlanHash` 非密码学强度（Design Notes 已明确声明"不要求密码学强度"）；薄扩展对 launch-context JSON 内容不做 schema 校验（只有本产品自身会写这个文件，畸形内容属自我攻击场景，且已有 JSON.parse 失败兜底）；`readYesNo` 单 chunk 读取（真实终端/管道单行 y/n 输入极不可能跨 chunk 拆分，现有测试已覆盖常见路径）。

- **发现（独立 code review，第二轮）：** 复核确认本 Story 全部 11 条 Acceptance Criteria 已满足、MVP 边界干净、133/133 测试通过，但发现一处需要在标记 `done` 前关闭的真实缺口，另加 3 项低风险 patch 与 1 项严重度重估（已在下方分别记录）。
- **发现 + 修正（`-- <args>` 转发可静默突破"单一事实源"保证）：** 在本机真实已安装的 `omp --help`（18.0.0）上重新逐条核验 Design Notes 已记录的调用面，确认 `-e, --extension=<value>` 明确文档为可重复（"can be used multiple times"）——因此用户经 `configs use/switch <id> -- -e <path>` 转发的 `-e` 会在 `buildOmpArgv` 自己发出的 `--no-extensions -e <thin-extension>` 之外再加载一个额外扩展，静默突破"当前配置/状态只有一个事实源"这一 Boundaries & Constraints 保证（薄扩展与用户扩展会同时存在）；`--profile=<value>` 同理可能覆盖 `buildOmpArgv` 计算出的隔离 profile 值。修正采用负责人已确认的方案（两部分）：
  1. **新增窄 token denylist**（`adapters/omp/process-port.ts` 新导出 `DENYLISTED_FORWARDED_ARG_TOKENS` + `findDenylistedForwardedArg`，`cli/index.ts` `parseUseOrSwitch` 在任何仓储打开/plan 创建/spawn 之前用它拒绝匹配项，返回与既有用法错误同风格的类型化 usage-error）。denylist 精确对应本 Story 自身依赖的三类保证，每一项都已对照本机真实 `omp --help` 输出核实存在：
     - **扩展加载**（单一事实源）：`-e`、`--extension`——`buildOmpArgv` 自己正是用这个 flag 加载薄扩展；确认为可重复。
     - **profile 选择**（隔离 auth/session/settings/cache）：`--profile`——`buildOmpArgv` 自己正是用这个 flag 隔离 profile。
     - **resume/continue/session 目录**（"resume 完全不拦截"，AD-7/AD-13/AD-19）：`-c`、`--continue`、`-r`、`--resume`、`--session-dir`——均已在既有 `process-port.test.ts`"never emits"用例中被列为"绝不能由本产品自己发出"的 flag，现在同样禁止由用户转发注入。
     未纳入 `--hook`（虽然 `--help` 文案写"Load a hook/extension file"，但它是与 `-e/--extension` 不同的独立机制，`buildOmpArgv` 从未用它承载薄扩展，Design Notes 的"单一事实源"论证也只针对 `-e` 机制本身）与 `--config`（`--help` 描述为"额外 config.yml overlay"，属于配置合并而非本 Story 三类保证中的任何一类，且 Design Notes 已在"OMP 真实调用面"一节把它单列出来讨论，与本次三类拒绝的范围不同）——denylist 刻意保持窄，只覆盖 `buildOmpArgv` 自己依赖的确切 flag 拼写，不去推断/分类语义上"可能有风险"的其它 flag（不违反 Boundaries & Constraints 对转发参数禁止解析/分类的要求：这仍是精确 token 匹配，不检查值、不判断语义）。
  2. **一次确认摘要中回显转发参数**（`cli/render.ts` `renderConfirmationSummary` 新增 `forwardedArgs` 参数，非空时在已知差异之后、"one-time confirmation"收尾行之前打印一行 `Forwarded to \`omp\` verbatim after \`--\`:` + 原样 token），让用户在确认前而非确认后就看到究竟会附加什么，`cli/index.ts` 对应调用点透传 `params.forwardedArgs`。
  新增测试：`tests/adapters/process-port.test.ts` 覆盖 `findDenylistedForwardedArg`（每个 token 单独断言、`--flag=value` 形式、不误伤形似但不同的 flag）；`tests/integration/cli-launch.test.ts` 新增三条端到端用例断言 `-e`/`--profile=other`/`--resume` 转发均被拒绝（usage-error、退出码 2、`existsSync(dbPath)` 为 `false`、`ompPort.lastSpawnParams` 为 `null`），以及一条断言非 denylist 转发参数会出现在"one-time confirmation"标记行之前。
- **修正（3 项低风险 patch，与上述一并应用并重新通过 `bunx tsc --noEmit` + `bun test`，150/150 通过，从 133 增至 150）：**
  1. `cli/render.ts` `renderLaunchFailure` 此前无条件打印"Launch plan {id} failed."，即便 `plan.phase === 'incomplete'`——而 `incomplete` 是 `application/launch.ts` `deriveOutcome` 里与 `failed` 语义不同的独立终态（OMP 进程结束但退出码不可判定，例如被信号杀死，并非真的以非零码失败）。改为按 `plan.phase` 分支：`incomplete` 打印"Launch plan {id} did not complete."，其余仍为"failed."。
  2. `tests/domain/activation.test.ts`"terminal phases reject every other event"扫描此前只覆盖 `['cancelled', 'failed', 'incomplete', 'requires-restart']`，遗漏 `succeeded`/`degraded` 这两个同样终态但允许恰好一个例外事件（`switch-requested`）的阶段。新增独立扫描覆盖 `succeeded`/`degraded`：断言 `switch-requested` 之外的全部事件仍被拒绝，`switch-requested` 本身被接受——纯粹补测试缺口，不改变 `transitionLaunchPlan` 行为（该分支代码本就正确）。
  3. `cli/index.ts` `runLaunchFlow` 此前用 `active.phase === 'succeeded' || active.phase === 'degraded'` 在调用 `requestConfigSwitch` 前自行重新判断"这个 plan 是否允许切换"，与 `transitionLaunchPlan` 内部 `case 'succeeded': case 'degraded':` 守卫的判断条件重复表达同一件事，未来两处独立演化时可能静默分叉。重构为：只要存在 active plan 就直接尝试 `requestConfigSwitch`，把是否可切换完全交给领域层的 `transitionLaunchPlan` 判定；仅当其抛出 `InvalidTransitionError`（即领域层判定不可切换）时才回退到 `prepareLaunchPlan`，其余错误原样上抛。行为不变（已用既有 switch 相关测试确认前后一致），只是消除了重复判断源。

## Design Notes

**状态机（`activation.ts`）：**
```
prepared --prepared-ok--> awaiting-confirmation
prepared --prepared-failed--> failed [terminal]
awaiting-confirmation --confirmed(有效token)--> applying
awaiting-confirmation --rejected--> cancelled [terminal]
applying --process-started--> observing
applying --apply-failed--> failed [terminal]
observing --observed(succeeded|degraded|failed|incomplete)--> 对应终态
succeeded --switch-requested--> requires-restart [terminal]
degraded --switch-requested--> requires-restart [terminal]
其余终态（cancelled/requires-restart/failed/incomplete）收到任何事件 --> {ok:false, reason:'invalid-transition'}
```
`confirmed` 事件必须携带 `ConfirmationToken{planId, revisionId, planHash, issuedAt}`；只有当 token 的三元组与当前 plan 完全一致且 `plan.phase === 'awaiting-confirmation'` 时才合法——这天然保证了“确认不能跨配置/跨计划/跨进程复用”，无需额外的已消费标记字段。`planHash = computePlanHash(revisionId, client, preparedAt)`：确定性字符串组合（例如用 `Bun.hash` 或简单拼接+`crypto.createHash('sha256')`），不要求密码学强度，只要求确定性与抗混淆（不同输入不同 hash）。

**OMP 真实调用面（已在本机验证，非猜测）：**
- `omp --version` 输出 `omp/17.4.1` 这种可解析格式（stdout 单行）。
- `omp --help` 确认的相关 flags：`--profile=<value>`（隔离 auth/session/settings/cache）、`--config=<value>`（可重复，额外 config.yml overlay）、`--skills=<value>`（逗号分隔 glob，按名过滤已发现的 skills，不需要提供 skill 文件内容）、`--no-skills`、`-e/--extension=<value>`（可重复，加载扩展文件）、`--no-extensions`（禁止自动发现，显式 `-e` 路径仍生效——用它保证只加载我们指定的薄扩展，不引入用户目录下其它扩展造成的事实源分裂）、`--append-system-prompt=<value>`、`-r/--resume=<value>`、`-c/--continue`（我们绝不传这两个）、`--session-dir=<value>`（我们绝不传，保持 OMP 默认 session 发现路径不被分裂，off-limits 以保证原生 resume 仍能找到本次 session）、`-p/--print`（非交互）、`MESSAGES`（位置参数，透传用户 prompt）。
- `buildOmpArgv` 组装：`[executable, '--profile', <安全化的 configName>, '--no-extensions', '-e', extensionPath, '--skills', <skill 名逗号列表 或省略以保留 '--no-skills' 当空>, ...forwardedArgs]`。**不要**尝试用 `--append-system-prompt` 注入 Instructions 内容、也不要发明 MCP 相关 flag——`omp --help` 里没有面向内联 MCP server 定义的 flag，且 Story 1.1 的 `CapabilityReference` 从未捕获 MCP 连接定义/Instructions 原始字节（只有类型化引用+摘要）。因此：Skills 用真实名称按 OMP 原生发现机制装配（安全，因为只传"名字"，内容由 OMP 自己从其本地 skills 目录解析）；Instructions/MCP/Hooks/Plugins 一律不在 argv 中尝试装配，`launchOmp` 用例把它们各自算作 `knownDifferences` 里的一条类型化 `degraded` 原因（例如 `'instructions-content-not-materialized-in-mvp'`），绝不假装已生效。这是本 Story 对"配置应用"合同的诚实边界，不是遗漏。

**薄扩展 ExtensionAPI（已在本机全局 omp 17.4.1 源码验证真实形状，路径供参考，不作为依赖引入）：**
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:1198`（`interface ExtensionAPI`）确认：`pi.on(event, handler)`、`pi.registerCommand(name, {description, handler: (args, ctx) => ...})`（`:1349`）、`ctx.ui.notify(message, type?)`（`:279`）、`ctx.ui.setStatus(key, text)`（`:285`）、`ctx.ui.confirm(...)`（`:267`）、事件名包含 `session_start`/`tool_call`/`turn_start`/`message_*` 等（`:1222`-`:1278`）。扩展文件里只订阅 `session_start`，只注册 `registerCommand`；绝不订阅任何 `tool_*`/`turn_*`/`message_*`/`agent_*` 事件（那些正是 AR12 禁止观察的任务执行信号）。类型用内联 `interface MinimalExtensionAPI { on(event:'session_start', handler:...): void; registerCommand(name:string, opts:{description?:string; handler:(args:string[], ctx:{ui:{notify(msg:string, type?:string):void; setStatus(key:string, text?:string):void}}) => Promise<void>|void}): void; }` 而非 `import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent'`，避免给本包引入一个会随 OMP 版本漂移、且未必在所有开发/CI 机器全局安装的真实 npm 依赖（Architecture Spine：OMP `main` 的移动值不得作为产品 toolchain 决定）。

**capability probe 结论为什么恒定是 `unsupported`（不是绕过 native-first，而是探测的诚实结果）：** OMP 原生 `--help`/`omp config list`（已验证真实输出，只有 appearance/context 等 UI 偏好，没有"当前由哪个外部配置修订启动"这个概念）都无法表达 Agent System 专有的 `StableConfigRevision`/`LaunchPlan` 事实——这是本产品的领域概念，OMP 从未见过。因此每次探测都会诚实得出"原生不足"，从而进入薄扩展路径；这与"若原生能力已满足则直接复用"的分支在代码结构上是对等的两条路径，只是当前真实证据总是走后者。

**目标 OMP smoke 为什么不能是完整真实对话：** 真实非 `--help` 调用需要一个已认证的模型 provider（API key/OAuth），本仓 CI 与开发沙箱都不保证具备；因此 `real-omp-smoke.test.ts` 只在本机存在 `omp` 二进制时运行，且把 `buildOmpArgv` 生成的参数中的消息位置参数替换为 `--help`，验证我们构造的 flags（`--profile`/`--no-extensions -e <path>`/`--skills` 等）确实能被真实二进制解析并以退出码 0 结束——这是诚实边界内能做到的最强真实验证，覆盖 AR17"目标 OMP smoke"的"覆盖... bridge 不可用与 OMP 启动失败"部分（其余"完成配置修订/Skills 启动装配"由 `buildOmpArgv` 单测 + 这条 smoke 共同覆盖）。

**LaunchContext 文件（唯一扩展消费入口，AR12 "只消费版本化 launch context"）：**
```json
{ "version": 1, "planId": "...", "configName": "...", "revisionId": "...", "client": "omp",
  "launchedAt": "...", "applyResult": "applied|degraded", "knownDifferences": ["..."],
  "switchEntryPointHint": "run `configs switch <id>` in the Agent System CLI" }
```
写入路径通过 `AGENT_SYSTEM_LAUNCH_CONTEXT` 环境变量传给 OMP 子进程；扩展在 `session_start` 里读一次，之后只响应用户主动敲的 `/agent-config`、`/agent-switch-config` 命令重新读取同一文件——不做轮询、不做文件监听、不做任何后台观察。

## Verification

**Commands:**
- `cd packages/control-plane && bun install` -- expected: 无错误完成
- `cd packages/control-plane && bunx tsc --noEmit` -- expected: 零类型错误（含新扩展文件与内联 `MinimalExtensionAPI` 类型）
- `cd packages/control-plane && bun test` -- expected: 全部测试通过，覆盖 I/O 矩阵全部行；若本机存在 `omp` 二进制，`real-omp-smoke.test.ts` 一并通过，否则该文件内部提前 return 跳过（不算失败）

## Suggested Review Order

**领域状态机：`LaunchPlan` 不可变转换（本轮设计核心）**

- 入口：十态状态机的唯一转换函数，含终态拒绝一切事件、`succeeded`/`degraded → requires-restart` 唯一例外。
  [`activation.ts:158`](../../packages/control-plane/src/domain/activation.ts#L158)

- 确认 token 与 `planHash` 绑定 `(planId, revisionId, planHash)` 三元组，天然防重放/跨配置/跨计划复用，无需额外"已消费"标记。
  [`activation.ts:127`](../../packages/control-plane/src/domain/activation.ts#L127)

- `LaunchPlan`/`LaunchStatus` 类型本身排除任务目标/对话/工具调用字段，边界靠类型系统而非约定强制。
  [`activation.ts:78`](../../packages/control-plane/src/domain/activation.ts#L78)
  [`activation.ts:235`](../../packages/control-plane/src/domain/activation.ts#L235)

**应用层：六个用例如何组合领域状态机与端口**

- `launchOmp`：capability probe 先行、写 launch context、argv spawn、观察结果反推终态——本 Story 唯一的多端口编排点。
  [`launch.ts:255`](../../packages/control-plane/src/application/launch.ts#L255)

- `prepareLaunchPlan`：client 校验先于任何持久化；配置不存在时产出 `failed` plan 而非抛错，与查看/比较错误处理风格统一。
  [`launch.ts:132`](../../packages/control-plane/src/application/launch.ts#L132)

- `requestConfigSwitch`：当前 plan 转 `requires-restart` 后才创建新 plan——非原子性的已知边界见 Spec Change Log。
  [`launch.ts:381`](../../packages/control-plane/src/application/launch.ts#L381)

- `computeKnownDifferences`：MVP 诚实边界的落点——Instructions/MCP/Hooks/Plugins 只标类型化差异，不假装已装配。
  [`launch.ts:103`](../../packages/control-plane/src/application/launch.ts#L103)

**OMP adapters：真实 argv/capability 证据**

- `buildOmpArgv` 纯函数：`--profile`/`--no-extensions -e`/`--skills`|`--no-skills`，不含任何清空全局配置的 flag。
  [`process-port.ts:21`](../../packages/control-plane/src/adapters/omp/process-port.ts#L21)

- `BunOmpCapabilityProbe`：真实 `Bun.which('omp')` 探测，诚实返回 `unsupported`（原生无本产品配置概念）而非硬编码跳过。
  [`capability-probe.ts:13`](../../packages/control-plane/src/adapters/omp/capability-probe.ts#L13)

- 薄扩展：只订阅 `session_start` + 两个 `registerCommand`，类型内联而非依赖 `@oh-my-pi/pi-coding-agent`。
  [`agent-status-extension.ts:92`](../../packages/control-plane/src/adapters/omp/extensions/agent-status-extension.ts#L92)

- `resolveClientSupport`：`claude-code`/`codex-cli` 的"当前不支持"文案与未来 adapter 边界声明。
  [`client.ts:26`](../../packages/control-plane/src/domain/client.ts#L26)

**CLI 入口：一次确认的用户可见流程**

- `runLaunchFlow`：`use`/`switch` 共享的一次确认流程——展示摘要、`--yes` 或交互 y/N、拒绝即 cancelled。
  [`index.ts:167`](../../packages/control-plane/src/cli/index.ts#L167)

- `parseUseOrSwitch`：unsupported-client 在任何仓储构造前返回；`--` 后转发参数不透明透传。
  [`index.ts:79`](../../packages/control-plane/src/cli/index.ts#L79)

- `main`：`overrides` 参数是测试注入假 OMP 端口的唯一缝隙，生产入口不传。
  [`index.ts:244`](../../packages/control-plane/src/cli/index.ts#L244)

- 渲染函数：确认摘要与启动状态视图的实际文案，逐字段对照 Boundaries & Constraints 的"只显示什么"清单。
  [`render.ts:185`](../../packages/control-plane/src/cli/render.ts#L185)
  [`render.ts:214`](../../packages/control-plane/src/cli/render.ts#L214)

**持久化与测试（外围）**

- `SqliteLaunchPlanRepository`：独立于 Story 1.1 仓储的 STRICT 表，`findActiveForClient` 支撑 `status`/`switch` 的"当前 plan"解析。
  [`launch-repository.ts:127`](../../packages/control-plane/src/adapters/sqlite/launch-repository.ts#L127)

- 领域/应用/adapters/CLI 四层测试覆盖 I/O 矩阵全部行，含状态机不变式、非 ASCII/空格路径、真实 OMP 二进制 smoke。
