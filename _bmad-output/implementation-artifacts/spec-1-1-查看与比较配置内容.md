---
title: 'Story 1.1 查看与比较配置内容'
type: 'feature'
created: '2026-08-22'
status: 'done'
baseline_commit: 'e2a21c7f98d2ee22c45eca32efbe0094717a9f8f'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 用户目前无法在启动 OMP 前查看某个已保存配置修订包含什么（Instructions/Skills/MCP、来源、边界），也无法机械并列比较多个配置；只能凭记忆或试错选择。

**Approach:** 新建外部 TypeScript/Bun CLI（`packages/control-plane`），六边形模块化单体，只读实现三个查询能力：列出已保存配置修订、查看单个修订详情、机械并列比较多个修订。领域内核定义不可变 `StableConfigRevision` 与 `Known<T>/Unknown` 事实类型；SQLite（STRICT、WAL）是查询的持久权威；一个专用 adapter 从本仓已存在的 `.cap/`（manifest.toml + profiles/*.toml + lock.json）读取真实配置数据，仅用于开发期填充 SQLite fixture/seed（非产品 CLI 子命令，见 Never）。不实现候选/推荐/配置创建/启动/OMP 进程管理。

## Boundaries & Constraints

**Always:**
- `domain/` 不导入 Bun、SQLite、文件系统、进程环境；只有纯类型与函数。
- 事实值统一 `Known<T>` / `Unknown(reason, observedAt)`；禁止用 `null`/缺字段表示未知。
- `StableConfigRevision` 不可变；比较、详情、列表均绑定具体修订，不做原位改写。
- 列表/详情/比较只显示类型化引用、来源类别、允许公开摘要、边界与状态；不显示或持久化私有原文、凭据、prompt、transcript、工具 payload。
- 无配置时显示诚实空状态；解析/未找到失败时显示配置标识、类型化原因、恢复建议，不静默回退默认配置、不影响其他配置查看。
- 比较纯机械并列同一字段；不产生评分、排序、Recommendation、自动候选或默认选择。
- SQLite 表用事务迁移创建为 `STRICT`；仓储查询使用参数化 SQL、显式列，不用 `SELECT *`。
- 单独查看一个配置提供完整视图，不要求先构建比较集合、不为凑数量复制/生成变体配置。

**Ask First:** 无（本 Story 范围内无需人工升级决定；`.cap/` 到 `StableConfigRevision` 的字段映射规则已在 Design Notes 中固定，若后续 Story 需要不同映射需人工重新确认）。

**Never:**
- 不实现配置创建、编辑、候选生成、Recommendation、用户选择绑定、OMP 启动/进程管理、Session/resume、SQLite lease/fencing（Story 1.2 及以后范围）。
- 不把 `.cap/` 导入能力暴露为产品 CLI 子命令（例如不做 `configs sync`/`configs import`）；导入只作为开发期 `scripts/seed-from-cap.ts` 脚本与测试 fixture 生成器存在，避免把"配置供应"变成本 Story 的用户能力（epics.md AR16）。
- 不观察、不解析任务内容；不引入 daemon、后台服务或非 TypeScript/Bun 的持久脚本。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 列表-有配置 | SQLite 中存在 ≥1 条 `StableConfigRevision` | `configs list` 显示每项名称、修订标识、default/generic 标记、简短边界、可用状态；不排序为推荐、不隐藏不可用项 | N/A |
| 列表-空 | SQLite 中无任何配置修订 | `configs list` 显示诚实空状态文案和配置供应边界说明，不是产品故障 | N/A |
| 详情-正常 | 存在指定 id 的修订 | `configs show <id>` 分组显示 Instructions/Skills/MCP 类型化引用、来源类别、允许公开摘要、边界、状态；未配置项/不可达项/Unknown 显式标出 | N/A |
| 详情-私域引用 | 修订引用私域资产 | 显示类型化引用与受控状态，不显示私有原文/凭据/prompt/transcript/工具 payload | N/A |
| 详情-未找到/解析失败 | id 不存在，或版本不支持/引用不可达/详情解析失败 | 显示配置标识、类型化失败原因、可执行恢复入口；退出码非 0 | 不静默回退默认配置、不修改配置、不影响其他配置查看 |
| 比较-多个 | 用户传 ≥2 个 id | `configs compare <id...>` 按同一字段并列显示组成/来源/边界/缺失项/差异/Unknown | N/A |
| 比较-含无效 id | 传入的 id 中至少一个不存在/解析失败 | 有效项正常比较展示，无效项以类型化失败原因单独列出；不中断整体输出 | 不静默丢弃、不用默认配置顶替 |

</frozen-after-approval>

## Code Map

- `package.json` -- 根 workspace，新增 `"workspaces": ["packages/*"]`（不改动现有 `openspec` devDependency）
- `packages/control-plane/package.json` -- 新 Bun 包，`bin` 指向 `src/cli/index.ts`，`bun:test` 脚本
- `packages/control-plane/tsconfig.json` -- 独立严格类型检查配置
- `packages/control-plane/migrations/0001_init.sql` -- `STRICT` 表：`stable_config`、`stable_config_revision`（含 JSON 列存 instructions/skills/mcp 引用数组）
- `packages/control-plane/src/domain/facts.ts` -- `Known<T>`/`Unknown` tagged union 及构造/守卫函数
- `packages/control-plane/src/domain/config.ts` -- `StableConfigRevision`、`CapabilityReference`（kind: instruction\|skill\|mcp）、`SourceCategory`、`ConfigAvailability`、纯函数 `compareRevisions(revisions): ComparisonResult`
- `packages/control-plane/src/application/ports.ts` -- `ConfigRevisionRepository` 端口接口（`listAll`、`findById`）
- `packages/control-plane/src/application/queries.ts` -- `listConfigRevisions`、`getConfigRevisionDetail`、`compareConfigRevisions` 用例；`ConfigNotFoundError`/`ConfigUnsupportedError` 类型化错误
- `packages/control-plane/src/adapters/sqlite/repository.ts` -- `SqliteConfigRevisionRepository`（`bun:sqlite`，参数化 SQL，运行 migration）
- `packages/control-plane/src/adapters/sources/cap-fs.ts` -- 读取 `.cap/manifest.toml` + `.cap/profiles/*.toml` + `.cap/lock.json`，映射为 `StableConfigRevision[]`（只读，字段映射见 Design Notes）
- `packages/control-plane/src/cli/render.ts` -- 文本渲染（list/detail/compare/空状态/失败），公共可导出视图共用同一渲染路径
- `packages/control-plane/src/cli/index.ts` -- argv 分发：`configs list`、`configs show <id>`、`configs compare <id...>`
- `packages/control-plane/scripts/seed-from-cap.ts` -- 开发期脚本：调用 `cap-fs` 适配器写入本地 SQLite 文件，非 CLI 产品子命令
- `packages/control-plane/tests/fixtures/cap-sample/` -- 独立 fixture（不耦合真实 `.cap/`，避免测试随仓库配置演进而漂移）：`manifest.toml`、`profiles/general.toml`、`profiles/reviewer.toml`、`lock.json`
- `packages/control-plane/tests/domain/facts.test.ts`、`tests/domain/config.test.ts` -- 领域纯函数与 Known/Unknown、比较逻辑
- `packages/control-plane/tests/contracts/repository.test.ts` -- `:memory:` SQLite 仓储合同（STRICT、参数化、空表、未找到）
- `packages/control-plane/tests/adapters/cap-fs.test.ts` -- fixture 到 `StableConfigRevision` 映射测试
- `packages/control-plane/tests/integration/cli.test.ts` -- 端到端：list/show/compare/空状态/未找到/私域引用不泄露，覆盖上方 I/O 矩阵全部行

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- 新增 `workspaces` 字段 -- 使 Bun 能解析 `packages/control-plane`
- [x] `packages/control-plane/package.json`、`tsconfig.json` -- 初始化包 -- Bun/TS 工具链落地
- [x] `packages/control-plane/src/domain/facts.ts` -- 实现 `Known<T>`/`Unknown` -- AD-8 事实类型基础
- [x] `packages/control-plane/src/domain/config.ts` -- 实体与机械比较函数 -- 承载 MVP-FR2/FR3 领域规则
- [x] `packages/control-plane/src/application/ports.ts`、`queries.ts` -- 三个只读用例 + 类型化失败 -- MVP-FR1/FR2/FR3 应用层
- [x] `packages/control-plane/migrations/0001_init.sql`、`src/adapters/sqlite/repository.ts` -- STRICT 仓储 -- AD-4/AD-13 持久化基础（本 Story 只用只读+seed 写入，不做并发/lease）
- [x] `packages/control-plane/src/adapters/sources/cap-fs.ts` -- 读取真实 `.cap/` 数据形状 -- 为 seed 脚本与测试提供真实字段映射
- [x] `packages/control-plane/scripts/seed-from-cap.ts` -- 开发期填充脚本 -- 使 CLI 可对真实数据手动验证，且不进入产品子命令面
- [x] `packages/control-plane/src/cli/render.ts`、`src/cli/index.ts` -- 三个只读子命令 -- 面向用户的 MVP-FR1/FR2/FR3 入口
- [x] `packages/control-plane/tests/**` -- 覆盖 I/O 矩阵全部行 -- 验证收口

**Acceptance Criteria:**
- Given 存在一个或多个保存的配置修订, when 用户运行 `configs list`, then CLI 显示每个配置的名称、修订标识、默认/通用标记、简短适用边界和可用状态，且不自动排序为推荐、不隐藏不可用配置，不可确认状态显示为 `Unknown`
- Given 当前没有保存配置, when 用户运行 `configs list`, then CLI 显示诚实空状态和配置供应边界，不伪造默认配置、不冒充产品故障
- Given 用户运行 `configs show <id>`, then 分组列出 Instructions/Skills/MCP 的类型化引用、来源类别、允许公开摘要、配置边界和当前可证明状态，未配置项/不可达项/Unknown 显式区分，不以文件存在或已安装推导已生效
- Given 配置引用个人私域资产, when 用户查看详情, then 只显示类型化引用和受控状态，不显示或持久化私有原文、凭据、prompt、transcript、工具 payload
- Given 用户选择两个或更多配置 id 运行 `configs compare`, then 按同一字段并列显示组成、来源、边界、缺失项、差异和 `Unknown`，不生成评分/排序/Recommendation/自动候选
- Given 用户只运行 `configs show` 单个配置, then 提供完整视图且不要求先建立比较集合，不为凑数量复制或生成变体配置
- Given 配置不存在、版本不受支持、引用不可达或详情解析失败, when 请求显示或比较, then 显示配置标识、类型化失败原因和可执行恢复入口，不静默回退默认配置、不影响其他配置查看

## Spec Change Log

- **发现：** 首轮实现严格按本 Design Notes 的字段映射规则实现 `defaultMarker: role === manifest.defaults`，但对照真实仓库 `.cap/manifest.toml`（`defaults = ".cap/project-defaults.toml"`，一个指向项目级能力策略覆盖文件的路径，不是 profile role 标识）核实后发现该规则在真实数据上恒为 `false`，且领域类型把 `defaultMarker` 声明为裸 `boolean` 而非 `Fact<boolean>`——这直接违反 AD-8"禁止用 `false` 表示未知"与本 Story AC"不可确认状态显示为 `Unknown`"。测试 fixture 当时人为把 `defaults` 设为角色名（`"general"`）掩盖了这个问题，掩盖了对真实数据的破坏性结果。
- **修正：** 将 `StableConfigRevision.defaultMarker` 改为 `Fact<boolean>`；`cap-fs.ts` 不再尝试从 `manifest.defaults` 猜测角色归属，对每个 profile 一律返回 `Unknown('cap-manifest-defaults-field-is-not-a-per-profile-role-marker', observedAt)`；SQLite schema/仓储/CLI 渲染/比较逻辑同步改为 Known/Unknown 四列模式；测试 fixture 与断言同步改为验证 `Unknown`，并新增两条针对 `defaultMarker` 为 `Unknown` 时的比较与渲染行为的回归测试。
- **保留：** 其余字段映射规则（`revisionId`=`layer_digest`、`availability`、`scopeBoundary`、Instructions/Skills/MCP 引用）经对照真实 `.cap/lock.json` 验证无误，未改动。
- **发现（review 三层并行）：** blind-hunter/edge-case-hunter/verification-gap 三个 context-free 审阅共提出约 30 项发现，去重后按后果分级 triage（详见下）。评为 `patch` 的部分立即修正，其余按 `reject`（噪音/超出本 Story 范围/仅影响非产品面的 `cap-fs.ts`/`seed-from-cap.ts` 开发期脚本）处理，不触发 `bad_spec`/`intent_gap` 回环——所有 root cause 都在 `<frozen-after-approval>` 之外的实现细节，且都可在不重新协商 Intent/Boundaries 的前提下修正。
- **修正（patch，已应用并重新通过 `bunx tsc --noEmit` + `bun test`，48/48 通过）：**
  1. `cap-fs.ts` `mapCapabilityNames` 死分支（`!resolved` 永不触达，因调用点在未 resolve 时总传空数组）——移除，简化签名。
  2. `queries.ts` `compareConfigRevisions` 未对重复 id 去重，导致 `configs compare rev-a rev-a` 产生误导性的重复列——改为先 `Set` 去重再解析。
  3. `cli/index.ts` `isConfigQueryError` 用 duck-typing (`'kind' in error`) 而非 `instanceof`——改为 `instanceof ConfigNotFoundError || instanceof ConfigUnsupportedError`。
  4. `cli/index.ts` 原先在校验 usage（未知命令/`show` 缺 id/`compare` 少于 2 个 id）之前就已构造 SQLite 仓储（产生磁盘副作用）——改为先纯函数校验 argv，usage 错误直接返回而不接触数据库；仓储构造失败与 `main()` 顶层未捕获异常现在都转成类型化文案 + 非零退出码，不再是裸 stack trace。
  5. `adapters/sqlite/repository.ts` 建表引用 `REFERENCES stable_config` 但从未执行 `PRAGMA foreign_keys = ON`（SQLite 默认关闭外键强制）——补上，使约束真正生效。
  6. `cli/render.ts` `configs compare` 的能力来源比较只显示聚合状态（如 `[source: different]`），未展示具体是哪个修订持有哪个值——新增按修订展开的差异明细行，复用已计算但此前未渲染的 `sourceCategoryByRevision`。
  7. 新增测试覆盖：CLI usage-error 路径（无命令/未知命令/`show` 缺 id/`compare` 少于 2 个 id，均验证数据库文件未被创建）、`compare` 遇到一个有效 id + 一个 `schema_version` 不支持 id 的优雅降级、重复 id 去重、来源类别差异明细渲染。测试从 41 增至 48。
  8. 新增 `.github/workflows/control-plane-checks.yml`：此前仓库四个既有 workflow 均不安装 Bun、不引用 `packages/control-plane`，新增的 5 个测试文件此前不受任何 CI 门禁约束（verification-gap 审阅的主发现）；新 workflow 在 `pull_request`/`push` 到 `main` 时对该包运行 `bun install`、`bunx tsc --noEmit`、`bun test`。
- **不采纳（reject，附理由，未修正）：** `availability` fact 的 `factColumnToFact` 解析忽略存储值恒返回 `'resolved'`——非缺陷，`ConfigAvailability = Fact<'resolved'>` 类型本身只有一个合法 Known 值；`cap-fs.ts`/`scripts/seed-from-cap.ts` 对残缺/畸形 `.cap/` 输入缺少容错（如 `manifest.profiles` 缺失、`--cap-root`/`--db` 缺值静默忽略）——该模块显式是非产品面开发期脚本（Never 边界已声明），崩溃是可容忍结果；fact 列 status/value 一致性缺 CHECK 约束、`--json`/`--help` 输出模式、README、`PRAGMA busy_timeout`、WAL 文件 `.gitignore`、单一修订内重复能力名去重——均为低严重度增强，不影响本 Story 验收标准，超出当前收紧范围。
- **发现（独立 code review，`review` → `done` 收尾）：** 复核判定无阻断项，全部验收标准满足，MVP 边界未越界，48/48 测试通过；但要求在标记 `done` 前补齐三处测试/CI 覆盖缺口（均不涉及生产行为变更）：① 无测试钉住"未解析（unresolved）profile 的 skills/mcp/hooks/plugins 必须来自 `lock.json` 空 inventory，不得从 profile TOML 的 `allow` 声明泄漏"这一已实现但未受测试保护的行为；② 无测试覆盖 `configs compare` 传入的全部 id 均解析失败的场景（此前只覆盖"部分 id 无效"）；③ `.github/workflows/control-plane-checks.yml` 只跑 `ubuntu-latest`，未覆盖本仓知识库明确标注的 Windows 路径/文件锁陷阱区，而适配器用到 `bun:sqlite` + WAL + 路径拼接。
- **修正（补齐三处收尾缺口，已重新通过 `bunx tsc --noEmit` + `bun test`，50/50 通过）：**
  1. `tests/adapters/cap-fs.test.ts` 新增一条测试：`reviewer.toml` 声明 `skills.allow = ["review-checklist"]`，但 `reviewer` role 在 fixture 的 `lock.json.profiles` 中不存在（未解析）；断言其 `skills`/`mcp`/`hooks`/`plugins` 均为空数组，且不含 `review-checklist`——核实当前实现已正确（未解析 profile 的能力清单只来自 `lock.json` inventory，从不读取 TOML 的 `allow` 列表），本条测试只是补齐钉住这一保证的回归测试，未改动 `cap-fs.ts`。
  2. `tests/integration/cli.test.ts` 新增一条测试：`configs compare does-not-exist-1 does-not-exist-2`（全部 id 均无法解析）；核实并断言当前行为——退出码 `1`，输出 `No valid configuration revisions were resolved to compare.` 与逐条类型化 `not found` 失败原因，不静默成功、不抛出未捕获异常/裸 stack trace、不产生 score/rank/recommend 字样。行为已正确，未改动 `queries.ts`/`cli/index.ts`/`render.ts`。
  3. `.github/workflows/control-plane-checks.yml` 的 `test` job 改为 `strategy.matrix.os: [ubuntu-latest, windows-latest]`，与既有 ubuntu 覆盖并行新增 Windows 覆盖；已在本机 Windows 环境本地重跑等效的 `bun install` / `bunx tsc --noEmit` / `bun test` 三步确认全部通过（workflow YAML 本身无法从本地触发 GitHub Actions 执行，本地等效步骤按本 Story Verification 章节的既定方法作为代理验证）。
  - 净效果：测试从 48 增至 50；三处均为收紧测试/CI 覆盖，`src/` 生产行为未发生任何改动。

## Design Notes

**`.cap/` → `StableConfigRevision` 字段映射（用于 `cap-fs.ts` 与 seed 脚本，非产品导入命令）：**
- `name` = profile role（如 `general`）；来自 `manifest.toml` 的 `[profiles]` 表
- `revisionId` = `lock.json` 中对应 profile 的 `layer_digest`（不可变内容指纹，天然满足 AD-5）
- `defaultMarker` = 该 role 是否等于 `manifest.toml` 的 `defaults`
- `scopeBoundary` = 从 `profiles/<role>.toml` 的角色/prompt 引用摘要派生的一句话边界（不解析 prompt 正文内容，只引用路径）
- `availability` = `Known("resolved")` 若 `lock.json.profiles.<role>` 存在且 `inventory` 可读；否则 `Unknown("not-resolved", now)`
- `instructions/skills/mcp` 引用 = `lock.json.profiles.<role>.inventory.{skills,mcps,hooks,plugins}`（本 Story 只取 skills/mcps 对应 MVP-FR2 的 Skills/MCP；`prompt` 文件路径映射为 Instructions 类型化引用；hooks/plugins 暂不在 AC 范围内，若存在则归入 Skills 同级分组并标注来源类别，不丢弃）

**为什么 `.cap/` 导入不是产品命令：** epics.md AR16 明确"配置供应不是本轮用户能力"。`cap-fs.ts` 因此只服务两个非产品面：`scripts/seed-from-cap.ts`（开发者手动运行填充本地 SQLite，用于人工验证 CLI）与测试 fixture 生成。CLI 的三个子命令（list/show/compare）只读 SQLite，不知道 `.cap/` 的存在。

**比较的"差异"定义：** 逐字段对比同 key 的值集合；不同即列入 `differences`；任一方为 `Unknown` 时该字段整体标 `Unknown`（不猜测相等或不等）。

## Verification

**Commands:**
- `cd packages/control-plane && bun install` -- expected: 无错误完成依赖安装
- `cd packages/control-plane && bunx tsc --noEmit` -- expected: 零类型错误
- `cd packages/control-plane && bun test` -- expected: 全部测试通过，覆盖 I/O 矩阵全部行

## Suggested Review Order

**领域模型：`defaultMarker` 从裸 boolean 改为 `Fact<boolean>`（本轮 review 修正的核心）**

- 入口：`defaultMarker` 类型从 `boolean` 改为 `Fact<boolean>`，是本轮所有下游改动的起点。
  [`config.ts:55`](../../packages/control-plane/src/domain/config.ts#L55)

- 真实数据验证后发现 `manifest.defaults` 不是角色标识，字段永远无法确认——按 AD-8 必须是 `Unknown` 而非猜测的 `false`。
  [`cap-fs.ts:142`](../../packages/control-plane/src/adapters/sources/cap-fs.ts#L142)

- 机械比较逻辑改为直接消费 `Fact<boolean>`，不再用 `known()` 二次包装。
  [`config.ts:220`](../../packages/control-plane/src/domain/config.ts#L220)

**SQLite 仓储：Known/Unknown 四列模式 + 外键强制**

- `default_marker` 单列改为 `status/value/reason/observed_at` 四列，与 `scope_boundary`/`availability` 同构。
  [`repository.ts:64`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L64)（`mapRowStrict`），[`repository.ts:128`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L128)（`mapRowLenient`）

- `PRAGMA foreign_keys = ON` 补上——SQLite 默认关闭，此前 `REFERENCES stable_config` 只是装饰。
  [`repository.ts:240`](../../packages/control-plane/src/adapters/sqlite/repository.ts#L240)

**CLI：usage 校验前置、类型化失败、能力来源差异明细**

- usage 错误（未知命令/缺 id/id 数不足）现在纯函数校验，不再在校验前就打开数据库文件。
  [`index.ts:38`](../../packages/control-plane/src/cli/index.ts#L38)

- 错误判别改用 `instanceof`，仓储构造失败与顶层未捕获异常改为类型化文案而非裸 stack trace。
  [`index.ts:23`](../../packages/control-plane/src/cli/index.ts#L23)，[`index.ts:108`](../../packages/control-plane/src/cli/index.ts#L108)

- `configs compare` 的能力来源差异此前只显示聚合状态，现按修订展开具体值。
  [`render.ts:118`](../../packages/control-plane/src/cli/render.ts#L118)

**应用层：重复 id 去重**

- `compareConfigRevisions` 对重复 id 先 `Set` 去重，避免误导性的重复比较列。
  [`queries.ts:84`](../../packages/control-plane/src/application/queries.ts#L84)

**cap-fs 适配器：移除死分支**

- `mapCapabilityNames` 的 `!resolved` 分支永不触达（调用点在未 resolve 时总传空数组）——移除。
  [`cap-fs.ts:86`](../../packages/control-plane/src/adapters/sources/cap-fs.ts#L86)

**CI 与外围**

- 新增 workflow：此前无任何 CI 门禁运行本包的测试。
  [`control-plane-checks.yml:1`](../../.github/workflows/control-plane-checks.yml#L1)

- 新增/修正的回归测试：usage-error 路径、id 去重、compare 优雅降级、来源差异明细、`defaultMarker` Unknown 渲染。
  [`cli.test.ts:96`](../../packages/control-plane/tests/integration/cli.test.ts#L96)

- 领域层 `defaultMarker` Unknown 对比行为回归测试。
  [`config.test.ts:55`](../../packages/control-plane/tests/domain/config.test.ts#L55)

- fixture 到 `Fact<boolean>` 映射的适配器测试改写。
  [`cap-fs.test.ts:15`](../../packages/control-plane/tests/adapters/cap-fs.test.ts#L15)
