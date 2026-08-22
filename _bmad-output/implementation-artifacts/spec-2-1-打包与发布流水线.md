---
title: 'configs CLI：打包为独立可执行文件并发布到 GitHub Releases'
type: 'feature'
created: '2026-08-22'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '8e157a9810fdd240c154674a0926ae71fa3f7ff2'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `configs` 至今只有 `bun src/cli/index.ts` 源码入口，从未编译打包分发——违反 `ARCHITECTURE-SPINE.md` AD-2/AD-15 从 Epic 1 起就要求的"外部 CLI 以 Bun standalone artifact 分平台发布"，也是 Epic 2 自更新客户端（Story 2.2，已拆分延后）的前置依赖：没有真实发布的、带版本号和 checksum 的产物，自更新无法端到端验证。

**Approach:** 新增一个只在推送 `configs-v*` tag 时触发的 GitHub Actions 发布 job，用 Bun 的跨平台编译（单一 ubuntu-latest runner、`--target` 交叉编译四个平台，不需要 OS matrix）产出独立可执行文件，计算 SHA256 校验和，发布到本仓库 GitHub Releases。CLI 侧新增 `--version` 读取编译期注入的版本号。

## Boundaries & Constraints

**Always:**
- 发布 job 只在推送 `configs-v*` tag 时触发，不在普通 push/PR 到 main 时触发——匹配 AD-15"安装/升级是低频显式操作"。
- 每个发布的二进制都必须在 `SHA256SUMS.txt` 里有一行标准 `sha256sum` 格式的记录（`<hash>  <filename>`）——这是 Story 2.2 自更新客户端做完整性校验时要解析的契约，格式不能自创。
- 产物命名固定：`configs-windows-x64.exe`、`configs-linux-x64`、`configs-darwin-x64`、`configs-darwin-arm64`——同样是 Story 2.2 要按运行平台挑选正确资产的契约。
- 已提交的 `src/cli/version.ts` 里 `CONFIGS_VERSION` 永远是字面量 `'dev'`；发布 job 只在构建期临时覆写这个文件，绝不提交这个改动。
- `--version` 不得打开 SQLite 仓储、不得触碰数据库文件——与既有的零参数/usage-error 路径同一约定。

**Ask First:** 真正推送 `configs-v*` tag（会在仓库公开创建一个 GitHub Release）是可见、不易撤销的动作——实现完成后，推送第一个真实/测试 tag 之前必须先问负责人确认。

**Never:** 不实现自更新客户端本身（Story 2.2，已按 [S] 拆分记入 `deferred-work.md`）；不做代码签名/公证（Windows Authenticode、macOS notarization）——AD-15 允许"签名或已知哈希"二选一，本仓库个人项目规模选哈希；不改动既有 `control-plane-checks.yml` 等 job 的 `bun-version: latest`，只有新发布 job 精确钉版本。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 推送发布 tag | `git push` 一个匹配 `configs-v*` 的 tag | 单 job 交叉编译四平台二进制、生成 `SHA256SUMS.txt`、发布到该 tag 对应的 GitHub Release | N/A |
| 未打包本地运行 | `bun src/cli/index.ts --version` | 打印 `dev`，退出 0，不建库 | N/A |
| 编译后运行 | 用注入版本号编译出的二进制执行 `--version` | 打印构建时注入的版本号，退出 0 | N/A |
| 常规子命令不受影响 | `configs list`/`use`/... | 行为与本次改动前完全一致 | N/A |

</frozen-after-approval>

## Code Map

- `.github/workflows/release-configs.yml`（新增） -- 触发：`push: tags: ['configs-v*']`；单 `ubuntu-latest` job，`permissions: contents: write`；`oven-sh/setup-bun@v2` 钉 `bun-version: 1.3.14`（本机验证过的版本，其余 job 的 `latest` 不动，见 Never）；`cd packages/control-plane && bun install`；从 `$GITHUB_REF_NAME` 剥离 `configs-v` 前缀得到 `VERSION`，`printf` 覆写 `src/cli/version.ts`；对四个 target（`bun-windows-x64`/`bun-linux-x64`/`bun-darwin-x64`/`bun-darwin-arm64`）循环跑 `bun build ./src/cli/index.ts --compile --target=<target> --outfile dist/<asset-name>`；`cd dist && sha256sum * > SHA256SUMS.txt`；`gh release create "$GITHUB_REF_NAME" packages/control-plane/dist/* --title "$GITHUB_REF_NAME" --generate-notes`（`GH_TOKEN: ${{ github.token }}`）。参照 `.github/workflows/control-plane-checks.yml`（同款 checkout/setup-bun/working-directory 写法）。
- `packages/control-plane/src/cli/version.ts`（新增） -- `export const CONFIGS_VERSION = 'dev';`，唯一职责是被发布 job 临时覆写，本地/测试永远读到 `'dev'`。
- `packages/control-plane/src/cli/index.ts` -- `main()` 顶部、`parseCommand` 之前加一个与现有零参数分支同级的 `argv[0] === '--version'` 特判：打印 `CONFIGS_VERSION`、返回 0，不调用 `openDeps`。`import.meta.main` 块不需要改（`--version` 走 `main()` 正常路径，非交互也非 TUI 触发条件）。
- `packages/control-plane/tests/cli/version.test.ts`（新增） -- `main(['--version'])` 断言：输出等于 `dev`（导入 `CONFIGS_VERSION` 而非硬编码字符串）、返回 0、不建 SQLite 文件。

## Tasks & Acceptance

**Execution:**
- [x] `packages/control-plane/src/cli/version.ts` -- 新建占位常量 -- 供编译期覆写与 `--version` 读取
- [x] `packages/control-plane/src/cli/index.ts` -- 加 `--version` 特判 -- I/O 矩阵"未打包本地运行"/"编译后运行"两行
- [x] `.github/workflows/release-configs.yml` -- 新建交叉编译+发布 job -- I/O 矩阵"推送发布 tag"一行
- [x] `packages/control-plane/tests/cli/version.test.ts` -- 新建 -- 覆盖 `--version` 不建库、正确输出
- [x] `packages/control-plane/package.json`/`bun.lock` -- 加 `react-devtools-core` devDependency（未在原 Code Map 里，实现期发现：`bun build --compile` 打包时 `ink` 的 `devtools.js` 动态 import 静态解析到这个可选 peer dep，缺失会让打包步骤本身失败，属于让 spec 的验证命令能跑通所必需的修复）

**Acceptance Criteria:**
- Given 本地未编译源码，when 运行 `bun src/cli/index.ts --version`，then 打印 `dev` 且退出码 0，且不创建/打开数据库文件。
- Given 带任何显式子命令（如 `configs list`），when 运行，then 行为与本次改动前完全一致。
- Given workflow 文件本身，when 用 `actionlint`（若本机可用）或人工核对语法，then YAML 合法、四个 target 名与 Bun 官方交叉编译 target 命名一致。

## Design Notes

- 用单一 `ubuntu-latest` job 加 `--target` 交叉编译四个平台，不用 OS matrix——Bun 的 `--compile --target=bun-<os>-<arch>` 支持跨平台编译产物，不需要真的在目标 OS 上跑，省掉三份 job 的 CI 时间和维护面。
- 版本注入选"构建前覆写一个占位 TS 常量文件"而不是 `bun build --define`——前者本地可读可调试、跨 shell（bash/PowerShell）不必操心 `--define` 的转义规则；`src/cli/version.ts` 提交时永远是 `'dev'`，CI 里的覆写从不落回 git。
- 版本号来源直接是触发发布的 git tag（剥掉 `configs-v` 前缀），不是 `package.json` 的 `version` 字段——tag 是唯一触发发布的动作，用它做单一真源，避免两处版本号手动同步出漂移。
- `SHA256SUMS.txt` 用标准 `sha256sum` 输出格式（而不是自定义 JSON）——`sha256sum -c` 本身就能校验，Story 2.2 的完整性校验实现时可以直接复用这个格式而不用发明新 schema。

## Verification

**Commands:**
- `cd packages/control-plane && bun test` -- expected: 全部通过，含新增 `tests/cli/version.test.ts`
- `cd packages/control-plane && bun run typecheck` -- expected: 无错误
- `cd packages/control-plane && bun build ./src/cli/index.ts --compile --target=bun-windows-x64 --outfile dist-smoke/configs-smoke.exe && ./dist-smoke/configs-smoke.exe --version` -- expected: 手动确认本机能跑通交叉编译且产物可执行（本机是 Windows，用 host target 验证编译产物真实可运行，不只是 workflow YAML 看起来对）

**Manual checks (if no CLI):**
- 实现完成、测试通过后，向负责人确认是否要推送一个真实的 `configs-v*` tag 触发实际发布（会在仓库公开创建 Release），确认前不主动推送。

## Suggested Review Order

**发布流水线：触发、版本注入、交叉编译**

- 触发条件与整条 job 序列——只认 `configs-v*` tag，先 typecheck+test 门再编译，不给未验证的 tagged commit 发布机会。
  [`release-configs.yml:6`](../../.github/workflows/release-configs.yml#L6)

- 版本号从 tag 剥前缀取得，经 `JSON.stringify` 安全转义后写入生成文件——这是审查中两个独立视角都抓到的注入风险点，务必确认转义逻辑而不是只看结果。
  [`release-configs.yml:41`](../../.github/workflows/release-configs.yml#L41)

- 交叉编译四个平台目标，单一 runner 不用 OS matrix。
  [`release-configs.yml:56`](../../.github/workflows/release-configs.yml#L56)

- 发布前实跑一次编译产物验证注入的版本号，而不是只信任构建过程。
  [`release-configs.yml:71`](../../.github/workflows/release-configs.yml#L71)

- checksum 格式与实际发布命令，`--clobber` 让重跑可恢复。
  [`release-configs.yml:84`](../../.github/workflows/release-configs.yml#L84)

**CLI：`--version` 接入**

- 早于 `parseCommand`/`openDeps` 拦截，不建库、不触发领域逻辑。
  [`index.ts:367`](../../packages/control-plane/src/cli/index.ts#L367)

- 版本常量占位——提交态永远是 `'dev'`，只被发布 job 临时覆写。
  [`version.ts:9`](../../packages/control-plane/src/cli/version.ts#L9)

**外围：依赖与测试**

- 新增 `react-devtools-core` devDependency，修复 `bun build --compile` 打包 `ink` 时的动态 import 解析失败。
  [`package.json`](../../packages/control-plane/package.json)

- `--version` 测试：不建库 + 输出精确等于字面量 `'dev'`（而不是循环比较同一个常量）。
  [`version.test.ts:39`](../../packages/control-plane/tests/cli/version.test.ts#L39)
