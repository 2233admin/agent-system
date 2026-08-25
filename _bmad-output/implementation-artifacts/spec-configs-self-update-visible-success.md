---
title: 'configs 自更新成功路径打印提示'
type: 'feature'
created: '08-23-2026'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '1e162bb18a5649626499d733d07a0288591c81ac'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `spec-2-2-自更新客户端.md` 已修订（correct-course 2026-08-23）：更新成功时必须打印一行提示，失败仍完全静默；但代码仍是旧行为——`checkAndApply` 返回 `Promise<void>`，成功替换后不产生任何输出。

**Approach:** `checkAndApply` 改为返回 `Promise<string | null>`（成功时返回新版本号字符串，其余所有分支返回 `null`），由 `cli/index.ts` 的 `import.meta.main` 块在非 `null` 时打印一行本地化提示；失败路径的整体 try/catch 静默降级完全不变。

## Boundaries & Constraints

**Always:**
- `checkAndApply` 只在替换成功（`replaceBinary` 已返回）时返回新版本号（`parseVersionFromTag` 解出的裸版本号，如 `"1.1.0"`，不带 `configs-v`/`v` 前缀）；其余每个提前 return 分支（dev 模式、无 release、非新版本、平台不支持、资源缺失、哈希不匹配）和 catch 块统一返回 `null`。
- 打印发生在 `cli/index.ts` 的 `import.meta.main` 块，`checkAndApply` 返回非 `null` 时调用 `t('selfUpdate.updated', { version })` 并 `console.log`；`checkAndApply` 本身不直接写 stdout（保持 adapter 不做展示决定的既有约定）。
- 新 i18n key（zh/en）：形如 "configs：已更新到 v{version}（下次启动生效）" / "configs: updated to v{version} (takes effect next launch)"——全角冒号与 zh 字典其余 `configs` 前缀消息一致；括注说明当次调用仍用替换前已加载的旧代码，避免与同次调用里 `--version` 可能显示的旧版本号显得自相矛盾。
- 失败路径（网络失败、校验失败、平台不支持、已是最新版本、dev 模式等）保持完全不变：不打印、不抛出、不阻塞。
- 打印调用必须自带 try/catch，静默吞掉任何异常（如 stdout 提前关闭触发的 EPIPE），不得让打印失败被外层 `import.meta.main` 的 try/catch 当成 unexpectedFailure 而中断用户实际请求的命令。
- `configs --version` 保留"单行裸版本号"契约（`release-configs.yml` 冒烟测试直接依赖）：即将分发的子命令是 `--version` 时跳过打印这条成功提示，其余子命令不受影响。

**Never:** 不改变失败静默的既有行为；不改变固定端点/完整性校验/`.bak` 回滚/零遥测；不给打印加确认或阻塞。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 更新成功（非 `--version`） | 有新版本、平台支持、校验通过 | `checkAndApply` 返回版本号；CLI 打印一行"已更新到 vX.X.X（下次启动生效）" | N/A |
| 更新成功且子命令是 `--version` | 同上，但 `argv[0] === '--version'` | 不打印提示，`--version` 仍只输出裸版本号 | N/A |
| 已是最新版本 | tag 版本不新于当前 | 返回 `null`，不打印，命令继续 | N/A |
| dev/无 release/平台不支持/校验失败/网络失败 | 各自条件 | 返回 `null`，不打印，命令继续 | 静默丢弃（既有行为不变）|

### 修订：提示时机（Issue #153，负责人 2026-08-24 明确激活）

自更新检查改为后台执行后（详见 `spec-2-2-自更新客户端.md` 的同名修订说明），本节"由 `import.meta.main` 在 `checkAndApply` 返回非 `null` 时立刻打印"的机制被取代：后台检查器把装好的版本号记进调度状态文件，改由**第一个真正运行到该版本**的前台调用打印（`reportPendingSelfUpdateNotice`，取代已删除的 `reportSelfUpdateResult`）。因此 i18n 文案从"（下次启动生效）/(takes effect next launch)"改为"（当前已生效）/(now in effect)"——打印时该版本确实已经是当前运行的版本。

未变的部分：一行、只在成功时出现、失败路径完全静默、打印自带 try/catch 吞掉 EPIPE、`--version` 不打印（且提示继续保留到下一个普通子命令，不被吞掉）、adapter 本身不写 stdout。

</frozen-after-approval>

## Code Map

- `application/ports.ts:191-193` -- `SelfUpdatePort.checkAndApply` 签名与其上方文档注释改为 `Promise<string | null>`
- `adapters/self-update/github-release-updater.ts:142-190`（`checkAndApply` 方法体，7 处 `return`/`replaceBinary` 调用行）与类文档注释（125-131 行"never writes to stdout"一句需同步改写）
- `cli/index.ts:640-642`（`import.meta.main` 块内 `checkAndApply` 调用处）及其上方注释（636-639 行"never...produces output"需同步改写）；`t`/`console.log` 已在文件内导入使用（见 57 行、542 行）
- `cli/i18n.ts:27`（zh dict）、`126`（en dict）起各加一个 `selfUpdate.updated` key
- `tests/adapters/self-update.test.ts:164-` -- `describe('GithubReleaseUpdater.checkAndApply', ...)` 下全部约 10 个 test case 的断言需补上返回值检查（成功用例断言等于解析出的版本号，其余全部断言 `null`）

## Tasks & Acceptance

**Execution:**
- [x] `application/ports.ts` -- 改接口签名+文档注释 -- 反映新的返回值语义
- [x] `adapters/self-update/github-release-updater.ts` -- `checkAndApply` 各分支补返回值，成功分支返回 `remoteVersion` -- 满足持久化提示所需数据
- [x] `cli/index.ts` -- 抽出导出函数 `reportSelfUpdateResult(updatedVersion, argv)`，`--version` 时跳过打印，打印调用自带 try/catch -- 满足"成功打印一行提示"+`--version`契约+EPIPE 防御
- [x] `cli/i18n.ts` -- zh/en 各加 `selfUpdate.updated`（全角冒号+"下次启动生效"括注）-- 双语一致
- [x] `tests/adapters/self-update.test.ts` -- 全部 checkAndApply 用例补返回值断言 -- 覆盖 I/O 矩阵场景
- [x] `tests/cli/self-update-notice.test.ts`（新增）-- 覆盖 `reportSelfUpdateResult` 的四个场景（正常打印/null 不打印/`--version` 抑制/打印异常吞掉）-- 补齐 CLI 层此前完全没有覆盖的打印决策逻辑

**Acceptance Criteria:**
- Given 有新版本、平台受支持、校验通过，when 调用 `configs`（编译二进制），then 二进制被替换且 stdout 打印一行含新版本号的提示
- Given 已是最新版本或任一失败条件，when 调用 `configs`，then 不打印任何自更新相关内容，命令按原逻辑继续
- Given `GithubReleaseUpdater.checkAndApply` 的返回值，when 检查类型，then 是 `string | null`，不是 `void`

## Spec Change Log

- **触发：** review round 1（blind-hunter/edge-case-hunter/verification-gap）——`console.log` 无失败模式的假设错误（真实存在 EPIPE 风险）；`--version` 单行裸版本号契约未被考虑；i18n 半角冒号不一致；提示文案未说明"下次启动生效"；CLI 层打印决策逻辑无测试覆盖。
- **修订：** Boundaries 改"打印必须自带 try/catch"+新增"`--version` 跳过打印"要求；i18n 文案改全角冒号+追加"下次启动生效"括注；I/O 矩阵拆出 `--version` 场景为独立行；Tasks 新增 `tests/cli/self-update-notice.test.ts`。
- **避免坏状态：** 打印失败导致整条命令 exit(1)；`--version` 冒烟测试（`release-configs.yml`）因多出一行提示而失败；用户误以为"同次调用已生效"。
- **KEEP：** `checkAndApply` 返回值改造（`Promise<string | null>`）、i18n key 结构、测试断言改造方式未被推翻。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全绿
- `cd packages/control-plane && bun run typecheck` -- expected: 无类型错误

## Suggested Review Order

**成功路径的核心行为**

- `checkAndApply` 成功分支返回裸版本号，其余分支返回 `null`
  [`github-release-updater.ts:145`](../../packages/control-plane/src/adapters/self-update/github-release-updater.ts#L145)
- `reportSelfUpdateResult`：`--version` 跳过打印、打印自带 try/catch 吞异常
  [`index.ts:654`](../../packages/control-plane/src/cli/index.ts#L654)

**i18n**

- zh/en 提示文案：全角冒号 + "下次启动生效"括注
  [`i18n.ts:125`](../../packages/control-plane/src/cli/i18n.ts#L125)

**测试（外围）**

- `reportSelfUpdateResult` 四场景：正常打印/null 不打印/`--version` 抑制/打印异常吞掉
  [`self-update-notice.test.ts:12`](../../packages/control-plane/tests/cli/self-update-notice.test.ts#L12)
- `checkAndApply` 返回值断言改造
  [`self-update.test.ts:164`](../../packages/control-plane/tests/adapters/self-update.test.ts#L164)
