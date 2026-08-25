---
title: 'Claude adapter 内容物化能力'
type: 'feature'
created: '2026-08-24'
status: 'done'
baseline_revision: '8c2db6ee85becd8ee14e507a5aaec8ea4597c261'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-建立-claude-code-adapter-骨架与硬控制能力探测.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-fresh-target-的启动与观察.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5-cap-parity-验证与本仓自身切换.md'
warnings: ['oversized']
deferred:
  - summary: >-
      `materialized/` 目前没有任何清理代码：invocation 目录（含其 `materialized/` 子目录）在
      launch 达到终态后不会被删除，会持续占用磁盘直到人工清理。
    evidence: >-
      `adapters/system/claude-invocation-dir.ts`（Story 4.3）与本 Story新增的
      `content-materializer.ts` 均未实现任何删除/清理逻辑；`launchClaudeFresh` 也未在任何终态分支
      调用过清理。
    location: 'packages/control-plane/src/adapters/system/claude-invocation-dir.ts'
    severity: low
  - summary: >-
      MCP 内容物化路径（`materializeMcp`/`--mcp-config`/`--strict-mcp-config` 动态交付、
      `claude.mcp-project-scope-control` 的 required-fail-closed 分支）已完整实现并有单元测试覆盖，
      但今天两个真实 `.cap/` profile 的 `mcp` 均为空集合，因此这条路径从未被真实 `.cap/` 数据触发过；
      `--strict-mcp-config` 在该路径被触发时会与 `adapter-plan.ts` 静态 argv 已贡献的同名 flag 重复
      （无害，见 `claude-launch.ts` 内联注释），但从未在真实环境下验证过这一无害性假设。
    evidence: >-
      `.cap/lock.json` 的 `profiles.general.inventory.mcps`/`profiles.agent-assembler.inventory.mcps`
      均为 `[]`；`packages/control-plane/tests/adapters/claude-content-materializer.test.ts` 与
      `tests/application/claude-launch.test.ts` 中 mcp 相关用例均使用构造出的 fixture 数据，不是真实
      `.cap/` 数据。
    location: 'packages/control-plane/src/application/claude-launch.ts'
    severity: low
  - summary: >-
      `_bmad-output/implementation-artifacts/sprint-status.yaml` 中
      `4-5b-claude-adapter-内容物化能力` 条目仍为 `backlog`——本 Story 的 Tasks & Acceptance 未列出更新
      该文件为交付项，故未修改；负责人/后续 Story 需要另行把它标记为 `done` 才能解除 Story 4.6/4.7 的
      顺序依赖。
    evidence: '_bmad-output/implementation-artifacts/sprint-status.yaml:60'
    location: '_bmad-output/implementation-artifacts/sprint-status.yaml'
    severity: low
  - summary: >-
      sanitizePathSegment 对两个不同 Skill 名字清洗成同一路径片段的情况没有碰撞检测，会静默用
      fs.cp 覆盖已存在目标目录。
    evidence: |-
      content-materializer.ts 的 materializeSkills 直接对清洗后的 segment 做 cp(..., {recursive:true})，
      未检查目标路径是否已被另一引用占用。今天真实 .cap/ 的 skill 名字互不冲突，未触发。
    location: 'packages/control-plane/src/adapters/clients/claude/content-materializer.ts'
    severity: low
  - summary: >-
      materializeMcp 对两个 mcp 引用共享同一 reference.name 的情况没有重名检测，会静默覆盖
      mcpServers 里的同名条目。
    evidence: |-
      mcpServers[reference.name] = ... 直接赋值，无 in 检查。MCP 路径在真实 .cap/ 数据下今天完全
      不可达（两个真实 profile 的 mcp 均为空），仅有构造用例覆盖。
    location: 'packages/control-plane/src/adapters/clients/claude/content-materializer.ts'
    severity: low
  - summary: >-
      resolveSkillSourceRef 未处理 lock.json 的 project_skill_imports[].source 是绝对路径的边界
      情形——path.join(repoRoot, absolutePath) 不会按预期只取绝对路径本身，会拼出错误的嵌套路径。
    evidence: |-
      当前真实 lock.json 里这个字段按约定始终是仓库根相对路径（如 plugins/grilling/skills/grilling），
      未观察到绝对路径场景，边界未被触发。
    location: 'packages/control-plane/src/adapters/sources/cap-fs.ts'
    severity: low
  - summary: >-
      lock.json 的 project_skill_imports 若出现重名 name 条目，Map 构造会静默让后一条覆盖前一条，
      不报错。
    evidence: |-
      new Map(entries.map(...)) 的标准行为；真实 lock.json 今天没有重名条目。
    location: 'packages/control-plane/src/adapters/sources/cap-fs.ts'
    severity: low
  - summary: >-
      imported skill 的 sourceRef（来自 lock.json 自身声明）没有路径遍历/越界校验，一个畸形或被
      篡改的 lock.json 条目（如 ../../../../etc）理论上可以让 materializeSkills 把仓库外内容复制
      进物化产物。
    evidence: |-
      resolveSkillSourceRef 直接 path.join(repoRoot, importSource) 后传给 cp(..., {recursive:true})，
      无 containment 检查。lock.json 是本地由 .cap 工具生成的可信文件，不是外部/用户输入，威胁模型上
      暂不视为紧迫风险，但记录跟踪。
    location: 'packages/control-plane/src/adapters/sources/cap-fs.ts'
    severity: medium
  - summary: >-
      materializeSkills 整份复制 sourceRef 指向的源目录，没有文件过滤或符号链接策略——目录里任何
      杂散文件（.git、凭据、构建产物）或符号链接都会被原样复制进 materialized/plugin/skills/<name>/。
    evidence: |-
      cp(source, dest, {recursive:true}) 无 filter 选项。今天真实 .cap/capabilities/skills/<name>/
      目录下只有 SKILL.md 一个文件，未触发。
    location: 'packages/control-plane/src/adapters/clients/claude/content-materializer.ts'
    severity: medium
  - summary: >-
      物化出的 plugin.json 使用固定身份 {name:'agent-system-materialized-skills', version:'1.0.0'}，
      不随实际技能集合变化——若 Claude Code 对 --plugin-dir 做按身份缓存（未核实），不同技能集合的
      连续启动可能在缓存层面互相冲突。
    evidence: |-
      materializeSkills 硬编码这两个字段；未找到 Claude Code 是否真的做身份缓存的证据，纯属推测风险。
    location: 'packages/control-plane/src/adapters/clients/claude/content-materializer.ts'
    severity: low
  - summary: >-
      writeFileAtomic 在 write 成功但 rename 失败时（如跨设备 rename、磁盘满）不会清理已写入的
      临时文件，可能残留 *.tmp 文件占用磁盘。
    evidence: |-
      writeFileAtomic 无 finally 清理分支；本轮修复（#1 高优先级 patch）已让写入失败本身不再抛出
      未捕获异常，但未覆盖"写入成功、rename 失败"这个更窄的子场景。
    location: 'packages/control-plane/src/adapters/clients/claude/content-materializer.ts'
    severity: low
---

<intent-contract>

## Intent

**Problem：** `launchClaudeFresh` 只应用 3 个硬控制 argv 标志，从不把装配意图的 Instructions/Skills/MCP 内容真正交付给新 spawn 的 Claude 进程（`computeClaudeKnownDifferences` 对任何非空引用恒记为"未物化"）；根因是 `cap-fs.ts` 把每个 `CapabilityReference.sourceRef` 硬编码为 `Unknown`，即使 `.cap/capabilities/skills/<name>/` 目录和 `profile.prompt` 文件真实存在于磁盘上。

**Approach：** (1) 修 `cap-fs.ts`，让 `sourceRef` 指向已知的真实磁盘路径；(2) 新增内容解析+物化模块：读取 `sourceRef` 指向的真实内容，写入 invocation 目录下的 `materialized/` 子目录（Skills 按 `.cap` 已验证的 plugin 包布局，Instructions 直接读文本，MCP 生成 `mcp.json`）；(3) `launchClaudeFresh` 在 spawn 前调用物化、把物化产生的动态 flag 追加进最终 argv，`computeClaudeKnownDifferences` 相应地只在物化失败/降级时才报告差异；(4) probe 扩展覆盖 `--plugin-dir`/`--append-system-prompt`，且强制本次重新 probe。

## Boundaries & Constraints

**Always：**
- `materialized/` 是 `ClaudeInvocationDirPort.prepare()` 目录下的专用子目录，绝不写入该目录根（根同时是 `cwd` 与 `CLAUDE_CONFIG_DIR`）。
- Skills 物化为 `materialized/plugin/.claude-plugin/plugin.json`（`{name, version:"1.0.0", description, skills:"./skills/"}`）+ 每个 Skill 一个 `materialized/plugin/skills/<name>/` 目录（整份复制 `sourceRef` 指向的源目录，不只是 SKILL.md），经单次 `--plugin-dir materialized/plugin` 交付。
- Instructions 物化为读出的纯文本，经 `--append-system-prompt <text>` 直接传参，不落文件。
- MCP 物化为 `materialized/mcp.json`（原生 `mcpServers` 格式），经 `--mcp-config materialized/mcp.json --strict-mcp-config` 交付；今天两个真实 profile 的 `mcp` 均为空，此路径当前不可达，仍需实现（AD-21 已定）。
- 任一 `required` capability 的 `sourceRef` 是 `Unknown` 或指向的路径不可读时，整次 launch 在 spawn 前 fail-closed（走 `applyFailure`，同 `invocation-dir`/`spawn-process` 现有错误分支的模式），不得部分物化后仍然 spawn。
- `computeClaudeKnownDifferences` 改为：某类引用非空且全部成功物化时不再报告"未物化"差异；仍有引用因 `sourceRef` 不可解析而降级时报告差异（复用 manifest 已有的 `degradedCapabilities` 机制，不新增平行的差异分类）。
- Probe 新增 `claude.plugin-dir-delivery`/`claude.append-system-prompt-delivery`（同 `hasFlag` 风格的存在性检查，非 `unknown` 默认）；本 Story 交付前必须真实重新执行一次 probe（不得复用旧版本快照）。
- `materialized/` 清理绑定既有 invocation 目录清理节点，不早于——本 Story 若该清理节点尚不存在，只需保证不提前清理，不需要新建一个完整的通用清理系统（那是既有缺口，AD-21 已记录）。

**Block If：** 无（AD-21 已把设计问题拍板，本 Story 只是落地）。

**Never：**
- 不修改 `domain/client.ts`、`resolveClientSupport`（Story 4.6 范围）。
- 不物化 `hooks`/`plugins`（`.cap/capabilities/` 下无这两类真实目录，manifest 也不含它们作为类型化引用字段——Story 4.2 的既有边界）。
- 不为 mcp/hooks/plugins 发明 `.cap/capabilities/{mcp,hooks,plugins}/<name>/` 之外的新路径映射约定；今天没有真实目录可验证，`sourceRef` 对这三类保持 `Unknown` 是诚实结果，不是缺陷。
- 不改动 `compileClaudeAssemblyManifest`/`compileClaudeAdapterPlan` 的既有字段签名（可以新增 `generatedFiles` 条目，不删改已有的）。
- 不尝试解决 Epic 3 未拍板的真实数据源接入协议（GitHub/本地目录导入）——本 Story 只覆盖今天可靠可解析的 `.cap` 本地文件来源。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 真实 `general`/`agent-assembler` profile，skills 非空 | 修复后的 `sourceRef` 指向真实 `.cap/capabilities/skills/<name>/` | `materialized/plugin/` 按真实布局生成，`--plugin-dir` 出现在最终 argv | 无 |
| Instructions 非空 | `sourceRef` 指向真实 `.cap/prompts/<role>.md` | 文本被读出并作为 `--append-system-prompt` 的值 | 文件不可读时该 capability 记 degraded/unsupported |
| `sourceRef` 为 `Unknown`（如 mcp/hooks/plugins 当前状态） | 引用非空但无真实来源 | 按 required/optional 走 AD-10 fail-closed | required 时整次 launch 失败并说明原因，optional 时列入 degraded |
| `--plugin-dir`/`--append-system-prompt` probe 结果为 `unsupported` | 本机 `claude` 版本不支持该 flag | 对应内容视为不可交付，required 时 fail closed | 不假装已物化 |
| 一次成功 launch 的 `materialized/` 清理 | launch 达到终态 | 清理不早于 Claude 及其子进程可能仍读取期间 | 不产生残留占用磁盘的孤儿目录（合理时间窗口内） |

</intent-contract>

## Code Map

- `packages/control-plane/src/adapters/sources/cap-fs.ts:100-116,161-186` -- `mapCapabilityNames`/`loadCapConfigRevisions`：把 `sourceRef: CAP_FS_FIELD_NOT_CAPTURED` 改为 skills → `resolveCapRelativePath(capRoot, 'capabilities/skills/' + name)`（目录路径），instructions → `resolveCapRelativePath(capRoot, profile.prompt)`（文件路径）；mcp/hooks/plugins 保持 `Unknown`（无真实目录约定）。
- `packages/control-plane/src/adapters/clients/claude/content-materializer.ts` -- 新增：`materializeClaudeContent(revision, invocationDir)` 只读解析 `sourceRef`（skills 复制整个源目录到 `materialized/plugin/skills/<name>/`，写 `materialized/plugin/.claude-plugin/plugin.json`；instructions 读文本；mcp 生成 `materialized/mcp.json`），返回哪些内容成功物化、哪些因 `sourceRef` 不可解析而失败，供 `claude-launch.ts` 据此决定 fail-closed 或追加 argv。文件写入复用 AD-9 同目录临时文件原子替换纪律（参考 `adapters/launch-context/fs-claude-launch-context-writer.ts` 的既有写法）。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts:116-118,190-207` -- `ClaudeAdapterPlanGeneratedFile`/`compileClaudeAdapterPlan`：`purpose` 联合类型新增 `'claude-plugin-dir' | 'append-system-prompt' | 'mcp-config'`（仍是元数据，不含真实路径/内容）；`generatedFiles` 依据 manifest 的 skills/instructions/mcp 是否非空产出对应条目。
- `packages/control-plane/src/application/claude-launch.ts:97-118,392-427` -- `computeClaudeKnownDifferences`：只在物化失败/降级时报告对应类别差异，不再对"非空即未物化"无条件报告。`launchClaudeFresh`：在 `invocationDir` 就绪、`spawn()` 之前调用 `materializeClaudeContent`；任一 required 物化失败时复用既有 `applyFailure` 模式返回失败 outcome；成功时把物化产生的动态 flag（`--plugin-dir <dir>`、`--append-system-prompt <text>`、`--mcp-config <dir> --strict-mcp-config`）追加进传给 `deps.claudeProcessPort.spawn` 的最终 `argv`（`adapterPlan.argv` 之外的补充，不修改 `adapterPlan.argv` 本身——那仍是纯编译、零 IO 的持久化字段）。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts:112-127,296-317` -- `BunClaudeCapabilityProbe`：仿照 `probeHookDenyEffect`/`probeMcpProjectScope` 的 `hasFlag` 用法，新增 `probePluginDirDelivery`/`probeAppendSystemPromptDelivery` 两个私有方法，纳入 `probeHardControlCapabilities` 返回数组。
- `packages/control-plane/tests/adapters/cap-fs.test.ts` -- 新增用例：`sourceRef` 对真实 `.cap/` 数据解析为已知真实路径（skills 目录存在、instructions 文件存在）。
- `packages/control-plane/tests/adapters/claude-content-materializer.test.ts` -- 新增：覆盖 I/O 矩阵全部行。
- `packages/control-plane/tests/application/claude-launch.test.ts` -- 扩展：`launchClaudeFresh` 物化成功/失败路径、`computeClaudeKnownDifferences` 新行为。
- `.cap/capabilities/skills/agent-assembler/` 等 -- 只读证据：真实 Skill 目录已存在，验证物化逻辑对齐真实布局。

## Tasks & Acceptance

**Execution：**
- `src/adapters/sources/cap-fs.ts` -- 修 `sourceRef` 硬编码 -- 解除阻塞前提。
- `src/adapters/clients/claude/content-materializer.ts` -- 新增物化模块 -- AD-21 核心实现。
- `src/adapters/clients/claude/adapter-plan.ts` -- 扩展 `generatedFiles` 联合类型 -- 声明物化产出的元数据。
- `src/application/claude-launch.ts` -- 接入物化 + 更新差异计算 -- 让 fresh launch 真正交付内容。
- `src/adapters/clients/claude/capability-probe.ts` -- 新增两项 probe -- 满足 AD-21/AD-15 的证据前提。
- 对应测试文件（见 Code Map）-- 覆盖 I/O 矩阵与 probe 新增项。

**Acceptance Criteria：**
- Given 真实 `.cap/` 的 `general`/`agent-assembler` profile，when `launchClaudeFresh` 编译并启动，then 生成的最终 argv 含 `--plugin-dir`（指向包含真实 `.claude-plugin/plugin.json` 与 skills 子目录的路径）且 `--append-system-prompt` 携带真实 prompt 文本，而 `computeClaudeKnownDifferences` 不再报告这两类"未物化"。
- Given 某 required capability 的 `sourceRef` 无法解析，when 编译该装配意图，then launch 在 spawn 前失败并给出可执行恢复动作，不产生部分物化后仍 spawn 的中间态。
- Given `bun test`、`bun run typecheck` 在 `packages/control-plane` 下执行，then 既有全部测试保持通过（不回归 Story 4.1～4.5 交付的 ~403 项），新增测试全部通过，`tsc --noEmit` 零错误。

## Review Triage Log

### 2026-08-24 — Review pass（四视角并行：blind-hunter、edge-case-hunter、verification-gap、intent-alignment）

- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 1, medium 4, low 0)
- defer: 8 (medium 2, low 6)
- reject: 8 (low 8)
- addressed_findings:
  - `[high]` `[patch]`（blind-hunter + edge-case-hunter，重复发现）`content-materializer.ts` 的 `writeFileAtomic`（写 `plugin.json`/`mcp.json`）在每类引用自身的 try/catch 之外，且 `claude-launch.ts` 调用 `materializeClaudeContent` 时也没有包一层 try/catch——一次磁盘写失败会以未捕获异常向外传播，直接违反本函数自己文档声明的"从不抛出、只返回 typed outcome"不变量。已改为把这两处写入也纳入 try/catch，失败时追加为 `ClaudeMaterializationFailure` 而不是抛出。
  - `[medium]` `[patch]`（blind-hunter + edge-case-hunter，重复发现）`instructionsDelivery.blocked ?? skillsDelivery.blocked ?? mcpDelivery.blocked` 只暴露第一个失败的内容组，与同文件 `manifestResult.kind === 'blocked'` 分支"列出全部 `missingRequiredCapabilities`"的既有先例不一致。已改为收集全部被阻塞的内容组，`failureReason`/`affectedCapabilities` 反映全部而非只反映第一个。
  - `[medium]` `[patch]`（verification-gap）`compileClaudeAdapterPlan` 新增的三个条件性 `generatedFiles` 条目（`claude-plugin-dir`/`append-system-prompt`/`mcp-config`）没有任何测试断言过——把任一条件互换或整段删掉都不会让现有测试失败。已在 `claude-adapter-plan.test.ts` 补充非空 skills/instructions/mcp 场景下 `generatedFiles` 的精确断言。
  - `[medium]` `[patch]`（verification-gap）`dynamicContentCapabilityIds` 并入失败/incomplete 分支 `affectedCapabilities` 的逻辑，没有任何测试用非空且成功物化的内容组驱动过失败路径——已在 `claude-launch.test.ts` 补充一个真实物化成功后 spawn 失败的用例，断言 `affectedCapabilities` 含对应 delivery capabilityId。
  - `[medium]` `[patch]`（intent-alignment）"本 Story 交付前必须真实重新执行一次 probe"这一要求，目前只有 spec `Auto Run Result` 里的叙述性证据，`claude-capability-probe.test.ts` 的真实环境测试只断言了通用的 enum 成员资格，没有专门断言这两个新 capability 具体解析为 `supported`——已补充一条真实环境断言，专门核实 `claude.plugin-dir-delivery`/`claude.append-system-prompt-delivery` 在本机真实 `claude` 上均为 `supported`。
  - `defer`（8，均结构性缺口，非本轮真实数据可触发，记录为已知残留风险）：`sanitizePathSegment` 无同名碰撞检测（blind-hunter+edge-case-hunter）；`materializeMcp` 无重名检测（同上）；`resolveSkillSourceRef` 未处理 `lock.json` 声明绝对路径的边界情形（edge-case-hunter）；`lock.json` `project_skill_imports` 重名条目静默后者覆盖前者（edge-case-hunter）；imported skill `sourceRef` 无路径遍历/越界校验（blind-hunter，medium——`lock.json` 是本地可信文件而非外部输入，暂不视为立即风险，但记录跟踪）；`materializeSkills` 整目录复制无过滤/符号链接策略（blind-hunter，medium——今天真实 skill 目录只有 `SKILL.md`，未触发）；物化 plugin 包用固定身份 `{name,version}`，未按内容区分（blind-hunter）；`writeFileAtomic` 在 `rename` 失败时可能留下孤儿临时文件（blind-hunter）。
  - `reject`（8，均记录理由未改代码）：`contentFingerprint` 保持 `Unknown`（blind-hunter）——AD-21/本 Story 范围只要求修 `sourceRef`，未要求计算内容指纹，不在本轮意图内；真实 `.cap/` 集成测试用 `console.warn`+`return` 而非测试框架 skip 机制（blind-hunter）——与 Story 4.1/4.5 已确立的既有模式一致，非本 Story 引入；新测试按真实技能/profile 名字断言（blind-hunter）——同样是 Story 4.5 parity 测试已确立的既有模式；`describeMaterializationFailures` 的"未知原因"分支不可达（blind-hunter）——纯 cosmetic 死分支，调用路径已保证 `failures` 非空；重复 `--strict-mcp-config` 未端到端测试（blind-hunter）——mcp 路径本就是 spec 自己 `deferred` 里已披露的"已实现但今天真实数据不可达"状态，非新问题；`requiredForContentGroup` 的 `true` 兜底未被测试驱动（blind-hunter）——注释已明确其为防御性代码，与本仓其它类似防御分支的既定处理一致；intent-alignment 发现的"差异计算改走运行时 `materialization.failures` 而非编译期 `manifest.degradedCapabilities`"这一表述分歧——这是更符合 AD-19"编译阶段零 IO"原则的正确选择，不是缺陷；intent-alignment 发现的"imported skill 来源解析范围比 intent-contract 文字描述更宽"——`Never` 边界只禁止为 mcp/hooks/plugins 发明新约定，未禁止对 skills 场景使用 `lock.json` 自身已声明的信息，在界内。

## Design Notes

- **为什么物化模块独立于 `adapter-plan.ts`：** `compileClaudeAdapterPlan` 是纯函数、零 IO（AD-19 要求持久 plan 不含 secret/content）；物化涉及真实文件读写，必须发生在 `launchClaudeFresh` 的运行时阶段，绑定到已经分配好的 `invocationDir`，不能在编译阶段做——这与 `RuntimeLaunchSpec`（AD-6 描述的、只存在于调用作用域的概念）是同一层。
- **为什么 mcp/hooks/plugins 保持 `Unknown` 而非发明路径约定：** `.cap/capabilities/` 目录下今天只有 `skills/` 真实存在；没有 `mcp/`、`hooks/`、`plugins/` 子目录，也没有任何声明它们该在哪。凭空约定一个路径规则既无法验证也可能与未来 Epic 3 数据源协议冲突，因此保持诚实 `Unknown`——两个真实 profile 的这三类引用本就是空集合，不影响任何当前可观察行为。

## Verification

**Commands：**
- `cd packages/control-plane && bun run typecheck` -- expected: 零错误退出
- `cd packages/control-plane && bun test` -- expected: 既有全部测试 + 新增测试全部通过，0 fail

## Auto Run Result

**实现摘要：** 修复了 `cap-fs.ts` 的 `sourceRef` 硬编码阻塞前提（instructions → 真实 prompt 文件路径；skills → 项目内 `.cap/capabilities/skills/<name>/` 或（对 import 类 skill）`lock.json` 自身已声明的 `project_skill_imports[].source` 真实路径；mcp/hooks/plugins 保持诚实 `Unknown`，未发明新路径约定）；新增 `content-materializer.ts`（`materializeClaudeContent`）只读解析已修复的 `sourceRef`，把 Instructions 读为文本、把 Skills 整份复制为真实 Claude plugin 包（`materialized/plugin/.claude-plugin/plugin.json` + `materialized/plugin/skills/<name>/`）、把 MCP 定义合并写入 `materialized/mcp.json`（原生 `mcpServers` 格式），全部写入只发生在 `<invocationDir>/materialized/` 子目录（同目录临时文件原子替换），从不触碰目录根；`capability-probe.ts` 新增 `claude.plugin-dir-delivery`/`claude.append-system-prompt-delivery` 两项存在性探测（真实环境下均为 `supported`，已核实 `claude` 2.1.241 的 `--plugin-dir`/`--append-system-prompt` 均存在）；`assembly-manifest.ts` 把这两项接入既有 `CAPABILITY_RELEVANCE_RULES`（分别在 skills/instructions 非空时相关，`required:true`），使不支持该 flag 的环境在 manifest 编译阶段就 fail-closed，早于任何真实文件 IO；`adapter-plan.ts` 的 `generatedFiles` 按 manifest 的 skills/instructions/mcp 是否非空追加 `'claude-plugin-dir' | 'append-system-prompt' | 'mcp-config'` 元数据条目（仍是纯函数、零 IO，只声明意图不含路径/内容）；`claude-launch.ts` 的 `launchClaudeFresh` 在 `invocationDir` 就绪后、`claude` 真正 spawn 前调用物化，对每个非空内容组（instructions/skills/mcp）应用统一的 `resolveContentGroupDelivery` 决策：全部引用成功物化 → 追加对应动态 flag（`--append-system-prompt <text>`、`--plugin-dir <path>`、`--mcp-config <path> --strict-mcp-config`）；有引用失败且该组治理能力 `required`（今天恒为 `true`）→ 在 spawn 前整体 fail closed（`content-materialization-blocked` 原因、`affectedCapabilities` 指向对应 delivery capabilityId），从不产生部分物化后仍 spawn 的中间态；`computeClaudeKnownDifferences` 相应改为只在物化失败/降级时才报告对应类别差异（hooks/plugins 因明确排除在 AD-21 之外，仍如实恒定报告为差异）。

**改动文件：**
- `packages/control-plane/src/adapters/sources/cap-fs.ts` -- 修复 `sourceRef` 硬编码：instructions/skills 解析为真实路径，mcp/hooks/plugins 保持 `Unknown`。
- `packages/control-plane/src/adapters/clients/claude/content-materializer.ts` -- 新增：内容物化模块。
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts` -- `ClaudeAdapterPlanGeneratedFile.purpose` 扩展；`compileClaudeAdapterPlan` 按 manifest 引用非空追加 generatedFiles 元数据条目。
- `packages/control-plane/src/adapters/clients/claude/assembly-manifest.ts` -- `CAPABILITY_RELEVANCE_RULES` 新增两条内容物化交付门槛规则。
- `packages/control-plane/src/adapters/clients/claude/capability-probe.ts` -- 新增 `probePluginDirDelivery`/`probeAppendSystemPromptDelivery`。
- `packages/control-plane/src/application/claude-launch.ts` -- 接入物化、动态 argv 追加、fail-closed 决策；`computeClaudeKnownDifferences` 签名扩展第三参数（物化结果）。
- `packages/control-plane/src/application/ports.ts` -- `ClaudeCapabilityProbePort` 文档注释更新（无字段/签名变化）。
- 测试新增/扩展：`tests/adapters/cap-fs.test.ts`、`tests/adapters/claude-content-materializer.test.ts`（新增文件）、`tests/adapters/claude-capability-probe.test.ts`、`tests/adapters/claude-assembly-manifest.test.ts`、`tests/adapters/claude-adapter-plan.test.ts`、`tests/application/claude-launch.test.ts`（含一项对真实 `.cap/` `general` profile 的端到端集成测试，验证最终 argv 真实含 `--plugin-dir`/`--append-system-prompt` 且 `computeClaudeKnownDifferences` 不再报告这两类差异，二进制不可达时优雅跳过）。

**审查发现（2026-08-24 review pass，详见上方 Review Triage Log）：** 5 个 patch（1 高、4 中），全部已修复并重新验证；0 个 intent_gap，0 个 bad_spec（未触发重新推导）；8 个 defer（记入 frontmatter `deferred`）；8 个 reject（记录理由，未改代码）。最高严重级发现：`content-materializer.ts` 的两处 `writeFileAtomic`（`plugin.json`/`mcp.json`）原先在 try/catch 保护之外，一次磁盘写失败会以未捕获异常向外传播，违反 `launchClaudeFresh` 自己"从不抛出"的既有不变量——已修复为纳入 try/catch、失败转为 `ClaudeMaterializationFailure`。

**Follow-up review recommendation：** `true`（本轮 patch 计数含 1 项 high severity，触发规则"任一 patch 为 high 则 true"）。

**验证执行（review 补丁后，最终状态）：**
- `cd packages/control-plane && bun run typecheck` -- 通过，0 错误（协调者独立复核，非仅依赖实现子代理自报）。
- `cd packages/control-plane && bun test` -- 441 pass / 0 fail / 1627 expect() calls（基线约 403 项 + 本 Story 实现与审查补丁新增约 38 项），无回归；协调者独立重跑一次结果一致，未观察到已知的 Windows SQLite 并发计时抖动。

**残留风险：** 见 frontmatter `deferred`（8 项，均为需要非真实数据/边界输入才会触发的结构性缺口，如 `sanitizePathSegment` 无同名碰撞检测、imported skill `sourceRef` 无路径遍历校验等——详见 Review Triage Log 的 defer 列表）；invocation 目录/`materialized/` 尚无清理代码，属既有缺口延续；MCP 动态交付路径在真实 `.cap/` 数据下今天不可达，仅有构造用例覆盖；`sprint-status.yaml` 未随本次实现更新为 `done`，需负责人或后续流程另行处理。
