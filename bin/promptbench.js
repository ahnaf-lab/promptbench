#!/usr/bin/env node
// CLI entry point. All argument parsing and command logic lives in
// src/cli.js so it can be unit tested directly; this file just wires it to
// the real process streams and turns the returned exit code into one.

import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
