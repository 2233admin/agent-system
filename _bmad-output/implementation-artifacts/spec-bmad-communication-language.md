---
title: '补齐 BMad 通信语言配置'
type: 'bugfix'
created: '2026-08-23'
status: 'done'
route: 'one-shot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BMad 构建技能渲染时缺少 `communication_language`，导致工作流在执行前直接 HALT。

**Approach:** 在安装器可持久覆盖的自定义配置中补齐 `core.communication_language = "Chinese"`，不修改安装器管理的基础配置。

## Boundaries & Constraints

**Always:** 保持现有中文输出约定；仅补齐缺失配置；使用 `_bmad/custom/config.toml` 作为持久覆盖层。

**Ask First:** 无。

**Never:** 不修改 `_bmad/config.toml`；不改变其他 BMad 配置；不触碰 OMP 登录态或用户凭据。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 配置渲染 | 自定义配置包含 `communication_language = "Chinese"` | BMad 构建技能成功生成 workflow 路径 | 渲染失败时保留明确错误，不继续执行工作流 |
| 配置合并 | 基础配置已有 `document_output_language = "Chinese"` | 两个语言配置同时保留，其他配置不变 | 不覆盖基础配置文件 |

## Code Map

- `_bmad/custom/config.toml` -- 持久化 BMad 配置覆盖层，新增通信语言。

## Tasks & Acceptance

**Execution:**
- [x] `_bmad/custom/config.toml` -- 补齐 `core.communication_language` -- 解除构建工作流渲染阻断。

**Acceptance Criteria:**
- Given 自定义配置提供中文通信语言，当渲染 `bmad-build` 工作流时，应成功输出可读取的 workflow 路径。
- Given 安装器管理的基础配置，当补齐自定义覆盖时，应保持基础配置文件未修改。

## Verification

**Commands:**
- `uv run --no-cache "C:/Workspace/worktrees/agent-system/auth/_bmad/scripts/render_skill.py" --project-root "C:/Workspace/worktrees/agent-system/auth" --skill "C:/Workspace/worktrees/agent-system/auth/.agents/skills/bmad-build"` -- expected: 输出 `read and follow ... workflow.md`，不再出现 `missing config value`。

</frozen-after-approval>

## Suggested Review Order

**配置合并边界**

- 通过持久覆盖层补齐缺失字段，避免改动安装器管理文件。
  [`config.toml:7`](../../_bmad/custom/config.toml#L7)
