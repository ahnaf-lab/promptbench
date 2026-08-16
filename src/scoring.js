// Scoring engine.
//
// Turns replayed results (see replay.js) into per-variant scores using a set
// of pluggable, deterministic scorers. A scorer is a plain object:
//
//   {
//     name: 'keyword',        // unique key the score appears under
//     weight?: 1,             // relative weight in the combined total (default 1)
//     score(result, allResults) -> number in [0, 1]
//   }
//
// Every built-in scorer is a pure function of the replayed results already on
// disk — no timers, no I/O, no network, no randomness. `allResults` is passed
// alongside the single `result` being scored so a scorer can normalise
// against the rest of the batch (e.g. cost relative to the priciest variant)
// without needing a separate "prepare" pass.

export class ScoringError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScoringError';
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Fraction of `keywords` found (case-insensitively by default) in the
 * variant's output. A variant that contains every keyword scores 1; one that
 * contains none scores 0. With no keywords configured every variant scores 1
 * (there is nothing to fail).
 */
export function keywordScorer(keywords = [], { caseSensitive = false, weight = 1 } = {}) {
  if (!Array.isArray(keywords)) {
    throw new ScoringError('keywordScorer: keywords must be an array of strings');
  }
  return {
    name: 'keyword',
    weight,
    score(result) {
      if (keywords.length === 0) return 1;
      const haystack = caseSensitive ? result.output : result.output.toLowerCase();
      let matched = 0;
      for (const keyword of keywords) {
        const needle = caseSensitive ? keyword : keyword.toLowerCase();
        if (needle !== '' && haystack.includes(needle)) matched++;
      }
      return matched / keywords.length;
    },
  };
}

/**
 * How close the output's length is to a `targetLength`, in either `'chars'`
 * (default) or `'words'`. A perfect match scores 1; the score falls off
 * linearly as the ratio of actual-to-target length moves away from 1.0 in
 * either direction (too short is penalised the same as too long), floored at
 * 0. With no target configured every variant scores 1.
 */
export function lengthRatioScorer({ targetLength = 0, unit = 'chars', weight = 1 } = {}) {
  if (unit !== 'chars' && unit !== 'words') {
    throw new ScoringError('lengthRatioScorer: unit must be "chars" or "words"');
  }
  return {
    name: 'length',
    weight,
    score(result) {
      if (!targetLength || targetLength <= 0) return 1;
      const length =
        unit === 'words'
          ? result.output.trim().split(/\s+/).filter(Boolean).length
          : result.output.length;
      const ratio = length / targetLength;
      return clamp01(1 - Math.abs(1 - ratio));
    },
  };
}

/**
 * Cheaper variants score higher. Cost is normalised against `maxCostUsd` when
 * given, or otherwise against the most expensive variant in the same batch
 * (`allResults`), so scores stay comparable across fixtures with wildly
 * different absolute costs. A variant costing nothing scores 1; the most
 * expensive variant in a batch (with no explicit ceiling) scores 0.
 */
export function costScorer({ maxCostUsd } = {}) {
  if (maxCostUsd !== undefined && (typeof maxCostUsd !== 'number' || maxCostUsd < 0)) {
    throw new ScoringError('costScorer: maxCostUsd must be a non-negative number');
  }
  return {
    name: 'cost',
    weight: 1,
    score(result, allResults) {
      const reference = maxCostUsd ?? Math.max(0, ...allResults.map((r) => r.costUsd));
      if (reference <= 0) return 1;
      return clamp01(1 - result.costUsd / reference);
    },
  };
}

/**
 * Run every scorer in `scorers` over every result in `results`, returning one
 * scorecard per variant:
 *
 *   { id, scores: { keyword: 0.5, length: 1, cost: 0.8 }, total: 0.77 }
 *
 * `total` is the weight-averaged mean of the individual scores. Results are
 * returned in the same order as `results` (i.e. fixture order) — call
 * `rankVariants` instead for a leaderboard sorted best-first.
 */
export function scoreVariants(results, scorers) {
  if (!Array.isArray(results)) {
    throw new ScoringError('scoreVariants: results must be an array');
  }
  if (!Array.isArray(scorers) || scorers.length === 0) {
    throw new ScoringError('scoreVariants: scorers must be a non-empty array');
  }
  for (const scorer of scorers) {
    if (!scorer || typeof scorer.score !== 'function' || typeof scorer.name !== 'string' || scorer.name === '') {
      throw new ScoringError('scoreVariants: every scorer needs a non-empty name and a score() function');
    }
  }

  return results.map((result) => {
    const scores = {};
    let weightedSum = 0;
    let weightTotal = 0;

    for (const scorer of scorers) {
      const raw = scorer.score(result, results);
      if (typeof raw !== 'number' || Number.isNaN(raw) || raw < 0 || raw > 1) {
        throw new ScoringError(`scorer "${scorer.name}" must return a number in [0, 1], got ${raw}`);
      }
      const weight = scorer.weight ?? 1;
      scores[scorer.name] = raw;
      weightedSum += raw * weight;
      weightTotal += weight;
    }

    return {
      id: result.id,
      scores,
      total: weightTotal > 0 ? weightedSum / weightTotal : 0,
    };
  });
}

/**
 * Same as scoreVariants, but sorted best-first (highest `total` wins; ties
 * broken by fixture order) — the shape a leaderboard wants directly.
 */
export function rankVariants(results, scorers) {
  const scored = scoreVariants(results, scorers);
  return scored
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.total - a.entry.total || a.index - b.index)
    .map(({ entry }) => entry);
}
