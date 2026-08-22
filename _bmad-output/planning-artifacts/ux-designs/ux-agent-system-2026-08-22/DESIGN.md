---
name: configs（agent-system CLI）
description: 用于查看/比较稳定 Agent 配置修订版本、并通过 OMP 启动的终端产品，双界面共用一套视觉语言——面向人类的默认交互式 TUI（`ink`）与非交互/脚本化的纯文本 argv CLI（不变）。启动 OMP 会话永远是人类为自己触发的动作，不是 AI agent 代为操作；两个界面都不为此设计。没有 GUI，没有 Web 界面——终端本身（渲染在用户自己的配色方案上）就是全部视觉系统。
colors:
  success:
    note: 'ANSI 绿色（终端原生 SGR，不是固定 hex）——自动适配用户自己的终端主题，无论浅色还是深色。'
  degraded:
    note: 'ANSI 黄色——与 attention 同一角色族。'
  failure:
    note: 'ANSI 红色。'
  attention:
    note: 'ANSI 黄色——需要用户采取行动，但不是失败（例如 requires-restart）。'
  neutral:
    note: '终端默认前景色——所有正文文本，以及所有进行中阶段（prepared、awaiting-confirmation、applying、observing）。'
  dim:
    note: 'ANSI 暗淡色（SGR 2）——次要文本：revision id、plan id、提示语、恢复指引。永远不作为用户必须采取行动的信息的唯一信号。'
typography:
  note: '完全继承自用户的终端模拟器（等宽字族、字号、行高）。应用层不控制任何字体——只控制 ANSI 颜色/字重（bold、dim）和纯文本排版（缩进、空行）。'
rounded:
  note: '不适用——终端输出没有圆角。'
spacing:
  indent-group: '2 空格——顶层"字段：值"（全角冒号）及列表项缩进（例如 "Revision:"、"- <name> revision=..."）。'
  indent-nested: '4 空格——嵌套在分组标签下的能力条目（例如 "    - <skill-name> [source: ...]"）。'
  indent-detail: '6 空格——嵌套在能力条目下的第三层细节（例如 compare 中按修订版本拆分的来源类别明细）。'
  section-gap: '1 个空行——分隔单条命令输出内部的逻辑区块（例如头部字段块、能力分组、已知差异之间）。'
components:
  status-line:
    role: '默认 {colors.neutral}；一旦 LaunchPlan.phase 到达已确定状态，重新着色为 {colors.success}/{colors.degraded}/{colors.failure}/{colors.attention} 之一。'
    weight: 'plain'
  list-row:
    role: '{colors.neutral} 文本，配置名不着色，default 标记不着色，revision id 用 {colors.dim}。'
  detail-block:
    role: '{colors.neutral}；字段标签加粗，值不加粗；能力分组标签加粗；"（未配置）"/"（比较的修订版本中均未配置）" 用 {colors.dim}。'
  confirmation-summary:
    role: '仅纯文本 CLI 路径使用（`use`/`switch` 交互式 y/N 前）：与 detail-block 相同，另加："已知差异" 区块标题用 {colors.attention}，每条差异用 {colors.neutral}；结尾确认句用 {colors.dim}。TUI 路径不展示这个组件——已知差异改为在 {components.tui-list-row}/{components.tui-detail-panel} 里内联展示，见 EXPERIENCE.md。'
  handoff-line:
    role: '{colors.dim}，只打印一次，紧接在终端交给 omp（stdio inherit）之前——之后不再打印，进程边界本身就是下一个视觉事件。两个界面共用同一行文案；从 TUI 触发时，必须先退出 ink 的 alt-screen、回到普通滚动终端，这一行才能打印——它永远是纯文本，从不在 alt-screen 内渲染。'
  failure-block:
    role: '首句用 {colors.failure}（failed/incomplete）或 {colors.attention}（cancelled——用户的选择，不是故障）；"阶段："/"原因：" 用 {colors.neutral}；"恢复建议：" 用 {colors.dim}。'
  switch-accepted-block:
    role: '"需要重启"那句用 {colors.attention}；其余用 {colors.neutral}。'
  tui-list-row:
    role: '{colors.neutral} 文本；选中行整行加 reverse video（SGR 7，一个修饰符，不是新颜色，行内文字/标记颜色不变）；名称之后若该修订版本存在已知差异，追加一个 {colors.attention} 的文字标记（不是符号/图标，见 Do''s and Don''ts）。'
  tui-detail-panel:
    role: '与 {components.detail-block} 内容相同，另加：已知差异直接内联展示（{colors.attention} 标题），不再等待一个专门的确认摘要屏幕。'
  tui-footer-hints:
    role: '{colors.dim}，屏幕底部单行按键提示（如 "↑↓ 选择 · enter 启动 · → 详情 · q 退出"），随当前屏幕更新提示内容，不常驻额外信息。'
status: final
updated: 2026-08-22
---

## Brand & Style

`configs` 除了一个规矩的 Unix CLI 本来就有的东西之外，没有额外的视觉身份：用户自己的终端。没有 logo，没有自定义字体，没有装饰性外壳。它全部的"品牌感"就是一小套克制的行为约定——纯文本永远先可读，颜色只是加速手段而非必需项，失败永远说清楚发生了什么、下一步该做什么。这和 `git`、`gh` 的姿态是一致的，也刻意呼应了源头 Brief 的语气：精确、证据克制、不夸大、对 Unknown 诚实。

**`[DELTA]` 双界面，同一套克制。** `configs` 现在有两个入口：给人用的默认交互式 TUI（无参数运行时，`ink` 构建），非交互/脚本化的纯文本 argv CLI（带子命令时，行为完全不变，见本文档其余部分；谁用这条路径、为什么，见 frontmatter description 与 EXPERIENCE.md 的 Foundation）。TUI 不是"更花哨的版本"——它继承同一套颜色角色、同一套不用图标/emoji 的纪律，只是把纯文本 CLI 里"重新 list 一遍、复制一整串 hash"这个必须的手工步骤，换成方向键选择。两个界面共享同一套底层操作（`prepareLaunchPlan`/`confirmLaunchPlan`/`launchOmp`），TUI 只是换了一层怎么触发它们。

## Colors

`configs` 使用终端自身的 16 色 ANSI 调色板（`SGR` 编码），从不使用固定 hex 值——这样 CLI 在用户选择的浅色或深色终端主题下都能正确显示，自己不做任何深色模式逻辑。四个与 `LaunchPlan.phase`/命令结果一一对应的语义角色，外加两个不对应任何阶段的辅助角色（neutral、dim）：

- **`{colors.success}`（绿色）** — `succeeded`。没有其他任何地方用绿色。
- **`{colors.degraded}`（黄色）** — `degraded`（启动成功了，但某些已配置的能力——Instructions/MCP/Hooks/Plugins——在这个 MVP 里没有被实际落实，见 `computeKnownDifferences`）。
- **`{colors.failure}`（红色）** — `failed`、`incomplete`。只保留给用户没有主动选择的结果。
- **`{colors.attention}`（黄色，与 degraded 同值）** — `requires-restart`，以及确认摘要/详情面板里的 "已知差异" 标题。表示"你应该看一眼、必要时采取行动"，但不暗示出了故障。`cancelled` 也用这个角色，而不是失败红——拒绝纯文本 CLI 路径那唯一一次确认是正常、正确的结果，不是错误（TUI 路径不展示交互式确认，也就没有 `cancelled` 这条出口，见 EXPERIENCE.md）。
- **`{colors.neutral}`** — 其余所有内容，包括所有进行中阶段（`prepared`、`awaiting-confirmation`、`applying`、`observing`）。一个阶段在落定之前不会被着色。
- **`{colors.dim}`** — 次要、非承重文本：id、提示、恢复指引、交接提示行。

**颜色永远是叠加信息，绝不是唯一信道。** 每个阶段和结果本来就已经配有一句纯英文（当前实现）说明（`renderLaunchFailure`、`renderLaunchStatus`）——颜色只是在支持颜色的终端上加快扫读速度，去掉颜色后文字本身必须仍然完全正确。对应的 `NO_COLOR`/非 TTY 契约见 EXPERIENCE.md 的 Accessibility Floor。

## Typography

不归本产品所有。字族、字号、行高由终端模拟器提供；`configs` 只会请求 `bold`（字段标签、区块标题）或 `dim`（次要文本）这两种字重变化，两者都是通用支持的 SGR 属性。不用斜体，不用下划线做装饰（下划线留给终端自己的超链接渲染，`configs` 不使用）。

## Layout & Spacing

**纯文本 CLI：** 一切都是左对齐、按行排列的文本——没有分栏，没有表格，没有制表符绘图字符。结构来自三级缩进（`{spacing.indent-group}`、`{spacing.indent-nested}`、`{spacing.indent-detail}`）和 `{spacing.section-gap}` 空行分隔的逻辑区块，与 `render.ts` 中已有的实现（`renderList`、`renderDetail`、`renderComparison`、`renderConfirmationSummary`）完全一致。不强加换行逻辑——较长的值（能力摘要、转发参数）原样打印，由终端自己决定如何换行。没有固定内容宽度，不对终端列数做任何假设。

**`[DELTA]` TUI：** 每屏三个纵向区域：内容区（列表或详情，占满剩余高度）、一条水平分隔线（连续的 `─` 字符，不是边框）、底部一行 `{components.tui-footer-hints}`。不用制表符画满整个屏幕的框。内容区内部沿用纯文本 CLI 同一套缩进/空行规则——TUI 不是重新发明了排版系统，只是把它塞进了一个全屏、可重绘的区域里。同样不假设固定终端列数，随窗口宽度自适应换行。

## Elevation & Depth

纯文本 CLI 不适用——行流没有 z 轴。**`[DELTA]` TUI 同样不引入层次：** 一次只显示一屏（列表或详情），没有叠加面板、没有弹窗、没有阴影。选中态用 reverse video 表达，不是"抬高"或"高亮发光"的视觉隐喻——TUI 和纯文本 CLI 在"没有深度"这件事上是一致的。

## Shapes

纯文本 CLI 不适用——没有圆角，没有边框，没有制表符绘图。（一个纯文本工具一旦开始画框，就是从"传达信息"变成了"装饰"——见 Do's and Don'ts。）**`[DELTA]` TUI 唯一的形状元素是** `{spacing.section-gap}` 替代品——内容区与 `{components.tui-footer-hints}` 之间的一条水平分隔线；不用制表符给整个屏幕或每个面板画框，不用圆角，不用箭头/圆点等图形符号表达选中（选中只用 reverse video）。

## Components

- **`{components.status-line}`** — 命名一个 `LaunchPhase` 或查询结果的那一个词，无论出现在哪（"状态：..."、"阶段：..."）。落定之前中性色，落定后按上面的映射重新着色。
- **`{components.list-row}`** — `configs list` 的一行：`- <name>  revision=<id>  [<default|generic>]  status=<available|Unknown (...)`，加上其下缩进的 `boundary:` 行。revision id 调暗，因为它是查找键而不是主要扫读目标（名字才是）。
- **`{components.detail-block}`** — `configs show`/`compare` 顶部：加粗字段标签，普通值，加粗能力分组标签（`Instructions:`、`Skills:`、`MCP:`、`Hooks:`、`Plugins:`）。
- **`{components.confirmation-summary}`** — 一次性的启动前摘要（`renderConfirmationSummary`）：一个 `detail-block` 该有的都有，另加：有内容时才出现的、attention 色的"已知差异"标题；有内容时才出现的、调暗的转发参数回显；调暗的结尾"一次性确认"提示句。
- **`{components.handoff-line}`** — 新增组件（见 EXPERIENCE.md 的 Interaction Primitives——"终端交接"）：用户确认通过、`omp` 接管 stdio 之前的瞬间，打印一行调暗文本。存在的意义是让终端换主人这件事永远不显得莫名其妙。
- **`{components.failure-block}`** — `renderLaunchFailure`：首句按结果着色（`failed`/`incomplete` 用失败红，`cancelled` 用 attention 黄），"阶段："/"原因：" 中性色，"恢复建议：" 调暗，且永远指向一条具体的下一步命令。
- **`{components.switch-accepted-block}`** — `renderSwitchAccepted`：需要重启那句用 attention 黄，其余中性色。
- **`{components.tui-list-row}`** — TUI 浏览列表的一行：人类可读名称（不是 revision id），选中行整行 reverse video；名称后若存在已知差异，追加一个 {colors.attention} 文字标记（不是符号）。
- **`{components.tui-detail-panel}`** — TUI 详情屏：内容与 {components.detail-block} 相同，另加已知差异内联展示（{colors.attention} 标题），不依赖任何确认摘要屏幕。
- **`{components.tui-footer-hints}`** — TUI 屏幕底部单行按键提示，{colors.dim}，随当前屏幕切换更新内容，与内容区之间只用一条水平分隔线分开（见 Layout & Spacing、Shapes）。

## Do's and Don'ts

| Do | Don't |
|---|---|
| 使用绑定终端自身调色板的 ANSI SGR 颜色码 | 硬编码 hex 颜色，或假设深色/浅色背景 |
| 去掉颜色（`NO_COLOR=1`）后每条消息依然完全可理解 | 把含义只编码在颜色里 |
| 始终只用上面这四个语义角色 | 每个命令自己加新颜色，或把颜色用作装饰 |
| 用纯文本结构：缩进 + 空行 | 画框、表格、spinner、进度条 |
| 在 stdio 交接前打印一次 `{components.handoff-line}` | 在交接之后、`omp` 退出、控制权返回之前打印任何东西 |
| 让长文本按终端自己的方式换行 | 强加固定内容宽度或手动换行逻辑 |
| TUI 用一条水平分隔线区分内容区/按键提示区 | TUI 给每个屏幕或面板画完整边框（heavy chrome，违背克制） |
| TUI 用 reverse video 表达选中 | 用箭头、圆点等图形符号或图标表达选中/状态 |
| TUI 退出 alt-screen 之后才打印交接提示行和最终状态 | 让 alt-screen 内容和普通滚动终端内容混在一起 |
