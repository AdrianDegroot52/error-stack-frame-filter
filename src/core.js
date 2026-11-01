// Core stack-frame filtering logic.
//
// Design decisions worth knowing about:
//
// 1. We operate on plain strings, not on Error objects, everywhere except in
//    `filterError`. This keeps the parsing/filtering layer pure and trivially
//    testable, and it lets callers feed us stacks captured from other realms
//    (workers, vm contexts, cross-process serialization).
//
// 2. Frame classification is line-oriented. A stack trace is a header line
//    ("Error: boom") followed by indented "at ..." lines. Continuation lines
//    that do not start with "at " are kept verbatim and never classified,
//    because V8 sometimes emits them for eval/eval-ish frames and dropping
//    them would silently change the trace.
//
// 3. "Internal" means: the frame's location contains a `node:` scheme, or the
//    path contains a `node_modules` segment. We deliberately do NOT treat
//    bare "node:internal/..." only via the scheme check because some runtimes
//    print `(internal/process/task_queues.js:95:5)` without the scheme. Both
//    are covered by checking the location text for the two markers.

const NODE_MODULES_MARKER = 'node_modules';
const NODE_SCHEME_MARKER = 'node:';
const INTERNAL_MARKER = 'internal/';

/**
 * Return true when a single stack-trace line refers to runtime or dependency
 * code rather than application code.
 *
 * The function accepts any line; non-frame lines (headers, blank lines) are
 * reported as not internal so callers can use it as a cheap predicate without
 * first parsing.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isInternalFrame(line) {
  if (typeof line !== 'string') {
    return false;
  }
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) {
    return false;
  }
  // Only inspect the location portion. A user function could legitimately be
  // named "node_modules" or contain "internal/", and we must not filter it
  // based on its name. The location is everything after the function name,
  // which V8 separates with a space. We take the last parenthesised group if
  // present, otherwise the token after "at ".
  const location = extractLocation(trimmed);
  if (location === null) {
    return false;
  }
  if (location.includes(NODE_MODULES_MARKER)) {
    return true;
  }
  if (location.startsWith(NODE_SCHEME_MARKER)) {
    return true;
  }
  if (location.includes(INTERNAL_MARKER) && !location.startsWith('/')) {
    // `internal/foo.js` style locations (no leading slash, no scheme) are
    // Node internals. Absolute paths like `/srv/internal/app.js` are not.
    return true;
  }
  return false;
}

/**
 * Extract the source location from a frame line.
 *
 * Handles the two shapes V8 emits:
 *   at fn (/path/to/file.js:1:2)
 *   at /path/to/file.js:1:2
 *   at async fn (/path/to/file.js:1:2)
 *
 * @param {string} line a line already known to start with "at "
 * @returns {string | null}
 */
function extractLocation(line) {
  const body = line.slice(3);
  if (body.length === 0) {
    return null;
  }
  const open = body.lastIndexOf('(');
  const close = body.lastIndexOf(')');
  if (open !== -1 && close > open) {
    return body.slice(open + 1, close).trim();
  }
  // No parentheses: the whole body is the location, possibly with an
  // "async " prefix.
  const withoutAsync = body.startsWith('async ') ? body.slice(6) : body;
  return withoutAsync.trim();
}

/**
 * Split a raw stack string into its header and frame lines.
 *
 * @param {string} stack
 * @returns {{ header: string, lines: string[] }}
 */
export function parseFrames(stack) {
  if (typeof stack !== 'string') {
    throw new TypeError('stack must be a string');
  }
  const lines = stack.split('\n');
  if (lines.length === 0) {
    return { header: '', lines: [] };
  }
  const header = lines[0];
  const rest = lines.slice(1);
  // Drop a single trailing empty line produced by a trailing newline, but keep
  // interior blank lines because they may be meaningful in custom stacks.
  if (rest.length > 0 && rest[rest.length - 1] === '') {
    rest.pop();
  }
  return { header, lines: rest };
}

/**
 * Filter a raw stack string, removing frames that point at node_modules or
 * Node internals.
 *
 * The header line is always preserved. Non-frame lines are preserved. If every
 * frame is filtered out, the result still contains the header, which is the
 * honest outcome: the caller can tell that nothing application-level was on
 * the stack.
 *
 * @param {string} stack
 * @returns {string}
 */
export function filterStack(stack) {
  const { header, lines } = parseFrames(stack);
  const kept = [];
  for (const line of lines) {
    if (line === '') {
      continue;
    }
    if (line.trim().startsWith('at ') && isInternalFrame(line)) {
      continue;
    }
    kept.push(line);
  }
  if (kept.length === 0) {
    return header;
  }
  return header + '\n' + kept.join('\n');
}

/**
 * Filter the stack of an Error in place and return the same Error.
 *
 * Mutating in place matches how `Error.prepareStackTrace` and logging
 * middleware expect to work; returning the error keeps call sites terse:
 * `throw filterError(err)`.
 *
 * @param {Error & { stack?: string }} error
 * @returns {Error & { stack?: string }}
 */
export function filterError(error) {
  if (error === null || typeof error !== 'object') {
    throw new TypeError('error must be an object');
  }
  if (typeof error.stack === 'string') {
    error.stack = filterStack(error.stack);
  }
  return error;
}
