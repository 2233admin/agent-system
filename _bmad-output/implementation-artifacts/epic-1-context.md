# Epic 1 Context: 查看、选择并使用 OMP 配置

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

用户需要看清一个已保存配置包含什么、按需机械比较多个配置，再选定一个具体修订，经一次确认 fresh 启动 OMP；进入 OMP 后恢复会话交给原生 resume，外部 CLI 只查看配置应用与启动生命周期状态。这是本轮唯一交付范围（MVP-FR1～FR10），落地"选配置 → 确认一次 → 使用 OMP"，明确排除候选/推荐、配置创建编辑和任务观察。

## Stories

- Story 1.1: 查看与比较配置内容
- Story 1.2: 选择配置并使用 OMP

## Requirements & Constraints

- 配置列表/详情只呈现机械可证明事实（名称、修订、来源、边界、状态）；未知一律 `Unknown`，不得由“存在/已安装”推导已生效；无配置显示诚实空状态；私域资产只显示受控引用，不落地原文、凭据、prompt、transcript、工具 payload。
- 比较仅在用户自选多个配置时触发，纯机械并列（组成/来源/边界/差异/Unknown），不产生评分/排序/Recommendation/自动候选；单看一项不要求先凑数量。解析失败时显示标识、类型化原因、恢复入口，不静默回退默认配置。
- 选定修订后一次确认即 fresh 启动；确认绑定当前 operation/修订/计划，拒绝或计划变化即失效，不可跨配置/进程复用。启动在独立 invocation 边界内 argv spawn（不经 shell），不改写用户全局配置。prompt/任务参数只作不透明透传，不解析、不持久化、不观察执行或结果。
- 启动状态只含所选修订、client/version、启动阶段、应用结果、已知差异/Unknown，绝不含任务内容或推荐。
- OMP 内当前配置/状态/切换 native-first：capability probe 证明原生能力满足合同即复用，不足才由薄扩展补最小面，两路径不得形成不同事实源。resume 完全由 OMP 原生负责，Agent System 不拦截、不存 locator。
- 切换配置返回“需要重启”，新配置建新计划并需新确认；不热改原进程、不自动 resume。启动失败显示阶段、受影响项、原因、Unknown、恢复动作；不伪造成功；仅 optional 失败可标 degraded。
- 选择 Claude Code/Codex CLI 时明确返回不支持，不提供占位实现。

## Technical Decisions

- 外部 TypeScript/Bun CLI，六边形模块化单体：`domain`（纯实体/状态机）、`application`（唯一状态变更入口）、`adapters`（OMP client、SQLite、投影、system）。`domain` 不得导入 OMP/Bun/SQLite/文件系统/进程环境/投影格式；adapter 不得自行做产品决定。测试运行器为 `bun:test`。
- SQLite（STRICT、WAL）是配置修订/用户选择/启动 operation 的持久权威；JSON/Markdown 仅为可重建的 allowlist 投影；凭据、transcript、原生 Session 始终归 OMP，禁止导入产品库。配置修订不可变，Epic 1 只读消费，不创建/编辑。
- SQLite 事务与进程启动不声明原子性：apply 走 operationId+planHash+manifestHash 条件写入认领，receipt 经 reconcile 校验后幂等入库。事实值统一 `Known<T>` / `Unknown(reason, observedAt)`，禁止 `null`/缺行表示未知；capability 固定 `supported|degraded|unsupported|unknown`。
- 激活转换表：`prepared → requires-restart|awaiting-confirmation|failed|cancelled → applying → observing → succeeded|degraded|failed|incomplete`；终态不可原位改写。进程直接 argv spawn，显式管理 cwd/env/stdio/exit/signal；桥写失败不阻止 OMP 退出，只使对应 observation 为 Unknown。
- MVP 边界（负责人裁决，覆盖 SPEC/Architecture 完整目标态）：不实现配置创建/编辑、候选/Recommendation（AR13/AR15）；不做逐项目标/约束/权限重判、不持久化 opaque Session locator、不实现 explicit resume 或 lease/fencing（AR15）；不做任务观察/三层验证作为产品运行时功能（AR13，三层验证仅外部开发验收门）；配置供应不是本轮能力，无配置只显示诚实空状态（AR16）。

## UX & Interaction Patterns

- 日常路径固定“查看/选择配置 → 一次确认 → 使用 OMP”，不要求管理单项资产；选择配置本身和进入 OMP 后不再产生额外确认。
- 比较与详情视图并列同一字段口径，支持按需展开，不引入排序/评分/推荐 UI。Unknown、失败原因与恢复入口和正常状态同等可见，不得默认折叠。

## Cross-Story Dependencies

- Story 1.2 依赖 Story 1.1 的配置查看模型（字段口径、Unknown 展示语法）；启动确认复用同一套字段展示待启用的 Instructions/Skills/MCP，失败展示复用同一“类型化原因 + 恢复入口”模式。
- 两条 Story 共享同一 OMP-only native-first 判定，不得形成不同事实源。
