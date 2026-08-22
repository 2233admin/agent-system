# Claude Code 配置、Resume 与 Hook 合同（R2.1）

## Answer

外部 adapter 可组合 `--settings`、`--setting-sources`、`--strict-mcp-config` 和按需 `--plugin-dir` 完成一次性启动隔离。`--settings` 高于 user/project/local、低于 managed；`--setting-sources` 可筛选文件来源，strict MCP 可仅使用显式 MCP 文件。managed settings、部分环境变量/独立 CLI flag 不能被统一排除，因此不得承诺绝对隔离。

`--continue`/`--resume` 恢复 Session，`--fork-session` 可生成新 ID，`--session-id` 可为新 Session 指定 UUID。官方确认 resume 触发 `SessionStart`，但未说明旧 `--settings` 是否继承；每次 resume 必须重新显式传隔离参数并把结果纳入 smoke。

单纯启动隔离不需要 hook；只有每次工具调用审计、策略阻断或结果观察才需要 `PreToolUse`/`PostToolUse`。

## Claims

| Claim | Source | Publisher | Date | Accessed | Confidence | Class |
| --- | --- | --- | --- | --- | --- | --- |
| `--settings` 是 per-session overlay，高于 user/project/local，低于 managed；多数设置热加载，部分仅 Session start 读取。 | https://code.claude.com/docs/en/settings | Anthropic | unknown | 2026-08-22 | High | fact/current-doc |
| CLI 支持 setting source 筛选、strict MCP、plugin dir、continue/resume/fork/session ID。 | https://code.claude.com/docs/en/cli-reference | Anthropic | unknown | 2026-08-22 | High | fact/current-doc |
| `SessionStart` 在开始或恢复时触发；PreToolUse 可阻止，PostToolUse 在成功后运行；ConfigChange 观察设置文件变化。 | https://code.claude.com/docs/en/hooks | Anthropic | unknown | 2026-08-22 | High | fact/current-doc |
| 外部 adapter 足够启动/恢复；工具级同步策略和观察才需要 hooks。 | 上述来源 | 本研究推论 | 2026-08-22 | 2026-08-22 | High | inference/architecture |

## Caveats

- managed settings 最高优先且不能由 per-session flag 覆盖。
- 环境变量不是统一 precedence 层，个别键有独立规则。
- hook 条目跨 settings scopes 合并，managed hooks 可能不可禁用。
- 多数设置热加载不等于所有启动输入都可运行期替换。

## Not Found

- resume 是否自动继承上次 `--settings` overlay 的官方保证；
- 排除 managed/env 的绝对隔离模式；
- 三端共同的 hook/event 或 Session 合同。

**Stop reason:** coverage；官方 settings、CLI 与 hooks 文档已回答隔离、恢复、生效时机和 hook 最低场景。