# Sprint Change Proposal — 2026-08-22

## 触发与背景

`_bmad-output/planning-artifacts/epics.md` 已完成 Step 1～4 全部验证（frontmatter `stepsCompleted` 记录齐全），负责人在 Story 细化期间把 MVP 范围锁定为 1 个 Epic（查看、选择并使用 OMP 配置）与 2 条 Story（1.1 查看与比较配置内容、1.2 选择配置并使用 OMP），并在 `AR13`～`AR17` 显式记录了这一锁定与来源 SPEC/Architecture Spine 的偏差。SPEC (`_bmad-output/specs/spec-agent-system/SPEC.md`) 与 Architecture Spine (`_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md`) 尚未回写这一锁定，仍以完整目标态描述能力与架构规则，未标注哪些部分不在当前 MVP 范围。这会让读者误以为 SPEC/Architecture 的全部 CAP/AD 都要在本轮 MVP 中实现，与 epics.md 冲突。

本轮 Correct Course 的触发不是实现期发现的技术限制或需求误解，而是**已确认的战略性范围收窄**（负责人在 Story 细化期间裁决）尚未回写上游合同文档。

## Section 1：Issue Summary

- 问题：SPEC.md 的 Capabilities（CAP-1～CAP-8）与 Architecture Spine 的 AD-1～AD-19 描述的是完整目标态产品/架构，而 epics.md 已把当前 MVP 收窄为 1 Epic / 2 Story，并显式列出多项不在本轮范围的能力（配置候选/推荐、配置创建/修订、Bad Case 产品化、opaque Session locator 持久化、Session lease/fencing、三层验证作为产品运行时功能）。
- 证据：epics.md 正文（Overview、AR13～AR17、FR Coverage Map、Story 1.1/1.2 Acceptance Criteria）与 SPEC.md/ARCHITECTURE-SPINE.md 现有正文的直接文本对照（见下方 Section 2）。

## Section 2：Impact Analysis（Artifact Conflict）

### SPEC.md — Capabilities 与 epics.md 的冲突

| Capability | 冲突点 | epics.md 依据 |
| --- | --- | --- |
| CAP-1 有界触发、候选与推荐 | SPEC 要求 Agent 主动调查、抽象需求并给出候选与 Recommendation；epics.md 明确 MVP 不生成候选/评分/排序/Recommendation/自动选择，用户直接选择已存在配置 | AR15（覆盖来源 FR2 与 AD-16）、AR13（配置创建/修订不进 MVP）、AR16 |
| CAP-2 稳定配置与内容所有权 | SPEC 描述用户"能保存"配置（建立/修订能力）；epics.md 中配置供应不是 MVP 能力，Story 以"已存在保存配置"为前置 | AR16 |
| CAP-4 低摩擦可信复用 | SPEC 的 ChangeAssessment 逐项比较"目标、约束、权限、风险"，隐含任务语义判断；epics.md 明确不分析/观察任务运行态 | AR7、NFR8（不执行任务语义判断/观察）；MVP-FR4/FR7 只描述单次确认与配置切换重启，无 ChangeAssessment 环节 |
| CAP-5 三层适用性验证 | SPEC 把三层验证当产品能力；epics.md 把它保留为外部开发验收门，非 Story 1.1/1.2 交付给终端用户的功能 | AR15（对 AD-11 的裁决） |
| CAP-6 基线与可比样本 | 同上，`validation-contract.md` 的 T-1～T-5 是团队验收合同，非 MVP 产品能力 | AR15（对 AD-17 的裁决） |
| CAP-7 Bad Case 有界演进 | SPEC 要求 Bad Case 驱动新配置修订/规则；epics.md 明确样本/Bad Case 产品化不进 MVP | AR13 |
| CAP-8 跨 Session 追溯 | SPEC 要求持久化 opaque native Session locator 并支持 ChangeAssessment/ValidationDecision 追溯；epics.md 只保留"配置修订可跨 CLI Session 回读"，resume 完全由 OMP 原生能力负责，不保存 locator、不做 lease/fencing | AR14（来源 FR14 收敛）、AR15（覆盖 AD-7/AD-13/AD-19）、MVP-FR5、AR9 |

SPEC 的 Constraints、Non-goals 均未提及以上收窄，Success signal 未区分"产品运行时信号"与"开发验收信号"。

### ARCHITECTURE-SPINE.md — AD 规则与 epics.md 的冲突

| AD | 冲突点 | epics.md 依据 |
| --- | --- | --- |
| AD-7 激活是 launch-scoped 单元 | 要求持久化 opaque native Session locator、ChangeAssessment 重判 | AR15 覆盖 |
| AD-11 三层验证独立取证 | 标为 `[ADOPTED]`（隐含当前必须实现），未注明是开发验收门 | AR15 覆盖为外部验收门 |
| AD-13 并发、Session lease 与升级 | 要求 SQLite 持久 lease/fencing token，依赖 AD-7 的 locator | AR15 覆盖 |
| AD-16 候选、推荐与用户裁决 | 标为 `[ADOPTED]`，要求 CandidateSet/Recommendation | AR15 覆盖 |
| AD-17 首轮样本与退出门固定 | 标为 `[ADOPTED]`，暗示是产品功能 | AR15 覆盖为外部验收门 |
| AD-19 Manifest/capability/receipt 合同 | 包含 opaque locator 与 explicit resume selector 字段的产品级承诺 | AR15 覆盖（字段可保留为 schema，值不产出/消费） |

`Deferred` 小节现有条目未列出上述 6 项覆盖；`能力 → 架构映射` 表未标注 MVP 与延后边界。

### PRD / UX 影响

不评估：本轮任务范围明确限定为 SPEC + Architecture Spine 与 epics.md 对齐，不修改 PRD 与 epics.md 本身（PRD 是完整目标态来源，epics.md 已完成裁决，均不在本次改动范围）。

## Section 3：Recommended Approach

**Direct Adjustment（Option 1）**：不删除 SPEC/Architecture 中面向未来的完整目标态描述（它们仍是合法的长期产品/架构方向，只是本轮不实施），而是在两份文档中显式标注"MVP 边界"，把 epics.md 已确认的裁决（AR13～AR17）回写为可追溯的范围注记：

- SPEC.md：在每个 Capability 下追加 `**MVP:**` 归属说明；Constraints/Non-goals 追加 MVP 范围收窄条款；Success signal 标注为开发验收门。
- ARCHITECTURE-SPINE.md：新增"MVP 范围边界"小节；在 AD-7、AD-11、AD-13、AD-16、AD-17、AD-19 内追加"MVP 边界"标注；`Deferred` 小节追加对应条目；`能力 → 架构映射` 表追加范围提示。
- validation-contract.md：顶部追加一句说明，明确该合同是开发验收方法而非 MVP 产品运行时功能。

**理由**：epics.md 的 AR15 本身用的是"覆盖"（override）而非删除的语言，说明负责人把这些能力视为已确认保留的未来架构，只是延后实施。直接删除 SPEC/Architecture 正文会丢失这部分已完成的设计工作，且需要更高权限的政策变更（不在本次任务授权范围内）。标注式回写风险最低、可逆、且让 SPEC/Architecture 与 epics.md 三者互相印证，不产生新的政策决定——只是让已确认决定在所有合同文档中一致可见。

- 效力评估：Low effort，Low risk（不改变任何已确认决定的实质内容，只做可追溯标注）。
- Rollback 选项：不适用（未完成实现，无需回滚已完成 Story）。
- MVP Review 选项：不适用（MVP 范围已经由 epics.md 完成裁决，本次不重新裁决范围，只做回写同步）。

## Section 4：Detailed Change Proposals

见下方 Implementation Handoff 之后的直接编辑记录（本提案与实际编辑一次性完成，未采用分阶段增量评审模式，因为改动是纯粹的范围标注回写，不改变任何已确认决定的实质内容）。

主要编辑：

1. `SPEC.md`
   - CAP-1～CAP-8 各追加一行 `**MVP:**` 归属说明。
   - `## Constraints` 追加 MVP 范围收窄条款。
   - `## Non-goals` 追加候选/推荐、配置创建、任务观察、opaque locator/lease-fencing、Bad Case 产品化、三层验证作为运行时功能的显式排除。
   - `## Success signal` 前追加"外部开发验收门"定语。
2. `ARCHITECTURE-SPINE.md`
   - frontmatter `scope` 追加 MVP 子集说明。
   - 新增 `## MVP 范围边界（epics.md 为准）` 小节（位于"设计范式"与"不变量与规则"之间）。
   - AD-7、AD-11、AD-13、AD-16、AD-17、AD-19 内各追加一行"MVP 边界"标注。
   - `## Deferred` 追加 3 条对应条目。
   - `能力 → 架构映射` 表下追加范围提示。
3. `validation-contract.md`
   - 顶部追加一句说明本合同用途是开发验收，非产品运行时功能。

## Section 5：Implementation Handoff

- 变更范围分类：**Minor**（纯标注回写，不改变已确认决定，不需要 PO/PM/Architect 重新裁决）。
- 执行者：本次任务直接由当前 Session 完成编辑（无需转交）。
- 成功标准：重新读取 SPEC.md、ARCHITECTURE-SPINE.md 后，两文档与 epics.md 之间不再存在未标注的能力范围冲突；epics.md 保持不变（除非其自身流程要求）。

## 需要负责人明确确认的事项（本次不擅自扩大/擅自解决）

以下事项超出"回写已确认裁决"的范围，本次只标注/记录，不代人决定：

1. **ChangeAssessment 的 MVP 归属是推断而非 epics.md 显式裁决**：epics.md 没有像对 AD-16/AD-7/AD-13/AD-19 那样显式提及 AD-7 中的 ChangeAssessment（逐项比较目标/约束/权限/风险）。本提案基于 AR7/NFR8"不执行任务语义判断、不观察任务运行态"的既有裁决，推断 ChangeAssessment 的目标/约束比较与该裁决不兼容，因此标注为不在 MVP。这是本次任务基于已确认政策的**逻辑推断**，不是 epics.md 的字面裁决——如果负责人对 ChangeAssessment 有不同意图（例如未来想要一个不涉及任务语义的轻量版本），需要另行确认。
2. **是否需要把 epics.md 加入 SPEC.md 的 `companions`/`sources` frontmatter**：本次未改动 SPEC.md 的 frontmatter 依赖图，只在正文追加引用 epics.md 的说明性文字。是否要把 epics.md 正式纳入 SPEC 的合同依赖图（这属于文档治理决定）留给负责人另行确认。
3. **是否需要同步更新 PRD**：PRD (`prd-agent-system-2026-08-21/prd.md`) 仍描述完整目标态 FR-1～FR-14，与本轮 MVP 收窄没有直接冲突（PRD 本就是更上游、更宽的目标态来源），但本次任务范围未包含 PRD，未做任何改动或标注，如负责人认为 PRD 也需要同步范围标注，需要另行明确任务。
