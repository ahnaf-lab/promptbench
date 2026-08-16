// Replay engine.
//
// Takes an already-validated fixture (see fixture.js) and turns each variant
// into a "replayed" result: the canned output plus derived totals, in a
// shape later milestones (scoring, TUI) can consume without touching the
// raw fixture again. No timers, no I/O, no network — replay is pure
// computation over data already on disk.

import { validateFixture } from './fixture.js';

/**
 * Compute the derived fields for a single variant record.
 */
function toResult(variant) {
  const totalTokens = variant.promptTokens + variant.completionTokens;
  return {
    id: variant.id,
    prompt: variant.prompt,
    output: variant.output,
    promptTokens: variant.promptTokens,
    completionTokens: variant.completionTokens,
    totalTokens,
    latencyMs: variant.latencyMs,
    costUsd: variant.costUsd,
  };
}

/**
 * Replay a fixture synchronously, returning one result per variant in the
 * order the fixture defined them. Re-validates the fixture first so callers
 * can pass hand-built objects (e.g. in tests) without going through
 * loadFixture.
 */
export function replay(fixture) {
  const validated = validateFixture(fixture);
  return validated.variants.map(toResult);
}

/**
 * Async generator form of replay(): yields one result at a time, waiting
 * `latencyMs` between yields when `simulateDelay` is true. Off by default so
 * consumers (like tests) get instant, deterministic output; a TUI can opt in
 * to feel like a live run.
 */
export async function* replayStream(fixture, { simulateDelay = false } = {}) {
  const results = replay(fixture);
  for (const result of results) {
    if (simulateDelay && result.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, result.latencyMs));
    }
    yield result;
  }
}
