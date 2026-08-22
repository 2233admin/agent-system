/**
 * `[DELTA]` Interactive TUI entry point (EXPERIENCE.md IA third layer,
 * DESIGN.md's `[DELTA]` components). Two screens -- `list`/`detail` --
 * built with `ink`. Reuses the exact same underlying operations as the
 * pure-text CLI path (`listConfigRevisions`, `prepareLaunchPlan`,
 * `confirmLaunchPlan`, `launchOmp`, `getLaunchStatus`) so the domain state
 * machine and its invariants are never bypassed or reimplemented here.
 *
 * `TuiApp` is a presentational component only -- it never talks to a
 * repository or spawns anything itself. It reports the user's decision
 * ("launch this revision" / "quit") via callback props, which keeps it
 * directly testable with `ink-testing-library` (Code Map:
 * `tests/cli/tui.test.tsx`). All of the imperative work -- opening
 * dependencies, entering/exiting the alt-screen, driving
 * `prepareLaunchPlan`/`confirmLaunchPlan`/`launchOmp`, and printing the
 * handoff line/final status -- lives in `runTui()`.
 *
 * Selection state (`inverse`/`color` props) is left entirely to `ink`
 * (itself built on `chalk`), which already does its own `NO_COLOR`/TTY
 * capability detection -- `colors.ts` is not reused inside the TUI screens
 * themselves (Design Notes).
 */

import React, { useState } from 'react';
import { Box, render, Text, useInput } from 'ink';

import type { StableConfigRevision } from '../domain/config';
import { computeKnownDifferences, confirmLaunchPlan, getLaunchStatus, launchOmp, prepareLaunchPlan, type LaunchDeps } from '../application/launch';
import { listConfigRevisions } from '../application/queries';
import { defaultExtensionPath } from '../adapters/omp/process-port';
import { t } from './i18n';
import { formatAvailability, formatDefaultMarker, renderDetail, renderHandoffLine, renderLaunchFailure, renderLaunchStatus } from './render';
import { openDeps, type CliOverrides, type FullDeps } from './index';

const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

function enterAltScreen(): void {
  process.stdout.write(ALT_SCREEN_ENTER);
}

function exitAltScreen(): void {
  process.stdout.write(ALT_SCREEN_EXIT);
}

type TuiScreen = { readonly kind: 'list'; readonly selectedIndex: number } | { readonly kind: 'detail'; readonly selectedIndex: number };

export interface TuiAppProps {
  readonly revisions: readonly StableConfigRevision[];
  readonly knownDifferencesByRevision: ReadonlyMap<string, readonly string[]>;
  readonly onLaunch: (revision: StableConfigRevision) => void;
  readonly onQuit: () => void;
}

/**
 * Presentational two-screen TUI. `Enter` reports the currently selected
 * revision via `onLaunch` from *either* screen (list or detail) --
 * "selected即启动", no y/N prompt and no confirmation-summary screen
 * (EXPERIENCE.md "TUI 自动确认"). `q` reports `onQuit` from either screen
 * without ever having called `onLaunch` -- no `LaunchPlan` is created on
 * that path.
 */
export function TuiApp({ revisions, knownDifferencesByRevision, onLaunch, onQuit }: TuiAppProps): React.JSX.Element {
  const [screen, setScreen] = useState<TuiScreen>({ kind: 'list', selectedIndex: 0 });

  useInput((input, key) => {
    // Ctrl+C is treated identically to `q` -- both go through `onQuit()`
    // so the caller's cleanup (exit alt-screen, close deps) always runs.
    // `render()` is mounted with `exitOnCtrlC: false` precisely so ink
    // never short-circuits that path itself (see `runTuiScreen`). Ink
    // parses the raw `\x03` byte into `input === 'c'` + `key.ctrl`, not a
    // literal `'\x03'` string (`parse-keypress.js`'s "ctrl+letter" branch).
    if (input === 'q' || (input === 'c' && key.ctrl)) {
      onQuit();
      return;
    }

    if (screen.kind === 'list') {
      if (key.upArrow) {
        setScreen((prev) => ({ kind: 'list', selectedIndex: Math.max(0, prev.selectedIndex - 1) }));
        return;
      }
      if (key.downArrow) {
        setScreen((prev) => ({ kind: 'list', selectedIndex: Math.max(0, Math.min(revisions.length - 1, prev.selectedIndex + 1)) }));
        return;
      }
      if (key.return) {
        const revision = revisions[screen.selectedIndex];
        if (revision !== undefined) {
          onLaunch(revision);
        }
        return;
      }
      if (key.rightArrow) {
        if (revisions.length > 0) {
          setScreen({ kind: 'detail', selectedIndex: screen.selectedIndex });
        }
        return;
      }
      return;
    }

    // screen.kind === 'detail'
    if (key.return) {
      const revision = revisions[screen.selectedIndex];
      if (revision !== undefined) {
        onLaunch(revision);
      }
      return;
    }
    if (key.escape) {
      setScreen({ kind: 'list', selectedIndex: screen.selectedIndex });
    }
  });

  if (revisions.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>{t('emptyList.line1')}</Text>
        <Text>{t('emptyList.line2')}</Text>
        <Text>{t('emptyList.line3')}</Text>
        <Text> </Text>
        <Text dimColor>{t('tui.listFooter')}</Text>
      </Box>
    );
  }

  if (screen.kind === 'list') {
    return (
      <Box flexDirection="column">
        {revisions.map((revision, index) => {
          const marker = formatDefaultMarker(revision);
          const availability = formatAvailability(revision);
          const hasKnownDifferences = (knownDifferencesByRevision.get(revision.revisionId) ?? []).length > 0;
          const label = `${revision.configName}  [${marker}]  ${t('list.statusLabel')}=${availability}`;
          return (
            <Text key={revision.revisionId} inverse={index === screen.selectedIndex}>
              {label}
              {hasKnownDifferences ? <Text color="yellow"> {t('tui.knownDifferencesMarker')}</Text> : null}
            </Text>
          );
        })}
        <Text> </Text>
        <Text dimColor>{t('tui.listFooter')}</Text>
      </Box>
    );
  }

  const revision = revisions[screen.selectedIndex]!;
  const diffs = knownDifferencesByRevision.get(revision.revisionId) ?? [];
  return (
    <Box flexDirection="column">
      {renderDetail(revision)
        .split('\n')
        .map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key -- static content, index-stable within a single render
          <Text key={index}>{line}</Text>
        ))}
      {diffs.length > 0 ? (
        <Box flexDirection="column">
          <Text> </Text>
          <Text color="yellow">{t('confirmation.knownDifferencesTitle')}</Text>
          {diffs.map((reason) => (
            <Text key={reason}>{`  - ${reason}`}</Text>
          ))}
        </Box>
      ) : null}
      <Text> </Text>
      <Text dimColor>{t('tui.detailFooter')}</Text>
    </Box>
  );
}

export type TuiDecision = { readonly kind: 'launch'; readonly revision: StableConfigRevision } | { readonly kind: 'quit' };

/**
 * Mounts `TuiApp` inside the alt-screen and resolves once the user either
 * selects a revision to launch or quits -- never re-entered afterwards
 * (the ink instance is unmounted before this resolves).
 */
function runTuiScreen(revisions: readonly StableConfigRevision[], knownDifferencesByRevision: ReadonlyMap<string, readonly string[]>): Promise<TuiDecision> {
  return new Promise((resolve) => {
    const instance = render(
      <TuiApp
        revisions={revisions}
        knownDifferencesByRevision={knownDifferencesByRevision}
        onLaunch={(revision) => {
          instance.unmount();
          resolve({ kind: 'launch', revision });
        }}
        onQuit={() => {
          instance.unmount();
          resolve({ kind: 'quit' });
        }}
      />,
      // Ink's default `exitOnCtrlC` unmounts and calls `process.exit()`
      // directly on Ctrl+C, bypassing `exitAltScreen()`/dependency
      // cleanup in `runTui()`. Disabling it here routes Ctrl+C through
      // `TuiApp`'s own `useInput` handler (which calls `onQuit()`) instead
      // -- the same cleanup path as a normal `q` quit.
      { exitOnCtrlC: false },
    );
  });
}

/**
 * Drives the same auto-confirm path `--yes` uses on the pure-text CLI:
 * `prepareLaunchPlan` then immediately `confirmLaunchPlan` -- no y/N
 * prompt, no confirmation-summary screen, but the exact same
 * `prepared -> awaiting-confirmation -> applying` domain transitions
 * (EXPERIENCE.md "TUI 自动确认"). Returns the plan wherever it lands --
 * still `awaiting-confirmation` never happens as a *returned* result here
 * since it is immediately confirmed; a plan that failed to prepare comes
 * back in `failed` instead.
 */
export async function runAutoConfirmLaunch(deps: LaunchDeps, revisionId: string): Promise<import('../domain/activation').LaunchPlan> {
  const prepared = await prepareLaunchPlan(deps, { revisionId, client: 'omp' });
  if (prepared.phase !== 'awaiting-confirmation') {
    return prepared;
  }
  return confirmLaunchPlan(deps, prepared.planId);
}

/**
 * Injectable seams for testing `runTuiWithDeps()`'s own orchestration
 * (alt-screen ordering, cleanup-on-throw, handoff-line placement, etc.)
 * without mounting a real `ink` app or opening real SQLite repositories.
 * All three default to the real implementations -- `runTui()`'s
 * production call site never passes any of these.
 */
export interface RunTuiHooks {
  readonly pickDecision?: (
    revisions: readonly StableConfigRevision[],
    knownDifferencesByRevision: ReadonlyMap<string, readonly string[]>,
  ) => Promise<TuiDecision>;
  readonly enterAltScreen?: () => void;
  readonly exitAltScreen?: () => void;
}

/**
 * Everything `runTui()` does once dependencies are already open: lists
 * revisions, mounts the two-screen TUI, and on a launch decision drives
 * the same confirm/launch/observe path as `configs use --yes`. The
 * alt-screen is always exited before anything is printed as plain text
 * (handoff line, failure block, final status) -- DESIGN.md
 * `{components.handoff-line}` and Interaction Primitives "终端交接" --
 * and `deps`' repositories are always closed exactly once, regardless of
 * which branch returns or throws.
 *
 * Split out from `runTui()` (which just calls `openDeps()` then this) so
 * tests can drive the orchestration directly against fake/in-memory
 * `FullDeps` and injected `RunTuiHooks`, without a real terminal or SQLite
 * file (`tests/cli/tui.test.tsx`).
 */
export async function runTuiWithDeps(deps: FullDeps, hooks: RunTuiHooks = {}): Promise<number> {
  const pickDecision = hooks.pickDecision ?? runTuiScreen;
  const doEnterAltScreen = hooks.enterAltScreen ?? enterAltScreen;
  const doExitAltScreen = hooks.exitAltScreen ?? exitAltScreen;

  // A single outer `finally` closes both repositories exactly once,
  // regardless of which branch below returns or throws -- no branch
  // closes them itself anymore, which previously risked either a leaked
  // handle (if an exception unwound past an inner branch's manual close)
  // or a double-close (if two branches' close calls could both run).
  try {
    let revisions: readonly StableConfigRevision[];
    try {
      revisions = await listConfigRevisions(deps.configRepository);
    } catch (error) {
      console.error(t('unexpectedFailure', { message: (error as Error).message }));
      return 1;
    }

    const knownDifferencesByRevision = new Map<string, readonly string[]>(revisions.map((revision) => [revision.revisionId, computeKnownDifferences(revision)]));

    // `exitAltScreen()` must run even if `pickDecision()` throws --
    // otherwise a crash mid-TUI would leave the user's real terminal
    // stuck showing the alt-screen buffer.
    let decision: TuiDecision;
    doEnterAltScreen();
    try {
      decision = await pickDecision(revisions, knownDifferencesByRevision);
    } finally {
      doExitAltScreen();
    }

    if (decision.kind === 'quit') {
      return 0;
    }

    const plan = await runAutoConfirmLaunch(deps, decision.revision.revisionId);
    if (plan.phase !== 'applying') {
      // `prepareLaunchPlan` carried the plan straight to `failed` (e.g. the
      // revision vanished between the list rendering and this point) --
      // render it exactly like the pure-text CLI's own failure path.
      console.log(renderLaunchFailure(plan));
      return 1;
    }

    console.log(renderHandoffLine());
    const finalPlan = await launchOmp(deps, {
      planId: plan.planId,
      extensionPath: defaultExtensionPath(),
      forwardedArgs: [],
      cwd: process.cwd(),
    });

    if (finalPlan.phase === 'succeeded' || finalPlan.phase === 'degraded') {
      const status = await getLaunchStatus(deps, finalPlan.planId);
      console.log(renderLaunchStatus(status));
      return 0;
    }

    console.log(renderLaunchFailure(finalPlan));
    return 1;
  } finally {
    deps.configRepository.close();
    deps.launchPlanRepository.close();
  }
}

/**
 * Full TUI entry point: opens dependencies, then delegates the rest of
 * the orchestration to `runTuiWithDeps()`.
 */
export async function runTui(overrides: CliOverrides): Promise<number> {
  const deps = await openDeps(overrides);
  if (deps === null) {
    return 1;
  }
  return runTuiWithDeps(deps);
}
