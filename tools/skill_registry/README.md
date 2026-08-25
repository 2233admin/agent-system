# skill_registry — Skill 资产面

回答“我有哪些组、它们归哪个事项、打包了没有、健康吗、下次怎么用最小代价复核”。

生成产物是 [`registry.md`](./registry.md)：76 个 Skill，**12 个组**。

## 组是第一结构

装卸、版本、发现、判定、复核都以组为单位，不以 Skill 为单位。**判定 12 次，不是 76 次。**

一个组可以服务多个事项（`bmad` 同时覆盖 E2 造软件与 E5 想清楚一件事），所以不按 Skill
逐个归属事项——组内互相调用（`bmad-help` 路由、deprecated 转发），拆组会拆断。

### 组不是 OMP plugin

2026-08-24 对 omp v18.0.3 实测得出。**OMP 的 skill 与 plugin 是两套互不相干的机制：**

| | OMP skill | OMP plugin |
| --- | --- | --- |
| 形态 | 目录约定 | npm 包 + 导出 factory 的 TS/JS extension |
| 装卸 | `skills.customDirectories` 增删 | `install` / `uninstall` / `link` |
| 选择 | `skills.includeSkills` / `ignoredSkills` / `enable{Pi,Claude,Agents,Codex}{User,Project}` | `enable` / `disable` / `features` |
| 版本 · 发现 · 健康 | **无** | `upgrade` / `discover` / `doctor` |

实测证据：`omp plugin install grilling` 解析到 `registry.npmjs.org` 返回 404；
`install`/`link` 按路径报 `package.json not found`——本仓插件目录只有
`.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json`，没有 `package.json`。
把本仓加为 marketplace 后 `omp plugin discover` 能列出全部 8 个组及版本，
但那只是清单，装不进去。

**所以“组”是本仓自己的概念**，OMP 侧的投影是 `customDirectories` + `includeSkills`，
由 `configs` 在启动时装配——没有任何东西被“安装”。版本、来源与更新触发 OMP 完全
不提供，必须由 `matters.json` 与 `configs` 承担。

客户端优先级 OMP > Claude > Codex CLI。`packagedForClaude` 记录的是 Claude 侧的打包
状态（`plugin.json` + 两份 Marketplace + 版本号），它给出版本号，但**不影响 OMP**。

## 四个面，不要混

| 面 | 回答 | 承载 | 性质 |
| --- | --- | --- | --- |
| 选型面 | 该用哪个 | `plugins/docs/skills-overview.md`（14 个） | 生成物 |
| **资产面** | **我有哪些组、归哪、打包没有** | **本工具（76 个 / 12 组）** | 生成物 |
| 装配面 | 某个配置引用了什么 | `configs` 与其 SQLite | **运行时权威** |
| 安装态 | 运行端实际装了什么 | `tools/plugin_release` | **本机事实** |

资产面存在的理由：装配面只看得见被配置引用的 Skill；当前 76 个里有 62 个从未被任何配置
引用，对 `configs` 完全不可见——既不会被使用，也不会被淘汰，只会一直堆着。

本页是派生视图，没有独立内容，因此不会与来源漂移。**它不是第二权威，也不检测安装态**——
安装态是本机事实，归 `tools/plugin_release`，本工具不重复那一层。

## 运行

```
node tools/skill_registry/skill-registry.ts            # 打到 stdout
node tools/skill_registry/skill-registry.ts --write    # 写入 registry.md
node tools/skill_registry/skill-registry.ts --check    # 两条不漂移不变量
```

Node 24+，原生剥离类型，无构建、无依赖，与 `plugins/tests/` 两份检查同一条件。

`--check` 守两条不变量，任一不满足即退出码 1：

1. **不要有两个控制器报同一个数字**——资产面与选型面各自实测 13 个重叠 Skill 的 L1
   字节，读数不一致即失败。
2. **生成物不要与来源漂移**——重新 render 并与 `registry.md` 逐字节比对。

由 `.github/workflows/skill-asset-checks.yml` 在 CI 执行，同一工作流还校验 BMad 的两份
安装副本（`.agents/skills` 与 `.claude/skills`）没有分叉。

## 数据来源

| 项 | 来源 | 性质 |
| --- | --- | --- |
| 字节（L1/L2/L3） | 扫描 `SKILL.md` 与 `references/` | 实测 |
| 组边界 · 服务事项 · 归组规则 · 来源 | `matters.json` | **声明** |
| 组版本 | `plugins/tests/workflow-routing.json` 的 `pluginVersions` | 声明 |
| 失效条件 · 最少复核步骤 · 上次复核（`plugins/` 内） | 同上的 `skillLifecycle` | 声明 |
| 同上（`plugins/` 外，组级） | `appraisals.json` 的 `groups` | 声明 |
| 同上（`plugins/` 外，逐个） | `appraisals.json` 的 `skills` | 声明 |

除字节外全部是声明态。本工具不产生判断，只汇总与暴露缺口。

### 来源三分：判据是允不允许本地改动

| kind | 含义 | 本地改动 | 更新方式 |
| --- | --- | --- | --- |
| `own` | 我们自己写的 | 随便改 | 不适用 |
| `fork` | 拿来直接用，**承诺零改动** | **零** | 拉上游新版 |
| `vendor` | 拿来但打了补丁 | 有，逐条登记 | 上游更新后重打补丁 |

**`fork` 的零改动是可机械验证的，不是一句声明**：内容指纹与上游 ref 不符即承诺已破，
必须转 `vendor` 或把改动推回上游。名义 fork、实际改过的组，下次升级一定丢改动且无人知晓。

`updateTrigger` 就是组级失效条件——对 fork 而言“上游发了新版”是唯一的失效条件，
全组成员共享，不用逐个 Skill 写。

**`kind` 与 `dependsOn` 是两回事。** 一个 `own` 组也可以依赖外部工具版本：`openspec` 组的
6 个 Skill 是本仓自己写的中文适配（`own`），但依赖 npm 包 `@fission-ai/openspec@1.9.0`
（由 `package.json` + `bun.lock` 锁定）。该依赖的 `updateTrigger` 是组的失效条件之一，
与 `kind` 无关。

当前 vendor 组的模板是 `plugins/grilling/UPSTREAM.md`：上游 pin、逐文件 Git blob 与
SHA-256、许可证本地副本、逐条改造记录、以及“不得自动合并覆盖本地正文”的回顾规则。

### 归组是判断，不是推导

`plugins/` 下 plugin 目录名即组名，机械可推。其余三处由 `matters.json` 的 `groupRules`
显式声明；套不上就标未归组，不猜。**`未归组 = 0` 只说明规则写全了，不说明判断正确**——
修改 `matters.json` 等于修改组边界或事项划分，需负责人确认。

当前的事项划分与 12 个组的归属已由负责人于 2026-08-24 确认，记录在 `matters.json`
的 `confirmed`；此后再改仍需新的明确确认。

### frontmatter 四种写法

两处来源的 `description` 写法不统一，工具全部归一到“运行端实际看到的一行”后计字节
（2026-08-24 实测重新核过一遍：此前这里记的是“三种写法”，其中“裸标量”标的来源
`.cap/capabilities/skills/` 已随 Story 4.7 退役删除，而代码一直在处理、表里却从未记过的
双引号写法确实还在用）：

| 写法 | 出现在 |
| --- | --- |
| 折叠标量 `>-` | `plugins/`（14 个） |
| 单引号并以 `''` 转义 | `.agents/skills/`（bmad，32 个） |
| 裸标量 | `.agents/skills/`（bmad，13 个） |
| 双引号并以 `\"` 转义 | `.agents/skills/`（bmad，4 个） |

超出这四种记为“解析失败”并计入缺口，不静默按 0 处理。

## 已知落后项

- **`plugins/` 内仍是逐 Skill 结构。** `appraisals.json` 已支持组级认知（`bmad` 一条覆盖
  49 个成员），但 `plugins/tests/workflow-routing.json` 的 `skillLifecycle` 还是逐 Skill。
  改它要动那条链的符合性测试，未做。
- **`recheckStaleDays: 30` 已由负责人于 2026-08-24 确认**（记录见 `matters.json` 的 `confirmed`）。
  它仍不是实测得出的数字——改动只需新的确认，不需要新的证据。
- **~~`epics.md` 与 `sprint-status.yaml` 已漂移。~~ 已于 2026-08-24 修复。** 原记录说 dry-run 会
  drop 5 条 `epics.md` 未覆盖的 story 键（全为 `done`）；实测是 **6** 条——除 Epic 2／3 的 5 条
  之外，Story 4.7 因为标题写成 `### Story 4.7（原 Story 4.6）：退役 .cap/ 本体`，派生键
  `4-7-原-story-4-6-退役-cap-本体` 与 sprint-status.yaml 的 `4-7-退役-cap-本体` 对不上，会被
  同时"新建一条 backlog + 丢弃一条 done"。修法：给 Epic 2／3 在 epics.md 补回 Story 标题与索引
  （验收标准仍以各自 `spec-*.md` 为准，不重建副本），并把 4.7 的历史编号说明从标题移到正文。
  现在 `generate --dry-run` 报 `in_sync: true`、`dropped_orphans: []`。
  另需注意：`generate` **不加 `--dry-run` 就会直接写入** status 文件（`--set` 不是写入的开关），
  本次核查时曾因此误写一次并从 git 还原。
- **`epic-1-retro-item-5` 的结论是错的。** 它记为 `done`、理由是「给 `sprint_status.py`
  加了 `--set-epic-status`」；实际该能力上游本就有（`sprint_plan.py generate --set`），
  补丁已于 2026-08-24 全部回退。历史 retro 文档未改（那是当时认知的记录），正确结论
  记在 `appraisals.json` 的 `groups.bmad.evidence`。
- **`bmad` 在仓库里存了两份**（`.agents/skills` 与 `.claude/skills`，内容完全相同，各 243 个
  文件，两份都被 git 跟踪）。一个组装到两个客户端不该在源里 vendor 两遍；登记面只计一份，
  因此 75 与 872 KB 是保守值。2026-08-24 核实过一遍：这**不是**误提交（提交 `7024901`
  的标题就是「跟踪 BMad skill 安装本体」，`.gitignore` 有整段说明），也**不是**等 Epic 4
  就能去掉——Epic 4 的 adapter 只物化被它启动的 fresh 会话，而这两份是客户端从 git 跟踪
  文件原生发现的（AD-20 的 2026-08-24 澄清）。缺的是上游「供给 + 分发」能力面，记在 #173；
  在它落地前两份都必须保持被跟踪。
