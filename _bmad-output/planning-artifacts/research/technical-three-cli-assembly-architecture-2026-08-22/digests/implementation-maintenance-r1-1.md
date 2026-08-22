# 实现、分发与长期维护现实（R1.1）

- 研究日期：2026-08-22
- 访问日期：2026-08-22
- 决策范围：外部 CLI 与 OMP、Claude Code、Codex CLI adapters；TypeScript/Bun、Go、Rust、Python/脚本的实现与五年维护面
- 证据边界：只使用本轮检索到的官方文档/官方仓库文档。事实与架构推论分列。未获得官方发布日期的页面标为 `unknown`；“当前”只表示在访问日官方页面仍如此描述，不外推未来兼容性。

## Executive finding

**最小、可逆的实现建议是：一个外部 TypeScript CLI，以 Bun 编译为各目标平台的独立可执行文件；核心只拥有规范化 assembly manifest、私有状态索引、进程启动与 adapter contract。Claude Code/Codex 首版使用配置文件和 CLI 参数 adapters；OMP 也先走启动参数/文件装配，仅当必须获得同步工具拦截、上下文变更、会话切换或原生 UI 时才加一个很薄的 TypeScript extension。**

理由不是“TypeScript 普遍优于 Go/Rust”，而是当前 OMP 的进程内扩展合同本身是 TS/JS module；选择 TypeScript 可在外部核心、schema 工具和必要的 OMP extension 之间共享实现语言，而 Bun 官方提供包含运行时的 standalone executable 与交叉目标构建。Claude Code 已提供 CLI resume、临时系统提示、MCP/plugin/config 入口；Codex 有 user/project config、profile 与外部 `notify` 命令。这些装配面不要求核心进入客户端进程。

Go 是最可信的第一反转目标：如果 Bun 的可执行文件、原生依赖、企业批准或更新策略成为实证阻塞，就把外部核心移植为 Go，同时保留 JSON Schema/JSONL adapter contract，并只留下 OMP 的薄 TS bridge。Rust 只有在出现内存安全、资源上限或必须集成 Rust-native 组件的明确要求时才值得承担工具链与双语言成本。纯脚本只适合受控单平台、已保证解释器、无并发装配的短期内部试验，不应成为五年产品基线。

## 1. Retrieved facts

### 1.1 语言与分发矩阵

| 选项 | 官方可核实的分发事实 | 配置/进程能力 | 跨平台现实 | 类型/schema 共享 | 测试与发布面 | 当前适配判断 |
|---|---|---|---|---|---|---|
| TypeScript + Bun | `bun build --compile` 把 Bun runtime、应用和依赖打进 standalone executable；官方列出 Linux、Windows、macOS 目标。[S1] | `Bun.spawn()` 接受 argv 数组、`cwd`、`env`、pipe；JSON/TOML/文本文件可由 TS 生态处理。[S1] | 仍需按 OS/arch 产物构建、签名和 smoke；含 native addon 时不能把“支持 target”推成“任意依赖可无痛交叉编译”。 | 与 OMP TS/JS extension 可共享 TS 类型、验证器和 fixtures；跨客户端持久合同仍应落为 JSON Schema，而不是只发布 `.d.ts`。 | 一套语言单测；加每个平台 executable smoke、三 client adapter contract fixtures。 | **首选**：最少语言边界，最快形成可逆外部核心。 |
| Go | `go build` 生成本地 executable；官方安装源码文档/目标表使用 `GOOS`/`GOARCH` 描述目标构建；`os/exec` 用 argv 启动进程且不隐式调用 shell。[S2] | 标准库可完成 JSON、文件和进程；TOML/JSON Schema 通常引入第三方库或生成代码。 | pure-Go 最直接；CGO/native dependency 会重新引入目标 C 工具链和平台矩阵。[S2] | 无法直接共享 OMP 的 TS 类型；必须以 JSON Schema/JSONL/CLI protocol 共享。 | Go 核心测试 + TS OMP bridge 测试 + protocol compatibility；发布产物通常朴素。 | **第一反转目标**：分发强，但首版增加语言/协议边界。 |
| Rust | Cargo 支持 `--target` 和 `.cargo/config.toml` 的 target-specific linker/runner；`std::process::Command` 提供 argv、cwd、env 与输出控制。[S3] | serde/JSON/TOML 生态成熟，但不属于标准库一体化合同。 | native executable；交叉编译常需对应 target、linker 与 native library 设置，CI 复杂度高于纯 Go/Bun 无 native addon 路径。[S3] | 与 TS adapters 同样依赖 schema/codegen/protocol；还要管理 Rust/TS 两套依赖与错误模型。 | Rust 核心 + TS bridge + FFI/子进程协议（若有）；最重。 | **暂不选**：此任务无已证实的性能或内存安全瓶颈。 |
| Python application / `zipapp` | 官方 `zipapp` 是含 `__main__.py` 的单文件 ZIP，但目标机仍需合适 Python interpreter；它不是自包含 native executable。[S4] | `subprocess` 与文件处理简单；可用 Python schema 库。 | Python/依赖版本、Windows launcher、native wheels 进入部署矩阵；“一个 `.pyz`”不等于“零运行时”。[S4] | 与 TS OMP extension 不能直接共享类型；仍需 JSON Schema。 | 解释器版本 × OS × dependency wheel；受控环境外维护面扩大。 | **仅脚本试验**：环境已保证 Python 时可快，不是默认发行方案。 |
| Shell/PowerShell scripts | 本轮没有找到能把 shell 脚本变成三 OS 同一运行合同的官方依据。 | 文件拼接和进程启动很快，但 quoting、encoding、signal、atomic replace 与 rollback 分叉。 | Bash/PowerShell 两条实现或额外 runtime；不是单一跨平台脚本。 | 无静态共享合同，必须另加 schema validator。 | 每 shell × OS；最容易漏掉并发和失败恢复。 | **拒绝为长期核心**；可作为安装/bootstrap，不作为状态所有者。 |

> 版本/兼容说明：S1–S3、S5–S8 是访问日的官方 current 页面或官方仓库 `main`；页面未提供统一 update date，故不声称固定版本范围。S4 明确是 Python 3.11.15 文档，只用于证明 `zipapp` 的分发语义，不作为 2026 Python 全版本兼容声明。

### 1.2 客户端 adapter 与 plugin/hook 边界

| 客户端 | 不需要进程内 plugin 的首版能力 | 只有 plugin/hook（或等价生命周期 API）才能可靠得到的能力 | 语言约束与维护含义 |
|---|---|---|---|
| OMP | 外部 CLI 可先生成/选择资源路径、MCP/skills/config，再启动 OMP；只做“装配后启动/恢复”的路径不天然要求进入 OMP 进程。 | 官方 extension runtime 可观察 session/agent/tool lifecycle；`tool_call`/`tool_result` 包裹每次工具执行，可阻止调用、改结果；可读 session manager、切换/分支 session、改变 active tools、注入消息、提供原生 UI/commands。[S5] 需要这些**同步、进程内且精确排序**的能力时，外部 wrapper 不能等价替代。 | extension 是导出 default factory 的 TS/JS module，并 import `ExtensionAPI`。[S5] 因此 OMP 内部薄层天然偏 TS/JS；它应只桥接稳定外部 protocol，不拥有跨客户端核心状态。 |
| Claude Code | CLI 可启动、`-c` 继续当前目录最近会话、`-r <session>` 按 ID/名称恢复；可用 `--append-system-prompt`/file、MCP、plugin 与显式配置入口完成一次启动装配。[S6] 因而 manifest 渲染、会话选择和进程启动不要求自定义进程内 plugin。 | 官方 hooks 提供 `SessionStart`、`PreToolUse`、`PostToolUse`、`Stop` 等事件；当要求在工具执行前阻止/判定、在精确 session lifecycle 记录、或收集客户端内部事件时，需要 hook，而仅解析 stdout 不足。[S7] | hook 可调用 command/HTTP/MCP，不要求核心用 TypeScript；plugin 是分发容器而不是必须把业务核心写成 TS 的理由。[S7] “TypeScript Claude adapter”应默认删去，除非插件包本身确有 TS 组件。 |
| Codex CLI | user config 在 `~/.codex/config.toml`，可信项目可用 `.codex/config.toml`；profile file 位于 `$CODEX_HOME` 并由 `--profile` 选择；MCP/skills/model instructions 可由配置引用。[S8] 外部 adapter 可创建隔离 `CODEX_HOME`/profile、渲染配置并启动客户端。 | 配置的 `notify` 是 Codex 调用的外部命令并传 JSON，足够做完成通知，但不是通用同步拦截。[S8] 本轮来源预算内**没有确认** Codex 的稳定进程内第三方 plugin ABI，亦未把所有 pre/post-tool 观察能力作为已证事实。需要工具级同步判定时必须另做 hooks 官方页/当前 CLI help 验证。 | 已证实的 notify 是 argv command，核心语言不限。[S8] 不应因 adapter 而强制 TS。项目 config 不能覆盖 provider/auth/notify/profile/telemetry 等 machine-local keys，隔离策略必须尊重该边界。[S8] |

### 1.3 哪些观察能力属于硬分界

**外部 wrapper 足够：**

1. 记录规范化 manifest、客户端、工作目录、启动 argv、环境变量 allowlist、配置快照 hash、外部进程 PID/exit code。
2. 在已知 session ID 时构造 resume 命令；在客户端只支持目录最近会话时记录其降级语义。
3. 在启动前写入隔离配置，在退出后回收由本次 assembly 独占的临时目录。
4. 读取明确稳定的 JSON/JSONL stdout 或客户端状态文件（前提是客户端官方合同如此说明）。

**必须 hook/plugin/lifecycle API：**

1. 工具调用发生前同步 deny/rewrite；事后 wrapper 无法撤销副作用。
2. 不依赖 stdout 文案而精确获得 tool start/result、compaction、session switch/branch、context mutation 等内部事件。
3. 修改客户端上下文、工具结果、active tools、session tree，或使用原生 TUI 通知/command/renderer。
4. 在客户端 crash/streaming/并发 agent 下仍要求事件与会话 ID 精确关联。

因此，“三端都写 plugin”不是首版前提；正确切分是 **configuration adapter by default, lifecycle adapter only on demonstrated observation requirement**。

## 2. Architecture options and maintenance surface

### A. 一个外部 TypeScript/Bun CLI + client-specific config adapters

**形态**

- `core`: manifest validation、capability negotiation、private state index、lock/lease、launch record。
- `adapters/{omp,claude,codex}`: 纯函数式 `plan(manifest, capabilities) -> files + argv + env + resume semantics`。
- `extensions/omp`：可选薄 TS extension，只发送/接收版本化 JSON 事件；Claude hooks 与 Codex notify 直接调用外部 executable，不复制核心。
- 发布：每个 OS/arch 一个 Bun executable；config/schema 与必要 plugin assets 可嵌入或同发行包携带。

**维护优点**

- 外部核心与 OMP extension 同语言；schema validator、fixtures、错误码可最大限度共享。
- Claude/Codex adapter 无需长驻服务或进程内 ABI。
- 分发无须用户另装 Node/Bun；仍必须维护平台 artifacts。

**主要风险**

- Bun compile 与 native npm dependencies、企业软件签名/杀软、自动更新的实测兼容性。
- TS 类型共享容易误导：客户端边界必须用运行时 schema 验证，`.d.ts` 不能验证磁盘/子进程数据。
- OMP API churn 可能把共享语言优势变成高耦合；extension 必须薄且可单独禁用。

### B. 外部 Go/Rust CLI + TypeScript OMP/Claude adapter

**形态与修正**

- 外部 native binary 负责所有状态和 config plans。
- 只保留 OMP TS bridge；Claude hook 可直接执行 native binary，通常不需要 TypeScript adapter。
- schema 以 JSON Schema 为真源；生成 Go/Rust/TS 类型，protocol 带 `contractVersion` 与 capability list。

**维护优点**

- Go 尤其适合常规原生 CLI 发行；没有 JS runtime/native addon 时部署边界清楚。
- 外部核心与客户端内部 churn 隔离得好。

**成本驱动（不伪造工时）**

- 两种语言、两个包管理器、两套错误/async/process 模型。
- schema codegen 或手写 DTO 漂移；每次 contract change 必须跨语言 fixtures。
- 调试链跨进程；Windows quoting、signal、stdio backpressure、crash recovery 都要 protocol tests。
- Rust 再增加 target linker/native dependency CI；若业务主要是 JSON/TOML、文件与子进程，这些成本没有被性能收益抵消。

### C. 纯脚本

**可接受边界**

- 单人/短期/受控 OS；解释器版本预装；单 assembly 串行执行；失败可人工恢复；不承诺稳定 resume/并发。

**为何不能作为五年基线**

- 清空/覆盖全局配置造成跨会话竞态；`trap/finally` 在 kill、断电、客户端再派生时不能保证恢复。
- Bash 与 PowerShell 的 quoting、路径、encoding、signal 不同；Python 脚本则把解释器与 wheels 变成发行依赖。
- 无类型并不减少合同：只是把 schema 错误推迟到用户运行时。
- 一旦补上锁、journal、atomic write、capability detection、structured errors、cross-platform tests，脚本会重新长成一个缺少明确边界的 CLI。

## 3. 配置文件与状态操作的最低实现纪律

以下是架构要求（推论），不是声称三客户端已提供同一能力：

1. **绝不清空或原地覆盖用户全局配置。** 优先使用客户端显式 settings/profile/home 参数；否则创建 assembly-owned 临时目录并只覆盖允许的 env/path。
2. **plan/apply 分离。** adapter 先输出 `files[]/argv/env/redactions/resumeMode/unsupported[]`，core 校验后再写盘与启动。
3. **同目录临时文件 + atomic replace；写入前 hash；写入后 fsync 能力按平台降级记录。** 若客户端只能读固定全局文件，用跨进程 lock + compare-and-swap restore；这应标为 degraded，而不是正常路径。
4. **私有状态不进公共仓。** manifest 可引用资源，credential 只允许环境变量名、keychain reference 或客户端已有 auth store；launch record 全部 redaction。
5. **外部核心拥有 assembly/session 映射，不拥有客户端 transcript。** 记录 `{assemblyId, client, cwd, clientSessionId?, resumeSelector, configHash, createdAt}`；客户端 session ID 未公开时保存 `Unknown` 和降级 resume 语义。
6. **无 shell 启动。** 始终 argv array；仅用户明确要求 shell pipeline 时才进入 shell，并把 shell/OS 写入 plan。
7. **并发默认隔离。** 每次 assembly 使用独立 workspace/profile/home；禁止“启动前清空、退出后恢复”作为并发设计。

## 4. 测试与发布最小矩阵

| 层 | 必须防守的可观察合同 | 建议矩阵 |
|---|---|---|
| Schema | manifest 拒绝未知破坏性字段；版本/Unknown/degraded 语义稳定 | 单语言 validator + golden invalid/valid fixtures |
| Adapter plan | 同一 manifest 生成确定的 files/argv/env；不泄露 secret；不写盘 | 3 clients × representative capabilities |
| Apply/rollback | atomic write、lock contention、preexisting user file 不丢失、crash journal 可恢复 | Windows/macOS/Linux filesystem scenarios |
| Process | argv 不经 shell、cwd/env 正确、signal/exit code/stdio 归属正确 | 每个发行目标 executable smoke |
| Resume | exact ID、name、current-directory-last、unsupported 四种模式不混淆 | client contract fixtures；可用时做真实 CLI smoke |
| Lifecycle bridge | event 带 assembly/session correlation；旧新 contract 版本拒绝或降级 | OMP extension + external binary protocol tests；Claude hook/Codex notify 只测实际使用事件 |
| Packaging | executable 启动、embedded assets 可读、配置目录有非 ASCII/空格 | 每个 OS/arch 发布 artifact；签名/杀软是发布验收而非单元测试 |

不要把三端高 Token 语义对照作为 MVP 门；测试 adapter contract、真实启动/恢复和状态安全即可。客户端升级时，先跑 compatibility smoke，再更新 capability snapshot；不能仅凭编译通过宣布兼容。

## 5. 五年维护风险

评分为架构判断：1=低、5=高；不是公开故障率。

| 风险驱动 | TS/Bun + config adapters | Go + thin TS OMP bridge | Rust + thin TS OMP bridge | 纯脚本 | 缓解 |
|---|---:|---:|---:|---:|---|
| 客户端 config/CLI churn | 4 | 4 | 4 | 5 | capability probe；adapter fixtures；不解析人类 stdout |
| OMP in-process API churn | 3（同语言但易耦合） | 4 | 4 | 5 | plugin 极薄；versioned protocol；可禁用 |
| 分发/运行时 | 3 | 2 | 3 | 5 | 每平台 artifact smoke；避免 native deps；签名与更新渠道 |
| 跨语言 schema drift | 1 | 4 | 4 | 4 | JSON Schema 真源 + generated types + cross-language golden fixtures |
| Windows/macOS/Linux 差异 | 3 | 2–3 | 3–4 | 5 | argv-only；真实平台 CI；非 ASCII/长路径/权限 fixtures |
| 配置并发与恢复 | 3 | 3 | 3 | 5 | isolated home/profile、lock、journal、CAS restore |
| 供应链/依赖 churn | 3 | 2 | 3 | 3–5 | 小依赖面、lockfile/SBOM、固定 toolchain、可重现构建 |
| 招聘/认知负担 | 2 | 3 | 4 | 3（隐性） | 一种核心语言；adapter contract 文档化；删除重复实现 |
| 可观察性缺口 | 3（按需 hooks） | 3 | 3 | 5 | 仅对已证明需要的事件加 lifecycle adapter |

**五年最危险的不是核心语言性能，而是客户端合同 churn、全局配置竞态和跨语言 schema 漂移。** 因此应把预算放在 capability/version probes、隔离状态、真实 launch/resume smoke 和薄 adapter 边界，而不是提前建设 daemon、SQLite 或完整 plugin 三件套。

## 6. 最小实现切片

1. **`assembly.schema.json`**：client、cwd、resources、system-prompt strategy、MCP、resume selector、capability policy；显式 `unsupported/degraded/Unknown`。
2. **纯 plan adapters**：OMP/Claude/Codex 各自只生成 files/argv/env；不得直接写用户全局目录。
3. **apply runner**：临时目录、lock/journal、secret redaction、argv spawn、exit record。
4. **private launch index**：先用原子 JSON/JSONL 文件；只有出现多写者查询/迁移压力才升级 SQLite，避免预建服务。
5. **真实 smoke**：三端各验证一次 fresh launch 与能支持的 resume mode；未支持项形成 capability result，不伪装等价。
6. **按需 OMP extension**：只有首个必须同步观测/修改的 use case 出现后才加入；contract 只含事件 envelope，不复制 core。
7. **Claude/Codex lifecycle**：先用官方 command hook/notify 触发外部 binary；无需要不创建 client-specific TS package。

## 7. 反转条件

### 从 TypeScript/Bun 反转到 Go

满足任一实证条件即可触发 spike；连续两个 release 仍不能消除则迁移 core：

- 目标企业环境拒绝/隔离 Bun-compiled executable，且签名、SBOM 或安全审查无法满足；
- 必需 native npm dependency 无法在支持矩阵稳定打包；
- executable 启动、内存或更新体积成为测得的产品约束；
- OMP extension 已缩到纯 JSON protocol bridge，TS 核心不再提供共享实现优势；
- 团队已有受支持的 Go 发布链，而 Bun 需独立维护全新链路。

### 从 Go 反转到 Rust

仅在出现可测的严格资源/延迟、安全边界，或关键库只在 Rust 可维护地提供时；“单文件更原生”不足以承担 Rust+TS 双栈。

### 从外部核心反转到 OMP 内部特化

- 产品价值主要来自 OMP 的同步 tool interception、session tree、context mutation、原生 UI；
- 外部 adapter contract 为了 OMP 持续泄漏内部对象，已经无法保持客户端中立；
- OMP 是明确主入口，Claude/Codex 只需 degraded export，而不是同级运行体验。

即便反转，私有 state/schema 和 client-neutral manifest 仍留在外部边界，保证未来抽取。

### 从 CLI 反转到 daemon/SQLite

只有出现多个并发 writer、跨进程订阅、需要查询大量 session 映射、或 crash recovery 无法由 journal 满足时；“以后可能并发”不是首版 daemon 理由。

### 允许纯脚本

只限单 OS、受控解释器、单用户串行、可人工恢复且明确到期的 experiment；一旦要求公共发行、并发或长期 resume，立即转 CLI。

## 8. Claims table

| ID | Claim | Source URL | Publisher | Publication/update date | Accessed | Confidence | Class |
|---|---|---|---|---|---|---|---|
| C1 | Bun `--compile` 可把 runtime、应用与依赖产生成 standalone executable，并列出跨 OS/arch targets。 | https://bun.com/docs/bundler/executables | Bun | unknown | 2026-08-22 | High | current distribution contract |
| C2 | Bun 提供 argv-based spawn，并支持 cwd/env/stdio。 | https://bun.com/docs/runtime/child-process | Bun | unknown | 2026-08-22 | High | current process API |
| C3 | Go 可按 GOOS/GOARCH 构建目标 executable；os/exec 不隐式经过 shell。 | https://go.dev/doc/install/source ; https://pkg.go.dev/os/exec | Go project | unknown | 2026-08-22 | High | current distribution/process contract |
| C4 | Cargo 支持 target 与 target-specific linker/runner；Rust Command 支持 argv/cwd/env/output。 | https://doc.rust-lang.org/cargo/reference/config.html ; https://doc.rust-lang.org/std/process/struct.Command.html | Rust project | unknown | 2026-08-22 | High | current build/process contract |
| C5 | Python zipapp 是单文件 archive，但仍要求合适的 Python interpreter。 | https://docs.python.org/3.11/library/zipapp.html | Python Software Foundation | versioned as Python 3.11.15; page date unknown | 2026-08-22 | High for 3.11 semantics; Medium for current-version extrapolation | versioned distribution contract |
| C6 | OMP extension 是 TS/JS default factory，并可注册 event/tool/command/UI 与 session APIs。 | https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md | Oh My Pi / can1357 | unknown (`main`) | 2026-08-22 | High for accessed main; Medium for future compatibility | current extension contract |
| C7 | OMP 将每次 tool execution 包在 `tool_call`/`tool_result` interception 中；进程内 extension 可执行外部 wrapper 无法等价提供的同步控制。 | https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md | Oh My Pi / can1357 | unknown (`main`) | 2026-08-22 | High fact / High inference | current contract + architecture inference |
| C8 | Claude CLI 支持 current-directory continue、按 ID/name resume、MCP/plugin 管理和临时 system-prompt flags，因此装配/恢复并不天然要求进程内 plugin。 | https://code.claude.com/docs/en/cli-reference | Anthropic | unknown; page contains per-feature minimum versions up through v2.1.x | 2026-08-22 | High fact / High inference | current CLI compatibility + architecture inference |
| C9 | Claude hooks 能在 SessionStart、PreToolUse、PostToolUse、Stop 等生命周期执行 command/HTTP/MCP；同步工具策略需要 hook，而启动 wrapper 不足。 | https://code.claude.com/docs/en/hooks | Anthropic | unknown | 2026-08-22 | High fact / High inference | current hook contract + architecture inference |
| C10 | Codex 支持 user/project config 与 `$CODEX_HOME` profile；project config 无权覆盖 provider/auth/notify/profile/telemetry 等 machine-local keys。 | https://learn.chatgpt.com/docs/config-file/config-reference | OpenAI | unknown | 2026-08-22 | High | current configuration contract |
| C11 | Codex `notify` 调用外部 command 并传 JSON；这可做通知但不证明通用工具级同步拦截。 | https://learn.chatgpt.com/docs/config-file/config-reference | OpenAI | unknown | 2026-08-22 | High fact / High inference | current config contract + bounded inference |
| C12 | TS/Bun 首版比 Go/Rust+TS bridge 少一个 schema/runtime boundary。 | S1–S3, S5–S9 | Multiple official publishers | see above | 2026-08-22 | Medium-High | architecture inference |
| C13 | 外部 core + config adapters 应先于三端 plugins；只有同步内部观察/修改才增加 lifecycle adapter。 | S5–S11 | Multiple official publishers | see above | 2026-08-22 | High | architecture inference |
| C14 | 纯脚本不应作为五年跨平台核心，因为解释器/shell、并发恢复和 schema 验证仍需维护。 | S4 plus C1–C13 comparison | Multiple | see above | 2026-08-22 | Medium-High | maintenance inference |
| C15 | Go 是 Bun 路线最小的反转目标，Rust 是条件性目标。 | C1–C6, C12–C14 | Multiple | see above | 2026-08-22 | Medium | selection inference |

## 9. Source register（8 sources）

| ID | URL | Publisher | Publication/update date | Accessed | Why used |
|---|---|---|---|---|---|
| S1 | https://bun.com/docs/bundler/executables （同 publisher 的 process API: https://bun.com/docs/runtime/child-process） | Bun | unknown | 2026-08-22 | standalone executable、targets、spawn |
| S2 | https://go.dev/doc/install/source （同 publisher API: https://pkg.go.dev/os/exec） | Go project | unknown | 2026-08-22 | native target builds、process semantics |
| S3 | https://doc.rust-lang.org/cargo/reference/config.html （同 publisher API: https://doc.rust-lang.org/std/process/struct.Command.html） | Rust project | unknown | 2026-08-22 | target/linker config、process semantics |
| S4 | https://docs.python.org/3.11/library/zipapp.html | Python Software Foundation | Python 3.11.15; page date unknown | 2026-08-22 | zipapp runtime requirement |
| S5 | https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md | Oh My Pi / can1357 | unknown (`main`) | 2026-08-22 | TS/JS extension、events、tool interception、session/UI APIs |
| S6 | https://code.claude.com/docs/en/cli-reference | Anthropic | unknown | 2026-08-22 | launch/resume/config/plugin/system-prompt CLI surface |
| S7 | https://code.claude.com/docs/en/hooks | Anthropic | unknown | 2026-08-22 | lifecycle observation/interception |
| S8 | https://learn.chatgpt.com/docs/config-file/config-reference | OpenAI | unknown | 2026-08-22 | Codex config scopes/profile/notify/schema |

> Source-count rule：同一官方 publisher 的 build/process API 子页在 claims 中保持精确 URL，但按一个语言运行时 source family 计；没有使用第三方打包器或博客作为结论依据。

## 10. Contradictions resolved

1. **“单文件就没有运行时依赖”**：Bun compile 会把 runtime 带入 executable；Python zipapp 则仍要求 interpreter。两者都叫单文件，但部署合同不同。[S1][S4]
2. **“所有客户端都必须 plugin”**：启动装配、配置与 resume 可由 CLI/config 完成；只有同步 tool/context/session/UI 能力需要 lifecycle integration。[S5–S8]
3. **“Go/Rust native binary 一定维护更少”**：发行面可能更朴素，但 OMP extension 仍是 TS/JS，因而引入跨语言 schema/protocol/fixtures；是否更少取决于 Bun 分发是否成为实证问题。[S1–S5]
4. **“TypeScript 能共享类型，所以无需 schema”**：磁盘、配置、hook stdin 与子进程输出都是运行时边界；TS 静态类型不能验证它们。共享 JSON Schema 才是跨语言/跨版本合同。（架构推论）
5. **“配置文件都能项目级覆盖”**：Codex 明确限制 project config 覆盖 provider/auth/notify/profile/telemetry；不能把 project-local 文件当成完整隔离层。[S8]
6. **“退出时恢复全局配置就安全”**：并发、kill 和 crash 会破坏 restore 假设；应优先隔离 home/profile/settings，无法隔离时才以 lock+journal 标记 degraded。（架构推论）

## 11. Leads

1. **Codex hooks 当前合同**：读取官方 hooks 页与实际 `codex --help`/schema，确认 PreToolUse/PostToolUse/SessionStart 是否稳定、事件 JSON 与退出码；这是决定 Codex 是否需要 lifecycle adapter 的最高价值下一步。
2. **Bun 发行 spike**：在 Windows x64、macOS arm64、Linux x64 编译真实最小 binary；验证签名、杀软、非 ASCII 路径、embedded assets、native dependency absence 与冷启动。
3. **OMP extension loading/versioning**：补读官方 extension-loading、package manifest 与 package release tags，确定 extension discovery、pinning、API compatibility/破坏性升级策略。
4. **Claude isolated settings**：以当前 CLI help 和 settings schema 确认 `--settings`、`--mcp-config`、`--plugin-dir` 的优先级、merge/strict semantics、session resume 时是否重新读取。
5. **Codex isolated home/profile**：真实 smoke 两个并发 `$CODEX_HOME`/profiles，验证 auth reuse 边界、session storage 与 resume selector，不触碰真实用户目录。
6. **Artifact policy**：向目标组织核实是否允许 Bun-bundled runtime、是否必须 codesign/notarize/SBOM/air-gap update；这是 Bun vs Go 的组织性反转证据。

## 12. Not Found

- 未找到 OMP extension API 的正式长期兼容承诺、稳定 ABI 或支持窗口；只确认访问日官方仓库 `main` 的合同。
- 未在本轮来源预算内确认 Codex 的稳定进程内第三方 plugin ABI或其语言约束；仅确认 config/profile/notify。
- 未找到 Bun、Go、Rust、Python 对本产品五年支持成本的公开可比数值；风险比较使用结构复杂度驱动，未伪造工时。
- 未找到三客户端共同的、可定位且并发安全的“完整配置覆盖”合同；不能据此声称一套临时 config flag 三端通用。
- 未验证任何客户端在 resume 时是否重新读取全部 Skills/MCP/system prompt 配置；这必须由客户端专项 smoke 回答。
- 未找到官方依据证明清空全局配置后能在 crash/并发下可靠恢复；因此该方案不进入推荐路径。
