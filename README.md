# promptbench

A terminal TUI that benchmarks multiple prompt variants against a local
recording of fixed model outputs, scoring each on cost, latency and
keyword/length heuristics — with zero live API calls. See which rewrite
actually wins as a live, navigable leaderboard instead of eyeballing
transcripts.

The foundation is the JSON **fixture format** that records a prompt variant's
canned output and metadata, and a **loader / replay engine** that turns a
fixture file into ordered, ready-to-score results. On top of that sits the
**scoring engine**: pluggable, deterministic scorers (keyword match, length
ratio, cost estimate) that turn each replayed result into a 0–1 score and a
weighted total. The leaderboard TUI and navigation land in later milestones.

## Install

Requires Node.js 18+. No external dependencies — the loader, validator and
replay engine are all built on the Node standard library (`node:fs/promises`,
`node:assert`, etc.), so there is nothing to add here beyond a genuine reason
to.

```bash
git clone <this-repo>
cd promptbench
npm install
```

## Usage

Fixtures live in `fixtures/*.json` and follow this shape:

```json
{
  "name": "greeting-rewrite",
  "variants": [
    {
      "id": "baseline",
      "prompt": "Say hello to the user.",
      "output": "Hello! How can I help you today?",
      "promptTokens": 6,
      "completionTokens": 9,
      "latencyMs": 420,
      "costUsd": 0.00013
    }
  ]
}
```

Load and validate a fixture, then replay it:

```js
import { loadFixture } from './src/fixture.js';
import { replay } from './src/replay.js';

const fixture = await loadFixture('./fixtures/greeting-rewrite.json');
const results = replay(fixture);

for (const r of results) {
  console.log(r.id, r.totalTokens, r.latencyMs, r.costUsd);
}
```

`replayStream` offers the same results as an async generator, optionally
pacing them out by each variant's recorded `latencyMs` (`simulateDelay:
true`) so a future TUI can feel like a live run without ever making a real
network call.

### Scoring

A **scorer** is a plain object — `{ name, weight?, score(result, allResults)
}` — so custom scorers plug in the same way the built-ins do. Every built-in
scorer is a pure function of data already on disk: no timers, no I/O, no
network, no randomness.

```js
import { replay } from './src/replay.js';
import {
  keywordScorer,
  lengthRatioScorer,
  costScorer,
  rankVariants,
} from './src/scoring.js';

const results = replay(fixture);

const scorers = [
  keywordScorer(['help', 'welcome']),      // fraction of keywords present
  lengthRatioScorer({ targetLength: 40 }), // how close output length is to a target
  costScorer(),                            // cheaper variants score higher
];

for (const entry of rankVariants(results, scorers)) {
  console.log(entry.id, entry.total.toFixed(2), entry.scores);
}
```

- `keywordScorer(keywords, { caseSensitive })` — fraction of `keywords` found
  in the output.
- `lengthRatioScorer({ targetLength, unit })` — 1 for an exact length match
  (in `'chars'` or `'words'`), falling off symmetrically the further the
  output is from the target.
- `costScorer({ maxCostUsd })` — cheaper is better; normalises against
  `maxCostUsd` if given, otherwise against the priciest variant in the same
  batch.
- `scoreVariants(results, scorers)` — one scorecard per variant, in fixture
  order, with a weight-averaged `total`.
- `rankVariants(results, scorers)` — the same scorecards, sorted best-first
  for a leaderboard.

## Status

Built autonomously with Claude Code, gated on passing tests. Milestone 2 of
5: fixture format, replay engine, and the pluggable scoring engine — the
leaderboard TUI and navigation are not implemented yet.
