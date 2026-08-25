# Reviewer: current-tech（具名技术是否经核实而非凭训练数据断言）— AD-22

**Verdict: PASS with findings**（1 项 medium）

## 逐条核实结果

| AD-22 依赖的技术断言 | 核实方式 | 结论 |
| --- | --- | --- |
| Claude Code 从项目目录 `.claude/skills/` 原生发现 Skill | **直接观察**：本 session 的 Skill 列表含全部 49 个 `bmad-*`，而这些 Skill 在仓内仅存在于 `.claude/skills/` 与 `.agents/skills/` | 已核实，最强证据等级 |
| `plugins/<组>/skills/<名>/` 不是原生发现路径 | **直接观察**：`adaptive-problem-solving`／`orchestrated-collaboration`／`grilling` 均在 `plugins/` 下且均**不在**本 session 的 Skill 列表中 | 已核实 |
| BMad 上游版本 6.11.0 | `_bmad/_config/manifest.yaml` 的 `installation.version`；`tools/skill_registry/registry.md` 记「2026-08-24 核实为上游当前最新版」 | 已核实（本仓昨日核实） |
| `_bmad/core/<skill>/SKILL.md` 不存在于磁盘 | `ls` 实测：`_bmad/core/` 只有 `config.yaml`、`module-help.csv`、`v6-shims` | 已核实 |
| `configs use <id> --client claude-code` 是真实入口 | 读 `src/cli/index.ts` 的 `USAGE_SYNTAX`、`KNOWN_CLIENT_IDS`、`resolveClientSupport`（Story 4.6 已把 claude-code 从硬编码 unsupported 改为真实探测） | 已核实 |
| `content-materializer.ts` 把 `sourceRef` 当作可直接使用的磁盘路径 | 读源码：`resolveSourcePath` 返回 `reference.sourceRef.value`，`materializeSkills` 对其 `cp(..., {recursive:true})` | 已核实 |
| `plugins/skill-imports.toml` 无产品代码读取 | 全仓 grep：唯一引用者 `plugins/tests/workflow-routing.test.ts` | 已核实 |

## F1 [medium] Codex 的原生发现路径未核实

AD-22 写「Codex 读 `.agents/skills/`」。该断言的来源是 `_bmad/_config/manifest.yaml` 的 `ides: [claude-code, codex, pi]` 加上仓内恰好存在 `.claude/skills` 与 `.agents/skills` 两个目录——即**从安装器的三个 IDE 声明反推两个目录的归属**。注意声明了三个 IDE 却只有两个目录，说明 `.agents/skills` 至少服务其中两个（codex 与 pi），映射关系并非一一对应，反推不成立。

本仓没有 Codex 的实测证据，Codex 侧也没有任何 adapter（AD-1 仍 Deferred）。按 AD-15 既定原则「文档声称但未经 probe/smoke 证实的能力保持 Unknown」，这条不该以肯定语气写进 AD。

**处置：** autofix —— 在 AD-22 中把 Codex 的发现路径标注为未核实推断，并挂到既有的 Codex 开放问题上。
