---
review: adversarial
target: ARCHITECTURE-SPINE.md（AD-21 + `.cap/` 退役顺序，2026-08-24 新增材料）
method: 构造两个各自"逐字合规"AD-21 的下一层实现单元（Story 4.5b 的两名独立开发者），寻找共享数据形状、实体归属或状态变更路径上的冲突；结论以本仓真实代码（Story 4.1~4.4 已落地部分）为依据核实，非纯文本推演。
date: 2026-08-24
---

## 一句话结论

**PASS with notes** —— AD-21 的原则性框架（调用作用域、fail-closed、AD-6 边界）是自洽的，但存在两个 Critical 级别的具体实现留白：(1) `sourceRef` 在当前代码里对任何真实 `.cap/` 灌入数据永远是 `Unknown`，AD-21"已知范围边界"段落对可解析性的事实主张与代码不符；(2) 物化产物的磁盘布局未被钉住，且必须复用的 invocation 目录同时兼作 `CLAUDE_CONFIG_DIR`/`cwd`，构成真实的内容碰撞面。两者都会让两个各自"读 AD-21 字面意思"的 Story 4.5b 实现产出不兼容的 Claude 进程行为。

---

## Critical

### C1 — `sourceRef` 在当前代码路径上永远是 `Unknown`；AD-21"已知范围边界"段落的事实前提与代码不符

AD-21 原文："已知范围边界：当前可靠可解析的 `sourceRef` 主要是经 `scripts/seed-from-cap.ts` 从本仓 `.cap/` 真实文件灌入的修订"。

核实 `packages/control-plane/src/adapters/sources/cap-fs.ts`（`seed-from-cap.ts` 唯一调用的加载器）：`mapCapabilityNames()`（skills/mcp/hooks/plugins）与 `instructions` 字面量都把 `sourceRef`/`contentFingerprint` 硬编码为 `CAP_FS_FIELD_NOT_CAPTURED`——一个 `unknown('not-captured-by-cap-fs-adapter', ...)`。也就是说，**今天通过 `seed-from-cap.ts` 灌入的全部修订，其全部 `CapabilityReference.sourceRef` 都是 `Unknown`，没有一个是 `Known`**。AD-21 用来锚定"当前可靠可解析范围"的那个真实数据源，其实一个可解析的 `sourceRef` 都不产出。

这不是无害的过时注释——它直接制造两个各自忠实执行 AD-21 字面规则、但产出不兼容 adapter 的 Story 4.5b 实现路径：

- **开发者 A**（字面派）：`sourceRef` 是 `Fact<string>`，AD-21 规则是"`sourceRef` 无法解析为真实可读内容时该 capability 记为 `unsupported`/`degraded`"。既然对本仓现有全部灌入数据它恒为 `Unknown`，A 严格按 AD-10 fail-closed 把每一个 capability（Instructions/Skills/MCP）都判定为不可解析，物化步骤对真实 `.cap/` 数据永远是空操作，`general`/`agent-assembler` 两个 profile 全部 degrade。这与 Story 4.5/4.7 要求的"对这两个 profile 做真实烟雾对照并证明功能对等"直接矛盾——按 A 的实现，parity 验证在第一步就会全线失败。
- **开发者 B**（意图派）：认定"sourceRef 恒 Unknown"明显不是产品意图，转而绕过这个坏掉的字段，从 `CapabilityReference.name` 反推真实路径（`cap-fs.ts` 里 `instructions.name = profile.prompt` 恰好本来就是一个声明路径，这给了 B 一个看似合理的先例）。对 skills/mcp，`name` 只是能力名字而非路径，B 只能自行发明"名字 → `.cap/` 目录结构"的映射规则——这正是任务描述里点名的风险："在 Story 4.5b 里假设一个 Epic 3 尚未拍板的数据源协议"；`epic-3-context.md` 明确写着"数据源接入协议 ... 仍是未拍板的开放架构/UX 问题，不应在实现层面自行发明映射规则"，B 的做法恰好撞上这条已写明的禁止项，但 AD-21 本身没有拦住它——AD-21 只规定了"解析失败怎么办"，没有规定"解析用什么依据"。

A 和 B 都没有违反 AD-21 的任何一句话，产出的 adapter 行为却完全相反（一个对真实数据永远 degrade，一个悄悄发明了未经裁决的路径推导规则）。这正是本次评审要找的"两个单元各自合规、却不兼容"的洞。

**建议收紧方向：** AD-21（或紧邻它的新 AD）应当把"`sourceRef` 必须先被真实populate 成 `Known`"列为 Story 4.5b 的前置条件，而不是留给实现者自行判断——即要求 `cap-fs.ts`/`seed-from-cap.ts` 路径先修复到产出 `Known(realPath)`，并明确禁止在 Claude adapter 内部从 `name` 反推路径。

### C2 — 物化产物的磁盘布局未钉住，且必须复用的 invocation 目录同时是 `CLAUDE_CONFIG_DIR` 与 `cwd`，构成真实碰撞面

核实 `packages/control-plane/src/adapters/system/claude-invocation-dir.ts` 与 `application/claude-launch.ts`：`FsClaudeInvocationDirPort.prepare(operationId)` 只返回**一个**目录；`launchClaudeFresh` 把这同一个目录同时用作 spawn 的 `cwd` **和** `env.CLAUDE_CONFIG_DIR`。AD-21 的 Rule 只说物化内容"写入既有 invocation 隔离目录（复用 Story 4.3 的 `ClaudeInvocationDirPort`）"，没有钉住这个目录内部的子路径约定。

两个各自合规的 Story 4.5b 实现可以选择不兼容的布局：

- **开发者 A：** 把每个 Skill 解析出的真实内容直接落在 `invocationDir/<skillName>/...`（扁平，位于 `CLAUDE_CONFIG_DIR` 根下），`--plugin-dir` 指向 `invocationDir` 本身。
- **开发者 B：** 新建 `invocationDir/materialized/plugin/`、`invocationDir/materialized/mcp.json` 子树，`--plugin-dir` 只指向 `plugin` 子目录。

两者都符合 AD-21 字面要求。但 A 的布局把任意用户命名的 Skill 目录直接混进 Claude Code 自己用作 `CLAUDE_CONFIG_DIR` 的根目录——而这个根目录是 Claude Code 自己管理内部状态（会话、`settings.json` 等）的地方。本仓代码里没有任何地方校验 Skill/Instruction/MCP 的 `name` 不会撞上 Claude Code 保留的子路径名；一个恰好叫 `settings`、`projects` 之类名字的 capability 就可能覆盖或影子化 Claude 自己的配置内部结构。B 的隔离布局没有这个问题。同一份 AD-21 文本、同一个 `CapabilityReference` 输入，两个实现会让最终 spawn 出来的 Claude 进程表现出真实的行为差异——这正是任务点名要找的"两个开发者各自实现，产出让 Claude 进程行为不同"的具体案例。

另外未钉住的相关点：`--plugin-dir` 在多 Skill 场景下是"一个目录、内部按约定分子目录"还是"每个 Skill 重复一次 `--plugin-dir`"，这是 Claude Code 自身的外部 CLI 契约（spine `sources:` 列表里没有覆盖 `--plugin-dir` 多值/嵌套语义的证据来源），AD-21 只点了 flag 名字，没有点参数基数/嵌套约定，同样留给两个实现各自猜测。

**建议收紧方向：** AD-21 应明确规定 invocation 目录下物化内容的子路径命名约定（按 capability kind 分子目录、且不得与 `CLAUDE_CONFIG_DIR` 根下已知/未来 Claude 自身状态路径同名），并明确 `--plugin-dir` 的基数/嵌套契约来源（若目前无法验证，应显式标为 Unknown 并要求 Story 4.5b 先做一次真实 `--help`/smoke 核实，而不是隐含默认）。

---

## High

### H1 — AD-21 的"终态后清理"与 AD-9 的 invocation 目录 reconcile 生命周期之间没有绑定；当前代码里两者都不存在，任一实现者可能只覆盖崩溃泄露或只覆盖慢子进程竞态中的一种

搜索全仓：目前没有任何代码删除 `claude-invocations/<operationId>` 目录——`FsClaudeInvocationDirPort` 只有 `prepare()`，没有对应的清理方法，`launchClaudeFresh` 也从未调用过任何清理逻辑。AD-21 规定"调用达到任一终态 ... 后，物化产物随其余 invocation 目录一并清理"，但没有说清理的触发点应该挂在哪一层。

`launchClaudeFresh` 目前是 `await deps.claudeProcessPort.spawn(...)` 拿到顶层 `claude` 进程退出码后立刻推导终态——这是最直觉的清理插入点。但 Claude Code 会拉起 MCP server、hook 等子进程（Story 4.1 的 `claude.hook-deny-return-value` 说明本身就承认"未验证真实 hook 触发"），这些子进程未必在顶层 `claude` 进程 wait 返回时已经退出，尤其在本仓目标平台 Windows 上文件锁/句柄语义更严格。两个各自合规的实现：

- **开发者 A：** 在 `spawnResult` resolve 之后同步 `rmSync(invocationDir, {recursive:true})`——如果某个 Claude 派生的子进程仍在读取 `--mcp-config`/`--plugin-dir` 里的文件，会在文件仍被使用时删除（任务描述点名的"慢启动进程竞态"）。
- **开发者 B：** 把清理挪到下一次启动/`reconcile` 扫描时执行（模仿 AD-9 现有的崩溃恢复模式）——这样正常成功的一次运行，其物化产物要等到*下一次* CLI 调用才被清理，窗口无上限；如果用户很久不再运行 CLI，泄露永远不发生清理。

两者都不能同时满足"不泄露"与"不在仍被读取时删除"；AD-21 的文本没有强制实现者把这条清理规则接到 AD-9 已经存在的、专门处理 invocation 工件崩溃恢复的 reconcile 机制上，而是让"终态后清理"读起来像一条可以在流程任意一点插入的独立指令。

**建议收紧方向：** 明确物化产物的清理不是一条独立指令，而是 AD-9 invocation 目录生命周期的一部分——即通过同一个 reconcile 通路（认领非终态 operation → 证明 writer 进程树结束 → 清理），而不是在 `launchClaudeFresh` 内联同步删除；或者至少要求"delete-after-grace-period + 下次 reconcile 兜底"的双重覆盖，而不是让两个实现各选一种。

### H2 — epics.md Story 4.7 的"实现需求"引用了已经不存在的步骤编号，与本次重写的三步顺序脱节

`epics.md` Story 4.7（第 408 行）写"**实现需求：** Architecture Spine'`.cap/` 退役顺序'小节第 4 步（下一轮 `bmad-architecture` 需重写该小节的第 1～3 步，移除'本仓自身切换'这一步的现有表述）"。但本次评审读取的 spine 已经是 2026-08-24 重写后的版本——退役顺序已经收窄为**三步**，"本仓自身切换"已被移除，且不存在"第 4 步"（第 3 步就是"退役 `.cap/` 本体"）。Story 4.7 的这句引用是重写前的状态，尚未同步。

风险不大（Story 4.7 的 AC 正文本身——"Given Story 4.5b 与 Story 4.6 均已完成 ... "——与新三步顺序的意图一致），但一个只看 `epics.md` 而不回去核对 spine 更新时间戳的实现者，可能会去找一个已经不存在的"第 4 步"，或误以为 spine 还没同步重写、退役顺序仍是旧的四步版本。

**建议：** 下一次 spine/epics.md 同步时把这一行的步骤号更新为"第 3 步"，去掉"下一轮 bmad-architecture 需重写"这句已经完成的待办。

---

## 已核查、未构成 Hole 的项（记录以避免重复排查）

- **退役顺序的三步是否可能被人读成"4.5b 或 4.6 二选一即满足"**：不成立。Spine 第 1 步用"并且"连接 probe/plan/launch/interpret、AD-21 内容物化能力、`configs` CLI 真实入口三项，`epics.md` Story 4.7 的 AC 同样显式写"Story 4.5b（内容物化）**与** Story 4.6（CLI 入口）均已完成"，两处都是显式合取，不存在可以只满足其一就推进到第 2 步的读法。
- **AD-21 物化范围是否会被误读为也覆盖 hooks/plugins**：不成立。AD-21 Rule 原文明确限定"每个装配意图引用的 `CapabilityReference`（Instructions/Skills/MCP）"，未提及 hooks/plugins；`claude-launch.ts` 现有的 `computeClaudeKnownDifferences` 也把 hooks/plugins 的"未物化"当作独立于 AD-21 范围之外的既有差异项处理，两处口径一致。

---

## Medium / Low

Medium：0；Low：0（除上方"已核查、未构成 Hole"两项外，未发现额外的次要不一致）。
