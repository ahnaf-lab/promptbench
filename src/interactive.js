// Interactive keyboard navigation.
//
// Wires real key presses to the pure nav.js reducer and re-renders the
// combined leaderboard + detail pane (render.js) on every change. Kept
// deliberately thin: everything that decides *what* the next state is lives
// in nav.js, and is unit tested with no terminal involved at all. This
// module only decodes keypresses and writes frames to a stream — no
// network calls, no shelling out, no dynamic code evaluation.

import * as readline from 'node:readline';

import { createNavState, reduceKey } from './nav.js';
import { renderInteractive } from './render.js';

const CLEAR_SCREEN = '\u001b[2J\u001b[H';

/**
 * Normalise a readline keypress into one of the names nav.js's reduceKey()
 * understands, or 'quit', or null for anything this UI ignores. A pure
 * function of the (str, key) pair readline hands to a 'keypress' listener,
 * so it is unit testable without a stream or a TTY.
 */
export function keyName(str, key) {
  if (!key) return null;
  if (key.ctrl && key.name === 'c') return 'quit';
  if (key.name === 'q' || key.name === 'escape') return 'quit';
  if (key.name === 'up' || key.name === 'k') return 'up';
  if (key.name === 'down' || key.name === 'j') return 'down';
  if (key.name === 'home' || str === 'g') return 'top';
  if (key.name === 'end' || str === 'G') return 'bottom';
  return null;
}

/**
 * Run the interactive leaderboard: renders one frame, then re-renders on
 * every navigation keypress, until the user quits (q / Esc / Ctrl+C) or the
 * input stream ends. Resolves when the session ends.
 *
 * `io.stdin`/`io.stdout` default to the real process streams but accept any
 * readable/writable stream readline can attach to — that's what makes this
 * testable with an in-memory stream instead of a real TTY.
 */
export function runInteractive(results, ranked, options = {}, io = {}) {
  const { stdin = process.stdin, stdout = process.stdout } = io;
  let state = createNavState(ranked);

  const render = () => {
    stdout.write(CLEAR_SCREEN + renderInteractive(results, ranked, state.selectedIndex, options) + '\n');
  };

  return new Promise((resolve) => {
    let finished = false;
    const wasRaw = stdin.isTTY ? stdin.isRaw : undefined;
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    readline.emitKeypressEvents(stdin);

    const finish = () => {
      if (finished) return;
      finished = true;
      stdin.removeListener('keypress', onKeypress);
      stdin.removeListener('end', finish);
      if (stdin.isTTY && wasRaw !== undefined && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(wasRaw);
      }
      if (typeof stdin.pause === 'function') stdin.pause();
      resolve();
    };

    const onKeypress = (str, key) => {
      const name = keyName(str, key);
      if (name === 'quit') {
        finish();
        return;
      }
      if (name) {
        const next = reduceKey(state, name);
        if (next !== state) {
          state = next;
          render();
        }
      }
    };

    stdin.on('keypress', onKeypress);
    stdin.on('end', finish);
    render();
  });
}
