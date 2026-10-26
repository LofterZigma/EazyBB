// JavaScript port of sustech_survival/selectcourse/ical.py.
import { diffDays, isoToUTC } from './calendar.js';

export const PERIOD_START_TIMES = Object.freeze({
  1: [8, 0], 2: [9, 0], 3: [10, 20], 4: [11, 20],
  5: [14, 0], 6: [15, 0], 7: [16, 20], 8: [17, 20],
  9: [19, 0], 10: [20, 0], 11: [21, 0],
});

const CLASS_MINUTES = 50;

function periodClock(period) {
  const time = PERIOD_START_TIMES[period];
  if (!time) throw new RangeError(`Invalid class period: ${period}`);
  return time;
}

function clockText(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function periodTimeRange(startPeriod, endPeriod = startPeriod) {
  if (endPeriod < startPeriod) throw new RangeError('End period precedes start period');
  const [startHour, startMinute] = periodClock(startPeriod);
  const [endHour, endMinute] = periodClock(endPeriod);
  const finish = endHour * 60 + endMinute + CLASS_MINUTES;
  return `${clockText(startHour, startMinute)}–${clockText(Math.floor(finish / 60), finish % 60)}`;
}

function formatUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function periodStart(date, period) {
  const [hour, minute] = periodClock(period);
  return new Date(isoToUTC(date) + ((hour - 8) * 60 + minute) * 60_000);
}

// Older timetable caches contain ICS events generated with the previous bell times.
// Update those events in memory so an export is correct before the next TIS refresh.
export function retimeIcal(ics) {
  if (typeof ics !== 'string') return ics;
  return ics.replace(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g, (event) => {
    const match = /^UID:.*-(\d{4}-\d{2}-\d{2})-p(\d+)@sustech_survival\r?$/m.exec(event);
    if (!match) return event;
    if (!PERIOD_START_TIMES[Number(match[2])]) return '';
    const start = periodStart(match[1], Number(match[2]));
    const end = new Date(start.getTime() + CLASS_MINUTES * 60_000);
    return event.replace(/^DTSTART:[^\r\n]*/m, `DTSTART:${formatUtc(start)}`)
      .replace(/^DTEND:[^\r\n]*/m, `DTEND:${formatUtc(end)}`);
  });
}

export function coursesToIcal(semester, { calName, now = new Date() } = {}) {
  const name = calName || `SUSTech ${semester.human}`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//sustech_survival//calendar//EN',
    `X-WR-CALNAME:${escapeText(name)}`, 'CALSCALE:GREGORIAN',
  ];
  for (const [index, course] of semester.classes.entries()) {
    const uidSeed = `c${index}-${escapeText(course.title) || 'class'}`;
    for (const date of semester.dates(course)) {
      for (const period of course.periods) {
        const start = periodStart(date, period);
        const end = new Date(start.getTime() + CLASS_MINUTES * 60_000);
        const week = Math.floor(diffDays(semester.teachingStart, date) / 7) + 1;
        const description = [
          ...(course.teacher ? [`Teacher: ${course.teacher}`] : []),
          `Week ${week}`,
        ].join(' | ');
        lines.push(
          'BEGIN:VEVENT',
          `UID:${uidSeed}-${date}-p${period}@sustech_survival`,
          `DTSTAMP:${formatUtc(now)}`,
          `DTSTART:${formatUtc(start)}`,
          `DTEND:${formatUtc(end)}`,
          `SUMMARY:${escapeText(course.title || 'Class')}`,
        );
        if (course.room) lines.push(`LOCATION:${escapeText(course.room)}`);
        lines.push(`DESCRIPTION:${escapeText(description)}`, 'END:VEVENT');
      }
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
