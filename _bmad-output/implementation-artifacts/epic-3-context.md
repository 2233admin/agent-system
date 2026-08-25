# Epic 3 Context: 配置供应与装配

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

`configs` 作为独立分发的二进制，长期没有把配置数据灌进自己 SQLite 存储的产品路径——唯一入口曾是仓库内部硬编码读取 `.cap/` 的开发者脚本（已随 Epic 4 一并退役）。本 Epic 补上这个缺口，让"装配"（写入配置修订）成为与"使用"（Epic 1 的看／选／用）并列但不合并的第二个能力面。其中**写路径半边已交付**：Story 3.1／3.2／3.3 分别落地了建立新修订、追加替代修订、展示装配来源与替代链。**尚未交付的是供应半边**：把用户选定的数据源（一批磁盘上的资产目录、本地目录或 GitHub 仓库）变成一条 `sourceRef` 真实可解析的配置修订。这一半目前仍靠人工手写含全部条目的候选 JSON、且 `sourceRef` 写成每台机器各不相同的绝对路径，因此既不可移植也无法规模化。该缺口是本仓 Skill 资产退役 git 跟踪的严格前置（先落地替代、再 parity 验证、最后退役），并已被架构面正式约束（见下）。供应半边尚未拆成 Story，本文件的 Stories 一节只列 epics.md 已定义的三条。

## Stories

- Story 3.1：建立新配置修订（configs establish）— done
- Story 3.2：修订现有配置（configs revise）— done
- Story 3.3：查看装配来源与替代链 — done

## Requirements & Constraints

- 建立／修订前必须先校验并持久化触发类别（新场景／已知能力不足／Bad Case）及真实工作或证据引用；缺失即零写入拒绝，且校验必须早于读取候选内容，避免非交互调用卡在等待输入上。
- 候选内容逐字段按声明类型校验，类型不符整体拒绝、零写入，不静默接受；命令非交互优先，未提供候选来源时立即类型化失败而不阻塞等待。
- 配置修订不可变：只追加新修订并以 `supersedes` 引用旧修订，写路径只暴露 insert-only 接口，不提供 update/delete。
- 持久化内容受统一的内容所有权与隐私边界约束：只存类型化引用、来源标识、可公开摘要、内容指纹与新鲜度证据；私域原文、凭据、任务内容与客户端 transcript 禁止入库，写入 schema 用显式 allowlist 拒绝未知字段。
- 供应能力的目标形态是：把一批磁盘上的资产目录变成一条 `sourceRef` 可解析的修订，并且本仓自身的装配意图也必须能被表达为一条真实修订——自我开发装配与产品装配是两个消费者、一条路径，不为前者另立机制。
- 装配与判定的单位是**组**而非单个 Skill（当前 12 个组／82 个 Skill）：组内成员互相路由调用，拆组会拆断调用；装配意图、来源归属与退役顺序全部按组表达。
- 组的来源三分是判据不是标签：`own`（自研）／`fork`（取自上游、承诺零本地改动）／`vendor`（取自上游已打补丁，须逐处登记）。`fork` 的零改动必须能用内容指纹对上游 ref 机械验证，指纹不符即须转 `vendor` 或把改动推回上游。
- 第三方组的字节属于上游可复现产物：仓库跟踪其 **pin**，不跟踪字节。一个 pin 必须同时具备可取得的来源与可校验的完整性，仅记版本号不成立。
- 数据源导入不得滑向已排除的非目标——不得演变为团队治理，或"从任意公开仓库拉取他人共享配置"式的公共共享／发现语义。
- 面向外部来源的通用接入协议（GitHub 仓库／本地目录格式与来源可信边界）仍未拍板，不得在实现层面自行发明映射规则；遇到当前无法解析的来源按 fail-closed 处理。

## Technical Decisions

- **唯一受认可的装配交付路径**是经 `configs use <revisionId> --client <clientId>` 启动、在调用作用域内物化。客户端原生项目目录发现（`.claude/skills/`、`.agents/skills/`）**不是装配面**：它不产生 manifest、不绑定 capability 状态、不产生 receipt，因此不能为任何能力声称 observation 阶段。未经 `configs` 启动的会话按定义不具备本产品装配的能力——这是已接受的结果，不是待修缺陷。
- **字节落点不得踩客户端原生发现路径**，否则"唯一装配路径"退化为无人执行的声明。本仓 canonical 落点定为 `_bmad/`（非任何客户端的发现路径，且与安装器自身的安装形状一致），安装器须配置为不产生 IDE 投影，`configs` 从 canonical 路径物化。规则在可控面内由机制强制，不靠自觉。
- **`sourceRef` 的跨机器可移植性语义必须一次裁定，并同时约束解析侧与供给侧**。这是本 Epic 剩余范围里风险最高的一处：既有物化实现把 `sourceRef` 当作可直接使用的绝对路径，而"字节每机复现"要求同一条修订在不同机器上仍能解析。绝对路径／仓库相对路径／符号引用三选一须依据真实证据裁定（canonical 落点是仓库相对路径，是一条强指示），但**禁止两侧各自发明**——不一致会让一方产出的修订在另一方手里按 fail-closed 静默全量降级为 `unsupported`，且没有任何门能指出根因。
- **控制面／adapter 职责分离**：应用层是唯一产品状态变更入口；CLI 负责选择与确认；adapter 只做 probe/plan/launch/interpret，不得直接改写 SQLite 或自行做产品决定。SQLite 是产品持久权威，JSON/Markdown 只是可重建的 allowlist 投影。
- **事实层级不可折叠**：能力状态固定为 `supported | degraded | unsupported | unknown`，不确定值一律用 Known(值, 证据引用)／Unknown(原因, 观察时间) 表达，不得用 null、缺行或 false 冒充未知；来源的 configured/installed/connectable 不得推导安全性、可信度或适用性。
- **装配权威唯一**：只有 `configs` 的修订是装配权威。`plugins/skill-imports.toml` 自称的"当前默认装配声明"没有任何产品代码消费，不是权威，其措辞待退役第 (3) 步统一收敛。
- **规则与能力必须同真**：仓库规则不得强制加载一个当前装配下拿不到的 Skill，"加载可用的 X"这类措辞不构成豁免。已知不一致：入口规则要求的 `orchestrated-collaboration` 与 `adaptive-problem-solving`（后者含硬门）只存在于 `plugins/`，对本仓会话结构性不可见，必须在落地步纳入本仓装配意图，否则该步不算完成。
- **Story 3.1 已落地、供后续复用的先例**：`ConfigRevisionRepository` 的 insert-only 写端口；迁移已具备 `trigger_category`／`evidence_ref`（NOT NULL）、`supersedes_revision_id` 及两个唯一索引；修订类型已含 `sourceRef`／`contentFingerprint`（与既有字段同为 Fact 形状）；失败一律抛类型化 Error 并由 CLI 捕获后复用既有渲染；用户可见文案需同时补齐中英 i18n key。

## Cross-Story Dependencies

- 3.2、3.3 依赖 3.1 建立的 schema（trigger／evidence／supersedes 列与唯一索引）与写端口／渲染约定，三者均已完成，无需新增迁移列。
- Epic 3 是 Epic 1 的数据供应前提：Epic 3 写入修订，Epic 1 保持唯一的查看／选择／启动消费面，两者不合并。
- 与 Epic 4 的接缝在 `sourceRef`：Epic 4 只交付"已解析内容 → 它自己 spawn 的 fresh 会话"这一段，上游"资产目录 → 可移植修订"归本 Epic。剩余供应工作与 Epic 4 的内容物化实现共用同一语义，须一次裁定。
- **本仓 Skill 资产退役严格三步、不得倒序**：(1) 落地替代——先修复本仓残缺的 canonical 安装（按 pin 重新写出本体到 `_bmad/`），再让 `configs` 具备供给能力并把本仓装配意图表达为一条真实修订；(2) parity 验证——经 `configs use` 启动的会话，其实际可用 Skill 集合与今天原生发现所得集合做**真实烟雾对照**（非清单比对），且必须在不存在用户级安装的环境中进行，否则结论假阳性；(3) 退役——原生发现目录改为非跟踪并进入忽略清单，双份字节一致门随之退役。第 (2) 步稳定前两份保持跟踪、一致门继续生效。
- 开放问题（不阻塞、落地步再判）：Codex 侧尚无等价 `configs` 启动入口，其 parity 验证暂时无法执行；是否允许两个客户端按各自节奏分别退役各自投影目录，留待落地时依真实能力判断。
