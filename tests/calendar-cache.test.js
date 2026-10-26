import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AcademicCalendar, CALENDAR_PROXY_BASE } from '../src/core/calendar.js';

test('keeps the saved calendar when a later HTTP refresh fails', async () => {
  const semester = (start, end) => ({
    sign_in: start, teaching_start: start, total_teaching_weeks: 1,
    midterm: { start, end: start, equivalent_weeks: [] },
    final: { start: end, end, equivalent_weeks: [2] },
  });
  const calendar = {
    spring_semester: semester('2026-02-23', '2026-03-08'),
    fall_semester: semester('2026-09-07', '2026-09-20'),
  };
  const saved = {
    'calendar/2026/undergraduate.json': calendar,
    'calendar/2026/graduate.json': calendar,
    'calendar/2026/general.json': { holidays: [] },
  };
  const storage = { get: async (key) => ({ [key]: saved[key] }), set: async (value) => Object.assign(saved, value) };
  const result = await AcademicCalendar.load(2026, 'undergraduate', {
    storage,
    fetchImpl: async () => ({ status: 503, ok: false, statusText: 'Unavailable' }),
  });
  assert.equal(result.spring.teachingStart, '2026-02-23');
  assert.equal(result.fall.teachingStart, '2026-09-07');
  assert.deepEqual(saved['calendar/2026/undergraduate.json'], calendar);
});

test('uses bundled 2026 calendar when the domestic proxy is unavailable', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.startsWith(CALENDAR_PROXY_BASE)) throw new TypeError('Failed to fetch');
    return new Response(await readFile(new URL(url), 'utf8'), { status: 200 });
  };
  const calendar = await AcademicCalendar.load(2026, 'undergraduate', { fetchImpl });
  assert.equal(calendar.fall.teachingStart, '2026-09-07');
  assert.equal(calendar.holidays.find((item) => item.name === '国庆节')?.start, '2026-10-01');
  assert.equal(requested.filter((url) => url.startsWith(CALENDAR_PROXY_BASE)).length, 2);
  assert.equal(requested.some((url) => url.endsWith('/graduate.json')), false);
});
