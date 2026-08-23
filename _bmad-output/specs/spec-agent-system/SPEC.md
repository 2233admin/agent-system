---
id: SPEC-agent-system
companions:
  - 'glossary.md'
  - 'validation-contract.md'
  - '../../planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
sources:
  - '../../planning-artifacts/prds/prd-agent-system-2026-08-21/prd.md'
  - '../../planning-artifacts/prds/prd-agent-system-2026-08-21/addendum.md'
  - '../../planning-artifacts/research/technical-three-cli-assembly-architecture-2026-08-22/research.md'
---

> **Canonical contract.** 本 SPEC 与 `companions:` 中的文件共同构成构建、测试和验收 Agent System MVP 的完整、保全验证合同。`sources:` 仅用于追溯，不是下游必读输入。

# Agent System MVP 规格

## Why

OMP Agent 的低频配置建立、高频任务复用和 Bad Case 演进目前缺少一个可验证的防漂移闭环。目标是让负责人和后续 Session 能证明每次装配必要、充分且不过载，区分期望、结果、观察与 Unknown，同时不把动态任务、私域内容或旧实现形态固化为稳定配置。

## Capabilities

> **MVP 范围锚定。** 下列 CAP-1～CAP-8 描述完整目标态产品意图，均为客户端中立表述。当前排期以 [`epics.md`](../../planning-artifacts/epics.md) 权威定义：Epic 1（查看、选择并使用 OMP 配置，覆盖 MVP-FR1～MVP-FR10）是原始锁定 MVP，Epic 2（控制面发布与自更新）、Epic 3（配置供应与装配，OMP）已陆续排入后续排期；三者均服务 OMP 单客户端。Epic 4（装配并激活 Claude Code 客户端——2026-08-23 裁决激活，见 `sprint-change-proposal-2026-08-23-cap-claude-codex-adapter.md`；Codex 证据不足未同批，继续非目标）是第二客户端的独立能力域，不改变 Epic 1～3 的完成门槛。每个 CAP 下追加的 `**MVP:**` 行说明该能力当前在 OMP（Epic 1～3）与 Claude Code（Epic 4）各自的归属；未实施部分保留为已确认的未来能力描述，不因写在本文档中而自动获得当前实施授权，重开需要新证据与负责人明确裁决（epics.md AR13、AR15、AR16；Claude Code 的重开证据见 `epic-1-retro-2026-08-22.md` 的 `epic-1-retro-item-7`）。

- **CAP-1 — 有界触发、候选与推荐**
  - **intent:** Agent 能在新工作场景、已知能力不足或有证据的 Bad Case 出现时主动调查、抽象需求，提出可区分候选和明确推荐，由用户裁决。
  - **success:** 建立/修订前持久化 `new-scenario | known-insufficiency | bad-case` 触发类别及真实工作/证据引用，缺失时拒绝；随后给出默认 2~3、最多 4 个候选，每项包含来源、行为价值、适用工作、边界、关键差异、依据、风险与 Unknown。用户可拒绝、补充或纠偏，只有高风险、权限、不可逆或价值取舍升级；单纯发现、历史存在或技术可行性不得触发范围扩张。
  - **MVP:** 不在 MVP。配置建立/修订与触发类别持久化不是 MVP 用户能力（Story 以"已存在保存配置"为前置），候选生成与 Recommendation 也不进入 MVP——用户直接从已存在的配置修订中选择（epics.md AR15 覆盖来源 FR2 与 Architecture Spine AD-16；AR16、AR13）。

- **CAP-2 — 稳定配置与内容所有权**
  - **intent:** 用户能保存带有限变体的稳定配置，引用源资产和结构化任务输入入口而不复制原始内容。
  - **success:** Instructions、Skills、MCP 三类资产不要求齐全；配置显式记录适用工作、必要资产、不装配能力、有限变体、共同边界、来源和输入入口，变体只改变已声明差异并继承共同边界；任务内容、私域原文与凭据仍由原始载体拥有，公共产物不复制它们。
  - **MVP:** 部分在 MVP，窄化为只读消费。MVP 只查看已存在配置修订的组成、来源类别、边界与 Unknown（MVP-FR1、MVP-FR2）；配置的建立、修订、变体裁剪与来源登记不是 MVP 用户能力（epics.md AR16：配置供应不是本轮能力；AR13：配置创建/编辑不进 MVP）。**Epic 4：** Claude Code adapter 复用同一内容所有权模型——只读引用 Instructions/Skills/MCP、不复制原文；同样不含建立/修订工作流，该部分需要独立证据与裁决才能开（类比 Epic 3 之于 OMP），不因 Epic 4 顺带打开。

- **CAP-3 — 装配事实、差异与解释**
  - **intent:** 用户能分别看到期望装配、最终结果、运行观察、差异与 Unknown，并理解重复激活为何相同或变化。
  - **success:** 系统分别表达期望装配、Adapter Plan、Launch Receipt、运行观察、差异与 Unknown；能力状态使用 `supported | degraded | unsupported | unknown`，运行装配使用 `observationStage = planned | launched | observed | verified`，三层验证另用 `validationMethod`；隔离对每个版本化 SourceId 列出 excluded/residual/unknown；缺失、额外、禁用、覆盖、预算或限制裁剪及其影响可见。
  - **MVP:** 在 MVP，窄化为配置应用与 OMP 启动生命周期。期望装配/最终结果/运行观察/差异/Unknown 的区分保留，用于 MVP-FR6 状态视图；运行观察范围限定为配置应用与客户端启动阶段，不含任务目标、对话、工具调用、任务进度或结果（epics.md MVP-FR6、AR7、NFR8）。**Epic 4：** Claude Code adapter 复用同一 `capabilityStatus`/`observationStage`/Known-Unknown 分层（Architecture Spine AD-19）；`supported` 只接受宿主原生可强制执行的权限/工具/MCP 证据，prompt 文字承诺不算证据。目标为已在运行的交互式会话（如本仓自身的 Claude Code session）时，`observationStage` 在用户实际重启前不越过 `planned`（AD-20）。

- **CAP-4 — 低摩擦可信复用**
  - **intent:** 用户能复用已验证配置，并在声明输入或外部事实发生实质变化时重新判断。
  - **success:** 普通复用逐项能力选择为 0、重复输入为 0、产品确认至多 1 次；prepare 持久化 ChangeAssessment，逐项比较目标、约束、权限、风险和必需能力，只能允许继续原修订或要求低频重判；必需 Unknown 时 fail closed。客户端 capability 与隔离残留在启动前可见；配置切换创建新 operation，并通过客户端重启或显式 resume 生效。
  - **MVP:** 部分在 MVP，窄化为单次确认。"逐项能力选择为 0、产品确认至多一次"保留（MVP-FR4、NFR7）；ChangeAssessment 式逐项比较目标/约束/权限/风险的重判流程不在 MVP——该比较隐含任务语义判断，与 epics.md AR7/NFR8 的"不执行任务语义判断、不观察任务运行态"裁决不兼容。MVP 内每次配置选择都作为新的启动计划处理，不做跨激活的声明输入重判（MVP-FR4、MVP-FR7）。**Epic 4：** Claude Code adapter 的 fresh target（本产品新 spawn 一个 Claude Code 进程）复用同一单次确认状态机（AD-7/AD-18，经 AD-20）；already-running session target（目标是已在运行的交互式会话）的 `apply` 只解析为 `requires-restart`，不完成激活、不冒充成功。同 OMP 一样不做 ChangeAssessment 式重判，也不做 CAP-1 的候选/推荐——用户直接选择既有装配。

- **CAP-5 — 三层适用性验证**
  - **intent:** 负责人能按静态/机械、受控集成、真实任务三层证据判断配置是否必要、充分且不过载。
  - **success:** 只有三层直接证据作用域一致、必要/充分/不过载均通过且无阻断性 Unknown 时才宣布 `Verified`；无关上下文和任务期装配干预均被记录。
  - **MVP:** 不是 MVP 产品运行功能。三层独立取证与 `Verified` 派生保留为**外部开发验收门**，用于团队判断本轮 MVP 交付是否达标，不在 Story 1.1/1.2 的验收范围内、不向终端用户暴露（epics.md AR15 对来源 FR11 与 Architecture Spine AD-11 的裁决）。

- **CAP-6 — 基线与可比样本**
  - **intent:** 负责人能用固定任务、基线和跨 Session 可比样本判断稳定配置是否改善真实任务。
  - **success:** T-1、T-2、T-3（无合适 T-3 时记录理由后用 T-4）每项至少有 1 个当前基线样本和 2 个稳定配置样本，其中至少 1 个来自 fresh 或明确不同的原生 Session；样本只按 `validation-contract.md` 的配置无关可比键分组，配置/manifest 与 Session 关系作为被比较自变量或分层字段展示，不可比组禁止汇总。达到最小样本门时追加绑定配置修订、样本组与证据的不可变 ValidationDecision。
  - **MVP:** 不是 MVP 产品运行功能，处理方式同 CAP-5。`validation-contract.md` 的 T-1～T-5 样本合同用于团队验收本轮 MVP 开发产出，不是提供给终端用户的产品能力（epics.md AR15 对 Architecture Spine AD-17 的裁决）。

- **CAP-7 — Bad Case 有界演进**
  - **intent:** Agent 能用 Bad Case 证据推动配置演进，而不恢复悬置概念或增加任务特判。
  - **success:** Bad Case 引用失败或差异证据、适用边界和拟议变化；只有明确裁决才创建新配置修订或规则；旧决定及替代链保留，默认扩张清单不被个案自动激活。
  - **MVP:** 不在 MVP。样本/Bad Case 产品化、有界演进裁决与新配置修订/规则创建均不进入 MVP（epics.md AR13）。

- **CAP-8 — 跨 Session 追溯**
  - **intent:** 后续 Session 能追溯配置、激活、判断、证据、Unknown 与决定替代链，而不继承旧授权或动态任务状态。
  - **success:** 持久记录以稳定 ID 关联配置修订、ChangeAssessment、launch-scoped operation、装配计划、启动回执、判断、证据、ValidationDecision、Unknown、opaque native Session locator 与替代链；客户端继续拥有凭据、transcript 和原生 Session 内容；新 Session 不继承旧确认、授权或任务内容。
  - **MVP:** 部分在 MVP，窄化。仅保留"配置修订可跨 CLI Session 回读"（来源 FR14 收敛，epics.md AR14）；ChangeAssessment、ValidationDecision、opaque native Session locator 的产品持久化与 Session lease/fencing 均不在 MVP——resume 完全由 OMP 原生能力负责，Agent System 不保存 locator、不管理 lease/fencing（epics.md MVP-FR5、AR9；覆盖 Architecture Spine AD-7/AD-13/AD-19 对应条款）。

## Constraints

- Clean-slate：MVP 只实现并验收 OMP；现有 Python CAP 仅作 Bad Case 证据，不是需求、架构或迁移基线。客户端中立的 manifest、receipt、opaque Session locator 与 adapter port 是架构边界，不等于当前支持 Claude Code/Codex CLI。
- 产品核心是外部 TypeScript/Bun CLI；OMP 薄扩展只转发低频请求和运行观察，不拥有产品状态或配置决定。不得引入 daemon、服务、shell 产品脚本或未触发的第二客户端实现。
- 不得清空、替换或“备份后恢复”真实用户全局配置。每次调用使用隔离 root/profile、显式一次性覆盖或 invocation-local 文件；无法排除的来源必须以 residual/unknown 可见，必要隔离无法证明时 fail closed。
- 客户端拥有凭据、transcript、缓存和原生 Session；产品只保存 opaque locator、版本、去密的 manifest/plan/receipt、差异与证据，不翻译或复制 Session 内容。
- 稳定配置只引用 Instructions、Skills、MCP 与结构化任务输入入口；不得持久化或公开复制动态任务内容、私域原文、凭据、生成文件原文或工具 payload。实际 secret 只存在于调用作用域的 `RuntimeLaunchSpec`，数据库、投影、receipt、bridge envelope 与诊断均使用 allowlist。
- 期望装配、adapter plan、启动结果、运行观察、差异与 Unknown 不得折叠；“参数已传入”或进程退出码为零不得冒充配置 `verified`。
- 机械检查优先，但代理信号不得替代受控集成或真实任务证据；证据不足必须保持 Unknown。
- 普通复用不得要求逐项能力选择或重复任务输入，且产品确认至多一次。
- 外部状态、客户端身份/版本、capability snapshot、隔离残留和声明输入变化必须可见；样本按任务、验收、输入可比规则、配置无关客户端环境和外部变化分组：可重复任务要求等价输入，一次性任务只要求相同输入分类/结构及验收映射。实际输入、配置/manifest/capability/receipt/Session 关系作为被比较自变量或分层字段，不要求相等但不得隐藏。
- 实现、数据所有权、激活状态机、失败边界、技术栈和验证作用域必须遵守 adopted `ARCHITECTURE-SPINE.md` 的 AD-1~AD-20；其中 AD-7、AD-11、AD-13、AD-16、AD-17 与 AD-19 的部分条款按下条 MVP 范围收窄执行；AD-20（Claude Code adapter 会话模型）是 Epic 4 的专属条款，见下条。
- **MVP 范围收窄（权威见 [`epics.md`](../../planning-artifacts/epics.md)）：** OMP 侧当前只落地 Epic 1（MVP-FR1～MVP-FR10）；Epic 2、Epic 3 已陆续排入排期。CAP-1 的候选/推荐、CAP-2 的配置建立/修订、CAP-4 的 ChangeAssessment 式声明输入重判、CAP-7 的 Bad Case 产品化、CAP-8 中 opaque native Session locator 的持久化与 Session lease/fencing 均不在 MVP；CAP-5、CAP-6 的三层验证与样本合同是外部开发验收门，不是 MVP 产品运行时功能。以上收窄由 epics.md AR13、AR15、AR16 确认；重开需要新证据与负责人明确裁决，不因本 SPEC 保留完整目标态描述而自动恢复实施授权。**Claude Code（Epic 4，2026-08-23 裁决激活）同样受上述收窄约束**：候选/推荐（CAP-1）、建立/修订（CAP-2）、ChangeAssessment（CAP-4）、Bad Case 产品化（CAP-7）、locator/lease 持久化（CAP-8）对 Claude Code 同样不在 MVP，与 OMP 侧收窄口径一致，不因新增第二客户端而单独放开。

## Non-goals

- Claude Code adapter 已按 2026-08-23 裁决激活（Epic 4，见 AD-1、AD-19、AD-20）；**Codex CLI 继续不在 MVP**（`.cap/runtime/` 无 `codex.toml`，无真实 Bad Case 证据支持同批激活）。无论 Claude Code 还是未来的 Codex，均不构建跨客户端配置等价层、Session 翻译、三端同步首发或通用 plugin/hook 语义；每个客户端 adapter 只实现同一窄端口（AD-19），不追求彼此等价。
- 不在 MVP 生成配置候选、评分、排序或 Recommendation，不由 Agent 选择配置或推荐装配；不提供配置创建、编辑或 Context Assembly；不分析或观察任务目标、过程、对话或结果；不持久化 opaque native Session locator，不实现 explicit resume 启动参数或 Session lease/fencing；不把样本/Bad Case 产品化、三层任务验证或跨 Session 任务证据作为 MVP 产品运行时功能（epics.md AR13、AR15、AR16 负责人裁决）。
- 不构建远程同步、团队共享服务、产品遥测、daemon、Python CAP 迁移兼容层，或以清空用户全局配置实现隔离。
- 不把 Profile 语义、Hard Handoff、每任务实时 Skill Discovery、动态子 Agent 装配或第四类核心资产作为默认修复。
- 不把开放式 Agent 平台、自动任务派发、权限提升、客户端沙箱或跨客户端同构配置编译器纳入 MVP。
- 不建设业务知识、Memory/RAG、任务资产平台、核心资产分类扩张、taxonomy/Canonical IR、公共配置共享、团队治理与商业化 Catalog，或把具体方法包升级为系统本体。
- 不用维护活动量、能力数量增长、人为减少 Unknown 或接入客户端数量作为产品成功。

## Success signal

以下成功信号是本轮 MVP 开发的**外部验收门**，用于团队判断交付是否达标，不是 MVP 产品对终端用户暴露的运行时功能（epics.md AR15）：在 `validation-contract.md` 规定的首轮任务上，稳定配置完成每任务 1 个基线和 2 个可比稳定样本，至少 1 个稳定样本来自 fresh 或明确不同的原生 Session；接受候选的 manifest/plan/receipt/差异可关联率和宣布 `Verified` 的三层证据完备率均为 100%，普通复用不再需要逐项选择或重复输入，且产品确认不超过一次。目标 OMP 版本必须完成 `fresh → 取得 opaque locator → explicit resume` smoke，SourceId 残留和 Unknown 可见，secret/私域内容不进入持久工件；达到最小样本门后必须持久化接受、调整、停止，或针对一个具名 Unknown 追加一次采样的 ValidationDecision。

## Assumptions

- 首要用户画像沿用 PRD 当前描述，待首批真实任务样本复核；该假设不授权扩张能力。

## Open Questions

- 完成最小样本后，SM-1 首次正式验收通过率、SM-2 任务期装配干预率和 SM-3 无关内容/能力出现率的量化接受门槛分别是多少？
