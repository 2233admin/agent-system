# Epic 4 Context: 装配并激活 Claude Code 客户端

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

当前 `.cap/` 用 TOML 允许清单和 prompt 文字给 Claude Code 装配 Instructions/Skills/MCP，属于宿主无法强制执行的软约束，且长期以散点提交独立维护、缺乏 epic 覆盖。本 Epic 为 Claude Code 建立一个类型化 client adapter，把装配边界改为宿主原生可强制执行的硬控制（如 settings.json 权限字段、hook 拒绝返回值），复用已有的 probe → plan → launch/resume → interpret 窄端口与固定的 `capabilityStatus` 证据合同，并按严格四步顺序把本仓自身的 Claude Code 装配来源从 `.cap/` 迁移过去，最终退役 `.cap/` 本体。Codex CLI 因缺乏真实装配证据不在本 Epic 范围内。

## Stories

- Story 4.1：建立 Claude Code adapter 骨架与硬控制能力探测
- Story 4.2：装配 Claude Code 的确定性 AdapterPlan
- Story 4.3：fresh target 的启动与观察
- Story 4.4：already-running session target 的 requires-restart 路径
- Story 4.5：`.cap/` parity 验证与本仓自身切换
- Story 4.6：退役 `.cap/` 本体

## Requirements & Constraints

- 装配边界必须是宿主原生可强制执行的硬控制；prompt 文字承诺、文档声称或未核实假设一律不得作为 `supported` 的证据，无法验证时返回 `unknown`。
- 能力状态固定为 `supported | degraded | unsupported | unknown`，且每项绑定可回读证据；必需能力缺失或不兼容时 fail closed，只有可选项缺失才可标 `degraded` 并列出受影响能力，不得静默忽略或伪装成已装配。
- 同一份装配意图（等价于 `.cap/manifest.toml` + `profiles/*.toml` + `skill-imports.toml` 当前表达的引用集合）在相同输入下必须产出确定性相同的 plan（hash 相同）；不产出任何候选、评分或推荐（本 Epic 与 Epic 1～3 一致，不做候选/推荐）。
- 不追求 Claude Code 与 OMP（或未来 Codex）之间的配置等价、Session 翻译或三端同步；不构成对 Claude Code/Codex 之外任何客户端的支持承诺。
- 不做建立/修订装配意图的工作流（那是 Epic 3 的范围）；本 Epic 只消费已存在的装配意图并交付给 Claude Code。
- `.cap/` 只是证据来源和迁移前身，不是需求或架构基线；退役必须按固定四步严格顺序执行（先建新 adapter → 一次性 parity 验证 → 本仓自身切换 → 退役 `.cap/` 本体），不得先退役后设计替代。
- 整个迁移期间，本仓自身运行的 Claude Code session（包括当前维护本仓的这个 session）不得失去 skill/profile 装配能力；无法保证不中断时先记录为阻塞项，不强行切换。
- Codex CLI 继续 Deferred，不在本 Epic 内建 adapter 目录或实现。

## Technical Decisions

- 新 adapter 落在 `packages/control-plane/src/adapters/clients/claude/`，复用既有 domain/application 层，不另起新包，与 `adapters/clients/omp/` 并列。
- 复用同一套 `AssemblyManifest`/`AdapterPlan`/`LaunchReceipt` 合同与 `capabilityStatus` 枚举，不新建平行的能力语义；`AdapterPlan` 只含 argv 结构、环境键、secret/content 引用、hash 与预期观察，不持久化实际环境值或文件内容。
- 会话模型分两种 launch target，共享同一状态转换表（`prepared → awaiting-confirmation → applying → observing → succeeded | degraded | failed | incomplete`，以及 `prepared → requires-restart`）：
  - **fresh**：本产品新 spawn 一个 Claude Code 进程，完整走该转换表，`observationStage` 可推进到 `launched`/`observed`，与 OMP adapter 同构。
  - **already-running session**（如当前维护本仓的 session）：不拥有该进程，`apply` 只能解析为既有终态 `requires-restart`，不新增状态、不产生部分应用的 SQLite 事实；`observationStage` 在用户实际重启前保持 `planned`，不得推进到 `launched`/`observed`/`verified`。
  - `plan` 阶段必须显式判断 target 属于哪一种；无法判断时按更保守的 already-running 处理（fail closed）。
- 明确排除 OMP extension 路线：经核实其机制无法声明 Skills/Instructions，对 MCP 只能被动监听通知，也不能代表独立客户端身份，技术上无法承担本 Epic 要求的能力。
- `.cap/` 退役四步顺序与 Story 对应关系：Story 4.1～4.2 对应"落地新 adapter"，4.3～4.4 对应验证 fresh/already-running 两条 target 路径，4.5 对应"parity 验证 + 本仓自身切换"，4.6 对应"退役 `.cap/` 本体"。本仓现存的 `general`、`agent-assembler` 两个 profile 是新 adapter 需要覆盖的最小集合。
- 验证边界新增 Claude Code adapter contract 测试：覆盖 capabilityId/subject、required/optional、四态 capabilityStatus、退出码与 receipt 解释（fresh target）；专项验证 `apply` 在 already-running target 下必然解析为 `requires-restart`、`observationStage` 不越过 `planned`、且无论 target 判断结果如何都不产生部分应用的 SQLite 事实。

## Cross-Story Dependencies

Story 4.1（probe）是 4.2（plan）的前置；4.2 产出的 AdapterPlan 是 4.3（fresh 启动）与 4.4（already-running requires-restart）两条路径的共同输入。4.3 与 4.4 都验证通过后才能进入 4.5（parity 验证 + 本仓自身切换）；4.5 稳定运行后才能执行 4.6（退役 `.cap/` 本体），4.6 明确禁止在 4.5 未验证稳定时执行。本 Epic 与 Epic 3（OMP 配置供应与装配）相互独立、不合并，服务不同客户端，不产生跨 Epic 的直接依赖。
