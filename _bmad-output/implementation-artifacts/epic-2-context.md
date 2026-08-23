# Epic 2 Context: 控制面发布与自更新

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

`configs` (the external Agent System CLI) is distributed as a Bun-compiled standalone executable, published per platform. On every process start, it silently checks a fixed release endpoint in the background for a newer version; if one exists, it verifies its integrity and replaces the local binary in place. Any failure in this check/download/verify path degrades silently — the current launch must never be blocked or failed because of it — and no telemetry, usage data, or product state is ever transmitted as part of the check. This closes a real gap: the reference client (`omp`) already ships this exact self-update behavior, and the repo owner explicitly requested parity for `configs`.

## Stories

- **Story 2.1 — 打包与发布流水线** (`spec-2-1-打包与发布流水线.md`, done): per-platform Bun `--compile` release pipeline and publishing to this repo's GitHub Releases, including the `SHA256SUMS.txt` integrity manifest Story 2.2 depends on.
- **Story 2.2 — 自更新客户端** (`spec-2-2-自更新客户端.md`, done): the silent-update-on-launch client described above — fixed-endpoint check, hash verification, `.bak`-preserving in-place replacement, silent degrade-on-failure. Drafted and built directly from a fresh spec (not through `bmad-create-epics-and-stories`), so its sprint-status entry had to be added by hand; see `deferred-work.md` for that process note.

## Requirements & Constraints

- Self-update is a narrowly-scoped, explicitly authorized exception to the project's general rule that ordinary activation must never install dependencies, change plugins, or update over the network. The exception covers **only** `configs`' own binary; it does not extend to OMP or to the thin OMP extension.
- OMP's own version upgrades remain a separate, low-frequency, explicit operation gated by capability probe, adapter fixtures, and fresh→locator→explicit-resume smoke tests before the compatibility snapshot is updated. Self-update must not touch or influence that path.
- The update check must use a read-only GET against one fixed, versioned release endpoint — never a user-controlled or runtime-derived URL.
- Downloaded artifacts must pass integrity verification (signature or known hash) before the local binary may be replaced.
- The previous binary must be preserved in a recoverable form (e.g. a `.bak` file) before replacement, so a bad update can be rolled back. Windows requires a rename-old-then-write-new strategy since a running exe cannot be overwritten directly (this is the pattern the reference client `omp` already uses, evidenced by `.bak` files next to `omp.exe`).
- Any failure at any step (check, download, verification) must degrade silently to "continue this launch on the current version" — it must never block or fail the current activation.
- The update process must not collect or transmit any telemetry, usage data, or product state.
- This is the only place in the whole product where ordinary activation is allowed to perform a network side effect.
- Test coverage for this epic must include the fixed-endpoint contract, integrity-verification enforcement, silent-degradation-on-failure behavior, and zero-telemetry — consistent with the project's broader validation posture of binding every claimed capability to verifiable evidence.

## Technical Decisions

- **Fixed release endpoint (settled, repo-owner decision, not yet reflected in planning docs):** the endpoint is this repository's own GitHub Releases (`github.com/zaurakworks/agent-system`).
- `configs` continues to be published as a Bun `--compile` standalone artifact, one per platform — this is the existing AD-15 distribution rule, unchanged by this epic.
- The thin OMP extension's distribution channel (Marketplace, Git, or local link) and its requirement to stay explicitly compatible with the CLI's protocol version are unaffected by this epic; self-update applies only to the `configs` binary itself.
- Overall system paradigm is a hexagonal modular monolith with the external CLI as the sole composition root; any self-update component should follow the existing convention that adapters (here: an update/process/filesystem adapter) don't make product decisions and that side effects stay isolated from the domain core.
- No daemon, background service, queue, or general-purpose IPC bus is introduced by this epic — the check happens inline at process start, not via a persistent process.

## Cross-Story Dependencies

- Independent of Epic 1 (查看、选择并使用 OMP 配置) — Epic 1 is already done and unrelated to distribution/update mechanics; no shared code or sequencing dependency is known.
- This epic's CI/CD needs (a pipeline that publishes release binaries and hosts the release endpoint) were net-new when this epic started; Story 2.1 stood up `.github/workflows/release-configs.yml`, publishing per-platform binaries and `SHA256SUMS.txt` to this repo's GitHub Releases, which Story 2.2's update client consumes as its fixed endpoint.
