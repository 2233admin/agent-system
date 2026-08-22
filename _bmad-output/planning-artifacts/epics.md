---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-agent-system-2026-08-21/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md
---

# agent-system - Epic Breakdown

## Overview

本文将现有 Agent Context Assembly capability SPEC、术语、验证合同和 adopted Architecture Spine 收敛为首个可交付 MVP。负责人在 Story 细化期间确认，MVP 最核心且仅需产品化的用户能力只有两项：

1. 用户可以查看某个配置包含什么，并按需机械比较多个配置；
2. 用户可以亲自选择某个配置，然后用该配置启动 OMP。

MVP 只实现 OMP。Claude Code 与 Codex CLI 只保留未来 client adapter 合同边界。产品不分析任务目标/验收/约束/权限/风险，不观察任务内容或结果，不由 Agent 选择配置、生成候选或推荐装配。OMP Session 恢复使用 OMP 原生能力；Agent System 不拥有 native Session locator。

## Requirements Inventory

### Functional Requirements

MVP-FR1：用户可以从外部 Agent System CLI 查看所有已保存配置；每项显示名称、具体修订、默认/通用标记、简短边界和可用状态。没有配置时显示诚实空状态，不伪造默认配置。

MVP-FR2：用户可以查看某一配置声明的 Instructions、Skills、MCP、来源类别、边界、缺失项和 Unknown；产品不显示或持久化私域原文、凭据、prompt、transcript 或任务内容。

MVP-FR3：用户可以自行选择两个或更多配置进行机械并列比较；产品不生成候选、评分、排序、Recommendation、自动选择或静默 fallback。

MVP-FR4：用户可以亲自选择一个具体配置修订，并在一次简洁确认后用它 fresh 启动 OMP；配置选择本身和进入 OMP 后不得产生额外产品确认。

MVP-FR5：用户进入 OMP 后可以使用 OMP 原生 resume。Agent System 不拦截、不选择 Session、不保存 opaque locator、不管理 lease/fencing，也不观察恢复后的任务内容或结果。

MVP-FR6：用户可以从外部 CLI 查看所选配置、OMP client/version、启动阶段、配置应用结果以及已知差异/Unknown；该状态不包含任务目标、对话、工具调用、进度或结果。

MVP-FR7：用户可以选择另一个配置进行切换；切换必须创建新的启动计划并要求重启，不在原 OMP 进程内热改配置，也不自动 resume。

MVP-FR8：配置查看、准备、应用或 OMP 启动失败时，用户可以看到失败阶段、受影响配置项、已知原因、Unknown 和恢复动作；产品不得伪造成功、自动回退或修改用户全局 OMP 配置。

MVP-FR9：OMP 内的“当前配置/启动状态/切换入口”采用 native-first：钉住版本的 capability probe 证明 OMP 原生能力满足合同时直接复用；不存在或不足时才由薄扩展提供最小辅助面，两者不得形成不同事实源。

MVP-FR10：MVP adapter registry 只支持 OMP；Claude Code/Codex CLI 返回明确 unsupported，仅保留客户端中立的 manifest/plan/receipt 与 adapter port 边界，不提供占位实现、配置翻译或跨客户端 Session 恢复。

### NonFunctional Requirements

NFR1：所有配置可用、应用、启动、失败和差异结论必须绑定可回读证据；未知即 Unknown。

NFR2：配置声明、启动计划、配置应用结果和 OMP 生命周期状态必须可区分；不得通过命名把较弱证据提升为“已在任务中生效”。

NFR3：状态必须携带实际 OMP client/version 或等价环境证据；文档声明或移动分支不能替代钉住版本的 probe/smoke。

NFR4：SQLite、日志、投影、manifest/plan/receipt、bridge envelope 与 invocation 诊断不得包含私有原文、凭据、prompt、transcript、工具 payload 或任务内容。

NFR5：私域资产仍受原授权边界约束；产品不得通过复制、缓存、公共摘要或启动工件绕过授权。

NFR6：外部来源或 MCP 的 configured/installed/connectable 状态不得自动推导安全、可信、适用或已在任务中使用。

NFR7：日常路径保持“查看/选择配置 → 一次确认 → 使用 OMP”；不得要求用户管理单项资产、填写内部 trigger enum 或处理任务分析。

NFR8：只做配置和启动控制面的机械判断；产品不执行任务语义判断、任务观察、任务结果验证或装配推荐。

NFR9：用户拥有配置选择权；Agent、默认标记、显示顺序和历史使用均不得替代用户选择。

### Additional Requirements

- AR1：采用外部 TypeScript/Bun CLI 与六边形模块化单体；领域状态变更只经应用命令，OMP adapter/薄扩展不得自行做产品决定或直接写 SQLite。
- AR2：MVP 只实现 OMP。Claude Code/Codex CLI 仅保留未来 adapter port 和版本化 DTO/schema 边界，不实现配置等价、Session 翻译或兼容 shim。
- AR3：SQLite 保存配置修订、用户选择和启动 operation 的持久事实；JSON/Markdown 仅为 allowlist 可重建投影。OMP transcript、凭据、缓存和原生 Session 始终由 OMP 拥有。
- AR4：配置修订不可变；查看、比较和启动始终绑定具体修订。历史修订不得因新状态被原位改写。
- AR5：一次启动确认绑定当前 operation、具体配置和当前计划；计划或配置变化后旧确认失效。SQLite 提交不伪装覆盖文件生成和进程启动，副作用必须可协调且不得重复启动。
- AR6：真实 OMP 配置只生成在受限 invocation 边界；直接 argv spawn，显式管理 cwd/env/stdio/exit/signal，不经 shell，不清空、改写或恢复用户全局配置。
- AR7：启动状态只覆盖 Agent System 配置选择、计划、应用和 OMP 进程生命周期；不得读取、归类、记录或解释任务运行态。prompt/任务参数只可不透明、invocation-scoped 透传给 OMP。
- AR8：必需配置引用不可达、schema/client 版本不兼容、权限或工件完整性失败时 fail closed；仅 optional 项失败可明确 degraded，并列出差异和 Unknown。
- AR9：OMP native resume 完全由用户在已启动 OMP 内操作。MVP 不保存 opaque locator，不实现 explicit resume 启动参数、native Session lease/fencing 或自动恢复；这些只保留未来 adapter 扩展空间。
- AR10：配置切换返回“需要重启”，以新配置创建新启动计划并再次进行该计划唯一一次确认。Agent System 不热改当前进程、不自动 resume。
- AR11：OMP 辅助面 native-first。实现前必须对钉住 OMP artifact 做 capability probe；原生能力满足当前配置/启动状态查看合同时复用，缺失或不足时才建设同语言薄扩展。
- AR12：薄扩展若需要，只消费版本化 launch context、显示当前配置/启动状态并转发切换入口；不得观察 prompt、消息、工具调用、任务进度/结果，不拥有配置或启动事实。
- AR13：配置创建、编辑、Context Assembly、Agent 候选/推荐、任务期 Context Loading、任务适用性判断、任务观察、样本/Bad Case 产品化、三层任务验证和跨 Session 任务证据均不进入 MVP。
- AR14：来源 SPEC FR1～FR4 在 MVP 中收敛为已保存配置的查看、用户选择和机械比较；来源 FR5～FR8 收敛为配置应用与 OMP 启动控制状态；来源 FR9～FR13 的任务感知/运行观察能力延后；FR14 只保留配置修订可跨 CLI Session 回读，不承担任务交接。
- AR15：本轮负责人裁决覆盖来源 SPEC FR2 与 Architecture Spine AD-16 的 Agent 候选生成/Recommendation，覆盖 AD-7/AD-13/AD-19 的 MVP explicit resume、opaque locator 与 Session lease/fencing，并把 AD-11/AD-17 的真实任务证据约束保留为外部开发验收门而非产品运行功能。
- AR16：配置供应不是本轮第三项用户能力。Story 以“存在已保存配置”为正常前置；无配置必须显示诚实空状态。不得通过伪造默认配置掩盖未提供配置数据。
- AR17：验证必须覆盖 schema/type contract、配置查询/比较、SQLite 仓储、隐私 allowlist、OMP adapter、确认幂等、失败协调和目标 OMP smoke；覆盖非 ASCII/空格路径、既有全局配置、未知 capability、bridge 不可用和 OMP 启动失败。

### UX Design Requirements

本轮按负责人要求跳过独立 UX 阶段，且未发现独立 UX 设计合同。用户可见交互合同已直接写入两条 Story：Story 1.1 覆盖候选比较和当前配置辅助面；Story 1.2 覆盖一次确认、启动/原生恢复边界、状态、配置切换和失败反馈。

### FR Coverage Map

MVP-FR1：Epic 1 / Story 1.1 — 查看保存配置列表与诚实空状态。
MVP-FR2：Epic 1 / Story 1.1 — 查看配置组成、来源、边界和 Unknown。
MVP-FR3：Epic 1 / Story 1.1 — 用户选定配置间的机械候选比较。
MVP-FR4：Epic 1 / Story 1.2 — 用户选择配置、一次确认并 fresh 启动 OMP。
MVP-FR5：Epic 1 / Story 1.2 — resume 委托 OMP 原生能力。
MVP-FR6：Epic 1 / Story 1.2 — 查看配置应用与 OMP 启动状态。
MVP-FR7：Epic 1 / Story 1.2 — 配置切换创建新计划并重启。
MVP-FR8：Epic 1 / Story 1.2 — 类型化失败反馈和恢复入口。
MVP-FR9：Epic 1 / Story 1.1、1.2 — OMP 内辅助能力 native-first。
MVP-FR10：Epic 1 / Story 1.2 — OMP-only 与未来 adapter 边界。

## Epic List

### Epic 1：查看、选择并使用 OMP 配置

用户可以看清一个配置包含什么，必要时并列比较多个配置，然后亲自选择一个具体修订，经一次确认 fresh 启动 OMP；进入 OMP 后使用原生 resume，并只查看配置应用与客户端启动状态。

**覆盖 FR：** MVP-FR1～MVP-FR10

**实现与交互约束：** 外部 CLI 是唯一主入口；OMP 内能力 native-first，缺口才由薄扩展补齐。产品不创建/编辑配置、不生成候选/推荐、不分析或观察任务。SQLite、versioned manifest/plan/receipt、invocation 隔离和失败协调只服务两项核心能力，不扩成额外用户流程。

## Epic 1：查看、选择并使用 OMP 配置

用户可以看清一个配置包含什么，必要时并列比较多个配置，然后亲自选择一个具体修订，经一次确认 fresh 启动 OMP；进入 OMP 后使用原生 resume，并只查看配置应用与客户端启动状态。

### Story 1.1：查看与比较配置内容

作为长期使用 OMP 的个人实践者，
我希望查看任一保存配置包含的 Instructions、Skills 和 MCP，并按需比较多个配置，
以便我在选择前知道会使用什么，而不依赖 Agent 推荐或隐含默认。

**实现需求：** MVP-FR1、MVP-FR2、MVP-FR3

**Acceptance Criteria:**

**Given** 存在一个或多个保存的配置修订
**When** 用户在外部 CLI 打开配置列表
**Then** CLI 显示每个配置的名称、修订标识、默认/通用标记、简短适用边界和可用状态
**And** 不自动选择、排序为推荐或隐藏不可用配置；不可确认状态显示为 `Unknown`。

**Given** 当前没有保存配置
**When** 用户打开配置列表
**Then** CLI 显示诚实空状态和配置供应边界
**And** 不伪造默认配置、不自动恢复历史配置，也不把空状态冒充产品故障。

**Given** 用户打开某个配置
**When** CLI 显示配置详情
**Then** 分组列出 Instructions、Skills、MCP 的类型化引用、来源类别、允许公开的摘要、配置边界和当前可证明状态
**And** 明确显示未配置项、不可达项和 `Unknown`，不得以文件存在或已安装推导已生效。

**Given** 配置引用个人私域资产
**When** 用户查看详情或导出可读视图
**Then** 授权环境内可看到类型化引用和受控状态，公共/可导出视图仍能自足说明配置含义
**And** 不显示或持久化私有原文、凭据、prompt、transcript、工具 payload 或个人当前上下文。

**Given** 用户选择两个或更多配置进行比较
**When** CLI 展示候选比较
**Then** 按同一字段并列显示组成、来源、边界、缺失项、差异和 `Unknown`
**And** 比较只基于机械事实，不生成评分、排序、Recommendation、自动候选或默认选择。

**Given** 用户只查看一个配置
**When** CLI 打开详情
**Then** 提供完整检查视图，不要求先建立 CandidateSet
**And** 不为满足候选数量而复制配置、生成变体或引入历史配置。


**Given** 配置不存在、版本不受支持、引用不可达或详情解析失败
**When** 外部 CLI 请求显示
**Then** 显示配置标识、类型化失败原因和可执行恢复入口
**And** 不静默回退到默认配置、不修改配置、不影响其他配置的查看。

### Story 1.2：选择配置并使用 OMP

作为长期使用 OMP 的个人实践者，
我希望亲自选择一个保存配置并启动 OMP，之后能看见当前配置、切换配置和理解失败，
以便日常使用只需“选配置 → 确认一次 → 使用 OMP”。

**实现需求：** MVP-FR4、MVP-FR5、MVP-FR6、MVP-FR7、MVP-FR8、MVP-FR9、MVP-FR10

**Acceptance Criteria:**

**Given** 用户在外部 CLI 看到保存配置列表
**When** 用户选择一个具体配置修订
**Then** 系统绑定该修订并准备 fresh 启动 OMP
**And** 不由 Agent 自动选择、推荐或静默回退到默认配置。

**Given** 所选配置可以转换为当前 OMP 版本支持的启动配置
**When** CLI 展示启动确认
**Then** 简洁显示配置名称/修订、将启用的 Instructions/Skills/MCP、OMP 版本、已知缺失或差异，并提供按需展开详情
**And** 用户只确认一次；配置选择本身和进入 OMP 后都不再重复确认。

**Given** 用户确认当前启动计划
**When** Agent System 启动 OMP
**Then** 在独立 invocation 边界生成所需配置并直接启动 OMP 进程
**And** 不清空、改写或恢复用户全局 OMP 配置，不安装/升级依赖，不经 shell 启动。

**Given** 用户向 OMP 传入 prompt、任务参数或动态上下文
**When** CLI 启动 OMP
**Then** 这些内容只作为不透明 invocation-scoped 输入透传给 OMP
**And** Agent System 不解析、不分类、不持久化、不记录日志，也不观察任务执行或结果。

**Given** OMP 已由 Agent System 启动
**When** 用户查看状态
**Then** 外部 CLI 显示所选配置修订、OMP client/version、启动阶段、配置应用结果以及已知差异/`Unknown`
**And** 状态不包含任务目标、对话、工具调用、任务进度、任务结果或装配推荐。

**Given** capability probe 证明 OMP 原生界面已满足当前配置和启动状态查看合同
**When** 用户在 OMP 内查看
**Then** 产品复用原生能力且不安装重复辅助命令
**And** 若原生能力不存在或不足，薄 OMP 扩展才提供最小当前配置、启动状态和外部 CLI 入口；两种路径不得同时形成不同事实源。

**Given** 用户进入 OMP 后需要恢复旧会话
**When** 用户调用 OMP 原生 resume
**Then** Agent System 不拦截、不选择 Session、不保存 opaque locator，也不观察恢复后的任务内容
**And** resume 的成功或失败由 OMP 原生界面负责；Agent System 只继续声明本进程由哪个配置修订启动，不把原生 resume 失败改写为配置应用失败。

**Given** 用户希望切换到另一个配置
**When** 用户在外部 CLI 或必要的薄 OMP 辅助入口选择新配置
**Then** 当前进程显示“需要重启”，新配置创建新的启动计划并要求一次确认
**And** Agent System 不在原进程内热改配置、不自动 resume；新 OMP 启动后用户可自行调用原生 resume。

**Given** 配置引用不可达、schema/OMP 版本不兼容、required 项无法应用、生成工件失败或 OMP 未成功启动
**When** 启动流程失败
**Then** 外部 CLI 与可用的 OMP 辅助面显示失败发生阶段、受影响配置项、已知原因、`Unknown` 和恢复动作
**And** 不伪造成功、不产生部分配置状态、不自动回退、不修改全局配置；仅 optional 项失败时才可明确标为 degraded。

**Given** 用户拒绝确认，或确认后配置修订/启动计划发生变化
**When** 系统尝试启动
**Then** 拒绝使用旧确认；拒绝时不启动，计划变化时重新展示一次新确认
**And** 确认不能跨配置、跨启动计划或跨 OMP 进程复用。

**Given** 用户选择 Claude Code 或 Codex CLI
**When** MVP 解析客户端
**Then** 明确返回当前不支持，并指出未来 adapter 边界
**And** 不提供占位实现、配置翻译、兼容 shim 或跨客户端 Session 恢复。
