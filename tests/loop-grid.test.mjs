import test from 'node:test';
import assert from 'node:assert/strict';
import {loopAtBar, resizeGridLoop} from '../web/loop-grid.js';

const beats = [0, .5, 1.1, 1.6, 2.3, 2.9, 3.4, 4, 4.7, 5.2, 5.8, 6.3];
test('L selects the current measure on an irregular beat grid', () => {
  assert.deepEqual(loopAtBar(beats, 0, 3.7, 7, 4), {a: 2.3, b: 4.7});
  assert.deepEqual(loopAtBar(beats, 0, 4.7, 7, 4), {a: 4.7, b: 7});
  assert.deepEqual(loopAtBar(beats, 0, 1, 7, 3), {a: 0, b: 1.6});
});
test('loop respects lead-in phase and remembers requested beat length', () => {
  assert.deepEqual(loopAtBar(beats, 2, .7, 7, 4), {a: 0, b: 1.1});
  assert.deepEqual(loopAtBar(beats, 0, 2.8, 7, 4, 8), {a: 2.3, b: 7});
  assert.equal(loopAtBar([], 0, 0, 7, 4), null);
});
test('resize uses bars or beats, keeps the start, and clamps to one beat or song end', () => {
  assert.deepEqual(resizeGridLoop(beats, 2.3, 4.7, 7, 4), {a: 2.3, b: 7});
  assert.deepEqual(resizeGridLoop(beats, 2.3, 4.7, 7, -1), {a: 2.3, b: 4});
  assert.deepEqual(resizeGridLoop(beats, 2.3, 4.7, 7, -4), {a: 2.3, b: 2.9});
  assert.deepEqual(resizeGridLoop(beats, 2.3, 2.9, 7, -4), {a: 2.3, b: 2.9});
});
