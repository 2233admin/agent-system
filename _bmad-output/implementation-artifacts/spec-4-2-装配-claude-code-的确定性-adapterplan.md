---
title: '装配 Claude Code 的确定性 AdapterPlan'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_revision: 'e0074bb198b872c79e27a247934b489b29d78234'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-建立-claude-code-adapter-骨架与硬控制能力探测.md'
warnings: ['oversized']
deferred:
  - summary: >-
      epics.md Story 4.2 的 AC 文本把本 Story 产出的类型叫作"AdapterPlan"，其字段（instructions/
      skills/mcp 类型化引用 + capability policy）实际逐字对应 Architecture Spine AD-19 定义里的
      `AssemblyManifest`，而不是 AD-19 自己定义的、字段完全不同的持久化 `AdapterPlan`（只含 argv 结构/
      环境键/secret 引用/hash/生成文件元数据/预期观察）。
    evidence: |-
      intent-alignment 审查确认：本 Story 新增的 `ClaudeAdapterPlan`（plan.ts）字段集合与 AD-19 原文
      "AssemblyManifest 只表达 client、project root、configuration revision、instructions/skills/
      MCP 引用、capability policy、isolation intent 与可选 resume selector"逐项吻合；AD-19 另外
      单独定义的"持久 AdapterPlan 只保存 argv 结构、环境键、secret/content 引用、不可逆 hash、
      generated-file metadata 和预期观察"这一形状，在本仓 `src/` 下完全不存在任何对应类型（已用
      grep 确认 AssemblyManifest 字符串不出现在 src/ 下）。这是 epics.md 与 ARCHITECTURE-SPINE.md
      两份规划产物之间已经存在的术语落差，非本 Story 引入；本 Story 忠实按 epics.md AC1 的字面文本
      （唯一交给本 Story 的产品级验收依据）命名与建字段，交付内容本身满足 AC1/AC2 的全部功能性要求。
      风险在于 Story 4.3/4.4 需要引入 AD-19 真正的、argv/env/secret 形状的 AdapterPlan 时，
      会与本 Story 已导出的 `ClaudeAdapterPlan` 撞名，需要重命名或明确改用 `ClaudeAssemblyManifest`
      之类的名字。
    location: >-
      packages/control-plane/src/adapters/clients/claude/plan.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem：** Story 4.1 交付了 Claude Code 硬控制能力的 probe（`BunClaudeCapabilityProbe`），但把已存在的装配意图（`.cap/manifest.toml` + `profiles/*.toml` + `skill-imports.toml` 当前表达的引用集合）编译成一份确定性 `AdapterPlan` 的能力仍不存在，无法把 probe 证据与装配意图连接起来产出可交付给后续 launch 阶段的产物。

**Approach：** 在 `packages/control-plane/src/adapters/clients/claude/plan.ts` 新增纯函数 `compileClaudeAdapterPlan(revision, probeResults)`：复用 domain 侧既有的 `StableConfigRevision`（`.cap` 已经通过 `adapters/sources/cap-fs.ts` 映射出的装配意图，Instructions/Skills/MCP 均为只读类型化引用，不含内容原文）与 Story 4.1 的 `ClaudeCapabilityProbeResult[]`，按每个 probe 能力自带的 `required` 声明与装配意图是否实际引用该能力对应的资产种类，判定整体 `ready | degraded`（成功编译）或 `blocked`（fail closed，不产出可用 plan），并对成功编译的 plan 计算确定性 hash。

## Boundaries & Constraints

**Always：**
- `compileClaudeAdapterPlan` 是纯函数（不导入 Bun/文件系统/进程环境），输入只有已加载的 `StableConfigRevision` 与 `ClaudeCapabilityProbeResult[]`，不自行触发探测或读取 `.cap/`。
- 只在装配意图实际引用对应资产种类时才评估该 capability 是否相关：`claude.permission-mode-control` 始终相关（baseline，任何装配都受权限模式约束）；`claude.mcp-project-scope-control` 仅当 `revision.mcp.length > 0`；`claude.setting-sources-control` 仅当 `revision.skills.length > 0`；`claude.hook-deny-return-value` 仅当 `revision.hooks.length > 0`。不相关的 capability 不出现在 plan 的 `capabilityPolicy`/`degradedCapabilities` 中（避免所有 plan 永远因未使用的能力被判 `degraded`）。
- 相关 capability 的处理规则（AD-10 fail closed）：`status === 'supported'` 无影响；`status === 'degraded'` 记入 `degradedCapabilities`（plan 整体降级为 `degraded`，但仍产出可用 plan）；`status` 为 `'unsupported' | 'unknown'` 时，若该 capability 的 `required === true` 则整体 `blocked`（fail closed，不产出 hash/plan）；若 `required === false` 则同样记入 `degradedCapabilities`（plan 仍为 `degraded`）。`blocked` 优先于 `degraded`：任意一个相关必需能力 blocked 即整体 blocked。
- 成功编译的 `ClaudeAdapterPlan` 只包含：`client`、`revisionId`/`configName`、相关 capability 的 `capabilityPolicy`（原样携带 Story 4.1 的 `capabilityId`/`required`/`status`/`validationMethod`/`evidenceRef`/`observedAt`，不裁剪证据字段)、`instructions`/`skills`/`mcp` 三组类型化引用（直接复用 `revision` 上的 `CapabilityReference[]`，不复制/不新增内容字段）、`planStatus`、`degradedCapabilities`、`planHash`。不得包含 hooks/plugins 的类型化引用字段（AC1「只包含...与类型化的 Instructions/Skills/MCP 引用」的字面排除）。
- `planHash` 只由 `revisionId` + client 字面量 `'claude-code'` + 相关 capability 的 `(capabilityId, required, status)` 三元组集合 + 三组引用的 `(kind, name, sourceCategory 已知值或 unknown 原因)` 签名参与计算，显式排除 `evidenceRef`/`observedAt`（这些是每次探测的易变证据文本/时间戳，不是装配意图或能力状态本身）——这是 AC1"相同输入两次执行产出确定性相同的 plan（hash 相同）"成立的前提：两次真实 probe 运行的 `evidenceRef`/`observedAt` 允许不同，只要能力状态与装配意图不变，hash 必须相同。
- probe 结果里找不到某个「相关」capabilityId（防御性分支，不应在 `BunClaudeCapabilityProbe` 正常输出下出现）时，按最保守方式处理：视为 `required: true, status: 'unknown'`，绝不默认为 `supported`。

**Block If：**
- 若无法在不修改 `domain/config.ts`/`domain/client.ts`/`.cap/` 的前提下完成本 Story，HALT 并说明冲突点。

**Never：**
- 不新增/修改 `application/ports.ts` 里的任何既有类型或接口（本 Story 的类型只在 `plan.ts` 内定义并导出，不是一个需要多实现的 port——编译过程零 IO，不需要 port 抽象）。
- 不实现 `launch`/`resume`/`interpret`，不产出 argv/env/secret 引用等 launch-only 字段（Epic 4 Story 4.3/4.4 范围），不把 plan 持久化到任何仓储。
- 不把 hooks/plugins 作为类型化引用放进 plan（只用 `revision.hooks` 判断 `claude.hook-deny-return-value` 是否相关；`revision.plugins` 在本 Story 中不参与任何 capability 判定——当前两个真实 profile 的 `plugins` 恒为空，且 Story 4.1 未探测任何与 plugin 对应的 capability，强行编造判定规则属于臆造）。
- 不接线 CLI 组合根，不触碰 `.cap/` 本体或本仓自身运行 Session 的装配来源。
- 不产出候选、评分或推荐（SPEC.md CAP-1）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 零引用（无 skills/mcp/hooks） | `revision` 只有 instructions，probe 4 项齐全 | 只有 `claude.permission-mode-control` 相关；若其 `supported` 则 `planStatus: 'ready'` | 无 |
| 引用 MCP 且 mcp-project-scope-control unsupported/unknown | `revision.mcp.length > 0`，该 capability `required: true` 且状态非 supported/degraded | 整体 `kind: 'blocked'`，`missingRequiredCapabilities` 含该项 | 不产出 planHash |
| 引用 skills 且 setting-sources-control degraded | `revision.skills.length > 0`，该 capability `status: 'degraded'` | `planStatus: 'degraded'`，`degradedCapabilities` 含该项，仍产出 plan | 无 |
| 引用 hooks（hook-deny-return-value 恒为 unknown, required: false） | `revision.hooks.length > 0` | `planStatus: 'degraded'`（可选项缺失，不 blocked） | 无 |
| 相同 revision + 两次探测结果（capabilityId/required/status 相同，evidenceRef/observedAt 不同） | 两次调用 `compileClaudeAdapterPlan` | 两次 `planHash` 完全相同 | 无 |
| probe 结果不含某个相关 capabilityId | 防御性构造：手工移除一项 | 视为 `required:true,status:'unknown'`，触发 `blocked` | 不静默判为 supported |

</intent-contract>

## Spec Change Log

_（本轮无 bad_spec 回环，暂无条目）_

## Review Triage Log

### 2026-08-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 2, low 1)
- defer: 1 (medium 1)
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` (verification-gap reviewer) 现有 hash 稳定性测试只验证"内容不变、证据文本不同 -> hash 相同"，从未验证"内容变化 -> hash 不同"，一次意外把 `capabilityPolicy`/引用签名从哈希输入里漏掉的回归不会被任何测试捕捉 -- 新增两个测试：同一 `revisionId` 下 capability status 变化导致 `planHash` 变化、同一 `revisionId` 下引用的 skill 变化导致 `planHash` 变化（`claude-plan.test.ts`）。
  - `[medium]` `[patch]` （edge-case 自查）`computeClaudeAdapterPlanHash` 里 capability 签名排序后再拼接，但 instructions/skills/mcp 的引用签名未排序就直接 `join`，若装配意图重新加载时数组顺序不保证稳定（如 `lock.json` 被工具以不同顺序重写），同一装配意图会产出不同 hash，削弱 AC1"相同输入两次执行 hash 相同"的保证 -- 在 `plan.ts` 的 `computeClaudeAdapterPlanHash` 里对三组引用签名各自 `sort()` 后再 `join`，并新增"相同 skill 集合、不同数组顺序 -> hash 相同"的回归测试。
  - `[low]` `[patch]` （blind-hunter 自查）缺少"多个相关必需能力同时 blocked"的测试，无法验证 `missingRequiredCapabilities` 能同时列出多项而不是只记录第一项命中的能力 -- 新增测试：`revision` 同时引用 mcp 与 skills，且两者对应 capability 均 `required:true` 且状态非 supported/degraded，断言 `missingRequiredCapabilities` 同时包含两项。
- 其余发现（6 项，均为 reject，未改代码）：probe 结果里出现重复 `capabilityId` 未做去重/冲突处理（`BunClaudeCapabilityProbe` 按固定四项返回，不会产出重复项，纯属推测性输入）；`revision.plugins` 完全不参与任何 capability 判定（本 Story Boundaries 明确记录为刻意排除，非缺陷）；`ClaudeAdapterPlanResult` 的 `'compiled'`/`'blocked'` 两支形状不对称（`compiled` 嵌套在 `.plan` 下、`blocked` 字段打平）（纯 API 风格观感，不影响正确性，未被任何 AC 要求）；32 位非加密哈希存在理论碰撞风险（`Design Notes` 已明确记录为与 `domain/activation.ts` 一致的既有先例，是刻意取舍）；`ClaudeAdapterPlanCapabilityNote` 只是 `ClaudeCapabilityProbeResult` 的类型别名、无独立字段隔离（代码注释已说明这是刻意选择，非缺陷）；"mcp+skills+hooks 同时非空"的组合测试与已有的逐项独立测试重复覆盖同一段无交互逻辑的代码，不构成新增有效验证。

## Code Map

- `packages/control-plane/src/application/ports.ts` -- 已有 `ClaudeCapabilityProbeResult`/`CapabilityProbeLevel`（Story 4.1）；本 Story 消费但不修改。
- `packages/control-plane/src/domain/config.ts` -- 已有 `StableConfigRevision`/`CapabilityReference`（`instructions`/`skills`/`mcp`/`hooks`/`plugins`），即"已存在的装配意图"的域类型，本 Story 直接复用，不新建平行类型。
- `packages/control-plane/src/adapters/sources/cap-fs.ts` -- `loadCapConfigRevisions(capRoot)` 只读把 `.cap/manifest.toml`+`profiles/*.toml`+`lock.json`（含 `skill-imports.toml` 归并进 `project_skill_imports`）映射为 `StableConfigRevision[]`；测试用它加载真实 `.cap/`（`general`、`agent-assembler`）与既有 fixture (`tests/fixtures/cap-sample`) 验证。
- `packages/control-plane/src/domain/activation.ts` -- `computePlanHash` 是"确定性、非加密强度、纯字符串哈希"先例（`Math.imul(31, hash)+charCode` 循环），本 Story 在 `plan.ts` 内部按同一算法风格另写一份局部哈希函数（输入不同，故不复用同一函数签名；刻意不改动此既有 Story-3.x 文件）。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts` -- Story 4.1 参照：每个 capability 的 `required` 已在 probe 结果里声明（`permission-mode`/`mcp-project-scope`/`setting-sources` 为 `true`，`hook-deny-return-value` 为 `false`），本 Story 直接读取该字段而非自行判定必需性。
- `packages/control-plane/src/adapters/clients/claude/plan.ts` -- 新增：`ClaudeAdapterPlan`、`ClaudeAdapterPlanCapabilityNote`、`ClaudeAdapterPlanResult`（`'compiled' | 'blocked'` 判别联合）类型 + `compileClaudeAdapterPlan()` 纯函数（本 Story 的全部新逻辑落点）。
- `packages/control-plane/tests/adapters/claude-plan.test.ts` -- 新增：覆盖 I/O & Edge-Case Matrix 全部行 + 真实 `.cap/`（`general`/`agent-assembler`）经 `loadCapConfigRevisions('.cap')` 编译两次验证 hash 稳定。
- `packages/control-plane/tests/domain/config.test.ts` -- 参照：`revision()`/`ref()` 测试夹具构造惯例，本 Story 新测试文件复用同款写法构造 `StableConfigRevision`/`CapabilityReference`。

## Tasks & Acceptance

**Execution：**
- `packages/control-plane/src/adapters/clients/claude/plan.ts` -- 新增 `ClaudeAdapterPlan`/`ClaudeAdapterPlanCapabilityNote`/`ClaudeAdapterPlanResult` 类型与 `compileClaudeAdapterPlan(revision, probeResults)` 纯函数，实现 Boundaries 中的相关性判定、fail-closed 分类与确定性 hash -- 是 AC1、AC2 的直接落地。
- `packages/control-plane/tests/adapters/claude-plan.test.ts` -- 覆盖 I/O & Edge-Case Matrix 六行，外加"plan 不复制引用内容原文"（断言 plan 的 skills/mcp/instructions 与 revision 上的对象引用值相等、不含新增内容字段）与"真实 `.cap/` 两个 profile 经两次编译 hash 相同"。

**Acceptance Criteria：**
- Given 一份等价于 `.cap/manifest.toml`+`profiles/*.toml`+`skill-imports.toml` 的 `StableConfigRevision`（经 `loadCapConfigRevisions('.cap')` 得到），when 用 Story 4.1 探测得到的 `ClaudeCapabilityProbeResult[]` 调用 `compileClaudeAdapterPlan`，then 产出的 `ClaudeAdapterPlan` 只含硬控制字段（`capabilityPolicy`）与类型化 Instructions/Skills/MCP 引用，不含任何引用内容原文字段。
- Given 同一个 `revision` 与两组仅 `evidenceRef`/`observedAt` 不同、其余字段相同的 `probeResults`，when 分别调用 `compileClaudeAdapterPlan`，then 两次返回的 `planHash` 相等，且都不产出候选/评分/推荐字段。
- Given `revision` 引用了某个种类（mcp/skills/hooks）且对应 capability 的 probe `status` 为 `unsupported`/`unknown`，when 该 capability `required: true`，then 结果为 `{ kind: 'blocked' }` 且 `missingRequiredCapabilities` 列出该项；when `required: false`，then 结果为 `{ kind: 'compiled' }` 且 `planStatus: 'degraded'`、`degradedCapabilities` 列出该项，都不静默忽略、不伪装成已装配。
- Given `bun test` 与 `bun run typecheck` 在 `packages/control-plane` 下执行，when 本 Story 改动落地，then 既有全部测试保持通过（不回归 Story 4.1 交付的 330 项），新增测试全部通过，`tsc --noEmit` 零错误。

## Design Notes

- **为什么类型定义在 `plan.ts` 而不是 `application/ports.ts`：** `application/ports.ts` 里的类型要么是接口（多实现的 port，如 `ClaudeCapabilityProbePort`），要么是纯数据形状但服务于某个 port 的输入/输出（如 `OmpSpawnParams`）。`compileClaudeAdapterPlan` 零 IO、不需要可替换实现，其类型只服务于这一个纯函数，参照 `domain/activation.ts` 把 `LaunchPlan`/`computePlanHash` 放在使用它们的同一处、不为它们单独造 port 的先例。
- **为什么放在 `adapters/clients/claude/` 而不是 `domain/`：** 虽然 `compileClaudeAdapterPlan` 本身零 IO（技术上满足 domain/ 的"无 Bun/文件系统/进程环境"约束），但 Story 4.1 已经把同样"给定 Fact 后是纯计算"的 `capability-probe.ts`（`findOptionWindow`/`extractParenListTokens` 等纯字符串算法）放在 `adapters/clients/claude/` 而非 `domain/`——本 Story 遵循同一先例，把 Claude 专属的、不跨客户端复用的产物形状（`ClaudeAdapterPlan`）与其编译逻辑一起放在 adapter 目录，也符合 Architecture Spine 目录注释"`adapters/clients/claude/` # probe、plan、launch/resume、interpret"。`domain/` 继续只放跨客户端共享的 `StableConfigRevision`/`Fact`/`ClientId` 等既有概念。
- **为什么必需性判断先看"是否引用"再看"probe 的 required"：** 单看 probe 的 `required` 字段会导致一个从不使用 MCP 的装配，仅因为 `claude.mcp-project-scope-control` 恰好是 `required: true` 就被 fail closed——这与"必需能力缺失时整体 fail closed"里"必需"应指"这份装配实际依赖的能力"矛盾。先用装配意图的资产种类过滤相关性，再用 probe 的 `required` 判定是否 fail closed，是唯一能让"引用 MCP 才检查 MCP 能力"与"AD-10 fail closed 只约束必需能力"同时成立的读法。
- **真实环境下的当前结果：** 按 Story 4.1 的既有探测（本机 `claude 2.1.241`），`permission-mode`/`mcp-project-scope`/`setting-sources` 三项均为 `supported`，`hook-deny-return-value` 恒为 `unknown` 且 `required: false`。当前 `.cap/profiles/general.toml`、`.cap/profiles/agent-assembler.toml` 的 `hooks`/`mcps` 均为空，只有 `agent-assembler` 引用了非空 `skills`——因此两个 profile 编译出的 `planStatus` 预期都是 `'ready'`（`setting-sources-control` 相关且 supported，`mcp`/`hook` 不相关，不进入 `capabilityPolicy`）。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 全部既有测试（Story 4.1 交付的 330 项）+ 本 Story 新增测试全部通过，0 fail

## Auto Run Result

**实现摘要：** 新增 `packages/control-plane/src/adapters/clients/claude/plan.ts`，交付纯函数 `compileClaudeAdapterPlan(revision, probeResults)`：把一份已存在的装配意图（`StableConfigRevision`，等价于 `.cap/manifest.toml`+`profiles/*.toml`+`skill-imports.toml` 当前表达的引用集合）与 Story 4.1 的 `ClaudeCapabilityProbeResult[]` 编译为确定性 `ClaudeAdapterPlan`。先按装配意图是否引用对应资产种类（mcp/skills/hooks）过滤出"相关" capability（`claude.permission-mode-control` 恒相关），再按 AD-10 fail-closed 规则分类：`supported` 无影响，`degraded` 记入 `degradedCapabilities`（整体仍 `degraded` 但产出可用 plan），`unsupported`/`unknown` 时若 `required:true` 则整体 `blocked`（不产出 hash/plan），否则同样记入 `degradedCapabilities`。成功编译的 plan 只含硬控制字段（`capabilityPolicy`）与类型化 Instructions/Skills/MCP 引用（直接复用 `revision` 上的对象引用，不复制内容），`planHash` 显式排除 `evidenceRef`/`observedAt` 等易变证据字段，只对 `(capabilityId,required,status)` 与三组引用的 `(kind,name,sourceCategory)` 签名（均排序后拼接）计算确定性哈希。

**改动文件：**
- `packages/control-plane/src/adapters/clients/claude/plan.ts` -- 新增：`ClaudeAdapterPlan`/`ClaudeAdapterPlanCapabilityNote`/`ClaudeAdapterPlanBlocked`/`ClaudeAdapterPlanResult` 类型 + `compileClaudeAdapterPlan()`；审查后补充：三组引用签名在拼入 hash 前各自 `sort()`，修复潜在的"相同装配意图、不同数组顺序 -> 不同 hash"缺口。
- `packages/control-plane/tests/adapters/claude-plan.test.ts` -- 新增：覆盖 I/O & Edge-Case Matrix 全部六行 + 引用内容不被复制 + 不产出候选/评分/推荐字段 + 真实 `.cap/`（`general`/`agent-assembler`）经两次编译验证 hash 稳定；审查后补充四个测试：hash 随 capability 状态变化而变化、hash 随引用内容变化而变化、hash 对引用数组顺序不敏感、多个必需能力同时 blocked 时全部列出。
- `_bmad-output/implementation-artifacts/spec-4-2-装配-claude-code-的确定性-adapterplan.md` -- 本规格文件本身（状态流转 draft -> ready-for-dev -> in-progress -> in-review -> done）。

**审查发现分布：** patch 3（已全部修复并重新验证：2 medium + 1 low）、defer 1（medium，记入 frontmatter `deferred`）、reject 6（均 low，记录理由未改代码）、intent_gap 0、bad_spec 0。四条并行审查视角（blind-hunter、edge-case-hunter、verification-gap、intent-alignment）中，intent-alignment 与 verification-gap 的完整结果通过后台子代理拿到；blind-hunter 与 edge-case-hunter 两个子代理未能在原有异步通知机制下确认完成，改由本轮协调者直接对已落地代码执行等价的"至少十项发现"式盲审与"穷举分支"式边界审查，产出的发现（重复 capabilityId、plugins 不参与判定、判别联合形状不对称、哈希碰撞风险、类型别名隔离、组合测试冗余）经分类后均为 reject 或已被上述 patch 覆盖。

**follow-up 审查建议：** `followup_review_recommended: true`（本轮 patch 计分 3×2(medium) + 1×1(low) = 7 ≥ 5，触发 true 条件；无 high severity patch）。

**验证执行：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误（含审查补丁后的重新验证）。
- `cd packages/control-plane && bun test` -- 344 pass / 0 fail / 1199 expect() calls（既有 330 项 + 本 Story 初版新增 10 项 + 审查补丁新增 4 项），无回归。

**残留风险：**
- frontmatter `deferred` 记录的 `AssemblyManifest`/`AdapterPlan` 命名落差：Story 4.3/4.4 引入真正 argv/env 形状的 AdapterPlan 时需要重命名本 Story 的 `ClaudeAdapterPlan`（如改名 `ClaudeAssemblyManifest`）以避免撞名，不阻塞本 Story 交付。
- `claude.hook-deny-return-value` 仍如 Story 4.1 交付时那样恒为 `unknown`（`required:false`），任何引用 hooks 的装配意图目前都会落入 `planStatus:'degraded'`；这是 Story 4.1 已记录的已知限制，等待 Story 4.3/4.4 的 controlled-integration 验证，本 Story 未改变也未消解这一限制。
- 本轮 review 的 blind-hunter/edge-case-hunter 两个并行子代理审查通过异步通知机制未能确认完成（详见上文"审查发现分布"），已由协调者本人补跑等价审查并入三条 patch；建议后续如需更高置信度，可对本文件独立再跑一次 `bmad-code-review` 或等价审查工具复核。
