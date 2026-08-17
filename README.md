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
weighted total. On top of that sits the **leaderboard renderer**: a raw-ANSI
table, best-first, with horizontal bars for total score, cost and latency.
On top of that sits **interactive navigation**: arrow keys (or vim-style
`j`/`k`) move the selection up and down the table, and a bordered side pane
shows the full recorded prompt/output transcript for whichever variant is
currently selected — a small CLI ties fixture, scorers, renderer and
navigation together into something runnable, in either a one-shot or a live
mode.

## Install

Requires Node.js 18+. No external dependencies — the loader, validator and
replay engine are all built on the Node standard library (`node:fs/promises`,
`node:assert`, etc.), so there is nothing to add here beyond a genuine reason
to.

```bash
git clone <this-repo>
cd promptbench
npm install
npm link   # optional: puts `promptbench` on your PATH
```

Without `npm link` you can still run it directly with
`node bin/promptbench.js <command>`; every example below assumes `promptbench`
is on your `PATH`.

## Usage

### Walkthrough

List the sample fixtures that ship with this package:

```bash
promptbench list
```

```
code-explain.json      code-explain      3 variants
greeting-rewrite.json  greeting-rewrite  3 variants
support-reply.json     support-reply     3 variants
```

Then benchmark one of them:

```bash
promptbench run fixtures/greeting-rewrite.json --keywords hello,help --no-color
```

```
#  ID        TOTAL              COST                   LATENCY
---------------------------------------------------------------------------
1  baseline  ██████████░░ 0.79  ███████░░░░░ $0.00013  ████████░░░░ 420ms
2  terse     ███████░░░░░ 0.57  ███░░░░░░░░░ $0.00006  ████░░░░░░░░ 210ms
3  formal    ████░░░░░░░░ 0.33  ████████████ $0.00021  ████████████ 610ms
```

Add `--interactive` (or `-i`) to browse the same leaderboard with the arrow
keys and read each variant's full recorded transcript in the side pane
instead of scrolling past it. Three fixtures are bundled under `fixtures/`,
each modelling a different kind of prompt-engineering decision:

- `greeting-rewrite.json` — a short user-facing greeting: terse vs. baseline
  vs. formal.
- `support-reply.json` — a customer support reply: direct vs. empathetic vs.
  policy-heavy legalese, trading warmth and thoroughness against cost.
- `code-explain.json` — explaining a code snippet: a one-line summary vs. an
  ELI5 walkthrough vs. a technical explanation with complexity analysis.

Point `promptbench run` at your own fixture file (any JSON file matching the
schema below) to benchmark real prompt rewrites the same way.

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

### Leaderboard rendering

`renderLeaderboard(results, ranked, options)` turns replayed results and
ranked scorecards into a fixed-width table, best-first, with a bar for total
score plus reference bars for cost and latency (normalised against the most
expensive / slowest variant in the batch):

```js
import { renderLeaderboard } from './src/render.js';

console.log(renderLeaderboard(results, rankVariants(results, scorers)));
```

```
#  ID        TOTAL              COST                   LATENCY
---------------------------------------------------------------------------
1  terse     ███████████░ 0.90  ███░░░░░░░░░ $0.00006  ████░░░░░░░░ 210ms
2  baseline  ██████████░░ 0.79  ███████░░░░░ $0.00013  ████████░░░░ 420ms
3  formal    ████████░░░░ 0.67  ████████████ $0.00021  ████████████ 610ms
```

It writes raw ANSI escape codes directly (no `chalk`/`cli-table` dependency)
so the output is a pure, deterministic function of its input — the same
results always render to the exact same string, which is what the snapshot
tests in `test/render.test.js` assert against a fixed fixture. Pass
`{ color: false }` for a plain table, or use the exported `stripAnsi()` to
strip colour codes from an already-rendered one.

A minimal CLI ties fixture loading, scoring and rendering together, with two
subcommands: `run` scores and prints a leaderboard for one fixture, `list`
shows the fixtures bundled with the package.

```bash
promptbench run fixtures/greeting-rewrite.json \
  --keywords hello,help --target-length 40
```

Flags for `run`: `--keywords a,b,c` (keyword scorer), `--target-length N`
(length scorer), `--bar-width N` (default 12), `--pane-width N` (detail pane
width in interactive mode, default 44), `--no-color` and
`--interactive`/`-i`. Without `--interactive` the CLI prints one full
leaderboard and exits. Run `promptbench` with no arguments for the full usage
text.

### Interactive navigation

`--interactive` (or `-i`) turns the same leaderboard into a live session: the
table and a bordered detail pane are drawn side by side, with `▶` marking the
selected row and the pane showing that variant's full recorded prompt and
output — the transcript, not just the summary line.

```bash
promptbench run fixtures/greeting-rewrite.json --interactive
```

- `↑`/`k` and `↓`/`j` move the selection up and down the table
- `g`/Home jumps to the top row, `G`/End jumps to the bottom row
- `q`, `Esc` or `Ctrl+C` exits

This is built from two pieces, kept deliberately separate for testability:
`src/nav.js` is a pure reducer over "which row is selected" — clamped
movement, jump-to-top/bottom, and a `reduceKey(state, key)` transition
function — with no I/O or terminal handling at all, so it's unit tested with
plain function calls. `src/interactive.js` is the thin runtime glue: it
decodes real key presses into the names `nav.js` understands and re-renders
`renderInteractive()` on every change. Because it only ever needs something
`readline.emitKeypressEvents` can attach to (not literally a TTY), its tests
drive it with an in-memory stream instead of a real terminal.

```js
import { createNavState, reduceKey, selectedId } from './src/nav.js';

let state = createNavState(ranked); // ranked from rankVariants()
state = reduceKey(state, 'down');
console.log(selectedId(state)); // the id of the now-selected row
```

`renderDetailPane(result, options)` and `renderInteractive(results, ranked,
selectedIndex, options)` (in `src/render.js`) are pure formatting, same as
`renderLeaderboard`: given the same inputs they always produce the same
string, which is what the snapshot tests in `test/render.test.js` assert
against.

## Status

Built autonomously with Claude Code, gated on passing tests. Milestone 5 of
5: fixture format, replay engine, pluggable scoring engine, the raw-ANSI
leaderboard renderer, interactive arrow-key navigation with a transcript
side pane, and the `promptbench run`/`promptbench list` CLI with three
bundled example fixture sets.
