// Fixture schema + loader.
//
// A fixture is a JSON file describing one benchmark run: a set of prompt
// variants, each paired with a *canned* model output plus the metadata a
// live call would have produced (token counts, latency, cost). Nothing in
// this module makes a network call — every number is read straight off disk.
//
// Shape:
// {
//   "name": "greeting-rewrite",
//   "variants": [
//     {
//       "id": "baseline",
//       "prompt": "Say hello to the user.",
//       "output": "Hello! How can I help you today?",
//       "promptTokens": 6,
//       "completionTokens": 9,
//       "latencyMs": 420,
//       "costUsd": 0.00013
//     }
//   ]
// }

import { readFile } from 'node:fs/promises';

const REQUIRED_VARIANT_FIELDS = {
  id: 'string',
  prompt: 'string',
  output: 'string',
  promptTokens: 'number',
  completionTokens: 'number',
  latencyMs: 'number',
  costUsd: 'number',
};

export class FixtureValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FixtureValidationError';
  }
}

/**
 * Validate a parsed fixture object against the schema. Throws
 * FixtureValidationError with a message identifying the offending field.
 * Returns the same object (not a copy) when valid, for chaining.
 */
export function validateFixture(fixture) {
  if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new FixtureValidationError('fixture must be a JSON object');
  }
  if (typeof fixture.name !== 'string' || fixture.name.trim() === '') {
    throw new FixtureValidationError('fixture.name must be a non-empty string');
  }
  if (!Array.isArray(fixture.variants) || fixture.variants.length === 0) {
    throw new FixtureValidationError('fixture.variants must be a non-empty array');
  }

  const seenIds = new Set();
  fixture.variants.forEach((variant, index) => {
    if (variant === null || typeof variant !== 'object' || Array.isArray(variant)) {
      throw new FixtureValidationError(`variants[${index}] must be an object`);
    }
    for (const [field, expectedType] of Object.entries(REQUIRED_VARIANT_FIELDS)) {
      const value = variant[field];
      if (typeof value !== expectedType) {
        throw new FixtureValidationError(
          `variants[${index}].${field} must be a ${expectedType}, got ${typeof value}`
        );
      }
    }
    if (variant.promptTokens < 0 || variant.completionTokens < 0) {
      throw new FixtureValidationError(`variants[${index}] token counts must not be negative`);
    }
    if (variant.latencyMs < 0) {
      throw new FixtureValidationError(`variants[${index}].latencyMs must not be negative`);
    }
    if (variant.costUsd < 0) {
      throw new FixtureValidationError(`variants[${index}].costUsd must not be negative`);
    }
    if (seenIds.has(variant.id)) {
      throw new FixtureValidationError(`duplicate variant id "${variant.id}"`);
    }
    seenIds.add(variant.id);
  });

  return fixture;
}

/**
 * Load and validate a fixture file from disk. Never makes a network call;
 * `path` is read as-is, so callers are responsible for not passing
 * untrusted, unsanitised paths through to this function.
 */
export async function loadFixture(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new FixtureValidationError(`could not read fixture file "${path}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FixtureValidationError(`fixture file "${path}" is not valid JSON: ${err.message}`);
  }

  return validateFixture(parsed);
}
