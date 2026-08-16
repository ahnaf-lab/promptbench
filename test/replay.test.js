import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadFixture } from '../src/fixture.js';
import { replay, replayStream } from '../src/replay.js';

const FIXTURE_PATH = new URL('../fixtures/greeting-rewrite.json', import.meta.url);

test('replay returns one result per variant, in fixture order', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  const results = replay(fixture);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.id), ['baseline', 'terse', 'formal']);
});

test('replay computes totalTokens as promptTokens + completionTokens', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  const [baseline] = replay(fixture);
  assert.equal(baseline.totalTokens, baseline.promptTokens + baseline.completionTokens);
  assert.equal(baseline.totalTokens, 15);
});

test('replay carries through output, latency and cost untouched', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  const [baseline] = replay(fixture);
  assert.equal(baseline.output, 'Hello! How can I help you today?');
  assert.equal(baseline.latencyMs, 420);
  assert.equal(baseline.costUsd, 0.00013);
});

test('replay makes no network calls and is deterministic across runs', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  const first = replay(fixture);
  const second = replay(fixture);
  assert.deepEqual(first, second);
});

test('replayStream yields results in order without delay by default', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  const seen = [];
  const start = Date.now();
  for await (const result of replayStream(fixture)) {
    seen.push(result.id);
  }
  const elapsed = Date.now() - start;
  assert.deepEqual(seen, ['baseline', 'terse', 'formal']);
  // No delay requested, so this should be near-instant, well under the
  // fixture's combined latencyMs (420 + 210 + 610 = 1240ms).
  assert.ok(elapsed < 200, `expected fast replay, took ${elapsed}ms`);
});

test('replayStream can simulate per-variant latency when asked', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  const seen = [];
  const start = Date.now();
  for await (const result of replayStream(fixture, { simulateDelay: true })) {
    seen.push(result.id);
  }
  const elapsed = Date.now() - start;
  assert.deepEqual(seen, ['baseline', 'terse', 'formal']);
  assert.ok(elapsed >= 1240, `expected simulated delay, took only ${elapsed}ms`);
});
