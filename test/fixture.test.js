import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadFixture, validateFixture, FixtureValidationError } from '../src/fixture.js';

const FIXTURE_PATH = new URL('../fixtures/greeting-rewrite.json', import.meta.url);

test('loadFixture reads and validates the shipped sample fixture', async () => {
  const fixture = await loadFixture(FIXTURE_PATH);
  assert.equal(fixture.name, 'greeting-rewrite');
  assert.equal(fixture.variants.length, 3);
  assert.equal(fixture.variants[0].id, 'baseline');
});

test('validateFixture rejects a non-object fixture', () => {
  assert.throws(() => validateFixture('not an object'), FixtureValidationError);
  assert.throws(() => validateFixture(null), FixtureValidationError);
  assert.throws(() => validateFixture([]), FixtureValidationError);
});

test('validateFixture rejects a fixture with no variants', () => {
  assert.throws(() => validateFixture({ name: 'empty', variants: [] }), FixtureValidationError);
});

test('validateFixture rejects a variant missing a required field', () => {
  const bad = {
    name: 'broken',
    variants: [
      {
        id: 'a',
        prompt: 'hi',
        output: 'hello',
        promptTokens: 1,
        completionTokens: 1,
        latencyMs: 1,
        // costUsd missing
      },
    ],
  };
  assert.throws(() => validateFixture(bad), FixtureValidationError);
});

test('validateFixture rejects negative token counts and latency', () => {
  const negTokens = {
    name: 'broken',
    variants: [
      {
        id: 'a',
        prompt: 'hi',
        output: 'hello',
        promptTokens: -1,
        completionTokens: 1,
        latencyMs: 1,
        costUsd: 0,
      },
    ],
  };
  assert.throws(() => validateFixture(negTokens), FixtureValidationError);
});

test('validateFixture rejects duplicate variant ids', () => {
  const dup = {
    name: 'broken',
    variants: [
      { id: 'a', prompt: 'p', output: 'o', promptTokens: 1, completionTokens: 1, latencyMs: 1, costUsd: 0 },
      { id: 'a', prompt: 'p2', output: 'o2', promptTokens: 1, completionTokens: 1, latencyMs: 1, costUsd: 0 },
    ],
  };
  assert.throws(() => validateFixture(dup), FixtureValidationError);
});

test('loadFixture rejects a missing file', async () => {
  await assert.rejects(() => loadFixture('/nonexistent/path/does-not-exist.json'), FixtureValidationError);
});

test('loadFixture rejects malformed JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'promptbench-'));
  const badPath = path.join(dir, 'bad.json');
  await writeFile(badPath, '{ not valid json', 'utf8');
  try {
    await assert.rejects(() => loadFixture(badPath), FixtureValidationError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
