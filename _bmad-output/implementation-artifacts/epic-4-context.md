# Epic 4 Context: 装配并激活 Claude Code 客户端

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

当前 `.cap/` 用 TOML 允许清单和 prompt 文字给 Claude Code 装配 Instructions/Skills/MCP，属于宿主无法强制执行的软约束，且长期以散点提交独立维护、缺乏 epic 覆盖。本 Epic 为 Claude Code 建立一个类型化 client adapter，把装配边界改为宿主原生可强制执行的硬控制（如 settings.json 权限字段、hook 拒绝返回值），复用已有的 probe → plan → launch/resume → interpret 窄端口与固定的 `capabilityStatus` 证据合同，并按顺序把新 adapter 建到功能对等 `.cap`（含真实内容交付、CLI 入口），验证通过后退役 `.cap/` 本体。Codex CLI 因缺乏真实装配证据不在本 Epic 范围内。

**2026-08-24 范围补全：** Story 4.5 的 AC2（本仓自身切换）经调查证明其前置对象不存在——本仓自身交互式 Claude Code session 的 skills/CLAUDE.md 由 Claude Code 原生项目目录发现机制读取 git 跟踪文件，与 `.cap` 的渲染管线无关。真正阻挡"退役 `.cap`"的是两个此前未被识别的能力缺口：新 adapter 的 fresh 启动尚不具备真实内容物化能力（只传硬控制 flag，不交付 Instructions/Skills/MCP 内容），且 `configs` CLI 没有任何入口能调用新 adapter 的 Claude 相关代码。因此新增 Story 4.5b（内容物化能力）与 Story 4.6（CLI 入口），原 Story 4.6（退役 `.cap/` 本体）顺延为 Story 4.7，`.cap/` 退役顺序从四步收窄为三步。

## Stories

- Story 4.1：建立 Claude Code adapter 骨架与硬控制能力探测（done）
- Story 4.2：装配 Claude Code 的确定性 AdapterPlan（done）
- Story 4.3：fresh target 的启动与观察（done）
- Story 4.4：already-running session target 的 requires-restart 路径（done）
- Story 4.5：`.cap/` parity 验证与本仓自身切换（done，AC2 已收窄为存档调查结论）
- Story 4.5b：Claude adapter 内容物化能力（backlog）
- Story 4.6：`configs` CLI 的 Claude 入口（backlog）
- Story 4.7：退役 `.cap/` 本体（backlog，原 Story 4.6）

## Requirements & Constraints

- 装配边界必须是宿主原生可强制执行的硬控制；prompt 文字承诺、文档声称或未核实假设一律不得作为 `supported` 的证据，无法验证时返回 `unknown`。
- 能力状态固定为 `supported | degraded | unsupported | unknown`，且每项绑定可回读证据；必需能力缺失或不兼容时 fail closed，只有可选项缺失才可标 `degraded` 并列出受影响能力，不得静默忽略或伪装成已装配。
- 同一份装配意图在相同输入下必须产出确定性相同的 plan（hash 相同）；不产出任何候选、评分或推荐（本 Epic 与 Epic 1～3 一致，不做候选/推荐）。
- 不追求 Claude Code 与 OMP（或未来 Codex）之间的配置等价、Session 翻译或三端同步；不构成对 Claude Code/Codex 之外任何客户端的支持承诺。
- 不做建立/修订装配意图的工作流（那是 Epic 3 的范围）；本 Epic 只消费已存在的装配意图并交付给 Claude Code。
- `.cap/` 只是证据来源和迁移前身，不是需求或架构基线；退役必须按固定三步严格顺序执行（落地新 adapter，含内容物化与 CLI 入口 → 真实烟雾 parity 验证 → 退役 `.cap/` 本体），不得先退役后设计替代。
- Codex CLI 继续 Deferred，不在本 Epic 内建 adapter 目录或实现。

## Technical Decisions

- 新 adapter 落在 `packages/control-plane/src/adapters/clients/claude/`，复用既有 domain/application 层，不另起新包，与 `adapters/clients/omp/` 并列。已交付：`process-port.ts`、`capability-probe.ts`（Story 4.1）、`assembly-manifest.ts`（原 `plan.ts`，Story 4.2）、`adapter-plan.ts`（真正的 AD-19 `AdapterPlan`，含 `ClaudeLaunchTarget`，Story 4.3）；`application/claude-launch.ts` 提供 `prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`（Story 4.3）与 `prepareClaudeAlreadyRunningLaunchPlan`（Story 4.4）。
- 会话模型分两种 launch target，共享同一状态转换表：**fresh**（本产品新 spawn 一个隔离 Claude 进程，完整走 `prepared → awaiting-confirmation → applying → observing → succeeded | degraded | failed | incomplete`）与 **already-running session**（`apply` 只能解析为既有终态 `requires-restart`，`observationStage` 在用户实际重启前保持 `planned`）；`plan` 阶段无法判断 target 类型时按更保守的 already-running 处理（fail closed）。
- **AD-21（2026-08-24 新增）：Claude adapter 内容物化。** OMP 与 Claude Code 在内容装配上存在真实能力非对称：OMP 的 `buildOmpArgv` 只传能力名字交给 OMP 自身原生机制解析，从不物化内容；Claude Code 的 `--plugin-dir` 只接受真实文件目录路径，没有"给名字帮你解析"的原生机制，因此 Claude adapter 必须自己把 `CapabilityReference.sourceRef` 解析为真实内容，写入 `ClaudeInvocationDirPort` 隔离目录下的专用 `materialized/` 子目录（不写入目录根，根同时是 `cwd` 与 `CLAUDE_CONFIG_DIR`，直接写入有真实碰撞风险）：Skills 重建 `.cap` 已实测的真实 Claude plugin 包布局（`materialized/plugin/.claude-plugin/plugin.json` + `materialized/plugin/skills/<name>/`）经 `--plugin-dir` 交付；Instructions 直接作为 `--append-system-prompt` 的参数文本；MCP 生成 `materialized/mcp.json`（原生 `mcpServers` 格式）经 `--mcp-config` + `--strict-mcp-config` 交付。内容本身从不进入 SQLite/投影/receipt（AD-6 边界不变），调用终态后随 invocation 目录一并清理，不早于 Claude 进程或其子进程可能仍在读取期间。
- **阻塞前提：** 今天经 `src/adapters/sources/cap-fs.ts`（`loadCapConfigRevisions`，由 `scripts/seed-from-cap.ts` 调用）从 `.cap/` 灌入的修订，其每个 `CapabilityReference` 的 `sourceRef`/`contentFingerprint` 都被硬编码为 `CAP_FS_FIELD_NOT_CAPTURED`（`Unknown`）——Story 4.5b 必须先修 `cap-fs.ts`，让它把本就读得到的真实磁盘路径写进 `sourceRef`，而不是发明新的名字→路径映射规则；否则 AD-10 fail-closed 会让本仓现存的每条 `.cap`-seeded 修订在 Claude 侧全部降级/不支持。
- **Probe 前提：** `--plugin-dir`、`--append-system-prompt` 当前只有 `.cap` 既有证据与文档核实过，未被 Story 4.1 的 `BunClaudeCapabilityProbe` 纳入探测；Story 4.5b 必须先扩展 probe 覆盖这两个 flag，并重新执行一次完整 probe（不复用旧版本快照——`.cap` 核实基线 2.1.236 与本机实测 2.1.241 已知漂移）。
- **CLI 入口（Story 4.6）：** `domain/client.ts` 的 `resolveClientSupport('claude-code')` 从硬编码 `unsupported` 改为基于 Story 4.1 真实探测结果；`configs use/switch --client claude-code` 复用 Story 1.2 已确立的确认/生命周期流程与 Story 4.3/4.4 已实现的 fresh/already-running 分支，成功路径经 Story 4.5b 的内容物化真实交付。不改变 OMP 侧既有行为。
- **`.cap/` 退役三步顺序（2026-08-24 收窄，原四步）：** (1) 落地新 adapter——probe/plan/launch/interpret + AD-21 内容物化 + CLI 真实入口（Story 4.1～4.4、4.5b、4.6）；(2) 一次性真实烟雾 parity 验证——物化后实际交付的 `--plugin-dir`/`--append-system-prompt`/`--mcp-config` 内容与 `cap use <role> --cli claude` 真实产出对照（Story 4.5 的 AC1 已完成静态结构比对，真实烟雾验证并入 Story 4.7 的前置条件）；(3) 退役 `.cap/` 本体（Story 4.7），需先核实 `.cap/` 不在产品运行时路径上（已确认只被开发期 `scripts/seed-from-cap.ts` 及其测试读取），并把 `openspec/specs/` 下与 `.cap/` 相关的现存 spec（`v3-assembly-executor` 已确认相关）收敛为归档。原"本仓自身切换"步骤已删除：调查证明该对象不存在，AD-20 已原地澄清。
- 明确排除 OMP extension 路线：经核实其机制无法声明 Skills/Instructions，对 MCP 只能被动监听通知，也不能代表独立客户端身份，技术上无法承担本 Epic 要求的能力。

## Cross-Story Dependencies

Story 4.1（probe）是 4.2（plan）的前置；4.2 产出的 AdapterPlan 是 4.3（fresh 启动）与 4.4（already-running requires-restart）两条路径的共同输入。4.3/4.4 完成后是 4.5（parity AC1 + AC2 调查存档）的前置，均已 done。4.5b（内容物化）依赖 4.3 的 `ClaudeInvocationDirPort`、4.1 的 probe 基础设施（需扩展）；4.6（CLI 入口）依赖 4.5b 已完成（成功路径需要真实内容交付，不能只有硬控制 flag）与 4.3/4.4 的生命周期逻辑。4.7（退役 `.cap/`）需要 4.5b 与 4.6 均完成，且真实烟雾测试验证功能对等，明确禁止在此前执行。本 Epic 与 Epic 3（OMP 配置供应与装配）相互独立、不合并，服务不同客户端，不产生跨 Epic 的直接依赖。
