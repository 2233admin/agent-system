---
title: 'configs CLI：语义色彩、交接提示行、中英 i18n、交互式 TUI'
type: 'feature'
created: '2026-08-22'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'a2ecd6914dde38dda759956488475f27deeb2768'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `configs` 目前只有英文纯文本输出，没有颜色，没有交接提示，也没有无参数时的交互式浏览方式——UX spine（DESIGN.md/EXPERIENCE.md，2026-08-22，status: final）记录了四处 `[DELTA]`：语义色彩、交接提示行、中英双语 i18n、交互式 TUI，均未落地到代码。

**Approach:** 在 `packages/control-plane` 现有六子命令纯文本 CLI 基础上（不重写、不动状态机），新增 `colors.ts`（ANSI 语义色 + NO_COLOR/非 TTY 判定）与 `i18n.ts`（zh 默认／`CONFIGS_LANG=en`，EXPERIENCE.md 文案表为准），接入 `render.ts` 全部用户可读字符串；新增一行交接提示（确认后、`omp` 接管 stdio 前）；新增 `ink` 交互式 TUI（无参数 + 交互 TTY 时进入，浏览列表→详情，Enter 复用 `--yes` 的自动确认路径启动，omp 退出后打印终态、进程退出、不回到 TUI）。带任何显式子命令时永远走纯文本 CLI，行为不变。

## Boundaries & Constraints

**Always:**
- `LaunchPlan.phase`（`domain/activation.ts`）10 值状态机与 `transitionLaunchPlan` 不改；TUI 的"自动确认"必须实际调用 `prepareLaunchPlan` → `confirmLaunchPlan`（与 `--yes` 同一条路径），不得绕开或伪造事件。
- 颜色永远是叠加信息：`NO_COLOR`（任意值）或 `stdout` 非 TTY 时不输出任何 ANSI；去色后每条消息仍完全可读。语义色只有四个角色（success 绿/degraded·attention 黄/failure 红），加 neutral/dim；不新增颜色。
- `CONFIGS_LANG` 显式切换（默认 zh，`=en` 切英文），不读 `LANG`/`LC_ALL`；命令名/flag/`LaunchPlan.phase` 等封闭枚举值不翻译。
- 交接提示行只打印一次，紧接确认通过、`omp` 接管 stdio（`stdio:['inherit','inherit','inherit']`，`process-port.ts:178`）之前；两界面共用同一行文案；TUI 触发时必须先退出 alt-screen 再打印（纯滚动终端上的普通文本）。
- 带任何显式子命令（`list`/`show`/.../`switch`）时，无论 TTY 与否，永远走纯文本 CLI，本次改动对其行为零影响（仅字符串内容随语言/颜色变化，结构/退出码不变）。
- TUI 只用键盘；过窄终端不得崩溃/卡死（用 ink 默认换行兜底）；TUI 不覆盖 `compare`/`switch`/`status`。

**Ask First:** 无——UX spine 已 final 且已过校验，实现期间若发现与 spine 矛盾之处再询问。

**Never:** 不做多候选推荐/热重配置/跨 client TUI（均已被 spine 排除）；不给纯文本 CLI 画框/加表格/加 spinner；TUI 不展示确认摘要屏，不引入 `switch`/`status` 的 TUI 化。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 无参数+交互 TTY | `configs`，stdin/stdout 均 TTY | 进入 ink TUI 浏览列表 | N/A |
| 无参数+非交互 | `configs`，stdout 非 TTY 或管道 | 打印帮助文本（同 usage），退出 0 | N/A |
| NO_COLOR | 任意子命令，`NO_COLOR=1` | 输出不含任何 ANSI 转义 | N/A |
| 非 TTY 输出 | `configs list \| cat` | 即使未设 NO_COLOR 也不输出 ANSI | N/A |
| 语言切换 | `CONFIGS_LANG=en configs show <id>` | 全部说明性文本为英文；phase 枚举值/字段值仍不翻译 | N/A |
| 默认语言 | 未设 `CONFIGS_LANG` | 全部说明性文本为中文 | N/A |
| TUI 选中启动 | TUI 列表选中一行按 Enter | 无 y/N 提示，直接 `prepareLaunchPlan`→`confirmLaunchPlan`→退出 alt-screen→打印交接行→`launchOmp` | 若 `prepareLaunchPlan` 落到 `failed`（如 revision 竞态消失），退出 alt-screen 后按纯文本失败块打印，进程退出 |
| TUI 退出 | 列表或详情屏按 `q` | 直接退出进程，从未创建 `LaunchPlan` | N/A |
| TUI 结束 | `omp` 退出 | 打印最终状态块，`configs` 进程退出，不回到 TUI | N/A |

</frozen-after-approval>

## Code Map

- `packages/control-plane/src/cli/render.ts` -- 全部用户可读字符串接入 `i18n.t()`；`renderLaunchStatus`/`renderLaunchFailure`/`renderSwitchAccepted`/`renderConfirmationSummary` 按 State Patterns 表接入 `colors.ts` 语义色；导出 `formatFact`/`CAPABILITY_GROUP_LABELS` 等既有私有 helper 供 TUI 复用（避免重复格式化逻辑）；新增 `renderHandoffLine()`。
- `packages/control-plane/src/cli/index.ts` -- `runLaunchFlow` 在 `confirmLaunchPlan` 之后、`launchOmp` 之前插入 `console.log(renderHandoffLine())`；抽出 `openDeps(overrides)`（现第 285-306 行的仓储构造+错误处理）供 `main()` 与新 TUI 入口共用；底部 `import.meta.main` 块按 argv 长度+`process.stdin.isTTY`+`process.stdout.isTTY` 分流到 `runTui()` 或 `main()`；`main()` 内 argv 为空时打印 `USAGE` 返回 0（不再是 usage-error）。
- `packages/control-plane/src/cli/colors.ts`（新增） -- `shouldColor()`（读 `NO_COLOR`/`process.stdout.isTTY`，每次调用现读，不缓存）+ `success/degraded/attention/failure/dim` 包装函数 + `colorForPhase(phase)` 映射（对照 EXPERIENCE.md State Patterns 表）。
- `packages/control-plane/src/cli/i18n.ts`（新增） -- `resolveLang()`（`CONFIGS_LANG==='en'`→en，否则 zh，每次现读）+ zh/en 完整文案表（EXPERIENCE.md Voice and Tone 表为起点，未列出字符串按同语气类推，含 `renderComparison`/`renderQueryFailure`/`renderUnsupportedClient` 等表外字符串）+ `t(key, params)`。
- `packages/control-plane/src/cli/tui.tsx`（新增） -- `runTui(overrides): Promise<number>`：进出 alt-screen（原始 ANSI `\x1b[?1049h`/`l`）、渲染 ink 根组件（`list`/`detail` 两屏状态机，`useInput` 处理 ↑↓/Enter/→/Esc/q）、选中即走 `prepareLaunchPlan`+`confirmLaunchPlan`、卸载 ink 后打印交接行+调用 `launchOmp`+打印终态（复用 `renderLaunchStatus`/`renderLaunchFailure`）。
- `packages/control-plane/package.json` -- 新增依赖 `ink`、`react`；devDependency `ink-testing-library`（TUI 单测，不走真实终端）。
- `packages/control-plane/tsconfig.json` -- 加 `"jsx": "react-jsx"`。
- `packages/control-plane/tests/integration/cli.test.ts`、`tests/integration/cli-launch.test.ts` -- `beforeEach`/`afterEach` 显式设置/清理 `process.env.CONFIGS_LANG = 'en'`，让既有英文字符串断言在新默认中文下继续通过（Story 1.1/1.2 已锁定的行为不变，只是必须显式声明期望的语言）。

## Tasks & Acceptance

**Execution:**
- [x] `src/cli/colors.ts` -- 新建语义色 + `shouldColor()` -- DESIGN.md Colors 一节
- [x] `src/cli/i18n.ts` -- 新建 zh/en 文案表 + `resolveLang()`/`t()` -- EXPERIENCE.md Voice and Tone 文案表
- [x] `src/cli/render.ts` -- 接入 i18n+颜色，新增 `renderHandoffLine`，导出复用 helper -- 四个组件角色映射
- [x] `src/cli/index.ts` -- 插入交接行打印、抽出 `openDeps`、zero-arg/TTY 分流 -- IA 第一层
- [x] `src/cli/tui.tsx` -- 新建两屏 ink TUI + 自动确认路径 -- Interaction Primitives "TUI 自动确认"
- [x] `package.json`/`tsconfig.json` -- 加依赖与 jsx 配置
- [x] `tests/cli/colors.test.ts`（新建） -- NO_COLOR/非 TTY 关闭色彩、四语义角色映射
- [x] `tests/cli/i18n.test.ts`（新建） -- 默认 zh、`CONFIGS_LANG=en` 切换、枚举值不翻译
- [x] `tests/cli/tui.test.tsx`（新建，用 `ink-testing-library`） -- 列表/详情渲染、已知差异标记、Enter 触发自动确认（mock deps）、q 退出不创建 plan
- [x] `tests/integration/cli.test.ts`、`tests/integration/cli-launch.test.ts` -- 补 `CONFIGS_LANG=en` 环境设置

**Acceptance Criteria:**
- Given `NO_COLOR=1`，when 运行任意子命令，then 输出不含 `\x1b[` 转义序列。
- Given `stdout` 被重定向到文件，when 运行任意子命令（未设 NO_COLOR），then 输出不含 ANSI 转义。
- Given 未设 `CONFIGS_LANG`，when 运行 `configs show <id>`，then 字段标签为中文（`配置：`/`修订版本：` 等），`LaunchPlan.phase` 值仍为英文枚举词。
- Given `CONFIGS_LANG=en`，when 运行同一命令，then 字段标签为英文且与当前实现英文字符串一致。
- Given 交互式 TTY 且无参数，when 启动 `configs`，then 进入 TUI 列表，不触达纯文本 CLI 分发逻辑。
- Given TUI 列表选中一项按 Enter，when 启动流程执行，then `LaunchPlan` 依次经过 `prepared→awaiting-confirmation→applying`，全程无 y/N 交互提示、无确认摘要屏输出。
- Given `omp` 已退出，when TUI 路径打印终态，then `configs` 进程退出且不重新进入 TUI 列表。
- Given 带显式子命令（如 `configs list`）+ 非 TTY，when 运行，then 行为与本次改动前完全一致（除颜色/语言随环境变量变化外）。

## Design Notes

- 颜色/语言均按环境变量现读（不在启动时缓存），因为测试需要在同一进程内切换 `NO_COLOR`/`CONFIGS_LANG`/`stdout.isTTY` 断言不同分支。
- 已知差异的具体原因字符串（如 `instructions-content-not-materialized-in-mvp`，来自 `computeKnownDifferences`）不在文案表内、保持现状不翻译——它们是 `computeKnownDifferences` 产出的准枚举 reason code，不是 Voice and Tone 表点名的说明性整句，且现有测试按原文断言。
- TUI 内 reverse-video 选中态与语义色标记均直接使用 `ink`（内部基于 `chalk`）对 `NO_COLOR`/终端能力的原生探测，不额外重新实现——TUI 只在 `stdin`/`stdout` 均为交互式 TTY 时才会进入，这是本次改动唯一会遇到"要不要上色"判断的路径。
- `openDeps()` 抽取只是把 `main()` 现有第 285-306 行原样搬到一个可复用函数，不改变其错误处理/close 顺序。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全部通过，含新增 `tests/cli/colors.test.ts`/`i18n.test.ts`/`tui.test.tsx`
- `cd packages/control-plane && bun run typecheck` -- expected: 无错误（含新增 `.tsx`）
- `cd packages/control-plane && NO_COLOR=1 bun src/cli/index.ts list | cat` -- expected: 手动确认无 ANSI 转义、中文默认文案
- `cd packages/control-plane && CONFIGS_LANG=en bun src/cli/index.ts list` -- expected: 手动确认英文文案与改动前一致

**Manual checks (if no CLI):**
- 在真实交互终端跑 `bun src/cli/index.ts` 无参数，走一遍 Key Flows 里 Wren 的路径（列表→详情→Enter→交接→omp 退出→终态→进程退出，不回 TUI）。

## Suggested Review Order

**入口与调度：无参数分流到 TUI，带子命令永远走纯文本 CLI**

- 交互 TTY 且无参数时才进入 TUI；带任何子命令时无论 TTY 与否都不受影响。
  [`index.ts:445`](../../packages/control-plane/src/cli/index.ts#L445)

- `main()` 内 argv 为空不再是 usage-error，改为打印 usage 并退出 0（仅非交互路径会走到这里）。
  [`index.ts:354`](../../packages/control-plane/src/cli/index.ts#L354)

- 从 `main()` 原地构造抽出为可复用函数，供 `main()` 与 `runTui()` 共用，行为不变。
  [`index.ts:222`](../../packages/control-plane/src/cli/index.ts#L222)

**TUI：两屏状态机、自动确认、alt-screen 生命周期**

- 纯展示组件：列表/详情两屏，Enter 直接上报选中的 revision，不经过 y/N 或确认摘要屏。
  [`tui.tsx:63`](../../packages/control-plane/src/cli/tui.tsx#L63)

- 编排核心：进出 alt-screen、依赖关闭都在同一个 try/finally 里，无论哪个分支返回或抛错都只执行一次。
  [`tui.tsx:255`](../../packages/control-plane/src/cli/tui.tsx#L255)

- 挂载 ink 应用；`exitOnCtrlC: false` 让 Ctrl+C 走 `TuiApp` 自己的 `onQuit`，不被 ink 默认行为跳过清理。
  [`tui.tsx:181`](../../packages/control-plane/src/cli/tui.tsx#L181)

- 真实 TTY 入口：打开依赖后委托给编排函数。
  [`tui.tsx:326`](../../packages/control-plane/src/cli/tui.tsx#L326)

**语义色彩：四角色映射 + NO_COLOR/非 TTY 判定**

- `LaunchPlan.phase` 到语义色角色的映射，进行中阶段保持中性色不着色。
  [`colors.ts:68`](../../packages/control-plane/src/cli/colors.ts#L68)

- 每次调用现读 `NO_COLOR`/`isTTY`，不缓存，颜色永远是叠加信息。
  [`colors.ts:26`](../../packages/control-plane/src/cli/colors.ts#L26)

- `renderLaunchStatus` 里颜色只包住阶段值本身、再嵌入固定模板，这是审查中专门补测的组合点。
  [`render.ts:257`](../../packages/control-plane/src/cli/render.ts#L257)

**中英 i18n：默认 zh、显式 `CONFIGS_LANG=en`、双向兜底**

- 只认 `CONFIGS_LANG`，不读 `LANG`/`LC_ALL`。
  [`i18n.ts:21`](../../packages/control-plane/src/cli/i18n.ts#L21)

- 查表 + 占位符替换；某语言缺键时兜底到另一语言而非裸键。
  [`i18n.ts:231`](../../packages/control-plane/src/cli/i18n.ts#L231)

**交接提示行：确认后、omp 接管 stdio 前打印一次**

- 纯文本 CLI 路径：`confirmLaunchPlan` 之后、`launchOmp` 之前插入交接行。
  [`index.ts:328`](../../packages/control-plane/src/cli/index.ts#L328)

- 两界面共用的渲染函数，恒为 dim。
  [`render.ts:331`](../../packages/control-plane/src/cli/render.ts#L331)

**外围：依赖、类型配置、测试**

- 新增 `ink`/`react` 运行时依赖，`ink-testing-library` 锁定到与 `ink@^5` 兼容的版本。
  [`package.json`](../../packages/control-plane/package.json)

- 新增 `jsx: react-jsx` 支持 `.tsx`。
  [`tsconfig.json`](../../packages/control-plane/tsconfig.json)

- 既有英文字符串断言补 `CONFIGS_LANG=en`，"无子命令"用例改为断言退出 0。
  [`cli.test.ts:326`](../../packages/control-plane/tests/integration/cli.test.ts#L326)

- 补交接行文案与位置的断言。
  [`cli-launch.test.ts:139`](../../packages/control-plane/tests/integration/cli-launch.test.ts#L139)
