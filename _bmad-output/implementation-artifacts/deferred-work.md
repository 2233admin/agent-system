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

- source_spec: none
  summary: configs 自更新客户端（Epic 2 / Story 2.2）——进程启动时后台检查、下载、完整性校验并原地替换本地二进制，接入 src/cli/index.ts 的启动路径。
  evidence: 本次意图（Epic 2：控制面发布与自更新）被判定为多目标，与"打包并发布 release 二进制"（Story 2.1）拆分——后者独立交付即有价值（哪怕没有自动更新，用户也能手动下载装，兑现 AD-2/AD-15 的分发要求），前者依赖后者先发布出真实、带版本号和 checksum 的 release 才能做端到端验证；负责人已确认按 [S] 拆分，Story 2.2 紧跟 Story 2.1 之后做，两者可按 Story 2.1 定的发布契约（release 资产命名/版本号来源/checksum 格式）部分并行开发。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-打包与发布流水线.md`
  summary: `--version` 没有 `-v`/`-V` 短别名，且出现在子命令之后（如 `configs status --version`）或带多余尾随参数时行为未特别处理，只是落进既有的 `parseCommand`/子命令自身参数解析逻辑。
  evidence: blind-hunter 与 edge-case-hunter 审查层发现；都是低影响的边缘用法，不影响 I/O 矩阵定义的四个核心场景，本次不顺手扩展 `--version` 的解析面。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-打包与发布流水线.md`
  summary: 没有任何机制（git hook、CI 检查）防止有人不小心把 `src/cli/version.ts` 里的 `CONFIGS_VERSION` 提交成非 `'dev'` 的值，尽管整套版本注入方案依赖这个文件在仓库里永远是 `'dev'`。
  evidence: blind-hunter 审查层发现，真实的防呆缺口，但成本收益上属于可选加固，不阻塞本次交付。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-打包与发布流水线.md`
  summary: 发布 job 在 `gh release create` 之前没有把 `dist/*` 上传为 workflow artifact，也没有依赖缓存；如果发布步骤失败，交叉编译出的二进制直接丢失，只能整个 job 重跑。
  evidence: blind-hunter 审查层发现，真实的运维便利性缺口，但对个人项目的低频发布节奏影响很小，本次不处理。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-打包与发布流水线.md`
  summary: `gh release create` 只用 `--generate-notes`，没有 changelog 文件、没有区分正式版和预发布 tag（例如 `configs-v1.2.3-beta.1` 仍会被发成正式 Release），也没有更新任何 README/文档说明 `--version` 或如何获取发布的二进制。
  evidence: blind-hunter 审查层发现，均为 spec 明确范围之外的产品/文档细节，不是本次 Story 2.1 的验收要求。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-自更新客户端.md`
  summary: `GithubReleaseUpdater` 直接信任仓库级 `GET /releases/latest`，不按 `configs-v` 前缀过滤——如果本仓库未来出现除 `release-configs.yml` 以外的另一个 GitHub Release 发布来源（当前核实过，仓库里只有这一处 `gh release create`），`/releases/latest` 可能返回非 configs 的 release，`isNewerVersion` 解析失败会 fail-closed 静默停止自更新（不会误更新/降级，但会悄悄失效且无提示）。
  evidence: blind-hunter 审查层（第二轮）发现。修复需要改用 `GET /releases`（列表）并按前缀筛选最新一条，这会改变 spec `Boundaries & Constraints` 里已冻结钉死的固定端点（`.../releases/latest`），需要负责人重新确认端点选择，不是本次可自行决定的机械 patch；当前不可达（仓库唯一的 release 来源就是 configs），且失败模式是安全的静默不更新，不阻塞本次交付。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-自更新客户端.md`
  summary: 自更新客户端没有任何退出开关（如 `CONFIGS_NO_SELF_UPDATE` 环境变量或 `--no-self-update` 参数）、没有检查节流/缓存（每次调用都实打一次未认证 GitHub API，限额 60 次/小时/IP）、失败时没有可选的调试/verbose 日志（`checkAndApply` 整体静默吞掉所有错误，用户和维护者都无从诊断"自更新为什么不生效"）。
  evidence: blind-hunter 审查层（两轮）独立发现。均为合理的运维/可诊断性增强，但 spec 的 `Boundaries & Constraints`/`Never` 明确要求"任一步失败都不得输出到 stdout/stderr/TUI"且"成功和失败都不在正常输出中提示"，加开关/日志需要先决定是否、如何在不违反这条约束的前提下开一个显式 opt-in 例外，属于需要负责人裁决的产品/安全边界问题，不在本次范围内顺手加。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-自更新客户端.md`
  summary: `replaceBinary` 成功更新后产生的 `<execPath>.<旧版本号>.bak` 文件永不清理，多次更新后无限累积；且两次 `rename`（旧文件→`.bak`、临时文件→`execPath`）之间仍有极小非原子窗口——若第二次 rename 失败，`execPath` 会彻底缺失且无自动回滚，只能从 `.bak` 手动恢复；另外没有并发保护，两个同时运行的 `configs` 进程可能同时触发自更新并竞争同一个 `execPath`/`<execPath>.download` 临时文件。
  evidence: blind-hunter 与 edge-case-hunter 审查层（两轮）独立发现。第一项窗口是本次 Spec Change Log 已明确"缩小但不消除"的已知残余风险（verification-gap 审查层第二轮复核确认这是"已明确接受的残余风险，不是隐藏回归"）；`.bak` 清理、失败自动回滚和并发锁都是合理的后续加固方向，但都需要额外设计判断（清理策略、回滚语义、锁的粒度），不是本次可无争议机械修的 patch，留待后续单独处理。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-自更新客户端.md`
  summary: `_bmad-output/implementation-artifacts/sprint-status.yaml` 目前没有 `2-2-...` 这个 story 条目（`development_status` 下只有 `epic-2: in-progress` 和 `2-1-打包与发布流水线: done`），因为 Story 2.2 是本次直接从空白起 spec 的新故事，未经过 `bmad-sprint-planning`/`bmad-create-epics-and-stories` 生成 story 级 sprint-status 条目。
  evidence: `bmad-build` 的 `sync-sprint-status` 子步骤在找不到匹配 story_key 时按设计静默跳过（"warn the user once... and return to caller"）；本次工作流运行期间已提示过一次。留给负责人决定是否需要单独跑一次 sprint-status 生成/修复来补上这个条目，不影响本次代码交付。

- source_spec: none
  summary: 候选功能——`configs use`/`switch` 在真正 fresh 启动 OMP 之前，先对配置引用的 MCP 服务器做一次连通性探测（而不是只做当前已有的 schema/reachability 静态检查），避免用户确认启动后，真正开始任务时才发现某个 MCP 连不上。
  evidence: 负责人在对话中提出该诉求并已明确确认排入候选（未指定具体 Epic/Story，留待后续排期裁决）。已就 OMP（`can1357/oh-my-pi`）原生能力做过技术查证：`docs/mcp-config.md` 明确记录的诊断能力（`/mcp list`、`/mcp test <name>`、`/mcp reconnect <name>` 等）全部是 slash command，且文档原文写明在"当前会话"（"in the current session"）中生效，即必须先有一个已经跑起来的 OMP 交互会话才能调用；OMP 未提供任何独立于会话之外的 headless/dry-run/CLI 连通性校验模式。因此 AR11 的 native-first 路径在此不可行——OMP 没有可复用的原生能力。若要落地，需要 Agent System 自行实现，评估过的两个方向：(a) 自建一套探测逻辑独立验证 MCP 连通性，与架构"不持有 OMP 连接状态、避免双事实源"的既有约束冲突；(b) 在真正启动前，临时拉起一个一次性 OMP 进程执行连通性检查后立即退出，再进入用户确认后的正式启动——更贴近诉求本意，但每次确认启动会多付出一次进程拉起/退出的延迟与开销，且需评估探测本身对有副作用的 MCP 服务器（如触发计费、外部状态变更）是否安全。是否排期、选哪个方向、归入哪个 Epic，留给后续专门的 architecture/story 细化阶段裁决。
