import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssignmentPreferences, homeAssignments, allAssignments } from '../src/core/assignment-preferences.js';

const items = [
  { id: 'past', title: 'Past', course: 'A', due: new Date('2026-10-18T12:00:00Z'), dayKey: '2026-10-18', completed: false },
  { id: 'soon', title: 'Soon', course: 'B', due: new Date('2026-10-20T12:00:00Z'), dayKey: '2026-10-20', completed: false },
  { id: 'later', title: 'Later', course: 'A', due: new Date('2026-10-25T12:00:00Z'), dayKey: '2026-10-25', completed: false },
  { id: 'done', title: 'Done', course: 'C', due: new Date('2026-10-19T12:00:00Z'), dayKey: '2026-10-19', completed: true },
];
const dayKeyAtOffset = (offset) => {
  const date = new Date('2026-10-19T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test('favorites appear first and the home limit applies after date filtering', () => {
  const selected = homeAssignments(items, new Set(['later']), {
    limit: 2, daysBefore: 0, daysAfter: 1, sort: 'dueAsc',
  }, dayKeyAtOffset);
  assert.deepEqual(selected.map((item) => item.id), ['later', 'soon']);
});

test('course detail can use its own count after applying assignment date preferences', () => {
  const preferences = { limit: 1, daysBefore: 1, daysAfter: 10, sort: 'dueAsc' };
  assert.deepEqual(homeAssignments(items, new Set(), preferences, dayKeyAtOffset).map((item) => item.id), ['past']);
  assert.deepEqual(homeAssignments(items, new Set(), preferences, dayKeyAtOffset, Infinity)
    .map((item) => item.id), ['past', 'soon', 'later']);
});

test('completed favorites can be hidden while the complete list keeps them faded by status', () => {
  const selected = homeAssignments(items, new Set(['done']), {
    hideCompletedFavorites: true, daysBefore: 1, daysAfter: 10,
  }, dayKeyAtOffset);
  assert.equal(selected.some((item) => item.id === 'done'), false);
  assert.deepEqual(allAssignments(items).map((item) => item.id), ['past', 'soon', 'later', 'done']);
});

test('invalid assignment settings fall back to bounded defaults', () => {
  assert.deepEqual(normalizeAssignmentPreferences({ limit: -3, daysBefore: 999, sort: 'bad' }), {
    limit: 1, hideCompletedFavorites: false, sort: 'dueAsc', daysBefore: 365, daysAfter: 30,
  });
});
