# Sprint Change Proposal — configs 自更新：成功提示可见化（2026-08-23）

## 触发与背景

用户在实测 `configs` 自更新时（先后两次撞见编译产物迁移路径 bug，修复并发布 `configs-v0.1.1` 后追问"更新后是不是应该跑新版、更新是不是该有点输出，像 omp 一样？"）促使核实参照物 `omp` 的真实行为。实测结果：`omp` **不是**"进程启度时静默检测新版本并原地替换二进制"——它有一个显式的 `omp update` 子命令，内部用 `bun add` 重装 npm 包，全程可见输出（"Current version: 18.0.1" → "New version available: 18.0.3" → 安装进度 → "✔ Updated to 18.0.3"）；普通启动（`omp`/`omp --version`）没有观察到任何后台静默检查的痕迹。`~/.bun/bin/omp.exe` 旁的 `.bak` 文件此前被当作"omp 静默原地替换二进制"的证据，更可能只是 `bun` 包管理器重装 npm 包时 Windows bin shim 机制的副产物。

`ARCHITECTURE-SPINE.md` AD-15 与 Story 2.2（`configs` 自更新客户端，已 `done`）均以这个错误前提为参照物起草。核对后发现：**AD-15 本身其实没有错**——它的 Rule 原文只要求"任一步骤失败一律静默降级...不得阻塞或使当前激活失败"，从未要求"成功也必须静默"。真正越界的是 Story 2.2 自己的 spec，在 AD-15 之外自行加了一条更严格的"Never: 成功和失败都不在正常输出中提示"。

## Section 1：Issue Summary

- **问题：** Story 2.2 的 spec 基于对参照物 `omp` 行为的错误理解（"omp 静默原地替换二进制"），额外加上了 AD-15 本身并未要求的"成功也不得输出提示"的约束。
- **类型：** 对原始需求的误解（Misunderstanding of original requirements）——不是新需求，也不是实现期技术限制；是起草 Story 2.2 spec 时对参照物的事实判断错了。
- **证据：** 实测 `omp update` 输出（"Current version: 18.0.1" / "New version available: 18.0.3" / 安装进度 / "✔ Updated to 18.0.3"）；`omp --version`/裸 `omp` 调用未观察到任何静默检查痕迹；`ARCHITECTURE-SPINE.md:159`（AD-15 Rule 原文，只约束失败路径静默，不约束成功路径）；`spec-2-2-自更新客户端.md` 冻结区 Problem/Approach/Never 三处引用错误前提的原文。

## Section 2：Impact Analysis

### Epic Impact

- **Epic 2（控制面发布与自更新）：** 仍可按原计划完成，不需要新增/删除/重排 Epic。Story 2.2 已交付的核心机制（固定端点、完整性校验、`.bak` 回滚、失败静默降级、零遥测、只在编译二进制上运行）全部不受影响，只有"成功路径是否输出"这一个具体约束需要修正。
- **Epic 1、Epic 3：** 不受影响，与自更新机制无关。

### Artifact Conflicts

- **PRD：** 无冲突。分发/更新机制不在 PRD 承诺范围内（同 2026-08-22 原提案的结论）。
- **Architecture（`ARCHITECTURE-SPINE.md` AD-15）：** **核实后无需修改。** AD-15 的 Rule 原文本来就只约束"失败静默降级"，从未要求"成功也静默"——之前的误解发生在 Story 2.2 spec 层面，不是 AD-15 本身的错。为避免未来同类误解，建议在 AD-15 Rule 末尾追加一句显式澄清（见 Section 4.1），但这只是补充说明，不改变任何既有约束的实质内容。
- **Story 2.2 spec（`_bmad-output/implementation-artifacts/spec-2-2-自更新客户端.md`）：** 需要修订，已 `done`，属于对已交付内容的追溯修正。具体改动见 Section 4.2：
  - Problem 陈述里对 `omp` 行为的错误描述需要更正。
  - Approach 陈述"不产生任何可见输出"改为区分失败（静默）与成功（一行提示）。
  - Boundaries "Always" 的失败静默条款保留但明确限定为失败路径；新增成功路径必须打印一行提示的条款。
  - "Never" 里"成功和失败都不在正常输出中提示"整条删除（拆分到 Always 的两个方向各自表述，不再是一条笼统禁令）。
  - I/O 矩阵"有新版本、平台受支持、校验通过"这一行的 Expected Output/Behavior 需要补上"打印一行提示"。
- **UX（DESIGN.md/EXPERIENCE.md）：** 未提及自更新提示文案，本次不需要修改；具体提示文案（中英双语 key）留给实现阶段按既有 i18n 惯例添加。
- **CI/CD：** 无冲突，`release-configs.yml` 的发布流程不受影响。

### Technical Impact（供后续实现阶段参考，本次不落地代码）

- `GithubReleaseUpdater.checkAndApply`（或调用方 `cli/index.ts` 的 `import.meta.main` 块）在二进制替换成功后需要打印一行简洁提示（如 `configs: 已更新到 v0.1.2`），复用既有 i18n `t()` 机制新增双语 key。
- `tests/adapters/self-update.test.ts` 里"有新版本、平台受支持、校验通过"对应的测试用例断言需要从"无输出"改为"断言这一行提示确实被打印"。
- 失败路径（网络失败、校验失败、平台不支持、已是最新版本等）保持完全不变——仍然整体静默降级，不打印任何内容。

## Section 3：Recommended Approach

**选择：Option 1（Direct Adjustment）。**

- 修订 Story 2.2 spec 的 Problem/Approach/Boundaries/Never/I-O 矩阵五处文本（Section 4.2），把"成功路径不得输出"这条越界约束改成"成功路径必须输出一行提示，失败路径仍然完全静默"。
- 给 AD-15 追加一句显式澄清（Section 4.1），说明"失败静默"从未意味着"成功也静默"，避免未来重复此误解。
- 不涉及 Option 2（回滚）——Story 2.2 已交付的核心机制没有错，不需要回退任何代码，只是收紧过头的一条约束需要放开。
- 不涉及 Option 3（PRD MVP 范围调整）——不影响 PRD/MVP。

**Effort：** Low（spec 文本修订）+ Low-Medium（后续实现：给 `checkAndApply` 加一行成功输出、加 i18n key、改一处测试断言，范围小、无新组件）。
**Risk：** Low——只是让一个已经完整实现完整性校验/固定端点/失败静默的机制在成功时多打印一行版本号，不引入新的攻击面或副作用；失败路径的静默降级、零遥测等安全边界完全不变。
**Timeline：** 不影响任何进行中的 Epic 3 工作；是对已交付 Story 2.2 的小范围追溯修正。

## Section 4：Detailed Change Proposals

### 4.1 Architecture — `ARCHITECTURE-SPINE.md` AD-15（补充澄清，非实质修改）

**Section:** `### AD-15 — 控制面发布、客户端升级与高频激活分离`

**在 Rule 段落末尾追加一句：**
```
"失败静默降级"只约束失败路径；更新成功（二进制已替换）时允许打印一行简洁提示（如版本号），不要求也不因此产生额外确认或阻塞——这一句是本次追溯澄清，不改变上述固定端点、完整性校验、`.bak` 回滚、失败静默降级、零遥测等既有约束的实质内容。
```

**理由：** 明确"失败静默 ≠ 成功也静默"，防止未来因同类误解再次收紧本不该收紧的约束。

### 4.2 Story 2.2 spec — `_bmad-output/implementation-artifacts/spec-2-2-自更新客户端.md`（冻结区修订）

**Problem（OLD → NEW）：**

OLD:
```
参照物 `omp` 已有进程启动时静默检测新版本并原地替换二进制的机制（`~/.bun/bin/omp.exe` 旁的 `.bak` 文件为证），负责人已明确要求 `configs` 具备同等能力，`ARCHITECTURE-SPINE.md` AD-15 也已修订出对应的窄范围联网例外。
```

NEW:
```
负责人已明确要求 `configs` 具备启动时自动更新的能力，`ARCHITECTURE-SPINE.md` AD-15 已修订出对应的窄范围联网例外。此前误以为参照物 `omp` 也是"进程启动时静默检测并原地替换二进制"（`~/.bun/bin/omp.exe` 旁的 `.bak` 文件曾被当作证据）——经核实，`omp` 实际提供的是显式的 `omp update` 子命令，内部用 `bun add` 重装 npm 包，全程可见输出（当前版本→发现新版本→安装进度→"已更新到 X.X.X"）；`.bak` 文件更可能是 `bun` 包管理器重装时 Windows bin shim 机制的副产物，不是"静默自更新"的证据。本次修正这个前提：成功更新时也需要给出可见提示。
```

**Approach（OLD → NEW）：**

OLD:
```
整条链路任一步失败都静默降级为"本次不更新，继续用当前版本完成启动"，不产生任何可见输出，也不阻塞或拖慢当前命令。
```

NEW:
```
整条链路任一步失败都静默降级为"本次不更新，继续用当前版本完成启动"，不阻塞或拖慢当前命令；成功替换后打印一行简洁提示（如"已更新到 X.X.X"），不需要额外确认。
```

**Boundaries → Always（OLD 条款 → NEW 条款，并新增一条）：**

OLD:
```
- 检查/下载/校验/替换整条链路必须整体 try/catch，任一步失败都不得抛出、不得输出到 stdout/stderr/TUI，也不得阻塞或延迟当前命令的执行与退出码；网络请求必须带边界超时，不得无限等待。
```

NEW（原条款收窄为仅约束失败路径）：
```
- 检查/下载/校验/替换整条链路必须整体 try/catch，任一步失败都不得抛出、不得阻塞或延迟当前命令的执行与退出码，也不得输出到 stdout/stderr/TUI（失败静默降级，同 AD-15）；网络请求必须带边界超时，不得无限等待。
```

新增条款：
```
- 替换成功后（旧二进制已重命名为 `.bak`、新二进制已写入原路径）打印一行简洁提示到 stdout，说明已更新到的新版本号（如 `configs: 已更新到 vX.X.X`）；这行提示本身的输出/格式化失败不得影响命令继续执行或退出码。
```

**Never（删除一条）：**

OLD:
```
...成功和失败都不在正常输出中提示"发现新版本/已更新"。
```

NEW：整条删除——失败不提示已被 Always 的收窄条款覆盖，成功需要提示已被 Always 的新增条款要求，不再需要一条笼统的"两者都不提示"禁令。

**I/O & Edge-Case Matrix（一行 OLD → NEW）：**

OLD 行：
```
| 有新版本、平台受支持、校验通过 | tag 版本不同；`process.platform`/`arch` 匹配四个已发布资产之一；下载字节 SHA256 与 `SHA256SUMS.txt` 一致 | 旧二进制重命名为 `.bak`，新二进制写入原路径，命令正常继续（本次仍用旧版本完成） | N/A |
```

NEW 行：
```
| 有新版本、平台受支持、校验通过 | tag 版本不同；`process.platform`/`arch` 匹配四个已发布资产之一；下载字节 SHA256 与 `SHA256SUMS.txt` 一致 | 旧二进制重命名为 `.bak`，新二进制写入原路径，打印一行"已更新到 vX.X.X"提示，命令正常继续（本次仍用旧版本完成） | N/A |
```

### 4.3 `sprint-status.yaml` — 无需改动

Story 2.2 保持 `done`；这是对已交付内容的追溯修正，不是新故事，不新增/删除/重排任何条目。

## Section 5：Implementation Handoff

- **变更范围分类：Minor。** 只是收紧过头的一条约束改回来，不涉及新组件、新 Epic/Story、不改变已交付机制的核心行为（固定端点、完整性校验、`.bak` 回滚、失败静默、零遥测全部不变）。
- **本次 correct-course 直接完成：** `ARCHITECTURE-SPINE.md` AD-15 追加澄清句（Section 4.1）；Story 2.2 spec 的 Problem/Approach/Boundaries/Never/I-O 矩阵五处修订（Section 4.2）——经负责人批准后由本次会话直接落地。
- **后续交给：** 下一次 `bmad-build`，针对已修订的 spec 实现"成功路径打印一行提示"这个小改动（`GithubReleaseUpdater`/`cli/index.ts` 的 `import.meta.main` 块 + 新增 i18n key + 更新 `tests/adapters/self-update.test.ts` 对应断言），预计走 one-shot 或小型 plan-code-review 路径即可，不需要重新走完整 Story 规划。

## Section 6：批准记录

负责人已批准，直接落地：`ARCHITECTURE-SPINE.md` AD-15 按 Section 4.1 追加澄清句；`spec-2-2-自更新客户端.md` 按 Section 4.2 修订 Problem/Approach/Boundaries（Always 收窄+新增）/Never（删除一条）/I-O 矩阵共五处。`sprint-status.yaml` 无需改动，Story 2.2 保持 `done`。后续"成功路径打印一行提示"的代码实现交给下一次 `bmad-build`。
