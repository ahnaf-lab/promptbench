import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { parseArgs, runCli, listBundledFixtures, BUNDLED_FIXTURES_DIR } from '../src/cli.js';

const FIXTURE_PATH = new URL('../fixtures/greeting-rewrite.json', import.meta.url).pathname;

function makeIo() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c) => (out += c.toString()));
  stderr.on('data', (c) => (err += c.toString()));
  return {
    stdin: new PassThrough(),
    stdout,
    stderr,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

// --- parseArgs (pure) ------------------------------------------------------

test('parseArgs with no arguments returns the help command', () => {
  assert.deepEqual(parseArgs([]), { command: 'help' });
  assert.deepEqual(parseArgs(['--help']), { command: 'help' });
  assert.deepEqual(parseArgs(['-h']), { command: 'help' });
});

test('parseArgs("list") returns the list command', () => {
  assert.deepEqual(parseArgs(['list']), { command: 'list' });
});

test('parseArgs rejects an unrecognised subcommand without throwing', () => {
  const result = parseArgs(['frobnicate']);
  assert.equal(result.command, 'unknown');
  assert.equal(result.name, 'frobnicate');
});

test('parseArgs("run", fixture) parses the fixture path and default flags', () => {
  const result = parseArgs(['run', 'fixtures/greeting-rewrite.json']);
  assert.equal(result.command, 'run');
  assert.equal(result.fixturePath, 'fixtures/greeting-rewrite.json');
  assert.equal(result.color, true);
  assert.equal(result.interactive, false);
  assert.equal(result.barWidth, 12);
  assert.equal(result.paneWidth, 44);
});

test('parseArgs("run") parses keywords, target-length, bar-width and flags', () => {
  const result = parseArgs([
    'run',
    'f.json',
    '--keywords',
    'hello, help',
    '--target-length',
    '40',
    '--bar-width',
    '20',
    '--no-color',
    '--interactive',
  ]);
  assert.deepEqual(result.keywords, ['hello', 'help']);
  assert.equal(result.targetLength, 40);
  assert.equal(result.barWidth, 20);
  assert.equal(result.color, false);
  assert.equal(result.interactive, true);
});

test('parseArgs("run") accepts -i as a shorthand for --interactive', () => {
  const result = parseArgs(['run', 'f.json', '-i']);
  assert.equal(result.interactive, true);
});

// --- listBundledFixtures ----------------------------------------------------

test('listBundledFixtures finds at least three bundled sample fixtures', async () => {
  const fixtures = await listBundledFixtures();
  assert.ok(fixtures.length >= 3, `expected >= 3 bundled fixtures, got ${fixtures.length}`);
  for (const f of fixtures) {
    assert.equal(typeof f.file, 'string');
    assert.equal(typeof f.name, 'string');
    assert.ok(f.variantCount >= 1);
  }
});

test('BUNDLED_FIXTURES_DIR points at the fixtures/ directory inside this package', () => {
  assert.ok(BUNDLED_FIXTURES_DIR.endsWith('fixtures'));
});

// --- runCli (integration) ---------------------------------------------------

test('runCli() with no args prints usage to stdout and returns exit code 0', async () => {
  const io = makeIo();
  const code = await runCli([], io);
  assert.equal(code, 0);
  assert.ok(io.out.includes('Commands:'));
});

test('runCli(["frobnicate"]) reports an unknown command on stderr with exit code 1', async () => {
  const io = makeIo();
  const code = await runCli(['frobnicate'], io);
  assert.equal(code, 1);
  assert.ok(io.err.includes('frobnicate'));
});

test('runCli(["run"]) without a fixture path fails with exit code 1', async () => {
  const io = makeIo();
  const code = await runCli(['run'], io);
  assert.equal(code, 1);
  assert.ok(io.err.includes('requires a fixture path'));
});

test('runCli(["run", fixture]) prints a one-shot leaderboard and returns 0', async () => {
  const io = makeIo();
  const code = await runCli(['run', FIXTURE_PATH, '--no-color'], io);
  assert.equal(code, 0);
  assert.ok(io.out.includes('baseline'));
  assert.ok(io.out.includes('TOTAL'));
});

test('runCli(["run", missingFixture]) fails with exit code 1 and a readable error', async () => {
  const io = makeIo();
  const code = await runCli(['run', 'does/not/exist.json'], io);
  assert.equal(code, 1);
  assert.ok(io.err.length > 0);
});

test('runCli(["list"]) lists every bundled fixture file on stdout', async () => {
  const io = makeIo();
  const code = await runCli(['list'], io);
  assert.equal(code, 0);
  assert.ok(io.out.includes('greeting-rewrite.json'));
  assert.ok(io.out.includes('support-reply.json'));
  assert.ok(io.out.includes('code-explain.json'));
});
