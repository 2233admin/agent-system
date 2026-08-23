---
title: 'Story 3.1：建立新配置修订（configs establish）'
type: 'feature'
created: '08-23-2026'
status: 'done'
review_loop_iteration: 1
context: []
baseline_commit: '9502500d089092e6c46a4717fd223d0803c38ff6'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ConfigRevisionRepository` 只读，没有写路径把 Agent 会话内已裁决候选写成新 `StableConfigRevision`，装配结果无法进入产品、Epic 1 读不到。

**Approach:** 新增 insert-only 写端口 `create(revision, trigger, supersedes)`（新迁移+领域字段扩展），单事务校验并**持久化**触发类别/证据引用、生成 `revisionId`、写入不可变修订；暴露为非交互 `configs establish`，固定传 `supersedes=null`。迁移一次加好 3.2 所需列/索引，但 supersedes 冲突转译与测试留给 3.2。

## Boundaries & Constraints

**Always:**
- 先校验 `trigger.category ∈ {new-scenario, known-insufficiency, bad-case}` 且 `evidenceRef` 非空，**必须早于**读取/解析候选（`--from`/stdin），避免非交互场景卡在 stdin 读取上；失败即零写入。`revisionId` 由端口内部 `crypto.randomUUID()` 生成。
- **`trigger.category`/`evidenceRef` 须持久化为 `StableConfigRevision` 自身字段**（新增 `trigger_category`/`evidence_ref` NOT NULL 列），不是校验完即丢——AD-16/AD-21 的持久事实要求。
- 写端口只暴露 `create`，无 update/delete；不复用 `seed()`/`insertRawRow()`。
- 新迁移加 `supersedes_revision_id`（可空）列 + `(config_name, revision_id)` 复合唯一索引 + `supersedes_revision_id` 唯一索引（供 3.2 复用，本 Story 不测）。
- `CapabilityReference` 新增 `sourceRef`/`contentFingerprint: Fact<string>`，形状同 `sourceCategory`/`summary`（无 `evidenceRef` 兄弟字段）。
- 候选 `known` Fact 的 `value` 须按字段类型校验（如 `defaultMarker` 须 boolean），类型不符零写入，不静默接受。
- 无 `--from` 且 stdin 是 TTY 时立即类型化拒绝，不阻塞等待交互（非交互一等公民，UX-DR2）。
- 失败均 throw 类型化 `Error`（复用 `kind` 标签惯例），CLI `instanceof` 捕获渲染，不裸抛。
- `establish --trigger-category <cat> --evidence <ref> [--from <path>]`（缺省走 stdin JSON）非交互、无 `--yes`；成功复用 `renderDetail`，前置"已建立新配置修订："；失败复用 `renderQueryFailure`，退出码 1。

**Ask First:** 候选 JSON 字段与现有 schema 对不上时，HALT 确认输入形状，不自行发明映射规则。

**Never:** `supersedes` 冲突转译/`revise` CLI（3.2）；"替代自："展示行（3.3）；数据源抓取（AD-20）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 建立成功 | 合法 flags + 候选 JSON | 新增 `supersedes=null` 修订（含持久化的 trigger/evidence），打印详情块 | N/A |
| 缺 trigger-category | 省略该 flag | 零写入，不读取候选 | "缺少触发类别"失败块，exit 1 |
| 缺 evidence | 省略该 flag | 零写入，不读取候选 | "缺少证据引用"失败块，exit 1 |
| 候选字段类型不符 | 如 `defaultMarker` 传字符串 | 零写入 | 类型化"候选内容不合法"失败块，exit 1 |
| 无 `--from` 且 stdin 为 TTY | 未提供任何候选来源 | 立即失败，不阻塞 | 类型化"未提供候选内容"失败块，exit 1 |

</frozen-after-approval>

## Code Map

- `domain/config.ts`(33-38, 52-63) -- 加 `sourceRef`/`contentFingerprint`/`supersedesRevisionId`/`triggerCategory`/`evidenceRef`；`application/launch.ts:92-94` -- `generateId(prefix)` 参照
- `application/ports.ts` -- 参照 `queries.ts` `ConfigNotFoundError`(6-13) `kind`+throw 惯例；新增缺 trigger/evidence/类型不符/无候选来源四类错误
- `adapters/sqlite/repository.ts`(257-268 PRAGMA/迁移参照；299-430 严禁复用的 `seed()`/`insertRawRow()`)；`factColumns` 抽共享函数供写端口复用；`validateCapabilityEntry` 补新字段存在性检查，缺失按 AD-8 视为 `Unknown` 而非崩溃
- `migrations/0003_supply.sql` -- 参照 `0001_init.sql`/`0002_launch.sql` STRICT+forward-only；加 `trigger_category`/`evidence_ref` NOT NULL 列
- `cli/index.ts` -- `parseCommand`(153-184) 加 `establish`（先校验 trigger/evidence 再读候选；无 `--from` 且 `stdin.isTTY` 立即拒绝；不调用 `openDeps()`；候选每个 `known` 值按字段类型校验）
- `cli/render.ts` -- 复用 `renderDetail`(103-122)、`renderQueryFailure`(132-134)
- `cli/i18n.ts` -- zh/en 加成功首句+4 失败 key+usage；错误详情走 `i18n.t()`，不裸拼英文
- `tests/contracts/`、`tests/integration/cli.test.ts` -- 参照现有 `:memory:`/端到端风格；加 `--from` 不存在路径用例

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0003_supply.sql` -- 加 trigger/evidence NOT NULL 列+supersedes 列+两唯一索引 -- 满足 AD-16/AD-21，3.2 复用
- [x] `domain/config.ts` -- 扩展类型 -- 满足 AD-21
- [x] `application/ports.ts` -- 写端口接口+四类类型化错误 -- 复用既有 throw 惯例（四类错误落在新建的 `application/establish.ts`，与 `queries.ts`/`launch.ts` 的既有分层一致；`ports.ts` 只放接口）
- [x] `adapters/sqlite/*.ts` -- 先校验后读候选+生成 ID+insert（含 trigger/evidence）；共享 `factColumns`；`validateCapabilityEntry` 补 Unknown-safe 读取 -- insert-only、fail-closed
- [x] `cli/index.ts`、`render.ts`、`i18n.ts` -- 非交互 `establish`+中英渲染 -- 满足 UX-DR1~DR4、DR7、DR2
- [x] 契约/集成测试覆盖 I/O 矩阵五场景 -- 满足 AR17

**Acceptance Criteria:**
- Given 合法 flags，when 调用 `configs establish`，then 生成且仅生成一条 `supersedes=null` 新修订（含持久化的 trigger category/evidence）并打印详情块
- Given 省略 `--trigger-category` 或 `--evidence`，when 调用，then 不读取候选内容、零写入，打印对应失败块，exit 1
- Given 候选 JSON 某字段类型与其声明类型不符，when 调用，then 零写入，打印类型化失败块，exit 1
- Given 无 `--from` 且 stdin 为 TTY，when 调用，then 立即失败而非阻塞，exit 1
- Given 写端口 `create` 接口，when 检查类型，then 编译期即不存在 update/delete

## Spec Change Log

- **触发：** review-loop 1（三层评审 intent_gap）——trigger/evidence 只校验未持久化，违反 AD-16/AD-21。
- **修订：** Boundaries 加持久化两列要求、校验先于读候选、TTY 快失败、候选语义类型校验、`validateCapabilityEntry` 的 Unknown-safe 读取；I/O 矩阵加两行。
- **避免坏状态：** trigger/evidence 写入即丢、无候选来源时无限阻塞、类型错误候选被静默 persist。
- **KEEP：** 写端口整体设计（insert-only、迁移一次加好 3.2 所需列/索引、supersedes 处理留给 3.2、`crypto.randomUUID()`、CLI/render/i18n 复用）未被推翻，重新实现时保留。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全绿
- `cd packages/control-plane && bun run typecheck` -- expected: 无类型错误

## Suggested Review Order

**持久化核心（本轮 intent_gap 的修复点）**

- 触发类别/证据引用先校验、非空后作为普通字符串字段（不是 `Fact<T>`）声明在修订上，为持久化铺路
  [`establish.ts:42`](../../packages/control-plane/src/application/establish.ts#L42)
- `StableConfigRevision` 新增 `triggerCategory`/`evidenceRef`/`supersedesRevisionId`，这是 AD-16/AD-21 要求的持久事实
  [`config.ts:90`](../../packages/control-plane/src/domain/config.ts#L90)
- 写端口 `create()`：单事务生成 `revisionId`、写入 trigger/evidence，insert-only
  [`config-revision-writer.ts:41`](../../packages/control-plane/src/adapters/sqlite/config-revision-writer.ts#L41)

**非交互安全（校验顺序、TTY、重复 flag）**

- `runEstablish`：候选内容完整校验先于构造写端口连接，拒绝路径不接触磁盘 db 文件
  [`index.ts:469`](../../packages/control-plane/src/cli/index.ts#L469)
- 重复 `--trigger-category`/`--evidence`/`--from` 返回 usage error，不静默保留最后一个值
  [`index.ts:194`](../../packages/control-plane/src/cli/index.ts#L194)
- 无 `--from` 且 stdin 为 TTY 时的快速失败判断
  [`candidate-source.ts:13`](../../packages/control-plane/src/cli/candidate-source.ts#L13)

**候选校验**

- `parseCandidateRevision`：逐字段类型校验，缺失 Fact 字段降级为 `Unknown`，类型不符整体拒绝
  [`establish.ts:154`](../../packages/control-plane/src/application/establish.ts#L154)
- `configName` 先 trim 再判空，避免空白变体产生不同的 config
  [`establish.ts:163`](../../packages/control-plane/src/application/establish.ts#L163)

**Schema 与迁移**

- 新迁移：`trigger_category`/`evidence_ref` NOT NULL 列 + `supersedes_revision_id` 列 + 两个唯一索引（供 3.2 复用）
  [`0003_supply.sql:12`](../../packages/control-plane/migrations/0003_supply.sql#L12)
- 迁移幂等 guard：`ALTER TABLE` 撞见 "duplicate column name" 时当作已迁移吞掉，避免并发连接崩溃
  [`repository.ts:342`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L342)

**错误处理与 i18n**

- `formatErrorReason` 的穷尽性 `default` 分支，未来新增错误 kind 会编译报错而不是静默 `undefined`
  [`render.ts:143`](../../packages/control-plane/src/cli/render.ts#L143)
- 候选内容不合法的失败文案：中文句子里显式标注嵌入的英文字段路径不是待翻译文案
  [`i18n.ts:123`](../../packages/control-plane/src/cli/i18n.ts#L123)

**测试（外围）**

- 写端口契约测试：insert-only 接口形状、trigger/evidence 持久化
  [`config-revision-writer.test.ts:39`](../../packages/control-plane/tests/contracts/config-revision-writer.test.ts#L39)
- `establish` 端到端集成测试：I/O 矩阵五场景 + 重复 flag/非法 JSON/kind 不匹配
  [`cli-establish.test.ts:90`](../../packages/control-plane/tests/integration/cli-establish.test.ts#L90)
- 读路径对"Story 3.1 之前"存量数据的 Unknown-safe 兼容测试
  [`repository.test.ts:183`](../../packages/control-plane/tests/contracts/repository.test.ts#L183)
