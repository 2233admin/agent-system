# Agent System MVP 术语合同

本文件定义 SPEC 使用的规范术语。实现细节由 adopted `ARCHITECTURE-SPINE.md` 约束。

| 术语 | 规范定义 |
| --- | --- |
| Agent System 控制面 | 外部 TypeScript/Bun CLI；负责配置裁决、装配计划、一次确认、客户端启动/恢复、状态持久化、查询与导出，是唯一产品组合根。 |
| 客户端 adapter | 实现 `probe → plan → launch/resume → interpret` 的窄边界；只把公共装配意图编译为某客户端的 argv/env/files 并解释回执，不拥有产品决定。 |
| OMP 薄桥 | 运行在 OMP 内的 TypeScript extension；只转发低频请求和版本化运行观察，不连接产品 SQLite、不复制领域规则。 |
| Assembly Manifest | 一次 launch-scoped 激活的客户端中立输入；包含 client、project root、配置修订、Instructions/Skills/MCP 引用、capability policy、isolation intent 与可选 resume selector，不包含客户端原生配置结构。 |
| Adapter Plan | adapter 对 manifest 的可持久确定性编译结果；包含客户端实际版本、capabilityStatus、argv 结构、环境键、secret/content 引用与 hash、generated-file metadata、SourceId disposition 和预期 observation；不含 secret 值或生成文件原文。 |
| RuntimeLaunchSpec | 由 Adapter Plan 在调用作用域内解析出的实际环境值与文件内容；只存在于受限内存或调用期临时文件，不进入产品数据库、投影、receipt 或诊断。 |
| Launch Receipt | 客户端启动/恢复后的证据回执；包含 `effect = applied | ignored | unknown`、`observationStage`、opaque native Session locator、退出状态与 allowlist 诊断。 |
| Capability 状态 | `supported | degraded | unsupported | unknown` 的封闭集合；以稳定 capabilityId、required/optional 与事实 subject 为主体，不得用布尔值压平。 |
| 运行装配阶段 | `observationStage = planned | launched | observed | verified` 的封闭集合；参数生成、进程启动、直接观察和合同验证逐级区分，退出码为零不等于 verified。 |
| 验证方法 | `validationMethod = mechanical | controlled-integration | real-task` 的封闭集合；与运行装配阶段是独立证据轴。 |
| 隔离结果 | Assembly Manifest 以版本化 SourceId 集合声明所需隔离；plan/receipt 对每个 SourceId 恰好返回 `excluded | residual | unknown`、作用域与 evidenceRef，未声明新来源必须追加 unknown。 |
| Opaque native Session locator | 由客户端定义、按客户端 namespaced 的恢复定位符；产品可关联和原样传回客户端，但不得解析为跨客户端 Session 模型或复制 transcript。 |
| ChangeAssessment | prepare 时持久化的输入变化裁决；逐项比较目标、约束、权限、风险和必需能力，只能允许继续原修订或要求低频重判。 |
| ValidationDecision | 达到最小样本门后追加的不可变负责人裁决；绑定配置修订、样本组与证据，结果为接受、调整、停止或针对一个具名 Unknown 追加一次采样。 |
| 源资产 | 可被稳定配置引用的 Instructions、Skills 或 MCP；资产原始内容由其来源拥有。 |
| 稳定配置 | 面向一类可重复工作的版本化期望装配，记录适用工作、必要源资产、有限变体、边界和结构化任务输入入口；不包含动态任务内容。 |
| 有限变体 | 同一稳定配置中预先命名、适用条件明确且数量受限的装配差异；不是每次任务临时重新选择。 |
| 结构化任务输入入口 | 指向任务期权威载体的类型化引用，包含来源、访问状态、内容指纹或新鲜度证据；不复制载体原文。 |
| 声明输入 | 本次任务明确提供或引用的输入集合；其内容、权限和生命周期仍由原始载体拥有。 |
| 期望装配 | 稳定配置修订声明本次应存在、启用、连接或加载的能力与上下文。它不证明客户端最终状态。 |
| 最终结果 | 激活操作实际返回或持久化的结果，包括成功、显式降级、失败、不完整或需要重启；不能由期望装配推断。 |
| 运行观察 | 从客户端生命周期、工具调用、Session 状态或其他已资格化观察面取得的直接运行事实；只追加证据，不反写期望状态。 |
| 差异 | 两个有来源事实之间的类型化比较，至少区分缺失、额外、禁用、覆盖、预算或限制裁剪，并记录受影响能力。 |
| Unknown | 当前没有足够直接证据判断的事实；必须记录原因和观察时间，不能用 `null`、缺行或 `false` 代替。 |
| 事实 | 可回读来源直接支持的陈述。 |
| 推论 | 由事实推导但来源没有直接声明的结论；必须保持为推论。 |
| 决定 | 经当前合同或负责人明确裁决、会约束后续行为的选择；被替代时追加替代关系，不静默改写。 |
| 证据 | 支撑事实、判断或验收的可回读记录，包含来源、作用域和采集时间。 |
| 静态/机械验证 | 不依赖真实任务结果即可重复执行的结构、引用、类型、schema、可加载性和一致性检查。 |
| 受控集成验证 | 在受控 OMP 环境中验证装配、激活、观察、失败和恢复边界，不外推为真实任务有效。 |
| 真实任务观察 | 在合同规定的真实任务与验收口径下取得的直接结果和干预记录。 |
| 必要 | 移除该能力或上下文会失去验收条件或必需证据。 |
| 充分 | 没有已知尚未满足的验收条件；Unknown 不能被当作满足。 |
| 不过载 | 每项能力和上下文均可追溯到目标、约束、验收或证据，不存在无关装配。 |
| Verified | 对同一配置修订、能力集合、任务验收和环境作用域，三层直接证据均通过必要、充分、不过载判断且没有阻断性 Unknown 的派生结论。 |
| 样本 | 固定任务类型、验收口径、声明输入、配置修订、客户端环境和证据口径的一次可比较执行记录。 |
| Bad Case | 已有配置或规则在具名边界内失败、漂移或过载的证据包；必须引用差异/失败证据并提出有界变化。 |
| 跨 Session 续接 | 新原生 Session 或显式 resume 后读取产品持久事实、决定、证据和 Unknown；不继承旧 operation 的确认、授权或动态任务状态。客户端仍拥有原生 Session 与 transcript。 |
