// ANSI leaderboard renderer.
//
// Turns ranked scorecards (see scoring.js) plus their replayed results (see
// replay.js) into a fixed-width table with horizontal bars for total score,
// cost and latency. Pure string formatting: no terminal-size detection, no
// TTY probing, no I/O. Given the same results, ranked scorecards and options
// it always produces exactly the same string — which is what makes it
// snapshot-testable, and is why colour is written as raw ANSI escape codes
// here rather than relying on process.stdout being a TTY.

export class RenderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RenderError';
  }
}

const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const FG_GREEN = `${ESC}32m`;
const FG_YELLOW = `${ESC}33m`;
const FG_RED = `${ESC}31m`;
const FG_CYAN = `${ESC}36m`;

const BAR_FILLED = '\u2588'; // █
const BAR_EMPTY = '\u2591'; // ░

function wrap(text, code, color) {
  return color ? `${code}${text}${RESET}` : text;
}

function padEnd(text, width) {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function padStart(text, width) {
  return text.length >= width ? text.slice(0, width) : ' '.repeat(width - text.length) + text;
}

/**
 * Render a single horizontal bar for a value already normalised to [0, 1].
 * Colour tone reflects the fraction: green for high, yellow for mid, red for
 * low — this is used for both "higher is better" (total score) and
 * "higher is worse" (cost/latency magnitude) bars; callers choose what the
 * fraction means.
 */
export function renderBar(fraction, width, { color = true } = {}) {
  if (typeof fraction !== 'number' || Number.isNaN(fraction)) {
    throw new RenderError(`renderBar: fraction must be a number, got ${fraction}`);
  }
  if (!Number.isInteger(width) || width <= 0) {
    throw new RenderError(`renderBar: width must be a positive integer, got ${width}`);
  }
  const clamped = Math.max(0, Math.min(1, fraction));
  const filledCount = Math.round(clamped * width);
  const filled = BAR_FILLED.repeat(filledCount);
  const empty = BAR_EMPTY.repeat(width - filledCount);
  const tone = clamped >= 0.66 ? FG_GREEN : clamped >= 0.33 ? FG_YELLOW : FG_RED;
  return wrap(filled, tone, color) + wrap(empty, DIM, color);
}

function formatCost(costUsd) {
  return `$${costUsd.toFixed(5)}`;
}

function formatLatency(latencyMs) {
  return `${latencyMs}ms`;
}

/**
 * Render a full leaderboard table: one row per entry in `ranked` (already
 * best-first, see rankVariants), with a bar for total score plus reference
 * bars for cost and latency normalised against the most expensive / slowest
 * variant in `results`.
 *
 * Options:
 *   - barWidth: bar width in characters (default 12)
 *   - color: emit ANSI colour codes (default true; pass false for a plain
 *     table, e.g. for a non-colour terminal or a diff-friendly log)
 */
export function renderLeaderboard(results, ranked, options = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new RenderError('renderLeaderboard: results must be a non-empty array');
  }
  if (!Array.isArray(ranked) || ranked.length === 0) {
    throw new RenderError('renderLeaderboard: ranked must be a non-empty array');
  }
  const { barWidth = 12, color = true } = options;
  if (!Number.isInteger(barWidth) || barWidth <= 0) {
    throw new RenderError(`renderLeaderboard: barWidth must be a positive integer, got ${barWidth}`);
  }

  const resultById = new Map(results.map((r) => [r.id, r]));
  for (const entry of ranked) {
    if (!resultById.has(entry.id)) {
      throw new RenderError(`renderLeaderboard: no result found for ranked id "${entry.id}"`);
    }
  }

  const maxCost = Math.max(...results.map((r) => r.costUsd)) || 1;
  const maxLatency = Math.max(...results.map((r) => r.latencyMs)) || 1;

  const rankWidth = Math.max(1, String(ranked.length).length);
  const idWidth = Math.max(2, ...ranked.map((e) => e.id.length));
  const costTextWidth = Math.max(4, ...results.map((r) => formatCost(r.costUsd).length));
  const latencyTextWidth = Math.max(7, ...results.map((r) => formatLatency(r.latencyMs).length));

  const headerCells = [
    padStart('#', rankWidth),
    padEnd('ID', idWidth),
    padEnd('TOTAL', barWidth + 5),
    padEnd('COST', barWidth + 1 + costTextWidth),
    padEnd('LATENCY', barWidth + 1 + latencyTextWidth),
  ];
  const headerLine = headerCells.join('  ');
  const separatorLine = '-'.repeat(headerLine.length);

  const rowLines = ranked.map((entry, index) => {
    const result = resultById.get(entry.id);
    const costFraction = result.costUsd / maxCost;
    const latencyFraction = result.latencyMs / maxLatency;

    const rankCell = padStart(String(index + 1), rankWidth);
    const idCell = wrap(padEnd(entry.id, idWidth), FG_CYAN, color);
    const totalCell =
      renderBar(entry.total, barWidth, { color }) + ' ' + padStart(entry.total.toFixed(2), 4);
    const costCell =
      renderBar(costFraction, barWidth, { color }) + ' ' + padEnd(formatCost(result.costUsd), costTextWidth);
    const latencyCell =
      renderBar(latencyFraction, barWidth, { color }) +
      ' ' +
      padEnd(formatLatency(result.latencyMs), latencyTextWidth);

    return [rankCell, idCell, totalCell, costCell, latencyCell].join('  ');
  });

  return wrap(headerLine, BOLD, color) + '\n' + separatorLine + '\n' + rowLines.join('\n');
}

/**
 * Strip ANSI escape codes from a rendered string. Useful for tests and for
 * writing leaderboard output to a file or a non-colour terminal.
 */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}
