---
title: 'configs CLI：启动时静默自更新客户端'
type: 'feature'
created: '2026-08-23'
status: 'done'
review_loop_iteration: 1
context: []
baseline_commit: 'ec5f8206225a7e06c0bfd90db47ea5eeb1647e1c'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `configs` 编译后的独立可执行文件目前发布后不会自我更新——用户装上某个版本就永久停留在那个版本，直到手动重新下载。负责人已明确要求 `configs` 具备启动时自动更新的能力，`ARCHITECTURE-SPINE.md` AD-15 已修订出对应的窄范围联网例外。此前误以为参照物 `omp` 也是"进程启动时静默检测并原地替换二进制"（`~/.bun/bin/omp.exe` 旁的 `.bak` 文件曾被当作证据）——经核实，`omp` 实际提供的是显式的 `omp update` 子命令，内部用 `bun add` 重装 npm 包，全程可见输出（当前版本→发现新版本→安装进度→"已更新到 X.X.X"）；`.bak` 文件更可能是 `bun` 包管理器重装时 Windows bin shim 机制的副产物，不是"静默自更新"的证据。本次修正这个前提：成功更新时也需要给出可见提示（见 `sprint-change-proposal-2026-08-23-configs-self-update-visible-success.md`）。

**Approach:** 新增一个只在编译后的发布二进制上运行的自更新组件：进程启动时只读 GET 一次固定的 GitHub Releases `latest` 端点，若 tag 版本与当前版本不同就下载对应平台资产与 `SHA256SUMS.txt`、校验哈希，通过后把旧二进制重命名为 `.bak` 并原地写入新二进制。整条链路任一步失败都静默降级为"本次不更新，继续用当前版本完成启动"，不阻塞或拖慢当前命令；成功替换后打印一行简洁提示（如"已更新到 X.X.X"），不需要额外确认。

## Boundaries & Constraints

**Always:**
- 只读 GET 固定端点 `https://api.github.com/repos/zaurakworks/agent-system/releases/latest`；不得从用户可控或运行时派生的 URL 拉取（AD-15）。
- 下载的二进制资产必须先用同一 release 里的 `SHA256SUMS.txt`（Story 2.1 定的标准 `sha256sum` 格式：`<hash>  <filename>`）逐字节校验通过，才允许替换本地文件；校验失败一律放弃本次更新，不写入任何文件。
- 替换前把旧二进制重命名为 `<execPath>.<当前版本号>.bak` 保留可回滚版本，与 `omp` 参照物的 `.bak` 模式一致。
- 检查/下载/校验/替换整条链路必须整体 try/catch，任一步失败都不得抛出、不得阻塞或延迟当前命令的执行与退出码，也不得输出到 stdout/stderr/TUI（失败静默降级，同 AD-15）；网络请求必须带边界超时，不得无限等待。
- 替换成功后（旧二进制已重命名为 `.bak`、新二进制已写入原路径）打印一行简洁提示到 stdout，说明已更新到的新版本号（如 `configs: 已更新到 vX.X.X`）；这行提示本身的输出/格式化失败不得影响命令继续执行或退出码。
- 只在编译后的发布二进制上运行：`CONFIGS_VERSION === 'dev'`（源码/测试运行）时整体跳过，不发起任何网络请求。
- 不采集、不携带、不上报任何遥测、使用数据或产品状态；请求不携带任何认证 token 或用户标识。

**Ask First:** 实现与单元测试全部完成后，若要用一次真实的 `configs-v*` tag 推送做端到端验证（下载并替换真实二进制）——这会在仓库公开创建一次 GitHub Release，是可见、不易撤销的动作——必须先问负责人确认，不主动推送（沿用 Story 2.1 同款约束；截至本次规划仓库尚无任何已发布 Release）。

**Never:**（下方"不引入 daemon…"一条已被 Issue #153 改写，见本节末尾的修订说明）不做代码签名/公证校验（沿用 Story 2.1 对 AD-15"签名或哈希二选一"选哈希的裁决）；不触碰或影响 OMP 自身版本升级路径（capability probe/adapter fixtures/smoke 门不变）；不引入 daemon、常驻进程或轮询定时器——检查只在进程启动这一次性时点内联发生；不持久化更新历史或版本决定到 SQLite 或磁盘（`.bak` 文件本身除外）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 源码运行 | `bun src/cli/index.ts <cmd>`，`CONFIGS_VERSION === 'dev'` | 完全跳过自更新，不发起任何网络请求 | N/A |
| 已是最新版本 | 编译二进制运行，release tag（去 `configs-v` 前缀）等于 `CONFIGS_VERSION` | 不下载、不替换，命令正常继续 | N/A |
| 仓库无任何 Release | GET `/releases/latest` 返回 404 | 视为无更新可用，命令正常继续 | 静默丢弃，不重试 |
| 有新版本、平台受支持、校验通过 | tag 版本不同；`process.platform`/`arch` 匹配四个已发布资产之一；下载字节 SHA256 与 `SHA256SUMS.txt` 一致 | 旧二进制重命名为 `.bak`，新二进制写入原路径，打印一行"已更新到 vX.X.X"提示，命令正常继续（本次仍用旧版本完成） | N/A |
| 校验失败 | 下载字节 SHA256 与 `SHA256SUMS.txt` 不一致 | 不替换本地文件 | 静默丢弃，不重试 |
| 网络请求失败或超时 | release 元数据或资产下载失败/超时 | 不替换本地文件 | 静默丢弃，不重试 |
| 平台不受支持 | `process.platform`/`arch` 不在四个已发布资产命名规则内 | 不下载、不替换 | 静默丢弃 |


### 修订：检查时机与节流（Issue #153，负责人 2026-08-24 明确激活）

负责人通过 [Issue #153](https://github.com/zaurakworks/agent-system/issues/153) 明确重新协商了本节两条约束，改写范围仅限"何时检查、是否阻塞、是否记时间戳"，**不改变**端点、完整性校验、`.bak` 回滚、零遥测、失败静默降级、`CONFIGS_VERSION === 'dev'` 完全跳过这些约束：

- 原 Always"不得阻塞或延迟当前命令"在实现上并未成立——检查是 `await` 在任何子命令分发之前的，实测 `configs --version` 因此多花约 1s，网络差时最坏可达约 65s。现改为：前台命令**不得**发起或等待任何自更新网络请求；检查由前台派发一个 stdio 全丢弃的独立后台进程（`configs --self-update-worker`）完成，其结果只影响**下一次**调用。
- 原 Never"不引入 daemon、常驻进程或轮询定时器——检查只在进程启动这一次性时点内联发生；不持久化更新历史或版本决定到 SQLite 或磁盘"改为：仍然不引入 daemon、常驻进程或轮询定时器（后台检查器是一次性短命进程，做完即退出），但允许持久化一个最小调度状态文件 `$HOME/.agent-system-state/control-plane/self-update.json`，只含"上次检查时间戳"与"待播报的已装版本号"两个字段；它是可丢弃的调度缓存，损坏或缺失一律退化为"现在就检查"，不作为任何产品决定的真源，也不记录更新历史。
- 由此新增的节流：每台机器每 24 小时最多检查一次（`SELF_UPDATE_CHECK_COOLDOWN_MS`），同时消化 deferred-work 里"每次调用都实打一次未认证 GitHub API"一条。
- 成功提示的时机随之改变：后台替换成功后不再在当次调用打印，而是由**第一个真正运行到该新版本**的前台调用打印（因此 i18n 文案从"（下次启动生效）"改为"（当前已生效）"）；`--version` 仍不打印且不消耗该提示（保留 `release-configs.yml` 冒烟测试依赖的"单行裸版本号"契约）。
- 自更新后立刻重启替换后二进制的行为（`buildSelfUpdateRestartArgv`）随之删除：它的唯一目的就是让更新在当次调用生效，而 Issue #153 明确接受"本次仍用旧版本跑完，下一次调用才生效"。

</frozen-after-approval>

## Code Map

- `packages/control-plane/src/application/ports.ts` -- 追加 `SelfUpdatePort { checkAndApply(currentVersion: string): Promise<void> }`，与既有 `OmpProcessPort`/`LaunchContextWriter` 同一约定：接口不做产品决定，方法保证不抛出。
- `packages/control-plane/src/adapters/self-update/asset-target.ts`（新增） -- 纯函数 `resolveAssetName(platform, arch): string | null`，映射 `process.platform`/`process.arch` 到 Story 2.1 四个资产名之一（`configs-windows-x64.exe`/`configs-linux-x64`/`configs-darwin-x64`/`configs-darwin-arm64`），不支持组合返回 `null`。
- `packages/control-plane/src/adapters/self-update/checksum.ts`（新增） -- 纯函数 `parseSha256Sums(text): Map<string,string>`，解析标准 `sha256sum` 输出（`<hash>  <filename>`）。
- `packages/control-plane/src/adapters/self-update/version-compare.ts`（新增） -- 纯函数 `isNewerVersion(remote: string, current: string): boolean`。按 `.` 切分成数字段逐段比较（`1.2.0` vs `1.10.0` 按数值而非字符串比较）；任一侧存在非数字段、段数为 0，或整体判定为"不确定"时返回 `false`（宁可漏更新也不误降级，同 `checkAndApply`"失败即不更新"的 fail-closed 精神）。
- `packages/control-plane/src/adapters/self-update/github-release-updater.ts`（新增） -- `GithubReleaseUpdater implements SelfUpdatePort`，注入可替换的 `fetch`（默认全局 `fetch`，供测试用 fake 替换，同 `FakeOmpProcessPort` 的可测试性约定）；`checkAndApply` 内部整体 try/catch。判定"有更新"改用 `isNewerVersion(latestVersion, currentVersion)`，不再是简单不等比较。`fetchWithTimeout` 的 `AbortController` 覆盖范围延伸到调用方读完响应体（`.json()`/`.text()`/`.arrayBuffer()`）为止才 `clearTimeout`，不再是 `fetch()` 本身一 resolve（只拿到 header）就解除超时。`replaceBinary` 改为"先把新字节写到 `<execPath>.download` 临时文件 -- 成功后才 `rename` 旧文件为 `.bak` 并把临时文件 `rename` 到 `execPath`"，把最可能失败的磁盘写入步骤挪到任何破坏性 rename 之前，缩小"旧文件已改名但新文件还没写好"的窗口。
- `packages/control-plane/src/cli/index.ts`（`import.meta.main` 块，`process.exit` 之前） -- `CONFIGS_VERSION !== 'dev'` 时 `await new GithubReleaseUpdater().checkAndApply(CONFIGS_VERSION)`，先于 `main()`/`runTui()` 调用；`main()`/`runTui()` 自身不感知自更新（保持既有可测试性，不新增隐式副作用）。
- `packages/control-plane/tests/adapters/self-update.test.ts`（新增） -- 覆盖 I/O 矩阵全部七行，另加"latest 版本低于/等于当前版本"和"写入新文件失败时原二进制不受影响"两个系统级场景，用 fake fetch + 临时目录代替真实网络/文件系统。

## Tasks & Acceptance

**Execution:**
- [x] `packages/control-plane/src/application/ports.ts` -- 新增 `SelfUpdatePort` -- 供 adapter 实现、CLI 入口依赖注入
- [x] `packages/control-plane/src/adapters/self-update/asset-target.ts` -- 新建平台→资产名映射 -- I/O 矩阵"平台不受支持"行
- [x] `packages/control-plane/src/adapters/self-update/checksum.ts` -- 新建 SHA256SUMS 解析 -- I/O 矩阵"校验失败"行的前置解析步骤
- [x] `packages/control-plane/src/adapters/self-update/version-compare.ts` -- 新建 `isNewerVersion` -- 防止把"版本不同"误判为"有更新"，堵住 CI 发布流水线自烧毁场景（见 Spec Change Log）
- [x] `packages/control-plane/src/adapters/self-update/github-release-updater.ts` -- 新建端到端自更新实现，接入 `isNewerVersion`、延伸超时覆盖到响应体读取、临时文件先行写入再替换 -- I/O 矩阵除"源码运行"外全部行
- [x] `packages/control-plane/src/cli/index.ts` -- 接入 `import.meta.main` 块 -- I/O 矩阵"源码运行"/"已是最新版本"两行
- [x] `packages/control-plane/tests/adapters/self-update.test.ts` -- 新建 -- 覆盖 I/O 矩阵全部七行 + 两个新增系统级场景

**Acceptance Criteria:**
- Given 从源码运行任意命令，when 执行，then 不发起任何网络请求。
- Given 编译二进制且 release 元数据请求超时、404 或失败，when 运行任意子命令，then 命令正常完成、返回原有退出码，stdout/stderr/TUI 无自更新相关输出。
- Given 下载资产字节与 `SHA256SUMS.txt` 记录的哈希不一致，when 校验，then 不替换本地二进制文件，原文件内容不变。
- Given 校验通过并完成替换，when 检查文件系统，then 存在 `<execPath>.<替换前版本号>.bak` 且内容等于替换前的原二进制，原路径处是新二进制内容。
- Given 自更新检查耗时较长（网络慢但未超时），when 命令仍在执行，then 总耗时不超过实现设定的边界超时，不无限等待，且该超时覆盖到响应体读取完成为止，不只是响应头返回为止。
- Given release 元数据里的 tag 版本号数值上低于或等于 `CONFIGS_VERSION`（含"版本不同但更旧"的情况，例如触发发布 tag 前、新 Release 尚未创建时 `/releases/latest` 仍返回上一个已发布版本），when 检查，then 不下载、不替换，命令正常继续，本地二进制保持不变。
- Given 写入新二进制的临时文件失败（如磁盘满），when 检查，then 原 `execPath` 处的文件内容和权限完全不变，不存在旧文件已被改名但新文件未写入的中间态。

## Spec Change Log

- **Issue #153（2026-08-24，负责人明确激活）：** 自更新检查从"每次调用前台同步 `await`"改为"前台按 24 小时冷却期派发独立后台进程，结果只影响下一次调用"。改动落在 `cli/index.ts`（`reportPendingSelfUpdateNotice`/`scheduleSelfUpdateCheck`/`runSelfUpdateWorker` 三个导出函数 + `import.meta.main` 分发）、新增 `adapters/self-update/check-state.ts` 与 `cli/self-update-state-path.ts`、i18n 文案与三个测试文件；`GithubReleaseUpdater` 本体（端点、超时、校验、`.bak`、fail-closed）一行未动。frozen 段的两条相关约束由负责人在 Issue 中重新协商，详见上方"修订：检查时机与节流"。删除 `reportSelfUpdateResult`/`buildSelfUpdateRestartArgv` 及其测试（前者被 `reportPendingSelfUpdateNotice` 取代，后者的"当次生效"目的被 Issue 明确放弃）。

- **触发发现（bad_spec，review_loop_iteration 1）：** 三个独立审查视角（Blind Hunter、Edge Case Hunter、Verification Gap Reviewer）交叉证实同一根因——`checkAndApply` 用"tag 与 `CONFIGS_VERSION` 是否不同"判定"有更新"，而不是"是否更新"。Verification Gap Reviewer 给出了具体、可复现的场景：`.github/workflows/release-configs.yml` 的"Smoke-test compiled binary"步骤在新 Release 真正创建之前，用新版本号编译并运行 `dist/configs-linux-x64`；此时 `GET /releases/latest` 仍返回上一个已发布版本，纯"不等"判定会误判为"有更新"，触发下载并用旧版本覆盖刚编译出的新二进制，进而把陈旧二进制发布到正式 Release。Blind Hunter/Edge Case Hunter 独立指出同一比较逻辑还允许任意"版本不同"（含更旧的 latest release）触发降级。另外两个关联发现一并折入本次修订：(a) `fetchWithTimeout` 的 `clearTimeout` 在 `fetch()` resolve（只拿到响应头）时就执行，未覆盖后续的响应体读取，一个响应头正常但响应体卡住的连接会无限期挂起，违反 Always 约束"网络请求必须带边界超时，不得无限等待"；(b) `replaceBinary` 先 `rename` 旧二进制再 `writeFile` 新内容，若 `writeFile`/`chmod` 在 rename 之后失败，`execPath` 处于"旧文件已消失、新文件未就位"的中间态，导致下次启动直接失败。
- **已修订：** Design Notes 新增"`isNewerVersion` 判定 + fail-closed"、"超时覆盖到响应体读完为止"、"先写临时文件再两次 rename"三条设计决策；Code Map 新增 `version-compare.ts` 文件条目，并更新 `github-release-updater.ts`/测试文件条目描述这三处修订；Tasks & Acceptance 新增对应任务行与两条系统级验收标准。`Intent`/`Boundaries & Constraints`/`I/O & Edge-Case Matrix`（frozen 部分）未改动——"有新版本"场景的产品意图本就蕴含"更新"而非"不同"，此次只是修正非 frozen 区域里对该意图的错误技术实现假设。
- **避免的已知坏状态：** 自更新客户端在 CI 发布流水线自身的 smoke-test 步骤里把刚编译好的新版本二进制静默替换为旧版本，导致发布到 GitHub Releases 的资产实际是陈旧二进制；以及任何"latest release 版本号低于本地版本"场景下的静默降级；以及一次网络体读取卡死导致自更新检查无限期挂起；以及一次失败的二进制写入让 `configs` 彻底无法启动（旧文件已被改名但新文件还没写好的窗口）。
- **KEEP（必须在重新派生的代码中保留）：** `SelfUpdatePort` 接口与其"不做产品决定、不抛出"的约定；`resolveAssetName`/`parseSha256Sums` 纯函数设计与其独立单测；`fetch`/`execPath` 构造函数注入的可测试性风格（同 `FakeOmpProcessPort` 惯例）；`checkAndApply` 顶层 try/catch 整体静默降级 + 内部 `currentVersion === 'dev'` 防御性早退；`cli/index.ts` 里"先于 `main()`/`runTui()` 调用、`main()`/`runTui()` 不感知自更新"的接入方式；`<execPath>.<旧版本号>.bak` 命名约定；GitHub `/releases/latest` 固定端点、无认证 header、无遥测；已验证通过的 231 项既有测试与 typecheck 全绿的基线不得回归。

## Design Notes

- `checkAndApply` 用注入的 `fetch`（构造函数参数，默认 `globalThis.fetch`）而不是环境变量做端点覆盖——保持"固定端点不可被用户配置"这条 Always 约束在生产路径上成立，同时不牺牲单元测试的可替换性，与既有 `FullDeps`/`CliOverrides` 依赖注入风格一致。
- GitHub `/releases/latest` 语义天然排除 prerelease/draft，但"是否有更新"必须用 `isNewerVersion(latestVersion, currentVersion)` 判定，不能只判断 tag 是否与 `CONFIGS_VERSION` 不同（详见 Spec Change Log：`release-configs.yml` 自身的编译后 smoke-test 步骤，会在新 Release 真正创建之前就用新版本号运行编译产物，此时 `/releases/latest` 返回的是上一个已发布版本——纯"不等"判定会把这当成"有更新"去下载替换，用旧版本覆盖刚编译出的新二进制）。`isNewerVersion` 按数字段比较，任何解析不确定都返回 `false`（fail-closed，宁可漏更新也不误降级）——这是本次唯一需要新增判断逻辑的地方，其余端点/校验/替换机制不变。
- 每个网络请求的边界超时必须覆盖到响应体读完为止，不能只到 `fetch()` 本身 resolve（此时只保证响应头已到达，`Response` 对象已构造，但 `.json()/.text()/.arrayBuffer()` 读取响应体是后续步骤）——`AbortController` 的 `clearTimeout` 时机要挪到调用方读完响应体之后，否则一个响应头正常但响应体卡住的连接可以无限期挂起，直接违反"网络请求必须带边界超时，不得无限等待"这条 Always 约束。
- `replaceBinary` 采用"先写临时文件、再做两次 rename"而不是"先 rename 旧文件、再 writeFile 新内容"——最可能失败的步骤（写入新字节，如磁盘满/权限问题）被挪到任何破坏性操作之前；只有临时文件完整写入成功后才依次 `rename` 旧文件到 `.bak`、`rename` 临时文件到 `execPath`，把"旧文件已被改名但新文件还没写好"的窗口从整个下载/写入过程缩小到两次几乎瞬时的 `rename` 调用之间。
- 请求不携带任何认证 header——未认证的 GitHub API 限额（60 次/小时/IP）远高于单机正常调用频率，且编译进公开分发的二进制里不适合内嵌任何 token。
- 替换目标是 `process.execPath`（Bun 编译产物运行时指向自身路径），而不是 `process.argv[0]` 或某个硬编码路径，避免用户把可执行文件改名/移动后自更新写错文件。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全部通过，含新增 `tests/adapters/self-update.test.ts`
- `cd packages/control-plane && bun run typecheck` -- expected: 无错误

**Manual checks (if no CLI):**
- 交叉编译一个带虚构旧版本号的 smoke 二进制并在本机运行：仓库当前无任何已发布 Release，预期该二进制打完整命令后正常完成、无输出、无崩溃（验证"仓库无 Release"这一真实边界情况下的静默降级），不需要为此推送任何 tag。
- 真实端到端下载-替换验证（需要真实 Release 存在）留给 Ask First 获批后单独执行，不在本次实现的默认验证范围内。

## Suggested Review Order

**版本比较与更新判定（本次审查发现并修复的核心问题）**

- 入口：判定"是否有更新"改用 `isNewerVersion` 而非简单不等比较，直接堵住 CI 发布流水线自烧毁场景。
  [`github-release-updater.ts:159`](../../packages/control-plane/src/adapters/self-update/github-release-updater.ts#L159)

- 数字段严格比较 + 任何解析歧义一律 fail-closed 返回"不是更新"，宁可漏更新也不误降级。
  [`version-compare.ts:21`](../../packages/control-plane/src/adapters/self-update/version-compare.ts#L21)

**网络请求超时覆盖到响应体读完为止**

- `withTimeout` 把 `clearTimeout` 延后到 `run()`（含响应体读取）结束才执行，堵住"响应头到但响应体卡住会无限期挂起"的漏洞。
  [`github-release-updater.ts:76`](../../packages/control-plane/src/adapters/self-update/github-release-updater.ts#L76)

**原子替换 replaceBinary**

- 先把新字节写到临时文件（最可能失败的一步），成功后才做两次近乎瞬时的 rename，缩小"旧文件已改名但新文件未就位"的窗口。
  [`github-release-updater.ts:96`](../../packages/control-plane/src/adapters/self-update/github-release-updater.ts#L96)

**接入点**

- 只在编译后的发布二进制（`CONFIGS_VERSION !== 'dev'`）上、先于 `main()`/`runTui()` 触发；源码/测试运行完全不发起网络请求。
  [`cli/index.ts:454`](../../packages/control-plane/src/cli/index.ts#L454)

- `checkAndApply` 顶层 try/catch 整体静默降级，失败/成功都不产生任何输出。
  [`github-release-updater.ts:142`](../../packages/control-plane/src/adapters/self-update/github-release-updater.ts#L142)

**辅助纯函数与端口定义**

- 平台/架构 -> 发布资产名映射，四个组合之外一律返回 `null`。
  [`asset-target.ts:9`](../../packages/control-plane/src/adapters/self-update/asset-target.ts#L9)

- 标准 `sha256sum` 格式解析，畸形行跳过而不是抛出。
  [`checksum.ts:14`](../../packages/control-plane/src/adapters/self-update/checksum.ts#L14)

- `SelfUpdatePort` 接口新增，延续既有端口"不做产品决定、不抛出"的约定。
  [`ports.ts:104`](../../packages/control-plane/src/application/ports.ts#L104)

**测试**

- 覆盖全部 7 行 I/O 矩阵 + 两个新增系统级场景（旧版本 latest release、写入失败无中间态），含响应体卡住的超时验证。
  [`self-update.test.ts:263`](../../packages/control-plane/tests/adapters/self-update.test.ts#L263)
