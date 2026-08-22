# Sprint Change Proposal — configs 自更新（2026-08-22）

## 触发与背景

负责人在 Epic 1（查看、选择并使用 OMP 配置）交付并合入 `main`（PR #131）后，讨论 `configs` CLI 的分发方式时，明确要求 `configs` 具备"进程启动时后台静默检测新版本并原地替换本地二进制"的自动更新能力，参照对照物 `omp`（`~/.bun/bin/omp.exe` 是 `bun build --compile` 编译的独立可执行文件，旁边的 `.bak` 备份文件证明它确有一套原地自更新机制）。

`ARCHITECTURE-SPINE.md` AD-15 现有规则明确写着："安装/升级是低频显式操作，普通激活不得安装依赖、改插件或联网更新。" 用户想要的行为——启动时静默检查并自动替换二进制——直接落在这条规则禁止的范围内，需要正式修订该 AD 而不是在实现期绕过。

## Section 1：Issue Summary

- **问题：** `configs` 自更新需求与 AD-15 已 adopted 的"普通激活禁止联网更新"规则冲突。
- **类型：** 新需求（负责人明确提出），不是实现期发现的技术限制，也不是对原有需求的误解。
- **证据：** `ARCHITECTURE-SPINE.md:159`（AD-15 Rule 原文）；`omp.exe`/`omp.exe.*.bak` 在 `~/.bun/bin/` 下的实际文件证据，佐证参照物确有原地替换二进制的更新机制。

## Section 2：Impact Analysis

### Epic Impact

- **Epic 1（查看、选择并使用 OMP 配置）：** 不受影响。Story 1.1/1.2 均已 `done`，与分发/更新机制无关，不需要修改。
- **新增 Epic 2（控制面发布与自更新）：** 需要新建，承载"编译独立可执行文件分发 + 自更新机制"这个此前完全没有覆盖的能力域。当前 `epics.md` 范围只锁定 Epic 1，没有第二个 epic 可以复用或调整。
- 其余已规划 epic：无（`epics.md` 当前只有 Epic 1），不存在需要重新排序或废弃的条目。

### Artifact Conflicts

- **PRD：** 无冲突，不需要修改。PRD §11"已知未知与重评条件"已明确"实现语言与产品表面留给架构阶段"，分发/更新机制属于架构层决定，不在 PRD 承诺范围内，MVP 仍可照原样达成。
- **Architecture（`ARCHITECTURE-SPINE.md`）：** AD-15 需要修订（见 Section 4 具体文本）。修订只新增一个范围极窄、有完整性/安全边界的例外，不影响 AD-15 其余规则（OMP 客户端版本升级仍是低频显式操作、仍需 capability probe/smoke 才能更新兼容 snapshot），也不影响其他 AD。
- **UX（DESIGN.md/EXPERIENCE.md）：** 当前完全未提及"启动时更新检查"。是否需要任何终端提示（例如更新完成后的一行提示）留给实现该 Epic 时的 UX/spec 阶段决定，本次不预先改 UX 文档。
- **CI/CD：** 当前 CI 只有 test/typecheck/assembly 相关 job，没有面向"发布 release 二进制 + 托管更新端点"的流水线；这是 Epic 2 实现范围的一部分，不在本次架构修订里处理。

### Technical Impact（供 Epic 2 实现阶段参考，本次不落地）

- 需要一个新的自更新组件：读取固定发布端点的最新版本号 → 下载对应平台工件 → 完整性校验（签名或哈希）→ 原子替换本地二进制（Windows 下运行中的 exe 不能被覆盖，需要类似 `omp` 的"重命名旧文件为 `.bak` + 写入新文件"策略）→ 失败时回滚/静默降级。
- 这是本项目目前唯一会在普通使用路径（`configs` 启动）上主动联网的行为，必须有明确的安全边界（固定端点、强制完整性校验、失败不阻塞启动、不上报任何遥测），这也是 Section 4 里 AD-15 修订文本要显式钉死的部分。

## Section 3：Recommended Approach

**选择：Option 1（Direct Adjustment）。**

- 修订 AD-15 规则文本，正式授权"`configs` 自身进程启动时静默自更新"这一个例外，同时保留其余规则（OMP 客户端升级仍低频显式、仍需 probe/smoke 门）。
- 在 `epics.md` 新增 Epic 2 占位（范围声明 + 指向本次修订的 AD-15），具体 Story 级验收标准留给后续 `bmad-build`/`bmad-create-epics-and-stories` 起草。
- 不涉及 Option 2（回滚）——没有已完成工作与本次冲突，这是纯增量需求，没有可回滚对象。
- 不涉及 Option 3（PRD MVP 范围调整）——PRD 不承诺分发机制，MVP 不受影响。

**Effort：** Low（本次架构文本修订）+ Medium-High（Epic 2 后续实现：跨平台二进制替换、签名/哈希校验、发布流水线）——后者不在本次 correct-course 范围内，留给 Epic 2 自己的 spec 阶段估算。
**Risk：** Medium——主要风险是自更新引入的供应链完整性问题（下载源被劫持、二进制被篡改），已通过 AD-15 修订文本里的强制校验/固定端点/失败降级条款收敛。
**Timeline：** 不影响已完成的 Epic 1；是纯增量范围，不改变已交付内容的时间线。

## Section 4：Detailed Change Proposals

### 4.1 Architecture — `ARCHITECTURE-SPINE.md` AD-15

**Section:** `### AD-15 — 控制面发布、客户端升级与高频激活分离`

**OLD（Prevents 行）：**
```
- **Prevents:** 每次激活安装/升级，以及客户端 contract churn 无门进入。
```

**NEW（Prevents 行）：**
```
- **Prevents:** 每次激活安装/升级依赖或插件、OMP 客户端 contract churn 无门进入，以及外部 CLI 自更新引入未经完整性校验的供应链风险或阻塞正常激活。
```

**OLD（Rule 行）：**
```
- **Rule:** 外部 CLI 以 Bun standalone artifact 分平台发布；OMP 薄扩展通过 Marketplace、Git 或本地 link 分发，但必须与 CLI protocol version 显式兼容。安装/升级是低频显式操作，普通激活不得安装依赖、改插件或联网更新。每个支持客户端的实际版本升级先运行 capability probe、adapter fixtures 与 fresh→locator→explicit resume 目标 smoke，再更新兼容 snapshot。文档声称但 release-pinned CLI/help/source 或 smoke 未证实的能力保持 Unknown。
```

**NEW（Rule 行）：**
```
- **Rule:** 外部 CLI 以 Bun standalone artifact 分平台发布；OMP 薄扩展通过 Marketplace、Git 或本地 link 分发，但必须与 CLI protocol version 显式兼容。安装/升级默认是低频显式操作，普通激活不得安装依赖、改插件或为 OMP/薄扩展联网更新。**唯一例外：外部 CLI 自身版本可以在进程启动时后台静默检查并原地自更新**——这是本架构唯一允许发生在普通激活路径上的联网行为，且必须同时满足：只读 GET 一个固定、版本化的发布端点（不得从用户可控或运行时派生的 URL 拉取）；下载工件必须先通过完整性校验（签名或已知哈希）才允许替换本地二进制；替换前保留可回滚的旧二进制（如 `.bak`）；检查、下载或校验的任一步骤失败一律静默降级为"本次不更新、继续用当前版本完成本次启动"，不得阻塞或使当前激活失败；更新检查/下载过程不得携带或上报任何遥测、使用数据或产品状态。OMP 自身的版本升级不受本条例外覆盖，继续是低频显式操作：每个支持客户端的实际版本升级先运行 capability probe、adapter fixtures 与 fresh→locator→explicit resume 目标 smoke，再更新兼容 snapshot。文档声称但 release-pinned CLI/help/source 或 smoke 未证实的能力保持 Unknown。
```

**理由：** 只新增一个范围极窄的例外（`configs` 自身二进制的启动时静默自更新），把user 明确要求的行为纳入架构授权范围，同时用四个可验证的硬性条件（固定端点、强制完整性校验、失败静默降级不阻塞、零遥测）把供应链风险和"每次激活都做联网副作用"的原有担忧管住。不改变 OMP 客户端升级仍是低频显式操作的既有规则。

### 4.2 Epics — `epics.md` 新增 Epic 2 占位

在 `## Epic List` 小节，`### Epic 1：查看、选择并使用 OMP 配置` 之后追加：

```markdown
### Epic 2：控制面发布与自更新

`configs` 以 Bun 编译的独立可执行文件分平台发布；进程启动时后台静默检查新版本，通过固定发布端点 + 完整性校验后原地自更新，失败静默降级不阻塞本次启动，不上报任何遥测。具体 Story 与验收标准由后续细化产出。

**覆盖 AD：** AD-15（2026-08-22 修订，见 sprint-change-proposal-2026-08-22-configs-self-update.md）
```

**理由：** 只建立范围占位，不预先固化 Story/验收标准——Story 级细节应由后续 `bmad-build`（或 `bmad-create-epics-and-stories`）在真正排期实现时产出，避免本次 correct-course 越权代做产品设计。

### 4.3 `sprint-status.yaml` — 新增 Epic 2 backlog 条目

```yaml
development_status:
  epic-2: backlog
```

## Section 5：Implementation Handoff

- **变更范围分类：Moderate。** 需要新增 backlog 条目（新 Epic），但不触及 PRD、不影响已交付的 Epic 1，也不需要重新做 MVP 范围裁决。
- **本次 correct-course 直接完成：** AD-15 文本修订、`epics.md` Epic 2 占位、`sprint-status.yaml` backlog 条目——三者均为文档层改动，经负责人批准后由本次会话直接落地。
- **后续交给：** 下一次 `bmad-build`（或 `bmad-create-epics-and-stories`）细化 Epic 2 的 Story 与验收标准，并按 spec → 实现 → review 流程交付自更新机制本身（跨平台二进制替换、签名/哈希校验、发布流水线）。

## Section 6：批准记录

负责人已批准，直接落地：`ARCHITECTURE-SPINE.md` AD-15 按 Section 4.1 文本修订；`epics.md` 按 Section 4.2 新增 Epic 2 占位；`sprint-status.yaml` 按 Section 4.3 新增 `epic-2: backlog` 条目。三处均已完成。后续 Epic 2 的 Story 细化与实现交给下一次 `bmad-build`。
