import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { loadFixture } from '../src/fixture.js';
import { replay } from '../src/replay.js';
import { keywordScorer, lengthRatioScorer, costScorer, rankVariants } from '../src/scoring.js';
import { runInteractive, keyName } from '../src/interactive.js';

const FIXTURE_PATH = new URL('../fixtures/greeting-rewrite.json', import.meta.url);
const CLEAR_SCREEN = '\u001b[2J\u001b[H';

async function getRanked() {
  const fixture = await loadFixture(FIXTURE_PATH);
  const results = replay(fixture);
  const scorers = [keywordScorer(['hello']), lengthRatioScorer({ targetLength: 40 }), costScorer()];
  return { results, ranked: rankVariants(results, scorers) };
}

// --- keyName (pure) ------------------------------------------------------

test('keyName maps arrow keys and vim-style keys to navigation names', () => {
  assert.equal(keyName('', { name: 'up' }), 'up');
  assert.equal(keyName('k', { name: 'k' }), 'up');
  assert.equal(keyName('', { name: 'down' }), 'down');
  assert.equal(keyName('j', { name: 'j' }), 'down');
  assert.equal(keyName('g', { name: 'g' }), 'top');
  assert.equal(keyName('G', { name: 'G' }), 'bottom');
});

test('keyName maps q, escape and ctrl-c to quit', () => {
  assert.equal(keyName('q', { name: 'q' }), 'quit');
  assert.equal(keyName('', { name: 'escape' }), 'quit');
  assert.equal(keyName('', { name: 'c', ctrl: true }), 'quit');
});

test('keyName returns null for keys the UI does not handle, and for no key at all', () => {
  assert.equal(keyName('x', { name: 'x' }), null);
  assert.equal(keyName('', null), null);
});

// --- runInteractive (integration, over an in-memory stream) --------------

test('runInteractive renders an initial frame and resolves when the user quits', async () => {
  const { results, ranked } = await getRanked();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString();
  });

  const promise = runInteractive(results, ranked, { color: false }, { stdin, stdout });
  stdin.write('q');
  await promise;

  assert.ok(output.includes(CLEAR_SCREEN));
  assert.ok(output.includes(ranked[0].id));
});

test('runInteractive re-renders a new frame on a navigation keypress before quitting', async () => {
  const { results, ranked } = await getRanked();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString();
  });

  const promise = runInteractive(results, ranked, { color: false }, { stdin, stdout });
  stdin.write('j'); // down
  stdin.write('q');
  await promise;

  const frameCount = output.split(CLEAR_SCREEN).length - 1;
  assert.ok(frameCount >= 2, `expected at least 2 frames, got ${frameCount}`);
  assert.ok(output.includes(ranked[1].id));
});

test('runInteractive resolves when the input stream ends without an explicit quit', async () => {
  const { results, ranked } = await getRanked();
  const stdin = new PassThrough();
  const stdout = new PassThrough();

  const promise = runInteractive(results, ranked, { color: false }, { stdin, stdout });
  stdin.end();
  await promise;
});
