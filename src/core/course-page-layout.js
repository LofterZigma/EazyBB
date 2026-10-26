export const COURSE_SECTIONS = ['announcements', 'tree', 'assignments'];

function canonicalLessonRecommendationKey(key) {
  try {
    const parts = JSON.parse(key);
    return Array.isArray(parts) && parts.length >= 5 ? JSON.stringify(parts.slice(0, 5)) : key;
  } catch {
    return key;
  }
}

function normalizeCustomSource(item, roots) {
  const source = item.source;
  if (source?.mode === 'range' && !source.legacyRootId) return source;
  const rootId = source?.legacyRootId || source?.rootId || item.splitRootId;
  if (!roots?.length) return source?.mode === 'range' ? source
    : { mode: 'range', start: 0, end: 0, legacyRootId: rootId || null };
  const found = roots.findIndex((root) => root.id === rootId);
  const index = found >= 0 ? found : 0;
  return makeRangeSource(roots, index, index + 1);
}

export function reconcileCoursePageLayout(saved, roots = null) {
  const customs = Array.isArray(saved?.customs) ? saved.customs.filter((item) =>
    typeof item?.id === 'string' && item.id.startsWith('custom:') && typeof item.title === 'string'
  ).map((item) => ({
    id: item.id, title: item.title, titleAuto: item.titleAuto === true,
    origin: item.origin === 'split' ? 'split' : 'manual',
    splitRootId: item.splitRootId || (item.origin === 'split' ? item.source?.rootId : undefined),
    source: normalizeCustomSource(item, roots),
  })) : [];
  const ids = [...COURSE_SECTIONS, ...customs.filter((item) => item.origin !== 'split').map((item) => item.id)];
  const order = [...new Set([...(Array.isArray(saved?.order) ? saved.order : []), ...ids])]
    .filter((id) => ids.includes(id));
  const splitIds = customs.filter((item) => item.origin === 'split').map((item) => item.id);
  const splitOrder = [...new Set([...(Array.isArray(saved?.splitOrder) ? saved.splitOrder
    : Array.isArray(saved?.order) ? saved.order : []), ...splitIds])]
    .filter((id) => splitIds.includes(id));
  const hidden = Array.isArray(saved?.hidden) ? [...new Set(saved.hidden)].filter((id) => [...ids, ...splitIds].includes(id)) : [];
  const titles = Object.fromEntries(COURSE_SECTIONS.map((id) => [id,
    typeof saved?.titles?.[id] === 'string' && saved.titles[id].trim() ? saved.titles[id].trim() : null]));
  const validCardIds = new Set([...ids, ...splitIds]);
  const display = Object.fromEntries(Object.entries(saved?.display ?? {})
    .filter(([id]) => validCardIds.has(id))
    .map(([id, value]) => [id, normalizeSectionDisplay(value)]));
  const treeNodeDisplay = Object.fromEntries(Object.entries(saved?.treeNodeDisplay ?? {})
    .map(([id, value]) => [id, normalizeTreeNodeDisplay(value)]));
  const normalizeRecommended = (values) => Array.isArray(values)
    ? [...new Set(values)].filter((id) => validCardIds.has(id)) : [];
  const recommended = normalizeRecommended(saved?.recommended);
  const recommendedByTimetable = Object.fromEntries(Object.entries(saved?.recommendedByTimetable ?? {})
    .filter(([, values]) => Array.isArray(values))
    .map(([key, values]) => [key, normalizeRecommended(values)]));
  const recommendedByLesson = Object.fromEntries(Object.entries(saved?.recommendedByLesson ?? {})
    .filter(([, values]) => Array.isArray(values))
    .map(([key, values]) => [canonicalLessonRecommendationKey(key), normalizeRecommended(values).slice(0, 2)]));
  const recommendedDisplayByLesson = Object.fromEntries(Object.entries(saved?.recommendedDisplayByLesson ?? {})
    .filter(([, values]) => values && typeof values === 'object' && !Array.isArray(values))
    .map(([key, values]) => [canonicalLessonRecommendationKey(key), Object.fromEntries(Object.entries(values)
      .filter(([id]) => validCardIds.has(id))
      .map(([id, value]) => [id, normalizeLessonPreview(value)]))]));
  const recommendedTreeNodeDisplayByLesson = Object.fromEntries(
    Object.entries(saved?.recommendedTreeNodeDisplayByLesson ?? {})
      .filter(([, sections]) => sections && typeof sections === 'object' && !Array.isArray(sections))
      .map(([key, sections]) => [canonicalLessonRecommendationKey(key), Object.fromEntries(Object.entries(sections)
        .filter(([id, nodes]) => validCardIds.has(id) && nodes && typeof nodes === 'object' && !Array.isArray(nodes))
        .map(([id, nodes]) => [id, Object.fromEntries(Object.entries(nodes)
          .map(([nodeId, value]) => [nodeId, normalizeTreeNodeDisplay(value)]))]))]));
  const layout = { order, splitOrder, hidden, titles, display, treeNodeDisplay,
    recommended, recommendedByTimetable,
    recommendedByLesson, recommendedDisplayByLesson, recommendedTreeNodeDisplayByLesson,
    splitTree: saved?.splitTree === true,
    treeHiddenBeforeSplit: saved?.treeHiddenBeforeSplit === true, customs };
  if (layout.splitTree && roots) return syncSplitItems(layout, roots);
  return layout;
}

export function syncSplitItems(layout, roots) {
  if (!layout.splitTree) return layout;
  const old = new Map(layout.customs.filter((item) => item.origin === 'split').map((item) => [item.splitRootId, item]));
  const manual = layout.customs.filter((item) => item.origin !== 'split');
  const split = roots.map((root, index) => {
    const existing = old.get(root.id);
    const source = existing?.source?.mode === 'range'
      ? makeRangeSource(roots, index, Math.max(index + 1, rangeBounds(existing.source, roots).end))
      : makeRangeSource(roots, index, index + 1);
    return existing ? { ...existing, source, title: existing.titleAuto
      ? (selectCustomRoots(source, roots)[0]?.title || root.title) : existing.title } : {
      id: `custom:tree:${root.id}`, title: root.title, titleAuto: true, splitRootId: root.id,
      origin: 'split', source: makeRangeSource(roots, index, index + 1),
    };
  });
  const valid = new Set([...COURSE_SECTIONS, ...manual.map((item) => item.id), ...split.map((item) => item.id)]);
  const splitIds = new Set(split.map((item) => item.id));
  const splitOrder = [...new Set([...(layout.splitOrder || []), ...split.map((item) => item.id)])]
    .filter((id) => splitIds.has(id));
  return {
    ...layout, customs: [...manual, ...split], splitOrder,
    recommended: layout.recommended.filter((id) => valid.has(id)),
    recommendedByTimetable: Object.fromEntries(Object.entries(layout.recommendedByTimetable)
      .map(([key, values]) => [key, values.filter((id) => valid.has(id))])),
    recommendedByLesson: Object.fromEntries(Object.entries(layout.recommendedByLesson)
      .map(([key, values]) => [key, values.filter((id) => valid.has(id))])),
    recommendedDisplayByLesson: Object.fromEntries(Object.entries(layout.recommendedDisplayByLesson ?? {})
      .map(([key, values]) => [key, Object.fromEntries(Object.entries(values)
        .filter(([id]) => valid.has(id)))])),
    recommendedTreeNodeDisplayByLesson: Object.fromEntries(
      Object.entries(layout.recommendedTreeNodeDisplayByLesson ?? {})
        .map(([key, sections]) => [key, Object.fromEntries(Object.entries(sections)
          .filter(([id]) => valid.has(id)))])),
    hidden: [...new Set([...layout.hidden.filter((id) => valid.has(id)), 'tree'])],
    display: Object.fromEntries(Object.entries(layout.display ?? {}).filter(([id]) => valid.has(id))),
  };
}

export function normalizeLessonPreview(value) {
  return { reverse: value?.reverse === true,
    count: Number(value?.count) === 2 ? 2 : 1 };
}

export function lessonPreviewSettings(layout, lessonKey, sectionId) {
  return normalizeLessonPreview(layout?.recommendedDisplayByLesson?.[lessonKey]?.[sectionId]);
}

export function lessonPreviewItems(items, previewDisplay) {
  const preview = normalizeLessonPreview(previewDisplay);
  return applySectionDisplay(items, { reverse: preview.reverse, limit: preview.count });
}

export function lessonTreeNodeDisplaySettings(layout, lessonKey, sectionId, nodeId) {
  return normalizeTreeNodeDisplay(layout?.recommendedTreeNodeDisplayByLesson?.[lessonKey]?.[sectionId]?.[String(nodeId)]);
}

export function normalizeSectionDisplay(value) {
  const limit = Number(value?.limit);
  return {
    reverse: value?.reverse === true,
    limit: value?.limit !== null && value?.limit !== '' && Number.isInteger(limit) && limit > 0 ? limit : null,
    hiddenItems: Array.isArray(value?.hiddenItems)
      ? [...new Set(value.hiddenItems.filter((id) => id !== null && id !== undefined).map(String))] : [],
  };
}

export function normalizeTreeNodeDisplay(value) {
  const { reverse, limit } = normalizeSectionDisplay(value);
  return { reverse, limit };
}

export function treeNodeDisplaySettings(layout, nodeId) {
  return normalizeTreeNodeDisplay(layout?.treeNodeDisplay?.[String(nodeId)]);
}

export function displayTreeChildren(children, layout, nodeId) {
  return applySectionDisplay(children, treeNodeDisplaySettings(layout, nodeId));
}

export function sectionDisplaySettings(layout, id) {
  return normalizeSectionDisplay(layout?.display?.[id]);
}

export function applySectionDisplay(items, value) {
  const { reverse, limit, hiddenItems } = normalizeSectionDisplay(value);
  const hidden = new Set(hiddenItems);
  const visible = items.filter((item) => !hidden.has(String(item.id)));
  if (reverse) visible.reverse();
  return limit === null ? visible : visible.slice(0, limit);
}

export function filterSectionTree(nodes, hiddenItems) {
  const hidden = new Set(hiddenItems);
  return nodes.filter((node) => !hidden.has(String(node.id))).map((node) => ({
    ...node, children: filterSectionTree(node.children || [], hiddenItems),
  }));
}

export function recommendedForTimetable(layout, key) {
  return Object.hasOwn(layout.recommendedByTimetable, key)
    ? layout.recommendedByTimetable[key] : layout.recommended;
}

export function lessonRecommendationKey(semester, lesson) {
  return JSON.stringify([String(semester ?? ''), String(lesson.name ?? ''), Number(lesson.day),
    Number(lesson.periodStart), Number(lesson.periodEnd)]);
}

export function recommendedForLesson(layout, lessonKey, timetableKey) {
  return (Object.hasOwn(layout.recommendedByLesson, lessonKey)
    ? layout.recommendedByLesson[lessonKey]
    : recommendedForTimetable(layout, timetableKey)).slice(0, 2);
}

export function rangeBounds(source, roots) {
  const first = roots.findIndex((root) => root.id === source?.startId);
  const last = roots.findIndex((root) => root.id === source?.endBeforeId);
  const start = first >= 0 ? first : Math.max(0, Math.min(roots.length, Number(source?.start) || 0));
  const fallbackEnd = Math.max(0, Math.min(roots.length, Number(source?.end) || 0));
  const end = source?.endBeforeId === null ? roots.length : last >= 0 ? last : fallbackEnd;
  return { start, end: Math.max(start, end) };
}

export function makeRangeSource(roots, start, end) {
  return { mode: 'range', start, end, startId: roots[start]?.id || null,
    endBeforeId: roots.length ? (roots[end]?.id || null) : undefined };
}

export function selectCustomRoots(source, roots) {
  if (source?.mode !== 'range') return [];
  const { start, end } = rangeBounds(source, roots);
  return roots.slice(start, end);
}

export function coveredSplitIds(layout, roots) {
  const coveredRoots = new Set();
  if (!layout?.splitTree) return new Set();
  for (const item of layout.customs) {
    if (item.origin !== 'manual' || layout.hidden.includes(item.id)) continue;
    for (const root of selectCustomRoots(item.source, roots)) coveredRoots.add(root.id);
  }
  const split = new Map(layout.customs.filter((item) => item.origin === 'split')
    .map((item) => [item.splitRootId, item]));
  for (const root of roots) {
    const item = split.get(root.id);
    if (!item || coveredRoots.has(root.id) || layout.hidden.includes(item.id)) continue;
    for (const selected of selectCustomRoots(item.source, roots)) {
      if (selected.id !== root.id) coveredRoots.add(selected.id);
    }
  }
  return new Set([...split.values()].filter((item) => coveredRoots.has(item.splitRootId)).map((item) => item.id));
}

export function visibleCoursePageOrder(layout, roots) {
  return layout.order;
}

export function visibleSplitOrder(layout, roots) {
  if (!layout.splitTree) return [];
  const covered = coveredSplitIds(layout, roots);
  return (layout.splitOrder || []).filter((id) => !covered.has(id));
}

export function reorderVisibleCoursePageItems(layout, visibleOrder, roots) {
  const current = visibleCoursePageOrder(layout, roots);
  if (current.length !== visibleOrder.length || current.some((id) => !visibleOrder.includes(id))) return layout;
  const visible = new Set(current);
  const pending = [...visibleOrder];
  return { ...layout, order: layout.order.map((id) => visible.has(id) ? pending.shift() : id) };
}

export function reorderVisibleSplitItems(layout, visibleOrder, roots) {
  const current = visibleSplitOrder(layout, roots);
  if (current.length !== visibleOrder.length || current.some((id) => !visibleOrder.includes(id))) return layout;
  const visible = new Set(current);
  const pending = [...visibleOrder];
  return { ...layout, splitOrder: layout.splitOrder.map((id) => visible.has(id) ? pending.shift() : id) };
}
