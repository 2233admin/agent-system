# 仓库工作入口

本仓的项目级 Agent 规则正文在 [`entrypoints/agent-system.md`](./entrypoints/agent-system.md)，开始工作前读取。它只在工作目录落在本仓时加载，不进入用户级全局常驻面。

## 当前权威声明（2026-08-22，负责人确认）

**被替代内容：** 本仓 `authority/`（`00-map.md` 至 `11-execution-state.md`）、`src/agent_system/`（Python 实现）、`docs/`、`knowledge/`，以及本文件与 `README.md` 此前”先读 `README.md` → `authority/00-map.md` → 按 Issue 分流”的产品政策路由，此前被当作产品需求／架构／范围的权威来源。

**新结论：** 上述内容全部降级为历史资产，只作证据参考，不再反向定义当前需求、架构、方法或授权——理由是这些内容已多次与实际锁定的产品方向冲突（例如曾指向 `src/agent_system/` 的 Python 约定，与 BMad 侧已 `[ADOPTED]` 的 TypeScript/Bun 架构决定直接矛盾）。当前唯一的产品政策、架构与范围权威来源是 BMad 工作流的当前产出（`_bmad-output/` 下由 `bmad-*` Skill 生成并持续同步的文件），具体包括：

- `_bmad-output/specs/spec-agent-system/SPEC.md` 及其 companions（如 `validation-contract.md`）
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture/**/ARCHITECTURE-SPINE.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

新 Session 开始工作前，应直接读取上述 BMad 产出作为当前范围与权威依据，而不是本文件下方”仓库任务路由”里描述的 `README.md`／`authority/00-map.md` 旧流程；`entrypoints/agent-system.md` 中与 GitHub Issue 授权边界、避免破坏性操作等**流程安全护栏**相关的规则仍然有效，只有”以谁的内容定义产品政策”这一点被替换。

## 仓库任务路由

- 开始任何工作前，先读取 `README.md` 并执行其中的”开始工作”。
- 以 `authority/00-map.md` 为产品政策根；有明确 GitHub Issue 时先读取远端当前合同，只加载合同链接的最窄政策与证据。
- 带 `迁移索引/待分诊` 标签的 Issue 默认只允许分诊和只读核验；旧正文、私有评论与开放状态都不恢复实施授权。
- 没有明确 Issue 时保持自由对话或当前请求的最小范围；可以提出有界候选，不能自行激活、派发或恢复旧事项。
- 明确 Issue 的工作直接实施、验证并通过 PR 或自足证据评论交付；不从源码、开放状态或历史安装恢复额外行为与权限。
- 不把分析、提案、实验、历史记录或私有旧仓材料当成当前授权。
- 未经负责人明确确认，不扩大授权，不恢复暂停事项，也不修改产品政策。

## 知识按名问路

- 需要 Windows／PowerShell GitHub 多行 Markdown 或 Windows 长路径／文件锁知识时，主动按名运行 `python tools/knowledge_action_trigger/action_trigger.py --action github-multiline-markdown` 或 `--action windows-path-or-file-lock`，再按需读取返回的当前知识源。
- 这是可查询工具，不自动触发、注入或挂 Hook；也可直接按名读取 `knowledge/windows-powershell-multiline-transfer.md` 或 `knowledge/windows-agent-ops.md`。查询不扩大合同、权限或产品决定。
