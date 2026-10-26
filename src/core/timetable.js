import { ClassTime, addDays, weekdayOf } from './calendar.js';
import { coursesToIcal } from './ical.js';

export function buildSemesterTimetable(sourceSemester, schedule, current, today) {
  // Calendar instances are shared in the background cache; keep each fetched
  // timetable's classes isolated from other panels and refreshes.
  const semester = Object.assign(Object.create(Object.getPrototypeOf(sourceSemester)), sourceSemester, { classes: [] });
  for (const lesson of schedule.lessons) {
    semester.fill(new ClassTime({
      weeks: lesson.weeks,
      weekday: lesson.day - 1,
      periods: Array.from({ length: lesson.periodEnd - lesson.periodStart + 1 }, (_, i) => lesson.periodStart + i),
      title: lesson.name,
      teacher: lesson.teacher,
      room: lesson.location,
    }));
  }
  if (schedule.lessons.length && !semester.classes.length) throw new Error('TIS 课程与校历日期无法对应');
  const monday = addDays(today, -weekdayOf(today));
  const sunday = addDays(monday, 6);
  const allLessons = semester.classes.flatMap((course) => semester.dates(course)
    .map((date) => ({
      date,
      day: weekdayOf(date) + 1,
      regularDay: course.weekday + 1,
      periodStart: Math.min(...course.periods),
      periodEnd: Math.max(...course.periods),
      name: course.title,
      location: course.room,
      teacher: course.teacher,
    }))).sort((a, b) => a.date.localeCompare(b.date) || a.periodStart - b.periodStart);
  const weekly = allLessons.filter((lesson) => monday <= lesson.date && lesson.date <= sunday);
  return {
    semester: `${current.xn} · 第 ${current.xq} 学期`,
    week: semester.weekOf(today),
    lessons: weekly,
    allLessons,
    firstWeekStart: addDays(semester.teachingStart, -weekdayOf(semester.teachingStart)),
    lastWeekStart: addDays(semester.finalEnd, -weekdayOf(semester.finalEnd)),
    ics: coursesToIcal(semester),
    filename: `EazyBB-${current.tisHuman}.ics`,
  };
}
