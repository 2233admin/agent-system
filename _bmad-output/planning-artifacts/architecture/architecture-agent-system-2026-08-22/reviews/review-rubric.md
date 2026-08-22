# 架构脊柱规则审查

## 结论

**PASS。** 外部 TypeScript/Bun 控制面、OMP-first adapter/薄桥、SQLite 产品权威、状态所有权、运行/部署/升级、失败安全和验证边界均已形成可执行合同。

## 已关闭 findings

- AD-16 持久化 `new-scenario | known-insufficiency | bad-case` 触发类别及工作/证据引用；单纯发现不得触发。
- AD-7 增加 ChangeAssessment，固定目标、约束、权限、风险、必需能力五维比较与继续/重判裁决。
- AD-17 增加不可变 ValidationDecision，并固定样本退出门。
- bridge envelope 的接收、关联、去重和入库路径由 AD-9/AD-14 封闭。
- bridge/invocation 工件纳入 AD-6 allowlist 与隐私测试。
- 样本只按配置无关可比键分组；配置/manifest/Session 是被比较变量。可重复任务要求等价输入，一次性任务允许独立实例但要求相同输入分类/结构与验收映射。

复核日期：2026-08-22。