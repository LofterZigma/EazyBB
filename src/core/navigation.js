import { PERIOD_START_TIMES } from './ical.js';

export function navigationAssignments(assignments, now = new Date(), limit = 2) {
  const pending = (Array.isArray(assignments) ? assignments : [])
    .filter((item) => item.completed !== true && Number.isFinite(new Date(item.due).getTime()))
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  const upcoming = pending.filter((item) => new Date(item.due) >= now);
  const overdue = pending.filter((item) => new Date(item.due) < now).reverse();
  return [...upcoming, ...overdue].slice(0, limit);
}

export function chooseNavigationItem(lessons, assignments, day, minuteOfDay, now = new Date(), classTimes = null) {
  const availableTimes = classTimes ?? PERIOD_START_TIMES;
  const todaysLessons = (Array.isArray(lessons) ? lessons : []).filter((lesson) => lesson.date === day
    && availableTimes[lesson.periodStart] && availableTimes[lesson.periodEnd]);
  const currentOrNext = todaysLessons.map((lesson) => {
    const [startHour, startMinute] = PERIOD_START_TIMES[lesson.periodStart] ?? [0, 0];
    const [endHour, endMinute] = PERIOD_START_TIMES[lesson.periodEnd] ?? [0, 0];
    const start = lesson.startTime || classTimes?.[lesson.periodStart]?.start;
    const end = lesson.endTime || classTimes?.[lesson.periodEnd]?.end;
    const startMinuteOfDay = /^\d{2}:\d{2}$/.test(start || '')
      ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) : startHour * 60 + startMinute;
    const endMinuteOfDay = /^\d{2}:\d{2}$/.test(end || '')
      ? Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) : endHour * 60 + endMinute + 50;
    return { lesson, start: startMinuteOfDay, end: endMinuteOfDay };
  }).filter((item) => item.end > minuteOfDay)
    .sort((a, b) => Number(b.start <= minuteOfDay) - Number(a.start <= minuteOfDay)
      || a.start - b.start)[0];
  if (currentOrNext) return {
    type: 'course', lesson: currentOrNext.lesson,
    state: currentOrNext.start <= minuteOfDay ? 'ongoing' : 'upcoming',
  };

  const assignment = navigationAssignments(assignments, now, 1)[0];
  return assignment ? { type: 'assignment', assignment } : { type: 'empty' };
}
