# Epic 3 Context: 配置供应与装配

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

`configs` 作为独立分发的二进制，脱离 `agent-system` 仓库本身完全没有配置数据供应路径——唯一能把数据灌进其 SQLite 存储的方式是仓库内部硬编码读取 `.cap/` 目录的开发者脚本。本 Epic 补上这个真实缺口：让用户可以选择数据源（GitHub 仓库或本地目录）导入原始资产，由 Agent 辅助完成调查、候选生成与推荐，用户裁决后建立或修订一条可持久化的稳定配置修订，从而让 Epic 1 的"查看/选择/使用"有真实数据可读。这条能力域此前被裁定不进入 MVP（配置创建/编辑、候选生成、Recommendation 均排除在外），本次是负责人在实际使用已交付产品后重新表态、正式排入排期。装配（Agent 辅助的候选生成与建立/修订）与使用（人工查看、选择、启动 OMP，即 Epic 1 范围）是两个不同的能力面，不合并、不互相替代。具体数据源接入协议、候选生成的交互设计仍是后续架构/UX 阶段的开放问题，未在本 Epic 层面拍板。

## Stories

- Story 3.1：建立新配置修订（configs establish）
- Story 3.2：修订现有配置（configs revise）
- Story 3.3：查看装配来源与替代链

## Requirements & Constraints

- 建立或修订配置修订前必须先校验并持久化触发类别（新场景 / 已知能力不足 / Bad Case）及真实工作或证据引用；缺失即零写入拒绝，校验必须早于读取候选内容，避免非交互调用卡在等待输入上。
- 候选内容每个字段值须按声明类型校验，类型不符整体拒绝、零写入，不静默接受。
- 命令非交互优先：未提供候选来源（无 `--from` 且 stdin 非管道）时立即类型化失败，不阻塞等待交互输入。
- 配置修订不可变：只追加新修订并通过 `supersedes` 引用旧修订，不覆写历史；写路径只暴露 insert-only 建立接口，不提供 update/delete。
- 持久化内容受统一内容所有权与隐私边界约束：只存类型化引用、来源标识、可公开摘要、内容指纹与新鲜度证据；私域原文、凭据、动态任务内容、客户端 transcript 禁止持久化；写入 schema 用显式 allowlist 拒绝未知字段。
- Agent 辅助候选生成默认给出 2～3、最多 4 个可区分候选，各记录来源、行为价值、适用工作、边界、关键差异、依据、风险与 Unknown；用户可拒绝/补充/纠偏，只有高风险、权限、不可逆或价值取舍才升级；候选空间覆盖实质差异后即停止扩展。
- 数据源导入设计不得滑向已排除的非目标——不得演变为团队治理或"从任意公开仓库拉取他人共享配置"式公共共享/发现语义。
- 数据源接入协议（GitHub 仓库/本地目录格式与来源可信边界）及候选生成如何落地为 CLI 交互仍是未拍板的开放架构/UX 问题，不应在实现层面自行发明映射规则。

## Technical Decisions

- 控制面/adapter 职责分离：应用层是唯一产品状态变更入口；CLI 负责选择与确认；adapter 只做 probe/plan/launch/interpret，不得直接改写 SQLite 或自行做产品决定。
- 期望状态采用不可变修订：每次变更创建新 `StableConfigRevision`，旧修订不可更新；替代关系经 `supersedes` 追加表达，不丢失因果链。
- 内容所有权与隐私边界：持久记录只存类型化引用、来源标识、可公开摘要与内容指纹；外部来源/MCP 的 configured/installed/connectable 状态不得自动推导安全性或可信度。
- Story 3.1 已落地、供 3.2/3.3 复用的先例：`ConfigRevisionRepository` 新增 insert-only 写端口 `create()`；迁移 `0003_supply.sql` 已加好 `trigger_category`/`evidence_ref`（NOT NULL）与 `supersedes_revision_id` 列及两个唯一索引；`StableConfigRevision` 新增 `sourceRef`/`contentFingerprint`（`Fact<T>` 形状同既有字段）；失败均抛类型化 `Error`，CLI `instanceof` 捕获后复用既有 `renderDetail`/`renderQueryFailure` 渲染；用户可见文案需同时补齐中英 i18n key。
- `supersedes` 冲突转译与"替代自："展示行被 3.1 有意留空，分别是 3.2、3.3 的实现范围，两者复用 3.1 已建好的 schema，无需新增迁移列。

## Cross-Story Dependencies

- 3.2、3.3 直接依赖 3.1 建立的 schema（trigger/evidence/supersedes 列与唯一索引）和写端口/CLI 渲染约定；3.1 未处理的 `supersedes` 冲突转译与"替代自"展示留给二者补齐。
- Epic 3 是 Epic 1（查看、选择并使用 OMP 配置）的数据供应前提：Epic 3 写入配置修订，Epic 1 保持唯一的查看/选择/启动消费面，两者不合并。
- 真实数据源抓取（GitHub 仓库/本地目录导入、来源可信边界校验）尚无架构决定；3.1 只覆盖"候选 JSON 已产出之后"的持久化写路径，不含抓取本身，后续 Story 需等该架构问题先行裁决。
