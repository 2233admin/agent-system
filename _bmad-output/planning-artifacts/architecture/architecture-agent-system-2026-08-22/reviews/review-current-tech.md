# Current-Tech Review — 2026-08-24 新增内容（AD-21、AD-20 修订、.cap/ 退役顺序重写）

**审查范围：** `ARCHITECTURE-SPINE.md` 中 AD-21（201-206 行）、AD-20 的 2026-08-24 澄清段（199 行）、`.cap/` 退役顺序重写（361-369 行），对应 `.memlog.md` 第 51-58 条。

**验证方法：** 直接读取本仓源码证据文件（非训练数据推断）+ WebFetch 官方 Claude Code CLI 文档实时核实。

## 一句话结论

**PASS with notes** —— AD-21 依赖的三项事实性断言均有真实证据支撑（两项为本仓/`.cap` 归档设计文档的实测证据，一项经官方在线文档独立复核为当前生产可用），但证据新鲜度和"已实现 vs 仅规划"的边界需要更明确标注。

## Critical

无。

## High

1. **AD-21 依赖的四个 flag（`--plugin-dir`/`--append-system-prompt`/`--mcp-config`/`--strict-mcp-config`）在本仓当前代码中尚未被 Story 4.1 的真实探测覆盖，只有 `.cap` 归档设计文档（2.1.236，2026-08-19 捕获）覆盖。** 本仓 `packages/control-plane/src/adapters/clients/claude/capability-probe.ts`（Story 4.1，针对本机真实 `claude --version` 2.1.241 跑过）只机械验证了 `--permission-mode`、`--strict-mcp-config`（仅作为 `mcp-project-scope-control` 判据的一半）、`--setting-sources`、`--include-hook-events` 四项，从未探测 `--plugin-dir`、`--append-system-prompt`、裸 `--mcp-config`。这三项的唯一本仓证据来自 `openspec/changes/archive/2026-08-20-add-claude-cap-adapter/evidence/claude-native-surface.json`（`.cap` 侧 T-1 实验，Claude Code **2.1.236**，2026-08-19 捕获），而 Story 4.1 已发现并记录了这份旧证据与本机当前版本（2.1.241）之间的版本漂移（`spec-4-1-...md` 第 18-19、136 行；`spec-4-5-...md` 第 140 行），且该漂移目前只有 `console.warn` 记录、无持久化产物（Story 4.5 `deferred` 项，severity: medium）。AD-21 建立在这份已知已漂移的旧证据上，架构文本本身未提及这个漂移或给出"Story 4.5b 实现时需重新探测这四个 flag against 当前版本"的显式要求。
   - **建议：** 在 AD-21 或 Story 4.5b 的验收范围中显式要求：实现时先用 `BunClaudeProcessPort.captureHelpText` 对 `--plugin-dir`/`--append-system-prompt`/`--mcp-config` 做一次本机真实探测（比照 `capability-probe.ts` 现有四项的模式），而不是直接假定 2026-08-19 的旧证据仍然成立。

## Medium / Low

- 计 3 项（medium 1，low 2）：
  - `[medium]` `--append-system-prompt` 在 `.cap` 的 `claude-native-surface.json` 中标注 `verified_by: "doc"`（仅文档核实，非受控实验），且该条目本身备注了姊妹 flag `--append-system-prompt-file` 存在性"待核"。WebFetch 官方文档（`code.claude.com/docs/en/cli-reference`，本次审查中实时抓取）证实 `--append-system-prompt` 与 `--append-system-prompt-file` 均为当前生产可用、非 deprecated/experimental，缓解了这一点，但 AD-21 文本本身未引用任何独立于 `.cap` 旧证据的来源。
  - `[low]` `.cap` 设计文档记录 `--strict-mcp-config` 对 claude.ai 账号级远程 MCP connector 无效（`claudeai-remote-connectors` 事实条目）；AD-21 的规则文本未提及这一已知限制对"内容物化"语义的潜在影响（虽然 AD-21 讨论的是项目/技能内容而非账号级 connector，相关性较低，仅作记录）。
  - `[low]` AD-21 与"退役顺序"第 1 步引用的 `scripts/seed-from-cap.ts` 与 `ClaudeInvocationDirPort` 均已在本仓真实存在（`packages/control-plane/scripts/seed-from-cap.ts`、`packages/control-plane/src/adapters/system/claude-invocation-dir.ts`、`application/ports.ts`），核实无误，非训练数据臆造；仅记录为已核实项，不构成问题。

## 逐项验证结果（供追溯）

1. **四个 flag 是否真实存在于 Claude Code CLI 且未过时** —— **确认，PASS**。WebFetch `https://code.claude.com/docs/en/cli-reference`（官方在线文档，本次实时抓取）逐一确认：`--plugin-dir`（"Load a plugin from a directory or `.zip` archive for this session only"，要求真实文件系统路径而非名字——与 AD-21 论证逐字吻合）、`--append-system-prompt`、`--mcp-config`、`--strict-mcp-config` 全部为当前生产可用（"Not deprecated or experimental"）。本仓 Story 4.1 的真实探测（本机 2.1.241）独立确认了 `--strict-mcp-config`、`--permission-mode`、`--setting-sources` 三项存在；`--plugin-dir`/`--append-system-prompt`/裸 `--mcp-config` 未被 Story 4.1 直接探测（见 High #1）。
2. **`.cap` 的 `cap use <role> --cli claude` 真实机制（隔离 `CLAUDE_CONFIG_DIR`、`--plugin-dir` 用于 skills）** —— **确认，PASS**。直接读取 `openspec/changes/archive/2026-08-20-add-claude-cap-adapter/design-spec.md`：2.3 节确认 `CLAUDE_CONFIG_DIR` 按 runtime-id 分配（隔离认证/会话，与项目/generation 无关）；3.1-3.2 节的 T-1 实测结论确认 `--plugin-dir` 是"session 级、只读"交付 Skill 的唯一通道（日志证据："Loaded 1 session-only plugins from --plugin-dir"）；4.1 节给出与 AD-21 描述完全对应的真实启动命令（`--settings`/`--setting-sources ""`/`--mcp-config`/`--strict-mcp-config`/`--append-system-prompt`/`--plugin-dir`）。AD-21/`.memlog.md` 第 52 条对该机制的转述准确，未发现夸大或篡改。
3. **OMP 的 `buildOmpArgv` 是否只传技能名字、从不物化内容** —— **确认，PASS**。直接读取 `packages/control-plane/src/adapters/omp/process-port.ts` 第 39-66 行：`buildOmpArgv` 只会 push `'--skills', skillNames.join(',')`（或 `'--no-skills'`）与 `-e <extensionPath>`（本产品自己的薄状态扩展，非技能内容），从未读取或写入任何技能/指令/MCP 的真实内容字节。与 AD-21 rationale 逐字一致。

## 关于"已实现 vs 仅规划"的范围说明（非缺陷，供审阅者知悉）

AD-21 是 Story 4.5b（尚未开始）的前瞻架构决定。本仓当前 `adapter-plan.ts` 的 `CAPABILITY_ARGV_MAP` 只含 `--permission-mode`/`--strict-mcp-config`/`--setting-sources` 三项，尚不含 `--plugin-dir`/`--append-system-prompt`/裸 `--mcp-config`——这是预期状态（Story 4.5b 尚未落地），不是与 AD-21 矛盾的回归，且 Story 4.5 已明确记录"新 adapter 目前从不物化内容"是当前真实状态、AD-21 正是要改变这一点的决定。
