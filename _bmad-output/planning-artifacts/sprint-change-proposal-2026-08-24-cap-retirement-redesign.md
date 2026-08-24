# Sprint Change Proposal — CAP 全面退役与 Claude adapter 装配能力补全（2026-08-24）

> **负责人批准：** 已批准（2026-08-24，Batch 模式一次性审阅通过）。Scope 分类 Major，路由给 PM/Architect；epics.md、sprint-status.yaml 的落地编辑已随本次批准一并执行，详见 Section 4。

## 触发与背景

Story 4.5（`.cap/` parity 验证与本仓自身切换）的 AC2 在负责人明确接受"切换需要重启"这一代价后，仍然无法安全落地——但阻塞原因从"不得中断"变成了一个更深的发现：**"本仓自身切换"这个故事表述的对象，从一开始就可能不存在**。2026-08-24 的追加调查（见 `spec-4-5-cap-parity-验证与本仓自身切换.md` 的"2026-08-24 追加调查"小节）给出四项具体证据：

1. `.cap` 对 Claude 的真实机制是 `cap use <role> --cli claude`——新建一个完全隔离的 `claude` 子进程（独立 `CLAUDE_CONFIG_DIR`，`--plugin-dir` 交付 Skill 内容），跟新 adapter 的 `launchClaudeFresh` 是同一类东西（新开隔离进程），**不是**改写本仓自己这个已在跑的交互式 session。
2. 本仓自己这个交互式 session 的 `skills`/`CLAUDE.md`，是 Claude Code 原生按项目目录规则读取的**普通 git 跟踪文件**；磁盘上找不到 `.cap-rendered/` 目录，也没有 `.claude/settings.json`。**没有证据证明这个 session 的能力来自 `.cap` 的渲染管线。**
3. 新 adapter 的 `launchClaudeFresh` 目前**不具备真正交付 Instructions/Skills/MCP 内容的能力**（`computeClaudeKnownDifferences` 对任何非空装配意图恒记为"未物化"），只传 3 个硬控制 flag——跟 `.cap` 真正能做的事不是同一能力等级。
4. `configs` CLI 里**没有任何入口**能调用新 adapter 的 Claude 相关代码——`domain/client.ts` 的 `resolveClientSupport('claude-code')` 仍硬编码 `unsupported`；`prepareClaudeFreshLaunchPlan`/`launchClaudeFresh`/`prepareClaudeAlreadyRunningLaunchPlan` 目前只被测试调用。

负责人就此直接裁决方向：**`.cap` 是历史产物，要彻底干掉；`configs`（新 control-plane）是新的权威系统**，需要重新设计装配/存储架构，让新 adapter 真正具备内容交付能力，然后正式退役 `.cap`。

## Section 1：Issue Summary

- **问题：** Epic 4 Story 4.5/4.6 现有表述建立在一个未经核实、且经调查大概率不成立的前提上（"本仓自身正在运行的 session 由 `.cap` 治理，只是不能被热更新"）。真正阻挡"退役 `.cap`"的，不是"如何安全切换一个已在跑的 session"，而是三个此前完全未被识别、未被设计的能力缺口：**真实 CLI 入口**、**内容物化能力**（Skills/Instructions/MCP 真正交付给 Claude 进程，而不只是硬控制 flag）、以及**是否需要"当前装配来源记录"这个新概念**。
- **类型：** 技术限制发现（实现阶段暴露）+ 原始需求理解偏差（"自身切换"故事对象的存在性未经核实）+ 负责人战略裁决（明确要求 CAP 全面退役、以 `configs` 为唯一权威）。
- **证据：** 见上方"触发与背景"四项调查结论，均来自对 `openspec/changes/archive/2026-08-20-add-claude-cap-adapter/design-spec.md`、本仓磁盘 `.cap/`/`.claude/` 实际内容、`packages/control-plane/src/**` 现有实现的直接读取与 `grep` 核实，不是推测。

## Section 2：Impact Analysis

### Epic Impact

- **Epic 1（查看、选择并使用 OMP 配置）、Epic 2（控制面发布与自更新）、Epic 3（配置供应与装配，OMP）：** 不受影响，不需要修改。三者都是 OMP 单客户端范围，且 Epic 3 已确认的存储模型（`StableConfigRevision`/`SqliteConfigRevisionRepository`，client-neutral）正是 Epic 4 应该复用而非另起的基础——本次不新增一套平行存储，是在既有 client-neutral 存储上补 Claude 侧缺失的读写路径。
- **Epic 4（装配并激活 Claude Code 客户端）：** 需要修改。
  - Story 4.1～4.4：不受影响，已交付的探测/编译/fresh 启动/requires-restart 判断逻辑本身没有错，只是"能力不完整"（没有内容物化）与"没有 CLI 入口"，不是"做错了需要撤回"。
  - Story 4.5：AC1（parity 验证）保持已完成状态不变；AC2 需要**重新表述**——不再是"本仓自身切换"，而应拆解为下方新增的两个能力缺口 Story，4.5 本身收敛为"确认本仓自身交互式 session 的装配来源与 `.cap` 无渲染管线关联"这一项已完成的调查结论存档，不再承担"切换"动作本身。
  - Story 4.6（退役 `.cap/` 本体）：**验收前提需要重写**。当前文本"Given Story 4.5 的本仓自身切换已稳定运行"这个前置条件对象不存在，需要改为"Given 新 adapter 的 fresh 启动已具备与 `cap use <role> --cli claude` 功能对等的内容物化能力，且经真实启动烟雾测试验证"。
  - **新增 Story（编号建议 4.5b 与 4.6，原 4.6 顺延为 4.7）：**
    - **Story 4.5b：Claude adapter 内容物化能力** —— 让 `launchClaudeFresh` 真正把装配意图的 Instructions/Skills/MCP 内容交付给新 spawn 的隔离 Claude 进程（功能对等于 `.cap` 的 `--plugin-dir` 机制），而不只是当前的 3 个硬控制 flag。
    - **Story 4.6：`configs` CLI 的 Claude 入口** —— 把 `resolveClientSupport('claude-code')` 从硬编码 `unsupported` 改为真实探测结果，让 `configs use --client claude-code`/`configs switch --client claude-code` 真正可调用新 adapter；这是"新 adapter 覆盖 `.cap` 现有场景"这句验收标准第一次有真实可触发路径去验证，而不只是测试直接调用内部函数。
  - **Story 4.7（原 4.6，退役 `.cap/` 本体）：** 前提改为 Story 4.5b + 4.6 均完成，且新 adapter 的 fresh Claude 启动通过一次真实烟雾测试（对照 `general`、`agent-assembler` 两个 profile，验证实际交付的 Skills/Instructions/MCP 内容与 `cap use <role> --cli claude` 产出等价）后，才能移除 `.cap/` 目录。**不再要求"本仓自身正在运行的 session 切换装配来源"作为退役前提**——调查已证明这个 session 的装配与 `.cap` 无关，不存在"切换"这个动作的对象。

### Artifact Conflicts

- **PRD：** 无冲突，不需要修改核心范围。§4.4 的 2026-08-23 裁决已经把 Claude Code 激活为第二客户端，范围就是"类型化能力装配、宿主原生可强制执行的硬控制边界"——内容物化能力属于这个范围内的具体实现细节补全，不是新范围。`addendum.md` 需要补一条技术决策记录（新增 CLI 入口与内容物化能力属于原裁决范围内的实现细节），供下一轮 `bmad-architecture` 使用，格式类比 2026-08-23 那次裁决记录。
- **Architecture（`ARCHITECTURE-SPINE.md`）：**
  - **AD-19（Manifest、capability 与 receipt 是客户端兼容合同）：** 当前 `AdapterPlan` 定义"只保存 argv 结构、环境键、secret/content 引用、不可逆 hash、generated-file metadata 和预期观察；实际环境值/文件内容只进入非持久 `RuntimeLaunchSpec`"——这段文本本身没有错，缺的是 Claude 侧 `RuntimeLaunchSpec` 如何具体把 Instructions/Skills/MCP 内容物化为 Claude 进程可读的文件（`--plugin-dir` 等价物）。这是需要 Architect 新增决定的具体设计，不是 correct-course 可以直接拍板的窄范围文本修订。
  - **".cap/ 退役顺序" 小节：** 需要重写。第 1 步"落地新 adapter"需要明确纳入内容物化能力与 CLI 入口，不能只是 probe/plan 库代码；第 3 步"本仓自身切换"需要整体移除或改写为"真实烟雾测试验证新 adapter fresh 启动功能对等于 `.cap`"，不再涉及"本仓自身正在运行的 session"。这部分文本改动范围不小（一整节的前提假设都要重新表述），**不满足 correct-course 直接改写的窄范围条件**，需要交给 Architect 正式裁定新的四步（或调整后的步数）退役顺序。
  - **AD-20：** 基本保留，"already-running session target → requires-restart"这条规则本身仍然正确、仍然有用（对任何用户未来想要"把装配应用到一个已在跑的 Claude 会话"的请求都适用），只是不再被套用到"本仓自身维护 session"这个具体场景上。不需要修改规则本身，只需要在退役顺序小节里去掉这层错误关联。
- **UX：** 当前无 Claude 侧 UX 设计（Epic 4 沿用 Epic 1 的"跳过独立 UX 阶段"先例）。内容物化能力若涉及新的 CLI 交互面（例如 `configs use --client claude-code` 的确认展示要不要说明"哪些内容会被物化交付"），建议下一轮 `bmad-architecture`/`bmad-create-epics-and-stories` 阶段判断是否需要补一次轻量 UX 复核，不在本次 correct-course 直接决定。
- **SPEC.md：** CAP-2、CAP-3 的"Epic 4"行文字（"只读引用...不含建立/修订工作流"）不冲突——内容物化是"交付已有只读引用的内容"，不是"建立/修订工作流"，两者是不同维度，不需要改写这两行。建议在下一轮 spec 复核时确认这一点已经表达清楚，避免歧义。
- **CI/CD：** 无关联 workflow 需要立即改动；等 Story 4.5b/4.6/4.7 有具体实现需求（例如新的烟雾测试门）时在各自 Story 阶段处理。
- **文档：** `epic-4-context.md` 需要在下一轮 `bmad-create-epics-and-stories` 或 `bmad-build` 阶段同步重新编译，反映新增的 Story 4.5b/4.6 与 4.7 前提改写；本次 correct-course 只在 epics.md 落地文字变更，不代为重新编译 context 文件。

## Section 3：Recommended Approach

**选择：Option 1（Direct Adjustment）+ 建议下一步走一次 `bmad-architecture`。**

- 在 Epic 4 内新增 Story 4.5b（内容物化能力）与 Story 4.6（CLI 入口），原 Story 4.6 顺延为 Story 4.7（退役 `.cap/` 本体，前提改写）。这是在既有 Epic 结构内新增/修改 Story，不需要新开 Epic、不需要回滚已交付内容（4.1～4.5 的 AC1 部分保留有效）。
- 内容物化能力涉及一个此前完全没有设计过的架构面（Claude 进程如何真实接收 Skills/Instructions/MCP 内容，功能对等 `--plugin-dir`），比照 Epic 3 当年"数据源接入协议未拍板"的先例，这类具体架构决定不适合在 correct-course 里直接拍板，**建议下一步走一次 `bmad-architecture`**，产出内容物化机制的具体设计（读取哪些既有 `StableConfigRevision` 字段、如何生成/摆放 Claude 能识别的文件、隔离边界如何保证不残留），再回到 `bmad-create-epics-and-stories` 把 Story 4.5b/4.6/4.7 的验收标准细化。
- 不涉及 Option 2（回滚）——Story 4.1～4.5 没有做错，AC1 的 parity 验证成果依然有效，只是"切换"这一步的故事对象需要重新认识，没有工作需要撤回。
- 不涉及 Option 3（PRD MVP 范围调整）——PRD §4.4 的第二客户端裁决范围本就包含"类型化能力装配"，内容物化只是把这个已确认范围的实现补完整，不需要收缩或重新定义核心目标。

**Effort：** Medium-High（内容物化是一块新的实现面，需要先过一次架构设计；CLI 入口相对直接，复用 Story 1.2 `use`/`switch` 的既有模式）。
**Risk：** Low-Medium——内容物化如果设计不当，可能引入"隔离边界不清"的风险（复用 AD-6 的调用作用域边界原则可以规避）；CLI 入口本身风险低，`resolveClientSupport` 的改动路径已经在 Story 4.1～4.4 的 `Never` 边界里被反复确认过范围。
**Timeline：** 不影响已交付的 Epic 1～3 与 Epic 4 Story 4.1～4.5（AC1 部分）；Story 4.7（退役 `.cap`）的时间线相应后移，等 4.5b/4.6 完成并通过真实烟雾测试后才能执行。

## Section 4：Detailed Change Proposals

### 4.1 Epics — `epics.md` 的 Epic 4 小节

在 `## Epic 4：装配并激活 Claude Code 客户端` 的 Story 列表中：

```diff
### Story 4.5：`.cap/` parity 验证与本仓自身切换
+
+> **2026-08-24 范围收窄：** AC1（parity 验证）保持已完成。AC2 原表述的"本仓自身切换"经调查（见
+> spec-4-5 的"2026-08-24 追加调查"）证明对象不存在——本仓自身交互式 session 的装配与 `.cap`
+> 无渲染管线关联。AC2 收敛为"确认并记录这一调查结论"，不再要求任何切换动作；真正的能力缺口
+> （内容物化、CLI 入口）拆分为下方 Story 4.5b、4.6。

...原 AC1/AC2 正文保留，AC2 标注为"已通过调查结论满足，不再要求切换动作"...

+### Story 4.5b：Claude adapter 内容物化能力
+
+作为维护本仓 Agent System 的负责人，
+我希望新 spawn 的 Claude Code 进程能真正收到装配意图声明的 Instructions/Skills/MCP 内容，
+以便 fresh 启动的会话不只是拿到 3 个硬控制 flag，而是功能对等于 `.cap` 的 `cap use <role> --cli claude`。
+
+**实现需求：** Architecture Spine AD-19（AdapterPlan/RuntimeLaunchSpec 边界）、AD-6（内容所有权与调用作用域边界）。
+具体物化机制留给下一轮 bmad-architecture 产出。
+
+### Story 4.6：`configs` CLI 的 Claude 入口
+
+作为长期使用 Claude Code 的个人实践者，
+我希望能通过 `configs use --client claude-code`/`configs switch --client claude-code` 真正触发新 adapter，
+以便新 adapter 的能力不再只被测试调用，而是有真实可用的产品入口。
+
+**实现需求：** `domain/client.ts` 的 `resolveClientSupport` 从硬编码 unsupported 改为真实探测结果；
+复用 Story 1.2 已建立的 `use`/`switch` 确认与生命周期模式。

### Story 4.6：退役 `.cap/` 本体
+（顺延为 Story 4.7）

作为维护本仓 Agent System 的负责人，
我希望在确认本仓自身切换稳定后才移除 `.cap/`，
...

**Acceptance Criteria:**

-**Given** Story 4.5 的本仓自身切换已稳定运行
+**Given** Story 4.5b（内容物化）与 Story 4.6（CLI 入口）均已完成，且新 adapter 的 fresh Claude
+启动经真实烟雾测试验证，对 `general`、`agent-assembler` 两个 profile 交付的 Skills/Instructions/MCP
+内容与 `cap use <role> --cli claude` 功能对等
**When** 执行 `.cap/` 退役
...
```

### 4.2 sprint-status.yaml

新增两个 Story 条目（`backlog`），既有 `4-6-退役-cap-本体` 键需要顺延语义（保留键名或重命名为 `4-7-...`，交给下一轮 `bmad-sprint-planning` 落地，避免本次 correct-course 直接改写追踪文件的键结构）：

```yaml
epic-4:
  4-1-...: done
  4-2-...: done
  4-3-...: done
  4-4-...: done
  4-5-cap-parity-验证与本仓自身切换: done   # AC2 范围已收窄，标注见上
  4-5b-claude-adapter-内容物化能力: backlog  # 新增
  4-6-configs-cli-的-claude-入口: backlog    # 新增
  4-7-退役-cap-本体: backlog                 # 原 4-6，前提已改写
```

### 4.3 Architecture Spine — 下一轮 `bmad-architecture` 待办清单

不在本次 correct-course 直接改写正文，记录为 Architect 输入：

1. 补充 AD-19 或新增 AD：Claude adapter 内容物化机制的具体设计（`RuntimeLaunchSpec` 如何从 `StableConfigRevision` 的 Skills/Instructions/MCP 引用生成 Claude 进程可读的文件/目录，隔离边界如何保证调用结束后清理，功能对等 `--plugin-dir`）。
2. 重写"`.cap/` 退役顺序"小节：四步改为对应新 Story 序列（落地内容物化 → CLI 入口 → 真实烟雾对等验证 → 退役），移除"本仓自身切换"这一步的现有表述。
3. 确认 AD-20 的 already-running/requires-restart 规则文本本身不需要修改，只需要在退役顺序里去掉与"本仓自身 session"的错误关联。

## Section 5：Implementation Handoff

- **Major scope** —— 涉及架构层面的新设计（内容物化机制）与 Epic 结构调整，路由给 **Product Manager / Solution Architect**。
- **下一步建议顺序：**
  1. `bmad-architecture`：产出内容物化机制设计 + 重写".cap/ 退役顺序"小节。
  2. `bmad-create-epics-and-stories`：把 Story 4.5b/4.6/4.7 的验收标准按架构产出细化（当前 Section 4.1 的 Story 正文是占位草稿，不是最终验收标准）。
  3. `bmad-sprint-planning`：把 sprint-status.yaml 的新条目正式落地（当前 Section 4.2 是占位建议）。
  4. `bmad-build`/`bmad-build-auto`：按新 Story 顺序实现。
- **成功标准：** Story 4.6 的 CLI 入口能让 `configs use --client claude-code` 真实跑通一次 fresh 启动；Story 4.5b 的内容物化能通过与 `cap use <role> --cli claude` 的真实产出比对（不只是静态 manifest 结构比对）；Story 4.7 执行退役前，`.cap/` 目录内容已确认不再被本仓自身 session、新 adapter 之外的任何路径依赖。
