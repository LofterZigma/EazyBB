import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseNavigationItem, navigationAssignments } from '../src/core/navigation.js';

test('navigation prefers an ongoing class, then the next class today', () => {
  const lessons = [
    { name: 'Morning', date: '2026-10-19', periodStart: 1, periodEnd: 2 },
    { name: 'Afternoon', date: '2026-10-19', periodStart: 5, periodEnd: 6 },
    { name: 'Tomorrow', date: '2026-10-20', periodStart: 1, periodEnd: 2 },
  ];
  assert.deepEqual(chooseNavigationItem(lessons, [], '2026-10-19', 8 * 60 + 20).lesson, lessons[0]);
  assert.equal(chooseNavigationItem(lessons, [], '2026-10-19', 8 * 60 + 20).state, 'ongoing');
  assert.deepEqual(chooseNavigationItem(lessons, [], '2026-10-19', 12 * 60).lesson, lessons[1]);
  assert.equal(chooseNavigationItem(lessons, [], '2026-10-19', 12 * 60).state, 'upcoming');
});

test('navigation shows the nearest unfinished assignment after the final class', () => {
  const now = new Date('2026-10-19T14:00:00Z');
  const lessons = [{ date: '2026-10-19', periodStart: 11, periodEnd: 11 }];
  const assignments = [
    { title: 'Done', due: '2026-10-20T00:00:00Z', completed: true },
    { title: 'Later', due: '2026-10-22T00:00:00Z' },
    { title: 'Soon', due: '2026-10-21T00:00:00Z' },
  ];
  assert.equal(chooseNavigationItem(lessons, assignments, '2026-10-19', 22 * 60, now).assignment.title, 'Soon');
  assert.deepEqual(chooseNavigationItem([], [], '2026-10-19', 22 * 60), { type: 'empty' });
});

test('navigation picks at most two unfinished tasks for the no-class cards', () => {
  const now = new Date('2026-10-19T14:00:00Z');
  const assignments = [
    { title: 'Overdue', due: '2026-10-18T00:00:00Z' },
    { title: 'Done', due: '2026-10-20T00:00:00Z', completed: true },
    { title: 'Later', due: '2026-10-22T00:00:00Z' },
    { title: 'Soon', due: '2026-10-21T00:00:00Z' },
  ];
  assert.deepEqual(navigationAssignments(assignments, now).map((item) => item.title), ['Soon', 'Later']);
  assert.deepEqual(navigationAssignments([assignments[0]], now), [assignments[0]]);
  assert.deepEqual(navigationAssignments([assignments[1]], now), []);
});

test('navigation respects a custom class start and end time', () => {
  const lessons = [{ date: '2026-10-19', day: 1, periodStart: 1, periodEnd: 1,
    name: 'Math', startTime: '10:00', endTime: '10:50' }];
  assert.equal(chooseNavigationItem(lessons, [], '2026-10-19', 9 * 60).state, 'upcoming');
  assert.equal(chooseNavigationItem(lessons, [], '2026-10-19', 10 * 60 + 20).state, 'ongoing');
  assert.equal(chooseNavigationItem(lessons, [], '2026-10-19', 11 * 60).type, 'empty');
});

test('navigation includes class periods added after the original eleven', () => {
  const lessons = [{ date: '2026-10-19', periodStart: 12, periodEnd: 12, name: 'Late class' }];
  const classTimes = { 12: { start: '22:00', end: '22:50' } };
  assert.equal(chooseNavigationItem(lessons, [], '2026-10-19', 22 * 60 + 10,
    new Date('2026-10-19T14:10:00Z'), classTimes).state, 'ongoing');
});
