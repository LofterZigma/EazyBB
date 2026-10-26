function normalizeCourseName(name) {
  return String(name ?? '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s·•_\-—()[\]{}（）【】]/g, '');
}

export function findBlackboardCourse(lessonName, courses) {
  const title = normalizeCourseName(lessonName);
  if (!title || !Array.isArray(courses)) return null;
  const exact = courses.filter((course) => normalizeCourseName(course.name) === title);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  // Blackboard may append a section, course code, or term to the TIS title.
  const candidates = courses.filter((course) => normalizeCourseName(course.name).startsWith(title));
  return candidates.length === 1 ? candidates[0] : null;
}

export function courseAssociationKey(semester, lessonName) {
  return JSON.stringify([String(semester ?? ''), String(lessonName ?? '')]);
}

export function resolveBlackboardCourse(lessonName, courses, associations, semester) {
  if (!Array.isArray(courses)) return null;
  const savedId = associations?.[courseAssociationKey(semester, lessonName)];
  return courses.find((course) => course.id === savedId)
    ?? findBlackboardCourse(lessonName, courses);
}
