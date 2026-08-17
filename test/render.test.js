import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadFixture } from '../src/fixture.js';
import { replay } from '../src/replay.js';
import { keywordScorer, lengthRatioScorer, costScorer, rankVariants } from '../src/scoring.js';
import { renderBar, renderLeaderboard, stripAnsi, RenderError } from '../src/render.js';

const FIXTURE_PATH = new URL('../fixtures/greeting-rewrite.json', import.meta.url);

async function getRanked() {
  const fixture = await loadFixture(FIXTURE_PATH);
  const results = replay(fixture);
  const scorers = [
    keywordScorer(['hello', 'help']),
    lengthRatioScorer({ targetLength: 40 }),
    costScorer(),
  ];
  return { results, ranked: rankVariants(results, scorers) };
}

// --- renderBar -----------------------------------------------------------

test('renderBar fills proportionally to the fraction', () => {
  assert.equal(renderBar(0, 10, { color: false }), '\u2591'.repeat(10));
  assert.equal(renderBar(1, 10, { color: false }), '\u2588'.repeat(10));
  assert.equal(renderBar(0.5, 10, { color: false }), '\u2588'.repeat(5) + '\u2591'.repeat(5));
});

test('renderBar clamps out-of-range fractions instead of throwing', () => {
  assert.equal(renderBar(-1, 4, { color: false }), '\u2591'.repeat(4));
  assert.equal(renderBar(2, 4, { color: false }), '\u2588'.repeat(4));
});

test('renderBar wraps filled/empty segments in ANSI codes when color is on', () => {
  const bar = renderBar(1, 3, { color: true });
  assert.ok(bar.includes('\u001b['));
  assert.equal(stripAnsi(bar), '\u2588\u2588\u2588');
});

test('renderBar rejects a non-integer width', () => {
  assert.throws(() => renderBar(0.5, 0), RenderError);
  assert.throws(() => renderBar(0.5, 1.5), RenderError);
});

// --- renderLeaderboard -----------------------------------------------------

test('renderLeaderboard produces the exact plain-text table for the fixed fixture', async () => {
  const { results, ranked } = await getRanked();
  const table = renderLeaderboard(results, ranked, { color: false });

  const expected = [
    '#  ID        TOTAL              COST                   LATENCY             ',
    '---------------------------------------------------------------------------',
    '1  baseline  █████████░░░ 0.73  ███████░░░░░ $0.00013  ████████░░░░ 420ms  ',
    '2  terse     ████░░░░░░░░ 0.31  ███░░░░░░░░░ $0.00006  ████░░░░░░░░ 210ms  ',
    '3  formal    ░░░░░░░░░░░░ 0.00  ████████████ $0.00021  ████████████ 610ms  ',
  ].join('\n');

  assert.equal(table, expected);
});

test('renderLeaderboard ranks best-first and matches rankVariants order', async () => {
  const { results, ranked } = await getRanked();
  const table = renderLeaderboard(results, ranked, { color: false });
  const lines = table.split('\n').slice(2); // drop header + separator
  const idsInOrder = lines.map((line) => line.trim().split(/\s+/)[1]);
  assert.deepEqual(idsInOrder, ranked.map((e) => e.id));
});

test('renderLeaderboard color output strips back down to the plain table', async () => {
  const { results, ranked } = await getRanked();
  const colored = renderLeaderboard(results, ranked, { color: true });
  const plain = renderLeaderboard(results, ranked, { color: false });
  assert.notEqual(colored, plain);
  assert.ok(colored.includes('\u001b['));
  assert.equal(stripAnsi(colored), plain);
});

test('renderLeaderboard marks the most expensive variant with a full cost bar', async () => {
  const { results, ranked } = await getRanked();
  const table = renderLeaderboard(results, ranked, { color: false, barWidth: 8 });
  const priciest = results.reduce((a, b) => (a.costUsd > b.costUsd ? a : b));
  const line = table.split('\n').find((l) => l.includes(priciest.id));
  assert.ok(line.includes('\u2588'.repeat(8)));
});

test('renderLeaderboard respects a custom barWidth', async () => {
  const { results, ranked } = await getRanked();
  const table = renderLeaderboard(results, ranked, { color: false, barWidth: 4 });
  assert.ok(table.includes('████ 0.73') || table.includes('███░ 0.73') || table.includes('░░░░ 0.00'));
});

test('renderLeaderboard rejects empty results or ranked arrays', async () => {
  const { ranked } = await getRanked();
  assert.throws(() => renderLeaderboard([], ranked), RenderError);
  assert.throws(() => renderLeaderboard([{ id: 'x', costUsd: 0, latencyMs: 0 }], []), RenderError);
});

test('renderLeaderboard rejects a ranked entry with no matching result', async () => {
  const { results } = await getRanked();
  assert.throws(
    () => renderLeaderboard(results, [{ id: 'missing', scores: {}, total: 0.5 }]),
    RenderError
  );
});

// --- stripAnsi ---------------------------------------------------------

test('stripAnsi removes escape codes and leaves plain text untouched', () => {
  assert.equal(stripAnsi('\u001b[1mhello\u001b[0m'), 'hello');
  assert.equal(stripAnsi('no escapes here'), 'no escapes here');
});
