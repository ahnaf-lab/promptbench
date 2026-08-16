import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadFixture } from '../src/fixture.js';
import { replay } from '../src/replay.js';
import {
  keywordScorer,
  lengthRatioScorer,
  costScorer,
  scoreVariants,
  rankVariants,
  ScoringError,
} from '../src/scoring.js';

const FIXTURE_PATH = new URL('../fixtures/greeting-rewrite.json', import.meta.url);

async function getResults() {
  const fixture = await loadFixture(FIXTURE_PATH);
  return replay(fixture);
}

// --- keywordScorer -----------------------------------------------------

test('keywordScorer scores the fraction of keywords found, case-insensitively', async () => {
  const results = await getResults();
  const scorer = keywordScorer(['hello', 'HELP']);
  const [baseline] = results; // "Hello! How can I help you today?"
  assert.equal(scorer.score(baseline), 1);

  const terse = results.find((r) => r.id === 'terse'); // "Hi there!"
  assert.equal(scorer.score(terse), 0);
});

test('keywordScorer respects caseSensitive option', async () => {
  const results = await getResults();
  const scorer = keywordScorer(['HELLO'], { caseSensitive: true });
  const [baseline] = results; // contains "Hello", not "HELLO"
  assert.equal(scorer.score(baseline), 0);
});

test('keywordScorer with no keywords scores everything 1', async () => {
  const results = await getResults();
  const scorer = keywordScorer([]);
  for (const result of results) {
    assert.equal(scorer.score(result), 1);
  }
});

test('keywordScorer rejects a non-array keywords argument', () => {
  assert.throws(() => keywordScorer('hello'), ScoringError);
});

// --- lengthRatioScorer ---------------------------------------------------

test('lengthRatioScorer scores an exact length match as 1', async () => {
  const results = await getResults();
  const terse = results.find((r) => r.id === 'terse'); // "Hi there!" = 9 chars
  const scorer = lengthRatioScorer({ targetLength: 9 });
  assert.equal(scorer.score(terse), 1);
});

test('lengthRatioScorer penalises deviation from target length symmetrically', async () => {
  const results = await getResults();
  const terse = results.find((r) => r.id === 'terse'); // 9 chars
  // ratio = 9/6 = 1.5 (50% over) vs ratio = 9/18 = 0.5 (50% under) — same
  // absolute deviation from a ratio of 1, so the same score either way.
  const tooLong = lengthRatioScorer({ targetLength: 6 });
  const tooShort = lengthRatioScorer({ targetLength: 18 });
  assert.equal(tooLong.score(terse), tooShort.score(terse));
});

test('lengthRatioScorer supports word counting', async () => {
  const results = await getResults();
  const terse = results.find((r) => r.id === 'terse'); // "Hi there!" = 2 words
  const scorer = lengthRatioScorer({ targetLength: 2, unit: 'words' });
  assert.equal(scorer.score(terse), 1);
});

test('lengthRatioScorer with no target scores everything 1', async () => {
  const results = await getResults();
  const scorer = lengthRatioScorer();
  for (const result of results) {
    assert.equal(scorer.score(result), 1);
  }
});

test('lengthRatioScorer rejects an invalid unit', () => {
  assert.throws(() => lengthRatioScorer({ unit: 'lines' }), ScoringError);
});

// --- costScorer ------------------------------------------------------------

test('costScorer gives the cheapest variant in a batch the top score', async () => {
  const results = await getResults();
  const scorer = costScorer();
  const scores = results.map((r) => scorer.score(r, results));
  const cheapest = results.reduce((a, b) => (a.costUsd < b.costUsd ? a : b));
  const cheapestScore = scorer.score(cheapest, results);
  assert.equal(cheapestScore, Math.max(...scores));
});

test('costScorer scores the most expensive variant 0 when no ceiling is given', async () => {
  const results = await getResults();
  const scorer = costScorer();
  const priciest = results.reduce((a, b) => (a.costUsd > b.costUsd ? a : b));
  assert.equal(scorer.score(priciest, results), 0);
});

test('costScorer normalises against an explicit maxCostUsd instead of the batch max', async () => {
  const results = await getResults();
  const scorer = costScorer({ maxCostUsd: 1 });
  const [baseline] = results; // costUsd: 0.00013
  assert.equal(scorer.score(baseline, results), 1 - 0.00013 / 1);
});

test('costScorer rejects a negative maxCostUsd', () => {
  assert.throws(() => costScorer({ maxCostUsd: -1 }), ScoringError);
});

// --- scoreVariants / rankVariants ------------------------------------------

test('scoreVariants returns one scorecard per variant in fixture order', async () => {
  const results = await getResults();
  const scored = scoreVariants(results, [keywordScorer(['hello']), costScorer()]);
  assert.equal(scored.length, 3);
  assert.deepEqual(scored.map((s) => s.id), ['baseline', 'terse', 'formal']);
  for (const entry of scored) {
    assert.ok('keyword' in entry.scores);
    assert.ok('cost' in entry.scores);
    assert.ok(entry.total >= 0 && entry.total <= 1);
  }
});

test('scoreVariants computes total as the weighted mean of individual scores', async () => {
  const results = await getResults();
  const scored = scoreVariants(results, [
    { name: 'always-one', weight: 1, score: () => 1 },
    { name: 'always-zero', weight: 3, score: () => 0 },
  ]);
  // weighted mean: (1*1 + 0*3) / (1+3) = 0.25
  for (const entry of scored) {
    assert.equal(entry.total, 0.25);
  }
});

test('scoreVariants throws when a scorer returns a value outside [0, 1]', async () => {
  const results = await getResults();
  assert.throws(
    () => scoreVariants(results, [{ name: 'broken', score: () => 2 }]),
    ScoringError
  );
});

test('scoreVariants rejects an empty scorers array', async () => {
  const results = await getResults();
  assert.throws(() => scoreVariants(results, []), ScoringError);
});

test('rankVariants sorts best-first by total score', async () => {
  const results = await getResults();
  const ranked = rankVariants(results, [keywordScorer(['hello', 'help'])]);
  // "Hello! How can I help you today?" matches both keywords, others match none.
  assert.equal(ranked[0].id, 'baseline');
  assert.equal(ranked[0].total, 1);
  assert.ok(ranked[1].total <= ranked[0].total);
  assert.ok(ranked[2].total <= ranked[1].total);
});

test('rankVariants breaks ties by original fixture order', async () => {
  const results = await getResults();
  const ranked = rankVariants(results, [{ name: 'flat', score: () => 1 }]);
  assert.deepEqual(ranked.map((r) => r.id), ['baseline', 'terse', 'formal']);
});
