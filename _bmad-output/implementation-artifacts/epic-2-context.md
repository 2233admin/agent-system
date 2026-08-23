# Epic 2 Context: 控制面发布与自更新

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

`configs`（外部 Agent System CLI）以 Bun 编译的独立可执行文件分平台发布。进程每次启动时都会在后台静默检查一个固定的发布端点是否有新版本；若存在，则校验其完整性并原地替换本地二进制文件。这条检查/下载/校验链路中任何一步失败都会静默降级——绝不能因此阻塞或使当次启动失败——检查过程也绝不上报任何遥测、使用数据或产品状态。这补上了一个真实缺口：参照客户端（`omp`）已具备完全相同的自更新行为，负责人明确要求 `configs` 具备同等能力。

## Stories

- **Story 2.1 — 打包与发布流水线**（`spec-2-1-打包与发布流水线.md`，done）：分平台的 Bun `--compile` 发布流水线，发布到本仓库的 GitHub Releases，包含 Story 2.2 依赖的 `SHA256SUMS.txt` 完整性清单。
- **Story 2.2 — 自更新客户端**（`spec-2-2-自更新客户端.md`，done）：即上文描述的启动时静默更新客户端——固定端点检查、哈希校验、保留 `.bak` 的原地替换、失败静默降级。该 story 是直接从一份全新 spec 起草并构建的（未经过 `bmad-create-epics-and-stories`），因此其 sprint-status 条目需要手动补录；具体过程说明见 `deferred-work.md`。

## Requirements & Constraints

- 自更新是对本项目"日常激活绝不允许安装依赖、更改插件或联网更新"这一通用规则的一个窄范围、明确授权的例外。该例外**仅**覆盖 `configs` 自身的二进制文件，不延伸到 OMP 或薄 OMP 扩展。
- OMP 自身的版本升级仍是一个独立的、低频的、显式操作,门槛是 capability probe、adapter fixtures 以及更新兼容性快照前的 fresh→locator→explicit-resume smoke 测试。自更新不得触碰或影响该路径。
- 更新检查必须对单一固定的、带版本号的发布端点使用只读 GET 请求——绝不能是用户可控或运行时派生的 URL。
- 下载的资产必须先通过完整性校验（签名或已知哈希）才允许替换本地二进制。
- 替换前必须以可恢复的形式（例如 `.bak` 文件）保留旧二进制，以便坏更新可以回滚。Windows 需要"先重命名旧文件、再写入新文件"的策略，因为正在运行的可执行文件不能被直接覆盖（这正是参照客户端 `omp` 已采用的模式，`omp.exe` 旁的 `.bak` 文件即为证据）。
- 检查、下载、校验任一环节失败都必须静默降级为"本次继续使用当前版本启动"——绝不能阻塞或使当次激活失败。
- 更新流程不得采集或上报任何遥测、使用数据或产品状态。
- 这是整个产品中唯一允许日常激活产生联网副作用的地方。
- 本 Epic 的测试覆盖必须包含固定端点合同、完整性校验强制执行、失败静默降级行为，以及零遥测——与本项目"每项声明能力都必须绑定可验证证据"的整体验证立场保持一致。

## Technical Decisions

- **固定发布端点（已定案，负责人决定，规划文档尚未同步反映）：** 端点就是本仓库自身的 GitHub Releases（`github.com/zaurakworks/agent-system`）。
- `configs` 继续以 Bun `--compile` 独立产物分平台发布——这是既有的 AD-15 分发规则，本 Epic 不做改动。
- 薄 OMP 扩展的分发渠道（Marketplace、Git 或本地 link）及其"必须与 CLI 协议版本显式兼容"的要求不受本 Epic 影响；自更新只作用于 `configs` 自身的二进制文件。
- 整体系统范式是以外部 CLI 为唯一组合根的六边形模块化单体；任何自更新组件都应遵循既有约定——adapter（这里指更新/进程/文件系统 adapter）不做产品决定，副作用与领域核心隔离。
- 本 Epic 不引入 daemon、后台服务、队列或通用 IPC 总线——检查是在进程启动时内联发生的一次性动作,不经由常驻进程。

## Cross-Story Dependencies

- 独立于 Epic 1（查看、选择并使用 OMP 配置）——Epic 1 已完成，且与分发/更新机制无关；未发现共享代码或先后顺序依赖。
- 本 Epic 启动之初,其所需的 CI/CD 能力（发布 release 二进制并托管发布端点的流水线）是全新的；Story 2.1 已搭建 `.github/workflows/release-configs.yml`，把分平台二进制和 `SHA256SUMS.txt` 发布到本仓库的 GitHub Releases，Story 2.2 的更新客户端将其作为固定端点消费。
