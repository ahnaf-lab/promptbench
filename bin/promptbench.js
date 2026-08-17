#!/usr/bin/env node
// CLI entry point: load a fixture, score its variants and either print a
// one-shot leaderboard table or (with --interactive) drive a live,
// arrow-key-navigable session with a side pane showing the selected
// variant's full transcript. No network calls, no dynamic code
// evaluation — the fixture path is only ever passed to fs.readFile, and
// user-supplied flag values are only ever used as scorer configuration
// (numbers/strings), never shelled out or eval'd.

import { loadFixture } from '../src/fixture.js';
import { replay } from '../src/replay.js';
import { keywordScorer, lengthRatioScorer, costScorer, rankVariants } from '../src/scoring.js';
import { renderLeaderboard } from '../src/render.js';
import { runInteractive } from '../src/interactive.js';

function parseArgs(argv) {
  const args = {
    fixturePath: undefined,
    keywords: [],
    targetLength: 0,
    color: true,
    barWidth: 12,
    interactive: false,
    paneWidth: 44,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keywords') {
      args.keywords = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--target-length') {
      args.targetLength = Number(argv[++i]);
    } else if (arg === '--bar-width') {
      args.barWidth = Number(argv[++i]);
    } else if (arg === '--pane-width') {
      args.paneWidth = Number(argv[++i]);
    } else if (arg === '--no-color') {
      args.color = false;
    } else if (arg === '--interactive' || arg === '-i') {
      args.interactive = true;
    } else {
      positional.push(arg);
    }
  }
  args.fixturePath = positional[0];
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.fixturePath) {
    process.stderr.write(
      'usage: promptbench <fixture.json> [--keywords a,b,c] [--target-length N] ' +
        '[--bar-width N] [--no-color] [--interactive] [--pane-width N]\n'
    );
    process.exitCode = 1;
    return;
  }

  const fixture = await loadFixture(args.fixturePath);
  const results = replay(fixture);
  const scorers = [
    keywordScorer(args.keywords),
    lengthRatioScorer({ targetLength: args.targetLength }),
    costScorer(),
  ];
  const ranked = rankVariants(results, scorers);

  if (args.interactive) {
    await runInteractive(results, ranked, {
      color: args.color,
      barWidth: args.barWidth,
      paneWidth: args.paneWidth,
    });
    return;
  }

  const table = renderLeaderboard(results, ranked, { color: args.color, barWidth: args.barWidth });
  process.stdout.write(table + '\n');
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
