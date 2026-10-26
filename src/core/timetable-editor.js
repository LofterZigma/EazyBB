import { addDays, diffDays, todayISO, weekdayOf } from './calendar.js';
import { PERIOD_START_TIMES } from './ical.js';

const pad = (value) => String(value).padStart(2, '0');
const clockMinutes = (value) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
};
const clockText = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export const DEFAULT_CLASS_TIMES = Object.freeze(Object.fromEntries(
  Object.entries(PERIOD_START_TIMES).map(([period, [hour, minute]]) => {
    const start = hour * 60 + minute;
    return [period, { start: clockText(start), end: clockText(start + 50) }];
  }),
));

export const MAX_CLASS_PERIODS = 36;

export function normalizeClassTimes(value) {
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_CLASS_TIMES);
  const entries = Object.entries(value).filter(([period]) => Number.isInteger(Number(period))
    && Number(period) >= 1 && Number(period) <= MAX_CLASS_PERIODS)
    .sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length || entries.some(([period, time], index) => Number(period) !== index + 1
    || !Number.isFinite(clockMinutes(time?.start)) || clockMinutes(time?.end) <= clockMinutes(time?.start))) {
    return structuredClone(DEFAULT_CLASS_TIMES);
  }
  const chronological = entries.map(([, time]) => time).sort((a, b) => clockMinutes(a.start) - clockMinutes(b.start));
  if (chronological.some((time, index) => index > 0
    && clockMinutes(chronological[index - 1].end) > clockMinutes(time.start))) {
    return structuredClone(DEFAULT_CLASS_TIMES);
  }
  return Object.fromEntries(entries.map(([period, time]) => [period,
    { start: time.start, end: time.end }]));
}

export function prepareClassTimeChange(draft, currentTimes, lessons = []) {
  if (!Array.isArray(draft) || draft.length < 1 || draft.length > MAX_CLASS_PERIODS) {
    throw new Error(`课程节数需为 1–${MAX_CLASS_PERIODS} 节`);
  }
  const sorted = draft.map((row) => ({ start: row.start, end: row.end,
    originalPeriod: row.originalPeriod == null ? null : Number(row.originalPeriod) }))
    .sort((a, b) => clockMinutes(a.start) - clockMinutes(b.start));
  const oldPeriods = new Set();
  for (const [index, row] of sorted.entries()) {
    if (!Number.isFinite(clockMinutes(row.start)) || !Number.isFinite(clockMinutes(row.end))
      || clockMinutes(row.end) <= clockMinutes(row.start)) {
      throw new Error('请填写有效的开始和结束时间');
    }
    if (index && clockMinutes(sorted[index - 1].end) > clockMinutes(row.start)) {
      throw new Error('课程节时间不能重叠');
    }
    if (row.originalPeriod !== null) {
      if (!currentTimes[row.originalPeriod] || oldPeriods.has(row.originalPeriod)) {
        throw new Error('课程节数据已变化，请重新打开设置');
      }
      oldPeriods.add(row.originalPeriod);
    }
  }
  const periodMap = new Map(sorted.filter((row) => row.originalPeriod !== null)
    .map((row) => [row.originalPeriod, sorted.indexOf(row) + 1]));
  const updatedLessons = lessons.map((lesson) => {
    const periods = Array.from({ length: lesson.periodEnd - lesson.periodStart + 1 },
      (_, index) => periodMap.get(lesson.periodStart + index));
    if (periods.some((period) => !period)) throw new Error(`第 ${lesson.periodStart}–${lesson.periodEnd} 节仍有课程，请先修改课程再删除节次`);
    const first = Math.min(...periods);
    const last = Math.max(...periods);
    if (last - first + 1 !== periods.length) throw new Error('多节连堂课程的节次不能拆开');
    return { ...lesson, periodStart: first, periodEnd: last };
  });
  return { times: Object.fromEntries(sorted.map(({ start, end }, index) => [index + 1, { start, end }])),
    lessons: updatedLessons, periodMap: Object.fromEntries(periodMap) };
}

export function remapSourceLessons(lessons, periodMap) {
  return lessons.map((lesson) => {
    const periods = Array.from({ length: lesson.periodEnd - lesson.periodStart + 1 },
      (_, index) => Number(periodMap[lesson.periodStart + index]));
    if (periods.some((period) => !Number.isInteger(period) || period < 1)) {
      throw new Error(`TIS 第 ${lesson.periodStart}–${lesson.periodEnd} 节已从时间设置中删除`);
    }
    return { ...lesson, periodStart: Math.min(...periods), periodEnd: Math.max(...periods) };
  });
}

export function lessonTimeRange(lesson, times = DEFAULT_CLASS_TIMES) {
  const start = lesson.startTime || times[lesson.periodStart]?.start;
  const end = lesson.endTime || times[lesson.periodEnd]?.end;
  return start && end ? `${start}–${end}` : '时间待设置';
}

export function validLesson(lesson, times = DEFAULT_CLASS_TIMES) {
  return /^\d{4}-\d{2}-\d{2}$/.test(lesson?.date ?? '')
    && Number.isFinite(Date.parse(`${lesson.date}T00:00:00Z`))
    && typeof lesson.name === 'string' && lesson.name.trim().length > 0
    && Number.isInteger(lesson.periodStart) && lesson.periodStart >= 1 && Boolean(times[lesson.periodStart])
    && Number.isInteger(lesson.periodEnd) && lesson.periodEnd >= lesson.periodStart && Boolean(times[lesson.periodEnd])
    && (!lesson.startTime || Number.isFinite(clockMinutes(lesson.startTime)))
    && (!lesson.endTime || Number.isFinite(clockMinutes(lesson.endTime)))
    && (!lesson.startTime || !lesson.endTime
      || clockMinutes(lesson.endTime) > clockMinutes(lesson.startTime));
}

export function makeEditableTimetable(lessons, previous = null, source = 'custom', times = DEFAULT_CLASS_TIMES) {
  if (!Array.isArray(lessons) || lessons.some((lesson) => !validLesson(lesson, times))) {
    throw new Error('课程数据格式无效');
  }
  const allLessons = lessons.map((lesson) => ({ ...lesson,
    day: weekdayOf(lesson.date) + 1,
    name: lesson.name.trim(),
    location: String(lesson.location || '').trim(),
    teacher: String(lesson.teacher || '').trim(),
  })).sort((a, b) => a.date.localeCompare(b.date) || a.periodStart - b.periodStart || a.name.localeCompare(b.name));
  const today = todayISO();
  const currentMonday = addDays(today, -weekdayOf(today));
  const firstWeekStart = allLessons.length ? addDays(allLessons[0].date, -weekdayOf(allLessons[0].date))
    : previous?.firstWeekStart || currentMonday;
  const lastDate = allLessons.at(-1)?.date;
  const lastWeekStart = lastDate ? addDays(lastDate, -weekdayOf(lastDate))
    : previous?.lastWeekStart || currentMonday;
  const week = 1 + Math.floor(diffDays(firstWeekStart, currentMonday) / 7);
  return {
    semester: previous?.semester || '自定义课程表',
    filename: previous?.filename || 'EazyBB-课程表.ics',
    source,
    week,
    firstWeekStart,
    lastWeekStart,
    lessons: allLessons.filter((lesson) => currentMonday <= lesson.date && lesson.date <= addDays(currentMonday, 6)),
    allLessons,
    ics: lessonsToIcal(allLessons, times),
  };
}

export function lessonGroups(lessons) {
  const counts = new Map();
  for (const lesson of lessons || []) {
    const signature = JSON.stringify([lesson.name, lesson.periodStart, lesson.periodEnd,
      lesson.location || '', lesson.teacher || '', lesson.startTime || '', lesson.endTime || '']);
    if (!counts.has(signature)) counts.set(signature, new Map());
    const weekdays = counts.get(signature);
    weekdays.set(lesson.day, (weekdays.get(lesson.day) || 0) + 1);
  }
  const groups = new Map();
  for (const lesson of lessons || []) {
    const signature = JSON.stringify([lesson.name, lesson.periodStart, lesson.periodEnd,
      lesson.location || '', lesson.teacher || '', lesson.startTime || '', lesson.endTime || '']);
    const weekdays = counts.get(signature);
    const regularDays = [...weekdays].filter(([, count]) => count > 1).map(([day]) => Number(day));
    const candidateDays = regularDays.length ? regularDays
      : [...weekdays.keys()].map(Number).filter((day) => day <= 5);
    const inferredDay = candidateDays.length && !candidateDays.includes(lesson.day)
      ? candidateDays.sort((a, b) => Math.abs(a - lesson.day) - Math.abs(b - lesson.day))[0]
      : lesson.day;
    const regularDay = lesson.regularDay || inferredDay;
    const key = JSON.stringify([lesson.name, regularDay, lesson.periodStart, lesson.periodEnd,
      lesson.location || '', lesson.teacher || '', lesson.startTime || '', lesson.endTime || '']);
    if (!groups.has(key)) groups.set(key, { key, lesson: { ...lesson, regularDay }, dates: [], items: [] });
    groups.get(key).dates.push(lesson.date);
    groups.get(key).items.push(lesson);
  }
  for (const group of groups.values()) group.dates.sort();
  return [...groups.values()].sort((a, b) => a.lesson.regularDay - b.lesson.regularDay
    || a.lesson.periodStart - b.lesson.periodStart || a.lesson.name.localeCompare(b.lesson.name, 'zh-CN'));
}

export function courseGroups(lessons) {
  const courses = new Map();
  for (const slot of lessonGroups(lessons)) {
    if (!courses.has(slot.lesson.name)) courses.set(slot.lesson.name, { name: slot.lesson.name, slots: [] });
    courses.get(slot.lesson.name).slots.push(slot);
  }
  return [...courses.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

const escapeIcs = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  .replace(/,/g, '\\,').replace(/;/g, '\\;');
const unescapeIcs = (value) => String(value || '').replace(/\\[nN]/g, '\n')
  .replace(/\\([,;\\])/g, '$1');
const localParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateTimeParts = (date) => Object.fromEntries(localParts.formatToParts(date)
  .map(({ type, value }) => [type, value]));

function readIcsDateTime(value, params = '') {
  if (/VALUE=DATE/i.test(params) || /^\d{8}$/.test(value)) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  if (utc) {
    const parts = dateTimeParts(new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +(second || 0))));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  const timeZone = /(?:^|;)TZID="?([^";]+)"?/i.exec(params)?.[1];
  if (timeZone && !['Asia/Shanghai', 'PRC', 'China Standard Time'].includes(timeZone)) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const desired = Date.UTC(+year, +month - 1, +day, +hour, +minute);
      let instant = desired;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(instant))
          .map(({ type, value }) => [type, value]));
        const actual = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
          +parts.hour, +parts.minute);
        instant += desired - actual;
      }
      const parts = dateTimeParts(new Date(instant));
      return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
    } catch { throw new Error(`ICS 时区无法识别：${timeZone}`); }
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function lessonsToIcal(lessons, times = DEFAULT_CLASS_TIMES) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EazyBB//Timetable//ZH',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:EazyBB 课程表'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  for (const [index, lesson] of lessons.entries()) {
    const start = lesson.startTime || times[lesson.periodStart]?.start;
    const end = lesson.endTime || times[lesson.periodEnd]?.end;
    if (!start || !end) continue;
    const date = lesson.date.replace(/-/g, '');
    const utcStamp = (time) => new Date(`${lesson.date}T${time}:00+08:00`).toISOString()
      .replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    lines.push('BEGIN:VEVENT', `UID:eazybb-${date}-${index}@local`, `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(end)}`,
      `SUMMARY:${escapeIcs(lesson.name)}`);
    if (lesson.location) lines.push(`LOCATION:${escapeIcs(lesson.location)}`);
    if (lesson.teacher) lines.push(`DESCRIPTION:${escapeIcs(lesson.teacher)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function importIcsLessons(ics, times = DEFAULT_CLASS_TIMES) {
  if (!/BEGIN:VCALENDAR/i.test(ics) || !/END:VCALENDAR/i.test(ics)) throw new Error('不是有效的 ICS 文件');
  const unfolded = String(ics).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [...unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/gi)];
  const lessons = [];
  for (const [, body] of events) {
    const props = new Map();
    for (const line of body.split('\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(';');
      props.set(name.toUpperCase(), { params: params.join(';'), value: line.slice(colon + 1) });
    }
    const startProp = props.get('DTSTART');
    const endProp = props.get('DTEND');
    const start = startProp && readIcsDateTime(startProp.value, startProp.params);
    const end = endProp && readIcsDateTime(endProp.value, endProp.params);
    const name = unescapeIcs(props.get('SUMMARY')?.value).trim();
    if (!start || !end || !name || start.date !== end.date) continue;
    const period = Number(Object.keys(times).find((key) => times[key].start === start.time)) || 1;
    const endPeriod = Number(Object.keys(times).find((key) => times[key].end === end.time)) || period;
    const basic = { name, location: unescapeIcs(props.get('LOCATION')?.value),
      teacher: unescapeIcs(props.get('DESCRIPTION')?.value),
      periodStart: period, periodEnd: Math.max(period, endPeriod),
      startTime: start.time, endTime: end.time };
    const rule = props.get('RRULE')?.value || '';
    if (rule && !/(?:^|;)FREQ=WEEKLY(?:;|$)/i.test(rule)) throw new Error('ICS 仅支持单次课程和每周重复课程');
    const until = /(?:^|;)UNTIL=([^;]+)/i.exec(rule)?.[1];
    const count = Number(/(?:^|;)COUNT=(\d+)/i.exec(rule)?.[1]);
    const interval = Number(/(?:^|;)INTERVAL=(\d+)/i.exec(rule)?.[1] || 1);
    const last = until ? (readIcsDateTime(until)?.date || until.slice(0, 4) + '-' + until.slice(4, 6) + '-' + until.slice(6, 8)) : null;
    const weekdayCodes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const byDay = /(?:^|;)BYDAY=([^;]+)/i.exec(rule)?.[1];
    const days = byDay ? byDay.split(',').map((code) => weekdayCodes.indexOf(code.toUpperCase()))
      : [weekdayOf(start.date)];
    if (days.some((day) => day < 0) || !Number.isInteger(interval) || interval < 1 || interval > 52) {
      throw new Error('ICS 每周重复规则无效');
    }
    if (rule && !last && !count) throw new Error('每周重复课程缺少结束日期或次数');
    const excluded = new Set(body.split('\n').filter((line) => /^EXDATE(?:;|:)/i.test(line))
      .flatMap((line) => {
        const colon = line.indexOf(':');
        const params = line.slice(0, colon).split(';').slice(1).join(';');
        return line.slice(colon + 1).split(',').map((value) => readIcsDateTime(value, params)?.date
          || (/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null));
      }).filter(Boolean));
    const firstMonday = addDays(start.date, -weekdayOf(start.date));
    let occurrences = 0;
    for (let week = 0; week < (rule ? 104 : 1); week += interval) {
      for (const day of days) {
        const date = rule ? addDays(firstMonday, week * 7 + day) : start.date;
        if (date < start.date || (last && date > last)) continue;
        if (count && occurrences >= count) break;
        occurrences += 1;
        if (!excluded.has(date)) lessons.push({ ...basic, date, day: weekdayOf(date) + 1 });
      }
      if (!rule || (count && occurrences >= count) || (last && addDays(firstMonday, (week + interval) * 7) > last)) break;
    }
  }
  if (!lessons.length) throw new Error('ICS 中没有可导入的课程');
  return lessons;
}
