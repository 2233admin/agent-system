# 三 CLI 架构成本与迁移代价（R1.1）

- 研究日期：2026-08-22
- 范围：A「一步交付三端 adapters」；B「外部核心 + 最窄 adapter contract，OMP-first」；C「整体 OMP 内部特化后再抽取」
- 结论性质：官方能力事实与架构推论严格分开；成本只使用结构性相对量级，不伪造工时。
- 新鲜度：能力事实均来自本轮于 2026-08-22 访问的官方当前文档或官方仓库 `main`。页面/文件未公开可靠的更新时间，故 Claims 表如实标 `unknown`；所有版本敏感结论都要求运行时记录实际 CLI 版本并重新做 capability probe。

## Executive finding

**按简报既定权重，B 的相对总负担最低（2.05/5），C 次之（3.30/5），A 最高（4.30/5）。** 这不是工期估算，而是可重加权的结构成本指数（1=低负担，5=高负担）。

推荐的最低成本可逆性 hedge 是：**现在就把一次调用的“装配意图 → 客户端启动参数/临时覆盖 → 启动回执/Session 绑定”放在 OMP 进程外，但只实现一个 OMP renderer；不用守护进程、不先造三端大一统 API，也不把业务核心塞进 OMP 内部。** 客户端继续拥有凭据和原生 Session；外部层只持有不透明 resume locator、cwd、客户端及版本、装配摘要和回执。

当前官方能力支持“不改全局配置的单次启动”这一较窄命题：OMP 有只作用于单进程且不持久化的可重复 `--config` overlay；Claude Code 有 `--settings`、`--setting-sources`、prompt/MCP 启动参数和 `--strict-mcp-config`；Codex 有优先级最高的一次性 `-c/--config key=value`。但三端没有一个已证实的、语义一致的“排除所有其他配置源 + 同构 Session resume + 同构有效配置回执”合同。因此，“几条脚本就足以完成单用户、单机、顺序启动的 MVP”是**有条件成立**；“清空全局配置后即可得到可恢复、并发安全的三端统一装配”被本轮证据否定。

## Findings

### 1. 本轮证实的客户端能力事实

#### OMP

- 官方设置文档给出明确优先级：built-in defaults `<` global `<` project `<` CLI overlays `<` runtime overrides。`--config <file>` 可重复、只对该进程生效、永不持久化；后传 overlay 覆盖先传 overlay。对象深合并，数组整体替换。
- `PI_CODING_AGENT_DIR` 会整体迁移 OMP agent base，包括全局 `config.yml`、认证存储 `agent.db` 及其余内容。这能提供强隔离，但也意味着认证和 Session 归属随根目录一起移动，不能把它误当作“只换配置文件”的无成本开关。
- `omp config set/reset` 和普通设置写入全局配置；`reset` 写入 schema 默认值而不是删除键。保存会在锁内重读文件，尽量保留 session 运行期间的外部编辑。
- `--continue`、`--resume <id/prefix/path>` 和 picker 均有官方行为说明。启动 resume 会按目标 Session 的 cwd 重新加载项目设置/插件和模型；进程内切换在失败时恢复先前 manager/runtime snapshot。匹配、跨项目、无 TTY 和损坏文件均有客户端特有边界，不能抽象成一个布尔 `resume=true`。

#### Claude Code

- 官方设置层优先级是 managed settings `>` command line `--settings` `>` project local `>` shared project `>` user。`--settings` 只覆盖显式提供的键；未提供的键继续使用文件设置，并非“独占配置文件”。
- 启动参数提供 `--setting-sources user,project,local`、`--mcp-config`、`--strict-mcp-config`、`--append-system-prompt(-file)`、`--system-prompt(-file)`；其中 `--strict-mcp-config` 只让 MCP 使用命令行提供的配置，不等于排除所有 managed policy。
- Session 可用 `--continue`、`--resume <id|name>`、picker 和 `--session-id <UUID>`；`--fork-session` 能在 resume 时产生新 ID。当前文档还说明 `--resume` 按 ID 搜索范围在 v2.1.223 前后改变，证明 adapter 必须按实际版本分支或拒绝未知版本。
- `--safe-mode` 可禁用大部分自定义项，但 managed policy 仍生效；因此它是诊断/降级路径，不是可宣称的完全空白环境。

#### Codex CLI

- 官方配置文档给出优先级：CLI flags/`--config` overrides `>` trusted project `.codex/config.toml` `>` selected profile `>` user `~/.codex/config.toml` `>` system config `>` defaults。项目配置、hooks、rules 仅在项目受信任时载入；user/system 仍会载入。
- 当前官方 CLI 文档确认 `-c key=value` 是本次调用的最高优先级 override；`codex exec` 支持 `resume`，可用 `--last` 选择当前 cwd 最近 Session，并可用 `--all` 扩大搜索；`--json` 产生逐状态 JSONL 事件。
- 本轮已读官方材料没有证实一个与 Claude `--setting-sources` 或 OMP 独立 agent root 等价的“排除全部用户/系统配置源”开关；也没有证实跨三端通用的有效配置导出合同。

### 2. 结构成本模型（架构推论）

以下全部为 **inference**。令候选架构总负担为：

`C_total = K_core + Σ_i(G_i + O_i + R_i + F_i) + S_owner + L_concurrency + T_matrix + M_migration`

其中：

- `K_core`：公共 manifest、capability vocabulary、receipt、schema/versioning；
- `G_i`：客户端 `i` 的参数、文件格式、cwd、进程和输出 glue；
- `O_i`：配置覆盖、优先级、恢复与机密边界；
- `R_i`：Session 定位、resume、fork、cwd 重绑定；
- `F_i`：客户端特有失败归类和诊断；
- `S_owner`：逻辑装配状态与客户端原生状态的所有权边界；
- `L_concurrency`：同一逻辑 Session、多 invocation、崩溃和竞态；
- `T_matrix`：客户端版本 × fresh/resume × overlay 类型 × 交互/脚本模式的资格矩阵；
- `M_migration`：以后切分、重定位状态、schema 迁移和调用方切换。

重复成本不是“adapter 数量”一个变量，而是：

`C_repeat = Σ_i version_change_i × (config_delta_i + resume_delta_i + output_delta_i + qualification_i) + core_schema_migration + support_boundary`

这解释了为什么 A 会把三端版本漂移立即变为发布耦合，C 会把未来抽取变成额外迁移项目，而 B 可以把新客户端的资格成本保持为增量。

### 3. 可重加权相对成本表

评分：1=最低成本/风险，5=最高。权重来自研究简报；可替换 `w_j` 后按 `Σ(w_j × score_j)` 重算。

| 决策维度 | 默认权重 | A 三端一步 | B 外部窄核心、OMP-first | C OMP 内部后抽取 | 主要结构驱动（inference） |
|---|---:|---:|---:|---:|---|
| 首版与长期总成本 | 40% | 5 | 2 | 4 | A 同时支付三端 glue/资格/漂移；B 只先固化稳定 envelope；C 以后重复支付切分和迁移 |
| 首个可用 MVP 速度 | 25% | 5 | 2 | 1 | C 最少边界；B 多一个很薄的外部边界；A 被最慢/最不确定客户端拖住 |
| 未来客户端接入成本 | 20% | 2 | 2 | 5 | A/B 已有外部边界；B 的窄 deterministic renderer 更易增量；C 先要从 OMP 内部抽出隐含合同 |
| 可观察性与正确性负担 | 10% | 4 | 2 | 3 | A 首发即覆盖三种 Session/配置失败；B 统一 receipt 后逐端资格；C 初期简单、抽取时需证明语义未丢失 |
| 分发与维护负担 | 5% | 5 | 3 | 3 | A 同时跟随三端；B 多一个外部小工具但无 daemon；C 同时承受 OMP 内部耦合和后续外部包 |
| **默认加权负担** | **100%** | **4.30** | **2.05** | **3.30** | 数字仅用于相对重加权，不代表工时或概率 |

重加权敏感性：

- B 相对 C 的优势为 `2·w_total - 1·w_MVP + 3·w_future + 1·w_correctness`（distribution 相同）。只有当 MVP 速度权重高到超过其余这些未来代价之和时，C 才会成为更便宜选择。
- A 在这些“负担”维度上不比 B 更低；A 合理的条件不是成本，而是“首发必须三端同时可用”被提升为硬门。若这不是硬门，A 没有成本优势。

### 4. 按成本构件比较一次性与重复代价

| 构件 | A：一步三端 adapters | B：外部窄 contract、OMP-first | C：OMP 内部特化后抽取 |
|---|---|---|---|
| 公共核心（一次性） | 高：在真实反馈前同时容纳三套差异，易变成 union-of-everything | 中低：只建 manifest/launch/receipt/session-binding envelope；OMP renderer 提供第一份证据 | 初期最低；抽取时高，因 OMP 内部类型、路径和生命周期可能已成为隐含合同 |
| 每端 glue（一次性） | 三份同时完成，且都要达到发布质量 | 首期一份；其余按 adapter qualification 增量增加 | 初期一份内嵌 glue；以后既要抽出 OMP glue 又要新增两端 |
| 状态所有权 | 一开始设计三套 client locator 映射，认知负担高 | 外部只持 opaque locator/receipt；客户端继续拥有 transcript/auth，边界最清楚 | OMP 状态容易被业务逻辑直接引用；后续要重新划线并迁移 |
| 配置覆盖/恢复 | 必须一次解决三套 precedence、exclusive/non-exclusive 和错误恢复 | 首期只保证 OMP；contract 只表达 capability 与 launch spec，不伪装语义一致 | 初期能直接调用 OMP 内部；抽取时要把隐式默认值显式化 |
| 并发安全 | 若改全局文件，需要三套锁/快照/恢复；不用全局写入则仍有三端 Session 并发边界 | 每 invocation 独立目录 + immutable manifest + 原子 receipt；只锁外部映射 | 可借 OMP 内部锁，但外部化后锁域、进程域、路径域需重做 |
| Session resume | 三端特有 locator/cwd/fork 语义同时上线 | 先保存 OMP opaque locator；以后为 Claude/Codex 增加 capability 分支 | OMP resume 最快；抽取后要兼容旧 locator/state path 并补另外两端 |
| 测试矩阵 | 首发即 `Σ client_i × modes_i × version bands_i` | core contract 一次；每加一端只加该端 fresh/resume/失败资格集 | 初期 OMP 单矩阵；抽取期同时出现“旧内嵌路径 vs 新外部路径”迁移证明，随后再扩三端 |
| 迁移 | 首次切换面大；完成后三端都在外部边界 | 加法式迁移；先只有一个调用方切到 envelope | 最高：拆包、状态迁移、调用方切换、旧路径清理必须同一 cutover 完成，否则形成双真相 |
| 失败边界 | adapter 可隔离客户端，但 core 或发布编排失败会阻塞三端首发 | renderer 失败只影响该客户端；receipt 能保留准备/启动/退出阶段 | 内部异常可能与 OMP 主生命周期同域；抽取期间 failure ownership 易模糊 |
| 版本重复成本 | 三端任一 CLI 漂移都可能触发同一发布列车 | OMP-first 只承担已启用端；新增端可独立 qualification | OMP 漂移直接耦合内部实现；抽取后又承担外部 contract 兼容 |

### 5. 最窄 adapter contract（B 的控制成本关键，inference）

不要先定义通用 Session 数据模型或通用 MCP/Skill AST。最窄边界只需要三件事：

1. `probe(clientBinary) -> CapabilityRecord`：记录实际版本，以及每项能力 `supported | degraded | unsupported | unknown`；
2. `compile(AssemblyIntent, optional SessionTarget) -> LaunchSpec`：纯函数式地产生 argv、env、cwd、临时文件和预期观察点；不得写客户端全局配置；
3. `interpret(LaunchObservation) -> ReceiptDelta`：从进程启动/退出及明确可解析输出中提取客户端原生 Session locator；无法取得时写 `unknown`，不能猜。

公共 core 只负责 schema、私有 invocation 目录、原子文件、子进程生命周期、redaction、receipt 和同一逻辑 Session 的本地互斥。客户端 adapter 不拥有凭据、transcript 或恢复算法；它只把外部意图映射到官方 CLI 合同。这样未来能力差异不会迫使 core 扩成客户端 SDK。

### 6. 无守护进程：“脚本 + 启动清单 + 回执”路径

#### 可行的最低闭环（inference）

1. **Preflight**：解析不可变 `AssemblyIntent`，探测二进制实际版本/能力，验证 cwd 与私有输入文件，分配唯一 `invocation_id`。
2. **Prepare**：在私有、每次调用独立目录生成 overlay/prompt/MCP 文件；只记录摘要，不把凭据写入公共仓。
3. **Compile**：
   - OMP：优先 `--config`；只有确需整根隔离时才使用 `PI_CODING_AGENT_DIR`，并显式承担 auth/session root 迁移；
   - Claude：组合 `--settings`、`--setting-sources`、prompt flags、`--mcp-config`/`--strict-mcp-config`，但 receipt 必须标注 managed settings 仍可能生效；
   - Codex：只生成已知键的 `-c key=value`/flags；未证实排除 user/system source 时，标记 isolation=`degraded|unknown`。
4. **Launch**：脚本作为会话期 wrapper 启动子进程，不成为常驻服务。先原子写 `prepared` receipt，再写 `launched`（redacted argv/env 摘要、cwd、client/version、PID/时间）。
5. **Bind**：只有从客户端明确输出或用户选择得到 locator 才写 `session-bound`；否则保存 `unknown` 并要求下次通过原生 picker 选择，而不是猜“最近 Session”。
6. **Exit**：记录退出码、信号和结束时间；临时输入按保留策略删除。wrapper 崩溃留下的 `prepared/launched` receipt 由下次 invocation 保守标为 stale，不能自动宣称已回滚。

#### 并发与恢复边界

- 通过“每 invocation 独立目录 + 不写全局配置 + 原子 receipt”避免大多数配置竞态；只对外部的 logical-session → native-locator 映射加本地锁。
- 未从官方材料取得三端“同一 native Session 可被两个进程安全并发写入”的保证。因此默认拒绝同一 logical Session 的第二个活动 resume；无法识别活动进程时标 `unknown` 并交给用户。
- 无 daemon 可以可靠覆盖前台/顺序启动、可审计回执和显式 resume；不能承诺 wrapper 被强杀后的实时清理、跨主机 lease、后台会话监督或持续健康检查。这些需求实际出现前，不应预付 daemon、SQLite 或远程协调成本。

#### 回执最小字段（inference）

`schema_version, invocation_id, client, client_version, capability_digest, cwd, assembly_digest, overlay_digests, redacted_launch_spec, lifecycle_state, native_session_locator?, locator_source, started_at, ended_at?, exit_status?, warnings[]`

其中 `native_session_locator` 是不透明值；禁止把三端 transcript 搬进公共状态。receipt 本身也应在私有、非公共仓位置。

### 7. 直接清空全局配置的风险

结论：**不作为任何候选的默认实现；即使有备份/恢复也不是低成本路径。**

| 风险 | 事实基础 | 架构推论 |
|---|---|---|
| 清空不等于隔离 | OMP/Claude/Codex 都有多层 precedence；Claude managed 层最高；Codex user/system 仍可加载；OMP 还有 project/runtime/env 路径 | 清空一个文件既可能破坏用户状态，又不能证明启动环境为空 |
| 竞态窗口 | OMP 普通设置是全局文件并有锁内重读；三端都存在用户级共享配置路径 | “备份→清空→启动→恢复”跨越多个进程和崩溃点；文件锁不能让已经运行的进程撤销已读状态 |
| 回滚不是语义逆操作 | OMP `reset` 写默认值而非删键，且存在迁移；Claude `--settings` 是 merge；Codex 层级受 trust/profile/system 影响 | 序列化再写回可能丢注释、格式、未知新键或并发用户编辑；字节备份也无法回滚进程已加载状态 |
| 误删 blast radius | OMP 的完整 agent root 同时包含 config、auth store 和其他状态；Claude/Codex 用户配置位于全局用户目录 | 把“清空 config”扩成“清空目录”可能破坏认证、Session 或其他本地状态，恢复成本远高于一次启动失败 |
| cwd/Session 恢复漂移 | OMP resume 会按记录 cwd 重新加载项目状态；Claude/Codex resume 也有 cwd/search 范围规则 | 启动时临时清空的环境与 resume 后实际生效环境可能不同，回执若不记录 cwd/版本/能力会误报成功 |

如果某个客户端只能靠全局写入实现一项能力，最低安全门也必须是：独占本机锁、写前 byte-for-byte snapshot + hash、compare-and-swap 恢复、崩溃恢复日志、明确阻止并行 invocation。其结构成本已高于“不支持/降级该能力 + 一次性 overlay”，所以不应放入 MVP 默认路径。

### 8. 候选结论

#### A：一步交付三端 adapters

- **适用条件**：三端同日可用是不可协商硬门。
- **代价**：最高首发 glue、资格矩阵和版本耦合；公共 contract 在一次获得三端真实反馈前容易过宽。
- **失败边界**：可按 adapter 隔离，但任一客户端未过资格门会阻塞整批发布。
- **迁移**：完成后的新增客户端成本可控，但这是用最高前置投入购买的结果。

#### B：外部核心 + 最窄 adapter contract、OMP-first

- **适用条件**：允许按客户端逐步上线，且最终三端是硬门而非首发三端硬门。
- **代价**：比 C 多一个很薄的外部 envelope；比 A 少两份首发 glue 和两套立即资格矩阵。
- **失败边界**：renderer 与客户端进程天然隔离；core 只持 receipt/locator，不复制客户端状态。
- **迁移**：新增 Claude/Codex 是添加 renderer 和资格集，不需要搬出 OMP 内部业务状态。
- **结论**：默认推荐。

#### C：整体 OMP 内部特化后再抽取

- **适用条件**：MVP 速度压倒未来接入和迁移成本，或方案只做短命实验。
- **代价**：首个 OMP 路径最低，但内部路径、状态对象、Session 生命周期会形成隐含 contract；后续抽取必须同时拆边界、迁状态、改调用方和补三端测试。
- **失败边界**：初期简单；抽取期最模糊，容易出现 OMP 内部状态与外部 core 双真相。
- **迁移**：三案最高。若仍选 C，至少把 manifest/receipt 文件格式和私有状态根放在 OMP 外，以保留退路；这实际上已经向 B 收敛。

## Claims

说明：`fact/current-doc` 表示官方当前能力事实；`inference/architecture` 表示由列明事实推导的架构判断。官方页面没有可靠公开的 publication/update date 时不猜测。

| ID | Claim | Class | Source URL | Publisher | Publication/update date | Accessed | Confidence |
|---|---|---|---|---|---|---|---|
| F1 | OMP 的 `--config` 是可重复、单进程、非持久化的高优先级 overlay；配置层深合并且数组替换。 | fact/current-doc | https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md | can1357/oh-my-pi（官方仓库） | unknown | 2026-08-22 | High |
| F2 | `PI_CODING_AGENT_DIR` 会迁移整个 OMP agent base（含 config、`agent.db`）；OMP 全局设置保存使用锁内重读，`reset` 写默认值而非删除键。 | fact/current-doc | https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md | can1357/oh-my-pi（官方仓库） | unknown | 2026-08-22 | High |
| F3 | OMP 支持 continue、按 id/prefix/path resume 和 picker；resume 可切换 cwd/重载项目状态，进程内 switch 有 snapshot rollback，但存在客户端特有匹配及失败边界。 | fact/current-doc | https://github.com/can1357/oh-my-pi/blob/main/docs/session-switching-and-recent-listing.md | can1357/oh-my-pi（官方仓库） | unknown | 2026-08-22 | High |
| F4 | Claude Code settings 优先级由 managed 到 command line/project/user；`--settings` 只覆盖给出的键，遗漏键仍来自文件层。 | fact/current-doc | https://code.claude.com/docs/en/settings | Anthropic | unknown | 2026-08-22 | High |
| F5 | Claude Code 提供 source selection、严格 MCP、prompt、continue/resume/session-id/fork 等启动合同；managed policy 不能由 safe mode 普遍移除；resume 搜索行为有版本边界。 | fact/current-doc | https://code.claude.com/docs/en/cli-reference | Anthropic | unknown | 2026-08-22 | High |
| F6 | Codex 配置层为 CLI overrides、trusted project、profile、user、system、defaults；`-c` 为一次调用的最高优先级 override。 | fact/current-doc | https://learn.chatgpt.com/docs/config-file/config-basic | OpenAI | unknown | 2026-08-22 | High |
| F7 | Codex `exec` 支持 resume/`--last`/`--all`，并可用 `--json` 输出逐状态 JSONL；官方当前 CLI 还提供 MCP/config 等独立命令面。 | fact/current-doc | https://learn.chatgpt.com/docs/developer-commands?surface=cli | OpenAI | unknown | 2026-08-22 | High |
| I1 | 三端一次性 overlay 能支持无 daemon 的单机顺序 MVP，但不能推出完全配置隔离或同构 resume。 | inference/architecture | https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md ; https://code.claude.com/docs/en/cli-reference ; https://learn.chatgpt.com/docs/config-file/config-basic | 本研究（由 OMP/Anthropic/OpenAI 官方材料推导） | 2026-08-22 | 2026-08-22 | High |
| I2 | 直接清空全局配置同时带来破坏性、竞态和不完全隔离；immutable per-invocation overlays 的结构成本更低。 | inference/architecture | https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md ; https://code.claude.com/docs/en/settings ; https://learn.chatgpt.com/docs/config-file/config-basic | 本研究（由 OMP/Anthropic/OpenAI 官方材料推导） | 2026-08-22 | 2026-08-22 | High |
| I3 | 以简报权重计，B 比 A/C 有更低总负担；其关键是 adapter 只做 probe/compile/interpret，客户端继续拥有 transcript/auth。 | inference/architecture | https://github.com/can1357/oh-my-pi/blob/main/docs/session-switching-and-recent-listing.md ; https://code.claude.com/docs/en/cli-reference ; https://learn.chatgpt.com/docs/developer-commands?surface=cli | 本研究（由三端官方 Session/CLI 差异推导） | 2026-08-22 | 2026-08-22 | Medium-High |
| I4 | C 的最低首发成本会被后续“内部 contract 外显 + 状态迁移 + 双路径资格”抵消，除非 MVP 速度的重权超过未来成本。 | inference/architecture | https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/session-switching-and-recent-listing.md | 本研究（由 OMP 配置/Session 内部耦合面推导） | 2026-08-22 | 2026-08-22 | Medium |

## Contradictions

1. **“三端都能靠一个完整配置文件覆盖全局”与证据冲突。** OMP 的 overlay 是深合并；Claude `--settings` 明确保留遗漏键，managed 仍更高；Codex 本轮只证实逐键 `-c` 和分层 config，未证实独占 source flag。
2. **“清空全局配置就得到干净环境”与多层 precedence 冲突。** project、managed、system、runtime/env、trust 等来源仍可能生效；同时清空会伤及共享用户状态。
3. **“Session resume 可统一成同一个参数”与官方行为冲突。** 三端在 locator 类型、cwd 搜索、picker、fork、跨项目范围、错误恢复上均不同；core 只能保存 opaque locator 和 capability，不能假定语义等价。
4. **“有文件锁就并发安全”不成立。** OMP 文档中的锁针对其设置保存，不能证明 backup/clear/restore 跨进程事务，更不能证明三端同一 native Session 的并发写安全。
5. **“脚本路线必然需要 daemon/SQLite”也未被证实。** 单机、前台、逐次启动可由 wrapper + 原子 receipt 完成；只有跨主机 lease、后台监督、长期健康/事件流等需求出现时，常驻状态服务才有对应价值。

## Leads

1. 在实现门前针对实际安装版本分别采集 `--version`、当前 `--help`/配置合同，并把版本和 capability digest 写入 receipt；文档页无可靠更新时间，不能只依赖 `main`/current docs。
2. 用最小 smoke（不修改用户全局配置）验证三端 fresh → 得到 native locator → explicit resume；重点记录 cwd 切换、退出码、输出中是否有稳定 session ID。
3. 补查 Codex 当前版本是否存在官方“完整替代配置根/排除 user+system sources”的稳定 CLI 合同；若仍无，Codex isolation 必须保持 `degraded|unknown`。
4. 验证 Claude `--setting-sources` 与 managed settings、`--strict-mcp-config`、`--safe-mode` 的组合边界；不要把其中任一项误报为全局独占。
5. 验证 OMP 在隔离 `PI_CODING_AGENT_DIR` 下的认证置备和从既有 Session resume 成本，再决定 MVP 用 overlay 还是独立 root。
6. 设计一次故意杀死 wrapper 的恢复演练：receipt 停留在 `prepared`/`launched` 时，下次运行必须保守归类而不是自动恢复/删除用户状态。

## Not Found

- 未找到三端共同、官方承诺的“独占所有配置来源”启动合同。
- 未找到任何三端之间可直接互换的 Session/transcript 格式或语义保证。
- 未找到三端共同的 machine-readable “最终有效配置 + 实际启用 Skills/MCP/system prompt”回执格式。
- 未找到三端对“同一 native Session 被多个本地进程并发 resume/写入”给出的统一安全保证。
- 未找到可以让“清空全局配置 → 启动 → 恢复”成为事务、可崩溃恢复且保留并发编辑的官方机制。
- 未找到本轮所读官方页面/仓库文件的可靠 publication/update timestamp；只能确认于 2026-08-22 访问到当前内容，故必须在实现和回执中 pin 实际 CLI 版本。
- 未找到支持用公开数值估算三案工时或维护成本的可信资料；因此本摘要只提供可重加权的结构性相对成本。
