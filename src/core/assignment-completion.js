export function normalizeCompletionOverrides(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  return Object.fromEntries(Object.entries(saved)
    .filter(([id, completed]) => typeof id === 'string' && typeof completed === 'boolean'));
}

export function resolveAssignmentCompletion(item, overrides, previousBbCompleted = null) {
  const bbCompleted = Object.hasOwn(item, 'bbCompleted')
    ? (typeof item.bbCompleted === 'boolean' ? item.bbCompleted : null)
    : typeof item.completed === 'boolean' ? item.completed : previousBbCompleted;
  const completed = Object.hasOwn(overrides, item.id) ? overrides[item.id] : bbCompleted;
  return { bbCompleted, completed };
}
