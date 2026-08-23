---
title: 'Story 3.2：修订现有配置（configs revise）'
type: 'feature'
created: '08-23-2026'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      SupersedesConflictError 的转译依赖对 SQLite 原始错误文本做子串匹配，与既有
      isConcurrentMigrationRace 约定一致但同样对驱动错误文案变化脆弱。
    evidence: |-
      config-revision-writer.ts 的 SUPERSEDES_UNIQUE_CONSTRAINT_MESSAGE 常量直接比较
      error.message 是否包含固定子串；bun:sqlite 抛出的是普通 Error，没有暴露稳定的
      错误码（如 SQLITE_CONSTRAINT_UNIQUE）可供替代匹配。blind-hunter 与
      edge-case-hunter 两个独立评审层均指出此点。
    location: >-
      packages/control-plane/src/adapters/sqlite/config-revision-writer.ts
    severity: low
  - summary: >-
      configs revise 复用 3.1 的四个 establish.* i18n key 时，消息文本固定写死
      "configs establish：..."，用户实际输入 revise 时会看到错误的子命令名。
    evidence: |-
      formatErrorReason（cli/render.ts）对 invalid-trigger-category/missing-evidence/
      no-candidate-source/invalid-candidate 四种 kind 直接调用 t('establish.xxx')，
      不区分调用方是 establish 还是 revise；修复需要给 formatErrorReason 增加调用方
      标识以选择 revise.*/establish.* 变体，超出本次 patch 的最小范围。
      verification-gap 评审层发现并确认属实。
    location: >-
      packages/control-plane/src/cli/render.ts
    severity: low
  - summary: >-
      renderQueryFailure 的外层包装对 establish/revise 这类固定字符串 label 显得别扭
      （如"配置 \"revise\"：..."），此问题在 3.1 就已存在，本 Story 只是复用而非引入。
    evidence: |-
      queryFailure.prefix 模板是 '配置 "{revisionId}"：{reason}'，为 show/compare 的
      revisionId label 设计；establish/revise 传入固定字符串而非真实 revisionId 时，
      外层"配置"措辞不准确。blind-hunter 评审层指出，且确认为 3.1 就存在的既有模式。
    location: >-
      packages/control-plane/src/cli/render.ts
    severity: low
  - summary: >-
      supersedesRevisionId 只在 CLI 层（runRevise）做存在性校验，写端口/schema 本身
      不强制其引用完整性（无 FK），绕过 CLI 直连端口的调用方可以插入悬空引用。
    evidence: |-
      SqliteConfigRevisionWriter.create() 信任 params.supersedesRevisionId 是有效的
      revisionId，不做二次查找；这与 configName 等其它字段目前同样不做 FK 约束的既有
      模式一致，非本 Story 独有的新问题。blind-hunter 评审层指出。
    location: >-
      packages/control-plane/src/adapters/sqlite/config-revision-writer.ts
    severity: low
baseline_commit: '112278b7db35061a712edd62c44c4c1537db420b'
baseline_revision: '112278b7db35061a712edd62c44c4c1537db420b'
---

<intent-contract>

## Intent

**Problem:** `configs establish`（Story 3.1）只能新建首条修订，`ConfigRevisionWriter.create()` 固定写 `supersedes=null`；没有非交互路径能对既有配置追加一条"替代旧修订"的新修订，`supersedes` 冲突（并发/重复替代同一目标）也没有任何转译，会以裸 SQLite `UNIQUE constraint failed` 泄漏。

**Approach:** 新增非交互 `configs revise --trigger-category <cat> --evidence <ref> --supersedes <revisionId> [--from <path>]`：复用 3.1 已建好的 schema（`supersedes_revision_id` 列 + 两个唯一索引）与校验/渲染/i18n 惯例，扩展 `EstablishConfigRevisionParams` 加 `supersedesRevisionId: string | null`（`establish` 显式传 `null`，`revise` 传解析出的目标 id），在 CLI 层用只读 `ConfigRevisionRepository.findById` 校验目标存在且 `configName` 一致，在写端口的插入事务里把目标已被替代（唯一索引冲突）的裸 SQLite 错误转译为类型化 `SupersedesConflictError`。不做"替代自："展示行（3.3 范围）。

## Boundaries & Constraints

**Always:**
- 校验顺序与 3.1 一致且更严格：先 `--trigger-category`（`InvalidTriggerCategoryError`）→ 再 `--evidence`（`MissingEvidenceError`）→ 再 `--supersedes` 非空（新 `MissingSupersedesError`）→ 再 TTY 守卫（`NoCandidateSourceError`）→ 最后才读取/解析候选；任一失败零写入、不读取后续输入。
- `--supersedes <revisionId>` 指向的修订必须先用只读 `ConfigRevisionRepository.findById` 查到，且其 `configName` 必须等于候选 JSON 解析出的 `configName`；查不到抛新 `SupersedesNotFoundError`，`configName` 不一致抛新 `SupersedesConfigMismatchError`——均在写端口事务开始前，零写入。
- `supersedes_revision_id` 唯一索引冲突（目标已被其他修订替代，含并发竞争）必须在 `SqliteConfigRevisionWriter.create()` 的插入事务里捕获裸 SQLite `UNIQUE constraint failed: stable_config_revision.supersedes_revision_id` 错误并转译为类型化 `SupersedesConflictError`，不得让原始 `Error` 逃逸到 CLI。
- `EstablishConfigRevisionParams` 加 `supersedesRevisionId: string | null`（必填字段，非 optional）；`establish` 调用点显式传 `null`，不依赖默认值。
- 候选校验、TTY 快失败、类型化错误 `instanceof` 捕获 + `renderQueryFailure`、中英 i18n 双写，完全复用 3.1 惯例，不发明新模式。
- 无 `--from` 且 stdin 为 TTY 时立即失败，不阻塞（同 establish）。

**Never:**
- 不做"替代自："展示行 / `renderDetail` 变更（3.3 范围）。
- 不新增 `update`/`delete` 端口方法；`revise` 仍是 insert-only（新增一条 `supersedes≠null` 的修订，不改写旧修订）。
- 不做真实数据源抓取；候选仍只来自已产出的 JSON（`--from`/stdin）。
- 不引入团队治理/多用户仲裁语义；`supersedes` 冲突只是"同一目标不能被替代两次"的存储约束翻译，不做业务层裁决规则。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 修订成功 | 合法 flags（含存在的 `--supersedes` 目标、configName 一致）+ 候选 JSON | 新增一条 `supersedes=<目标id>` 的新修订，打印详情块 | N/A |
| 缺 `--supersedes` | 省略该 flag | 零写入，不读取候选 | "缺少 supersedes 目标"失败块，exit 1 |
| `--supersedes` 目标不存在 | 传入未知 revisionId | 零写入 | "supersedes 目标不存在"失败块，exit 1 |
| `--supersedes` 目标属于不同 config | 候选 `configName` ≠ 目标修订的 `configName` | 零写入 | "supersedes 目标与候选 configName 不一致"失败块，exit 1 |
| `--supersedes` 目标已被替代 | 目标已是另一条修订的 `supersedesRevisionId` | 零写入 | "supersedes 目标已被替代"失败块（原始 SQLite 错误已转译），exit 1 |
| 缺 trigger-category / evidence | 省略对应 flag | 零写入，不读取候选 | 复用 3.1 既有失败块，exit 1 |
| 候选字段类型不符 | 如 `defaultMarker` 传字符串 | 零写入 | 复用 3.1"候选内容不合法"失败块，exit 1 |
| 无 `--from` 且 stdin 为 TTY | 未提供候选来源 | 立即失败，不阻塞 | 复用 3.1"未提供候选内容"失败块，exit 1 |

</intent-contract>

## Code Map

- `packages/control-plane/src/application/ports.ts:25-29` `EstablishConfigRevisionParams` -- 加 `supersedesRevisionId: string | null`；`:39-41` doc comment 去掉"3.1 always writes null"表述；`:51-98` 附近按既有 `kind`+throw 惯例新增 4 个错误类：`MissingSupersedesError`（`'missing-supersedes'`）、`SupersedesNotFoundError`（`'supersedes-not-found'`，携带 `revisionId`）、`SupersedesConfigMismatchError`（`'supersedes-config-mismatch'`，携带 `revisionId`/`expectedConfigName`/`actualConfigName`）、`SupersedesConflictError`（`'supersedes-conflict'`，携带 `revisionId`）
- `packages/control-plane/src/application/establish.ts:42-54` 参照 `parseTriggerCategory`/`parseEvidenceRef` 加 `parseSupersedesRevisionId(raw: string | undefined): string`（trim 后非空校验，否则抛 `MissingSupersedesError`）；`:31` 的 re-export 列表加新增的 4 个错误类
- `packages/control-plane/src/adapters/sqlite/config-revision-writer.ts:64-81` `revision.supersedesRevisionId` 从硬编码 `null` 改为 `params.supersedesRevisionId`；`:87-155` 事务 `try/catch`：捕获插入时的 `Error`，若 `params.supersedesRevisionId !== null` 且 `.message` 包含 `UNIQUE constraint failed: stable_config_revision.supersedes_revision_id` 则抛 `SupersedesConflictError(params.supersedesRevisionId)`，否则原样 rethrow
- `packages/control-plane/src/domain/config.ts:92-98` `supersedesRevisionId` 字段 doc comment 更新（不再是"reserved for 3.2"，改为说明 `revise` 何时写非 null）
- `packages/control-plane/src/cli/index.ts` -- `:79-80` `USAGE_SYNTAX` 加 `revise` 语法；`:98-111` `ParsedCommand` 加 `revise` 变体（`triggerCategoryRaw`/`evidenceRaw`/`supersedesRaw`/`fromPath`）；参照 `:183-248` `parseEstablish` 写 `parseRevise`（多一个 `--supersedes` 分支，复用既有 `parseError.establishFlagRequiresValue`/`establishFlagRepeated` 通用 key，`{flag}` 传 `'--supersedes'`）；`:250-283` `parseCommand` 加 `case 'revise'`；参照 `:469-523` `runEstablish` 写 `runRevise`：校验顺序 trigger→evidence→supersedes 非空→TTY→读候选→`parseCandidateRevision` 预检查→构造只读 `SqliteConfigRevisionRepository` 调 `findById(supersedesRevisionId)` 校验存在+configName 一致→构造 `SqliteConfigRevisionWriter` 调 `create()`→`renderReviseSuccess`；catch 块增补新 4 类错误 + 复用旧 4 类，`finally` 确保 repository/writer 都 `close()`；`:555-561` 参照 establish 特判，`revise` 同样在 `openDeps()` 之前特判分发（避免语法/TTY 失败也开库文件——注意 `revise` 仍需在通过早期守卫后自行开库做 `findById`/`create`，这点与纯只读命令不同，但同样绕开 `openDeps()` 捆绑的 launchPlan/OMP 端口）
- `packages/control-plane/src/cli/render.ts:104-123` `renderDetail` 不变（"替代自"留给 3.3）；`:132` `QueryOrEstablishError` 联合类型加 4 个新错误类；`:143-164` `formatErrorReason` 的 `switch` 加 4 个新 `case`；仿 `:181-183` `renderEstablishSuccess` 加 `renderReviseSuccess(revision)`（复用 `renderDetail`，前缀换新 key）
- `packages/control-plane/src/cli/i18n.ts` -- zh（`:114-124` 附近）与 en（`:215-225` 附近）各加：`revise.successPrefix`、`revise.missingSupersedes`、`revise.supersedesNotFound`（`{revisionId}`）、`revise.supersedesConfigMismatch`（`{revisionId}`/`{expected}`/`{actual}`）、`revise.supersedesConflict`（`{revisionId}`）；`parseError.establishFlagRequiresValue`/`establishFlagRepeated` 直接复用，无需新 key
- `packages/control-plane/tests/contracts/config-revision-writer.test.ts` -- 参照现有 `withTempDb`/`VALID_CANDIDATE` 惯例，加：先 `create()` 一条基线修订，再 `create({ ..., supersedesRevisionId: baseline.revisionId })` 成功持久化；再对同一 `baseline.revisionId` 二次 `create({ supersedesRevisionId: ... })` 断言 `rejects.toBeInstanceOf(SupersedesConflictError)` 且第二次调用后 `listAll()` 长度仍只增加一条（零写入）
- `packages/control-plane/tests/integration/cli-revise.test.ts`（新文件）-- 完整照搬 `cli-establish.test.ts` 的 `beforeEach`/`afterEach`/`createDataStdin`/`createTTYStdin`/`withFakeStdin`/`listAllRevisions`/`VALID_CANDIDATE` 辅助函数，覆盖 I/O 矩阵全部场景（先用 `main(['establish', ...])` 建一条基线修订拿到 `revisionId`，再驱动 `main(['revise', ..., '--supersedes', baselineId, ...])`）

## Tasks & Acceptance

**Execution:**
- `packages/control-plane/src/application/ports.ts` -- 扩展 `EstablishConfigRevisionParams`，新增 4 个类型化错误类 -- 复用既有 `kind`+throw 惯例，供 CLI `instanceof` 捕获
- `packages/control-plane/src/application/establish.ts` -- 加 `parseSupersedesRevisionId` 校验器 + re-export 新错误类
- `packages/control-plane/src/adapters/sqlite/config-revision-writer.ts` -- `supersedesRevisionId` 参数化 + 插入事务捕获唯一索引冲突转译为 `SupersedesConflictError`
- `packages/control-plane/src/domain/config.ts` -- 更新 `supersedesRevisionId` 字段 doc comment
- `packages/control-plane/src/cli/index.ts` -- 加 `revise` 命令解析（`parseRevise`）、`runRevise` 编排（含 `findById` 目标校验）、`main()` 分发、usage 语法
- `packages/control-plane/src/cli/render.ts` -- 扩展 `QueryOrEstablishError`、`formatErrorReason`，加 `renderReviseSuccess`
- `packages/control-plane/src/cli/i18n.ts` -- zh/en 各加 5 个 `revise.*` key
- `packages/control-plane/tests/contracts/config-revision-writer.test.ts` -- 加 supersedes 成功 + 冲突两个用例
- `packages/control-plane/tests/integration/cli-revise.test.ts`（新建）-- 覆盖 I/O 矩阵 8 场景 + 重复/未知 flag 用例

**Acceptance Criteria:**
- Given 合法 flags（`--supersedes` 指向存在且同 `configName` 的修订）+ 合法候选，when 调用 `configs revise`，then 生成且仅生成一条 `supersedesRevisionId` 等于目标 id 的新修订并打印详情块
- Given 省略 `--supersedes`，when 调用，then 不读取候选内容、零写入，打印失败块，exit 1
- Given `--supersedes` 指向不存在的 revisionId，when 调用，then 零写入，打印失败块，exit 1
- Given `--supersedes` 指向的修订与候选 `configName` 不一致，when 调用，then 零写入，打印失败块，exit 1
- Given `--supersedes` 指向的修订已被另一条修订替代，when 再次调用以相同目标 `revise`，then 零写入，打印失败块（不泄漏裸 SQLite 错误），exit 1
- Given 写端口 `create` 接口，when 检查类型，then 编译期仍不存在 update/delete（`supersedes` 只是新增字段，不是新方法）

## Spec Change Log

_None yet — no bad_spec loopback has been triggered._

## Review Triage Log

### 08-23-2026 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 1, low 7)
- defer: 4: (high 0, medium 0, low 4)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` `runRevise`（`cli/index.ts`）的 catch 分支未处理 `findById` 可能抛出的 `ConfigUnsupportedError`（目标修订 `schema_version` 不受支持或 capability JSON 损坏），会以未捕获异常崩溃而非渲染失败块；补齐 `instanceof`/`isConfigQueryError` 分支，复用 `renderQueryFailure`。
  - `[low]` `[patch]` `runRevise` 的 `finally` 块里 `repository?.close()` 若抛出会导致 `writer?.close()` 永不执行（资源泄漏）；两个 `close()` 各自包一层 `try/catch` 吞掉关闭错误。
  - `[low]` `[patch]` `revise` 全程同时持有 `repository`（读）与 `writer`（写）两个 SQLite 连接，`repository` 在 `findById` 校验通过后应立即 `close()`，不必等到外层 `finally`，减少不必要的锁窗口。
  - `[low]` `[patch]` `SqliteConfigRevisionWriter.create()` 对 `triggerCategory`/`evidenceRef` 有绕过 CLI 直连端口时的防御性再校验，但 `supersedesRevisionId` 没有等价校验（空字符串会被原样持久化）；加一行非空校验（`supersedesRevisionId !== null` 时复用 `parseSupersedesRevisionId` 语义）。
  - `[low]` `[patch]` spec 的 Design Notes 描述 `renderQueryFailure` 的 `label` 应在候选 `configName` 已解析出时优先使用它，但 `runRevise` 实际对三类 supersedes 专属错误始终传固定字符串 `'revise'`；改代码使其匹配 Design Notes 描述的行为（这三类错误都发生在 `parseCandidateRevision` 成功之后，`configName` 已可用）。
  - `[low]` `[patch]` 缺少断言"被替代的基线修订本身在 `revise` 后原样不变"的回归测试；在 `tests/integration/cli-revise.test.ts` 的成功用例里加上该断言。
  - `[low]` `[patch]` `parseSupersedesRevisionId`（`application/establish.ts`）没有直接单元测试覆盖空白字符串输入；仿照 `evidenceRef` 的等价测试补一个。
  - `[low]` `[patch]` `SupersedesConfigMismatchError` 的集成测试只断言输出包含 `'configuration'` 子串，未验证 `revisionId`/`expected`/`actual` 三个字段真的被正确填入消息；加强断言。

**已推迟（defer，记入 frontmatter `deferred`）：**
- `SupersedesConflictError` 的转译依赖对 SQLite 原始错误文本做子串匹配（`UNIQUE constraint failed: stable_config_revision.supersedes_revision_id`），与本仓库既有的 `isConcurrentMigrationRace` 子串匹配约定一致，但两者都对驱动错误文案变化脆弱；有条件时应改用结构化错误码。
- `configs revise` 复用 3.1 的 `establish.missingTriggerCategory`/`missingEvidence`/`noCandidateSource`/`invalidCandidate` 四个 i18n key 时，消息文本仍固定写死"configs establish：..."，会在用户实际输入 `revise` 时显示错误的子命令名；修复需要给 `formatErrorReason` 增加调用方标识以选择 `revise.*`/`establish.*` 变体，属于超出本次 patch 的小型设计改动。
- `renderQueryFailure`/`queryFailure.prefix` 的外层包装（`配置 "{label}"：{reason}`）对 `establish`/`revise` 这类非"配置 id"的固定字符串 label 显得别扭（如"配置 \"revise\"：..."），此问题在 3.1 就已存在，本 Story 只是复用而非引入。
- `supersedesRevisionId` 只在 CLI 层（`runRevise`）做存在性校验，写端口/schema 本身不强制其引用完整性（无 FK），绕过 CLI 直连端口的调用方可以插入悬空引用；与 `configName` 等其它字段目前同样不做 FK 约束的既有模式一致。

## Design Notes

`revise` 的目标校验分两层，理由：
1. **存在性 + configName 一致性**（`findById` + 应用层比较）——这是"好意校验"，能在写事务开始前给出精确错误，但存在 TOCTOU 窗口（校验后、插入前，目标可能被并发替代）。
2. **唯一索引冲突转译**（写端口事务内捕获 SQLite 错误）——这是真正的正确性保证，闭合 1 的 TOCTOU 窗口；`idx_stable_config_revision_supersedes_revision_id` 已由 3.1 建好，SQLite 的 NULL 不参与唯一性去重，因此 `establish`（永远写 `null`）永不触发此约束，只有 `revise` 的非 null 值会。

`renderQueryFailure` 的 `label` 参数沿用 establish 的模式：`revise` 校验失败前若已解析出候选 `configName` 可用它作为 label，否则退回固定字符串 `'revise'`（`establish` 同样对未解析出 configName 的早期失败退回 `'establish'`）。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全绿
- `cd packages/control-plane && bun run typecheck` -- expected: 无类型错误

## Auto Run Result

**实现摘要：** 新增非交互 `configs revise --trigger-category <cat> --evidence <ref> --supersedes <revisionId> [--from <path>]`，复用 3.1 的 schema（`supersedes_revision_id` 列 + 两个唯一索引）、写端口 `create()`、`parseCandidateRevision`、CLI 渲染/i18n 惯例；`--supersedes` 目标先经只读 `ConfigRevisionRepository.findById` 校验存在且 `configName` 一致，写端口插入事务把唯一索引冲突（目标已被替代）转译为类型化 `SupersedesConflictError`，不泄漏裸 SQLite 错误。不含"替代自："展示行（明确留给 3.3）。

**改动文件：**
- `packages/control-plane/src/application/ports.ts` -- `EstablishConfigRevisionParams` 加必填 `supersedesRevisionId: string | null`；新增 4 个类型化错误类（`MissingSupersedesError`/`SupersedesNotFoundError`/`SupersedesConfigMismatchError`/`SupersedesConflictError`）
- `packages/control-plane/src/application/establish.ts` -- 新增 `parseSupersedesRevisionId` 校验器 + re-export 新错误类
- `packages/control-plane/src/adapters/sqlite/config-revision-writer.ts` -- `supersedesRevisionId` 参数化（不再硬编码 `null`）；插入事务 `try/catch` 把唯一索引冲突转译为 `SupersedesConflictError`；对 `supersedesRevisionId` 加防御性再校验（review patch）
- `packages/control-plane/src/domain/config.ts` -- 更新 `supersedesRevisionId` 字段 doc comment（不再是"reserved for 3.2"）
- `packages/control-plane/src/cli/index.ts` -- 新增 `parseRevise`/`runRevise`/`main()` 分发/usage 语法；`runRevise` 校验顺序 trigger→evidence→supersedes 非空→TTY→候选→`findById` 目标校验→`create()`；review patch 补齐 `ConfigUnsupportedError` 处理、`repository`/`writer` 独立 `close()`、`repository` 提前释放、`renderQueryFailure` label 改用已解析出的 `configName`
- `packages/control-plane/src/cli/render.ts` -- `QueryOrEstablishError` 加 4 个新错误类，`formatErrorReason` 加对应 `case`，新增 `renderReviseSuccess`
- `packages/control-plane/src/cli/i18n.ts` -- zh/en 各加 5 个 `revise.*` key
- `packages/control-plane/tests/contracts/config-revision-writer.test.ts` -- 加 supersedes 成功/冲突用例；review patch 补 `parseSupersedesRevisionId` 直接单元测试（含空白字符串）+ writer 层空白 supersedes 防御性校验测试
- `packages/control-plane/tests/integration/cli-revise.test.ts`（新建）-- 覆盖 I/O 矩阵全部 8 场景 + 重复/未知 flag 用例；review patch 加"被替代基线修订原样不变"回归断言 + 加强 `SupersedesConfigMismatchError` 消息字段断言

**评审结果：** 4 层并行评审（blind-hunter / edge-case-hunter / verification-gap / intent-alignment）。intent_gap 0，bad_spec 0。触发 8 个 patch（1 medium + 7 low，均已修复并重新验证）、推迟 4 个 defer（记入 frontmatter `deferred`：SQLite 冲突文本子串匹配的脆弱性、`revise` 复用 establish i18n 文案导致的子命令名不准确、`queryFailure.prefix` 对非 revisionId label 的措辞别扭[3.1 既有]、`supersedesRevisionId` 无 schema 级 FK 约束[与既有模式一致]）、拒绝 3 个 reject（i18n key 命名沿用 establish 前缀、spec 自报 `oversized`、Code Map 行号轻微漂移）。

**Follow-up review recommendation：** `true`（本轮 patch 计 1 medium + 7 low，`3×1 + 1×7 = 10 ≥ 5`）。

**验证：**
- `cd packages/control-plane && bun run typecheck` -- 通过，无类型错误
- `cd packages/control-plane && bun test` -- 295 pass / 0 fail（24 files），复跑一次确认稳定；`cli-establish.test.ts` 的既有并发测试"真实并发 establish"在无关改动下偶发因 Windows SQLite 锁竞争超时失败（重跑必过），是 Story 3.1 遗留的既有 flake，非本 Story 引入

**残留风险：**
- 见 frontmatter `deferred` 四项（均为 low severity，已记录，不阻塞交付）
- `cli-establish.test.ts` 的并发测试在 Windows 上偶发 flake（Story 3.1 遗留，未在本 Story 范围内修复）
