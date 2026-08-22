# 当前技术事实审查

## 结论

**PASS。** 架构中的技术选择均有本轮官方来源或明确标记为架构推论；不再依赖 OMP `--config` overlay。

## 已关闭 finding

OMP `main` 是移动分支：复核时根 `package.json` 已为 `packageManager: bun@1.4.0`、catalog packages `18.0.0`，早先 17.4.4/1.3.14 快照已过时。架构已删除具体 `main` 版本种子；首个支持版本只能由 release-pinned capability probe 与 `fresh → locator → explicit resume` smoke 生成。`.memlog.md` 以 overturned/correction 追加记录，未静默改写历史。

Bun standalone、TypeScript/OMP 同语言边界、Go 第一反转条件、Claude/Codex profile/resume/hooks 仅用于未来边界研究，均未被写成 MVP 当前支持。

复核日期：2026-08-22。