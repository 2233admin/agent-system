---
title: '技术决策研究：三 CLI 装配架构'
type: technical
topic: 'three cli assembly architecture'
decision: '选择一步支持三 CLI、外部窄核心 OMP-first，或 OMP 内部特化'
source: 'native-run'
status: complete
preset: standard
validation: normal
created: '2026-08-22'
updated: '2026-08-22'
---

# 技术决策研究：三 CLI 装配架构

## 执行结论

**选择“外部窄核心 + OMP-first”，实现为 TypeScript/Bun CLI；首版只交付 OMP adapter。** 公共层固定一次调用的 manifest、capability probe、临时装配目录、启动/恢复参数、原子 receipt 与不透明 Session locator。客户端继续拥有凭据、transcript 和原生 Session。Claude Code、Codex CLI 后续各加一个 adapter，不要求三端首发，不先造 daemon，也不先造三套进程内 plugin。[1][2][3]

这不是折中，而是 clean-slate 下最低成本的可逆边界：与“三端一步”相比，它不同时支付三套配置、权限、Session、生命周期和升级资格成本；与“OMP 内部特化后抽取”相比，它现在只多一个很薄的 invocation envelope，却避免以后从 OMP 对象与 Session 生命周期中逆向抽取隐含合同。按已确认权重，三案相对负担为 **4.30 / 2.05 / 3.30**（1 低、5 高；不是工时）。

**关键限定：**“几条脚本清空全局配置即可完成三端装配”不成立。三端均有多层配置来源、各自的 trust/managed 规则和不同 Session 语义；文件备份→清空→恢复不是跨进程事务，也无法在 kill、并发编辑或 OS keychain 下保证恢复。MVP 必须使用隔离 root/profile、一次性参数或生成的 project/session 配置；无法隔离的能力标为 `degraded|unknown`，不伪装成功。[1][2][3]

## 决策矩阵

评分为结构负担：1=低，5=高。权重来自本轮确认：总成本 40%、MVP 速度 25%、未来接入 20%、正确性 10%、分发 5%。

| 维度 | 权重 | A：三端一步 | B：外部窄核心、OMP-first | C：OMP 内部后抽取 |
| --- | ---: | ---: | ---: | ---: |
| 首版与长期总成本 | 40% | 5 | 2 | 4 |
| 首个可用 MVP 速度 | 25% | 5 | 2 | 1 |
| 未来客户端接入 | 20% | 2 | 2 | 5 |
| 可观察性与正确性 | 10% | 4 | 2 | 3 |
| 分发与维护 | 5% | 5 | 3 | 3 |
| **加权负担** | **100%** | **4.30** | **2.05** | **3.30** |

- **A 三端一步：**只有“三端必须同日达到同级体验”是硬性产品门时合理。当前不是。否则它在任何成本维度都不优于 B。
- **B 外部窄核心、OMP-first：**先固化客户端中立且长期必需的 manifest/receipt/Session locator；adapter 只是 probe、compile、launch、interpret。每增加一端只增加该端资格矩阵。
- **C OMP 内部后抽取：**首个 OMP 功能最快，但配置、状态、Session 和 UI 容易成为进程内隐含合同。以后接第二端时要同时拆边界、迁状态、改调用方、补双路径测试；若提前把 manifest/receipt 放到外部，实际上已经收敛到 B。

敏感性结论：只有把“最短 MVP”权重提高到压过总成本、未来接入和正确性之和，C 才优于 B；A 的合理性不来自成本，只来自三端同步首发硬门。

## 当前客户端能力现实

### OMP

当前源码确认 profile 在主要模块导入前选择；`PI_CONFIG_DIR`、profile 与默认 profile 下的 `PI_CODING_AGENT_DIR` 可改变配置根。配置发现存在有序选择，部分文件取第一个存在项；完整 root 同时影响认证和 Session，故临时 root 不会无成本继承既有状态。[1]

外部 adapter 足够完成 cwd/profile/root 选择、静态 Instructions/Skills/MCP 装配、fresh launch 和显式 resume。只有以下能力需要薄 TypeScript extension：同步阻止或改写 tool call、修改 provider/context、注入消息、监听 Session tree、提供原生 TUI。OMP extension 本身是 TS/JS factory，支持 lifecycle、tools、commands、renderers 和 Session APIs。[1]

### Claude Code

`--settings` 是单 Session overlay，优先于 user/project/local、低于 managed；`--setting-sources` 可筛选文件来源，`--strict-mcp-config` 可限定显式 MCP，`--plugin-dir` 可单次加载。managed settings 和部分环境/CLI 规则仍不可排除，因此只能声明“已隔离已知用户/项目来源”，不能声明“完全无外部影响”。[2]

`--continue`/`--resume`、`--fork-session` 和 `--session-id` 提供原生恢复/分叉。官方确认 resume 触发 `SessionStart`，但未承诺继承旧的 `--settings`；adapter 必须在 resume 时重新传入本次 manifest，并以真实 smoke 验证结果。需要逐 tool 审计或阻断时才启用 `PreToolUse`/`PostToolUse` hooks。[2]

### Codex CLI

`CODEX_HOME`、profile 与 `-c/--config` 支持隔离和一次性覆盖；`sqlite_home` 可能另行指定，认证也可能位于 OS keychain。`codex resume <id>`、`--last`、`--all` 提供恢复，但 `--last` 默认受 cwd 限定。project 配置受 trust 限制，且不能覆盖部分 machine-local provider/auth/notify/profile/telemetry 项。[3]

当前 hooks 覆盖 Session、tool、permission、prompt、compact 和 subagent 事件，且只有 command handler 真正执行；多个匹配 hook 可并发。因此 adapter 足够启动与恢复，工具级观察/策略才接 hooks。`notify` 只是通知，不是完整同步工具流。plugin 可携带 hooks/MCP，但本轮未找到稳定通用 plugin ABI，保持 Unknown。[3]

### 共同边界

三端可以共用的不是配置文件，而是**意图与证据合同**：

```text
AssemblyManifest
  client + projectRoot + configurationRevision
  instructions + skills + mcp + capabilityPolicy
  resumeSelector? + isolationIntent

AdapterPlan
  clientVersion + supported/degraded/unsupported/unknown
  argv + env + generatedFiles + excludedOrResidualSources

LaunchReceipt
  operationId + manifestHash + clientVersion
  applied/ignored/unknown + nativeSessionLocator?
  preparedAt + launchedAt? + observedAt? + exit?
```

不能共用：配置 precedence、trust/managed 语义、Skills 发现与批准、hook event 语义、transcript 格式、Session ID、resume 选择器和“最终有效配置”回执。[1][2][3]

## 实现语言与分发

### 推荐：TypeScript + Bun

Bun 可把 runtime、应用和依赖编译为 standalone executable，并提供跨目标构建与 argv-based process API。[4] 选择 TypeScript 的主要理由不是性能，而是**减少边界**：OMP extension 合同本身是 TS/JS；外部 core、JSON Schema tooling、adapter 与未来薄 OMP bridge 可保持一种语言。首版不依赖 daemon、IPC 或 native add-on，分发为单个 CLI artifact。

需要钉住的不是“TypeScript 7.0.2”这一手写数字，而是仓库 lockfile、Bun toolchain 与实际 OMP/Claude/Codex 版本。OMP `main` 当前版本只能作为本轮证据，不能替代发布时 capability probe。

### 第一反转目标：Go

Go 可按目标 OS/arch 构建 executable，`os/exec` 不经 shell。[5] 若企业终端拒绝 Bun executable、native npm dependency 无法稳定打包、签名/SBOM/杀软链长期阻塞，或薄 OMP bridge 已使 TS 共享优势消失，则把外部 core 迁到 Go，保留 JSON Schema/JSONL 合同与 TS bridge。代价是两种语言、两套生成类型和跨语言 golden fixtures。

### 条件性选择：Rust

Rust 具备目标与 linker/runner 配置及 argv process API。[6] 只有出现可测的严格资源/安全边界或关键 Rust-native 组件时采用。当前控制面主要是小型 schema、文件和子进程编排；Rust 的双语言、交叉编译和认知成本没有对应收益。

### 不选 Python 或纯脚本

Python zipapp 仍要求目标机器存在合适解释器；venv 也不天然可搬迁。[7] 纯脚本只能用于单 OS、解释器受控、单用户串行、可人工恢复且明确到期的实验。它不能承担跨平台发行、并发锁、崩溃恢复、schema 版本和五年客户端 churn。现有 Python CAP 只可作 Bad Case 证据，不是需求、架构或迁移基线。

## 最小可实施切片

1. **`assembly.schema.json`**：固定 manifest、capability 与 receipt 的版本化 schema；生成 TypeScript 类型。
2. **纯函数 OMP adapter**：输入 manifest + capability snapshot，输出 argv/env/files/预期 observation；不写用户目录。
3. **apply runner**：创建 invocation 临时目录，原子落盘 manifest/plan/receipt，直接 argv spawn，不经 shell；捕获 exit/signal/stdout ownership。
4. **私有 launch index**：MVP 用原子 JSON/JSONL 或单写者文件索引。只有出现多 writer、查询和迁移压力才引入 SQLite；不预建 daemon。
5. **真实 OMP smoke**：fresh→取得 locator→explicit resume；同时覆盖非 ASCII/空格路径、旧全局配置仍存在、能力缺失、被 kill 后 incomplete receipt。
6. **按需薄 extension**：第一个必须同步观察/干预的 OMP 用例出现后才加入；协议只传 versioned event envelope，不复制核心状态。
7. **后续客户端**：Claude、Codex 各自通过同一 adapter port 增量资格；首个成功接入第二端前，不把多端语义写成已支持事实。

## 状态所有权与失败安全

- **Client-owned：**凭据、transcript、native Session、客户端缓存与原生恢复规则。
- **Control-plane-owned：**manifest、生成计划、capability snapshot、receipt、不透明 locator、版本与哈希。
- **Project-owned：**可公开复用的 schema、adapter contract、测试 fixtures；不含真实用户状态。
- **单写者：**一个 `operationId` 对应一个 apply；同一 invocation 目录不可被两个进程写。
- **失败不等于回滚成功：**`prepared` 后被 kill 时，下次只把状态归类为 incomplete/unknown；不得自动删除客户端数据或伪造恢复完成。
- **不碰真实全局配置：**若某能力只能写固定全局文件，MVP 默认标 unsupported/degraded。最低安全门也必须包含独占锁、逐字节快照与 hash、CAS restore、崩溃日志和禁止并发；这个成本通常已高于不支持该能力。

## 测试与发布门

| 层 | 防守的可观察合同 |
| --- | --- |
| Schema | unknown field、版本不兼容、secret 字段和 unsupported/degraded/unknown 不被吞掉 |
| Adapter plan | 相同 manifest 生成确定 argv/env/files；不写盘、不泄露 secret |
| Apply | atomic write、锁竞争、既有文件不丢失、kill 后 receipt 可判定 |
| Process | argv 不经 shell、cwd/env/stdio/exit/signal 归属正确 |
| Resume | exact ID、cwd-last、unsupported、mismatch 不混淆 |
| Packaging | Windows/macOS/Linux artifact 启动；内嵌资产、非 ASCII、空格路径；签名/杀软/SBOM |
| Compatibility | 每个支持客户端版本执行 fresh→locator→explicit resume；升级先 probe/smoke，后更新 snapshot |

MVP 不以三端 LLM 输出语义一致或高 Token 对照为门；这既昂贵也不能证明配置合同。测试 adapter contract、真实启动/恢复和失败安全即可。

## 反证、矛盾与红队

### 已解决的矛盾

首轮材料把 OMP `--config` 描述为可重复、非持久化 overlay；第二轮在当前 CLI 入口与配置源码中未找到可依赖的通用合同，并观察到部分配置是“按优先级取第一个文件”。因此最终建议**不依赖 `--config`**：OMP 先用明确 profile/root 与生成的启动期配置；该 flag 只有在 release-pinned help/source 与真实 smoke 一致后才能升级为 supported。[1]

### 最强反对意见

**“既然 MVP 只有 OMP，直接做 OMP 内部 extension 最快，外部 CLI 是提前抽象。”** 这在一次性 demo 上成立。反驳点不是未来可能性，而是已确定的产品方向包括 Claude Code/Codex；配置选择、Session resume、回执和用户私有状态本来就不能归 OMP 所有。把这四项放在 OMP 内部会立即形成错误所有权。外部层只承担这些不可避免的共同 invariant，不承载 OMP tool/UI 细节，因而不是三端大一统框架。

### 两种“各自合规但互不兼容”的攻击

1. 两个 adapter 都返回 `Verified`，一个表示“参数成功传入”，另一个表示“客户端运行期确认生效”。修复：receipt 的 evidence level 必须枚举 `planned|launched|observed|verified`，`Verified` 只允许由客户端专项 observation 产生。
2. 两个调用各自合法 resume 同一 native Session，并发写坏 transcript。修复：control plane 不声称客户端并发安全；同一 `(client, nativeSessionLocator)` 需要本地 lease，无法确认 locator 时 fail closed 或要求 fresh/fork。
3. Claude managed settings 与 Codex trusted-project rule 都被 adapter 忽略，但两者仍返回 isolated。修复：隔离结果必须列 `excludedSources`、`residualSources` 和 `unknownSources`，只有残留为空且有 evidence 才能称 full。

## 反转与迁移路径

- **B → Go core：**Bun 分发/批准阻塞连续两个 release 仍不能消除，或 native dependency 成为稳定硬门。schema、fixtures、receipt 和 adapter port 不变。
- **B → OMP 内部特化：**主要价值被实证为同步 tool interception、Session tree、context mutation 或原生 UI，且外部 adapter 已持续泄漏 OMP 内部对象。即使反转，manifest/receipt/私有状态根仍留在外部。
- **CLI → daemon/SQLite：**只在出现多个并发 writer、跨进程订阅、大量 Session 查询或 journal 无法满足恢复时。不是为了“以后可能并发”。
- **OMP-only → 第二客户端：**先实现 Claude 或 Codex 的 probe/plan/launch/interpret 四步，不修改核心 Session 类型；unsupported/degraded/unknown 是合法结果。

## Recommendation with conditions

采用 **外部 TypeScript/Bun CLI + 六边形 adapter port + OMP-first**，前提与升级条件如下：

- 首版只承诺 OMP；Claude/Codex 属明确后续接入，不拖住 MVP。
- 绝不清空或替换真实用户全局配置；只使用隔离 root/profile、显式一次性覆盖或 invocation-local 文件。
- 客户端能力由 release-pinned probe 与真实 smoke 决定；文档未确认即 Unknown。
- Session 只保存 opaque locator；不复制 transcript，不跨客户端翻译 Session。
- 没有同步观察/干预用例时，不添加 OMP extension、Claude/Codex hooks、daemon、IPC 或 SQLite。
- 若 Bun 发布链出现实证硬门，先迁 Go；若 OMP 内部能力成为主要价值，再收缩为 OMP 特化，而不是现在锁死。

## Source appendix

| Ref | URL | Publisher | Publication/update date | Accessed | 用途 |
| --- | --- | --- | --- | --- | --- |
| [1] | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/config.ts ; https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/cli.ts ; https://github.com/can1357/oh-my-pi/blob/main/docs/environment-variables.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | OMP 配置根、profile、环境、extension 与 Session/lifecycle 边界 |
| [2] | https://code.claude.com/docs/en/settings ; https://code.claude.com/docs/en/cli-reference ; https://code.claude.com/docs/en/hooks | Anthropic | unknown | 2026-08-22 | Claude precedence、一次性设置、resume 与 hooks |
| [3] | https://learn.chatgpt.com/docs/config-file/config-advanced ; https://learn.chatgpt.com/docs/config-file/config-reference ; https://learn.chatgpt.com/docs/developer-commands?surface=cli ; https://learn.chatgpt.com/docs/hooks | OpenAI | unknown；profile 行为含 0.134.0+ 说明 | 2026-08-22 | Codex home/profile、resume、hooks、trust 与 machine-local 边界 |
| [4] | https://bun.com/docs/bundler/executables ; https://bun.com/docs/runtime/child-process | Bun | unknown | 2026-08-22 | standalone executable、cross target、argv process |
| [5] | https://go.dev/doc/install/source ; https://pkg.go.dev/os/exec | Go project | unknown | 2026-08-22 | 目标构建与非 shell process API |
| [6] | https://doc.rust-lang.org/cargo/reference/config.html ; https://doc.rust-lang.org/std/process/struct.Command.html | Rust project | unknown | 2026-08-22 | target/linker 与 process API |
| [7] | https://docs.python.org/3.11/library/zipapp.html ; https://docs.python.org/3/library/venv.html | Python Software Foundation | Python 3.11.15 / 3.x；页面日期 unknown | 2026-08-22 | 单文件 archive 的解释器要求与 venv 可搬迁边界 |
