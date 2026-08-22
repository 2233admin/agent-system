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
