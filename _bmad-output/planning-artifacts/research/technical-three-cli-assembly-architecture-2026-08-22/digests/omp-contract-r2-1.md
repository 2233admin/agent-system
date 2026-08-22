# OMP 配置、Resume 与薄扩展边界（R2.1）

## Answer

OMP 当前官方源码支持在启动前选择 profile/config root，但本轮未证实一个通用、临时的 `--config` overlay/merge API。配置发现是有序查找，部分文件取第一个存在项；profile、`PI_CONFIG_DIR` 与默认 profile 下的 `PI_CODING_AGENT_DIR` 会改变配置根。完整 root 同时影响 auth 和 Session，因此隔离 root 不会无成本继承既有认证或 Session。

纯外部 adapter 足以完成：选择 cwd/profile/root、生成启动期 Skills/MCP/system prompt 配置、fresh launch 和显式 continue/resume。只有需要同步观察/阻止工具调用、修改 provider/context、注入消息、操作 Session tree 或原生 UI 时才增加薄 TypeScript extension。

## Claims

| Claim | Source | Publisher | Date | Accessed | Confidence | Class |
| --- | --- | --- | --- | --- | --- | --- |
| OMP `main` 的根 `package.json` 在复核时声明 `packageManager: bun@1.4.0`、catalog OMP packages `18.0.0`；移动分支值只证明访问时快照，不是待支持 release。CLI 入口仍为 TS/Bun。 | https://github.com/can1357/oh-my-pi/blob/main/package.json | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | High for accessed snapshot; Low for release compatibility | fact/current-source |
| 用户与项目配置目录按优先级返回；非 JSON 文件查找返回第一个存在项，不是通用 deep merge。 | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/config.ts | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | High | fact/current-source |
| OMP profile 在其他主要模块导入前解析；也接受 `OMP_PROFILE`/`PI_PROFILE`。 | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/cli.ts | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | High | fact/current-source |
| 环境加载顺序为 process、project cwd、active agent、active config root、home，且只填未设置键。 | https://github.com/can1357/oh-my-pi/blob/main/docs/environment-variables.md | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | High | fact/current-doc |
| OMP extension 提供 session/agent/tool/provider/context 生命周期事件和运行期修改能力。 | https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md | can1357/oh-my-pi | unknown (`main`) | 2026-08-22 | High | fact/current-doc |
| 外部 adapter 足够静态启动装配；进程内精确观察/干预才需要 extension。 | 上述来源 | 本研究推论 | 2026-08-22 | 2026-08-22 | High | inference/architecture |

## Contradiction

首轮成本摘要依据 `docs/settings.md` 把 `--config` 描述为可重复 overlay；本轮从当前 CLI 入口与配置源码未找到对应通用 flag，且配置文件查找显示 selection 语义。最终报告必须把 `--config` 能力降级为 disputed/未证实，不以它作为推荐前提。

## Not Found

- 当前 release-pinned 的通用 `--config` overlay 合同；
- OMP extension API 长期兼容承诺；
- 隔离 root 同时无缝复用既有 auth/session 的官方保证。

**Stop reason:** coverage；已回答静态装配、隔离 root、resume 和 extension 触发边界。