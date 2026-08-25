# Reviewer: rubric walker（good-spine checklist）— AD-22

**Verdict: PASS with findings**（2 项 high、1 项 medium 需在交付前处理）

## 逐项

| 检查项 | 结果 |
| --- | --- |
| 固定了下一层真实的分歧点 | 部分——见 F1 |
| 每条 Rule 可执行且真能防住其声称的分歧 | 部分——见 F3 |
| Deferred 下无可致分歧项 | 通过（Codex 半边已显式 Deferred 且说明了为何无法验证） |
| 具名技术已核实 | 部分——见 F4（另见 current-tech lens） |
| 认可而非顶撞既有代码约定 | 通过——AD-22 与 content-materializer.ts / resolveClientSupport 现状一致 |
| 未削弱或顶撞既有 AD | 通过——与 AD-20（requires-restart）、AD-21（调用作用域物化）、AD-4（SQLite 唯一权威）一致，未修改任何既有 Rule |
| 该 altitude 拥有的每个维度都已决定／延后／列为开放问题 | **不通过——见 F1** |

## F1 [high] 「组织」这一维度整体缺席

负责人的原问题是「Skill 在仓库中怎么**存放**、怎么**组织**、怎么被**装配**」。AD-22 固定了存放（按来源判归属）与装配（configs 唯一路径），但**组织**没有任何着落。

仓内真实存在一个成熟的组织模型——「组是第一结构：装卸、版本、发现、判定、复核都以组为单位，不以 Skill 为单位；判定 12 次不是 82 次」，连同 own／fork／vendor 三分来源模型与 fork 零改动的机械可验证性——但它**只存在于 `tools/skill_registry/README.md`**，一个工具的 README，够不着权威面。这正是本轮要修的病：设计存在但不在权威面上。AD-22 若不把「组」固定为装卸／版本／判定的单位，下一层两个实现者完全可以一个按 Skill 粒度、一个按组粒度建模。

**处置：** autofix —— 在 AD-22 Rule 增一条「组是第一结构」。

## F2 [high] 新增的验证边界门在今天必然失败

本轮给「验证边界」加的 AD-22 一致性门要求「仓库规则强制加载的每个 Skill 都在本仓当前装配意图内」。但 AD-22 自己承认这三个 Skill 目前不可见，且要到退役第 (1) 步才纳入。于是这道门从写下的那一刻起就是红的，而 AD-22 的过渡期条款又明确允许当前状态。门与规则自相矛盾。

**处置：** autofix —— 把该门的生效时点绑定到退役第 (1) 步完成之后，并说明在此之前它是待建门而非现行门。

## F3 [medium] 第二个 `fork` 组没有 pin 落点

Rule 把第三方组的 pin 具体化为 `_bmad/_config/manifest.yaml` + `skill-manifest.csv`——那是 BMad 安装器专有的产物。当前 `fork` 组确实只有 `bmad` 一个（`grilling` 是 `vendor`，已打 1 处补丁，按 Rule 属仓库源码，判定正确）。但再来一个来自别的上游的 `fork` 组时，pin 该放哪没有规定，两个实现者会各自发明。

**处置：** autofix —— 把 pin 要求一般化为「每个 fork 组必须有一个被跟踪的 pin，声明上游 ref 与可复现的取得方式」，BMad 的两份清单作为当前唯一实例。

## F4 [medium] `.agents/skills` 服务 Codex 属未核实推断

见 current-tech lens F1，不重复。
