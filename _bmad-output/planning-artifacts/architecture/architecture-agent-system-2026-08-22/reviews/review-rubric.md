---
lens: rubric-walker
target: ARCHITECTURE-SPINE.md (architecture-agent-system-2026-08-22)
pass: 2026-08-24 (AD-21 content materialization; AD-20 self-session amendment; `.cap/` 退役顺序 3-step rewrite)
---

# Rubric Walk — Architecture Spine (2026-08-24 pass)

**Verdict: PASS with notes.**

The spine's own text (AD-21, the AD-20 2026-08-24 amendment, and the 3-step `.cap/` retirement rewrite) is internally coherent, enforceable, and verified-accurate against the actual `packages/control-plane/src/` code on every spot-check performed. The material problem found is not in the spine's prose itself but in its propagation: the downstream `epics.md` — the very "level below" this checklist asks the spine to protect — was left contradicting the rewritten retirement order in several places, which is exactly the kind of two-units-diverge risk this review exists to catch.

## Critical Findings

1. **`epics.md` Epic 4 narrative still describes the retired four-step `.cap/` retirement order and old story-to-step mapping, contradicting both the spine's rewritten 3-step order and `epics.md`'s own updated Story sections in the same file.**
   - `epics.md:261` ("实现与交互约束"): "`.cap/` 退役必须按 Architecture Spine"`.cap/` 退役顺序"小节的**四步**严格顺序执行（Story 4.1～4.2 对应"落地新 adapter"，4.3～4.4 对应验证 fresh/already-running 两条 target 路径，**4.5 对应"parity 验证 + 本仓自身切换"，4.6 对应"退役 `.cap/` 本体"**）" — this is the exact old mapping the spine's 2026-08-24 rewrite deleted (spine now has 3 steps; Story 4.5's AC2 "本仓自身切换" is void; the CLI-entry story is now **4.6**, not part of "退役"; retirement itself is now **4.7**).
   - `epics.md:257`: "...最终按固定**四步**顺序取代现有 `.cap/`" — same staleness.
   - `epics.md:351` (Story 4.5b's "实现需求"): points at "退役顺序小节第 2、3 步" — under the *old* numbering step 3 was "本仓自身切换"; under the *new* numbering step 3 is "退役 `.cap/` 本体". Ambiguous/wrong either way for a reader relying on this line alone.
   - `epics.md:408` (Story 4.6/CLI-entry's "实现需求"): still says "退役顺序小节第 4 步（下一轮 `bmad-architecture` 需重写该小节的第 1～3 步...）" — written as if the rewrite hadn't happened yet, but this architecture pass (dated 2026-08-24, same day) already performed that rewrite. This line is now stale relative to the spine it references.
   - Impact: a Story 4.5/4.5b/4.6/4.7 implementer reading `epics.md` top-to-bottom gets **internally contradictory** guidance about how many retirement steps exist and which Story maps to which step — precisely the "divergence point for the level below" this rubric flags as unacceptable. The spine's own content is not at fault, but "fixes the real divergence points for the level below and misses none" fails here because the architecture edit's propagation into `epics.md` was incomplete (only the Section 4.1 diff block from the sprint-change-proposal was applied; these narrative paragraphs elsewhere in the same Epic were missed).
   - Recommended fix: a follow-up `epics.md` edit (via `bmad-create-epics-and-stories` or a narrow correct-course) to align lines 257/261/351/408 with the spine's 3-step order and the 4.5/4.5b/4.6/4.7 numbering already in force elsewhere in the same file.

## High Findings

1. **Retirement-order Step 3 misidentifies `v3-assembly-executor` as an "openspec change" to archive; it is actually a live capability spec.** Spine text: "移除 `.cap/` 目录，并收敛治理它的 openspec change（`v3-assembly-executor` 等）为归档状态。" Verified on disk: `openspec/specs/v3-assembly-executor/spec.md` exists under `openspec/specs/` (OpenSpec's "current adopted truth" location), not under `openspec/changes/` (there is no active or archived change by that name — `grep`/`ls` over `openspec/changes/` and `openspec/changes/archive/` found none). OpenSpec's convention doesn't "archive" a spec directly; specs are updated/retired via a new change that is itself later archived. As written, a Story 4.7 implementer following this instruction literally has no artifact matching "openspec change named v3-assembly-executor" to archive, and could either skip the step (leaving stale governance content pointing at `.cap/`) or take the wrong action against `openspec/specs/v3-assembly-executor/spec.md` directly, bypassing the propose→apply→archive workflow the rest of this repo's `openspec/` directory follows. Recommend correcting the reference to name the actual artifact (`openspec/specs/v3-assembly-executor/spec.md`) and the correct disposition action (retire/remove via a new openspec change, not "archive" in place).

## Medium / Low

2 medium, 0 low.

- **Medium:** AD-21's delivery mechanisms (`--plugin-dir`, `--append-system-prompt`, `--mcp-config`/`--strict-mcp-config`) are asserted by name but, unlike `--strict-mcp-config` (already probe-verified in `capability-probe.ts:198-221`), `--plugin-dir` and `--append-system-prompt` have no corresponding capability-probe verification anywhere in the current codebase yet. AD-15's own principle ("文档声称但 release-pinned CLI/help/source 或 smoke 未证实的能力保持 Unknown") should apply to these delivery flags too, but AD-21's Rule doesn't explicitly require Story 4.5b to extend the Story 4.1 probe pattern to verify these flags before trusting them as the content-delivery mechanism — it only covers `sourceRef` resolvability, not flag-existence. Worth one added sentence in AD-21 (or a cross-reference to AD-15) closing this gap explicitly rather than leaving it implicit.
- **Medium:** AD-21 `Binds: AD-6、AD-9、AD-19` implies the materialized-content files (rendered `--mcp-config` JSON, `--plugin-dir` directory contents, system-prompt file) inherit AD-9's same-directory atomic temp-file-replacement discipline, but the Rule text itself never states this explicitly for these specific artifacts (AD-9's Rule text names "manifest/plan/launch context", not materialized capability content). Low risk given the shared invocation-dir infrastructure, but an explicit sentence would remove ambiguity for Story 4.5b's implementer.

## Verification notes (spot-checks performed, all passed)

- `buildOmpArgv` in `packages/control-plane/src/adapters/omp/process-port.ts:39-66` confirmed to pass only `--skills <name1,name2>` (or `--no-skills`), matching AD-21's rationale claim about OMP's capability-name-only argv exactly.
- `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts`'s `CAPABILITY_ARGV_MAP` confirmed to currently emit exactly 3 hard-control flags (`--permission-mode manual`, `--strict-mcp-config`, `--setting-sources project`) and no content-delivery flags — matching the sprint-change-proposal's "3 硬控制 flag, no materialization" characterization that motivates AD-21.
- `computeClaudeKnownDifferences` in `packages/control-plane/src/application/claude-launch.ts:97-118` confirmed to mark instructions/skills/mcp (and hooks/plugins) content as `*-not-materialized-in-fresh-launch` for any non-empty reference list — matches the proposal's "any non-empty assembly intent recorded as unmaterialized" claim.
- `domain/client.ts:26-34`'s `resolveClientSupport` confirmed hardcoded `supported: false` for `'claude-code'` — matches the proposal's "no real CLI entry" claim that Story 4.6 exists to fix.
- `.cap/profiles/` confirmed to contain exactly `general.toml` and `agent-assembler.toml` — matches the retirement order's "最小覆盖集" claim.
- `hooks`/`plugins` CapabilityReference fields on `StableConfigRevision` (`domain/config.ts:79-80`) confirmed **deliberately excluded** from `ClaudeAssemblyManifest` per Story 4.2's own design note in `assembly-manifest.ts:24-25` ("Deliberately no `hooks`/`plugins` reference fields") — so AD-21's scoping to Instructions/Skills/MCP only is consistent with an already-adopted (pre-this-pass) boundary, not a newly introduced silent gap.
- No hardcoded version-number claims (e.g. `Bun 1.x`, `TypeScript 7.x`) remain anywhere in the spine text — consistent with the 2026-08-22 memlog decision to strip main-branch version snapshots in favor of release-pinned probe/smoke evidence; nothing stale to flag.
- AD-20's 2026-08-24 amendment confirmed to have actually removed the "this repo's own session" example from the Rule's `already-running` bullet itself (not just added a caveat) — the bullet now reads generically, and the clarification paragraph correctly explains the removal without contradicting the unchanged `requires-restart` rule.
