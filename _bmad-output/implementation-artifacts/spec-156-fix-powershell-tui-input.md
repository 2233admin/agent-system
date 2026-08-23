---
title: 'Issue #156：修复 PowerShell 下 configs TUI 键盘输入失效'
type: 'bugfix'
created: '2026-08-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9861ecad38481d541da575a51770916defcf3827'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Windows PowerShell 中运行已编译的 `configs` 零参数 TUI 时，进程进入 Ink 界面但键盘事件（包括 Ctrl+C）可能永远不到达 `useInput`，用户只能外部强杀。现有测试使用 `ink-testing-library` 合成 stdin，不能覆盖 Bun 独立可执行文件的真实控制台流。

**Approach:** 在 Ink 挂载前显式恢复 Bun 的 stdin 消费状态，使 Windows/PowerShell 控制台的 readable 事件进入 Ink 既有 raw-mode 解析链；保留 `exitOnCtrlC: false`、alt-screen 和统一清理路径，不新建第二套 TUI 输入解析器。补充回归测试覆盖 stdin 恢复调用，并用源码/编译后二进制在真实 PowerShell TTY 验证 q、方向键、Enter、Ctrl+C。

## Boundaries & Constraints

**Always:** 只修复零参数且 stdin/stdout 均为 TTY 的 TUI 输入路径；显式子命令、非 TTY usage、Ink 的 key parsing、LaunchPlan 状态机、OMP 启动和退出清理保持不变。输入恢复必须发生在 `render()` 前，不能吞掉或复制键盘字节；Ctrl+C 仍经 `TuiApp.onQuit()` 退出。

**Ask First:** 若实测 stdin 仍无 readable/data 事件，或必须调用 Windows API/FFI、替换 Ink、引入自定义终端协议，停止并请求重新裁决；这些已超出当前最小修复。

**Never:** 不增加轮询线程、daemon、PowerShell/Batch 产品脚本、外部强杀 fallback、静默自动回退或新的键位语义；不把合成 stdin 测试冒充真实 Windows TTY 证据。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PowerShell TTY | 编译后二进制、零参数、stdin/stdout 为 TTY | TUI 接收 q、↑↓、Enter、Ctrl+C；Ctrl+C 正常退出并恢复终端 | 不留 alt-screen/raw mode |
| Source TTY | `bun src/cli/index.ts`、零参数 | 与编译后二进制使用同一输入路径 | 不改变显式子命令 |
| Non-TTY | 零参数但 stdin 或 stdout 非 TTY | 继续走纯文本 usage，不调用 TUI 输入恢复 | 退出码与现有行为一致 |

</frozen-after-approval>

## Code Map

- `packages/control-plane/src/cli/tui.tsx` -- `runTuiScreen()` 在 `render(<TuiApp ...>)` 前建立 TUI stdin 前置条件；保留 `exitOnCtrlC: false` 与 `instance.unmount()` 清理。
- `packages/control-plane/src/cli/index.ts` -- `import.meta.main` 的零参数双 TTY 分流；只读证据，确认修复不影响显式子命令和非 TTY 路径。
- `packages/control-plane/tests/cli/tui.test.tsx` -- 现有 Ink 合成 stdin 已覆盖 q、Ctrl+C、方向键、Enter；新增针对 stdin 恢复前置条件的 focused regression test，不删除现有交互断言。
- `node_modules/ink/build/components/App.js` -- 只读外部运行时证据：Ink 依赖 stdin 的 raw mode、`readable` 事件与 `read()`，合成测试无法证明真实 Bun stream。
- `.github/workflows/release-configs.yml` -- 只读发布证据：Windows 目标会编译，但当前 smoke 只执行 Linux 二进制；真实 PowerShell TTY 作为本地验收门。

## Tasks & Acceptance

**Execution:**
- [x] `packages/control-plane/src/cli/tui.tsx` -- 在 Ink render 前恢复 stdin 消费状态，并保持现有 raw-mode/卸载/alt-screen 生命周期 -- 让 Bun Windows 控制台输入进入既有 Ink 链路。
- [x] `packages/control-plane/tests/cli/tui.test.tsx` -- 添加 stdin 前置条件的回归断言，并保留 q、Ctrl+C、方向键、Enter 组件测试 -- 防止修复被删除且不改变键位合同。

**Acceptance Criteria:**
- Given 零参数且 stdin/stdout 均为 TTY，when TUI 挂载，then stdin 在 Ink render 前已恢复消费，且既有 `useInput` 收到键盘事件。
- Given TUI 中按 Ctrl+C 或 q，when 事件到达，then 统一走 `onQuit()`，退出码为 0，不遗留 raw mode 或 alt-screen。
- Given 显式子命令或非 TTY 零参数，when CLI 启动，then 不进入 TUI 输入路径，原有输出和退出码不变。
- Given 源码模式和编译后二进制在真实 PowerShell TTY，when 分别按 q、方向键、Enter、Ctrl+C，then 每个动作均产生预期结果；记录实际 Bun 版本与验证方式。

## Design Notes

Ink 5.2.1 的 `useInput` 不直接监听 `data`，而是由 `App.handleSetRawMode()` 注册 `readable` 监听并调用 `stdin.read()`。当前 TUI 只设置 `exitOnCtrlC: false`，没有显式恢复 Bun stdin；`ink-testing-library` 的 fake stdin 会主动发出 `readable`，因此既有测试会掩盖真实控制台差异。修复只补齐 stream 生命周期前置条件，不复制 `parse-keypress` 或重写 Windows 控制台模式。

## Verification

**Commands:**
- `cd packages/control-plane && bun test tests/cli/tui.test.tsx` -- expected: existing and new TUI tests pass.
- `cd packages/control-plane && bun run typecheck` -- expected: no TypeScript errors.
- `bun build packages/control-plane/src/cli/index.ts --compile --outfile <temp>/configs-156.exe` -- expected: Windows standalone binary builds.

**Manual checks (if no CLI):**
- 在真实 Windows PowerShell/TTY 分别运行源码入口和编译后二进制；确认列表→方向键→详情/Enter、q、Ctrl+C 可响应，退出后终端不残留 alt-screen/raw mode；记录 `process.platform`、`process.versions.bun` 和是否为独立可执行文件。

## Suggested Review Order

**stdin 生命周期**

- 先恢复 Bun stdin，再交给 Ink raw-mode 管理输入。
  [`tui.tsx:57`](../../packages/control-plane/src/cli/tui.tsx#L57)

- 挂载失败、退出和启动均恢复原始 stdin 状态。
  [`tui.tsx:205`](../../packages/control-plane/src/cli/tui.tsx#L205)

**回归保护**

- Fake TTY 模拟 resume、readable 顺序与暂停状态恢复。
  [`tui.test.tsx:205`](../../packages/control-plane/tests/cli/tui.test.tsx#L205)

- Ctrl+C 验证统一退出路径与 listener 清理。
  [`tui.test.tsx:593`](../../packages/control-plane/tests/cli/tui.test.tsx#L593)

- 零参数双 TTY 分流保持显式命令和非 TTY 隔离。
  [`index.ts:687`](../../packages/control-plane/src/cli/index.ts#L687)
