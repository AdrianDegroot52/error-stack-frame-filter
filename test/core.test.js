import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterStack,
  filterError,
  parseFrames,
  isInternalFrame,
} from '../src/index.js';

const SAMPLE = [
  'Error: boom',
  '    at appHandler (/srv/app/handler.js:10:5)',
  '    at /srv/app/node_modules/left-pad/index.js:3:9',
  '    at node:internal/process/task_queues:95:5',
  '    at async /srv/app/server.js:22:7',
  '    at internal/process/task_queues.js:95:5',
].join('\n');

test('isInternalFrame flags node_modules paths', () => {
  assert.equal(isInternalFrame('    at /srv/app/node_modules/left-pad/index.js:3:9'), true);
});

test('isInternalFrame flags node: scheme locations', () => {
  assert.equal(isInternalFrame('    at node:internal/process/task_queues:95:5'), true);
});

test('isInternalFrame flags bare internal/ locations', () => {
  assert.equal(isInternalFrame('    at internal/process/task_queues.js:95:5'), true);
});

test('isInternalFrame does not flag absolute paths containing internal/', () => {
  assert.equal(isInternalFrame('    at /srv/app/internal/helper.js:1:1'), false);
});

test('isInternalFrame does not flag a user function merely named node_modules', () => {
  assert.equal(isInternalFrame('    at node_modules (/srv/app/handler.js:1:1)'), false);
});

test('isInternalFrame ignores non-frame lines', () => {
  assert.equal(isInternalFrame('Error: boom'), false);
  assert.equal(isInternalFrame(''), false);
});

test('isInternalFrame tolerates non-string input', () => {
  assert.equal(isInternalFrame(undefined), false);
  assert.equal(isInternalFrame(42), false);
});

test('parseFrames splits header from frames and drops trailing newline', () => {
  const { header, lines } = parseFrames(SAMPLE + '\n');
  assert.equal(header, 'Error: boom');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '    at appHandler (/srv/app/handler.js:10:5)');
});

test('parseFrames rejects non-strings', () => {
  assert.throws(() => parseFrames(null), TypeError);
});

test('filterStack keeps application frames only', () => {
  const out = filterStack(SAMPLE);
  const lines = out.split('\n');
  assert.equal(lines[0], 'Error: boom');
  assert.deepEqual(lines.slice(1), [
    '    at appHandler (/srv/app/handler.js:10:5)',
    '    at async /srv/app/server.js:22:7',
  ]);
});

test('filterStack preserves the header when every frame is filtered', () => {
  const stack = [
    'Error: all internal',
    '    at node:internal/process/task_queues:95:5',
    '    at /srv/app/node_modules/dep/index.js:1:1',
  ].join('\n');
  assert.equal(filterStack(stack), 'Error: all internal');
});

test('filterStack preserves non-frame continuation lines', () => {
  const stack = [
    'Error: custom',
    '    at app (/srv/app/x.js:1:1)',
    'Caused by: something',
    '    at /srv/app/node_modules/dep/index.js:1:1',
  ].join('\n');
  assert.equal(
    filterStack(stack),
    ['Error: custom', '    at app (/srv/app/x.js:1:1)', 'Caused by: something'].join('\n'),
  );
});

test('filterError mutates and returns the same error object', () => {
  const err = new Error('boom');
  err.stack = SAMPLE;
  const returned = filterError(err);
  assert.equal(returned, err);
  assert.equal(err.stack.split('\n').length, 3);
});

test('filterError leaves stack untouched when absent', () => {
  const err = { message: 'no stack' };
  const returned = filterError(err);
  assert.equal(returned, err);
  assert.equal('stack' in err, false);
});

test('filterError rejects non-objects', () => {
  assert.throws(() => filterError(null), TypeError);
  assert.throws(() => filterError('boom'), TypeError);
});
