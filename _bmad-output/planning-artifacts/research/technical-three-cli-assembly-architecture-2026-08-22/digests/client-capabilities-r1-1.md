# 三 CLI 客户端能力面（R1.1）

- 研究日期：2026-08-22
- 来源：仅当前官方文档/官方源码；页面无可靠更新时间时标记 unknown。
- 结论：三端都能通过配置和 CLI 参数完成一部分启动装配，但没有共同的独占配置根、Session 格式或最终有效配置回执。不得清空真实全局配置；应使用隔离 root/profile、一次性覆盖和客户端 adapter。

## 能力矩阵

| 能力面 | OMP | Claude Code | Codex CLI | 共同合同 / 不可抽象部分 |
| --- | --- | --- | --- | --- |
| Instructions | context files、Skills metadata、profile；扩展可在 agent start 修改 prompt | `--append-system-prompt`、`--system-prompt`、settings；outputStyle 需 `/clear` 或重启 | `developer_instructions`、`model_instructions_file`、AGENTS.md | 公共层只能表达 instruction bundle；优先级和生效时机由 adapter 声明 |
| Skills | `.omp/skills/*/SKILL.md` | Skills 与 plugins | `SKILL.md`、`skills.config[].enabled` | 文件形态可近似复用；发现、批准、启用和调用语义不同 |
| MCP | stdio/http/SSE、会话命令，版本敏感 | stdio/http/SSE/ws、`mcp add`、`.mcp.json`；SSE 已 deprecated | `mcp add`、stdio/streamable HTTP | manifest 可共享；OAuth、作用域、持久化和运行期变更必须由 adapter 处理 |
| Tools/permissions | active tools、disabled servers、TUI/扩展策略 | permissions allow/deny、managed policy、hooks | `approval_policy`、sandbox、apps、exec policy | 只能共享 capability policy，不能共享具体权限语义 |
| Plugins/hooks | extensions/hooks | marketplace、plugins、hooks、ConfigChange | plugins/marketplace/hooks/skills 能力随版本 | 需要 client adapter；不承诺等价事件 |
| Scope/precedence | `~/.omp/agent`、项目 `.omp`、profile 可迁移用户 base | managed > CLI > local > project > user；list 有 merge 语义 | CLI override > trusted project > profile > user > system；项目层禁止覆盖部分 machine-local key | 只能统一表达 isolated per-run root/profile 与已知残留来源 |
| CLI isolation | profile、CLI overlay；完整 root 会连 auth/session 一起移动 | `--settings` 为本 Session 覆盖，但不能越过 managed，也不是全局 root 替代 | `CODEX_HOME`、profile、`-c`；未证实排除全部 user/system source | 不清空全局；隔离程度必须回执为 full/degraded/unknown |
| Session | `--continue`、`--resume id/prefix/path`、JSONL tree | continue/resume/session ID，由客户端拥有 | `exec resume --last/--all`、archive/unarchive/delete、thread ID | 只保存 opaque locator；transcript 不可移植，resume 语义不可统一 |
| Lifecycle | 多数 discovery/config 为启动期；MCP 运行变更版本敏感 | 多数 settings 可热加载；outputStyle 例外 | profile/config 多为启动期；持久命令影响后续 Session | adapter 声明 `startup_only` / `runtime_mutable` |
| Receipts | TUI/log/SDK，随版本变化 | `/status`、`/doctor`、stream-json MCP errors | `--json` JSONL、doctor/debug、部分命令 JSON | 统一 envelope 必须由 adapter 从稳定输出解释，无法观察则 Unknown |
| Distribution | Bun/npm/Homebrew/Nix/Windows installer | CLI、managed deployment、marketplace | binary/npm/installer、marketplace/profile | adapter 与 manifest 可公共分发；凭据与私域状态不入仓 |

## 最小 adapter 合同

```text
AssemblyInvocation {
  client
  project_root
  isolated_profile_or_root
  instruction_bundle
  skills_manifest
  mcp_manifest
  capability_policy
  opaque_session_handle?
}
```

Adapter 必须返回：客户端版本、supported/degraded/unsupported/unknown、applied/ignored、startup-only/runtime-mutable、诊断与不透明 Session locator。不得声称技能、hooks、plugin 或 transcript 跨客户端等价。

## 清空全局配置假设

**被否定为默认产品路径。** 三端均有多层 precedence；清空一个用户文件既不能排除 managed/project/system/runtime 来源，也可能破坏认证、其他项目和并发 Session。备份→清空→启动→恢复不是跨进程事务；kill、并发编辑和客户端启动后持有的内存状态均无法由文件恢复撤销。

可接受的低成本路径是：每 invocation 独立目录、隔离 profile/root 或一次性 CLI overlay、不可变 manifest、原子 receipt。某能力只能写固定全局文件时，应标为 degraded，并要求锁、字节快照、CAS 恢复和崩溃日志；通常不值得进入 MVP。

## Claims

| ID | Claim | Source URL | Publisher | Publication/update date | Accessed | Confidence | Class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Claude settings precedence 为 managed > CLI > local > project > user；`--settings` 是 per-session 覆盖且不能越过 managed。 | https://code.claude.com/docs/en/settings | Anthropic | unknown | 2026-08-22 | High | fact/current-doc |
| B | Claude settings 多数热加载；outputStyle 需 clear/restart；`/status` 可显示来源。 | https://code.claude.com/docs/en/settings | Anthropic | unknown | 2026-08-22 | High | fact/current-doc |
| C | Claude MCP 支持 stdio/http/SSE/ws，SSE deprecated，并有 stream-json MCP error 事件。 | https://code.claude.com/docs/en/mcp | Anthropic | unknown | 2026-08-22 | High | fact/current-doc |
| D | Codex 支持用户/可信项目配置、`CODEX_HOME`、profile 和一次性配置覆盖。 | https://learn.chatgpt.com/docs/config-file/config-reference | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| E | Codex 配置包含 developer instructions、model instructions file、skills、sandbox、approval 和本地状态路径。 | https://learn.chatgpt.com/docs/config-file/config-reference | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| F | Codex 支持 resume、archive/delete、JSONL、MCP/plugin 命令面。 | https://learn.chatgpt.com/docs/developer-commands?surface=cli | OpenAI | unknown | 2026-08-22 | High | fact/current-doc |
| G | OMP 使用用户/项目 roots，并可用 profile 重定位用户 base。 | https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | Medium-High | fact/current-source |
| H | 三端没有共同、原子、独占配置覆盖或可移植 Session 合同。 | 上述官方来源 | 本研究推论 | 2026-08-22 | 2026-08-22 | High | inference/architecture |

## Contradictions

- Claude 多数设置热加载，Codex profile/config 偏启动期；不能统一成运行期 mutation。
- Claude list merge 与 Codex project restriction 不同；不能把一个 JSON merge 算法投射到三端。
- Claude MCP 可运行期管理，Codex `mcp add` 偏持久化配置；receipt 必须区分本次生效与以后生效。
- OMP 官方文档来自 current branch，未提供长期 ABI/兼容承诺；实现必须 pin 实际版本。

## Leads

- 对实际安装版本执行 fresh→取得 locator→explicit resume smoke。
- 钉住版本并做 managed conflict、untrusted project、MCP failure、并发 Session、resume mismatch 负面测试。
- 读取当前 OMP CLI help/源码确认 overlay 与 resume 生命周期。

## Not Found

- 共同配置 root 或独占所有配置源的开关；
- 可事务回滚的全局覆盖；
- 可移植 Session ID/transcript；
- 等价的 Skills/hooks/plugins 语义；
- 三端共同的 machine-readable 最终有效装配回执。
