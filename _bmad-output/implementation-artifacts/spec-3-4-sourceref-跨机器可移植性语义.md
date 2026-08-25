---
title: 'Story 3.4：裁定并落地 sourceRef 的跨机器可移植性语义'
type: 'feature'
created: '2026-08-25'
status: 'done'
baseline_commit: '3c7a51382382e99d24de38bad596b038f0f572b0'
review_loop_iteration: 1
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `CapabilityReference.sourceRef` 存的是什么路径，从未被任何 AD 或代码约定固定。物化侧把它当可直接使用的路径原样 `cp`／`readFile`；而 AD-22 已裁定第三方 Skill 字节由每台机器各自复现，同一条修订在不同机器上的绝对路径必然不同。AD-22 把这个歧义列为 **critical**：两侧各自发明会让一方产出的修订在另一方手里按 AD-10 静默全量降级，且无门可指根因。

**Approach:** 裁定 `sourceRef` **只有一种合法形态——库内相对路径**，解析侧对单一共用的 `defaultSupplyRoot()` 展开并强制收敛在根内；绝对路径与一切退化形态一律 fail-closed。根是本机配置（环境变量覆盖），不进修订，修订因此可移植。本 Story 只落地解析侧与根，供给侧命令是 Story 3.5。

## Boundaries & Constraints

**Always:**
- **合法形态唯一：** `sourceRef` 是库内相对 POSIX 路径。判定规则（顺序执行，任一不满足即非法）：① 非空；② 不含反斜杠；③ `path.isAbsolute()` 为 false；④ `path.resolve(root, v)` 严格位于根之内——用 `path.relative(root, resolved)` 判定，结果须非空、不以 `..` 开头、且非绝对。
- **非法一律 fail-closed（AD-10）**，记 `unsupported`（必需）／`degraded`（可选），失败原因须同时含原始 `sourceRef` 值与当时生效的根，因为本 Story 的 Problem 就是「无门可指根因」。
- **两侧共用一个 `defaultSupplyRoot()`**，不接受任一侧的单独覆盖入口——单侧覆盖正是 AD-22 判为 critical 的「各自发明」。
- **根按一次调用快照一次：** 在 `materializeClaudeContent` 顶部解析一次并向下传，不在每个引用处重读——三组是 `Promise.all` 并发，重读会让同一条修订的不同引用落在不同根上。
- **根的两种部署场景都要在代码注释与 spec 里写明**（见 Design Notes）：默认值服务发行版用户，本仓自我开发靠环境变量指向仓库根。

**Ask First:** 若发现「相对且收敛」这条规则会让某个**真实存在**的数据形态失效（已核实真实库中 20 个 skill 条目的 `sourceRef` 全为 `Unknown`、Known 零条，故预期为零）；若根的默认值需偏离 `path.dirname(defaultDbPath())` 派生约定。

**Never:** 不新增 `configs supply` 或任何供给子命令（Story 3.5）。不改 `stable_config_revision` schema 或写端口。不为兼容而保留绝对路径通道。不碰 `.claude/skills`／`.agents/skills` 的跟踪状态。

## I/O & Edge-Case Matrix

以下 win32 行为均已实测（根取 `D:\lib`）。

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 合法相对 | `known('skills/a')` | 解析为 `<root>/skills/a` 并物化 | N/A |
| 空串 | `known('')` | `path.resolve` 返回根本身 → **必须拒绝** | fail-closed，含值与根 |
| 当前目录 | `known('.')` | 同样返回根本身 → 拒绝 | 同上 |
| 逃逸 | `known('..')` / `known('../x')` | 解析到根外 → 拒绝 | 同上 |
| 反斜杠 | 值为 `skills` 加反斜杠加 `a` | win32 可解析但 POSIX 上会变成单个文件名 → 拒绝 | 同上 |
| 绝对（带盘符） | `known('C:/x/y')` | `isAbsolute` 为真 → 拒绝 | 同上 |
| 绝对（POSIX 风格） | `known('/x/y')` | win32 上 `resolve` 得 `D:\x\y`（盘符取自根）→ 拒绝 | 同上 |
| 盘符相对 | `known('C:x/y')` | `isAbsolute` 为假但解析到 cwd → 被收敛检查拒绝 | 同上 |
| `Unknown` | `unknown('not-provided', …)` | 与本 Story 之前完全一致的 `{reason}` 分支 | 既有 fail-closed 路径 |
| 环境变量覆盖根 | `CONTROL_PLANE_SUPPLY_ROOT=<tmp>/lib` | 根取该值 | N/A |
| 环境变量为空串 | `CONTROL_PLANE_SUPPLY_ROOT=''` | 视为未设置，回落默认根 | N/A |
| 未设环境变量 | — | `path.join(path.dirname(defaultDbPath()), 'supply')` | N/A |

</frozen-after-approval>

## Code Map

- `src/cli/supply-root.ts` -- **新建**。`defaultSupplyRoot()`：读 `CONTROL_PLANE_SUPPLY_ROOT`，`!== undefined && length > 0` 才采用，否则 `path.join(path.dirname(defaultDbPath()), 'supply')`。照抄 `src/cli/db-path.ts:10-16` 的守卫写法。
- `src/adapters/clients/claude/content-materializer.ts` -- `resolveSourcePath`（`:72-77`）实现上面四条判定，返回解析后路径或类型化 reason。根**不再**在此函数内读取：改由 `materializeClaudeContent`（`:214-217`）顶部解析一次，经 `materializeInstructions`（`:86`，当前无目录参数）／`materializeSkills`（`:119`）／`materializeMcp`（`:170`）传入——这是本轮相对上一版的关键变化，为满足「根按调用快照」。三个调用点 `:95`／`:130`／`:179` 的 `if ('reason' in resolved)` 结构不变。
- `src/adapters/sources/cap-fs.ts:140` -- `resolveSkillSourceRef` 目前产出 `known(resolveCapRelativePath(...))` 即**绝对**路径，新合同下会被拒。改为产出相对 `capRoot` 的 POSIX 路径；其调用方把供给根设为 `capRoot`。该 loader 自 Story 4.7 起只跑夹具，无产品调用方。
- `tests/adapters/claude-content-materializer.test.ts` -- **16 个既有用例的 `sourceRef` 全部是 `mkdtemp` 绝对路径**（`known(...)` 出现在 `:87/:101/:123/:134/:159/:178/:196/:224/:238/:255/:275/:287-288`），新合同下会全部失败，须迁移为「设根 + 相对路径」。`:220-233` 那条 `name` 含 `../../escape` 的用例测的是 `sanitizePathSegment`（写侧），与读侧收敛无关，保留。
- `tests/adapters/cap-fs.test.ts`、`tests/adapters/claude-assembly-manifest.test.ts`、`tests/application/claude-launch.test.ts` -- 消费 `loadCapConfigRevisions` 输出，随 `cap-fs.ts` 改动同步核对。
- `src/domain/config.ts:46` -- `sourceRef: Fact<string>` 的定义处补一句合同说明，供给侧实现者最先看这里。
- `tests/cli/supply-root.test.ts` -- **新建**，覆盖矩阵后三行；env 夹具用**保存并恢复**（不是只 `delete`），两个测试文件保持同一纪律。

## Tasks & Acceptance

**Execution:**（路径与锚点见 Code Map，不在此重复）
- [x] `supply-root.ts` -- 新建根解析
- [x] `content-materializer.ts` -- 四条判定 + 根改为顶部快照并向下传 + 失败原因含值与根 + 中文注释写明裁定与两种部署场景
- [x] `cap-fs.ts` -- skill `sourceRef` 改产出 `capRoot` 相对的 POSIX 路径
- [x] `domain/config.ts` -- `sourceRef` 定义处补合同说明
- [x] `tests/adapters/claude-content-materializer.test.ts` -- 迁移 16 个既有用例 + 覆盖矩阵前九行
- [x] `tests/cli/supply-root.test.ts` -- 新建，覆盖矩阵后三行
- [x] `tests/adapters/cap-fs.test.ts` 等三个消费方测试 -- 随 `cap-fs.ts` 同步

**Acceptance Criteria:**
- Given 同一条带相对 `sourceRef` 的修订与两个不同的根，when 分别物化，then 各自解析到各自根下的真实内容——修订可移植、机器差异只由根承担。
- Given 任一非法形态，when 物化，then 该 capability 记为失败、`pluginDirPath` 为 `null`、且失败原因文本同时包含原始 `sourceRef` 与生效的根。
- Given 一次物化调用，when 其间 `CONTROL_PLANE_SUPPLY_ROOT` 被改动，then 本次调用的全部引用仍解析于同一个根。

## Spec Change Log

- **2026-08-25（loop 1，intent_gap）** — 触发发现：三个审查层独立报出，冻结区 I/O 矩阵「绝对路径原样返回（含 POSIX `/x/y`）」在 win32 上事实错误（实测根取 `D:\lib` 时 `/x/y` 解析为 `D:\x\y`，盘符取自根）；且 `known('')`／`known('.')` 解析为根本身，使 `cp` 把整个供给库当作一个 Skill 拷入并报成功——把 AD-10 的 fail-closed 翻成了 fail-open（verification-gap 层实测复现）。根因在冻结区，按 workflow 判为 intent_gap，已回滚代码并回到负责人。**修订内容：** 负责人 2026-08-25 裁定 `sourceRef` 只允许库内相对路径、绝对路径一律拒绝；据此重写 Intent／Boundaries／I/O 矩阵，新增收敛判定四条规则、根按调用快照、失败原因须含值与根。默认根维持 `$HOME` 派生但要求写明两种部署场景。**避免的已知坏状态：** 一条带空串或 `..` 的修订静默交付整个供给库（或状态目录）并报告启动成功。**KEEP（重新推导后须保留）：** `resolveSourcePath` 作为唯一收敛点、三个调用点不改结构；`defaultSupplyRoot()` 照抄 `db-path.ts` 的 env 守卫形状；「同一修订 + 两个不同根」的可移植性对照测试；`tests/cli/supply-root.test.ts` 的保存并恢复 env 夹具纪律。

- **2026-08-25（loop 2，patch 集）** — 三层审查在实现后复跑，判定为无 intent_gap／无 bad_spec，9 条 patch 已直接应用于代码，其中两条由审查层的真变异证明（把根改回每引用重读 env、把失败信息缩成只有名字，两种变异下 502 全绿——AC3 与诊断信息此前均无测试兜住）。另新增两条本文件级修订：**(a)** Code Map 原写 cap-fs 产出「相对 `capRoot`」且「调用方把供给根设为 `capRoot`」，实现改用 `repoRoot`——经核实这是 Code Map 的错误而非实现偏离：`lock.json` 的 `project_skill_imports[].source` 为 `plugins/grilling/skills/grilling`，位于 `capRoot` **之外**，相对 `capRoot` 会得到 `../plugins/...`，正好被本合同规则拒绝；一条修订的全部引用必须解析于同一个根，故只能取 `repoRoot`。实现同时把 instruction 的 `sourceRef` 一并转为相对（Tasks 只点名了 skill 那条），理由同样是避免一条修订劈成两个根。**(b)** 判定规则新增第「拒绝盘符前缀 `/^[A-Za-z]:/`」一条，且在实现中排在 `isAbsolute` **之前**：同盘符的 `C:x/y` 在 win32 会被 `path.resolve` 折进根内而被接受（且收敛判定转为依赖 `process.cwd()`），`C:/x/y` 在 POSIX 上 `isAbsolute` 为假而被当普通相对名接受——同一条修订两个平台含义不同，正是第②条反斜杠规则成文理由所禁止的。排在 `isAbsolute` 之前是为了让诊断信息本身也平台无关。**避免的已知坏状态：** 一条修订在 Windows 被拒、在 Linux 静默物化；以及本 Story 的核心交付物（含值与根的诊断）在用户可见面上零覆盖、任何人缩短消息都不被发现。**KEEP：** 单一导出谓词 `validateSupplyRelativeRef`（消灭手抄副本、产出侧可自检）；`SUPPLY_REF_REJECTION_MARKER` 断言（使反斜杠规则在 POSIX 腿上也真正被钉住）；AC3 用「同组两个引用 + `queueMicrotask` 翻转」的可确定性形状。
- **2026-08-25（loop 2 补记，本文件缺陷）** — frontmatter 原为 `context: []`，导致实现 agent 无从得知 `AGENTS.md` 的「代码注释语言」规则（bmad-build 的 dispatch 按设计不携带 house-style 内容，`context:` 才是既定通道），新增 201 行注释全为英文。已把 `AGENTS.md` 写入 `context:`，并单独派 patch 改写注释。

## Design Notes

**根的两种部署场景**（本轮新增要求，必须同时写进代码注释）：

| 场景 | 供给库在哪 | 根怎么来 |
| --- | --- | --- |
| 本仓自我开发 | 就是本仓库（`plugins/`、canonical `_bmad/`） | `CONTROL_PLANE_SUPPLY_ROOT` 指向仓库根 |
| 发行版 `configs` 用户 | 机器上没有「本仓库」这个东西 | 默认 `$HOME/.agent-system-state/control-plane/supply` |

默认值只服务第二种。不把默认改成仓库根派生，是因为编译后的二进制没有仓库可派生，绕一圈仍要回退到某个 `$HOME` 约定。

**为什么绝对路径整体拒绝而不是兼容。** 已核实真实库中 20 个 skill 条目的 `sourceRef` 全为 `Unknown`、Known 零条，兼容通道保护不了任何真实数据，却会永久保留一个「两种形态」的歧义面——而歧义正是 AD-22 判为 critical 的东西。

**这条 Story 关闭 AD-22 的一个显式开放项**（AD-22 退役第 (1) 步：「必须一并裁定…禁止两个实现者各自发明」）。裁定本身还需回写 spine，那是本 Story 之外的一次架构 Update，不在此处顺手改。

## Verification

**Commands:**
- `cd packages/control-plane && bunx tsc --noEmit` -- expected: 零错误
- `cd packages/control-plane && bun test` -- expected: 全绿（既有 16 个物化用例迁移后仍验证同样的交付内容）

## Suggested Review Order

**合同本身（先看这里，其余都是它的接线）**

- 五条判定规则的唯一实现；盘符那条刻意排在 `isAbsolute` 之前，让判定与诊断都平台无关
  [`supply-root.ts:91`](../../packages/control-plane/src/cli/supply-root.ts#L91)

- 根的解析：trim、空白视为未设、两个分支都 `path.resolve`，避免相对根重新引入 cwd 依赖
  [`supply-root.ts:35`](../../packages/control-plane/src/cli/supply-root.ts#L35)

- 拒绝标记与原因文本；本 Story 的交付物就是这串「含值与根」的诊断
  [`supply-root.ts:122`](../../packages/control-plane/src/cli/supply-root.ts#L122)

**解析侧接线**

- 根在这里快照一次，向下传给三组；不在引用处重读，否则并发下同一修订会劈成两个根
  [`content-materializer.ts:263`](../../packages/control-plane/src/adapters/clients/claude/content-materializer.ts#L263)

- 唯一收敛点，接参而非自取根；三个调用点结构未变
  [`content-materializer.ts:95`](../../packages/control-plane/src/adapters/clients/claude/content-materializer.ts#L95)

**产出侧自检**

- 声明数据先校验后 join——先 join 会把 `/abs/x` 吞掉；不合法即降级为既有的 Unknown
  [`cap-fs.ts:149`](../../packages/control-plane/src/adapters/sources/cap-fs.ts#L149)

- skill 与 instruction 同时转相对；漏掉任一个会让一条修订劈成两个根
  [`cap-fs.ts:195`](../../packages/control-plane/src/adapters/sources/cap-fs.ts#L195)

**合同的文档面**

- 字段定义处写明合同，供给侧实现者最先看这里
  [`config.ts:57`](../../packages/control-plane/src/domain/config.ts#L57)

**测试（外围）**

- 诊断必须抵达用户可见输出——变异证明此前这条链路零覆盖
  [`cli-claude-launch.test.ts:393`](../../packages/control-plane/tests/integration/cli-claude-launch.test.ts#L393)

- 盘符用例已解除 win32 跳过，两条 CI 腿都断言同一结论
  [`supply-root.test.ts:123`](../../packages/control-plane/tests/cli/supply-root.test.ts#L123)

- 谓词层的规则逐条覆盖
  [`supply-root.test.ts:106`](../../packages/control-plane/tests/cli/supply-root.test.ts#L106)
