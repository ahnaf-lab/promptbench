// CLI argument parsing + command dispatch.
//
// Kept separate from bin/promptbench.js so it can be unit tested directly
// (spawning a subprocess for every flag combination would be slow and
// awkward to assert against). Nothing here makes a network call or shells
// out: fixture paths are only ever passed to fs.readFile via loadFixture(),
// and the only other filesystem access is listing the bundled fixtures/
// directory that ships inside this package.
//
// Two subcommands:
//   promptbench run <fixture.json> [flags]   score + render a fixture
//   promptbench list                         list the bundled sample fixtures

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadFixture } from './fixture.js';
import { replay } from './replay.js';
import { keywordScorer, lengthRatioScorer, costScorer, rankVariants } from './scoring.js';
import { renderLeaderboard } from './render.js';
import { runInteractive } from './interactive.js';

// fixtures/ ships alongside src/ in the published package, so it is located
// relative to this module rather than to process.cwd() — the CLI must be
// able to find its own bundled samples no matter where it is invoked from.
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const BUNDLED_FIXTURES_DIR = path.join(PACKAGE_ROOT, 'fixtures');

export const USAGE = `usage: promptbench <command> [options]

Commands:
  run <fixture.json>   score a fixture's prompt variants and print a leaderboard
  list                  list the bundled sample fixtures under fixtures/

Options for "run":
  --keywords a,b,c      words to look for in each variant's output
  --target-length N     ideal output length used by the length-ratio scorer
  --bar-width N         leaderboard bar width in characters (default 12)
  --pane-width N        detail pane width in interactive mode (default 44)
  --no-color            disable ANSI colour output
  --interactive, -i     live, arrow-key-navigable session instead of one-shot

Examples:
  promptbench run fixtures/greeting-rewrite.json --keywords hello,help
  promptbench run fixtures/support-reply.json --interactive
  promptbench list
`;

/**
 * Parse CLI argv (already stripped of `node script.js`) into a structured
 * command. Returns { command: 'help' } for no args or -h/--help, or
 * { command: 'unknown', name } for an unrecognised subcommand — callers
 * decide what to print/exit with, this function only classifies input.
 */
export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    return { command: 'help' };
  }

  const [command, ...rest] = argv;
  if (command === 'list') {
    return { command: 'list' };
  }
  if (command !== 'run') {
    return { command: 'unknown', name: command };
  }

  const args = {
    command: 'run',
    fixturePath: undefined,
    keywords: [],
    targetLength: 0,
    color: true,
    barWidth: 12,
    interactive: false,
    paneWidth: 44,
  };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--keywords') {
      args.keywords = (rest[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--target-length') {
      args.targetLength = Number(rest[++i]);
    } else if (arg === '--bar-width') {
      args.barWidth = Number(rest[++i]);
    } else if (arg === '--pane-width') {
      args.paneWidth = Number(rest[++i]);
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

/**
 * List the fixture files bundled with the package: file name, the fixture's
 * declared `name` and its variant count. Sorted by file name for a stable,
 * testable order.
 */
export async function listBundledFixtures() {
  const entries = await readdir(BUNDLED_FIXTURES_DIR);
  const files = entries.filter((f) => f.endsWith('.json')).sort();
  const fixtures = [];
  for (const file of files) {
    const fixture = await loadFixture(path.join(BUNDLED_FIXTURES_DIR, file));
    fixtures.push({ file, name: fixture.name, variantCount: fixture.variants.length });
  }
  return fixtures;
}

/**
 * Run the "run" subcommand: load, replay, score and render a fixture. Shared
 * by the one-shot and --interactive paths so both stay in sync.
 */
async function runFixture(args, io) {
  const fixture = await loadFixture(args.fixturePath);
  const results = replay(fixture);
  const scorers = [
    keywordScorer(args.keywords),
    lengthRatioScorer({ targetLength: args.targetLength }),
    costScorer(),
  ];
  const ranked = rankVariants(results, scorers);

  if (args.interactive) {
    await runInteractive(
      results,
      ranked,
      { color: args.color, barWidth: args.barWidth, paneWidth: args.paneWidth },
      { stdin: io.stdin, stdout: io.stdout }
    );
    return;
  }

  const table = renderLeaderboard(results, ranked, { color: args.color, barWidth: args.barWidth });
  io.stdout.write(table + '\n');
}

/**
 * Top-level CLI entry point. `io` defaults to the real process streams but
 * accepts any writable stdout/stderr (and readable stdin, for --interactive)
 * so it can be driven from tests without touching the real terminal.
 * Returns a process exit code; never calls process.exit itself.
 */
export async function runCli(argv, io = {}) {
  const { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = io;
  const args = parseArgs(argv);

  if (args.command === 'help') {
    stdout.write(USAGE);
    return 0;
  }

  if (args.command === 'unknown') {
    stderr.write(`promptbench: unknown command "${args.name}"\n\n${USAGE}`);
    return 1;
  }

  if (args.command === 'list') {
    const fixtures = await listBundledFixtures();
    for (const f of fixtures) {
      stdout.write(`${f.file}\t${f.name}\t${f.variantCount} variants\n`);
    }
    return 0;
  }

  // args.command === 'run'
  if (!args.fixturePath) {
    stderr.write(`promptbench: "run" requires a fixture path\n\n${USAGE}`);
    return 1;
  }

  try {
    await runFixture(args, { stdin, stdout });
    return 0;
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }
}
