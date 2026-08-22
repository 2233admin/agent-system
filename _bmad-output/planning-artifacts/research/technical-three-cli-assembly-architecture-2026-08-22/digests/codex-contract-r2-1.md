# Codex CLI 配置、Resume 与 Hook 合同（R2.1）

## Answer

外部 config adapter 足以覆盖 MVP 的 fresh isolation、配置覆盖和显式 resume：使用独立 `CODEX_HOME`，必要时同时独立 `sqlite_home`；以 profile 或 `-c/--config` 覆盖；用 `codex resume <id>`、`--last`/`--all` 恢复。它不能单独提供可靠工具调用观察；需要时使用 `PreToolUse`/`PostToolUse` command hooks。`notify` 是通知通道，不是完整同步工具流。

Codex plugin 可以携带 hooks/MCP，但本轮未找到稳定通用 plugin ABI；该项为 Unknown，不推断不存在。

## Claims

| Claim | Source | Publisher | Date | Accessed | Confidence | Class |
| --- | --- | --- | --- | --- | --- | --- |
| `CODEX_HOME` 默认 `~/.codex`，含 config、auth 或 keychain 关联、history、logs/cache；`sqlite_home` 可单独指定可恢复运行数据库。 | https://learn.chatgpt.com/docs/config-file/config-advanced | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| `--profile` 在 base user config 之上、project/CLI 之下加载独立 profile file；0.134.0+ 不再使用 legacy `[profiles]`。 | https://learn.chatgpt.com/docs/config-file/config-advanced | OpenAI | unknown | 2026-08-22 | High | fact/versioned-current-doc |
| `-c/--config` 解析 TOML、支持 dot notation，并处于 CLI 最高优先级。 | https://learn.chatgpt.com/docs/config-file/config-reference | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| `codex resume` 支持 ID、`--last`、`--all`；`--last` 默认按 cwd 限定，显式 `-C` 优先。 | https://learn.chatgpt.com/docs/developer-commands?surface=cli | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| 当前 hooks 包含 SessionStart/End、Pre/PostToolUse、PermissionRequest、Prompt、Compact、Subagent 事件；当前只有 command handler 执行。 | https://learn.chatgpt.com/docs/hooks | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| 外部 adapter 足够启动/恢复；工具级观察或策略需要 hooks。 | 上述来源 | 本研究推论 | 2026-08-22 | 2026-08-22 | High | inference/architecture |

## Caveats

- `CODEX_HOME` 不保证覆盖单独设置的 `sqlite_home`；两者都要纳入 capability probe。
- 认证可能位于 OS keychain，不能假定都在 `auth.json`。
- project 配置和 hooks 依赖 trust，且不能覆盖 provider/auth/notify/profile/telemetry 等 machine-local keys。
- 多个匹配 command hooks 可并发执行，不是串行 event bus。
- managed-only hooks 可以排除用户/project/session/plugin hooks。

## Not Found

- 排除所有 user/system/managed 来源的统一独占开关；
- 稳定通用的进程内 plugin ABI；
- 不依赖 adapter 的跨客户端 resume 或 lifecycle 语义。

**Stop reason:** coverage；五个官方来源已覆盖 config、profile、resume、hooks、notify 和 plugin 边界。