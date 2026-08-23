import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reportSelfUpdateResult } from '../../src/cli/index';

/**
 * `reportSelfUpdateResult` is the print-decision pulled out of the
 * `import.meta.main` block in `src/cli/index.ts` -- that block never runs
 * under `bun test` (see `tests/cli/version.test.ts`'s comment on `main()`
 * being called directly instead), so this is the only place these three
 * scenarios from the correct-course fix-up get direct coverage.
 */
describe('reportSelfUpdateResult', () => {
  let originalLang: string | undefined;
  let originalLog: typeof console.log;
  let logged: string[];

  beforeEach(() => {
    originalLang = process.env.CONFIGS_LANG;
    process.env.CONFIGS_LANG = 'en';
    originalLog = console.log;
    logged = [];
    console.log = (...args: unknown[]) => {
      logged.push(args.join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    if (originalLang === undefined) {
      delete process.env.CONFIGS_LANG;
    } else {
      process.env.CONFIGS_LANG = originalLang;
    }
  });

  test('non-"--version" subcommand with a new version: prints exactly one line with the version substituted in', () => {
    reportSelfUpdateResult('1.1.0', ['list']);

    expect(logged).toEqual(['configs: updated to v1.1.0 (takes effect next launch)']);
  });

  test('updatedVersion is null (no update happened): never prints, regardless of argv', () => {
    reportSelfUpdateResult(null, ['list']);
    reportSelfUpdateResult(null, []);
    reportSelfUpdateResult(null, ['--version']);

    expect(logged).toEqual([]);
  });

  test('argv[0] is "--version": suppresses the line even when an update did happen, so the single-bare-version-line contract stays intact', () => {
    reportSelfUpdateResult('1.1.0', ['--version']);

    expect(logged).toEqual([]);
  });

  test('a throwing console.log (e.g. EPIPE) is swallowed silently -- never propagates', () => {
    console.log = () => {
      throw new Error('EPIPE');
    };

    expect(() => reportSelfUpdateResult('1.1.0', ['list'])).not.toThrow();
  });
});
