// Interactive navigation state.
//
// Pure reducer over a "which leaderboard row is selected" cursor. No I/O,
// no terminal handling — see interactive.js for the part that turns real
// key presses into calls here. Kept separate so the selection logic
// (clamping, jump-to-top/bottom, key mapping) is unit testable without a
// TTY, a stream, or a timer.

export class NavError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NavError';
  }
}

function clampIndex(index, length) {
  return Math.max(0, Math.min(length - 1, index));
}

/**
 * Create the initial navigation state for a ranked leaderboard (the
 * best-first array from rankVariants()). `state.selectedIndex` is an index
 * into `ranked` directly, so callers never need to re-resolve an id back to
 * a position.
 */
export function createNavState(ranked, { selectedIndex = 0 } = {}) {
  if (!Array.isArray(ranked) || ranked.length === 0) {
    throw new NavError('createNavState: ranked must be a non-empty array');
  }
  return {
    ids: ranked.map((entry) => entry.id),
    selectedIndex: clampIndex(selectedIndex, ranked.length),
  };
}

/**
 * Move the selection by `delta` rows, clamped to the first/last row — no
 * wraparound, so hitting the top or bottom just stops there.
 */
export function moveSelection(state, delta) {
  if (typeof delta !== 'number' || !Number.isInteger(delta)) {
    throw new NavError(`moveSelection: delta must be an integer, got ${delta}`);
  }
  return { ...state, selectedIndex: clampIndex(state.selectedIndex + delta, state.ids.length) };
}

/** Jump directly to the first row. */
export function selectFirst(state) {
  return { ...state, selectedIndex: 0 };
}

/** Jump directly to the last row. */
export function selectLast(state) {
  return { ...state, selectedIndex: state.ids.length - 1 };
}

/** The id of the row currently selected. */
export function selectedId(state) {
  return state.ids[state.selectedIndex];
}

/**
 * Translate a normalised key name (see interactive.js's keyName()) into the
 * next nav state. Keys this reducer doesn't recognise (including 'quit',
 * which the caller handles itself) return the same state unchanged.
 */
export function reduceKey(state, key) {
  switch (key) {
    case 'up':
      return moveSelection(state, -1);
    case 'down':
      return moveSelection(state, 1);
    case 'top':
      return selectFirst(state);
    case 'bottom':
      return selectLast(state);
    default:
      return state;
  }
}
