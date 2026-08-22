# 下层实现分歧攻击

## 结论

**PASS。** 未发现两个实现单元逐字遵守 AD-1~AD-19 仍能对同一事实产生不兼容结果的剩余路径。

## 已关闭攻击面

- AD-8/AD-19 将 `observationStage` 与 `validationMethod` 分成独立证据轴。
- capability 固定 `capabilityId`、required/optional、封闭 subject、capabilityStatus、effect 与 evidenceRef。
- isolation 固定版本化 SourceId 集合，每个来源恰好返回 excluded/residual/unknown。
- bridge request/response/event 固定 operation/snapshot/manifest/invocation/request/event 关联及幂等导入。
- receipt/envelope 文件只是不可信传输输入；SQLite 条件插入是唯一产品事实。
- native Session lease 固定 ownerOperationId、单调 fencingToken、持有期与可证明回收门。

复核日期：2026-08-22。