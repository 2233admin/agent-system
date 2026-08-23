# Sprint Change Proposal — CAP 角色(b) 归宿：正式激活 Claude Code/Codex 第二客户端

- **日期：** 2026-08-23
- **触发：** `_bmad-output/implementation-artifacts/epic-1-retro-2026-08-22.md` 的 open action item `epic-1-retro-item-7`（owner: repo owner）
- **模式：** Incremental
- **负责人：** Eridanus（本 session 内直接裁决）

## 1. Issue Summary

`.cap/`（`manifest.toml`、`profiles/*.toml`、`runtime/{claude,omp}.toml`、`skill-imports.toml`）长期身兼两职：

- **(a) OMP 配置管理** —— 已被 `packages/control-plane`（Epic 1、Epic 2，及进行中的 Epic 3）正式取代。
- **(b) Claude Code/Codex agent 能力装配** —— 给这两个客户端拼 Instructions/Skills/MCP，目前没有任何 epic 覆盖，也不在 Agent System 的 MVP 范围内。

`epic-1-retro-2026-08-22.md` 的 `epic-1-retro-item-7` 把这个缺口记成 open action item：要求负责人决定"为 CAP 角色(b) 立新 epic 纳入排期"还是"明确接受 CAP 继续独立兜底"。在此之前，角色(b) 的维护一直是散点直接提交（例如 `b9e95cd 优化：agent-assembler 补充 secret 边界与显式声明 openspec 能力`），不经过 sprint 跟踪，也没有 Agent System 那种类型化、绑定证据、fail-closed 的能力合同——只是 TOML allow/deny 清单加 prompt 文字约束。

本次 session 内负责人明确了两点，构成本提议的具体方向：

1. **要重新设计**，不是原地维护现状。
2. 重新设计要给的是**硬控制**（宿主客户端能实际强制执行的权限/工具/MCP 边界），排除了"OMP extension 软控制"路线——经核实，OMP 自身 extension 机制（`oh-my-pi/docs/extensions.md`）不能声明 Skills/Instructions，MCP 只能被动监听通知，也不能代表独立客户端身份，技术上做不出 CAP 角色(b) 需要的能力。
3. 硬控制层落地方式：**并入 Agent System，作为 `packages/control-plane` 新的 client adapter**，复用 Architecture Spine AD-19 已定义的窄端口（`probe → plan → launch/resume → interpret`，`capabilityStatus = supported | degraded | unsupported | unknown` 且每项绑定证据），而不是让 CAP 继续作为独立工具自建一套平行的硬控制原则。

这直接触发 PRD §4.4"已确认 MVP 客户端范围"与 §7"明确非目标"、Architecture Spine AD-1 与 Deferred 小节里明确写下的重开条件：**"出现第二客户端的重复真实任务或 Bad Case 时，才重新评估扩大覆盖"** / **"只有产品合同明确激活第二客户端后，按 AD-19 增量资格"**。`epic-1-retro-item-7` 记录的持续维护负担与治理缺口即是这个 Bad Case 证据；本次是负责人的明确裁决。

## 2. Impact Analysis

### Epic Impact

- **Epic 1、Epic 2：** 不受影响，按原计划完成，无需修改。
- **Epic 3（配置供应与装配，OMP）：** 不受影响，也不与本次新增能力域合并——Epic 3 服务 OMP，本次服务 Claude Code/Codex，两者是不同客户端 adapter，不追求跨客户端配置或 Session 等价（AD-1、AD-19 既有原则）。
- **新增 Epic 4：** 需要新增一个 epic 覆盖 Claude Code/Codex adapter 与 `.cap/` 退役迁移（见下方"Detailed Change Proposals"）。

### Artifact Conflicts

- **PRD：** §4.4"已确认 MVP 客户端范围"（当前锁定单一 OMP 客户端环境）与 §7"明确非目标"（"第二个或更多 Agent 客户端的产品支持；扩大覆盖必须由重复真实任务或 Bad Case 触发"）两处的重开条件被本次裁决触发，需要在下一轮 `bmad-prd`（addendum）中正式表态；具体新增 FR 留给该轮产出，本提议不代写。
- **Architecture Spine：** AD-1（"MVP 只实现并验收 OMP；Claude Code/Codex CLI 不进入 MVP 完成门"）与 Deferred 小节"Claude Code/Codex adapter 实现与产品承诺"条目需要重新表态；AD-19 的窄端口设计本身不需要改规则，只需要在其"MVP 边界"标注里补上第二客户端的 capability 覆盖范围；结构种子 `packages/control-plane/src/adapters/clients/` 下需要新增 `claude/` 与 `omp/` 并列。这些行文本身的正式改写，留给下一轮 `bmad-architecture` 产出（沿用 Epic 3 先例的处理方式：correct-course 记录裁决，不直接改 Architecture Spine 正文）。
- **UX：** 本轮 MVP 跳过了独立 UX 阶段（PRD §"UX Design Requirements"），交互合同直接写进 Story。新 epic 涉及的交互面（尤其是 Claude Code 通常已是交互中会话、而非像 OMP 一样 fresh spawn 的执行模型差异）比 Epic 1 更复杂，建议下一轮走一次 `bmad-ux`，而不是像 Epic 1 一样直接把合同写进 Story。
- **其他工件：**
  - `.cap/` 本体（`manifest.toml`、`profiles/*.toml`、`runtime/claude.toml`、`skill-imports.toml`）成为新 adapter 的需求/参照输入，新 adapter 交付后需要一个明确的退役顺序，避免本仓自己的 Claude Code session（包括当前这个 session）在迁移期间失去 skill/profile 装配能力。
  - `openspec/` 下治理 `.cap` 的既有 change（`v3-assembly-executor`、`add-claude-cap-adapter`、`enable-windows-cap-assembly`、`harden-assembly-helper-maintenance` 等 spec）需要在新 adapter 落地后收敛，避免同一能力域出现两份权威合同。
  - 测试/验证边界需要新增 Claude Code/Codex 的 adapter contract 测试（参照 Architecture Spine"验证边界"一节对 OMP 的覆盖方式：schema/domain/仓储/隐私/adapter-contract/故障实验/目标 smoke），但 Claude Code 的"通常已在交互会话中运行"执行模型与 OMP 的"CLI spawn 一个新进程"不同，如何纳入 AD-7/AD-18 的 launch-scoped operation 状态机是一个需要下一轮 `bmad-architecture` 明确解决的开放问题，本提议不预先下判断。

## 3. Recommended Approach

**Option 3（PRD MVP Review）+ 新增 Epic，Major 范围变更。**

- Option 1（直接调整）不可行：这不是在现有 epic 结构内加故事就能解决的问题，需要改 PRD Non-goals 与 Architecture MVP 边界锁定条款。
- Option 2（回滚）不适用：没有已完成故事需要撤销，Epic 1/2 与进行中的 Epic 3 都保持有效。
- Option 3 可行且是唯一路径：PRD 与 Architecture 都已经把"第二客户端"预留为一个明确可重开的口子（"产品合同明确激活后，按 AD-19 增量资格"），本次负责人裁决正是这个重开触发条件本身；Architecture 的 AD-19 窄端口模式已经把"多客户端复用同一能力合同"的设计工作提前做好，降低了这次扩展的新设计风险。

**理由：**
1. 负责人本 session 内明确表达了三层递进的意图（要重新设计 → 要硬控制而非软控制 → 要并入 Agent System 复用既有能力合同模式），三者共同构成一次有意的战略决定，不是临时调整。
2. `.cap` 当前的软约束（TOML allow/deny + prompt 文字）与 CAP 角色(b) 已经产生的持续维护负担（`epic-1-retro-item-7`、散点提交）是真实的 Bad Case 证据，满足 PRD/Architecture 自己写好的重开门槛。
3. 把新 adapter 放进 `control-plane` 而不是让 CAP 继续独立发展一套平行硬控制原则，避免"同一类问题两套实现、两份真理来源"（这正是 AD-19 本身要防止的"两个 adapter 各自合规却不兼容"）。

**风险与代价（Major 范围变更固有）：** 需要 PM（PRD Non-goals/§4.4 addendum）与 Architect（AD-1/Deferred/AD-19 边界改写、结构种子扩展）介入，不是本次 correct-course 或 Developer agent 能直接实施完成的；Claude Code 执行模型（交互中会话 vs fresh spawn）与 AD-7/AD-18 状态机的适配方式仍是开放问题，需要下一轮 `bmad-architecture` 解决，不在本提议范围内预先给出答案。

## 4. Detailed Change Proposals

### PRD（`prd-agent-system-2026-08-21/prd.md`）

**待办（下一轮 `bmad-prd` 产出，本提议不代写正文）：**
- §4.4"已确认 MVP 客户端范围"：记录第二客户端（Claude Code/Codex）激活裁决与触发依据。
- §7"明确非目标"：更新"第二个或更多 Agent 客户端的产品支持"条目的触发状态。
- 视需要新增覆盖 Claude Code/Codex 装配的 FR（具体条目留给该轮产出）。

### Architecture Spine（`ARCHITECTURE-SPINE.md`）

**待办（下一轮 `bmad-architecture` 产出，本提议不代写正文，沿用 Epic 3 先例不在 correct-course 直接改 Architecture 正文）：**
- AD-1：更新"Claude Code/Codex CLI 不进入 MVP 完成门"的表述。
- Deferred 小节："Claude Code/Codex adapter 实现与产品承诺"条目重新表态为已激活。
- AD-19"MVP 边界"标注：补充第二客户端 capability 覆盖范围。
- 结构种子：`packages/control-plane/src/adapters/clients/` 下新增 `claude/`（`codex/` 视范围决定是否同批）。
- 明确 Claude Code"交互中会话"执行模型如何适配 AD-7/AD-18 launch-scoped operation 状态机（开放问题，留给该轮解决）。

### epics.md

**新增 Epic 4（本提议批准后立即写入，见下方 diff）：**

```
### Epic 4：装配并激活 Claude Code/Codex 客户端（Agent System 第二客户端）

`configs` 新增对 Claude Code 与 Codex CLI 的类型化 client adapter（复用 Architecture Spine
AD-19 已定义的窄端口：probe → plan → launch/resume → interpret，capability 状态固定为
`supported | degraded | unsupported | unknown` 并绑定证据），以硬控制（native 权限/工具/MCP
层面可强制执行的边界）交付 Instructions/Skills/MCP 装配，取代现有 `.cap/`（`.cap/manifest.toml`、
`profiles/*.toml`、`runtime/claude.toml`、`skill-imports.toml`）当前依赖 TOML 允许清单与未经
证据绑定的软约束的装配方式。这条能力域此前被 PRD §4.4"已确认 MVP 客户端范围"与 §7"明确非目标"、
Architecture Spine AD-1 与 Deferred 小节明确列为"第二客户端"，需等待"产品合同明确激活"才重新评估；
本次由负责人在 correct-course 会话中依据 epic-1-retro-2026-08-22.md 的 open action item（CAP
长期独立兜底、缺乏 epic 覆盖、以软约束方式维护）与本仓持续的 ad hoc CAP 维护证据（如 `b9e95cd`
等散点提交），明确裁决触发该重开条件、正式激活第二客户端。装配（Claude Code/Codex adapter、硬控制
能力合同）与迁移退役 `.cap/` 保持在同一能力域内处理，不与 Epic 3（OMP 配置供应与装配）合并——两者
服务不同客户端、不追求跨客户端配置或 Session 等价（AD-1、AD-19）。具体 adapter 边界、Claude Code
特有的"通常已是交互中会话而非 fresh spawn"执行模型如何纳入 launch-scoped operation 状态机、`.cap/`
到新 adapter 的迁移与退役顺序、PRD Non-goals 与 Architecture AD-1/Deferred 的正式改写，均留给后续
bmad-prd（addendum）、bmad-architecture、bmad-create-epics-and-stories 产出。

**覆盖：** PRD §4.4、§7 对应裁决的重新表态（第二客户端激活触发条件已满足）；Architecture Spine
AD-1、AD-19、Deferred 小节"Claude Code/Codex adapter"条目的重新表态；覆盖
epic-1-retro-2026-08-22.md open action item `epic-1-retro-item-7`。

（2026-08-23 新增，见 `sprint-change-proposal-2026-08-23-cap-claude-codex-adapter.md`）
```

### sprint-status.yaml

**新增（本提议批准后立即写入）：**
- `development_status` 下新增 `epic-4: backlog`（暂不列 story 子项，story 拆分留给
  `bmad-create-epics-and-stories`）。
- `action_items` 中 `epic-1-retro-item-7` 状态由 `open` 改为 `done`，补充
  `resolved_ref: sprint-change-proposal-2026-08-23-cap-claude-codex-adapter.md`，说明
  "决定"本身已完成，后续执行由 epic-4 承接跟踪。

## 5. Implementation Handoff

**范围分类：Major** —— 需要 PM 与 Architect 介入，Developer agent 不能直接据此实施。

- **Product Manager（`bmad-prd`）：** 在 `prd-agent-system-2026-08-21/` 下产出新的 addendum，正式改写 §4.4 与 §7 对应裁决；如需要，起草覆盖 Claude Code/Codex 装配的新 FR。
- **Solution Architect（`bmad-architecture`）：** 更新 `ARCHITECTURE-SPINE.md` 的 AD-1、Deferred、AD-19 MVP 边界标注与结构种子；明确 Claude Code 执行模型（交互中会话 vs fresh spawn）与 AD-7/AD-18 状态机的适配方式；给出 `.cap/` 退役迁移顺序，确保本仓自身的 Claude Code session 装配在迁移期间不中断。
- **后续（Architect 产出后）：** `bmad-create-epics-and-stories` 把 Epic 4 拆成具体 Story；`bmad-sprint-planning` 纳入正式跟踪。

**成功标准：** PRD addendum 与 Architecture Spine 更新均落盘、内部一致（不再有"Non-goal 未重开但 epics.md 已经在做"这种矛盾）；`epic-4` 在 `sprint-status.yaml` 可跟踪；`.cap/` 退役路径明确到不会让本仓 Claude Code session 中途失去装配能力。
