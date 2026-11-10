# error-stack-frame-filter

Removes `node_modules` and Node-internal frames from error stack traces so only application code remains.

```js
import { filterStack, filterError } from 'error-stack-frame-filter';

const err = new Error('boom');
err.stack = [
  'Error: boom',
  '    at appHandler (/srv/app/handler.js:10:5)',
  '    at /srv/app/node_modules/left-pad/index.js:3:9',
  '    at node:internal/process/task_queues:95:5',
].join('\n');

filterError(err);
console.log(err.stack);
// Error: boom
//     at appHandler (/srv/app/handler.js:10:5)

// Or work on a raw string:
console.log(filterStack(err.stack));
```

Exports: `filterStack(stack)`, `filterError(error)`, `parseFrames(stack)`, `isInternalFrame(line)`.

## Why this exists

A stack trace from a real application is mostly noise: every `require` in the call chain contributes a `node_modules` frame, and the runtime contributes `node:internal/...` frames. When you log an error, that noise pushes the one frame you care about off the screen. This library drops those frames and keeps the rest.

The trade-off is that filtering is purely textual. There is no source map lookup, no runtime introspection, and no attempt to guess whether a `node_modules` path is really third-party code. A path containing the `node_modules` substring is treated as internal, full stop. That is fast, dependency-free, and predictable, but it means a monorepo that vendors code under a directory literally named `node_modules` will have those frames dropped too. If that matters, filter the string yourself instead of calling `filterStack`.

## The awkward edge

A frame is only classified when the line starts with `at `. Lines that do not (headers, `Caused by:` continuations, blank lines) are passed through untouched. If every frame is filtered out, the result is just the header line — not an empty string. That is deliberate: an empty string would look like a bug in the caller, while a bare `Error: boom` correctly says "the stack had nothing application-level in it."

`isInternalFrame` inspects only the location portion of a frame, not the function name. A user function named `node_modules` is not filtered. The flip side is that a location is classified as internal if it contains `node_modules` anywhere, including as a substring of a longer directory name.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

