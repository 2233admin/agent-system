# Sprint Change Proposal — configs 配置供应与装配能力缺口（2026-08-23）

## 触发与背景

Epic 1（查看、选择并使用 OMP 配置）与 Epic 2（控制面发布与自更新）均已交付，`configs` 也已发布首个真实版本 `configs-v0.1.0` 并装到本机验证过端到端可用。负责人在实际按 `omp` 的方式装好 `configs` 二进制后，尝试使用时发现：`configs list` 是空的，唯一能把数据灌进它的 SQLite 存储的路径是仓库内部的开发者脚本 `packages/control-plane/scripts/seed-from-cap.ts`，该脚本硬编码读取本仓库的 `.cap/` 目录格式。负责人据此提出：`configs` 作为一个独立分发的二进制，脱离 `agent-system` 这个仓库根本无法获得任何配置数据——"看/选/用"这半个产品做完了，但"数据从哪来"完全没有设计，这不是实现细节遗漏，而是 MVP 范围划分阶段"没有设计好"的一个真实缺口。

## Section 1：Issue Summary

- **问题：** `configs` CLI 没有任何脱离本仓库 `.cap/` 目录的配置供应路径；作为独立产品无法独立使用。
- **类型：** 负责人在实际使用已交付产品后提出的新方向（不是本轮实现缺陷，也不是对已交付 Story 的误解）。
- **证据：**
  - `scripts/seed-from-cap.ts` 文档字符串原文："This is intentionally NOT a CLI subcommand -- per epics.md AR16, 'configuration supply' is not a user-facing capability in this Story."
  - `epics.md` AR13："配置创建、编辑、Context Assembly、Agent 候选/推荐...均不进入 MVP"；AR16："配置供应不是本轮第三项用户能力。"
  - `packages/control-plane/src/application/ports.ts` 的 `ConfigRevisionRepository` 接口只有 `listAll`/`findById` 两个只读方法，没有任何写入/建立路径。
  - 实测：装好 `~/.bun/bin/configs.exe` 后必须额外进入 `packages/control-plane` 目录跑 `bun run seed`，才能让 `configs list` 有内容。
  - `_bmad-output/specs/spec-agent-system/SPEC.md` 的 CAP-1（Agent 候选/推荐装配）与 CAP-2（配置建立/修订）本就完整描述了这个能力，只是被 `epics.md` AR13/AR15 裁定"不在 MVP"。

## Section 2：Impact Analysis

### Epic Impact

- **Epic 1（查看、选择并使用 OMP 配置）：** 不受影响，不需要修改。它的两个 Story 已关闭，Acceptance Criteria 明确写着"不生成候选、评分、排序、Recommendation""不由 Agent 自动选择、推荐"——这些正是要被新增能力扩展的边界，不能在已关闭的 Story 里顺手改，必须新开 Epic 承载。
- **Epic 2（控制面发布与自更新）：** 不受影响，不需要修改；分发/更新机制与配置供应是两个独立层。
- **新增 Epic 3（配置供应与装配）：** 需要新建，承载"选择数据源（GitHub 仓库 / 本地目录）→ Agent 辅助装配（调查、候选、推荐）→ 建立/修订可持久化的配置修订"这个此前完全没有覆盖的能力域。这条能力域直接对应 SPEC.md 的 CAP-1 全部意图与 CAP-2 的"建立/修订"部分——两者当前都标注"不在 MVP"，本次是负责人对 `epics.md` AR13/AR15/AR16 收窄裁决的重新表态。
- 其余已规划 epic：无（`epics.md` 当前只有 Epic 1、Epic 2），不存在需要重新排序或废弃的条目；新 Epic 3 排在两者之后，因为它是在两者都交付、真实使用后才被发现的空白，不影响已交付内容的时间线。

### Artifact Conflicts

- **PRD：** 无冲突，不需要修改。PRD 的 WF-1（"建立或修订稳定配置"）、FR-1~FR-4 本就完整描述了这个能力；`epics.md` 的 AR13 只是"本轮 MVP 不做"，不是 PRD 从未承诺。本次是把 PRD 已有范围排进下一轮 Epic，不是新增 PRD 范围。
- **Architecture（`ARCHITECTURE-SPINE.md`）：** AD-16（候选、推荐与用户裁决可追溯）已是 `[ADOPTED]`，候选生成流程本身的架构描述没有错，只是标注了"MVP 边界（epics.md AR15）：MVP 不实现"。这行标注需要在正式的 architecture 阶段重新审视，但**本次 correct-course 不直接修改 AD-16 文本**——因为要落地它，还需要至少一个全新的、当前 AD-1~AD-19 完全没覆盖的架构面：**数据源接入**（GitHub 仓库 / 本地目录二选一导入，读取什么格式、如何校验来源可信边界）和**装配持久化写路径**（`ConfigRevisionRepository` 目前是纯只读接口，需要新增建立/修订的写方法及其领域约束）。这些是需要 Architect 判断的新决定，不是 correct-course 可以直接拍板的窄范围文本修订（对比 Epic 2 先例：AD-15 那次改动范围小、边界清晰，可以在 correct-course 里直接改；这次不满足同等条件）。
- **UX（DESIGN.md/EXPERIENCE.md）：** 当前完全没有覆盖"Agent 辅助装配"这个交互面。`epics.md` 记录过"本轮按负责人要求跳过独立 UX 阶段"，因为 Epic 1 的交互足够简单，直接写进 Story 就够。Epic 3 的"候选呈现、用户裁决、数据源选择向导"复杂得多，建议补一次独立 UX 阶段，而不是重复 Epic 1 的"跳过"做法——这是本提案的建议，需要负责人在下一步确认是否同意。
- **CI/CD：** 当前无关联 workflow 需要改动；等 Epic 3 有具体实现需求（例如新的仓储迁移、新的测试门）时在其自己的 Story 阶段处理，不在本次 correct-course 范围。
- **文档：** `packages/control-plane` 目前没有任何 README；这次暴露的"用户不知道要跑 `bun run seed`"本身也是缺文档的直接后果，Epic 3 完成后应当补一份"如何独立于 agent-system 使用 configs"的说明，记入 Epic 3 的验收范围而非本次直接补。

### Technical Impact（供 Epic 3 架构/实现阶段参考，本次不落地）

- 需要决定：数据源导入协议（GitHub 仓库结构 vs 本地目录结构，是否复用 `.cap/` 格式还是设计新的、不耦合本仓库实现的通用 schema）。
- 需要决定：`ConfigRevisionRepository` 的写路径设计（新建/修订配置修订的领域命令、不可变修订版本号策略——参照 AD-4"配置修订不可变"）。
- 需要决定：候选生成/推荐（CAP-1）具体如何在 CLI 里落地为交互（一次性向导命令？还是常驻装配子命令？）——这是 UX 阶段的产出。
- 需要重新评估：来源可信边界——PRD 明确排除"团队治理、公共配置共享/发现"（§7 明确非目标），Epic 3 的"GitHub 仓库导入"设计必须避免滑向这些非目标（例如不能变成"从任意公开仓库拉取别人分享的配置"这种商业化/共享语义）。

## Section 3：Recommended Approach

**选择：Option 1（Direct Adjustment）。**

- 新增 Epic 3 承载"配置供应与装配"，具体架构决定（数据源接入、写路径设计）与 UX 设计留给后续 `bmad-architecture`/`bmad-ux` 阶段产出，Story 级细节留给 `bmad-create-epics-and-stories`。
- 不涉及 Option 2（回滚）——Epic 1/2 的实现没有错，问题是"从未做过"的能力缺失，不是"做错了需要撤回"，没有工作需要回滚。
- 不涉及 Option 3（PRD MVP 范围调整）——PRD 原有范围本就包含这个能力（WF-1/FR-1~FR-4），不需要收缩或重新定义核心目标；这是给 MVP 之后补下一个 Epic，不是收缩 MVP。

**Effort：** High（全新能力面：数据源接入、装配持久化写路径、候选生成交互，外加可能的独立 UX 阶段）。
**Risk：** Medium——主要风险是"装配"引入的候选生成/来源信任语义如果设计不当，容易滑向 PRD §7 明确排除的"公共配置共享/发现"或"团队治理"非目标；需要在正式架构阶段严格钉住 AD-16 已有的候选生成边界（2~3 个候选、用户裁决、只在高风险/不可逆时升级）。
**Timeline：** 不影响已交付的 Epic 1/2；是纯增量范围，不改变已交付内容的时间线。

## Section 4：Detailed Change Proposals

### 4.1 Epics — `epics.md` 新增 Epic 3 占位

在 `## Epic List` 小节，`### Epic 2：控制面发布与自更新` 之后追加：

```markdown
### Epic 3：配置供应与装配

`configs` 支持选择数据源（GitHub 仓库或本地目录）导入原始资产，由 Agent 辅助完成调查、候选生成与推荐（对应 SPEC.md CAP-1），用户裁决后建立/修订可持久化的稳定配置（对应 CAP-2 的"建立/修订"部分，恢复覆盖 PRD FR-1～FR-4 / WF-1）。这条能力域此前被 epics.md AR13/AR15/AR16 明确裁定不进入 MVP；本次由负责人在实际使用已交付产品后重新表态、正式排入后续排期。装配（Agent 辅助）与使用（人工看/选/用，即 Epic 1 范围）保持两个不同的能力面，不合并、不互相替代。具体数据源接入方式、配置修订写路径与交互设计留给后续 bmad-architecture / bmad-ux / bmad-create-epics-and-stories 产出。

**覆盖：** SPEC.md CAP-1（全部）、CAP-2（建立/修订部分）；PRD FR-1～FR-4、WF-1；覆盖 epics.md AR13、AR15、AR16 对应裁决的重新表态；覆盖 Architecture Spine AD-16 的"MVP 边界"标注（该行文本本身留给下一轮 architecture 阶段正式修订，不在本次 correct-course 直接改）。
```

**理由：** 只建立范围占位，不预先固化架构方案或 Story/验收标准——数据源接入、仓储写路径、候选生成交互都需要专门的架构与 UX 判断，correct-course 阶段越权代做会产生和 Epic 1/2 已确立边界冲突的风险。

### 4.2 `sprint-status.yaml` — 新增 Epic 3 backlog 条目

```yaml
development_status:
  epic-3: backlog
```

### 4.3 后续行动项（本次不直接落地，记录待办）

- 下一步运行 `bmad-architecture`，针对 Epic 3 产出新的架构决定（暂定 AD-20+）：数据源接入协议、`ConfigRevisionRepository` 写路径设计、来源可信边界；同时正式审视并可能修订 AD-16 的"MVP 边界"标注。
- 视架构阶段结论，评估是否需要一次独立的 `bmad-ux` 阶段覆盖"候选呈现、用户裁决、数据源选择向导"的交互设计（Epic 1 当初跳过了独立 UX 阶段，Epic 3 复杂度更高，建议不再跳过，但最终由负责人和架构阶段结论共同决定）。
- 架构与（如需要）UX 阶段完成后，运行 `bmad-spec` 同步 `_bmad-output/specs/spec-agent-system/SPEC.md`——CAP-1/CAP-2 当前的"MVP: 不在 MVP"标注届时会过期，需要重新派生更新（correct-course 本身不越权直接改 SPEC.md，那是 bmad-spec 的职责）。
- 再运行 `bmad-create-epics-and-stories` 把 Epic 3 拆成具体 Story。

## Section 5：Implementation Handoff

- **变更范围分类：Moderate（占位部分）+ Major（架构/UX 部分）。** `epics.md` 新增 Epic 3 占位与 `sprint-status.yaml` 新增 backlog 条目是范围清晰、可直接落地的文档层改动；但具体如何实现（数据源接入、持久化写路径、装配交互）是全新架构面，必须路由给 Architect（Winston）和视情况路由给 UX（Sally），不能由 Developer 直接实现，也不是本次 correct-course 可以顺手拍板的窄范围修订。
- **本次 correct-course 直接完成：** `epics.md` Epic 3 占位、`sprint-status.yaml` 新增 `epic-3: backlog` 条目——经负责人批准后由本次会话直接落地。
- **后续交给：**
  - **Architect（Winston，`bmad-architecture`）：** 产出数据源接入、仓储写路径、来源可信边界的正式架构决定，并重新审视 AD-16 的 MVP 边界标注。
  - **UX（Sally，`bmad-ux`，视架构阶段结论决定是否需要）：** 产出候选呈现、用户裁决、数据源选择向导的交互设计。
  - **`bmad-spec`：** 架构/UX 结论落定后，同步更新 SPEC.md 的 CAP-1/CAP-2 MVP 标注。
  - **`bmad-create-epics-and-stories` → `bmad-build`：** 把 Epic 3 拆成 Story 并逐一实现，交付流程与 Epic 1/2 一致（spec → 实现 → 三层独立审查 → PR → 合入）。

## Section 6：批准记录

负责人已批准，直接落地：`epics.md` 按 4.1 新增 Epic 3 占位；`sprint-status.yaml` 按 4.2 新增 `epic-3: backlog` 条目。二者均已完成。4.3 列出的后续行动项（架构决定、视情况的 UX 阶段、SPEC.md 同步、Story 拆分）交给下一轮 `bmad-architecture` 起头。
