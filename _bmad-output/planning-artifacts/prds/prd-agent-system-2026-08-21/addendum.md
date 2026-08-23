---
title: "Agent Context Assembly PRD 补充"
status: captured
created: 2026-08-21
updated: 2026-08-23
---

# Agent Context Assembly PRD 补充

本文件只保留不应进入产品需求正文、但需要交给后续架构阶段的已批准边界。它不作架构决定。

## 1. 实现语言候选

TypeScript 是后续架构阶段应认真评估的候选方向，不是当前既定架构。架构阶段必须根据目标运行环境、客户端集成面、类型与测试支持、分发方式和长期维护成本，将 TypeScript 与其他允许语言进行明确比较；在比较完成前，不得把 TypeScript 写成已确认技术选型。

## 2. 现有 Python CAP 的证据地位

现有 Python CAP 不可信任为后续建设的实现或迁移基线。它只可用于：

- 提供已暴露问题和真实 Bad Case；
- 证明部分产品概念曾被尝试；
- 作为需求与验收设计的反例输入。

后续若进入实现，必须从已确认的产品目标、范围与验收重新判断。只有经独立验证仍有价值的行为才可进入新方案；不得因代码已经存在而保留其架构、接口或行为。

## 3. 当前明确不作的技术决定

本阶段不定义或选择：

- CLI、TUI 或其他产品表面；
- Schema、Canonical IR、字段或存储布局；
- 适配器、进程边界、客户端集成机制；
- Python CAP 代码审计、Python 重写、TypeScript 迁移或兼容路径；
- OMP、Claude CLI 与 Codex CLI 的配置等价层；
- Hard Handoff、实时 Skill Discovery 或动态子 Agent 装配机制。

这些事项只有在 PRD 的用户结果、FR 与真实任务验收要求明确后，才能在架构阶段提出候选、比较取舍并获得确认。

## 4. 2026-08-23 裁决：Claude Code/Codex 第二客户端激活的技术边界

对应 PRD §4.4、§7 的 2026-08-23 裁决更新（第二客户端正式激活，纳入 Epic 4）。本节记录负责人在 correct-course 会话中对"如何实现"给出的明确技术裁决；这些是**已确认的约束**，不是留给架构阶段自由比较的候选——下一轮 `bmad-architecture` 必须遵守，不得重新选择其他机制，除非出现推翻下述核实结论的新证据。

- **硬控制，而非软控制。** 新 adapter 必须交付宿主客户端能够实际强制执行的权限/工具/MCP 边界（例如 Claude Code 的 settings.json 权限字段、hook 拒绝返回值），不得依赖 prompt 文字这类不可强制执行的软约束。
- **排除 OMP extension 路线。** 经核实 `oh-my-pi/docs/extensions.md`：OMP 自身的 extension 机制无法声明 Skills/Instructions，对 MCP 只能被动监听通知而不能配置，且不能代表独立客户端身份运行——技术上无法承担本次要求的能力，不得作为实现路径重新提出。
- **复用 Architecture Spine AD-19 窄端口模式。** 新 adapter 落在 `packages/control-plane` 内，按既有的 `probe → plan → launch/resume → interpret` 与 `capabilityStatus = supported | degraded | unsupported | unknown`（每项绑定证据）能力合同实现，不新建一套平行的能力语义。
- **`.cap/` 退役约束。** `.cap/manifest.toml`、`profiles/*.toml`、`runtime/claude.toml`、`skill-imports.toml` 是本次问题的证据来源与迁移前身，不是需求或架构基线；具体退役顺序留给下一轮 `bmad-architecture` 决定，但该顺序必须保证本仓自身运行的 Claude Code session（包括当前维护本仓的 session）在迁移期间不失去 skill/profile 装配能力，不得先退役后设计替代。
- **不与 Epic 3 合并。** Epic 3（OMP 配置供应与装配）与本次 Claude Code/Codex adapter 是两个不同客户端的能力域，不合并、不追求跨客户端配置或 Session 等价。

来源：`sprint-change-proposal-2026-08-23-cap-claude-codex-adapter.md`（已获负责人批准）。
