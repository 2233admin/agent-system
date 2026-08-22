---
title: "Agent Context Assembly PRD 补充"
status: captured
created: 2026-08-21
updated: 2026-08-21
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
