// Public entry point for error-stack-frame-filter.
//
// The library is intentionally split into a pure core (core.js) and this
// re-export barrel so that consumers can import from a single stable path
// while the implementation stays testable in isolation.
export { filterStack, filterError, parseFrames, isInternalFrame } from './core.js';
