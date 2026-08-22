- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: `requestConfigSwitch` is not transactional across its two `LaunchPlanRepository.save()` calls -- if `prepareLaunchPlan` throws while creating the replacement plan (e.g. a future `UnsupportedClientError` reachable outside the CLI's own pre-validation), the previous plan is left stranded in `requires-restart` with no replacement plan and no compensating rollback.
  evidence: raised independently by the blind-hunter and edge-case-hunter review layers against the Story 1.2 diff; not reachable through the shipped CLI today (client is validated to `'omp'` before `requestConfigSwitch` is ever called, and a not-found/unsupported new revision does not throw -- `prepareLaunchPlan` resolves it to a `failed` plan instead), so it does not block Story 1.2's acceptance criteria, but is a real gap if `requestConfigSwitch` is ever called from a new call site or a second client becomes supported.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: `configs status`/`use`/`switch` silently ignore trailing/extra positional arguments (e.g. `configs status <id> <garbage>`) instead of returning a usage error, unlike the stricter validation `show`/`compare` already have from Story 1.1.
  evidence: raised by the blind-hunter review layer; a real CLI consistency/UX gap, but low severity (extra tokens are simply dropped, not misinterpreted as something harmful) and not required by any of Story 1.2's acceptance criteria.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: launch-context JSON files written by `FsLaunchContextWriter` (`<state-dir>/launch-context/<planId>.json`) are never cleaned up -- there is no retention policy or garbage collection, so the directory grows unbounded over the life of a machine/user.
  evidence: raised by the blind-hunter review layer; a real operational-hygiene gap, but out of Story 1.2's scope (no cleanup/observation infrastructure is required by any acceptance criterion, and Story 1.1 similarly ships no cleanup for its own on-disk artifacts).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: rare application-layer failures during `runLaunchFlow` (e.g. `confirmLaunchPlan` hitting a stale confirmation, or `launchOmp` failing inside the capability-probe/context-writer calls in a way that itself throws rather than resolving to a `failed` plan) are not individually try/caught in `cli/index.ts`, so they surface through the generic top-level "configs: unexpected failure: ..." handler instead of the typed `renderLaunchFailure` view.
  evidence: raised by the edge-case-hunter review layer; these paths are already safely caught and reported (non-zero exit, no crash, no data corruption) by the existing top-level `catch` in `if (import.meta.main)`, just with a less polished message than the rest of the Story's typed failure rendering -- a genuine but cosmetic gap, not a functional defect.
  severity_reassessment (informational, second independent review pass -- annotation only, underlying gap still not fixed): a later independent code review reassessed this item's severity from "cosmetic" to "real but non-blocking" -- these paths do reach the user as an unpolished, un-typed message (`configs: unexpected failure: ...`) rather than the Story's typed `renderLaunchFailure` rendering, which is a real (if narrow) inconsistency in the CLI's failure-reporting contract, not merely a stylistic nit. It remains non-blocking for Story 1.2's acceptance criteria (no crash, no data corruption, non-zero exit still returned) and is left as documented deferred work, not fixed by this pass.

- source_spec: `_bmad-output/implementation-artifacts/spec-cli-ux-delta.md`
  summary: `src/cli/i18n.ts` 里的中文文案在全角标点和半角 ASCII 空格之间混排（例如 `指令： （未配置）`，来自 `${label} ${t('capabilityGroup.emptySingle')}`），中文排版不够地道。
  evidence: blind-hunter 审查层发现；纯文案打磨问题，不是功能缺陷，任何验收标准都未要求这一点。

- source_spec: `_bmad-output/implementation-artifacts/spec-cli-ux-delta.md`
  summary: 新增的交互式 TUI 入口（交互 TTY 下不带参数运行 `configs`）在 `USAGE`/帮助文本里完全没有提及，用户读到打印出的用法说明也无法得知它的存在。
  evidence: blind-hunter 审查层发现；是合理的体验打磨建议，但 DESIGN.md/EXPERIENCE.md 与 spec-cli-ux-delta.md 的 Tasks & Acceptance 均未要求 `USAGE` 提及 TUI（EXPERIENCE.md 的 Key Flows 里用户就是直接敲 `configs` 自然发现的）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: `openDeps()`（`packages/control-plane/src/cli/index.ts`）构造 `ompPort`/`capabilityProbe`/`contextWriter`（`new BunOmpProcessPort()` 等）的代码在保护 `configRepository`/`launchPlanRepository` 构造的 try/catch 之外——如果这三个构造函数中任意一个抛出异常，已打开的 SQLite 句柄会泄漏，异常本身也不会被捕获。
  evidence: edge-case-hunter 审查层针对 spec-cli-ux-delta.md 的 diff 提出，但核实为历史遗留问题：这个结构（端口构造在仓储 try/catch 之外）在 spec-cli-ux-delta.md 的 `openDeps()` 抽取之前，`main()` 里就已经原样存在（Design Notes："openDeps() 抽取只是把 main() 现有...行原样搬到一个可复用函数,不改变其错误处理/close顺序"）。不是 Story 1.2 或本次 CLI UX delta 故事引入的问题；归属到 Story 1.2 作为原始来源。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: `validateCapabilityEntry`（`packages/control-plane/src/adapters/sqlite/repository.ts`）只校验能力条目的 `name` 字段，不校验 `sourceCategory`/`summary` 这两个同样必填的 `Fact<T>` 字段——手工改坏的行或未来某个写入路径的 bug 若产生缺失/畸形的 `sourceCategory`/`summary`，会顺利通过解析，之后在 `render.ts` 的 `formatCapabilityRef` 调用 `formatFact`/`isKnown` 时因访问 `undefined.kind` 而抛出未捕获异常，而不是走该函数文档承诺的 `ConfigUnsupportedError`/降级到 `[]` 路径。
  evidence: /code-review skill 独立审查发现，经我本人对照 `repository.ts`/`facts.ts`/`render.ts` 源码核实为真实缺口。当前所有写入路径（seed 脚本等）都不会产生这种畸形数据，不可达；但作为一个类型契约上的防御性缺口，值得后续单独修一次而不是在本次 UX delta 顺手改——这属于 Story 1.2 复盘行动项 2（`parseCapabilityJson` 校验）本身的完整性问题，不是本次 TUI/i18n/颜色改动引入的。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-选择配置并使用-omp.md`
  summary: 同一处新增的按条目 `name` 校验，在 `findById`（严格模式）与 `listAll`（宽松模式）下对同一条脏数据反应不一致——`configs list` 会把畸形的 `hooks`/`plugins` 条目静默清空后照常显示该修订版本，而 `configs show`/`configs use` 同一个 id 会直接抛 `ConfigUnsupportedError` 拒绝显示/启动，即使出问题的字段（如 hooks）本来就不会被实际用于启动。
  evidence: /code-review skill 独立审查发现，经核实为真实的 list/show 不一致行为。修复需要先做一个设计判断（该让 list 也变严格，还是让 show/use 对不影响启动的字段变宽松），不是可以无争议地机械修的 patch，留给后续专门处理，不阻塞本次合并。

- source_spec: `_bmad-output/implementation-artifacts/spec-cli-ux-delta.md`
  summary: `application/launch.ts` 里 `applyFailure` 记录的失败原因（如 `revision-lookup: ${error.message}`、`spawn-process: ${error.message}`）是原始英文诊断文本，拼进已经本地化的 `t('failure.reason', {reason})` 句子后，在默认中文环境下会出现"原因：revision-lookup: configuration revision not found (...)"这种中英混杂的句子。
  evidence: /code-review skill 独立审查发现，经核实为真实的中文默认体验瑕疵。未修复的原因：这些诊断字符串来自 `application/launch.ts` 内部拼接以及更底层的 `ConfigNotFoundError`/`ConfigUnsupportedError` 等既有错误类（Story 1.1/1.2 遗留，非本次改动新增），要完整翻译需要动到这些错误类自身的 message，范围超出本次 UX delta 的边界；处理方式与 Design Notes 里对 `computeKnownDifferences` reason code 不翻译的既有决定一致——都被视为诊断性代码而非说明性整句，先记录，不在本次里扩大范围修。

- source_spec: `_bmad-output/implementation-artifacts/spec-cli-ux-delta.md`
  summary: `launchOmp`（`application/launch.ts`）里 `getConfigRevisionDetail` 的重新读取和 `capabilityProbe.probeStatusViewingCapability()` 两个互不依赖的调用是顺序 await 而不是并发执行，每次启动都要付出两者延迟之和而不是取两者较大值。
  evidence: /code-review skill 独立审查发现，属实但是纯性能建议、不是正确性缺陷。改成 `Promise.all` 会改变失败路径行为（revision 查询失败时探针调用现在会跳过，并发后会变成两者都执行），属于需要额外判断取舍的改动，本次不顺手改，留待后续单独评估。

- source_spec: `_bmad-output/implementation-artifacts/spec-cli-ux-delta.md`
  summary: `tests/cli/tui.test.tsx` 里的 `FakeConfigRevisionRepository`/`FakeLaunchPlanRepository`/`FakeOmpProcessPort` 等一整套 fake 实现与 `tests/application/launch.test.ts` 里已有的 fake 几乎逐字重复，两处未来任一接口变化都要同步改两份，否则会有一份悄悄过期。
  evidence: /code-review skill 独立审查发现，真实的测试维护性问题，但不影响当前正确性，属于测试基础设施重构（抽取共享 fake 模块），本次不顺手做，留待后续测试整理时处理。
