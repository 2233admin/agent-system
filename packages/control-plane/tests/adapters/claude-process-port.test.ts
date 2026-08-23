import { describe, expect, test } from 'bun:test';

import { BunClaudeProcessPort, type ClaudeSpawnedProcess } from '../../src/adapters/clients/claude/process-port';

/**
 * A fake `ClaudeSpawnedProcess` for deterministic tests of
 * `BunClaudeProcessPort`'s error-handling branches (non-zero exit,
 * unparsable output, thrown spawn errors, timeout) -- these must not
 * depend on a real `claude` binary being installed, since CI does not
 * guarantee one (verification-gap finding from this Story's own review).
 */
function fakeProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  neverExits?: boolean;
}): ClaudeSpawnedProcess & { killed: boolean } {
  const state = { killed: false };
  // Mirrors real process semantics: `exited` only settles once the process
  // is gone. For `neverExits`, it hangs until `kill()` is called -- exactly
  // like a real hung/interactive child only terminating once actually
  // killed -- rather than a promise that would hang forever even after
  // `kill()`, which would make the timeout guard itself untestable.
  let resolveExited: ((exitCode: number) => void) | null = null;
  const exited: Promise<number> =
    opts.neverExits === true
      ? new Promise<number>((resolve) => {
          resolveExited = resolve;
        })
      : Promise.resolve(opts.exitCode ?? 0);

  return {
    stdout: opts.stdout ?? '',
    stderr: opts.stderr ?? '',
    exited,
    kill(): void {
      state.killed = true;
      resolveExited?.(-1);
    },
    get killed() {
      return state.killed;
    },
  };
}

describe('BunClaudeProcessPort', () => {
  const binaryPresent = Bun.which('claude') !== null;

  test('detectVersion is a real, one-time probe honest about binary absence', async () => {
    const port = new BunClaudeProcessPort();
    const result = await port.detectVersion();

    if (binaryPresent) {
      // Real install: must be a recognized `<version> (Claude Code)` output
      // parsed into a bare version string -- never hardcoded, never assumed.
      expect(result.kind).toBe('known');
      if (result.kind === 'known') {
        expect(result.value.length).toBeGreaterThan(0);
      }
    } else {
      expect(result.kind).toBe('unknown');
      if (result.kind === 'unknown') {
        expect(result.reason).toBe('claude-binary-not-found');
      }
    }
  });

  test('captureHelpText returns the real --help output when the binary is present, honest Unknown otherwise', async () => {
    const port = new BunClaudeProcessPort();
    const result = await port.captureHelpText([]);

    if (binaryPresent) {
      expect(result.kind).toBe('known');
      if (result.kind === 'known') {
        expect(result.value).toContain('Usage: claude');
      }
    } else {
      expect(result.kind).toBe('unknown');
      if (result.kind === 'unknown') {
        expect(result.reason).toBe('claude-binary-not-found');
      }
    }
  });

  test('captureHelpText also works for subcommands (e.g. "mcp add")', async () => {
    const port = new BunClaudeProcessPort();
    const result = await port.captureHelpText(['mcp', 'add']);

    if (binaryPresent) {
      expect(result.kind).toBe('known');
      if (result.kind === 'known') {
        expect(result.value).toContain('--scope');
      }
    } else {
      expect(result.kind).toBe('unknown');
    }
  });
});

describe('BunClaudeProcessPort (fake-spawn-driven error branches)', () => {
  test('detectVersion: non-zero exit code resolves to Unknown, not thrown', async () => {
    const port = new BunClaudeProcessPort(
      () => fakeProcess({ stdout: '', exitCode: 1 }),
      () => '/fake/claude',
    );
    const result = await port.detectVersion();
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toContain('exited with code 1');
    }
  });

  test('detectVersion: unparsable output resolves to Unknown describing the raw text', async () => {
    const port = new BunClaudeProcessPort(
      () => fakeProcess({ stdout: 'garbage output', exitCode: 0 }),
      () => '/fake/claude',
    );
    const result = await port.detectVersion();
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toContain('unrecognized claude --version output');
    }
  });

  test('detectVersion: a thrown spawn error resolves to Unknown, never propagates', async () => {
    const port = new BunClaudeProcessPort(
      () => {
        throw new Error('ENOENT: spawn failed');
      },
      () => '/fake/claude',
    );
    const result = await port.detectVersion();
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toContain('ENOENT: spawn failed');
    }
  });

  test('detectVersion: a thrown non-Error spawn failure is still stringified, never "undefined"', async () => {
    const port = new BunClaudeProcessPort(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'plain string failure';
      },
      () => '/fake/claude',
    );
    const result = await port.detectVersion();
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toContain('plain string failure');
      expect(result.reason).not.toContain('undefined');
    }
  });

  test('detectVersion: a hung child is killed and resolved to Unknown after the timeout, not hung forever', async () => {
    const hungProcess = fakeProcess({ neverExits: true });
    const port = new BunClaudeProcessPort(() => hungProcess, () => '/fake/claude', 20);
    const result = await port.detectVersion();
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toContain('timed out');
    }
    expect(hungProcess.killed).toBe(true);
  });

  test('captureHelpText: empty output resolves to Unknown rather than a blank Known value', async () => {
    const port = new BunClaudeProcessPort(
      () => fakeProcess({ stdout: '', exitCode: 0 }),
      () => '/fake/claude',
    );
    const result = await port.captureHelpText([]);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toContain('empty claude');
    }
  });

  test('captureHelpText: stderr is drained concurrently and never blocks resolution', async () => {
    const port = new BunClaudeProcessPort(
      () => fakeProcess({ stdout: 'Usage: claude [options]', stderr: 'x'.repeat(10_000), exitCode: 0 }),
      () => '/fake/claude',
    );
    const result = await port.captureHelpText([]);
    expect(result.kind).toBe('known');
  });
});
