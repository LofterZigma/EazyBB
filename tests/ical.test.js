import test from 'node:test';
import assert from 'node:assert/strict';
import { Semester as CalendarSemester } from '../src/core/calendar.js';
import { Semester as TisSemester } from '../src/core/semester.js';
import { coursesToIcal, periodTimeRange, retimeIcal } from '../src/core/ical.js';
import { buildSemesterTimetable } from '../src/core/timetable.js';

function fallSemester() {
  return new CalendarSemester({
    tis: new TisSemester('2026-20271'),
    level: 'undergraduate',
    teachingStart: '2026-09-07', teachingEnd: '2026-12-25',
    signIn: '2026-09-04', freshmanArrival: null,
    totalTeachingWeeks: 16,
    midtermStart: '2026-10-26', midtermEnd: '2026-11-08', midtermWeeks: [8, 9],
    finalStart: '2026-12-28', finalEnd: '2027-01-08', finalWeeks: [17],
    compensatories: [], extraBreaks: [],
  });
}

test('builds the visible week and an export containing the whole semester', () => {
  const semester = fallSemester();
  const current = new TisSemester('2026-20271');
  const timetable = buildSemesterTimetable(semester, {
    lessons: [{
      name: 'Math, A; B', day: 1, periodStart: 1, periodEnd: 2,
      location: 'Room; 101', teacher: 'Teacher A', weeks: [1, 7],
    }],
  }, current, '2026-10-19');

  assert.equal(timetable.week, 7);
  assert.deepEqual(timetable.lessons.map(({ day, periodStart, periodEnd, name }) => [day, periodStart, periodEnd, name]), [
    [1, 1, 2, 'Math, A; B'],
  ]);
  assert.deepEqual(timetable.allLessons.map(({ date }) => date), ['2026-09-07', '2026-10-19']);
  assert.deepEqual(timetable.allLessons.map(({ regularDay }) => regularDay), [1, 1]);
  assert.equal(timetable.firstWeekStart, '2026-09-07');
  assert.equal(timetable.lastWeekStart, '2027-01-04');
  assert.equal(timetable.filename, 'EazyBB-2026-2027-1.ics');
  assert.equal((timetable.ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.match(timetable.ics, /DTSTART:20261019T000000Z\r\nDTEND:20261019T005000Z/);
  assert.match(timetable.ics, /SUMMARY:Math\\, A\\; B/);
  assert.match(timetable.ics, /LOCATION:Room\\; 101/);
  assert.match(timetable.ics, /DESCRIPTION:Teacher: Teacher A \| Week 7/);
  assert.match(timetable.ics, /DTSTART:20260907T000000Z/);
  assert.equal(semester.classes.length, 0, 'calendar cache must stay unchanged');
});

test('the ICS writer emits CRLF and uses a caller supplied stamp', () => {
  const semester = fallSemester();
  const output = coursesToIcal(semester, { now: new Date('2026-10-18T12:00:00Z') });
  assert.equal(output, 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//sustech_survival//calendar//EN\r\nX-WR-CALNAME:SUSTech 2027 Fall\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n');
});

test('all eleven class periods follow the configured bell times', () => {
  assert.deepEqual(Array.from({ length: 11 }, (_, index) => periodTimeRange(index + 1)), [
    '08:00–08:50', '09:00–09:50', '10:20–11:10', '11:20–12:10',
    '14:00–14:50', '15:00–15:50', '16:20–17:10', '17:20–18:10',
    '19:00–19:50', '20:00–20:50', '21:00–21:50',
  ]);
  assert.equal(periodTimeRange(5, 6), '14:00–15:50');
  assert.throws(() => periodTimeRange(12), RangeError);
});

test('the ICS export uses the new afternoon and evening times', () => {
  const semester = fallSemester();
  const current = new TisSemester('2026-20271');
  const { ics } = buildSemesterTimetable(semester, { lessons: [
    { name: 'Afternoon', day: 1, periodStart: 5, periodEnd: 5, weeks: [1] },
    { name: 'Evening', day: 1, periodStart: 11, periodEnd: 11, weeks: [1] },
  ] }, current, '2026-09-07');
  assert.match(ics, /DTSTART:20260907T060000Z\r\nDTEND:20260907T065000Z/);
  assert.match(ics, /DTSTART:20260907T130000Z\r\nDTEND:20260907T135000Z/);
});

test('old cached ICS events are retimed without changing the calendar structure', () => {
  const semester = fallSemester();
  const current = new TisSemester('2026-20271');
  const { ics } = buildSemesterTimetable(semester, { lessons: [
    { name: 'Afternoon', day: 1, periodStart: 5, periodEnd: 5, weeks: [1] },
  ] }, current, '2026-09-07');
  const old = ics.replace('DTSTART:20260907T060000Z', 'DTSTART:20260907T053000Z')
    .replace('DTEND:20260907T065000Z', 'DTEND:20260907T062000Z');
  assert.equal(retimeIcal(old), ics);
});
