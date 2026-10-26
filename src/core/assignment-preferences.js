export const DEFAULT_ASSIGNMENT_PREFERENCES = Object.freeze({
  limit: 5,
  hideCompletedFavorites: false,
  sort: 'dueAsc',
  daysBefore: 0,
  daysAfter: 30,
});

const SORT_OPTIONS = new Set(['dueAsc', 'dueDesc', 'course']);

export function normalizeAssignmentPreferences(saved) {
  const bounded = (value, fallback, max) => Number.isInteger(Number(value))
    ? Math.min(max, Math.max(0, Number(value))) : fallback;
  return {
    limit: Math.max(1, bounded(saved?.limit, 5, 100)),
    hideCompletedFavorites: saved?.hideCompletedFavorites === true,
    sort: SORT_OPTIONS.has(saved?.sort) ? saved.sort : 'dueAsc',
    daysBefore: bounded(saved?.daysBefore, 0, 365),
    daysAfter: bounded(saved?.daysAfter, 30, 365),
  };
}

export function sortAssignments(items, sort = 'dueAsc') {
  return [...items].sort((a, b) => {
    if (sort === 'course') {
      const byCourse = a.course.localeCompare(b.course, 'zh-CN');
      if (byCourse) return byCourse;
    }
    const byDue = a.due.getTime() - b.due.getTime();
    return (sort === 'dueDesc' ? -byDue : byDue) || a.title.localeCompare(b.title, 'zh-CN');
  });
}

export function homeAssignments(items, favorites, savedPreferences, dayKeyAtOffset, limitOverride = null) {
  const preferences = normalizeAssignmentPreferences(savedPreferences);
  const firstDay = dayKeyAtOffset(-preferences.daysBefore);
  const lastDay = dayKeyAtOffset(preferences.daysAfter);
  const visible = items.filter((item) => {
    const favorite = favorites.has(item.id);
    if (favorite && item.completed === true && preferences.hideCompletedFavorites) return false;
    if (favorite) return true;
    return item.completed !== true && item.dayKey >= firstDay && item.dayKey <= lastDay;
  });
  const sorted = sortAssignments(visible, preferences.sort);
  return [...sorted.filter((item) => favorites.has(item.id)),
    ...sorted.filter((item) => !favorites.has(item.id))].slice(0, limitOverride ?? preferences.limit);
}

export function allAssignments(items) {
  return [...items].sort((a, b) => Number(a.completed === true) - Number(b.completed === true)
    || a.due.getTime() - b.due.getTime() || a.title.localeCompare(b.title, 'zh-CN'));
}
