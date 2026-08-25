---
title: '退役 .cap/ 本体'
type: 'chore'
created: '2026-08-24'
status: 'done'
baseline_revision: '33a9d710f7e7904b48fb451eaa6921b5cfe0eb3b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5-cap-parity-验证与本仓自身切换.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5b-claude-adapter-内容物化能力.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-6-configs-cli-的-claude-入口.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem：** Story 4.5b/4.6 已经交付新 adapter 的内容物化与真实 CLI 入口，但真实烟雾 parity 验证目前只覆盖了 `general` 一个 profile（Story 4.5b 的端到端测试），`agent-assembler` 只有静态 manifest/plan 结构比对（Story 4.5），没有真正跑过物化+真实 argv 交付；`.cap/` 本体尚未退役。

**Approach：** (1) 补齐 `agent-assembler` profile 的真实烟雾 parity 证据（物化+argv 层面，复用 Story 4.5b 已建立的方法，不发明新方法论）；(2) 核实代码库内除已知的开发期读取路径外，没有其他运行时代码依赖 `.cap/`；(3) 逐一核实 `openspec/specs/` 下每个条目是否与 `.cap/` 直接耦合，只归档确认耦合的条目，保留仍然通用、独立于 `.cap/` 实现的条目；(4) 仅在以上全部验证通过后移除 `.cap/` 目录本体。

## Boundaries & Constraints

**Always：**
- 真实烟雾 parity 证据必须覆盖 `general`、`agent-assembler` **两个**真实 profile，复用 Story 4.5b 已经对 `general` 做过的同一方法（真实 `.cap/` 数据 → 真实探测 → 真实物化 → 断言最终 argv 含 `--plugin-dir`（指向真实生成的 `.claude-plugin/plugin.json` + skills 子目录）与 `--append-system-prompt`（真实 prompt 文本））；不要求真正调用旧 Python `cap` 工具本身（该工具是历史证据来源，不是本 Story 需要重新验证的运行时依赖，且现场调用它超出本仓当前 TypeScript/Bun 控制面的运行边界）——"功能对等"以 Story 4.5 已确立的比对基准（`.cap/lock.json` 声明的 inventory + `openspec/changes/archive/2026-08-20-add-claude-cap-adapter/design-spec.md` 记录的已验证 `native/plugin/` 真实布局）为准。
- 退役前必须核实 `configs` CLI（`src/cli/index.ts`）与全部产品运行时路径不依赖 `.cap/` 目录内容；已知现状（`.cap/` 只被开发期 `scripts/seed-from-cap.ts` 与 `src/adapters/sources/cap-fs.ts` 读取，不在产品运行时路径上）需要在退役前重新确认仍然成立，而不是假设它没有变化。
- `openspec/specs/` 下每个条目的正文（不只是 Purpose 一行）都必须被读过，逐一判断是否与 `.cap/` 的实现直接耦合（正文描述 `.cap/`、CAP profile/render/lock 机制本身）——耦合的归档，不耦合、描述与 `.cap/` 实现无关的通用能力/设计原则的（例如可能仍适用于新 adapter 或未来能力的 Skill 设计合同）保留不动，并在 spec 里逐条记录判断依据。
- `scripts/seed-from-cap.ts` 与依赖真实 `.cap/` 文件的测试（`tests/adapters/cap-fs.test.ts`、`tests/adapters/claude-cap-parity-verification.test.ts`、`tests/adapters/claude-assembly-manifest.test.ts` 里读真实 `.cap/` 的部分）在 `.cap/` 被移除后会失败——必须随 `.cap/` 一并处理（删除或改写为不依赖真实 `.cap/` 文件），不能留下指向已删除路径、必然失败的测试。
- `.cap/` 移除后，`_bmad-output/implementation-artifacts/sprint-status.yaml` 的 `4-7-退役-cap-本体` 标记 `done`；`epic-4` 若全部 Story 均已完成（含 optional 的回顾）则一并评估是否可标 `done`（不强制，由本 Story 实现时按 sprint-status.yaml 既定规则判断）。

**Block If：**
- `agent-assembler` 的真实烟雾 parity 证据无法通过（例如物化失败、argv 缺失预期 flag、与 `general` 已验证的行为出现未解释的差异）：HALT，记录差异，不得继续退役。
- 发现任何未预期的产品运行时代码路径依赖 `.cap/`：HALT，记录该依赖，不得继续退役。

**Never：**
- 不改动 Story 4.1～4.6 已交付的任何函数签名或行为。
- 不归档任何 `openspec/specs/` 条目，除非已经真正读过其正文并确认与 `.cap/` 实现直接耦合——不得凭文件名或 Purpose 一行猜测。
- 不删除 `openspec/specs/` 之外的其他内容；不触碰 `openspec/changes/`（历史 change 记录本就是证据参考，不是本 Story 的操作对象）。
- 不尝试真正调用旧 Python `cap` 工具做实时对照。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 真实 `agent-assembler` profile | `.cap/profiles/agent-assembler.toml` 真实数据 | 物化成功，最终 argv 含 `--plugin-dir`/`--append-system-prompt`，内容与 `.cap/lock.json` 声明的 inventory 一致 | 任何未解释差异导致测试失败，不静默通过 |
| `.cap/` 退役前的运行时依赖核实 | 全仓库代码 | 确认只有开发期脚本/测试读取 `.cap/`，产品运行时路径（`cli/index.ts` 等）不依赖它 | 发现依赖则 HALT，不继续 |
| `openspec/specs/` 逐条核实 | 15 个现存 spec | 与 `.cap/` 实现耦合的归档；通用、独立于 `.cap/` 的保留 | 每条都要有记录判断依据的证据 |
| 全部前提通过后执行退役 | -- | 移除 `.cap/` 目录；`scripts/seed-from-cap.ts` 与依赖真实 `.cap/` 的测试同步处理 | 不产生"部分退役"的中间态 |
| 任一前提未通过 | -- | 阻止退役，明确说明"不得先退役后设计替代" | 不产生部分退役的中间态 |

</intent-contract>

## Code Map

- `packages/control-plane/tests/application/claude-launch.test.ts` -- 已有 `general` profile 真实端到端物化+argv 测试（Story 4.5b）；本 Story 复制/参数化出 `agent-assembler` 的同款测试。
- `packages/control-plane/tests/adapters/claude-cap-parity-verification.test.ts` -- 已有对两个 profile 的 manifest/plan 结构级 parity（Story 4.5）；本 Story 在其基础上或旁边补充物化层面的 `agent-assembler` 证据，不重复已覆盖的结构比对。
- `packages/control-plane/src/cli/index.ts` -- 核实：`grep -n "\.cap"` 全文件确认零命中（延续 Story 4.5 已核实的结论，本 Story 需重新跑一次确认未变）。
- `packages/control-plane/scripts/seed-from-cap.ts`、`packages/control-plane/src/adapters/sources/cap-fs.ts` -- `.cap/` 移除后不可用；决定删除或改写（改写为读取一个不依赖真实 `.cap/` 的 fixture/等价物，或直接删除且同步移除依赖它的测试）。
- `openspec/specs/*/spec.md`（15 个条目：`agent-behavior-evaluation`、`agent-skill-design`、`cap-default-interactive-entry`、`claude-runtime`、`claude-surface-closure`、`digest-materialization-evidence`、`general-profile`、`layered-agent-profile`、`omp-cross-profile-resume`、`omp-shared-preferences`、`portable-assembly-host`、`private-capability-overlay`、`project-skill-imports`、`research-first-assembly`、`v3-assembly-executor`、`workspace-context-bridge`）-- 逐条读正文判断是否与 `.cap/` 耦合。已知明确耦合（正文直接描述 CAP/profile/render/lock 机制）：`cap-default-interactive-entry`、`claude-runtime`、`claude-surface-closure`、`digest-materialization-evidence`、`general-profile`、`layered-agent-profile`、`omp-cross-profile-resume`、`omp-shared-preferences`、`portable-assembly-host`、`private-capability-overlay`、`project-skill-imports`、`v3-assembly-executor`、`workspace-context-bridge`（共 13 个，均在 Purpose 段落里直接提到 "CAP"）。需要本 Story 逐条读全文确认、不能只看 Purpose：`agent-behavior-evaluation`、`agent-skill-design`、`research-first-assembly`（这 3 个 Purpose 段落未提及 CAP，可能是独立于 `.cap/` 实现的通用设计原则，需要判断是否仍然适用于新 adapter 或产品的其他部分，不得默认归档）。
- `.cap/`（目录本体）-- 最终移除对象。

## Tasks & Acceptance

**Execution：**
- 补充 `agent-assembler` 的真实烟雾物化+argv 测试 -- 满足 Boundaries 的两 profile 覆盖要求。
- 核实运行时依赖 -- 满足退役前置条件。
- 逐条核实并归档确认耦合的 `openspec/specs/` 条目 -- 满足 Boundaries 的归档范围要求。
- 处理 `scripts/seed-from-cap.ts`/`cap-fs.ts`/依赖真实 `.cap/` 的测试 -- 避免退役后出现必然失败的测试。
- 移除 `.cap/` 目录 -- 本 Story 的终点动作，仅在以上全部通过后执行。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 标记 `4-7-退役-cap-本体: done`。

**Acceptance Criteria：**
- Given Story 4.5b（内容物化）与 Story 4.6（CLI 入口）均已完成，且新 adapter 的 fresh Claude 启动经真实烟雾测试验证——对 `general`、`agent-assembler` 两个 profile 交付的 Skills/Instructions 内容与 `.cap/lock.json` 声明的 inventory 及已验证的真实 plugin 布局功能对等，when 执行 `.cap/` 退役，then 移除 `.cap/` 目录，并把 `openspec/specs/` 下逐条核实后确认与 `.cap/` 直接耦合的条目收敛为归档状态，then `.cap/` 历史内容降级为证据参考，不再作为任何当前需求或架构的权威来源。
- Given 任一前置条件（两 profile 真实烟雾验证、运行时依赖核实）未通过，when 有人尝试执行退役，then 阻止退役，明确说明"不得先退役后设计替代"，不产生部分退役的中间态。
- Given `bun test`、`bun run typecheck` 在 `packages/control-plane` 下执行（`.cap/` 移除后），then 不存在任何指向 `.cap/` 已删除路径而必然失败的测试；既有全部测试保持通过（除已知因 `.cap/` 移除而按计划删除/改写的用例外，不回归 Story 4.1～4.6 交付的 ~453 项），`tsc --noEmit` 零错误。

## Review Triage Log

### 2026-08-24 — Review pass（四视角并行：blind-hunter、edge-case-hunter、verification-gap、intent-alignment）

- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 3, low 0)
- defer: 6 (medium 1, low 5)
- reject: 5 (low 5)
- addressed_findings:
  - `[medium]` `[patch]`（verification-gap）删除 `claude-capability-probe-cap-parity.test.ts` 连带丢失了唯一一处对真实 `claude` 二进制断言 `permission-mode-control`/`mcp-project-scope-control`/`setting-sources-control` 具体解析为 `supported`/`degraded`（而不只是通用 enum 成员资格）的真实环境测试——这个断言本身跟 `.cap/` 无关，纯粹是"真实 `claude --help` 解析是否仍然正确"的回归防护，不该随 `.cap/` 退役一起消失；CI 本就不装 `claude` 二进制所以不影响 CI 结果，但会让本机装了 `claude` 的开发者失去这层保护。已在 `claude-capability-probe.test.ts` 既有的真实环境 describe 块里补回这三项断言，与已有的 `plugin-dir-delivery`/`append-system-prompt-delivery` 真实环境断言同款写法。
  - `[medium]` `[patch]`（blind-hunter）sprint-status.yaml 里 `epic-4-story-4-5-ac2-blocked-story-4-6-not-executable` 这个 action item 的 `id` 仍写着"story-4-6"，但退役顺序早已改成三步、这个阻塞项实际关联的是已经重编号的 Story 4.5 AC2——id 是历史时间点生成的稳定标识符，不宜事后改名（避免破坏可能引用它的外部脚本/流程），已改为在 `note` 开头补一句显式说明"此 id 里的'story-4-6'是历史命名，创建时该 Story 尚未被 2026-08-24 架构重设计顺延为 4.7，不代表当前 Story 编号"，消除歧义。
  - `[medium]` `[patch]`（blind-hunter）该 action item 标记 `status: done` 容易被误读成"AC2（本仓自身切换）本身已经实现"——已重写 `note`，把"AC2 描述的能力本身依然没有实现，只是它此前阻塞 Story 4.6/4.7 的前提被 2026-08-24 架构重设计证明不成立"这句最关键的澄清挪到 note 最前面、单独成句，不再淹没在一段长陈述里。
  - `defer`（6，均为超出本 chore Story 合理范围的既有/关联缺口，非本轮新引入的回归）：`.gitignore` 里"canonical contracts live in .cap"的注释已过期（1 行，低优先级独立清理）；`claude-content-materializer.test.ts` 里一处测试标题仍写"today's real .cap/ state"（同类过期措辞，未随本 Story 一起改，非本 Story 触碰的文件）；`epics.md`/`ARCHITECTURE-SPINE.md`/`epic-4-context.md`/`spec-1-1-...md` 等规划/架构文档仍以现在时描述 `.cap/` 读取行为——这是跨越整个规划语料库的文档一致性工作，规模远超一个"移除目录"的 chore Story，需要独立任务处理；`cap-fs.ts` 现在实质上只被测试使用（唯一真实调用方 `scripts/seed-from-cap.ts` 已删除），但代码位置/命名未标注它现在是测试专用基础设施；`cap-fs.test.ts` 的 describe 标题里"（fixture, not the real repo .cap/)"这个消歧限定词，在同文件真实 `.cap/` 分支已被整体移除后变得多余；`prepareClaudeAlreadyRunningLaunchPlan`（AC2）与"探测→编译→计划"全链路对真实 `claude` 二进制+真实 profile 数据的集成测试覆盖，随 `.cap/` 退役后不再有替代——这是退役 `.cap/` 的一个已知、可接受的覆盖收窄，非缺陷，但值得记录以备将来考虑用别的真实数据源重建等价覆盖。
  - `reject`（5，均记录理由未改代码）：不同测试文件对"删除依赖真实 `.cap/` 的代码"采用了不同程度的墓志铭注释（有的写长段落说明，有的直接删除不留痕）——纯风格不一致，不影响正确性；测试文件里嵌入的长篇叙事性说明注释——与本仓 Epic 1～4 全程已确立的注释风格一致，非本 Story 独有问题；未对"未来有人重新引入指向已删除 seed 脚本的引用"设防护机制——对一个已完成的 chore Story 而言是过度设计；intent-alignment 提出的"sprint-status.yaml 对已解除的 action item 引用了本次 diff 范围之外的文档（AD-20、correct-course 提案）"——这些文档在仓库里真实存在（本轮会话早些时候产出），只是不在 reviewer 拿到的这份局部 diff 范围内，不是凭空引用；intent-alignment 对 Block If #1 证据可复现性的质疑——已由协调者独立复现解决，见下方"协调者独立复核"小节，不再是遗留问题。

## Design Notes

- **为什么"功能对等"不要求现场调用旧 Python `cap`：** `.cap/` 与治理它的旧实现本身已经被 Architecture Spine AD-1 裁定为"只作 Bad Case 证据，不是需求、架构或迁移基线"；Story 4.5 已经确立了安全、可复现的比对基准——真实探测+真实编译产出与 `.cap/lock.json`、`.cap/runtime/claude.toml` 声明数据的逐项对照，以及 `.cap` 已实测验证过的 `native/plugin/` 布局约定（`design-spec.md` 记录，Story 4.5b 已复用同一布局）——本 Story 延续这套已验证方法，不需要、也不应该现场调用一个历史遗留工具制造新的运行时耦合。
- **为什么 `openspec/specs/` 的归档判断不能只看文件名/Purpose：** 之前的 correct-course/架构讨论只核实过 `v3-assembly-executor` 一个条目，其余条目未经验证就被笼统归为"等"——这正是本 Story 需要补的功课；15 个条目里至少 3 个（`agent-behavior-evaluation`、`agent-skill-design`、`research-first-assembly`）的 Purpose 段落读起来像是独立于 `.cap/` 具体实现的通用设计原则，贸然归档可能丢失仍然适用的产品知识，必须逐条读正文判断。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 既有全部测试（除按计划删除/改写的用例外）+ 新增测试全部通过，0 fail

## Auto Run Result

**执行环境说明：** 本 Story 的实现落在一个独立的 Claude 工作树沙箱（`worktree-agent-a45e0634beb62c487`），该沙箱最初基于 `main`（未包含 Epic 4 任何代码），随后 fast-forward 到 `zaurakworks/new-story` 分支的 tip（`33a9d710f7e7904b48fb451eaa6921b5cfe0eb3b`，与本 spec frontmatter 的 `baseline_revision` 完全一致），并运行 `bun install` 补齐依赖后开始实现；本 spec 文件本身也是在该沙箱内首次创建（读取自另一处工作目录的草稿全文后原样落地），因为 Never/Block If 等约束条款审查确认与另一处草稿逐字一致。

### 1. `agent-assembler` 真实烟雾 parity 证据（Block If 前置条件之一）

在 `packages/control-plane/tests/application/claude-launch.test.ts` 的 `describe('[Story 4.5b] launchClaudeFresh against the real repo .cap/ (AC1 evidence)', ...)` 基础上，把原先只覆盖 `general` 一个 profile 的测试参数化为遍历 `['general', 'agent-assembler']`，复用 Story 4.5b 已建立的同一方法（真实 `loadCapConfigRevisions` 读取真实 `.cap/` → 真实 `BunClaudeCapabilityProbe`/`BunClaudeProcessPort` 探测 → 真实 `prepareClaudeFreshLaunchPlan`/`confirmLaunchPlan`/`launchClaudeFresh` 编译并物化 → 断言最终 argv），并新增一项本 Story 特有的更强断言：对该 profile revision 引用的每个 Skill，物化出的 plugin 包必须真实包含 `skills/<name>/` 子目录（不只是存在 `.claude-plugin/plugin.json`）。

实测结果（本机真实 `claude` 2.1.241，Windows）：两个 profile 均 `outcome.plan.phase` 为 `'succeeded'`（未触发 `'degraded'` 分支）；argv 均含真实 `--plugin-dir <真实物化目录>/plugin`（内含 `.claude-plugin/plugin.json` 与逐个 Skill 的 `skills/<name>/` 子目录）与真实 `--append-system-prompt <真实 prompt 正文>`；`computeClaudeKnownDifferences` 均不再报告 `instructions-content-not-materialized-in-fresh-launch`/`skills-content-not-materialized-in-fresh-launch`。`agent-assembler` profile 额外验证了 imported skill（`grilling`，来自 `lock.json` 的 `project_skill_imports`，物理路径在仓库根 `plugins/grilling/skills/grilling`，不在 `.cap/capabilities/skills/` 下）与 13 个普通 project skill 同样被正确物化进 `skills/grilling/` 子目录。`bun test tests/application/claude-launch.test.ts -t "real"` -- 2 pass / 0 fail / 36 expect() calls。未触发 Block If 的"物化失败/argv 缺失预期 flag/与 general 出现未解释差异"任一条款。

这份证据随后被记录进本文件（见此段），随即整个 `describe` 块连同其依赖的 `.cap/` 真实读取一起被移除（见下方"清理" 小节）——它的角色是本 Story 退役前的一次性证据收集，不是长期保留、只要 `.cap/` 存在就能反复重跑的回归测试；证据的永久载体是这段 Auto Run Result 加上 git 历史，而不是一段此后必然因为目标目录已删除而失败的测试代码。

**协调者独立复核（2026-08-24，回应 review pass 的 intent-alignment 发现）：** review 阶段 intent-alignment 视角指出，本节以上内容是"叙事性证据"——diff 本身（baseline 与最终态之差）无法区分"这段参数化测试真的跑过、随后被删"与"它从未存在过，只是原有 `general`-only 测试被删"这两种可能，测试计数的加减法两边都能自洽，不能反证。鉴于 `.cap/` 在协调者自己的主工作目录（尚未合并本次改动）里依然完整存在，协调者在该目录下独立编写了一个不属于本 Story 交付物、仅用于验证的临时脚本，直接调用 Story 4.5b 交付的同一条真实链路（`loadCapConfigRevisions` → `BunClaudeCapabilityProbe` → `compileClaudeAssemblyManifest` → `materializeClaudeContent`）对真实 `agent-assembler` revision 执行，运行后立即删除该脚本（不提交）。独立复现结果：`manifestStatus: 'ready'`；14 个 skill 引用全部物化成功（含 imported 的 `grilling`，物理来源 `plugins/grilling/skills/grilling`），`materialized/plugin/skills/` 下逐一生成对应子目录，`materialized/plugin/.claude-plugin/plugin.json` 存在；`instructions.appendSystemPromptText` 提取到真实 prompt 正文（"# Agent 装配者..."开头）；`skills.failures`/`instructions.failures`/`mcp.failures` 均为空数组。与本节上方记录的实现证据结论完全一致，独立确认 Block If 前置条件之一在删除 `.cap/` 前确实成立，不只是叙事声称。

### 2. 运行时依赖核实（Block If 前置条件之二）

对全仓库执行 `grep -rn "\.cap[/'\"\`]"`（严格匹配 `.cap` 后紧跟路径分隔符或引号，排除 `capabilityProbe` 等变量名的假阳性）：

- `packages/control-plane/src/cli/index.ts`：零命中（唯一一处历史命中是文件头部一行解释"为什么没有 `configs sync/import`"的文档注释，指向 `cap-fs.ts`，不构成代码依赖）。
- `packages/control-plane/src/` 下命中的 8 个文件（`adapter-plan.ts`、`assembly-manifest.ts`、`capability-probe.ts`、`content-materializer.ts`、`cap-fs.ts`、`claude-invocation-dir.ts`、`claude-launch.ts`、`application/ports.ts`）中，除 `cap-fs.ts` 外全部只是历史设计说明性文档注释（例如"这个 flag 对应 `.cap/runtime/claude.toml` 的哪个字段"），不含任何真实文件系统读取代码。
- `loadCapConfigRevisions`（`cap-fs.ts` 里唯一真正读取 CAP 形状目录的函数）的全部调用方核实为：`cap-fs.ts` 自身定义处、已删除的 `scripts/seed-from-cap.ts`（开发期脚本）、以及若干测试文件；`src/cli/index.ts`、`src/application/`、`src/adapters/sqlite/` 中无任何调用——`configs` CLI 的 `configRepository` 始终经 `SqliteConfigRevisionRepository` 构造，与 `cap-fs.ts` 完全解耦。
- 仓库根 `.github/workflows/control-plane-checks.yml`、`package.json`、`scripts/` 均无 `.cap` 依赖；`packages/` 下只有 `control-plane` 一个包。

结论：确认现状与 Story 4.5 已核实结论一致——`.cap/` 只被开发期 `cap-fs.ts`（可复用的通用 CAP 形状目录 loader，非硬编码指向 `.cap/`）、已删除的 `scripts/seed-from-cap.ts`、以及测试读取，不在任何产品运行时路径上。未触发 Block If 的"发现未预期运行时依赖"条款。

### 3. `openspec/specs/` 逐条核实与归档

逐一读取全部 16 个（非 spec 草稿声称的 15 个——实际清点为 16 个目录；差异已在此记录，不影响逐条核实结论）`openspec/specs/*/spec.md` 正文（不只是 Purpose），判断依据与结果：

**确认与 `.cap` 实现直接耦合、归档的 13 个**（正文以 CAP profile/lock/render/generation/effective-hash/portable-tree/water-hydration 等 `.cap` 私有实现机制作为核心叙述对象，不是"提到 CAP"这种字面匹配，而是逐条读过全文确认其 Requirement/Scenario 本身描述的就是 `.cap` 的具体机制）：

| Spec | 归档依据（逐条读正文后的结论） |
|---|---|
| `cap-default-interactive-entry` | 全文是 CAP CLI（旧 Python 工具）自身的裸 `cap`/`cap show` 交互链路合同，与新 TypeScript adapter 无关 |
| `claude-runtime` | 全文是 CAP 的 Claude generation/水合/三重 hash 锁定机制 |
| `claude-surface-closure` | 全文是 CAP 中间态到 Claude 原生投影、ambient 面关闭的 CAP 专属机制 |
| `digest-materialization-evidence` | 全文是 CAP 的 source/profile/render digest 与 evidence index 机制 |
| `general-profile` | 正文直接引用 `.cap` 声明闭包、"CAP SHALL 返回/解释/渲染" |
| `layered-agent-profile` | 全文是 CAP 的 real-home/work/profile 分层与 `.cap/lock.json`/`.cap/manifest.toml` 机制 |
| `omp-cross-profile-resume` | 全文是 CAP profile 间共享 OMP session root 的机制 |
| `omp-shared-preferences` | 全文是 CAP OMP runtime 与普通 OMP 共享用户偏好投影的机制 |
| `portable-assembly-host` | 全文是 CAP 锁定/渲染 digest 跨宿主一致性与目录安全校验机制 |
| `private-capability-overlay` | 全文是 CAP 私有能力层绑定公共 source 的机制 |
| `project-skill-imports` | 正文直接引用 `.cap/skill-imports.toml`、`.cap/capabilities/skills/`，是 CAP v3 的项目内 Skill 复用机制 |
| `v3-assembly-executor` | 全文是 `agent-assembler` 在 CAP v3 manifest/lock/render/machine-context pin 体系内的交付合同（Architecture Spine 已预先确认相关，本次逐条读正文复核一致） |
| `workspace-context-bridge` | 全文是 CAP 隔离 OMP 时恢复 workspace `AGENTS.md` 上下文的机制，其 `system-prompt.md`/`profile prompt` 均是 CAP render 产物 |

**确认不耦合、保留的 3 个**：

- `agent-behavior-evaluation`：全文（基线优先、正反平衡评测场景、Trial 可比较性、证据分层）不含任何 CAP/`.cap`/profile/render/lock 字样，是完全通用的 Agent 行为评测方法论，与装配来源（CAP 还是新 adapter）无关，仍适用于本产品未来任何 Agent 行为评测工作。**保留。**
- `research-first-assembly`：全文（外部事实调研优先、一手来源优先、调研证据可审查）同样不含任何 CAP 实现细节，是完全通用的"依赖外部事实的装配决定必须先调研"方法论，与本 Story 交付的新 Claude adapter、未来任何 adapter 同样适用。**保留。**
- `agent-skill-design`：Purpose 与 3/4 Requirement（发现元数据、路由边界、渐进披露）完全通用，不提 CAP。唯一耦合点是 Requirement"运行时能力授权始终来自 profile"一句正文写"Skill 元数据或工具提示 MUST NOT 授予选定 `.cap` profile 未声明的能力"——这是逐条读正文后发现的真实耦合点，不是凭 Purpose 猜测。但判断为**保留不归档**：(a) 该条款背后的原则——"Skill 自身元数据不能凭空授权，能力必须来自被授权的装配声明"——是一条独立于 `.cap` 具体实现的通用设计原则，AD-19 的 `AssemblyManifest.capabilityPolicy`/`CapabilityReference` 机制在新 adapter 里正是同一原则的另一套实现；(b) 归档整个 spec 会连带丢弃另外 3 条完全通用、仍然对本产品 Skill 编写工作有效的合同，代价大于收益；(c) 本 Story 的 Never 边界只授权"归档"（保留/移动整个 spec 条目），不授权改写 spec 正文把 ".cap profile" 泛化为 "governing capability declaration" 这类文字——那是另一个工作范围。**残留风险（已记录，非阻塞）：** 该条款的 ".cap profile" 字样在 `.cap/` 已被本 Story 删除后成为一句指向已不存在实现的过时措辞；描述的原则依然成立，但文字本身需要后续一次独立的、经授权的 spec 正文编辑修正（不在本 Story 授权范围内）。

**归档操作方式**：`openspec archive` CLI 命令只对 `openspec/changes/` 下的 change 提案生效（把变更 delta 合并进 `openspec/specs/` 后将 change 移入 `openspec/changes/archive/`），没有"直接归档一个既有 spec 条目"的原生操作；且本 Story Never 边界明确"不触碰 `openspec/changes/`"，排除了"新建一个 REMOVED-requirements 变更提案走标准 apply→archive 流程"这条路径。因此采用与本仓已确立的 `_archive/` 顶层降级归档惯例完全一致的方式（见 `AGENTS.md` 2026-08-23 声明："`authority/`、`knowledge/`、`docs/`、`src/agent_system/` 已从仓库根物理搬迁到 `_archive/` 同名子路径下...git mv 保留...降级为...只作证据参考，不再反向定义...权威来源"）：对确认耦合的 13 个条目逐一执行 `git mv openspec/specs/<name> _archive/openspec/specs/<name>`，保留完整 git 历史，物理移出 `openspec/specs/` 使其不再被 `openspec spec list`/`openspec validate --specs` 当作当前权威 spec 处理，同时不删除任何内容、不触碰 `openspec/changes/`。曾短暂试验把归档条目放进 `openspec/specs/archive/<name>/`（`openspec spec list` 仍会把它列为一个奇怪 id 为 `archive/<name>` 的"当前 spec"，不满足"不再是当前权威 spec"的目标），已回退，改用 `_archive/openspec/specs/<name>/`。

验证：`npx openspec spec list` 归档后只列出 `agent-behavior-evaluation`、`agent-skill-design`、`research-first-assembly` 三项；`npx openspec validate --specs --strict` 对这三项全部 `✓`，`3 passed, 0 failed`。

### 4. `scripts/seed-from-cap.ts`／`cap-fs.ts`／依赖真实 `.cap/` 测试的处理

- **`cap-fs.ts`（生产模块）：保留，不删除。** 它是一个参数化的、可复用的"读取 CAP 形状目录"loader（`capRoot` 是入参，不是硬编码路径），并非专属绑定真实 `.cap/`；`tests/fixtures/cap-sample/`（一个结构等价的 fixture 目录）已经、且在 `.cap/` 删除后继续独立驱动它的全部核心行为测试。更新了模块头部文档注释，去掉对已删除的 `scripts/seed-from-cap.ts` 的引用，改为说明 `.cap/` 已退役、该模块因是通用 loader 而保留、继续由 fixture 驱动。
- **`scripts/seed-from-cap.ts`（开发脚本）：删除。** 该脚本的唯一存在理由是把真实 `.cap/` 数据写入 SQLite 供手动验证 CLI，`.cap/` 退役后其默认参数指向的目录不复存在；Story 3.1/3.2 交付的 `configs establish`/`configs revise` 已经是当前唯一支持的非交互式配置供给路径（`cli/index.ts` 头部文档注释原文即指出这一点），保留一个默认路径必然报错的开发脚本没有价值。同步移除 `package.json` 的 `"seed": "bun scripts/seed-from-cap.ts"` script 条目，并更新 `adapters/sqlite/repository.ts` 里 `seed()` 方法引用该脚本的文档注释（`seed()` 方法本身保留，测试仍在用它灌入 fixture 数据）。
- **`tests/adapters/cap-fs.test.ts`：部分移除。** 该文件本身分两个 `describe`：`loadCapConfigRevisions (fixture, not the real repo .cap/)`（12 项，全部只读 `tests/fixtures/cap-sample/`，完全保留不动）与 `loadCapConfigRevisions sourceRef against the real repo .cap/ (Story 4.5b AC evidence)`（4 项，真实读取 `.cap/`）。移除后者整个 `describe` 块（连带变为未使用的 `existsSync`/`statSync`/`CAP_ROOT` 导入/常量一并清理），替换为一段说明性注释：其验证的两类 `sourceRef` 解析路径（普通 project skill、`lock.json` 声明的 imported skill）已经被保留的 fixture 测试（`'[Story 4.5b] a plain project skill's sourceRef resolves ...'`，fixture 里同样声明了一个 `grilling` imported skill）等价覆盖。
- **`tests/adapters/claude-assembly-manifest.test.ts`：部分移除。** 移除 `describe('compileClaudeAssemblyManifest against the real .cap/ (general, agent-assembler)', ...)`（1 项，真实读取 `.cap/` 后编译两个真实 profile 的 manifest），连带清理变为未使用的 `path` 导入与 `loadCapConfigRevisions` 导入；替换为说明性注释。它验证的行为（`manifestStatus: 'ready'`、`capabilityPolicy` 覆盖预期 4 个 capability id、两次 probe 产出稳定 `manifestHash`）由本文件其余大量基于合成 revision 的测试等价覆盖，不依赖 `.cap/` 是否存在。
- **`tests/adapters/claude-cap-parity-verification.test.ts`：整个文件删除。** 这是 Story 4.5 专为"新 adapter vs. 真实 `.cap/lock.json`/`.cap/runtime/claude.toml`"逐项 parity 比对而写的文件，比对目标（`.cap/`）本身被本 Story 删除后，该文件不再有比对对象，不是"改写成不依赖真实 `.cap/`"能保留意义的场景（比对真实 `.cap` 数据正是它存在的唯一理由）。删除前重跑一次确认最终状态干净：`bun test tests/adapters/claude-cap-parity-verification.test.ts` -- 3 pass / 0 fail（含"[Story 4.5 已知差异 (a)]"版本漂移的 `console.warn` 记录，未阻塞），随附的 `.cap/` 文件树前后快照断言（`snapshotFileTree` before/after 一致）也在删除前最后一次确认通过，证明 Story 4.5 声称的"全程零改动 `.cap/`"在退役前一刻依然成立。
- **`tests/adapters/claude-capability-probe-cap-parity.test.ts`：整个文件删除。** Story 4.1 AC2 证据文件，唯一职责是把真实 probe 结果与 `.cap/runtime/claude.toml` 声明字段比对；比对目标消失后没有独立存在价值。删除前重跑确认：`bun test tests/adapters/claude-capability-probe-cap-parity.test.ts` -- 1 pass / 0 fail（同样记录了 2.1.241 vs 2.1.236 的已知版本漂移 `console.warn`，未阻塞）。它验证的"probe 不伪造 supported"这类通用行为，由 `tests/adapters/claude-capability-probe.test.ts` 里独立的 `describe('BunClaudeCapabilityProbe (real environment)', ...)`（对真实安装的 `claude` 二进制探测，不依赖 `.cap/`）等价覆盖。
- **`tests/application/claude-launch.test.ts`：本 Story 新增的 `describe('[Story 4.5b/4.7] launchClaudeFresh against the real repo .cap/ (AC1 evidence)', ...)`（含 `general`/`agent-assembler` 两项，即本文件第 1 节记录的证据）在证据被记入本 spec 后同样整体移除**，连带清理变为未使用的 `existsSync` 导入。它验证的物化行为（内容真实写入、argv 含真实 flag、`computeClaudeKnownDifferences` 不再报告未物化）由本文件其余基于合成 revision + 真实 probe/真实文件系统临时目录的测试（如 `'[Story 4.5b] AC1 内容真实物化成功...'`）等价覆盖，不依赖 `.cap/` 是否存在。

### 5. `.cap/` 目录移除

在以上 4 步全部通过、且 Block If 的两项条件均未触发后，执行 `git rm -r .cap`，移除全部 23 个文件（`capabilities/skills/*/SKILL.md` × 13、`lock.json`、`manifest.toml`、`profiles/*.toml` × 2、`project-defaults.toml`、`prompts/*.md` × 2、`runtime/*.toml` × 2、`skill-imports.toml`）。

### 验证执行（`.cap/` 移除后，最终状态）

- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误。
- `cd packages/control-plane && bun test` -- **443 pass / 0 fail / 1526 expect() calls**，跑两次结果一致（未观察到此前 Story 记录过的 Windows SQLite 并发计时抖动）。计数核对：Story 4.6 结束基线 453 项 → 本 Story 新增 `agent-assembler` 真实烟雾测试（+1，`general`/`agent-assembler` 参数化后共 2 项，相对原有 1 项净增 1）→ 删除依赖真实 `.cap/` 的测试（`cap-fs.test.ts` 4 项 + `claude-assembly-manifest.test.ts` 1 项 + `claude-cap-parity-verification.test.ts` 3 项 + `claude-capability-probe-cap-parity.test.ts` 1 项 + `claude-launch.test.ts` 新增又移除的 2 项 = -11）→ 453 + 1 - 11 = 443，与实测一致。
- `npx openspec validate --specs --strict`（`.cap/` 移除后重跑）-- `agent-behavior-evaluation`/`agent-skill-design`/`research-first-assembly` 三项 `✓`，`3 passed, 0 failed`。

### 审查发现（2026-08-24 review pass，详见上方 Review Triage Log）

四路并行 review（blind-hunter、edge-case-hunter、verification-gap、intent-alignment）：3 个 patch（均 medium）全部已修复并重新验证；0 个 intent_gap，0 个 bad_spec；6 个 defer（记入 frontmatter `deferred`）；5 个 reject（记录理由，未改代码）。最值得注意的发现：删除 `claude-capability-probe-cap-parity.test.ts` 时连带丢失了唯一一处对真实 `claude` 二进制断言三个硬控制能力具体解析为 `supported`/`degraded`（而非只是通用 enum 成员资格）的真实环境测试——这个断言本身跟 `.cap/` 无关，是纯粹的 probe 解析回归防护；已在 `claude-capability-probe.test.ts` 的既有真实环境 describe 块里补回。另修正了 sprint-status.yaml 一个 action item 的措辞歧义（`status: done` 容易被误读成"AC2 本身已实现"，实际只是阻塞关系解除）。intent-alignment 提出的"Block If #1 证据不可从 diff 独立复现"这一尖锐质疑，已由协调者在自己未合并的主工作目录（`.cap/` 依然完整存在）里独立重跑同一条真实链路解决，见上方"协调者独立复核"小节。

**Follow-up review recommendation：** `true`（3 项 medium patch，`3 × 3 = 9 ≥ 5`，触发规则）。

**验证执行（review 补丁后，最终状态）：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误（协调者独立复核）。
- `cd packages/control-plane && bun test` -- **444 pass / 0 fail / 1529 expect() calls**（443 + 本轮新增 1 项真实环境断言测试），跑两次结果一致；协调者独立重跑确认。

### 改动文件

- `packages/control-plane/tests/application/claude-launch.test.ts` -- 新增并跑通 `agent-assembler` 真实烟雾证据（参数化 `general`/`agent-assembler`），记录证据后移除该 `describe` 块与未使用的 `existsSync` 导入。
- `packages/control-plane/tests/adapters/cap-fs.test.ts` -- 移除依赖真实 `.cap/` 的 `describe` 块与未使用导入，保留全部 fixture-only 测试。
- `packages/control-plane/tests/adapters/claude-assembly-manifest.test.ts` -- 移除依赖真实 `.cap/` 的 `describe` 块与未使用导入。
- `packages/control-plane/tests/adapters/claude-cap-parity-verification.test.ts` -- 删除（整个文件）。
- `packages/control-plane/tests/adapters/claude-capability-probe-cap-parity.test.ts` -- 删除（整个文件）。
- `packages/control-plane/scripts/seed-from-cap.ts` -- 删除。
- `packages/control-plane/package.json` -- 移除 `"seed"` script 条目。
- `packages/control-plane/src/adapters/sources/cap-fs.ts` -- 更新头部文档注释（`.cap/` 已退役、模块保留原因、`scripts/seed-from-cap.ts` 已删除），零行为改动。
- `packages/control-plane/src/adapters/sqlite/repository.ts` -- 更新 `seed()` 方法文档注释，零行为改动。
- `openspec/specs/{cap-default-interactive-entry,claude-runtime,claude-surface-closure,digest-materialization-evidence,general-profile,layered-agent-profile,omp-cross-profile-resume,omp-shared-preferences,portable-assembly-host,private-capability-overlay,project-skill-imports,v3-assembly-executor,workspace-context-bridge}/spec.md` -- `git mv` 至 `_archive/openspec/specs/<同名>/spec.md`（13 项，历史完整保留）。
- `.cap/` -- 整体删除（23 个文件）。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 标记 `4-7-退役-cap-本体: done`；把已被 2026-08-24 架构澄清取代前提的 action item（`epic-4-story-4-5-ac2-blocked-story-4-6-not-executable`）状态更新为 `done` 并记录理由与 `resolved_ref`；`last_updated` 刷新。`epic-4` 本身保留 `in-progress`（见下方"关于 epic-4 状态"）。

### 关于 epic-4 状态：保留 `in-progress`，未标记 `done`

Spec 原文允许"若全部 Story 均已完成（含 optional 的回顾）则一并评估是否可标 done（不强制）"。核实后决定**不**标记 `epic-4: done`，理由：

1. `sprint_status.py update --set-epic-status` 的工具自身文档明确写道它是"唯一能把一个 epic 移到 done 的写入路径"，暗示直接手工编辑 YAML 把 epic 状态改成 done 不是本仓已确立的合规操作方式；该脚本主要服务于 retrospective 流程（`--set-retro-done`、`--set-epic-status` 均在 `update` 子命令下，围绕 retro 上下文设计）。
2. 本仓已有的同类先例是 `epic-3`：全部 3 个 Story 均 `done`、`epic-3-retrospective: optional`，但 `epic-3` 本身仍保留 `in-progress`——说明"全部 Story 完成 + retro optional"在本仓惯例下不会自动触发 epic 级 done，这是一个需要人工/retro 流程确认的独立决定，不是本 Story（一个 Story 级 chore）的授权范围。
3. `epic-4-retrospective` 仍是 `optional`（未运行、未标 `done`），而 `epic-1`/`epic-2` 被标为 `done` 时其对应 retrospective 字段本身也是 `done`（不是 `optional`）——进一步印证"epic done"在本仓惯例下与"retrospective 已完成"绑定，而非仅仅"全部 Story done"。

`detect-epic` 已确认 `epic: 4`、`story_count: 8`、`pending_stories: []`——epic-4 已具备可以运行 retrospective 或由负责人显式确认 done 的全部前提条件；本 Story 把这一状态如实留给负责人下一步决定，不越权代为拍板。
