# promptbench

A terminal TUI that benchmarks multiple prompt variants against a local
recording of fixed model outputs, scoring each on cost, latency and
keyword/length heuristics — with zero live API calls. See which rewrite
actually wins as a live, navigable leaderboard instead of eyeballing
transcripts.

This first milestone lays the foundation: the JSON **fixture format** that
records a prompt variant's canned output and metadata, and a **loader /
replay engine** that turns a fixture file into ordered, ready-to-score
results. The scoring and TUI layers land in later milestones.

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

## Status

Built autonomously with Claude Code, gated on passing tests. Milestone 1 of
5: fixture format and replay engine only — scoring, the leaderboard TUI, and
navigation are not implemented yet.
