---
title: 'Story 3.1：configs establish code review 发现修复'
type: 'bugfix'
created: '08-23-2026'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '6451388b3d04b32af5e5d340ca1eb0f47e2200d9'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.1（`configs establish` 写路径，commit b63709f）的 code review 发现 4 条待修正确性问题：`parseFact` 对存在但类型错误的 `unknown`-kind Fact 静默改写默认值而非拒绝；写端口 `create()` 不自行校验 `triggerCategory`/`evidenceRef`；迁移门控用单列判断整批 ALTER 导致半迁移库静默失败；并发迁移竞态守卫漏了 `SQLITE_BUSY`。（另有 3 条复用/简化类清理项已拆分记入 `deferred-work.md`，不在本轮范围。）

**Approach:** 逐项修正，复用本文件/相邻文件已有的姊妹模式（`known` 分支的拒绝逻辑、已定义但未调用的 `InvalidTriggerCategoryError`/`MissingEvidenceError`、已有的 `pragma_table_info` 按列探测技巧），不引入新机制。

## Boundaries & Constraints

**Always:**
- `kind === 'unknown'` 的 `reason`/`observedAt`：字段缺失沿用默认值，字段**存在但类型错误**时整条 candidate 拒绝（不要整体照抄已删除的 pre-commit 版本——那版本把"缺失"也当错误，比当前文档化的语义更严）。
- `SqliteConfigRevisionWriter.create()` 必须在事务开始（`:71`）前显式校验 `triggerCategory`（合法枚举）与 `evidenceRef`（非空），复用已存在但当前未被调用的 `InvalidTriggerCategoryError`/`MissingEvidenceError`（`application/ports.ts:51-70`），不要新造错误类型或依赖 DB 端 CHECK 约束兜底。
- 迁移门控改为按 `trigger_category`/`evidence_ref`/`supersedes_revision_id` 三列各自独立判断存在性（两个索引已有 `IF NOT EXISTS`，不需要门控）。
- 并发迁移竞态守卫需要同时容忍 `SQLITE_BUSY`/`database is locked` 与 `duplicate column name`；优先加 `PRAGMA busy_timeout` 从根源缓解，而不只是扩大错误文案匹配。

**Ask First:**
- （无——4 条均为可直接机械修正的正确性缺陷，不涉及需要人类拍板的设计取舍。）

**Never:**
- 不改 `EstablishConfigRevisionParams.candidate` 的 `unknown` 类型契约、不抽取共享连接建立 helper、不改 `parseEstablish` 的 flag 哨兵约定——这三项已拆分进 `deferred-work.md`，留给后续单独一轮。
- 不把 `launch-repository.ts` 的同款 PRAGMA/连接逻辑纳入本次（不在 4 条范围内）。
- 不改动 Story 3.2/3.3 尚未实现的功能（`supersedes` 冲突转译、"替代自"展示），只修 3.1 已交付代码里的问题。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| unknown-Fact 类型错误 | `{kind:'unknown', reason:12345}` | 整条 candidate 被拒绝，零写入 | `InvalidCandidateError` |
| triggerCategory 绕过 CLI 直达 writer | `create({triggerCategory:'bogus', evidenceRef:'x', ...})` | 拒绝，零写入 | `InvalidTriggerCategoryError` |
| evidenceRef 绕过 CLI 直达 writer | `create({triggerCategory:'bad-case', evidenceRef:'', ...})` | 拒绝，零写入 | `MissingEvidenceError` |
| 半迁移历史库 | 库只有 `supersedes_revision_id`，无 `trigger_category`/`evidence_ref` | 三列各自补齐缺失列，迁移完整完成 | 不再整体事务回滚 |
| 真实并发 establish | 两进程同时对全新库文件执行 | 一方成功迁移，另一方容忍 busy/duplicate 后继续 | 不再各自因锁竞争失败退出 |

</frozen-after-approval>

## Code Map

- `packages/control-plane/src/application/establish.ts:71-96`(`parseFact`) -- unknown 分支(:87-90)对存在但类型错误的字段静默默认；姊妹 `known` 分支(:92-95)用 `fail()`(:56-58，即抛 `InvalidCandidateError`)正确处理同类情况，照此镜像修正。
- `packages/control-plane/src/adapters/sqlite/config-revision-writer.ts:41-142`(`create()`) -- INSERT 在 :104-111，`triggerCategory`/`evidenceRef` 直接来自 params(:135-136)未经校验，需在 :71 事务开始前插入校验；合法枚举 `TRIGGER_CATEGORIES` 定义于 `establish.ts:33`。
- `packages/control-plane/src/adapters/sqlite/repository.ts:321-348`(`runConfigRevisionMigrations`) -- 单列门控在 :328-331(`pragma_table_info` 查 `trigger_category`)；`migrations/0003_supply.sql` 三条 `ALTER TABLE` 分别加 `trigger_category`/`evidence_ref`/`supersedes_revision_id`。并发守卫在 :336-347，只匹配 `duplicate column name`。两处构造函数（本文件 :363-367、`config-revision-writer.ts:36-37`）均只设了 `journal_mode`/`foreign_keys` 两条 PRAGMA，没有 `busy_timeout`。

## Tasks & Acceptance

**Execution:**
- [x] `application/establish.ts` -- 修正 `parseFact` 的 `unknown` 分支：字段缺失沿用默认值，字段存在但类型错误时调用 `fail()` 拒绝整条 candidate。
- [x] `adapters/sqlite/config-revision-writer.ts` -- `create()` 事务开始前显式校验 `triggerCategory`/`evidenceRef`，不合法时抛对应类型化错误。
- [x] `adapters/sqlite/repository.ts` -- `runConfigRevisionMigrations` 把单列门控拆成三列各自独立门控；并发守卫加 `PRAGMA busy_timeout` 并容忍 busy/locked 类错误。
- [x] `tests/` -- 覆盖 I/O 矩阵的 5 个场景，新增/更新对应单测与仓储合同测试。

**Acceptance Criteria:**
- Given candidate 含 `kind==='unknown'` 且 `reason` 为数字，when 调用 `configs establish`，then 整条被 `InvalidCandidateError` 拒绝、零写入。
- Given 直接调用 `SqliteConfigRevisionWriter.create()` 且 `triggerCategory` 不在合法枚举内，when 执行，then 抛 `InvalidTriggerCategoryError`，不产生任何 DB 写入。
- Given 一个只带 `supersedes_revision_id` 列的历史库文件，when 打开该库，then `trigger_category`/`evidence_ref` 被正确补齐，不出现"迁移失败但被吞掉"的静默状态。
- Given 两个进程同时对同一全新库文件执行 establish，when 并发迁移，then 两者都不因锁竞争而各自失败退出。

## Spec Change Log

- 2026-08-23：初稿约 2700 tokens 超出 1600 目标上限，按 [S] 拆分——把 5/6/7 号清理项（candidate 重复校验、构造函数重复、flag 哨兵不一致）移入 `deferred-work.md`，本 spec 收窄为 4 条 correctness bug。

## Design Notes

- 并发守卫优先修 `PRAGMA busy_timeout`（从根源缓解锁竞争），错误文案匹配范围扩大只作为兜底，不能替代 busy_timeout。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全部通过，包含新增的 5 个场景用例
- `cd packages/control-plane && bun run typecheck` -- expected: 无类型错误

## Suggested Review Order

**迁移门控与并发容忍（核心重构）**

- 单列门控改为逐列门控，且 try/catch 统一覆盖 `ADD COLUMN` 与 `CREATE INDEX` 两类语句，是本轮改动的设计核心
  [`repository.ts:371`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L371)

- `isConcurrentMigrationRace` 作为并发竞态兜底，容忍范围从单一文案扩到 busy/locked
  [`repository.ts:366`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L366)

- 两处构造函数同步加 `PRAGMA busy_timeout`，是并发容忍从根源生效的前提
  [`repository.ts:424`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L424)
  [`config-revision-writer.ts:41`](../../packages/control-plane/src/adapters/sqlite/config-revision-writer.ts#L41)

**写端口自校验**

- `create()` 事务前显式校验 `triggerCategory`/`evidenceRef`，端口不再信任调用方已做过校验
  [`config-revision-writer.ts:55`](../../packages/control-plane/src/adapters/sqlite/config-revision-writer.ts#L55)

**candidate 校验对称性**

- `unknown`-kind Fact 的 `reason`/`observedAt`：缺失走默认值，存在但类型错误则拒绝整条 candidate
  [`establish.ts:92`](../../packages/control-plane/src/application/establish.ts#L92)

**测试（覆盖以上三处修复的边界与并发场景）**

- 双真实进程并发验证锁竞争不导致失败退出
  [`cli-establish.test.ts:304`](../../packages/control-plane/tests/integration/cli-establish.test.ts#L304)

- 两种半迁移历史库状态，含索引创建断言
  [`repository.test.ts:72`](../../packages/control-plane/tests/contracts/repository.test.ts#L72)

- `triggerCategory`/`evidenceRef`（含空白字符串）非法值零写入
  [`config-revision-writer.test.ts:150`](../../packages/control-plane/tests/contracts/config-revision-writer.test.ts#L150)
