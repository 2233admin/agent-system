import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { BunClaudeCapabilityProbe } from '../../src/adapters/clients/claude/capability-probe';
import { BunClaudeProcessPort } from '../../src/adapters/clients/claude/process-port';

/**
 * `[Story 4.1 AC2]` Reads `.cap/runtime/claude.toml` for comparison only --
 * never written to. This file is the repo's own already-verified evidence
 * (Claude Code 2.1.236 on Windows); this test checks the probe's
 * independently-observed capability set against it, and makes any
 * difference explicit rather than silently dropping it, per AC2.
 */
interface CapClaudeRuntimeToml {
  readonly version: number;
  readonly client: string;
  readonly policy: {
    readonly login_mode: string;
    readonly permission_mode: string;
    readonly enable_project_mcp: boolean;
    readonly enable_user_assets: boolean;
    readonly auto_memory: boolean;
  };
}

const CAP_RUNTIME_CLAUDE_TOML_PATH = path.join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  '.cap',
  'runtime',
  'claude.toml',
);

/** The version `.cap/runtime/claude.toml`'s header comment says was verified. */
const CAP_VERIFIED_CLAUDE_VERSION = '2.1.236';

/**
 * Type-guards the parsed TOML shape field by field instead of a bare `as`
 * cast, so a renamed/missing field fails with a clear assertion message
 * here rather than an opaque `TypeError` deep inside the test body below.
 */
function isCapClaudeRuntimeToml(value: unknown): value is CapClaudeRuntimeToml {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.client !== 'string') {
    return false;
  }
  const policy = record.policy;
  if (typeof policy !== 'object' || policy === null) {
    return false;
  }
  const policyRecord = policy as Record<string, unknown>;
  return (
    typeof policyRecord.permission_mode === 'string' &&
    typeof policyRecord.enable_project_mcp === 'boolean' &&
    typeof policyRecord.enable_user_assets === 'boolean'
  );
}

describe('Claude Code adapter probe vs .cap/runtime/claude.toml (AC2)', () => {
  test('probe capability set is consistent with .cap already-verified fields, or the difference is recorded rather than dropped', async () => {
    let rawText: string;
    try {
      rawText = await Bun.file(CAP_RUNTIME_CLAUDE_TOML_PATH).text();
    } catch (error) {
      throw new Error(
        `AC2 parity check requires .cap/runtime/claude.toml as comparison evidence, but it could not be read ` +
          `at ${CAP_RUNTIME_CLAUDE_TOML_PATH}: ${(error as Error).message}. This is the repo's own already-` +
          'verified evidence file (read-only) -- if it was intentionally moved/removed, this test needs updating, ' +
          'not silently skipping.',
      );
    }
    const parsedUnknown: unknown = Bun.TOML.parse(rawText);
    if (!isCapClaudeRuntimeToml(parsedUnknown)) {
      throw new Error(
        '.cap/runtime/claude.toml no longer has the shape this Story\'s AC2 comparison expects ' +
          '(client: string, policy.permission_mode: string, policy.enable_project_mcp: boolean, ' +
          'policy.enable_user_assets: boolean) -- update this test\'s expectations deliberately, not by ignoring the mismatch.',
      );
    }
    const parsed = parsedUnknown;

    // Sanity: this is really the file this Story is required to compare
    // against, and it really does declare the three fields AC2 names.
    expect(parsed.client).toBe('claude');
    expect(typeof parsed.policy.permission_mode).toBe('string');
    expect(typeof parsed.policy.enable_project_mcp).toBe('boolean');
    expect(typeof parsed.policy.enable_user_assets).toBe('boolean');
    expect(rawText).toContain(CAP_VERIFIED_CLAUDE_VERSION);

    const processPort = new BunClaudeProcessPort();
    const probe = new BunClaudeCapabilityProbe(processPort);
    const [results, versionFact] = await Promise.all([
      probe.probeHardControlCapabilities(),
      processPort.detectVersion(),
    ]);

    const permissionMode = results.find((r) => r.capabilityId === 'claude.permission-mode-control');
    const mcpScope = results.find((r) => r.capabilityId === 'claude.mcp-project-scope-control');
    const settingSources = results.find((r) => r.capabilityId === 'claude.setting-sources-control');
    if (permissionMode === undefined || mcpScope === undefined || settingSources === undefined) {
      throw new Error('probe did not return the three capabilities AC2 compares against .cap');
    }

    const binaryPresent = Bun.which('claude') !== null;
    if (!binaryPresent) {
      // Honest Unknown when the bridge itself is unavailable in this
      // environment -- never silently assume parity with .cap.
      expect(permissionMode.status).toBe('unknown');
      expect(mcpScope.status).toBe('unknown');
      expect(settingSources.status).toBe('unknown');
      return;
    }

    // `.cap` treats these three fields as legitimate, already-verified
    // hard-control knobs. The probe must independently confirm the native
    // mechanism each one depends on still exists -- `unsupported` here
    // would be a real, load-bearing regression against `.cap`'s evidence,
    // not something this test may silently wave through.
    expect(['supported', 'degraded']).toContain(permissionMode.status);
    expect(['supported', 'degraded']).toContain(mcpScope.status);
    expect(['supported', 'degraded']).toContain(settingSources.status);

    // Known, recorded inconsistency (not silently dropped, per AC2): `.cap`
    // was last verified against Claude Code 2.1.236; this repo's real
    // installed binary has since moved on. This does not fail the build --
    // reconciling it is Story 4.5's one-time parity verification -- but it
    // must never pass unnoticed.
    if (versionFact.kind === 'known' && versionFact.value !== CAP_VERIFIED_CLAUDE_VERSION) {
      console.warn(
        `[Story 4.1 AC2] known inconsistency: real "claude --version" is ${versionFact.value}, ` +
          `but .cap/runtime/claude.toml was last verified against ${CAP_VERIFIED_CLAUDE_VERSION}. ` +
          'Recorded here, not blocking this Story; reconciliation is Story 4.5 (.cap parity verification) scope.',
      );
    } else if (versionFact.kind === 'unknown') {
      // The binary is reachable (we are past the `!binaryPresent` early
      // return above) yet its own version could not be determined -- e.g.
      // an unrecognized `--version` output format. This is itself a
      // version-comparison gap and must be recorded, not silently skipped
      // just because it took the "unknown" branch instead of "known".
      console.warn(
        `[Story 4.1 AC2] known inconsistency: real "claude --version" could not be determined ` +
          `(${versionFact.reason}), so it cannot be compared against .cap/runtime/claude.toml's verified ` +
          `${CAP_VERIFIED_CLAUDE_VERSION} baseline. Recorded here, not blocking this Story.`,
      );
    }
  });
});
