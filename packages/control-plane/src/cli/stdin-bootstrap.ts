/**
 * Bun standalone Windows builds can drop console keystrokes unless stdin has
 * a readable listener before Ink and its stream adapters initialize. Keep this
 * listener for the process lifetime; the TUI bridge owns the temporary data
 * listener and raw-mode lifecycle later.
 */
if (process.platform === 'win32' && process.stdin.isTTY === true) {
  process.stdin.on('readable', () => {});
}
