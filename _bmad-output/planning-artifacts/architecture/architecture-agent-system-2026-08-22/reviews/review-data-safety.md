# 数据与失败安全审查

## 结论

**PASS。** 凭据/私域内容、invocation 工件、wrapper/OMP kill、SQLite 恢复和同 Session 并发的阻断问题均已封闭。

## 已关闭 findings

- 持久 Adapter Plan 只含环境键、secret/content 引用与 hash；实际值只进入调用期 RuntimeLaunchSpec。
- manifest/plan/launch context 使用受限目录、原子替换、operation/schema/hash 校验；不匹配只产生 incomplete/Unknown。
- bridge envelope 使用显式 allowlist，拒绝 prompt、消息、工具参数/结果、原始错误与 transcript；终态/恢复后清理。
- receipt/envelope 由应用 command 关联、验 hash、幂等导入 SQLite；文件存在不改变 Outcome。
- native Session lease 持有至进程树被证明结束；失联且无法证明停止时 locator 保持 blocked，只能 fresh/fork。
- kill、secret 泄漏、工件损坏、envelope 重放和 fencing lease 已进入验证边界。

复核日期：2026-08-22。