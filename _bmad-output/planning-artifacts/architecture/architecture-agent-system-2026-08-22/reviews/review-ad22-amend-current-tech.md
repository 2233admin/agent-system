# Reviewer: current-tech —— AD-22 修订（2026-08-25，#173 两项裁定）

**Verdict: PASS with findings**（1 项 medium）

| 修订引入的技术断言 | 核实方式 | 结论 |
| --- | --- | --- |
| npm 包 `bmad-method` 当前版本为 `6.11.0` | `npm view bmad-method version` 实测返回 `6.11.0` | 已核实（本轮实测） |
| 该版本与 `_bmad/_config/manifest.yaml` 的 `installation.version` 一致 | 读文件比对 | 已核实 |
| `files-manifest.csv` 记录 263 个文件、每条带 sha256 | 读文件；`wc -l` = 264（含表头） | 已核实 |
| **sha256 覆盖 49 个 skill 本体** | 交叉比对：`skill-manifest.csv` 的 49 条 `path` 与 `files-manifest.csv` 的 `path` 集合求交，**49/49 命中** | 已核实（这是"完整性可校验"成立的关键，本轮专门验过） |
| `_bmad/` 下 254 个 canonical 本体缺失 | `du -sh _bmad` = 150K；`ls _bmad/core/` 只有三项 | 已核实 |
| `.claude/skills`／`.agents/skills` 是项目级原生发现路径 | 直接观察（本 session 的 Skill 列表） | 已核实 |

## F1 [medium] `source: built-in` 的含义属推断，不是核实

修订写「两个 module 均 `source: built-in`（打包在该包内，无需另抓）」。前半句是读文件所得，后半句「打包在该包内、无需另抓」是**对该字段含义的推断**——依据只是同一条记录里 `npmPackage: null`、`repoUrl: null`。我没有运行安装器，也没有查看 `bmad-method` 包的内容来确认 module 本体确实随包分发。

这条恰好是可复现性论证的最后一环：若 `built-in` 实际意味着别的东西（例如由安装器在运行时另行获取），则"pin 可复现"的结论要打折。

**处置：** autofix —— 改为如实标注推断来源，并把"运行一次安装器确认 canonical 真能复现"列进第 (1) 步已有的待核实项（该步本来就要恢复 canonical，顺带即可证实）。
