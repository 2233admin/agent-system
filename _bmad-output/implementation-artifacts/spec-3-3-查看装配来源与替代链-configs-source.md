---
title: 'Story 3.3：查看装配来源与替代链'
type: 'feature'
created: '08-23-2026'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      buildSupersedesChain/getSupersedesChain do not validate that a predecessor/successor
      revision shares the same configName as the revision being viewed.
    evidence: |-
      supersedesRevisionId is only unique per id, not scoped to configName at the DB
      level, so a write-path bug or manually-edited data could make a chain silently
      cross configs with no error. This is a write-side invariant (what gets stored
      into supersedes_revision_id) owned by Story 3.1/3.2, not by 3.3's read-only
      traversal -- out of 3.3's explicit "no write-path changes" scope.
    location: >-
      packages/control-plane/src/domain/config.ts (buildSupersedesChain)
    severity: low
  - summary: >-
      A duplicate supersedesRevisionId across two revisions (fan-out) is silently
      overwritten in buildSupersedesChain's successorOf map with no dangling/ambiguity
      marker.
    evidence: |-
      Only reachable via corrupted/manually-edited data or a pre-unique-index legacy
      database -- the spec's Design Notes deliberately assumed "healthy data has at
      most one edge" per Story 3.1's unique index and did not ask for fan-out handling,
      matching the shipped behavior. Worth hardening in a future pass for defensive
      consistency with how dangling references already are handled.
    location: >-
      packages/control-plane/src/domain/config.ts:buildSupersedesChain (successorOf construction)
    severity: low
  - summary: >-
      A cycle in supersedesRevisionId stops traversal safely but renders identically
      to a cleanly-terminated chain -- corruption is not surfaced to the user.
    evidence: |-
      The spec's Boundaries only required cycle *safety* (no infinite loop), which is
      met and tested; it did not require cycle *detectability* in the rendered output.
      Only reachable via corrupted/manually-edited data.
    location: >-
      packages/control-plane/src/domain/config.ts:buildSupersedesChain
    severity: low
  - summary: >-
      buildSupersedesChain(revisions, revisionId) called with a revisionId absent from
      revisions returns an empty chain indistinguishable from "verified no history".
    evidence: |-
      Not reachable through the current sole caller (getSupersedesChain calls findById
      first, guaranteeing revisionId's presence barring an impossible same-process
      race), but buildSupersedesChain is an exported, reuse-oriented pure function
      (Design Notes: "未来任何调用方...都能...复用") -- a future direct caller (e.g.
      Story 3.2) passing a mismatched pair would get a misleading silent result.
    location: >-
      packages/control-plane/src/domain/config.ts:buildSupersedesChain
    severity: low
  - summary: >-
      formatCapabilityRef's line grows dense/wide once real (non-Unknown) sourceRef/
      contentFingerprint values are long hash-like strings; no wrapping considered.
    evidence: |-
      Cosmetic/layout concern only visible once real fingerprint data exists (current
      fixtures/tests use short placeholder strings); a display-layout decision better
      made with real data in view rather than guessed now.
    location: >-
      packages/control-plane/src/cli/render.ts:formatCapabilityRef
    severity: low
baseline_revision: '0aa0b82b45ef3dc7cba4d4afe56b6026f9858aaf'
---

<intent-contract>

## Intent

**Problem:** Story 3.1 已把 `sourceRef`/`contentFingerprint`（每个能力引用的装配来源）以及 `triggerCategory`/`evidenceRef`（修订建立缘由）和 `supersedesRevisionId`（替代关系指针）持久化，但 `configs show` 完全不渲染这五个字段——用户看不到一条配置修订的内容来自哪里，也看不到它替代了谁、后来又被谁替代。

**Approach:** 纯读侧扩展，不改 schema、不改写路径。`domain/config.ts` 加一个纯函数，从已加载的修订全集里双向遍历 `supersedesRevisionId` 指针，产出某个修订的替代链（更早的前驱链、更新的后继链）；`application/queries.ts` 包一层把它接到 `ConfigRevisionRepository`；`cli/render.ts` 在 `renderDetail` 里补上触发类别/证据引用行和每条能力引用的来源引用/内容指纹，并新增一个独立的替代链渲染函数；`cli/index.ts` 的 `show` 分支在打印详情后追加替代链两行。

## Boundaries & Constraints

**Always:**
- 只读：不新增迁移、不新增写端口方法、不触碰 `SqliteConfigRevisionWriter`/`establish` 路径。
- 替代链遍历只用现有 `ConfigRevisionRepository.listAll()`/`findById()`，不新增 SQL 查询方法。
- 前驱链、后继链都必须有环路防护（`visited` 集合），防止数据异常时死循环；遇到悬空的 `supersedesRevisionId`（指向的修订不在已加载全集里）不得抛错，按 AD-8 记录为“无法解析”状态并停止该方向的遍历，其余方向/其余修订不受影响。
- 无前驱/无后继时必须显式打印“（无）”，不得省略该行（AD-8 一贯的“Unknown/空不得静默省略”）。
- 新增替代链渲染逻辑放在独立导出函数（不要塞进 `formatCapabilityRef`/`renderDetail` 内部私有逻辑），因为并发进行的 Story 3.2（`configs revise`，会真正产出非空 `supersedesRevisionId`）大概率也需要在其写入成功的输出里展示"替代自"，需要能直接复用这个函数而不是重新实现一遍。
- 触发类别/证据引用行、每条能力引用的来源引用/内容指纹行都通过既有 `i18n.t()` 走中英对照，不裸拼英文。

**Block If:** 无——现有 schema/端口已覆盖本 Story 需要的所有数据，本 Story 不产生需要人工确认的架构缺口。

**Never:** 真实数据源抓取；任何写路径改动；`configs establish`/`revise` 的 `supersedes` 冲突转译（3.2 范围）；TUI 详情屏（`cli/tui.tsx`）展示替代链——`renderDetail` 的既有富文本增量会自动流入 TUI，但替代链渲染函数只接到 `show` 子命令，TUI 详情屏本 Story 不接（TUI 需要额外把 `listAll()` 结果传入，属于可选后续增量，不在本 Story 范围内）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 装配来源-正常 | `configs show <id>`，修订含至少一个能力引用 | 详情块新增“触发类别/证据引用”行；每条能力引用行追加来源引用/内容指纹 | N/A |
| 替代链-无前驱无后继 | 目标修订 `supersedesRevisionId` 为 `null`，且没有其他修订指向它 | 追加“替代自：（无）”“后继：（无）” | N/A |
| 替代链-有前驱 | A（`supersedes=null`）← B（`supersedes=A`）← C（`supersedes=B`），查看 C | “替代自”行按从旧到新列出 A、B | N/A |
| 替代链-有后继 | 同上链，查看 A | “后继”行按从近到远列出 B、C | N/A |
| 替代链-悬空引用 | 修订的 `supersedesRevisionId` 指向一个不存在于当前全集的 id | 该方向的链在此处停止，标注“无法解析”，不抛错、不影响其余输出 | 详情其余部分正常打印，exit 0 |
| 替代链-环路 | 数据异常导致 `supersedesRevisionId` 形成环 | 遍历检测到重复 id 立即停止，不死循环 | 覆盖到即可，不必是常见路径 |

</intent-contract>

## Code Map

- `packages/control-plane/src/domain/config.ts` -- 加 `SupersedesLink`/`SupersedesChain` 类型 + 纯函数 `buildSupersedesChain(revisions, revisionId)`（双向遍历，环路防护，悬空引用记录为 `danglingPredecessorId`/`danglingSuccessorId`）；参照文件已有的 `compareRevisions` 风格（纯函数、只吃已加载数组，不做 IO）
- `packages/control-plane/src/application/queries.ts` -- 加 `getSupersedesChain(repository, revisionId)`：`findById` 严格解析当前修订（复用既有 `ConfigNotFoundError`），`listAll()` 取全集喂给 `buildSupersedesChain`
- `packages/control-plane/src/cli/render.ts` -- `renderDetail`(第 103-121 行) 加触发类别/证据引用行；`formatCapabilityRef`(第 69-73 行) 追加来源引用/内容指纹；新增独立导出函数 `renderSupersedesChainSection(chain)`（不并入 `renderDetail`，供 `cli/index.ts` 的 `show` 分支单独调用并拼接，也供未来 Story 3.2 的成功输出复用）
- `packages/control-plane/src/cli/i18n.ts` -- zh/en 各加 `detail.triggerCategory`/`detail.evidenceRef`/`capabilityRef.sourceRef`/`capabilityRef.contentFingerprint`/`detail.supersededFrom`/`detail.supersededBy`/`detail.chainNone`/`detail.chainUnresolvable` 等 key
- `packages/control-plane/src/cli/index.ts` -- `show` 分支（约第 576-588 行）在 `getConfigRevisionDetail` 之后追加调用 `getSupersedesChain` 并拼接 `renderSupersedesChainSection` 的输出；沿用既有 `isConfigQueryError`/`renderQueryFailure` 失败路径（`getSupersedesChain` 对不存在的 id 抛的仍是既有 `ConfigNotFoundError`）
- `packages/control-plane/tests/domain/config.test.ts` -- `buildSupersedesChain` 的单元测试，覆盖 I/O 矩阵六场景
- `packages/control-plane/tests/integration/cli.test.ts` -- `configs show` 的替代链渲染集成测试，复用文件已有的 `sampleRevision`/`seed` 夹具（`StableConfigRevision.supersedesRevisionId` 字段直接可用，无需 `insertRawRow`）

## Tasks & Acceptance

**Execution:**
- `domain/config.ts` -- 新增 `SupersedesLink`/`SupersedesChain` 类型与 `buildSupersedesChain` 纯函数 -- 承载双向遍历与环路/悬空防护，零 IO
- `application/queries.ts` -- 新增 `getSupersedesChain` -- 复用既有 `ConfigNotFoundError`，把 IO（`findById`+`listAll`）和纯遍历粘起来
- `cli/render.ts` -- 扩展 `renderDetail`/`formatCapabilityRef`，新增 `renderSupersedesChainSection` -- 满足“查看装配来源”与“替代链”两部分展示，且替代链渲染独立可复用
- `cli/i18n.ts` -- 补齐中英 key -- 无裸拼英文
- `cli/index.ts` -- `show` 分支接入替代链查询与渲染 -- 保持现有失败路径不变
- 单元测试覆盖 `buildSupersedesChain` 六场景；集成测试覆盖 `configs show` 的来源字段与替代链渲染 -- 满足 I/O 矩阵

**Acceptance Criteria:**
- Given 一个已建立且未被任何修订替代的配置修订，when 执行 `configs show <id>`，then 输出包含触发类别、证据引用，以及每条能力引用的来源引用与内容指纹
- Given 一条形如 A←B←C 的替代链，when 执行 `configs show <C的id>`，then 输出的“替代自”行按从旧到新列出 A、B
- Given 同一条链，when 执行 `configs show <A的id>`，then 输出的“后继”行按从近到远列出 B、C
- Given 目标修订没有前驱也没有后继，when 执行 `configs show <id>`，then 输出显式打印“替代自：（无）”与“后继：（无）”，不省略
- Given 某修订的 `supersedesRevisionId` 指向一个已不在存储全集中的 id，when 执行 `configs show <id>`，then 该方向标注为无法解析，命令仍以 exit 0 正常完成，其余字段不受影响

## Spec Change Log

_（空——本轮评审未触发 bad_spec 回环。）_

## Review Triage Log

### 2026-08-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 5: (high 0, medium 0, low 5)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[low]` `[patch]` `configs show` 拼接 `renderDetail`/`renderSupersedesChainSection` 时用单个换行而非空行分隔，与 `renderDetail` 内部各段落之间的空行惯例不一致（blind-hunter 发现）——改为空行分隔。

## Design Notes

`buildSupersedesChain` 不是 `application/queries.ts` 里的方法，而是 `domain/config.ts` 的纯函数——遵循本包既有分层约定（`compareRevisions` 同样是纯函数，`compareConfigRevisions` 才是接 IO 的应用层包装），使其可以脱离 SQLite 直接单元测试，且未来任何调用方（CLI、TUI、或 3.2 的成功输出）都能在已经手握 `listAll()` 结果时零额外 IO 地复用。

前驱链使用 `current.supersedesRevisionId` 反复查表回溯；后继链反向建一个 `supersedesRevisionId -> revision` 的映射后从当前 id 出发正向查找——由于 3.1 迁移已经给 `supersedes_revision_id` 建了唯一索引，"谁替代了我"这个方向在数据健康时最多一条边，天然是一条链而非树，遍历逻辑无需处理分叉。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全绿
- `cd packages/control-plane && bun run typecheck` -- expected: 无类型错误

## Auto Run Result

**摘要：** 纯读侧扩展 `configs show`：新增装配来源展示（触发类别/证据引用/每条能力引用的来源引用与内容指纹）与双向替代链展示（“替代自：”“后继：”，含空链/悬空引用/环路的显式处理）。未改动任何 schema、迁移或写路径。

**改动文件：**
- `packages/control-plane/src/domain/config.ts` -- 新增 `SupersedesLink`/`SupersedesChain` 类型与纯函数 `buildSupersedesChain`（双向遍历、环路防护、悬空引用记录）
- `packages/control-plane/src/application/queries.ts` -- 新增 `getSupersedesChain`（IO 包装：`findById` 严格解析 + `listAll` 喂给纯遍历）
- `packages/control-plane/src/cli/render.ts` -- `renderDetail`/`formatCapabilityRef` 扩展装配来源字段；新增独立导出函数 `renderSupersedesChainSection`
- `packages/control-plane/src/cli/i18n.ts` -- 补齐中英 8 个新 key
- `packages/control-plane/src/cli/index.ts` -- `show` 分支接入替代链查询与渲染（两块以空行分隔）
- `packages/control-plane/tests/domain/config.test.ts` -- `buildSupersedesChain` 单元测试 7 例，覆盖 I/O 矩阵六场景
- `packages/control-plane/tests/integration/cli.test.ts` -- `configs show` 集成测试 4 例

**评审结果分类：**
- patch 已应用：1（low）—— `show` 拼接改为空行分隔
- defer 已记录：5（均 low）—— 详见 frontmatter `deferred` 列表：跨 config 替代链未校验、`supersedesRevisionId` 分叉被静默覆盖、环路终止与正常终止在渲染上不可区分、`buildSupersedesChain` 被以不存在于全集内的 id 直接调用时返回具有误导性的空链、能力引用行随真实长指纹变长后可能过宽
- reject：8（噪音或已被现有机制覆盖，含：`show` 内两次 `findById` 的 TOCTOU 顾虑对单用户本地 CLI 不成立、悬空标记与既有 `formatFact` 惯例一致、`SupersedesChain.revisionId` 作为自描述返回字段保留、zh/en 新增 key 已被既有 `tests/cli/i18n.test.ts` 的字典对齐测试结构性覆盖、防御性不可达分支缺测试、`renderDetail` 对既有调用方无回归已由全量测试通过验证、`getSupersedesChain` 不会在 `getConfigRevisionDetail` 抛错后执行由控制流保证、TUI 详情屏未接替代链系本 Story 显式排除范围）

**回归复核建议：** `followup_review_recommended = false`（本轮 patch 计分：0 high、0 medium、1 low → `3×0 + 1×1 = 1 < 5` 且无 high，未达阈值）。

**验证：**
- `cd packages/control-plane && bun test` -- 283 pass / 0 fail（含新增 11 个测试）
- `cd packages/control-plane && bun run typecheck` -- 无类型错误

**残留风险：** 见上方 5 项 defer，均为“需要手工构造或损坏数据才能触发”的防御性缺口，不影响本 Story 五条验收标准；建议在 Story 3.2（写路径引入真实非空 `supersedesRevisionId`）落地后一并复核是否仍然只是理论风险。另需人工留意：`renderSupersedesChainSection` 是刻意独立导出的可复用渲染函数，Story 3.2 的 `configs revise` 成功输出大概率也要展示“替代自”，建议其直接复用该函数而非重新实现。
