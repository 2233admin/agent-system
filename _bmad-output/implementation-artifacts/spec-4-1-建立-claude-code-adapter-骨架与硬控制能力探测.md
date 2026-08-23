---
title: '建立 Claude Code adapter 骨架与硬控制能力探测'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_revision: '8fae93496848af38ba3fb76cf68d41419e9a7132'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/.cap/runtime/claude.toml'
warnings: []
deferred:
  - summary: >-
      AC2 的"差异不得被静默丢弃"目前只落在测试级别（bun test 的 console.warn），没有任何非测试、可持久查阅的产物承载版本漂移等已知差异。
    evidence: |-
      claude-capability-probe-cap-parity.test.ts 用 console.warn 记录真实 claude --version（2.1.241）与
      .cap/runtime/claude.toml 声明的已核实版本（2.1.236）之间的漂移；这满足"不得静默丢弃"的字面要求，但只有运行
      bun test 的人能看到，没有 CLI 报告面或持久化产物可供非测试运行的读者事后查阅。intent-alignment 审查阳性确认了
      这一点，同时判定这不构成本 Story 的意图缺口——本 Story 是纯探测能力，尚无 CLI/报告基础设施可承载持久记录。
    location: >-
      packages/control-plane/tests/adapters/claude-capability-probe-cap-parity.test.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem：** 本仓维护自身运行的 Claude Code 装配目前完全由 `.cap/` 的 TOML 允许清单与 prompt 文字驱动，属于宿主无法强制执行的软约束；Epic 4 要求为 Claude Code 建立一个类型化 client adapter，但在装配任何东西之前，必须先诚实探测当前 Claude Code 环境到底原生支持哪些"硬控制"（宿主可强制执行、可回读证据的边界），不能假设或依赖 prompt 文字承诺。

**Approach：** 在 `packages/control-plane/src/adapters/clients/claude/` 新增 Claude Code adapter 的探测（probe）能力，复用既有 `adapters/omp/` 的结构先例（独立 process port 负责真实调用、独立 capability probe 负责解释证据）与 `application/ports.ts` 里已定义的 `CapabilityProbeLevel`（`supported | degraded | unsupported | unknown`）,新增按 `capabilityId` 区分的多能力探测端口，对每个候选硬控制能力返回四态之一并绑定可回读证据；同时用只读方式与 `.cap/runtime/claude.toml` 的三个已核实字段（`permission_mode`、`enable_project_mcp`、`enable_user_assets`）做比对，任何差异都必须被记录，不得静默丢弃。

## Boundaries & Constraints

**Always：**
- 每个探测结果必须携带稳定 `capabilityId`、`subject`（人类可读用途说明）、`required`（是否为 fail-closed 必需项）、`status`（四态之一）与 `evidenceRef`（描述实际观察到的证据或未能验证的原因）。
- `evidenceRef` 必须描述真实、机械捕获的证据（例如实际执行 `claude --help`/`claude --version` 得到的原始输出片段），或明确说明为何无法验证；禁止填占位字符串。
- 无法机械验证的能力必须返回 `unknown`，不得默认为 `supported`；prompt 文字承诺、官方文档声称、未核实假设一律不得作为 `supported` 的证据来源。
- `claude` 二进制不可达时，全部候选能力必须一致返回 `unknown`，原因指向二进制缺失（与 `adapters/omp/capability-probe.ts` 对 `omp` 二进制缺失时的处理方式一致）。
- 探测必须通过独立、可注入的 `ClaudeProcessPort` 抽象获取真实调用证据（`detectVersion`、`captureHelpText`），能力解释逻辑（`ClaudeCapabilityProbePort` 的实现）不得直接调用 `Bun.spawn`/`Bun.which`，以保持与 `adapters/omp/` 相同的"调用 vs 解释"分层，并让能力判定逻辑可用注入的假证据做确定性单元测试。
- 必须新增至少一项只读测试，将探测结果与 `.cap/runtime/claude.toml` 当前已核实的 `permission_mode`、`enable_project_mcp`、`enable_user_assets` 三个字段比对；比对发现的任何差异（包括版本漂移）必须以可见方式记录（测试断言或显式警告输出），不得被吞掉。

**Block If：**
- 若无法在不修改 `.cap/` 或触碰本仓当前运行 Session 装配来源的前提下完成探测能力实现，HALT 并说明具体冲突点。

**Never：**
- 不得修改、禁用或写入 `.cap/` 目录下任何文件；只允许以只读方式读取 `.cap/runtime/claude.toml` 作为比对证据。
- 不得变更本仓自身当前运行 Claude Code Session 的 skill/profile 装配来源（那是 Story 4.5 的范围，且以 parity 验证为前提门槛）。
- 不实现 `plan`/`launch`/`resume`/`interpret` 端口或 `AssemblyManifest`/`AdapterPlan`/`LaunchReceipt` 的具体落地（Story 4.2 起的范围）；本 Story 只交付 `probe`。
- 不新增 `adapters/clients/codex/`（Codex 仍处于 Deferred，AD-1）。
- 不修改 `domain/client.ts` 的 `resolveClientSupport`（其对 `claude-code` 的 `supported:false` 判定属于 CLI 现有产品边界，本 Story 不做集成接线，避免影响现有 306 项既有测试所依赖的行为）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 二进制不可达 | `Bun.which('claude')` 返回 `null` | `probeHardControlCapabilities()` 的全部四项结果 `status: 'unknown'`，`evidenceRef` 指出二进制缺失 | 不抛异常，不返回 `supported` |
| 证据完整且与已核实取值一致 | `--help` 含完整 `--permission-mode` 六态枚举、`--strict-mcp-config`、`mcp add --help` 含 `--scope` 三态、`--setting-sources` 三态 | `permission-mode-control`/`mcp-project-scope-control`/`setting-sources-control` 均为 `supported`；`hook-deny-return-value` 仍为 `unknown` | 无 |
| 证据部分命中（枚举不完整） | `--permission-mode` 存在但只列出部分取值 | 对应能力 `status: 'degraded'`，`evidenceRef` 说明取值集合与基线不完全一致 | 不得静默判为 `supported` |
| 证据完全缺失（选项本身不存在） | `--help` 文本中不含 `--permission-mode` | 对应能力 `status: 'unsupported'`，`evidenceRef` 说明选项未出现 | 不得判为 `unknown`（选项确实不存在是可观察事实，而非"无法验证"） |
| 与 `.cap/runtime/claude.toml` 比对 | 真实环境探测结果 + 只读解析的 `.cap/runtime/claude.toml` | 三个映射能力（permission-mode/mcp-project-scope/setting-sources）在二进制可达时应为 `supported` 或 `degraded`，不应为 `unsupported`（若为 `unsupported` 代表真实回归，需要被测试捕捉）；版本漂移（真实 `claude --version` 与 `.cap` 声明的 2.1.236 不一致）必须被显式记录（如测试内 `console.warn`），不得吞掉 | 二进制不可达时整体退化为全 `unknown` 分支，不视为比对失败 |

</intent-contract>

## Code Map

- `packages/control-plane/src/application/ports.ts` -- 已有 `CapabilityProbeLevel`（`supported|degraded|unsupported|unknown`）、`OmpCapabilityProbePort`/`OmpProcessPort` 作为 OMP 侧结构先例；本 Story 在其后追加 `ClaudeProcessPort`、`ClaudeCapabilityProbeResult`、`ClaudeCapabilityProbePort` 三个新端口/类型，复用同一枚举，不新建平行的能力语义。
- `packages/control-plane/src/adapters/omp/process-port.ts` -- `BunOmpProcessPort.detectVersion()` 是"真实二进制探测、找不到就诚实 Unknown、找到了按已核实正则解析"这一先例的落地参照。
- `packages/control-plane/src/adapters/omp/capability-probe.ts` -- `BunOmpCapabilityProbe` 是"不接受未核实假设、无法验证时返回 Unknown"这一先例的落地参照（单一能力版本）。
- `packages/control-plane/src/domain/facts.ts` -- `Fact<T>`/`known`/`unknown`/`isKnown`，探测证据一律用这个 Known/Unknown 合同表达，禁止用裸 `null`。
- `packages/control-plane/src/domain/client.ts` -- `ClientId` 已包含 `'claude-code'`；本 Story 不改动此文件。
- `.cap/runtime/claude.toml` -- 只读比对目标：`policy.permission_mode`（当前 `"manual"`）、`policy.enable_project_mcp`（当前 `false`）、`policy.enable_user_assets`（当前 `false`），文件头注释声明"已对 Claude Code 2.1.236 核实过"。
- `packages/control-plane/src/adapters/clients/claude/process-port.ts` -- 新增：`BunClaudeProcessPort implements ClaudeProcessPort`，`detectVersion()`（`claude --version`，正则 `^(\S+)\s*\(Claude Code\)$`）与 `captureHelpText(args)`（`claude ...args --help`，返回原始输出）。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts` -- 新增：`BunClaudeCapabilityProbe implements ClaudeCapabilityProbePort`，构造时注入 `ClaudeProcessPort`；`probeHardControlCapabilities()` 返回四项 `ClaudeCapabilityProbeResult`（`claude.permission-mode-control`、`claude.mcp-project-scope-control`、`claude.setting-sources-control`、`claude.hook-deny-return-value`），每项判定逻辑见 Design Notes。
- `packages/control-plane/tests/adapters/claude-process-port.test.ts` -- 新增：镜像 `tests/adapters/capability-probe.test.ts` 的"真实环境分支"写法，覆盖二进制存在/不存在两条路径。
- `packages/control-plane/tests/adapters/claude-capability-probe.test.ts` -- 新增：用可注入的 `FakeClaudeProcessPort` 驱动四种判定分支的确定性单元测试，外加一个真实环境下的"从不虚构 supported"整体断言。
- `packages/control-plane/tests/adapters/claude-capability-probe-cap-parity.test.ts` -- 新增：AC2 专项，只读解析 `.cap/runtime/claude.toml`，与真实探测结果比对，记录版本漂移证据。

## Tasks & Acceptance

**Execution：**
- `packages/control-plane/src/application/ports.ts` -- 追加 `ClaudeProcessPort`、`ClaudeCapabilityProbeResult`、`ClaudeCapabilityProbePort` 三个类型/接口，复用既有 `CapabilityProbeLevel` -- 让 Claude adapter 与 OMP adapter 共享同一能力语义合同（AD-19）。
- `packages/control-plane/src/adapters/clients/claude/process-port.ts` -- 新增 `BunClaudeProcessPort`，提供 `detectVersion`/`captureHelpText` 两个真实、一次性的进程调用 -- 是探测能力唯一的证据来源，能力解释逻辑不得绕过它直接调用 `Bun.spawn`。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts` -- 新增 `BunClaudeCapabilityProbe`，对四个候选硬控制能力（权限模式、MCP 项目级 scope、setting-sources 来源范围、hook 拒绝返回值）分别判定四态之一并绑定证据 -- 是 AC1 的直接落地。
- `packages/control-plane/tests/adapters/claude-process-port.test.ts` -- 覆盖 `detectVersion`/`captureHelpText` 在二进制存在/不存在下的诚实分支。
- `packages/control-plane/tests/adapters/claude-capability-probe.test.ts` -- 覆盖 I/O & Edge-Case Matrix 前四行（二进制不可达、证据完整、证据部分命中、证据完全缺失）。
- `packages/control-plane/tests/adapters/claude-capability-probe-cap-parity.test.ts` -- 覆盖 I/O & Edge-Case Matrix 第五行（与 `.cap/runtime/claude.toml` 比对，记录版本漂移）-- 是 AC2 的直接落地。

**Acceptance Criteria：**
- Given 本仓当前环境 `claude` 二进制可达，when 调用 `BunClaudeCapabilityProbe.probeHardControlCapabilities()`，then 返回的四项结果均携带非空 `capabilityId`/`subject`/`evidenceRef`，`status` 均为 `supported|degraded|unsupported|unknown` 之一，且 `claude.hook-deny-return-value` 恒为 `unknown`（本 Story 未做受控集成验证）。
- Given `claude` 二进制不可达（`Bun.which('claude')` 为 `null`），when 调用探测，then 全部四项结果的 `status` 均为 `unknown`，且 `evidenceRef` 指向二进制缺失，没有任何一项被判为 `supported`。
- Given 用可控假证据注入 `ClaudeProcessPort`（完整/部分/缺失三种 `--help` 文本），when 调用探测，then 对应能力分别得到 `supported`/`degraded`/`unsupported`，无一在证据不足时被误判为 `supported`。
- Given 只读解析 `.cap/runtime/claude.toml` 得到 `permission_mode`/`enable_project_mcp`/`enable_user_assets`，when 与真实探测结果比对，then 二进制可达时三项映射能力均不为 `unsupported`（若为 `unsupported` 视为真实回归，测试会失败并暴露），且真实 `claude --version` 与 `.cap` 声明的 2.1.236 之间的任何差异都会被显式记录（而非静默通过）。
- Given `bun test` 与 `bun run typecheck` 在 `packages/control-plane` 下执行，when 本 Story 改动落地，then 全部既有测试保持通过（不回归），新增测试全部通过，`tsc --noEmit` 零错误。

## Spec Change Log

_（本轮无 bad_spec 回环，暂无条目）_

## Review Triage Log

### 2026-08-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 14 (high 4, medium 6, low 4)
- defer: 1 (medium 1)
- reject: 8 (high 0, medium 0, low 8)
- addressed_findings:
  - `[high]` `[patch]` Token matching for `--permission-mode`/`--scope`/`--setting-sources` scanned the *entire* captured `--help` blob via loose `.includes()`, letting incidental substring hits elsewhere in the text fabricate `supported`/`degraded` evidence — replaced with `findOptionWindow` (word-boundary-safe flag location) + `extractParenListTokens` (parses the flag's own documented enum) in `capability-probe.ts`.
  - `[high]` `[patch]` Neither `Bun.spawn` call in `process-port.ts` had a timeout, so a hung/interactive `claude` child (e.g. an unexpected trust prompt) could hang the probe forever — added a constructor-injectable `timeoutMs` (default 10s) that kills the child and resolves `unknown` on expiry.
  - `[high]` `[patch]` `BunClaudeProcessPort`'s non-zero-exit, unparsable-output, and thrown-spawn-error branches were untested (and CI has no `claude` binary installed — confirmed via `.github/workflows/control-plane-checks.yml` — so they never ran anywhere), leaving a real regression-blind spot in the exact logic this Story delivers — refactored `BunClaudeProcessPort` to accept injectable `spawnFn`/`whichFn`/`timeoutMs`, and added `tests/adapters/claude-process-port.test.ts` fake-spawn tests covering all of those branches plus the new timeout branch, deterministically and independent of any real install.
  - `[high]` `[patch]` (same root cause as the finding above, capability-probe side) `probeMcpProjectScope`/`probeSettingSources`'s fully-`unsupported` branches, and the permission-mode superset/prefix-collision edge cases, had no test coverage — added dedicated fixture-driven tests in `claude-capability-probe.test.ts`.
  - `[medium]` `[patch]` An extra, unrecognized token in `--permission-mode`'s documented enum (a superset of the verified baseline) was still accepted as `supported` by the old subset-only `containsAll` check — replaced with `tokenSetsEqual` (exact set equality) so a superset now correctly resolves to `degraded`.
  - `[medium]` `[patch]` `--permission-mode` used a bare substring check, so a hypothetical longer flag like `--permission-mode-legacy` could be mistaken for the real flag — `findOptionWindow` now requires a non-word/non-hyphen boundary after the flag token.
  - `[medium]` `[patch]` Neither spawned process's `stderr: 'pipe'` stream was ever read, risking pipe-buffer backpressure stalling a child that writes to stderr, and discarding diagnostic text — both `detectVersion`/`captureHelpText` now drain stdout and stderr concurrently via the shared `runClaudeCommand` helper.
  - `[medium]` `[patch]` `ClaudeCapabilityProbeResult` had no timestamp, silently discarding the underlying `Fact`'s `observedAt` when flattening an `Unknown` into a capability result — added an `observedAt` field, sourced from the original evidence gap's own timestamp when available.
  - `[medium]` `[patch]` (intent-alignment finding) No field distinguished "mechanically probed via `--help`" from "behaviorally confirmed via a real launch," risking a downstream consumer (e.g. Story 4.2's `plan` phase) over-reading `supported` as enforced — added `validationMethod: 'mechanical'` (AD-11's own independent axis) to every `ClaudeCapabilityProbeResult`.
  - `[low]` `[patch]` `catch (error) { (error as Error).message }` blindly cast a caught value, so a thrown non-`Error` would silently read as `"undefined"` — added an `errorMessage()` helper with an `instanceof Error` guard.
  - `[low]` `[patch]` `detectVersion`/`captureHelpText` duplicated binary-lookup/spawn/exit-code/error-wrapping logic almost verbatim — extracted into a single shared `runClaudeCommand` private method.
  - `[low]` `[patch]` `claude-capability-probe-cap-parity.test.ts` threw a raw, undescriptive filesystem error if `.cap/runtime/claude.toml` were ever missing — wrapped in a try/catch with a message naming this as an AC2 evidence-file problem, not a silent skip.
  - `[low]` `[patch]` The same test's `as CapClaudeRuntimeToml` cast would let a renamed/missing TOML field surface as an opaque `TypeError` deep in the test body — added `isCapClaudeRuntimeToml` runtime shape validation with a descriptive failure message.
  - `defer`: AC2's "not silently dropped" recording is currently test-level only (`console.warn`), with no durable non-test artifact — added to spec frontmatter `deferred` (see above); out of proportion for a probe-only Story with no CLI/report surface yet.
  - `reject` (8, all cosmetic/speculative/out-of-scope-by-design, no code change): redundant `Bun.which` calls across two `captureHelpText` invocations (cheap synchronous lookup, restructuring would violate the capability-probe-must-not-call-Bun-directly boundary); probe never wired into a composition root (explicitly out of scope per this Story's own `Never` boundary, confirmed unused elsewhere by the verification-gap review); doc-comment's `2.1.241` example vs. the parity test's `2.1.236` constant "not tied together" (these are deliberately two different numbers — the whole point of the parity test is that they can differ); no Windows `.cmd`/`.ps1` shim handling (speculative — this exact Windows environment's real `claude.exe` already spawns correctly per all passing tests); no `args` parameter validation on `captureHelpText` (internal-only method, two fixed call sites, no untrusted-input surface); hardcoded Chinese `subject`/`evidenceRef` strings vs. an otherwise-English OMP precedent (consistent with this repo's broader Chinese-primary documentation convention; not a defect); `probeHookDenyEffect` permanently pinned at `unknown` with no path to `supported`/`unsupported` specified (intentional — already documented in Design Notes as Story 4.3/4.4's `controlled-integration` scope, and the intent-alignment audit confirmed this narrowing is architecturally sanctioned by AD-11, not an oversight); theoretical case-sensitivity mismatch in token matching (speculative, no evidence of real casing variation, and `.cap`'s own declared values use the exact casing already matched).

## Design Notes

- **为什么是这四个 capabilityId：** AC1 举例"settings.json 权限字段、hook 拒绝返回值、MCP 配置项"。逐一核实真实 `claude --help`/`claude mcp add --help` 输出（2.1.241，本机核实）后发现：
  - `--permission-mode <mode>` 的六态枚举（`acceptEdits auto bypassPermissions manual dontAsk plan`）与 `.cap/runtime/claude.toml` 注释里"合法取值"逐字一致 -- 映射为 `claude.permission-mode-control`，对应 `.cap` 的 `permission_mode` 字段。
  - `claude mcp add --scope <scope>`（`local, user, or project`）与 `--strict-mcp-config` 一起证实"项目级 MCP 是否纳入"是真实、原生、可强制的边界 -- 映射为 `claude.mcp-project-scope-control`，对应 `.cap` 的 `enable_project_mcp` 字段。
  - `--setting-sources <sources>`（`user, project, local`）证实"按来源排除配置"（覆盖用户级 skills/subagents/commands 等资产）是真实原生边界 -- 映射为 `claude.setting-sources-control`，对应 `.cap` 的 `enable_user_assets` 字段。
  - hook 拒绝返回值：`--help` 只能证实 hook 生命周期事件是真实概念（`--include-hook-events`），但"非零退出码/JSON 决策会被宿主真正强制阻断"这件事需要真实触发一次 hook 并观察阻断效果（controlled-integration validationMethod），属于 Story 4.3/4.4 的启动观察范围；本 Story 只做静态 `--help` 探测，因此恒定诚实返回 `unknown`，绝不因为官方文档描述过这个行为就标记 `supported`（AC1 的核心约束）。
- **为什么用可注入的 `ClaudeProcessPort` 而不是让 probe 直接 `Bun.spawn`：** 让能力判定逻辑（哪些 token 出现在哪段文本里）可以用确定性假证据做单元测试，同时保留一个针对真实安装的环境测试（同 `adapters/omp/` precedent），两者互补 -- 假证据测试覆盖判定分支的正确性，真实环境测试覆盖"这台机器上确实没有编造证据"。
- **已发现并记录的差异（AC2）：** 本仓当前环境 `claude --version` 实测为 `2.1.241`，而 `.cap/runtime/claude.toml` 文件头注释声明"已对 Claude Code 2.1.236 核实过"-- 版本已漂移。这不阻塞本 Story（探测机制本身仍然真实、诚实地工作），已通过 `claude-capability-probe-cap-parity.test.ts` 的 `console.warn` 记录，留待 Story 4.5（`.cap` parity 验证）处理，不得被后续开发静默忽略。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 全部测试通过（含既有 306 项 + 本 Story 新增 24 项 = 330 项），0 fail

## Auto Run Result

**实现摘要：** 新增 `packages/control-plane/src/adapters/clients/claude/` Claude Code adapter 骨架，交付 probe 阶段：`BunClaudeProcessPort`（真实、一次性的 `claude --version`/`claude ...args --help` 调用，构造时可注入 `spawnFn`/`whichFn`/`timeoutMs` 以支持确定性测试与超时保护）与 `BunClaudeCapabilityProbe`（对四个候选硬控制能力——权限模式、MCP 项目级 scope、setting-sources 来源范围、hook 拒绝返回值——分别判定 `supported|degraded|unsupported|unknown` 并绑定 `evidenceRef`/`validationMethod`/`observedAt`）。`application/ports.ts` 追加 `ClaudeProcessPort`/`ClaudeCapabilityProbeResult`/`ClaudeCapabilityProbePort`/`ClaudeCapabilityValidationMethod`，复用既有 `CapabilityProbeLevel`。AC2 的 `.cap/runtime/claude.toml` 只读比对通过专项测试落地，记录并公开了真实版本漂移（2.1.241 实测 vs. `.cap` 声明的已核实 2.1.236）。

**改动文件：**
- `packages/control-plane/src/application/ports.ts` -- 追加 Claude adapter 的三个新端口/类型 + `ClaudeCapabilityValidationMethod`（既有内容零改动）。
- `packages/control-plane/src/adapters/clients/claude/process-port.ts` -- 新增：`BunClaudeProcessPort`，含超时保护、stderr 排空、共享 `runClaudeCommand` 辅助方法、安全的错误消息提取。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts` -- 新增：`BunClaudeCapabilityProbe`，含边界安全的选项定位（`findOptionWindow`）、精确集合匹配（`tokenSetsEqual`）、`validationMethod`/`observedAt` 字段。
- `packages/control-plane/tests/adapters/claude-process-port.test.ts` -- 新增：真实环境分支测试 + 可注入假 spawn 驱动的非零退出码/无法解析输出/抛出异常/超时分支测试。
- `packages/control-plane/tests/adapters/claude-capability-probe.test.ts` -- 新增：I/O 矩阵全五行覆盖 + 精确集合匹配（superset 拒绝）+ 边界安全（flag 前缀碰撞）+ 全 `unsupported` 分支 + `validationMethod`/`observedAt` 字段断言。
- `packages/control-plane/tests/adapters/claude-capability-probe-cap-parity.test.ts` -- 新增：AC2 专项，含 TOML 缺失/字段变更的防御性处理与二进制可达但版本不可解析分支的记录。
- `_bmad-output/implementation-artifacts/epic-4-context.md` -- 新增：Epic 4 编译上下文（本轮 clarify 阶段产出，供后续 Story 4.2～4.6 复用）。

**审查发现分布：** patch 14（已全部修复并重新验证），defer 1（已计入 frontmatter `deferred`），reject 8（记录理由，未改代码），intent_gap 0，bad_spec 0。

**后续审查建议：** `followup_review_recommended: true`（本轮 patch 含 4 项 high severity，触发 true 条件）。

**验证执行：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误。
- `cd packages/control-plane && bun test` -- 330 pass / 0 fail / 1147 expect() calls，覆盖既有 306 项与本 Story 新增 24 项，无回归。

**残留风险：**
- AC2 的差异记录目前只在测试级别可见（见 frontmatter `deferred`），尚无 CLI/报告面持久化；不阻塞本 Story，留待后续 Story 处理。
- 本 Story 的 `supported` 结论均为 `validationMethod: 'mechanical'`（静态 `--help` 证据），尚未包含任何真实启动观察；Story 4.3/4.4 的 `controlled-integration` 验证是必要的下一步，不能仅凭本 Story 结果假定硬控制在真实会话中确实生效。
- 未在真实、干净的 CI 环境（无 `claude` 二进制）下运行过完整测试套件确认新增的可注入 fake-spawn 测试确实不依赖真实二进制；本地验证显示这些测试与 `Bun.which('claude')` 的真实结果无关（构造函数显式覆盖了 `whichFn`），但建议 CI 首次跑通后再次确认。
