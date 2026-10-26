import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompletionOverrides, resolveAssignmentCompletion } from '../src/core/assignment-completion.js';

test('a manual completion state takes priority over refreshed Blackboard data', () => {
  const overrides = normalizeCompletionOverrides({ 'course/assignment': true });
  const item = { id: 'course/assignment', completed: false };
  assert.deepEqual(resolveAssignmentCompletion(item, overrides), { bbCompleted: false, completed: true });
  assert.deepEqual(resolveAssignmentCompletion({ ...item, completed: true }, { 'course/assignment': false }),
    { bbCompleted: true, completed: false });
});

test('cached Blackboard state is retained when a refresh omits the status', () => {
  assert.deepEqual(resolveAssignmentCompletion({ id: 'assignment', completed: null }, {}, true),
    { bbCompleted: true, completed: true });
  assert.deepEqual(resolveAssignmentCompletion({ id: 'assignment', bbCompleted: false, completed: true }, {}),
    { bbCompleted: false, completed: false });
  assert.deepEqual(resolveAssignmentCompletion({ id: 'assignment', bbCompleted: null, completed: true }, {}),
    { bbCompleted: null, completed: null });
});
