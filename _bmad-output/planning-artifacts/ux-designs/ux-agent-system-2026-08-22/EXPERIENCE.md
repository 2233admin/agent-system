---
name: configs（agent-system CLI）
description: configs 信息架构、状态与交互的行为规约，覆盖两个入口——非交互/脚本化的纯文本 argv CLI（list/show/compare 只读查看面 + use/switch/status 有状态启动面，最终交接给 OMP）与面向人类的默认交互式 TUI（浏览列表 + 详情，选中即启动）。启动一个 OMP 会话（use/switch）本身永远是人类为自己发起的动作——AI agent 不调用它，也不会去用装配后的 omp；agent 能协助的是装配本身（不在本文档范围，见 Foundation）。
status: final
updated: 2026-08-22
---

## Foundation

**表现形式：** 终端，双界面。以 Bun 编译的独立可执行文件（`configs`）分发，按平台发布（Bun 编译隐含跨 Windows/macOS/Linux，架构文档未对平台差异做进一步规定）。没有 GUI，没有 Web 界面。启动一个 OMP 会话（`use`/`switch`）本身永远是人类为自己发起的动作——是"我现在要用这个配置开始工作"，不是任何第三方代为触发的事，两个入口都遵守这一点，`[DELTA]` 按调用方分工如下：
- **人类默认路径——交互式 TUI。** `configs` 不带任何子命令、在交互式 TTY 里运行时，进入全屏 TUI（浏览列表→详情，见下方 Information Architecture）。
- **非交互/脚本化路径——纯文本 argv CLI（不变）。** 带任何显式子命令（`list`/`show`/`use`/...）时，无论是否在 TTY 里，永远走本文档已有的、Story 1.1/1.2 已实现的纯文本路径——这条路径的行为在这次 TUI 改动里**完全不变**。**这条路径不是给 AI agent 用来"帮你启动 omp"的**：agent-system 里的 agent 不消费装配后的 omp，也不调用 `use`/`switch`；agent 能协助的是配置的装配本身（PRD 里低频的"Context Assembly"节奏），而装配数据进入 SQLite 走的是这个 CLI 不管的另一条路径（见 Information Architecture）。这条纯文本路径的实际用途是：脚本/CI 之类需要精确按 id 调用、不经过交互式浏览的场景，以及人类自己想跳过 TUI、直接敲命令的习惯用法。

视觉身份定义在 [DESIGN.md](./DESIGN.md)——本文件只管行为。

**UI 系统：** 纯文本 CLI 路径不用任何终端 UI 库——原生 `stdout`/`stderr`/`stdin`，每一行由 `render.ts` 里的纯字符串格式化函数拼出，没有 spinner、没有光标操控、没有备用屏幕缓冲区、没有原地重绘（这部分继承架构 Spine AD-14、AD-15 的既有约束，不受本次改动影响）。**`[DELTA]` TUI 路径用 `ink`**（React-for-terminals），有备用屏幕缓冲区（alt-screen）和原地重绘，但只用于 TUI 自己的两屏；一旦要打印交接提示行或最终状态，TUI 必须先退出 alt-screen、回到普通滚动终端，把这些行为普通纯文本打印（见 Interaction Primitives）。

**本文档范围：** 仍是 MVP——Epic 1，Story 1.1（`list`/`show`/`compare`）与 Story 1.2（`use`/`status`/`switch`）。截至 2026-08-22，两个 Story 都已实现且状态为 `done`；本文档把它们的行为追认为正式契约，并额外规定了四处代码里还没有的改动（语义色彩、交接提示行、中英双语 i18n、交互式 TUI——正文中以 `[DELTA]` 标出）。**TUI 路径本身还包含一处对已有架构假设的偏离：它不展示交互式确认，选中即启动**（见 Interaction Primitives 的详细说明与授权依据）——这是本次改动里唯一动到"确认"这件事的地方，纯文本 CLI 的确认行为不受影响。明确不在本文档范围内：
- 多候选推荐（架构 Spine 已延后，AD-16）
- Bad Case 驱动的演进（架构 Spine 已延后，AD-7/AD-17）
- 跨 client（Claude Code/Codex）支持（架构 Spine 已延后，AD-19/MVP-FR10）
- `compare` 的 TUI 化（用户在这轮讨论里主动延后，不是架构限制）

## Information Architecture

一个可执行文件，三层入口。

**第一层——按调用方式分流（新增）：**

```
configs                    → 交互式 TTY：进入 TUI；非交互/非 TTY：打印帮助文本（同 usage）
configs <subcommand> ...    → 永远走纯文本 CLI，不看 TTY 与否
```

**第二层——纯文本 CLI 的六个子命令（不变）**，不分层、没有交互式菜单，每个能力都是一次单独的 argv 调用：

```
configs list
configs show <id>
configs compare <id> <id> [...ids]
configs use <id> [--client <id>] [--yes] [-- ...args]
configs status [<planId>]
configs switch <id> [--client <id>] [--yes] [-- ...args]
```

两组，对应 PRD 的两种节奏：

- **查询组**（`list`、`show`、`compare`）——只读、无副作用，可以随便跑多少次。回答"现在有哪些配置、它们有什么区别"。
- **激活组**（`use`、`status`、`switch`）——有状态，会创建/读取 `LaunchPlan` 记录，是唯一会启动 OMP 的地方。回答"让其中一个配置真正工作起来"。

没有第七个子命令。`configs sync`/`configs import` 不存在，在本 MVP 范围内也不应该被加进来（见 `cli/index.ts` 头部注释）——配置数据进入 SQLite 走的是另一条这个 CLI 不管的路径。

**`[DELTA]` 第三层——TUI 的两屏**，不是新的子命令，是纯文本查询组/激活组同一批底层操作的另一种触发方式：

```
浏览列表   → 复用 list 的数据，人类可读的名称而非 revision id，逐条标记已知差异
详情       → 复用 show 的数据，已知差异内联展示（不再需要单独的确认摘要）
[Enter]    → 立即触发 use 等价的启动流程（见 Interaction Primitives 的"TUI 自动确认"）
```

TUI 不覆盖 `compare`（本轮延后，纯文本 CLI 里的 `compare` 不受影响）、不覆盖 `switch`/`status`（TUI 会话是一次性的：选中即启动、omp 退出即整个 `configs` 进程退出，见 Interaction Primitives；需要切换配置或单独查状态时仍用纯文本命令）。

IA 闭合性检查：PRD 里 FR-1..FR-14 的每一个诉求，都落在纯文本 CLI 六个子命令之一、`status` 的阶段投影，或 TUI 的两屏之上；没有诉求找不到入口，也没有入口对应不到任何诉求。TUI 的存在没有绕开任何一条既有诉求，只是给其中"选一个配置并使用"这条最高频的路径换了一种人类触发方式。

## Voice and Tone

克制、就事论事、证据克制——直接继承自 Brief 的产品语气，不是 CLI 层面临时发明的。具体体现：

- **平铺直叙地说发生了什么，不软化、不夸张。** "Launch plan {id} failed." 而不是 "哎呀，出错了！"
- **每条失败信息都指向一条具体的恢复命令**，而不是泛泛的道歉（`renderLaunchFailure` 的 `Recovery:` 行、`renderQueryFailure` 的 `Recovery: run configs list...`）。如果一条消息指不出下一步，那是需要修的缺口，不是靠语气软化就能糊弄过去的。
- **绝不假装确定性。** `Fact<T>` 为 `Unknown` 时打印为 `Unknown (<reason>, observed <timestamp>)`，绝不悄悄省略或瞎猜（这是硬性架构不变量 AD-10，不只是文风选择）。
- **不用感叹号，不用 emoji，不用"成功啦！🎉"。** 成功信息和失败信息一样克制：`阶段：succeeded`。（为什么 `succeeded` 这类阶段枚举值不翻译，见下方"输出语言"一节。）
- **空状态解释数据模型，而不是道歉。** `renderEmptyList`："本工具只读取已存储在 SQLite 里的配置修订版本；它自己不创建、不导入、不提供任何配置。"——诚实说明这个工具是什么，呼应 MVP-FR1 自己的定位。

**`[DELTA]` 输出语言：中英双语（i18n），显式切换，不跟随系统区域设置。** 面向用户阅读的说明性文本（字段标签、区块标题、确认/失败/切换提示句、交接提示行等）提供中/英两套完整文案；默认语言为中文（`zh`），通过环境变量 `CONFIGS_LANG=en` 显式切换为英文——这是相对当前实现（只有英文一套字符串）的第三处改动建议。不跟随 `LANG`/`LC_ALL` 系统区域设置：一是这台机器的系统区域不一定代表这个终端会话里实际读输出的人是谁（同一台机器上，中文用户和被邀请协作的英文用户可能共用同一个系统区域设置）；二是与本文档已经定下的 `NO_COLOR`/非 TTY 那条"显式环境变量优先于隐式推断"的规则保持同一套心智模型，用户不用分别记两套推断规则。命令名、子命令、参数名/flag（`list`/`show`/`compare`/`use`/`status`/`switch`、`--yes`、`--client`、`CONFIGS_LANG` 本身），以及 `LaunchPlan.phase` 等封闭枚举值（`succeeded`/`failed`/`degraded` 等），都保持英文标识符不变，理由一致：它们是可能被脚本/`grep` 匹配的稳定值，不是给人读的说明性文本，这是 argv/环境变量的语法惯例，与显示语言无关（类似 `git`/`npm` 全球统一命令名）。`[y/N]` 这类输入格式提示两种语言下都保留原样，是被广泛识别的通用约定。

**文案对照表**（zh/en 两套目标文案，供实现直接作为 i18n 文案表使用；en 列与当前实现的英文字符串一致，未做改写）：

| 用途 | 中文（zh，默认） | English（en，`CONFIGS_LANG=en`） |
|---|---|---|
| 配置名字段 | `配置：` | `Configuration:` |
| 修订版本字段 | `修订版本：` | `Revision:` |
| 状态字段 | `状态：` | `Status:` |
| 边界字段 | `边界：` | `Boundary:` |
| 客户端字段 | `客户端：` | `Client:` |
| 客户端版本字段 | `客户端版本：` | `Client version:` |
| 阶段字段 | `阶段：` | `Phase:` |
| 应用结果字段 | `应用结果：` | `Apply result:` |
| 能力分组标签 | `指令：` / `技能：` / `MCP：` / `钩子：` / `插件：` | `Instructions:` / `Skills:` / `MCP:` / `Hooks:` / `Plugins:` |
| 空能力分组 | `（未配置）` | `(none configured)` |
| 对比中空分组 | `（比较的修订版本中均未配置）` | `(none in any compared revision)` |
| 已知差异标题（有内容） | `已知差异（本 MVP 不会完整应用）：` | `Known differences (will not be fully applied in this MVP):` |
| 已知差异（status，无内容） | `已知差异：（无）` | `Known differences: (none)` |
| 转发参数回显标题 | `在 \`--\` 之后原样转发给 \`omp\`：` | `` Forwarded to `omp` verbatim after `--`: `` |
| 一次性确认收尾句 | `这是本次启动计划的一次性确认——之后不会再询问。` | `This is a one-time confirmation for this launch plan -- nothing else will ask again.` |
| 确认提示 | `是否继续启动？[y/N] ` | `Proceed with this launch? [y/N] ` |
| 取消/未启动 | `启动计划 {id} 已取消：{reason}。` / `OMP 未启动。` | `Launch plan {id} was cancelled: {reason}.` / `OMP was not started.` |
| 未完成/失败首句 | `启动计划 {id} 未完成。` / `启动计划 {id} 失败。` | `Launch plan {id} did not complete.` / `Launch plan {id} failed.` |
| 原因/恢复建议字段 | `原因：` / `恢复建议：...` | `Reason:` / `Recovery: ...` |
| 切换-需要重启句 | `当前 OMP 进程（计划 {id}）现在需要重启才能使用新配置。` | `Current OMP process (plan {id}) now requires a restart to use a new configuration.` |
| 切换-新计划已创建句 | `已为修订版本 {revisionId} 创建新的启动计划（{planId}），等待新的确认。` | `A new launch plan ({planId}) was created for revision {revisionId} and awaits a fresh confirmation.` |
| 切换-旧进程不受影响句 | `当前进程不会被原地修改，也不会自动恢复。` | `The current process is not modified in place and will not auto-resume.` |
| 交接提示行 | `终端控制权已交给 omp——直到它退出前，这个终端都是 omp 的。` | `Handing off to omp — this terminal is omp's until it exits.` |
| `[DELTA]` TUI 已知差异标记（追加在名称后） | `（有已知差异）` | `(has known differences)` |
| `[DELTA]` TUI 浏览列表页脚提示 | `↑↓ 选择 · enter 启动 · → 详情 · q 退出` | `↑↓ select · enter use · → details · q quit` |
| `[DELTA]` TUI 详情面板页脚提示 | `enter 启动 · esc 返回 · q 退出` | `enter use · esc back · q quit` |

这份对照表不穷尽所有字符串，但覆盖了每个 Component Pattern 里点名的关键句子，足够作为实现 i18n 文案表的起点；未列出的字符串按同样的语气规则（克制、指向具体恢复动作、不夸张）在两种语言下类推翻译。阶段枚举值不翻译的理由见上文。

## Component Patterns

以下是行为规约；每一项对应的视觉处理见 DESIGN.md 的 Components 一节里同名的 `{components.*}` token。

- **列表行** — 每个修订版本一行：名称、revision id、default/generic 标记、可用性；下方缩进一行 `boundary:`。行不会截断配置名。
- **详情块** — 单个修订版本的完整视图：身份字段，然后是固定顺序的能力分组（Instructions、Skills、MCP 始终显示，哪怕为空；Hooks、Plugins 只在非空时显示）。顺序固定，让用户在多次 `show` 之间扫读时能建立稳定的心智地图。
- **对比块** — 先是标量字段（每个都标注 `[same]`/`[different]`/`[unknown]`），然后是能力分组，每条都显示哪些被比较的修订版本 `missingIn:`，只在真正有差异时才展示按来源类别的拆分明细（不会用一堆多余的 "same" 行填充）。
- **确认摘要**（仅纯文本 CLI 路径；TUI 路径没有这个组件，见下方 `[DELTA]` TUI 两屏与 Interaction Primitives） — 每次启动尝试只出现一次，紧接在 yes/no 提示之前：身份信息、client + client 版本（一个 `Fact`，可能打印 `Unknown`）、实际会被请求的能力分组，然后——仅当非空时——一个"Known differences"区块，说明这个 MVP 不会落实的部分，然后——仅当非空时——原样回显的转发参数，最后是结尾"这是一次性确认"的句子。会为空的区块整段省略，绝不在这里写"(none)"（这点和详情块不同——详情块里"(none configured)"是有意义的信息，而确认摘要追求的是可扫读性，不是穷举完整性）。
- **`[DELTA]` 交接提示行** — 新增，两个界面共用。确认通过的瞬间（纯文本 CLI：交互式确认或 `--yes`；TUI：按下 `Enter`）、`omp` 接管 stdio 之前，打印一行：`终端控制权已交给 omp——直到它退出前，这个终端都是 omp 的。` 在此之后，直到 `omp` 退出、控制权返回之前，`configs` 不再有任何输出（见 Interaction Primitives）。
- **状态块** — 修订版本、client、client 版本、阶段、应用结果、已知差异（为空时显示 `(none)`——这一处**确实**要穷举，因为 `status` 存在的目的就是被检查，可能是被工具检查）。绝不显示任务目标、对话内容、工具调用、任务进度或结果（架构边界——这个入口是启动计划状态，不是 agent 可观测性面板）。
- **失败块** — 首句要区分 `cancelled`（用户主动拒绝）、`failed`（非零退出码）、`incomplete`（被杀死/无法确定退出码）——三句不同的话，绝不合并成一句笼统的"没成功"。永远以指向下一步命令的 `Recovery:` 行结尾。
- **切换已接受块** — 在 `switch` 针对一个活跃计划被接受的瞬间打印，早于新计划自己的确认摘要：说明**旧**进程现在需要重启、不会自动恢复，**新**计划已创建、等待它自己的全新确认。绝不暗示切换本身已经完成。
- **不支持的 client 消息** — 立即、单行，在任何仓储被打开或计划被创建之前打印（`renderUnsupportedClient`）。没有计划，没有确认，没有半吊子状态。
- **`[DELTA]` TUI 浏览列表行** — 复用列表行的数据（名称、default/generic 标记、可用性），但主键换成人类可读的名称，revision id 不在这一屏出现（不需要，选择靠方向键，不靠复制粘贴）。若该修订版本存在已知差异，名称后追加一个文字标记（不是图标）。
- **`[DELTA]` TUI 详情面板** — 复用详情块的全部内容（身份字段 + 固定顺序的能力分组），另加：已知差异直接内联展示在这一屏里，作为常规信息的一部分，不再是"确认前才揭示"的专属区块——用户在按下启动键之前，只要看过这一屏就已经看到了会不会 degraded。

## State Patterns

`LaunchPlan.phase` 是一个封闭的 10 值集合（`domain/activation.ts`）；每个值都对应唯一一个 DESIGN.md 颜色角色，绝不含糊呈现：

| 阶段 | 含义 | 颜色角色 | 是否终态 |
|---|---|---|---|
| `prepared` | 计划已创建，尚未展示给用户 | neutral | 否 |
| `awaiting-confirmation` | 纯文本 CLI：确认摘要已展示，等待 y/N；TUI：同一阶段照样经过，但被程序化立即确认（不展示交互确认，见 Interaction Primitives 的"TUI 自动确认"），人类不会看到这个阶段停留 | neutral | 否 |
| `applying` | 已确认，即将/正在启动 `omp` | neutral | 否 |
| `observing` | `omp` 已启动，等待其退出 | neutral | 否 |
| `succeeded` | `omp` 退出码为 0，所有能力都已应用 | success（绿） | 是* |
| `degraded` | `omp` 退出码为 0，但存在已知差异 | degraded（黄） | 是* |
| `failed` | `omp` 退出码非零，或准备阶段失败 | failure（红） | 是 |
| `incomplete` | `omp` 结束但无法确定退出码（被信号终止） | failure（红） | 是 |
| `cancelled` | 用户在纯文本 CLI 路径拒绝了那唯一一次确认（TUI 路径不会到达这个阶段——见 Interaction Primitives） | attention（黄） | 是 |
| `requires-restart` | 之前 `succeeded`/`degraded` 的计划被 `switch` 取代 | attention（黄） | 是 |

\* `succeeded`/`degraded` 还能再接受一个事件（`switch-requested` → `requires-restart`）——是仅有的"感觉不那么终态"的终态，本文档的实现方不能像对待 `failed`/`cancelled`/`incomplete` 那样把它们当成永久冻结。

任何一个阶段都不能被自造或改述——每一条渲染出来的阶段字符串都必须是这 10 个词之一（或者对于纯查询失败，是另一个封闭的 `ConfigQueryError` 类型 `config-not-found`/`config-unsupported`，它们不是 `LaunchPlan` 的阶段，绝不能和阶段混为一谈）。

## Interaction Primitives

- **`[DELTA]` TUI 键位，只用键盘。** 浏览列表：`↑`/`↓` 移动选中行，`Enter` 立即启动选中的配置（见下方"TUI 自动确认"），`→`（或 `i`）查看详情，`q` 退出 TUI（此时从未创建过 `LaunchPlan`）。详情面板：`Enter` 启动，`Esc` 返回列表，`q` 退出。不需要鼠标，也不提供鼠标交互——键盘操作是唯一路径，见 Accessibility Floor。
- **只确认一次（纯文本 CLI 路径）。** 每次启动尝试有且只有一次确认，作用域绑定 `operationId + planHash`（架构 AD-3/AD-7）。`--yes` 跳过交互式提示，但不跳过确认这个**事件本身**——计划依然按同样的方式经过 `awaiting-confirmation → applying`。UX 绝不能在此之上再加一道"你真的确定吗"的关卡，也绝不能让 `--yes` 跳过交互路径本该先展示的内容（摘要永远在提示/flag 被求值之前打印）。这条规则只约束纯文本 CLI 路径；TUI 路径的确认方式见下面"TUI 自动确认"一条。
- **模糊输入立即失败，绝不挂起（纯文本 CLI 路径）。** `y`/`yes`（大小写不敏感）是唯一的肯定回答；其他任何输入——包括空输入或过早的 stdin EOF（stdin 被关闭/从 `/dev/null` 重定向、且未带 `--yes`）——都立即视为拒绝，绝不挂起。（这是本分支刚修复过的真实 bug；这个行为现在是承重的，不是偶然的。）
- **`[DELTA]` TUI 自动确认，不展示交互确认。** TUI 里选中一个配置按 Enter，直接触发启动——不会看到 y/N 提示或确认摘要屏。技术上这**不是**跳过了 `LaunchPlan` 的确认事件，而是复用了 `--yes` 已经在用的同一条路径：`prepareLaunchPlan` 之后立即程序化调用 `confirmLaunchPlan`，计划依然按同样的方式经过 `awaiting-confirmation → applying`，`operationId + planHash` 绑定不变——领域模型和架构不变量（AD-3/AD-7 的"一次确认上限"）没有被突破，只是 TUI 从不要求人类对这个已经存在的事件做交互式应答。**这是一次经负责人明确拍板的、对"人类必须交互式确认"这一假设的偏离**，理由：TUI 能在选中之前就把已知差异这类风险信息摆在浏览列表和详情面板里（见 Component Patterns），选中这个动作本身已经承载了确认的意图，不需要再问一遍。纯文本 CLI 路径不受影响，仍然保留交互式 y/N 与 `--yes`。
- **终端交接，两个界面共用。** 确认通过后（纯文本 CLI：交互式确认或 `--yes`；TUI：按下 Enter 那一刻），`omp` 以 `stdio: ['inherit','inherit','inherit']` 被启动——整个终端的控制权转移给 `omp`，直到它退出。**`configs` 这个 OS 进程本身并没有退出**：它把终端的可见性和输入焦点让给了 `omp`，自己在后台存活、静默等待 `omp` 的退出码/信号，因为只有这样才能推导 `succeeded`/`degraded`/`failed`/`incomplete`（`deriveOutcome`）、写回 `LaunchPlan`、满足 AD-10 的观测/reconcile 要求——绝不能确认完就让 `configs` 先行退出、把 `omp` 变成没人观测的孤儿进程。`{components.handoff-line}`（DESIGN.md）就是"这即将发生"的明确信号；TUI 触发时，这一行在 alt-screen 退出之后才打印（普通滚动终端上的纯文本，不是 TUI 渲染的一部分）。从交接提示行到 `omp` 退出之间，两个界面都不打印任何东西、不控制任何东西——这是 `omp` 的屏幕。
- **`[DELTA]` TUI 一次性退出，不循环回 TUI。** `omp` 退出后，`configs` 打印最终状态——复用纯文本 CLI 已有的状态块（{components.status-line} 等，不是新画一屏）——然后整个 `configs` 进程退出，控制权回到用户真正的 shell，**不会**重新进入 TUI 的浏览列表。这是刻意的：启动是这条会话里最后一件事，没有理由再把用户留在一个交互界面里。TUI 里也没有"取消/拒绝"这个出口——没有确认动作可拒绝；用户想不启动，只要不按 Enter、按 `q` 退出即可，这种情况下从未创建过 `LaunchPlan`，跟纯文本 CLI 的 `cancelled`（先创建了 `awaiting-confirmation` 的计划、再显式拒绝）是两回事，不要混用这两个词。
- **非交互/脚本化模式。** `--yes` 配合被重定向的 stdin，让每条激活命令都可脚本化。**退出码契约：** `0` = 命令按报告的结果跑完了（查询成功，或启动到达 `succeeded`/`degraded`）；`1` = 一种已定型、预期内的失败（查询未找到/不支持，启动 `failed`/`incomplete`/`cancelled`，不支持的 client）；`2` = 用法错误（参数有问题，从未触达存储层或 `omp`）。退出码为 `0` 只证明命令跑完了，从不证明某个配置被独立地*验证过*——这个区分是架构层面（AD-10）定的，本文档不放松它。
- **不做热重配置。** `switch` 从不修改正在运行的 `omp` 进程。它永远在旧计划上产生 `requires-restart`，并创建一个需要自己全新确认的新计划。没有"热应用"这回事。
- **黑名单转发参数在产生任何副作用之前就被拒绝。** `use`/`switch` 之后 `-- <args>` 会原样转发给 `omp`，除了一个固定黑名单（`-e`/`--extension`、`--profile`、`-c`/`--continue`、`-r`/`--resume`、`--session-dir`）——这些在解析阶段就被拒绝，早于任何仓储被打开或计划被创建，用来维护单一扩展来源/隔离 profile/不自动恢复这几条保证。

## Accessibility Floor

本次的严肃程度是个人项目/hobby（不是受监管场景，也不是面向广泛消费者的产品）——以下是底线，不是一次详尽审计：

- **颜色绝不承重。** 每个阶段/结果本来就配有一句纯文字说明；去掉全部颜色后，每条消息必须依然完全正确、不含糊（印证 DESIGN.md"叠加信息、非唯一信道"的规则）。
- **遵循 `NO_COLOR`。** 当环境变量 `NO_COLOR` 被设置（任意值）时，不输出任何 ANSI 编码，无一例外——这是事实上的标准（`no-color.org`），`git`/`gh` 也遵循它。
- **`[DELTA]` `CONFIGS_LANG` 显式切换输出语言。** 默认中文；设置 `CONFIGS_LANG=en` 切换为英文，照顾不读中文的协作者。不跟随系统 `LANG`/`LC_ALL`——与 `NO_COLOR` 同一套"显式环境变量优先于隐式推断"的心智模型，见 Voice and Tone 的文案对照表。
- **非 TTY 时自动关闭颜色。** 当 `stdout` 不是 TTY（被管道传输、被重定向、被另一个工具捕获）时，无论 `NO_COLOR` 是否设置，颜色都自动关闭，与 `git`/`gh` 的做法一致——机器消费者永远不需要解析 ANSI 转义序列才能拿到干净的值。
- **纯顺序文本（纯文本 CLI 路径）。** 没有制表符绘图，没有多栏布局，没有光标重定位——输出通过屏幕阅读器或没有任何特殊处理的基础终端从上到下读取都是正确的。
- **宁可立即失败也不挂起（纯文本 CLI 路径）。** 模糊/缺失的输入（见 Interaction Primitives）永远立即得到结果，而不是让进程——以及用户——无限期等待。
- **`[DELTA]` TUI 的可访问性代价，以及为什么可以接受。** 全屏 alt-screen 界面天生比线性纯文本更难被屏幕阅读器正确处理——这是接受的取舍，不是忽略的问题：本次严肃程度是个人项目，且**纯文本 CLI 路径原样保留、行为完全不变**，任何需要线性、可被屏幕阅读器正确读取输出的场景，随时可以用显式子命令（`configs list`/`configs use <id> --yes` 等）代替 TUI，不存在"只能用 TUI"的强制路径。
- **`[DELTA]` TUI 只用键盘，不要求鼠标。** 见 Interaction Primitives 的键位说明——所有操作都有键盘路径，没有仅靠鼠标才能触发的功能。
- **`[DELTA]` TUI 在过窄/过矮终端下的兜底。** 不追求为极端小尺寸终端做专门的响应式布局（超出本次个人项目的范围）；`ink` 默认的换行/截断行为兜底即可，但终端过小时必须优雅降级（内容换行或省略），不能崩溃或无提示地卡死。

## Key Flows

以下是一条有代表性的端到端路径，把上面各节定义的入口、状态和交互原语串成一次真实使用——不是一份详尽的流程目录，而是校验"这些规约拼在一起是否真的可用"的一个样本。

### Wren 处理一个晚间任务

Wren 就是 Brief 里描述的那种实践者：一个人，做几种不同性质的真实工作，手头有几个之前会话里已经搭好、验证过的稳定配置——一个是专注写作用的，一个是 MCP 面更广的研究向配置。今天是工作日晚上，Wren 只有二十分钟，只想让研究配置跑起来，不想折腾，也懒得回忆任何 revision id。

1. Wren 直接敲 `configs`，不带任何参数。TTY 是交互式的，进入 TUI 浏览列表。列表按人类可读的名字排列——`general`、`writing-v1`、`research-v3`——不是 sha256 hash。`research-v3` 这一行名字后面带着一个黄色的文字标记：有已知差异。
2. Wren 按 `→` 看一眼详情，查看这个差异是什么：这个修订版本声明了这次 MVP 还落实不了的某些 Instructions，其余 Skills/MCP 都会正常生效。信息已经摆在这一屏上，不需要等到"确认"那一步才揭晓。
3. Wren 按 `Esc` 回到列表，选中 `research-v3`。
4. **高潮点：** Wren 按下 `Enter`。没有确认提示，没有摘要屏——启动立即开始。这正是这次改动想要的效果：选中即启动；差异早在第 2 步就已经被看到，不需要再被问一遍"确定吗"。
5. TUI 退出 alt-screen，打印一行交接提示（`终端控制权已交给 omp——直到它退出前，这个终端都是 omp 的。`），屏幕变成 `omp` 自己的界面。`configs` 这个进程本身**没有退出**——它安静地活着，等 `omp` 退出后才能拿到真实的退出码/信号。
6. 二十分钟后，Wren 做完了，退出 `omp`。控制权回到 `configs`：打印最终状态，黄色的 `阶段：degraded`，与第 2 步在详情面板里看到的差异说明一致——然后 `configs` 进程整个退出，Wren 直接回到自己平时用的 shell 提示符，**不会**被拽回 TUI 里。
7. 下周，Wren 想在不手动重启的情况下把当前会话切回写作配置。TUI 目前不覆盖 `switch`（本轮延后），于是 Wren 在另一个终端里、`omp` 仍在运行时跑纯文本命令 `configs switch writing-v1`——这条路径的行为跟这次改动之前完全一样：`configs` 打印切换已接受块（当前进程现在需要重启、一个新计划已创建），然后是这个新计划自己的确认摘要，然后等待交互式 `[y/N]`。TUI 的"选中即启动"不适用于这里——`switch` 只存在于纯文本 CLI，保留原有的一次交互确认。

这段旅程里的每一步都对应一个已经存在的入口（信息架构闭合性：TUI 的两屏、纯文本 CLI 的六个子命令，没有发明第七个命令，也没有发明新阶段）。

### 一个容易搞混的边界：agent 在这条流程里完全不出现

如 Foundation 所述，启动 OMP 会话永远是人类为自己触发的动作，agent-system 里的 AI agent 不调用 `configs use`/`switch`；agent 能帮上忙的地方是配置装配本身，那件事发生在这六个子命令之外。这段旅程之所以从头到尾没有出现任何 agent，正是因为这一步——"选中 `research-v3`、按 Enter"——本质上是 Wren 在替自己按下开始工作的按钮，不是任何自动化代劳的环节。
