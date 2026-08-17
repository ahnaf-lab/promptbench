// ANSI leaderboard renderer.
//
// Turns ranked scorecards (see scoring.js) plus their replayed results (see
// replay.js) into a fixed-width table with horizontal bars for total score,
// cost and latency, plus a bordered "detail pane" showing one variant's full
// recorded transcript, and a combined side-by-side view of the two for
// interactive navigation (see nav.js / interactive.js). Pure string
// formatting throughout: no terminal-size detection, no TTY probing, no I/O.
// Given the same inputs it always produces exactly the same string — which
// is what makes it snapshot-testable, and is why colour is written as raw
// ANSI escape codes here rather than relying on process.stdout being a TTY.

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
  const { barWidth = 12, color = true, selectedId } = options;
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

  // The selection marker column only appears when a caller opts in by
  // passing `selectedId` (interactive mode). Omitting it entirely by
  // default keeps the one-shot table's layout byte-for-byte unchanged.
  const showMarker = selectedId !== undefined;
  const markerWidth = 2;

  const headerCells = [
    ...(showMarker ? [padEnd('', markerWidth)] : []),
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

    const markerCell = showMarker
      ? entry.id === selectedId
        ? wrap(padEnd('\u25b6', markerWidth), FG_CYAN, color)
        : padEnd('', markerWidth)
      : null;
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

    const cells = [rankCell, idCell, totalCell, costCell, latencyCell];
    if (markerCell !== null) cells.unshift(markerCell);
    return cells.join('  ');
  });

  return wrap(headerLine, BOLD, color) + '\n' + separatorLine + '\n' + rowLines.join('\n');
}

/**
 * Greedily word-wrap `text` to `width` columns, hard-breaking any single
 * word longer than `width`. Pure function of its inputs; always returns at
 * least one line (an empty string for empty input) so callers can render a
 * fixed-height box even for a blank field.
 */
function wrapText(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let remaining = word;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function boxTop(width) {
  return '\u250c' + '\u2500'.repeat(width - 2) + '\u2510';
}

function boxBottom(width) {
  return '\u2514' + '\u2500'.repeat(width - 2) + '\u2518';
}

// Padding is applied to the plain text BEFORE any ANSI wrapping, so the
// escape codes (zero-width once rendered) never throw off column alignment.
function boxRow(text, innerWidth, { color = true, code } = {}) {
  const padded = padEnd(text, innerWidth);
  const content = code ? wrap(padded, code, color) : padded;
  return `\u2502 ${content} \u2502`;
}

function boxBlank(innerWidth) {
  return `\u2502 ${' '.repeat(innerWidth)} \u2502`;
}

/**
 * Render a single variant's full recorded transcript — prompt, output and
 * metrics — as a bordered box. This is the "side pane" a leaderboard row
 * drills into: pure formatting of data already produced by replay(), so the
 * same result always renders to the same box.
 *
 * Options:
 *   - width: total box width in characters, including borders (default 44)
 *   - color: emit ANSI colour codes (default true)
 */
export function renderDetailPane(result, options = {}) {
  if (!result || typeof result !== 'object' || typeof result.id !== 'string') {
    throw new RenderError('renderDetailPane: result must be a replayed result object');
  }
  const { width = 44, color = true } = options;
  if (!Number.isInteger(width) || width < 20) {
    throw new RenderError(`renderDetailPane: width must be an integer >= 20, got ${width}`);
  }
  const innerWidth = width - 4;

  const lines = [boxTop(width)];
  lines.push(boxRow(result.id, innerWidth, { color, code: `${BOLD}${FG_CYAN}` }));
  lines.push(boxBlank(innerWidth));
  lines.push(boxRow('Prompt:', innerWidth, { color, code: DIM }));
  for (const wrapped of wrapText(result.prompt, innerWidth)) {
    lines.push(boxRow(wrapped, innerWidth, { color }));
  }
  lines.push(boxBlank(innerWidth));
  lines.push(boxRow('Output:', innerWidth, { color, code: DIM }));
  for (const wrapped of wrapText(result.output, innerWidth)) {
    lines.push(boxRow(wrapped, innerWidth, { color }));
  }
  lines.push(boxBlank(innerWidth));
  const metrics = `${result.totalTokens} tok  ${formatLatency(result.latencyMs)}  ${formatCost(result.costUsd)}`;
  lines.push(boxRow(metrics, innerWidth, { color, code: DIM }));
  lines.push(boxBottom(width));

  return lines.join('\n');
}

/**
 * Combine the leaderboard and the selected row's detail pane into a single
 * side-by-side frame, for interactive navigation. `selectedIndex` is an
 * index into `ranked` (matching nav.js's state shape directly, so callers
 * never need to re-resolve an id back to a position).
 *
 * Options: barWidth/color as renderLeaderboard, plus `paneWidth` for the
 * detail pane (default 44).
 */
export function renderInteractive(results, ranked, selectedIndex, options = {}) {
  if (!Array.isArray(ranked) || ranked.length === 0) {
    throw new RenderError('renderInteractive: ranked must be a non-empty array');
  }
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= ranked.length) {
    throw new RenderError(`renderInteractive: selectedIndex out of range, got ${selectedIndex}`);
  }

  const { barWidth = 12, color = true, paneWidth = 44 } = options;
  const selected = ranked[selectedIndex];
  const resultById = new Map(results.map((r) => [r.id, r]));
  const selectedResult = resultById.get(selected.id);
  if (!selectedResult) {
    throw new RenderError(`renderInteractive: no result found for selected id "${selected.id}"`);
  }

  const board = renderLeaderboard(results, ranked, { barWidth, color, selectedId: selected.id });
  const pane = renderDetailPane(selectedResult, { width: paneWidth, color });

  const boardLines = board.split('\n');
  const paneLines = pane.split('\n');
  const boardWidth = Math.max(...boardLines.map((l) => stripAnsi(l).length));
  const rowCount = Math.max(boardLines.length, paneLines.length);

  const combined = [];
  for (let i = 0; i < rowCount; i++) {
    const left = boardLines[i] ?? '';
    const gap = Math.max(0, boardWidth - stripAnsi(left).length);
    const right = paneLines[i] ?? '';
    combined.push(left + ' '.repeat(gap) + '  ' + right);
  }

  const hint = wrap('\u2191/\u2193 move   q quit', DIM, color);
  return combined.join('\n') + '\n\n' + hint;
}

/**
 * Strip ANSI escape codes from a rendered string. Useful for tests and for
 * writing leaderboard output to a file or a non-colour terminal.
 */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}
