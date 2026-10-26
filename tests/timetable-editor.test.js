import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CLASS_TIMES, importIcsLessons, lessonGroups, courseGroups, lessonTimeRange,
  lessonsToIcal, makeEditableTimetable, normalizeClassTimes, prepareClassTimeChange,
  remapSourceLessons, validLesson } from '../src/core/timetable-editor.js';

test('class periods are sorted by start time and courses follow renumbered periods', () => {
  const current = { 1: { start: '08:00', end: '08:50' },
    2: { start: '09:00', end: '09:50' } };
  const lesson = { date: '2026-10-19', name: 'Course', periodStart: 2, periodEnd: 2 };
  const result = prepareClassTimeChange([
    { originalPeriod: 2, start: '09:00', end: '09:50' },
    { originalPeriod: null, start: '08:50', end: '09:00' },
    { originalPeriod: 1, start: '08:00', end: '08:50' },
  ], current, [lesson]);
  assert.deepEqual(result.times, {
    1: { start: '08:00', end: '08:50' },
    2: { start: '08:50', end: '09:00' },
    3: { start: '09:00', end: '09:50' },
  });
  assert.deepEqual([result.lessons[0].periodStart, result.lessons[0].periodEnd], [3, 3]);
  assert.equal(lesson.periodStart, 2);
});

test('deleting an unused period renumbers courses and deleting a used period is rejected', () => {
  const current = { 1: { start: '08:00', end: '08:50' },
    2: { start: '09:00', end: '09:50' } };
  const lesson = { date: '2026-10-19', name: 'Course', periodStart: 2, periodEnd: 2 };
  const result = prepareClassTimeChange([
    { originalPeriod: 2, start: '09:00', end: '09:50' },
  ], current, [lesson]);
  assert.equal(result.lessons[0].periodStart, 1);
  assert.throws(() => prepareClassTimeChange([
    { originalPeriod: 1, start: '08:00', end: '08:50' },
  ], current, [lesson]), /课程/);
});

test('class periods may touch but may not overlap', () => {
  const rows = [
    { originalPeriod: null, start: '08:00', end: '08:50' },
    { originalPeriod: null, start: '08:50', end: '09:40' },
  ];
  assert.equal(Object.keys(prepareClassTimeChange(rows, {}).times).length, 2);
  assert.throws(() => prepareClassTimeChange([
    rows[0], { ...rows[1], start: '08:49' },
  ], {}), /重叠/);
  assert.deepEqual(normalizeClassTimes({ 1: rows[0], 2: { ...rows[1], start: '08:49' } }),
    DEFAULT_CLASS_TIMES);
});

test('courses can use a newly added period beyond the original eleven', () => {
  const times = { ...DEFAULT_CLASS_TIMES, 12: { start: '22:00', end: '22:50' } };
  const lesson = { date: '2026-10-19', name: 'Evening course', periodStart: 12, periodEnd: 12 };
  assert.equal(validLesson(lesson, times), true);
  assert.equal(makeEditableTimetable([lesson], null, 'custom', times).allLessons.length, 1);
});

test('a TIS refresh follows saved period numbers after a new period is inserted', () => {
  const current = { 1: { start: '08:00', end: '08:50' },
    2: { start: '09:00', end: '09:50' } };
  const change = prepareClassTimeChange([
    { originalPeriod: 1, start: '08:00', end: '08:50' },
    { originalPeriod: null, start: '08:50', end: '09:00' },
    { originalPeriod: 2, start: '09:00', end: '09:50' },
  ], current);
  const sourceMap = { 1: change.periodMap[1], 2: change.periodMap[2] };
  const [lesson] = remapSourceLessons([
    { date: '2026-10-19', name: 'Course', periodStart: 2, periodEnd: 2 },
  ], sourceMap);
  assert.equal(lesson.periodStart, 3);
  assert.equal(lesson.periodEnd, 3);
});

test('edited courses produce a full timetable and an ICS export with custom times', () => {
  const lessons = [
    { date: '2026-10-19', name: '编译原理', periodStart: 1, periodEnd: 2, location: '一教 101' },
    { date: '2026-10-26', name: '编译原理', periodStart: 1, periodEnd: 2, location: '一教 101' },
  ];
  const times = normalizeClassTimes({ ...DEFAULT_CLASS_TIMES, 1: { start: '08:05', end: '08:55' } });
  const result = makeEditableTimetable(lessons, null, 'custom', times);
  assert.equal(result.allLessons.length, 2);
  assert.equal(result.firstWeekStart, '2026-10-19');
  assert.equal(result.lastWeekStart, '2026-10-26');
  assert.equal(lessonGroups(result.allLessons).length, 1);
  assert.equal(lessonTimeRange(result.allLessons[0], times), '08:05–09:50');
  assert.match(result.ics, /DTSTART:20261019T000500Z/);
});

test('ICS export can be imported without losing course dates and times', () => {
  const original = [{ date: '2026-10-19', name: '编译原理', periodStart: 1, periodEnd: 1,
    location: '一教, 101', startTime: '08:30', endTime: '09:20' }];
  const imported = importIcsLessons(lessonsToIcal(original));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, '编译原理');
  assert.equal(imported[0].date, '2026-10-19');
  assert.equal(imported[0].location, '一教, 101');
  assert.equal(imported[0].startTime, '08:30');
});

test('ICS import expands weekly recurring courses and converts UTC to China time', () => {
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261019T000000Z\nDTEND:20261019T005000Z\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:数学\nEND:VEVENT\nEND:VCALENDAR`;
  const imported = importIcsLessons(ics);
  assert.deepEqual(imported.map((lesson) => lesson.date), ['2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(imported[0].startTime, '08:00');
});

test('ICS import handles multiple weekdays and excluded dates', () => {
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20261019T080000\nDTEND;TZID=Asia/Shanghai:20261019T085000\nRRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE\nEXDATE;TZID=Asia/Shanghai:20261021T080000\nSUMMARY:物理\nEND:VEVENT\nEND:VCALENDAR`;
  assert.deepEqual(importIcsLessons(ics).map((lesson) => lesson.date),
    ['2026-10-19', '2026-10-26', '2026-10-28']);
});

test('ICS import converts events from another named time zone', () => {
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=America/New_York:20261018T200000\nDTEND;TZID=America/New_York:20261018T205000\nSUMMARY:远程课\nEND:VEVENT\nEND:VCALENDAR`;
  assert.deepEqual(importIcsLessons(ics).map((lesson) => [lesson.date, lesson.startTime]),
    [['2026-10-19', '08:00']]);
});

test('invalid timetable input is rejected before replacing the saved schedule', () => {
  assert.throws(() => makeEditableTimetable([{ date: '2026-10-19', name: '', periodStart: 1,
    periodEnd: 1 }]), /课程数据格式无效/);
  assert.throws(() => importIcsLessons('not an ics file'), /ICS/);
});

test('a makeup date stays under the regular course time in settings', () => {
  const lessons = [
    { date: '2026-10-19', day: 1, regularDay: 1, name: '编译原理', periodStart: 1, periodEnd: 2 },
    { date: '2026-10-26', day: 1, regularDay: 1, name: '编译原理', periodStart: 1, periodEnd: 2 },
    { date: '2026-10-31', day: 6, regularDay: 1, name: '编译原理', periodStart: 1, periodEnd: 2 },
    { date: '2026-10-21', day: 3, regularDay: 3, name: '编译原理', periodStart: 5, periodEnd: 6 },
  ];
  const courses = courseGroups(lessons);
  assert.equal(courses.length, 1);
  assert.deepEqual(courses[0].slots.map((slot) => slot.lesson.regularDay), [1, 3]);
  assert.equal(courses[0].slots[0].items.length, 3);
  assert.equal(lessonGroups(lessons.map(({ regularDay, ...lesson }) => lesson)).length, 2,
    'older caches also merge a one-off makeup date into the regular time');
});
