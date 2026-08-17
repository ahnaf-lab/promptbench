import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createNavState,
  moveSelection,
  selectFirst,
  selectLast,
  selectedId,
  reduceKey,
  NavError,
} from '../src/nav.js';

const RANKED = [{ id: 'terse', total: 0.9 }, { id: 'baseline', total: 0.7 }, { id: 'formal', total: 0.5 }];

test('createNavState starts at row 0 by default', () => {
  const state = createNavState(RANKED);
  assert.equal(state.selectedIndex, 0);
  assert.equal(selectedId(state), 'terse');
});

test('createNavState clamps an out-of-range starting index', () => {
  assert.equal(createNavState(RANKED, { selectedIndex: 99 }).selectedIndex, 2);
  assert.equal(createNavState(RANKED, { selectedIndex: -5 }).selectedIndex, 0);
});

test('createNavState rejects an empty ranked array', () => {
  assert.throws(() => createNavState([]), NavError);
});

test('moveSelection steps down and up, clamped at the ends', () => {
  let state = createNavState(RANKED);
  state = moveSelection(state, 1);
  assert.equal(selectedId(state), 'baseline');
  state = moveSelection(state, 1);
  assert.equal(selectedId(state), 'formal');
  state = moveSelection(state, 1); // already at the bottom row
  assert.equal(selectedId(state), 'formal');
  state = moveSelection(state, -10); // clamp back to the top
  assert.equal(selectedId(state), 'terse');
});

test('moveSelection rejects a non-integer delta', () => {
  assert.throws(() => moveSelection(createNavState(RANKED), 0.5), NavError);
});

test('selectFirst and selectLast jump directly to the ends', () => {
  const state = moveSelection(createNavState(RANKED), 1);
  assert.equal(selectedId(selectFirst(state)), 'terse');
  assert.equal(selectedId(selectLast(state)), 'formal');
});

test('reduceKey maps up/down/top/bottom to the matching transitions', () => {
  let state = createNavState(RANKED);
  state = reduceKey(state, 'down');
  assert.equal(selectedId(state), 'baseline');
  state = reduceKey(state, 'bottom');
  assert.equal(selectedId(state), 'formal');
  state = reduceKey(state, 'up');
  assert.equal(selectedId(state), 'baseline');
  state = reduceKey(state, 'top');
  assert.equal(selectedId(state), 'terse');
});

test('reduceKey leaves state unchanged for unrecognised keys', () => {
  const state = createNavState(RANKED);
  const next = reduceKey(state, 'quit');
  assert.equal(next, state);
});
