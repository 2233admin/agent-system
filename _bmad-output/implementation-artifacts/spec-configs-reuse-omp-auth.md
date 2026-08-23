---
title: '修复 configs 启动 OMP 的登录态复用'
type: 'bugfix'
created: '2026-08-23'
status: 'done'
route: 'plan-code-review'
baseline_commit: 'bbcb473d36c68ea3577296187ccf3a51bf3662b5'
context:
  - '{project-root}/_bmad-output/specs/spec-agent-system/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `configs use` 当前无条件向 OMP 传入按配置名生成的 `--profile`。OMP 的命名 profile 会切换 auth、session、settings 和 cache 根目录，因此 configs 启动的 OMP 与用户直接运行 `omp` 使用不同登录态，GPT OAuth 需要重新登录。

**Approach:** 让 configs 启动 OMP 使用默认 profile，与直接 `omp` 的认证和客户端状态来源一致；配置修订继续通过 skills、薄扩展和 launch context 表达，不再用 OMP profile 承担配置隔离。禁止用户通过不透明转发参数重新指定 profile。

## Boundaries & Constraints

**Always:** 直接传入 argv，不经 shell；继承用户现有 OMP 认证环境；不清空、改写、恢复或复制全局 OMP 文件；保留 `--no-extensions`、薄扩展、skills 和 launch context 行为；未知状态仍保持 Unknown。

**Ask First:** 若验证发现必须保留每配置独立 session/settings/cache 才能满足其他已确认合同，停止并报告，不自行引入 auth broker、HOME/XDG 重映射或凭据复制。

**Never:** 不创建 OMP 命名 profile；不复制或迁移 GPT 凭据；不持久化认证内容；不通过 `HOME`、`XDG_*`、`PI_*` 或 `OMP_*` 环境变量伪造登录态；不修改用户全局配置。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| configs 启动 | 有具体配置修订 | OMP argv 不包含 `--profile`，使用默认 profile；skills/扩展参数仍存在 | OMP 启动错误沿现有类型化失败路径返回 |
| 直接启动对齐 | 用户已在默认 `omp` profile 登录 GPT | configs 启动子进程继承同一认证/状态来源，不要求重新登录 | 认证本身失效由 OMP 原生界面处理 |
| 恶意/冲突转发 | `--profile`、resume 或 session-dir 出现在 `--` 后 | 启动前拒绝，不创建计划、不 spawn | 显示现有 denylist 类型化错误 |
| 多配置选择 | 配置名含空格、斜线或非 ASCII | 不再生成 profile 名，配置仍按 revision、skills、launch context 传递 | 不因配置名格式阻断启动 |

## Code Map

- `packages/control-plane/src/adapters/omp/process-port.ts:21-48` -- OMP argv 组合根；移除配置名 profile，保留扩展、skills 和透明参数。
- `packages/control-plane/src/adapters/omp/process-port.ts:50-103` -- 转发参数 denylist；保留对 profile/resume/session-dir 的阻断，避免用户覆盖默认状态策略。
- `packages/control-plane/src/cli/index.ts:156-166` -- 启动前参数校验注释与错误路径，保持拒绝发生在数据库和 spawn 之前。
- `packages/control-plane/src/cli/i18n.ts:106-108,207-209` -- 中英文错误文案，反映默认 profile 合同。
- `packages/control-plane/tests/adapters/process-port.test.ts:36-40` -- 回归断言 configs 不选择命名 profile；其余 argv 安全断言必须继续通过。
- 只读证据：OMP 18.0.3 `--help` 声明 `--profile` 用于 isolated profile；官方 `packages/utils/src/dirs.ts` 将命名 profile 解析到 `~/.omp/profiles/<name>`，并将 auth/session/settings/cache 路径切换到该根目录。

## Tasks & Acceptance

**Execution:**
- [x] `packages/control-plane/src/adapters/omp/process-port.ts` -- 使用默认 OMP profile 组装 argv -- 复用直接 `omp` 登录态。
- [x] `packages/control-plane/tests/adapters/process-port.test.ts` -- 更新 profile 回归断言 -- 防止 named profile 回归。
- [x] `packages/control-plane/src/cli/index.ts` -- 更新隔离策略注释 -- 保持 denylist 语义可读。
- [x] `packages/control-plane/src/cli/i18n.ts` -- 更新 profile 错误文案 -- 对外说明默认 profile 约束。

**Acceptance Criteria:**
- Given 配置修订，当 `configs use` 组装 OMP argv 时，then argv 不包含 `--profile` 且保留配置声明的 skills/扩展参数。
- Given 用户已在直接 `omp` 默认 profile 登录 GPT，当 configs 启动 OMP 时，then 不要求重新登录且子进程继续继承现有环境。
- Given 转发参数包含 profile/resume/session-dir，当启动前解析时，then 返回类型化拒绝且不 spawn OMP。
- Given 配置名含非 ASCII 或路径字符，当启动时，then 不因 profile 名生成或碰撞逻辑失败。

## Verification

**Commands:**
- `bun test packages/control-plane/tests/adapters/process-port.test.ts packages/control-plane/tests/omp/real-omp-smoke.test.ts` -- expected: all relevant tests pass and real OMP `--help` accepts the argv.
- `bun run --cwd packages/control-plane typecheck` -- expected: no TypeScript errors.

**Manual checks (if no CLI):**
- Inspect the captured argv/environment for a configs launch: no `--profile` or auth-root override; only `AGENT_SYSTEM_LAUNCH_CONTEXT` is added to inherited environment.

</frozen-after-approval>

## Supersession Note

This fix intentionally supersedes the earlier Story 1.2 implementation note that used an OMP named profile for per-configuration auth/session/settings/cache isolation. The user-facing contract is now default-profile reuse so `configs` and direct `omp` share the authenticated client state; the earlier artifact remains historical evidence and is not an active launch rule.

## Suggested Review Order

**默认认证路径**

- 移除配置名 profile，让 configs 与直接 omp 共用默认认证状态。
  [`process-port.ts:30`](../../packages/control-plane/src/adapters/omp/process-port.ts#L30)

- 保留扩展与技能装配，同时阻止不透明参数切换 profile。
  [`process-port.ts:52`](../../packages/control-plane/src/adapters/omp/process-port.ts#L52)

**启动边界**

- 在 spawn 前拒绝会改变默认 profile 或恢复语义的转发参数。
  [`index.ts:156`](../../packages/control-plane/src/cli/index.ts#L156)

- 对外错误文案明确默认 profile 合同，保持中英文键一致。
  [`i18n.ts:106`](../../packages/control-plane/src/cli/i18n.ts#L106)

**回归证据**

- 覆盖普通与带薄扩展的 argv，防止 `--profile=value` 形式回归。
  [`process-port.test.ts:36`](../../packages/control-plane/tests/adapters/process-port.test.ts#L36)

- 用真实 OMP `--help` 验证移除 profile 后的启动参数仍可解析。
  [`real-omp-smoke.test.ts:18`](../../packages/control-plane/tests/omp/real-omp-smoke.test.ts#L18)
